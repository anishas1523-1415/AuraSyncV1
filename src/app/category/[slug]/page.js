"use client";
import styles from "./page.module.css";
import { useEffect, useMemo, useState } from "react";
import { useAudio } from "@/contexts/AudioContext";
import { Play, ArrowLeft, Pause, MusicNote } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

const CATEGORY_MAP = {
  chill:      { title: "Chill Vibes",        query: "lofi chill relaxing music",        color: "#11998e", emoji: "🌊" },
  focus:      { title: "Focus Mode",          query: "focus study instrumental music",    color: "#4776E6", emoji: "🎯" },
  workout:    { title: "Workout Beast",        query: "workout gym motivation songs",      color: "#FF4500", emoji: "💪" },
  sleep:      { title: "Sleep Sounds",         query: "sleep music calming relaxation",    color: "#483D8B", emoji: "🌙" },
  pop:        { title: "Pop Hits",             query: "top pop songs 2024",               color: "#FF416C", emoji: "⭐" },
  hiphop:     { title: "Hip-Hop",             query: "hip hop rap songs",                color: "#8E54E9", emoji: "🎤" },
  indie:      { title: "Indie Picks",          query: "indie alternative music",          color: "#FF8008", emoji: "🎸" },
  electronic: { title: "Electronic",          query: "electronic edm music",             color: "#b224ef", emoji: "⚡" },
  rock:       { title: "Rock Anthems",         query: "rock songs classic",               color: "#E94057", emoji: "🎸" },
  tamil:      { title: "Tamil Hits",           query: "latest tamil hit songs",           color: "#f7971e", emoji: "🎵" },
};

export default function CategoryPage({ params }) {
  const { slug } = params;
  const { playTrack, currentTrack, isPlaying, togglePlay } = useAudio();
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(null);

  const category = CATEGORY_MAP[slug] || {
    title: `${slug?.charAt(0).toUpperCase()}${slug?.slice(1)} Picks`,
    query: `${slug} songs`,
    color: "#8A2BE2",
    emoji: "🎵",
  };

  useEffect(() => {
    async function fetchSongs() {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(category.query)}`);
        const data = await res.json();
        if (data.tracks?.length) setTracks(data.tracks.slice(0, 20));
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    fetchSongs();
  }, [slug]);

  const handlePlay = (track, index) => {
    if (currentTrack?.id === track.id) {
      togglePlay();
    } else {
      setActiveIndex(index);
      playTrack(track, tracks);
    }
  };

  return (
    <div className={styles.container}>
      {/* Hero Header */}
      <div className={styles.hero} style={{ "--cat-color": category.color }}>
        <div className={styles.heroBg} style={{ background: `linear-gradient(135deg, ${category.color}33, transparent)` }} />
        <Link href="/" className={styles.backBtn}><ArrowLeft size={22} /></Link>
        <div className={styles.heroContent}>
          <span className={styles.emoji}>{category.emoji}</span>
          <h1>{category.title}</h1>
          <p className={styles.trackCount}>
            {loading ? "Loading..." : `${tracks.length} songs`}
          </p>
        </div>
        {!loading && tracks.length > 0 && (
          <button
            className={styles.playAllBtn}
            style={{ background: category.color }}
            onClick={() => playTrack(tracks[0], tracks)}
          >
            <Play size={20} weight="fill" /> Play All
          </button>
        )}
      </div>

      {/* Track List */}
      <div className={styles.trackList}>
        {loading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className={styles.skeletonItem}>
              <div className={styles.skeletonCover} />
              <div className={styles.skeletonInfo}>
                <div className={styles.skeletonTitle} />
                <div className={styles.skeletonArtist} />
              </div>
            </div>
          ))
        ) : (
          tracks.map((track, i) => {
            const isActive = currentTrack?.id === track.id;
            return (
              <div
                key={track.id}
                className={`${styles.trackItem} ${isActive ? styles.activeTrack : ""}`}
                onClick={() => handlePlay(track, i)}
              >
                <span className={styles.trackNumber}>
                  {isActive && isPlaying
                    ? <span className={styles.playingDot} style={{ background: category.color }} />
                    : i + 1
                  }
                </span>
                <img src={track.cover} alt={track.title} className={styles.cover} />
                <div className={styles.trackInfo}>
                  <h3 style={isActive ? { color: category.color } : {}}>
                    {track.title?.split("|")[0].split("(")[0].trim()}
                  </h3>
                  <p>{track.artist}</p>
                </div>
                <div className={styles.playBtn}>
                  {isActive && isPlaying
                    ? <Pause size={18} weight="fill" style={{ color: category.color }} />
                    : <Play size={18} weight="fill" />
                  }
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}