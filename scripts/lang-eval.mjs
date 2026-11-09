// Language classifier evaluation (run: node scripts/lang-eval.mjs).
// Reports accuracy, per-language precision / recall / F1, coverage (share given any label) and the
// misclassified songs, on the labelled set in scripts/lang-benchmark.json.
import { readFileSync } from "node:fs";
import { classifyTrack } from "../src/lib/ir/classify.js";

const bench = JSON.parse(readFileSync(new URL("./lang-benchmark.json", import.meta.url), "utf8"));
for (const [name, tracks] of [["known", bench.tracks], ["held-out", bench.held_out || []]]) {
console.log(`
== ${name} ==`);
const stats = {};
let correct = 0;
let labelled = 0;
const errors = [];
for (const [title, artist, truth] of tracks) {
  const { language } = classifyTrack({ id: `${title}|${artist}`, title, artist });
  const s = (k) => (stats[k] ||= { tp: 0, fp: 0, fn: 0 });
  if (language) labelled++;
  if (language === truth) { correct++; s(truth).tp++; }
  else {
    s(truth).fn++;
    if (language) s(language).fp++;
    errors.push(`${title} — ${artist}: ${language || "unknown"} (should be ${truth})`);
  }
}
console.log(`accuracy ${(correct / tracks.length).toFixed(2)}  coverage ${(labelled / tracks.length).toFixed(2)}  (n=${tracks.length})`);
for (const [lang, { tp, fp, fn }] of Object.entries(stats)) {
  const p = tp + fp ? tp / (tp + fp) : 0;
  const r = tp + fn ? tp / (tp + fn) : 0;
  const f = p + r ? (2 * p * r) / (p + r) : 0;
  console.log(`  ${lang.padEnd(10)} P=${p.toFixed(2)} R=${r.toFixed(2)} F1=${f.toFixed(2)}`);
}
if (errors.length) console.log("\nmistakes:\n  " + errors.join("\n  "));
}
