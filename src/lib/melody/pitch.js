// Pitch tracking for query by humming. Pure functions on Float32Array audio (mono), no platform APIs,
// so the same code runs in the app, in a worker and in Node tests.
//
//   trackHum(samples, sampleRate)        one voice: humming, singing, whistling (YIN)
//   trackMelody(samples, sampleRate)     the main melody of a full song mix (harmonic-sum salience
//                                        + Viterbi smoothing, after Salamon & Gómez's "Melodia" idea)
//
// Both return { midi: Float32Array, fps } with one fractional MIDI note per frame, NaN = no pitch.
// References: de Cheveigné & Kawahara 2002 (YIN); Salamon & Gómez 2012 (predominant melody).

export const hzToMidi = (hz) => 69 + 12 * Math.log2(hz / 440);
export const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// ─── YIN for a single voice ───
// 16 kHz input. Whistles reach ~2.5 kHz, low male humming ~70 Hz.
export function trackHum(samples, sampleRate, { hop = 320, frame = 768, fmin = 70, fmax = 2200, threshold = 0.15 } = {}) {
  const tauMin = Math.max(2, Math.floor(sampleRate / fmax));
  const tauMax = Math.min(frame - 2, Math.ceil(sampleRate / fmin));
  const W = frame - tauMax;
  const frames = Math.max(0, Math.floor((samples.length - frame) / hop) + 1);
  const midi = new Float32Array(frames).fill(NaN);
  const rms = new Float32Array(frames);
  const d = new Float32Array(tauMax + 1);

  for (let f = 0; f < frames; f++) {
    const start = f * hop;
    let energy = 0;
    for (let i = 0; i < frame; i++) energy += samples[start + i] * samples[start + i];
    rms[f] = Math.sqrt(energy / frame);
  }
  // Silence gate: the quietest tenth of the recording is usually the room, and a voice is well above
  // it. A hum without pauses has no quiet part, so the gate never rises above a quarter of the
  // voice's own level.
  const sorted = Float32Array.from(rms).sort();
  const floor = sorted[Math.floor(sorted.length * 0.1)] || 0;
  const peak = sorted[Math.floor(sorted.length * 0.95)] || 0;
  const gate = Math.max(Math.min(floor * 3, peak * 0.25), peak * 0.05, 1e-4);

  for (let f = 0; f < frames; f++) {
    if (rms[f] < gate) continue;
    const start = f * hop;
    // Difference function
    for (let tau = 1; tau <= tauMax; tau++) {
      let sum = 0;
      for (let i = 0; i < W; i++) {
        const diff = samples[start + i] - samples[start + i + tau];
        sum += diff * diff;
      }
      d[tau] = sum;
    }
    // Cumulative mean normalised difference, first dip under the threshold
    let running = 0;
    let best = -1;
    let bestVal = 1;
    for (let tau = 1; tau <= tauMax; tau++) {
      running += d[tau];
      const cmnd = running > 0 ? (d[tau] * tau) / running : 1;
      d[tau] = cmnd;
      if (tau < tauMin) continue;
      if (best < 0 && cmnd < threshold) {
        // walk to the bottom of this dip
        best = tau;
        bestVal = cmnd;
      } else if (best >= 0) {
        if (cmnd < bestVal) { best = tau; bestVal = cmnd; }
        else break;
      }
    }
    if (best < 0) continue;
    // Parabolic interpolation around the dip
    let tau = best;
    if (best > 1 && best < tauMax) {
      const a = d[best - 1];
      const b = d[best];
      const c = d[best + 1];
      const denom = a - 2 * b + c;
      if (denom !== 0) tau = best + (a - c) / (2 * denom);
    }
    midi[f] = hzToMidi(sampleRate / tau);
  }
  return { midi, fps: sampleRate / hop };
}

// ─── FFT (iterative radix-2, in place) ───
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar;
        im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar;
        im[i + k] += ai;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

// ─── Main melody of a mix ───
// Candidate pitches: MIDI 45–84 (110–1047 Hz, the singing range) in half-semitone steps. Each frame's
// salience for a candidate is the weighted sum of the spectrum at its harmonics; a Viterbi pass
// picks a smooth path (big jumps cost more), and quiet / unclear frames are marked as no melody.
// `sustain` (0..1) discounts what stays the same for seconds on end: a bass pedal, a drone, a pad.
// For each pitch, that share of its average strength over the surrounding `sustainSeconds` is taken
// away, so a voice moving over a drone wins over the drone (real songs showed the drone winning
// for a minute at a time without it).
export function trackMelody(samples, sampleRate, { hop = 800, n = 2048, lowMidi = 45, highMidi = 84, step = 0.5, harmonics = 8, sustain = 0.85, sustainSeconds = 4 } = {}) {
  const frames = Math.max(0, Math.floor((samples.length - n) / hop) + 1);
  const bins = Math.round((highMidi - lowMidi) / step) + 1;
  const sal = new Float32Array(frames * bins);
  const window = new Float32Array(n);
  for (let i = 0; i < n; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const mag = new Float32Array(n / 2);
  const binHz = sampleRate / n;
  // Harmonic positions (fractional FFT bins) for each candidate
  const harmBins = [];
  for (let b = 0; b < bins; b++) {
    const f0 = midiToHz(lowMidi + b * step);
    const list = [];
    for (let h = 1; h <= harmonics; h++) {
      const k = (f0 * h) / binHz;
      if (k < n / 2 - 1) list.push([k, Math.pow(0.8, h - 1)]);
    }
    harmBins.push(list);
  }
  const frameEnergy = new Float32Array(frames);

  for (let f = 0; f < frames; f++) {
    const start = f * hop;
    for (let i = 0; i < n; i++) { re[i] = samples[start + i] * window[i]; im[i] = 0; }
    fft(re, im);
    let energy = 0;
    for (let k = 0; k < n / 2; k++) {
      const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      // Compressed magnitude: the voice's harmonics count, the loud bass doesn't drown them
      mag[k] = Math.sqrt(m);
      energy += m * m;
    }
    frameEnergy[f] = energy;
    // Emphasise the voice band (~150 Hz – 5 kHz)
    for (let k = 0; k < n / 2; k++) {
      const hz = k * binHz;
      if (hz < 120) mag[k] *= 0.2;
      else if (hz > 5000) mag[k] *= 0.4;
    }
    for (let b = 0; b < bins; b++) {
      let s = 0;
      for (const [k, w] of harmBins[b]) {
        const k0 = Math.floor(k);
        s += w * Math.max(mag[k0], mag[k0 + 1]);
      }
      sal[f * bins + b] = s;
    }
  }

  return melodyFromSalience(sal, frames, bins, { fps: sampleRate / hop, lowMidi, step, sustain, sustainSeconds, frameEnergy });
}

// From a pitch salience map (frames × bins, row-major; bin b = MIDI lowMidi + b * step) to the
// melody: sustained-sound suppression, a smooth Viterbi path, then "no melody" where it's quiet or
// nothing stands out. Shared by trackMelody (hand-built salience) and Basic Pitch's contour output.
//   frameEnergy: optional loudness per frame (quiet frames are no melody)
//   minPeak:     optional absolute floor for the strongest pitch in a frame (model probabilities)
export function melodyFromSalience(sal, frames, bins, { fps, lowMidi, step, sustain = 0.85, sustainSeconds = 4, frameEnergy = null, minPeak = 0, weakQuantile = 0.25 }) {
  // Sustained-sound suppression: subtract each pitch's running average over ±sustainSeconds
  if (sustain > 0 && frames > 2) {
    const half = Math.max(1, Math.round((sustainSeconds * fps) / 2));
    const avg = new Float32Array(frames);
    for (let b = 0; b < bins; b++) {
      let sum = 0;
      let count = 0;
      let lo = 0;
      let hi = -1;
      for (let f = 0; f < frames; f++) {
        while (hi < Math.min(frames - 1, f + half)) { hi++; sum += sal[hi * bins + b]; count++; }
        while (lo < f - half) { sum -= sal[lo * bins + b]; lo++; count--; }
        avg[f] = sum / count;
      }
      for (let f = 0; f < frames; f++) sal[f * bins + b] = Math.max(0, sal[f * bins + b] - sustain * avg[f]);
    }
  }

  // Viterbi: path through candidates, each step pays for the size of the jump
  const JUMP = 0.24 * step; // cost per semitone of movement 0.24, relative to normalised salience
  const RANGE = Math.round(12 / step); // the melody moves at most a full octave between frames
  const score = new Float32Array(bins);
  const next = new Float32Array(bins);
  const back = new Int16Array(frames * bins);
  const peakSal = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let max = 1e-9;
    for (let b = 0; b < bins; b++) max = Math.max(max, sal[f * bins + b]);
    peakSal[f] = max;
    for (let b = 0; b < bins; b++) {
      const local = sal[f * bins + b] / max;
      if (f === 0) { score[b] = local; continue; }
      let bestPrev = -Infinity;
      let arg = b;
      for (let p = Math.max(0, b - RANGE); p <= Math.min(bins - 1, b + RANGE); p++) {
        const v = score[p] - JUMP * Math.abs(p - b);
        if (v > bestPrev) { bestPrev = v; arg = p; }
      }
      next[b] = bestPrev + local;
      back[f * bins + b] = arg;
    }
    if (f > 0) score.set(next);
  }
  const midi = new Float32Array(frames).fill(NaN);
  if (!frames) return { midi, fps };
  let b = 0;
  for (let i = 1; i < bins; i++) if (score[i] > score[b]) b = i;
  for (let f = frames - 1; f >= 0; f--) {
    midi[f] = lowMidi + b * step;
    if (f > 0) b = back[f * bins + b];
  }
  // No melody in quiet frames (intros, breaks) or where nothing stands out (drums only)
  const quiet = frameEnergy ? Float32Array.from(frameEnergy).sort()[Math.floor(frames * 0.15)] * 2 : -Infinity;
  const weak = Math.max(minPeak, Float32Array.from(peakSal).sort()[Math.floor(frames * weakQuantile)]);
  for (let f = 0; f < frames; f++) {
    if ((frameEnergy && frameEnergy[f] < quiet) || peakSal[f] < weak) midi[f] = NaN;
  }
  return { midi, fps };
}
