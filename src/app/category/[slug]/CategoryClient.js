"use client";
import styles from "./page.module.css";
import { useEffect, useRef, useState } from "react";
import { useAudio } from "@/contexts/AudioContext";
import { Play, ArrowLeft, Pause, Plus } from "@phosphor-icons/react";
import Link from "next/link";
import AddToPlaylistModal from "@/components/AddToPlaylistModal";
import SyncButton from "@/components/SyncButton";
import { toast } from "@/lib/toast";
import { mixSongs, forYouSongs } from "@/lib/catalog";
import { CATEGORY_MAP } from "./categories";

export default function CategoryClient({ slug }) {
  const { playTrack, currentTrack, isPlaying, togglePlay, setContextPlaylist, prefetchTracks, playHistory, likedTracks } = useAudio();
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeModalTrack, setActiveModalTrack] = useState(null);
  const requestRef = useRef(0);

  const category = CATEGORY_MAP[slug] || {
    title: `${slug?.charAt(0).toUpperCase()}${slug?.slice(1)} Picks`,
    seeds: [`${slug} songs`, `${slug} hits`],
    color: "#8A2BE2",
    emoji: "🎵",
  };

  // A new mix of songs on every visit; `fresh` (the sync button) skips the short-lived cache
  const loadSongs = async (fresh = false) => {
    const requestId = ++requestRef.current;
    try {
      const list = slug === "foryou"
        ? await forYouSongs({ history: playHistory, liked: likedTracks, fallbackSeeds: category.seeds, fresh })
        : await mixSongs(slug, category.seeds, { fresh });
      if (requestId !== requestRef.current) return false;
      setTracks(list);
      prefetchTracks(list);
      return list.length > 0;
    } catch (e) {
      console.error(e);
      if (requestId === requestRef.current) {
        toast("Couldn't load songs — check your connection and tap Sync", { variant: "error" });
      }
      return false;
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    loadSongs();
    // Library state arrives after mount; For You only needs it once, on the first load
  }, [slug]);

  // Expose category tracks as global context playlist for floating dial
  useEffect(() => {
    if (tracks.length > 0) {
      setContextPlaylist({
        type: "category",
        id: slug,
        title: category.title,
        tracks: tracks
      });
    }
    return () => {
      setContextPlaylist(null);
    };
  }, [tracks, slug]);

  const handlePlay = (track, index) => {
    if (currentTrack?.id === track.id) {
      togglePlay();
    } else {
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
        {!loading && (
          <div className={styles.actionRow}>
            {tracks.length > 0 && (
              <button
                className={styles.playAllBtn}
                style={{ background: category.color }}
                onClick={() => playTrack(tracks[0], tracks)}
              >
                <Play size={20} weight="fill" /> Play All
              </button>
            )}
            <SyncButton onSync={() => loadSongs(true)} />
          </div>
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
                
                <div className={styles.trackActions}>
                  <button
                    className={styles.addBtn}
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveModalTrack(track);
                    }}
                    title="Add to Playlist"
                  >
                    <Plus size={18} />
                  </button>
                  <div className={styles.playBtn}>
                    {isActive && isPlaying
                      ? <Pause size={18} weight="fill" style={{ color: category.color }} />
                      : <Play size={18} weight="fill" />
                    }
                  </div>
                </div>
              </div>
            );
          })
        )}
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