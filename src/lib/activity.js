// What a play counts towards in the listener's lifetime profile: which artists, which genre and
// which mood. Used when a song is played (counted into the device's activity) and to build the
// "Sound Aura" summary from the lifetime totals.

// Each credited artist counts once ("Anirudh Ravichander, Shilpa Rao" -> two artists)
export const creditedArtists = (artist = "") => [...new Set(
  String(artist).split(/,|&| x | feat\.? | ft\.? /i).map((a) => a.replace(/\s*-\s*Topic$/i, "").trim()).filter((a) => a && a.toLowerCase() !== "unknown artist"),
)];

export function genreOf(track) {
  const title = (track?.title || "").toLowerCase();
  const artist = (track?.artist || "").toLowerCase();
  if (/lofi|chill|relax|coffee|sunday/.test(title)) return "Lofi/Chill";
  if (/hip hop|\brap\b|trap|banger/.test(title)) return "Hip-Hop";
  if (/synth|retro|electro|dance|edm/.test(title)) return "Electronic";
  if (/rock|metal|classic/.test(title)) return "Rock";
  if (/ilayaraja|ilaiyaraaja|rahman|anirudh/.test(artist) || /tamil/.test(title)) return "Tamil Hits";
  return "Pop";
}

export function moodOf(track) {
  const title = (track?.title || "").toLowerCase();
  if (/workout|gym|motivation|energetic/.test(title)) return "Energetic";
  if (/sleep|calm|relaxing|nature/.test(title)) return "Peaceful";
  if (/sad|breakup|failure|valigal/.test(title)) return "Melancholic";
  return "Chill";
}

const top = (counts) => {
  let best = "Unknown";
  let max = 0;
  for (const [name, n] of Object.entries(counts || {})) if (n > max) { max = n; best = name; }
  return best;
};

const percentages = (counts) => {
  const total = Object.values(counts || {}).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(counts || {})
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => ({ name, percentage: Math.round((n / total) * 100) }));
};

// The "Sound Aura" summary from lifetime totals ({ artists, genres, moods } as count maps)
export function tasteFromTotals(totals) {
  const plays = Object.values(totals?.genres || {}).reduce((a, b) => a + b, 0);
  if (!plays) return { topArtist: "None", topGenre: "None", dominantMood: "None", stats: null };
  return {
    topArtist: top(totals.artists),
    topGenre: top(totals.genres),
    dominantMood: top(totals.moods),
    stats: {
      artistsCount: Object.keys(totals.artists || {}).length,
      genres: percentages(totals.genres),
      moods: percentages(totals.moods),
    },
  };
}
