import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';
import { supabase, isSupabaseActive } from '@/lib/supabase';

const ytSearch = require('youtube-search-api');

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
      limiter: Ratelimit.slidingWindow(10, '60 s'),
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
    if (now - value.timestamp > 24 * 60 * 60 * 1000) searchCache.delete(key);
  }
  for (const [ip, data] of rateLimitMap.entries()) {
    if (now - data.timestamp > 60 * 1000) rateLimitMap.delete(ip);
  }
}, 60 * 60 * 1000);

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown';
  const now = Date.now();
  
  // 1. Rate Limiting
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
      console.warn('Upstash Rate Limiting failed, falling back to in-memory:', err);
      // Fallback to in-memory rate limiting
      if (ip !== 'unknown') {
        const userLimit = rateLimitMap.get(ip) || { count: 0, timestamp: now };
        if (now - userLimit.timestamp > 60 * 1000) {
          userLimit.count = 1;
          userLimit.timestamp = now;
        } else {
          userLimit.count++;
          if (userLimit.count > 10) {
            return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
          }
        }
        rateLimitMap.set(ip, userLimit);
      }
    }
  } else {
    // In-memory rate limiting fallback
    if (ip !== 'unknown') {
      const userLimit = rateLimitMap.get(ip) || { count: 0, timestamp: now };
      if (now - userLimit.timestamp > 60 * 1000) {
        userLimit.count = 1;
        userLimit.timestamp = now;
      } else {
        userLimit.count++;
        if (userLimit.count > 10) {
          return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
        }
      }
      rateLimitMap.set(ip, userLimit);
    }
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query) {
    return NextResponse.json({ error: 'Query parameter "q" is required' }, { status: 400 });
  }
  
  const queryClean = query.toLowerCase().trim();
  const cacheKey = `search:${queryClean}`;

  // 2. Check Cache
  if (useUpstash && redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const tracks = typeof cached === 'string' ? JSON.parse(cached) : cached;
        return NextResponse.json({ tracks });
      }
    } catch (err) {
      console.warn('Upstash Cache get failed, falling back to in-memory:', err);
      if (searchCache.has(queryClean)) {
        const cachedData = searchCache.get(queryClean);
        if (now - cachedData.timestamp < 24 * 60 * 60 * 1000) {
          return NextResponse.json({ tracks: cachedData.tracks });
        }
      }
    }
  } else {
    // In-memory cache check fallback
    if (searchCache.has(queryClean)) {
      const cachedData = searchCache.get(queryClean);
      if (now - cachedData.timestamp < 24 * 60 * 60 * 1000) {
        return NextResponse.json({ tracks: cachedData.tracks });
      }
    }
  }

  try {
    const instances = [
      "https://vid.puffyan.us",
      "https://invidious.jing.rocks",
      "https://yt.artemislena.eu"
    ];
    
    let results = [];
    for (const instance of instances) {
      try {
        const response = await fetch(`${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=video`, {
          signal: AbortSignal.timeout(5000)
        });
        if (response.ok) {
          results = await response.json();
          break;
        }
      } catch (err) {
        console.warn(`Invidious instance ${instance} failed:`, err);
      }
    }

    if (!results || results.length === 0) {
      // Fallback to youtube-search-api as a last resort, in case all instances are down
      const fallbackResults = await ytSearch.GetListByKeyword(query, false, 15, [{type: 'video'}]);
      if (fallbackResults && fallbackResults.items) {
        results = fallbackResults.items.map(item => ({
          videoId: item.id,
          title: item.title,
          author: item.channelTitle || 'Unknown Artist',
          videoThumbnails: [{ url: item.thumbnail?.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg` }]
        }));
      }
    }

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
      try {
        const upsertData = candidateTracks.map(t => ({
          id: t.id,
          title: t.title,
          artist: t.artist,
          cover: t.cover,
          url: t.url,
        }));
        await supabase.from('song_cache').upsert(upsertData, { onConflict: 'id' });
      } catch (e) {
        console.warn("Supabase song_cache upsert failed:", e);
      }
    }

    // 3. Save to Query Cache
    if (useUpstash && redis) {
      try {
        // Cache for 24 hours (86400 seconds)
        await redis.set(cacheKey, candidateTracks, { ex: 24 * 60 * 60 });
      } catch (err) {
        console.warn('Upstash Cache set failed, falling back to in-memory:', err);
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
