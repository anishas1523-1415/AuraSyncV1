// Category pages. Shared by the server page (to pre-build every category) and the client view.
// Each category has several YouTube Music song searches ("seeds"); every load mixes a random
// few of them, so the list is different each visit and the sync button brings fresh songs.
export const CATEGORY_MAP = {
  chill: {
    title: "Chill Vibes", color: "#11998e", emoji: "🌊",
    seeds: ["lofi chill", "chill hits", "lofi hindi songs", "acoustic chill", "chill tamil songs", "soft english songs", "lofi love songs"],
  },
  focus: {
    title: "Focus Mode", color: "#4776E6", emoji: "🎯",
    seeds: ["piano instrumental", "lofi beats instrumental", "study instrumental", "ambient focus", "tamil bgm instrumental", "guitar instrumental"],
  },
  workout: {
    title: "Workout Beast", color: "#FF4500", emoji: "💪",
    seeds: ["workout phonk", "gym motivation songs", "hip hop workout", "edm workout", "tamil mass songs", "power rock workout"],
  },
  sleep: {
    title: "Sleep Sounds", color: "#483D8B", emoji: "🌙",
    seeds: ["sleep piano", "slowed reverb songs", "calm acoustic songs", "ambient sleep", "soft melody songs", "tamil melody night songs"],
  },
  pop: {
    title: "Pop Hits", color: "#FF416C", emoji: "⭐",
    seeds: ["top pop hits", "english pop hits", "dance pop hits", "pop love songs", "bollywood pop songs", "new pop songs"],
  },
  hiphop: {
    title: "Hip-Hop", color: "#8E54E9", emoji: "🎤",
    seeds: ["hip hop hits", "rap hits", "desi hip hop", "trap songs", "tamil rap songs", "old school hip hop"],
  },
  indie: {
    title: "Indie Picks", color: "#FF8008", emoji: "🎸",
    seeds: ["indie pop", "hindi indie songs", "indie folk", "bedroom pop", "indie rock", "tamil indie songs"],
  },
  electronic: {
    title: "Electronic", color: "#b224ef", emoji: "⚡",
    seeds: ["edm hits", "house music hits", "electronic dance songs", "future bass", "melodic techno", "progressive house"],
  },
  rock: {
    title: "Rock Anthems", color: "#E94057", emoji: "🎸",
    seeds: ["rock classics", "alternative rock hits", "hard rock hits", "soft rock songs", "indian rock songs", "pop rock hits"],
  },
  tamil: {
    title: "Tamil Hits", color: "#f7971e", emoji: "🎵",
    seeds: ["latest tamil songs", "tamil hits", "anirudh hits", "tamil melody songs", "a r rahman tamil hits", "tamil kuthu songs", "yuvan shankar raja hits"],
  },
  foryou: {
    title: "For You", color: "#ec4899", emoji: "✨",
    seeds: ["trending songs", "viral hits", "new music hits", "top songs this week"],
  },
};

// The Trends page ("floating hits")
export const TRENDS_SEEDS = ["latest tamil songs", "trending tamil songs", "tamil hits", "anirudh hits", "tamil melody songs", "tamil kuthu songs"];

// Discover feed: a broad mix
export const DISCOVER_SEEDS = ["trending songs", "viral hits", "top pop hits", "indie pop", "hip hop hits", "edm hits", "latest tamil songs", "hindi hits", "new music hits"];
