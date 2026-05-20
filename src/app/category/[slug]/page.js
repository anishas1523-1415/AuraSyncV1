"use client";
import styles from "./page.module.css";
import { useEffect, useMemo, useState } from "react";
import { useAudio } from "@/contexts/AudioContext";
import { Play, ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

const CATEGORY_QUERIES = {
  chill: "lofi chill songs",
  focus: "focus music instrumental",
  workout: "workout songs",
  sleep: "sleep music relaxation"
};

const CATEGORY_TITLES = {
  chill: "Chill Picks",
  focus: "Focus Picks",
  workout: "Workout Picks",
  sleep: "Sleep Picks"
};

export default function CategoryPage({ params }) {
  const { slug } = params;
  const { playTrack } = useAudio();
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);

  const title = CATEGORY_TITLES[slug] || `${slug?.charAt(0).toUpperCase()}${slug?.slice(1)} Picks`;
  const query = useMemo(() => CATEGORY_QUERIES[slug] || `${slug} songs`, [slug]);

  useEffect(() => {
    async function fetchCategorySongs() {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();

        if (data.tracks?.length) {
          setTracks(data.tracks.slice(0, 15));
        } else {
          setTracks([]);
        }
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    }

    fetchCategorySongs();
  }, [query]);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <Link href="/" className={styles.backBtn}>
          <ArrowLeft size={24} />
        </Link>
        <h1>{title}</h1>
        <p>{query}</p>
      </header>

      <div className={styles.spatialMap}>
        {loading && (
          <div className={styles.loader}>
            Loading {title}...
          </div>
        )}

        {tracks.map((track, i) => {
          const size = 95 + (i % 3) * 15;
          const top = 10 + (i * 6.5) + '%';
          const left = (i % 2 === 0 ? 15 + (i % 4) * 8 : 50 - (i % 3) * 8) + '%';

          return (
            <div
              key={track.id}
              className={styles.trackBubble}
              style={{
                width: size,
                height: size,
                top,
                left,
                backgroundImage: `url(${track.cover})`,
                animationDelay: `${i * 0.15}s`
              }}
              onClick={() => playTrack(track, tracks)}
            >
              <div className={styles.playOverlay}>
                <Play size={24} weight="fill" color="white" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}