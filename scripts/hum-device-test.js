// On-device hum search integration test. Runs INSIDE the app's WebView (over USB debugging):
//   node <cdp helper> -f scripts/hum-device-test.js
// For several indexed songs it synthesises a "perfect hummer" from the song's own stored melody
// (8 s from a random spot, transposed, slightly slower, with vibrato and noise) and checks hum search
// on the phone finds that song; then random melodies that must come back as no match.
// It tests the phone's pipeline end to end (index, pitch tracking, matching, latency), NOT how
// well real people hum: that needs real recordings (HUM_SEARCH_BENCHMARK.md).
const M = window.__auraMelody;
if (!M) return { error: "hum search module not loaded" };
const refs = await M.references();
if (!refs.length) return { error: "index empty" };
const SR = 16000;
let seed = 7;
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

function synthHum(contour, from, frames, { transpose = 3, tempo = 1.1, noise = 0.02 } = {}) {
  const out = new Float32Array(Math.ceil((frames / 10) * tempo * SR));
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR / tempo; // seconds into the original
    const f = from + Math.floor(t * 10);
    const m = contour[f];
    if (!Number.isNaN(m) && m > 0) {
      const vib = 0.15 * Math.sin(2 * Math.PI * 5 * (i / SR));
      phase += (2 * Math.PI * midiToHz(m + transpose + vib)) / SR;
      out[i] = 0.3 * (Math.sin(phase) + 0.4 * Math.sin(2 * phase) + 0.2 * Math.sin(3 * phase));
    }
    out[i] += noise * (rand() * 2 - 1);
  }
  return out;
}

const results = [];
const tried = refs.filter((r) => r.contour.length > 400).slice(0, 12);
for (const ref of tried) {
  // a stretch with plenty of melody
  let from = 0;
  for (let k = 0; k < 20; k++) {
    const s = Math.floor(rand() * (ref.contour.length - 100));
    let voiced = 0;
    for (let f = s; f < s + 80; f++) if (!Number.isNaN(ref.contour[f])) voiced++;
    if (voiced > 60) { from = s; break; }
  }
  const hum = synthHum(ref.contour, from, 80, { transpose: Math.round(rand() * 8 - 4), tempo: 0.9 + rand() * 0.25 });
  const t0 = performance.now();
  const res = await M.humSearch(hum);
  results.push({
    song: (ref.track?.title || ref.id).slice(0, 28),
    rank: res.tracks.findIndex((t) => t.id === ref.id) + 1 || "none",
    top: res.tracks[0]?.title?.slice(0, 24) || res.reason,
    ms: Math.round(performance.now() - t0),
  });
}

// Melodies not in the index: random scale walks
let falsePositives = 0;
const strangers = 8;
for (let k = 0; k < strangers; k++) {
  const contour = new Float32Array(100);
  let p = 60 + Math.floor(rand() * 10);
  for (let f = 0; f < 100; f++) {
    if (f % 4 === 0) p += [-2, -1, 0, 1, 2, 3, -3][Math.floor(rand() * 7)];
    contour[f] = f % 12 === 11 ? NaN : p;
  }
  const res = await M.humSearch(synthHum(contour, 0, 90, { transpose: 0, tempo: 1 }));
  if (res.tracks.length) falsePositives++;
}

const n = results.length;
return {
  indexed: refs.length,
  top1: `${results.filter((r) => r.rank === 1).length}/${n}`,
  top3: `${results.filter((r) => typeof r.rank === "number" && r.rank <= 3).length}/${n}`,
  noMatch: `${results.filter((r) => r.rank === "none").length}/${n}`,
  falsePositives: `${falsePositives}/${strangers}`,
  medianMs: results.map((r) => r.ms).sort((a, b) => a - b)[n >> 1],
  results,
};
