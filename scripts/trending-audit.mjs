// Trending audit (run: node scripts/trending-audit.mjs [language] [country]). Read-only, needs network.
// Runs the trending engine on the live YouTube Music charts exactly as the app does and prints
// every candidate's verdict (accepted, or why not) plus the language evidence of accepted songs.
// Writes bench/trending-audit.json (bench/ is git-ignored).
import { Innertube } from "youtubei.js";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { languageTrending, trendingNow, trendDiagnostics, setTrendDataLoader } from "../src/lib/ir/charts.js";

const language = process.argv[2] || "tamil";
const country = process.argv[3] || "IN";
if (existsSync("public/trend-data.json")) setTrendDataLoader(() => JSON.parse(readFileSync("public/trend-data.json", "utf8")));
const yt = await Innertube.create({ retrieve_player: false, generate_session_locally: true });

const t0 = Date.now();
const pool = await languageTrending(yt, language, { country, count: 56 });
const poolMs = Date.now() - t0;
const t1 = Date.now();
const now = await trendingNow(yt, { country, languages: [language], count: 80 });
const nowMs = Date.now() - t1;
const diag = trendDiagnostics(language);
const nowDiag = trendDiagnostics("now");

mkdirSync("bench", { recursive: true });
writeFileSync("bench/trending-audit.json", JSON.stringify({ at: new Date().toISOString(), language, country, pool: diag, now: nowDiag }, null, 2));

const reasons = {};
diag.report.forEach((r) => { reasons[r.reason] = (reasons[r.reason] || 0) + 1; });
console.log(`${language} Trending: ${pool.length} eligible of ${diag.candidates} chart songs (${diag.checked} checked in detail) in ${poolMs} ms`);
console.log("verdicts:", JSON.stringify(reasons));
console.log(`Trending (now): ${now.length} songs in ${nowMs} ms; duplicates dropped: ${nowDiag.report.filter((r) => r.reason === "duplicate").length}`);
console.log(`\nAccepted (${language}):`);
pool.forEach((t, i) => console.log(`${String(i + 1).padStart(2)}. ${t.title} — ${t.artist} | ${t.trend.languageMethod} ${t.trend.languageConfidence} | ${t.trend.charts.map((c) => `${c.chart}#${c.rank + 1}`).join(" ")} | ${t.trend.status}`));
console.log(`\nRejected, but checked as possibly ${language}:`);
diag.report.filter((r) => !r.accepted && r.reason !== "language mismatch" && r.reason !== "not checked" && !(r.reason === "language uncertain" && !r.lang))
  .forEach((r) => console.log(`  ${r.title} — ${r.artist || ""}: ${r.reason} (${r.detail})`));
const offChart = diag.report.filter((r) => !r.accepted && r.reason === "language uncertain" && !r.lang).length;
console.log(`\n(${diag.report.filter((r) => r.reason === "language mismatch").length} national-chart songs in other languages and ${offChart} with no ${language} evidence were not looked up.)`);
