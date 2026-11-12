// Nightly chart snapshot and momentum (run: node scripts/trend-snapshot.mjs [country]).
//
// 1. Reads today's official YouTube Music charts (the same chart lists the app uses).
// 2. If YOUTUBE_API_KEY is set: the official YouTube Data API v3 adds, per song, its view count,
//    its audio language (defaultAudioLanguage, set by the uploader) and its upload date.
// 3. Saves the day's chart positions to Supabase (chart_snapshots; needs SUPABASE_SERVICE_KEY).
// 4. From the stored days, works out each charting song's momentum and writes public/trend-data.json,
//    which the app and the website read:
//      new        first seen on any chart in the last 3 days (needs 7+ days of history)
//      rising     up the chart by 3+ places (or 15%+) over ~3 days, re-entered, or views/day up 30%+
//      declining  down by the same amount
//      steady     neither
//      evergreen  uploaded more than 3 years ago and not rising (needs the Data API)
//      unknown    not enough history yet (fewer than 4 days): nothing is guessed
// Without SUPABASE_SERVICE_KEY it still writes today's file, with every status "unknown".
import { Innertube } from "youtubei.js";
import { writeFileSync, appendFileSync } from "node:fs";
import { chartPlaylists, playlistTracks } from "../src/lib/ir/charts.js";

const country = (process.argv[2] || "IN").toUpperCase();
const SUPABASE_URL = process.env.SUPABASE_URL || "https://aldykcamdcizwkqvbubz.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const API_KEY = process.env.YOUTUBE_API_KEY;
const OUT = process.env.TREND_DATA_FILE || "public/trend-data.json";
const DAY_MS = 24 * 60 * 60 * 1000;
const today = new Date().toISOString().slice(0, 10);
const summary = [];
const note = (line) => { console.log(line); summary.push(line); };

// ─── Today's charts ───
const yt = await Innertube.create({ retrieve_player: false, generate_session_locally: true });
const lists = await chartPlaylists(yt, country);
const named = [
  ["trending", lists.trending], ["daily", lists.daily], ["top", lists.top],
  ...Object.entries(lists.languages).map(([l, id]) => [`weekly:${l}`, id]),
].filter(([, id]) => id);
const rows = [];
for (const [chart, id] of named) {
  const tracks = await playlistTracks(yt, id).catch(() => []);
  const seen = new Set();
  tracks.forEach((t, rank) => {
    if (!t?.id || seen.has(t.id) || !/^[A-Za-z0-9_-]{11}$/.test(t.id)) return; // one row per song per chart
    seen.add(t.id);
    rows.push({ day: today, country, chart, rank, video_id: t.id, title: String(t.title || "").slice(0, 300), artist: String(t.artist || "").slice(0, 300) });
  });
}
const ids = [...new Set(rows.map((r) => r.video_id))];
note(`Charts for ${country} on ${today}: ${named.length} charts, ${rows.length} positions, ${ids.length} songs.`);
if (!rows.length) { note("No chart data today: nothing written."); process.exit(1); }

// ─── Official Data API facts (optional) ───
const facts = {};
if (API_KEY) {
  for (let i = 0; i < ids.length; i += 50) {
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${ids.slice(i, i + 50).join(",")}&key=${API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) { note(`YouTube Data API error ${res.status}: ${(await res.text()).slice(0, 200)}`); break; }
    for (const v of (await res.json()).items || []) {
      facts[v.id] = {
        views: v.statistics?.viewCount ? Number(v.statistics.viewCount) : null,
        audio_language: v.snippet?.defaultAudioLanguage || null,
        published_at: v.snippet?.publishedAt || null,
      };
    }
  }
  note(`YouTube Data API: facts for ${Object.keys(facts).length} of ${ids.length} songs.`);
} else {
  note("YOUTUBE_API_KEY not set: no view counts, audio language or upload dates.");
}
rows.forEach((r) => Object.assign(r, facts[r.video_id] || {}));

// ─── Store today, read the history ───
const sb = (path, init = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...init,
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
});
let history = rows;
if (SERVICE_KEY) {
  for (let i = 0; i < rows.length; i += 500) {
    const res = await sb("chart_snapshots?on_conflict=day,country,chart,video_id", {
      method: "POST", body: JSON.stringify(rows.slice(i, i + 500)), headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    });
    if (!res.ok) throw new Error(`saving snapshot: ${res.status} ${await res.text()}`);
  }
  const since = new Date(Date.now() - 30 * DAY_MS).toISOString().slice(0, 10);
  history = [];
  for (let from = 0; ; from += 1000) {
    const res = await sb(`chart_snapshots?select=day,chart,rank,video_id,views&country=eq.${country}&day=gte.${since}&order=day.asc`, { headers: { Range: `${from}-${from + 999}` } });
    if (!res.ok) throw new Error(`reading history: ${res.status}`);
    const page = await res.json();
    history.push(...page);
    if (page.length < 1000) break;
  }
  // Keep about four months
  const cutoff = new Date(Date.now() - 120 * DAY_MS).toISOString().slice(0, 10);
  await sb(`chart_snapshots?day=lt.${cutoff}`, { method: "DELETE" });
} else {
  note("SUPABASE_SERVICE_KEY not set: today's charts only, momentum unknown.");
}

// ─── Momentum ───
const days = [...new Set(history.map((r) => r.day))].sort();
const historyDays = days.length;
const byKey = new Map(); // video|chart -> Map(day -> rank)
const firstSeen = new Map();
const viewsByDay = new Map(); // video -> Map(day -> views)
for (const r of history) {
  const k = `${r.video_id}|${r.chart}`;
  if (!byKey.has(k)) byKey.set(k, new Map());
  byKey.get(k).set(r.day, r.rank);
  if (!firstSeen.has(r.video_id) || r.day < firstSeen.get(r.video_id)) firstSeen.set(r.video_id, r.day);
  if (r.views != null) {
    if (!viewsByDay.has(r.video_id)) viewsByDay.set(r.video_id, new Map());
    viewsByDay.get(r.video_id).set(r.day, Number(r.views));
  }
}
const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / DAY_MS);
// The comparison day: the latest stored day at least 3 days before today
const pastDay = [...days].reverse().find((d) => dayDiff(today, d) >= 3) || null;

const songs = {};
const counts = {};
for (const id of ids) {
  const todays = rows.filter((r) => r.video_id === id).sort((a, b) => a.rank - b.rank);
  const main = todays[0]; // the chart it ranks best on today
  let status = "unknown";
  let rankDelta = null;
  let viewsPerDay = null;
  if (historyDays >= 4 && pastDay) {
    const before = byKey.get(`${id}|${main.chart}`)?.get(pastDay);
    if (before == null) status = "rising"; // wasn't on this chart then
    else {
      rankDelta = before - main.rank; // positive = moved up
      const needed = Math.max(3, Math.round(before * 0.15));
      status = rankDelta >= needed ? "rising" : -rankDelta >= needed ? "declining" : "steady";
    }
    if (historyDays >= 7 && dayDiff(today, firstSeen.get(id)) <= 3) status = "new";
    // Views per day now vs the period before (Data API only)
    const v = viewsByDay.get(id);
    if (v && v.has(today) && v.has(pastDay)) {
      viewsPerDay = Math.round((v.get(today) - v.get(pastDay)) / dayDiff(today, pastDay));
      const older = [...v.keys()].filter((d) => dayDiff(pastDay, d) >= 3).pop();
      if (older) {
        const prevPerDay = (v.get(pastDay) - v.get(older)) / dayDiff(pastDay, older);
        if (prevPerDay > 0 && viewsPerDay >= prevPerDay * 1.3 && status !== "new") status = "rising";
      }
    }
  }
  const f = facts[id] || {};
  if (f.published_at && Date.now() - Date.parse(f.published_at) > 3 * 365 * DAY_MS && status !== "rising" && status !== "new") status = "evergreen";
  counts[status] = (counts[status] || 0) + 1;
  songs[id] = {
    status, chart: main.chart, rank: main.rank, rankDelta,
    firstSeen: firstSeen.get(id) || today,
    views: f.views ?? null, viewsPerDay,
    audioLanguage: f.audio_language || null,
    publishedAt: f.published_at || null,
  };
}

writeFileSync(OUT, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  country,
  historyDays,
  comparedWith: pastDay,
  apiData: !!API_KEY && Object.keys(facts).length > 0,
  songs,
  note: "Chart momentum, written nightly by scripts/trend-snapshot.mjs from daily chart snapshots.",
})}\n`);
note(`History: ${historyDays} day(s)${pastDay ? `, compared with ${pastDay}` : ""}. Status counts: ${JSON.stringify(counts)}.`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Chart snapshot\n\n${summary.map((l) => `- ${l}`).join("\n")}\n`);
