import { NextResponse } from 'next/server';
import { Innertube, UniversalCache } from 'youtubei.js';

export const dynamic = 'force-dynamic';

// Hot global caching for the Innertube instance
let ytInstance = null;

async function getInnertubeInstance() {
  if (!ytInstance) {
    ytInstance = await Innertube.create({
      cache: new UniversalCache(false),
      generate_session_locally: true,
      clientType: 'IOS'
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

  try {
    const yt = await getInnertubeInstance();
    
    // Download directly using the IOS client which currently bypasses the broken decipher signature!
    const stream = await yt.download(id, {
      type: 'audio',
      quality: 'best',
      client: 'IOS'
    });

    const headers = new Headers();
    headers.set('Content-Type', 'audio/mp4');
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Cache-Control', 'public, max-age=86400'); // Cache on Vercel Edge for 24 hours to reduce latency!

    return new NextResponse(stream, {
      status: 200,
      headers
    });

  } catch (e) {
    console.error('[AuraSynq Stream Error]: Failed to download via IOS client.', e.message);
    
    // Final desperate fallback if even the IOS client fails
    const fallbackUrl = `https://pipedapi.kavin.rocks/streams/${id}`;
    try {
      const pipedRes = await fetch(fallbackUrl);
      if (pipedRes.ok) {
        const data = await pipedRes.json();
        const audioStream = data.audioStreams.find(s => s.bitrate >= 128000) || data.audioStreams[0];
        if (audioStream && audioStream.url) {
          console.log('[AuraSynq Stream API]: Used Piped API fallback.');
          return NextResponse.redirect(audioStream.url);
        }
      }
    } catch(err) {
      console.error("Piped API fallback also failed", err.message);
    }

    return NextResponse.json(
      { error: 'Audio extraction completely blocked. All methods failed.' }, 
      { status: 500 }
    );
  }
}

