// Session-mood evaluation (run: node scripts/ir-eval-session.mjs).
// Same seed song, two simulated listening sessions (calm melodies vs high-energy mass songs).
// The radio after the seed should follow the session: more romantic/calm songs in the first,
// more energetic/party songs in the second.
import { Innertube } from "youtubei-web";
import { spawnSync } from "node:child_process";

// Each session runs in its own process (the profile keeps its state in module memory)
const only = process.argv[2];
if (!only) {
  for (const tag of ["a", "b"]) {
    const out = spawnSync(process.execPath, [process.argv[1], tag], { encoding: "utf8" }).stdout;
    const lines = out.split(String.fromCharCode(10)).filter((l) => /^(seed|session)/.test(l));
    console.log(lines.join(String.fromCharCode(10)));
  }
  process.exit(0);
}

const yt = await Innertube.create({ retrieve_player: false, generate_session_locally: true });
const stores = {};
let active = only;
globalThis.window = globalThis;
globalThis.localStorage = {
  getItem: (k) => stores[active]?.[k] ?? null,
  setItem: (k, v) => { (stores[active] ||= {})[k] = String(v); },
  removeItem: (k) => { delete stores[active]?.[k]; },
};
const { searchMusicSongs, musicRadio } = await import("../src/lib/musicTracks.js");
// profile.js caches its state in memory: load a fresh copy per session
const load = async (tag) => {
  active = tag;
  const q = `?s=${tag}`;
  const profile = await import(`../src/lib/ir/profile.js`);
  const recommend = await import(`../src/lib/ir/recommend.js`);
  return { ...profile, ...recommend };
};
const { classifyTrack } = await import("../src/lib/ir/classify.js");

const sessions = {
  a: { label: "calm melodies", songs: ["munbe vaa", "uyire en uyire", "kadhal oru aagayam", "nenjukkul peidhidum", "ennai thottu"] },
  b: { label: "mass / energetic", songs: ["hukum", "arabic kuthu", "kaavaalaa", "naa ready", "vaathi coming"] },
};
const [seed] = await searchMusicSongs(yt, process.env.SEED || "kanmani anbodu");
const radio = await musicRadio(yt, seed.id);
console.log(`seed: ${seed.title} — ${seed.artist}; ${radio.length} radio candidates\n`);

const calm = new Set(["romantic", "calm", "chill", "sad"]);
const loud = new Set(["energetic", "party"]);
for (const [tag, { label, songs }] of Object.entries(sessions).filter(([t]) => t === only)) {
  const m = await load(tag);
  for (const q of songs) {
    const [song] = await searchMusicSongs(yt, q);
    if (song) m.recordFeedback(song, "complete");
  }
  const picks = m.rankRadio(radio, { current: seed, count: 10 });
  const moods = picks.map((t) => classifyTrack(t).mood);
  const c = moods.filter((x) => calm.has(x)).length;
  const l = moods.filter((x) => loud.has(x)).length;
  console.log(`session "${label}": calm-ish ${c}, loud ${l} of 10 | ${picks.slice(0, 5).map((t) => t.title.slice(0, 20)).join(" / ")}`);
}
process.exit(0);
