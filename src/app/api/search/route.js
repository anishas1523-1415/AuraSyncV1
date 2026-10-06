import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';
import { supabase, isSupabaseActive } from '@/lib/supabase';

const ytSearch = require('youtube-search-api');

// Search-as-you-type, Discover, categories and Blend all share this budget; cached queries are free
const RATE_LIMIT_PER_MINUTE = 30;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const SOURCE_TIMEOUT_MS = 6000;

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
  if (useUpstash && redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return typeof cached === 'string' ? JSON.parse(cached) : cached;
      return null;
    } catch (err) {
      console.warn('Upstash Cache get failed, falling back to in-memory:', err.message);
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
    videoThumbnails: [{ url: item.thumbnail?.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg` }]
  }));
}

async function searchInvidious(instance, query) {
  const response = await fetch(`${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=video`, {
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`${instance}: HTTP ${response.status}`);
  const results = await response.json();
  if (!Array.isArray(results) || !results.length) throw new Error(`${instance}: no results`);
  return results;
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
  if (useUpstash && ratelimit) {
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
      console.warn('Upstash Rate Limiting failed, falling back to in-memory:', err.message);
      if (isRateLimitedInMemory(ip, now)) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
      }
    }
  } else if (isRateLimitedInMemory(ip, now)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    const results = await searchAllSources(query);

    if (!results || results.length === 0) {
      return NextResponse.json({ tracks: [] });
    }

    const candidateTracks = results.slice(0, 15).map(item => ({
      id: item.videoId,
      title: item.title,
      artist: item.author || 'Unknown Artist',
      cover: item.videoThumbnails?.[0]?.url || `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${item.videoId}`,
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
      const { error } = await supabase.from('song_cache').upsert(upsertData, { onConflict: 'id' });
      if (error) console.warn("Supabase song_cache upsert failed:", error.message);
    }

    // 3. Save to Query Cache
    if (useUpstash && redis) {
      try {
        // Cache for 24 hours (86400 seconds)
        await redis.set(cacheKey, candidateTracks, { ex: 24 * 60 * 60 });
      } catch (err) {
        console.warn('Upstash Cache set failed, falling back to in-memory:', err.message);
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
