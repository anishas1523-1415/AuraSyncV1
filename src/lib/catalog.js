"use client";
// Where song lists come from. YouTube Music's song search (real songs, not stage shows or
// reaction videos) and its radio for "more like this". In the Android app both run on the phone;
// on the website, and as the app's fallback, through /api/search.
import { apiUrl, isMobileApp } from "@/lib/api";
import { getProfile, seedFromLibrary } from "@/lib/ir/profile";
import { forYou, personalize, pickSeeds } from "@/lib/ir/recommend";
import { regionalLanguages } from "@/lib/ir/signals";

const CACHE_MS = 6 * 60 * 60 * 1000; // song searches change slowly; mixes stay varied anyway
// Versioned: a new ranking must not serve lists ranked by an older one
const STORE_KEY = "aurasynq_catalog_cache_v3";
try { ["aurasynq_catalog_cache", "aurasynq_catalog_cache_v2"].forEach((k) => localStorage.removeItem(k)); } catch (e) {}
const MAX_STORED = 80;
const RECENT_HISTORY = 30; // songs played lately sink to the bottom of fresh mixes
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

// key -> { at, tracks }. Kept on the device too, so lists open instantly on later visits
const cache = new Map();
let restored = false;
const restoreCache = () => {
  if (restored || typeof window === "undefined") return;
  restored = true;
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
    for (const [key, entry] of saved) {
      if (Date.now() - entry.at < CACHE_MS) cache.set(key, entry);
    }
  } catch (e) {}
};
let persistTimer = null;
const persistCache = () => {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      const entries = [...cache.entries()].sort((a, b) => b[1].at - a[1].at).slice(0, MAX_STORED);
      localStorage.setItem(STORE_KEY, JSON.stringify(entries));
    } catch (e) {}
  }, 500);
};
const lastSeeds = new Map(); // mix key -> seeds used last time

let musicPromise = null;
const loadMusic = () => {
  if (!isMobileApp || typeof window === "undefined") return Promise.resolve(null);
  if (!musicPromise) musicPromise = import("@/lib/ondevice/music").catch(() => null);
  return musicPromise;
};

async function fromServer(params) {
  const res = await fetch(apiUrl(`/api/search?${new URLSearchParams(params)}`));
  if (res.status === 429) throw Object.assign(new Error("Too many searches"), { rateLimited: true });
  if (!res.ok) throw new Error(`Search failed (HTTP ${res.status})`);
  return (await res.json()).tracks || [];
}

async function cached(key, load, fresh) {
  restoreCache();
  const hit = cache.get(key);
  const ttl = key.startsWith("chart:") ? CACHE_MS / 2 : CACHE_MS;
  if (!fresh && hit && Date.now() - hit.at < ttl) return hit.tracks;
  try {
    const tracks = await load();
    if (tracks.length) {
      cache.set(key, { at: Date.now(), tracks });
      persistCache();
    }
    return tracks;
  } catch (err) {
    // Offline or a flaky connection: an older copy beats an empty screen
    if (hit) return hit.tracks;
    throw err;
  }
}

// The listener's country (for the charts), from the phone's locale, India by default
const country = () => {
  const region = typeof navigator !== "undefined" ? String(navigator.language || "").split("-")[1] : "";
  return /^[A-Z]{2}$/.test(region || "") ? region : "IN";
};

// Official YouTube Music charts: kind "now" (trending in the country, leaning toward the
// listener's languages) or a language ("tamil"). Phone first, the server as fallback.
export function chartSongs(kind, { fresh = false } = {}) {
  const languages = regionalLanguages(getProfile());
  const key = `chart:${kind}:${kind === "now" ? languages.join(",") : ""}`;
  return cached(key, () => lookup(
    (m) => m.chartSongs(kind, { country: country(), languages }),
    { chart: kind, country: country(), langs: languages.join(",") },
  ), fresh);
}

// What's trending in the listener's region (their languages): ids of today's trending and
// latest songs. Loaded in the background; rankings use whatever has arrived so far.
let trending = null;
let trendingAt = 0;
export function trendingIds() {
  if (typeof window === "undefined") return null;
  if (!trendingAt || Date.now() - trendingAt > CACHE_MS) {
    trendingAt = Date.now();
    // The official charts: trending in the country plus the listener's languages' weekly charts
    const langs = regionalLanguages(getProfile()).slice(0, 2);
    Promise.allSettled([chartSongs("now"), ...langs.map((l) => chartSongs(l))]).then((results) => {
      const ids = new Set(results.flatMap((r) => (r.status === "fulfilled" ? r.value.map((t) => t.id) : [])));
      if (ids.size) trending = ids;
    });
  }
  return trending;
}

// Open the phone's YouTube Music connection early, so the first list loads sooner
export function warmCatalog() {
  restoreCache();
  setTimeout(trendingIds, 3000);
  loadMusic().then((music) => music?.warmUp?.()).catch(() => {});
}

// Phone first; the server if the phone's lookup fails or finds nothing
async function lookup(onDevice, serverParams) {
  const music = await loadMusic();
  if (music) {
    try {
      const tracks = await onDevice(music);
      if (tracks.length) return tracks;
    } catch (err) {
      console.warn("AuraSynq: on-device lookup failed, asking the server", err);
    }
  }
  return fromServer(serverParams);
}

// A listener's search: full relevance ranking, personalised by their taste profile
export function searchSongs(query, { fresh = false } = {}) {
  const q = query.trim();
  return cached(`search:${q.toLowerCase()}`, () => lookup((m) => m.searchSongs(q, { profile: getProfile(), trending: trendingIds() }), { q }), fresh);
}

// Background searches behind mixes: plain song search, ranked by `personalize` afterwards
function seedSongs(query, { fresh = false } = {}) {
  const q = query.trim();
  return cached(`seed:${q.toLowerCase()}`, () => lookup((m) => m.searchSongs(q, { light: true }), { q }), fresh);
}

// Songs that sound like this one: YouTube Music's radio for it (same mood, related artists)
export function relatedSongs(track, { fresh = false } = {}) {
  const id = track?.id;
  if (!id || !YOUTUBE_ID.test(id)) return Promise.resolve([]);
  return cached(`related:${id}`, () => lookup((m) => m.relatedSongs(id), { related: id }), fresh);
}

// ─── Mixing: different songs and order on every visit or sync ───

export const shuffle = (list) => {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

const interleave = (lists) => {
  const out = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) lists.forEach((l) => l[i] && out.push(l[i]));
  return out;
};

const recentlyPlayedIds = () => {
  try {
    const history = JSON.parse(localStorage.getItem("aurasynq_play_history") || "[]");
    return new Set(history.slice(0, RECENT_HISTORY).map((t) => t?.id));
  } catch (e) {
    return new Set();
  }
};

// One entry per song (the same song often appears on several albums), unheard songs first
const freshen = (tracks, count, exclude = new Set()) => {
  const seen = new Set();
  const unique = tracks.filter((t) => {
    if (!t?.id || exclude.has(t.id)) return false;
    const key = `${t.title}|${t.artist?.split(",")[0]}`.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(t.id) || seen.has(key)) return false;
    seen.add(t.id);
    seen.add(key);
    return true;
  });
  const recent = recentlyPlayedIds();
  return [...unique.filter((t) => !recent.has(t.id)), ...unique.filter((t) => recent.has(t.id))].slice(0, count);
};

const settledLists = async (promises) => {
  const results = await Promise.allSettled(promises);
  // Each list keeps its relevance order; variety comes from seed choice and `personalize`
  const lists = results.filter((r) => r.status === "fulfilled" && r.value.length).map((r) => r.value);
  if (!lists.length) throw results.find((r) => r.status === "rejected")?.reason || new Error("No songs found");
  return lists;
};

// A mix from a few of `seeds` (avoiding last time's), preferring the listener's languages, then
// ranked by how well each song fits them, with a little variety
export async function mixSongs(key, seeds, { count = 25, seedsPerMix = 2, fresh = false } = {}) {
  const previous = lastSeeds.get(key) || [];
  const unused = seeds.filter((s) => !previous.includes(s));
  const chosen = pickSeeds(unused.length >= seedsPerMix ? unused : seeds, seedsPerMix);
  lastSeeds.set(key, chosen);
  const lists = await settledLists(chosen.map((seed) => seedSongs(seed, { fresh })));
  return personalize(freshen(interleave(lists), count * 2), { count, trending: trendingIds() });
}

// Personal mix: songs that the radios of the listener's favourites (from every side of their
// taste) agree on, ranked by fit (see recommend.forYou)
export async function forYouSongs({ history = [], liked = [], fallbackSeeds = [], count = 25, fresh = false }) {
  seedFromLibrary({ liked, history });
  const list = await forYou((track) => relatedSongs(track, { fresh }), {
    count: count * 2,
    recent: recentlyPlayedIds(),
    fallback: () => mixSongs("foryou", fallbackSeeds, { count, fresh }),
  });
  return freshen(list, count);
}
