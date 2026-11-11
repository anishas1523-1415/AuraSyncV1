// Song search: query understanding -> several retrievals in parallel (meta-search) -> rank fusion
// -> BM25 + priors + personal taste -> near-duplicate collapse -> pseudo-relevance feedback.
// `getClient` resolves to a youtubei.js Innertube instance (server, phone or the eval script).
import { analyzeQuery } from "./query.js";
import { normalize, tokenize, jaccard, termMatch, parseTitle, STOPWORDS } from "./text.js";
import { bm25Scores, coverage, reciprocalRankFusion, qualityPrior, collapseDuplicates, cosine } from "./rank.js";
import { classifyTrack, classifyList, trackFeatures } from "./classify.js";
import { regionalLanguages, regionalScore, trendScore } from "./signals.js";
import { songToTrack, isPlayableSong, musicRadio } from "../musicTracks.js";
import { learnMoods } from "./moods.js";

const RESULTS = 30;

const shelfOf = (res) => res?.songs ?? res?.albums ?? res?.artists ?? res?.contents?.find((c) => c?.contents?.length);
const nameOf = (item) => String(item?.name || item?.title || "").trim();

// Album/film names carry suffixes the listener never types
const albumCore = (title = "") => normalize(title
  .replace(/\((original )?(motion picture )?(sound ?track|ost|background score|original score)[^)]*\)/i, " ")
  .replace(/\b(original motion picture soundtrack|soundtrack|ost)\b/gi, " "));

// Share of the typed words found in a real name, tolerant of romanisation and typos (0..1):
// "anirudh" -> "Anirudh Ravichander" 1, "kavala" -> "Kaavaalaa" 0.85
function nameMatch(typed, real) {
  const q = tokenize(typed);
  const t = tokenize(real);
  if (!q.length || !t.length) return 0;
  return q.reduce((n, w) => n + Math.max(0, ...t.map((x) => termMatch(w, x))), 0) / q.length;
}

export function createSearch(getClient) {
  async function songSearch(query) {
    const yt = await getClient();
    const res = await yt.music.search(query, { type: "song" });
    return (shelfOf(res)?.contents || []).map(songToTrack).filter(isPlayableSong);
  }

  // "master movie songs" -> the film's soundtrack album, in order. Several albums share a name
  // ("Leo" the Netflix film, "Leo (Telugu)"), so the pick must agree with the song results: same
  // composer, songs credited "From <film>" (mutual reinforcement between the two result lists).
  async function filmAlbum(name, { wantsScore, languages, songsPromise }) {
    const yt = await getClient();
    const [plain, ost, songs] = await Promise.all([
      yt.music.search(name, { type: "album" }).catch(() => null),
      yt.music.search(`${name} original motion picture soundtrack`, { type: "album" }).catch(() => null),
      songsPromise,
    ]);
    const albums = [...(shelfOf(plain)?.contents || []).slice(0, 6), ...(shelfOf(ost)?.contents || []).slice(0, 6)]
      .filter((a, i, all) => a?.id && all.findIndex((b) => b.id === a.id) === i);
    // Composers of songs the song search credits to this film
    const filmArtists = new Set((songs || [])
      .filter((t) => nameMatch(name, parseTitle(t.title).film || t.album || "") >= 0.9)
      .flatMap((t) => String(t.artist).split(/,|&/).map((a) => normalize(a)).filter(Boolean)));
    let best = null;
    let bestScore = 0;
    for (const album of albums) {
      const title = nameOf(album);
      const subtitle = album.flex_columns?.[1]?.title?.toString() || "";
      const core = albumCore(title.replace(/\((tamil|telugu|hindi|malayalam|kannada)\)/i, ""));
      let score = nameMatch(name, core) + 0.2 * jaccard(name, core); // "Leo" over "Victor & Leo"
      if (/soundtrack|motion picture/i.test(title)) score += 0.25;
      if (/background score|original score/i.test(title)) score += wantsScore ? 0.3 : -0.4;
      if (/^single/i.test(subtitle)) score -= 0.3;
      const credited = normalize(subtitle.split(" • ")[1] || "");
      if (credited && [...filmArtists].some((a) => credited.includes(a) || a.includes(credited))) score += 0.5;
      const dubbed = title.match(/\((tamil|telugu|hindi|malayalam|kannada)\)/i)?.[1]?.toLowerCase();
      if (dubbed) score += languages.includes(dubbed) ? 0.2 : -0.35; // another language's version
      if (score > bestScore) { bestScore = score; best = album; }
    }
    if (!best?.id || bestScore < 0.75) return null;
    const album = await yt.music.getAlbum(best.id);
    const albumTitle = album.header?.title?.toString() || nameOf(best);
    const albumArtist = album.header?.strapline_text_one?.toString() || album.header?.author?.name ||
      (best.flex_columns?.[1]?.title?.toString() || "").split(" • ")[1] || "";
    const cover = [...(album.header?.thumbnail?.contents || best.thumbnails || [])]
      .sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url?.replace(/=w\d+-h\d+/, "=w544-h544");
    return (album.contents || [])
      .map((item) => songToTrack(item))
      .filter(Boolean)
      .map((t) => ({
        ...t,
        artist: t.artist === "Unknown Artist" ? albumArtist || t.artist : t.artist,
        cover: t.cover?.includes("hqdefault") && cover ? cover : t.cover,
        album: albumTitle,
      }))
      // Album rows are songs by definition; some layouts omit their length, so don't require it
      .filter((t) => !t.duration || isPlayableSong(t));
  }

  // "anirudh" / "sid sriram songs" -> that artist's top songs, if the name really is an artist
  async function artistTopSongs(name) {
    const yt = await getClient();
    const res = await yt.music.search(name, { type: "artist" });
    const artist = shelfOf(res)?.contents?.[0];
    if (!artist?.id || nameMatch(name, nameOf(artist)) < 0.85) return null;
    const page = await yt.music.getArtist(artist.id);
    const top = page.sections?.find((s) => /top songs|songs/i.test(s.title?.toString?.() || s.header?.title?.toString?.() || ""));
    const tracks = (top?.contents || []).map(songToTrack).filter(Boolean)
      .map((t) => (t.artist === "Unknown Artist" ? { ...t, artist: nameOf(artist) } : t));
    return { name: nameOf(artist), tracks };
  }

  async function suggestion(query) {
    try {
      const yt = await getClient();
      const sections = await yt.music.getSearchSuggestions(query);
      const texts = (sections || []).flatMap((s) => (s.contents || []).map((c) => c.suggestion?.toString?.() || ""));
      return texts.find((t) => t && normalize(t) !== normalize(query)) || null;
    } catch (e) {
      return null;
    }
  }

  // `spoken`: the whole sentence a voice search heard ("play that song from leo where vijay
  // dances"). It's also sent to YouTube Music as is, the way YouTube's own voice search works, and
  // what YouTube Music finds for it is trusted rather than filtered for word overlap.
  async function search(raw, { profile = null, trending = null, spoken = "" } = {}) {
    const q = analyzeQuery(raw);
    if (!q.text) return [];
    const safe = (p) => p.catch(() => null);
    const wantsScore = /\b(bgm|score|theme)\b/.test(q.text);

    // Songs' language: the one asked for, else the listener's, else the language they typed in
    const languages = q.languages.length ? q.languages
      : topLanguages(profile).length ? topLanguages(profile) : q.queryLanguage ? [q.queryLanguage] : [];
    // Requests are searched without their asking words ("enaku melody songs venum" -> "melody songs").
    // Dropping native asking words ("mujhe ... sunao") also drops their language, so a mood request
    // typed in one keeps a language: "hindi sad songs", not English "sad songs"
    let mainQuery = q.isRequest && q.searchText ? q.searchText : raw;
    if (q.queryLanguage && !q.languages.length && q.intent === "mood" && languages[0]) {
      mainQuery = `${languages[0]} ${mainQuery}`;
    }
    const songsPromise = safe(songSearch(mainQuery));
    // The whole spoken sentence is searched too, but only when it says more than the parsed words
    // (at least two meaningful words they left out): "play kesariya" doesn't need a second search,
    // "play that song from leo where vijay dances" does
    const sentence = String(spoken || "").trim();
    const parsedWords = new Set(tokenize(mainQuery));
    const extraWords = tokenize(sentence).filter((w) => !parsedWords.has(w) && !STOPWORDS.has(w) && w.length > 2);
    const spokenPromise = sentence && extraWords.length >= 2 ? safe(songSearch(sentence)) : Promise.resolve(null);
    // A name plus a mood ("ilaiyaraaja melody", "vijay songs for gym"): also search the name with
    // each mood ("vijay gym songs"); used only if the name turns out to be an artist or a film
    const nameMood = q.intent === "album_or_artist" && q.bases.length && q.entity;
    const [songs, albumRaw, artistRaw, ...expanded] = await Promise.all([
      songsPromise,
      q.intent === "album" || q.intent === "album_or_artist"
        ? safe(filmAlbum(q.entity, { wantsScore, languages, songsPromise })) : null,
      q.intent === "album_or_artist" || q.intent === "song_or_artist" ? safe(artistTopSongs(q.entity)) : null,
      ...(q.intent === "mood" ? q.expansions.slice(0, 2).map((e) => safe(songSearch(e))) : []),
      ...(nameMood ? q.bases.slice(0, 2).map((b) => safe(songSearch(`${q.entity} ${b}`))) : []),
    ]);

    // "kavala song" names a song, not the artist "Kavala": when the best song hit is titled like
    // the request, it's a song search and the artist/album guesses are dropped
    const top = (songs || [])[0];
    const titledLikeQuery = top && q.intent !== "album" && nameMatch(q.entity, parseTitle(top.title).song) >= 0.8;
    // A film's soundtrack beats a same-named artist ("leo songs" is the film, not Leo Middea), but only
    // when the album is named just that: "vijay" is the singer, not the dub "Vijay the Master"
    const albumName = albumCore(String(albumRaw?.[0]?.album || "").replace(/\((tamil|telugu|hindi|malayalam|kannada)\)/i, ""));
    const albumExact = !!albumRaw?.length && nameMatch(albumName, q.entity) >= 0.8;
    const artistFound = !!artistRaw?.tracks?.length;
    const album = titledLikeQuery || (artistFound && !albumExact) ? null : albumRaw;
    const artist = titledLikeQuery || album?.length ? null : artistRaw;
    // "arabic kuthu" is a title that happens to contain a mood word: treat it as a song search
    const intent = titledLikeQuery && q.intent === "album_or_artist" ? "song" : q.intent;

    const spokenTracks = await spokenPromise;
    const lists = [{ tracks: songs || [], weight: 1 }];
    if (spokenTracks?.length) lists.push({ tracks: spokenTracks, weight: 0.8 });
    if (album?.length) lists.push({ tracks: album, weight: 1.6 });
    if (artist?.tracks?.length) lists.push({ tracks: artist.tracks, weight: 1.2 });
    // (Mood expansions run only for mood requests, name + mood searches only for name requests)
    const nameResolved = !!(album?.length || artist?.tracks?.length);
    expanded.forEach((tracks) => {
      if (nameMood && !nameResolved) return; // the name wasn't an artist or a film
      if (tracks?.length) lists.push({ tracks, weight: nameMood ? 0.9 : 0.7 });
    });

    const moods = intent === "song" ? [] : q.moods;
    // YouTube Music's own answers to the spoken sentence, by rank
    // (only the top few: further down, YouTube's answers to a long sentence get noisy)
    const trusted = new Map((spokenTracks || []).slice(0, 3).map((t, i) => [t.id, i]));
    const ctx = { profile, album, artist, trending, moods, languageHint: q.queryLanguage, trusted };
    let ranked = score([q], reciprocalRankFusion(lists), ctx);

    // Weak matches: try YouTube Music's spelling suggestion ("vathi comming" -> "vaathi coming")
    if (intent !== "mood" && (!ranked.length || ranked[0].cov < 0.6)) {
      const corrected = await suggestion(mainQuery);
      if (corrected) {
        const extra = await safe(songSearch(corrected));
        if (extra?.length) {
          lists.push({ tracks: extra, weight: 1.3 });
          // Score against both spellings, so neither the typed nor the corrected words lose out
          ranked = score([q, analyzeQuery(corrected)], reciprocalRankFusion(lists), ctx);
        }
      }
    }

    ranked = collapseDuplicates(ranked);

    // An unambiguous mood request ("sad tamil songs") is evidence for the mood of what it returns
    if (q.intent === "mood" && q.moods.length === 1) learnMoods(ranked.slice(0, 20).map((r) => r.track), q.moods[0]);

    // Precision: for a specific song, drop results that share nothing with the query and fill the
    // tail with songs like the top hit instead (pseudo-relevance feedback: assume it's relevant)
    if (intent === "song" || intent === "song_or_artist") {
      const strong = ranked.filter((r) => r.cov >= 0.5 || r.boosted);
      if (strong.length && strong.length < ranked.length) {
        let related = [];
        try {
          related = await musicRadio(await getClient(), strong[0].track.id);
        } catch (e) {}
        const have = new Set(strong.map((r) => r.track.id));
        const tail = related.filter((t) => !have.has(t.id)).map((track) => ({ track, score: 0, cov: 0, related: true }));
        ranked = collapseDuplicates([...strong, ...tail]);
      }
    }

    return ranked.slice(0, RESULTS).map(({ track, related }) => (related ? { ...track, reason: "related" } : track));
  }

  // Final relevance score for every fused candidate (`queries`: the typed query and, if any, its
  // spelling correction; each signal takes the better of the two)
  function score(queries, fused, { profile, album, artist, trending, moods = [], languageHint = null, trusted = new Map() }) {
    const q = queries[0];
    const learned = regionalLanguages(profile);
    // The typing language ("enaku ... venum") leads when the listener's taste names no language yet
    const regional = languageHint && !learned.includes(languageHint) && !topLanguages(profile).length
      ? [languageHint, ...learned] : learned;
    const tracks = fused.map((f) => f.track);
    classifyList(tracks);
    const bm25 = tracks.map((_, i) => Math.max(...queries.map((v) => bm25ByQuery(v, tracks)[i])));
    const maxBm25 = Math.max(1e-9, ...bm25);
    const maxFused = Math.max(1e-9, ...fused.map((f) => f.fused));
    const albumIds = new Set((album || []).map((t) => t.id));
    const artistName = artist?.name ? normalize(artist.name) : "";
    bm25Cache.clear();

    return fused.map(({ track, fused: f }, i) => {
      const cov = Math.max(...queries.map((v) => coverage(v.tokens, track)));
      const phrase = Math.max(...queries.map((v) => phraseMatch(v.content, track)));
      // Popularity as an authority signal: 28M plays beats a 185-play cover of the same title
      const popularity = track.plays ? Math.min(1, Math.log10(track.plays + 1) / 9) : 0.3;
      let s = 0.3 * (bm25[i] / maxBm25) + 0.3 * (f / maxFused) + 0.15 * cov + 0.25 * phrase +
        0.3 * popularity + qualityPrior(track, q);
      let boosted = false;
      if (albumIds.has(track.id)) { s += 0.6; boosted = true; }
      if (artistName && normalize(track.artist).includes(artistName)) { s += 0.3; boosted = true; }
      if (q.languages.length) {
        const lang = classifyTrack(track).language;
        if (lang && q.languages.includes(lang)) s += 0.15;
        else if (lang) s -= 0.2;
      }
      // A song classified with the requested mood fits better (most songs carry no mood label, so
      // there is no penalty for a missing one)
      if (moods.length) {
        const mood = classifyTrack(track).mood;
        if (mood && moods.includes(mood)) s += 0.1;
      }
      if (q.intent === "mood") boosted = true; // every mood result is "about" the request
      // A spoken sentence: YouTube Music's top answers to it count, whatever words they share
      if (trusted.has(track.id)) {
        s += 0.25 / (1 + trusted.get(track.id) * 0.5);
        boosted = true;
      }
      if (profile) s += 0.15 * cosine(profile, trackFeatures(track));
      // No language asked: lean toward the listener's region and what's trending (tie-breakers)
      if (!q.languages.length) s += 0.5 * regionalScore(track, regional);
      s += trendScore(track, trending);
      return { track, score: s, cov, boosted };
    }).sort((a, b) => b.score - a.score);
  }

  const bm25Cache = new Map();
  const bm25ByQuery = (q, tracks) => {
    if (!bm25Cache.has(q.raw)) bm25Cache.set(q.raw, bm25Scores(q.tokens, tracks));
    return bm25Cache.get(q.raw);
  };

  return { search, songSearch, filmAlbum, artistTopSongs };
}

// Phrase query: the words appear together and in order in the song name (1), or in order with
// gaps (0.5). "rowdy baby" -> "Rowdy Baby" 1, "Baby Tu Rowdy" 0.
function phraseMatch(terms, track) {
  if (terms.length < 2) return 0;
  const words = tokenize(parseTitle(track.title).song);
  const positions = terms.map((t) => words.findIndex((w) => termMatch(t, w) >= 0.7));
  if (positions.some((p) => p < 0)) return 0;
  const inOrder = positions.every((p, i) => i === 0 || p > positions[i - 1]);
  if (!inOrder) return 0;
  return positions.every((p, i) => i === 0 || p === positions[i - 1] + 1) ? 1 : 0.5;
}

// The listener's main languages, from their taste profile (lang:* features)
function topLanguages(profile) {
  if (!profile) return [];
  return Object.entries(profile)
    .filter(([k, v]) => k.startsWith("lang:") && v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k]) => k.slice(5));
}

export { parseTitle };
