"use client";
// Voice search: speech -> text on the device, then the same request understanding as typed search.
//   Android app: Android's own speech recognition, through @capacitor-community/speech-recognition
//                (MIT), without its popup: the app's listening screen shows the words live.
//                Nothing is recorded or stored by AuraSynq.
//   Website:     the browser's Web Speech API where it exists (Chrome, Edge, Safari).
// Indian English ("en-IN") is the default: it writes Tanglish and Hinglish requests in Latin letters
// ("enakku ilaiyaraaja songs venum"), which is what the request parser reads; Tamil or Hindi
// recognisers would answer in Tamil/Devanagari script.
import { Capacitor } from "@capacitor/core";
import { SpeechRecognition } from "@capacitor-community/speech-recognition";
import { bestTranscript, parseVoiceCommand } from "@/lib/ir/voice";

const LANGUAGE = "en-IN";

const isNative = () => typeof window !== "undefined" && Capacitor.isNativePlatform();
const webRecognizer = () => (typeof window === "undefined" ? null : window.SpeechRecognition || window.webkitSpeechRecognition || null);

// Imported directly, never returned through a Promise: a Capacitor plugin object answers every
// property, including "then", so `await`ing it (or resolving a promise with it) never finishes
const sr = SpeechRecognition;

// Can this device do voice search at all?
export async function voiceAvailable() {
  if (isNative()) {
    try {
      return !!(await sr.available()).available;
    } catch (e) {
      return false;
    }
  }
  return !!webRecognizer();
}

class VoiceError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // "unavailable" | "denied" | "no-speech" | "failed"
  }
}

// ─── Live session (used by the listening screen) ───
// Words appear as they're spoken: onPartial(text) while listening, then onEnd(command | null) once
// the speaker stops (Android's recogniser ends on silence). onError(VoiceError) on failure.
// Returns { stop } to end early (what was heard so far is used).
export function startVoiceSession({ onPartial, onEnd, onError }) {
  let finished = false;
  let latest = [];
  const finish = () => {
    if (finished) return;
    finished = true;
    const transcript = bestTranscript(latest);
    onEnd(transcript ? parseVoiceCommand(transcript) : null);
  };
  const fail = (e) => {
    if (finished) return;
    finished = true;
    onError(e instanceof VoiceError ? e : new VoiceError("failed", "Couldn't hear that. Try again"));
  };

  if (isNative()) {
    const handles = [];
    let watch = null;
    let finalTimer = null;
    let stopped = false; // the speaker finished (or tapped stop): waiting for the final words
    let restarts = 0;
    const startedAt = Date.now();
    const cleanup = () => {
      clearInterval(watch);
      handles.forEach((h) => h?.remove?.());
    };
    // Android reports "stopped" (end of speech) BEFORE it delivers the final transcript, which
    // often carries the last words; so after "stopped" the session waits for that final result
    // (one more partialResults event), or gives up after a moment if none comes.
    const settle = (wait) => {
      clearTimeout(finalTimer);
      finalTimer = setTimeout(() => { cleanup(); finish(); }, wait);
    };
    const listen = () => sr.start({ language: LANGUAGE, maxResults: 5, partialResults: true, popup: false });
    (async () => {
      let perm = await sr.checkPermissions().catch(() => null);
      if (perm?.speechRecognition !== "granted") perm = await sr.requestPermissions().catch(() => null);
      if (perm?.speechRecognition !== "granted") throw new VoiceError("denied", "Allow microphone access to search by voice");
      handles.push(await sr.addListener("partialResults", ({ matches }) => {
        if (!matches?.length) return;
        latest = matches;
        onPartial?.(matches[0]);
        if (stopped) settle(150); // the final result after end of speech: done
      }));
      handles.push(await sr.addListener("listeningState", ({ status }) => {
        if (status === "stopped" && !stopped && latest.length) { stopped = true; settle(1800); }
      }));
      // No Google popup: the app's own screen shows what's heard
      await listen();
      // Watchdog. Android's recogniser gives up on its own: no speech within ~5 s ("no match",
      // "speech timeout"), "recogniser busy", network hiccups. The plugin can't report those once
      // listening has started, so the screen kept saying "Listening…" over a dead recogniser.
      // Checked twice a second: if it stopped without hearing words, it is started again (at most 3
      // times within 15 s: some phones beep on every start), the way YouTube's voice search keeps
      // waiting; if it heard words, they're used.
      watch = setInterval(async () => {
        if (stopped || finished) return;
        const { listening } = await sr.isListening().catch(() => ({ listening: true }));
        if (listening) return;
        if (latest.length) {
          stopped = true;
          settle(1200);
        } else if (Date.now() - startedAt < 15000 && restarts < 3) {
          restarts++;
          await new Promise((r) => setTimeout(r, 250)); // let the old recogniser release the mic
          if (!stopped && !finished) listen().catch(() => {});
        } else {
          stopped = true;
          settle(0);
        }
      }, 500);
    })().catch((e) => { cleanup(); fail(e); });
    return {
      stop: () => { sr.stop().catch(() => {}); stopped = true; settle(latest.length ? 1200 : 300); },
    };
  }

  const Recognizer = webRecognizer();
  if (!Recognizer) {
    setTimeout(() => fail(new VoiceError("unavailable", "Voice search isn't supported in this browser")), 0);
    return { stop: () => {} };
  }
  const rec = new Recognizer();
  rec.lang = LANGUAGE;
  rec.maxAlternatives = 5;
  rec.interimResults = true;
  rec.continuous = false;
  rec.onresult = (e) => {
    const result = e.results[e.results.length - 1];
    latest = [...result].map((a) => a.transcript);
    onPartial?.(latest[0]);
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") fail(new VoiceError("denied", "Allow microphone access to search by voice"));
    else if (e.error !== "no-speech" && e.error !== "aborted") fail(new VoiceError("failed", "Couldn't hear that. Try again"));
  };
  rec.onend = finish;
  rec.start();
  return { stop: () => rec.stop() };
}
