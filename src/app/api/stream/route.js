import { NextResponse } from 'next/server';
import { Innertube, UniversalCache } from 'youtubei.js';

export const dynamic = 'force-dynamic';

// Hot global caching for the Innertube instance
let ytInstance = null;

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

  try {
    const yt = await getInnertubeInstance();
    const info = await yt.getInfo(id);
    
    // Choose the best audio-only format (usually m4a/mp4)
    const format = info.chooseFormat({ type: 'audio', quality: 'best' });
    
    if (!format || !format.url) {
      throw new Error("No suitable audio format found");
    }
    
    // Decipher the URL if necessary
    const streamUrl = format.decipher(yt.session.player);

    // Fetch the audio stream directly from Vercel
    // This solves the 403 IP mismatch issue because Vercel's IP requests the URL
    // and Vercel's IP downloads the bytes, matching the IP lock perfectly.
    const response = await fetch(streamUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`YouTube stream returned status ${response.status}`);
    }

    // Pipe the response directly back to the client
    const headers = new Headers();
    headers.set('Content-Type', format.mime_type || 'audio/mp4');
    headers.set('Accept-Ranges', 'bytes');
    if (response.headers.has('Content-Length')) {
      headers.set('Content-Length', response.headers.get('Content-Length'));
    }

    return new NextResponse(response.body, {
      status: 200,
      headers
    });

  } catch (e) {
    console.error('[AuraSynq Stream Error]: Failed to pipe stream via Vercel.', e.message);
    
    // Fallback to proxy APIs if all else fails
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

