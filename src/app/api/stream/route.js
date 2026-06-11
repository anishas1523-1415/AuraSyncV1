import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'Missing track ID' }, { status: 400 });
  }

  // A highly stable array of Invidious instances to bypass YouTube blocks.
  const invidiousInstances = [
    'https://vid.puffyan.us',
    'https://invidious.fdn.fr',
    'https://invidious.perennialte.ch',
    'https://yewtu.be'
  ];

  for (const instance of invidiousInstances) {
    try {
      // 4-second timeout per instance to keep the app fast
      const url = `${instance}/api/v1/videos/${id}?fields=adaptiveFormats`;
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      
      if (res.ok) {
        const data = await res.json();
        
        if (data.adaptiveFormats && data.adaptiveFormats.length > 0) {
          // Filter out video, keep only pure audio streams
          const audioStreams = data.adaptiveFormats.filter(stream => 
            stream.type && stream.type.startsWith('audio')
          );
          
          if (audioStreams.length > 0) {
            // Pick the stream with the highest bitrate for best quality
            const bestAudio = audioStreams.reduce((prev, current) => 
              (parseInt(prev.bitrate) > parseInt(current.bitrate)) ? prev : current
            );
            
            // Redirect the user's browser straight to the hidden audio file
            return NextResponse.redirect(bestAudio.url);
          }
        }
      }
    } catch (err) {
      console.warn(`[AuraSynq Fallback]: ${instance} failed or timed out. Trying next...`);
    }
  }

  return NextResponse.json(
    { error: 'Audio extraction failed. All decentralized nodes are currently blocked.' }, 
    { status: 500 }
  );
}
