"use client";
// Where song lists come from. YouTube Music's song search (real songs, not stage shows or
// reaction videos) and its radio for "more like this". In the Android app both run on the phone;
// on the website, and as the app's fallback, through /api/search.
import { apiUrl, isMobileApp } from "@/lib/api";

const CACHE_MS = 10 * 60 * 1000;
const RECENT_HISTORY = 30; // songs played lately sink to the bottom of fresh mixes
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

const cache = new Map(); // key -> { at, tracks }
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
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.tracks;
  const tracks = await load();
  if (tracks.length) cache.set(key, { at: Date.now(), tracks });
  return tracks;
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

export function searchSongs(query, { fresh = false } = {}) {
  const q = query.trim();
  return cached(`search:${q.toLowerCase()}`, () => lookup((m) => m.searchSongs(q), { q }), fresh);
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
  const lists = results.filter((r) => r.status === "fulfilled" && r.value.length).map((r) => shuffle(r.value));
  if (!lists.length) throw results.find((r) => r.status === "rejected")?.reason || new Error("No songs found");
  return lists;
};

// A mix of a few random searches from `seeds`, avoiding the ones used last time
export async function mixSongs(key, seeds, { count = 25, seedsPerMix = 2, fresh = false } = {}) {
  const previous = lastSeeds.get(key) || [];
  const unused = seeds.filter((s) => !previous.includes(s));
  const chosen = shuffle(unused.length >= seedsPerMix ? unused : seeds).slice(0, seedsPerMix);
  lastSeeds.set(key, chosen);
  const lists = await settledLists(chosen.map((seed) => searchSongs(seed, { fresh })));
  return freshen(interleave(lists), count);
}

// Personal mix: radios of a few songs the listener played or liked, so it follows their mood
export async function forYouSongs({ history = [], liked = [], fallbackSeeds = [], count = 25, fresh = false }) {
  const pool = [...history.slice(0, 15), ...liked.slice(0, 15)].filter((t) => t?.id && YOUTUBE_ID.test(t.id));
  const unique = pool.filter((t, i) => pool.findIndex((o) => o.id === t.id) === i);
  if (!unique.length) return mixSongs("foryou", fallbackSeeds, { count, fresh });

  const seeds = shuffle(unique).slice(0, 3);
  const lists = await settledLists(seeds.map((track) => relatedSongs(track, { fresh })));
  return freshen(interleave(lists), count, new Set(seeds.map((t) => t.id)));
}
