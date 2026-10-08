// Category pages. Shared by the server page (to pre-build every category) and the client view.
export const CATEGORY_MAP = {
  chill:      { title: "Chill Vibes",        query: "lofi chill relaxing music",        color: "#11998e", emoji: "🌊" },
  focus:      { title: "Focus Mode",          query: "focus study instrumental music",    color: "#4776E6", emoji: "🎯" },
  workout:    { title: "Workout Beast",        query: "workout gym motivation songs",      color: "#FF4500", emoji: "💪" },
  sleep:      { title: "Sleep Sounds",         query: "sleep music calming relaxation",    color: "#483D8B", emoji: "🌙" },
  pop:        { title: "Pop Hits",             query: `top pop songs ${new Date().getFullYear()}`,               color: "#FF416C", emoji: "⭐" },
  hiphop:     { title: "Hip-Hop",             query: "hip hop rap songs",                color: "#8E54E9", emoji: "🎤" },
  indie:      { title: "Indie Picks",          query: "indie alternative music",          color: "#FF8008", emoji: "🎸" },
  electronic: { title: "Electronic",          query: "electronic edm music",             color: "#b224ef", emoji: "⚡" },
  rock:       { title: "Rock Anthems",         query: "rock songs classic",               color: "#E94057", emoji: "🎸" },
  tamil:      { title: "Tamil Hits",           query: "latest tamil hit songs",           color: "#f7971e", emoji: "🎵" },
  foryou:     { title: "For You",              query: "popular hits chart music",         color: "#ec4899", emoji: "✨" },
};
