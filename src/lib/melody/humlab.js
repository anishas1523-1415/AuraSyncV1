"use client";
// Hum Lab: collecting labelled hums for the hum search dataset (see docs/HUM_SEARCH_ARCHITECTURE.md §9).
// Each take is a short recording of someone humming / whistling / singing a known part of a known
// song. Takes are kept on this device (IndexedDB); with the participant's consent they are also
// shared with the hum dataset by humshare.js. Export gives the participant their own copy.

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

const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(",")[1]);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

// Every take as files: { name, blob } for each WAV and JSON label, plus one manifest
async function takeFiles() {
  const takes = await listTakes();
  const files = [];
  const manifest = [];
  takes.forEach((take, i) => {
    const name = takeFileName(take.label, i + 1);
    files.push({ name: `${name}.wav`, blob: take.wav });
    files.push({ name: `${name}.json`, blob: new Blob([JSON.stringify(take.label, null, 2)], { type: "application/json" }) });
    manifest.push({ file: `${name}.wav`, ...take.label });
  });
  files.push({
    name: `humlab-manifest-${Date.now()}.json`,
    blob: new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), takes: manifest }, null, 2)], { type: "application/json" }),
  });
  return { files, count: takes.length };
}

// Exports every take (WAV + JSON label) and one manifest. Resolves to the number of takes.
//   Android app: written to the app's storage, then Android's share sheet opens with all of them
//                (save to Files / Drive, or send on WhatsApp, email…). The WebView can't download.
//   Browsers that can share files: the same, through the browser's share sheet.
//   Other browsers: downloaded one by one.
export async function exportTakes() {
  const { files, count } = await takeFiles();
  if (!count) return 0;
  const { Capacitor } = await import("@capacitor/core");
  if (Capacitor.isNativePlatform()) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([import("@capacitor/filesystem"), import("@capacitor/share")]);
    const folder = `humlab-${Date.now()}`;
    const uris = [];
    for (const f of files) {
      const { uri } = await Filesystem.writeFile({ path: `${folder}/${f.name}`, data: await blobToBase64(f.blob), directory: Directory.Cache, recursive: true });
      uris.push(uri);
    }
    await Share.share({ title: "Hum Lab recordings", text: `${count} Hum Lab takes`, files: uris, dialogTitle: "Save or send your Hum Lab takes" });
    return count;
  }
  const asFiles = files.map((f) => new File([f.blob], f.name, { type: f.blob.type }));
  if (navigator.canShare?.({ files: asFiles })) {
    await navigator.share({ title: "Hum Lab recordings", files: asFiles });
    return count;
  }
  await downloadAll(files);
  return count;
}

async function downloadAll(files) {
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
  for (const f of files) {
    download(f.blob, f.name);
    await new Promise((r) => setTimeout(r, 350)); // browsers drop rapid-fire downloads
  }
}
