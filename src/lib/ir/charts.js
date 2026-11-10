// What's actually trending: YouTube Music's official charts for a country (Trending 20, Daily Top,
// Top 100) and its weekly per-language charts (e.g. "Top Weekly Videos Tamil"), merged with
// reciprocal rank fusion. Works with any youtubei.js client (phone or server).
import { songToTrack, isPlayableSong } from "../musicTracks.js";
import { parseTitle, normalize } from "./text.js";
import { reciprocalRankFusion, collapseDuplicates } from "./rank.js";
import { classifyTrack } from "./classify.js";

// ─── Language verification from YouTube's own video details ───
// A song's tags and description almost always name its language ("Latest Tamil songs"), which is
// stronger evidence than any word list. Each song is looked up once and remembered.
const LANGUAGE_PATTERNS = {
  tamil: /\b(tamil|kollywood)\b/gi,
  telugu: /\b(telugu|tollywood)\b/gi,
  hindi: /\b(hindi|bollywood)\b/gi,
  malayalam: /\b(malayalam|mollywood)\b/gi,
  kannada: /\b(kannada|sandalwood)\b/gi,
  punjabi: /\b(punjabi)\b/gi,
  bengali: /\b(bengali|bangla)\b/gi,
  marathi: /\b(marathi)\b/gi,
  bhojpuri: /\b(bhojpuri)\b/gi,
  haryanvi: /\b(haryanvi)\b/gi,
};
const VOTES_KEY = "aurasynq_lang_votes";
const votesMemo = new Map();
let votesLoaded = false;
const loadVotes = () => {
  if (votesLoaded) return;
  votesLoaded = true;
  try {
    for (const [id, votes] of Object.entries(JSON.parse(globalThis.localStorage?.getItem(VOTES_KEY) || "{}"))) votesMemo.set(id, votes);
  } catch (e) {}
};
let votesTimer = null;
const saveVotes = () => {
  clearTimeout(votesTimer);
  votesTimer = setTimeout(() => {
    try {
      const entries = [...votesMemo.entries()].slice(-1500);
      globalThis.localStorage?.setItem(VOTES_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch (e) {}
  }, 1000);
};

// { tamil: 3, telugu: 0, ... } from the video's keywords (counted double) and description, or null
async function languageVotes(yt, videoId) {
  loadVotes();
  if (votesMemo.has(videoId)) return votesMemo.get(videoId);
  try {
    const info = await yt.getBasicInfo(videoId, "WEB");
    const keywords = (info.basic_info?.keywords || []).join(" ");
    const description = String(info.basic_info?.short_description || "").slice(0, 800);
    const votes = {};
    for (const [lang, pattern] of Object.entries(LANGUAGE_PATTERNS)) {
      const n = (keywords.match(pattern) || []).length * 2 + (description.match(pattern) || []).length;
      if (n) votes[lang] = n;
    }
    votesMemo.set(videoId, votes);
    saveVotes();
    return votes;
  } catch (e) {
    return null; // couldn't look it up: callers fall back to the word-list evidence
  }
}

// accept = the song's own details agree with the language (or say nothing against it)
function decideLanguage(language, ownLanguage, votes) {
  if (votes && Object.keys(votes).length) {
    const mine = votes[language] || 0;
    const other = Math.max(0, ...Object.entries(votes).filter(([l]) => l !== language).map(([, n]) => n));
    if (mine > 0 && mine >= other) return true;
    if (other > mine) return false;
  }
  return !ownLanguage || ownLanguage === language;
}

// Walks the ranked songs, 8 at a time, keeping those that pass, until `count` have been kept
async function filterByLanguage(yt, language, ranked, count, ownLanguage) {
  const kept = [];
  for (let i = 0; i < ranked.length && kept.length < count; i += 8) {
    const chunk = ranked.slice(i, i + 8);
    const votes = await Promise.all(chunk.map((t) => languageVotes(yt, t.id)));
    chunk.forEach((t, j) => { if (decideLanguage(language, ownLanguage(t), votes[j])) kept.push(t); });
  }
  return kept.slice(0, count);
}

const CHART_TTL_MS = 3 * 60 * 60 * 1000;
// Chart entries that aren't songs: film promos and announcements
const NOT_A_SONG = /\b(glimpse|teaser|trailer|promo|first look|motion poster|making|behind the scenes|bts|interview|announcement|dialogue|scene)\b/i;

const chartIndex = new Map(); // country -> { at, promise }
const playlistCache = new Map(); // id -> { at, promise }

// The charts page lists the chart playlists; find them by title so new ids are picked up
async function chartPlaylists(yt, country) {
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
  return { ...track, title: film ? `${song} (From "${film}")` : song, ...(album && !track.album ? { album } : {}) };
}

async function playlistTracks(yt, id) {
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

const fuse = (lists, count) => collapseDuplicates(reciprocalRankFusion(lists.filter((l) => l.tracks.length), 20)
  .map(({ track, fused }) => ({ track, score: fused })))
  .slice(0, count)
  .map(({ track }) => ({ ...track, trending: true }));

// Trending in one language: its weekly chart first, plus the country's trending/daily charts'
// songs in that language (identified by the language classifier)
export async function languageTrending(yt, language, { country = "IN", count = 40 } = {}) {
  const lists = await chartPlaylists(yt, country);
  const [weekly, trending, daily] = await Promise.all([
    playlistTracks(yt, lists.languages[language]).catch(() => []),
    playlistTracks(yt, lists.trending).catch(() => []),
    playlistTracks(yt, lists.daily).catch(() => []),
  ]);
  // Each song judged on its own evidence: a chart is exactly where one song may differ from the rest
  // (labels guessed from neighbours in other lists don't count here)
  const ownLanguage = (t) => {
    const r = classifyTrack(t);
    return r.byNeighbours ? null : r.language;
  };
  // From the general (all-language) charts, only songs whose own evidence clearly says so
  const inLanguage = (tracks) => tracks.filter((t) => {
    const r = classifyTrack(t);
    return !r.byNeighbours && r.language === language && (r.confidence ?? 1) >= 0.75;
  });
  // Even a language's chart holds dubbed versions ("[Hindi]", "(Telugu)") and other-language hits:
  // keep the songs that are in the language, or that nothing marks as another one
  const weeklyInLanguage = weekly.filter((t) => {
    const lang = ownLanguage(t);
    return !lang || lang === language;
  });
  const ranked = fuse([
    { tracks: weeklyInLanguage, weight: 1.3 },
    { tracks: inLanguage(trending), weight: 1.1 },
    { tracks: inLanguage(daily), weight: 0.9 },
  ], count * 2);
  // Last check, from YouTube's own tags and description of each song
  return filterByLanguage(yt, language, ranked, count, ownLanguage);
}

// Trending now in the country, leaning toward the listener's languages
export async function trendingNow(yt, { country = "IN", languages = [], count = 40 } = {}) {
  const lists = await chartPlaylists(yt, country);
  const regional = languages.filter((l) => lists.languages[l]).slice(0, 2);
  const [trending, daily, top, ...weekly] = await Promise.all([
    playlistTracks(yt, lists.trending).catch(() => []),
    playlistTracks(yt, lists.daily).catch(() => []),
    playlistTracks(yt, lists.top).catch(() => []),
    ...regional.map((l) => playlistTracks(yt, lists.languages[l]).catch(() => [])),
  ]);
  return fuse([
    { tracks: trending, weight: 1.3 },
    { tracks: daily, weight: 1.1 },
    { tracks: top, weight: 0.7 },
    ...weekly.map((tracks) => ({ tracks, weight: 0.9 })),
  ], count);
}

export const chartLanguageKey = (language) => normalize(language);
