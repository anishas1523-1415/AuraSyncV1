// Behaviour learning tests (run: node scripts/behavior-learning-test.mjs). Offline, no network.
// Simulates a listener's activity (searches, plays, skips, replays, lyrics, likes) and checks that the
// taste profile, mixes, charts and suggestions move with it, and that two accounts stay separate.
const store = new Map();
globalThis.window = globalThis;
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const profile = await import("../src/lib/ir/profile.js");
const { pickSeeds, personalize } = await import("../src/lib/ir/recommend.js");
const { rankTrending } = await import("../src/lib/ir/trending.js");
const { trackFeatures } = await import("../src/lib/ir/classify.js");
const { cosine } = await import("../src/lib/ir/rank.js");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
};

const song = (id, title, artist, extra = {}) => ({ id, title, artist, ...extra });
const tamilSad = [
  song("ts1", "Kannazhaga", "Anirudh Ravichander, Dhanush"),
  song("ts2", "Po Nee Po", "Anirudh Ravichander"),
  song("ts3", "Enna Solla", "Anirudh Ravichander"),
];
const englishGym = [
  song("eg1", "Till I Collapse", "Eminem"),
  song("eg2", "Lose Yourself", "Eminem"),
  song("eg3", "Stronger", "Kanye West"),
];

// 1. Searches alone shape the profile
profile.resetTaste();
profile.recordSearch("anirudh sad songs");
profile.recordSearch("anirudh songs");
let p = profile.getProfile() || {};
check("search adds the searched artist", (p["artist:anirudh"] || 0) > 0, JSON.stringify(p));
check("search adds the searched mood", (p["mood:sad"] || 0) > 0);

// 2. Listening: completes, replays and lyrics for Anirudh; quick skips for Eminem
const v0 = profile.tasteVersion();
tamilSad.forEach((t) => { profile.recordFeedback(t, "complete"); profile.recordFeedback(t, "lyrics"); });
profile.recordFeedback(tamilSad[0], "replay");
englishGym.forEach((t) => profile.recordFeedback(t, "quick_skip"));
englishGym.forEach((t) => profile.recordFeedback(t, "skip"));
p = profile.getProfile();
const anirudh = profile.affinity(song("x1", "New Song", "Anirudh Ravichander"));
const eminem = profile.affinity(song("x2", "Other Song", "Eminem"));
check("loved artist fits better than skipped artist", anirudh > eminem, `${anirudh.toFixed(2)} vs ${eminem.toFixed(2)}`);
check("songs skipped quickly twice are rejected", profile.isRejected(englishGym[0]));
check("judgments advance the taste version", profile.tasteVersion() - v0 >= 6, `${profile.tasteVersion() - v0}`);
check("lastJudged reports a positive recent song", profile.lastJudged("ts1")?.positive === true);

profile.recordSearch("anirudh");
check("a searched short name maps to the full artist heard", !!profile.exportTaste().queries["artist:anirudh ravichander"]);

// 3. Charts: trending songs ranked by this listener's taste (the trending engine; full tests in trending-test.mjs)
const chart = [
  song("c1", "Chart Pop 1", "Taylor Swift"), song("c2", "Chart Rap", "Eminem"), song("c3", "Chart Pop 2", "Dua Lipa"),
  song("c4", "Chart Pop 3", "Ed Sheeran"), song("c5", "Hukum", "Anirudh Ravichander"), song("c6", "Chart Pop 4", "Coldplay"),
  song("c7", "Kaavaalaa", "Anirudh Ravichander"), song("c8", "Chart Pop 5", "Adele"),
];
profile.recordFeedback(chart[1], "quick_skip");
profile.recordFeedback(chart[1], "quick_skip");
const intent = profile.getIntent();
const ranked = rankTrending(chart.map((track, i) => ({ track, standing: { regional: 1 / (1 + i / 10), broader: 0.5 } })), {
  intentFit: (t) => cosine(intent, trackFeatures(t)), judged: profile.judgedCount(), heard: (id) => !!profile.lastJudged(id), rejected: profile.isRejected,
}).map((r) => r.track.id);
// With little history the chart still leads (the brief's new-listener weights): their artist moves up, not to the top
check("trending: the listener's artist moves up from its chart position", ranked.indexOf("c5") < 4 && ranked.indexOf("c7") < 6, ranked.join(","));
check("trending: a song they keep skipping goes last, not out", ranked[ranked.length - 1] === "c2" && ranked.length === chart.length, ranked.join(","));

// 4. Mixes: a seed whose songs were played through comes up more than one whose songs were skipped
for (let i = 0; i < 4; i++) {
  profile.recordFeedback(song(`gs${i}`, `Gym Song ${i}`, "Someone", { seed: "tamil gym songs" }), "complete");
  profile.recordFeedback(song(`gb${i}`, `Gym Bad ${i}`, "Someone Else", { seed: "edm workout" }), "quick_skip");
}
check("played-through seed weighs more", profile.seedWeight("tamil gym songs") > 1.5, profile.seedWeight("tamil gym songs").toFixed(2));
check("skipped seed weighs less", profile.seedWeight("edm workout") < 0.6, profile.seedWeight("edm workout").toFixed(2));
let good = 0;
for (let i = 0; i < 400; i++) if (pickSeeds(["tamil gym songs", "edm workout"], 1)[0] === "tamil gym songs") good += 1;
check("mix picks the working seed most of the time", good > 280, `${good}/400`);

// 5. Mix ranking: the listener's artist rises
const mix = personalize([song("m1", "Mix A", "Eminem"), song("m2", "Mix B", "Coldplay"), song("m3", "Mix C", "Anirudh Ravichander")], { count: 3 });
check("personal mix leads with their artist", mix[0].id === "m3", mix.map((t) => t.artist).join(" | "));

// 6. Accounts: state exported for one account and merged with another keeps each account's own
const accountA = profile.exportTaste();
profile.resetTaste();
check("a new account starts with no taste", profile.getProfile() === null);
profile.recordFeedback(englishGym[1], "like");
profile.recordFeedback(englishGym[2], "like");
const accountB = profile.exportTaste();
check("account B learns its own taste", profile.affinity(song("x3", "Gym", "Eminem")) > profile.affinity(song("x4", "Melody", "Anirudh Ravichander")));
profile.applyTaste(profile.mergeTasteState(accountA, {}));
check("restoring account A brings back its searches and seeds", !!profile.exportTaste().queries["artist:anirudh"] && profile.seedWeight("tamil gym songs") > 1.5);
const merged = profile.mergeTasteState(accountA, accountB);
check("sync merge keeps searches and seeds", !!merged.queries["artist:anirudh"] && !!merged.seeds["tamil gym songs"]);

console.log(failures ? `\n${failures} failed` : "\nAll behaviour learning tests passed");
process.exit(failures ? 1 : 0);
