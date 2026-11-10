import { db } from "./firebase";
import { doc, getDoc, getDocs, collection, runTransaction, setDoc, writeBatch } from "firebase/firestore";
import { syncBlob as syncBlobWith, readCloud as readCloudWith, deleteCloudLibrary as deleteCloudWith, libPath } from "./cloudBlob";

// A listener's library lives under users/{uid}/lib/{name}: one document per kind of data (liked,
// playlists, history, activity, taste, settings). The security rules let only that signed-in
// person read or write it.
//
// Saving is an atomic READ-MERGE-WRITE inside a Firestore transaction: the cloud copy is read, merged
// with this device's copy using the rules in library.js, and written back in one step. Two devices
// saving at the same moment cannot overwrite each other (the transaction retries), and a save that
// cannot reach the server fails cleanly (the caller keeps the data and retries) instead of hanging.
//
// A kind of data is stored as a JSON string; strings over ~240k characters are split across several
// documents (name, name~1, name~2...) so Firestore's 1 MB document limit can never stop a save.

// The thin interface the logic needs from Firestore (a fake one is used in tests)
export function firestoreStore() {
  const ref = (path) => doc(db, ...path);
  return {
    available: () => !!db,
    runTransaction: (fn) => runTransaction(db, (tx) => fn({
      get: async (path) => { const s = await tx.get(ref(path)); return s.exists() ? s.data() : null; },
      set: (path, data) => tx.set(ref(path), data),
      delete: (path) => tx.delete(ref(path)),
    })),
    get: async (path) => { const s = await getDoc(ref(path)); return s.exists() ? s.data() : null; },
    list: async (path) => (await getDocs(collection(db, ...path))).docs.map((d) => d.id),
    deleteMany: async (paths) => {
      for (let i = 0; i < paths.length; i += 400) {
        const batch = writeBatch(db);
        paths.slice(i, i + 400).forEach((p) => batch.delete(ref(p)));
        await batch.commit();
      }
    },
  };
}

const withTimeout = (promise, ms = 20000) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
]);

const store = firestoreStore();

export const syncBlob = (userId, name, local, merge) => syncBlobWith(store, userId, name, local, merge);
export const readCloud = (userId, name) => readCloudWith(store, userId, name);
export const deleteCloudLibrary = (userId) => deleteCloudWith(store, userId);

export async function writeMarker(userId, name, data) {
  if (!userId || !db) return false;
  try {
    await withTimeout(setDoc(doc(db, ...libPath(userId, name)), { ...data, at: Date.now() }));
    return true;
  } catch (err) {
    return false;
  }
}

// The single-document library (before per-kind documents), read once to migrate it
export async function loadLegacyLibrary(userId) {
  if (!userId || !store.available()) return null;
  try {
    const data = await withTimeout(store.get(["users", userId]));
    if (!data) return {};
    return {
      likedTracks: Array.isArray(data.likedTracks) ? data.likedTracks : [],
      customPlaylists: Array.isArray(data.customPlaylists) ? data.customPlaylists : [],
      playHistory: Array.isArray(data.playHistory) ? data.playHistory : [],
      listenStats: data.listenStats && typeof data.listenStats === "object" ? data.listenStats : null,
    };
  } catch (err) {
    return null;
  }
}

// The profile summary (name, photo, email) kept on the user document
export async function syncProfileToCloud(user) {
  if (!user?.id || !db) return false;
  try {
    await withTimeout(setDoc(doc(db, "users", user.id), {
      name: user.fullName || "Aura User",
      avatarUrl: user.imageUrl || null,
      email: user.email || null,
    }, { merge: true }));
    return true;
  } catch (err) {
    return false;
  }
}
