import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'Missing track ID' }, { status: 400 });
  }

  // Bypass ytdl-core entirely. Use decentralized Piped API instances.
  // We use an array of them so if one is down, it instantly tries the next.
  const proxyInstances = [
    `https://pipedapi.kavin.rocks/streams/${id}`,
    `https://pipedapi.tokhmi.xyz/streams/${id}`,
    `https://api.piped.projectsegfau.lt/streams/${id}`
  ];

  for (const proxyUrl of proxyInstances) {
    try {
      // 4-second timeout to prevent serverless hanging
      const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(4000) }); 
      
      if (res.ok) {
        const data = await res.json();
        const audioStreams = data.audioStreams;
        
        if (audioStreams && audioStreams.length > 0) {
          // Find the highest quality audio stream and redirect the client to it
          const bestAudio = audioStreams.reduce((prev, current) => 
            (prev.bitrate > current.bitrate) ? prev : current
          );
          
          return NextResponse.redirect(bestAudio.url);
        }
      }
    } catch (err) {
      console.warn(`[AuraSynq Proxy Skip]: ${proxyUrl} failed or timed out.`);
      // Continue to the next proxy in the loop
    }
  }

  return NextResponse.json(
    { error: 'All audio proxy layers blocked or timed out.' }, 
    { status: 500 }
  );
}
