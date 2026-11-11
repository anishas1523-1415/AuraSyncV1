// Background worker: melody extraction is a few seconds of number crunching per song, kept off the
// main thread so playback and scrolling never stutter.
//   in:  { job: "reference" | "query", id, samples: Float32Array (16 kHz mono) }
//   out: { id, packed: Uint8Array, seconds, voiced } or { id, error }
import { trackMelody, trackHum } from "./pitch.js";
import { referenceContour, queryContour, packContour, voicedShare } from "./contour.js";

const SR = 16000;

self.onmessage = (event) => {
  const { job, id, samples } = event.data || {};
  try {
    const contour = job === "query" ? queryContour(trackHum(samples, SR)) : referenceContour(trackMelody(samples, SR));
    const packed = packContour(contour);
    self.postMessage({ id, packed, seconds: samples.length / SR, voiced: voicedShare(contour) }, [packed.buffer]);
  } catch (e) {
    self.postMessage({ id, error: String(e?.message || e) });
  }
};
