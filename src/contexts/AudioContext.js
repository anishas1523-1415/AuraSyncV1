"use client";
import { createContext, useContext, useState, useRef, useEffect, useCallback } from "react";
import { useUser } from "@/lib/clerk";
import {
  syncHistoryToCloud, syncLikedToCloud, syncPlaylistsToCloud, syncProfileToCloud, loadLibraryFromCloud
} from "@/lib/dbSync";
import { toast } from "@/lib/toast";
import { apiUrl } from "@/lib/api";

// Capacitor MediaSession plugin: drives the Android notification / lock screen controls.
// On the web it wraps navigator.mediaSession, so one adapter covers both.
// The plugin is a Proxy that answers every property (even `then`), so it must be wrapped in an
// object: resolving a promise with it directly calls a non-existent native `then()` method.
const mediaSessionPluginPromise = typeof window !== "undefined"
  ? import("@capgo/capacitor-media-session").then((m) => ({ plugin: m.MediaSession })).catch(() => ({ plugin: null }))
  : Promise.resolve({ plugin: null });

const webMediaSession = {
  setMetadata: async (options) => { navigator.mediaSession.metadata = new MediaMetadata(options); },
  setPlaybackState: async ({ playbackState }) => { navigator.mediaSession.playbackState = playbackState; },
  setActionHandler: async ({ action }, handler) => { navigator.mediaSession.setActionHandler(action, handler); },
  setPositionState: async (options) => { navigator.mediaSession.setPositionState(options); }
};

const withMediaSession = (fn) => {
  mediaSessionPluginPromise
    .then(({ plugin }) => {
      if (plugin) return fn(plugin);
      if ("mediaSession" in navigator) return fn(webMediaSession);
    })
    .catch(() => {}); // Unsupported action or platform: ignore
};

const AudioContext = createContext();
export const audioProgressEmitter = typeof window !== "undefined" ? new EventTarget() : null;
// Last emitted values, so components mounting mid-song start with the right time
const lastEmitted = { progress: 0, duration: 0 };

const HISTORY_KEY = "aurasynq_play_history";
const LIKED_KEY = "aurasynq_liked_songs_metadata";
const PLAYLISTS_KEY = "aurasynq_custom_playlists";
const DOWNLOADS_KEY = "aurasynq_downloaded_metadata";
const AUTO_CACHE_KEY = "aurasynq_auto_cached_ids";
const STATS_KEY = "aurasynq_listen_stats";
const SYNC_META_KEY = "aurasynq_sync_meta";
const AUDIO_CACHE = "aurasynq_offline_audio";

const HISTORY_LIMIT = 50;
const AUTO_CACHE_LIMIT = 25;          // recently played songs kept for offline replay
const AUTO_CACHE_AFTER_SECONDS = 30;  // only cache songs that were actually listened to
const RADIO_BATCH = 8;
const WARM_AHEAD = 2;                 // upcoming queue songs resolved ahead of time
const WARM_LIST_TOP = 2;              // top songs of a freshly opened list
const FIRST_BUFFER_TIMEOUT_MS = 30000; // a cold song can take a while to resolve
const STALL_TIMEOUT_MS = 15000;       // mid-song stall before reconnecting
const MAX_STREAM_RECOVERIES = 2;
const DEFAULT_STATS = { totalSeconds: 0, trackPlays: 0 };

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const DIRECT_AUDIO = /\.(mp3|m4a|wav|ogg|aac)($|\?)/i;
const LONG_FORM = /(full album|greatest hits|jukebox|non ?stop|playlist|\bmix\b|mashup|compilation|\d+\s*hours?)/i;

const readStored = (key, fallback = []) => {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch (e) {
    return fallback;
  }
};

const writeStored = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
};

// Strip heavy payloads before saving to LocalStorage to prevent quota limits
const lightTrack = (track) => {
  const light = { ...track };
  delete light.lyrics;
  delete light.djIntro;
  return light;
};

const mergeById = (primary, secondary) => {
  const seen = new Set(primary.map(t => t.id));
  return [...primary, ...secondary.filter(t => t && !seen.has(t.id))];
};

// Newer side wins so deletions on one device stick; unknown order (legacy data) is merged
const resolveCollection = (local, localAt, cloud, cloudAt) => {
  if (!cloud.length) return local;
  if (!local.length) return cloud;
  if (cloudAt > localAt) return cloud;
  if (localAt > cloudAt) return local;
  return mergeById(local, cloud);
};

const extractId = (t) => {
  if (!t) return null;
  if (t.id && YOUTUBE_ID.test(t.id)) return t.id;
  if (t.url) {
    const m1 = t.url.match(/[?&]v=([A-Za-z0-9_-]{11})/);
    if (m1 && m1[1]) return m1[1];
    const m2 = t.url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
    if (m2 && m2[1]) return m2[1];
  }
  return t.id || null;
};

const streamKey = (id) => apiUrl(`/api/stream?id=${id}`);

// Downloads a whole song for the Cache API. `Range: bytes=0-` takes the fast chunked path
// (plain GETs crawl on invidious-companion), and the result is re-wrapped as a 200 because
// cache.put() rejects partial (206) responses.
const fetchAudioForCache = async (url) => {
  const res = await fetch(url, { headers: { Range: "bytes=0-" } });
  if (res.status !== 200 && res.status !== 206) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const total = Number(res.headers.get("content-range")?.split("/")[1]);
  if (total && blob.size < total) throw new Error("Incomplete download");
  return new Response(blob, {
    status: 200,
    headers: { "content-type": res.headers.get("content-type") || blob.type || "audio/mp4" }
  });
};
const shortTitle = (title = "") => title.split("|")[0].split("(")[0].trim();
const cleanArtistName = (artist = "") => artist.replace(/\s*-\s*Topic$/i, "").replace(/VEVO$/i, "").trim();

const shuffleAround = (list, first) => {
  const rest = list.filter(t => t.id !== first?.id);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return first && list.some(t => t.id === first.id) ? [first, ...rest] : rest;
};

const isSameQueue = (a, b) =>
  a === b || (a.length === b.length && a.every((t, i) => t.id === b[i]?.id));

const generateMockLyrics = (title, artist) => {
  const cleanTitle = title.split('|')[0].split('(')[0].split('-')[0].trim();
  return [
    { time: 0, text: `🎵 ${cleanTitle}` },
    { time: 3, text: `👤 ${artist}` },
    { time: 6, text: `(Searching for synced lyrics...)` },
    { time: 10, text: `(If no lyrics appear, they are unavailable for this track)` }
  ];
};

const noLyricsFound = (title, artist) => {
  const cleanTitle = title.split('|')[0].split('(')[0].split('-')[0].trim();
  return [
    { time: 0, text: `🎵 ${cleanTitle}` },
    { time: 3, text: `👤 ${artist}` },
    { time: 6, text: `(No synced lyrics found for this track)` }
  ];
};

const parseLRC = (lrcText) => {
  if (!lrcText) return null;
  const lines = lrcText.split("\n");
  const lyrics = [];
  const timeRegex = /\[(\d+):(\d+)(?:\.(\d+))?\]/;

  for (const line of lines) {
    const match = timeRegex.exec(line);
    if (match) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const milliseconds = match[3] ? parseInt(match[3].padEnd(3, "0").substring(0, 3), 10) : 0;

      const timeInSeconds = minutes * 60 + seconds + milliseconds / 1000;
      const text = line.replace(timeRegex, "").trim();

      if (text) {
        lyrics.push({ time: timeInSeconds, text });
      }
    }
  }
  return lyrics.length > 0 ? lyrics : null;
};

const parsePlainLyrics = (plainText, songDuration) => {
  if (!plainText) return null;
  const lines = plainText.split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  const duration = songDuration || 240;
  const interval = duration / (lines.length + 2);

  return lines.map((text, index) => ({
    time: Math.floor((index + 1) * interval),
    text
  }));
};

export function AudioProvider({ children }) {
  const { user } = useUser();
  const [currentTrack, setCurrentTrack] = useState(null);
  const [queue, setQueueState] = useState([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);

  const progressRef = useRef(0);
  const durationRef = useRef(0);

  const setProgress = (val) => {
    progressRef.current = val;
    lastEmitted.progress = val;
    if (audioProgressEmitter) {
      audioProgressEmitter.dispatchEvent(new CustomEvent('progress', { detail: val }));
    }
  };

  const setDuration = (val) => {
    if (durationRef.current === val) return;
    durationRef.current = val;
    lastEmitted.duration = val;
    if (audioProgressEmitter) {
      audioProgressEmitter.dispatchEvent(new CustomEvent('duration', { detail: val }));
    }
  };

  const [mounted, setMounted] = useState(false);
  // Library state starts empty and is loaded after mount, so server and client renders match
  const [libraryReady, setLibraryReady] = useState(false);
  const [playHistory, setPlayHistory] = useState([]);
  const [likedTracks, setLikedTracks] = useState([]);
  const [customPlaylists, setCustomPlaylists] = useState([]);
  const [listenStats, setListenStats] = useState(DEFAULT_STATS);
  const [isShuffle, setIsShuffle] = useState(false);
  const [contextPlaylist, setContextPlaylist] = useState(null);
  const [sharedTrackInfo, setSharedTrackInfo] = useState(null);
  const [cloudUserId, setCloudUserId] = useState(null);

  const audioRef = useRef(null);

  // Refs mirror state so media-session handlers, timers and async continuations never read stale values
  const currentTrackRef = useRef(null);
  const queueRef = useRef([]);
  const originalQueueRef = useRef([]);
  const isShuffleRef = useRef(false);
  const playHistoryRef = useRef([]);
  const likedTracksRef = useRef([]);
  const customPlaylistsRef = useRef([]);

  const blobUrlRef = useRef(null);
  const unlockedRef = useRef(false);        // audio element has played after a user gesture (iOS)
  const consecutiveErrorsRef = useRef(0);
  const recoveryRef = useRef({ trackId: null, attempts: 0, resumeAt: 0 });
  const stallTimerRef = useRef(null);
  const cachedIdsRef = useRef(new Set());   // songs available offline (downloads + auto-cache)
  const warmedIdsRef = useRef(new Set());
  const radioPendingRef = useRef(null);
  const lastPushedRef = useRef({});

  const listenStatsRef = useRef(DEFAULT_STATS);
  const pendingListenRef = useRef(0);
  const trackListenRef = useRef(0);
  const lastTickRef = useRef(null);

  useEffect(() => { isShuffleRef.current = isShuffle; }, [isShuffle]);
  useEffect(() => { playHistoryRef.current = playHistory; }, [playHistory]);
  useEffect(() => { likedTracksRef.current = likedTracks; }, [likedTracks]);
  useEffect(() => { customPlaylistsRef.current = customPlaylists; }, [customPlaylists]);

  const commitQueue = (nextQueue) => {
    queueRef.current = nextQueue;
    setQueueState(nextQueue);
  };

  const setQueue = (valueOrUpdater) => {
    const next = typeof valueOrUpdater === "function" ? valueOrUpdater(queueRef.current) : valueOrUpdater;
    originalQueueRef.current = next;
    commitQueue(next);
  };

  const setCurrent = (track) => {
    currentTrackRef.current = track;
    setCurrentTrack(track);
  };

  // ─── Library loading & persistence ───────────────────────

  useEffect(() => {
    setMounted(true);
    setPlayHistory(readStored(HISTORY_KEY));
    setLikedTracks(readStored(LIKED_KEY));
    setCustomPlaylists(readStored(PLAYLISTS_KEY));
    const stats = { ...DEFAULT_STATS, ...readStored(STATS_KEY, DEFAULT_STATS) };
    listenStatsRef.current = stats;
    setListenStats(stats);
    cachedIdsRef.current = new Set([
      ...readStored(DOWNLOADS_KEY).map(t => extractId(t)),
      ...readStored(AUTO_CACHE_KEY)
    ]);
    setLibraryReady(true);
  }, []);

  useEffect(() => { if (libraryReady) writeStored(HISTORY_KEY, playHistory); }, [playHistory, libraryReady]);
  useEffect(() => { if (libraryReady) writeStored(LIKED_KEY, likedTracks); }, [likedTracks, libraryReady]);
  useEffect(() => { if (libraryReady) writeStored(PLAYLISTS_KEY, customPlaylists); }, [customPlaylists, libraryReady]);

  // Records when the user last edited a collection, so the newest device wins on restore
  const touchSyncMeta = (key) => {
    const meta = readStored(SYNC_META_KEY, {});
    meta[key] = Date.now();
    writeStored(SYNC_META_KEY, meta);
  };

  // Restore from the cloud BEFORE pushing anything, so a fresh device never wipes the saved library
  useEffect(() => {
    if (!libraryReady || !user?.id) return;
    let cancelled = false;
    const userId = user.id;
    syncProfileToCloud(user);

    loadLibraryFromCloud(userId).then((cloud) => {
      if (cancelled || !cloud) return;
      const meta = readStored(SYNC_META_KEY, {});

      const liked = resolveCollection(likedTracksRef.current, meta.liked || 0, cloud.likedTracks, cloud.likedUpdatedAt);
      const playlists = resolveCollection(customPlaylistsRef.current, meta.playlists || 0, cloud.customPlaylists, cloud.playlistsUpdatedAt);
      const history = mergeById(playHistoryRef.current, cloud.playHistory).slice(0, HISTORY_LIMIT);

      meta.liked = Math.max(meta.liked || 0, cloud.likedUpdatedAt);
      meta.playlists = Math.max(meta.playlists || 0, cloud.playlistsUpdatedAt);
      writeStored(SYNC_META_KEY, meta);

      // What the cloud already holds; identical values are not pushed back
      lastPushedRef.current = {
        liked: JSON.stringify(cloud.likedTracks),
        playlists: JSON.stringify(cloud.customPlaylists),
        history: JSON.stringify(cloud.playHistory)
      };
      setLikedTracks(liked);
      setCustomPlaylists(playlists);
      setPlayHistory(history);
      setCloudUserId(userId);
    });

    return () => { cancelled = true; };
  }, [libraryReady, user?.id]);

  const pushIfChanged = (key, value, push) => {
    if (!cloudUserId || cloudUserId !== user?.id) return;
    const json = JSON.stringify(value);
    if (lastPushedRef.current[key] === json) return;
    lastPushedRef.current[key] = json;
    push();
  };

  useEffect(() => {
    pushIfChanged("history", playHistory, () => syncHistoryToCloud(playHistory, cloudUserId));
  }, [playHistory, cloudUserId]);

  useEffect(() => {
    pushIfChanged("liked", likedTracks, () =>
      syncLikedToCloud(likedTracks, cloudUserId, readStored(SYNC_META_KEY, {}).liked || Date.now()));
  }, [likedTracks, cloudUserId]);

  useEffect(() => {
    pushIfChanged("playlists", customPlaylists, () =>
      syncPlaylistsToCloud(customPlaylists, cloudUserId, readStored(SYNC_META_KEY, {}).playlists || Date.now()));
  }, [customPlaylists, cloudUserId]);

  // ─── Listening stats ─────────────────────────────────────

  const saveListenStats = (stats) => {
    listenStatsRef.current = stats;
    writeStored(STATS_KEY, stats);
    setListenStats(stats);
  };

  const flushListenStats = () => {
    if (pendingListenRef.current <= 0) return;
    const stats = listenStatsRef.current;
    saveListenStats({ ...stats, totalSeconds: Math.round(stats.totalSeconds + pendingListenRef.current) });
    pendingListenRef.current = 0;
  };

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") flushListenStats(); };
    window.addEventListener("pagehide", flushListenStats);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flushListenStats);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, []);

  // ─── Queue ───────────────────────────────────────────────

  const removeFromQueue = (trackId) => {
    commitQueue(queueRef.current.filter(t => t.id !== trackId));
    originalQueueRef.current = originalQueueRef.current.filter(t => t.id !== trackId);
  };

  const addToQueue = (track) => {
    if (!track || queueRef.current.some(t => t.id === track.id)) return;
    commitQueue([...queueRef.current, track]);
    originalQueueRef.current = [...originalQueueRef.current, track];
  };

  const toggleShuffle = () => {
    const nextShuffle = !isShuffleRef.current;
    const current = currentTrackRef.current;
    if (nextShuffle) {
      originalQueueRef.current = queueRef.current;
      commitQueue(shuffleAround(queueRef.current, current));
    } else {
      // Restore the original order, keeping tracks added or removed while shuffled
      const live = new Set(queueRef.current.map(t => t.id));
      const restored = originalQueueRef.current.filter(t => live.has(t.id));
      const restoredIds = new Set(restored.map(t => t.id));
      commitQueue([...restored, ...queueRef.current.filter(t => !restoredIds.has(t.id))]);
    }
    isShuffleRef.current = nextShuffle;
    setIsShuffle(nextShuffle);
  };

  const applyNewQueue = (newQueue, track) => {
    if (isSameQueue(newQueue, queueRef.current)) return;
    originalQueueRef.current = newQueue;
    commitQueue(isShuffleRef.current ? shuffleAround(newQueue, track) : newQueue);
  };

  // ─── Playback ────────────────────────────────────────────

  const safePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    const attempt = audio.play();
    if (!attempt?.then) return;
    attempt
      .then(() => { unlockedRef.current = true; })
      .catch(err => {
        if (err.name === 'AbortError') return; // superseded by a newer track load
        setIsBuffering(false);
        setIsPlaying(false);
        if (err.name === 'NotAllowedError') {
          toast("Tap play to start listening");
        } else {
          console.warn('HTML audio play failed:', err);
        }
      });
  };

  const revokeBlobUrl = () => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  };

  const playFromCache = async (track, trackId, shouldAutoPlay) => {
    if (typeof window === "undefined" || !("caches" in window)) return false;
    try {
      const cache = await caches.open(AUDIO_CACHE);
      const response = (await cache.match(streamKey(trackId))) || (track.url ? await cache.match(track.url) : null);
      if (!response) return false;
      const blob = await response.blob();
      const audio = audioRef.current;
      if (!audio || currentTrackRef.current?.id !== track.id) return true;
      revokeBlobUrl();
      blobUrlRef.current = URL.createObjectURL(blob);
      audio.src = blobUrlRef.current;
      console.log("AuraSynq Debug: Playing cached audio locally", track.title);
      if (shouldAutoPlay) safePlay(); else setIsBuffering(false);
      return true;
    } catch (err) {
      console.warn("Offline cache playback failed:", err);
      return false;
    }
  };

  const fetchLyricsFromApi = useRef(null);
  const lyricsAbortRef = useRef(null);
  fetchLyricsFromApi.current = async (title, artist, trackId, hadOwnLyrics) => {
    if (lyricsAbortRef.current) lyricsAbortRef.current.abort();
    lyricsAbortRef.current = new AbortController();
    const signal = lyricsAbortRef.current.signal;

    let lyricsLines = null;
    try {
      const url = apiUrl(`/api/lyrics?id=${encodeURIComponent(trackId)}&title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`);
      const res = await fetch(url, { signal });
      if (res.ok) {
        const data = await res.json();
        lyricsLines = data.syncedLyrics
          ? parseLRC(data.syncedLyrics)
          : parsePlainLyrics(data.plainLyrics, data.duration);
      }
    } catch (err) {
      if (err.name === 'AbortError') return null;
    }

    if (lyricsLines?.length) {
      setCurrentTrack(prev => (prev && prev.id === trackId ? { ...prev, lyrics: lyricsLines } : prev));
      return lyricsLines;
    }
    // Replace the "Searching..." placeholder with a definitive answer
    if (!hadOwnLyrics) {
      setCurrentTrack(prev => (prev && prev.id === trackId ? { ...prev, lyrics: noLyricsFound(title, artist) } : prev));
    }
    return null;
  };

  const stopAudio = () => {
    clearStallTimer();
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      // removeAttribute + load() empties the element without firing an error event
      audio.removeAttribute('src');
      audio.load();
    }
    revokeBlobUrl();
    flushListenStats();
    setCurrent(null);
    setIsPlaying(false);
    setIsBuffering(false);
    setProgress(0);
    setDuration(0);
    commitQueue([]);
    originalQueueRef.current = [];
  };

  const addToHistory = (track) => {
    const light = lightTrack(track);
    setPlayHistory(prev => [light, ...prev.filter(t => t.id !== track.id)].slice(0, HISTORY_LIMIT));
    const stats = listenStatsRef.current;
    saveListenStats({ ...stats, trackPlays: stats.trackPlays + 1 });
  };

  const playTrack = (track, newQueue = null, shouldAutoPlay = true) => {
    if (!track) return;

    if (newQueue) {
      applyNewQueue(newQueue, track);
    } else if (!queueRef.current.some(t => t.id === track.id)) {
      addToQueue(track);
    }

    const audio = audioRef.current;

    if (currentTrackRef.current?.id === track.id) {
      seekTo(0);
      if (shouldAutoPlay) safePlay();
      return;
    }

    flushListenStats();
    clearStallTimer();
    recoveryRef.current = { trackId: null, attempts: 0, resumeAt: 0 };
    trackListenRef.current = 0;
    lastTickRef.current = null;

    const hadOwnLyrics = !!track.lyrics;
    setCurrent({ ...track, lyrics: track.lyrics || generateMockLyrics(track.title, track.artist) });
    setIsBuffering(shouldAutoPlay);
    setProgress(0);
    setDuration(0);
    addToHistory(track);
    fetchLyricsFromApi.current(track.title, track.artist, track.id, hadOwnLyrics);

    if (!audio) return;
    revokeBlobUrl();

    const trackId = extractId(track);
    const isYouTube = !!trackId && YOUTUBE_ID.test(trackId);
    const online = typeof navigator === "undefined" || navigator.onLine !== false;
    const isCached = cachedIdsRef.current.has(trackId);

    const startNetwork = (src) => {
      audio.src = src;
      audio.currentTime = 0;
      if (shouldAutoPlay) {
        safePlay();
        startStallWatch();
      } else {
        setIsBuffering(false);
      }
    };

    // Cached songs play from the device once the element is unlocked (saves data, works offline).
    // Otherwise start synchronously to keep the user-gesture context mobile browsers require.
    if (online && !(isCached && unlockedRef.current)) {
      if (isYouTube) return startNetwork(streamKey(trackId));
      if (track.url && DIRECT_AUDIO.test(track.url)) return startNetwork(track.url);
    }

    playFromCache(track, trackId, shouldAutoPlay).then((played) => {
      if (played || currentTrackRef.current?.id !== track.id) return;
      if (online && isYouTube) return startNetwork(streamKey(trackId));
      if (online && track.url && DIRECT_AUDIO.test(track.url)) return startNetwork(track.url);
      setIsBuffering(false);
      setIsPlaying(false);
      toast(online ? "This song can't be played right now." : "You're offline — this song isn't downloaded.", { variant: "error" });
    });
  };

  // Keep the vibe going: when the queue runs out, append similar tracks instead of looping
  const extendQueueWithRadio = (seed) => {
    if (radioPendingRef.current) return radioPendingRef.current;
    const run = (async () => {
      try {
        const artist = cleanArtistName(seed.artist);
        const query = artist && artist !== "Unknown Artist"
          ? `${artist} best songs`
          : `${shortTitle(seed.title)} similar songs`;
        const res = await fetch(apiUrl(`/api/search?q=${encodeURIComponent(query)}`));
        if (!res.ok) return [];
        const data = await res.json();
        const known = new Set([...queueRef.current, ...playHistoryRef.current].map(t => t.id));
        const fresh = (data.tracks || [])
          .filter(t => t?.id && !known.has(t.id) && !LONG_FORM.test(t.title || ""))
          .slice(0, RADIO_BATCH);
        if (fresh.length) {
          commitQueue([...queueRef.current, ...fresh]);
          originalQueueRef.current = [...originalQueueRef.current, ...fresh];
          toast(`📻 Aura Radio queued ${fresh.length} songs like "${shortTitle(seed.title).slice(0, 28)}"`);
        }
        return fresh;
      } catch (e) {
        return [];
      } finally {
        radioPendingRef.current = null;
      }
    })();
    radioPendingRef.current = run;
    return run;
  };

  const playNext = (shouldAutoPlay = !audioRef.current?.paused) => {
    const currentQ = queueRef.current;
    const currentT = currentTrackRef.current;
    if (!currentT) return;

    const currentIndex = currentQ.findIndex(t => t.id === currentT.id);
    if (currentIndex === -1) {
      if (currentQ.length) playTrack(currentQ[0], null, shouldAutoPlay);
      return;
    }
    if (currentIndex < currentQ.length - 1) {
      playTrack(currentQ[currentIndex + 1], null, shouldAutoPlay);
      return;
    }

    extendQueueWithRadio(currentT).then((added) => {
      if (currentTrackRef.current?.id !== currentT.id) return; // user already moved on
      if (added.length) playTrack(added[0], null, shouldAutoPlay);
      else if (currentQ.length > 1) playTrack(currentQ[0], null, shouldAutoPlay);
      else seekTo(0);
    });
  };

  const playPrevious = (shouldAutoPlay = !audioRef.current?.paused) => {
    const currentQ = queueRef.current;
    const currentT = currentTrackRef.current;
    if (!currentT) return;

    // If progress is > 3 seconds, or it's the only track, restart the track
    if (progressRef.current > 3 || currentQ.length <= 1) {
      seekTo(0);
      return;
    }

    const currentIndex = currentQ.findIndex(t => t.id === currentT.id);
    if (currentIndex !== -1) {
      const prevIndex = (currentIndex - 1 + currentQ.length) % currentQ.length;
      playTrack(currentQ[prevIndex], null, shouldAutoPlay);
    }
  };

  const resume = () => {
    const audio = audioRef.current;
    if (!audio || !currentTrackRef.current) return;
    // Retry a failed stream instead of calling play() on a dead source
    if (audio.error) audio.load();
    safePlay();
  };

  const pause = () => audioRef.current?.pause();

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio || !currentTrackRef.current) return;
    if (audio.paused) resume(); else pause();
  };

  const syncPositionState = () => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    withMediaSession(ms => ms.setPositionState({
      duration: audio.duration,
      playbackRate: audio.playbackRate || 1,
      position: Math.min(audio.currentTime || 0, audio.duration)
    }));
  };

  const seekTo = (seconds) => {
    const audio = audioRef.current;
    if (!currentTrackRef.current || !audio) return;
    try {
      const max = Number.isFinite(audio.duration) ? audio.duration : seconds;
      const target = Math.max(0, Math.min(seconds, max));
      audio.currentTime = target;
      lastTickRef.current = null;
      setProgress(target);
      syncPositionState();
    } catch (err) {
      console.warn('HTML audio seek failed:', err);
    }
  };

  // Latest handlers for lock screen / notification callbacks registered once
  const actionsRef = useRef({});
  actionsRef.current = { resume, pause, playNext, playPrevious, seekTo };

  useEffect(() => {
    const handlers = {
      play: () => actionsRef.current.resume(),
      pause: () => actionsRef.current.pause(),
      stop: () => actionsRef.current.pause(),
      nexttrack: () => actionsRef.current.playNext(true),
      previoustrack: () => actionsRef.current.playPrevious(true),
      seekto: (details) => {
        if (details?.seekTime != null) actionsRef.current.seekTo(details.seekTime);
      },
      seekforward: (details) => actionsRef.current.seekTo(progressRef.current + (details?.seekOffset || 10)),
      seekbackward: (details) => actionsRef.current.seekTo(progressRef.current - (details?.seekOffset || 10))
    };
    withMediaSession((ms) => Promise.all(Object.entries(handlers).map(([action, handler]) =>
      Promise.resolve().then(() => ms.setActionHandler({ action }, handler)).catch(() => {})
    )));
  }, []);

  // Lock screen / notification metadata
  useEffect(() => {
    if (!currentTrack) return;
    const cover = currentTrack.cover || "/icon-512x512.png";
    withMediaSession(ms => ms.setMetadata({
      title: shortTitle(currentTrack.title) || currentTrack.title,
      artist: currentTrack.artist,
      album: "AuraSynq",
      artwork: [
        { src: cover, sizes: "192x192" },
        { src: cover, sizes: "512x512" }
      ]
    }));
  }, [currentTrack?.id]);

  useEffect(() => {
    if (!currentTrack) return;
    withMediaSession(ms => ms.setPlaybackState({ playbackState: isPlaying ? "playing" : "paused" }));
  }, [isPlaying, currentTrack?.id]);

  // ─── Prefetch & offline cache ────────────────────────────

  const warmTrack = (track) => {
    const id = extractId(track);
    if (!id || !YOUTUBE_ID.test(id) || warmedIdsRef.current.has(id)) return;
    warmedIdsRef.current.add(id);
    fetch(`${streamKey(id)}&warm=1`).catch(() => warmedIdsRef.current.delete(id));
  };

  // Resolve upcoming songs on the server ahead of time so skipping feels instant
  const warmNextTrack = () => {
    const currentQ = queueRef.current;
    const index = currentQ.findIndex(t => t.id === currentTrackRef.current?.id);
    if (index === -1) return;
    currentQ.slice(index + 1, index + 1 + WARM_AHEAD).forEach(warmTrack);
  };

  // Lists (categories, Discover, Trends) pre-resolve the songs most likely to be tapped first
  const prefetchTracks = (tracks, count = WARM_LIST_TOP) => {
    (tracks || []).slice(0, count).forEach(warmTrack);
  };

  const autoCacheTrack = async (track) => {
    const trackId = extractId(track);
    if (!trackId || !YOUTUBE_ID.test(trackId) || cachedIdsRef.current.has(trackId)) return;
    if (!("caches" in window) || navigator.onLine === false || navigator.connection?.saveData) return;
    cachedIdsRef.current.add(trackId);
    try {
      const cache = await caches.open(AUDIO_CACHE);
      await cache.put(streamKey(trackId), await fetchAudioForCache(streamKey(trackId)));

      // Keep only the most recent auto-cached songs; explicit downloads are never evicted
      const downloaded = new Set(readStored(DOWNLOADS_KEY).map(t => extractId(t)));
      const list = [trackId, ...readStored(AUTO_CACHE_KEY).filter(id => id !== trackId)];
      while (list.length > AUTO_CACHE_LIMIT) {
        const evicted = list.pop();
        if (!downloaded.has(evicted)) {
          await cache.delete(streamKey(evicted));
          cachedIdsRef.current.delete(evicted);
        }
      }
      writeStored(AUTO_CACHE_KEY, list);
    } catch (e) {
      cachedIdsRef.current.delete(trackId);
      console.warn("Background caching failed", e);
    }
  };

  // ─── Library ─────────────────────────────────────────────

  const toggleLikeTrack = (track) => {
    if (!track) return;
    touchSyncMeta("liked");
    setLikedTracks(prev => (prev.some(t => t.id === track.id)
      ? prev.filter(t => t.id !== track.id)
      : [...prev, lightTrack(track)]));
  };

  const isTrackLiked = (trackId) => {
    return likedTracks.some(t => t.id === trackId);
  };

  const updatePlaylists = (updater) => {
    touchSyncMeta("playlists");
    setCustomPlaylists(updater);
  };

  // Custom playlists implementation
  const createPlaylist = (name) => {
    const newPlaylist = {
      id: 'playlist_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      name: name || 'Unnamed Playlist',
      tracks: [],
      isCollaborative: false,
      collaborators: []
    };
    updatePlaylists(prev => [...prev, newPlaylist]);
    return newPlaylist;
  };

  const deletePlaylist = (playlistId) => {
    updatePlaylists(prev => prev.filter(p => p.id !== playlistId));
  };

  const renamePlaylist = (playlistId, newName) => {
    updatePlaylists(prev => prev.map(p => p.id === playlistId ? { ...p, name: newName } : p));
  };

  const addTrackToPlaylist = (playlistId, track) => {
    if (!track) return;
    updatePlaylists(prev => prev.map(p => {
      if (p.id !== playlistId || p.tracks.some(t => t.id === track.id)) return p;
      return { ...p, tracks: [...p.tracks, lightTrack(track)] };
    }));
  };

  const removeTrackFromPlaylist = (playlistId, trackId) => {
    updatePlaylists(prev => prev.map(p =>
      p.id === playlistId ? { ...p, tracks: p.tracks.filter(t => t.id !== trackId) } : p
    ));
  };

  const toggleCollaborative = (playlistId) => {
    updatePlaylists(prev => prev.map(p => {
      if (p.id !== playlistId) return p;
      const nextCollab = !p.isCollaborative;
      const collaborators = nextCollab ? [
        { name: "Arun", avatar: "https://i.pravatar.cc/150?u=arun_blend" },
        { name: "Meera", avatar: "https://i.pravatar.cc/150?u=meera_blend" }
      ] : [];
      return { ...p, isCollaborative: nextCollab, collaborators };
    }));
  };

  // Offline downloads: YouTube songs via the same-origin stream proxy, direct audio by URL
  const downloadTrack = async (track) => {
    if (typeof window === "undefined" || !("caches" in window) || !track) return false;
    const trackId = extractId(track);
    const key = trackId && YOUTUBE_ID.test(trackId)
      ? streamKey(trackId)
      : (track.url && DIRECT_AUDIO.test(track.url) ? track.url : null);
    if (!key) return false;

    try {
      const cache = await caches.open(AUDIO_CACHE);
      if (!(await cache.match(key))) {
        await cache.put(key, await fetchAudioForCache(key));
      }
      if (track.cover) {
        const imgRes = await fetch(track.cover, { mode: "no-cors" }).catch(() => null);
        if (imgRes) await cache.put(track.cover, imgRes).catch(() => {});
      }

      const list = readStored(DOWNLOADS_KEY);
      if (!list.some(t => t.id === track.id)) {
        writeStored(DOWNLOADS_KEY, [...list, lightTrack(track)]);
      }
      cachedIdsRef.current.add(trackId);
      return true;
    } catch (err) {
      console.warn("Global download track failed", err);
      return false;
    }
  };

  const deleteDownloadedTrack = async (trackId) => {
    if (typeof window === "undefined" || !("caches" in window)) return false;
    try {
      const list = readStored(DOWNLOADS_KEY);
      const track = list.find(t => t.id === trackId);
      if (track) {
        const cache = await caches.open(AUDIO_CACHE);
        const id = extractId(track);
        await cache.delete(streamKey(id));
        if (track.url) await cache.delete(track.url);
        if (track.cover) await cache.delete(track.cover);
        cachedIdsRef.current.delete(id);
      }
      writeStored(DOWNLOADS_KEY, list.filter(t => t.id !== trackId));
      return true;
    } catch (err) {
      console.warn("Global delete downloaded track failed", err);
      return false;
    }
  };

  // ─── Shared links ────────────────────────────────────────

  // Shows the shared-song banner; playback starts when the user taps it (autoplay needs a gesture)
  const openSharedTrack = async ({ id, title, artist }) => {
    if (!id || !YOUTUBE_ID.test(id)) return;
    setSharedTrackInfo({
      id,
      title: title || "Shared Song",
      artist: artist || "Someone shared a vibe with you",
      cover: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${id}`,
      hue: Math.floor(Math.random() * 360)
    });
    if (title) return;

    // Older links carry only the id: look the metadata up
    try {
      const res = await fetch(apiUrl(`/api/search?q=${encodeURIComponent(id)}`));
      const data = await res.json();
      const match = data.tracks?.find(t => t.id === id);
      if (match) setSharedTrackInfo(prev => (prev?.id === id ? { ...prev, ...match } : prev));
    } catch (err) {
      console.warn("Failed to load shared track", err);
    }
  };

  const playSharedTrack = () => {
    const shared = sharedTrackInfo;
    if (!shared) return;
    playTrack(shared, [shared], true);
    setSharedTrackInfo(null);
  };

  const clearSharedTrack = () => setSharedTrackInfo(null);

  // User taste profile analyzer based on actual play history
  const getUserTasteProfile = useCallback(() => {
    if (playHistory.length === 0) {
      return { topArtist: "None", topGenre: "None", dominantMood: "None", stats: null };
    }

    const artistCounts = {};
    const genreCounts = {};
    const moodCounts = {};

    playHistory.forEach(track => {
      if (track.artist) {
        const artistClean = track.artist.trim();
        artistCounts[artistClean] = (artistCounts[artistClean] || 0) + 1;
      }

      let genre = "Pop";
      const titleLower = (track.title || "").toLowerCase();
      if (titleLower.includes("lofi") || titleLower.includes("chill") || titleLower.includes("relax") || titleLower.includes("coffee") || titleLower.includes("sunday")) genre = "Lofi/Chill";
      else if (titleLower.includes("hip hop") || titleLower.includes("rap") || titleLower.includes("trap") || titleLower.includes("banger")) genre = "Hip-Hop";
      else if (titleLower.includes("synth") || titleLower.includes("retro") || titleLower.includes("electro") || titleLower.includes("dance") || titleLower.includes("edm")) genre = "Electronic";
      else if (titleLower.includes("rock") || titleLower.includes("metal") || titleLower.includes("classic")) genre = "Rock";
      else if (track.artist?.toLowerCase().includes("ilayaraja") || track.artist?.toLowerCase().includes("rahman") || titleLower.includes("tamil") || track.artist?.toLowerCase().includes("anirudh")) genre = "Tamil Hits";

      genreCounts[genre] = (genreCounts[genre] || 0) + 1;

      let mood = "Chill";
      if (titleLower.includes("workout") || titleLower.includes("gym") || titleLower.includes("motivation") || titleLower.includes("energetic")) mood = "Energetic";
      else if (titleLower.includes("sleep") || titleLower.includes("calm") || titleLower.includes("relaxing") || titleLower.includes("nature")) mood = "Peaceful";
      else if (titleLower.includes("sad") || titleLower.includes("breakup") || titleLower.includes("failure") || titleLower.includes("valigal")) mood = "Melancholic";

      moodCounts[mood] = (moodCounts[mood] || 0) + 1;
    });

    const getTop = (counts) => {
      let topItem = "Unknown";
      let maxCount = 0;
      Object.entries(counts).forEach(([item, count]) => {
        if (count > maxCount) {
          maxCount = count;
          topItem = item;
        }
      });
      return topItem;
    };

    return {
      topArtist: getTop(artistCounts),
      topGenre: getTop(genreCounts),
      dominantMood: getTop(moodCounts),
      stats: {
        artistsCount: Object.keys(artistCounts).length,
        genres: Object.entries(genreCounts).map(([name, val]) => ({ name, percentage: Math.round((val / playHistory.length) * 100) })),
        moods: Object.entries(moodCounts).map(([name, val]) => ({ name, percentage: Math.round((val / playHistory.length) * 100) }))
      }
    };
  }, [playHistory]);

  // ─── Audio element events ────────────────────────────────

  const clearStallTimer = () => {
    if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
  };

  // Re-open a dropped stream and continue from where it stopped, instead of skipping the song
  const recoverStream = () => {
    const audio = audioRef.current;
    const track = currentTrackRef.current;
    const src = audio?.getAttribute('src');
    if (!audio || !track || !src) return false;
    const previous = recoveryRef.current.trackId === track.id ? recoveryRef.current.attempts : 0;
    if (previous >= MAX_STREAM_RECOVERIES) return false;
    const resumeAt = audio.currentTime || 0;
    recoveryRef.current = { trackId: track.id, attempts: previous + 1, resumeAt };
    audio.addEventListener('loadedmetadata', () => {
      if (resumeAt > 1) {
        try { audio.currentTime = resumeAt; } catch (e) {}
      }
    }, { once: true });
    audio.src = src;
    setIsBuffering(true);
    safePlay();
    return true;
  };

  // A "Streaming..." that never ends: the connection stalled without an error event
  const startStallWatch = () => {
    const audio = audioRef.current;
    if (!audio || stallTimerRef.current) return;
    const limit = (audio.currentTime || 0) < 1 ? FIRST_BUFFER_TIMEOUT_MS : STALL_TIMEOUT_MS;
    stallTimerRef.current = setTimeout(() => {
      stallTimerRef.current = null;
      const a = audioRef.current;
      if (!a || a.paused || !currentTrackRef.current || a.readyState >= 3) return;
      if (recoverStream()) {
        toast("Weak connection — reconnecting…");
        startStallWatch();
      } else {
        handleStreamFailure();
      }
    }, limit);
  };

  const handleAudioError = () => {
    const audio = audioRef.current;
    const track = currentTrackRef.current;
    // Ignore errors from an intentionally emptied element
    if (!audio || !track || !audio.getAttribute('src')) return;
    console.warn("Audio element error:", audio.error);
    clearStallTimer();

    // Streaming failed but the song is saved on this device: play that copy instead
    const trackId = extractId(track);
    if (!audio.src.startsWith('blob:') && cachedIdsRef.current.has(trackId)) {
      playFromCache(track, trackId, true);
      return;
    }

    // A dropped connection: reconnect and resume before giving up on the song
    if (recoverStream()) {
      startStallWatch();
      return;
    }
    handleStreamFailure();
  };

  const handleStreamFailure = () => {
    const track = currentTrackRef.current;
    if (!track) return;
    setIsBuffering(false);
    setIsPlaying(false);

    // Prevent infinite skip loops during global YouTube outages
    consecutiveErrorsRef.current += 1;
    if (consecutiveErrorsRef.current > 3) {
      consecutiveErrorsRef.current = 0;
      console.error("Multiple stream failures detected. YouTube streaming is likely blocked.");
      toast(
        navigator.onLine !== false
          ? "YouTube streaming is currently disrupted. Playback paused."
          : "You're offline. Downloaded songs still play from your Profile.",
        { variant: "error", duration: 4500 }
      );
      return;
    }
    toast(`Couldn't stream "${shortTitle(track.title).slice(0, 30)}" — skipping`, { variant: "error" });
    playNext(true);
  };

  return (
    <AudioContext.Provider value={{
      currentTrack, isPlaying, isBuffering, playTrack, togglePlay, seekTo, playNext, playPrevious, stopAudio, playHistory, queue, setQueue, removeFromQueue, addToQueue, isShuffle, toggleShuffle,
      likedTracks, toggleLikeTrack, isTrackLiked,
      customPlaylists, setCustomPlaylists, createPlaylist, deletePlaylist, renamePlaylist, addTrackToPlaylist, removeTrackFromPlaylist, toggleCollaborative,
      contextPlaylist, setContextPlaylist,
      downloadTrack, deleteDownloadedTrack,
      sharedTrackInfo, setSharedTrackInfo, clearSharedTrack, openSharedTrack, playSharedTrack,
      getUserTasteProfile, listenStats, prefetchTracks
    }}>
      {children}
      {/* Always mounted: the very first tap must find an element to load and play synchronously */}
      {mounted && (
        <audio
          ref={audioRef}
          preload="auto"
          style={{ display: "none" }}
          onPlay={() => {
            setIsPlaying(true);
            syncPositionState();
          }}
          onPlaying={() => {
            clearStallTimer();
            setIsBuffering(false);
            consecutiveErrorsRef.current = 0;
            warmNextTrack();
          }}
          onPause={() => {
            clearStallTimer();
            setIsPlaying(false);
            flushListenStats();
            syncPositionState();
          }}
          onEnded={() => {
            clearStallTimer();
            setIsPlaying(false);
            setProgress(0);
            playNext(true);
          }}
          onLoadedMetadata={(e) => {
            setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0);
            syncPositionState();
          }}
          onSeeked={syncPositionState}
          onTimeUpdate={(e) => {
            const a = e.currentTarget;
            const t = a.currentTime || 0;
            setProgress(t);
            if (Number.isFinite(a.duration)) setDuration(a.duration);

            // Count real listening time (seeks and stalls are excluded)
            if (!a.paused && lastTickRef.current !== null) {
              const delta = t - lastTickRef.current;
              if (delta > 0 && delta < 1.5) {
                pendingListenRef.current += delta;
                trackListenRef.current += delta;
              }
            }
            lastTickRef.current = t;
            if (pendingListenRef.current >= 15) flushListenStats();
            // Playing smoothly again after a reconnect: allow future recoveries
            if (recoveryRef.current.attempts && t > recoveryRef.current.resumeAt + 10) {
              recoveryRef.current.attempts = 0;
            }

            const track = currentTrackRef.current;
            if (track && trackListenRef.current >= AUTO_CACHE_AFTER_SECONDS && !a.src.startsWith('blob:')) {
              trackListenRef.current = -Infinity; // once per play
              autoCacheTrack(track);
            }
          }}
          onWaiting={() => {
            setIsBuffering(true);
            startStallWatch();
          }}
          onError={handleAudioError}
        />
      )}
    </AudioContext.Provider>
  );
}

export const useAudio = () => useContext(AudioContext);

export const useAudioProgress = () => {
  const [progress, setProgressState] = useState(0);
  const [duration, setDurationState] = useState(0);

  useEffect(() => {
    if (!audioProgressEmitter) return;
    setProgressState(lastEmitted.progress);
    setDurationState(lastEmitted.duration);

    const onProgress = (e) => setProgressState(e.detail);
    const onDuration = (e) => setDurationState(e.detail);

    audioProgressEmitter.addEventListener('progress', onProgress);
    audioProgressEmitter.addEventListener('duration', onDuration);

    return () => {
      audioProgressEmitter.removeEventListener('progress', onProgress);
      audioProgressEmitter.removeEventListener('duration', onDuration);
    };
  }, []);

  return { progress, duration };
};
