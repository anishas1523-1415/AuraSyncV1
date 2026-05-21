"use client";
import styles from "./page.module.css";
import TopBar from "@/components/TopBar";
import Link from "next/link";

const HOME_BUBBLES = [
  { id: "chill",       name: "CHILL",    color: "linear-gradient(135deg, #11998e, #38ef7d)", path: "/category/chill",    size: 130 },
  { id: "trending",    name: "TRENDING", color: "linear-gradient(135deg, #ff0844, #ffb199)", path: "/trends",             size: 145 },
  { id: "focus",       name: "FOCUS",    color: "linear-gradient(135deg, #4776E6, #8E54E9)", path: "/category/focus",    size: 120 },
  { id: "workout",     name: "WORKOUT",  color: "linear-gradient(135deg, #FF4500, #ff8c00)", path: "/category/workout",  size: 135 },
  { id: "sleep",       name: "SLEEP",    color: "linear-gradient(135deg, #2C3E50, #4CA1AF)", path: "/category/sleep",    size: 115 },
  { id: "tamil",       name: "TAMIL",    color: "linear-gradient(135deg, #f7971e, #ffd200)", path: "/category/tamil",    size: 125 },
  { id: "electronic",  name: "ELECTRO",  color: "linear-gradient(135deg, #b224ef, #7579ff)", path: "/category/electronic", size: 118 },
];

// Distribute bubbles in a visually interesting pattern
const POSITIONS = [
  { top: "8%",  left: "12%" },
  { top: "6%",  left: "55%" },
  { top: "24%", left: "35%" },
  { top: "38%", left: "8%"  },
  { top: "40%", left: "55%" },
  { top: "58%", left: "20%" },
  { top: "60%", left: "55%" },
];

export default function Home() {
  return (
    <div className={styles.container}>
      <TopBar />
      <div className={styles.spatialMap}>
        {HOME_BUBBLES.map((bubble, i) => {
          const pos = POSITIONS[i] || { top: `${10 + i * 12}%`, left: `${i % 2 === 0 ? 15 : 50}%` };
          return (
            <Link
              key={bubble.id}
              href={bubble.path}
              style={{ position: "absolute", top: pos.top, left: pos.left, textDecoration: "none" }}
            >
              <div
                className={styles.bubble}
                style={{
                  width: bubble.size,
                  height: bubble.size,
                  background: bubble.color,
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
