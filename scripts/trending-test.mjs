// Trending engine tests (run: node scripts/trending-test.mjs). Offline: a fake YouTube client serves
// fixed charts, so every rule of the trending brief is checked on known data:
//   A. Tamil Trending language isolation   B. personalised ranking   C. strict eligibility
//   D. data integrity (duplicates, stale / missing data, unknown language)
import { languageTrending, trendingNow, trendDiagnostics, setTrendDataLoader } from "../src/lib/ir/charts.js";
import { verifyLanguage, rankTrending, spreadOut, collapseVersions, trendStanding, explicitLanguage, TREND_CONFIG } from "../src/lib/ir/trending.js";

let failures = 0;
let total = 0;
const check = (name, ok, detail = "") => {
  total += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
};

// ─── Fixture charts ───
let n = 0;
const vid = () => `vid${String(n++).padStart(8, "0")}`;
const song = (title, artist, { album, keywords = [], description = "", seconds = 240 } = {}) => ({ id: vid(), title, artist, album, keywords, description, seconds });
const S = {
  tamilHit: song("Kaadhal Mazhai", "Anirudh Ravichander", { keywords: ["kaadhal mazhai song", "kaadhal mazhai tamil song", "latest tamil songs"] }),
  tamilHit2: song("Oru Naal Kanavu", "Sid Sriram", { keywords: ["oru naal kanavu", "tamil melody songs", "latest tamil songs"] }),
  tamilEnglishTitle: song("Heartbeat Lady", "G. V. Prakash Kumar", { keywords: ["heartbeat lady tamil song", "tamil love songs"] }),
  tanglish: song("Vibe Panrom Da", "Hiphop Tamizha", { keywords: ["vibe panrom da tamil", "tamil english song"], description: "Tamil song with English rap" }),
  teluguHit: song("Nuvvu Naaku", "Sid Sriram", { keywords: ["nuvvu naaku telugu song", "latest telugu songs"] }),
  malayalamHit: song("Ninne Kaanan", "Vineeth Sreenivasan", { keywords: ["ninne kaanan malayalam song", "malayalam songs"] }),
  hindiHit: song("Tum Hi Ho Dil", "Arijit Singh", { keywords: ["tum hi ho dil hindi song", "bollywood songs"] }),
  kannadaHit: song("Ninna Nodi", "Sanjith Hegde", { keywords: ["ninna nodi kannada song", "kannada songs"] }),
  englishHit: song("Midnight Drive", "The Weeknd", { keywords: ["midnight drive english song", "pop"] }),
  unknownHit: song("Zoom Zoom", "DJ Unknown", { keywords: ["zoom zoom"] }),
  instrumental: song("Mass Theme BGM", "Anirudh Ravichander", { keywords: ["mass theme bgm"] }),
  // The same film song in two languages; the Telugu version is on the national chart
  tamilVersion: song("Vaa Vaa Nilave (From \"Megam\")", "Anirudh Ravichander", { keywords: ["vaa vaa nilave tamil", "megam tamil movie songs"] }),
  teluguVersion: song("Raa Raa Jabili (From \"Megam\") [Telugu]", "Anirudh Ravichander", { keywords: ["raa raa jabili telugu", "megam telugu"] }),
  // Duplicates: a lyric-video copy, a slowed version, and an upload under another title
  tamilHitCopy: song("Kaadhal Mazhai (Lyric Video)", "Anirudh Ravichander", { keywords: ["kaadhal mazhai lyric video", "tamil songs"] }),
  tamilHitSlowed: song("Kaadhal Mazhai (Slowed + Reverb)", "Anirudh Ravichander", { keywords: ["kaadhal mazhai slowed", "tamil songs"] }),
  otherTitleUpload: song("Mazhai Paadal", "Anirudh Ravichander", { keywords: ["oru naal kanavu full song", "oru naal kanavu video", "oru naal kanavu tamil", "tamil songs"] }),
  // A different song of the same film, whose tags mention the film's other hit once
  sameFilmOtherSong: song("Theeyae Theeyae", "Sid Sriram", { keywords: ["theeyae theeyae song", "oru naal kanavu", "tamil songs"] }),
  // A Tamil song nobody charts: must never appear
  notTrendingTamil: song("Pazhaya Paadal", "Ilaiyaraaja", { keywords: ["pazhaya paadal tamil song"] }),
};
const CHARTS = {
  trending: [S.teluguVersion, S.hindiHit, S.englishHit, S.unknownHit, S.tamilHit],
  daily: [S.hindiHit, S.malayalamHit, S.kannadaHit, S.teluguHit],
  top: [S.hindiHit, S.englishHit],
  "weekly:tamil": [S.tamilHit, S.tamilHit2, S.sameFilmOtherSong, S.tamilHitCopy, S.tamilEnglishTitle, S.tanglish, S.instrumental, S.tamilVersion, S.tamilHitSlowed, S.otherTitleUpload, S.unknownHit],
  "weekly:telugu": [S.teluguHit, S.teluguVersion],
  "weekly:hindi": [S.hindiHit],
};
const byId = new Map(Object.values(S).map((s) => [s.id, s]));
const playlistIds = { trending: "PLtrending", daily: "PLdaily", top: "PLtop", "weekly:tamil": "PLtamil", "weekly:telugu": "PLtelugu", "weekly:hindi": "PLhindi" };
const titles = { trending: "Trending 20 India", daily: "Daily Top Music Videos - India", top: "Top 100 Music Videos India", "weekly:tamil": "Top Weekly Videos Tamil", "weekly:telugu": "Top Weekly Videos Telugu", "weekly:hindi": "Top Weekly Videos Hindi" };
let detailsCalls = 0;
const fakeYt = {
  actions: {
    execute: async () => ({
      data: { contents: { singleColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [{
        musicCarouselShelfRenderer: { contents: Object.keys(playlistIds).map((k) => ({ musicTwoRowItemRenderer: { title: { runs: [{ text: titles[k] }] }, navigationEndpoint: { browseEndpoint: { browseId: `VL${playlistIds[k]}` } } } })) },
      }] } } } }] } } },
    }),
  },
  music: {
    getPlaylist: async (id) => {
      const key = Object.keys(playlistIds).find((k) => playlistIds[k] === id);
      return { items: (CHARTS[key] || []).map((s) => ({ id: s.id, title: s.title, artists: s.artist.split(", ").map((name) => ({ name })), duration: { seconds: s.seconds }, album: s.album ? { name: s.album } : undefined, thumbnails: [] })) };
    },
  },
  getBasicInfo: async (id) => {
    detailsCalls += 1;
    const s = byId.get(id);
    if (!s) throw new Error("unknown video");
    return { basic_info: { keywords: s.keywords, short_description: s.description, view_count: 1000 } };
  },
};

// ─── A. Tamil Trending ───
setTrendDataLoader(null);
const tamil = await languageTrending(fakeYt, "tamil", { country: "IN", count: 20 });
const ids = new Set(tamil.map((t) => t.id));
const diag = trendDiagnostics("tamil");
const verdict = (s) => diag.report.find((r) => r.id === s.id);
check("A1 trending Tamil song is included", ids.has(S.tamilHit.id));
check("A2 trending Telugu song is excluded", !ids.has(S.teluguHit.id));
check("A3 trending Malayalam song is excluded", !ids.has(S.malayalamHit.id));
check("A4 trending Hindi song is excluded", !ids.has(S.hindiHit.id));
check("A5 trending Kannada song is excluded", !ids.has(S.kannadaHit.id));
check("A6 trending English song is excluded", !ids.has(S.englishHit.id));
check("A7 non-trending Tamil song is excluded", !ids.has(S.notTrendingTamil.id) && !verdict(S.notTrendingTamil));
check("A8 unknown-language trending song is excluded", !ids.has(S.unknownHit.id), JSON.stringify(verdict(S.unknownHit)));
check("A9 Tamil-English mixed song with Tamil evidence is included", ids.has(S.tanglish.id), JSON.stringify(verdict(S.tanglish)));
check("A10 Tamil song with an English title is classified Tamil", ids.has(S.tamilEnglishTitle.id), JSON.stringify(verdict(S.tamilEnglishTitle)));
check("A11 instrumental with uncertain language is excluded", !ids.has(S.instrumental.id) && /instrumental/.test(verdict(S.instrumental)?.detail || ""), JSON.stringify(verdict(S.instrumental)));
check("A12 film song: only the Tamil version is included", ids.has(S.tamilVersion.id) && !ids.has(S.teluguVersion.id));
check("A13 every accepted song is verified Tamil", tamil.every((t) => t.trend.language === "tamil" && t.trend.languageStatus === "verified"));

// ─── C. Strict eligibility ───
check("C1 every song returned is on an official chart", tamil.every((t) => t.trending && t.trend.charts.length > 0));
const fewer = await languageTrending(fakeYt, "tamil", { country: "IN", count: 50 });
check("C2 too few eligible songs: fewer are returned, nothing added", fewer.length === tamil.length && fewer.length < 50, `${fewer.length}`);
const malayalam = await languageTrending(fakeYt, "malayalam", { country: "IN", count: 20 });
check("C3 a language with no chart of its own still only gets its own verified songs", malayalam.every((t) => t.trend.language === "malayalam"), malayalam.map((t) => t.title).join(", "));
check("C4 no cross-language contamination in the Telugu pool", (await languageTrending(fakeYt, "telugu", { count: 20 })).every((t) => t.trend.language === "telugu"));
const now = await trendingNow(fakeYt, { country: "IN", languages: ["tamil"], count: 30 });
check("C5 Trending (now) only has charting songs", now.every((t) => t.trending && t.trend.charts.length > 0) && !now.some((t) => t.id === S.notTrendingTamil.id));
check("C6 an unsupported language gives nothing", (await languageTrending(fakeYt, "klingon", {})).length === 0);

// ─── D. Data integrity ───
check("D1 a lyric-video copy collapses into the song", !ids.has(S.tamilHitCopy.id) && verdict(S.tamilHitCopy)?.reason === "duplicate");
check("D2 a slowed version gives way to its charting original", !ids.has(S.tamilHitSlowed.id) && /slowed/.test(verdict(S.tamilHitSlowed)?.detail || ""), JSON.stringify(verdict(S.tamilHitSlowed)));
check("D3b a different song whose tags mention another hit once is kept", ids.has(S.sameFilmOtherSong.id), JSON.stringify(verdict(S.sameFilmOtherSong)));
check("D3 an upload whose tags name another charting song collapses into it", !ids.has(S.otherTitleUpload.id), JSON.stringify(verdict(S.otherTitleUpload)));
const counted = trendStanding({ charts: [{ chart: "trending", rank: 0 }, { chart: "trending", rank: 0 }, { chart: "daily", rank: 3 }] }, { kind: "now" });
const single = trendStanding({ charts: [{ chart: "trending", rank: 0 }] }, { kind: "now" });
check("D4 a song listed twice does not count twice", counted.broader === single.broader, `${counted.broader} vs ${single.broader}`);
const noData = verifyLanguage({ track: { id: "x", title: "Something" }, charts: [] }, {});
check("D5 unknown language never defaults to Tamil", noData.language === null && noData.status === "uncertain");
const chartOnly = verifyLanguage({ track: { id: "y", title: "Mystery" }, charts: [{ chart: "weekly:tamil", rank: 5 }] }, {});
check("D6 the language chart alone does not verify a song", chartOnly.status !== "verified", chartOnly.status);
const tamilOnChart = { track: { id: "z1", title: "Kadhal Vandhale" }, charts: [{ chart: "weekly:tamil", rank: 3 }] };
const tamilDetails = { keywords: ["kadhal vandhale tamil song", "tamil songs"] };
const englishDefault = verifyLanguage(tamilOnChart, { details: tamilDetails, trend: { audioLanguage: "en-US" }, classify: () => ({ language: "tamil", confidence: 0.9 }) });
check("D12 an uploader's default English audio language doesn't block a Tamil song", englishDefault.status === "verified" && englishDefault.language === "tamil", JSON.stringify(englishDefault));
const labelDefault = verifyLanguage(tamilOnChart, { details: tamilDetails, trend: { audioLanguage: "hi" }, classify: () => ({ language: "tamil", confidence: 0.9 }) });
check("D13 a label-wide audio default (hi) alone can't overrule chart, tags and title", labelDefault.status === "verified" && labelDefault.language === "tamil", JSON.stringify(labelDefault));
const agreeing = verifyLanguage({ track: { id: "z2", title: "Mystery" }, charts: [{ chart: "weekly:tamil", rank: 3 }] }, { trend: { audioLanguage: "ta" } });
check("D14 audio language agreeing with the language chart verifies a song", agreeing.status === "verified", JSON.stringify(agreeing));
const noVocals = verifyLanguage(tamilOnChart, { details: tamilDetails, trend: { audioLanguage: "zxx" }, classify: () => ({ language: "tamil", confidence: 0.9 }) });
check("D15 'zxx' (no spoken language) counts as instrumental and is excluded", noVocals.status !== "verified", JSON.stringify(noVocals));
check("D16 YouTube's 'bh' code reads as Bhojpuri", verifyLanguage({ track: { id: "z3", title: "Lagal" }, charts: [{ chart: "weekly:bhojpuri", rank: 1 }] }, { trend: { audioLanguage: "bh" } }).language === "bhojpuri");
check("D7 explicit language markers are read, film names are not", explicitLanguage("Song (Telugu)") === "telugu" && explicitLanguage("Azhagiya Tamil Magan Songs") === null);
setTrendDataLoader(() => ({ generatedAt: new Date(Date.now() - 5 * 24 * 3600e3).toISOString(), songs: { [S.tamilHit.id]: { status: "rising" } } }));
const stale = await languageTrending(fakeYt, "tamil", { count: 20 });
check("D8 stale trend data (5 days old) is ignored, not trusted", stale.every((t) => t.trend.status === "unknown"));
setTrendDataLoader(() => ({ generatedAt: new Date().toISOString(), songs: { [S.tamilHit2.id]: { status: "rising" } } }));
const freshData = await languageTrending(fakeYt, "tamil", { count: 20 });
check("D9 fresh trend data is used for momentum", freshData.find((t) => t.id === S.tamilHit2.id)?.trend.status === "rising");
check("D10 missing data never invents momentum", freshData.filter((t) => t.id !== S.tamilHit2.id).every((t) => t.trend.status === "unknown"));
setTrendDataLoader(null);
detailsCalls = 0;
await languageTrending(fakeYt, "tamil", { count: 20 });
check("D11 track details are looked up once and remembered", detailsCalls === 0, `${detailsCalls} lookups`);

// ─── B. Personalised ranking (eligible songs only) ───
const items = [
  { track: { id: "a", title: "Top Kuthu", artist: "Artist A" }, standing: { regional: 1, broader: 0.6 } },
  { track: { id: "b", title: "Soft Melody", artist: "Artist B" }, standing: { regional: 0.7, broader: 0.3 } },
  { track: { id: "c", title: "Another Kuthu", artist: "Artist C" }, standing: { regional: 0.8, broader: 0.4 } },
];
const melodyFit = (t) => (t.title.includes("Melody") ? 0.9 : -0.2);
const newUser = rankTrending(items, {});
check("B1 new listener: plain trending order, no invented taste", newUser.map((r) => r.track.id).join() === "a,c,b" && newUser.every((r) => r.parts.personal === 0.5));
const melodyFan = rankTrending(items, { intentFit: melodyFit, judged: 60 });
check("B2 melody listener: the trending melody ranks first", melodyFan[0].track.id === "b", melodyFan.map((r) => r.track.id).join());
check("B3 personalisation never adds songs", melodyFan.length === items.length && melodyFan.every((r) => items.some((i) => i.track.id === r.track.id)));
const fewSongs = rankTrending(items, { intentFit: melodyFit, judged: 6 });
check("B4 little history: taste moves the order only slightly", fewSongs[0].track.id === "a", fewSongs.map((r) => r.track.id).join());
const w = rankTrending(items, { judged: 1000 })[0].weights;
check("B5 established weights match the brief (35/45/10/10)", Math.abs(w.regional - 0.35) < 1e-9 && Math.abs(w.personal - 0.45) < 1e-9 && Math.abs(w.broader - 0.1) < 1e-9);
const w0 = rankTrending(items, { judged: 0 })[0].weights;
check("B6 new-listener weights match the brief (65/15/15/5)", Math.abs(w0.regional - 0.65) < 1e-9 && Math.abs(w0.discovery - 0.05) < 1e-9);
const rejectedLast = rankTrending(items, { intentFit: () => 0.5, judged: 60, rejected: (t) => t.id === "a" });
check("B7 a song the listener keeps skipping moves to the end (still eligible)", rejectedLast[rejectedLast.length - 1].track.id === "a");
const sameArtist = [1, 2, 3, 4].map((i) => ({ track: { id: `s${i}`, title: `Song ${i}`, artist: "One Artist" }, score: 1 - i * 0.1 }))
  .concat([{ track: { id: "o1", title: "Other", artist: "Someone Else" }, score: 0.1 }]);
const spread = spreadOut(sameArtist);
check("B8 diversity: no more than 2 in a row from one artist up top, nothing dropped", spread[2].track.id === "o1" && spread.length === sameArtist.length, spread.map((r) => r.track.id).join());
const tamilAndMalayalam = { intentFit: (t) => (t.artist === "Artist B" ? 0.8 : 0), judged: 60 };
check("B9 preferences only reorder within a pool (pool contents unchanged)", rankTrending(items, tamilAndMalayalam).length === items.length);

console.log(failures ? `\n${failures} of ${total} failed` : `\nAll ${total} trending tests passed`);
process.exit(failures ? 1 : 0);
