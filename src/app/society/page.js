"use client";
import styles from "./page.module.css";
import { useState, useEffect, useRef } from "react";
import { useAudio } from "@/contexts/AudioContext";
import { useUser } from "@/lib/clerk";
import { Users, Microphone, MusicNote, Heartbeat, Chat, ArrowLeft } from "@phosphor-icons/react";
import Link from "next/link";
import { syncEngine } from "@/lib/syncEngine";

const MOCK_FRIENDS = [
  { id: 1, name: "Arun", avatar: "https://i.pravatar.cc/150?u=arun1", online: true },
  { id: 2, name: "Meera", avatar: "https://i.pravatar.cc/150?u=meera2", online: true },
  { id: 3, name: "Karan", avatar: "https://i.pravatar.cc/150?u=karan3", online: false },
  { id: 4, name: "Priya", avatar: "https://i.pravatar.cc/150?u=priya4", online: true },
];

const REACTIONS = [
  { emoji: "🔥", label: "Fire" },
  { emoji: "❤️", label: "Love" },
  { emoji: "🎵", label: "Vibe" },
  { emoji: "😮", label: "Wow" },
  { emoji: "💃", label: "Dance" },
];

export default function Society() {
  const { currentTrack, isPlaying } = useAudio();
  const { user } = useUser();
  const [particles, setParticles] = useState([]);
  const [messages, setMessages] = useState([
    { id: 1, user: "Meera", text: "this song is 🔥🔥", time: "2m ago" },
    { id: 2, user: "Arun", text: "absolutely vibing rn", time: "1m ago" },
    { id: 3, user: "Priya", text: "❤️❤️❤️", time: "just now" },
  ]);
  const [reactionBurst, setReactionBurst] = useState([]);
  const chatRef = useRef(null);
  const currentTrackRef = useRef(currentTrack);

  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack]);

  // Join Room
  useEffect(() => {
    const userId = user?.id || `anon_${Math.floor(Math.random()*1000)}`;
    const isHost = userId.includes("host"); // Arbitrary for demo, or set by UI
    syncEngine.joinRoom("cyberpunk_room_1", userId, isHost);

    const unsubscribe = syncEngine.onSync((data) => {
      // Receive host's progress/playing state
      if (!isHost && data.isPlaying !== isPlaying) {
        // sync play state (this is simplified, would need direct AudioContext methods)
        console.log("AuraSynq Sync: Host play state changed to", data.isPlaying);
      }
    });

    return () => {
      unsubscribe();
      syncEngine.leaveRoom();
    };
  }, [user]);

  const handleCanvasTap = (e) => {
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(10);
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const newParticle = { id: Date.now(), x, y };
    setParticles(prev => [...prev, newParticle]);
    setTimeout(() => {
      setParticles(prev => prev.filter(p => p.id !== newParticle.id));
    }, 800);
  };

  const sendReaction = (reaction) => {
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(15);
    }
    const burst = { id: Date.now(), emoji: reaction.emoji };
    setReactionBurst(prev => [...prev, burst]);
    setTimeout(() => {
      setReactionBurst(prev => prev.filter(b => b.id !== burst.id));
    }, 1500);

    // Add to chat feed
    const userName = user?.firstName || "You";
    setMessages(prev => [
      ...prev,
      { id: Date.now(), user: userName, text: reaction.emoji + " reacted", time: "just now" }
    ].slice(-10));
  };

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages]);

  // Request notifications permission on mount and setup mock friends activity
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "default") {
        Notification.requestPermission();
      }
    }

    const interval = setInterval(() => {
      const isReaction = Math.random() > 0.4;
      const onlineFriends = MOCK_FRIENDS.filter(f => f.online);
      if (onlineFriends.length === 0) return;
      const randomFriend = onlineFriends[Math.floor(Math.random() * onlineFriends.length)];

      if (isReaction) {
        const randomReaction = REACTIONS[Math.floor(Math.random() * REACTIONS.length)];
        const burst = { id: Date.now(), emoji: randomReaction.emoji };
        setReactionBurst(prev => [...prev, burst]);
        setTimeout(() => {
          setReactionBurst(prev => prev.filter(b => b.id !== burst.id));
        }, 1500);

        setMessages(prev => [
          ...prev,
          { id: Date.now(), user: randomFriend.name, text: `${randomReaction.emoji} reacted`, time: "just now" }
        ].slice(-10));

        if (typeof navigator !== "undefined" && navigator.vibrate) {
          navigator.vibrate(8);
        }

        if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
          new Notification("AuraSynq Live", {
            body: `${randomFriend.name} reacted with ${randomReaction.emoji}`,
            icon: "/icon-192x192.png",
            silent: true
          });
        }
      } else {
        const activeTrack = currentTrackRef.current;
        const cleanTitle = activeTrack ? activeTrack.title.split("|")[0].split("(")[0].trim().slice(0, 24) : "";
        const cleanArtist = activeTrack ? activeTrack.artist : "";

        const dynamicComments = activeTrack ? [
          `listening to "${cleanTitle}" too! 🔥`,
          `"${cleanTitle}" is an absolute masterpiece! 🚀`,
          `that beat transition in "${cleanTitle}" was insane`,
          `${cleanArtist} is literally a legend`,
          "anyone wants to sync a blend for this track?",
          "AuraSynq UI is so clean, love this player vibe"
        ] : [
          "this song is a masterpiece! 🔥",
          "vibing hard right now 🚀",
          "that last beat transition was insane",
          "cyberpunk UI is so clean",
          "anyone wants to share a blend?",
          "AuraSynq is amazing"
        ];
        
        const comment = dynamicComments[Math.floor(Math.random() * dynamicComments.length)];
        setMessages(prev => [
          ...prev,
          { id: Date.now(), user: randomFriend.name, text: comment, time: "just now" }
        ].slice(-10));

        if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
          new Notification("AuraSynq Chat", {
            body: `${randomFriend.name}: ${comment}`,
            icon: "/icon-192x192.png"
          });
        }
      }
    }, 15000); // Simulates friend activity every 15 seconds

    return () => clearInterval(interval);
  }, []);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <Link href="/" className={styles.backBtn}><ArrowLeft size={22} /></Link>
        <div>
          <h1>Live Society</h1>
          <p className={styles.roomName}>🎧 Cyberpunk Room</p>
        </div>
        <div className={styles.liveChip}>
          <span className={styles.liveDot} />
          LIVE
        </div>
      </header>

      {/* Now Playing Card */}
      <div className={styles.nowPlayingCard}>
        <div className={styles.cardLeft}>
          <MusicNote size={18} weight="fill" color="#a855f7" />
          <span className={styles.npLabel}>Now Playing</span>
        </div>
        {currentTrack ? (
          <div className={styles.trackInfo}>
            <img src={currentTrack.cover} alt="" className={styles.trackThumb} />
            <div>
              <p className={styles.trackTitle}>
                {currentTrack.title?.split("|")[0].split("(")[0].trim().slice(0, 28)}
              </p>
              <p className={styles.trackArtist}>{currentTrack.artist}</p>
            </div>
            {isPlaying && <div className={styles.bars}>
              {[1,2,3].map(i => <div key={i} className={styles.bar} style={{ animationDelay: `${i * 0.15}s` }} />)}
            </div>}
          </div>
        ) : (
          <p className={styles.noTrack}>No song playing yet — press play!</p>
        )}
      </div>

      {/* Friends Row */}
      <div className={styles.friendsSection}>
        <p className={styles.friendsLabel}>
          <Users size={16} /> {MOCK_FRIENDS.filter(f => f.online).length + 1} listening
        </p>
        <div className={styles.friendsRow}>
          {/* User's own avatar */}
          <div className={styles.friendAvatar}>
            {user?.imageUrl
              ? <img src={user.imageUrl} alt="You" className={styles.avatarImg} />
              : <div className={styles.avatarFallback}>{user?.firstName?.charAt(0) || "Y"}</div>
            }
            <span className={styles.onlineDot} />
            <p className={styles.friendName}>You</p>
          </div>
          {MOCK_FRIENDS.map(f => (
            <div key={f.id} className={styles.friendAvatar}>
              <img src={f.avatar} alt={f.name} className={styles.avatarImg} />
              {f.online && <span className={styles.onlineDot} />}
              <p className={styles.friendName}>{f.name}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Beat Canvas */}
      <div className={styles.canvasContainer} onClick={handleCanvasTap}>
        <div className={styles.canvasHint}>
          <Heartbeat size={28} weight="fill" color="#a855f7" />
          <p>Tap to the beat! Send vibes to friends</p>
        </div>
        {particles.map(p => (
          <div key={p.id} className={styles.particle} style={{ left: p.x, top: p.y }} />
        ))}
        {reactionBurst.map(b => (
          <div key={b.id} className={styles.reactionBurst}>{b.emoji}</div>
        ))}
      </div>

      {/* Reaction Row */}
      <div className={styles.reactions}>
        {REACTIONS.map(r => (
          <button key={r.label} className={styles.reactionBtn} onClick={() => sendReaction(r)}>
            <span>{r.emoji}</span>
          </button>
        ))}
      </div>

      {/* Live Chat */}
      <div className={styles.chatSection}>
        <div className={styles.chatHeader}>
          <Chat size={16} />
          <span>Live Chat</span>
        </div>
        <div className={styles.chatFeed} ref={chatRef}>
          {messages.map(msg => (
            <div key={msg.id} className={styles.chatMsg}>
              <span className={styles.chatUser}>{msg.user}</span>
              <span className={styles.chatText}>{msg.text}</span>
              <span className={styles.chatTime}>{msg.time}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
