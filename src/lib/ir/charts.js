// What's actually trending: YouTube Music's official charts for a country (Trending 20, Daily Top,
// Top 100) and its weekly per-language charts (e.g. "Top Weekly Videos Tamil"), merged with
// reciprocal rank fusion. Works with any youtubei.js client (phone or server).
import { songToTrack, isPlayableSong } from "../musicTracks.js";
import { parseTitle, normalize } from "./text.js";
import { reciprocalRankFusion, collapseDuplicates } from "./rank.js";
import { classifyTrack } from "./classify.js";

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
  return fuse([
    { tracks: weeklyInLanguage, weight: 1.3 },
    { tracks: inLanguage(trending), weight: 1.1 },
    { tracks: inLanguage(daily), weight: 0.9 },
  ], count);
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
