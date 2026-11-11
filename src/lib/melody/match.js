// Query by humming: find the songs whose melody contains the hummed one.
//
// Invariances
//   key / octave   the key shift between hum and song is estimated as the circular mean of note
//                  differences, and differences are folded into one octave, so humming lower, higher,
//                  or an octave off (whistling) costs nothing
//   tempo          the query is compared against reference stretches 0.8–1.25× its length, and DTW
//                  absorbs uneven timing inside them
//   off-key notes  per-frame cost is capped, so a few wrong notes don't sink a match
//   partial hums   the query may match anywhere inside a song (sliding windows / subsequence DTW)
//
// Two stages: a coarse pass over every song (24-point shape of each window, cheap), then DTW on the
// best windows. Answers "no match" when the best score is poor or not clearly ahead.
import { CONTOUR_FPS, voicedShare } from "./contour.js";

const POINTS = 24;
const TEMPOS = [0.8, 0.9, 1, 1.12, 1.25];
const COARSE_STEP = 5; // frames (0.5 s)
const COARSE_KEEP_DEFAULT = 60;
const PER_SONG_DEFAULT = 3;
const CAP = 3; // semitones: a note further off than this costs the same as this
const SHIFTS = [-1.5, -1, -0.5, 0, 0.5, 1, 1.5]; // key refinement around the coarse estimate

// Distance between two pitches with octave errors forgiven (0..6 semitones)
export const folded = (d) => {
  const x = Math.abs(d) % 12;
  return x > 6 ? 12 - x : x;
};

const finite = (v) => !Number.isNaN(v);

// POINTS evenly spaced values of contour[start, start+length), NaN where there's no melody
function sample(contour, start, length, out) {
  for (let i = 0; i < POINTS; i++) out[i] = contour[Math.min(contour.length - 1, Math.floor(start + (i * length) / POINTS))];
  return out;
}

// The key shift between two aligned shapes: the circular mean of their note-by-note differences
// (on a 12-semitone circle, so octave jumps in either melody don't pull it off). Returns semitones.
function circularShift(q, r) {
  let x = 0;
  let y = 0;
  for (let i = 0; i < POINTS; i++) {
    if (!finite(q[i]) || !finite(r[i])) continue;
    const a = ((q[i] - r[i]) * Math.PI) / 6;
    x += Math.cos(a);
    y += Math.sin(a);
  }
  return (Math.atan2(y, x) * 6) / Math.PI;
}

// Coarse distance of two POINTS-long shapes under their best key shift; { d, shift }
function shapeDistance(q, r) {
  const shift = circularShift(q, r);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < POINTS; i++) {
    if (!finite(q[i]) || !finite(r[i])) continue;
    sum += Math.min(CAP, folded(q[i] - r[i] - shift));
    n++;
  }
  return { d: n >= POINTS * 0.6 ? sum / n : Infinity, shift };
}

// Subsequence DTW: the whole query against any stretch of `ref`; pitch shift `shift` already found.
// Returns the average per-step cost of the best path.
function subsequenceDTW(q, ref, shift) {
  const n = q.length;
  const m = ref.length;
  const GAP = 0.6; // cost of a frame where one side has no melody
  let prev = new Float32Array(m + 1).fill(0); // free start anywhere in the reference
  let prevLen = new Float32Array(m + 1).fill(0);
  let cur = new Float32Array(m + 1);
  let curLen = new Float32Array(m + 1);
  for (let i = 1; i <= n; i++) {
    cur[0] = Infinity;
    curLen[0] = 0;
    for (let j = 1; j <= m; j++) {
      const a = q[i - 1];
      const b = ref[j - 1];
      const cost = finite(a) && finite(b) ? Math.min(CAP, folded(a - b - shift)) : GAP;
      // steps: diagonal, query advances (ref held), ref advances (query held); stretched steps cost a bit more
      let best = prev[j - 1];
      let len = prevLen[j - 1];
      if (prev[j] + 0.3 < best) { best = prev[j] + 0.3; len = prevLen[j]; }
      if (cur[j - 1] + 0.3 < best) { best = cur[j - 1] + 0.3; len = curLen[j - 1]; }
      cur[j] = best + cost;
      curLen[j] = len + 1;
    }
    [prev, cur] = [cur, prev];
    [prevLen, curLen] = [curLen, prevLen];
  }
  let best = Infinity;
  for (let j = 1; j <= m; j++) if (prevLen[j] > 0) best = Math.min(best, prev[j] / Math.max(n, prevLen[j]));
  return best;
}

const medianOf = (values) => {
  const v = [...values].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

// references: [{ id, contour: Float32Array }] ; query: Float32Array contour (CONTOUR_FPS)
// Returns { matches: [{ id, cost, z, confidence, at }], reason, ms, closest? }. `matches` is empty,
// with a reason ("too-short" | "no-melody" | "no-candidate" | "no-match" | "ambiguous"), when there's
// no confident answer; `closest` then holds the near misses.
//
// Answering: the best song must cost at most `maxCost` and stand out from the rest of the field by
// `minZ` (see z below). An optional `sureCost` accepts very low costs outright; it's off by default
// because similar melodies can score that well too. Defaults were tuned on synthetic audio
// (scripts/hum-synthetic-test.mjs) and are to be re-tuned on real recordings.
// Experiments showed larger `coarseKeep` / `perSong` don't help, so the fast defaults stay.
export function searchMelody(query, references, { top = 5, maxCost = 0.65, sureCost = 0, minZ = 3, coarseKeep = COARSE_KEEP_DEFAULT, perSong = PER_SONG_DEFAULT } = {}) {
  const started = Date.now();
  const voiced = voicedShare(query);
  if (query.length < 3 * CONTOUR_FPS) return { matches: [], reason: "too-short", ms: 0 };
  if (voiced < 0.3) return { matches: [], reason: "no-melody", ms: 0 };

  // (Stretching the hum's intervals, for people who compress them, was tried on real hums
  // on 2026-11-11 and never helped, so it isn't done.)
  const bestBySong = new Map();
  matchQuery(query, references, { coarseKeep, perSong }, bestBySong);
  return decide(bestBySong, { top, maxCost, sureCost, minZ, started });
}

// Stages 1 and 2; the best cost per song goes into bestBySong
function matchQuery(query, references, { coarseKeep, perSong }, bestBySong) {
  // ─── Stage 1: coarse shapes ───
  const qShape = sample(query, 0, query.length, new Float32Array(POINTS));
  const rShape = new Float32Array(POINTS);
  const candidates = [];
  for (const ref of references) {
    const c = ref.contour;
    const found = [];
    for (const tempo of TEMPOS) {
      const length = Math.round(query.length * tempo);
      if (length > c.length) continue;
      for (let s = 0; s + length <= c.length; s += COARSE_STEP) {
        sample(c, s, length, rShape);
        let voicedPoints = 0;
        for (let i = 0; i < POINTS; i++) if (finite(rShape[i])) voicedPoints++;
        if (voicedPoints < POINTS * 0.6) continue;
        const { d, shift } = shapeDistance(qShape, rShape);
        if (d < Infinity) found.push({ ref, start: s, length, d, shift });
      }
    }
    found.sort((a, b) => a.d - b.d);
    // a few windows per song, not overlapping ones
    const kept = [];
    for (const w of found) {
      if (kept.length >= perSong) break;
      if (kept.some((k) => Math.abs(k.start - w.start) < w.length / 2)) continue;
      kept.push(w);
    }
    candidates.push(...kept);
  }
  candidates.sort((a, b) => a.d - b.d);
  const shortlist = candidates.slice(0, coarseKeep);

  // ─── Stage 2: DTW on the shortlist, with the pitch shift refined around the coarse estimate ───
  for (const w of shortlist) {
    const from = Math.max(0, w.start - Math.round(w.length * 0.15));
    const to = Math.min(w.ref.contour.length, w.start + Math.round(w.length * 1.15));
    const segment = w.ref.contour.subarray(from, to);
    // The coarse key estimate comes from 24 points and can be off by a semitone or more
    let cost = Infinity;
    for (const delta of SHIFTS) cost = Math.min(cost, subsequenceDTW(query, segment, w.shift + delta));
    const prev = bestBySong.get(w.ref.id);
    if (!prev || cost < prev.cost) bestBySong.set(w.ref.id, { id: w.ref.id, cost, at: w.start / CONTOUR_FPS });
  }
}

// Ranking, confidence and the answer, from the best cost per song
function decide(bestBySong, { top, maxCost, sureCost, minZ, started }) {
  const ranked = [...bestBySong.values()].sort((a, b) => a.cost - b.cost);
  const ms = Date.now() - started;
  if (!ranked.length) return { matches: [], reason: "no-candidate", ms };
  // How far each song stands out from the rest of the field for THIS query: a hard hum (off-key,
  // short) scores worse against every song, so raw cost alone can't tell a match from a near miss.
  // z = (median cost of the next songs - cost) / their spread (median absolute deviation).
  const field = ranked.slice(1, 11).map((r) => r.cost);
  const fieldMedian = field.length ? medianOf(field) : ranked[0].cost + 0.3;
  const spread = (field.length > 2 ? medianOf(field.map((c) => Math.abs(c - fieldMedian))) : 0.05) + 0.02;
  const scored = ranked.slice(0, top).map((r) => {
    const z = (fieldMedian - r.cost) / spread;
    return { ...r, z, confidence: Math.max(0, Math.min(1, (z - 1) / (minZ * 2))) };
  });
  const best = scored[0];
  if (best.cost > maxCost) return { matches: [], reason: "no-match", ms, closest: scored };
  if (best.cost > sureCost && best.z < minZ) return { matches: [], reason: "ambiguous", ms, closest: scored };
  return { matches: scored, reason: "ok", ms };
}
