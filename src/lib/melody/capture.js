"use client";
// Records a short hum, whistle or sung melody from the microphone and returns it as 16 kHz mono.
// Nothing is stored or sent anywhere: the samples go straight to hum search on the device.
// Android: the WebView asks for the microphone through Capacitor (RECORD_AUDIO in the manifest).

const SR = 16000;

class CaptureError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // "unavailable" | "denied" | "failed"
  }
}

// Linear-interpolation resampling to 16 kHz (the mic runs at 44.1 / 48 kHz)
function resample(input, fromRate) {
  if (fromRate === SR) return input;
  const ratio = fromRate / SR;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio;
    const a = Math.floor(x);
    const frac = x - a;
    out[i] = input[a] * (1 - frac) + (input[a + 1] ?? input[a]) * frac;
  }
  return out;
}

// Records up to `seconds` of audio. Optional: `onLevel(0..1)` reports loudness while recording,
// `onProgress(0..1)` how much of the time has passed, and `shouldStop()` ends it early (after at
// least `minSeconds`).
export async function recordMelody({ seconds = 10, minSeconds = 4, onLevel, onProgress, shouldStop } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) throw new CaptureError("unavailable", "Humming search needs microphone access, which this device doesn't offer");
  let stream;
  try {
    // Raw signal: noise suppression and echo cancellation smear pitch
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1 },
    });
  } catch (e) {
    throw new CaptureError("denied", "Allow microphone access to search by humming");
  }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  try {
    const source = ctx.createMediaStreamSource(stream);
    // ScriptProcessor: deprecated but supported everywhere, and needs no separate worklet file
    const node = ctx.createScriptProcessor(4096, 1, 1);
    const chunks = [];
    let total = 0;
    const needed = Math.ceil(seconds * ctx.sampleRate);
    await new Promise((resolve) => {
      node.onaudioprocess = (e) => {
        const data = e.inputBuffer.getChannelData(0);
        chunks.push(new Float32Array(data));
        total += data.length;
        if (onLevel) {
          let sum = 0;
          for (let i = 0; i < data.length; i += 8) sum += data[i] * data[i];
          onLevel(Math.min(1, Math.sqrt(sum / (data.length / 8)) * 4));
        }
        onProgress?.(Math.min(1, total / needed));
        const early = shouldStop?.() && total >= minSeconds * ctx.sampleRate;
        if (total >= needed || early) resolve();
      };
      source.connect(node);
      node.connect(ctx.destination); // required for onaudioprocess to fire; outputs silence
    });
    node.disconnect();
    source.disconnect();
    const all = new Float32Array(total);
    let at = 0;
    for (const c of chunks) { all.set(c, at); at += c.length; }
    return resample(all, ctx.sampleRate);
  } catch (e) {
    if (e instanceof CaptureError) throw e;
    throw new CaptureError("failed", "Couldn't record. Try again");
  } finally {
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => {});
  }
}
