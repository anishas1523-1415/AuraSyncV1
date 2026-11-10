// Query understanding tests (run: node scripts/query-parse-test.mjs). Offline, no network.
// Each case states what analyzeQuery must extract; fields not listed are not checked.
// Two groups: natural-language requests (Tamil/Tanglish/Hindi/English, era, artist + mood) and
// plain titles, which must keep parsing as titles (filler words are only dropped from requests).
import { analyzeQuery } from "../src/lib/ir/query.js";

const CASES = [
  // ── Requests from the product brief ──
  { q: "Enaku melody songs venum", intent: "mood", moods: ["romantic"], queryLanguage: "tamil", searchText: "melody songs" },
  { q: "Ilayaraja old love songs", intent: "album_or_artist", entity: "ilayaraja", moods: ["retro", "romantic"] },
  { q: "Play sad Tamil songs", intent: "mood", languages: ["tamil"], moods: ["sad"] },
  { q: "90s Hindi romantic songs", intent: "mood", languages: ["hindi"], moods: ["romantic"], era: "90s" },
  { q: "Vijay songs for gym", intent: "album_or_artist", entity: "vijay", moods: ["energetic"], searchText: "vijay songs gym" },
  // ── More natural-language requests ──
  { q: "anirudh sad songs", intent: "album_or_artist", entity: "anirudh", moods: ["sad"] },
  { q: "sid sriram melody", intent: "album_or_artist", entity: "sid sriram", moods: ["romantic"] },
  { q: "80s tamil songs", intent: "mood", languages: ["tamil"], era: "80s" },
  { q: "2000s hindi party songs", intent: "mood", languages: ["hindi"], moods: ["party"], era: "2000s" },
  { q: "mujhe sad songs sunao", intent: "mood", moods: ["sad"], queryLanguage: "hindi", searchText: "sad songs" },
  { q: "songs for driving", intent: "mood", moods: ["happy"] },
  { q: "study music", intent: "mood", moods: ["calm"] },
  { q: "kuthu songs podu", intent: "mood", moods: ["party"], queryLanguage: "tamil", searchText: "kuthu songs" },
  { q: "i want some workout songs", intent: "mood", moods: ["energetic"], searchText: "workout songs" },
  { q: "tamil gaana songs", intent: "mood", languages: ["tamil"], moods: ["party"] },
  // Mood expansions carry the era and the language a request names
  { q: "90s hindi romantic songs", expansionsInclude: "hindi 90s romantic songs" },
  { q: "enaku melody songs venum", expansionsInclude: "tamil melody songs" },
  // ── Titles: must stay titles ──
  { q: "i want it that way", intent: "song", entity: "", searchText: "i want it that way" },
  { q: "for you", intent: "song_or_artist", searchText: "for you" },
  { q: "mujhe kuch kehna hai", intent: "song", searchText: "mujhe kuch kehna hai" },
  { q: "vaathi coming", intent: "song_or_artist", entity: "vaathi coming" },
  { q: "master movie songs", intent: "album", entity: "master" },
  { q: "jailer songs", intent: "album_or_artist", entity: "jailer" },
  { q: "anirudh", intent: "song_or_artist", entity: "anirudh" },
  { q: "why this kolaveri di", intent: "song" },
  { q: "96 movie songs", intent: "album", entity: "96" },
];

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let failed = 0;
for (const c of CASES) {
  const got = analyzeQuery(c.q);
  const problems = [];
  for (const field of ["intent", "entity", "languages", "queryLanguage", "era", "searchText"]) {
    if (field in c && !same(got[field], c[field])) problems.push(`${field}: got ${JSON.stringify(got[field])}, want ${JSON.stringify(c[field])}`);
  }
  if (c.moods && !same([...got.moods].sort(), [...c.moods].sort())) problems.push(`moods: got ${JSON.stringify(got.moods)}, want ${JSON.stringify(c.moods)}`);
  if (c.expansionsInclude && !got.expansions.includes(c.expansionsInclude)) {
    problems.push(`expansions ${JSON.stringify(got.expansions)} lack "${c.expansionsInclude}"`);
  }
  if (problems.length) {
    failed++;
    console.log(`FAIL  ${c.q}\n      ${problems.join("\n      ")}`);
  } else {
    console.log(`ok    ${c.q}`);
  }
}
console.log(`\n${CASES.length - failed}/${CASES.length} passed`);
process.exit(failed ? 1 : 0);
