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
    // Use local scraper (youtube-search-api) directly for near-instant results
    const results = await ytSearch.GetListByKeyword(query, false, 15, [{type: 'video'}]);
    
    if (!results || !results.items) {
      return NextResponse.json({ tracks: [] });
    }

    // Convert to track objects and then filter out videos that are not embeddable
    const candidateTracks = results.items.map(item => ({
      id: item.id,
      title: item.title,
      artist: item.channelTitle || 'Unknown Artist',
      cover: item.thumbnail?.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${item.id}`,
      mood: "energetic",
      hue: Math.floor(Math.random() * 360)
    }));

    // Save to cache
    searchCache.set(queryKey, { tracks: candidateTracks, timestamp: now });

    // Return candidate tracks directly to prevent blocking the search response with multiple external API calls
    return NextResponse.json({ tracks: candidateTracks });
  } catch (error) {
    console.error('Search Error:', error);
    return NextResponse.json({ error: 'Failed to fetch tracks' }, { status: 500 });
  }
}
