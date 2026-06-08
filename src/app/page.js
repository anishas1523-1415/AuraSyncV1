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
  { id: "tamil",       name: "TAMIL",    color: "#f7971e", path: "/category/tamil",    size: 125 },
  { id: "electronic",  name: "ELECTRO",  color: "#b224ef", path: "/category/electronic", size: 118 },
];

const POSITIONS = [
  { top: "5%",  left: "8%" },
  { top: "4%",  left: "64%" },
  { top: "22%", left: "34%" },
  { top: "46%", left: "33%" },
  { top: "28%", left: "5%"  },
  { top: "44%", left: "68%" },
  { top: "62%", left: "12%" },
  { top: "64%", left: "52%" },
];

export default function Home() {
  const { getUserTasteProfile } = useAudio();
  const [bubbles, setBubbles] = useState(INITIAL_BUBBLES);
  
  useEffect(() => {
    // Adapt UI based on user taste profile
    const profile = getUserTasteProfile();
    if (profile && profile.topGenre !== "Unknown") {
      setBubbles(prev => prev.map(b => {
        if (b.id === "foryou") {
          // Change color based on mood
          const moodColor = profile.dominantMood === "Energetic" ? "#ff4500" :
                            profile.dominantMood === "Peaceful" ? "#4ca1af" :
                            profile.dominantMood === "Melancholic" ? "#8e54e9" : "#ec4899";
                            
          return {
            ...b,
            name: `${profile.dominantMood.toUpperCase()} MIX`,
            color: moodColor,
            path: `/category/${profile.topGenre.toLowerCase().replace(/[^a-z0-9]/g, '')}`
          };
        }
        return b;
      }));
    }
  }, []);

  return (
    <div className={styles.container}>
      <TopBar />
      <div className={styles.spatialMap}>
        {bubbles.map((bubble, i) => {
          const pos = POSITIONS[i] || { top: `${10 + i * 12}%`, left: `${i % 2 === 0 ? 15 : 50}%` };
          const isForYou = bubble.id === "foryou";
          return (
            <Link
              key={bubble.id}
              href={bubble.path}
              style={{ position: "absolute", top: pos.top, left: pos.left, textDecoration: "none" }}
            >
              <div
                className={`${styles.bubble} ${isForYou ? styles.forYouBubble : ""}`}
                style={{
                  width: bubble.size,
                  height: bubble.size,
                  "--bubble-color": bubble.color,
                  animationDelay: `${i * 1.2}s`,
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
