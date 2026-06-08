"use client";
import styles from "./page.module.css";
import { useEffect, useState, use } from "react";
import { useAudio } from "@/contexts/AudioContext";
import { Play, ArrowLeft, Pause, MusicNote, Plus } from "@phosphor-icons/react";
import Link from "next/link";
import AddToPlaylistModal from "@/components/AddToPlaylistModal";

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
  foryou:     { title: "For You",              query: "popular hits chart music",         color: "#ec4899", emoji: "✨" },
};

export default function CategoryPage({ params }) {
  const { slug } = use(params);
  const { playTrack, currentTrack, isPlaying, togglePlay, setContextPlaylist } = useAudio();
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(null);
  const [activeModalTrack, setActiveModalTrack] = useState(null);

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
        let searchQuery = category.query;
        const favArtist = getFavoriteArtist();

        if (slug === "foryou") {
          if (favArtist) {
            searchQuery = `${favArtist} hit songs`;
          }
        } else if (favArtist && slug !== "sleep" && slug !== "focus") {
          // Personalize category searches with the user's favorite artist
          searchQuery = `${searchQuery} ${favArtist}`;
        }

        const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`);
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
          <div className={styles.actionRow}>
            <button
              className={styles.playAllBtn}
              style={{ background: category.color }}
              onClick={() => playTrack(tracks[0], tracks)}
            >
              <Play size={20} weight="fill" /> Play All
            </button>
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