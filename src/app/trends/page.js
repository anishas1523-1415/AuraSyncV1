"use client";
import styles from "./page.module.css";
import { useEffect, useRef, useState } from "react";
import { useAudio } from "@/contexts/AudioContext";
import { Play, Pause, ArrowLeft, MusicNotes } from "@phosphor-icons/react";
import Link from "next/link";
import SyncButton from "@/components/SyncButton";
import { toast } from "@/lib/toast";
import { mixSongs } from "@/lib/catalog";
import { TRENDS_SEEDS } from "@/app/category/[slug]/categories";

const ROW_HEIGHT = 160; // a dial, its label and its float fit before the next dial in the column

// Stable per-song "randomness" so a dial keeps its rhythm across re-renders
const hash = (text = "") => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
};

// The original scattered field: two staggered columns shifting sideways row by row,
// four dial sizes. Spaced in pixels so dials never cover each other or their labels.
const layoutBubble = (track, i) => {
  const size = 90 + (i % 4) * 14;
  const row = Math.floor(i / 2);
  const col = i % 2;
  const r = hash(track.id);
  return {
    size,
    top: 12 + row * ROW_HEIGHT + (col === 0 ? 0 : ROW_HEIGHT / 2),
    left: (col === 0 ? 8 : 48) + (row % 3) * 5, // percent
    duration: 5 + r * 3,
    delay: -r * 8,
  };
};

export default function Trends() {
  const { playTrack, currentTrack, isPlaying, togglePlay, setContextPlaylist, prefetchTracks } = useAudio();
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const mapRef = useRef(null);

  const loadTrends = async (fresh = false) => {
    try {
      const list = await mixSongs("trends", TRENDS_SEEDS, { count: 16, fresh });
      setTracks(list);
      prefetchTracks(list);
      mapRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      return list.length > 0;
    } catch (e) {
      console.error(e);
      toast("Couldn't load trends — check your connection and tap Sync", { variant: "error" });
      return false;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTrends();
  }, []);

  // Expose trends tracks as global context playlist for floating dial
  useEffect(() => {
    if (tracks.length > 0) {
      setContextPlaylist({
        type: "trends",
        id: "trends",
        title: "Tamil Trends",
        tracks: tracks
      });
    }
    return () => {
      setContextPlaylist(null);
    };
  }, [tracks]);

  const handleTap = (track) => {
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(10);
    if (currentTrack?.id === track.id) togglePlay();
    else playTrack(track, tracks);
  };

  const rows = Math.ceil(tracks.length / 2);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <Link href="/" className={styles.backBtn}>
          <ArrowLeft size={22} />
        </Link>
        <div className={styles.headerRow}>
          <div>
            <h1>Tamil Trends</h1>
            <p>Floating hits for you</p>
          </div>
          {!loading && <SyncButton size="sm" onSync={() => loadTrends(true)} />}
        </div>
      </header>

      <div className={styles.spatialMap} ref={mapRef}>
        {loading && (
          <div className={styles.loader}>
            <MusicNotes size={32} weight="fill" />
            <span>Syncing Live Tamil Tracks...</span>
          </div>
        )}

        <div className={styles.field} style={{ height: rows * ROW_HEIGHT + ROW_HEIGHT }}>
          {tracks.map((track, i) => {
            const { size, top, left, duration, delay } = layoutBubble(track, i);
            const isActive = currentTrack?.id === track.id;
            return (
              <div
                key={track.id}
                className={styles.floatLayer}
                style={{ top, left: `${left}%`, width: size, animationDuration: `${duration}s`, animationDelay: `${delay}s` }}
              >
                <button
                  type="button"
                  className={`${styles.trackBubble} ${isActive ? styles.activeBubble : ""}`}
                  style={{ width: size, height: size, backgroundImage: `url(${track.cover})` }}
                  onClick={() => handleTap(track)}
                  title={`${track.title} — ${track.artist}`}
                >
                  <span className={`${styles.playOverlay} ${isActive ? styles.overlayVisible : ""}`}>
                    {isActive && isPlaying
                      ? <Pause size={22} weight="fill" color="white" />
                      : <Play size={22} weight="fill" color="white" />}
                  </span>
                </button>
                <div className={styles.trackLabel}>
                  <span>{track.title?.split("|")[0].split("(")[0].trim().slice(0, 14)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
