"use client";
// Hum Lab: collecting labelled hums for the hum search dataset (see docs/HUM_SEARCH_ARCHITECTURE.md §9).
// Each take is a short recording of someone humming / whistling / singing a known part of a known
// song. Takes are kept on this device (IndexedDB) until the participant exports them: nothing is
// uploaded anywhere by this module.

const DB_NAME = "aurasynq_humlab";
const STORE = "takes";
export const TAKE_SR = 16000;

// The kinds of take a participant is asked for, so the dataset covers how real people hum
export const TAKE_KINDS = [
  { id: "hum", label: "Hum it", hint: "Hum the part you just heard, the way you normally would" },
  { id: "whistle", label: "Whistle it", hint: "Whistle the same part" },
  { id: "sing", label: "Sing it (la-la is fine)", hint: "Sing the tune, with or without the words" },
  { id: "higher", label: "Hum it higher", hint: "Hum it again, starting on a noticeably higher note" },
  { id: "lower", label: "Hum it lower", hint: "Hum it again, starting on a noticeably lower note" },
  { id: "faster", label: "Hum it faster", hint: "Hum it again, a bit faster than the song" },
  { id: "slower", label: "Hum it slower", hint: "Hum it again, a bit slower than the song" },
  { id: "partial", label: "Just a bit of it", hint: "Hum only the first few seconds of the part" },
];

// ─── WAV (16-bit PCM, mono) ───
export function encodeWav(samples, sampleRate = TAKE_SR) {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(bytes);
  const text = (at, s) => { for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)); };
  text(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([bytes], { type: "audio/wav" });
}

// ─── Takes in IndexedDB: { id, wav (Blob), label } ───
let dbPromise = null;
function db() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((e) => { dbPromise = null; throw e; });
  return dbPromise;
}
const run = async (mode, fn) => {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
  });
};

export const saveTake = (take) => run("readwrite", (s) => s.put(take));
export const listTakes = async () => ((await run("readonly", (s) => s.getAll())) || []).sort((a, b) => a.label.recordedAt - b.label.recordedAt);
export const deleteTake = (id) => run("readwrite", (s) => s.delete(id));
export const clearTakes = () => run("readwrite", (s) => s.clear());

// "<videoId>__<start>-<end>__<kind>__<participant>__<n>": the benchmark reads the song id from the
// part before the first "__"
export function takeFileName(label, n) {
  const safe = (x) => String(x || "anon").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "anon";
  return `${label.songId}__${Math.round(label.segmentStart)}-${Math.round(label.segmentEnd)}__${label.kind}__${safe(label.participant)}__${n}`;
}

// Downloads every take (WAV + JSON label) and one manifest.json listing them all
export async function exportTakes() {
  const takes = await listTakes();
  const manifest = [];
  const download = (blob, name) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
  for (let i = 0; i < takes.length; i++) {
    const name = takeFileName(takes[i].label, i + 1);
    download(takes[i].wav, `${name}.wav`);
    download(new Blob([JSON.stringify(takes[i].label, null, 2)], { type: "application/json" }), `${name}.json`);
    manifest.push({ file: `${name}.wav`, ...takes[i].label });
    await new Promise((r) => setTimeout(r, 350)); // browsers drop rapid-fire downloads
  }
  download(new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), takes: manifest }, null, 2)], { type: "application/json" }), `humlab-manifest-${Date.now()}.json`);
  return takes.length;
}
