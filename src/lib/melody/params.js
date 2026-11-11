"use client";
// Hum search settings. The training job (scripts/hum-train.mjs, run nightly) tunes them on the shared
// Hum Lab dataset and publishes public/hum-params.json only when they beat the current ones on
// held-back hums. The app ships with the file it was built with and fetches the website's latest
// copy at most once a day, so better settings arrive without an app update.
import { apiUrl } from "@/lib/api";

export const DEFAULT_PARAMS = { maxCost: 0.65, minZ: 3, coarseKeep: 60, perSong: 3, guessMaxCost: 0.65 };
// Anything outside these ranges is ignored (a broken file can't break hum search)
const RANGES = { maxCost: [0.3, 1.2], minZ: [1, 6], coarseKeep: [20, 200], perSong: [1, 8], guessMaxCost: [0.3, 1.2] };
const CACHE_KEY = "aurasynq_hum_params";
const DAY = 24 * 60 * 60 * 1000;

export function cleanParams(raw) {
  const out = { ...DEFAULT_PARAMS };
  for (const [k, [lo, hi]] of Object.entries(RANGES)) {
    const v = Number(raw?.[k]);
    if (Number.isFinite(v) && v >= lo && v <= hi) out[k] = k === "coarseKeep" || k === "perSong" ? Math.round(v) : v;
  }
  return out;
}

let current = null;
export async function humParams() {
  if (current) return current;
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); } catch (e) {}
  if (cached?.params && Date.now() - cached.at < DAY) return (current = cleanParams(cached.params));
  try {
    const res = await fetch(apiUrl("/hum-params.json"), { cache: "no-store" });
    if (res.ok) {
      const params = (await res.json())?.params;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), params })); } catch (e) {}
      return (current = cleanParams(params));
    }
  } catch (e) {}
  return (current = cleanParams(cached?.params));
}
