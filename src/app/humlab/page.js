"use client";
// Hum Lab: a data-collection tool for hum search (docs/HUM_SEARCH_ARCHITECTURE.md §9). Not linked
// from the app's screens; open /humlab directly. A participant listens to a short, known part of a
// song, then hums / whistles / sings it back in several ways. Every take is saved on this device
// with an exact label (song, segment, kind of take, voice), and exported as WAV + JSON files.
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Microphone, Play, Pause, Trash, DownloadSimple, Check, MagnifyingGlass } from "@phosphor-icons/react";
import { useAudio, audioProgressEmitter } from "@/contexts/AudioContext";
import { searchSongs } from "@/lib/catalog";
import { toast } from "@/lib/toast";
import { classifyTrack } from "@/lib/ir/classify";
import { TAKE_KINDS, TAKE_SR, encodeWav, saveTake, listTakes, deleteTake, clearTakes, exportTakes } from "@/lib/melody/humlab";
import { SUGGESTED_SONGS } from "@/lib/melody/humlabSongs";
import styles from "./page.module.css";

const PROFILE_KEY = "aurasynq_humlab_profile";
const SEGMENT_SECONDS = 15;
const TAKE_SECONDS = 15;
const VOICES = ["male", "female", "child", "other", "prefer not to say"];
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export default function HumLab() {
  const { playTrack, togglePlay, seekTo, isPlaying, currentTrack } = useAudio();
  const [step, setStep] = useState("consent"); // consent | about | song | segment | takes
  const [profile, setProfile] = useState({ participant: "", voice: "", consent: false });
  const [suggested, setSuggested] = useState([]);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState([]);
  const [song, setSong] = useState(null);
  const [start, setStart] = useState(45);
  const [heard, setHeard] = useState(false);
  const [takes, setTakes] = useState([]);
  const [recording, setRecording] = useState(null); // kind id while recording
  const [level, setLevel] = useState(0);
  const [progress, setProgress] = useState(0);
  const [pending, setPending] = useState(null); // { kind, samples, url } awaiting keep / redo
  const [message, setMessage] = useState("");
  const stopRef = useRef(false);
  const segmentEndRef = useRef(null);
  const isPlayingRef = useRef(false);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null");
      if (saved?.consent) { setProfile(saved); setStep("song"); }
    } catch (e) {}
    listTakes().then(setTakes).catch(() => {});
  }, []);

  // Suggested songs, resolved on YouTube Music when the song step opens
  useEffect(() => {
    if (step !== "song" || suggested.length) return;
    let cancelled = false;
    (async () => {
      const out = [];
      for (const s of SUGGESTED_SONGS) {
        const [t] = await searchSongs(s.query).catch(() => []);
        if (cancelled) return;
        if (t) out.push({ ...t, decade: s.decade });
        setSuggested([...out]);
      }
    })();
    return () => { cancelled = true; };
  }, [step, suggested.length]);

  // Stop the song at the end of the segment
  useEffect(() => {
    if (!audioProgressEmitter) return;
    const onProgress = (e) => {
      const end = segmentEndRef.current;
      if (end !== null && e.detail >= end) {
        segmentEndRef.current = null;
        setHeard(true);
        if (isPlayingRef.current) togglePlay();
      }
    };
    audioProgressEmitter.addEventListener("progress", onProgress);
    return () => audioProgressEmitter.removeEventListener("progress", onProgress);
  }, [togglePlay]);
  const saveProfile = (p) => {
    setProfile(p);
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch (e) {}
  };

  const search = async () => {
    if (!query.trim()) return;
    setMessage("Searching…");
    const tracks = await searchSongs(query.trim()).catch(() => []);
    setFound(tracks.slice(0, 8));
    setMessage(tracks.length ? "" : "Nothing found");
  };

  const chooseSong = (t) => {
    setSong(t);
    setStart(Math.min(45, Math.max(0, (t.duration || 120) - SEGMENT_SECONDS - 5)));
    setHeard(false);
    setStep("segment");
  };

  // Plays [start, start + SEGMENT_SECONDS] of the song through the app's own player
  const playSegment = () => {
    segmentEndRef.current = start + SEGMENT_SECONDS;
    if (currentTrack?.id === song.id) {
      seekTo(start);
      if (!isPlaying) togglePlay();
      return;
    }
    playTrack(song, [song], true);
    // seek once the song has started (the player needs the source first)
    const t0 = Date.now();
    const trySeek = setInterval(() => {
      if (isPlayingRef.current || Date.now() - t0 > 15000) {
        clearInterval(trySeek);
        seekTo(start);
      }
    }, 300);
  };

  const record = async (kind) => {
    if (recording) return;
    if (isPlayingRef.current) togglePlay();
    setRecording(kind.id);
    setPending(null);
    setMessage(kind.hint);
    stopRef.current = false;
    try {
      const { recordMelody } = await import("@/lib/melody/capture");
      const samples = await recordMelody({
        seconds: TAKE_SECONDS,
        minSeconds: 2,
        onLevel: setLevel,
        onProgress: setProgress,
        shouldStop: () => stopRef.current,
      });
      const url = URL.createObjectURL(encodeWav(samples, TAKE_SR));
      setPending({ kind: kind.id, samples, url });
      setMessage("Listen back, then keep it or try again");
    } catch (err) {
      setMessage(err?.message || "Couldn't record");
    } finally {
      setRecording(null);
      setLevel(0);
      setProgress(0);
    }
  };

  const keep = async () => {
    if (!pending) return;
    const { language } = classifyTrack(song);
    const label = {
      songId: song.id,
      title: song.title,
      artist: song.artist,
      album: song.album || null,
      language: language || null,
      decade: song.decade || null,
      segmentStart: start,
      segmentEnd: start + SEGMENT_SECONDS,
      kind: pending.kind,
      seconds: +(pending.samples.length / TAKE_SR).toFixed(2),
      sampleRate: TAKE_SR,
      participant: profile.participant || null,
      voice: profile.voice || null,
      recordedAt: Date.now(),
      device: navigator.userAgent,
      consent: true,
    };
    await saveTake({ id: `${label.recordedAt}-${Math.random().toString(36).slice(2, 7)}`, wav: encodeWav(pending.samples, TAKE_SR), label });
    URL.revokeObjectURL(pending.url);
    setPending(null);
    setTakes(await listTakes());
    setMessage("Saved");
  };

  const kindsDone = new Set(takes.filter((t) => t.label.songId === song?.id && t.label.segmentStart === start).map((t) => t.label.kind));

  return (
    <div className={styles.container}>
      <header className={styles.top}>
        {(step === "segment" || step === "takes") && (
          <button className={styles.iconBtn} onClick={() => setStep(step === "takes" ? "segment" : "song")} aria-label="Back">
            <ArrowLeft size={20} />
          </button>
        )}
        <h1>Hum Lab</h1>
        <span className={styles.count}>{takes.length} takes</span>
      </header>

      {step === "consent" && (
        <section className={`glass ${styles.card}`}>
          <h2>Help AuraSynq learn to recognise hums</h2>
          <p>You'll listen to a short part of a song, then hum, whistle or sing it back a few different ways. Each recording is about 15 seconds.</p>
          <ul>
            <li>Recordings are saved <b>only on this device</b>. Nothing is uploaded.</li>
            <li>You choose when to export them and who to send them to.</li>
            <li>They're used only to test and improve AuraSynq's hum search.</li>
            <li>You can delete any recording, or all of them, at any time.</li>
          </ul>
          <button className={styles.primary} onClick={() => setStep("about")}>I agree, let's start</button>
        </section>
      )}

      {step === "about" && (
        <section className={`glass ${styles.card}`}>
          <h2>About you (optional)</h2>
          <label className={styles.field}>
            Name or alias
            <input value={profile.participant} onChange={(e) => setProfile({ ...profile, participant: e.target.value })} placeholder="e.g. Ravi" />
          </label>
          <div className={styles.field}>
            Voice
            <div className={styles.chips}>
              {VOICES.map((v) => (
                <button key={v} className={`${styles.chip} ${profile.voice === v ? styles.chipOn : ""}`} onClick={() => setProfile({ ...profile, voice: v })}>{v}</button>
              ))}
            </div>
          </div>
          <button className={styles.primary} onClick={() => { saveProfile({ ...profile, consent: true }); setStep("song"); }}>Continue</button>
        </section>
      )}

      {step === "song" && (
        <section className={styles.stack}>
          <div className={styles.searchRow}>
            <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder="Search any song…" />
            <button className={styles.iconBtn} onClick={search} aria-label="Search"><MagnifyingGlass size={20} /></button>
          </div>
          {message && <p className={styles.muted}>{message}</p>}
          {found.map((t) => <SongRow key={t.id} track={t} onPick={chooseSong} />)}
          <h3>Suggested · Tamil across the decades</h3>
          {!suggested.length && <p className={styles.muted}>Loading songs…</p>}
          {suggested.map((t) => <SongRow key={t.id} track={t} tag={t.decade} onPick={chooseSong} done={takes.some((x) => x.label.songId === t.id)} />)}
        </section>
      )}

      {step === "segment" && song && (
        <section className={`glass ${styles.card}`}>
          <SongRow track={song} />
          <h2>1. Listen to this part</h2>
          <p className={styles.muted}>Pick a part you know well, like the chorus. Then play it and listen carefully.</p>
          <div className={styles.segment}>
            <button className={styles.chip} onClick={() => { setStart(Math.max(0, start - 5)); setHeard(false); }}>−5 s</button>
            <span className={styles.time}>{fmt(start)} – {fmt(start + SEGMENT_SECONDS)}</span>
            <button className={styles.chip} onClick={() => { setStart(Math.min(Math.max(0, (song.duration || 600) - SEGMENT_SECONDS), start + 5)); setHeard(false); }}>+5 s</button>
          </div>
          <button className={styles.primary} onClick={isPlaying && currentTrack?.id === song.id ? togglePlay : playSegment}>
            {isPlaying && currentTrack?.id === song.id ? <><Pause size={18} weight="fill" /> Pause</> : <><Play size={18} weight="fill" /> Play this part</>}
          </button>
          <button className={styles.secondary} disabled={!heard} onClick={() => { setMessage(""); setStep("takes"); }}>
            {heard ? "I've heard it, record now" : "Play the part first"}
          </button>
        </section>
      )}

      {step === "takes" && song && (
        <section className={styles.stack}>
          <div className={`glass ${styles.card}`}>
            <SongRow track={song} />
            <p className={styles.muted}>Part {fmt(start)} – {fmt(start + SEGMENT_SECONDS)}. Record as many of these as you can. Each one helps.</p>
            {message && <p className={styles.message}>{message}</p>}
            {recording && (
              <div className={styles.meter}>
                <div className={styles.meterFill} style={{ width: `${Math.round(level * 100)}%` }} />
                <span>{Math.ceil(TAKE_SECONDS * (1 - progress))} s · tap Stop when done</span>
              </div>
            )}
            {pending && (
              <div className={styles.review}>
                <audio src={pending.url} controls />
                <div className={styles.row}>
                  <button className={styles.primary} onClick={keep}><Check size={18} /> Keep</button>
                  <button className={styles.secondary} onClick={() => { URL.revokeObjectURL(pending.url); setPending(null); setMessage(""); }}>Try again</button>
                </div>
              </div>
            )}
          </div>
          {TAKE_KINDS.map((k) => (
            <div key={k.id} className={`glass ${styles.kind}`}>
              <div>
                <b>{kindsDone.has(k.id) ? "✓ " : ""}{k.label}</b>
                <p className={styles.muted}>{k.hint}</p>
              </div>
              {recording === k.id ? (
                <button className={styles.stop} onClick={() => { stopRef.current = true; }}>Stop</button>
              ) : (
                <button className={styles.recBtn} disabled={!!recording || !!pending} onClick={() => record(k)} aria-label={`Record: ${k.label}`}>
                  <Microphone size={20} weight="fill" />
                </button>
              )}
            </div>
          ))}
          <button className={styles.secondary} onClick={() => setStep("song")}>Next song</button>
        </section>
      )}

      {step !== "consent" && step !== "about" && takes.length > 0 && (
        <section className={`glass ${styles.card}`}>
          <h3>Your takes ({takes.length})</h3>
          {takes.slice(-6).reverse().map((t) => (
            <div key={t.id} className={styles.takeRow}>
              <span>{t.label.title?.slice(0, 26)} · {t.label.kind} · {fmt(t.label.segmentStart)}</span>
              <button className={styles.iconBtn} onClick={async () => { await deleteTake(t.id); setTakes(await listTakes()); }} aria-label="Delete take"><Trash size={16} /></button>
            </div>
          ))}
          <div className={styles.row}>
            <button className={styles.primary} onClick={async () => {
              try {
                const n = await exportTakes();
                toast(`${n} takes ready. Save them to Files or Drive, or send them`, { duration: 4000 });
              } catch (err) {
                if (!/cancel/i.test(err?.message || "")) toast(`Export failed: ${err?.message || err}`, { variant: "error" });
              }
            }}>
              <DownloadSimple size={18} /> Export all
            </button>
            <button className={styles.danger} onClick={async () => { if (confirm("Delete all takes on this device?")) { await clearTakes(); setTakes([]); } }}>Delete all</button>
          </div>
        </section>
      )}
    </div>
  );
}

function SongRow({ track, tag, onPick, done }) {
  const body = (
    <>
      <img src={track.cover} alt="" className={styles.cover} />
      <span className={styles.songText}>
        <b>{track.title}</b>
        <span className={styles.muted}>{track.artist}{tag ? ` · ${tag}` : ""}</span>
      </span>
      {done && <Check size={18} className={styles.done} />}
    </>
  );
  return onPick
    ? <button className={styles.songRow} onClick={() => onPick(track)}>{body}</button>
    : <div className={styles.songRow}>{body}</div>;
}
