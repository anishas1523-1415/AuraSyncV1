"use client";
// What the listener is in the mood for RIGHT NOW, as opposed to their long-term taste.
//   session vector: the last few songs they heard, newest weighing most (skips count negatively),
//                   forgotten after a few hours of silence
//   time of day:    a gentle prior on moods (calm in the morning and late at night, romantic in the
//                   evening...), only a tie-breaker
// Both are sparse feature vectors in the same space as the taste profile (artist/lang/mood/film).
import { cosine } from "./rank.js";

const SESSION_MS = 3 * 60 * 60 * 1000; // a break longer than this starts a new session
const MAX_EVENTS = 14;
const ORDER_DECAY = 0.78;              // each earlier song counts 22% less

// Called by the profile recorder for every feedback event
export function sessionEvents(state) {
  state.recent = (state.recent || []).filter((e) => Date.now() - e.at < SESSION_MS * 2).slice(-MAX_EVENTS);
  return state.recent;
}

export function pushSessionEvent(state, event) {
  const events = sessionEvents(state);
  // The same song re-judged (e.g. liked after completing) updates its event instead of repeating
  const last = events[events.length - 1];
  if (last && last.id === event.id) {
    last.w = Math.abs(event.w) > Math.abs(last.w) ? event.w : last.w;
    last.at = event.at;
  } else {
    events.push(event);
  }
  state.recent = events.slice(-MAX_EVENTS);
}

// { feature: weight }, normalised; null when there is no recent listening
export function sessionVector(state) {
  const events = (state?.recent || []).filter((e) => Date.now() - e.at < SESSION_MS);
  if (!events.length) return null;
  const vector = {};
  events.forEach((e, i) => {
    const age = events.length - 1 - i;
    const w = e.w * Math.pow(ORDER_DECAY, age);
    for (const [k, v] of Object.entries(e.f || {})) vector[k] = (vector[k] || 0) + w * v;
  });
  const norm = Math.sqrt(Object.values(vector).reduce((n, v) => n + v * v, 0));
  if (!norm) return null;
  return Object.fromEntries(Object.entries(vector).map(([k, v]) => [k, v / norm]));
}

// Moods that suit the hour (weights 0..1), as a feature vector
export function timeOfDay(date = new Date()) {
  const h = date.getHours();
  let part;
  let moods;
  if (h >= 5 && h < 11) { part = "morning"; moods = { calm: 0.7, happy: 0.8, chill: 0.6, devotional: 0.5 }; }
  else if (h >= 11 && h < 17) { part = "afternoon"; moods = { happy: 0.7, energetic: 0.6, party: 0.4, chill: 0.4 }; }
  else if (h >= 17 && h < 22) { part = "evening"; moods = { romantic: 0.7, chill: 0.6, happy: 0.5, party: 0.4 }; }
  else { part = "night"; moods = { calm: 0.8, sad: 0.6, chill: 0.7, romantic: 0.5 }; }
  const vector = {};
  for (const [mood, w] of Object.entries(moods)) vector[`mood:${mood}`] = w;
  return { part, vector };
}

// Long-term taste, this session and the hour, blended into one "what to play now" vector.
// The session leads when the listener has been active (their current mood is the best signal).
export function intentVector(profile, session, date = new Date()) {
  const tod = timeOfDay(date).vector;
  const parts = [];
  if (profile) parts.push([profile, session ? 0.4 : 0.8]);
  if (session) parts.push([session, 0.45]);
  parts.push([tod, 0.15]);
  const vector = {};
  for (const [vec, weight] of parts) {
    for (const [k, v] of Object.entries(vec)) vector[k] = (vector[k] || 0) + weight * v;
  }
  return vector;
}

// How well a song fits the moment (-1..1)
export function momentFit(trackFeaturesVector, intent) {
  return intent ? cosine(intent, trackFeaturesVector) : 0;
}
