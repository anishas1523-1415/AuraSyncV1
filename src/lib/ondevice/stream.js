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
const PARALLEL_CHUNKS = 4; // a typical 3-5 MB song downloads in one round
const MAX_CACHED_SONGS = 4;
const POST_BODY = "eAA="; // protobuf {15: 0}, what YouTube's own player sends
const GOOGLEVIDEO_HEADERS = {
  accept: "*/*",
  origin: "https://www.youtube.com",
  referer: "https://www.youtube.com/",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
};

export const isOnDeviceSupported = isNativeApp;

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

async function resolveAudio(videoId) {
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
  return { url, size, mimeType: (format.mime_type || "audio/mp4").split(";")[0] };
}

// ─── Download: POST + `range=` query parameter, in parallel chunks ───

async function downloadAudio({ url, size, mimeType }) {
  // Follow googlevideo's redirects once (POST bodies don't survive redirects)
  const head = await nativeFetchBytes(url, { method: "HEAD", headers: GOOGLEVIDEO_HEADERS });
  if (head.status === 403) throw new Error("YouTube refused the stream (403)");
  const finalUrl = head.url || url;
  const fetchChunk = (from, to) => nativeFetchBytes(`${finalUrl}&range=${from}-${to}`, {
    method: "POST",
    headers: GOOGLEVIDEO_HEADERS,
    bodyBase64: POST_BODY,
  });

  if (!size) {
    // Size not stated: read sequentially until a short chunk marks the end (capped at ~40 MB)
    const parts = [];
    for (let index = 0; index < 40; index++) {
      const res = await fetchChunk(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES - 1);
      if (res.status !== 200 || !res.bytes) {
        if (index > 0 && res.status === 416) break; // asked past the end
        throw new Error(`Chunk ${index} failed with HTTP ${res.status}`);
      }
      parts.push(res.bytes);
      if (res.bytes.length < CHUNK_BYTES) break;
    }
    return new Blob(parts, { type: mimeType });
  }

  const ranges = [];
  for (let start = 0; start < size; start += CHUNK_BYTES) {
    ranges.push([start, Math.min(start + CHUNK_BYTES, size) - 1]);
  }
  const parts = new Array(ranges.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < ranges.length) {
      const index = nextIndex++;
      const [from, to] = ranges[index];
      let attempt = 0;
      for (;;) {
        const res = await fetchChunk(from, to);
        if (res.status === 200 && res.bytes) {
          parts[index] = res.bytes;
          break;
        }
        // One retry per chunk for flaky mobile connections; 403 means the token was rejected
        if (res.status === 403 || ++attempt > 1) {
          throw new Error(`Chunk ${index} failed with HTTP ${res.status}`);
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL_CHUNKS, ranges.length) }, worker));
  return new Blob(parts, { type: mimeType });
}

// ─── Public API: song blobs with a small in-memory cache ─────

const songs = new Map(); // videoId -> Promise<Blob>

export function getTrackBlob(videoId) {
  if (songs.has(videoId)) {
    const cached = songs.get(videoId);
    songs.delete(videoId); // refresh LRU position
    songs.set(videoId, cached);
    return cached;
  }
  const pending = resolveAudio(videoId).then(downloadAudio);
  pending.catch(() => songs.delete(videoId));
  songs.set(videoId, pending);
  while (songs.size > MAX_CACHED_SONGS) songs.delete(songs.keys().next().value);
  return pending;
}

// Download a song that will probably play next, so the skip is instant
export function prefetchTrack(videoId) {
  getTrackBlob(videoId).catch(() => {});
}

// Start BotGuard early (it takes a second or two) so the first tap is faster
export function warmUp() {
  getSession().catch((err) => console.warn("AuraSynq on-device: session warm-up failed", err));
}

// Diagnostics from a USB-debug session: await window.__auraOnDevice.test("yKNxeF4KMsY")
if (typeof window !== "undefined") {
  window.__auraOnDevice = {
    getSession,
    resolveAudio,
    async test(videoId) {
      const started = Date.now();
      const blob = await getTrackBlob(videoId);
      return { bytes: blob.size, type: blob.type, ms: Date.now() - started };
    },
  };
}
