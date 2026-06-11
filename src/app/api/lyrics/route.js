import { NextResponse } from 'next/server';
import { supabase, isSupabaseActive } from '@/lib/supabase';

const lyricsCache = new Map();

function cleanTitle(title) {
  if (!title) return "";
  let t = title.toLowerCase();
  
  // Remove content in brackets and parentheses completely
  t = t.replace(/\(.*?\)|\[.*?\]|\{.*?\}/g, '');
  
  // Remove common YouTube/music video terms
  const termsToRemove = [
    'official video', 'official music video', 'official audio', 
    'lyrical video', 'lyrics', 'lyrical', 'full song', 'full video',
    'hd', '4k', '8k', 'ft.', 'feat.', 'featuring', 'remix', 'cover',
    'video', 'audio', 'mv'
  ];
  
  for (const term of termsToRemove) {
    const regex = new RegExp(`\\b${term}\\b`, 'gi');
    t = t.replace(regex, '');
  }
  
  // Remove pipe and dash separators
  t = t.replace(/\|.*|-.*?$/g, '');
  
  return t.trim();
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id') || '';
  const title = searchParams.get('title') || '';
  const artist = searchParams.get('artist') || '';

  if (!title) {
    return NextResponse.json({ error: 'Missing title' }, { status: 400 });
  }

  const cleanedTitle = cleanTitle(title);
  const cacheKey = `${cleanedTitle}-${artist}`.toLowerCase();

  // 1. Check local memory cache
  const cached = lyricsCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < 7 * 24 * 60 * 60 * 1000)) {
    return NextResponse.json(cached.data);
  }

  // 2. Check Supabase DB cache if active and ID is provided
  if (isSupabaseActive && id) {
    try {
      const { data: dbData, error: dbError } = await supabase
        .from('song_cache')
        .select('lyrics')
        .eq('id', id)
        .single();
        
      if (!dbError && dbData && dbData.lyrics) {
        const payload = JSON.parse(dbData.lyrics);
        // Save to local cache
        lyricsCache.set(cacheKey, { data: payload, timestamp: Date.now() });
        return NextResponse.json(payload);
      }
    } catch (e) {
      console.warn("Supabase lyrics cache read failed", e);
    }
  }

  let lyricsPayload = null;
  const url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanedTitle)}&artist_name=${encodeURIComponent(artist)}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      lyricsPayload = {
        plainLyrics: data.plainLyrics || null,
        syncedLyrics: data.syncedLyrics || null,
        duration: data.duration || 0
      };
    }
  } catch (fetchErr) {
    if (fetchErr.name === 'TimeoutError') {
      console.warn('[AuraSynq Lyrics]: External API timed out. Falling back to null.');
    } else {
      console.warn('[AuraSynq Lyrics Fetch Error]:', fetchErr.message);
    }
  }

  if (!lyricsPayload) {
    return NextResponse.json({ error: 'No lyrics found' }, { status: 404 });
  }

  // Save to local memory cache
  lyricsCache.set(cacheKey, { data: lyricsPayload, timestamp: Date.now() });

  // Save to Supabase DB cache
  if (isSupabaseActive && id) {
    try {
      await supabase.from('song_cache').upsert({
        id,
        title,
        artist,
        url: `https://www.youtube.com/watch?v=${id}`,
        lyrics: JSON.stringify(lyricsPayload)
      });
    } catch (e) {
      console.warn("Supabase lyrics cache write failed", e);
    }
  }

  return NextResponse.json(lyricsPayload);
}
