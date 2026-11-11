// Natural-language request evaluation (run: node scripts/ir-eval-requests.mjs [path/to/search.js]).
// Requests have no single right song, so each is judged by what its top 10 must be:
//   artist  - share of the top 10 credited to the named artist (P@10)
//   lang    - share of the top 10 classified in the requested language (P@10)
// Pass another copy of search.js (e.g. an older version) to compare engines on the same requests.
import { Innertube } from "youtubei-web";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { classifyTrack, classifyList } from "../src/lib/ir/classify.js";

const REQUESTS = [
  { q: "Enaku melody songs venum", lang: "tamil" },
  { q: "kuthu songs podu", lang: "tamil" },
  { q: "Play sad Tamil songs", lang: "tamil" },
  { q: "90s Hindi romantic songs", lang: "hindi" },
  { q: "mujhe sad songs sunao", lang: "hindi" },
  { q: "naan sad songs kekanum", lang: "tamil" },
  { q: "Ilayaraja old love songs", artist: /ilaiyaraaja|ilayaraja|ilaiyaraja/i },
  { q: "Vijay songs for gym", artist: /\bvijay\b/i },
  { q: "sid sriram melody", artist: /sid sriram/i },
  { q: "anirudh sad songs", artist: /anirudh/i },
  { q: "ilaiyaraaja melody", artist: /ilaiyaraaja|ilayaraja|ilaiyaraja/i },
];

const modulePath = process.argv[2] ? pathToFileURL(resolve(process.argv[2])).href : "../src/lib/ir/search.js";
const { createSearch } = await import(modulePath);
const yt = await Innertube.create({ retrieve_player: false, generate_session_locally: true });
const { search } = createSearch(async () => yt);

let total = 0;
const times = [];
for (const r of REQUESTS) {
  const started = Date.now();
  let results = [];
  try {
    results = await search(r.q);
  } catch (err) {
    console.warn(`  ! ${r.q}: ${err.message}`);
  }
  const ms = Date.now() - started;
  times.push(ms);
  const top = results.slice(0, 10);
  classifyList(top);
  const good = top.filter((t) => (r.artist ? r.artist.test(t.artist) : classifyTrack(t).language === r.lang)).length;
  const p10 = top.length ? good / 10 : 0;
  total += p10;
  console.log(`${r.q.padEnd(28)} P@10 ${p10.toFixed(1)}  ${String(ms).padStart(5)}ms  ${top.slice(0, 3).map((t) => `${t.title.slice(0, 28)} — ${t.artist.slice(0, 18)}`).join(" | ")}`);
}
times.sort((a, b) => a - b);
console.log(`\nmean P@10 ${(total / REQUESTS.length).toFixed(2)}  median ${times[Math.floor(times.length / 2)]}ms  (n=${REQUESTS.length})`);
