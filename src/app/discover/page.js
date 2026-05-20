"use client";
import { trendingTracks } from "@/lib/mockData";
import styles from "./page.module.css";
import { useAudio } from "@/contexts/AudioContext";
import { Heart } from "@phosphor-icons/react/dist/ssr";
import { useEffect } from "react";

export default function Discover() {
  const { playTrack, currentTrack } = useAudio();
  
  useEffect(() => {
    // We set scroll snap on body for this page only
    document.body.style.overflow = "hidden";
    
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && entry.intersectionRatio > 0.5) {
          const trackId = entry.target.dataset.trackId;
          const track = trendingTracks.find(t => t.id === trackId);
          if (track && currentTrack?.id !== track.id) {
            playTrack(track, trendingTracks);
          }
        }
      });
    }, { threshold: 0.6 });

    const trackElements = document.querySelectorAll('.discover-track-snap');
    trackElements.forEach(el => observer.observe(el));

    return () => {
      document.body.style.overflow = "hidden"; // default
      observer.disconnect();
    };
  }, [currentTrack]);

  return (
    <div className={styles.feedContainer}>
      {trendingTracks.map(track => (
        <div key={track.id} data-track-id={track.id} className={`discover-track-snap ${styles.feedItem}`} style={{ '--track-hue': track.hue }}>
          <div className={styles.visuals}>
            <img src={track.cover} alt={track.title} className={styles.fullCover} />
            <div className={styles.gradientOverlay}></div>
          </div>
          
          <div className={styles.trackInfo}>
            <h1>{track.title}</h1>
            <p>{track.artist}</p>
          </div>
          
          <div className={styles.actions}>
            <button className={styles.actionBtn}><Heart size={32} weight="regular"/></button>
          </div>
        </div>
      ))}
    </div>
  );
}
