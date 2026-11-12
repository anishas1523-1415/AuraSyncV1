"use client";
// The listener model. Every listen is implicit relevance feedback: finishing or liking a song is
// a positive judgment, skipping it early a negative one. The taste profile is a Rocchio-style
// vector over song features (artists, language, mood, film), with older feedback fading out:
//   profile = sum(positive features * weight * decay) - gamma * sum(negative features * decay)
import { trackFeatures } from "./classify.js";
import { cosine } from "./rank.js";
import { pushSessionEvent, sessionVector, intentVector } from "./context.js";
import { analyzeQuery } from "./query.js";

const KEY = "aurasynq_taste";
const MAX_TRACKS = 400;
const HALF_LIFE_DAYS = 21;
const GAMMA = 0.6; // negatives count a bit less than positives (Rocchio's gamma < beta)

// Feedback weights per event. Besides the obvious ones (like, playlist, played through, skipped):
//   search_play  picked from search results: they went looking for it
//   replay       played again (tapped again, restarted, or back within a day): a strong positive
//   queue        added to the queue by hand
//   lyrics       opened the lyrics while it played: engaged with the song
//   quick_skip   skipped within the first seconds: a clear "not this"
const WEIGHTS = {
  like: 3, unlike: -2, playlist: 2, complete: 1, play: 0.4, skip: -1,
  search_play: 1.2, replay: 1.5, queue: 1, lyrics: 0.6, quick_skip: -1.6,
};
const NEGATIVE = new Set(["skip", "quick_skip"]);

let state = null; // { tracks: { id: { title, artist, f, pos, neg, at, skips, completes, replays } }, radio, queries, seeds }
let profileCache = null;
let version = 0; // grows with every judgment: lists built before many new judgments are rebuilt

const load = () => {
  if (state) return state;
  try {
    state = JSON.parse(localStorage.getItem(KEY) || "null");
  } catch (e) {}
  if (!state?.tracks) state = { tracks: {}, radio: { played: 0, skipped: 0 } };
  return state;
};
let saveTimer = null;
const listeners = new Set();
// Lets the account sync hear about every change to what was learned, so it saves within seconds
export function subscribeTaste(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const save = () => {
  profileCache = null;
  version += 1;
  listeners.forEach((fn) => { try { fn(); } catch (e) {} });
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }, 400);
};

const decay = (at) => Math.pow(0.5, (Date.now() - at) / (HALF_LIFE_DAYS * 86400000));

// How many judgments have been recorded since the app started (lists use it to know when to refresh)
export const tasteVersion = () => version;

// Record one feedback event for a song (kind: see WEIGHTS). `scale` strengthens or weakens it, e.g.
// by how long the song was listened to.
export function recordFeedback(track, kind, { scale = 1 } = {}) {
  if (typeof window === "undefined" || !track?.id || !(kind in WEIGHTS)) return;
  const s = load();
  const entry = s.tracks[track.id] || {
    title: track.title, artist: track.artist, f: trackFeatures(track), pos: 0, neg: 0, skips: 0, completes: 0,
  };
  // Fade what was learned before, then add the new judgment
  const fade = entry.at ? decay(entry.at) : 1;
  entry.pos *= fade;
  entry.neg *= fade;
  const w = WEIGHTS[kind] * scale;
  if (w > 0) entry.pos += w;
  else entry.neg += -w;
  if (NEGATIVE.has(kind)) entry.skips += 1;
  if (kind === "complete") entry.completes += 1;
  if (kind === "replay") entry.replays = (entry.replays || 0) + 1;
  entry.at = Date.now();
  s.tracks[track.id] = entry;

  // Keep the most recent songs
  const ids = Object.keys(s.tracks);
  if (ids.length > MAX_TRACKS) {
    ids.sort((a, b) => s.tracks[a].at - s.tracks[b].at).slice(0, ids.length - MAX_TRACKS).forEach((id) => delete s.tracks[id]);
  }

  // The listening session: what they are into right now
  pushSessionEvent(s, { id: track.id, f: entry.f, w, at: Date.now() });

  // Online evaluation of Aura Radio: precision = share of radio songs played through
  if (track.source === "radio" && (kind === "complete" || NEGATIVE.has(kind))) {
    s.radio[kind === "complete" ? "played" : "skipped"] += 1;
  }
  // Which search behind a mix this song came from: mixes learn which of their searches this
  // listener actually enjoys (see seedWeight)
  if (track.seed && (kind === "complete" || kind === "play" || kind === "like" || NEGATIVE.has(kind))) {
    s.seeds = s.seeds || {};
    const stat = s.seeds[track.seed] || { pos: 0, neg: 0, at: 0 };
    const fade2 = stat.at ? decay(stat.at) : 1;
    stat.pos *= fade2;
    stat.neg *= fade2;
    if (w > 0) stat.pos += w; else stat.neg += -w;
    stat.at = Date.now();
    s.seeds[track.seed] = stat;
  }
  save();
}

// Seed the model from an existing library (likes and history), once
export function seedFromLibrary({ liked = [], history = [] }) {
  if (typeof window === "undefined") return;
  const s = load();
  if (s.seeded) return;
  liked.slice(0, 100).forEach((t) => recordFeedback(t, "like"));
  history.slice(0, 50).forEach((t) => !s.tracks[t.id] && recordFeedback(t, "play"));
  s.seeded = true;
  save();
}

// ─── Searches: what the listener asks for, even before they play anything ───
// "sad tamil songs" says tamil + sad; a searched name says that artist. Kept as a small decaying
// vector of features, added to the taste profile with a lower weight than actual listening.
const SEARCH_WEIGHT = 0.35;
export function recordSearch(raw) {
  if (typeof window === "undefined" || !raw?.trim()) return;
  const a = analyzeQuery(raw);
  const features = [
    ...(a.languages || []).map((l) => `lang:${l}`),
    ...(a.moods || []).map((m) => `mood:${m}`),
  ];
  // A bare name ("anirudh", "sid sriram") is most likely an artist or a song: as an artist feature
  // it only matters when songs by that artist exist, so a song title does no harm
  if (a.entity && a.intent !== "album") features.push(`artist:${a.entity}`);
  else if (a.intent === "song" && a.topic?.length && a.topic.length <= 3) features.push(`artist:${a.topic.join(" ")}`);
  if (!features.length) return;
  const s = load();
  // "anirudh" -> "artist:anirudh ravichander" when songs by that artist were heard
  const known = new Set(Object.values(s.tracks).flatMap((e) => Object.keys(e.f || {}).filter((k) => k.startsWith("artist:"))));
  for (let i = 0; i < features.length; i++) {
    if (!features[i].startsWith("artist:") || known.has(features[i])) continue;
    const full = [...known].find((k) => k.startsWith(`${features[i]} `));
    if (full) features[i] = full;
  }
  s.queries = s.queries || {};
  const now = Date.now();
  for (const k of new Set(features)) {
    const q = s.queries[k] || { w: 0, at: now };
    q.w = q.w * decay(q.at) + 1;
    q.at = now;
    s.queries[k] = q;
  }
  const keys = Object.keys(s.queries);
  if (keys.length > 60) {
    const strength = (k) => s.queries[k].w * decay(s.queries[k].at);
    keys.sort((x, y) => strength(y) - strength(x)).slice(60).forEach((k) => delete s.queries[k]);
  }
  save();
}

// How much one of a mix's searches has worked for this listener (0.3 .. 3; 1 when unknown)
export function seedWeight(seed) {
  const stat = load().seeds?.[seed];
  if (!stat) return 1;
  const d = decay(stat.at);
  return Math.max(0.3, Math.min(3, (1 + stat.pos * d) / (1 + stat.neg * d)));
}

// The Rocchio taste vector (sparse { feature: weight }), normalised
export function getProfile() {
  if (typeof window === "undefined") return null;
  if (profileCache) return profileCache;
  const s = load();
  const vector = {};
  for (const entry of Object.values(s.tracks)) {
    const d = decay(entry.at);
    const w = (entry.pos - GAMMA * entry.neg) * d;
    if (!w) continue;
    for (const [k, v] of Object.entries(entry.f || {})) vector[k] = (vector[k] || 0) + w * v;
  }
  // What they search for counts too, scaled to the listening part so it can't drown it out
  const queries = Object.entries(s.queries || {});
  if (queries.length) {
    const listenNorm = Math.sqrt(Object.values(vector).reduce((n, v) => n + v * v, 0)) || 1;
    const qNorm = Math.sqrt(queries.reduce((n, [, q]) => n + (q.w * decay(q.at)) ** 2, 0)) || 1;
    for (const [k, q] of queries) {
      vector[k] = (vector[k] || 0) + SEARCH_WEIGHT * listenNorm * (q.w * decay(q.at)) / qNorm;
    }
  }
  const norm = Math.sqrt(Object.values(vector).reduce((n, v) => n + v * v, 0));
  if (!norm) return null;
  profileCache = Object.fromEntries(Object.entries(vector).map(([k, v]) => [k, v / norm]));
  return profileCache;
}

// The current session's vector (last songs heard, newest first in weight), or null
export function getSession() {
  if (typeof window === "undefined") return null;
  return sessionVector(load());
}

// Long-term taste + this session + time of day: what suits the listener right now
export function getIntent() {
  if (typeof window === "undefined") return null;
  const profile = getProfile();
  const session = getSession();
  return profile || session ? intentVector(profile, session) : null;
}

// How well a song fits the listener (-1..1)
export function affinity(track, profile = getProfile()) {
  return profile ? cosine(profile, trackFeatures(track)) : 0;
}

// How many songs the listener has judged (how well the app knows them)
export function judgedCount() {
  if (typeof window === "undefined") return 0;
  return Object.keys(load().tracks).length;
}

// When a song was last judged and whether the listener liked what they heard (null if never)
export function lastJudged(id) {
  if (typeof window === "undefined") return null;
  const entry = load().tracks[id];
  return entry ? { at: entry.at, positive: entry.pos > entry.neg } : null;
}

// Songs the listener keeps skipping and never finishes: keep them out of autoplay
export function isRejected(track) {
  const entry = load().tracks[track?.id];
  return !!entry && entry.skips >= 2 && entry.completes === 0 && entry.neg > entry.pos;
}

// Songs the listener clearly likes, strongest first (seeds for recommendations)
export function favouriteTracks(limit = 30) {
  const s = load();
  return Object.entries(s.tracks)
    .map(([id, e]) => ({ id, title: e.title, artist: e.artist, f: e.f, weight: (e.pos - GAMMA * e.neg) * decay(e.at) }))
    .filter((t) => t.weight > 0.3)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit);
}

// ─── Taste clusters: flat k-means (cosine) over the favourite songs ───
// Someone who plays both Tamil melodies and English workout tracks gets one cluster for each,
// so personal mixes cover every side of their taste instead of the loudest one.
export function tasteClusters(maxK = 3) {
  const items = favouriteTracks(60);
  if (items.length < 4) return items.length ? [{ centroid: centroidOf(items), members: items, weight: 1 }] : [];
  const k = Math.min(maxK, Math.ceil(items.length / 6));
  // Farthest-point initialisation
  const centroids = [items[0].f];
  while (centroids.length < k) {
    const next = items.reduce((best, item) => {
      const d = 1 - Math.max(...centroids.map((c) => cosine(c, item.f)));
      return d > best.d ? { d, item } : best;
    }, { d: -1, item: null });
    centroids.push(next.item.f);
  }
  let groups = [];
  for (let iter = 0; iter < 8; iter++) {
    groups = centroids.map(() => []);
    items.forEach((item) => {
      let best = 0;
      centroids.forEach((c, i) => { if (cosine(c, item.f) > cosine(centroids[best], item.f)) best = i; });
      groups[best].push(item);
    });
    groups.forEach((g, i) => { if (g.length) centroids[i] = centroidOf(g); });
  }
  const total = items.reduce((n, t) => n + t.weight, 0) || 1;
  return groups
    .filter((g) => g.length)
    .map((members) => ({ centroid: centroidOf(members), members, weight: members.reduce((n, t) => n + t.weight, 0) / total }))
    .sort((a, b) => b.weight - a.weight);
}

function centroidOf(items) {
  const c = {};
  items.forEach((item) => Object.entries(item.f || {}).forEach(([k, v]) => { c[k] = (c[k] || 0) + v * (item.weight || 1); }));
  return c;
}

// Human summary of the profile: top languages, moods and artists
export function tasteSummary() {
  const profile = getProfile() || {};
  const top = (prefix, n) => Object.entries(profile)
    .filter(([k, v]) => k.startsWith(prefix) && v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => ({ name: k.slice(prefix.length), weight: v }));
  const s = load();
  const judged = s.radio.played + s.radio.skipped;
  return {
    languages: top("lang:", 3),
    moods: top("mood:", 3),
    artists: top("artist:", 5),
    radioPrecision: judged >= 5 ? s.radio.played / judged : null,
    radioJudged: judged,
  };
}

export function resetTaste() {
  state = { tracks: {}, radio: { played: 0, skipped: 0 }, queries: {}, seeds: {} };
  save();
}

// ─── Saving the taste profile to the listener's account ───
// What the app learned (per-song feedback and Aura Radio's accuracy) follows the account to every
// device. Merging keeps, for each song, whichever device judged it most recently; Aura Radio's
// counters only grow, so the larger value wins. The short-lived session is never synced.

const stableString = (v) => JSON.stringify(v);

export function mergeTasteState(a, b) {
  const A = a?.tracks ? a : { tracks: {}, radio: { played: 0, skipped: 0 } };
  const B = b?.tracks ? b : { tracks: {}, radio: { played: 0, skipped: 0 } };
  const tracks = { ...A.tracks };
  for (const [id, entry] of Object.entries(B.tracks)) {
    const mine = tracks[id];
    const newer = !mine || (entry.at || 0) > (mine.at || 0) ||
      ((entry.at || 0) === (mine.at || 0) && stableString(entry) > stableString(mine));
    if (newer) tracks[id] = entry;
  }
  const ids = Object.keys(tracks);
  if (ids.length > MAX_TRACKS) {
    ids.sort((x, y) => (tracks[y].at || 0) - (tracks[x].at || 0)).slice(MAX_TRACKS).forEach((id) => delete tracks[id]);
  }
  // Searches and mix seeds: per key, the most recently updated wins
  const newest = (x = {}, y = {}) => {
    const out = { ...x };
    for (const [k, v] of Object.entries(y)) if (!out[k] || (v.at || 0) > (out[k].at || 0)) out[k] = v;
    return out;
  };
  return {
    tracks,
    queries: newest(A.queries, B.queries),
    seeds: newest(A.seeds, B.seeds),
    radio: {
      played: Math.max(A.radio?.played || 0, B.radio?.played || 0),
      skipped: Math.max(A.radio?.skipped || 0, B.radio?.skipped || 0),
    },
    seeded: !!(A.seeded || B.seeded),
  };
}

export function exportTaste() {
  if (typeof window === "undefined") return { tracks: {}, radio: { played: 0, skipped: 0 }, seeded: false };
  const s = load();
  return { tracks: s.tracks, radio: s.radio, seeded: !!s.seeded, queries: s.queries || {}, seeds: s.seeds || {} };
}

export function applyTaste(merged) {
  if (typeof window === "undefined") return;
  const s = load();
  s.tracks = merged.tracks;
  s.radio = merged.radio;
  s.seeded = merged.seeded;
  s.queries = merged.queries || {};
  s.seeds = merged.seeds || {};
  save();
}
