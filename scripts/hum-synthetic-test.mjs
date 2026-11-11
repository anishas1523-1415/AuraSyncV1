// Hum search pipeline test on SYNTHETIC audio (run: node scripts/hum-synthetic-test.mjs [songs]).
//
// What it checks: that melody extraction from a full mix (melody + bass + chords + drums) and
// matching of hummed queries work end to end, under transposition, tempo change, off-key and wrong
// notes, whistling an octave up, short clips and background noise, and that hums of melodies NOT in
// the index are rejected.
//
// What it does NOT measure: real-world accuracy. Synthetic songs have one clean melody line and
// synthetic hums are cleaner than people. Real accuracy comes from HUM_SEARCH_BENCHMARK.md with
// real recordings only. Deterministic (seeded), so results are comparable between runs.
import { trackHum, trackMelody, midiToHz } from "../src/lib/melody/pitch.js";
import { referenceContour, queryContour, packContour, unpackContour } from "../src/lib/melody/contour.js";
import { searchMelody } from "../src/lib/melody/match.js";

const SR = 16000;
const SONGS = Number(process.argv[2] || 60);
const SONG_SECONDS = 50;

// Seeded random numbers (mulberry32)
let seed = 12345;
const rand = () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(rand() * list.length)];

// A melody: notes of a major or minor scale, mostly stepwise, phrases of 0.2–0.9 s notes
const SCALES = [[0, 2, 4, 5, 7, 9, 11], [0, 2, 3, 5, 7, 8, 10]];
function makeMelody(seconds) {
  const tonic = 55 + Math.floor(rand() * 12);
  const scale = pick(SCALES);
  const notes = [];
  let t = 0;
  let degree = 7;
  while (t < seconds) {
    const step = pick([-2, -1, -1, 0, 1, 1, 2, -3, 3, 4]);
    degree = Math.max(0, Math.min(14, degree + step));
    const pitch = tonic + scale[degree % 7] + 12 * Math.floor(degree / 7) - 7;
    const dur = pick([0.25, 0.25, 0.5, 0.5, 0.5, 0.75, 1]);
    const rest = rand() < 0.12 ? pick([0.25, 0.5]) : 0;
    notes.push({ start: t, dur, pitch });
    t += dur + rest;
  }
  return { tonic, notes };
}

// Render notes with a harmonic-rich voice (vibrato, soft attack)
function renderVoice(out, notes, { gain = 0.3, harmonics = 6, vibrato = 0.25, timeScale = 1, transpose = 0, offset = 0, detune = () => 0 } = {}) {
  for (const n of notes) {
    const start = Math.floor((n.start - offset) * timeScale * SR);
    const len = Math.floor(n.dur * timeScale * SR * 0.92);
    if (start + len < 0 || start >= out.length) continue;
    const pitch = n.pitch + transpose + detune(n);
    let phase = 0;
    for (let i = 0; i < len; i++) {
      const idx = start + i;
      if (idx < 0 || idx >= out.length) continue;
      const vib = vibrato * Math.sin((2 * Math.PI * 5.5 * i) / SR);
      const hz = midiToHz(pitch + vib);
      phase += (2 * Math.PI * hz) / SR;
      let s = 0;
      for (let h = 1; h <= harmonics; h++) s += Math.sin(phase * h) / h;
      const env = Math.min(1, i / (0.03 * SR)) * Math.min(1, (len - i) / (0.05 * SR));
      out[idx] += gain * env * s;
    }
  }
}

function renderSong(melody) {
  const out = new Float32Array(SONG_SECONDS * SR);
  renderVoice(out, melody.notes, { gain: 0.35 });
  // Accompaniment: bass on the tonic/fifth, a sustained chord, kick and hi-hat noise
  const chordRoots = [0, 5, 7, 9];
  for (let bar = 0; bar < SONG_SECONDS / 2; bar++) {
    const root = melody.tonic - 12 + pick(chordRoots);
    const start = bar * 2 * SR;
    for (let i = 0; i < 2 * SR && start + i < out.length; i++) {
      const t = i / SR;
      out[start + i] += 0.25 * Math.sin(2 * Math.PI * midiToHz(root - 12) * t);
      for (const iv of [0, 4, 7]) out[start + i] += 0.05 * Math.sin(2 * Math.PI * midiToHz(root + iv) * t);
      const beat = t % 0.5;
      if (beat < 0.05) out[start + i] += 0.3 * Math.sin(2 * Math.PI * 60 * beat) * (1 - beat / 0.05);
      if (Math.abs(beat - 0.25) < 0.02) out[start + i] += 0.08 * (rand() * 2 - 1);
    }
  }
  return out;
}

const addNoise = (out, level) => { for (let i = 0; i < out.length; i++) out[i] += level * (rand() * 2 - 1); };

// A hummed query of melody notes between [from, from+seconds)
function renderHum(melody, from, seconds, kind) {
  const notes = melody.notes.filter((n) => n.start >= from && n.start + n.dur <= from + seconds);
  const tempo = kind === "tempo" ? pick([0.8, 0.85, 1.18, 1.25]) : 0.92 + rand() * 0.16;
  const out = new Float32Array(Math.ceil(seconds * tempo * SR) + SR / 2);
  let transpose = Math.round(rand() * 10 - 5);
  let harmonics = 3;
  let detune = () => (rand() - 0.5) * 0.3;
  if (kind === "whistle") { transpose += 12 + (rand() < 0.5 ? 12 : 0); harmonics = 1; }
  if (kind === "octave") transpose -= 12;
  if (kind === "offkey") detune = () => (rand() - 0.5) * 0.9 + (rand() < 0.15 ? pick([-2, 2]) : 0);
  renderVoice(out, notes, { gain: 0.4, harmonics, vibrato: 0.15, timeScale: tempo, transpose, offset: from, detune });
  if (kind === "noise") addNoise(out, 0.2);
  else addNoise(out, 0.01);
  return out;
}

// ─── Build the index ───
let t0 = Date.now();
const melodies = [];
const references = [];
let extractMs = 0;
for (let i = 0; i < SONGS; i++) {
  const melody = makeMelody(SONG_SECONDS);
  melodies.push(melody);
  const audio = renderSong(melody);
  const s = Date.now();
  const contour = referenceContour(trackMelody(audio, SR));
  extractMs += Date.now() - s;
  // stored packed, as on the phone
  references.push({ id: `song${i}`, contour: unpackContour(packContour(contour)) });
}
// Melodies that are NOT in the index, for false positives
const strangers = Array.from({ length: Math.max(10, Math.round(SONGS / 3)) }, () => makeMelody(SONG_SECONDS));
console.log(`index: ${SONGS} synthetic songs x ${SONG_SECONDS}s, melody extraction ${Math.round(extractMs / SONGS)} ms/song, built in ${Date.now() - t0} ms`);

// Reference extraction sanity: share of frames within a semitone of the true melody (octave-folded)
let agree = 0;
let total = 0;
melodies.slice(0, 10).forEach((m, i) => {
  const c = references[i].contour;
  for (let f = 0; f < c.length; f++) {
    const t = f / 10;
    const note = m.notes.find((n) => t >= n.start + 0.05 && t < n.start + n.dur - 0.05);
    if (!note || Number.isNaN(c[f])) continue;
    total++;
    const d = Math.abs(c[f] - note.pitch) % 12;
    if (Math.min(d, 12 - d) <= 1) agree++;
  }
});
console.log(`melody extraction agreement with the true melody: ${(100 * agree / Math.max(1, total)).toFixed(0)}% of voiced frames (octave-folded)`);

// ─── Queries ───
const KINDS = [
  ["clean hum (8 s)", "clean", 8],
  ["transposed + tempo ±20%", "tempo", 8],
  ["off-key, wrong notes", "offkey", 8],
  ["whistled, octave(s) up", "whistle", 8],
  ["an octave down", "octave", 8],
  ["short (4 s)", "clean", 4],
  ["background noise", "noise", 8],
];
const perKind = Math.max(10, Math.round(SONGS / 2));
let all = { n: 0, top1: 0, top3: 0, none: 0, ms: [] };
const reasons = {};
for (const [label, kind, seconds] of KINDS) {
  const r = { n: 0, top1: 0, top3: 0, none: 0, ms: [] };
  for (let k = 0; k < perKind; k++) {
    const i = Math.floor(rand() * SONGS);
    const from = 2 + rand() * (SONG_SECONDS - seconds - 4);
    const hum = renderHum(melodies[i], from, seconds, kind);
    const s = Date.now();
    const query = queryContour(trackHum(hum, SR));
    const res = searchMelody(query, references);
    r.ms.push(Date.now() - s);
    r.n++;
    const ids = res.matches.map((m) => m.id);
    if (!ids.length) {
      r.none++;
      // why it was rejected, and whether the right song was the closest anyway
      const right = res.closest?.[0]?.id === `song${i}`;
      const key = `${res.reason}${right ? " (right song was closest)" : ""}`;
      reasons[key] = (reasons[key] || 0) + 1;
    }
    if (ids[0] === `song${i}`) r.top1++;
    if (ids.slice(0, 3).includes(`song${i}`)) r.top3++;
  }
  r.ms.sort((a, b) => a - b);
  console.log(`${label.padEnd(26)} top1 ${(r.top1 / r.n).toFixed(2)}  top3 ${(r.top3 / r.n).toFixed(2)}  no-match ${(r.none / r.n).toFixed(2)}  median ${r.ms[r.ms.length >> 1]} ms  (n=${r.n})`);
  for (const k of ["n", "top1", "top3", "none"]) all[k] += r[k];
  all.ms.push(...r.ms);
}
all.ms.sort((a, b) => a - b);
console.log(`${"ALL indexed".padEnd(26)} top1 ${(all.top1 / all.n).toFixed(2)}  top3 ${(all.top3 / all.n).toFixed(2)}  no-match ${(all.none / all.n).toFixed(2)}  median ${all.ms[all.ms.length >> 1]} ms, p95 ${all.ms[Math.floor(all.ms.length * 0.95)]} ms`);

console.log(`  why indexed songs came back empty: ${JSON.stringify(reasons)}`);

// False positives: hums of melodies the index doesn't have must come back empty
let fp = 0;
const accepted = [];
for (const m of strangers) {
  const hum = renderHum(m, 5, 8, "clean");
  const res = searchMelody(queryContour(trackHum(hum, SR)), references);
  if (res.matches.length) {
    fp++;
    accepted.push(`cost ${res.matches[0].cost.toFixed(2)} z ${res.matches[0].z.toFixed(1)}`);
  }
}
if (accepted.length) console.log(`  wrongly accepted unknown melodies: ${accepted.join("; ")}`);
console.log(`${"NOT in index (should reject)".padEnd(26)} false-positive rate ${(fp / strangers.length).toFixed(2)}  (n=${strangers.length})`);
console.log("\nSynthetic audio: checks the pipeline, not real-world accuracy (see HUM_SEARCH_BENCHMARK.md).");
