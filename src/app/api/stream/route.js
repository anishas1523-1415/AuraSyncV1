import { NextResponse } from 'next/server';
import ytdl from '@distube/ytdl-core';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'Missing track ID' }, { status: 400 });
  }

  try {
    // Utilize @distube/ytdl-core for direct, reliable extraction.
    // If this fails on Vercel with "Sign in to confirm you're not a bot",
    // you must change your Vercel Serverless Region to Europe (fra1 or lhr1) to bypass the US datacenter block.
    const info = await ytdl.getInfo(id);
    
    const format = ytdl.chooseFormat(info.formats, { 
      quality: 'highestaudio', 
      filter: 'audioonly' 
    });

    if (format && format.url) {
      // Redirect the client browser directly to the googlevideo stream.
      return NextResponse.redirect(format.url);
    }
    
    throw new Error('No valid audio formats found');

  } catch (error) {
    console.error('[AuraSynq Stream Error]:', error.message);
    
    // Fallback array of Invidious instances if ytdl-core hits a captcha wall
    const proxyInstances = [
      'https://invidious.weblibre.org',
      'https://vid.puffyan.us',
      'https://invidious.perennialte.ch'
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
              return NextResponse.redirect(bestAudio.url);
            }
          }
        }
      } catch (err) {
        console.warn(`[Fallback] ${instance} failed.`);
      }
    }

    return NextResponse.json(
      { error: 'Audio extraction blocked by host provider. Change Vercel Region to fra1.' }, 
      { status: 500 }
    );
  }
}
