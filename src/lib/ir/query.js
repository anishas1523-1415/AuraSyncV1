// Query understanding: what kind of request is this, and which words carry its meaning.
import { normalize, tokenize, STOPWORDS, VARIANT_TERMS } from "./text.js";

export const LANGUAGE_WORDS = {
  tamil: "tamil", kollywood: "tamil", hindi: "hindi", bollywood: "hindi", telugu: "telugu",
  tollywood: "telugu", malayalam: "malayalam", kannada: "kannada", english: "english",
  punjabi: "punjabi", bengali: "bengali", marathi: "marathi", korean: "korean", kpop: "korean",
};

// Mood / genre thesaurus: a request word -> the moods it means, and searches that widen recall
// (thesaurus-based query expansion)
export const MOODS = {
  sad: { mood: "sad", expand: ["sad songs", "emotional songs", "heartbreak songs", "pain songs"] },
  emotional: { mood: "sad", expand: ["emotional songs", "sad songs"] },
  breakup: { mood: "sad", expand: ["breakup songs", "heartbreak songs", "sad songs"] },
  heartbreak: { mood: "sad", expand: ["heartbreak songs", "sad songs"] },
  love: { mood: "romantic", expand: ["love songs", "romantic songs", "melody songs"] },
  romantic: { mood: "romantic", expand: ["romantic songs", "love songs"] },
  melody: { mood: "romantic", expand: ["melody songs", "soft melody songs", "love songs"] },
  kuthu: { mood: "party", expand: ["kuthu songs", "mass songs", "dance songs"] },
  mass: { mood: "party", expand: ["mass songs", "kuthu songs", "hero intro songs"] },
  party: { mood: "party", expand: ["party songs", "dance songs", "club songs"] },
  dance: { mood: "party", expand: ["dance songs", "party songs"] },
  workout: { mood: "energetic", expand: ["workout songs", "gym songs", "motivation songs"] },
  gym: { mood: "energetic", expand: ["gym songs", "workout songs"] },
  motivation: { mood: "energetic", expand: ["motivation songs", "inspirational songs"] },
  phonk: { mood: "energetic", expand: ["phonk", "drift phonk"] },
  chill: { mood: "chill", expand: ["chill songs", "lofi songs", "relaxing songs"] },
  lofi: { mood: "chill", expand: ["lofi songs", "chill songs"] },
  relax: { mood: "chill", expand: ["relaxing songs", "calm songs"] },
  sleep: { mood: "calm", expand: ["sleep songs", "calm songs", "lullaby"] },
  calm: { mood: "calm", expand: ["calm songs", "peaceful songs"] },
  peaceful: { mood: "calm", expand: ["peaceful songs", "calm songs"] },
  devotional: { mood: "devotional", expand: ["devotional songs", "bhakti songs"] },
  bhakti: { mood: "devotional", expand: ["bhakti songs", "devotional songs"] },
  rap: { mood: "energetic", expand: ["rap songs", "hip hop songs"] },
  hiphop: { mood: "energetic", expand: ["hip hop songs", "rap songs"] },
  rock: { mood: "energetic", expand: ["rock songs"] },
  happy: { mood: "happy", expand: ["happy songs", "feel good songs"] },
  feelgood: { mood: "happy", expand: ["feel good songs", "happy songs"] },
  travel: { mood: "happy", expand: ["travel songs", "road trip songs"] },
  folk: { mood: "folk", expand: ["folk songs"] },
  classical: { mood: "calm", expand: ["classical songs", "carnatic songs"] },
  old: { mood: "retro", expand: ["old songs", "evergreen songs", "retro songs"] },
  retro: { mood: "retro", expand: ["retro songs", "old songs"] },
  evergreen: { mood: "retro", expand: ["evergreen songs", "old songs"] },
};

// "master movie songs", "jailer bgm", "96 soundtrack" -> the film/album name
const ALBUM_PATTERN = /^(.+?)\s+(movie|film|padam|album|ost|soundtrack|jukebox)\b/i;
const SONGS_SUFFIX = /^(.+?)\s+(songs|song|hits)$/i;

export function analyzeQuery(raw = "") {
  const text = normalize(raw);
  const tokens = tokenize(raw);
  const content = tokens.filter((t) => !STOPWORDS.has(t));
  const languages = [...new Set(tokens.map((t) => LANGUAGE_WORDS[t]).filter(Boolean))];
  const moodWords = tokens.filter((t) => MOODS[t]);
  const variants = Object.keys(VARIANT_TERMS).filter((v) => VARIANT_TERMS[v].test(raw));

  // Words left after removing languages, moods and request words: the "topic"
  const topic = content.filter((t) => !LANGUAGE_WORDS[t] && !MOODS[t]);

  let intent = "song";
  let entity = "";
  const albumMatch = text.match(ALBUM_PATTERN);
  const songsMatch = text.match(SONGS_SUFFIX);
  if (!topic.length && (moodWords.length || languages.length)) {
    intent = "mood"; // "sad tamil songs", "workout", "tamil"
  } else if (albumMatch && topic.length) {
    intent = "album";
    entity = albumMatch[1];
  } else if (songsMatch && topic.length && topic.length <= 4) {
    intent = "album_or_artist"; // "jailer songs" (film) or "anirudh songs" (artist): decided later
    entity = songsMatch[1].split(" ").filter((t) => !LANGUAGE_WORDS[t] && !MOODS[t]).join(" ");
  } else if (topic.length <= 3 && !moodWords.length && tokens.length <= 3) {
    intent = "song_or_artist"; // "kesariya", "anirudh", "sid sriram"
    entity = topic.join(" ");
  }

  const moods = [...new Set(moodWords.map((w) => MOODS[w].mood))];
  const expansions = [...new Set(moodWords.flatMap((w) => MOODS[w].expand))]
    .map((e) => (languages[0] ? `${languages[0]} ${e}` : e));

  return { raw, text, tokens, content, topic, intent, entity, languages, moods, variants, expansions };
}
