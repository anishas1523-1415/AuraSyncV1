"use client";
import { useState, useEffect, useRef, forwardRef } from "react";
import { useAudio, useAudioProgress } from "@/contexts/AudioContext";
import styles from "./page.module.css";
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from "framer-motion";
import { Play, Pause, SkipBack, SkipForward, CaretDown, Shuffle, ListBullets, Heart, Share, ListPlus } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { shareOrCopy } from "@/lib/toast";
import { siteUrl } from "@/lib/api";
import { useCloseOnBack } from "@/lib/backButton";
import SyncButton from "@/components/SyncButton";
import AddToPlaylistModal from "@/components/AddToPlaylistModal";

export default function Player() {
  const router = useRouter();
  const { 
    currentTrack, isPlaying, isBuffering, togglePlay, seekTo, playNext, playPrevious, queue, removeFromQueue, playTrack, isShuffle, toggleShuffle,
    toggleLikeTrack, isTrackLiked, syncUpNext
  } = useAudio();
  const { progress, duration } = useAudioProgress();
  const [showLyrics, setShowLyrics] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [swipeDirection, setSwipeDirection] = useState("next");
  const [playlistTrack, setPlaylistTrack] = useState(null); // song being added to a playlist
  useCloseOnBack(showLyrics, () => setShowLyrics(false));
  useCloseOnBack(showQueue, () => setShowQueue(false));

  const isLiked = currentTrack ? isTrackLiked(currentTrack.id) : false;

  const handleLikeClick = (e) => {
    e.stopPropagation();
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(12);
    toggleLikeTrack(currentTrack);
  };

  const handleShareClick = async (e) => {
    e.stopPropagation();
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(10);
    // Title and artist ride along so the receiver sees the song instantly, without a lookup
    const title = currentTrack.title?.split("|")[0].split("(")[0].trim() || "";
    const shareUrl = siteUrl(`/player?track=${encodeURIComponent(currentTrack.id)}`) +
      `&t=${encodeURIComponent(title)}&a=${encodeURIComponent(currentTrack.artist || "")}`;
    await shareOrCopy({
      title: currentTrack.title,
      text: `🎵 Vibe with me to "${title}" by ${currentTrack.artist} on AuraSynq!`,
      url: shareUrl
    }, "Song link copied to clipboard!");
  };

  const lastClickTime = useRef(0);
  const clickTimeout = useRef(null);
  const activeLineRef = useRef(null);

  // Find the active lyric line based on progress
  const activeLyricIndex = currentTrack?.lyrics ? currentTrack.lyrics.findIndex((l, i, arr) => {
    const nextLine = arr[i + 1];
    return progress >= l.time && (!nextLine || progress < nextLine.time);
  }) : -1;

  useEffect(() => {
    if (currentTrack) {
      document.documentElement.style.setProperty('--aura-hue', currentTrack.hue);
    }
  }, [currentTrack]);

  // Automatically scroll active lyric line to center
  useEffect(() => {
    if (showLyrics && activeLineRef.current) {
      activeLineRef.current.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
    }
  }, [activeLyricIndex, showLyrics]);

  if (!currentTrack) {
    return <div className={styles.container}><h1 className={styles.empty}>Select a track from the Bubbles to begin</h1></div>;
  }

  const formatTime = (seconds) => {
    if (isNaN(seconds) || seconds === null) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const handleTap = (e) => {
    const now = Date.now();
    const timeDiff = now - lastClickTime.current;
    
    if (timeDiff < 300) {
      clearTimeout(clickTimeout.current);
      if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(12);
      setShowLyrics(prev => !prev);
      setShowQueue(false);
    } else {
      clickTimeout.current = setTimeout(() => {
        if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(10);
        togglePlay();
      }, 300);
    }
    lastClickTime.current = now;
  };

  // framer-motion's tap listens on the card element itself, so the buttons' React
  // stopPropagation runs too late: taps on Like, Share or the seek bar also toggled playback.
  const handleCardTap = (event) => {
    if (event?.target?.closest?.("button, input, a")) return;
    handleTap(event);
  };

  // The outgoing card flies off from wherever it is (its exit animation) while the new one
  // slides in; the song changes right away instead of after an animation
  const goTo = (direction) => {
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(12);
    setSwipeDirection(direction);
    if (direction === "next") playNext(true);
    else playPrevious(true);
  };

  const handleBtnPrev = (e) => {
    e.stopPropagation();
    goTo("prev");
  };

  const handleBtnNext = (e) => {
    e.stopPropagation();
    goTo("next");
  };

  const handlePlayFromQueue = (track) => {
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(12);
    playTrack(track, queue);
  };

  const handleRemoveFromQueue = (trackId, e) => {
    e.stopPropagation();
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(8);
    removeFromQueue(trackId);
  };

  const hasDuration = Number.isFinite(duration) && duration > 0;
  const percent = hasDuration ? Math.min(100, (progress / duration) * 100) : 0;

  return (
    <div className={styles.container}>
      <div className={`${styles.background} ${isPlaying ? styles.pulse : ''}`}></div>
      
      <button className={styles.collapseBtn} onClick={() => router.back()} title="Collapse Player">
        <CaretDown size={24} weight="bold" />
      </button>

      <button 
        className={`${styles.queueBtn} ${showQueue ? styles.activeQueueBtn : ""}`} 
        onClick={() => {
          if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(10);
          setShowQueue(prev => !prev);
          setShowLyrics(false);
        }} 
        title="View Queue"
      >
        <ListBullets size={24} weight="bold" />
      </button>
      
      {!showLyrics && !showQueue ? (
        <div className={styles.cardWrapper}>
          <AnimatePresence initial={false} custom={swipeDirection} mode="popLayout">
            <SwipeCard
              key={currentTrack.id}
              direction={swipeDirection}
              onSwipe={goTo}
              onTap={handleCardTap}
            >
              {/* Share (Top Left) and Like (Top Right) absolute buttons inside card */}
              <button 
                className={`${styles.cardActionBtn} ${styles.cardShareBtn}`} 
                onClick={handleShareClick}
                onPointerDown={(e) => e.stopPropagation()}
                title="Share Song"
              >
                <Share size={22} />
              </button>

              <button 
                className={`${styles.cardActionBtn} ${styles.cardLikeBtn} ${isLiked ? styles.liked : ""}`}
                onClick={handleLikeClick}
                onPointerDown={(e) => e.stopPropagation()}
                title={isLiked ? "Unlike Song" : "Like Song"}
              >
                <Heart size={24} weight={isLiked ? "fill" : "regular"} />
              </button>

              <button 
                className={`${styles.cardActionBtn} ${styles.cardPlaylistBtn}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(10);
                  setPlaylistTrack(currentTrack);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                title="Add to Playlist"
              >
                <ListPlus size={22} />
              </button>

              <div className={styles.coverContainer} onClick={(e) => e.stopPropagation()}>
                <img 
                  src={currentTrack.cover} 
                  alt="Cover" 
                  className={`${styles.cover} ${isBuffering ? styles.loadingCover : ''}`} 
                  onError={(e) => {
                    // Fallback to visual placeholder if offline/blocked
                    e.target.src = "/icon-192x192.png";
                  }}
                />
                {isBuffering && (
                  <div className={styles.loaderOverlay}>
                    <div className={styles.spinner}></div>
                    <span>Streaming...</span>
                  </div>
                )}
              </div>
              
              <div className={styles.info} onClick={(e) => e.stopPropagation()}>
                <h1>{currentTrack.title?.split("|")[0].split("(")[0].trim()}</h1>
                <p>{currentTrack.artist}</p>
              </div>

              {/* Seek Slider */}
              <div 
                className={styles.sliderContainer} 
                onClick={(e) => e.stopPropagation()} 
                onDoubleClick={(e) => e.stopPropagation()}
              >
                <span className={styles.timeText}>{formatTime(progress)}</span>
                <input 
                  type="range"
                  min="0"
                  max={hasDuration ? duration : 100}
                  value={progress}
                  onChange={(e) => seekTo(parseFloat(e.target.value))}
                  className={styles.seekBar}
                  style={{
                    background: `linear-gradient(to right, var(--primary-color, #a855f7) ${percent}%, rgba(255, 255, 255, 0.2) ${percent}%)`
                  }}
                />
                <span className={styles.timeText}>{formatTime(hasDuration ? duration : 0)}</span>
              </div>

              <p className={styles.hint}>Swipe left/right to change • Double tap for lyrics</p>
            </SwipeCard>
          </AnimatePresence>

          {/* Centered Media Controls */}
          <div className={styles.tinderActions}>
            <button 
              className={styles.actionBtnPrev} 
              onClick={handleBtnPrev}
              title="Previous Song"
            >
              <SkipBack size={22} weight="fill" />
            </button>
            
            <button 
              className={styles.actionBtnPlay} 
              onClick={(e) => { e.stopPropagation(); if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(10); togglePlay(); }}
              title={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? <Pause size={26} weight="fill" /> : <Play size={26} weight="fill" />}
            </button>
            
            <button 
              className={styles.actionBtnNext} 
              onClick={handleBtnNext}
              title="Next Song"
            >
              <SkipForward size={22} weight="fill" />
            </button>
          </div>
        </div>
      ) : showQueue ? (
        <div className={styles.queueView}>
          <div className={styles.queueHeader}>
            <h2>Up Next</h2>
            <div className={styles.queueHeaderRight}>
              <button
                className={`${styles.queueShuffleBtn} ${isShuffle ? styles.activeShuffle : ""}`}
                onClick={() => {
                  if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(10);
                  toggleShuffle();
                }}
                title={isShuffle ? "Shuffle on" : "Shuffle off"}
              >
                <Shuffle size={13} weight="bold" />
              </button>
              <SyncButton size="sm" onSync={syncUpNext} />
              <span className={styles.queueCount}>{queue.length} songs</span>
            </div>
          </div>
          <div className={styles.queueList}>
            {queue.map((track, i) => {
              const isActive = currentTrack.id === track.id;
              return (
                <div 
                  key={`${track.id}-${i}`}
                  className={`${styles.queueItem} ${isActive ? styles.activeQueueItem : ""}`}
                  onClick={() => handlePlayFromQueue(track)}
                >
                  <img src={track.cover} alt="" className={styles.queueThumb} />
                  <div className={styles.queueInfo}>
                    <h4>{track.title?.split("|")[0].split("(")[0].trim()}</h4>
                    <p>{track.artist}</p>
                  </div>
                  <div className={styles.queueActions}>
                    {queue.length > 1 && (
                      <button 
                        className={styles.removeQueueBtn} 
                        onClick={(e) => handleRemoveFromQueue(track.id, e)}
                        title="Remove from queue"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          
          <button 
            className={styles.closeQueueBtn} 
            onClick={() => setShowQueue(false)}
          >
            Back to Player
          </button>
        </div>
      ) : (
        <div className={styles.lyricsView} onClick={handleTap}>
          <div className={styles.waterfall}>
            {currentTrack.lyrics?.map((line, i) => {
              const isActive = i === activeLyricIndex;
              const isPast = i < activeLyricIndex;
              return (
                <div 
                  key={i} 
                  ref={isActive ? activeLineRef : null}
                  className={`${styles.lyricLine} ${isActive ? styles.lyricActive : ''} ${isPast ? styles.lyricPast : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    seekTo(line.time);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                  }}
                >
                  {line.text}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Rendered at the page level so the sheet covers the whole screen */}
      {playlistTrack && (
        <AddToPlaylistModal track={playlistTrack} onClose={() => setPlaylistTrack(null)} />
      )}
    </div>
  );
}

const cardVariants = {
  enter: (dir) => ({
    x: dir === "prev" ? -300 : 300,
    rotateZ: dir === "prev" ? -15 : 15,
    opacity: 0,
    scale: 0.92
  }),
  center: {
    x: 0,
    rotateZ: 0,
    opacity: 1,
    scale: 1,
    transition: {
      x: { type: "spring", stiffness: 300, damping: 28 },
      rotateZ: { type: "spring", stiffness: 300, damping: 28 },
      opacity: { duration: 0.2 },
      scale: { duration: 0.2 }
    }
  },
  exit: (dir) => ({
    x: dir === "prev" ? 500 : -500,
    rotateZ: dir === "prev" ? 25 : -25,
    opacity: 0,
    scale: 0.92,
    transition: {
      x: { duration: 0.28, ease: "easeOut" },
      rotateZ: { duration: 0.28, ease: "easeOut" },
      opacity: { duration: 0.22 },
      scale: { duration: 0.22 }
    }
  })
};

const SWIPE_DISTANCE = 80;
const SWIPE_VELOCITY = 400;
const SNAP_BACK = { type: "spring", stiffness: 300, damping: 22 };

// One song card. Each card owns its drag position, so the card leaving keeps flying from where
// the finger let go (a shared position used to snap it back to the middle first: the glitch).
// Forwards its ref: AnimatePresence's popLayout mode measures the card through it.
const SwipeCard = forwardRef(function SwipeCard({ direction, onSwipe, onTap, children }, ref) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-15, 15]);
  const skipOpacity = useTransform(x, [-120, -20], [1, 0]);
  const prevOpacity = useTransform(x, [20, 120], [0, 1]);

  const handleDragEnd = (event, info) => {
    const distance = info.offset.x;
    const velocity = info.velocity.x;
    if (distance < -SWIPE_DISTANCE || velocity < -SWIPE_VELOCITY) onSwipe("next");
    else if (distance > SWIPE_DISTANCE || velocity > SWIPE_VELOCITY) onSwipe("prev");
    // Back to the middle; if the song changed, this card's exit animation takes over instead
    animate(x, 0, SNAP_BACK);
  };

  return (
    <motion.div
      ref={ref}
      custom={direction}
      variants={cardVariants}
      initial="enter"
      animate="center"
      exit="exit"
      className={styles.minimalPlayer}
      drag="x"
      dragConstraints={{ left: -400, right: 400 }}
      onDragEnd={handleDragEnd}
      style={{ x, rotate }}
      onTap={onTap}
    >
      {children}

      {/* Tinder-style SKIP and PREV visual stamp overlays */}
      <motion.div className={styles.skipBadge} style={{ opacity: skipOpacity }}>
        <span>SKIP</span>
      </motion.div>
      <motion.div className={styles.prevBadge} style={{ opacity: prevOpacity }}>
        <span>PREV</span>
      </motion.div>
    </motion.div>
  );
});
