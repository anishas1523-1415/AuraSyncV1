"use client";
import styles from "./page.module.css";
import { useUser, useClerk } from "@/lib/clerk";
import { useAudio } from "@/contexts/AudioContext";
import { useState, useEffect } from "react";
import {
  ChartBar, SignOut, MusicNote, Clock, Heart,
  Gear, Bell, Shield, CaretRight, Play, DownloadSimple, X, Export, Trash, Pause
} from "@phosphor-icons/react";

export default function Profile() {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const { playHistory, playTrack, currentTrack, isPlaying, togglePlay, deleteDownloadedTrack, getUserTasteProfile } = useAudio();
  const [downloadedSongs, setDownloadedSongs] = useState([]);

  useEffect(() => {
    const loadDownloads = () => {
      try {
        const stored = localStorage.getItem("aurasynq_downloaded_metadata");
        if (stored) {
          setDownloadedSongs(JSON.parse(stored));
        } else {
          setDownloadedSongs([]);
        }
      } catch (e) {
        console.warn(e);
      }
    };
    loadDownloads();
    window.addEventListener("focus", loadDownloads);
    return () => window.removeEventListener("focus", loadDownloads);
  }, []);

  const handleDeleteDownload = async (trackId, e) => {
    e.stopPropagation();
    if (confirm("Remove this downloaded song from your device?")) {
      const success = await deleteDownloadedTrack(trackId);
      if (success) {
        setDownloadedSongs(prev => prev.filter(t => t.id !== trackId));
        if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(15);
        alert("Downloaded track removed offline!");
      }
    }
  };

  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showIosGuide, setShowIosGuide] = useState(false);

  useEffect(() => {
    // Check if running on iOS
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    setIsIOS(ios);

    // Check if running in standalone mode (already installed)
    const standalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
    setIsStandalone(standalone);

    // Grab prompt if available
    if (window.deferredPrompt) {
      setDeferredPrompt(window.deferredPrompt);
    }

    const handlePromptReady = () => {
      setDeferredPrompt(window.deferredPrompt);
    };

    window.addEventListener("pwa-install-prompt-ready", handlePromptReady);
    return () => {
      window.removeEventListener("pwa-install-prompt-ready", handlePromptReady);
    };
  }, []);

  const handleInstallClick = async () => {
    if (isIOS) {
      setShowIosGuide(true);
      return;
    }
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`PWA Install Choice Outcome: ${outcome}`);
    window.deferredPrompt = null;
    setDeferredPrompt(null);
  };

  const showInstallButton = !isStandalone && (deferredPrompt || isIOS);

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
              ? `Your aura is a neon blend of ${getUserTasteProfile().topGenre} and ${getUserTasteProfile().dominantMood} vibes. You vibe heavily with ${getUserTasteProfile().topArtist}.`
              : "Start playing songs to build your aura"}
          </p>
        </div>
      </div>

      {/* Taste Breakdown Details */}
      {playHistory.length > 0 && getUserTasteProfile().stats && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Aura Breakdown</h2>
          <div className={styles.breakdownCard}>
            <div className={styles.breakdownGroup}>
              <h3>Top Genres</h3>
              {getUserTasteProfile().stats.genres.map(g => (
                <div key={g.name} className={styles.statProgressRow}>
                  <div className={styles.progressLabel}>
                    <span>{g.name}</span>
                    <span>{g.percentage}%</span>
                  </div>
                  <div className={styles.progressBar}>
                    <div 
                      className={styles.progressFill} 
                      style={{ width: `${g.percentage}%` }} 
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className={styles.breakdownGroup}>
              <h3>Mood Vibes</h3>
              {getUserTasteProfile().stats.moods.map(m => (
                <div key={m.name} className={styles.statProgressRow}>
                  <div className={styles.progressLabel}>
                    <span>{m.name}</span>
                    <span>{m.percentage}%</span>
                  </div>
                  <div className={styles.progressBar}>
                    <div 
                      className={styles.progressFill} 
                      style={{ width: `${m.percentage}%` }} 
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

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

      {/* Offline Downloads */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>Offline Downloads</h2>
          <span className={styles.downloadCount}>{downloadedSongs.length} tracks</span>
        </div>
        
        {downloadedSongs.length === 0 ? (
          <div className={styles.emptyDownloads}>
            <p>No offline tracks downloaded yet.</p>
            <p className={styles.emptySub}>Tap the download arrow in the floating dial on any playlist or player page to cache music offline!</p>
          </div>
        ) : (
          <div className={styles.downloadsList}>
            {downloadedSongs.map((track, i) => {
              const isActive = currentTrack?.id === track.id;
              return (
                <div
                  key={`${track.id}-${i}`}
                  className={`${styles.downloadItem} ${isActive ? styles.activeItem : ""}`}
                  onClick={() => isActive ? togglePlay() : playTrack(track, downloadedSongs)}
                >
                  <img src={track.cover} alt={track.title} className={styles.downloadCover} />
                  <div className={styles.downloadInfo}>
                    <h4 style={isActive ? { color: "#a855f7" } : {}}>
                      {track.title?.split("|")[0].split("(")[0].trim().slice(0, 30)}
                    </h4>
                    <p>{track.artist}</p>
                  </div>
                  <div className={styles.downloadControls}>
                    <button 
                      className={styles.deleteDownloadBtn}
                      onClick={(e) => handleDeleteDownload(track.id, e)}
                      title="Remove download"
                    >
                      <Trash size={18} />
                    </button>
                    <div className={styles.playIcon}>
                      {isActive && isPlaying
                        ? <Pause size={18} weight="fill" color="#a855f7" />
                        : <Play size={18} weight="fill" />
                      }
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Settings */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Settings</h2>
        <div className={styles.settingsList}>
          {showInstallButton && (
            <div className={styles.settingItem} onClick={handleInstallClick} style={{ cursor: "pointer" }}>
              <div className={`${styles.settingIcon} ${styles.installIcon}`}>
                <DownloadSimple size={20} color="#a855f7" />
              </div>
              <div className={styles.settingInfo}>
                <h4 style={{ color: "#a855f7" }}>Install AuraSynq</h4>
                <p>{isIOS ? "Show iOS installation details" : "Get the installable mobile app"}</p>
              </div>
              <CaretRight size={18} className={styles.chevron} />
            </div>
          )}

          {settings.map(({ icon: Icon, label, sub }) => (
            <div key={label} className={styles.settingItem}>
              <div className={styles.settingIcon}><Icon size={20} /></div>
              <div className={styles.settingInfo}>
                <h4>{label}</h4>
                <p>{sub}</p>
              </div>
              <CaretRight size={18} className={styles.chevron} />
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

      {/* iOS Installation Guide Modal */}
      {showIosGuide && (
        <div className={styles.modalOverlay} onClick={() => setShowIosGuide(false)}>
          <div className={`glass ${styles.modalContent}`} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>Install AuraSynq on iOS</h3>
              <button className={styles.closeBtn} onClick={() => setShowIosGuide(false)}>
                <X size={20} />
              </button>
            </div>
            <div className={styles.modalBody}>
              <p>Add AuraSynq to your Home Screen for a seamless full screen app experience on iOS:</p>
              <ol className={styles.instructionsList}>
                <li>
                  Open AuraSynq in the <strong>Safari</strong> browser.
                </li>
                <li>
                  Tap the <strong>Share</strong> button <Export size={20} style={{ verticalAlign: 'middle', margin: '0 2px' }} /> in Safari's toolbar.
                </li>
                <li>
                  Scroll down the menu and choose <strong>Add to Home Screen</strong>.
                </li>
                <li>
                  Tap <strong>Add</strong> in the top-right corner to finish.
                </li>
              </ol>
            </div>
            <button className={styles.dismissBtn} onClick={() => setShowIosGuide(false)}>
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
