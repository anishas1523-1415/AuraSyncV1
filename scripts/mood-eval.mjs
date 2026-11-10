// Mood classification evaluation (run: node scripts/mood-eval.mjs [--no-index]).
// 1. Labelled songs (scripts/mood-benchmark.json): coverage (share given any mood), precision (share of
//    given moods that are right) and accuracy (share right overall).
// 2. Real radio lists: mood coverage of the songs YouTube Music's radio returns, which is what
//    recommendations re-rank (no labels needed).
// The mood index (src/lib/ir/moods.js), when present, is built first unless --no-index is passed.
import { readFileSync } from "node:fs";
import { Innertube } from "youtubei-web";

const store = {};
globalThis.localStorage = {
  getItem: (k) => store[k] ?? null,
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
const { searchMusicSongs, musicRadio } = await import("../src/lib/musicTracks.js");
const { classifyTrack } = await import("../src/lib/ir/classify.js");
const bench = JSON.parse(readFileSync(new URL("./mood-benchmark.json", import.meta.url), "utf8"));
const yt = await Innertube.create({ retrieve_player: false, generate_session_locally: true });

const moods = process.argv.includes("--no-index") ? null : await import("../src/lib/ir/moods.js").catch(() => null);
if (moods) {
  const started = Date.now();
  const stats = await moods.ensureMoodIndex(yt, { languages: ["tamil", "hindi", "telugu", "english"] });
  console.log(`mood index: ${stats.songs} songs from ${stats.playlists} playlists in ${Date.now() - started}ms`);
} else {
  console.log("mood index: not used");
}

let covered = 0;
let right = 0;
const errors = [];
const sources = {};
for (const [query, accepted] of bench.songs) {
  const [song] = await searchMusicSongs(yt, query).catch(() => []);
  if (!song) { errors.push(`${query}: not found`); continue; }
  const { mood, moodSource } = classifyTrack(song);
  if (mood) {
    covered++;
    sources[moodSource || "title"] = (sources[moodSource || "title"] || 0) + 1;
  }
  if (mood && accepted.includes(mood)) right++;
  else errors.push(`${song.title.slice(0, 40)} — ${song.artist.slice(0, 22)}: ${mood ? `${mood} [${moodSource}]` : "none"} (want ${accepted.join("/")})`);
}
const n = bench.songs.length;
console.log(`\n== labelled songs (n=${n}) ==`);
console.log(`coverage ${(covered / n).toFixed(2)}  precision ${(covered ? right / covered : 0).toFixed(2)}  accuracy ${(right / n).toFixed(2)}`);
console.log(`labels by source: ${JSON.stringify(sources)}`);
console.log("misses:\n  " + errors.join("\n  "));

let total = 0;
let labelled = 0;
console.log("\n== radio lists ==");
for (const seedQuery of bench.radio_seeds) {
  const [seed] = await searchMusicSongs(yt, seedQuery).catch(() => []);
  if (!seed) continue;
  const radio = await musicRadio(yt, seed.id).catch(() => []);
  const withMood = radio.filter((t) => classifyTrack(t).mood).length;
  total += radio.length;
  labelled += withMood;
  console.log(`  ${seed.title.slice(0, 30).padEnd(30)} ${withMood}/${radio.length} have a mood`);
}
console.log(`radio mood coverage ${(labelled / Math.max(1, total)).toFixed(2)} (n=${total})`);
process.exit(0);
