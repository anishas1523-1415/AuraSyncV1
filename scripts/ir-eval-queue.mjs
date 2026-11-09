// Does Up Next re-rank after skips? (run: node scripts/ir-eval-queue.mjs)
// A queue of real songs (radio of a seed). The listener skips two songs by the most common artist;
// rerankUpcoming then re-orders what's left. Reports where that artist's remaining songs sit
// before and after, and how many moved down.
import { Innertube } from "youtubei-web";
const store = new Map();
globalThis.window = globalThis;
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { searchMusicSongs, musicRadio } = await import("../src/lib/musicTracks.js");
const { recordFeedback } = await import("../src/lib/ir/profile.js");
const { rerankUpcoming } = await import("../src/lib/ir/recommend.js");

const yt = await Innertube.create({ retrieve_player: false, generate_session_locally: true });
for (const seedQuery of ["vaathi coming", "kesariya", "why this kolaveri di"]) {
  const [seed] = await searchMusicSongs(yt, seedQuery);
  const queue = [seed, ...(await musicRadio(yt, seed.id)).slice(0, 20)];
  const first = (t) => String(t.artist).split(",")[0].trim();
  const counts = {};
  queue.slice(1).forEach((t) => { counts[first(t)] = (counts[first(t)] || 0) + 1; });
  const [artist] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  // the listener skips the first two songs by that artist
  const skipped = queue.slice(1).filter((t) => first(t) === artist).slice(0, 2);
  skipped.forEach((t) => recordFeedback(t, "skip"));
  const current = skipped[1];
  const upcoming = queue.slice(1).filter((t) => !skipped.includes(t));
  const after = rerankUpcoming(upcoming, { current });
  const pos = (list) => list.map((t, i) => (first(t) === artist ? i + 1 : null)).filter(Boolean);
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  console.log(`seed "${seedQuery}": skipped 2 songs by ${artist}; ${pos(upcoming).length} more of theirs queued`);
  console.log(`  mean position of ${artist}: before ${avg(pos(upcoming)).toFixed(1)} -> after ${avg(pos(after)).toFixed(1)} (of ${upcoming.length}); next song unchanged: ${upcoming[0].id === after[0].id}`);
}
process.exit(0);
