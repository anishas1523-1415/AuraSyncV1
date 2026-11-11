// Spoken requests -> what to do. A transcript is turned into an action plus the words to search;
// the search words then go through the normal request understanding (query.js: languages, moods,
// eras, artists, Tanglish asking words), so speaking and typing behave the same.
//
//   "Play old Ilaiyaraaja romantic songs in Tamil" -> play,    "old ilaiyaraaja romantic songs tamil"
//   "Enakku Ilaiyaraaja songs venum"               -> search,  "enakku ilaiyaraaja songs venum"
//   "Play something similar to this"               -> similar
//   "Find that Vijay song"                         -> search,  "vijay song"
//   "Create a romantic Malayalam playlist"         -> playlist, "romantic malayalam songs"
//   "Play energetic songs for gym"                 -> play,    "energetic songs for gym"
import { normalize } from "./text.js";
import { analyzeQuery } from "./query.js";

// Said to get the app's attention, not part of the request
const WAKE = /^(hey|ok|okay|hi)\s+(aura|aurasynq|aura synq)\b\s*/;
// "something like this", "more songs like this one", "similar to this song"
const SIMILAR = /\b(similar to (this|that|the current|what'?s playing)|(something|songs?|more) like (this|that)|more of (this|that)|same (kind|type|vibe) (of songs?|as this)?)\b/;
// "create / make (me) a ... playlist"
const PLAYLIST = /^(create|make|build|generate)\s+(me\s+)?(a|an|my)?\s*(.*?)\s*playlist\b(.*)$/;
// Leading verbs that say what to do with the songs
const PLAY = /^(play|put on|start|queue|shuffle)\b\s*/;
const FIND = /^(find|search( for)?|look for|show( me)?|get( me)?|i want to hear|i wanna hear|can you play|could you play|please play)\b\s*/;
// Words that only point at a song: "that Vijay song" -> "vijay song", "the song called Kesariya" ->
// "kesariya". Only in these shapes: titles are full of them ("This Is Me", "Why This Kolaveri Di").
const POINTING = /^(that|the|this|those|some)\s+(.+\bsongs?)$/;
const CALLED = /^((the|a)\s+)?(song|track)\s+(called|named|titled)\s+/;
// "in Tamil" -> "tamil": the language stays, the preposition goes
const IN_LANGUAGE = /\bin\s+(tamil|hindi|telugu|malayalam|kannada|english|punjabi|bengali|marathi)\b/g;

const tidy = (text) => text.replace(/\s+/g, " ").trim();

// { action: "play" | "search" | "similar" | "playlist", query, transcript, request }
export function parseVoiceCommand(transcript = "") {
  let text = normalize(transcript).replace(WAKE, "");
  const result = (action, query = "") => {
    const q = tidy(query);
    return { action, query: q, transcript: String(transcript).trim(), request: q ? analyzeQuery(q) : null };
  };
  if (!text) return result("search");

  if (SIMILAR.test(text)) return result("similar");

  const playlist = text.match(PLAYLIST);
  if (playlist) {
    // "create a romantic malayalam playlist" -> "romantic malayalam songs"
    let words = tidy(`${playlist[4]} ${playlist[5]}`.replace(/\b(of|with|for)\b/g, " "));
    if (words && !/\b(songs?|music|hits)\b/.test(words)) words = `${words} songs`;
    return result("playlist", words.replace(IN_LANGUAGE, "$1"));
  }

  let action = "search";
  if (PLAY.test(text)) {
    action = "play";
    text = text.replace(PLAY, "");
  }
  text = text.replace(FIND, "");
  text = text.replace(CALLED, "").replace(IN_LANGUAGE, "$1").replace(POINTING, "$2");
  return result(action, text);
}

// Hesitations a speech engine writes down ("um", "uh") or guesses for unclear sounds
const NOISE = new Set(["um", "uh", "umm", "hmm", "ah", "er", "and", "when"]);

// Speech engines return several guesses; prefer the one the request understanding makes most of
// (names a language, mood, era or "songs", or uses Tamil/Hindi asking words), with fewer
// hesitation words, then the engine's own order
export function bestTranscript(alternatives = []) {
  const list = alternatives.map((t) => String(t || "").trim()).filter(Boolean);
  if (list.length <= 1) return list[0] || "";
  const score = (t, i) => {
    const q = analyzeQuery(t);
    const noise = q.allTokens.filter((w) => NOISE.has(w)).length;
    return (q.isRequest ? 1 : 0) + (q.queryLanguage ? 0.6 : 0) + 0.3 * q.moods.length +
      0.3 * q.languages.length + (q.era ? 0.3 : 0) - 0.25 * noise - 0.2 * i;
  };
  return list.map((t, i) => [t, score(t, i)]).sort((a, b) => b[1] - a[1])[0][0];
}
