// Text processing for song retrieval (query pre-processing and title entity extraction).
// Pure functions shared by the app, the server search route and scripts/ir-eval.mjs.

// Words that describe the request rather than the song ("tamil love songs" -> love, tamil)
export const STOPWORDS = new Set([
  "song", "songs", "music", "lyrics", "lyric", "lyrical", "video", "videos", "audio", "full", "hd",
  "4k", "official", "the", "a", "an", "of", "and", "by", "from", "movie", "film", "track", "tracks",
  "mp3", "download", "play", "latest", "new", "all", "best", "hit", "hits", "top", "superhit",
]);

// Versions people only want when they ask for them
export const VARIANT_TERMS = {
  live: /\blive\b|\bconcert\b|\bunplugged\b/i,
  cover: /\bcover\b|\btribute\b|\bfemale version\b|\bmale version\b/i,
  karaoke: /\bkaraoke\b|\bwithout vocals\b/i,
  instrumental: /\binstrumental\b|\bbgm\b|\bbackground score\b|\btheme\b|\bflute\b|\bpiano version\b/i,
  slowed: /\bslowed\b|\breverb\b|\bsped up\b|\bnightcore\b|\b8d\b/i,
  lofi: /\blo-?fi\b/i,
  remix: /\bremix\b|\bmashup\b|\bdj\b/i,
  reprise: /\breprise\b|\bunplugged\b|\bacoustic\b/i,
};

// Strip accents, lowercase, keep letters/digits (any script) and spaces
export function normalize(text = "") {
  return String(text)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export const tokenize = (text) => normalize(text).split(" ").filter(Boolean);
export const contentTokens = (text) => tokenize(text).filter((t) => !STOPWORDS.has(t));

// Romanised Tamil/Hindi/Telugu is spelt many ways (kaadhal / kadhal / kathal, vaathi / vathi,
// comming / coming). A phonetic key folds those spellings together, Soundex-style.
export function phoneticKey(token = "") {
  return token
    .toLowerCase()
    .replace(/(ph)/g, "f")
    .replace(/(zh)/g, "l")
    .replace(/(th|dh)/g, "t")
    .replace(/(kh|gh)/g, "k")
    .replace(/(bh)/g, "b")
    .replace(/(sh|ch)/g, "s")
    .replace(/w/g, "v")
    .replace(/y$/g, "i")
    .replace(/[aeiou]+/g, (v, i) => (i === 0 ? "a" : "")) // keep only a leading vowel
    .replace(/(.)\1+/g, "$1"); // doubled letters
}

// Damerau-Levenshtein distance (adjacent swaps count as one edit), for typos
export function editDistance(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m || !n) return m || n;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

// How well a query term matches a document term: 1 exact, 0.85 same sound, 0.7 one typo, else 0
export function termMatch(q, t) {
  if (q === t) return 1;
  if (q.length >= 3 && t.startsWith(q)) return 0.8; // prefix while typing
  // Short keys collide too easily (love / live), so sound-alike matching needs some length
  if (q.length >= 4) {
    const key = phoneticKey(q);
    if ((q.length >= 5 || key.length >= 3) && key === phoneticKey(t)) return 0.85;
  }
  if (q.length >= 5 && Math.abs(q.length - t.length) <= 1 && editDistance(q, t) <= 1) return 0.7;
  return 0;
}

// ─── Entity extraction from raw titles (rule-based) ───
// "Arabic Kuthu - Halamithi Habibo (From "Beast")"  -> song, film "Beast"
// "Vaathi Coming | Master | Thalapathy Vijay | Anirudh" -> song, film/credits
// "Hukum - Thalaivar Alappara - Tamil (From "Jailer")" -> song, film, language "tamil"
const LANGUAGES = ["tamil", "hindi", "telugu", "malayalam", "kannada", "english", "punjabi", "bengali", "marathi"];

export function parseTitle(title = "") {
  const raw = String(title);
  const film = (raw.match(/\(\s*from\s+["“]?([^"”)]+)["”]?\s*\)/i) || raw.match(/\bfrom\s+["“]([^"”]+)["”]/i) || [])[1] || "";
  const variants = Object.keys(VARIANT_TERMS).filter((v) => VARIANT_TERMS[v].test(raw));
  const lowered = raw.toLowerCase();
  const language = LANGUAGES.find((l) => new RegExp(`\\b${l}\\b`).test(lowered)) || "";
  // The song name is what comes before brackets, " | " credits or " - " subtitles
  const song = raw
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .split(/\s[|•]\s|\s-\s/)[0]
    .replace(/\b(official|lyric(al)?|video|audio|song|full|hd|4k)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { song: song || raw.trim(), film: film.trim(), variants, language };
}

// Key that is the same for every upload/version-less copy of one song
export function songKey(track) {
  const { song } = parseTitle(track?.title);
  const artist = normalize(String(track?.artist || "").split(/,|&| x | feat/i)[0]);
  return `${tokenize(song).map(phoneticKey).join(" ")}|${phoneticKey(artist.split(" ")[0] || "")}`;
}

// Word shingles and Jaccard similarity, for near-duplicate titles
export function jaccard(a, b) {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}
