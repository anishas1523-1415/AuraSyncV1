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

const makeTrack = ({ id, title, artist, cover, duration }) => ({
  id,
  title: title || "Unknown title",
  artist: artist || "Unknown Artist",
  cover,
  url: `https://www.youtube.com/watch?v=${id}`,
  duration: duration || 0,
  mood: "energetic",
  hue: Math.floor(Math.random() * 360),
});

// A song row from music.search(..., { type: "song" })
export const songToTrack = (item) => item?.id && makeTrack({
  id: item.id,
  title: item.title,
  artist: joinArtists(item.artists) || item.author?.name || artistsFromSubtitle(item),
  cover: largeCover(item.thumbnails, item.id),
  duration: item.duration?.seconds,
});

// An entry of music.getUpNext() (YouTube Music's radio for a song)
export const upNextToTrack = (item) => item?.video_id && makeTrack({
  id: item.video_id,
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
  return (shelf?.contents || []).map(songToTrack).filter(isPlayableSong);
}

export async function musicRadio(yt, videoId) {
  const panel = await yt.music.getUpNext(videoId, true);
  return (panel?.contents || [])
    .map(upNextToTrack)
    .filter((track) => isPlayableSong(track) && track.id !== videoId);
}
