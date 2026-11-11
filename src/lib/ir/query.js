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
  // Activities and genres people ask for by name
  driving: { mood: "happy", expand: ["driving songs", "road trip songs"] },
  study: { mood: "calm", expand: ["study music", "focus songs"] },
  studying: { mood: "calm", expand: ["study music", "focus songs"] },
  focus: { mood: "calm", expand: ["focus songs", "study music"] },
  running: { mood: "energetic", expand: ["running songs", "workout songs"] },
  wedding: { mood: "party", expand: ["wedding songs", "dance songs"] },
  gaana: { mood: "party", expand: ["gaana songs", "kuthu songs"] },
};

// Words that ask for music rather than name it ("enaku ... venum", "mujhe ... sunao", "i want ...").
// They are dropped only from requests (see isRequest), never from a title like "I Want It That Way".
// Native-language request words also say which language the listener is typing in.
const REQUEST_WORDS = {
  tamil: ["enaku", "enakku", "venum", "vendum", "podu", "poodu", "kekanum", "kekkanum"],
  hindi: ["mujhe", "chahiye", "sunao", "bajao", "lagao", "sunna", "sunni"],
  english: ["i", "want", "need", "some", "please", "give", "me", "for", "listen", "something", "any", "can", "you", "put", "on"],
};
const REQUEST_LANGUAGE = Object.fromEntries(
  Object.entries(REQUEST_WORDS).flatMap(([lang, words]) => words.map((w) => [w, lang])),
);
// "I" in a request ("naan sad songs kekanum", "main sad songs sunna chahta hoon"). These are also
// names ("Naan" is a film, "Main Hoon Na" a title), so they count as asking words only when another
// asking word is in the same request.
const PRONOUNS = {
  tamil: ["naan", "nan", "naanum"],
  hindi: ["main", "mai", "hoon", "hun", "chahta", "chahti"],
};
const PRONOUN_LANGUAGE = Object.fromEntries(
  Object.entries(PRONOUNS).flatMap(([lang, words]) => words.map((w) => [w, lang])),
);
// Words that show the text is a request for songs, not a song title
const SONG_WORDS = new Set(["song", "songs", "music", "hits", "paatu", "paattu", "padal", "paadal", "gaane", "gaana"]);
// "Song(s)" in Tamil, Malayalam and Hindi: read as "songs" in a request ("tamil pattu podu" ->
// "tamil songs"), not as a name. Alone ("pattu") it stays a name: there's an artist called Pattu.
const NATIVE_SONG = new Set(["pattu", "paatu", "paattu", "pattugal", "paatugal", "paadalgal", "padal", "paadal", "paatta", "gaane", "geet", "geeth"]);

// "90s", "80's", "2000s", "1990s" -> an era
const ERA = /^(19|20)?\d0s$/;

// "master movie songs", "jailer bgm", "96 soundtrack" -> the film/album name
const ALBUM_PATTERN = /^(.+?)\s+(movie|film|padam|album|ost|soundtrack|jukebox)\b/i;
const SONGS_SUFFIX = /^(.+?)\s+(songs|song|hits)$/i;

export function analyzeQuery(raw = "") {
  const text = normalize(raw);
  const allTokens = tokenize(raw);
  const languages = [...new Set(allTokens.map((t) => LANGUAGE_WORDS[t]).filter(Boolean))];
  const moodWords = allTokens.filter((t) => MOODS[t]);
  const era = allTokens.find((t) => ERA.test(t)) || "";
  const variants = Object.keys(VARIANT_TERMS).filter((v) => VARIANT_TERMS[v].test(raw));

  // A request names a mood, activity, language, era or "songs"; a bare title does none of these
  const nativeSong = allTokens.length > 1 && allTokens.some((t) => NATIVE_SONG.has(t));
  const isRequest = !!(moodWords.length || languages.length || era || nativeSong || allTokens.some((t) => SONG_WORDS.has(t) && !NATIVE_SONG.has(t)));
  const asking = isRequest ? allTokens.filter((t) => REQUEST_LANGUAGE[t]) : [];
  // Pronouns go too, but only beside a real asking word ("naan ... kekanum", not "naan songs")
  const pronouns = asking.length ? allTokens.filter((t) => PRONOUN_LANGUAGE[t]) : [];
  const dropped = new Set([...asking, ...pronouns]);
  const requestWords = [...asking, ...pronouns];
  const tokens = isRequest
    ? allTokens.filter((t) => !dropped.has(t)).map((t) => (nativeSong && NATIVE_SONG.has(t) ? "songs" : t))
    : allTokens;
  // The language the listener typed in (Tanglish "enaku ... venum" -> tamil), not the language of the
  // songs they asked for: a hint, used only when the request and their taste name none
  const queryLanguage = requestWords.map((w) => REQUEST_LANGUAGE[w] || PRONOUN_LANGUAGE[w]).find((l) => l !== "english") || null;
  // What to send to the music search: the request without its asking words
  const searchText = tokens.join(" ");
  const content = tokens.filter((t) => !STOPWORDS.has(t));

  // Words left after removing languages, moods, era and request words: the "topic"
  const topic = content.filter((t) => !LANGUAGE_WORDS[t] && !MOODS[t] && t !== era);
  const notFacet = (t) => !LANGUAGE_WORDS[t] && !MOODS[t] && t !== era;

  let intent = "song";
  let entity = "";
  const albumMatch = searchText.match(ALBUM_PATTERN);
  const songsMatch = searchText.match(SONGS_SUFFIX);
  if (!topic.length && (moodWords.length || languages.length || era)) {
    intent = "mood"; // "sad tamil songs", "workout", "tamil", "90s hindi romantic songs"
  } else if (albumMatch && topic.length) {
    intent = "album";
    entity = albumMatch[1];
  } else if (songsMatch && topic.length && topic.length <= 4) {
    intent = "album_or_artist"; // "jailer songs" (film) or "anirudh songs" (artist): decided later
    entity = songsMatch[1].split(" ").filter(notFacet).join(" ");
  } else if ((moodWords.length || era) && topic.length && topic.length <= 3) {
    intent = "album_or_artist"; // "sid sriram melody", "vijay songs for gym": a name plus a mood
    entity = topic.join(" ");
  } else if (topic.length <= 3 && !moodWords.length && tokens.length <= 3) {
    intent = "song_or_artist"; // "kesariya", "anirudh", "sid sriram"
    entity = topic.join(" ");
  }

  const moods = [...new Set(moodWords.map((w) => MOODS[w].mood))];
  // Widened searches carry the requested language (else the typing language) and the era:
  // "90s hindi romantic songs" -> "hindi 90s romantic songs", "hindi 90s love songs"
  const expandLanguage = languages[0] || queryLanguage || "";
  const bases = [...new Set(moodWords.flatMap((w) => MOODS[w].expand))];
  if (!bases.length && era) bases.push("songs", "hit songs");
  const expansions = bases.map((e) => [expandLanguage, era, e].filter(Boolean).join(" "));

  return {
    raw, text, tokens, allTokens, content, topic, intent, entity, languages, queryLanguage, era, moods,
    variants, expansions, bases, isRequest, searchText,
  };
}
