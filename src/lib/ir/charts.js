// What's actually trending: YouTube Music's official charts for a country (Trending 20, Daily Top,
// Top 100) and its weekly per-language charts ("Top Weekly Videos Tamil"), run through the trending
// engine (trending.js): only charting songs, strict language pools, one entry per song, with a
// diagnostic record for every candidate. Works with any youtubei.js client (phone or server).
// Ranking for the listener happens afterwards, on the phone (catalog.chartPage).
import { songToTrack, isPlayableSong, findAudioVersion } from "../musicTracks.js";
import { parseTitle } from "./text.js";
import { classifyTrack } from "./classify.js";
import { verifyLanguage, findTemplates, collapseVersions, trendStanding, explicitLanguage, POOL_LANGUAGES, LANGUAGE_CODES } from "./trending.js";
import { LANGUAGE_OVERRIDES } from "./languageOverrides.js";

const CHART_TTL_MS = 3 * 60 * 60 * 1000;
// Chart entries that aren't songs: film promos and announcements
const NOT_A_SONG = /\b(glimpse|teaser|trailer|promo|first look|motion poster|making|behind the scenes|bts|interview|announcement|dialogue|scene)\b/i;

// ─── Track details from YouTube (tags, description, views), remembered for a week ───
const DETAILS_KEY = "aurasynq_track_details_v1";
const DETAILS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const detailsMemo = new Map();
let detailsLoaded = false;
const loadDetails = () => {
  if (detailsLoaded) return;
  detailsLoaded = true;
  try {
    const now = Date.now();
    for (const [id, d] of Object.entries(JSON.parse(globalThis.localStorage?.getItem(DETAILS_KEY) || "{}"))) {
      if (now - d.at < DETAILS_TTL_MS) detailsMemo.set(id, d);
    }
  } catch (e) {}
};
let detailsTimer = null;
const saveDetails = () => {
  clearTimeout(detailsTimer);
  detailsTimer = setTimeout(() => {
    try {
      globalThis.localStorage?.setItem(DETAILS_KEY, JSON.stringify(Object.fromEntries([...detailsMemo.entries()].slice(-1500))));
    } catch (e) {}
  }, 1000);
};

// { keywords, description, views, at } or null when YouTube didn't answer (never guessed)
async function trackDetails(yt, videoId) {
  loadDetails();
  if (detailsMemo.has(videoId)) return detailsMemo.get(videoId);
  try {
    const info = await yt.getBasicInfo(videoId, "WEB");
    const d = {
      keywords: (info.basic_info?.keywords || []).slice(0, 40),
      description: String(info.basic_info?.short_description || "").slice(0, 800),
      views: Number.isFinite(info.basic_info?.view_count) ? info.basic_info.view_count : null,
      at: Date.now(),
    };
    detailsMemo.set(videoId, d);
    saveDetails();
    return d;
  } catch (e) {
    return null;
  }
}

// ─── Audio versions of chart videos, remembered (found: 30 days; not found: 3 days) ───
const AUDIO_KEY = "aurasynq_audio_versions_v3";
const audioMemo = new Map();
let audioLoaded = false;
const loadAudio = () => {
  if (audioLoaded) return;
  audioLoaded = true;
  try {
    const now = Date.now();
    for (const [id, e] of Object.entries(JSON.parse(globalThis.localStorage?.getItem(AUDIO_KEY) || "{}"))) {
      if (now - e.at < (e.track ? 30 : 3) * 24 * 60 * 60 * 1000) audioMemo.set(id, e);
    }
  } catch (e) {}
};
let audioTimer = null;
const saveAudio = () => {
  clearTimeout(audioTimer);
  audioTimer = setTimeout(() => {
    try { globalThis.localStorage?.setItem(AUDIO_KEY, JSON.stringify(Object.fromEntries([...audioMemo.entries()].slice(-1500)))); } catch (e) {}
  }, 1000);
};

// Chart entries (with their trend data) become the songs as released: same verdict, same chart
// positions, but the audio track's id, title, cover and length. Videos without a clear audio match
// stay as they are. Two uploads that turn out to be one song are merged.
async function asAudio(yt, entries) {
  loadAudio();
  const out = new Array(entries.length);
  let next = 0;
  const worker = async () => {
    while (next < entries.length) {
      const i = next++;
      const t = entries[i];
      if (t.media === "audio") { out[i] = t; continue; }
      let memo = audioMemo.get(t.id);
      if (!memo) {
        let found = null;
        try { found = await findAudioVersion(yt, t, { keywords: detailsMemo.get(t.id)?.keywords || [], language: t.trend?.language || ownLanguage(t).language || null }); } catch (e) {}
        memo = { track: found && { id: found.id, title: found.title, artist: found.artist, album: found.album, cover: found.cover, duration: found.duration }, at: Date.now() };
        audioMemo.set(t.id, memo);
        saveAudio();
      }
      out[i] = memo.track
        ? { ...t, ...memo.track, url: `https://www.youtube.com/watch?v=${memo.track.id}`, media: "audio", trend: { ...t.trend, videoId: t.id } }
        : { ...t, media: "video" };
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  const seen = new Set();
  return out.filter((t) => t && !seen.has(t.id) && seen.add(t.id));
}

// ─── Nightly trend data (scripts/trend-snapshot.mjs): momentum, views, audio language ───
// The phone reads the website's /trend-data.json, the server its own copy; null when unavailable
// (then momentum is "unknown", never invented).
const TREND_STALE_MS = 72 * 60 * 60 * 1000; // older than 3 days: not used
let trendLoader = null;
let trendCache = null;
export function setTrendDataLoader(fn) { trendLoader = fn; trendCache = null; }
async function trendData() {
  if (!trendLoader) return null;
  if (trendCache && Date.now() - trendCache.at < CHART_TTL_MS) return trendCache.promise;
  const fresh = (d) => d?.songs && d.generatedAt && Date.now() - Date.parse(d.generatedAt) < TREND_STALE_MS;
  const promise = Promise.resolve().then(trendLoader).then((d) => (fresh(d) ? d : null)).catch(() => null);
  trendCache = { at: Date.now(), promise };
  return promise;
}

// ─── Chart playlists ───
const chartIndex = new Map(); // country -> { at, promise }
const playlistCache = new Map(); // id -> { at, promise }

// The charts page lists the chart playlists; find them by title so new ids are picked up
export async function chartPlaylists(yt, country) {
  const hit = chartIndex.get(country);
  if (hit && Date.now() - hit.at < CHART_TTL_MS) return hit.promise;
  const promise = (async () => {
    const res = await yt.actions.execute("/browse", { browseId: "FEmusic_charts", client: "YTMUSIC", formData: { selectedValues: [country] } });
    const sections = res.data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];
    const lists = { trending: null, daily: null, top: null, languages: {} };
    for (const section of sections) {
      for (const item of section.musicCarouselShelfRenderer?.contents || []) {
        const r = item.musicTwoRowItemRenderer;
        const title = r?.title?.runs?.[0]?.text || "";
        const id = (r?.navigationEndpoint?.browseEndpoint?.browseId || "").replace(/^VL/, "");
        if (!id) continue;
        if (/^trending/i.test(title)) lists.trending = id;
        else if (/daily top/i.test(title)) lists.daily = id;
        else if (/top 100/i.test(title)) lists.top = id;
        const lang = title.match(/top weekly videos\s+(\w+)/i)?.[1];
        if (lang) lists.languages[lang.toLowerCase()] = id;
      }
    }
    return lists;
  })();
  promise.catch(() => chartIndex.delete(country));
  chartIndex.set(country, { at: Date.now(), promise });
  return promise;
}

// "Magale Video Song | Baththa | Vijay Sethupathi | @SaiAbhyank" -> title "Magale", album "Baththa"
function cleanChartTrack(track) {
  const raw = track.title || "";
  if (!/\s[|]\s|video|lyric/i.test(raw)) return track;
  const { song, film } = parseTitle(raw);
  const parts = raw.split(/\s[|]\s/).map((p) => p.trim());
  const album = film || (parts.length > 1 && !/@|official|music|records|sony|saregama|think|lahari|aditya|t-series|tips/i.test(parts[1]) ? parts[1] : "");
  // Keep a language marker ("(Telugu)") the cleaning would remove: it's evidence
  const marker = explicitLanguage(raw);
  const title = film ? `${song} (From "${film}")` : song;
  return { ...track, title: marker && !explicitLanguage(title) ? `${title} (${marker[0].toUpperCase()}${marker.slice(1)})` : title, ...(album && !track.album ? { album } : {}) };
}

export async function playlistTracks(yt, id) {
  if (!id) return [];
  const hit = playlistCache.get(id);
  if (hit && Date.now() - hit.at < CHART_TTL_MS) return hit.promise;
  const promise = yt.music.getPlaylist(id).then((p) => (p.items || p.contents || [])
    .map(songToTrack)
    .filter((t) => t && isPlayableSong(t) && !NOT_A_SONG.test(t.title))
    .map(cleanChartTrack));
  promise.catch(() => playlistCache.delete(id));
  playlistCache.set(id, { at: Date.now(), promise });
  return promise;
}

// Every song on the given charts, with its positions: [{ track, charts: [{ chart, rank }] }]
function candidatesFrom(named) {
  const byId = new Map();
  for (const { chart, tracks } of named) {
    tracks.forEach((track, rank) => {
      if (!track?.id) return;
      const c = byId.get(track.id) || { track, charts: [] };
      if (!c.charts.some((x) => x.chart === chart)) c.charts.push({ chart, rank });
      byId.set(track.id, c);
    });
  }
  return [...byId.values()];
}

// ─── Diagnostics: why each candidate was accepted or not (last run per chart kind) ───
const diagnostics = new Map();
export const trendDiagnostics = (kind) => diagnostics.get(kind) || null;

const ownLanguage = (track) => {
  const r = classifyTrack(track);
  return r.byNeighbours ? { language: null } : r;
};

const publicTrend = (standing, extra = {}) => ({ status: standing.status, regional: standing.regional, broader: standing.broader, ...extra });

// ─── Trending in one language: only songs verified in that language ───
export async function languageTrending(yt, language, { country = "IN", count = 40 } = {}) {
  if (!POOL_LANGUAGES.includes(language)) return [];
  const [lists, trend] = await Promise.all([chartPlaylists(yt, country), trendData()]);
  const [weekly, trending, daily, top] = await Promise.all([
    playlistTracks(yt, lists.languages[language]).catch(() => []),
    playlistTracks(yt, lists.trending).catch(() => []),
    playlistTracks(yt, lists.daily).catch(() => []),
    playlistTracks(yt, lists.top).catch(() => []),
  ]);
  const candidates = candidatesFrom([
    { chart: `weekly:${language}`, tracks: weekly },
    { chart: "trending", tracks: trending },
    { chart: "daily", tracks: daily },
    { chart: "top", tracks: top },
  ]);
  const report = [];
  const songTrend = (id) => trend?.songs?.[id] || null;
  const standingOf = (c) => trendStanding(c, { kind: language, trend: songTrend(c.track.id) });

  // Songs only on the national charts are checked further only if something points to this
  // language (no point looking up 200 Hindi hits for Tamil Trending)
  const considered = [];
  for (const c of candidates) {
    const onLanguageChart = c.charts.some((x) => x.chart === `weekly:${language}`);
    const own = ownLanguage(c.track);
    const marker = explicitLanguage(c.track.title);
    const audio = songTrend(c.track.id)?.audioLanguage;
    if (onLanguageChart || own.language === language || marker === language || LANGUAGE_OVERRIDES[c.track.id]?.language === language || (audio && LANGUAGE_CODES[audio.split("-")[0].toLowerCase()] === language)) {
      considered.push(c);
    } else {
      report.push({ id: c.track.id, title: c.track.title, artist: c.track.artist, accepted: false, reason: own.language ? "language mismatch" : "language uncertain", detail: own.language ? `classifier: ${own.language}` : "not on the language chart, no evidence", charts: c.charts });
    }
  }
  considered.sort((a, b) => { const x = standingOf(a); const y = standingOf(b); return (y.regional + y.broader) - (x.regional + x.broader); });

  // Look up details in order of standing until enough are verified (with room for duplicates)
  const details = {};
  const verdicts = new Map();
  let checked = 0;
  const verifyAll = () => {
    const isTemplate = findTemplates(details);
    let verified = 0;
    for (const c of considered.slice(0, checked)) {
      const v = verifyLanguage(c, {
        details: details[c.track.id],
        trend: songTrend(c.track.id),
        override: LANGUAGE_OVERRIDES[c.track.id],
        isTemplate,
        classify: ownLanguage,
      });
      verdicts.set(c.track.id, v);
      if (v.status === "verified" && v.language === language) verified += 1;
    }
    return verified;
  };
  while (checked < considered.length) {
    const batch = considered.slice(checked, checked + 8);
    const got = await Promise.all(batch.map((c) => trackDetails(yt, c.track.id)));
    batch.forEach((c, i) => { if (got[i]) details[c.track.id] = got[i]; });
    checked += batch.length;
    if (verifyAll() >= Math.ceil(count * 1.25)) break;
  }
  verifyAll();

  const eligible = [];
  considered.forEach((c, i) => {
    const base = { id: c.track.id, title: c.track.title, artist: c.track.artist, charts: c.charts };
    if (i >= checked) { report.push({ ...base, accepted: false, reason: "not checked", detail: "enough songs were verified first" }); return; }
    const v = verdicts.get(c.track.id);
    const lang = { language: v.language, secondary: v.secondary, confidence: v.confidence, status: v.status, method: v.method, sources: v.sources };
    if (v.status !== "verified") report.push({ ...base, accepted: false, reason: v.status === "conflict" ? "language conflict" : "language uncertain", detail: v.reason, lang });
    else if (v.language !== language) report.push({ ...base, accepted: false, reason: "language mismatch", detail: `verified ${v.language}`, lang });
    else eligible.push({ candidate: c, standing: standingOf(c), keywords: details[c.track.id]?.keywords || [], lang });
  });

  const isTemplate = findTemplates(details);
  eligible.forEach((e) => { e.template = isTemplate(e.keywords); });
  eligible.sort((a, b) => (b.standing.regional + b.standing.broader) - (a.standing.regional + a.standing.broader));
  const { kept, dropped } = collapseVersions(eligible);
  dropped.forEach(({ item, of, reason }) => report.push({ id: item.candidate.track.id, title: item.candidate.track.title, artist: item.candidate.track.artist, accepted: false, reason: "duplicate", detail: `${reason}: ${of.title}`, charts: item.candidate.charts }));
  const out = kept.slice(0, count);
  out.forEach(({ candidate, standing, lang }) => report.push({ id: candidate.track.id, title: candidate.track.title, artist: candidate.track.artist, accepted: true, reason: "trending, verified language", detail: lang.method, lang, charts: candidate.charts, standing }));
  diagnostics.set(language, { at: Date.now(), country, candidates: candidates.length, checked, eligible: out.length, report });
  return asAudio(yt, out.map(({ candidate, standing, lang }) => ({
    ...candidate.track,
    trending: true,
    trend: publicTrend(standing, { charts: candidate.charts, language: lang.language, languageStatus: lang.status, languageMethod: lang.method, languageConfidence: lang.confidence }),
  })));
}

// ─── Trending now in the country ───
// The national charts (broader) and the weekly charts of the listener's languages (regional).
// Every song is on an official chart; ranking for the listener is done afterwards.
export async function trendingNow(yt, { country = "IN", languages = [], count = 40 } = {}) {
  const [lists, trend] = await Promise.all([chartPlaylists(yt, country), trendData()]);
  const regional = languages.filter((l) => lists.languages[l]).slice(0, 2);
  const [trending, daily, top, ...weekly] = await Promise.all([
    playlistTracks(yt, lists.trending).catch(() => []),
    playlistTracks(yt, lists.daily).catch(() => []),
    playlistTracks(yt, lists.top).catch(() => []),
    ...regional.map((l) => playlistTracks(yt, lists.languages[l]).catch(() => [])),
  ]);
  const candidates = candidatesFrom([
    { chart: "trending", tracks: trending },
    { chart: "daily", tracks: daily },
    { chart: "top", tracks: top },
    ...regional.map((l, i) => ({ chart: `weekly:${l}`, tracks: weekly[i] })),
  ]);
  const items = candidates
    .map((c) => ({ candidate: c, standing: trendStanding(c, { kind: "now", regionalLanguages: regional, trend: trend?.songs?.[c.track.id] }), keywords: [] }))
    .sort((a, b) => (b.standing.regional + b.standing.broader) - (a.standing.regional + a.standing.broader));
  // Possible re-uploads under another title share a main artist: only those need their tags
  // (remembered for a week, so this is usually free)
  const mainArtist = (t) => String(t.artist || "").split(/,|&/)[0].trim().toLowerCase();
  const perArtist = new Map();
  items.slice(0, count * 2).forEach((i) => { const a = mainArtist(i.candidate.track); perArtist.set(a, (perArtist.get(a) || 0) + 1); });
  const suspects = items.slice(0, count * 2).filter((i) => perArtist.get(mainArtist(i.candidate.track)) > 1).slice(0, 40);
  const got = await Promise.all(suspects.map((i) => trackDetails(yt, i.candidate.track.id)));
  suspects.forEach((i, k) => { i.keywords = got[k]?.keywords || []; });
  const isTemplate = findTemplates(Object.fromEntries(suspects.map((i, k) => [i.candidate.track.id, got[k]]).filter(([, d]) => d)));
  suspects.forEach((i) => { i.template = isTemplate(i.keywords); });
  const { kept, dropped } = collapseVersions(items);
  const out = kept.slice(0, count);
  diagnostics.set("now", {
    at: Date.now(), country, regionalLanguages: regional, candidates: candidates.length, eligible: out.length,
    report: [
      ...out.map(({ candidate, standing }) => ({ id: candidate.track.id, title: candidate.track.title, artist: candidate.track.artist, accepted: true, reason: "on an official chart", charts: candidate.charts, standing })),
      ...dropped.map(({ item, of, reason }) => ({ id: item.candidate.track.id, title: item.candidate.track.title, accepted: false, reason: "duplicate", detail: `${reason}: ${of.title}` })),
    ],
  });
  return asAudio(yt, out.map(({ candidate, standing }) => ({
    ...candidate.track,
    trending: true,
    trend: publicTrend(standing, { charts: candidate.charts }),
  })));
}
