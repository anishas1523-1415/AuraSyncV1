import { NextResponse } from 'next/server';
import { supabase, isSupabaseActive } from '@/lib/supabase';

const lyricsCache = new Map();
const LRCLIB = 'https://lrclib.net/api';
const LRCLIB_HEADERS = { 'User-Agent': 'AuraSynq (https://github.com/aurasynq)' };

// Common YouTube/music video terms
const NOISE_TERMS = [
  'official video', 'official music video', 'official audio', 'official lyric video',
  'lyric video', 'lyrical video', 'lyrics', 'lyrical', 'full song', 'full video',
  'video song', 'audio song', 'hd', '4k', '8k', 'remastered', 'video', 'audio', 'mv'
];

function stripNoise(text) {
  let t = text.toLowerCase();

  // Remove content in brackets and parentheses completely
  t = t.replace(/\(.*?\)|\[.*?\]|\{.*?\}/g, ' ');

  // Featured artists are rarely part of the track name in lyrics databases
  t = t.replace(/\b(ft|feat|featuring)\b\.?.*$/i, ' ');

  for (const term of NOISE_TERMS) {
    t = t.replace(new RegExp(`\\b${term}\\b`, 'gi'), ' ');
  }
  return t.replace(/[@#"“”]/g, '').replace(/\s+/g, ' ').trim();
}

// YouTube channel names: "ColdplayVEVO", "Coldplay - Topic", "Coldplay Official"
function cleanArtist(artist) {
  return (artist || '')
    .replace(/\s*-\s*topic$/i, '')
    .replace(/vevo$/i, '')
    .replace(/\b(official|music|records)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Builds lookup candidates. "Artist - Song" titles used to lose the song name entirely
// (the old `-.*?$` regex kept "Artist"), which made lyrics miss for most music videos.
function buildCandidates(rawTitle, rawArtist) {
  const channel = cleanArtist(rawArtist);
  const primary = (rawTitle || '').split('|')[0];
  const parts = primary.split(/\s+[-–—]\s+/);
  const candidates = [];

  if (parts.length >= 2) {
    const left = stripNoise(parts[0]);
    const right = stripNoise(parts.slice(1).join(' '));
    if (right) candidates.push({ track: right, artist: left || channel });
    if (left) candidates.push({ track: left, artist: right || channel });
  }
  const whole = stripNoise(primary);
  if (whole) candidates.push({ track: whole, artist: channel });

  return candidates.filter(c => c.track);
}

const toPayload = (data) => ({
  plainLyrics: data.plainLyrics || null,
  syncedLyrics: data.syncedLyrics || null,
  duration: data.duration || 0
});

async function lrclibGet({ track, artist }, signal) {
  if (!artist) return null;
  const url = `${LRCLIB}/get?track_name=${encodeURIComponent(track)}&artist_name=${encodeURIComponent(artist)}`;
  const res = await fetch(url, { signal, headers: LRCLIB_HEADERS });
  if (!res.ok) return null;
  const data = await res.json();
  return data.syncedLyrics || data.plainLyrics ? toPayload(data) : null;
}

async function lrclibSearch({ track, artist }, signal) {
  const params = artist
    ? `track_name=${encodeURIComponent(track)}&artist_name=${encodeURIComponent(artist)}`
    : `q=${encodeURIComponent(track)}`;
  const res = await fetch(`${LRCLIB}/search?${params}`, { signal, headers: LRCLIB_HEADERS });
  if (!res.ok) return null;
  const results = await res.json();
  if (!Array.isArray(results)) return null;
  // Prefer time-synced lyrics, then any lyrics at all
  const best = results.find(r => r.syncedLyrics) || results.find(r => r.plainLyrics);
  return best ? toPayload(best) : null;
}

async function findLyrics(title, artist) {
  const signal = AbortSignal.timeout(8000);
  const candidates = buildCandidates(title, artist);

  // Exact matches first (cheap and precise), then fuzzy search
  for (const candidate of candidates) {
    const exact = await lrclibGet(candidate, signal);
    if (exact) return exact;
  }
  for (const candidate of candidates) {
    const fuzzy = await lrclibSearch(candidate, signal);
    if (fuzzy) return fuzzy;
  }
  if (candidates[0]) {
    return lrclibSearch({ track: `${candidates[0].track} ${candidates[0].artist || ''}`.trim() }, signal);
  }
  return null;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id') || '';
  const title = searchParams.get('title') || '';
  const artist = searchParams.get('artist') || '';

  if (!title) {
    return NextResponse.json({ error: 'Missing title' }, { status: 400 });
  }

  const cacheKey = `${title}-${artist}`.toLowerCase();

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
        .maybeSingle();

      if (!dbError && dbData && dbData.lyrics) {
        const payload = JSON.parse(dbData.lyrics);
        lyricsCache.set(cacheKey, { data: payload, timestamp: Date.now() });
        return NextResponse.json(payload);
      }
    } catch (e) {
      console.warn("Supabase lyrics cache read failed", e);
    }
  }

  let lyricsPayload = null;
  try {
    lyricsPayload = await findLyrics(title, artist);
  } catch (fetchErr) {
    if (fetchErr.name === 'TimeoutError') {
      console.warn('[AuraSynq Lyrics]: External API timed out. Falling back to null.');
    } else {
      console.warn('[AuraSynq Lyrics Fetch Error]:', fetchErr.message);
    }
  }

  if (!lyricsPayload) {
    return NextResponse.json({ plainLyrics: null, syncedLyrics: null }, { status: 200 });
  }

  // Save to local memory cache
  lyricsCache.set(cacheKey, { data: lyricsPayload, timestamp: Date.now() });

  // Save to Supabase DB cache
  if (isSupabaseActive && id) {
    const { error } = await supabase.from('song_cache').upsert({
      id,
      title,
      artist,
      url: `https://www.youtube.com/watch?v=${id}`,
      lyrics: JSON.stringify(lyricsPayload)
    });
    if (error) console.warn("Supabase lyrics cache write failed", error.message);
  }

  return NextResponse.json(lyricsPayload);
}
