import { db } from "./firebase";
import { doc, setDoc, getDoc, deleteDoc } from "firebase/firestore";

// Each listener's library is one Firestore document, users/{uid}; the security rules only let
// that signed-in person read or write it. Every call resolves to true when it reached the cloud.

// Firestore rejects `undefined` field values; a JSON round-trip drops them
const sanitize = (value) => JSON.parse(JSON.stringify(value ?? null));

const save = async (userId, fields, what) => {
  if (!userId || !db) return false;
  try {
    await setDoc(doc(db, "users", userId), fields, { merge: true });
    return true;
  } catch (err) {
    console.warn(`AuraSynq: couldn't sync ${what} to the cloud`, err);
    return false;
  }
};

export const syncHistoryToCloud = (history, userId) =>
  save(userId, { playHistory: sanitize(history) }, "history");

// `updatedAt` lets other devices tell newer edits (incl. unlikes) apart
export const syncLikedToCloud = (likedTracks, userId, updatedAt = Date.now()) =>
  save(userId, { likedTracks: sanitize(likedTracks), likedUpdatedAt: updatedAt }, "liked songs");

export const syncPlaylistsToCloud = (playlists, userId, updatedAt = Date.now()) =>
  save(userId, { customPlaylists: sanitize(playlists), playlistsUpdatedAt: updatedAt }, "playlists");

export const syncStatsToCloud = (stats, userId) =>
  save(userId, { listenStats: sanitize(stats) }, "listening stats");

export const syncProfileToCloud = (user) => {
  if (!user?.id) return Promise.resolve(false);
  return save(user.id, {
    name: user.fullName || "Aura User",
    avatarUrl: user.imageUrl || null,
    email: user.email || null,
  }, "profile");
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
      playlistsUpdatedAt: Number(data.playlistsUpdatedAt) || 0,
      listenStats: data.listenStats && typeof data.listenStats === "object" ? data.listenStats : null,
    };
  } catch (err) {
    console.warn("AuraSynq: couldn't load the library from the cloud", err);
    return null;
  }
};

// Account deletion: remove everything stored for this listener
export const deleteCloudLibrary = async (userId) => {
  if (!userId || !db) return false;
  try {
    await deleteDoc(doc(db, "users", userId));
    return true;
  } catch (err) {
    console.warn("AuraSynq: couldn't delete the cloud library", err);
    return false;
  }
};
