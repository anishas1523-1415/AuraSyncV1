"use client";
import styles from "./page.module.css";
import { useUser, useClerk } from "@clerk/nextjs";
import { useAudio } from "@/contexts/AudioContext";
import {
  ChartBar, SignOut, MusicNote, Clock, Heart,
  Gear, Bell, Shield, ChevronRight, Play
} from "@phosphor-icons/react/dist/ssr";

export default function Profile() {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const { playHistory, playTrack, currentTrack, isPlaying, togglePlay } = useAudio();

  const displayName = isLoaded && user
    ? user.fullName || user.firstName || "Music Lover"
    : "Loading...";
  const avatarUrl = isLoaded && user
    ? user.imageUrl
    : null;
  const email = isLoaded && user
    ? user.primaryEmailAddress?.emailAddress
    : "";
  const memberSince = isLoaded && user
    ? new Date(user.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : "";

  const totalMinutes = playHistory.length * 4; // avg 4 min per track
  const uniqueArtists = [...new Set(playHistory.map(t => t.artist))].length;

  const handleSignOut = () => signOut({ redirectUrl: "/" });

  const settings = [
    { icon: Bell, label: "Notifications", sub: "Manage alerts" },
    { icon: Shield, label: "Privacy", sub: "Data & permissions" },
    { icon: Gear, label: "Preferences", sub: "App settings" },
  ];

  return (
    <div className={styles.container}>
      {/* Hero Header */}
      <div className={styles.hero}>
        <div className={styles.heroBg} />
        {avatarUrl ? (
          <img src={avatarUrl} alt="Avatar" className={styles.avatar} />
        ) : (
          <div className={styles.avatarPlaceholder}>
            {displayName.charAt(0).toUpperCase()}
          </div>
        )}
        <h1 className={styles.name}>{displayName}</h1>
        <p className={styles.email}>{email}</p>
        {memberSince && (
          <span className={styles.memberBadge}>🎵 Member since {memberSince}</span>
        )}
      </div>

      {/* Stats Row */}
      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <Clock size={22} color="#a855f7" />
          <h3>{totalMinutes}</h3>
          <p>Min Played</p>
        </div>
        <div className={styles.statCard}>
          <MusicNote size={22} color="#ec4899" />
          <h3>{playHistory.length}</h3>
          <p>Songs Played</p>
        </div>
        <div className={styles.statCard}>
          <Heart size={22} color="#f43f5e" />
          <h3>{uniqueArtists}</h3>
          <p>Artists</p>
        </div>
      </div>

      {/* Aura Orb */}
      <div className={styles.auraSection}>
        <div className={styles.orbWrapper}>
          <div className={styles.auraOrb} />
          <div className={styles.orbRing} />
        </div>
        <div className={styles.auraText}>
          <h2>Your Sound Aura</h2>
          <p>
            {playHistory.length > 0
              ? `You vibe with ${playHistory[0]?.artist?.split(" ")[0]} and similar artists`
              : "Start playing songs to build your aura"}
          </p>
        </div>
      </div>

      {/* Recently Played */}
      {playHistory.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2>Recently Played</h2>
          </div>
          <div className={styles.historyList}>
            {playHistory.slice(0, 8).map((track, i) => {
              const isActive = currentTrack?.id === track.id;
              return (
                <div
                  key={`${track.id}-${i}`}
                  className={`${styles.historyItem} ${isActive ? styles.activeItem : ""}`}
                  onClick={() => isActive ? togglePlay() : playTrack(track, playHistory)}
                >
                  <img src={track.cover} alt={track.title} className={styles.historyCover} />
                  <div className={styles.historyInfo}>
                    <h4 style={isActive ? { color: "#a855f7" } : {}}>
                      {track.title?.split("|")[0].split("(")[0].trim().slice(0, 30)}
                    </h4>
                    <p>{track.artist}</p>
                  </div>
                  <Play size={18} weight="fill" className={styles.historyPlay} />
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Settings */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Settings</h2>
        <div className={styles.settingsList}>
          {settings.map(({ icon: Icon, label, sub }) => (
            <div key={label} className={styles.settingItem}>
              <div className={styles.settingIcon}><Icon size={20} /></div>
              <div className={styles.settingInfo}>
                <h4>{label}</h4>
                <p>{sub}</p>
              </div>
              <ChevronRight size={18} className={styles.chevron} />
            </div>
          ))}

          {/* Sign Out */}
          <div className={styles.settingItem} onClick={handleSignOut} style={{ cursor: "pointer" }}>
            <div className={`${styles.settingIcon} ${styles.dangerIcon}`}>
              <SignOut size={20} />
            </div>
            <div className={styles.settingInfo}>
              <h4 style={{ color: "#f43f5e" }}>Sign Out</h4>
              <p>Log out of AuraSynq</p>
            </div>
          </div>
        </div>
      </section>

      <p className={styles.version}>AuraSynq v1.0 · Made with ❤️</p>
    </div>
  );
}
