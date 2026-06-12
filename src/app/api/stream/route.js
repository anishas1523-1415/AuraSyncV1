import { NextResponse } from 'next/server';
import { Innertube, UniversalCache } from 'youtubei.js';

export const dynamic = 'force-dynamic';

// Hot global caching to eliminate setup delays and YouTube rate limits.
// These variables persist in memory across serverless invocations on Vercel.
let ytInstance = null;
const streamCache = new Map(); // trackId -> { url, expires }

async function getInnertubeInstance() {
  if (!ytInstance) {
    ytInstance = await Innertube.create({
      cache: new UniversalCache(false),
      generate_session_locally: true
    });
  }
  return ytInstance;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'Missing track ID' }, { status: 400 });
  }

  // 1. Hot Memory Cache Check (Instant redirect under 5ms if recently requested)
  const cachedStream = streamCache.get(id);
  if (cachedStream && cachedStream.expires > Date.now()) {
    console.log(`[AuraSynq Stream API]: Serving cached stream URL for track: ${id}`);
    return NextResponse.redirect(cachedStream.url);
  }

  try {
    // 2. Primary Engine: youtubei.js (Using shared instance to save ~2 seconds of setup overhead)
    const yt = await getInnertubeInstance();
    const info = await yt.getBasicInfo(id);
    const format = info.chooseFormat({ type: 'audio', quality: 'best' });

    if (format && format.url) {
      // YouTube stream URLs generally last 6 hours. We cache for 4 hours to be safe.
      const expires = Date.now() + 4 * 60 * 60 * 1000;
      streamCache.set(id, { url: format.url, expires });
      console.log(`[AuraSynq Stream API]: Extracted and cached stream URL for track: ${id}`);
      return NextResponse.redirect(format.url);
    }
    
    throw new Error('No valid audio formats found via Innertube');

  } catch (error) {
    console.warn('[AuraSynq Stream Warning]: youtubei.js failed, shifting to active Invidious array...', error.message);
    
    // Reset instance if it somehow got corrupted/expired session
    ytInstance = null;

    // Ultimate Fallback Array: Freshly verified active instances
    const proxyInstances = [
      'https://inv.thepixora.com',
      'https://inv.nadeko.net',
      'https://invidious.f5.si',
      'https://invidious.nerdvpn.de',
      'https://yt.chocolatemoo53.com',
      'https://vid.puffyan.us'
    ];

    for (const instance of proxyInstances) {
      try {
        const url = `${instance}/api/v1/videos/${id}?fields=adaptiveFormats`;
        const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
        
        if (res.ok) {
          const data = await res.json();
          if (data.adaptiveFormats && data.adaptiveFormats.length > 0) {
            const audioStreams = data.adaptiveFormats.filter(stream => stream.type && stream.type.startsWith('audio'));
            if (audioStreams.length > 0) {
              const bestAudio = audioStreams.reduce((prev, current) => (parseInt(prev.bitrate) > parseInt(current.bitrate)) ? prev : current);
              if (bestAudio && bestAudio.url) {
                // Cache fallback URLs as well (though they might expire or get blocked faster)
                const expires = Date.now() + 2 * 60 * 60 * 1000; // Cache for 2 hours
                streamCache.set(id, { url: bestAudio.url, expires });
                return NextResponse.redirect(bestAudio.url);
              }
            }
          }
        }
      } catch (err) {
        console.warn(`[Fallback] ${instance} timeout/fail.`);
      }
    }

    // If EVERYTHING fails (extremely rare with youtubei.js + 6 active proxy nodes)
    return NextResponse.json(
      { error: 'Audio extraction completely blocked. Vercel IP ban active across all engines.' }, 
      { status: 500 }
    );
  }
}
