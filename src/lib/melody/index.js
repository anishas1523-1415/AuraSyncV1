"use client";
// The hum search index on this device, and hum search itself.
//
// Each song the app has already downloaded for playback (auto-cached recent songs and explicit
// downloads, in Cache Storage) gets its main melody extracted once, in a worker, and stored as a
// compact contour (~600 bytes per minute) in IndexedDB. Audio never leaves the device and is never
// stored again; contours outlive the audio cache, so coverage grows with listening.
import { apiUrl } from "@/lib/api";
import { readStored } from "@/lib/storage";
import { contourToBase64, contourFromBase64, unpackContour, queryContour } from "./contour.js";
import { trackHum } from "./pitch.js";
import { searchMelody } from "./match.js";

const DB_NAME = "aurasynq_melody";
const STORE = "refs";
const AUDIO_CACHE = "aurasynq_offline_audio"; // shared with AudioContext.js
const DOWNLOADS_KEY = "aurasynq_downloaded_metadata";
const AUTO_CACHE_KEY = "aurasynq_auto_cached_ids";
const HISTORY_KEY = "aurasynq_play_history";
const LIKED_KEY = "aurasynq_liked_songs_metadata";
const TASTE_KEY = "aurasynq_taste";
const CATALOG_KEY = "aurasynq_catalog_cache_v3";
const UNKNOWN = "Unknown title";
const SR = 16000;
// Bump when extraction changes, so old contours are rebuilt.
// 2: sustained-sound (drone / bass pedal) suppression in trackMelody
const VERSION = 2;
const MIN_VOICED = 0.15; // a song with less melody than this (instrumental, ambient) isn't kept

// ─── IndexedDB ───
let dbPromise = null;
function db() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((e) => { dbPromise = null; throw e; });
  return dbPromise;
}
const tx = async (mode, fn) => {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
  });
};

let refsCache = null; // [{ id, contour: Float32Array, track }]
async function allRefs() {
  if (refsCache) return refsCache;
  const rows = await tx("readonly", (s) => s.getAll());
  refsCache = (rows || []).filter((r) => r.v === VERSION && r.contour).map((r) => ({
    id: r.id,
    track: r.track,
    contour: unpackContour(contourFromBase64(r.contour)),
  }));
  return refsCache;
}

export async function melodyIndexStats() {
  const rows = await tx("readonly", (s) => s.getAll()).catch(() => []);
  const kept = rows.filter((r) => r.v === VERSION && r.contour);
  return {
    songs: kept.length,
    skipped: rows.filter((r) => r.v === VERSION && !r.contour).length,
    seconds: Math.round(kept.reduce((n, r) => n + (r.seconds || 0), 0)),
  };
}

// ─── Worker ───
let worker = null;
let nextJob = 1;
const pending = new Map();
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  worker.onmessage = (e) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.error) p.reject(new Error(e.data.error));
    else p.resolve(e.data);
  };
  worker.onerror = (e) => {
    pending.forEach((p) => p.reject(new Error(e.message || "melody worker failed")));
    pending.clear();
    worker = null;
  };
  return worker;
}
const runJob = (job, samples) => new Promise((resolve, reject) => {
  const id = nextJob++;
  pending.set(id, { resolve, reject });
  getWorker().postMessage({ job, id, samples }, [samples.buffer]);
});

// ─── Audio ───
// Decoding into a 16 kHz context resamples on the way in; channels are averaged to mono
export async function decodeTo16k(arrayBuffer) {
  const ctx = new OfflineAudioContext(1, 1, SR);
  const buffer = await ctx.decodeAudioData(arrayBuffer);
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] += data[i] / buffer.numberOfChannels;
  }
  return out;
}

async function cachedAudio(id) {
  if (!("caches" in globalThis)) return null;
  const cache = await caches.open(AUDIO_CACHE);
  const res = await cache.match(apiUrl(`/api/stream?id=${id}`));
  return res ? res.arrayBuffer() : null;
}

// ─── Indexing queue: one song at a time, in the background ───
const queue = [];
const queued = new Set();
let running = false;

const lightTrack = (t) => ({
  id: t.id,
  title: t.title || UNKNOWN,
  artist: t.artist || "Unknown Artist",
  cover: t.cover || `https://i.ytimg.com/vi/${t.id}/hqdefault.jpg`,
  duration: t.duration || 0,
  ...(t.album ? { album: t.album } : {}),
});

// Song details for ids known only from the audio cache: history keeps 50 songs, but the taste
// profile (400), liked songs, downloads and cached lists know many more
function knownTracks() {
  const known = new Map();
  const add = (t) => { if (t?.id && t.title && !known.has(t.id)) known.set(t.id, t); };
  [...readStored(DOWNLOADS_KEY), ...readStored(LIKED_KEY), ...readStored(HISTORY_KEY)].forEach(add);
  try {
    const taste = JSON.parse(localStorage.getItem(TASTE_KEY) || "{}");
    Object.entries(taste.tracks || {}).forEach(([id, e]) => add({ id, title: e.title, artist: e.artist }));
  } catch (e) {}
  try {
    const catalog = JSON.parse(localStorage.getItem(CATALOG_KEY) || "[]");
    (Array.isArray(catalog) ? catalog : Object.values(catalog)).forEach((entry) => {
      const tracks = Array.isArray(entry) ? entry[1]?.tracks : entry?.tracks;
      (tracks || []).forEach(add);
    });
  } catch (e) {}
  return known;
}

async function indexOne(track, blob) {
  const existing = await tx("readonly", (s) => s.get(track.id)).catch(() => null);
  if (existing?.v === VERSION) {
    // Learned before its details were known (e.g. at start-up): fill them in now
    if (existing.track?.title === UNKNOWN && track.title && track.title !== UNKNOWN) {
      await tx("readwrite", (s) => s.put({ ...existing, track: lightTrack(track) }));
      refsCache = null;
    }
    return;
  }
  const bytes = blob ? await blob.arrayBuffer() : await cachedAudio(track.id);
  if (!bytes) return; // audio not on the device (any more): nothing to index
  const samples = await decodeTo16k(bytes);
  const { packed, seconds, voiced } = await runJob("reference", samples);
  const row = { id: track.id, v: VERSION, track: lightTrack(track), seconds, voiced, at: Date.now() };
  // Instrumentals and ambient tracks: remembered as checked, but not searchable
  if (voiced >= MIN_VOICED) row.contour = contourToBase64(packed);
  await tx("readwrite", (s) => s.put(row));
  refsCache = null;
}

// Learning costs a few seconds of processing per song: it waits while the battery is low and the
// phone isn't charging, and picks up again later (Battery Status API where the WebView has it)
const LOW_BATTERY = 0.3;
const RETRY_LOW_BATTERY_MS = 5 * 60 * 1000;
async function batteryLow() {
  try {
    const battery = await navigator.getBattery?.();
    return !!battery && !battery.charging && battery.level < LOW_BATTERY;
  } catch (e) {
    return false;
  }
}

async function drain() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      if (await batteryLow()) {
        setTimeout(drain, RETRY_LOW_BATTERY_MS);
        break;
      }
      const { track, blob } = queue.shift();
      queued.delete(track.id);
      try {
        await indexOne(track, blob);
      } catch (e) {
        console.warn("AuraSynq: melody indexing failed for", track.id, e?.message || e);
      }
      // give the device a breather between songs
      await new Promise((r) => setTimeout(r, 1500));
    }
  } finally {
    running = false;
  }
}

// Called when a song has been downloaded for playback (blob optional: read from the cache otherwise)
export function indexMelodyLater(track, blob = null) {
  if (typeof window === "undefined" || !track?.id || queued.has(track.id)) return;
  queued.add(track.id);
  queue.push({ track, blob });
  setTimeout(drain, 4000);
}

// Start-up: index every song whose audio is already on the device (downloads, recent songs)
let backfilled = false;
export function backfillMelodyIndex() {
  if (backfilled || typeof window === "undefined" || !("indexedDB" in window)) return;
  backfilled = true;
  setTimeout(async () => {
    const known = knownTracks();
    const ids = [...readStored(DOWNLOADS_KEY).map((t) => t?.id), ...readStored(AUTO_CACHE_KEY)].filter(Boolean);
    for (const id of new Set(ids)) indexMelodyLater(known.get(id) || { id, title: UNKNOWN });
    // Songs learned earlier without details: fill them in from what's known now
    const rows = await tx("readonly", (s) => s.getAll()).catch(() => []);
    const fixes = rows.filter((r) => r.track?.title === UNKNOWN && known.has(r.id));
    if (fixes.length) {
      await tx("readwrite", (s) => fixes.forEach((r) => s.put({ ...r, track: lightTrack(known.get(r.id)) }))).catch(() => {});
      refsCache = null;
    }
  }, 20000);
}

// USB-debug hook (like window.__auraSearch): await window.__auraMelody.melodyIndexStats()
export const __debug = { allRefs, cachedAudio };
if (typeof window !== "undefined") {
  window.__auraMelody = {
    melodyIndexStats: () => melodyIndexStats(),
    humSearch: (samples) => humSearch(samples),
    references: () => allRefs(),
    cachedAudio: (id) => cachedAudio(id),
    decodeTo16k: (bytes) => decodeTo16k(bytes),
    // the last hums, newest first: { query contour, reason, candidates, at } plus `samples` on request
    recentHums: (withAudio = false) => recentHums.map((h) => ({ ...h, samples: withAudio ? Array.from(h.samples) : undefined })),
  };
}

// ─── Hum search ───
// The last few hums, kept in memory only (never stored): lets a developer see over USB debugging
// why a hum wasn't found (window.__auraMelody.recentHums()). Gone when the app closes.
const recentHums = [];
const KEEP_HUMS = 5;

// How many near misses to offer when no song is a confident match, and how close they must be.
// Real hums score much rougher than the synthetic tests (the right song at ~0.55 cost, but often
// not clearly ahead of the rest), so like Google's hum search the closest songs are offered as
// best guesses rather than answering "no match".
const GUESSES = 3;
const GUESS_MAX_COST = 0.65;

// samples: Float32Array at 16 kHz. Resolves to { tracks, guess, reason, ms, indexed }:
// guess = true when tracks are best guesses rather than a confident match
export async function humSearch(samples) {
  const started = Date.now();
  const refs = await allRefs();
  if (!refs.length) return { tracks: [], guess: false, reason: "empty-index", ms: 0, indexed: 0 };
  const query = queryContour(trackHum(samples, SR));
  const res = searchMelody(query, refs);
  const byId = new Map(refs.map((r) => [r.id, r.track]));
  const confident = res.matches.length > 0;
  const guessable = !confident && res.reason === "ambiguous" ? (res.closest || []).filter((m) => m.cost <= GUESS_MAX_COST).slice(0, GUESSES) : [];
  const tracks = (confident ? res.matches : guessable)
    .map((m) => ({ ...byId.get(m.id), matchConfidence: m.confidence, matchAt: m.at }))
    .filter((t) => t.id);
  const describe = (m) => ({ id: m.id, title: byId.get(m.id)?.title, cost: +m.cost.toFixed(3), z: +m.z.toFixed(2), at: m.at });
  recentHums.unshift({
    samples,
    query: Array.from(query, (v) => (Number.isNaN(v) ? null : +v.toFixed(2))),
    reason: res.reason,
    candidates: (res.matches.length ? res.matches : res.closest || []).map(describe),
    at: Date.now(),
  });
  recentHums.length = Math.min(recentHums.length, KEEP_HUMS);
  return { tracks, guess: !confident && tracks.length > 0, reason: res.reason, ms: Date.now() - started, indexed: refs.length };
}
