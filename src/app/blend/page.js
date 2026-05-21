"use client";
import styles from "./page.module.css";
import { useState, useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { useAudio } from "@/contexts/AudioContext";
import { Play, Pause, Shuffle, MusicNote, Sparkle, ArrowLeft, Users } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

const FRIEND_PROFILES = [
  {
    id: "friend1",
    name: "Meera",
    avatar: "https://i.pravatar.cc/150?u=meera_blend",
    topGenres: ["Tamil", "Pop", "Romantic"],
    query: "latest tamil pop romantic songs",
  },
  {
    id: "friend2",
    name: "Arun",
    avatar: "https://i.pravatar.cc/150?u=arun_blend",
    topGenres: ["Hip-Hop", "Electronic", "Trap"],
    query: "hip hop electronic trap songs",
  },
  {
    id: "friend3",
    name: "Priya",
    avatar: "https://i.pravatar.cc/150?u=priya_blend",
    topGenres: ["Indie", "Chill", "Acoustic"],
    query: "indie chill acoustic songs",
  },
];

const MY_GENRES = ["Electronic", "Tamil", "Chill"];
const MY_QUERY = "electronic chill songs tamil";

function CompatibilityBar({ label, value, color }) {
  return (
    <div className={styles.barRow}>
      <span className={styles.barLabel}>{label}</span>
      <div className={styles.barTrack}>
        <div
          className={styles.barFill}
          style={{ width: `${value}%`, background: color }}
        />
      </div>
      <span className={styles.barValue}>{value}%</span>
    </div>
  );
}

export default function Blend() {
  const { user, isLoaded } = useUser();
  const { playTrack, currentTrack, isPlaying, togglePlay } = useAudio();

  const [selectedFriend, setSelectedFriend] = useState(null);
  const [phase, setPhase] = useState("select"); // select | blending | result
  const [blendTracks, setBlendTracks] = useState([]);
  const [score, setScore] = useState(null);
  const [loadingBlend, setLoadingBlend] = useState(false);

  const myName = isLoaded && user ? user.firstName || "You" : "You";
  const myAvatar = isLoaded && user ? user.imageUrl : null;

  const startBlend = async () => {
    if (!selectedFriend) return;
    setPhase("blending");
    setLoadingBlend(true);

    // Fetch tracks for both users' taste
    try {
      const [myRes, friendRes] = await Promise.all([
        fetch(`/api/search?q=${encodeURIComponent(MY_QUERY)}`),
        fetch(`/api/search?q=${encodeURIComponent(selectedFriend.query)}`),
      ]);
      const myData = await myRes.json();
      const friendData = await friendRes.json();

      const myTracks = myData.tracks?.slice(0, 8) || [];
      const friendTracks = friendData.tracks?.slice(0, 8) || [];

      // Interleave tracks (alternating) and shuffle slightly
      const combined = [];
      const maxLen = Math.max(myTracks.length, friendTracks.length);
      for (let i = 0; i < maxLen; i++) {
        if (i < myTracks.length) combined.push({ ...myTracks[i], owner: "me" });
        if (i < friendTracks.length) combined.push({ ...friendTracks[i], owner: "friend" });
      }

      // Shuffle
      for (let i = combined.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [combined[i], combined[j]] = [combined[j], combined[i]];
      }

      setBlendTracks(combined.slice(0, 15));

      // Generate compatibility score
      const genreOverlap = Math.floor(Math.random() * 25 + 55);
      const energyMatch = Math.floor(Math.random() * 30 + 50);
      const tempoSync = Math.floor(Math.random() * 35 + 45);
      const overall = Math.round((genreOverlap + energyMatch + tempoSync) / 3);

      setScore({ overall, genreOverlap, energyMatch, tempoSync });

      // Transition to result
      await new Promise(r => setTimeout(r, 3000));
      setPhase("result");
    } catch (e) {
      console.error(e);
      setPhase("select");
    } finally {
      setLoadingBlend(false);
    }
  };

  const reset = () => {
    setPhase("select");
    setSelectedFriend(null);
    setBlendTracks([]);
    setScore(null);
  };

  const playAll = () => {
    if (blendTracks.length) playTrack(blendTracks[0], blendTracks);
  };

  // ─── PHASE: SELECT FRIEND ──────────────────────────────
  if (phase === "select") {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <Link href="/" className={styles.backBtn}><ArrowLeft size={22} /></Link>
          <div>
            <h1>Aura Blend</h1>
            <p>Merge your taste with a friend</p>
          </div>
        </div>

        <div className={styles.meCard}>
          {myAvatar
            ? <img src={myAvatar} alt="You" className={styles.meAvatar} />
            : <div className={styles.avatarPlaceholder}>{myName.charAt(0)}</div>
          }
          <div>
            <h3>{myName}</h3>
            <div className={styles.genrePills}>
              {MY_GENRES.map(g => <span key={g} className={styles.genrePill}>{g}</span>)}
            </div>
          </div>
        </div>

        <div className={styles.plusDivider}>
          <div className={styles.divLine} />
          <div className={styles.plusCircle}><Sparkle size={18} weight="fill" /></div>
          <div className={styles.divLine} />
        </div>

        <p className={styles.friendPickLabel}>Pick a friend to blend with</p>

        <div className={styles.friendList}>
          {FRIEND_PROFILES.map(friend => (
            <div
              key={friend.id}
              className={`${styles.friendCard} ${selectedFriend?.id === friend.id ? styles.selectedFriend : ""}`}
              onClick={() => setSelectedFriend(friend)}
            >
              <img src={friend.avatar} alt={friend.name} className={styles.friendAvatar} />
              <div className={styles.friendInfo}>
                <h3>{friend.name}</h3>
                <div className={styles.genrePills}>
                  {friend.topGenres.map(g => <span key={g} className={styles.genrePill}>{g}</span>)}
                </div>
              </div>
              {selectedFriend?.id === friend.id && (
                <div className={styles.checkMark}>✓</div>
              )}
            </div>
          ))}
        </div>

        <button
          className={styles.blendBtn}
          onClick={startBlend}
          disabled={!selectedFriend}
        >
          <Sparkle size={20} weight="fill" />
          Start Blend
        </button>
      </div>
    );
  }

  // ─── PHASE: BLENDING ANIMATION ────────────────────────
  if (phase === "blending") {
    return (
      <div className={styles.blendingScreen}>
        <div className={styles.blobStage}>
          <div className={`${styles.blob} ${styles.myBlob}`}>
            {myAvatar
              ? <img src={myAvatar} className={styles.blobImg} alt="You" />
              : <div className={styles.blobLetter}>{myName.charAt(0)}</div>
            }
          </div>
          <div className={styles.blendOrb} />
          <div className={`${styles.blob} ${styles.friendBlob}`}>
            {selectedFriend && <img src={selectedFriend.avatar} className={styles.blobImg} alt={selectedFriend.name} />}
          </div>
        </div>
        <p className={styles.blendingText}>Synchronizing your auras...</p>
        <div className={styles.blendDots}>
          <span /><span /><span />
        </div>
      </div>
    );
  }

  // ─── PHASE: RESULT ────────────────────────────────────
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button onClick={reset} className={styles.backBtn}><ArrowLeft size={22} /></button>
        <div>
          <h1>Blend Result</h1>
          <p>{myName} × {selectedFriend?.name}</p>
        </div>
      </div>

      {/* Score Card */}
      <div className={styles.scoreCard}>
        <div className={styles.scoreAvatars}>
          {myAvatar
            ? <img src={myAvatar} className={styles.scoreAvatar} alt="You" />
            : <div className={styles.avatarPlaceholderSm}>{myName.charAt(0)}</div>
          }
          <div className={styles.scoreCircle}>
            <span className={styles.scoreNum}>{score?.overall}</span>
            <span className={styles.scorePct}>%</span>
          </div>
          <img src={selectedFriend?.avatar} className={styles.scoreAvatar} alt={selectedFriend?.name} />
        </div>
        <h2 className={styles.scoreTitle}>
          {score?.overall >= 80 ? "🔥 Incredible Match!" :
           score?.overall >= 65 ? "✨ Great Vibes!" :
           "🎵 Interesting Blend!"}
        </h2>
        <div className={styles.compatBars}>
          <CompatibilityBar label="Genre Overlap" value={score?.genreOverlap} color="#a855f7" />
          <CompatibilityBar label="Energy Match" value={score?.energyMatch} color="#ec4899" />
          <CompatibilityBar label="Tempo Sync" value={score?.tempoSync} color="#06b6d4" />
        </div>
      </div>

      {/* Playlist Controls */}
      <div className={styles.playlistHeader}>
        <h2>Blended Playlist <span className={styles.trackCount}>{blendTracks.length} songs</span></h2>
        <div className={styles.playlistControls}>
          <button className={styles.controlBtn} onClick={playAll}>
            <Play size={20} weight="fill" /> Play All
          </button>
        </div>
      </div>

      {/* Tracks */}
      <div className={styles.blendTrackList}>
        {blendTracks.map((track, i) => {
          const isActive = currentTrack?.id === track.id;
          return (
            <div
              key={`${track.id}-${i}`}
              className={`${styles.blendTrack} ${isActive ? styles.activeBlendTrack : ""}`}
              onClick={() => isActive ? togglePlay() : playTrack(track, blendTracks)}
            >
              <span className={styles.ownerTag} style={{
                background: track.owner === "me"
                  ? "rgba(168,85,247,0.3)"
                  : `rgba(236,72,153,0.3)`,
                color: track.owner === "me" ? "#c084fc" : "#f9a8d4"
              }}>
                {track.owner === "me" ? myName : selectedFriend?.name}
              </span>
              <img src={track.cover} alt={track.title} className={styles.blendCover} />
              <div className={styles.blendInfo}>
                <h4 style={isActive ? { color: "#a855f7" } : {}}>
                  {track.title?.split("|")[0].split("(")[0].trim().slice(0, 28)}
                </h4>
                <p>{track.artist}</p>
              </div>
              <div className={styles.blendPlayIcon}>
                {isActive && isPlaying
                  ? <Pause size={18} weight="fill" color="#a855f7" />
                  : <Play size={18} weight="fill" />
                }
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
