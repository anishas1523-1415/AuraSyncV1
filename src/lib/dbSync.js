import { db } from "./firebase";
import { doc, setDoc } from "firebase/firestore";

// Synchronize play history to Firestore
export const syncHistoryToCloud = async (history, userId) => {
  if (!db || !userId) return; // Silent fallback if Firebase is inactive or user is offline
  try {
    const userDocRef = doc(db, "users", userId);
    await setDoc(userDocRef, { playHistory: history }, { merge: true });
  } catch (err) {
    console.warn("AuraSynq Debug: Failed to sync history to cloud", err);
  }
};

// Synchronize liked tracks to Firestore
export const syncLikedToCloud = async (likedTracks, userId) => {
  if (!db || !userId) return;
  try {
    const userDocRef = doc(db, "users", userId);
    await setDoc(userDocRef, { likedTracks }, { merge: true });
  } catch (err) {
    console.warn("AuraSynq Debug: Failed to sync liked tracks to cloud", err);
  }
};

// Synchronize custom playlists to Firestore
export const syncPlaylistsToCloud = async (playlists, userId) => {
  if (!db || !userId) return;
  try {
    const userDocRef = doc(db, "users", userId);
    await setDoc(userDocRef, { customPlaylists: playlists }, { merge: true });
  } catch (err) {
    console.warn("AuraSynq Debug: Failed to sync playlists to cloud", err);
  }
};
