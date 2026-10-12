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

const DIAL_COUNT = 12;
const LABEL_SPACE = 22;  // the song name under a dial
const GAP = 6;           // dials keep at least this far apart
const BOTTOM_SPACE = 84; // keep clear of the mini player and the dial button
const MIN_SPEED = 4;     // px per second: a very slow drift
const MAX_SPEED = 7;

const dialSize = (i) => 68 + (i % 4) * 8;

// Dials are small: ask YouTube Music for a 240px cover instead of the player's 544px one
const dialCover = (url = "") => url.replace("=w544-h544", "=w240-h240");

// Floating dials: each drifts very slowly in its own direction anywhere on the screen, glides
// off the edges and softly bounces off the other dials, so they never overlap
function useFloatingDials(tracks, field, dialRefs) {
  useEffect(() => {
    if (!field || !tracks.length) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    // Start on a grid so nothing overlaps from the first frame
    const cols = 3;
    const rows = Math.ceil(tracks.length / cols);
    const bodies = tracks.map((track, i) => {
      const size = dialSize(i);
      const height = size + LABEL_SPACE;
      const r = height / 2 + GAP / 2;
      const angle = Math.random() * Math.PI * 2;
      const speed = MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED);
      return {
        el: dialRefs.current[track.id],
        size,
        height,
        r,
        x: Math.min(field.width - r, Math.max(r, ((i % cols) + 0.5) * (field.width / cols))),
        y: Math.min(field.height - r, Math.max(r, (Math.floor(i / cols) + 0.5) * (field.height / rows))),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        speed,
        phase: Math.random() * Math.PI * 2,
      };
    });

    const draw = (time) => {
      for (const b of bodies) {
        if (!b.el) continue;
        const tilt = reduceMotion ? 0 : Math.sin(time / 4000 + b.phase) * 3;
        b.el.style.transform = `translate(${b.x - b.size / 2}px, ${b.y - b.height / 2}px) rotate(${tilt}deg)`;
        b.el.style.opacity = "1";
      }
    };

    const step = (dt) => {
      for (const b of bodies) {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        // Edges: glide back in
        if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx); }
        if (b.x > field.width - b.r) { b.x = field.width - b.r; b.vx = -Math.abs(b.vx); }
        if (b.y < b.r) { b.y = b.r; b.vy = Math.abs(b.vy); }
        if (b.y > field.height - b.r) { b.y = field.height - b.r; b.vy = -Math.abs(b.vy); }
      }
      // Dials that meet: separate them and exchange their motion along the line between them
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
          const a = bodies[i];
          const c = bodies[j];
          const dx = c.x - a.x;
          const dy = c.y - a.y;
          const dist = Math.hypot(dx, dy) || 0.01;
          const overlap = a.r + c.r - dist;
          if (overlap <= 0) continue;
          const nx = dx / dist;
          const ny = dy / dist;
          a.x -= (nx * overlap) / 2;
          a.y -= (ny * overlap) / 2;
          c.x += (nx * overlap) / 2;
          c.y += (ny * overlap) / 2;
          const approach = (a.vx - c.vx) * nx + (a.vy - c.vy) * ny;
          if (approach > 0) {
            a.vx -= approach * nx;
            a.vy -= approach * ny;
            c.vx += approach * nx;
            c.vy += approach * ny;
          }
        }
      }
      // Keep every dial at its own gentle pace (bounces must not speed anything up)
      for (const b of bodies) {
        const v = Math.hypot(b.vx, b.vy) || 1;
        b.vx = (b.vx / v) * b.speed;
        b.vy = (b.vy / v) * b.speed;
      }
    };

    // Settle the starting grid so even a tight screen begins without overlaps
    for (let i = 0; i < 60; i++) step(0);
    draw(0);
    if (reduceMotion) return;

    let frame = 0;
    let last = performance.now();
    const loop = (now) => {
      step(Math.min(0.05, (now - last) / 1000));
      last = now;
      draw(now);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [tracks, field?.width, field?.height]);
}

export default function Trends() {
  const { playTrack, currentTrack, isPlaying, togglePlay, setContextPlaylist, prefetchTracks } = useAudio();
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [field, setField] = useState(null);
  const mapRef = useRef(null);
  const dialRefs = useRef({});

  useFloatingDials(tracks, field, dialRefs);

  const loadTrends = async (fresh = false) => {
    try {
      const list = await mixSongs("trends", TRENDS_SEEDS, { count: DIAL_COUNT, fresh });
      setTracks(list);
      prefetchTracks(list);
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

  // The dials roam the whole visible area, so they need its size
  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    const measure = () => setField({ width: el.clientWidth, height: Math.max(200, el.clientHeight - BOTTOM_SPACE) });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
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

        {tracks.map((track, i) => {
          const size = dialSize(i);
          const isActive = currentTrack?.id === track.id;
          return (
            <div
              key={track.id}
              ref={(el) => { dialRefs.current[track.id] = el; }}
              className={styles.dial}
              style={{ width: size, zIndex: isActive ? 2 : 1 }}
            >
              <button
                type="button"
                className={`${styles.trackBubble} ${isActive ? styles.activeBubble : ""}`}
                style={{ width: size, height: size, backgroundImage: `url(${dialCover(track.cover)})` }}
                onClick={() => handleTap(track)}
                title={`${track.title} — ${track.artist}`}
              >
                <span className={`${styles.playOverlay} ${isActive ? styles.overlayVisible : ""}`}>
                  {isActive && isPlaying
                    ? <Pause size={20} weight="fill" color="white" />
                    : <Play size={20} weight="fill" color="white" />}
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
  );
}
