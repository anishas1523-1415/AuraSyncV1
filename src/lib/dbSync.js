import { db } from "./firebase";
import { doc, setDoc, getDoc } from "firebase/firestore";

// Firestore rejects `undefined` field values; a JSON round-trip drops them
const sanitize = (value) => JSON.parse(JSON.stringify(value ?? null));

// Synchronize play history to Cloud
export const syncHistoryToCloud = async (history, userId) => {
  if (!userId || !db) return;
  try {
    const userDocRef = doc(db, "users", userId);
    await setDoc(userDocRef, { playHistory: sanitize(history) }, { merge: true });
  } catch (err) {
    console.warn("AuraSynq Debug: Failed to sync history to cloud", err);
  }
};

// Synchronize liked tracks to Cloud. `updatedAt` lets other devices tell newer edits (incl. unlikes) apart.
export const syncLikedToCloud = async (likedTracks, userId, updatedAt = Date.now()) => {
  if (!userId || !db) return;
  try {
    const userDocRef = doc(db, "users", userId);
    await setDoc(userDocRef, { likedTracks: sanitize(likedTracks), likedUpdatedAt: updatedAt }, { merge: true });
  } catch (err) {
    console.warn("AuraSynq Debug: Failed to sync liked tracks to cloud", err);
  }
};

// Synchronize custom playlists to Cloud
export const syncPlaylistsToCloud = async (playlists, userId, updatedAt = Date.now()) => {
  if (!userId || !db) return;
  try {
    const userDocRef = doc(db, "users", userId);
    await setDoc(userDocRef, { customPlaylists: sanitize(playlists), playlistsUpdatedAt: updatedAt }, { merge: true });
  } catch (err) {
    console.warn("AuraSynq Debug: Failed to sync playlists to cloud", err);
  }
};

// Automatically sync user profile if missing
export const syncProfileToCloud = async (user) => {
  if (!user || !user.id || !db) return;
  try {
    const fullName = (user.firstName || '') + (user.lastName ? ` ${user.lastName}` : '');
    const userDocRef = doc(db, "users", user.id);
    await setDoc(userDocRef, {
      name: fullName.trim() || 'Aura User',
      avatarUrl: user.imageUrl || null
    }, { merge: true });
  } catch (err) {
    console.warn("AuraSynq Debug: Failed to sync profile to cloud", err);
  }
};

// Restore the library saved from other devices.
// Returns null when the cloud is unreachable, so callers never overwrite cloud data blindly.
export const loadLibraryFromCloud = async (userId) => {
  if (!userId || !db) return null;
  try {
    const snapshot = await getDoc(doc(db, "users", userId));
    const data = snapshot.exists() ? snapshot.data() : {};
    return {
      playHistory: Array.isArray(data.playHistory) ? data.playHistory : [],
      likedTracks: Array.isArray(data.likedTracks) ? data.likedTracks : [],
      customPlaylists: Array.isArray(data.customPlaylists) ? data.customPlaylists : [],
      likedUpdatedAt: Number(data.likedUpdatedAt) || 0,
      playlistsUpdatedAt: Number(data.playlistsUpdatedAt) || 0
    };
  } catch (err) {
    console.warn("AuraSynq Debug: Failed to load library from cloud", err);
    return null;
  }
};
