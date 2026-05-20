"use client";
import { createContext, useContext, useState, useRef, useEffect } from "react";

const AudioContext = createContext();

const generateMockLyrics = (title, artist) => {
  const cleanTitle = title.split('|')[0].split('(')[0].split('-')[0].trim();
  
  // Custom themed lyrics depending on keywords in title
  const isSad = title.toLowerCase().includes('sad') || title.toLowerCase().includes('love failure') || title.toLowerCase().includes('breakup') || title.toLowerCase().includes('valigal') || title.toLowerCase().includes('vazhi');
  const isHappy = title.toLowerCase().includes('happy') || title.toLowerCase().includes('kuthu') || title.toLowerCase().includes('dance') || title.toLowerCase().includes('mass') || title.toLowerCase().includes('danga');
  const isRomantic = !isSad && !isHappy; // Default to romantic/melodic
  
  let lyricTemplate = [];
  
  if (isSad) {
    lyricTemplate = [
      "வலிகள் நிறைந்த என் நெஞ்சமே...",
      "Why did you leave me in the dark?",
      "கண்ணீர் துளிகள் வழியுதே அன்பே...",
      "Holding onto memories of us...",
      "நீ இல்லாமல் வாழ வழியுமில்லை...",
      "Every shadow looks like your face...",
      "நெஞ்சில் ஓடும் காயங்கள் ஆறவில்லை...",
      "Lost in the silence of your goodbye...",
      "மறக்க நினைக்கிறேன் மறக்க முடியாமல்...",
      "Will the sun ever rise again?"
    ];
  } else if (isHappy) {
    lyricTemplate = [
      "ஆட்டத்த போடு தம்பி இன்னைக்கு...",
      "Feel the rhythm, let your body move!",
      "மகிழ்ச்சி பொங்குது நெஞ்சுக்குள்ள...",
      "Turn up the music, enjoy the vibe!",
      "வாழ்க்கை ஒரு முறை கொண்டாடுவோம்...",
      "Sing out loud, let the worries fade!",
      "புதுப்பாதை தேடி ஓடுவோம்...",
      "Dance with the stars, touch the sky!",
      "நெஞ்சில் உற்சாகம் குறையாமலே...",
      "This is our time, make it count!"
    ];
  } else {
    // Romantic/Melodic
    lyricTemplate = [
      "உன் விழி பார்த்த நொடி முதல்...",
      "Every beat of my heart speaks your name...",
      "என் மூச்சில் கலந்தாயே அன்பே...",
      "Dancing in the shadows of the starlight...",
      "விண்மீன்கள் போல் நாம் இணைந்திருப்போம்...",
      "Through the highs and lows, we shine...",
      "ஆசைகள் நெஞ்சில் அலைபாயும் நேரம்...",
      "Let the rhythm guide us home tonight...",
      "உயிரே உன் வாசம் என்னை ஈர்க்குதே...",
      "Under the moon, our souls unite...",
      "கனவுகள் யாவும் நிஜமாகும் காலம்...",
      "Every moment with you is a dream..."
    ];
  }

  const lyrics = [
    { time: 0, text: `🎵 Playing: ${cleanTitle} 🎵` },
    { time: 5, text: `👤 Artist: ${artist}` },
    { time: 8, text: "🌸 (Instrumental Intro) 🌸" }
  ];

  // Loop and generate lyrics up to 500 seconds dynamically
  let currentTime = 15;
  let lineIndex = 0;
  
  const chorus = isSad 
    ? ["துரோகம் தாங்காமல் துடிக்குதே நெஞ்சம்...", "ஏன் என்னை பிரிந்தாய் என் உயிரே..."]
    : isHappy 
      ? ["கொண்டாட்டம் போடுவோம் குதுகலமாய்...", "வாழ்கை கொண்டாடும் தருணமே இது..."]
      : ["என் அன்பே என் உயிரே நீதானே...", "உன்னோடு வாழும் நொடியே போதுமே..."];

  while (currentTime < 500) {
    // Add a Verse line
    lyrics.push({
      time: currentTime,
      text: lyricTemplate[lineIndex % lyricTemplate.length]
    });
    currentTime += 8;
    
    // Add second Verse line
    lyrics.push({
      time: currentTime,
      text: lyricTemplate[(lineIndex + 1) % lyricTemplate.length]
    });
    currentTime += 8;

    // Add Chorus
    lyrics.push({
      time: currentTime,
      text: `✨ ${chorus[0]} ✨`
    });
    currentTime += 8;
    lyrics.push({
      time: currentTime,
      text: `✨ ${chorus[1]} ✨`
    });
    currentTime += 8;

    // Add brief Instrumental break every now and then
    if (currentTime % 3 === 0) {
      lyrics.push({
        time: currentTime,
        text: "🎶 (Instrumental Bridge) 🎶"
      });
      currentTime += 12;
    }
    
    lineIndex += 2;
  }
  
  lyrics.push({
    time: currentTime,
    text: "💖 (Outro) 💖"
  });

  return lyrics;
};

const parseLRC = (lrcText) => {
  if (!lrcText) return null;
  const lines = lrcText.split("\n");
  const lyrics = [];
  const timeRegex = /\[(\d+):(\d+)(?:\.(\d+))?\]/;

  for (const line of lines) {
    const match = timeRegex.exec(line);
    if (match) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const milliseconds = match[3] ? parseInt(match[3].padEnd(3, "0").substring(0, 3), 10) : 0;
      
      const timeInSeconds = minutes * 60 + seconds + milliseconds / 1000;
      const text = line.replace(timeRegex, "").trim();
      
      if (text) {
        lyrics.push({ time: timeInSeconds, text });
      }
    }
  }
  return lyrics.length > 0 ? lyrics : null;
};

const parsePlainLyrics = (plainText, songDuration) => {
  if (!plainText) return null;
  const lines = plainText.split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  
  const duration = songDuration || 240;
  const interval = duration / (lines.length + 2);
  
  return lines.map((text, index) => ({
    time: Math.floor((index + 1) * interval),
    text
  }));
};

const createSilenceDataURL = (duration = 600) => {
  const sampleRate = 8000;
  const numSamples = sampleRate * duration;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  
  const writeString = (v, offset, str) => {
    for (let i = 0; i < str.length; i++) {
      v.setUint8(offset + i, str.charCodeAt(i));
    }
  };
  
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, numSamples * 2, true);
  
  const blob = new Blob([buffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
};

export function AudioProvider({ children }) {
  const [currentTrack, setCurrentTrack] = useState(null);
  const [queue, setQueue] = useState([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [silenceSrc, setSilenceSrc] = useState("");
  const [mounted, setMounted] = useState(false);
  const [isYtReady, setIsYtReady] = useState(false);

  const audioRef = useRef(null);
  const ytPlayerRef = useRef(null);
  const pollIntervalRef = useRef(null);

  // Maintain refs to avoid stale closure scopes in YT player callbacks
  const currentTrackRef = useRef(null);
  const queueRef = useRef([]);
  const isPlayingRef = useRef(false);

  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack]);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // Initialize dynamic script and silence generator
  useEffect(() => {
    setMounted(true);
    const silenceUrl = createSilenceDataURL(600);
    setSilenceSrc(silenceUrl);

    if (typeof window !== "undefined") {
      if (!window.YT) {
        const tag = document.createElement("script");
        tag.src = "https://www.youtube.com/iframe_api";
        const firstScriptTag = document.getElementsByTagName("script")[0];
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
      }

      window.onYouTubeIframeAPIReady = () => {
        console.log("AuraSynq Debug: YouTube Iframe API Loaded");
        setIsYtReady(true);

        const activeTrack = currentTrackRef.current;
        if (activeTrack && ytPlayerRef.current && typeof ytPlayerRef.current.loadVideoById === "function") {
          try {
            ytPlayerRef.current.loadVideoById({ videoId: activeTrack.id });
            if (isPlayingRef.current && typeof ytPlayerRef.current.playVideo === "function") {
              setTimeout(() => {
                try {
                  ytPlayerRef.current?.playVideo();
                } catch (err) {
                  console.warn("YT autoplay after ready failed:", err);
                }
              }, 100);
            }
          } catch (err) {
            console.warn("YT sync on ready failed:", err);
          }
        }
      };

      if (window.YT && window.YT.Player) {
        setIsYtReady(true);
      }
    }

    return () => {
      if (silenceUrl) URL.revokeObjectURL(silenceUrl);
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  const playNext = () => {
    const currentQ = queueRef.current;
    const currentT = currentTrackRef.current;
    if (currentQ.length <= 1 || !currentT) return;
    const currentIndex = currentQ.findIndex(t => t.id === currentT.id);
    if (currentIndex !== -1) {
      const nextIndex = (currentIndex + 1) % currentQ.length;
      playTrack(currentQ[nextIndex], currentQ, isPlayingRef.current);
    }
  };

  const playPrevious = () => {
    const currentQ = queueRef.current;
    const currentT = currentTrackRef.current;
    if (currentQ.length <= 1 || !currentT) return;
    const currentIndex = currentQ.findIndex(t => t.id === currentT.id);
    if (currentIndex !== -1) {
      const prevIndex = (currentIndex - 1 + currentQ.length) % currentQ.length;
      playTrack(currentQ[prevIndex], currentQ, isPlayingRef.current);
    }
  };

  // Initialize YT Player when API script is ready
  useEffect(() => {
    if (isYtReady && !ytPlayerRef.current) {
      console.log("AuraSynq Debug: Instantiating YT Player...");
      ytPlayerRef.current = new window.YT.Player("yt-player-placeholder", {
        height: "1",
        width: "1",
        videoId: "",
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          origin: typeof window !== "undefined" ? window.location.origin : ""
        },
        events: {
          onReady: () => {
            console.log("AuraSynq Debug: YT Player ready for loading.");
          },
          onStateChange: (event) => {
            const state = event.data;
            if (state === window.YT.PlayerState.PLAYING) {
              setIsPlaying(true);
              setIsBuffering(false);
            } else if (state === window.YT.PlayerState.PAUSED) {
              setIsPlaying(false);
              setIsBuffering(false);
            } else if (state === window.YT.PlayerState.BUFFERING) {
              setIsBuffering(true);
            } else if (state === window.YT.PlayerState.ENDED) {
              setIsPlaying(false);
              setIsBuffering(false);
              setProgress(0);
              // Auto-advance to next song
              playNext();
            }
          }
        }
      });
    }
  }, [isYtReady]);

  const fetchLyricsFromApi = async (title, artist, trackId) => {
    try {
      const cleanTitle = title
        .split('|')[0]
        .split('(')[0]
        .split('-')[0]
        .replace(/official/i, '')
        .replace(/video/i, '')
        .replace(/song/i, '')
        .replace(/lyric/i, '')
        .replace(/audio/i, '')
        .trim();
        
      const cleanArtist = artist
        .split('-')[0]
        .replace(/vevo/i, '')
        .replace(/music/i, '')
        .trim();

      console.log(`AuraSynq Debug: Querying real lyrics for "${cleanTitle}" by "${cleanArtist}"`);
      
      const url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(cleanArtist)}`;
      const res = await fetch(url);
      
      if (!res.ok) {
        const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(cleanTitle + ' ' + cleanArtist)}`;
        const searchRes = await fetch(searchUrl);
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          if (searchData && searchData.length > 0) {
            const bestMatch = searchData[0];
            const parsed = bestMatch.syncedLyrics 
              ? parseLRC(bestMatch.syncedLyrics) 
              : parsePlainLyrics(bestMatch.plainLyrics, bestMatch.duration);
            
            if (parsed) {
              console.log("AuraSynq Debug: Found and synced search-query lyrics successfully!");
              setCurrentTrack(prev => {
                if (prev && prev.id === trackId) {
                  return { ...prev, lyrics: parsed };
                }
                return prev;
              });
              return;
            }
          }
        }
        throw new Error("LrcLib search failed to return match");
      }
      
      const data = await res.json();
      const parsed = data.syncedLyrics 
        ? parseLRC(data.syncedLyrics) 
        : parsePlainLyrics(data.plainLyrics, data.duration);
        
      if (parsed) {
        console.log("AuraSynq Debug: Found and synced direct lyrics successfully!");
        setCurrentTrack(prev => {
          if (prev && prev.id === trackId) {
            return { ...prev, lyrics: parsed };
          }
          return prev;
        });
      }
    } catch (err) {
      console.warn("AuraSynq Debug: Failed to fetch real lyrics from database:", err);
    }
  };

  const playTrack = (track, newQueue = null, shouldAutoPlay = true) => {
    // Set queue if provided, or build one
    if (newQueue) {
      setQueue(newQueue);
    } else {
      setQueue(prev => {
        const exists = prev.some(t => t.id === track.id);
        if (!exists) return [...prev, track];
        return prev;
      });
    }

    if (currentTrackRef.current?.id !== track.id) {
      const trackWithLyrics = {
        ...track,
        lyrics: track.lyrics || generateMockLyrics(track.title, track.artist)
      };
      setCurrentTrack(trackWithLyrics);
      setIsPlaying(shouldAutoPlay);
      setIsBuffering(shouldAutoPlay);
      setProgress(0);
      setDuration(0);
      
      fetchLyricsFromApi(track.title, track.artist, track.id);

      const loadVideo = () => {
        if (ytPlayerRef.current && typeof ytPlayerRef.current.loadVideoById === "function") {
          try {
            ytPlayerRef.current.loadVideoById({ videoId: track.id });
            if (shouldAutoPlay && typeof ytPlayerRef.current.playVideo === "function") {
              setTimeout(() => {
                try {
                  ytPlayerRef.current?.playVideo();
                } catch (err) {
                  console.warn("YT play after load failed:", err);
                }
              }, 100);
            }
          } catch (err) {
            console.error("YT Player load error:", err);
          }
        } else {
          setTimeout(loadVideo, 250);
        }
      };
      loadVideo();
    } else {
      setIsPlaying(shouldAutoPlay);
    }
  };

  const togglePlay = () => {
    if (currentTrack) {
      setIsPlaying(!isPlaying);
    }
  };

  const seekTo = (seconds) => {
    if (!currentTrack) return;
    if (ytPlayerRef.current && typeof ytPlayerRef.current.seekTo === "function") {
      try {
        ytPlayerRef.current.seekTo(seconds, true);
        setProgress(seconds);
        if (audioRef.current) {
          audioRef.current.currentTime = seconds % 600;
        }
      } catch (err) {
        console.warn("YT seek failed:", err);
      }
    }
  };

  // Sync state changes with native audio player and YT player
  useEffect(() => {
    if (ytPlayerRef.current && typeof ytPlayerRef.current.playVideo === "function") {
      try {
        if (isPlaying) {
          ytPlayerRef.current.playVideo();
          if (audioRef.current) {
            audioRef.current.play().catch(err => console.warn("Silent audio play failed:", err));
          }
        } else {
          ytPlayerRef.current.pauseVideo();
          if (audioRef.current) {
            audioRef.current.pause();
          }
        }
      } catch (err) {
        console.warn("Playstate sync error:", err);
      }
    }
  }, [isPlaying, currentTrack?.id]);

  // Poll progress state
  useEffect(() => {
    if (isPlaying) {
      pollIntervalRef.current = setInterval(() => {
        if (ytPlayerRef.current && typeof ytPlayerRef.current.getCurrentTime === "function") {
          try {
            const curTime = ytPlayerRef.current.getCurrentTime();
            const dur = ytPlayerRef.current.getDuration();
            if (curTime !== undefined) setProgress(curTime);
            if (dur !== undefined && dur > 0) setDuration(dur);
          } catch (err) {
            // ignore
          }
        }
      }, 250);
    } else {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [isPlaying, currentTrack?.id]);

  // Register HTML5 Media Session API metadata for lock screen integration
  useEffect(() => {
    if (typeof window !== "undefined" && "mediaSession" in navigator && currentTrack) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.artist,
        album: "AuraSynq Aura",
        artwork: [
          { src: currentTrack.cover || "/icon-192x192.png", sizes: "192x192", type: "image/png" },
          { src: currentTrack.cover || "/icon-512x512.png", sizes: "512x512", type: "image/png" }
        ]
      });

      navigator.mediaSession.setActionHandler("play", () => setIsPlaying(true));
      navigator.mediaSession.setActionHandler("pause", () => setIsPlaying(false));
      navigator.mediaSession.setActionHandler("nexttrack", () => playNext());
      navigator.mediaSession.setActionHandler("previoustrack", () => playPrevious());
      navigator.mediaSession.setActionHandler("seekto", (details) => {
        if (details.seekTime !== undefined) seekTo(details.seekTime);
      });
    }
  }, [currentTrack?.id]);

  useEffect(() => {
    if (typeof window !== "undefined" && "mediaSession" in navigator && currentTrack) {
      navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    }
  }, [isPlaying, currentTrack?.id]);

  useEffect(() => {
    if (typeof window !== "undefined" && "mediaSession" in navigator && currentTrack && duration > 0) {
      try {
        navigator.mediaSession.setPositionState({
          duration: duration,
          playbackRate: 1.0,
          position: progress
        });
      } catch (err) {
        console.warn("MediaSession setPositionState error:", err);
      }
    }
  }, [progress, duration, currentTrack?.id]);

  return (
    <AudioContext.Provider value={{ currentTrack, isPlaying, isBuffering, playTrack, togglePlay, progress, duration, seekTo, playNext, playPrevious }}>
      {children}
      {mounted && currentTrack && silenceSrc && (
        <audio 
          ref={audioRef}
          src={silenceSrc}
          loop
          style={{ display: "none" }}
        />
      )}
      <div 
        id="yt-player-container" 
        style={{ 
          position: "absolute", 
          width: "1px", 
          height: "1px", 
          opacity: 0, 
          pointerEvents: "none",
          overflow: "hidden",
          left: "-1000px",
          top: "-1000px"
        }}
      >
        <div id="yt-player-placeholder" />
      </div>
    </AudioContext.Provider>
  );
}

export const useAudio = () => useContext(AudioContext);
