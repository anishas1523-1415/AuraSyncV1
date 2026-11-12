// Turns YouTube Music results (youtubei.js nodes) into AuraSynq tracks. Shared by the server
// search route and the Android app's on-device lookups, so both produce identical tracks.

// Music thumbnails come as tiny squares (60-120px); the URL encodes the size, so ask for a big one
const largeCover = (thumbnails = [], videoId) => {
  const best = [...thumbnails].sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url;
  if (!best) return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  return best.includes("googleusercontent.com") ? best.replace(/=w\d+-h\d+/, "=w544-h544") : best;
};

const joinArtists = (artists) => (artists || []).map((a) => a?.name).filter(Boolean).join(", ");

// Some layouts (e.g. for mobile browsers) leave `artists` empty; the row's subtitle still reads
// "Artist A, Artist B & Artist C • Album • 4:32"
const artistsFromSubtitle = (item) => {
  const subtitle = item.flex_columns?.[1]?.title?.toString() || item.subtitle?.toString() || "";
  return subtitle.split(" • ")[0].replace(/ & /g, ", ").trim();
};

// media: "audio" (the song as released, like YouTube Music / Spotify play it) or "video" (a music
// video, often with dialogue or scenes before and after the song)
const makeTrack = ({ id, title, artist, cover, duration, album, plays, media }) => ({
  id,
  ...(media ? { media } : {}),
  title: title || "Unknown title",
  artist: artist || "Unknown Artist",
  ...(album ? { album } : {}),
  ...(plays ? { plays } : {}),
  cover,
  url: `https://www.youtube.com/watch?v=${id}`,
  duration: duration || 0,
  mood: "energetic",
  hue: Math.floor(Math.random() * 360),
});

// "28M plays" / "1.2B views" -> 28000000 (popularity, used as a ranking prior)
const parsePlays = (item) => {
  const text = (item.flex_columns || []).map((c) => c.title?.toString() || "").find((t) => /\b(plays|views)\b/i.test(t));
  const m = text?.match(/([\d.]+)\s*([KMB])?/i);
  if (!m) return 0;
  return Math.round(parseFloat(m[1]) * ({ k: 1e3, m: 1e6, b: 1e9 }[(m[2] || "").toLowerCase()] || 1));
};

// Some layouts (album pages, mobile responses) only show the length as text ("3:11" / "1:02:33")
const durationFromText = (item) => {
  const text = (item.flex_columns || []).concat(item.fixed_columns || [])
    .map((c) => c.title?.toString() || "").join(" • ");
  const m = text.match(/(?:^|[\s•])(\d{1,2}:)?(\d{1,2}):(\d{2})(?=$|[\s•])/);
  if (!m) return 0;
  return (m[1] ? parseInt(m[1], 10) * 3600 : 0) + parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
};

// YouTube Music's own type of an entry: ATV = audio track, OMV / UGC / ... = a video
const VIDEO_TYPES = /OMV|UGC|PODCAST|SHORTS|OFFICIAL_SOURCE_MUSIC/;
const mediaOf = (item) => {
  const type = item?.endpoint?.payload?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType
    || item?.overlay?.content?.endpoint?.payload?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType;
  if (type) return /ATV/.test(type) ? "audio" : VIDEO_TYPES.test(type) ? "video" : null;
  if (item?.item_type === "song") return "audio";
  if (item?.item_type === "video") return "video";
  return null;
};

// A song row from music.search(..., { type: "song" }) or a playlist
export const songToTrack = (item) => item?.id && makeTrack({
  id: item.id,
  media: mediaOf(item),
  title: item.title,
  artist: joinArtists(item.artists) || item.author?.name || artistsFromSubtitle(item),
  cover: largeCover(item.thumbnails, item.id),
  duration: item.duration?.seconds || durationFromText(item),
  album: item.album?.name,
  plays: parsePlays(item),
});

// An entry of music.getUpNext() (YouTube Music's radio for a song)
export const upNextToTrack = (item) => item?.video_id && makeTrack({
  id: item.video_id,
  media: mediaOf(item),
  title: item.title?.toString(),
  artist: joinArtists(item.artists) || item.author,
  cover: largeCover(item.thumbnail, item.video_id),
  duration: item.duration?.seconds,
});

// Songs only: no live streams, nothing over 15 minutes (mixes, jukeboxes)
export const isPlayableSong = (track) => !!track && track.duration > 0 && track.duration <= 15 * 60;

export async function searchMusicSongs(yt, query) {
  const res = await yt.music.search(query, { type: "song" });
  const shelf = res.songs ?? res.contents?.find((c) => c?.contents?.length);
  return (shelf?.contents || []).map((item) => songToTrack(item) && { ...songToTrack(item), media: "audio" }).filter(isPlayableSong);
}

// Audio tracks first (YouTube Music's own order otherwise kept); videos only after them
const audioFirst = (tracks) => [...tracks.filter((t) => t.media !== "video"), ...tracks.filter((t) => t.media === "video")];

export async function musicRadio(yt, videoId) {
  const panel = await yt.music.getUpNext(videoId, true);
  return audioFirst((panel?.contents || [])
    .map(upNextToTrack)
    .filter((track) => isPlayableSong(track) && track.id !== videoId));
}

// ─── The audio version of a music video ───
// Chart playlists list music videos ("Magale Video Song | Baththa | ...", 4:43 with its intro);
// listeners expect the song as released ("Magale (From "Baththa")", 4:18), which is also what lyrics
// are timed to. YouTube Music rarely links the two for Indian labels, so the song is looked up and
// accepted only on a clear match: same song name, same singers or film, and a length that fits
// inside the video (videos add scenes; they don't cut the song). No clear match: null.
const normal = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const songName = (title) => normal(String(title || "")
  .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
  .split(/\s[|•]\s|\s-\s/)[0]
  .replace(/\b(official|lyric(al)?|video|audio|song|full|hd|4k|8k|music)\b/gi, " ")
  .replace(/\b(feat|ft)\b.*$/i, " "));
const filmOf = (track) => normal((String(track.title || "").match(/\(\s*from\s+["“]?([^"”)]+)["”]?\s*\)/i) || [])[1] || track.album || "");
const artistSet = (a) => new Set(String(a || "").split(/,|&| x | feat\.? | ft\.? /i).map(normal).filter(Boolean));
const VERSION_WORDS = /\b(unplugged|acoustic|slowed|reverb|sped up|lofi|lo fi|remix|cover|karaoke|instrumental|reprise|live|8d|female version|male version|bgm|theme)\b/i;
const LABEL = /\b(music|records|audio|films|entertainment|official|tamil|telugu|hindi|south|series|saregama|lahari|aditya|tips|think|sony|zee|t series)\b/i;

// Same name, allowing transliteration differences: "Kanukulla" / "Kannukulla", "Pattampoochi" /
// "Pattaampoochi" (doubled letters squeezed, then at most one edit for longer names)
const squeeze = (s) => s.replace(/\s+/g, "").replace(/(.)\1+/g, "$1");
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}
export function sameSongName(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const x = squeeze(a);
  const y = squeeze(b);
  return x === y || (Math.min(x.length, y.length) >= 7 && editDistance(x, y) <= 1);
}
const LANGUAGE_MARK = /[(\[]\s*(tamil|telugu|hindi|malayalam|kannada|punjabi|bengali|marathi)\b[^)\]]*[)\]]|\s-\s*(tamil|telugu|hindi|malayalam|kannada)\s*$/i;
const languageMark = (text) => { const m = LANGUAGE_MARK.exec(text || ""); return m ? (m[1] || m[2]).toLowerCase() : null; };

// options: { keywords: the video's own tags, language: the video's verified language }
export function isAudioMatch(video, audio, { keywords = [], language = null } = {}) {
  if (!audio?.id || audio.id === video.id) return false;
  const name = songName(video.title);
  if (!name || !sameSongName(songName(audio.title), name)) return false;
  // Never a version marked as another language ("Song (Hindi)", album "Film - Telugu")
  const marked = languageMark(audio.title) || languageMark(audio.album);
  if (marked && marked !== (language || languageMark(video.title) || marked)) return false;
  // A different version of the song is not the song (unless the video is that version too)
  if (VERSION_WORDS.test(audio.title || "") && !VERSION_WORDS.test(video.title || "")) return false;
  const va = artistSet(video.artist);
  const aa = artistSet(audio.artist);
  const sharedArtist = [...va].some((a) => aa.has(a));
  const filmV = filmOf(video);
  const filmA = filmOf(audio);
  // The film in the audio's album name, also confirmed by the video's own tags ("jana nayagan movie")
  const filmName = filmA.replace(/\b(original|motion|picture|soundtrack|ost|tamil|telugu|hindi|malayalam|kannada)\b/g, " ").replace(/\s+/g, " ").trim();
  const tagged = filmName.length >= 4 && keywords.some((k) => normal(k).includes(filmName));
  const sameFilm = tagged || (filmV && filmA && (filmV === filmA || filmV.includes(filmA) || filmA.includes(filmV)));
  // Chart uploads from label channels ("Sony Music South") name the channel, not the singers
  const channelOnly = va.size === 1 && LABEL.test([...va][0]);
  if (!sharedArtist && !sameFilm && !channelOnly) return false;
  // Videos add scenes or cut the song short; a very different length is another recording or a part
  if (video.duration && audio.duration) {
    const ratio = audio.duration / video.duration;
    if (ratio < 0.55 || ratio > 1.6) return false;
  }
  return true;
}

export async function findAudioVersion(yt, video, options = {}) {
  if (video?.media === "audio") return null;
  const name = songName(video.title);
  if (!name) return null;
  const main = String(video.artist || "").split(",")[0].trim();
  const film = filmOf(video);
  const queries = [`${name} ${main}`];
  if (film && !main.toLowerCase().includes(film)) queries.push(`${name} ${film}`);
  const language = options.language || languageMark(video.title);
  for (const q of queries) {
    const found = (await searchMusicSongs(yt, q).catch(() => [])).slice(0, 8);
    const matches = found.filter((x) => isAudioMatch(video, x, options));
    if (!matches.length) continue;
    return pickVersion(name, found, matches, language);
  }
  return null;
}

// Songs released in several languages (a Tamil film's songs also as a Hindi and Telugu dub): the
// dub's album isn't always marked ("Jan Neta" is the Hindi "Jana Nayagan"). The version marked with
// the song's own language wins; an unmarked one is taken only when no other-language version of the
// song shows up; otherwise the video stays (better than the wrong language).
function pickVersion(name, found, matches, language) {
  const mark = (x) => languageMark(x.title) || languageMark(x.album);
  if (language) {
    const own = matches.find((x) => mark(x) === language);
    if (own) return own;
  }
  const multiLanguage = found.some((x) => sameSongName(songName(x.title), name) && mark(x) && mark(x) !== language);
  if (multiLanguage) return null;
  return matches.find((x) => !mark(x) || mark(x) === language) || null;
}

// YouTube Music's own autocomplete for a half-typed query
export async function musicSuggestions(yt, query) {
  const sections = await yt.music.getSearchSuggestions(query);
  const seen = new Set();
  return (sections || [])
    .flatMap((section) => (section.contents || []).map((c) => c.suggestion?.toString?.() || ""))
    .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
    .slice(0, 8);
}
