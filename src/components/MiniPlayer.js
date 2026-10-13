"use client";
import { useAudio } from "@/contexts/AudioContext";
import { Play, Pause } from "@phosphor-icons/react";
import styles from "./MiniPlayer.module.css";
import { useRouter } from "next/navigation";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { isMobileApp } from "@/lib/api";
import { existingYouTubeElement } from "@/lib/youtubeEmbed";

export default function MiniPlayer() {
  const { currentTrack, isPlaying, togglePlay } = useAudio();
  const router = useRouter();
  const pathname = usePathname();
  const coverRef = useRef(null);
  const visible = !!currentTrack && pathname !== "/player";

  // Website: the playing video sits in the mini player's cover spot
  useEffect(() => {
    if (isMobileApp || !visible) return;
    const media = existingYouTubeElement();
    media?.showIn(coverRef.current);
    return () => media?.showIn(null);
  }, [visible, currentTrack?.id]);

  if (!visible) return null;

  return (
    <div 
      className={`glass ${styles.miniPlayer}`} 
      onClick={() => router.push("/player")}
      style={{ cursor: "pointer" }}
    >
      <div className={styles.trackInfo}>
        <img ref={coverRef} src={currentTrack.cover} alt="Cover" className={styles.cover} />
        <div className={styles.textInfo}>
          <span className={styles.title}>{currentTrack.title}</span>
          <span className={styles.artist}>{currentTrack.artist}</span>
        </div>
      </div>
      <button 
        className={styles.playBtn} 
        onClick={(e) => { 
          e.preventDefault(); 
          e.stopPropagation(); 
          togglePlay(); 
        }}
      >
        {isPlaying ? <Pause size={24} weight="fill" /> : <Play size={24} weight="fill" />}
      </button>
    </div>
  );
}
