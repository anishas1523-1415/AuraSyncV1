// Song search: query understanding -> several retrievals in parallel (meta-search) -> rank fusion
// -> BM25 + priors + personal taste -> near-duplicate collapse -> pseudo-relevance feedback.
// `getClient` resolves to a youtubei.js Innertube instance (server, phone or the eval script).
import { analyzeQuery } from "./query.js";
import { normalize, tokenize, jaccard, termMatch, parseTitle } from "./text.js";
import { bm25Scores, coverage, reciprocalRankFusion, qualityPrior, collapseDuplicates, cosine } from "./rank.js";
import { classifyTrack, trackFeatures } from "./classify.js";
import { songToTrack, isPlayableSong, musicRadio } from "../musicTracks.js";

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
      .filter(isPlayableSong);
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

  async function search(raw, { profile = null } = {}) {
    const q = analyzeQuery(raw);
    if (!q.text) return [];
    const safe = (p) => p.catch(() => null);
    const wantsScore = /\b(bgm|score|theme)\b/.test(q.text);

    const songsPromise = safe(songSearch(raw));
    const languages = q.languages.length ? q.languages : topLanguages(profile);
    const [songs, albumRaw, artistRaw, ...expanded] = await Promise.all([
      songsPromise,
      q.intent === "album" || q.intent === "album_or_artist"
        ? safe(filmAlbum(q.entity, { wantsScore, languages, songsPromise })) : null,
      q.intent === "album_or_artist" || q.intent === "song_or_artist" ? safe(artistTopSongs(q.entity)) : null,
      ...(q.intent === "mood" ? q.expansions.slice(0, 2).map((e) => safe(songSearch(e))) : []),
    ]);

    // "kavala song" names a song, not the artist "Kavala": when the best song hit is titled like
    // the request, it's a song search and the artist/album guesses are dropped
    const top = (songs || [])[0];
    const titledLikeQuery = top && q.intent !== "album" && nameMatch(q.entity, parseTitle(top.title).song) >= 0.8;
    const album = titledLikeQuery ? null : albumRaw;
    // A film's soundtrack beats a same-named artist ("leo songs" is the film, not Leo Middea)
    const artist = titledLikeQuery || album?.length ? null : artistRaw;

    const lists = [{ tracks: songs || [], weight: 1 }];
    if (album?.length) lists.push({ tracks: album, weight: 1.6 });
    if (artist?.tracks?.length) lists.push({ tracks: artist.tracks, weight: 1.2 });
    expanded.forEach((tracks) => tracks?.length && lists.push({ tracks, weight: 0.7 }));

    let ranked = score([q], reciprocalRankFusion(lists), { profile, album, artist });

    // Weak matches: try YouTube Music's spelling suggestion ("vathi comming" -> "vaathi coming")
    if (q.intent !== "mood" && (!ranked.length || ranked[0].cov < 0.6)) {
      const corrected = await suggestion(raw);
      if (corrected) {
        const extra = await safe(songSearch(corrected));
        if (extra?.length) {
          lists.push({ tracks: extra, weight: 1.3 });
          // Score against both spellings, so neither the typed nor the corrected words lose out
          ranked = score([q, analyzeQuery(corrected)], reciprocalRankFusion(lists), { profile, album, artist });
        }
      }
    }

    ranked = collapseDuplicates(ranked);

    // Precision: for a specific song, drop results that share nothing with the query and fill the
    // tail with songs like the top hit instead (pseudo-relevance feedback: assume it's relevant)
    if (q.intent === "song" || q.intent === "song_or_artist") {
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
  function score(queries, fused, { profile, album, artist }) {
    const q = queries[0];
    const tracks = fused.map((f) => f.track);
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
      if (q.intent === "mood") boosted = true; // every mood result is "about" the request
      if (profile) s += 0.15 * cosine(profile, trackFeatures(track));
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
