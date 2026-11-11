"use client";
// The listening screen: opens from the mic in the search bar.
//   Voice: speak a request; the words appear live, and the request runs as a search
//   Song:  hum, whistle or sing for up to 10 s; the tune is matched against songs on this device
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Microphone, Waveform, X } from "@phosphor-icons/react";
import { useAudio } from "@/contexts/AudioContext";
import { startVoiceSession } from "@/lib/voice";
import styles from "./ListenOverlay.module.css";

const SONG_SECONDS = 10;
const HINTS = {
  voice: ["“Play old Ilaiyaraaja songs”", "“Enakku kuthu songs venum”", "“Play something like this”", "“Find that Vijay song”"],
  song: ["Hum, whistle or sing the tune", "The chorus works best", "No words needed"],
};

export default function ListenOverlay({ open, initialMode = "voice", canHum = true, onClose, onVoiceCommand, onSongResults }) {
  const { isPlaying, togglePlay } = useAudio();
  const [mode, setMode] = useState(initialMode);
  const [phase, setPhase] = useState("idle"); // listening | working | none | error | idle
  const [transcript, setTranscript] = useState("");
  const [message, setMessage] = useState("");
  const [level, setLevel] = useState(0);
  const [progress, setProgress] = useState(0);
  const [hint, setHint] = useState(0);
  const [run, setRun] = useState(0); // bump to listen again
  const sessionRef = useRef(null);
  const stopSongRef = useRef(false);
  const resumeRef = useRef(false);

  useEffect(() => { if (open) { setMode(initialMode); setRun((r) => r + 1); } }, [open, initialMode]);

  // Rotating examples under the heading
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setHint((h) => h + 1), 2600);
    return () => clearInterval(t);
  }, [open]);

  // Music stops while listening (the mic would hear it) and comes back after
  useEffect(() => {
    if (!open) return;
    if (isPlaying) { resumeRef.current = true; togglePlay(); }
    return () => {
      if (resumeRef.current) { resumeRef.current = false; togglePlay(); }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // One listening round per (open, mode, run)
  useEffect(() => {
    if (!open || !run) return;
    let cancelled = false;
    setTranscript("");
    setMessage("");
    setLevel(0);
    setProgress(0);
    setPhase("listening");

    if (mode === "voice") {
      sessionRef.current = startVoiceSession({
        onPartial: (text) => !cancelled && setTranscript(text),
        onEnd: (command) => {
          if (cancelled) return;
          if (!command || (!command.query && command.action !== "similar")) {
            setPhase("none");
            setMessage("Didn't catch that. Tap the mic and try again");
            return;
          }
          // "Play ..." starts a new song: the one paused for listening stays paused
          if (command.action === "play") resumeRef.current = false;
          onVoiceCommand(command);
        },
        onError: (err) => {
          if (cancelled) return;
          setPhase("error");
          setMessage(err.message);
        },
      });
      // Voice has no loudness feed: a gentle breathing pulse instead
      let t = 0;
      const pulse = setInterval(() => { t += 1; setLevel(0.25 + 0.2 * Math.abs(Math.sin(t / 3))); }, 120);
      return () => { cancelled = true; clearInterval(pulse); sessionRef.current?.stop(); sessionRef.current = null; };
    }

    // Song mode
    stopSongRef.current = false;
    (async () => {
      try {
        const [{ recordMelody }, melody] = await Promise.all([import("@/lib/melody/capture"), import("@/lib/melody/index")]);
        const stats = await melody.melodyIndexStats();
        if (!stats.songs) {
          if (!cancelled) { setPhase("none"); setMessage("Song search learns the songs you play. Play a few songs, then try again"); }
          return;
        }
        const samples = await recordMelody({
          seconds: SONG_SECONDS,
          onLevel: (v) => !cancelled && setLevel(v),
          onProgress: (p) => !cancelled && setProgress(p),
          shouldStop: () => cancelled || stopSongRef.current,
        });
        if (cancelled) return;
        setPhase("working");
        setLevel(0);
        const { tracks, guess, reason } = await melody.humSearch(samples);
        if (cancelled) return;
        if (tracks.length) {
          onSongResults(tracks, { guess });
          return;
        }
        setPhase("none");
        setMessage(reason === "no-melody" || reason === "too-short"
          ? "Couldn't hear a tune. Hum a little louder, closer to the phone"
          : `No match among the ${stats.songs} songs learned on this phone. Try the chorus, a bit longer`);
      } catch (err) {
        if (!cancelled) { setPhase("error"); setMessage(err?.message || "Couldn't listen. Try again"); }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, run]);

  if (!open || typeof document === "undefined") return null;

  const onMic = () => {
    if (phase === "listening") {
      if (mode === "voice") sessionRef.current?.stop();
      else stopSongRef.current = true;
      return;
    }
    if (phase !== "working") setRun((r) => r + 1);
  };

  const heading = {
    listening: mode === "voice" ? "Listening…" : "Listening for the tune…",
    working: "Finding the song…",
    none: "No luck this time",
    error: "Something went wrong",
    idle: "",
  }[phase];
  const hints = HINTS[mode];

  return createPortal(
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Search by voice or song">
      <div className={styles.glow} style={{ "--level": level }} />
      <header className={styles.top}>
        <button className={styles.close} onClick={onClose} aria-label="Close">
          <X size={22} />
        </button>
        <div className={`glass ${styles.modes}`} role="tablist">
          <button role="tab" aria-selected={mode === "voice"} className={`${styles.mode} ${mode === "voice" ? styles.modeActive : ""}`} onClick={() => mode !== "voice" && setMode("voice")}>
            <Microphone size={16} weight={mode === "voice" ? "fill" : "regular"} /> Voice
          </button>
          {canHum && (
            <button role="tab" aria-selected={mode === "song"} className={`${styles.mode} ${mode === "song" ? styles.modeActive : ""}`} onClick={() => mode !== "song" && setMode("song")}>
              <Waveform size={16} weight={mode === "song" ? "fill" : "regular"} /> Song
            </button>
          )}
        </div>
        <span className={styles.spacer} />
      </header>

      <main className={styles.body}>
        <h2 className={styles.heading}>{heading}</h2>
        {phase === "listening" && !transcript && <p key={hint} className={styles.hint}>{hints[hint % hints.length]}</p>}
        {transcript && <p className={styles.transcript}>{transcript}</p>}
        {message && <p className={styles.message}>{message}</p>}
      </main>

      <footer className={styles.bottom}>
        <button
          className={`${styles.mic} ${phase === "listening" ? styles.micLive : ""} ${phase === "working" ? styles.micWorking : ""}`}
          style={{ "--level": level, "--progress": mode === "song" ? progress : 0 }}
          onClick={onMic}
          aria-label={phase === "listening" ? "Stop listening" : "Listen again"}
        >
          <span className={styles.ring} />
          <span className={styles.ring2} />
          {mode === "voice" ? <Microphone size={34} weight="fill" /> : <Waveform size={34} weight="fill" />}
        </button>
        <p className={styles.caption}>
          {phase === "listening" ? (mode === "song" ? `Tap to finish · ${Math.max(0, Math.ceil(SONG_SECONDS * (1 - progress)))}s` : "Tap to finish")
            : phase === "working" ? "Matching melodies on this phone"
            : "Tap to try again"}
        </p>
      </footer>
    </div>,
    document.body,
  );
}
