"use client";
import styles from "./page.module.css";
import TopBar from "@/components/TopBar";
import { categories } from "@/lib/mockData";
import { useAudio } from "@/contexts/AudioContext";
import Link from "next/link";

export default function Home() {
  // Add a special trending category
  const allCategories = [
    ...categories.map(cat => ({
      ...cat,
      path: `/category/${cat.name.toLowerCase()}`
    })),
    { id: "trending", name: "TRENDING", color: "linear-gradient(135deg, #ff0844 0%, #ffb199 100%)", path: "/trends" }
  ];

  return (
    <div className={styles.container}>
      <TopBar />
      <div className={styles.spatialMap}>
        {allCategories.map((cat, i) => {
          const size = 120 + (i * 15);
          const top = 15 + (i * 12) + '%';
          const left = (i % 2 === 0 ? 15 : 45) + '%';
          
          const bubbleContent = (
            <div 
              className={`glass ${styles.bubble}`} 
              style={{ width: size, height: size, '--bubble-color': cat.color }}
            >
              <span>{cat.name}</span>
            </div>
          );

          if (cat.path) {
            return (
              <Link key={cat.id} href={cat.path} style={{ position: 'absolute', top, left, textDecoration: 'none' }}>
                {bubbleContent}
              </Link>
            );
          }

          return (
            <div key={cat.id} style={{ position: 'absolute', top, left }}>
              {bubbleContent}
            </div>
          );
        })}
      </div>
    </div>
  );
}
