"use client";
import styles from "./page.module.css";
import { useAudio } from "@/contexts/AudioContext";
import { Heart, Share, Play, Pause } from "@phosphor-icons/react";
import { useEffect, useState, useRef } from "react";
import { shareOrCopy, toast } from "@/lib/toast";
import { siteUrl } from "@/lib/api";
import { mixSongs, forYouSongs } from "@/lib/catalog";
import { DISCOVER_SEEDS } from "@/app/category/[slug]/categories";
import SyncButton from "@/components/SyncButton";

// Every third card follows the listener's own taste (radio of songs they played or liked)
const weave = (mix, personal) => {
  const out = [];
  const seen = new Set();
  const add = (t) => { if (t && !seen.has(t.id)) { seen.add(t.id); out.push(t); } };
  mix.forEach((t, i) => {
    add(t);
    if (i % 2 === 1) add(personal[(i - 1) / 2]);
  });
  personal.forEach(add);
  return out;
};

export default function Discover() {
  const { playTrack, currentTrack, isPlaying, togglePlay, toggleLikeTrack, isTrackLiked, prefetchTracks, playHistory, likedTracks } = useAudio();
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const loadedRef = useRef(false);
  const feedRef = useRef(null);

  const loadFeed = async (fresh = false) => {
    try {
      const hasTaste = playHistory.length > 0 || likedTracks.length > 0;
      const [mix, personal] = await Promise.allSettled([
        mixSongs("discover", DISCOVER_SEEDS, { seedsPerMix: 3, count: 18, fresh }),
        hasTaste ? forYouSongs({ history: playHistory, liked: likedTracks, count: 8, fresh }) : Promise.resolve([]),
      ]);
      const list = weave(mix.value || [], personal.value || []);
      if (!list.length) throw mix.reason || new Error("No songs found");
      setTracks(list);
      prefetchTracks(list);
      feedRef.current?.scrollTo({ top: 0 });
      return true;
    } catch (e) {
      console.error(e);
      toast("Couldn't load your feed — check your connection and tap sync", { variant: "error" });
      return false;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    loadFeed();
  }, []);

  // Likes go to the shared library so they show up in Library → Liked Songs and sync to the cloud
  const toggleLike = (track) => {
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(12);
    toggleLikeTrack(track);
  };

  const handleShare = (track) => {
    const title = track.title?.split("|")[0].split("(")[0].trim() || "";
    shareOrCopy({
      title: track.title,
      text: `🎵 Listen to ${title} by ${track.artist} on AuraSynq!`,
      url: siteUrl(`/player?track=${encodeURIComponent(track.id)}&t=${encodeURIComponent(title)}&a=${encodeURIComponent(track.artist || "")}`),
    }, "Song link copied to clipboard!");
  };

  if (loading) {
    return (
      <div className={styles.loadingScreen}>
        <div className={styles.loadingPulse} />
        <p>Loading your feed...</p>
      </div>
    );
  }

  return (
    <div className={styles.feedContainer} ref={feedRef}>
      <div className={styles.syncFloat}>
        <SyncButton floating onSync={() => loadFeed(true)} />
      </div>
      {tracks.map((track) => {
        const isActive = currentTrack?.id === track.id;
        const isLiked = isTrackLiked(track.id);

        return (
          <div
            key={track.id}
            data-track-id={track.id}
            className={styles.feedItem}
          >
            {/* Background Cover */}
            <div className={styles.bgCover}>
              <img src={track.cover} alt="" className={styles.bgImg} />
              <div className={styles.bgBlur} />
            </div>

            {/* Centered Album Art */}
            <div className={styles.albumArt} onClick={() => isActive ? togglePlay() : playTrack(track, tracks)}>
              <img
                src={track.cover}
                alt={track.title}
                className={`${styles.albumImg} ${isActive && isPlaying ? styles.spinning : ""}`}
              />
              <div className={`${styles.playPauseOverlay} ${isActive ? styles.overlayVisible : ""}`}>
                {isActive && isPlaying
                  ? <Pause size={42} weight="fill" />
                  : <Play size={42} weight="fill" />
                }
              </div>
            </div>

            {/* Track Info */}
            <div className={styles.trackInfo}>
              <div className={styles.nowPlaying}>
                {isActive && <span className={styles.liveTag}>● NOW PLAYING</span>}
              </div>
              <h2>{track.title?.split("|")[0].split("(")[0].trim()}</h2>
              <p>{track.artist}</p>
            </div>

            {/* Side Actions */}
            <div className={styles.actions}>
              <button
                className={`${styles.actionBtn} ${isLiked ? styles.liked : ""}`}
                onClick={() => toggleLike(track)}
              >
                <Heart size={30} weight={isLiked ? "fill" : "regular"} />
                <span>{isLiked ? "Liked" : "Like"}</span>
              </button>

              <button className={styles.actionBtn} onClick={() => handleShare(track)}>
                <Share size={28} weight="regular" />
                <span>Share</span>
              </button>

              <button
                className={styles.actionBtn}
                onClick={() => isActive ? togglePlay() : playTrack(track, tracks)}
              >
                {isActive && isPlaying
                  ? <Pause size={28} weight="fill" />
                  : <Play size={28} weight="fill" />
                }
                <span>{isActive && isPlaying ? "Pause" : "Play"}</span>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
