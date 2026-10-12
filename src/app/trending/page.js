"use client";
import base from "../trends/page.module.css";
import styles from "./page.module.css";
import { useEffect, useRef, useState } from "react";
import { useAudio } from "@/contexts/AudioContext";
import { Play, Pause, ArrowLeft, MusicNotes } from "@phosphor-icons/react";
import Link from "next/link";
import SyncButton from "@/components/SyncButton";
import { toast } from "@/lib/toast";
import { useReconnect } from "@/lib/network";
import { mixSongs } from "@/lib/catalog";
import { TRENDING_SEEDS } from "@/app/category/[slug]/categories";

const ROW_HEIGHT = 150; // a dial, its name and its float fit before the next dial in the column

// Stable per-song randomness, so each dial keeps its own float across re-renders
const hash = (text = "") => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
};

// In-place floats, each a different shape: [x, y, rotate] waypoints scaled by an amplitude
const FLOATS = [
  (a) => [[0, 0, 0], [0, -a, 3], [0, 0, 0], [0, a * 0.5, -2], [0, 0, 0]],                // bob
  (a) => [[0, 0, 0], [a, -a * 0.2, 4], [0, 0, 0], [-a, -a * 0.2, -4], [0, 0, 0]],        // sway
  (a) => Array.from({ length: 9 }, (_, i) => {                                           // orbit
    const t = (i / 8) * Math.PI * 2;
    return [Math.cos(t) * a * 0.8 - a * 0.8, Math.sin(t) * a * 0.8, Math.sin(t) * 3];
  }),
  (a) => Array.from({ length: 9 }, (_, i) => {                                           // figure eight
    const t = (i / 8) * Math.PI * 2;
    return [Math.sin(t) * a, Math.sin(t * 2) * a * 0.5, Math.sin(t) * 4];
  }),
  (a) => [[0, 0, 0], [a * 0.7, -a * 0.7, 5], [0, -a, 0], [-a * 0.7, -a * 0.7, -5], [0, 0, 0]], // arc
  (a) => [[0, 0, -5], [0, -a * 0.4, 5], [0, 0, -5]],                                       // wobble
];

// The original scattered field: two staggered columns shifting sideways row by row
const layoutDial = (track, i) => {
  const r = hash(track.id);
  const row = Math.floor(i / 2);
  const col = i % 2;
  return {
    size: 84 + (i % 4) * 14,
    top: 10 + row * ROW_HEIGHT + (col === 0 ? 0 : ROW_HEIGHT / 2),
    left: (col === 0 ? 9 : 47) + (row % 3) * 5, // percent
    shape: FLOATS[r % FLOATS.length],
    amplitude: 8 + (r % 7),                // 8-14 px
    duration: 4500 + (r % 5500),           // 4.5-10 s
    phase: (r % 1000) / 1000,
    breathe: r % 3 === 0,                  // some dials also gently swell
  };
};

function TrendingDial({ track, index, isActive, isPlaying, onTap }) {
  const ref = useRef(null);
  const dial = layoutDial(track, index);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== "function") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const points = dial.shape(dial.amplitude);
    const animation = el.animate(points.map(([x, y, rot], i) => ({
      transform: `translate(${x}px, ${y}px) rotate(${rot}deg)${dial.breathe ? ` scale(${1 + Math.sin((i / (points.length - 1)) * Math.PI) * 0.04})` : ""}`,
      easing: "ease-in-out",
    })), {
      duration: dial.duration,
      iterations: Infinity,
      delay: -dial.phase * dial.duration,
    });
    return () => animation.cancel();
  }, [track.id, index]);

  return (
    <div className={styles.slot} style={{ top: dial.top, left: `${dial.left}%`, width: dial.size, zIndex: isActive ? 50 : 1 }}>
      <div ref={ref} className={styles.floater}>
        <button
          type="button"
          className={`${base.trackBubble} ${isActive ? base.activeBubble : ""}`}
          style={{ width: dial.size, height: dial.size, backgroundImage: `url(${(track.cover || "").replace("=w544-h544", "=w240-h240")})` }}
          onClick={() => onTap(track)}
          title={`${track.title} — ${track.artist}`}
        >
          <span className={`${base.playOverlay} ${isActive ? base.overlayVisible : ""}`}>
            {isActive && isPlaying
              ? <Pause size={22} weight="fill" color="white" />
              : <Play size={22} weight="fill" color="white" />}
          </span>
        </button>
        <div className={base.trackLabel}>
          <span>{track.title?.split("|")[0].split("(")[0].trim().slice(0, 14)}</span>
        </div>
      </div>
    </div>
  );
}

export default function Trending() {
  const { playTrack, currentTrack, isPlaying, togglePlay, setContextPlaylist, prefetchTracks } = useAudio();
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const mapRef = useRef(null);

  const loadTrending = async (fresh = false) => {
    try {
      const list = await mixSongs("trending", TRENDING_SEEDS, { count: 16, seedsPerMix: 3, fresh });
      setTracks(list);
      prefetchTracks(list);
      mapRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      return list.length > 0;
    } catch (e) {
      console.error(e);
      toast("Couldn't load what's trending — check your connection and tap Sync", { variant: "error" });
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Came back online with nothing on screen: load now
  useReconnect(() => { if (!tracks.length) loadTrending(); });

  useEffect(() => {
    loadTrending();
  }, []);

  // Expose the list as the global context playlist for the floating dial
  useEffect(() => {
    if (tracks.length > 0) {
      setContextPlaylist({ type: "trending", id: "trending", title: "Trending Now", tracks });
    }
    return () => setContextPlaylist(null);
  }, [tracks]);

  const handleTap = (track) => {
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(10);
    if (currentTrack?.id === track.id) togglePlay();
    else playTrack(track, tracks);
  };

  const rows = Math.ceil(tracks.length / 2);

  return (
    <div className={base.container}>
      <header className={base.header}>
        <Link href="/" className={base.backBtn}>
          <ArrowLeft size={22} />
        </Link>
        <div className={base.headerRow}>
          <div>
            <h1>Trending Now</h1>
            <p>What everyone&apos;s playing right now</p>
          </div>
          {!loading && <SyncButton size="sm" onSync={() => loadTrending(true)} />}
        </div>
      </header>

      <div className={styles.scrollMap} ref={mapRef}>
        {loading && (
          <div className={base.loader}>
            <MusicNotes size={32} weight="fill" />
            <span>Syncing what&apos;s trending...</span>
          </div>
        )}
        <div className={styles.field} style={{ height: rows * ROW_HEIGHT + ROW_HEIGHT }}>
          {tracks.map((track, i) => (
            <TrendingDial
              key={track.id}
              track={track}
              index={i}
              isActive={currentTrack?.id === track.id}
              isPlaying={isPlaying}
              onTap={handleTap}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
