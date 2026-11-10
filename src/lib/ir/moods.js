// Song moods from curated evidence instead of title words.
//
// 1. Mood index: YouTube Music's own editorial mood playlists ("Kollywood Romance Essentials",
//    "Bollywood Melancholy", "Tollywood Dance Hitlist", "Workout"...). A song on a playlist curated
//    for a mood is labelled with that mood; a song on several takes the mood most of them agree on.
//    Built from the "Moods & moments" categories and the listener's language pages, cached on the
//    device for a few days, and looked up by video id or by song identity (title + artist), because
//    radio often returns another upload of the same song.
// 2. Learned moods: songs returned for an unambiguous mood request ("sad songs") are remembered as
//    weak evidence for that mood.
//
// classifyTrack (classify.js) uses: index > title words > learned. Works with any youtubei.js client.
import { songKey } from "./text.js";
import { songToTrack } from "../musicTracks.js";

const STORE_KEY = "aurasynq_mood_index_v1";
const LEARNED_KEY = "aurasynq_mood_learned_v1";
const INDEX_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_PLAYLISTS = 96;
const GLOBAL_PLAYLISTS = 20; // of those, kept for global (English) mood playlists
const CONCURRENCY = 8;
const MAX_LEARNED = 1500;
export const MOODS = ["romantic", "sad", "party", "energetic", "chill", "calm", "happy", "devotional"];

// A playlist's title names its mood (checked in order: "Hip Hop Heartbreak" is sad, not hip-hop)
const TITLE_MOOD = [
  [/\b(sad|melanchol\w*|heartbreak\w*|break ?ups?|lonely|cry\w*|pain|wallow|galau|triste|dard|judaai)\b/i, "sad"],
  [/\b(devotional|bhakti|bhajans?|spiritual|divine|aarti)\b/i, "devotional"],
  [/\b(workout|gym|energi[sz]e\w*|energy|pump\w*|power|beast ?mode|running|motivat\w*|upbeat|recharg\w*)\b/i, "energetic"],
  [/\b(dance|party|kuthu|club|bangers?|dhamaka|wedding|sangeet|bhangra)\b/i, "party"],
  [/\b(romanc\w*|romantic|love|sweethearts?|serenades?|pyaar|ishq|kadhal|prema)\b/i, "romantic"],
  [/\b(chill\w*|lo-?fi|relax\w*|unwind|mellow|monsoon|rain|lounge|easy breezy)\b/i, "chill"],
  [/\b(sleep\w*|calm|peace\w*|study|meditat\w*|sweet dreams|lullab\w*)\b/i, "calm"],
  [/\b(feel\w* ?good|happy|good vibes|sunshine|cheer\w*|uplift\w*|pick me up)\b/i, "happy"],
];
// Categories on YouTube Music's "Moods & moments" page and the mood each means. Every category
// also holds plain hit lists ("Iconic Kollywood Hits" sits under Feel good), so a playlist without
// a mood in its title takes the category's mood only for the narrow categories below.
const CATEGORY_MOOD = {
  romance: "romantic", sad: "sad", party: "party", workout: "energetic", energize: "energetic",
  chill: "chill", sleep: "calm", focus: "calm", "feel good": "happy", devotional: "devotional",
};
const CATEGORY_FALLBACK = new Set(["romance", "sad", "party", "workout", "devotional"]);
// Broad moods say less than specific ones: when a song's playlists disagree, the specific mood wins
const SPECIFICITY = { romantic: 1, sad: 1, party: 1, energetic: 1, devotional: 1, happy: 0.6, chill: 0.6, calm: 0.6 };
// Versions whose mood isn't the original's ("Raataan Lambiyan (Remix)" in a workout list, lo-fi
// edits in a chill list): labelled by their own id only, never by song identity
const VERSION = /\b(remix|lo-?fi|slowed|reverb|sped up|nightcore|8d|mashup|unplugged|reprise|cover|instrumental|karaoke|dj)\b/i;
const LANGUAGE_PAGE = { tamil: "tamil", telugu: "telugu", hindi: "hindi", malayalam: "malayalam", kannada: "kannada", punjabi: "punjabi" };
// How playlists name each language's film music
const LANGUAGE_WORDS = {
  tamil: /\b(tamil|kollywood)\b/i, telugu: /\b(telugu|tollywood)\b/i, hindi: /\b(hindi|bollywood)\b/i,
  malayalam: /\b(malayalam|mollywood)\b/i, kannada: /\b(kannada|sandalwood)\b/i, punjabi: /\bpunjabi\b/i,
};
// From the mood categories (mostly global), keep the playlists for Indian listeners first
const INDIAN = /\b(bollywood|kollywood|tollywood|mollywood|sandalwood|punjabi|desi|hindi|tamil|telugu|malayalam|kannada|indian|carnatic|ghazal|sufi)\b/i;

export const moodOfTitle = (title = "") => TITLE_MOOD.find(([re]) => re.test(title))?.[1] || null;

// ─── State: { at, ids: { videoId: mood }, keys: { songKey: mood } } ───
let index = null;
let learned = null;
const listeners = new Set();
export const onMoodIndexChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const notify = () => listeners.forEach((fn) => { try { fn(); } catch (e) {} });

const storage = () => {
  try { return globalThis.localStorage || null; } catch (e) { return null; }
};
const read = (key) => {
  try { return JSON.parse(storage()?.getItem(key) || "null"); } catch (e) { return null; }
};
const write = (key, value) => {
  try { storage()?.setItem(key, JSON.stringify(value)); } catch (e) {}
};

const loadIndex = () => {
  if (index) return index;
  const saved = read(STORE_KEY);
  index = saved?.ids ? saved : { at: 0, ids: {}, keys: {} };
  return index;
};
const loadLearned = () => {
  if (!learned) learned = read(LEARNED_KEY) || {};
  return learned;
};

// The curated mood of a song, or null
export function indexedMood(track) {
  if (!track?.id && !track?.title) return null;
  const { ids, keys } = loadIndex();
  return ids[track.id] || (track.title ? keys[songKey(track)] : null) || null;
}

// The mood learned from mood requests, or null (weak: used only when nothing else says anything)
export function learnedMood(track) {
  if (!track?.id) return null;
  const votes = loadLearned()[track.id];
  if (!votes) return null;
  const [best, n] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0] || [];
  const total = Object.values(votes).reduce((a, b) => a + b, 0);
  return n >= 1 && n / total >= 0.6 ? best : null;
}

let learnTimer = null;
// Songs returned for an unambiguous mood request ("sad songs", "kuthu songs") vote for that mood
export function learnMoods(tracks, mood) {
  if (!MOODS.includes(mood) || !tracks?.length) return;
  const store = loadLearned();
  for (const t of tracks.slice(0, 20)) {
    if (!t?.id) continue;
    const votes = (store[t.id] ||= {});
    votes[mood] = (votes[mood] || 0) + 1;
  }
  const ids = Object.keys(store);
  if (ids.length > MAX_LEARNED) ids.slice(0, ids.length - MAX_LEARNED).forEach((id) => delete store[id]);
  clearTimeout(learnTimer);
  learnTimer = setTimeout(() => write(LEARNED_KEY, store), 1000);
  notify();
}

// ─── Building the index ───
const runsText = (t) => t?.runs?.map((r) => r.text).join("") || t?.simpleText || "";

async function browse(yt, browseId, params) {
  const res = await yt.actions.execute("/browse", { browseId, ...(params ? { params } : {}), client: "YTMUSIC" });
  return res.data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];
}

// [{ title, id, shelf }] for every playlist on a category page
async function categoryPlaylists(yt, endpoint) {
  const sections = await browse(yt, endpoint.browseId, endpoint.params);
  return sections.flatMap((s) => {
    const shelf = s.gridRenderer || s.musicCarouselShelfRenderer;
    const head = runsText(shelf?.header?.gridHeaderRenderer?.title || shelf?.header?.musicCarouselShelfBasicHeaderRenderer?.title);
    return (shelf?.items || shelf?.contents || [])
      .map((i) => i.musicTwoRowItemRenderer)
      .filter(Boolean)
      .map((r) => ({
        title: runsText(r.title),
        id: String(r.navigationEndpoint?.browseEndpoint?.browseId || "").replace(/^VL/, ""),
        shelf: head,
      }))
      .filter((p) => p.id);
  });
}

// Which mood playlists to read: editorial ones only (ids starting "RDCL"), for the listener's languages
async function choosePlaylists(yt, languages) {
  const sections = await browse(yt, "FEmusic_moods_and_genres");
  const buttons = sections.flatMap((s) => s.gridRenderer?.items || [])
    .map((i) => i.musicNavigationButtonRenderer)
    .filter(Boolean)
    .map((b) => ({ name: runsText(b.buttonText).toLowerCase(), endpoint: b.clickCommand?.browseEndpoint }))
    .filter((b) => b.endpoint?.browseId);
  const wantsEnglish = !languages.length || languages.includes("english");
  const langNames = languages.map((l) => LANGUAGE_PAGE[l]).filter(Boolean);
  const pages = buttons.filter((b) => CATEGORY_MOOD[b.name] || langNames.includes(b.name));
  const lists = await Promise.all(pages.map((b) => categoryPlaylists(yt, b.endpoint)
    .then((playlists) => ({ ...b, playlists }))
    .catch(() => ({ ...b, playlists: [] }))));

  const chosen = new Map(); // id -> { title, mood, priority }
  for (const { name, playlists } of lists) {
    const categoryMood = CATEGORY_MOOD[name] || null;
    for (const p of playlists) {
      if (!p.id.startsWith("RDCL") || chosen.has(p.id)) continue;
      const mood = moodOfTitle(p.title) || (CATEGORY_FALLBACK.has(name) ? categoryMood : null);
      if (!mood) continue; // "Kollywood Hitlist", "Iconic Kollywood Hits": no mood
      const indian = !categoryMood || INDIAN.test(`${p.title} ${p.shelf}`);
      const native = langNames.some((l) => LANGUAGE_WORDS[l].test(`${p.title} ${p.shelf}`));
      if (!indian && !wantsEnglish) continue;
      // Language pages and playlists in their languages first, then other Indian ones, then global
      const priority = !categoryMood || native ? 0 : indian ? 1 : 2;
      const lang = langNames.find((l) => LANGUAGE_WORDS[l].test(`${p.title} ${p.shelf}`)) || (!categoryMood ? name : priority === 2 ? "global" : "indian");
      chosen.set(p.id, { id: p.id, title: p.title, mood, priority, lang });
    }
  }
  // Spread the budget over moods so no single mood takes every slot; English listeners keep a share
  // for global playlists
  const all = [...chosen.values()];
  const globalShare = wantsEnglish ? GLOBAL_PLAYLISTS : 0;
  // Round-robin over (language, mood) pairs: Tamil romance, Hindi sad, Telugu party... each get a
  // playlist before any pair gets a second (the mood categories alone are mostly Bollywood)
  const pick = (pool, budget) => {
    const groups = new Map();
    pool.forEach((p) => {
      const key = `${p.lang}|${p.mood}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    });
    const queues = [...groups.values()];
    const picked = [];
    while (picked.length < budget && queues.some((q) => q.length)) {
      for (const q of queues) {
        if (picked.length >= budget) break;
        if (q.length) picked.push(q.shift());
      }
    }
    return picked;
  };
  const regional = pick(all.filter((p) => p.priority < 2).sort((a, b) => a.priority - b.priority), MAX_PLAYLISTS - globalShare);
  const global = pick(all.filter((p) => p.priority === 2), MAX_PLAYLISTS - regional.length);
  return [...regional, ...global];
}

async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map((x) => fn(x).catch(() => null)))));
  }
  return out;
}

let building = null;
// The last build's playlists ({ id, title, mood, ids }), kept in memory for inspection and evals
let lastBuild = [];
export const moodIndexSources = () => lastBuild;

// Builds (or reuses a fresh) mood index. Resolves to { songs, playlists }; never throws.
export function ensureMoodIndex(yt, { languages = [], force = false } = {}) {
  const current = loadIndex();
  if (!force && current.at && Date.now() - current.at < INDEX_TTL_MS && Object.keys(current.ids).length) {
    return Promise.resolve({ songs: Object.keys(current.ids).length, playlists: current.playlists || 0, cached: true });
  }
  if (building) return building;
  building = (async () => {
    try {
      const playlists = await choosePlaylists(yt, languages);
      const votes = new Map(); // id or key -> { mood: n }
      const vote = (key, mood) => {
        const v = votes.get(key) || {};
        v[mood] = (v[mood] || 0) + SPECIFICITY[mood];
        votes.set(key, v);
      };
      const sources = [];
      const results = await inBatches(playlists, CONCURRENCY, async (p) => {
        const page = await yt.music.getPlaylist(p.id);
        const tracks = (page.items || page.contents || []).map(songToTrack).filter(Boolean);
        tracks.forEach((t) => {
          vote(`id:${t.id}`, p.mood);
          if (!VERSION.test(t.title)) vote(`key:${songKey(t)}`, p.mood);
        });
        sources.push({ ...p, ids: tracks.map((t) => t.id), keys: tracks.map((t) => songKey(t)) });
        return tracks.length;
      });
      lastBuild = sources;
      const winner = (v) => {
        const [best, n] = Object.entries(v).sort((a, b) => b[1] - a[1])[0];
        const total = Object.values(v).reduce((a, b) => a + b, 0);
        return n / total > 0.5 ? best : null; // split evenly between equally specific moods: say nothing
      };
      const next = { at: Date.now(), ids: {}, keys: {}, playlists: results.filter(Boolean).length };
      for (const [k, v] of votes) {
        const mood = winner(v);
        if (!mood) continue;
        if (k.startsWith("id:")) next.ids[k.slice(3)] = mood;
        else next.keys[k.slice(4)] = mood;
      }
      if (!Object.keys(next.ids).length) return { songs: 0, playlists: 0 }; // offline: keep the old one
      index = next;
      write(STORE_KEY, next);
      notify();
      return { songs: Object.keys(next.ids).length, playlists: next.playlists };
    } catch (e) {
      return { songs: Object.keys(loadIndex().ids).length, playlists: 0, error: e.message };
    } finally {
      building = null;
    }
  })();
  return building;
}
