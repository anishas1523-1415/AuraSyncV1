// Offline evaluation of Aura Radio personalisation (run: node scripts/ir-eval-radio.mjs).
// A simulated listener likes Tamil melodies and skips party/Hindi tracks; for a few seed songs we
// compare YouTube Music's raw radio with the re-ranked radio: share of the top 10 in the
// listener's language (precision of the language preference) and artist variety.
import { Innertube } from "youtubei-web";

// profile.js keeps its state in localStorage; give Node a tiny in-memory one
const store = new Map();
globalThis.window = globalThis;
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

const { musicRadio, searchMusicSongs } = await import("../src/lib/musicTracks.js");
const { recordFeedback } = await import("../src/lib/ir/profile.js");
const { rankRadio, radioAnchor, mergeRadio } = await import("../src/lib/ir/recommend.js");
const { classifyTrack } = await import("../src/lib/ir/classify.js");

const yt = await Innertube.create({ retrieve_player: false, generate_session_locally: true });

// Simulated feedback: likes and completes for Tamil melodies, skips for Hindi party songs
for (const q of ["munbe vaa", "uyire en uyire", "kadhal oru aagayam", "ennai thottu", "nenjukkul peidhidum"]) {
  const [song] = await searchMusicSongs(yt, q);
  if (song) { recordFeedback(song, "like"); recordFeedback(song, "complete"); }
}
for (const q of ["kala chashma", "badshah genda phool"]) {
  const [song] = await searchMusicSongs(yt, q);
  if (song) { recordFeedback(song, "skip"); recordFeedback(song, "skip"); }
}

const share = (tracks, lang) => tracks.filter((t) => classifyTrack(t).language === lang).length / Math.max(1, tracks.length);
const artists = (tracks) => new Set(tracks.map((t) => String(t.artist).split(",")[0].trim())).size;

let raw = 0;
let ranked = 0;
const seeds = ["kesariya", "vaathi coming", "shape of you", "pudhu vellai mazhai"];
for (const q of seeds) {
  const [seed] = await searchMusicSongs(yt, q);
  const radio = await musicRadio(yt, seed.id);
  const before = radio.slice(0, 10);
  const anchor = radioAnchor(seed);
  const anchorRadio = anchor ? await musicRadio(yt, anchor.id) : [];
  const after = rankRadio(mergeRadio(radio, anchorRadio), { current: seed, count: 10 });
  raw += share(before, "tamil");
  ranked += share(after, "tamil");
  console.log(`\n${seed.title} — ${seed.artist}`);
  console.log(`  raw radio: tamil ${share(before, "tamil").toFixed(1)}, artists ${artists(before)} | ${before.slice(0, 4).map((t) => t.title.slice(0, 22)).join(" / ")}`);
  console.log(`  re-ranked: tamil ${share(after, "tamil").toFixed(1)}, artists ${artists(after)} | ${after.slice(0, 4).map((t) => t.title.slice(0, 22)).join(" / ")}`);
}
console.log(`\nTamil share of top 10, mean over ${seeds.length} seeds: raw ${(raw / seeds.length).toFixed(2)} -> re-ranked ${(ranked / seeds.length).toFixed(2)}`);
process.exit(0);
