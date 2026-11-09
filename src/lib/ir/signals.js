// Shared ranking signals: regional language preference, trending boost, mood compatibility.
import { classifyTrack } from "./classify.js";

// Languages by device locale, used until listening history says otherwise
const LOCALE_LANGUAGES = { ta: "tamil", hi: "hindi", te: "telugu", ml: "malayalam", kn: "kannada", pa: "punjabi", bn: "bengali", mr: "marathi" };

// The listener's languages, strongest first: from their taste profile, else the phone's locale
export function regionalLanguages(profile) {
  const learned = Object.entries(profile || {})
    .filter(([k, v]) => k.startsWith("lang:") && v > 0.05)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k.slice(5));
  if (learned.length) return learned.slice(0, 3);
  const locale = typeof navigator !== "undefined" ? String(navigator.language || "") : "";
  const lang = LOCALE_LANGUAGES[locale.split("-")[0]];
  return lang ? [lang] : [];
}

// +0.15 for the listener's main language, smaller for their others, -0.12 for one they never play
export function regionalScore(track, languages) {
  if (!languages?.length) return 0;
  const lang = classifyTrack(track).language;
  if (!lang) return 0;
  const i = languages.indexOf(lang);
  if (i === 0) return 0.15;
  if (i > 0) return 0.08;
  return -0.12;
}

// Trending: songs on the current trending lists, and very popular songs in general
export function trendScore(track, trendingIds) {
  let s = 0;
  if (trendingIds?.has?.(track.id)) s += 0.12;
  if (track.plays) s += 0.06 * Math.min(1, Math.log10(track.plays + 1) / 9);
  return s;
}

// Moods that sit well together after one another, and ones that clash
const CLASH = {
  sad: ["party", "energetic", "happy"],
  calm: ["party", "energetic"],
  romantic: ["energetic"],
  party: ["sad", "calm", "devotional"],
  energetic: ["sad", "calm", "romantic"],
  devotional: ["party"],
  happy: ["sad"],
  chill: ["party"],
};

// Same mood +0.1, clashing mood -0.15, unknown 0; same language +0.1, different -0.15
export function continuityScore(current, track) {
  if (!current) return 0;
  const a = classifyTrack(current);
  const b = classifyTrack(track);
  let s = 0;
  if (a.mood && b.mood) s += a.mood === b.mood ? 0.1 : CLASH[a.mood]?.includes(b.mood) ? -0.15 : 0;
  if (a.language && b.language) s += a.language === b.language ? 0.1 : -0.15;
  return s;
}
