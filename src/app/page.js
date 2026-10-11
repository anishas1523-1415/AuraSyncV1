"use client";
import styles from "./page.module.css";
import TopBar from "@/components/TopBar";
import Link from "next/link";
import { useAudio } from "@/contexts/AudioContext";
import { useEffect, useState } from "react";

const INITIAL_BUBBLES = [
  { id: "chill",       name: "CHILL",    color: "#11998e", path: "/category/chill",    size: 130 },
  { id: "trending",    name: "TRENDING", color: "#ff0844", path: "/trends",             size: 145 },
  { id: "foryou",      name: "FOR YOU",  color: "#ec4899", path: "/category/foryou",     size: 155 },
  { id: "focus",       name: "FOCUS",    color: "#8e54e9", path: "/category/focus",    size: 120 },
  { id: "workout",     name: "WORKOUT",  color: "#ff4500", path: "/category/workout",  size: 135 },
  { id: "sleep",       name: "SLEEP",    color: "#4ca1af", path: "/category/sleep",    size: 115 },
  { id: "tamil",       name: "TAMIL",    color: "#f7971e", path: "/trends",            size: 125 }, // floating Tamil dials
  { id: "electronic",  name: "ELECTRO",  color: "#b224ef", path: "/category/electronic", size: 118 },
];

// Where each bubble sits, as fractions of the free space (map size minus the bubble's size), so
// the layout keeps its shape on any screen without bubbles overlapping or spilling off the edge
const POSITIONS = [
  { x: 0.02, y: 0.02 }, // chill
  { x: 0.98, y: 0.07 }, // trending
  { x: 0.50, y: 0.33 }, // for you
  { x: 0.56, y: 0.65 }, // focus
  { x: 0.00, y: 0.56 }, // workout
  { x: 1.00, y: 0.46 }, // sleep
  { x: 0.08, y: 0.90 }, // tamil
  { x: 0.60, y: 0.92 }, // electro (clear of the dial button, bottom right)
];

// Taste-profile genres mapped onto existing category pages
const GENRE_TO_CATEGORY = {
  "Lofi/Chill": "chill",
  "Hip-Hop": "hiphop",
  "Electronic": "electronic",
  "Rock": "rock",
  "Tamil Hits": "tamil",
  "Pop": "pop",
};

export default function Home() {
  const { getUserTasteProfile, playHistory } = useAudio();
  const [bubbles, setBubbles] = useState(INITIAL_BUBBLES);
  
  useEffect(() => {
    // Adapt UI based on user taste profile (stats is null until something has been played)
    const profile = getUserTasteProfile();
    if (profile?.stats) {
      setBubbles(INITIAL_BUBBLES.map(b => {
        if (b.id === "foryou") {
          // Change color based on mood
          const moodColor = profile.dominantMood === "Energetic" ? "#ff4500" :
                            profile.dominantMood === "Peaceful" ? "#4ca1af" :
                            profile.dominantMood === "Melancholic" ? "#8e54e9" : "#ec4899";
                            
          return {
            ...b,
            name: `${profile.dominantMood.toUpperCase()} MIX`,
            color: moodColor,
            path: `/category/${GENRE_TO_CATEGORY[profile.topGenre] || "foryou"}`
          };
        }
        return b;
      }));
    } else {
      setBubbles(INITIAL_BUBBLES);
    }
  }, [playHistory]);

  return (
    <div className={styles.container}>
      <TopBar />
      <div className={styles.spatialMap}>
        {bubbles.map((bubble, i) => {
          const pos = POSITIONS[i] || { x: (i % 2) * 0.9, y: Math.min(0.95, i * 0.12) };
          const isForYou = bubble.id === "foryou";
          // Shrinks a little on short screens so the eight bubbles still fit apart
          const size = `min(${bubble.size}px, ${(bubble.size / 8.9).toFixed(2)}vh)`;
          return (
            <Link
              key={bubble.id}
              href={bubble.path}
              style={{
                position: "absolute",
                left: `calc((100% - ${size}) * ${pos.x})`,
                top: `calc((100% - ${size}) * ${pos.y})`,
                textDecoration: "none",
              }}
            >
              <div
                className={`${styles.bubble} ${isForYou ? styles.forYouBubble : ""}`}
                style={{
                  width: size,
                  height: size,
                  "--bubble-color": bubble.color,
                  // Own rhythm per bubble, already mid-float on arrival (not all moving in step)
                  animationDuration: `${8 + (i % 3) * 1.7}s`,
                  animationDelay: `-${i * 1.9}s`,
                }}
              >
                <span>{bubble.name}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
