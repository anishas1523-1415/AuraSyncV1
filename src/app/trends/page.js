"use client";
import styles from "./page.module.css";
import { useEffect, useState } from "react";
import { useAudio } from "@/contexts/AudioContext";
import { Play, ArrowLeft, MusicNotes, Plus } from "@phosphor-icons/react";
import Link from "next/link";
import AddToPlaylistModal from "@/components/AddToPlaylistModal";

export default function Trends() {
  const { playTrack, setContextPlaylist } = useAudio();
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeModalTrack, setActiveModalTrack] = useState(null);

  useEffect(() => {
    async function fetchTamilSongs() {
      try {
        const res = await fetch("/api/search?q=latest+tamil+hit+songs");
        const data = await res.json();
        if (data.tracks) {
          const list = data.tracks.slice(0, 15);
          setTracks(list);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    fetchTamilSongs();
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

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <Link href="/" className={styles.backBtn}>
          <ArrowLeft size={24} />
        </Link>
        <div>
          <h1>Tamil Trends</h1>
          <p>Floating hits for you</p>
        </div>
      </header>

      <div className={styles.spatialMap}>
        {loading && (
          <div className={styles.loader}>
            <MusicNotes size={32} weight="fill" />
            <span>Syncing Live Tamil Tracks...</span>
          </div>
        )}

        {tracks.map((track, i) => {
          const size = 90 + (i % 4) * 18;
          const row = Math.floor(i / 2);
          const col = i % 2;
          const top = 5 + row * 14 + (col === 0 ? 0 : 7) + "%";
          const left = col === 0
            ? 8 + (row % 3) * 5 + "%"
            : 48 + (row % 3) * 5 + "%";

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
                animationDelay: `${i * 0.12}s`,
              }}
              onClick={() => playTrack(track, tracks)}
              title={`${track.title} — ${track.artist}`}
            >

              <div className={styles.playOverlay}>
                <Play size={22} weight="fill" color="white" />
              </div>
              <div className={styles.trackLabel}>
                <span>{track.title?.split("|")[0].split("(")[0].trim().slice(0, 14)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {activeModalTrack && (
        <AddToPlaylistModal 
          track={activeModalTrack} 
          onClose={() => setActiveModalTrack(null)} 
        />
      )}
    </div>
  );
}
