import { rtdb, isFirebaseActive } from "./firebase";
import { ref, onValue, set, serverTimestamp } from "firebase/database";
import { audioProgressEmitter } from "@/contexts/AudioContext";

class SyncEngine {
  constructor() {
    this.roomId = null;
    this.isHost = false;
    this.userId = null;
    this.listeners = [];
    this.unsubscribe = null;
    
    // Throttle broadcast
    this.lastBroadcastTime = 0;
  }

  joinRoom(roomId, userId, isHost = false) {
    if (!isFirebaseActive) {
      console.warn("AuraSynq Sync: Firebase is not active. SyncEngine disabled.");
      return;
    }
    
    this.roomId = roomId;
    this.userId = userId;
    this.isHost = isHost;
    
    const roomRef = ref(rtdb, `society_rooms/${roomId}`);
    
    // If host, bind to progress emitter
    if (this.isHost) {
      this.hostProgressHandler = (e) => this.broadcastState(e.detail);
      if (audioProgressEmitter) {
        audioProgressEmitter.addEventListener("progress", this.hostProgressHandler);
      }
    } else {
      // If listener, subscribe to Firebase node
      this.unsubscribe = onValue(roomRef, (snapshot) => {
        const data = snapshot.val();
        if (data && data.hostId !== this.userId) {
          this.triggerListeners(data);
        }
      });
    }
  }

  broadcastState(progress, isPlaying = true, currentTrackId = null) {
    if (!this.isHost || !isFirebaseActive || !this.roomId) return;
    
    const now = Date.now();
    // Throttle to 1 broadcast per second to save bandwidth
    if (now - this.lastBroadcastTime < 1000) return;
    this.lastBroadcastTime = now;

    const roomRef = ref(rtdb, `society_rooms/${this.roomId}`);
    set(roomRef, {
      hostId: this.userId,
      progress,
      isPlaying,
      currentTrackId,
      timestamp: serverTimestamp()
    }).catch(console.error);
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
    if (this.unsubscribe) {
      this.unsubscribe();
    }
    this.roomId = null;
  }
}

export const syncEngine = new SyncEngine();
