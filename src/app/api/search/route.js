import { NextResponse } from 'next/server';
const ytSearch = require('youtube-search-api');

// Simple in-memory cache and rate limiter (for single-instance deployments)
const searchCache = new Map();
const rateLimitMap = new Map();

// Clear cache entries older than 24 hours every hour
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
  // Basic IP Rate Limiting (max 30 requests per minute per IP)
  const ip = request.headers.get('x-forwarded-for') || 'unknown';
  const now = Date.now();
  
  if (ip !== 'unknown') {
    const userLimit = rateLimitMap.get(ip) || { count: 0, timestamp: now };
    if (now - userLimit.timestamp > 60 * 1000) {
      userLimit.count = 1;
      userLimit.timestamp = now;
    } else {
      userLimit.count++;
      if (userLimit.count > 30) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
      }
    }
    rateLimitMap.set(ip, userLimit);
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query) {
    return NextResponse.json({ error: 'Query parameter "q" is required' }, { status: 400 });
  }
  
  const queryKey = query.toLowerCase().trim();

  // Check cache
  if (searchCache.has(queryKey)) {
    const cachedData = searchCache.get(queryKey);
    if (now - cachedData.timestamp < 24 * 60 * 60 * 1000) {
      return NextResponse.json({ tracks: cachedData.tracks });
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
      const ytSearch = require('youtube-search-api');
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

    // Save to cache
    searchCache.set(queryKey, { tracks: candidateTracks, timestamp: now });

    return NextResponse.json({ tracks: candidateTracks });
  } catch (error) {
    console.error('Search Error:', error);
    return NextResponse.json({ error: 'Failed to fetch tracks' }, { status: 500 });
  }
}
