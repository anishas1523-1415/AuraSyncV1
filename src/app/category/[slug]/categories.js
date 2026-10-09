// Category pages. Shared by the server page (to pre-build every category) and the client view.
// Queries use singular "... song" phrasing: plural mood searches ("workout songs") mostly return
// hour-long compilations and live streams instead of individual songs.
export const CATEGORY_MAP = {
  chill:      { title: "Chill Vibes",        query: "lofi song",        color: "#11998e", emoji: "🌊" },
  focus:      { title: "Focus Mode",          query: "bgm song",    color: "#4776E6", emoji: "🎯" },
  workout:    { title: "Workout Beast",        query: "phonk song",      color: "#FF4500", emoji: "💪" },
  sleep:      { title: "Sleep Sounds",         query: "slowed reverb song",    color: "#483D8B", emoji: "🌙" },
  pop:        { title: "Pop Hits",             query: "pop song",               color: "#FF416C", emoji: "⭐" },
  hiphop:     { title: "Hip-Hop",             query: "hip hop rap songs",                color: "#8E54E9", emoji: "🎤" },
  indie:      { title: "Indie Picks",          query: "indie pop song",          color: "#FF8008", emoji: "🎸" },
  electronic: { title: "Electronic",          query: "electronic song",             color: "#b224ef", emoji: "⚡" },
  rock:       { title: "Rock Anthems",         query: "rock song",               color: "#E94057", emoji: "🎸" },
  tamil:      { title: "Tamil Hits",           query: "latest tamil hit songs",           color: "#f7971e", emoji: "🎵" },
  foryou:     { title: "For You",              query: "trending song",         color: "#ec4899", emoji: "✨" },
};
