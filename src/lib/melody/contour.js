// Melody contours: a pitch track reduced to 10 values per second (fractional MIDI, NaN = no melody),
// the form both reference songs and hummed queries are stored and compared in.
// Stored compactly as half-semitone steps in a Uint8Array (0 = no melody), ~600 bytes per minute.

export const CONTOUR_FPS = 10;

// Resample a pitch track to CONTOUR_FPS: each output frame is the median of the voiced input frames
// it covers (no pitch when fewer than 40 % of them are voiced)
export function toContour({ midi, fps }) {
  const ratio = fps / CONTOUR_FPS;
  const out = new Float32Array(Math.floor(midi.length / ratio)).fill(NaN);
  const bucket = [];
  for (let i = 0; i < out.length; i++) {
    bucket.length = 0;
    const from = Math.floor(i * ratio);
    const to = Math.floor((i + 1) * ratio);
    for (let j = from; j < to; j++) if (!Number.isNaN(midi[j])) bucket.push(midi[j]);
    if (bucket.length && bucket.length >= 0.4 * (to - from)) out[i] = median(bucket);
  }
  return out;
}

// Short gaps (between notes, a breath) are bridged; longer ones stay empty
export function fillGaps(contour, maxGap = 3) {
  const out = Float32Array.from(contour);
  let last = -1;
  for (let i = 0; i < out.length; i++) {
    if (Number.isNaN(out[i])) continue;
    const gap = i - last - 1;
    if (last >= 0 && gap > 0 && gap <= maxGap) {
      for (let k = 1; k <= gap; k++) out[last + k] = out[last] + ((out[i] - out[last]) * k) / (gap + 1);
    }
    last = i;
  }
  return out;
}

// Remove pitch-tracker glitches: single frames far from both neighbours
export function despike(contour, limit = 4) {
  const out = Float32Array.from(contour);
  for (let i = 1; i < out.length - 1; i++) {
    const [a, b, c] = [contour[i - 1], contour[i], contour[i + 1]];
    if ([a, b, c].some(Number.isNaN)) continue;
    if (Math.abs(b - a) > limit && Math.abs(b - c) > limit && Math.abs(a - c) <= limit) out[i] = (a + c) / 2;
  }
  return out;
}

export function median(values) {
  const v = [...values].sort((x, y) => x - y);
  if (!v.length) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export const voicedShare = (contour) => {
  let n = 0;
  for (const v of contour) if (!Number.isNaN(v)) n++;
  return contour.length ? n / contour.length : 0;
};

// Uint8: round(midi * 2) (MIDI 0–127 -> 1–254), 0 = no melody
export function packContour(contour) {
  const out = new Uint8Array(contour.length);
  for (let i = 0; i < contour.length; i++) {
    out[i] = Number.isNaN(contour[i]) ? 0 : Math.max(1, Math.min(254, Math.round(contour[i] * 2)));
  }
  return out;
}

export function unpackContour(bytes) {
  const out = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ? bytes[i] / 2 : NaN;
  return out;
}

// Base64 for storage in IndexedDB / JSON
export function contourToBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return typeof btoa === "function" ? btoa(s) : Buffer.from(bytes).toString("base64");
}

export function contourFromBase64(text) {
  if (typeof atob === "function") {
    const s = atob(text);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(text, "base64"));
}

// From a pitch track to the stored reference form
export function referenceContour(track) {
  return despike(fillGaps(toContour(track), 2));
}

// From a hummed pitch track to the query form (humming has longer gaps between notes)
export function queryContour(track) {
  return despike(fillGaps(toContour(track), 4));
}
