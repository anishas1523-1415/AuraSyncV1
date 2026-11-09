"use client";
// Recommendations: what to play next and what to put in personal mixes.
import { trackFeatures, classifyList } from "./classify.js";
import { cosine, diversify, collapseDuplicates } from "./rank.js";
import { getProfile, isRejected, tasteClusters, favouriteTracks } from "./profile.js";
import { regionalLanguages, regionalScore, trendScore, continuityScore } from "./signals.js";

// ─── Aura Radio: songs after the current one ───
// Candidates come from YouTube Music's radio for the current song (its collaborative filtering);
// each is re-scored by similarity to what's playing now (session context) and to the listener's
// taste, rejected songs are dropped, and runs of one artist are broken up (MMR).
export function rankRadio(candidates, { current, exclude = new Set(), count = 10, trending = null }) {
  const profile = getProfile();
  const languages = regionalLanguages(profile);
  const context = current ? trackFeatures(current) : {};
  classifyList(current ? [current, ...candidates] : candidates); // neighbour vote fills unknown languages
  const scored = candidates
    .filter((t) => t?.id && !exclude.has(t.id) && !isRejected(t))
    .map((track, rank) => {
      const f = trackFeatures(track);
      // YouTube Music's own order still counts; songs from the second (taste) list start lower
      const base = (track.fromAnchor ? 0.7 : 1) / (1 + (track.rankInList ?? rank) * 0.15);
      // Relevance to the song playing (features + mood/language continuity) comes first, then the
      // listener's taste, their region's language and what's trending
      const s = 0.3 * base + 0.35 * cosine(context, f) + continuityScore(current, track) +
        (profile ? 0.4 * cosine(profile, f) : 0) + 0.5 * regionalScore(track, languages) + trendScore(track, trending);
      return { track, score: s };
    })
    .sort((a, b) => b.score - a.score);
  return diversify(collapseDuplicates(scored), { lambda: 0.7, count, features: trackFeatures })
    .map(({ track }) => {
      const { fromAnchor, rankInList, ...clean } = track;
      return { ...clean, source: "radio" };
    });
}

// The listener's favourite song most like `current` (not `current` itself): its radio is a second
// candidate list, so the queue leans toward what they already love in this vibe
export function radioAnchor(current) {
  if (!current) return null;
  const context = trackFeatures(current);
  let best = null;
  let bestSim = 0.3;
  for (const fav of favouriteTracks(40)) {
    if (fav.id === current.id) continue;
    const sim = cosine(context, fav.f) * Math.min(1, fav.weight);
    if (sim > bestSim) { bestSim = sim; best = fav; }
  }
  return best && { id: best.id, title: best.title, artist: best.artist };
}

// Merge the current song's radio with the anchor's (marked, keeping each one's own rank)
export function mergeRadio(primary, anchorList = []) {
  const seen = new Set(primary.map((t) => t.id));
  return [
    ...primary.map((t, i) => ({ ...t, rankInList: i })),
    ...anchorList.filter((t) => !seen.has(t.id)).map((t, i) => ({ ...t, fromAnchor: true, rankInList: i })),
  ];
}

// ─── For You: HITS over the listener's favourite songs and their radios ───
// Seeds (hubs) are picked from every taste cluster, weighted by how much that side of the taste
// is played; a song recommended by several seeds' radios gets a high authority score.
export async function forYou(getRelated, { count = 25, recent = new Set(), fallback = async () => [] } = {}) {
  const clusters = tasteClusters(3);
  if (!clusters.length) return fallback();
  const seeds = [];
  clusters.forEach((cluster) => {
    const n = Math.max(1, Math.round(cluster.weight * 5));
    shuffleInPlace([...cluster.members].slice(0, 8)).slice(0, n)
      .forEach((m) => seeds.push({ ...m, hub: m.weight * cluster.weight }));
  });
  const lists = await Promise.allSettled(seeds.slice(0, 6).map((s) => getRelated({ id: s.id, title: s.title, artist: s.artist })));

  const authority = new Map();
  const byId = new Map();
  lists.forEach((result, i) => {
    if (result.status !== "fulfilled") return;
    result.value.forEach((track, rank) => {
      if (!track?.id) return;
      byId.set(track.id, track);
      authority.set(track.id, (authority.get(track.id) || 0) + seeds[i].hub / (5 + rank));
    });
  });
  const seedIds = new Set(seeds.map((s) => s.id));
  const maxAuth = Math.max(1e-9, ...authority.values());
  const profile = getProfile();
  const scored = [...authority.entries()]
    .filter(([id]) => !seedIds.has(id) && !recent.has(id))
    .map(([id, a]) => {
      const track = byId.get(id);
      if (isRejected(track)) return null;
      return { track, score: 0.6 * (a / maxAuth) + (profile ? 0.4 * cosine(profile, trackFeatures(track)) : 0) };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
  const picked = diversify(collapseDuplicates(scored), { lambda: 0.72, count, features: trackFeatures });
  return picked.length ? picked.map((p) => p.track) : fallback();
}

// ─── Mood/category mixes: relevant first, personal second, a little variety ───
export function personalize(tracks, { count = 25, trending = null } = {}) {
  const profile = getProfile();
  const languages = regionalLanguages(profile);
  classifyList(tracks);
  const scored = tracks.map((track, rank) => ({
    track,
    score: 0.5 / (1 + rank * 0.08) + (profile ? 0.4 * cosine(profile, trackFeatures(track)) : 0) +
      regionalScore(track, languages) + trendScore(track, trending) + Math.random() * 0.06,
  })).filter(({ track }) => !isRejected(track)).sort((a, b) => b.score - a.score);
  return diversify(scored, { lambda: 0.8, count, features: trackFeatures }).map((p) => p.track);
}

// Which seeds of a category suit the listener: language-specific seeds follow their languages
const SEED_LANGUAGES = ["tamil", "hindi", "telugu", "malayalam", "kannada", "english", "punjabi", "bollywood"];

export function pickSeeds(seeds, n) {
  const profile = getProfile();
  const weightOf = (seed) => {
    const named = SEED_LANGUAGES.find((l) => seed.toLowerCase().includes(l));
    if (!profile || !named) return 1 + Math.random();
    const lang = named === "bollywood" ? "hindi" : named;
    const fit = profile[`lang:${lang}`] || 0;
    // Their language: strongly preferred; a language they never play: rarely picked
    return (fit > 0.05 ? 1.5 + fit * 4 : 0.4) + Math.random();
  };
  return [...seeds].sort((a, b) => weightOf(b) - weightOf(a)).slice(0, n);
}

function shuffleInPlace(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// Queue for a song tapped in a list: that song first, then the rest of the list ordered by how
// close each is to it (features, mood and language continuity), the list's own order breaking ties
export function queueFrom(track, list = []) {
  if (!track) return list;
  const context = trackFeatures(track);
  const rest = list
    .filter((t) => t?.id && t.id !== track.id)
    .map((t, rank) => ({
      t,
      score: 0.6 * cosine(context, trackFeatures(t)) + continuityScore(track, t) + 0.25 / (1 + rank * 0.1),
    }))
    .sort((a, b) => b.score - a.score)
    .map(({ t }) => t);
  return [track, ...rest];
}
