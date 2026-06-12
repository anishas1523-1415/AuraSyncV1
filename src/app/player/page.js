"use client";
import { useState, useEffect, useRef } from "react";
import { useAudio, useAudioProgress } from "@/contexts/AudioContext";
import styles from "./page.module.css";
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from "framer-motion";
import { Play, Pause, SkipBack, SkipForward, CaretDown, Shuffle, ListBullets, Heart, Share } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";

export default function Player() {
  const router = useRouter();
  const { 
    currentTrack, isPlaying, isBuffering, togglePlay, seekTo, playNext, playPrevious, queue, removeFromQueue, playTrack, isShuffle, toggleShuffle,
    toggleLikeTrack, isTrackLiked
  } = useAudio();
  const { progress, duration } = useAudioProgress();
  const [showLyrics, setShowLyrics] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [swipeDirection, setSwipeDirection] = useState("next");
  const [isQueueSynced, setIsQueueSynced] = useState(false);

  const isLiked = currentTrack ? isTrackLiked(currentTrack.id) : false;

  const handleLikeClick = (e) => {
    e.stopPropagation();
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(12);
    toggleLikeTrack(currentTrack);
  };

  const handleShareClick = async (e) => {
    e.stopPropagation();
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(10);
    if (typeof window !== "undefined") {
      const shareUrl = `${window.location.origin}/player?track=${currentTrack.id}`;
      if (navigator.share) {
        navigator.share({
          title: currentTrack.title,
          text: `🎵 Vibe with me to "${currentTrack.title}" by ${currentTrack.artist} on AuraSynq!`,
          url: shareUrl
        }).catch(() => {});
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(shareUrl);
          alert("Song link copied to clipboard!");
        } catch (err) {
          alert("Share link: " + shareUrl);
        }
      } else {
        alert("Share link: " + shareUrl);
      }
    }
  };

  useEffect(() => {
    async function checkQueueSync() {
      if (queue.length === 0 || typeof window === "undefined" || !("caches" in window)) return;
      try {
        const cache = await caches.open("aurasynq_offline_audio");
        let allCached = true;
        let hasDirect = false;
        for (const track of queue) {
          const isDirectAudio = track.url && /\.mp3($|\?)/i.test(track.url);
          if (isDirectAudio) {
            hasDirect = true;
            const matched = await cache.match(track.url);
            if (!matched) {
              allCached = false;
              break;
            }
          }
        }
        setIsQueueSynced(hasDirect && allCached);
      } catch (err) {
        console.warn(err);
      }
    }
    checkQueueSync();
  }, [queue]);


  const lastClickTime = useRef(0);
  const activeLineRef = useRef(null);

  // Motion values to track drag offset and drive rotation/badge opacities dynamically
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-15, 15]);
  const skipOpacity = useTransform(x, [-120, -20], [1, 0]);
  const prevOpacity = useTransform(x, [20, 120], [0, 1]);

  // Reset x motion position whenever the song changes
  useEffect(() => {
    // Only reset if we somehow got stuck, normal flow handles x.set(0) in the swipe/btn handlers
    x.set(0);
  }, [currentTrack?.id]);

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
      if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(12);
      setShowLyrics(prev => !prev);
      setShowQueue(false);
    } else {
      if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(10);
      togglePlay();
    }
    lastClickTime.current = now;
  };

  const handleDragEnd = (event, info) => {
    const swipeThreshold = 80;
    const velocityThreshold = 400;
    const dragDistance = info.offset.x;
    const dragVelocity = info.velocity.x;

    const hasNext = queue && queue.length > 1;
    const hasPrev = queue && queue.length > 1;

    if (dragDistance < -swipeThreshold || dragVelocity < -velocityThreshold) {
      if (hasNext) {
        setSwipeDirection("next");
        if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(12);
        animate(x, -500, { duration: 0.2 }).then(() => {
          x.set(0);
          playNext(true);
        });
      } else {
        animate(x, 0, { type: "spring", stiffness: 300, damping: 22 });
      }
    } else if (dragDistance > swipeThreshold || dragVelocity > velocityThreshold) {
      if (hasPrev) {
        setSwipeDirection("prev");
        if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(12);
        animate(x, 500, { duration: 0.2 }).then(() => {
          x.set(0);
          playPrevious(true);
        });
      } else {
        animate(x, 0, { type: "spring", stiffness: 300, damping: 22 });
      }
    } else {
      // Smoothly snap back to center using spring physics
      animate(x, 0, { type: "spring", stiffness: 300, damping: 22 });
    }
  };

  const handleBtnPrev = (e) => {
    e.stopPropagation();
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(12);
    setSwipeDirection("prev");
    animate(x, 500, { duration: 0.2 }).then(() => {
      x.set(0);
      playPrevious(true);
    });
  };

  const handleBtnNext = (e) => {
    e.stopPropagation();
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(12);
    setSwipeDirection("next");
    animate(x, -500, { duration: 0.2 }).then(() => {
      x.set(0);
      playNext(true);
    });
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

  const percent = duration ? (progress / duration) * 100 : 0;

  const cardVariants = {
    enter: (dir) => ({
      left: dir === "next" ? 300 : dir === "prev" ? -300 : 0,
      rotate: dir === "next" ? 15 : dir === "prev" ? -15 : 0,
      opacity: 0,
      scale: 0.92
    }),
    center: {
      left: 0,
      rotate: 0,
      opacity: 1,
      scale: 1,
      transition: {
        left: { type: "spring", stiffness: 300, damping: 25 },
        rotate: { type: "spring", stiffness: 300, damping: 25 },
        opacity: { duration: 0.2 },
        scale: { duration: 0.2 }
      }
    },
    exit: (dir) => ({
      left: dir === "next" ? -400 : dir === "prev" ? 400 : 0,
      rotate: dir === "next" ? -25 : dir === "prev" ? 25 : 0,
      opacity: 0,
      scale: 0.92,
      transition: {
        left: { duration: 0.3, ease: "easeOut" },
        rotate: { duration: 0.3, ease: "easeOut" },
        opacity: { duration: 0.2 },
        scale: { duration: 0.2 }
      }
    })
  };

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
            <motion.div 
              key={currentTrack.id}
              custom={swipeDirection}
              variants={cardVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className={styles.minimalPlayer}
              drag="x"
              dragConstraints={{ left: -400, right: 400 }}
              onDragEnd={handleDragEnd}
              style={{ x, rotate }}
              onTap={handleTap}
            >
              {/* Share (Top Left) and Like (Top Right) absolute buttons inside card */}
              <button 
                className={`${styles.cardActionBtn} ${styles.cardShareBtn}`} 
                onClick={handleShareClick}
                title="Share Song"
              >
                <Share size={22} />
              </button>

              <button 
                className={`${styles.cardActionBtn} ${styles.cardLikeBtn} ${isLiked ? styles.liked : ""}`}
                onClick={handleLikeClick}
                title={isLiked ? "Unlike Song" : "Like Song"}
              >
                <Heart size={24} weight={isLiked ? "fill" : "regular"} />
              </button>

              {/* Tinder-style SKIP and PREV visual stamp overlays */}
              <motion.div className={styles.skipBadge} style={{ opacity: skipOpacity }}>
                <span>SKIP</span>
              </motion.div>
              <motion.div className={styles.prevBadge} style={{ opacity: prevOpacity }}>
                <span>PREV</span>
              </motion.div>

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
                  max={duration || 100}
                  value={progress}
                  onChange={(e) => seekTo(parseFloat(e.target.value))}
                  className={styles.seekBar}
                  style={{
                    background: `linear-gradient(to right, var(--primary-color, #a855f7) ${percent}%, rgba(255, 255, 255, 0.2) ${percent}%)`
                  }}
                />
                <span className={styles.timeText}>{formatTime(duration)}</span>
              </div>

              <p className={styles.hint}>Swipe left/right to change • Double tap for lyrics</p>
            </motion.div>
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
    </div>
  );
}
