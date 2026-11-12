"use client";
// Sharing Hum Lab takes with the hum dataset (asked once, in Hum Lab's first screen).
// Each take goes up as: its audio (WAV), its pitch outline, and its label (song, part, kind of take).
// The tune of the labelled song, as this phone's song index heard it, goes up too (outline only,
// no song audio): the training job compares hums against these outlines.
//
// Privacy: no account, name or email is attached. Each phone gets a random contributor id, kept only
// on the phone, which also lets it withdraw everything it shared (forgetShared).
// The dataset's public key can only ADD takes; nobody can read them with it (see the Supabase
// policies: insert-only tables, private audio bucket).
import { listTakes, saveTake } from "./humlab.js";
import { trackHum } from "./pitch.js";
import { queryContour, packContour, contourToBase64 } from "./contour.js";

const URL_BASE = "https://aldykcamdcizwkqvbubz.supabase.co";
const KEY = "sb_publishable_yQH14RAGbnH9ceyKnIuXnQ_t34VNHnz"; // publishable: insert-only by design
const CONTRIBUTOR_KEY = "aurasynq_humlab_contributor";
const PROFILE_KEY = "aurasynq_humlab_profile";
export const CONSENT_VERSION = 2; // 2: takes are shared automatically (1: kept on the phone only)
const APP_VERSION = "1.0.6";

export function sharingAllowed() {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null");
    return !!p?.consent && (p.consentVersion || 1) >= CONSENT_VERSION;
  } catch (e) {
    return false;
  }
}

export function contributorId() {
  let id = null;
  try { id = localStorage.getItem(CONTRIBUTOR_KEY); } catch (e) {}
  if (!id) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    try { localStorage.setItem(CONTRIBUTOR_KEY, id); } catch (e) {}
  }
  return id;
}

const headers = (extra = {}) => ({ apikey: KEY, ...extra });
const safeId = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 64);

// Samples of a 16-bit mono WAV written by encodeWav
async function wavSamples(blob) {
  const view = new DataView(await blob.arrayBuffer());
  const n = (view.byteLength - 44) >> 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = view.getInt16(44 + i * 2, true) / 32768;
  return out;
}

async function post(path, body, extraHeaders) {
  const res = await fetch(`${URL_BASE}${path}`, { method: "POST", headers: headers(extraHeaders), body });
  // 409: already there (a retry after a lost response, or an outline another take sent)
  if (!res.ok && res.status !== 409 && !(res.status === 400 && /Duplicate|already exists/i.test(await res.clone().text()))) {
    throw new Error(`upload failed (${res.status})`);
  }
}

async function songOutline(songId) {
  try {
    const { referenceOutline } = await import("./index.js");
    return await referenceOutline(songId);
  } catch (e) {
    return null;
  }
}

// Uploads one take (audio, outline, label) and the song's outline if ready. Resolves to the take
// marked as shared; the caller saves it.
export async function uploadTake(take, contributor = contributorId()) {
  const { label } = take;
  const takeId = safeId(take.id);
  const samples = await wavSamples(take.wav);
  const contour = contourToBase64(packContour(queryContour(trackHum(samples, label.sampleRate || 16000))));
  const audioPath = `takes/${contributor}/${takeId}.wav`;
  await post(`/storage/v1/object/hum-audio/${audioPath}`, take.wav, { "Content-Type": "audio/wav" });
  await post("/rest/v1/hum_takes", JSON.stringify({
    take_id: takeId,
    contributor,
    song_id: label.songId,
    title: label.title,
    artist: label.artist,
    language: label.language,
    decade: label.decade,
    segment_start: label.segmentStart,
    segment_end: label.segmentEnd,
    kind: label.kind,
    seconds: label.seconds,
    voice: label.voice,
    contour,
    audio_path: audioPath,
    app_version: APP_VERSION,
  }), { "Content-Type": "application/json", Prefer: "return=minimal" });
  const outlineSent = await sendOutline(label);
  return { ...take, sharedAt: Date.now(), outlineSent };
}

// The song's outline, once this phone has learned the song (it learns songs in the background after
// they play, so right after a take it may not be ready yet). Resolves to whether it was sent.
async function sendOutline(label) {
  const outline = await songOutline(label.songId);
  if (!outline) return false;
  await post("/rest/v1/song_outlines", JSON.stringify({
    song_id: label.songId, title: label.title, artist: label.artist, contour: outline,
  }), { "Content-Type": "application/json", Prefer: "return=minimal" });
  return true;
}

// Sends every take not yet shared. Resolves to { shared, pending }. Safe to call often: one run at
// a time, and a take that fails is retried next time (offline, server busy...).
let running = null;
export function shareTakes() {
  if (!sharingAllowed()) return Promise.resolve({ shared: 0, pending: 0 });
  if (running) return running;
  running = (async () => {
    const contributor = contributorId();
    const all = await listTakes();
    const waiting = all.filter((t) => !t.sharedAt);
    // Shared earlier, but the song's outline wasn't ready then
    const sentSongs = new Set();
    for (const take of all.filter((t) => t.sharedAt && !t.outlineSent)) {
      try {
        const sent = sentSongs.has(take.label.songId) || await sendOutline(take.label);
        if (sent) { sentSongs.add(take.label.songId); await saveTake({ ...take, outlineSent: true }); }
      } catch (e) { break; }
    }
    let shared = 0;
    for (const take of waiting) {
      try {
        await saveTake(await uploadTake(take, contributor));
        shared += 1;
      } catch (e) {
        console.warn("Hum Lab: take not shared yet", e);
        break; // probably offline: try the rest later
      }
    }
    return { shared, pending: waiting.length - shared };
  })().finally(() => { running = null; });
  return running;
}

// Withdraws shared takes from the dataset: one (takeId) or all of this phone's
export async function forgetShared(takeId = null) {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/forget_hum_takes`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ p_contributor: contributorId(), p_take_id: takeId ? safeId(takeId) : null }),
  });
  if (!res.ok) throw new Error(`couldn't remove (${res.status})`);
  return res.json();
}
