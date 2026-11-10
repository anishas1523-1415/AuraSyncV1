"use client";
// The listener's library: liked songs, playlists, play history, lifetime listening activity,
// taste and settings. It lives on the device first (instant, works offline) and is saved to the
// listener's account whenever there is a connection, so signing in on any device shows the same
// data. Merging uses the conflict-free rules in lib/library.js, and cloud saves are atomic
// (lib/dbSync.js), so no device can overwrite another's changes.
import { useState, useRef, useEffect, useCallback } from "react";
import { readStored, writeStored, removeStored, lightTrack } from "@/lib/storage";
import {
  mergeLiked, mergePlaylists, mergeHistory, mergeActivity, mergeSettings, activityTotals, emptySlot, stable, ts,
} from "@/lib/library";
import { creditedArtists, genreOf, moodOf } from "@/lib/activity";
import { syncBlob, readCloud, writeMarker, loadLegacyLibrary, syncProfileToCloud, deleteCloudLibrary } from "@/lib/dbSync";
import { exportTaste, applyTaste, mergeTasteState, resetTaste, seedFromLibrary } from "@/lib/ir/profile";

const KEYS = {
  liked: "aurasynq_liked_songs_metadata",
  likedRemoved: "aurasynq_liked_removed",
  playlists: "aurasynq_custom_playlists",
  playlistsDeleted: "aurasynq_playlists_deleted",
  history: "aurasynq_play_history",
  historyCleared: "aurasynq_history_cleared_at",
  activity: "aurasynq_activity",
  settings: "aurasynq_settings",
  settingsAt: "aurasynq_settings_at",
  device: "aurasynq_device_id",
  legacyStats: "aurasynq_listen_stats",
  legacySyncMeta: "aurasynq_sync_meta",
  outbox: "aurasynq_outbox_", // + user id: changes that never reached the cloud before sign-out
};

export const HISTORY_LIMIT = 50;
export const DEFAULT_SETTINGS = {
  haptics: true,       // vibration on taps
  radioAlerts: true,   // "Aura Radio queued…" pop-ups
  autoplay: true,      // keep playing similar songs when the queue ends
  dataSaver: false,    // phone: no pre-downloading the next song or keeping songs offline
  pauseHistory: false, // don't record listening history
};

const NAMES = ["liked", "playlists", "history", "activity", "taste", "settings"];
const MERGE = {
  liked: mergeLiked,
  playlists: mergePlaylists,
  history: (a, b) => mergeHistory(a, b, HISTORY_LIMIT),
  activity: mergeActivity,
  taste: mergeTasteState,
  settings: mergeSettings,
};
const DEBOUNCE_MS = 1500;
const ACTIVITY_MIN_INTERVAL_MS = 60000; // listening time changes constantly: save at most once a minute
const RETRY_MS = 45000;

const newId = () => `d_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const getDeviceId = () => {
  let id = readStored(KEYS.device, null);
  if (!id) { id = newId(); writeStored(KEYS.device, id); }
  return id;
};

export function useLibrary(user, { onAccountChange } = {}) {
  const userId = user?.id || null;

  const [libraryReady, setLibraryReady] = useState(false);
  const [likedTracks, setLikedTracks] = useState([]);
  const [customPlaylists, setCustomPlaylists] = useState([]);
  const [playHistory, setPlayHistory] = useState([]);
  const [lifetime, setLifetime] = useState({ seconds: 0, plays: 0, artists: {}, genres: {}, moods: {} });
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [syncState, setSyncState] = useState("off"); // off | syncing | synced | pending
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState(0);

  // Refs mirror state so callbacks and timers always see the latest data, and so several changes
  // in one tick (create a playlist, then add a song to it) build on each other correctly
  const likedRef = useRef([]);
  const likedRemovedRef = useRef({});
  const playlistsRef = useRef([]);
  const playlistsDeletedRef = useRef({});
  const historyRef = useRef([]);
  const historyClearedRef = useRef(0);
  const activityRef = useRef({ devices: {} });
  const settingsRef = useRef(DEFAULT_SETTINGS);
  const settingsAtRef = useRef(0);
  const deviceIdRef = useRef(null);

  const userIdRef = useRef(null);
  const confirmedRef = useRef({});     // name -> stable() of what the cloud last confirmed
  const bootstrappedRef = useRef(false);
  const busyRef = useRef(false);
  const rerunRef = useRef(false);
  const lastActivitySyncRef = useRef(0);
  const debounceRef = useRef(null);
  const onAccountChangeRef = useRef(onAccountChange);
  onAccountChangeRef.current = onAccountChange;
  const userObjRef = useRef(user);   // latest user for long-lived callbacks
  userObjRef.current = user;

  // ─── The blobs that are saved to the account ───

  const getBlob = (name) => {
    switch (name) {
      case "liked": return { items: likedRef.current, removed: likedRemovedRef.current };
      case "playlists": return { items: playlistsRef.current, deleted: playlistsDeletedRef.current };
      case "history": return { items: historyRef.current, clearedAt: historyClearedRef.current };
      case "activity": return activityRef.current;
      case "taste": return exportTaste();
      case "settings": return { values: settingsRef.current, at: settingsAtRef.current };
      default: return null;
    }
  };

  const refreshLifetime = () => setLifetime(activityTotals(activityRef.current));

  // Applies merged data to state and storage (only when it actually differs)
  const applyBlob = (name, blob) => {
    if (!blob || stable(blob) === stable(getBlob(name))) return;
    switch (name) {
      case "liked":
        likedRef.current = blob.items; likedRemovedRef.current = blob.removed;
        setLikedTracks(blob.items);
        writeStored(KEYS.liked, blob.items); writeStored(KEYS.likedRemoved, blob.removed);
        break;
      case "playlists":
        playlistsRef.current = blob.items; playlistsDeletedRef.current = blob.deleted;
        setCustomPlaylists(blob.items);
        writeStored(KEYS.playlists, blob.items); writeStored(KEYS.playlistsDeleted, blob.deleted);
        break;
      case "history":
        historyRef.current = blob.items; historyClearedRef.current = blob.clearedAt;
        setPlayHistory(blob.items);
        writeStored(KEYS.history, blob.items); writeStored(KEYS.historyCleared, blob.clearedAt);
        break;
      case "activity":
        activityRef.current = blob;
        writeStored(KEYS.activity, blob);
        refreshLifetime();
        break;
      case "taste":
        applyTaste(blob);
        break;
      case "settings":
        if (blob.values) {
          settingsRef.current = { ...DEFAULT_SETTINGS, ...blob.values };
          settingsAtRef.current = ts(blob.at);
          setSettings(settingsRef.current);
          writeStored(KEYS.settings, settingsRef.current); writeStored(KEYS.settingsAt, settingsAtRef.current);
        }
        break;
      default:
    }
  };

  const mergeIntoLocal = (name, other) => applyBlob(name, MERGE[name](getBlob(name), other));

  const dirtyNames = () => NAMES.filter((name) => confirmedRef.current[name] !== stable(getBlob(name)));
  // Listening time and taste are saved quietly in the background; only changes the listener made
  // themselves count as "waiting to sync"
  const VISIBLE = ["liked", "playlists", "history", "settings"];
  const visibleDirty = () => dirtyNames().filter((name) => VISIBLE.includes(name));
  const refreshPending = () => {
    if (!userIdRef.current) { setPendingCount(0); return; }
    setPendingCount(visibleDirty().length);
  };

  // ─── Loading from the device ───

  useEffect(() => {
    deviceIdRef.current = getDeviceId();

    likedRef.current = readStored(KEYS.liked);
    likedRemovedRef.current = readStored(KEYS.likedRemoved, {});
    playlistsRef.current = readStored(KEYS.playlists);
    playlistsDeletedRef.current = readStored(KEYS.playlistsDeleted, {});
    historyRef.current = readStored(KEYS.history);
    historyClearedRef.current = readStored(KEYS.historyCleared, 0);
    settingsRef.current = { ...DEFAULT_SETTINGS, ...readStored(KEYS.settings, {}) };
    settingsAtRef.current = readStored(KEYS.settingsAt, 0);

    // Lifetime activity. Before it existed the app kept only two totals (minutes, songs) and the
    // last 50 plays: carry those over so nothing the listener already earned is lost.
    let activity = readStored(KEYS.activity, null);
    if (!activity?.devices) {
      const legacy = readStored(KEYS.legacyStats, null);
      const slot = emptySlot();
      slot.seconds = Number(legacy?.totalSeconds) || 0;
      slot.plays = Math.max(Number(legacy?.trackPlays) || 0, historyRef.current.length);
      for (const song of historyRef.current) {
        creditedArtists(song.artist).forEach((a) => { slot.artists[a] = (slot.artists[a] || 0) + 1; });
        slot.genres[genreOf(song)] = (slot.genres[genreOf(song)] || 0) + 1;
        slot.moods[moodOf(song)] = (slot.moods[moodOf(song)] || 0) + 1;
      }
      slot.at = Date.now();
      activity = { devices: { [deviceIdRef.current]: slot } };
      writeStored(KEYS.activity, activity);
    }
    activityRef.current = activity;
    if (!activity.devices[deviceIdRef.current]) activity.devices[deviceIdRef.current] = emptySlot();

    setLikedTracks(likedRef.current);
    setCustomPlaylists(playlistsRef.current);
    setPlayHistory(historyRef.current);
    setSettings(settingsRef.current);
    refreshLifetime();
    setLibraryReady(true);
    seedFromLibrary({ liked: likedRef.current, history: historyRef.current });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Saving to the account ───

  // One round of syncing: each changed kind of data is merged with the cloud copy atomically.
  // Resolves to true when everything that needed saving reached the cloud.
  const runSync = useCallback(async ({ force = false } = {}) => {
    const uid = userIdRef.current;
    if (!uid) return false;
    if (busyRef.current) { rerunRef.current = true; return false; }
    busyRef.current = true;
    setSyncState("syncing");
    let allOk = true;
    try {
      // First time on this account on this device: bring over anything saved before accounts existed
      // or left behind by a sign-out that could not reach the cloud
      if (!bootstrappedRef.current) {
        const ok = await bootstrap(uid);
        if (!ok || userIdRef.current !== uid) { allOk = false; return false; }
      }
      const due = (force ? NAMES : dirtyNames()).filter((name) => {
        if (name === "activity" && !force && Date.now() - lastActivitySyncRef.current < ACTIVITY_MIN_INTERVAL_MS) return false;
        return true;
      });
      for (const name of due) {
        const result = await syncBlob(uid, name, getBlob(name), MERGE[name]);
        if (userIdRef.current !== uid) return false; // signed out or switched meanwhile
        if (!result.ok) { allOk = false; continue; }
        if (name === "activity") lastActivitySyncRef.current = Date.now();
        confirmedRef.current[name] = stable(result.merged);
        mergeIntoLocal(name, result.merged); // plus whatever changed here while the save was in flight
      }
      if (allOk) {
        removeStored(KEYS.outbox + uid);
        setLastSyncedAt(Date.now());
      }
      return allOk;
    } finally {
      busyRef.current = false;
      refreshPending();
      const stillDirty = userIdRef.current ? visibleDirty().length : 0;
      setSyncState(!userIdRef.current ? "off" : allOk && !stillDirty ? "synced" : "pending");
      if (rerunRef.current) { rerunRef.current = false; setTimeout(() => runSync(), 300); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Everything that has to be merged in once per sign-in on this device
  const bootstrap = async (uid) => {
    // 1. changes this device could not save before the last sign-out
    const outbox = readStored(KEYS.outbox + uid, null);
    if (outbox) NAMES.forEach((name) => outbox[name] && mergeIntoLocal(name, outbox[name]));

    // 2. the single-document library from before per-kind documents (once per account)
    const marker = await readCloud(uid, "meta");
    if (!marker.ok) return false; // offline: try again later
    if (!marker.exists) {
      const legacy = await loadLegacyLibrary(uid);
      if (legacy === null) return false;
      if (legacy.likedTracks?.length) mergeIntoLocal("liked", { items: legacy.likedTracks.map((t) => ({ ...t, likedAt: ts(t.likedAt) })), removed: {} });
      if (legacy.customPlaylists?.length) mergeIntoLocal("playlists", { items: legacy.customPlaylists, deleted: {} });
      if (legacy.playHistory?.length) mergeIntoLocal("history", { items: legacy.playHistory.map((t) => ({ ...t, playedAt: ts(t.playedAt) })), clearedAt: 0 });
      const legacyDoneKey = `aurasynq_legacy_stats_done_${uid}`;
      if (legacy.listenStats && !readStored(legacyDoneKey, false)) {
        writeStored(legacyDoneKey, true);
        // The old total was already counted into this device's slot: park it as its own "legacy"
        // slot and take it off this device's, so the lifetime sum stays the same, not doubled
        const mine = activityRef.current.devices[deviceIdRef.current] || emptySlot();
        const legacySeconds = Number(legacy.listenStats.totalSeconds) || 0;
        const legacyPlays = Number(legacy.listenStats.trackPlays) || 0;
        const take = (value, from) => Math.max(0, value - Math.min(value, from));
        const patch = {
          devices: {
            legacy: { ...emptySlot(), seconds: legacySeconds, plays: legacyPlays, at: Date.now() },
            [deviceIdRef.current]: { ...mine, seconds: take(mine.seconds, legacySeconds), plays: take(mine.plays, legacyPlays) },
          },
        };
        // direct replacement: this subtraction must not be undone by max-merging
        activityRef.current = { devices: { ...activityRef.current.devices, ...patch.devices } };
        writeStored(KEYS.activity, activityRef.current);
        refreshLifetime();
      }
      // the migration marker is written once the data below has been saved
    }

    // 3. merge with the cloud, kind by kind
    for (const name of NAMES) {
      const result = await syncBlob(uid, name, getBlob(name), MERGE[name]);
      if (userIdRef.current !== uid) return false;
      if (!result.ok) return false;
      confirmedRef.current[name] = stable(result.merged);
      mergeIntoLocal(name, result.merged);
    }
    if (!marker.exists && !(await writeMarker(uid, "meta", { migrated: true, from: "single-document" }))) return false;
    removeStored(KEYS.outbox + uid);
    removeStored(KEYS.legacySyncMeta);
    syncProfileToCloud(userObjRef.current);
    bootstrappedRef.current = true;
    return true;
  };

  // Debounced save after local edits, and a retry loop while anything is unsaved
  const schedule = () => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSync(), DEBOUNCE_MS);
  };

  useEffect(() => {
    if (!libraryReady) return;
    refreshPending();
    if (userIdRef.current) schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [likedTracks, customPlaylists, playHistory, settings, lifetime, libraryReady]);

  useEffect(() => {
    const retry = () => { if (userIdRef.current && dirtyNames().length) runSync(); };
    const timer = setInterval(retry, RETRY_MS);
    const onVisible = () => {
      if (!userIdRef.current) return;
      if (document.visibilityState === "visible") runSync({ force: true }); // pull what other devices saved
      else runSync();                                                       // leaving: save what changed
    };
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pagehide", retry);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pagehide", retry);
    };
  }, [runSync]);

  // ─── Account changes ───

  const snapshotAll = () => Object.fromEntries(NAMES.map((name) => [name, getBlob(name)]));

  const clearLocal = () => {
    Object.values(KEYS).forEach((key) => { if (!key.endsWith("_")) removeStored(key); });
    writeStored(KEYS.device, deviceIdRef.current); // the device keeps its identity
    likedRef.current = []; likedRemovedRef.current = {};
    playlistsRef.current = []; playlistsDeletedRef.current = {};
    historyRef.current = []; historyClearedRef.current = 0;
    activityRef.current = { devices: { [deviceIdRef.current]: emptySlot() } };
    settingsRef.current = DEFAULT_SETTINGS; settingsAtRef.current = 0;
    confirmedRef.current = {};
    bootstrappedRef.current = false;
    resetTaste();
    setLikedTracks([]); setCustomPlaylists([]); setPlayHistory([]); setSettings(DEFAULT_SETTINGS);
    refreshLifetime();
    setLastSyncedAt(0);
    setPendingCount(0);
  };

  const previousUidRef = useRef(undefined);
  useEffect(() => {
    if (!libraryReady) return;
    const previous = previousUidRef.current;
    previousUidRef.current = userId;
    userIdRef.current = userId;
    if (previous && previous !== userId) {
      // Signed out or switched account. Anything the cloud never confirmed is set aside for the
      // next time this account signs in on this device, so a sign-out can never lose data.
      if (dirtyNames().length && !writeStored(KEYS.outbox + previous, snapshotAll())) {
        console.warn("AuraSynq: couldn't keep unsynced changes for the next sign-in");
      }
      clearLocal();
      onAccountChangeRef.current?.();
    }
    if (userId) { setSyncState("pending"); runSync({ force: true }); } else setSyncState("off");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryReady, userId]);

  // Before signing out: save everything. Resolves { ok } (false when something could not be saved;
  // it is then kept on this device and merged back the next time this account signs in here).
  const prepareSignOut = async () => {
    if (!userIdRef.current) return { ok: true };
    clearTimeout(debounceRef.current);
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      while (busyRef.current) await new Promise((r) => setTimeout(r, 200));
      ok = await runSync({ force: true });
    }
    return { ok: ok && dirtyNames().length === 0 };
  };

  const syncNow = async () => runSync({ force: true });

  const deleteCloudData = async () => {
    const uid = userIdRef.current;
    const ok = await deleteCloudLibrary(uid);
    if (ok) { removeStored(KEYS.outbox + uid); clearLocal(); }
    return ok;
  };

  // ─── Liked songs ───

  const toggleLike = (track) => {
    if (!track) return false;
    const now = Date.now();
    const exists = likedRef.current.some((t) => t.id === track.id);
    if (exists) {
      likedRemovedRef.current = { ...likedRemovedRef.current, [track.id]: now };
      likedRef.current = likedRef.current.filter((t) => t.id !== track.id);
    } else {
      likedRef.current = [...likedRef.current, { ...lightTrack(track), likedAt: now }];
    }
    setLikedTracks(likedRef.current);
    writeStored(KEYS.liked, likedRef.current); writeStored(KEYS.likedRemoved, likedRemovedRef.current);
    return !exists;
  };

  // ─── Playlists ───

  const updatePlaylists = (updater, deletedPatch = null) => {
    playlistsRef.current = updater(playlistsRef.current);
    if (deletedPatch) playlistsDeletedRef.current = { ...playlistsDeletedRef.current, ...deletedPatch };
    setCustomPlaylists(playlistsRef.current);
    writeStored(KEYS.playlists, playlistsRef.current); writeStored(KEYS.playlistsDeleted, playlistsDeletedRef.current);
  };
  const touch = (playlist, extra = {}) => ({ ...playlist, ...extra, updatedAt: Date.now() });

  const createPlaylist = (name) => {
    const now = Date.now();
    const playlist = {
      id: `playlist_${now}_${Math.floor(Math.random() * 1000)}`,
      name: name || "Unnamed Playlist", nameAt: now,
      tracks: [], removed: {},
      isCollaborative: false, collaborators: [],
      createdAt: now, updatedAt: now,
    };
    updatePlaylists((prev) => [...prev, playlist]);
    return playlist;
  };

  const deletePlaylist = (playlistId) =>
    updatePlaylists((prev) => prev.filter((p) => p.id !== playlistId), { [playlistId]: Date.now() });

  const renamePlaylist = (playlistId, newName) =>
    updatePlaylists((prev) => prev.map((p) => (p.id === playlistId ? touch(p, { name: newName, nameAt: Date.now() }) : p)));

  const addTrackToPlaylist = (playlistId, track) => {
    if (!track) return;
    updatePlaylists((prev) => prev.map((p) => {
      if (p.id !== playlistId || p.tracks.some((t) => t.id === track.id)) return p;
      return touch(p, { tracks: [...p.tracks, { ...lightTrack(track), addedAt: Date.now() }] });
    }));
  };

  const removeTrackFromPlaylist = (playlistId, trackId) =>
    updatePlaylists((prev) => prev.map((p) => (p.id === playlistId
      ? touch(p, { tracks: p.tracks.filter((t) => t.id !== trackId), removed: { ...(p.removed || {}), [trackId]: Date.now() } })
      : p)));

  const toggleCollaborative = (playlistId) =>
    updatePlaylists((prev) => prev.map((p) => {
      if (p.id !== playlistId) return p;
      const next = !p.isCollaborative;
      return touch(p, {
        isCollaborative: next,
        collaborators: next ? [
          { name: "Arun", avatar: "https://i.pravatar.cc/150?u=arun_blend" },
          { name: "Meera", avatar: "https://i.pravatar.cc/150?u=meera_blend" },
        ] : [],
      });
    }));

  // ─── History and lifetime activity ───

  const mySlot = () => {
    const devices = activityRef.current.devices;
    if (!devices[deviceIdRef.current]) devices[deviceIdRef.current] = emptySlot();
    return devices[deviceIdRef.current];
  };
  const saveActivity = () => {
    mySlot().at = Date.now();
    writeStored(KEYS.activity, activityRef.current);
    refreshLifetime();
  };

  // A song started playing
  const recordPlay = (track, { keepHistory = true } = {}) => {
    if (keepHistory) {
      historyRef.current = [{ ...lightTrack(track), playedAt: Date.now() }, ...historyRef.current.filter((t) => t.id !== track.id)].slice(0, HISTORY_LIMIT);
      setPlayHistory(historyRef.current);
      writeStored(KEYS.history, historyRef.current);
    }
    const slot = mySlot();
    slot.plays += 1;
    creditedArtists(track.artist).forEach((a) => { slot.artists[a] = (slot.artists[a] || 0) + 1; });
    slot.genres[genreOf(track)] = (slot.genres[genreOf(track)] || 0) + 1;
    slot.moods[moodOf(track)] = (slot.moods[moodOf(track)] || 0) + 1;
    saveActivity();
  };

  const addListenSeconds = (seconds) => {
    if (!(seconds > 0)) return;
    mySlot().seconds = Math.round(mySlot().seconds + seconds);
    saveActivity();
  };

  const clearHistory = () => {
    historyClearedRef.current = Date.now();
    historyRef.current = [];
    setPlayHistory([]);
    writeStored(KEYS.history, []); writeStored(KEYS.historyCleared, historyClearedRef.current);
  };

  // ─── Settings ───

  const updateSettings = (patch) => {
    settingsRef.current = { ...settingsRef.current, ...patch };
    settingsAtRef.current = Date.now();
    setSettings(settingsRef.current);
    writeStored(KEYS.settings, settingsRef.current); writeStored(KEYS.settingsAt, settingsAtRef.current);
  };

  return {
    libraryReady,
    likedTracks, likedRef, toggleLike,
    customPlaylists, playlistsRef, createPlaylist, deletePlaylist, renamePlaylist, addTrackToPlaylist, removeTrackFromPlaylist, toggleCollaborative,
    playHistory, historyRef, recordPlay, clearHistory,
    lifetime, addListenSeconds,
    settings, settingsRef, updateSettings,
    syncState, pendingCount, lastSyncedAt, syncNow, prepareSignOut, deleteCloudData,
    isCloudSynced: syncState === "synced",
  };
}
