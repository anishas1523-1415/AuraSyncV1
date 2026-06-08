"use client";
import styles from "./page.module.css";
import { useAudio } from "@/contexts/AudioContext";
import { Heart, Share, Play, Pause, MusicNote, DotsThreeVertical } from "@phosphor-icons/react";
import { useEffect, useState, useRef } from "react";

const getFavoriteArtist = () => {
  try {
    const stored = localStorage.getItem("aurasynq_play_history");
    if (!stored) return null;
    const history = JSON.parse(stored);
    if (!history || history.length === 0) return null;
    
    const counts = {};
    let maxArtist = null;
    let maxCount = 0;
    
    for (const track of history) {
      if (!track.artist) continue;
      const artist = track.artist.trim();
      counts[artist] = (counts[artist] || 0) + 1;
      if (counts[artist] > maxCount) {
        maxCount = counts[artist];
        maxArtist = artist;
      }
    }
    return maxArtist;
  } catch (e) {
    return null;
  }
};

const QUERIES = [
  "trending pop songs 2024",
  "latest electronic dance music",
  "viral songs this week",
  "chill indie hits",
  "hip hop banger songs",
];

export default function Discover() {
  const { playTrack, currentTrack, isPlaying, togglePlay } = useAudio();
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [liked, setLiked] = useState({});
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    async function fetchTracks() {
      try {
        const favArtist = getFavoriteArtist();
        let query = QUERIES[Math.floor(Math.random() * QUERIES.length)];
        if (favArtist) {
          query = `${query} ${favArtist}`;
        }
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        if (data.tracks?.length) {
          setTracks(data.tracks.slice(0, 15));
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    fetchTracks();

    // Load saved likes
    try {
      const saved = localStorage.getItem("aurasynq_liked");
      if (saved) setLiked(JSON.parse(saved));
    } catch (e) {}
  }, []);

  const toggleLike = (trackId) => {
    setLiked((prev) => {
      const updated = { ...prev, [trackId]: !prev[trackId] };
      try { localStorage.setItem("aurasynq_liked", JSON.stringify(updated)); } catch (e) {}
      return updated;
    });
  };

  const handleShare = (track) => {
    if (navigator.share) {
      navigator.share({
        title: track.title,
        text: `🎵 Listen to ${track.title} by ${track.artist} on AuraSynq!`,
        url: window.location.href,
      }).catch(() => {});
    }
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
    <div className={styles.feedContainer}>
      {tracks.map((track) => {
        const isActive = currentTrack?.id === track.id;
        const isLiked = liked[track.id];

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
                onClick={() => toggleLike(track.id)}
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
