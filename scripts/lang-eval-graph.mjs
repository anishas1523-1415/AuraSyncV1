// Language identification with co-listening neighbours (run: node scripts/lang-eval-graph.mjs).
// For each held-out song: find it on YouTube Music, fetch its radio, and classify the song
// together with those neighbours (classifyList: kNN vote + artist learning), as the app does.
import { readFileSync } from "node:fs";
import { Innertube } from "youtubei-web";
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { classifyTrack, classifyList } = await import("../src/lib/ir/classify.js");
const { searchMusicSongs, musicRadio } = await import("../src/lib/musicTracks.js");

const { held_out } = JSON.parse(readFileSync(new URL("./lang-benchmark.json", import.meta.url), "utf8"));
const yt = await Innertube.create({ retrieve_player: false, generate_session_locally: true });
let alone = 0;
let graph = 0;
const errors = [];
for (const [title, artist, truth] of held_out) {
  const track = { id: `${title}|${artist}`, title, artist };
  if (classifyTrack(track).language === truth) alone++;
  let neighbours = [];
  try {
    const [hit] = await searchMusicSongs(yt, `${title} ${artist.split(",")[0]}`);
    if (hit) neighbours = (await musicRadio(yt, hit.id)).slice(0, 25);
  } catch (e) {}
  const [result] = classifyList([track, ...neighbours]);
  if (result.language === truth) graph++;
  else errors.push(`${title} — ${artist}: ${result.language || "unknown"} (should be ${truth})`);
}
console.log(`held-out accuracy: alone ${(alone / held_out.length).toFixed(2)} -> with neighbours ${(graph / held_out.length).toFixed(2)}  (n=${held_out.length})`);
if (errors.length) console.log("mistakes:\n  " + errors.join("\n  "));
process.exit(0);
