// Search relevance evaluation for AuraSynq (run: node scripts/ir-eval.mjs [baseline|new]).
// Uses the judgments in scripts/ir-benchmark.json and reports, per query kind:
//   Hit@1 / Hit@5 / Hit@10  - is the right song in the top k?
//   MRR                     - mean reciprocal rank of the first right song
//   P@10                    - precision for artist queries (share of top 10 by that artist)
// "baseline" is the old YouTube Music song-filter search; "new" is src/lib/ir/search.js.
import { readFileSync } from "node:fs";
import { Innertube } from "youtubei-web";
import { searchMusicSongs } from "../src/lib/musicTracks.js";

const mode = process.argv[2] || "new";
const bench = JSON.parse(readFileSync(new URL("./ir-benchmark.json", import.meta.url), "utf8"));
const yt = await Innertube.create({ retrieve_player: false, generate_session_locally: true });

let search;
if (mode === "baseline") {
  search = (q) => searchMusicSongs(yt, q);
} else {
  const { createSearch } = await import("../src/lib/ir/search.js");
  search = createSearch(async () => yt).search;
}

const norm = (s) => String(s || "").toLowerCase();
const byKind = {};
const rows = [];

for (const item of bench.queries) {
  let results = [];
  const started = Date.now();
  try {
    results = await search(item.q);
  } catch (err) {
    console.warn(`  ! ${item.q}: ${err.message}`);
  }
  const ms = Date.now() - started;
  const k = (byKind[item.kind] ||= { n: 0, hit1: 0, hit5: 0, hit10: 0, rr: 0, p10: 0, p10n: 0 });
  k.n++;
  let note = "";
  if (item.title) {
    const re = new RegExp(item.title, "i");
    const rank = results.findIndex((t) => re.test(norm(t.title))) + 1;
    if (rank === 1) k.hit1++;
    if (rank && rank <= 5) k.hit5++;
    if (rank && rank <= 10) k.hit10++;
    if (rank) k.rr += 1 / rank;
    note = rank ? `rank ${rank}` : "MISSING";
    if (item.kind === "movie") {
      // A movie query wants its soundtrack: share of the top 10 that are songs from it
      const p = results.slice(0, 10).filter((t) => re.test(norm(t.title)) || re.test(norm(t.album))).length / 10;
      k.p10 += p;
      k.p10n++;
      note += ` P@10 ${p.toFixed(1)}`;
    }
  } else if (item.artist) {
    const top = results.slice(0, 10);
    const p = top.length ? top.filter((t) => norm(t.artist).includes(item.artist)).length / 10 : 0;
    k.p10 += p;
    k.p10n++;
    note = `P@10 ${p.toFixed(1)}`;
  } else {
    const top = results.slice(0, 10);
    note = `${results.length} results`;
    k.p10 += top.length / 10;
    k.p10n++;
  }
  rows.push(`${item.kind.padEnd(8)} ${item.q.padEnd(28)} ${note.padEnd(10)} ${String(ms).padStart(5)}ms  ${results.slice(0, 3).map((t) => `${t.title} — ${t.artist}`.slice(0, 40)).join(" | ")}`);
}

console.log(rows.join("\n"));
console.log(`\n== ${mode} ==`);
let total = { n: 0, hit1: 0, hit5: 0, hit10: 0, rr: 0 };
for (const [kind, k] of Object.entries(byKind)) {
  if (k.p10n === k.n && !k.hit10 && !k.rr) {
    console.log(`${kind.padEnd(9)} n=${k.n}  P@10=${(k.p10 / k.p10n).toFixed(2)}`);
    continue;
  }
  const p10 = k.p10n ? `  P@10=${(k.p10 / k.p10n).toFixed(2)}` : "";
  console.log(`${kind.padEnd(9)} n=${k.n}  Hit@1=${(k.hit1 / k.n).toFixed(2)}  Hit@5=${(k.hit5 / k.n).toFixed(2)}  Hit@10=${(k.hit10 / k.n).toFixed(2)}  MRR=${(k.rr / k.n).toFixed(2)}${p10}`);
  for (const f of ["n", "hit1", "hit5", "hit10", "rr"]) total[f] += k[f];
}
console.log(`${"ALL known".padEnd(9)} n=${total.n}  Hit@1=${(total.hit1 / total.n).toFixed(2)}  Hit@5=${(total.hit5 / total.n).toFixed(2)}  Hit@10=${(total.hit10 / total.n).toFixed(2)}  MRR=${(total.rr / total.n).toFixed(2)}`);
process.exit(0);
