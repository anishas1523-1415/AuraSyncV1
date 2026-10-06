import { NextResponse } from 'next/server';
import { Innertube, Platform, UniversalCache } from 'youtubei.js';

export const dynamic = 'force-dynamic';
// Deciphering needs `new Function`, which the edge runtime forbids
export const runtime = 'nodejs';
export const maxDuration = 60;

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

// Clients verified to return playable audio/mp4 without a login. Raced in parallel, first one wins.
const CLIENTS = ['IOS', 'MWEB'];

// Refresh resolved URLs a few minutes before YouTube expires them
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;
const MAX_CACHED_URLS = 500;

// youtubei.js emits a self-contained script (it declares its own globals and ends with
// `return process(...)`), so it must be evaluated as-is without injecting parameters.
Platform.load({
  ...Platform.shim,
  eval: (data) => new Function(data.output)()
});

// Hot global caching for the Innertube instance
let ytPromise = null;

function getInnertubeInstance() {
  if (!ytPromise) {
    ytPromise = Innertube.create({
      cache: new UniversalCache(false),
      generate_session_locally: true
    }).catch((err) => {
      ytPromise = null;
      throw err;
    });
  }
  return ytPromise;
}

// Resolved googlevideo URLs keyed by video id. They are signed for THIS server's IP
// (`ip` is in sparams), which is why the audio is proxied instead of redirected.
const urlCache = new Map();
const inflightResolves = new Map();

function expiryOf(url) {
  const expire = Number(new URL(url).searchParams.get('expire'));
  return expire ? expire * 1000 : Date.now() + 60 * 60 * 1000;
}

async function resolveAudio(id, { fresh = false } = {}) {
  const cached = urlCache.get(id);
  if (!fresh && cached && cached.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return cached;
  if (inflightResolves.has(id)) return inflightResolves.get(id);

  const pending = (async () => {
    const yt = await getInnertubeInstance();
    const format = await Promise.any(CLIENTS.map(async (client) => {
      const f = await yt.getStreamingData(id, { type: 'audio', quality: 'best', client });
      if (!f?.url) throw new Error(`${client}: no audio URL`);
      return f;
    })).catch((err) => {
      const reasons = err.errors?.map(e => e.message).join(' | ') || err.message;
      throw new Error(`All clients failed: ${reasons}`);
    });

    const entry = {
      url: format.url,
      mimeType: format.mime_type?.split(';')[0] || 'audio/mp4',
      expiresAt: expiryOf(format.url)
    };
    urlCache.delete(id);
    urlCache.set(id, entry);
    if (urlCache.size > MAX_CACHED_URLS) urlCache.delete(urlCache.keys().next().value);
    return entry;
  })().finally(() => inflightResolves.delete(id));

  inflightResolves.set(id, pending);
  return pending;
}

const PASSTHROUGH_HEADERS = ['content-type', 'content-length', 'content-range', 'last-modified'];

async function proxyAudio(entry, request) {
  const clientRange = request.headers.get('range');
  const upstream = await fetch(entry.url, {
    headers: { Range: clientRange || 'bytes=0-' },
    signal: request.signal,
    cache: 'no-store'
  });

  if (upstream.status !== 200 && upstream.status !== 206) {
    upstream.body?.cancel().catch(() => {});
    const err = new Error(`Upstream responded ${upstream.status}`);
    err.status = upstream.status;
    throw err;
  }

  const headers = new Headers();
  for (const name of PASSTHROUGH_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has('content-type')) headers.set('content-type', entry.mimeType);
  headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', 'private, max-age=3600');

  // A request without Range gets a complete 200 so the Cache API can store it for offline play
  // (cache.put rejects 206 responses).
  if (!clientRange) {
    headers.delete('content-range');
    return new Response(upstream.body, { status: 200, headers });
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

async function pipedFallback(id) {
  const res = await fetch(`https://pipedapi.kavin.rocks/streams/${id}`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return null;
  const data = await res.json();
  const streams = Array.isArray(data?.audioStreams) ? data.audioStreams : [];
  const audioStream = streams.find(s => s.bitrate >= 128000) || streams[0];
  return audioStream?.url || null;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id || !VIDEO_ID.test(id)) {
    return NextResponse.json({ error: 'Missing or invalid track ID' }, { status: 400 });
  }

  // Optional self-hosted Invidious (with its PO-token helper). `local=true` makes the instance
  // proxy the audio itself, so the redirect is not IP-locked and supports seeking.
  const invidiousBase = process.env.AURASYNQ_INVIDIOUS_URL?.replace(/\/+$/, '');
  if (invidiousBase) {
    if (searchParams.has('warm')) return new Response(null, { status: 204 });
    return NextResponse.redirect(`${invidiousBase}/latest_version?id=${id}&itag=140&local=true`);
  }

  // Prefetch mode: resolve and cache the URL so the next track starts instantly
  if (searchParams.has('warm')) {
    try {
      await resolveAudio(id);
      return new Response(null, { status: 204 });
    } catch (e) {
      return NextResponse.json({ error: 'Warm-up failed' }, { status: 502 });
    }
  }

  try {
    try {
      return await proxyAudio(await resolveAudio(id), request);
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      // A cached URL can go stale early (403/410): resolve a fresh one and retry once
      console.warn(`[AuraSynq Stream]: retrying ${id} with a fresh URL (${e.message})`);
      return await proxyAudio(await resolveAudio(id, { fresh: true }), request);
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      return new Response(null, { status: 499 });
    }
    console.error('[AuraSynq Stream Error]: Failed to resolve audio stream.', e.message);

    // Final fallback: Piped proxies its own streams, so a redirect is safe here
    try {
      const pipedUrl = await pipedFallback(id);
      if (pipedUrl) {
        console.log('[AuraSynq Stream API]: Used Piped API fallback.');
        return NextResponse.redirect(pipedUrl);
      }
    } catch (err) {
      console.error('Piped API fallback also failed', err.message);
    }

    return NextResponse.json(
      { error: 'Audio extraction completely blocked. All methods failed.' },
      { status: 502 }
    );
  }
}
