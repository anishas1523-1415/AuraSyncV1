import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';
import { supabase, isSupabaseActive } from '@/lib/supabase';

const ytSearch = require('youtube-search-api');

// Search-as-you-type, Discover, categories and Blend all share this budget; cached queries are free
const RATE_LIMIT_PER_MINUTE = 30;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const SOURCE_TIMEOUT_MS = 6000;

// Upstash's client retries 5 times with backoff by default (~4s per call). When the database is
// unreachable that added ~13s to every search, so fail fast and skip it for a while instead.
const UPSTASH_TIMEOUT_MS = 1500;
const UPSTASH_COOLDOWN_MS = 5 * 60 * 1000;
const SUPABASE_TIMEOUT_MS = 1500;
let upstashDownUntil = 0;

// Lists should be songs: hour-long mixes and live streams load slowly and aren't what a
// category or a song search wants, unless the query explicitly asks for them.
const MAX_SONG_SECONDS = 15 * 60;
const LONG_FORM_QUERY = /\b(mix|mixes|jukebox|non ?stop|hours?|hrs?|full album|playlist|live|medley|mashup)\b/i;

// "4:13" / "1:01:33" -> seconds (0 when unknown)
const parseDuration = (text) => {
  const parts = String(text || '').split(':').map(Number);
  if (!text || parts.some(Number.isNaN)) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
};

const INVIDIOUS_INSTANCES = [
  "https://vid.puffyan.us",
  "https://invidious.jing.rocks",
  "https://yt.artemislena.eu"
];

// Check if Upstash env variables are provided
const useUpstash = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

let redis = null;
let ratelimit = null;

if (useUpstash) {
  try {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
      retry: false,
      signal: () => AbortSignal.timeout(UPSTASH_TIMEOUT_MS),
    });

    ratelimit = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(RATE_LIMIT_PER_MINUTE, '60 s'),
      analytics: true,
      prefix: '@upstash/ratelimit/aurasynq',
    });
  } catch (err) {
    console.error('Failed to initialize Upstash Redis/Ratelimit:', err);
  }
}

// Simple in-memory cache and rate limiter (fallback for local development/single-instance deployments)
const searchCache = new Map();
const rateLimitMap = new Map();

// Clear in-memory cache entries older than 24 hours every hour
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of searchCache.entries()) {
    if (now - value.timestamp > CACHE_TTL_MS) searchCache.delete(key);
  }
  for (const [ip, data] of rateLimitMap.entries()) {
    if (now - data.timestamp > 60 * 1000) rateLimitMap.delete(ip);
  }
}, 60 * 60 * 1000);

const upstashAvailable = () => useUpstash && !!redis && Date.now() > upstashDownUntil;

function markUpstashDown(operation, err) {
  upstashDownUntil = Date.now() + UPSTASH_COOLDOWN_MS;
  console.warn(`Upstash ${operation} failed (${err.message}); using in-memory cache and rate limits for 5 min`);
}

// x-forwarded-for is "client, proxy1, proxy2"; only the first entry identifies the user
const getClientIp = (request) =>
  request.headers.get('x-forwarded-for')?.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';

function isRateLimitedInMemory(ip, now) {
  if (ip === 'unknown') return false;
  const userLimit = rateLimitMap.get(ip) || { count: 0, timestamp: now };
  if (now - userLimit.timestamp > 60 * 1000) {
    userLimit.count = 1;
    userLimit.timestamp = now;
  } else {
    userLimit.count++;
  }
  rateLimitMap.set(ip, userLimit);
  return userLimit.count > RATE_LIMIT_PER_MINUTE;
}

async function getCachedTracks(cacheKey, queryClean, now) {
  if (upstashAvailable()) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return typeof cached === 'string' ? JSON.parse(cached) : cached;
      return null;
    } catch (err) {
      markUpstashDown('cache get', err);
    }
  }
  const cachedData = searchCache.get(queryClean);
  if (cachedData && now - cachedData.timestamp < CACHE_TTL_MS) return cachedData.tracks;
  return null;
}

async function searchYouTube(query) {
  const fallbackResults = await ytSearch.GetListByKeyword(query, false, 15, [{ type: 'video' }]);
  const items = (fallbackResults?.items || []).filter(item => item.id && item.type !== 'channel');
  if (!items.length) throw new Error('youtube-search-api: no results');
  return items.map(item => ({
    videoId: item.id,
    title: item.title,
    author: item.channelTitle || 'Unknown Artist',
    videoThumbnails: [{ url: item.thumbnail?.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg` }],
    durationSeconds: parseDuration(item.length?.simpleText),
    isLive: !!item.isLive
  }));
}

async function searchInvidious(instance, query) {
  const response = await fetch(`${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=video`, {
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`${instance}: HTTP ${response.status}`);
  const results = await response.json();
  if (!Array.isArray(results) || !results.length) throw new Error(`${instance}: no results`);
  return results.map(item => ({ ...item, durationSeconds: item.lengthSeconds || 0, isLive: !!item.liveNow }));
}

// Race every source: the first non-empty answer wins, so dead mirrors no longer add their timeouts
async function searchAllSources(query) {
  const withTimeout = (promise) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), SOURCE_TIMEOUT_MS))
  ]);
  try {
    return await Promise.any([
      withTimeout(searchYouTube(query)),
      ...INVIDIOUS_INSTANCES.map(instance => searchInvidious(instance, query))
    ]);
  } catch (err) {
    console.warn('All search sources failed:', err.errors?.map(e => e.message).join(' | ') || err.message);
    return [];
  }
}

const MIN_SONG_RESULTS = 5;
const MAX_FALLBACK_SECONDS = 60 * 60;

// No duration almost always means a live stream (24/7 "lofi beats" channels), which the search
// library doesn't always flag as live; those can't be played as songs.
const isSong = (item) => !item.isLive && item.durationSeconds > 0 && item.durationSeconds <= MAX_SONG_SECONDS;
const isPlayableLong = (item) => !item.isLive && item.durationSeconds > 0 && item.durationSeconds <= MAX_FALLBACK_SECONDS;

// Prefer individual songs. Mood searches ("lofi", "sleep") mostly return streams and hour-long
// compilations, so when too few songs remain, search again for songs, then allow up to an hour.
async function selectSongs(query, allResults) {
  if (LONG_FORM_QUERY.test(query)) return allResults;

  let songs = allResults.filter(isSong);
  const addNew = (items, keep) => {
    const seen = new Set(songs.map(song => song.videoId));
    songs = songs.concat(items.filter(item => keep(item) && !seen.has(item.videoId)));
  };

  if (songs.length < MIN_SONG_RESULTS && !/\bsongs?\b/i.test(query)) {
    addNew(await searchAllSources(`${query} songs`), isSong);
  }
  if (songs.length < MIN_SONG_RESULTS) {
    addNew(allResults, isPlayableLong);
  }
  return songs;
}

export async function GET(request) {
  const ip = getClientIp(request);
  const now = Date.now();

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query) {
    return NextResponse.json({ error: 'Query parameter "q" is required' }, { status: 400 });
  }

  const queryClean = query.toLowerCase().trim().slice(0, 200);
  const cacheKey = `search:${queryClean}`;

  // 1. Cache hits are served before rate limiting; they cost nothing upstream
  const cachedTracks = await getCachedTracks(cacheKey, queryClean, now);
  if (cachedTracks) {
    return NextResponse.json({ tracks: cachedTracks });
  }

  // 2. Rate Limiting
  if (upstashAvailable() && ratelimit) {
    try {
      const { success, limit, reset, remaining } = await ratelimit.limit(ip);
      if (!success) {
        return NextResponse.json(
          { error: 'Too many requests' },
          {
            status: 429,
            headers: {
              'X-RateLimit-Limit': limit.toString(),
              'X-RateLimit-Remaining': remaining.toString(),
              'X-RateLimit-Reset': reset.toString(),
            },
          }
        );
      }
    } catch (err) {
      markUpstashDown('rate limit', err);
      if (isRateLimitedInMemory(ip, now)) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
      }
    }
  } else if (isRateLimitedInMemory(ip, now)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    const results = await selectSongs(query, await searchAllSources(query));

    if (!results || results.length === 0) {
      return NextResponse.json({ tracks: [] });
    }

    const candidateTracks = results.slice(0, 15).map(item => ({
      id: item.videoId,
      title: item.title,
      artist: item.author || 'Unknown Artist',
      cover: item.videoThumbnails?.[0]?.url || `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${item.videoId}`,
      duration: item.durationSeconds || 0,
      mood: "energetic",
      hue: Math.floor(Math.random() * 360)
    }));

    // Cache metadata into Supabase song_cache for each track found
    if (isSupabaseActive) {
      const upsertData = candidateTracks.map(t => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        cover: t.cover,
        url: t.url,
      }));
      const { error } = await supabase
        .from('song_cache')
        .upsert(upsertData, { onConflict: 'id' })
        .abortSignal(AbortSignal.timeout(SUPABASE_TIMEOUT_MS));
      if (error) console.warn("Supabase song_cache upsert failed:", error.message);
    }

    // 3. Save to Query Cache
    if (upstashAvailable()) {
      try {
        // Cache for 24 hours (86400 seconds)
        await redis.set(cacheKey, candidateTracks, { ex: 24 * 60 * 60 });
      } catch (err) {
        markUpstashDown('cache set', err);
        searchCache.set(queryClean, { tracks: candidateTracks, timestamp: now });
      }
    } else {
      searchCache.set(queryClean, { tracks: candidateTracks, timestamp: now });
    }

    return NextResponse.json({ tracks: candidateTracks });
  } catch (error) {
    console.error('Search Error:', error);
    return NextResponse.json({ error: 'Failed to fetch tracks' }, { status: 500 });
  }
}
