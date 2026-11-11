// Hum search benchmark on REAL recordings (run: node scripts/hum-benchmark.mjs).
//
// 1. Export the phone's index:  node scripts/hum-export-index.mjs   -> bench/hum/index.json
// 2. Put recordings in bench/hum/clips/<category>/<videoId>__<anything>.wav
//      category: tamil, hindi, malayalam, telugu, english, old, regional, offkey, whistle, short, noise
//      videoId:  the song's YouTube id as listed by the export (11 characters), or "none" for a hum
//                of a song that is NOT on the phone (measures false positives)
//    WAV, 16-bit PCM or 32-bit float, any sample rate, mono or stereo. Phone recordings (m4a) can be
//    converted with: ffmpeg -i in.m4a -ac 1 -ar 16000 out.wav
// 3. Run this script. It uses exactly the app's pitch tracker and matcher.
//
// Hum Lab exports (/humlab in the app or website) work as they are: copy the exported files into
// bench/hum/clips/humlab/. Each take's JSON label (song, segment, kind of take, voice, language,
// decade) is read automatically; results are then also broken down by those, and "right part"
// checks the match landed within 15 s of the segment that was hummed.
// A take of a song the phone hasn't learned counts as "not in index" (false-positive test).
//
// Recordings stay on this computer: bench/ is git-ignored. Nothing is uploaded.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { trackHum } from "../src/lib/melody/pitch.js";
import { queryContour } from "../src/lib/melody/contour.js";
import { searchMelody } from "../src/lib/melody/match.js";

const ROOT = process.env.HUM_BENCH_DIR || "bench/hum";
const SR = 16000;
if (!existsSync(`${ROOT}/index.json`)) {
  console.log("No index: run node scripts/hum-export-index.mjs with the phone connected first.");
  process.exit(1);
}
const index = JSON.parse(readFileSync(`${ROOT}/index.json`, "utf8"));
const references = index.songs.map((s) => ({ id: s.id, contour: Float32Array.from(s.contour, (v) => (v === null ? NaN : v)) }));
const titles = new Map(index.songs.map((s) => [s.id, `${s.track?.title} — ${s.track?.artist}`]));

// Minimal WAV reader: PCM 16-bit or float 32-bit, downmixed to mono, resampled to 16 kHz
function readWav(path) {
  const buf = readFileSync(path);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("not a WAV file");
  let pos = 12;
  let fmt = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === "fmt ") {
      fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    } else if (id === "data" && fmt) {
      const bytes = fmt.bits / 8;
      const frames = Math.floor(size / (bytes * fmt.channels));
      const mono = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let s = 0;
        for (let c = 0; c < fmt.channels; c++) {
          const at = body + (i * fmt.channels + c) * bytes;
          s += fmt.format === 3 ? buf.readFloatLE(at) : bytes === 2 ? buf.readInt16LE(at) / 32768 : buf.readInt32LE(at) / 2147483648;
        }
        mono[i] = s / fmt.channels;
      }
      if (fmt.rate === SR) return mono;
      const ratio = fmt.rate / SR;
      const out = new Float32Array(Math.floor(frames / ratio));
      for (let i = 0; i < out.length; i++) {
        const x = i * ratio;
        const a = Math.floor(x);
        out[i] = mono[a] * (1 - (x - a)) + (mono[a + 1] ?? mono[a]) * (x - a);
      }
      return out;
    }
    pos = body + size + (size % 2);
  }
  throw new Error("no audio data");
}

const clipsDir = `${ROOT}/clips`;
if (!existsSync(clipsDir)) {
  console.log(`No recordings yet: add WAV files under ${clipsDir}/<category>/ (see the top of this script).`);
  process.exit(1);
}
const rows = [];
for (const category of readdirSync(clipsDir).filter((d) => statSync(join(clipsDir, d)).isDirectory())) {
  for (const file of readdirSync(join(clipsDir, category)).filter((f) => f.toLowerCase().endsWith(".wav"))) {
    const expected = basename(file).split("__")[0];
    // Hum Lab label next to the WAV, if any
    const sidecar = join(clipsDir, category, file.replace(/\.wav$/i, ".json"));
    const label = existsSync(sidecar) ? JSON.parse(readFileSync(sidecar, "utf8")) : null;
    const samples = readWav(join(clipsDir, category, file));
    const t0 = Date.now();
    const res = searchMelody(queryContour(trackHum(samples, SR)), references);
    const ms = Date.now() - t0;
    const ids = res.matches.map((m) => m.id);
    const top = res.matches[0];
    rows.push({
      category: label ? label.kind : category,
      file,
      expected,
      inIndex: expected !== "none" && titles.has(expected),
      ids,
      reason: res.reason,
      ms,
      seconds: samples.length / SR,
      label,
      rightPart: label && top?.id === expected ? Math.abs(top.at - label.segmentStart) <= 15 : null,
    });
  }
}
if (!rows.length) { console.log("No WAV recordings found."); process.exit(1); }

const summarise = (list) => {
  const known = list.filter((r) => r.inIndex);
  const unknown = list.filter((r) => !r.inIndex);
  const rank = (r) => r.ids.indexOf(r.expected);
  const share = (n, d) => (d ? (n / d).toFixed(2) : "—");
  const ms = list.map((r) => r.ms).sort((a, b) => a - b);
  return {
    n: list.length,
    top1: share(known.filter((r) => rank(r) === 0).length, known.length),
    top3: share(known.filter((r) => rank(r) >= 0 && rank(r) < 3).length, known.length),
    top5: share(known.filter((r) => rank(r) >= 0 && rank(r) < 5).length, known.length),
    noMatch: share(known.filter((r) => !r.ids.length).length, known.length),
    wrongAnswer: share(known.filter((r) => r.ids.length && rank(r) !== 0).length, known.length),
    falsePositive: share(unknown.filter((r) => r.ids.length).length, unknown.length),
    medianMs: ms[ms.length >> 1],
  };
};

console.log(`index: ${references.length} songs (exported ${index.exportedAt})`);
const unindexed = rows.filter((r) => r.expected !== "none" && !titles.has(r.expected)).length;
if (unindexed) console.log(`${unindexed} take(s) are of songs the phone hasn't learned: counted as "not in index"`);

const table = (title, groupOf) => {
  const groups = [...new Set(rows.map(groupOf).filter((g) => g !== null && g !== undefined))].sort();
  if (!groups.length) return;
  console.log(`\n${title.padEnd(13)} n    top1  top3  top5  no-match  wrong  false-pos  median ms`);
  for (const g of [...groups, "ALL"]) {
    const s = summarise(g === "ALL" ? rows : rows.filter((r) => groupOf(r) === g));
    console.log(`${String(g).slice(0, 12).padEnd(12)} ${String(s.n).padStart(3)}   ${s.top1}  ${s.top3}  ${s.top5}  ${s.noMatch.padStart(8)}  ${s.wrongAnswer.padStart(5)}  ${s.falsePositive.padStart(9)}  ${String(s.medianMs).padStart(9)}`);
  }
};
table("category", (r) => r.category);
if (rows.some((r) => r.label)) {
  table("language", (r) => r.label?.language || (r.label ? "unknown" : null));
  table("decade", (r) => r.label?.decade || (r.label ? "unknown" : null));
  table("voice", (r) => r.label?.voice || (r.label ? "unknown" : null));
  const found = rows.filter((r) => r.rightPart !== null);
  if (found.length) console.log(`\nright part of the song (top match within 15 s of the hummed segment): ${found.filter((r) => r.rightPart).length}/${found.length}`);
}
console.log("\nper clip:");
for (const r of rows) {
  const got = r.ids.length ? r.ids.slice(0, 3).map((id) => (id === r.expected ? `[${titles.get(id)}]` : titles.get(id))).join(" | ") : `no match (${r.reason})`;
  console.log(`  ${r.category}/${r.file}: ${got}`);
}
