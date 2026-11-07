"use client";
// YouTube Music lookups on the phone (search and radio), straight from YouTube like playback.
// Needs no PO token, so it doesn't wait for BotGuard.
import { Innertube, UniversalCache } from "youtubei-web/web";
import { nativeFetch } from "./nativeHttp";
import { musicRadio, searchMusicSongs } from "../musicTracks";
import { createSearch } from "../ir/search";

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

export async function searchSongs(query, { profile = null, light = false } = {}) {
  // `light`: plain song search for background mixes, which don't need the extra lookups
  if (light) return searchMusicSongs(await getClient(), query);
  return engine.search(query, { profile });
}

export async function relatedSongs(videoId) {
  return musicRadio(await getClient(), videoId);
}

// USB-debug hook: await window.__auraSearch.filmAlbum("leo", { languages: [] })
if (typeof window !== "undefined") window.__auraSearch = engine;

export function warmUp() {
  getClient().catch(() => {});
}
