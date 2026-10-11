"use client";
// On-device streaming for the Android app: the phone resolves and downloads each song from
// YouTube itself, with no server in between (works on any network the phone can reach YouTube
// from). Loaded lazily, only inside the native app.
import { Innertube, Platform, YT, YTNodes, Utils, UniversalCache } from "youtubei-web/web";
import { nativeFetch, nativeFetchBytes, isNativeApp } from "./nativeHttp";
import { createPoTokenMinter } from "./poToken";

// youtubei.js emits a self-contained decipher script that must be evaluated as-is
Platform.load({ ...Platform.shim, eval: (data) => new Function(data.output)() });

// WEB only returns SABR streams (no URLs); TV_SIMPLY reliably returns plain URLs
const CLIENTS = ["TV_SIMPLY", "WEB", "MWEB", "ANDROID_VR"];
const AUDIO_ITAG = 140; // AAC 128 kbps, plays in every WebView
const CHUNK_BYTES = 1024 * 1024; // larger chunks get throttled by YouTube
const FIRST_CHUNK_BYTES = 256 * 1024; // ~16s of audio: enough to start playing right away
const PARALLEL_CHUNKS = 4; // a typical 3-5 MB song downloads in one round
const SLOW_LINK_PARALLEL = 2; // on a slow link more parallel chunks only delay the next one needed
const SLOW_LINK_BYTES_PER_SEC = 400 * 1024;
const CHUNK_RETRIES = 2; // per chunk, for flaky mobile connections
const MAX_CACHED_SONGS = 4;
const LOCATION_TTL_MS = 3 * 60 * 60 * 1000; // stream URLs expire after ~6 h
const LOCATE_TIMEOUT_MS = 40000; // BotGuard + lookup; past this, fail instead of "Streaming..." forever
const MAX_LOCATIONS = 40;
const POST_BODY = "eAA="; // protobuf {15: 0}, what YouTube's own player sends
const GOOGLEVIDEO_HEADERS = {
  accept: "*/*",
  origin: "https://www.youtube.com",
  referer: "https://www.youtube.com/",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
};

export const isOnDeviceSupported = isNativeApp;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Recent failures, readable over USB debugging: window.__auraOnDevice.errors
const recentErrors = [];
function noteError(videoId, stage, err) {
  recentErrors.unshift({ at: new Date().toISOString(), videoId, stage, message: String(err?.message || err) });
  recentErrors.length = Math.min(recentErrors.length, 30);
}

// ─── Session: Innertube client + PO token minter ─────────────

let session = null;
let sessionPromise = null;

async function createSession() {
  const bootstrap = await Innertube.create({
    fetch: nativeFetch,
    retrieve_player: false,
    enable_session_cache: false,
    user_agent: navigator.userAgent,
  });
  const visitorData = bootstrap.session.context.client.visitorData;
  if (!visitorData) throw new Error("YouTube returned no visitor data");

  const { minter, expiresAt } = await createPoTokenMinter(bootstrap);
  const sessionPoToken = await minter.mintAsWebsafeString(visitorData);
  const yt = await Innertube.create({
    fetch: nativeFetch,
    po_token: sessionPoToken,
    visitor_data: visitorData,
    generate_session_locally: true,
    enable_session_cache: false,
    cache: new UniversalCache(false),
    user_agent: navigator.userAgent,
  });
  return { yt, minter, expiresAt };
}

// YouTube rejected something tied to the session (PO token, visitor data): start a new one
function resetSession() {
  session = null;
}

export function getSession() {
  if (session && session.expiresAt > Date.now()) return Promise.resolve(session);
  if (!sessionPromise) {
    sessionPromise = createSession()
      .then((created) => { session = created; return created; })
      .finally(() => { sessionPromise = null; });
  }
  return sessionPromise;
}

// ─── Resolve a song to a deciphered audio URL ────────────────

async function lookUp(videoId) {
  const { yt, minter } = await getSession();
  const contentPoToken = await minter.mintAsWebsafeString(videoId);

  const callWatch = (client) => new YTNodes.NavigationEndpoint({
    watchEndpoint: { videoId, racyCheckOk: true, contentCheckOk: true },
  }).call(yt.actions, {
    playbackContext: {
      contentPlaybackContext: {
        vis: 0,
        splay: false,
        lactMilliseconds: "-1",
        signatureTimestamp: yt.session.player?.signature_timestamp,
      },
    },
    serviceIntegrityDimensions: { poToken: contentPoToken },
    client,
  });

  // Clients differ in what they'll serve (e.g. one may demand a login), so try each in turn
  let response = null;
  let lastReason = "No YouTube client returned stream URLs";
  for (const client of CLIENTS) {
    const candidate = await callWatch(client).catch((err) => ({ error: err }));
    if (candidate.error) {
      lastReason = candidate.error.message;
      continue;
    }
    const playability = candidate.data.playabilityStatus;
    const first = candidate.data.streamingData?.adaptiveFormats?.[0];
    if (playability?.status === "OK" && (first?.url || first?.signatureCipher)) {
      response = candidate;
      break;
    }
    if (playability?.status && playability.status !== "OK") {
      lastReason = playability.reason || `Video unavailable (${playability.status})`;
    }
  }
  if (!response) throw new Error(lastReason);

  const info = new YT.VideoInfo([response], yt.actions, Utils.generateRandomString(16));
  if (info.basic_info?.is_live) throw new Error("Live streams can't be played as songs");
  const formats = info.streaming_data?.adaptive_formats || [];
  const format = formats.find((f) => f.itag === AUDIO_ITAG)
    || formats.filter((f) => f.has_audio && !f.has_video && f.mime_type?.startsWith("audio/mp4"))
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
  if (!format) throw new Error("No playable audio format");

  let url = await format.decipher(yt.session.player);
  url = url.includes("alr=yes") ? url.replace("alr=yes", "alr=no") : `${url}&alr=no`;
  // 0 when YouTube doesn't state it; the download then reads chunks until the end
  const size = Number(new URL(url).searchParams.get("clen")) || Number(format.content_length) || 0;
  const durationSec = Number(format.approx_duration_ms) / 1000 || Number(info.basic_info?.duration) || 0;
  return {
    url,
    size,
    durationSec,
    // Full type with codecs, which MediaSource needs (e.g. audio/mp4; codecs="mp4a.40.2")
    codecType: format.mime_type || 'audio/mp4; codecs="mp4a.40.2"',
    mimeType: (format.mime_type || "audio/mp4").split(";")[0],
  };
}

const isLiveError = (err) => /live stream/i.test(err?.message || "");

// One retry with a brand-new session: most failures are an expired or rejected token
async function resolveAudio(videoId) {
  try {
    return await lookUp(videoId);
  } catch (err) {
    if (isLiveError(err)) throw err;
    noteError(videoId, "lookup", err);
    console.warn("AuraSynq on-device: lookup failed, retrying with a new session", err);
    resetSession();
    return lookUp(videoId);
  }
}

const refusedError = (message) => Object.assign(new Error(message), { refused: true });

// The stream URL with googlevideo's redirects already followed (a POST body doesn't survive a
// redirect), so playback can go straight to downloading
async function locate(videoId) {
  for (let attempt = 0; ; attempt++) {
    const resolved = await resolveAudio(videoId);
    const head = await nativeFetchBytes(resolved.url, { method: "HEAD", headers: GOOGLEVIDEO_HEADERS });
    if (head.status !== 403) return { ...resolved, url: head.url || resolved.url };
    if (attempt > 0) throw refusedError("YouTube refused the stream (403)");
    resetSession();
  }
}

const locations = new Map(); // videoId -> { at, promise }

function getLocation(videoId) {
  const hit = locations.get(videoId);
  if (hit && Date.now() - hit.at < LOCATION_TTL_MS) return hit.promise;
  const promise = Promise.race([
    locate(videoId),
    sleep(LOCATE_TIMEOUT_MS).then(() => { throw new Error("Looking the song up took too long"); }),
  ]);
  locations.set(videoId, { at: Date.now(), promise });
  promise.catch(() => {
    if (locations.get(videoId)?.promise === promise) locations.delete(videoId);
  });
  while (locations.size > MAX_LOCATIONS) locations.delete(locations.keys().next().value);
  return promise;
}

// ─── Download: POST + `range=` query parameter, in chunks ───

// Byte ranges for a song; the first one is small so playback can start almost immediately
function planRanges(size) {
  const ranges = [[0, Math.min(FIRST_CHUNK_BYTES, size) - 1]];
  for (let start = FIRST_CHUNK_BYTES; start < size; start += CHUNK_BYTES) {
    ranges.push([start, Math.min(start + CHUNK_BYTES, size) - 1]);
  }
  return ranges;
}

// Downloads a located song, handing each chunk to `onChunk` in order as soon as it (and every
// chunk before it) has arrived. Resolves to the complete file.
async function downloadAudio({ url, size, mimeType }, onChunk = () => {}) {
  const deliver = (bytes) => {
    try { onChunk(bytes); } catch (err) { console.warn("AuraSynq on-device: chunk consumer failed", err); }
  };

  // null = past the end of the file (only asked for when the size is unknown)
  const fetchChunk = async (from, to) => {
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await nativeFetchBytes(`${url}&range=${from}-${to}`, {
          method: "POST",
          headers: GOOGLEVIDEO_HEADERS,
          bodyBase64: POST_BODY,
        });
      } catch (err) {
        res = { status: 0, error: err };
      }
      if (res.status === 200 && res.bytes) return res.bytes;
      if (res.status === 416) return null;
      const reason = res.status ? `HTTP ${res.status}` : res.error?.message || "network error";
      if (res.status === 403) throw refusedError(`YouTube refused bytes ${from}-${to} (403)`);
      if (attempt >= CHUNK_RETRIES) throw new Error(`Bytes ${from}-${to} failed: ${reason}`);
      await sleep(400 * (attempt + 1));
    }
  };

  if (!size) {
    // Size not stated: read sequentially until a short chunk marks the end (capped at ~40 MB)
    const parts = [];
    for (let index = 0; index < 40; index++) {
      const bytes = await fetchChunk(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES - 1);
      if (!bytes) {
        if (index > 0) break;
        throw new Error("The stream is empty");
      }
      parts.push(bytes);
      deliver(bytes);
      if (bytes.length < CHUNK_BYTES) break;
    }
    return new Blob(parts, { type: mimeType });
  }

  const ranges = planRanges(size);
  const parts = new Array(ranges.length);

  // The first chunk gets the connection to itself: it is what starts playback
  const started = Date.now();
  parts[0] = await fetchChunk(...ranges[0]);
  if (!parts[0]) throw new Error("The stream is empty");
  deliver(parts[0]);
  const bytesPerSec = parts[0].length / Math.max(0.05, (Date.now() - started) / 1000);
  const parallel = bytesPerSec < SLOW_LINK_BYTES_PER_SEC ? SLOW_LINK_PARALLEL : PARALLEL_CHUNKS;

  let nextIndex = 1;
  let nextToDeliver = 1;
  const deliverReady = () => {
    while (nextToDeliver < parts.length && parts[nextToDeliver]) {
      deliver(parts[nextToDeliver]);
      nextToDeliver++;
    }
  };
  const worker = async () => {
    while (nextIndex < ranges.length) {
      const index = nextIndex++;
      const bytes = await fetchChunk(...ranges[index]);
      if (!bytes) throw new Error(`Chunk ${index} is past the end of the stream`);
      parts[index] = bytes;
      deliverReady();
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, ranges.length - 1) }, worker));
  return new Blob(parts, { type: mimeType });
}

// ─── Public API: songs with a small in-memory cache ─────────

const songs = new Map(); // videoId -> Promise<Blob> (finished or still downloading)

const remember = (videoId, pending) => {
  pending.catch((err) => {
    noteError(videoId, "download", err);
    if (songs.get(videoId) === pending) songs.delete(videoId);
    locations.delete(videoId);
    if (err?.refused) resetSession();
  });
  songs.set(videoId, pending);
  while (songs.size > MAX_CACHED_SONGS) songs.delete(songs.keys().next().value);
  return pending;
};

// A song that is already downloaded or downloading (prefetched or played before), else null
export function peekTrack(videoId) {
  const known = songs.get(videoId);
  if (!known) return null;
  songs.delete(videoId); // refresh LRU position
  songs.set(videoId, known);
  return known;
}

export function forgetTrack(videoId) {
  songs.delete(videoId);
  locations.delete(videoId);
}

export function getTrackBlob(videoId) {
  return peekTrack(videoId) || remember(videoId, getLocation(videoId).then((located) => downloadAudio(located)));
}

// Progressive playback: `onReady({ codecType, durationSec, size })` once the song is located,
// then `onChunk(bytes)` in order. Resolves to the whole file, kept for replays and offline caching.
export function streamTrack(videoId, { onReady, onChunk } = {}) {
  return remember(videoId, getLocation(videoId).then((located) => {
    onReady?.({ codecType: located.codecType, durationSec: located.durationSec, size: located.size });
    return downloadAudio(located, onChunk);
  }));
}

// Download a song that will probably play next, so the skip is instant
export function prefetchTrack(videoId) {
  getTrackBlob(videoId).catch(() => {});
}

// Look songs up without downloading them (a few KB each), so tapping one starts streaming at once
export function preResolve(videoIds) {
  videoIds.slice(0, 4).forEach((videoId, i) => {
    if (songs.has(videoId) || locations.has(videoId)) return;
    setTimeout(() => getLocation(videoId).catch(() => {}), i * 250);
  });
}

// Start BotGuard early (it takes a second or two) so the first tap is faster
export function warmUp() {
  getSession().catch((err) => console.warn("AuraSynq on-device: session warm-up failed", err));
}

// Diagnostics from a USB-debug session: await window.__auraOnDevice.testProgressive("yKNxeF4KMsY")
if (typeof window !== "undefined") {
  window.__auraOnDevice = {
    getSession,
    resolveAudio,
    preResolve,
    errors: recentErrors,
    async test(videoId) {
      const started = Date.now();
      const blob = await getTrackBlob(videoId);
      return { bytes: blob.size, type: blob.type, ms: Date.now() - started };
    },
    async testProgressive(videoId) {
      const preLocated = locations.has(videoId);
      songs.delete(videoId);
      const started = Date.now();
      let readyMs = 0;
      let firstChunkMs = 0;
      let chunks = 0;
      const blob = await streamTrack(videoId, {
        onReady: () => { readyMs = Date.now() - started; },
        onChunk: () => { chunks++; if (!firstChunkMs) firstChunkMs = Date.now() - started; },
      });
      return { preLocated, readyMs, firstChunkMs, chunks, totalMs: Date.now() - started, bytes: blob.size };
    },
  };
}
