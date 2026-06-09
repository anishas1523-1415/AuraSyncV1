"use client";
import { createContext, useContext, useState, useRef, useEffect } from "react";
import { useUser } from "@/lib/clerk";
import { syncHistoryToCloud, syncLikedToCloud, syncPlaylistsToCloud } from "@/lib/dbSync";
let MediaSession = null;
if (typeof window !== "undefined") {
  import("@capgo/capacitor-media-session").then((m) => {
    MediaSession = m.MediaSession;
  }).catch(err => console.warn("Failed to load Capgo MediaSession plugin", err));
}

const AudioContext = createContext();
export const audioProgressEmitter = typeof window !== "undefined" ? new EventTarget() : null;

const generateMockLyrics = (title, artist) => {
  const cleanTitle = title.split('|')[0].split('(')[0].split('-')[0].trim();
  
  // Custom themed lyrics depending on keywords in title
  const isSad = title.toLowerCase().includes('sad') || title.toLowerCase().includes('love failure') || title.toLowerCase().includes('breakup') || title.toLowerCase().includes('valigal') || title.toLowerCase().includes('vazhi');
  const isHappy = title.toLowerCase().includes('happy') || title.toLowerCase().includes('kuthu') || title.toLowerCase().includes('dance') || title.toLowerCase().includes('mass') || title.toLowerCase().includes('danga');
  const isRomantic = !isSad && !isHappy; // Default to romantic/melodic
  
  let lyricTemplate = [];
  
  if (isSad) {
    lyricTemplate = [
      "வலிகள் நிறைந்த என் நெஞ்சமே...",
      "Why did you leave me in the dark?",
      "கண்ணீர் துளிகள் வழியுதே அன்பே...",
      "Holding onto memories of us...",
      "நீ இல்லாமல் வாழ வழியுமில்லை...",
      "Every shadow looks like your face...",
      "நெஞ்சில் ஓடும் காயங்கள் ஆறவில்லை...",
      "Lost in the silence of your goodbye...",
      "மறக்க நினைக்கிறேன் மறக்க முடியாமல்...",
      "Will the sun ever rise again?"
    ];
  } else if (isHappy) {
    lyricTemplate = [
      "ஆட்டத்த போடு தம்பி இன்னைக்கு...",
      "Feel the rhythm, let your body move!",
      "மகிழ்ச்சி பொங்குது நெஞ்சுக்குள்ள...",
      "Turn up the music, enjoy the vibe!",
      "வாழ்க்கை ஒரு முறை கொண்டாடுவோம்...",
      "Sing out loud, let the worries fade!",
      "புதுப்பாதை தேடி ஓடுவோம்...",
      "Dance with the stars, touch the sky!",
      "நெஞ்சில் உற்சாகம் குறையாமலே...",
      "This is our time, make it count!"
    ];
  } else {
    // Romantic/Melodic
    lyricTemplate = [
      "உன் விழி பார்த்த நொடி முதல்...",
      "Every beat of my heart speaks your name...",
      "என் மூச்சில் கலந்தாயே அன்பே...",
      "Dancing in the shadows of the starlight...",
      "விண்மீன்கள் போல் நாம் இணைந்திருப்போம்...",
      "Through the highs and lows, we shine...",
      "ஆசைகள் நெஞ்சில் அலைபாயும் நேரம்...",
      "Let the rhythm guide us home tonight...",
      "உயிரே உன் வாசம் என்னை ஈர்க்குதே...",
      "Under the moon, our souls unite...",
      "கனவுகள் யாவும் நிஜமாகும் காலம்...",
      "Every moment with you is a dream..."
    ];
  }

  const lyrics = [
    { time: 0, text: `🎵 Playing: ${cleanTitle} 🎵` },
    { time: 5, text: `👤 Artist: ${artist}` },
    { time: 8, text: "🌸 (Instrumental Intro) 🌸" }
  ];

  // Loop and generate lyrics up to 500 seconds dynamically
  let currentTime = 15;
  let lineIndex = 0;
  
  const chorus = isSad 
    ? ["துரோகம் தாங்காமல் துடிக்குதே நெஞ்சம்...", "ஏன் என்னை பிரிந்தாய் என் உயிரே..."]
    : isHappy 
      ? ["கொண்டாட்டம் போடுவோம் குதுகலமாய்...", "வாழ்கை கொண்டாடும் தருணமே இது..."]
      : ["என் அன்பே என் உயிரே நீதானே...", "உன்னோடு வாழும் நொடியே போதுமே..."];

  while (currentTime < 500) {
    // Add a Verse line
    lyrics.push({
      time: currentTime,
      text: lyricTemplate[lineIndex % lyricTemplate.length]
    });
    currentTime += 8;
    
    // Add second Verse line
    lyrics.push({
      time: currentTime,
      text: lyricTemplate[(lineIndex + 1) % lyricTemplate.length]
    });
    currentTime += 8;

    // Add Chorus
    lyrics.push({
      time: currentTime,
      text: `✨ ${chorus[0]} ✨`
    });
    currentTime += 8;
    lyrics.push({
      time: currentTime,
      text: `✨ ${chorus[1]} ✨`
    });
    currentTime += 8;

    // Add brief Instrumental break every now and then
    if (currentTime % 3 === 0) {
      lyrics.push({
        time: currentTime,
        text: "🎶 (Instrumental Bridge) 🎶"
      });
      currentTime += 12;
    }
    
    lineIndex += 2;
  }
  
  lyrics.push({
    time: currentTime,
    text: "💖 (Outro) 💖"
  });

  return lyrics;
};

const parseLRC = (lrcText) => {
  if (!lrcText) return null;
  const lines = lrcText.split("\n");
  const extractYoutubeId = (url) => {
    try {
      const urlObj = new URL(url);
      if (urlObj.hostname.includes('youtube.com') || urlObj.hostname.includes('youtu.be')) {
          return urlObj.searchParams.get('v') || urlObj.pathname.split('/')[2] || urlObj.pathname.slice(1);
      }
      return null;
    } catch (e) {
      return null;
    }
  };
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

const createSilenceDataURL = (duration = 600) => {
  const sampleRate = 8000;
  const numSamples = sampleRate * duration;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  
  const writeString = (v, offset, str) => {
    for (let i = 0; i < str.length; i++) {
      v.setUint8(offset + i, str.charCodeAt(i));
    }
  };
  
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, numSamples * 2, true);
  
  const blob = new Blob([buffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
};

export function AudioProvider({ children }) {
  const { user } = useUser();
  const [currentTrack, setCurrentTrack] = useState(null);
  const [queue, setQueue] = useState([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  
  const progressRef = useRef(0);
  const durationRef = useRef(0);
  
  const setProgress = (val) => {
    progressRef.current = val;
    if (audioProgressEmitter) {
      audioProgressEmitter.dispatchEvent(new CustomEvent('progress', { detail: val }));
    }
  };
  
  const setDuration = (val) => {
    durationRef.current = val;
    if (audioProgressEmitter) {
      audioProgressEmitter.dispatchEvent(new CustomEvent('duration', { detail: val }));
    }
  };
  const [silenceSrc, setSilenceSrc] = useState("");
  const [mounted, setMounted] = useState(false);
  const [isYtReady, setIsYtReady] = useState(false);
  const [playHistory, setPlayHistory] = useState(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem('aurasynq_play_history');
        if (stored) return JSON.parse(stored);
      } catch (e) {}
    }
    return [];
  });
  
  const [likedTracks, setLikedTracks] = useState(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem('aurasynq_liked_songs_metadata');
        if (stored) return JSON.parse(stored);
      } catch (e) {}
    }
    return [];
  });
  
  const [customPlaylists, setCustomPlaylists] = useState(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem('aurasynq_custom_playlists');
        if (stored) return JSON.parse(stored);
      } catch (e) {}
    }
    return [];
  });
  const [isShuffle, setIsShuffle] = useState(false);
  const [originalQueue, setOriginalQueue] = useState([]);
  const [contextPlaylist, setContextPlaylist] = useState(null);
  const [sharedTrackInfo, setSharedTrackInfo] = useState(null);

  const audioRef = useRef(null);
  const silenceAudioRef = useRef(null);

  const removeFromQueue = (trackId) => {
    setQueue(prev => prev.filter(t => t.id !== trackId));
    setOriginalQueue(prev => prev.filter(t => t.id !== trackId));
  };

  const addToQueue = (track) => {
    setQueue(prev => {
      const exists = prev.some(t => t.id === track.id);
      if (!exists) return [...prev, track];
      return prev;
    });
    setOriginalQueue(prev => {
      const exists = prev.some(t => t.id === track.id);
      if (!exists) return [...prev, track];
      return prev;
    });
  };

  const toggleShuffle = () => {
    setIsShuffle(prev => {
      const nextShuffle = !prev;
      if (nextShuffle) {
        setOriginalQueue([...queue]);
        const currentT = currentTrackRef.current;
        let otherTracks = queue.filter(t => t.id !== currentT?.id);
        
        for (let i = otherTracks.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [otherTracks[i], otherTracks[j]] = [otherTracks[j], otherTracks[i]];
        }
        
        if (currentT) {
          setQueue([currentT, ...otherTracks]);
        } else {
          setQueue(otherTracks);
        }
      } else {
        if (originalQueue.length > 0) {
          setQueue(originalQueue);
        }
      }
      return nextShuffle;
    });
  };
  const ytPlayerRef = useRef(null);
  const pollIntervalRef = useRef(null);
  const currentIsHtmlRef = useRef(false);

  // Maintain refs to avoid stale closure scopes in YT player callbacks
  const currentTrackRef = useRef(null);
  const queueRef = useRef([]);
  const isPlayingRef = useRef(false);

  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack]);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // Initialize dynamic script and silence generator
  useEffect(() => {
    setMounted(true);
    const silenceUrl = createSilenceDataURL(600);
    setSilenceSrc(silenceUrl);

    if (typeof window !== "undefined") {
      if (!window.YT) {
        const tag = document.createElement("script");
        tag.src = "https://www.youtube.com/iframe_api";
        const firstScriptTag = document.getElementsByTagName("script")[0];
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
      } else {
        setIsYtReady(true);
      }
    }
    
    return () => {
      if (ytPlayerRef.current && typeof ytPlayerRef.current.destroy === 'function') {
        ytPlayerRef.current.destroy();
      }
      if (silenceUrl) URL.revokeObjectURL(silenceUrl);
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  // Update Native Capacitor Media Session
  useEffect(() => {
    const updateNativeSession = async () => {
      try {
        if (currentTrack) {
          await MediaSession.setMetadata({
            title: currentTrack.title,
            artist: currentTrack.artist,
            album: "AuraSynq",
            artwork: [{ src: currentTrack.cover || "", sizes: "512x512", type: "image/png" }]
          });
          await MediaSession.setPlaybackState({
            playbackState: isPlaying ? "playing" : "paused",
          });
        }
      } catch (err) {
        // Ignored in browser environments
      }
    };
    updateNativeSession();
  }, [currentTrack, isPlaying]);

  // Capacitor Media Session Listeners
  useEffect(() => {
    let playSub, pauseSub, nextSub, prevSub;
    const initListeners = async () => {
      try {
        playSub = await MediaSession.addListener("play", () => {
          togglePlay();
        });
        pauseSub = await MediaSession.addListener("pause", () => {
          togglePlay();
        });
        nextSub = await MediaSession.addListener("nexttrack", () => {
          playNext();
        });
        prevSub = await MediaSession.addListener("previoustrack", () => {
          playPrevious();
        });
      } catch (e) {}
    };
    initListeners();
    return () => {
      if (playSub) playSub.remove();
      if (pauseSub) pauseSub.remove();
      if (nextSub) nextSub.remove();
      if (prevSub) prevSub.remove();
    };
  }, []);

  if (typeof window !== "undefined") {
    window.onYouTubeIframeAPIReady = () => {
      console.log("AuraSynq Debug: YouTube Iframe API Loaded");
      setIsYtReady(true);

      const activeTrack = currentTrackRef.current;
      if (activeTrack && ytPlayerRef.current && typeof ytPlayerRef.current.loadVideoById === "function") {
        try {
          ytPlayerRef.current.loadVideoById({ videoId: activeTrack.id });
          if (isPlayingRef.current && typeof ytPlayerRef.current.playVideo === "function") {
            setTimeout(() => {
              try {
                ytPlayerRef.current?.playVideo();
              } catch (err) {
                console.warn("YT autoplay after ready failed:", err);
              }
            }, 100);
          }
        } catch (err) {
          console.warn("YT sync on ready failed:", err);
        }
      }
    };
  }

  const playNext = (shouldAutoPlay = isPlayingRef.current) => {
    const currentQ = queueRef.current;
    const currentT = currentTrackRef.current;
    if (currentQ.length <= 1 || !currentT) {
      if (currentT) {
        seekTo(0);
      }
      return;
    }
    const currentIndex = currentQ.findIndex(t => t.id === currentT.id);
    if (currentIndex !== -1) {
      const nextIndex = (currentIndex + 1) % currentQ.length;
      playTrack(currentQ[nextIndex], currentQ, shouldAutoPlay);
    }
  };

  const playPrevious = (shouldAutoPlay = isPlayingRef.current) => {
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
      playTrack(currentQ[prevIndex], currentQ, shouldAutoPlay);
    }
  };

  // Initialize YT Player when API script is ready
  useEffect(() => {
    if (isYtReady && !ytPlayerRef.current) {
      console.log("AuraSynq Debug: Instantiating YT Player...");
      ytPlayerRef.current = new window.YT.Player("yt-player-placeholder", {
        height: "1",
        width: "1",
        videoId: "",
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          origin: typeof window !== "undefined" ? window.location.origin : ""
        },
        events: {
          onReady: () => {
            console.log("AuraSynq Debug: YT Player ready for loading.");
          },
          onStateChange: (event) => {
            const state = event.data;
            if (state === window.YT.PlayerState.PLAYING) {
              setIsPlaying(true);
              setIsBuffering(false);
            } else if (state === window.YT.PlayerState.PAUSED) {
              setIsPlaying(false);
              setIsBuffering(false);
            } else if (state === window.YT.PlayerState.BUFFERING) {
              setIsBuffering(true);
            } else if (state === window.YT.PlayerState.ENDED) {
              setIsPlaying(false);
              setIsBuffering(false);
              setProgress(0);
              // Auto-advance to next song
              playNext();
            }
          },
          onError: (event) => {
            try {
              console.warn('AuraSynq Debug: YT Player error', event.data);
              setIsBuffering(false);
              setIsPlaying(false);
            } catch (err) {
              // ignore
            }
          }
        }
      });
    }
  }, [isYtReady]);

  const abortControllerRef = useRef(null);

  const fetchLyricsFromApi = async (title, artist, trackId) => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      // Create search query favoring the artist and title
      const searchQuery = encodeURIComponent(`${title} ${artist}`);
      const url = `https://lrclib.net/api/search?q=${searchQuery}`;
      
      const res = await fetch(url, { signal });
      
      if (!res.ok) throw new Error("LrcLib search failed");
      
      const data = await res.json();
      if (!data || data.length === 0) throw new Error("No lyrics found");

      const bestMatch = data[0];
      const lyricsLines = bestMatch.syncedLyrics 
        ? parseLRC(bestMatch.syncedLyrics) 
        : parsePlainLyrics(bestMatch.plainLyrics, bestMatch.duration);
      
      if (lyricsLines && lyricsLines.length > 0) {
        console.log("AuraSynq Debug: Found and synced search-query lyrics successfully!");
        setCurrentTrack(prev => {
          if (prev && prev.id === trackId) {
            return { ...prev, lyrics: lyricsLines };
          }
          return prev;
        });
        return lyricsLines;
      } else {
        throw new Error("LrcLib search failed to return match");
      }
    } catch (err) {
      if (err.name === 'AbortError') return null;
      console.warn("AuraSynq Debug: Failed to fetch real lyrics from database:", err);
    }
    return null;
  };

  const stopAudio = () => {
    try {
      if (ytPlayerRef.current && typeof ytPlayerRef.current.pauseVideo === 'function') {
        ytPlayerRef.current.pauseVideo();
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
    } catch (err) {}
    setCurrentTrack(null);
    setIsPlaying(false);
    setIsBuffering(false);
    setProgress(0);
    setDuration(0);
    setQueue([]);
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  const addToHistory = (track) => {
    setPlayHistory(prev => {
      const filtered = prev.filter(t => t.id !== track.id);
      
      // Strip heavy payloads before saving to LocalStorage to prevent quota limits
      const lightTrack = { ...track };
      delete lightTrack.lyrics;
      delete lightTrack.djIntro;
      
      const updated = [lightTrack, ...filtered].slice(0, 20);
      try {
        localStorage.setItem('aurasynq_play_history', JSON.stringify(updated));
      } catch (e) {}
      
      if (user?.id) syncHistoryToCloud(updated, user.id);
      return updated;
    });
  };

  const playTrack = (track, newQueue = null, shouldAutoPlay = true) => {
    // Synchronously kickstart background audio hack on user gesture to guarantee WebView background playback
    if (shouldAutoPlay && silenceAudioRef.current) {
      silenceAudioRef.current.play().catch(() => {});
    }

    // Set queue if provided, or build one
    if (newQueue) {
      setQueue(newQueue);
    } else {
      setQueue(prev => {
        const exists = prev.some(t => t.id === track.id);
        if (!exists) return [...prev, track];
        return prev;
      });
    }

    if (currentTrackRef.current?.id !== track.id) {
      const trackWithLyrics = {
        ...track,
        lyrics: track.lyrics || generateMockLyrics(track.title, track.artist)
      };
      setCurrentTrack(trackWithLyrics);
      setIsPlaying(shouldAutoPlay);
      setIsBuffering(shouldAutoPlay);
      setProgress(0);
      setDuration(0);
      addToHistory(track);
      fetchLyricsFromApi(track.title, track.artist, track.id);

      // Decide whether this is a direct audio URL (mp3) or a YouTube video.
      const isDirectAudio = track.url && /\.mp3($|\?)/i.test(track.url);
      currentIsHtmlRef.current = isDirectAudio;

      if (isDirectAudio) {
        // Pause any YT playback
        try {
          if (ytPlayerRef.current && typeof ytPlayerRef.current.pauseVideo === 'function') {
            ytPlayerRef.current.pauseVideo();
          }
        } catch (err) {
          // ignore
        }

        // Use HTMLAudioElement for direct audio
        setTimeout(async () => {
          try {
            if (audioRef.current) {
              let audioSrc = track.url;
              
              // Check Cache Storage for offline playback
              try {
                if (typeof window !== "undefined" && "caches" in window) {
                  const cache = await caches.open("aurasynq_offline_audio");
                  const matchedResponse = await cache.match(track.url);
                  if (matchedResponse) {
                    const blob = await matchedResponse.blob();
                    audioSrc = URL.createObjectURL(blob);
                    console.log("AuraSynq Debug: Playing cached audio locally offline", track.title);
                  } else {
                    if (navigator.onLine) {
                      console.log("AuraSynq Debug: Background downloading and caching track", track.title);
                      fetch(track.url).then(async (response) => {
                        if (response.ok) {
                          const cacheCopy = await caches.open("aurasynq_offline_audio");
                          await cacheCopy.put(track.url, response);
                          if (track.cover) {
                            const imgRes = await fetch(track.cover, { mode: "no-cors" }).catch(() => null);
                            if (imgRes) await cacheCopy.put(track.cover, imgRes);
                          }
                        }
                      }).catch(e => console.warn("Background caching failed", e));
                    }
                  }
                }
              } catch (cacheErr) {
                console.warn("Offline caching matching failed:", cacheErr);
              }

              audioRef.current.src = audioSrc;
              audioRef.current.currentTime = 0;
              if (shouldAutoPlay) {
                audioRef.current.play().catch(err => console.warn('HTML audio play failed:', err));
              }
              setIsBuffering(false);
            }
          } catch (err) {
            console.warn('Direct audio playback failed:', err);
          }
        }, 50);
      } else {
        // Try to extract a YouTube video id from url if id looks non-standard
        const extractYoutubeId = (t) => {
          if (!t) return null;
          if (t.id && /^[A-Za-z0-9_-]{11}$/.test(t.id)) return t.id;
          if (t.url) {
            const m1 = t.url.match(/[?&]v=([A-Za-z0-9_-]{11})/);
            if (m1 && m1[1]) return m1[1];
            const m2 = t.url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
            if (m2 && m2[1]) return m2[1];
          }
          return t.id || null;
        };

        const videoId = extractYoutubeId(track);
        const loadVideo = () => {
          if (ytPlayerRef.current && typeof ytPlayerRef.current.loadVideoById === "function") {
            try {
              if (videoId) {
                ytPlayerRef.current.loadVideoById({ videoId });
              } else if (track.id) {
                ytPlayerRef.current.loadVideoById({ videoId: track.id });
              }
              if (shouldAutoPlay && typeof ytPlayerRef.current.playVideo === "function") {
                setTimeout(() => {
                  try {
                    ytPlayerRef.current?.playVideo();
                  } catch (err) {
                    console.warn("YT play after load failed:", err);
                  }
                }, 100);
              }
            } catch (err) {
              console.error("YT Player load error:", err);
            }
          } else {
            setTimeout(loadVideo, 250);
          }
        };
        loadVideo();
      }
    } else {
      seekTo(0);
      setIsPlaying(shouldAutoPlay);
      if (currentIsHtmlRef.current && audioRef.current) {
        audioRef.current.currentTime = 0;
        if (shouldAutoPlay) {
          audioRef.current.play().catch(err => console.warn('HTML audio play failed:', err));
        }
      } else if (ytPlayerRef.current && typeof ytPlayerRef.current.seekTo === "function") {
        ytPlayerRef.current.seekTo(0, true);
        if (shouldAutoPlay && typeof ytPlayerRef.current.playVideo === "function") {
          try {
            ytPlayerRef.current.playVideo();
          } catch (err) {
            console.warn("YT replay failed:", err);
          }
        }
      }
    }
  };

  const togglePlay = () => {
    if (currentTrack) {
      // Synchronously toggle silence audio to maintain background media session lock
      if (silenceAudioRef.current) {
        if (!isPlaying) {
          silenceAudioRef.current.play().catch(() => {});
        } else {
          silenceAudioRef.current.pause();
        }
      }

      // If current track is direct HTML audio, control audio element directly
      if (currentIsHtmlRef.current && audioRef.current) {
        if (isPlaying) {
          audioRef.current.pause();
          setIsPlaying(false);
        } else {
          audioRef.current.play().catch(err => console.warn('HTML audio play failed:', err));
          setIsPlaying(true);
        }
      } else {
        setIsPlaying(!isPlaying);
      }
    }
  };

  const seekTo = (seconds) => {
    if (!currentTrack) return;
    if (currentIsHtmlRef.current && audioRef.current) {
      try {
        audioRef.current.currentTime = seconds;
        setProgress(seconds);
      } catch (err) {
        console.warn('HTML audio seek failed:', err);
      }
      return;
    }
    if (ytPlayerRef.current && typeof ytPlayerRef.current.seekTo === "function") {
      try {
        ytPlayerRef.current.seekTo(seconds, true);
        setProgress(seconds);
        if (audioRef.current) {
          audioRef.current.currentTime = seconds % 600;
        }
      } catch (err) {
        console.warn("YT seek failed:", err);
      }
    }
  };

  // Sync state changes with native audio player and YT player
  useEffect(() => {
    try {
      if (currentIsHtmlRef.current) {
        if (audioRef.current) {
          if (isPlaying) {
            audioRef.current.play().catch(err => console.warn('HTML audio play failed:', err));
            if (silenceAudioRef.current) silenceAudioRef.current.play().catch(() => {});
          } else {
            audioRef.current.pause();
            if (silenceAudioRef.current) silenceAudioRef.current.pause();
          }
        }
      } else if (ytPlayerRef.current && typeof ytPlayerRef.current.playVideo === "function") {
        if (isPlaying) {
          ytPlayerRef.current.playVideo();
          if (silenceAudioRef.current) silenceAudioRef.current.play().catch(() => {});
        } else {
          ytPlayerRef.current.pauseVideo();
          if (silenceAudioRef.current) silenceAudioRef.current.pause();
        }
      }
    } catch (err) {
      console.warn("Playstate sync error:", err);
    }
  }, [isPlaying, currentTrack?.id]);

  // Poll progress state
  useEffect(() => {
    // For YT player, poll; for HTML audio, use element events
    if (currentIsHtmlRef.current) {
      if (audioRef.current) {
        const a = audioRef.current;
        const timeHandler = () => {
          setProgress(a.currentTime || 0);
          setDuration(a.duration || 0);
        };
        const endHandler = () => {
          setIsPlaying(false);
          setProgress(0);
          playNext();
        };
        a.addEventListener('timeupdate', timeHandler);
        a.addEventListener('ended', endHandler);
        if (!isPlaying) {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
        }
        return () => {
          a.removeEventListener('timeupdate', timeHandler);
          a.removeEventListener('ended', endHandler);
        };
      }
    } else {
      if (isPlaying) {
        pollIntervalRef.current = setInterval(() => {
          if (ytPlayerRef.current && typeof ytPlayerRef.current.getCurrentTime === "function") {
            try {
              const curTime = ytPlayerRef.current.getCurrentTime();
              const dur = ytPlayerRef.current.getDuration();
              if (curTime !== undefined) setProgress(curTime);
              if (dur !== undefined && dur > 0) setDuration(dur);
            } catch (err) {
              // ignore
            }
          }
        }, 250);
      } else {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      }
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [isPlaying, currentTrack?.id]);

  // Register HTML5 Media Session API metadata for lock screen integration
  useEffect(() => {
    if (typeof window !== "undefined" && "mediaSession" in navigator && currentTrack) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.artist,
        album: "AuraSynq Aura",
        artwork: [
          { src: currentTrack.cover || "/icon-192x192.png", sizes: "192x192", type: "image/png" },
          { src: currentTrack.cover || "/icon-512x512.png", sizes: "512x512", type: "image/png" }
        ]
      });

      navigator.mediaSession.setActionHandler("play", () => setIsPlaying(true));
      navigator.mediaSession.setActionHandler("pause", () => setIsPlaying(false));
      navigator.mediaSession.setActionHandler("nexttrack", () => playNext(true));
      navigator.mediaSession.setActionHandler("previoustrack", () => playPrevious(true));
      navigator.mediaSession.setActionHandler("seekto", (details) => {
        if (details.seekTime !== undefined) seekTo(details.seekTime);
      });
      
      // Capacitor MediaSession integration
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.MediaSession) {
        window.Capacitor.Plugins.MediaSession.setMetadata({
          title: currentTrack.title,
          artist: currentTrack.artist
        });
      }
    }
  }, [currentTrack?.id]);

  useEffect(() => {
    if (typeof window !== "undefined" && "mediaSession" in navigator && currentTrack) {
      navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    }
  }, [isPlaying, currentTrack?.id]);

  useEffect(() => {
    if (typeof window !== "undefined" && "mediaSession" in navigator && currentTrack && durationRef.current > 0) {
      try {
        navigator.mediaSession.setPositionState({
          duration: durationRef.current,
          playbackRate: 1.0,
          position: progressRef.current
        });
      } catch (err) {
        console.warn("MediaSession setPositionState error:", err);
      }
    }
  }, [currentTrack?.id]);

  // History, liked songs, and custom playlists are now initialized lazily in useState.

  // Liking implementation
  const toggleLikeTrack = (track) => {
    setLikedTracks(prev => {
      let updated;
      const isLiked = prev.some(t => t.id === track.id);
      if (isLiked) {
        updated = prev.filter(t => t.id !== track.id);
      } else {
        const lightTrack = { ...track };
        delete lightTrack.lyrics;
        delete lightTrack.djIntro;
        updated = [...prev, lightTrack];
      }
      
      try {
        localStorage.setItem('aurasynq_liked_songs_metadata', JSON.stringify(updated));
      } catch (e) {}
      
      if (user?.id) syncLikedToCloud(updated, user.id);
      return updated;
    });
  };

  const isTrackLiked = (trackId) => {
    return likedTracks.some(t => t.id === trackId);
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
    setCustomPlaylists(prev => {
      const updated = [...prev, newPlaylist];
      try { localStorage.setItem('aurasynq_custom_playlists', JSON.stringify(updated)); } catch (e) {}
      return updated;
    });
    return newPlaylist;
  };

  const deletePlaylist = (playlistId) => {
    setCustomPlaylists(prev => {
      const updated = prev.filter(p => p.id !== playlistId);
      try { localStorage.setItem('aurasynq_custom_playlists', JSON.stringify(updated)); } catch (e) {}
      return updated;
    });
  };

  const renamePlaylist = (playlistId, newName) => {
    setCustomPlaylists(prev => {
      const updated = prev.map(p => p.id === playlistId ? { ...p, name: newName } : p);
      try { localStorage.setItem('aurasynq_custom_playlists', JSON.stringify(updated)); } catch (e) {}
      return updated;
    });
  };

  const addTrackToPlaylist = (playlistId, track) => {
    if (!track) return;
    setCustomPlaylists(prev => {
      const updated = prev.map(p => {
        if (p.id === playlistId) {
          const exists = p.tracks.some(t => t.id === track.id);
          if (!exists) {
            return { ...p, tracks: [...p.tracks, track] };
          }
        }
        return p;
      });
      try { localStorage.setItem('aurasynq_custom_playlists', JSON.stringify(updated)); } catch (e) {}
      return updated;
    });
  };

  const removeTrackFromPlaylist = (playlistId, trackId) => {
    setCustomPlaylists(prev => {
      const updated = prev.map(p => {
        if (p.id === playlistId) {
          return { ...p, tracks: p.tracks.filter(t => t.id !== trackId) };
        }
        return p;
      });
      try { localStorage.setItem('aurasynq_custom_playlists', JSON.stringify(updated)); } catch (e) {}
      return updated;
    });
  };

  const toggleCollaborative = (playlistId) => {
    setCustomPlaylists(prev => {
      const updated = prev.map(p => {
        if (p.id === playlistId) {
          const nextCollab = !p.isCollaborative;
          const collaborators = nextCollab ? [
            { name: "Arun", avatar: "https://i.pravatar.cc/150?u=arun_blend" },
            { name: "Meera", avatar: "https://i.pravatar.cc/150?u=meera_blend" }
          ] : [];
          return { ...p, isCollaborative: nextCollab, collaborators };
        }
        return p;
      });
      try { localStorage.setItem('aurasynq_custom_playlists', JSON.stringify(updated)); } catch (e) {}
      return updated;
    });
  };

  // Offline Caching helpers
  const downloadTrack = async (track) => {
    if (typeof window === "undefined" || !("caches" in window) || !track) return false;
    try {
      const isDirectAudio = track.url && /\.mp3($|\?)/i.test(track.url);
      if (!isDirectAudio) return false;
      
      const cache = await caches.open("aurasynq_offline_audio");
      const matched = await cache.match(track.url);
      if (!matched) {
        const res = await fetch(track.url);
        if (res.ok) {
          await cache.put(track.url, res);
          if (track.cover) {
            const imgRes = await fetch(track.cover, { mode: "no-cors" }).catch(() => null);
            if (imgRes) await cache.put(track.cover, imgRes);
          }
        } else {
          return false;
        }
      }
      
      try {
        const stored = localStorage.getItem("aurasynq_downloaded_metadata");
        const list = stored ? JSON.parse(stored) : [];
        if (!list.some(t => t.id === track.id)) {
          list.push(track);
          localStorage.setItem("aurasynq_downloaded_metadata", JSON.stringify(list));
        }
      } catch (e) {
        console.warn(e);
      }
      return true;
    } catch (err) {
      console.warn("Global download track failed", err);
      return false;
    }
  };

  const deleteDownloadedTrack = async (trackId) => {
    if (typeof window === "undefined" || !("caches" in window)) return false;
    try {
      const stored = localStorage.getItem("aurasynq_downloaded_metadata");
      const list = stored ? JSON.parse(stored) : [];
      const track = list.find(t => t.id === trackId);
      if (track) {
        const cache = await caches.open("aurasynq_offline_audio");
        await cache.delete(track.url);
        if (track.cover) await cache.delete(track.cover);
      }
      const updated = list.filter(t => t.id !== trackId);
      localStorage.setItem("aurasynq_downloaded_metadata", JSON.stringify(updated));
      return true;
    } catch (err) {
      console.warn("Global delete downloaded track failed", err);
      return false;
    }
  };

  // Shared track link auto-play logic
  useEffect(() => {
    if (typeof window === "undefined" || !mounted) return;
    const urlParams = new URLSearchParams(window.location.search);
    const trackId = urlParams.get("track");
    if (!trackId) return;

    const loadSharedTrack = async () => {
      try {
        console.log("AuraSynq Debug: Shared track detected. Fetching track metadata for", trackId);
        const res = await fetch(`/api/search?q=${encodeURIComponent(trackId)}`);
        const data = await res.json();
        if (data.tracks && data.tracks.length > 0) {
          const matchedTrack = data.tracks[0];
          setSharedTrackInfo(matchedTrack);
          // Play the track automatically
          playTrack(matchedTrack, [matchedTrack], true);
        }
      } catch (err) {
        console.warn("Failed to load shared track", err);
      }
    };
    loadSharedTrack();
  }, [mounted]);

  const clearSharedTrack = () => setSharedTrackInfo(null);

  // User taste profile analyzer based on actual play history
  const getUserTasteProfile = () => {
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

    const topArtist = getTop(artistCounts);
    const topGenre = getTop(genreCounts);
    const dominantMood = getTop(moodCounts);

    return {
      topArtist,
      topGenre,
      dominantMood,
      stats: {
        artistsCount: Object.keys(artistCounts).length,
        genres: Object.entries(genreCounts).map(([name, val]) => ({ name, percentage: Math.round((val / playHistory.length) * 100) })),
        moods: Object.entries(moodCounts).map(([name, val]) => ({ name, percentage: Math.round((val / playHistory.length) * 100) }))
      }
    };
  };

  return (
    <AudioContext.Provider value={{
      currentTrack, isPlaying, isBuffering, playTrack, togglePlay, seekTo, playNext, playPrevious, stopAudio, playHistory, queue, setQueue, removeFromQueue, addToQueue, isShuffle, toggleShuffle,
      likedTracks, toggleLikeTrack, isTrackLiked,
      customPlaylists, setCustomPlaylists, createPlaylist, deletePlaylist, renamePlaylist, addTrackToPlaylist, removeTrackFromPlaylist, toggleCollaborative,
      contextPlaylist, setContextPlaylist,
      downloadTrack, deleteDownloadedTrack,
      sharedTrackInfo, setSharedTrackInfo, clearSharedTrack, getUserTasteProfile
    }}>
      {children}
      {mounted && silenceSrc && (
        <audio 
          ref={silenceAudioRef}
          src={silenceSrc}
          loop
          playsInline
          style={{ display: "none" }}
        />
      )}
      {mounted && currentTrack && (
        <audio 
          ref={audioRef}
          style={{ display: "none" }}
        />
      )}
      <div 
        id="yt-player-container" 
        style={{ 
          position: "absolute", 
          width: "1px", 
          height: "1px", 
          opacity: 0, 
          pointerEvents: "none",
          overflow: "hidden",
          left: "-1000px",
          top: "-1000px"
        }}
      >
        <div id="yt-player-placeholder" />
      </div>
    </AudioContext.Provider>
  );
}

export const useAudio = () => useContext(AudioContext);

export const useAudioProgress = () => {
  const [progress, setProgressState] = useState(0);
  const [duration, setDurationState] = useState(0);

  useEffect(() => {
    if (!audioProgressEmitter) return;
    
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
