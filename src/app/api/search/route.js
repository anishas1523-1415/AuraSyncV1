import { NextResponse } from 'next/server';
const ytSearch = require('youtube-search-api');
const fetch = globalThis.fetch || (url => import('node-fetch').then(m => m.default(url)));

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query) {
    return NextResponse.json({ error: 'Query parameter "q" is required' }, { status: 400 });
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

    // Use YouTube oEmbed endpoint to validate embeddability. If oEmbed returns
    // 200, the video is publicly embeddable; otherwise skip it.
    const filtered = [];
    await Promise.all(candidateTracks.map(async (t) => {
      try {
        const oembedUrl = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(t.url)}`;
        const res = await fetch(oembedUrl, { method: 'GET' });
        if (res.ok) {
          filtered.push(t);
        }
      } catch (e) {
        // ignore non-embeddable or network errors for individual items
      }
    }));

    return NextResponse.json({ tracks: filtered });
  } catch (error) {
    console.error('Search Error:', error);
    return NextResponse.json({ error: 'Failed to fetch tracks' }, { status: 500 });
  }
}
