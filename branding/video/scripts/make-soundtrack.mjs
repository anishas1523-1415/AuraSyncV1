// Original soundtrack for the AuraSynq promo, synthesised from scratch (no samples, no licences
// needed). 100 BPM, A minor (Am - F - C - G), ~60 s: pad intro, groove, pad outro.
// Usage: node scripts/make-soundtrack.mjs [seconds] > writes public/soundtrack.wav
import { writeFileSync, mkdirSync } from "node:fs";

const SECONDS = Number(process.argv[2]) || 60;
const RATE = 44100;
const N = Math.floor(SECONDS * RATE);
const BPM = 100;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const L = new Float32Array(N);
const R = new Float32Array(N);

const midi = (m) => 440 * 2 ** ((m - 69) / 12);
// Am, F, C, G voicings (MIDI) and their roots
const CHORDS = [
  { notes: [57, 60, 64, 69], root: 45 },
  { notes: [53, 57, 60, 65], root: 41 },
  { notes: [55, 60, 64, 67], root: 48 },
  { notes: [55, 59, 62, 67], root: 43 },
];
const chordAt = (t) => CHORDS[Math.floor(t / BAR) % CHORDS.length];

// Sections
const INTRO_END = BAR * 3;            // pads only
const GROOVE_END = SECONDS - BAR * 2; // full groove until the outro
const smooth = (x) => Math.min(1, Math.max(0, x)) ** 2 * (3 - 2 * Math.min(1, Math.max(0, x)));

// ─── Pad: detuned saws through a slowly opening low-pass ───
{
  let lpL = 0, lpR = 0;
  const phases = new Map();
  for (let i = 0; i < N; i++) {
    const t = i / RATE;
    const chord = chordAt(t);
    const inBar = (t % BAR) / BAR;
    const swell = Math.min(1, inBar * 6) * (1 - smooth((inBar - 0.85) / 0.15) * 0.35);
    let sl = 0, sr = 0;
    chord.notes.forEach((note, n) => {
      [-0.08, 0.08].forEach((detune, d) => {
        const key = `${n}${d}`;
        const f = midi(note + detune);
        const ph = ((phases.get(key) || 0) + f / RATE) % 1;
        phases.set(key, ph);
        const saw = 2 * ph - 1;
        if (d === 0) sl += saw; else sr += saw;
      });
    });
    const open = 0.02 + 0.05 * smooth(t / (INTRO_END + BAR)) + 0.015 * Math.sin(t * 0.7);
    lpL += open * (sl - lpL);
    lpR += open * (sr - lpR);
    const fadeIn = smooth(t / 4);
    const fadeOut = 1 - smooth((t - (SECONDS - 4)) / 4);
    L[i] += lpL * 0.055 * swell * fadeIn * fadeOut;
    R[i] += lpR * 0.055 * swell * fadeIn * fadeOut;
  }
}

// Sidechain-style ducking on each beat during the groove
const duck = (t) => {
  if (t < INTRO_END || t > GROOVE_END) return 1;
  const sinceBeat = t % BEAT;
  return 0.55 + 0.45 * Math.min(1, sinceBeat / 0.22);
};

// ─── Sub bass: root notes on eighths ───
{
  let ph = 0;
  for (let i = 0; i < N; i++) {
    const t = i / RATE;
    if (t < INTRO_END || t > GROOVE_END) continue;
    const f = midi(chordAt(t).root - 12);
    ph = (ph + f / RATE) % 1;
    const step = (t % (BEAT / 2)) / (BEAT / 2);
    const env = Math.exp(-step * 3) * 0.9 + 0.1;
    const v = Math.sin(2 * Math.PI * ph) * 0.22 * env * duck(t);
    L[i] += v; R[i] += v;
  }
}

// ─── Drums ───
const addHit = (start, length, fn) => {
  const s = Math.floor(start * RATE);
  for (let k = 0; k < length * RATE && s + k < N; k++) {
    const [l, r] = fn(k / RATE);
    L[s + k] += l; R[s + k] += r;
  }
};
let noiseSeed = 1;
const noise = () => ((noiseSeed = (noiseSeed * 16807) % 2147483647) / 2147483647) * 2 - 1;

for (let beat = 0; beat * BEAT < SECONDS; beat++) {
  const t0 = beat * BEAT;
  if (t0 < INTRO_END || t0 > GROOVE_END) continue;
  // Kick on every beat
  let kp = 0;
  addHit(t0, 0.4, (t) => {
    const f = 45 + 90 * Math.exp(-t * 28);
    kp += f / RATE;
    const v = Math.sin(2 * Math.PI * kp) * Math.exp(-t * 7) * 0.5;
    return [v, v];
  });
  // Clap on 2 and 4
  if (beat % 2 === 1) {
    let bp = 0;
    addHit(t0, 0.18, (t) => {
      const n = noise();
      bp += 0.35 * (n - bp);
      const v = (n - bp) * Math.exp(-t * 22) * 0.16;
      return [v * 0.9, v];
    });
  }
  // Hats on eighths, open-ish on the off-beat
  [0, 0.5].forEach((off, j) => {
    let hp = 0;
    addHit(t0 + off * BEAT, j ? 0.09 : 0.04, (t) => {
      const n = noise();
      const hi = n - hp;
      hp = n;
      const v = hi * Math.exp(-t * (j ? 40 : 80)) * 0.05;
      return [v * (j ? 0.7 : 1), v * (j ? 1 : 0.7)];
    });
  });
}

// ─── Arp pluck: sixteenth notes from the chord, with a stereo echo ───
{
  const sixteenth = BEAT / 4;
  const pattern = [0, 2, 1, 3, 2, 1, 3, 0];
  for (let k = 0; k * sixteenth < SECONDS; k++) {
    const t0 = k * sixteenth;
    if (t0 < INTRO_END - BAR || t0 > GROOVE_END + BAR) continue;
    const chord = chordAt(t0);
    const note = chord.notes[pattern[k % pattern.length]] + 12;
    const f = midi(note);
    const level = 0.06 * smooth((t0 - (INTRO_END - BAR)) / BAR);
    [0, 0.36, 0.72].forEach((delay, echo) => {
      let ph = 0;
      const gain = level * [1, 0.45, 0.2][echo];
      addHit(t0 + delay, 0.3, (t) => {
        ph = (ph + f / RATE) % 1;
        const tri = 1 - 4 * Math.abs(ph - 0.5);
        const v = tri * Math.exp(-t * 14) * gain;
        return echo === 1 ? [v * 0.3, v] : echo === 2 ? [v, v * 0.3] : [v, v];
      });
    });
  }
}

// ─── Riser into the groove ───
{
  let lp = 0;
  const start = INTRO_END - BAR;
  for (let i = Math.floor(start * RATE); i < INTRO_END * RATE && i < N; i++) {
    const t = i / RATE - start;
    const n = noise();
    lp += (0.02 + 0.3 * (t / BAR)) * (n - lp);
    const v = lp * 0.08 * (t / BAR) ** 2;
    L[i] += v; R[i] += v;
  }
}

// ─── Master: soft clip, normalise, 16-bit WAV ───
let peak = 0;
for (let i = 0; i < N; i++) {
  L[i] = Math.tanh(L[i] * 1.4);
  R[i] = Math.tanh(R[i] * 1.4);
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const gain = 0.89 / (peak || 1);
const data = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  data.writeInt16LE(Math.round(L[i] * gain * 32767), i * 4);
  data.writeInt16LE(Math.round(R[i] * gain * 32767), i * 4 + 2);
}
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + data.length, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(2, 22);
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 4, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(data.length, 40);
mkdirSync("public", { recursive: true });
writeFileSync("public/soundtrack.wav", Buffer.concat([header, data]));
console.log(`public/soundtrack.wav: ${SECONDS}s, 100 BPM`);
