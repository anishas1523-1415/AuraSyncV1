"use client";
// The listener model. Every listen is implicit relevance feedback: finishing or liking a song is
// a positive judgment, skipping it early a negative one. The taste profile is a Rocchio-style
// vector over song features (artists, language, mood, film), with older feedback fading out:
//   profile = sum(positive features * weight * decay) - gamma * sum(negative features * decay)
import { trackFeatures } from "./classify.js";
import { cosine } from "./rank.js";
import { pushSessionEvent, sessionVector, intentVector } from "./context.js";

const KEY = "aurasynq_taste";
const MAX_TRACKS = 400;
const HALF_LIFE_DAYS = 21;
const GAMMA = 0.6; // negatives count a bit less than positives (Rocchio's gamma < beta)

// Feedback weights per event
const WEIGHTS = { like: 3, unlike: -2, playlist: 2, complete: 1, play: 0.4, skip: -1 };

let state = null; // { tracks: { id: { title, artist, f, pos, neg, at, skips, completes } }, radio: {...} }
let profileCache = null;

const load = () => {
  if (state) return state;
  try {
    state = JSON.parse(localStorage.getItem(KEY) || "null");
  } catch (e) {}
  if (!state?.tracks) state = { tracks: {}, radio: { played: 0, skipped: 0 } };
  return state;
};
let saveTimer = null;
const save = () => {
  profileCache = null;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }, 400);
};

const decay = (at) => Math.pow(0.5, (Date.now() - at) / (HALF_LIFE_DAYS * 86400000));

// Record one feedback event for a song (kind: like | unlike | playlist | complete | play | skip)
export function recordFeedback(track, kind) {
  if (typeof window === "undefined" || !track?.id || !(kind in WEIGHTS)) return;
  const s = load();
  const entry = s.tracks[track.id] || {
    title: track.title, artist: track.artist, f: trackFeatures(track), pos: 0, neg: 0, skips: 0, completes: 0,
  };
  // Fade what was learned before, then add the new judgment
  const fade = entry.at ? decay(entry.at) : 1;
  entry.pos *= fade;
  entry.neg *= fade;
  const w = WEIGHTS[kind];
  if (w > 0) entry.pos += w;
  else entry.neg += -w;
  if (kind === "skip") entry.skips += 1;
  if (kind === "complete") entry.completes += 1;
  entry.at = Date.now();
  s.tracks[track.id] = entry;

  // Keep the most recent songs
  const ids = Object.keys(s.tracks);
  if (ids.length > MAX_TRACKS) {
    ids.sort((a, b) => s.tracks[a].at - s.tracks[b].at).slice(0, ids.length - MAX_TRACKS).forEach((id) => delete s.tracks[id]);
  }

  // The listening session: what they are into right now
  pushSessionEvent(s, { id: track.id, f: entry.f, w: WEIGHTS[kind], at: Date.now() });

  // Online evaluation of Aura Radio: precision = share of radio songs played through
  if (track.source === "radio" && (kind === "complete" || kind === "skip")) {
    s.radio[kind === "complete" ? "played" : "skipped"] += 1;
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
  state = { tracks: {}, radio: { played: 0, skipped: 0 } };
  save();
}
