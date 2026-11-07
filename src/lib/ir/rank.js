// Ranking: BM25 relevance over song fields, rank fusion of several result lists, quality priors,
// near-duplicate collapsing, cosine similarity on sparse vectors and diversity (MMR).
import { tokenize, termMatch, parseTitle, songKey, STOPWORDS } from "./text.js";

// ─── BM25 (Okapi) over weighted fields, computed on the candidate set ───
// Album names matter less: a cover released as a single titled "Munbe Vaa" must not outrank
// the film song just because its album repeats the title
const FIELDS = { title: 3, artist: 2, album: 0.5 };
const K1 = 1.2;
const B = 0.6;

const fieldTokens = (track) => ({
  title: tokenize(parseTitle(track.title).song + " " + (parseTitle(track.title).film || "")),
  artist: tokenize(track.artist || ""),
  album: tokenize(track.album || ""),
});

export function bm25Scores(queryTokens, tracks) {
  const terms = [...new Set(queryTokens.filter((t) => !STOPWORDS.has(t)))];
  if (!terms.length) return tracks.map(() => 0);
  const docs = tracks.map(fieldTokens);
  const lengths = docs.map((d) => Object.entries(FIELDS).reduce((n, [f, w]) => n + d[f].length * w, 0));
  const avg = lengths.reduce((a, b) => a + b, 0) / Math.max(1, lengths.length) || 1;
  const N = docs.length;

  // Weighted term frequency of each query term in each document (fuzzy matches count partly)
  const tf = docs.map((d) => terms.map((q) => {
    let f = 0;
    for (const [field, weight] of Object.entries(FIELDS)) {
      for (const t of d[field]) f += termMatch(q, t) * weight;
    }
    return f;
  }));
  const idf = terms.map((_, j) => {
    const n = tf.filter((row) => row[j] > 0).length;
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  });
  return tf.map((row, i) => row.reduce((score, f, j) => {
    if (!f) return score;
    return score + idf[j] * ((f * (K1 + 1)) / (f + K1 * (1 - B + B * (lengths[i] / avg))));
  }, 0));
}

// Share of the query's meaningful words found in the song (coverage, 0..1)
export function coverage(queryTokens, track) {
  const terms = [...new Set(queryTokens.filter((t) => !STOPWORDS.has(t)))];
  if (!terms.length) return 0;
  const d = fieldTokens(track);
  const all = [...d.title, ...d.artist, ...d.album];
  const matched = terms.reduce((n, q) => n + Math.max(0, ...all.map((t) => termMatch(q, t))), 0);
  return matched / terms.length;
}

// ─── Reciprocal rank fusion: merge result lists from different searches ───
export function reciprocalRankFusion(lists, k = 30) {
  const scores = new Map();
  const byId = new Map();
  lists.forEach(({ tracks, weight = 1 }) => {
    tracks.forEach((track, rank) => {
      if (!track?.id) return;
      scores.set(track.id, (scores.get(track.id) || 0) + weight / (k + rank + 1));
      if (!byId.has(track.id)) byId.set(track.id, track);
    });
  });
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, score]) => ({ track: byId.get(id), fused: score }));
}

// ─── Priors: versions nobody asked for, odd lengths ───
export function qualityPrior(track, { variants = [] } = {}) {
  let prior = 0;
  const parsed = parseTitle(track.title);
  for (const v of parsed.variants) {
    if (!variants.includes(v)) prior -= v === "instrumental" || v === "karaoke" ? 0.6 : 0.4;
  }
  const d = track.duration || 0;
  if (d && (d < 75 || d > 9 * 60)) prior -= 0.3;
  return prior;
}

// ─── Near-duplicate detection: one entry per song (keep the best-scored copy) ───
export function collapseDuplicates(scored) {
  const seen = new Set();
  return scored.filter(({ track }) => {
    const key = songKey(track);
    if (seen.has(key) || seen.has(track.id)) return false;
    seen.add(key);
    seen.add(track.id);
    return true;
  });
}

// ─── Vector space: cosine similarity of sparse vectors ({ feature: weight }) ───
export function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, v] of Object.entries(a)) {
    na += v * v;
    if (b[k]) dot += v * b[k];
  }
  for (const v of Object.values(b)) nb += v * v;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// ─── Maximal Marginal Relevance: relevant but not five songs in a row by one artist ───
export function diversify(scored, { lambda = 0.75, count = 25, features }) {
  const pool = [...scored];
  const picked = [];
  while (picked.length < count && pool.length) {
    let best = 0;
    let bestValue = -Infinity;
    pool.forEach((item, i) => {
      const redundancy = picked.length
        ? Math.max(...picked.slice(-6).map((p) => cosine(features(item.track), features(p.track))))
        : 0;
      const value = lambda * item.score - (1 - lambda) * redundancy;
      if (value > bestValue) { bestValue = value; best = i; }
    });
    picked.push(pool.splice(best, 1)[0]);
  }
  return picked;
}
