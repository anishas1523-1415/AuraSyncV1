"use client";
// YouTube Music lookups on the phone (search and radio), straight from YouTube like playback.
// Needs no PO token, so it doesn't wait for BotGuard.
import { Innertube, UniversalCache } from "youtubei-web/web";
import { nativeFetch } from "./nativeHttp";
import { searchMusicSongs, musicRadio } from "../musicTracks";

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

export async function searchSongs(query) {
  return searchMusicSongs(await getClient(), query);
}

export async function relatedSongs(videoId) {
  return musicRadio(await getClient(), videoId);
}
