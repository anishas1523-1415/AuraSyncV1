import { supabase, isSupabaseActive } from "./supabase";
import { rtdb, isFirebaseActive } from "./firebase";
import { ref, onValue, set, serverTimestamp } from "firebase/database";
import { audioProgressEmitter } from "@/contexts/AudioContext";

class SyncEngine {
  constructor() {
    this.roomId = null;
    this.isHost = false;
    this.userId = null;
    this.listeners = [];
    this.unsubscribeFirebase = null;
    this.supabaseChannel = null;
    
    // Throttle broadcast
    this.lastBroadcastTime = 0;
  }

  joinRoom(roomId, userId, isHost = false) {
    this.roomId = roomId;
    this.userId = userId;
    this.isHost = isHost;
    
    if (this.isHost) {
      this.hostProgressHandler = (e) => this.broadcastState(e.detail);
      if (audioProgressEmitter) {
        audioProgressEmitter.addEventListener("progress", this.hostProgressHandler);
      }
    }

    if (isSupabaseActive) {
      this.supabaseChannel = supabase
        .channel(`room:${roomId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'societies_rooms', filter: `id=eq.${roomId}` },
          (payload) => {
            const data = payload.new;
            if (data && data.host_id !== this.userId && !this.isHost) {
              this.triggerListeners({
                hostId: data.host_id,
                progress: data.progress_seconds,
                isPlaying: data.is_playing,
                currentTrackId: data.current_track_id
              });
            }
          }
        )
        .subscribe();
    } else if (isFirebaseActive) {
      const roomRef = ref(rtdb, `society_rooms/${roomId}`);
      if (!this.isHost) {
        this.unsubscribeFirebase = onValue(roomRef, (snapshot) => {
          const data = snapshot.val();
          if (data && data.hostId !== this.userId) {
            this.triggerListeners(data);
          }
        });
      }
    } else {
      console.warn("AuraSynq Sync: No active DB (Supabase or Firebase). Sync disabled.");
    }
  }

  broadcastState(progress, isPlaying = true, currentTrackId = null) {
    if (!this.isHost || !this.roomId) return;
    
    const now = Date.now();
    // Throttle to 1 broadcast per second to save bandwidth
    if (now - this.lastBroadcastTime < 1000) return;
    this.lastBroadcastTime = now;

    if (isSupabaseActive) {
      supabase.from('societies_rooms').upsert({
        id: this.roomId,
        name: this.roomId,
        host_id: this.userId,
        current_track_id: currentTrackId,
        progress_seconds: progress,
        is_playing: isPlaying
      }).catch(console.error);
    } else if (isFirebaseActive) {
      const roomRef = ref(rtdb, `society_rooms/${this.roomId}`);
      set(roomRef, {
        hostId: this.userId,
        progress,
        isPlaying,
        currentTrackId,
        timestamp: serverTimestamp()
      }).catch(console.error);
    }
  }

  onSync(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  triggerListeners(data) {
    this.listeners.forEach(cb => cb(data));
  }

  leaveRoom() {
    if (this.isHost && this.hostProgressHandler && audioProgressEmitter) {
      audioProgressEmitter.removeEventListener("progress", this.hostProgressHandler);
    }
    if (this.supabaseChannel) {
      this.supabaseChannel.unsubscribe();
      this.supabaseChannel = null;
    }
    if (this.unsubscribeFirebase) {
      this.unsubscribeFirebase();
      this.unsubscribeFirebase = null;
    }
    this.roomId = null;
  }
}

export const syncEngine = new SyncEngine();
