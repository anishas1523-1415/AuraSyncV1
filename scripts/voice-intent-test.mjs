// Voice command understanding tests (run: node scripts/voice-intent-test.mjs). Offline, no network.
// Transcripts as a speech engine returns them -> action, search words and request understanding.
import { parseVoiceCommand, bestTranscript } from "../src/lib/ir/voice.js";

const CASES = [
  // From the product brief
  { t: "Play old Ilaiyaraaja romantic songs in Tamil", action: "play", query: "old ilaiyaraaja romantic songs tamil", languages: ["tamil"], moods: ["retro", "romantic"] },
  { t: "Enakku Ilaiyaraaja songs venum", action: "search", entity: "ilaiyaraaja", queryLanguage: "tamil" },
  { t: "Play something similar to this", action: "similar" },
  { t: "Find that Vijay song", action: "search", query: "vijay song" },
  { t: "Create a romantic Malayalam playlist", action: "playlist", query: "romantic malayalam songs", languages: ["malayalam"], moods: ["romantic"] },
  { t: "Play energetic songs for gym", action: "play", moods: ["energetic"] },
  { t: "Play old Tamil melody songs", action: "play", intent: "mood", languages: ["tamil"], moods: ["retro", "romantic"] },
  // More phrasings
  { t: "Hey Aura play Kesariya", action: "play", query: "kesariya" },
  { t: "play the song called Vaathi Coming", action: "play", query: "vaathi coming" },
  { t: "search for anirudh sad songs", action: "search", query: "anirudh sad songs", entity: "anirudh" },
  { t: "more songs like this", action: "similar" },
  { t: "make me a workout playlist", action: "playlist", query: "workout songs", moods: ["energetic"] },
  { t: "mujhe sad songs sunao", action: "search", queryLanguage: "hindi", moods: ["sad"] },
  { t: "play 90s hindi romantic songs", action: "play", era: "90s", languages: ["hindi"] },
  // A title that contains a pointer word must survive
  { t: "play this is me", action: "play", query: "this is me" },
  { t: "play why this kolaveri di", action: "play", query: "why this kolaveri di" },
  { t: "find the song called this is me", action: "search", query: "this is me" },
  { t: "play that anirudh song", action: "play", query: "anirudh song" },
];

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let failed = 0;
for (const c of CASES) {
  const got = parseVoiceCommand(c.t);
  const q = got.request || {};
  const problems = [];
  if (got.action !== c.action) problems.push(`action: got ${got.action}, want ${c.action}`);
  if ("query" in c && got.query !== c.query) problems.push(`query: got "${got.query}", want "${c.query}"`);
  for (const f of ["entity", "intent", "queryLanguage", "era", "languages"]) {
    if (f in c && !same(q[f], c[f])) problems.push(`${f}: got ${JSON.stringify(q[f])}, want ${JSON.stringify(c[f])}`);
  }
  if (c.moods && !same([...(q.moods || [])].sort(), [...c.moods].sort())) problems.push(`moods: got ${JSON.stringify(q.moods)}, want ${JSON.stringify(c.moods)}`);
  if (problems.length) { failed++; console.log(`FAIL  ${c.t}\n      ${problems.join("\n      ")}`); }
  else console.log(`ok    ${c.t}  ->  ${got.action} "${got.query}"`);
}

// Choosing among the speech engine's alternatives
const pick = bestTranscript(["and I can ilayaraja songs when um", "enakku ilaiyaraaja songs venum"]);
if (pick !== "enakku ilaiyaraaja songs venum") { failed++; console.log(`FAIL  bestTranscript picked "${pick}"`); }
else console.log("ok    bestTranscript prefers the alternative that reads as a request");

const total = CASES.length + 1;
console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
