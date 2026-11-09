"use client";
// YouTube Music lookups on the phone (search and radio), straight from YouTube like playback.
// Needs no PO token, so it doesn't wait for BotGuard.
import { Innertube, UniversalCache } from "youtubei-web/web";
import { nativeFetch } from "./nativeHttp";
import { musicRadio, searchMusicSongs, musicSuggestions } from "../musicTracks";
import { createSearch } from "../ir/search";
import { languageTrending, trendingNow } from "../ir/charts";

let clientPromise = null;

function getClient() {
  if (!clientPromise) {
    clientPromise = Innertube.create({
      fetch: nativeFetch,
      retrieve_player: false,
      generate_session_locally: true,
      enable_session_cache: false,
      cache: new UniversalCache(false),
      // No phone user agent here: YouTube Music then answers with its mobile layout, which
      // leaves out the artist names (youtubei.js defaults to a desktop browser)
    }).catch((err) => {
      clientPromise = null; // try again next time (e.g. the phone was offline)
      throw err;
    });
  }
  return clientPromise;
}

// Full relevance search (query understanding, film albums, artists, ranking, personal taste)
const engine = createSearch(getClient);

export async function searchSongs(query, { profile = null, trending = null, light = false } = {}) {
  // `light`: plain song search for background mixes, which don't need the extra lookups
  if (light) return searchMusicSongs(await getClient(), query);
  return engine.search(query, { profile, trending });
}

export async function relatedSongs(videoId) {
  return musicRadio(await getClient(), videoId);
}

export async function suggestQueries(query) {
  return musicSuggestions(await getClient(), query);
}

// Official YouTube Music charts: "tamil" (one language) or "now" (the country, leaning toward
// `languages`)
export async function chartSongs(kind, { country = "IN", languages = [], count = 40 } = {}) {
  const yt = await getClient();
  return kind === "now" ? trendingNow(yt, { country, languages, count }) : languageTrending(yt, kind, { country, count });
}

// USB-debug hook: await window.__auraSearch.filmAlbum("leo", { languages: [] })
if (typeof window !== "undefined") window.__auraSearch = { ...engine, chartSongs };

export function warmUp() {
  getClient().catch(() => {});
}
