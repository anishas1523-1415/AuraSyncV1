"use client";
import { useState } from "react";
import { useAudio } from "@/contexts/AudioContext";
import { X, Plus, MusicNote } from "@phosphor-icons/react";
import styles from "./AddToPlaylistModal.module.css";

export default function AddToPlaylistModal({ track, onClose }) {
  const { customPlaylists, createPlaylist, addTrackToPlaylist } = useAudio();
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);

  if (!track) return null;

  const handleCreateAndAdd = (e) => {
    e.preventDefault();
    const name = newPlaylistName.trim();
    if (!name) return;
    const created = createPlaylist(name);
    addTrackToPlaylist(created.id, track);
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(15);
    }
    setNewPlaylistName("");
    setShowCreateForm(false);
    alert(`Created playlist "${name}" and added "${track.title}"!`);
    onClose();
  };

  const handleAddToPlaylist = (playlistId, playlistName) => {
    addTrackToPlaylist(playlistId, track);
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(15);
    }
    alert(`Added "${track.title}" to playlist "${playlistName}"!`);
    onClose();
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={`glass ${styles.content}`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h3>Add to Playlist</h3>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className={styles.trackSummary}>
          <img src={track.cover} alt="" className={styles.cover} />
          <div className={styles.trackInfo}>
            <h4>{track.title?.split("|")[0].split("(")[0].trim()}</h4>
            <p>{track.artist}</p>
          </div>
        </div>

        <div className={styles.body}>
          {customPlaylists.length === 0 ? (
            <div className={styles.empty}>
              <p>You haven't created any playlists yet.</p>
            </div>
          ) : (
            <div className={styles.playlistList}>
              {customPlaylists.map((playlist) => (
                <div 
                  key={playlist.id} 
                  className={styles.playlistItem}
                  onClick={() => handleAddToPlaylist(playlist.id, playlist.name)}
                >
                  <div className={styles.playlistIcon}>
                    <MusicNote size={20} weight="fill" />
                  </div>
                  <div className={styles.playlistDetails}>
                    <h4>{playlist.name}</h4>
                    <p>{playlist.tracks?.length || 0} songs</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!showCreateForm ? (
            <button 
              className={styles.newPlaylistBtn}
              onClick={() => setShowCreateForm(true)}
            >
              <Plus size={18} weight="bold" /> Create New Playlist
            </button>
          ) : (
            <form onSubmit={handleCreateAndAdd} className={styles.createForm}>
              <input 
                type="text"
                placeholder="Playlist name..."
                className={styles.input}
                value={newPlaylistName}
                onChange={(e) => setNewPlaylistName(e.target.value)}
                autoFocus
              />
              <div className={styles.formActions}>
                <button 
                  type="button" 
                  className={styles.cancelBtn}
                  onClick={() => setShowCreateForm(false)}
                >
                  Cancel
                </button>
                <button type="submit" className={styles.submitBtn}>
                  Create & Add
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
