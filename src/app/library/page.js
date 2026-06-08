"use client";
import { useState, useEffect } from "react";
import { useAudio } from "@/contexts/AudioContext";
import { 
  Heart, Plus, MusicNote, ArrowLeft, Play, Pause, Trash, 
  PencilSimple, Users, UserPlus, Sparkle, PlusCircle, Check, DownloadSimple
} from "@phosphor-icons/react";
import styles from "./page.module.css";

// Recommended songs to add to custom playlists
const RECOMMENDATIONS = [
  { id: "lofi1", title: "Midnight Coffee", artist: "Lofi Beats", cover: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=100&q=80", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3", hue: 280 },
  { id: "lofi2", title: "Rainy Sunday", artist: "Chill Hop", cover: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=100&q=80", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3", hue: 210 },
  { id: "synth1", title: "Neon Skyline", artist: "Retro Wave", cover: "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=100&q=80", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3", hue: 330 },
  { id: "chill1", title: "Summer Breeze", artist: "Acoustic Sun", cover: "https://images.unsplash.com/photo-1458560871784-56d23406c091?w=100&q=80", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3", hue: 45 },
  { id: "chill2", title: "Forest Walk", artist: "Nature Sounds", cover: "https://images.unsplash.com/photo-1493225457124-a1a2a5f5f9af?w=100&q=80", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3", hue: 120 }
];

export default function Library() {
  const { 
    likedTracks, toggleLikeTrack, 
    customPlaylists, createPlaylist, deletePlaylist, renamePlaylist, 
    addTrackToPlaylist, removeTrackFromPlaylist, toggleCollaborative,
    playTrack, currentTrack, isPlaying, togglePlay, setContextPlaylist, downloadTrack
  } = useAudio();

  const [selectedPlaylistId, setSelectedPlaylistId] = useState(null); // null | "liked" | playlistId
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renamePlaylistName, setRenamePlaylistName] = useState("");
  const [activeTab, setActiveTab] = useState("all"); // "all" | "playlists" | "liked"
  const [isSyncing, setIsSyncing] = useState(false);

  // Fetch the currently active playlist object
  const activePlaylist = selectedPlaylistId === "liked" 
    ? { id: "liked", name: "Liked Songs", tracks: likedTracks, isSystem: true }
    : customPlaylists.find(p => p.id === selectedPlaylistId);

  // Set the global AudioContext playlist context so AuraDial can sync it
  useEffect(() => {
    if (activePlaylist) {
      setContextPlaylist({
        type: activePlaylist.isSystem ? "liked" : "custom",
        id: activePlaylist.id,
        title: activePlaylist.name,
        tracks: activePlaylist.tracks
      });
    } else {
      setContextPlaylist(null);
    }
  }, [selectedPlaylistId, activePlaylist?.tracks?.length]);

  const handleCreatePlaylist = (e) => {
    e.preventDefault();
    const name = newPlaylistName.trim();
    if (!name) return;
    const created = createPlaylist(name);
    setNewPlaylistName("");
    setShowCreateModal(false);
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(12);
    setSelectedPlaylistId(created.id);
  };

  const handleRenamePlaylist = (e) => {
    e.preventDefault();
    const name = renamePlaylistName.trim();
    if (!name) return;
    renamePlaylist(selectedPlaylistId, name);
    setRenamePlaylistName("");
    setShowRenameModal(false);
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(12);
  };

  const handleDeletePlaylist = () => {
    if (confirm("Are you sure you want to delete this playlist?")) {
      deletePlaylist(selectedPlaylistId);
      setSelectedPlaylistId(null);
      if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(20);
    }
  };

  const handleSimulateCollab = () => {
    if (!activePlaylist) return;
    // Find recommendations not already in the playlist
    const available = RECOMMENDATIONS.filter(r => !activePlaylist.tracks.some(t => t.id === r.id));
    if (available.length === 0) {
      alert("All collaborative suggestions have already been added!");
      return;
    }
    
    const randomTrack = available[Math.floor(Math.random() * available.length)];
    const collaborators = ["Arun", "Meera", "Priya"];
    const friend = collaborators[Math.floor(Math.random() * collaborators.length)];
    
    // Add track
    addTrackToPlaylist(activePlaylist.id, {
      ...randomTrack,
      collaborator: friend // tag collaborator
    });

    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate([40, 50, 40]);
    }
    alert(`${friend} added a track: "${randomTrack.title}"!`);
  };

  const handleInviteFriend = () => {
    const inviteUrl = `${window.location.origin}/invite-blend?playlist=${selectedPlaylistId}`;
    if (navigator.share) {
      navigator.share({
        title: "Collaborate on AuraSynq",
        text: `Hey, join my collaborative playlist "${activePlaylist.name}" on AuraSynq!`,
        url: inviteUrl
      }).catch(() => {});
    } else {
      navigator.clipboard.writeText(inviteUrl);
      alert("Collaborative invite link copied to clipboard!");
    }
  };

  const playPlaylist = () => {
    if (activePlaylist && activePlaylist.tracks.length > 0) {
      playTrack(activePlaylist.tracks[0], activePlaylist.tracks);
    }
  };

  const handleSyncPlaylist = async () => {
    if (!activePlaylist || !activePlaylist.tracks || activePlaylist.tracks.length === 0) return;
    if (isSyncing) return;
    
    setIsSyncing(true);
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate([60, 40, 60]);
    
    try {
      let syncCount = 0;
      let directCount = 0;
      for (const track of activePlaylist.tracks) {
        const isDirect = track.url && /\.mp3($|\?)/i.test(track.url);
        if (isDirect) {
          directCount++;
          const success = await downloadTrack(track);
          if (success) syncCount++;
        }
      }
      if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(100);
      if (directCount === 0) {
        alert("AuraSynq offline sync is only available for MP3 audio streams. YouTube video streams cannot be cached.");
      } else {
        alert(`Successfully synced ${syncCount} of ${directCount} tracks from "${activePlaylist.name}" offline!`);
      }
    } catch (err) {
      console.warn(err);
    } finally {
      setIsSyncing(false);
    }
  };

  // ─── PLAYLIST DETAIL SUBVIEW ────────────────────────────
  if (selectedPlaylistId && activePlaylist) {
    const hasTracks = activePlaylist.tracks && activePlaylist.tracks.length > 0;
    
    return (
      <div className={styles.container}>
        <div className={styles.detailHeader}>
          <button onClick={() => setSelectedPlaylistId(null)} className={styles.backBtn}>
            <ArrowLeft size={24} weight="bold" />
          </button>
          
          <div className={styles.playlistMeta}>
            <div className={styles.playlistTitleContainer}>
              <h1>{activePlaylist.name}</h1>
              {!activePlaylist.isSystem && (
                <button 
                  onClick={() => {
                    setRenamePlaylistName(activePlaylist.name);
                    setShowRenameModal(true);
                  }}
                  className={styles.metaBtn}
                  title="Rename Playlist"
                >
                  <PencilSimple size={18} />
                </button>
              )}
            </div>
            <p className={styles.metaInfo}>
              {activePlaylist.isSystem ? "AuraSynq Collection" : "Custom Playlist"} • {activePlaylist.tracks?.length || 0} songs
            </p>
          </div>
        </div>

        {/* Playlist Action Bar */}
        <div className={styles.actionBar}>
          <button 
            className={styles.playAllBtn}
            onClick={playPlaylist}
            disabled={!hasTracks}
            style={{ opacity: hasTracks ? 1 : 0.5 }}
          >
            <Play size={20} weight="fill" /> Play
          </button>

          <button 
            className={`${styles.actionToggle} ${isSyncing ? styles.actionActive : ""}`}
            onClick={handleSyncPlaylist}
            disabled={!hasTracks || isSyncing}
            style={{ opacity: hasTracks ? 1 : 0.5 }}
            title="Sync Offline"
          >
            <DownloadSimple size={20} weight={isSyncing ? "fill" : "regular"} />
            <span>{isSyncing ? "Syncing..." : "Sync"}</span>
          </button>

          {!activePlaylist.isSystem && (
            <div className={styles.customPlaylistActions}>
              <button 
                className={`${styles.actionToggle} ${activePlaylist.isCollaborative ? styles.actionActive : ""}`}
                onClick={() => toggleCollaborative(activePlaylist.id)}
                title="Toggle Collaborative Mode"
              >
                <Users size={20} weight={activePlaylist.isCollaborative ? "fill" : "regular"} />
                <span>{activePlaylist.isCollaborative ? "Collaborative" : "Make Collab"}</span>
              </button>

              {activePlaylist.isCollaborative && (
                <>
                  <button className={styles.actionToggle} onClick={handleInviteFriend} title="Invite Collaborator">
                    <UserPlus size={20} />
                  </button>
                  <button className={styles.actionToggle} onClick={handleSimulateCollab} title="Simulate Friend Activity">
                    <Sparkle size={20} color="#a855f7" weight="fill" />
                  </button>
                </>
              )}

              <button className={styles.deleteBtn} onClick={handleDeletePlaylist} title="Delete Playlist">
                <Trash size={20} />
              </button>
            </div>
          )}
        </div>

        {/* Collaborators row if active */}
        {activePlaylist.isCollaborative && activePlaylist.collaborators?.length > 0 && (
          <div className={styles.collabRow}>
            <span className={styles.collabLabel}>Collaborators:</span>
            <div className={styles.collabAvatars}>
              {activePlaylist.collaborators.map((c, idx) => (
                <img key={idx} src={c.avatar} alt={c.name} title={c.name} className={styles.collabAvatar} />
              ))}
            </div>
          </div>
        )}

        {/* Tracks List */}
        <div className={styles.trackList}>
          {!hasTracks ? (
            <div className={styles.emptyPlaylist}>
              <MusicNote size={48} weight="thin" />
              <p>This playlist is empty.</p>
              <p className={styles.emptySub}>Add recommended songs below or search to find music!</p>
            </div>
          ) : (
            activePlaylist.tracks.map((track, i) => {
              const isActive = currentTrack?.id === track.id;
              return (
                <div key={`${track.id}-${i}`} className={`${styles.trackItem} ${isActive ? styles.activeTrack : ""}`}>
                  <span className={styles.trackIndex}>
                    {isActive && isPlaying ? <span className={styles.playingBar} /> : i + 1}
                  </span>
                  <img 
                    src={track.cover} 
                    alt="" 
                    className={styles.trackCover} 
                    onClick={() => playTrack(track, activePlaylist.tracks)}
                  />
                  <div className={styles.trackInfo} onClick={() => playTrack(track, activePlaylist.tracks)}>
                    <h4 style={isActive ? { color: "#a855f7" } : {}}>
                      {track.title?.split("|")[0].split("(")[0].trim()}
                    </h4>
                    <p>
                      {track.artist}
                      {track.collaborator && (
                        <span className={styles.addedBy}> • Added by {track.collaborator}</span>
                      )}
                    </p>
                  </div>
                  <div className={styles.trackControls}>
                    {activePlaylist.isSystem ? (
                      <button 
                        className={styles.removeTrackBtn}
                        onClick={() => toggleLikeTrack(track)}
                        title="Remove from Liked"
                      >
                        <Heart size={20} weight="fill" color="#ec4899" />
                      </button>
                    ) : (
                      <button 
                        className={styles.removeTrackBtn}
                        onClick={() => removeTrackFromPlaylist(activePlaylist.id, track.id)}
                        title="Remove from Playlist"
                      >
                        <Trash size={20} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Recommended tracks for custom playlists */}
        {!activePlaylist.isSystem && (
          <section className={styles.recommendationsSection}>
            <h3 className={styles.recTitle}>Recommended for You</h3>
            <p className={styles.recSub}>Based on the vibe of this playlist</p>
            <div className={styles.recList}>
              {RECOMMENDATIONS.filter(r => !activePlaylist.tracks.some(t => t.id === r.id)).map(track => (
                <div key={track.id} className={styles.recItem}>
                  <img src={track.cover} alt="" className={styles.recCover} />
                  <div className={styles.recInfo}>
                    <h4>{track.title}</h4>
                    <p>{track.artist}</p>
                  </div>
                  <button 
                    className={styles.addRecBtn}
                    onClick={() => {
                      addTrackToPlaylist(activePlaylist.id, track);
                      if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(10);
                    }}
                    title="Add to Playlist"
                  >
                    <PlusCircle size={24} weight="fill" />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Rename Playlist Modal */}
        {showRenameModal && (
          <div className={styles.modalOverlay} onClick={() => setShowRenameModal(false)}>
            <div className={`glass ${styles.modalContent}`} onClick={(e) => e.stopPropagation()}>
              <h3>Rename Playlist</h3>
              <form onSubmit={handleRenamePlaylist}>
                <input 
                  type="text" 
                  className={styles.modalInput}
                  value={renamePlaylistName}
                  onChange={(e) => setRenamePlaylistName(e.target.value)}
                  autoFocus
                />
                <div className={styles.modalActions}>
                  <button type="button" onClick={() => setShowRenameModal(false)} className={styles.modalCancel}>
                    Cancel
                  </button>
                  <button type="submit" className={styles.modalSubmit}>
                    Save
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── LIBRARY LIST VIEW ──────────────────────────────────
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.topRow}>
          <img src="https://i.pravatar.cc/150?u=aurasynq_avatar" alt="Profile" className={styles.thumb}/>
          <h1>Your Library</h1>
          <button className={styles.addBtn} onClick={() => setShowCreateModal(true)} title="Create Playlist">
            <Plus size={24}/>
          </button>
        </div>
        <div className={styles.filters}>
          <span 
            className={`${styles.filterChip} ${activeTab === "all" ? styles.filterActive : ""}`}
            onClick={() => setActiveTab("all")}
          >
            All
          </span>
          <span 
            className={`${styles.filterChip} ${activeTab === "playlists" ? styles.filterActive : ""}`}
            onClick={() => setActiveTab("playlists")}
          >
            Playlists
          </span>
          <span 
            className={`${styles.filterChip} ${activeTab === "liked" ? styles.filterActive : ""}`}
            onClick={() => setActiveTab("liked")}
          >
            Liked
          </span>
        </div>
      </header>

      <div className={styles.list}>
        {/* Liked Songs Entry */}
        {(activeTab === "all" || activeTab === "liked") && (
          <div className={styles.listItem} onClick={() => setSelectedPlaylistId("liked")}>
            <div className={styles.likedCover}>
              <Heart size={24} weight="fill" color="white"/>
            </div>
            <div className={styles.listText}>
              <h3>Liked Songs</h3>
              <p>{likedTracks.length} songs</p>
            </div>
          </div>
        )}

        {/* Custom Playlists */}
        {(activeTab === "all" || activeTab === "playlists") && (
          customPlaylists.map(playlist => (
            <div 
              key={playlist.id} 
              className={styles.listItem} 
              onClick={() => setSelectedPlaylistId(playlist.id)}
            >
              <div className={styles.playlistIconCover}>
                <MusicNote size={24} weight="fill" color="white" />
                {playlist.isCollaborative && (
                  <div className={styles.collabBadge} title="Collaborative Playlist">
                    <Users size={12} weight="fill" />
                  </div>
                )}
              </div>
              <div className={styles.listText}>
                <h3>{playlist.name}</h3>
                <p>
                  {playlist.isCollaborative ? "Collaborative Playlist" : "Playlist"} • {playlist.tracks?.length || 0} songs
                </p>
              </div>
            </div>
          ))
        )}

        {/* Empty state helper if no custom playlists */}
        {activeTab === "playlists" && customPlaylists.length === 0 && (
          <div className={styles.emptyState}>
            <p>No playlists created yet.</p>
            <button className={styles.createBtn} onClick={() => setShowCreateModal(true)}>
              Create Playlist
            </button>
          </div>
        )}
      </div>

      {/* Create Playlist Modal */}
      {showCreateModal && (
        <div className={styles.modalOverlay} onClick={() => setShowCreateModal(false)}>
          <div className={`glass ${styles.modalContent}`} onClick={(e) => e.stopPropagation()}>
            <h3>Create New Playlist</h3>
            <form onSubmit={handleCreatePlaylist}>
              <input 
                type="text" 
                placeholder="Give your playlist a name..."
                className={styles.modalInput}
                value={newPlaylistName}
                onChange={(e) => setNewPlaylistName(e.target.value)}
                autoFocus
              />
              <div className={styles.modalActions}>
                <button type="button" onClick={() => setShowCreateModal(false)} className={styles.modalCancel}>
                  Cancel
                </button>
                <button type="submit" className={styles.modalSubmit}>
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
