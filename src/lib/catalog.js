"use client";
// Where song lists come from. YouTube Music's song search (real songs, not stage shows or
// reaction videos) and its radio for "more like this". In the Android app both run on the phone;
// on the website, and as the app's fallback, through /api/search.
import { apiUrl, isMobileApp } from "@/lib/api";
import { getProfile, seedFromLibrary, tasteVersion } from "@/lib/ir/profile";
import { forYou, personalize, pickSeeds, pickChartSongs } from "@/lib/ir/recommend";
import { regionalLanguages } from "@/lib/ir/signals";
import { momentPicks } from "@/lib/ir/recommend";
import { normalize } from "@/lib/ir/text";

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
// On the phone the chart pool is larger than the server route's 40, so chart pages can keep changing
// from one Sync to the next. Language charts check each song's language online (slower, more data),
// so their pool is smaller.
const chartPool = (kind) => (kind === "now" ? 80 : 56);

export function chartSongs(kind, { fresh = false } = {}) {
  const languages = regionalLanguages(getProfile());
  const key = `chart:${kind}:${kind === "now" ? languages.join(",") : ""}:${chartPool(kind)}`;
  return cached(key, () => lookup(
    (m) => m.chartSongs(kind, { country: country(), languages, count: chartPool(kind) }),
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

// ─── Search suggestions ───
// Autocomplete = the listener's own recent searches and artists that start with what they typed
// (instant, no network), then YouTube Music's suggestions for it.
const suggestCache = new Map();

// App tools that typing can reach: "hum", "hum l…" suggests Hum Lab (it has no other link). From
// just "h" only for people who have used it, so ordinary listeners aren't shown a tool they don't know.
const TOOLS = [{ text: "Hum Lab", names: ["humlab", "hum lab"], href: "/humlab", usedKey: "aurasynq_humlab_profile" }];

export function localSuggestions(text) {
  const q = normalize(text);
  if (!q || typeof window === "undefined") return [];
  const out = [];
  for (const tool of TOOLS) {
    let used = false;
    try { used = !!localStorage.getItem(tool.usedKey); } catch (e) {}
    if ((q.length >= 3 || used) && tool.names.some((n) => n.startsWith(q))) out.push({ text: tool.text, kind: "tool", href: tool.href });
  }
  try {
    JSON.parse(localStorage.getItem("aurasynq_recent_searches") || "[]")
      .filter((s) => normalize(s).startsWith(q) && normalize(s) !== q)
      .slice(0, 3)
      .forEach((s) => out.push({ text: s, kind: "recent" }));
  } catch (e) {}
  Object.entries(getProfile() || {})
    .filter(([k, v]) => k.startsWith("artist:") && v > 0.05 && k.slice(7).startsWith(q) && k.slice(7) !== q)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .forEach(([k]) => out.push({ text: k.slice(7).replace(/\b\w/g, (c) => c.toUpperCase()), kind: "artist" }));
  return out;
}

// Re-orders YouTube Music's suggestions by the listener's taste: a suggestion naming one of their
// artists, languages or moods moves up; the rest keep YouTube's order
function rankSuggestions(list) {
  const profile = getProfile();
  if (!profile || list.length < 2) return list;
  const terms = Object.entries(profile)
    .filter(([k, v]) => v > 0.05 && /^(artist|lang|mood):/.test(k))
    .map(([k, v]) => [k.slice(k.indexOf(":") + 1), v]);
  const score = (text, i) => {
    const t = normalize(text);
    const fit = terms.reduce((n, [term, v]) => (term.length > 2 && t.includes(term) ? n + v : n), 0);
    return fit - i * 0.02;
  };
  return list.map((s, i) => ({ s, k: score(typeof s === "string" ? s : s?.text || "", i) }))
    .sort((a, b) => b.k - a.k)
    .map((x) => x.s);
}

export async function suggestQueries(text) {
  const q = text.trim();
  if (!q) return [];
  const key = q.toLowerCase();
  if (suggestCache.has(key)) return rankSuggestions(suggestCache.get(key));
  let list = [];
  try {
    const music = await loadMusic();
    list = music
      ? await music.suggestQueries(q)
      : (await (await fetch(apiUrl(`/api/search?${new URLSearchParams({ suggest: q })}`))).json()).suggestions || [];
  } catch (e) {}
  if (suggestCache.size > 200) suggestCache.clear();
  suggestCache.set(key, list);
  return rankSuggestions(list);
}

// "For this moment" chips on the Search screen
export const searchMoments = () => momentPicks();

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
// `spoken`: the whole sentence of a voice search, also searched as is (on the phone; the server
// takes the parsed words only)
export function searchSongs(query, { fresh = false, spoken = "" } = {}) {
  const q = query.trim();
  const key = `search:${q.toLowerCase()}${spoken ? `|${spoken.trim().toLowerCase()}` : ""}`;
  return cached(key, () => lookup((m) => m.searchSongs(q, { profile: getProfile(), trending: trendingIds(), spoken }), { q }), fresh);
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
  const reuse = recentList(key, fresh);
  if (reuse) return reuse;
  // Seeds not used in the last two rounds (remembered across restarts), when there are enough
  const recentSeeds = seedHistory(key).slice(-2).flat();
  const unused = seeds.filter((s) => !recentSeeds.includes(s));
  const chosen = pickSeeds(unused.length >= seedsPerMix ? unused : seeds, seedsPerMix);
  rememberSeeds(key, chosen);
  const lists = (await settledLists(chosen.map((seed) => seedSongs(seed, { fresh }).then((list) => list.map((t) => ({ ...t, seed }))))));
  // Songs this list hasn't shown lately come first, so every round brings new ones
  const pool = preferUnseen(key, freshen(interleave(lists), count * 4), count * 2);
  const out = personalize(pool, { count, trending: trendingIds() });
  return showList(key, out);
}

// ─── Variety: what each list has shown, and which seeds it used ───
// Remembered on the device so a list doesn't come back to the same songs after a sync or a restart.
// Opening a list again within a few minutes shows the same songs (no jumping while browsing);
// Sync always brings a new set.
const SHOWN_KEY = "aurasynq_shown_v1";
const SEEDS_KEY = "aurasynq_seed_history_v1";
const SHOWN_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const SHOWN_MAX = 300; // per list
const REUSE_MS = 60 * 60 * 1000; // an hour: lists don't change under you while browsing
const lastLists = new Map(); // key -> { at, tracks }: the list as last shown in this session

const readJSON = (k, fallback) => {
  try { return JSON.parse(localStorage.getItem(k) || "null") || fallback; } catch (e) { return fallback; }
};
const writeJSON = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
};

function shownMap(key) {
  const all = readJSON(SHOWN_KEY, {});
  const now = Date.now();
  return Object.fromEntries(Object.entries(all[key] || {}).filter(([, at]) => now - at < SHOWN_TTL_MS));
}

// Reused within the hour, unless the listener has since told the app a lot (several plays, skips,
// likes or searches): then the list is rebuilt for what they are into now
const RELEARN_AFTER = 6;
function recentList(key, fresh) {
  const last = lastLists.get(key);
  if (fresh || !last || Date.now() - last.at >= REUSE_MS) return null;
  return tasteVersion() - (last.version || 0) >= RELEARN_AFTER ? null : last.tracks;
}

// Records `tracks` as shown by list `key`, and returns them
function showList(key, tracks) {
  if (!tracks?.length) return tracks;
  lastLists.set(key, { at: Date.now(), tracks, version: tasteVersion() });
  const all = readJSON(SHOWN_KEY, {});
  const mine = shownMap(key);
  const now = Date.now();
  tracks.forEach((t) => { if (t?.id) mine[t.id] = now; });
  all[key] = Object.fromEntries(Object.entries(mine).sort((a, b) => b[1] - a[1]).slice(0, SHOWN_MAX));
  writeJSON(SHOWN_KEY, all);
  return tracks;
}

// `want` songs: never-shown ones first (in their own order), then the longest-unseen
function preferUnseen(key, tracks, want) {
  const shown = shownMap(key);
  const unseen = tracks.filter((t) => !shown[t.id]);
  if (unseen.length >= want) return unseen.slice(0, want);
  const seen = tracks.filter((t) => shown[t.id]).sort((a, b) => shown[a.id] - shown[b.id]);
  return [...unseen, ...seen].slice(0, want);
}

const seedHistory = (key) => readJSON(SEEDS_KEY, {})[key] || [];
function rememberSeeds(key, chosen) {
  const all = readJSON(SEEDS_KEY, {});
  all[key] = [...(all[key] || []), chosen].slice(-4);
  writeJSON(SEEDS_KEY, all);
}

// A page of a chart (Trending, a language's chart): each Sync shows the chart songs this list
// showed longest ago (never-shown first), in chart rank order (top hits first); opening again within
// the hour shows the same. The phone's larger chart pool keeps pages changing.
export async function chartPage(kind, count, { fresh = false } = {}) {
  const key = `chartpage:${kind}`;
  const reuse = recentList(key, fresh);
  if (reuse) return reuse;
  const chart = await chartSongs(kind, { fresh: false });
  if (chart.length < count) return [];
  const rank = new Map(chart.map((t, i) => [t.id, i]));
  const candidates = preferUnseen(key, chart, Math.min(chart.length, Math.round(count * 1.6)))
    .sort((a, b) => rank.get(a.id) - rank.get(b.id));
  return showList(key, pickChartSongs(candidates, count).sort((a, b) => rank.get(a.id) - rank.get(b.id)));
}

// Personal mix: songs that the radios of the listener's favourites (from every side of their
// taste) agree on, ranked by fit (see recommend.forYou)
export async function forYouSongs({ history = [], liked = [], fallbackSeeds = [], count = 25, fresh = false }) {
  const key = `foryou:${count}`;
  const reuse = recentList(key, fresh);
  if (reuse) return reuse;
  seedFromLibrary({ liked, history });
  const list = await forYou((track) => relatedSongs(track, { fresh }), {
    count: count * 4,
    recent: recentlyPlayedIds(),
    fallback: () => mixSongs("foryou", fallbackSeeds, { count: count * 2, fresh }),
  });
  // Songs this list hasn't shown lately first, so each round brings new picks
  return showList(key, preferUnseen(key, freshen(list, count * 4), count));
}
