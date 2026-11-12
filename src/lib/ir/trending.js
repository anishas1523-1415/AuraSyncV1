// ─── The trending engine: what is genuinely trending, in which language, ranked for one listener ───
// Pure functions (no network, no storage), shared by the phone and the server, so the rules hold
// wherever the charts are read. charts.js fetches the data and calls these; catalog.js ranks.
//
// Pipeline (no step after 2 can add a song):
//   1. candidates      every song on an official chart, with its chart positions
//   2. eligibility     on at least one official chart = trending. Nothing else qualifies:
//                      not likes, not favourite artists, not search results, not the catalogue
//   3. language        track-level evidence decides a song's language (verifyLanguage); a
//                      language pool keeps only songs VERIFIED in that language
//   4. versions        one entry per song: re-uploads and lyric/video copies collapse, originals
//                      win over slowed / remix / cover versions of the same song
//   5. standing        how strongly the song is trending: chart positions + momentum (snapshots)
//   6. ranking         regional / personal / broader / discovery, weighted by how well the app
//                      knows the listener (rankTrending)
//   7. diversity       no runs of one artist or film; songs move down, never out
// If too few songs qualify, fewer are returned. Every candidate gets a diagnostic record.
import { normalize, tokenize, parseTitle, VARIANT_TERMS } from "./text.js";

// ─── Configuration (initial values, to be tuned by evaluation) ───
export const TREND_CONFIG = {
  verifyThreshold: 0.75,     // language support needed for "verified"
  likelyThreshold: 0.45,
  conflictShare: 0.6,        // another language with this share of the top one's support = conflict
  weights: {
    new: { regional: 0.65, personal: 0.15, broader: 0.15, discovery: 0.05 },
    established: { regional: 0.35, personal: 0.45, broader: 0.10, discovery: 0.10 },
  },
  establishedAfter: 30,      // judged songs before a listener counts as established (blend from 5)
  maxPerArtist: 2,           // per page of results, before songs are moved down
  maxPerFilm: 3,
  momentum: { rising: 0.15, new: 0.1, steady: 0, declining: -0.1, evergreen: -0.08 },
};

export const POOL_LANGUAGES = ["tamil", "telugu", "hindi", "malayalam", "kannada", "punjabi", "bengali", "marathi", "bhojpuri", "haryanvi", "english"];
const LANGUAGE_WORDS = {
  tamil: /\b(tamil|kollywood)\b/i, telugu: /\b(telugu|tollywood)\b/i, hindi: /\b(hindi|bollywood)\b/i,
  malayalam: /\b(malayalam|mollywood)\b/i, kannada: /\b(kannada|sandalwood)\b/i, punjabi: /\bpunjabi\b/i,
  bengali: /\b(bengali|bangla)\b/i, marathi: /\bmarathi\b/i, bhojpuri: /\bbhojpuri\b/i, haryanvi: /\bharyanvi\b/i,
  english: /\benglish\b/i,
};
// Data API audio-language codes
export const LANGUAGE_CODES = { ta: "tamil", te: "telugu", hi: "hindi", ml: "malayalam", kn: "kannada", pa: "punjabi", bn: "bengali", mr: "marathi", bho: "bhojpuri", bgc: "haryanvi", en: "english" };
const SCRIPTS = [
  [/[஀-௿]/, "tamil"], [/[ఀ-౿]/, "telugu"], [/[ഀ-ൿ]/, "malayalam"],
  [/[ಀ-೿]/, "kannada"], [/[਀-੿]/, "punjabi"], [/[ঀ-৿]/, "bengali"],
];
// Words in a tag that say nothing about which song it is
const GENERIC = new Set(["song", "songs", "video", "videos", "movie", "movies", "film", "films", "latest", "new", "hit", "hits", "full", "official", "lyric", "lyrical", "music", "audio", "hd", "4k", "8k", "trending", "top", "best", "love", "romantic", "melody", "kuthu", "mass", "gaana", "gana", "folk", "dance", "single", "album", "version", "cinema", "2023", "2024", "2025", "2026", ...Object.keys(LANGUAGE_WORDS), "kollywood", "tollywood", "bollywood", "mollywood", "sandalwood", "bangla"]);

// Evidence weights. Track-level sources describe THIS upload; supporting ones (script, word lists,
// artist priors) can confirm but never decide on their own.
const W = { override: 10, marker: 1, audioLanguage: 0.8, languageChart: 0.6, specificTags: 0.4, genericTags: 0.15, description: 0.1, script: 0.25, classifier: 0.3 };
const TRACK_LEVEL = new Set(["override", "marker", "audioLanguage", "languageChart", "specificTags"]);

// "(Tamil)", "[Telugu Version]", "Hindi Dubbed", "- Malayalam" at the end
export function explicitLanguage(title = "") {
  const t = String(title);
  for (const [lang, re] of Object.entries(LANGUAGE_WORDS)) {
    const word = re.source.replace(/\\b/g, "").replace(/^\(|\)$/g, "");
    if (new RegExp(`[(\\[]\\s*(${word})(\\s+(version|dubbed|song|lyrical|video))?\\s*[)\\]]`, "i").test(t)) return lang;
    if (new RegExp(`\\b(${word})\\s+(version|dubbed)\\b`, "i").test(t)) return lang;
    if (new RegExp(`\\s[-|]\\s*(${word})\\s*$`, "i").test(t)) return lang;
  }
  return null;
}

// Keyword signatures shared by several songs in one batch: a channel's template, not song details
export function findTemplates(detailsById) {
  const counts = new Map();
  const sig = (kw) => kw.map((k) => normalize(k)).sort().join("|");
  for (const d of Object.values(detailsById)) {
    if (!d?.keywords?.length) continue;
    const s = sig(d.keywords);
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  const templates = new Set([...counts].filter(([, n]) => n >= 3).map(([s]) => s));
  return (keywords) => !!keywords?.length && templates.has(sig(keywords));
}

const songTokens = (track) => {
  const { song, film } = parseTitle(track.title);
  return new Set(tokenize(`${song} ${film} ${track.album || ""}`).filter((t) => t.length >= 4 && !GENERIC.has(t)));
};

// ─── Language verification of one song ───
// candidate: { track, charts: [{ chart: "weekly:tamil" | "trending" | ..., rank }] }
// context:   { details: { keywords, description }, trend: { audioLanguage }, override, isTemplate,
//              classify: (track) => { language, confidence, byNeighbours } }
// -> { language, secondary, confidence, status, method, sources, reason }
export function verifyLanguage(candidate, context = {}) {
  const { track, charts = [] } = candidate;
  const support = {};
  const sources = [];
  const add = (source, language, weight, detail) => {
    if (!language || !weight) return;
    support[language] = (support[language] || 0) + weight;
    sources.push({ source, language, weight: +weight.toFixed(3), ...(detail ? { detail } : {}) });
  };

  if (context.override?.language) {
    add("override", context.override.language, W.override, context.override.note);
    return finish({ support, sources, forced: context.override.language });
  }
  add("marker", explicitLanguage(track.title), W.marker);
  const audio = context.trend?.audioLanguage;
  if (audio) add("audioLanguage", LANGUAGE_CODES[audio.split("-")[0]] || null, W.audioLanguage, audio);
  for (const c of charts) {
    const m = /^weekly:(\w+)$/.exec(c.chart);
    if (m && LANGUAGE_WORDS[m[1]]) add("languageChart", m[1], W.languageChart, `#${c.rank + 1}`);
  }
  // Tags: a tag naming a language and something of this song ("karuppu tamil movie songs") is
  // about this song; "Latest Tamil Songs" on every upload of a channel is not
  const keywords = context.details?.keywords || [];
  if (keywords.length) {
    const mine = songTokens(track);
    const template = context.isTemplate?.(keywords);
    const specific = {};
    const generic = {};
    for (const kw of keywords) {
      for (const [lang, re] of Object.entries(LANGUAGE_WORDS)) {
        if (!re.test(kw)) continue;
        const aboutThisSong = !template && tokenize(kw).some((t) => mine.has(t));
        (aboutThisSong ? specific : generic)[lang] = true;
      }
    }
    Object.keys(specific).forEach((l) => add("specificTags", l, W.specificTags));
    Object.keys(generic).filter((l) => !specific[l]).forEach((l) => add("genericTags", l, W.genericTags, template ? "channel template" : null));
  }
  const description = context.details?.description || "";
  for (const [lang, re] of Object.entries(LANGUAGE_WORDS)) if (re.test(description)) add("description", lang, W.description);
  const scriptHit = SCRIPTS.find(([re]) => re.test(track.title || ""));
  if (scriptHit) add("script", scriptHit[1], W.script);
  const c = context.classify?.(track);
  if (c?.language && !c.byNeighbours) add("classifier", c.language, W.classifier * Math.min(1, c.confidence ?? 1), `confidence ${(c.confidence ?? 1).toFixed(2)}`);

  const instrumental = VARIANT_TERMS.instrumental.test(track.title || "") || VARIANT_TERMS.karaoke.test(track.title || "");
  return finish({ support, sources, instrumental, hasAudioLanguage: !!audio });
}

function finish({ support, sources, forced = null, instrumental = false, hasAudioLanguage = false }) {
  const ranked = Object.entries(support).sort((a, b) => b[1] - a[1]);
  const [primary, top = 0] = ranked[0] || [null, 0];
  const [secondary = null, second = 0] = ranked[1] || [];
  const total = ranked.reduce((n, [, v]) => n + v, 0) || 1;
  const confidence = +(Math.min(1, top / 1.5) * (top / total)).toFixed(3);
  const methods = [...new Set(sources.filter((s) => s.language === primary).map((s) => s.source))];
  const base = { language: primary, secondary, confidence, sources, method: methods.join("+") || "none" };
  if (forced) return { ...base, language: forced, confidence: 1, status: "verified", method: "override", reason: "human-verified" };
  if (!primary) return { ...base, status: "uncertain", reason: "no language evidence" };
  const trackLevelFor = (lang) => sources.some((s) => s.language === lang && TRACK_LEVEL.has(s.source));
  const otherMarker = sources.some((s) => s.source === "marker" && s.language !== primary);
  if (otherMarker) return { ...base, status: "conflict", reason: "title marks another language" };
  if (secondary && trackLevelFor(secondary) && second >= TREND_CONFIG.conflictShare * top) {
    return { ...base, status: "conflict", reason: `${primary} and ${secondary} both claimed` };
  }
  // The word lists and artist priors can't make a song Tamil, but when they are sure it's another
  // language and only the chart and generic tags say otherwise, the song isn't verified
  const strong = sources.some((s) => s.language === primary && ["override", "marker", "audioLanguage", "specificTags"].includes(s.source));
  const dissent = sources.find((s) => s.source === "classifier" && s.language !== primary && s.weight >= 0.8 * W.classifier);
  if (dissent && !strong) return { ...base, status: "conflict", reason: `classifier is sure it is ${dissent.language}; only chart and generic tags say ${primary}` };
  if (instrumental && !hasAudioLanguage) return { ...base, status: "uncertain", reason: "instrumental without a verified language" };
  if (top >= TREND_CONFIG.verifyThreshold && trackLevelFor(primary)) return { ...base, status: "verified", reason: `verified by ${base.method}` };
  if (top >= TREND_CONFIG.likelyThreshold) return { ...base, status: "likely", reason: "not enough track-level evidence" };
  return { ...base, status: "uncertain", reason: "weak evidence" };
}

// ─── One entry per song ───
const VERSION_ORDER = ["cover", "karaoke", "instrumental", "slowed", "lofi", "remix", "live", "reprise"];
const versionOf = (track) => parseTitle(track.title).variants.find((v) => VERSION_ORDER.includes(v)) || null;
const baseName = (track) => normalize(parseTitle(track.title).song.replace(/\b(feat|ft)\b.*$/i, ""));
const artistsOf = (track) => new Set(String(track.artist || "").split(/,|&| x | feat\.? | ft\.? /i).map((a) => normalize(a)).filter(Boolean));
const jaccard = (a, b) => {
  if (!a.size || !b.size) return 0;
  let n = 0;
  a.forEach((x) => b.has(x) && (n += 1));
  return n / (a.size + b.size - n);
};

// An upload whose own tags keep naming another charting song (by a name of 2+ words) is that song, under
// another title ("Raavana Suthudae" tagged "raavana mavandaa full song"). Channel templates don't count.
function namesOther(a, b) {
  if (a.template || !a.keywords?.length) return false;
  const name = baseName(b.candidate.track);
  if (name.split(" ").length < 2 || name === baseName(a.candidate.track)) return false;
  const tags = a.keywords.map((k) => normalize(k));
  // Its tags must keep naming the other song (3+ tags) and never its own title: songs of one film
  // often mention the film's other hits once or twice
  const own = baseName(a.candidate.track);
  return tags.filter((k) => k.includes(name)).length >= 3 && !(own && tags.some((k) => k.includes(own)));
}

// items: [{ candidate, standing, keywords, template }] best first. Returns { kept, dropped: [{ item, of, reason }] }
export function collapseVersions(items) {
  const kept = [];
  const dropped = [];
  for (const item of items) {
    const t = item.candidate.track;
    const name = baseName(t);
    const version = versionOf(t);
    const same = kept.find((k) => {
      const o = k.candidate.track;
      if (o.id === t.id) return true;
      if (!name || baseName(o) !== name) return false;
      const filmA = normalize(parseTitle(t.title).film || t.album || "");
      const filmB = normalize(parseTitle(o.title).film || o.album || "");
      const kwA = new Set((item.keywords || []).flatMap((k) => tokenize(k)).filter((x) => x.length > 3 && !GENERIC.has(x)));
      const kwB = new Set((k.keywords || []).flatMap((kw) => tokenize(kw)).filter((x) => x.length > 3 && !GENERIC.has(x)));
      return jaccard(artistsOf(t), artistsOf(o)) > 0 || (filmA && filmA === filmB) || jaccard(kwA, kwB) >= 0.2;
    }) || kept.find((k) => namesOther(item, k) || namesOther(k, item));
    if (!same) { kept.push(item); continue; }
    // An original beats a version of itself even when the version charts higher
    const sameVersion = versionOf(same.candidate.track);
    if (sameVersion && !version) {
      kept[kept.indexOf(same)] = item;
      dropped.push({ item: same, of: t, reason: `${sameVersion} version of a charting original` });
    } else {
      dropped.push({ item, of: same.candidate.track, reason: version ? `${version} version of a charting song` : "another upload of the same song" });
    }
  }
  return { kept, dropped };
}

// ─── Trending standing ───
const CHART_WEIGHTS = { trending: 1.3, daily: 1.1, top: 0.7, weekly: 1.0 };
const positionScore = (rank) => 1 / (1 + rank / 10); // #1 = 1, #10 = 0.5, #30 = 0.25

// How strongly a song trends. regional: its language/region charts; broader: the national charts.
// kind: "now" (regional = the listener's languages' charts) or a language pool
export function trendStanding(candidate, { kind, regionalLanguages = [], trend = null } = {}) {
  let regional = 0;
  let broader = 0;
  for (const c of candidate.charts) {
    const [type, lang] = c.chart.split(":");
    const s = positionScore(c.rank) * (CHART_WEIGHTS[type] || 1);
    if (type === "weekly") {
      if (kind === "now" ? regionalLanguages.includes(lang) : lang === kind) regional = Math.max(regional, s);
    } else {
      broader = Math.max(broader, s / 1.3);
      // In a language pool, a national chart hit in that language is regional trending too
      if (kind !== "now") regional = Math.max(regional, (s / 1.3) * 0.9);
    }
  }
  if (kind === "now" && !regionalLanguages.length) regional = broader; // no languages known: the country is the region
  const status = trend?.status || "unknown";
  const momentum = TREND_CONFIG.momentum[status] || 0;
  const clamp = (v) => Math.max(0, Math.min(1.2, v));
  return { regional: clamp(regional + (regional ? momentum : 0)), broader: clamp(broader + (broader ? momentum : 0)), status, momentum };
}

// ─── Ranking for one listener ───
// items: [{ track, standing }]; listener: { intentFit(track) -> -1..1 | null, judged: number,
// heard(id) -> boolean, rejected(track) -> boolean }. Returns [{ track, score, parts }] best first.
export function rankTrending(items, listener = {}) {
  const judged = listener.judged || 0;
  const m = Math.max(0, Math.min(1, (judged - 5) / (TREND_CONFIG.establishedAfter - 5)));
  const { new: a, established: b } = TREND_CONFIG.weights;
  const w = Object.fromEntries(Object.keys(a).map((k) => [k, a[k] + (b[k] - a[k]) * m]));
  const scored = items.map(({ track, standing }) => {
    const fit = listener.intentFit ? listener.intentFit(track) : null;
    // No profile: everyone gets the same neutral value, so it changes nothing (no invented taste)
    const personal = fit === null || fit === undefined ? 0.5 : Math.max(0, Math.min(1, (fit + 1) / 2));
    const discovery = listener.heard ? (listener.heard(track.id) ? 0.2 : 1) : 0.5;
    const rejected = listener.rejected?.(track) || false;
    const parts = {
      regional: +standing.regional.toFixed(3),
      personal: +(rejected ? 0 : personal).toFixed(3),
      broader: +standing.broader.toFixed(3),
      discovery,
    };
    const score = w.regional * parts.regional + w.personal * parts.personal + w.broader * parts.broader + w.discovery * parts.discovery - (rejected ? 0.5 : 0);
    return { track, score: +score.toFixed(4), parts, rejected, weights: w };
  });
  return scored.sort((x, y) => y.score - x.score);
}

// No runs of one artist or film: songs over the limit move down (in order), never out
export function spreadOut(scored, { maxPerArtist = TREND_CONFIG.maxPerArtist, maxPerFilm = TREND_CONFIG.maxPerFilm, window = 12 } = {}) {
  const out = [];
  const later = [];
  const artistCount = new Map();
  const filmCount = new Map();
  for (const item of scored) {
    const t = item.track;
    const artist = [...artistsOf(t)][0] || "";
    const film = normalize(parseTitle(t.title).film || t.album || "");
    const tooMany = out.length < window && ((artist && (artistCount.get(artist) || 0) >= maxPerArtist) || (film && (filmCount.get(film) || 0) >= maxPerFilm));
    if (tooMany) { later.push(item); continue; }
    out.push(item);
    artistCount.set(artist, (artistCount.get(artist) || 0) + 1);
    if (film) filmCount.set(film, (filmCount.get(film) || 0) + 1);
  }
  return [...out, ...later];
}
