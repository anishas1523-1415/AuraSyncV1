import { db } from "./firebase";
import { doc, setDoc } from "firebase/firestore";
import { supabase, isSupabaseActive } from "./supabase";

// Synchronize play history to Cloud
export const syncHistoryToCloud = async (history, userId) => {
  if (!userId) return;
  try {
    if (isSupabaseActive) {
      await supabase.from('user_libraries').upsert({
        user_id: userId,
        play_history: JSON.stringify(history)
      }, { onConflict: 'user_id' });
    } else if (db) {
      const userDocRef = doc(db, "users", userId);
      await setDoc(userDocRef, { playHistory: history }, { merge: true });
    }
  } catch (err) {
    console.warn("AuraSynq Debug: Failed to sync history to cloud", err);
  }
};

// Synchronize liked tracks to Cloud
export const syncLikedToCloud = async (likedTracks, userId) => {
  if (!userId) return;
  try {
    if (isSupabaseActive) {
      await supabase.from('user_libraries').upsert({
        user_id: userId,
        liked_tracks: JSON.stringify(likedTracks)
      }, { onConflict: 'user_id' });
    } else if (db) {
      const userDocRef = doc(db, "users", userId);
      await setDoc(userDocRef, { likedTracks }, { merge: true });
    }
  } catch (err) {
    console.warn("AuraSynq Debug: Failed to sync liked tracks to cloud", err);
  }
};

// Synchronize custom playlists to Cloud
export const syncPlaylistsToCloud = async (playlists, userId) => {
  if (!userId) return;
  try {
    if (isSupabaseActive) {
      await supabase.from('user_libraries').upsert({
        user_id: userId,
        custom_playlists: JSON.stringify(playlists)
      }, { onConflict: 'user_id' });
    } else if (db) {
      const userDocRef = doc(db, "users", userId);
      await setDoc(userDocRef, { customPlaylists: playlists }, { merge: true });
    }
  } catch (err) {
    console.warn("AuraSynq Debug: Failed to sync playlists to cloud", err);
  }
};

// Automatically sync user profile if missing
export const syncProfileToCloud = async (user) => {
  if (!user || !user.id || !isSupabaseActive) return;
  try {
    const fullName = user.firstName + (user.lastName ? ` ${user.lastName}` : '');
    await supabase.from('profiles').upsert({
      id: user.id,
      name: fullName || 'Aura User',
      avatar_url: user.imageUrl || null
    }, { onConflict: 'id' });
  } catch (err) {
    console.warn("AuraSynq Debug: Failed to sync profile to cloud", err);
  }
};
