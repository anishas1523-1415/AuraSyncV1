import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'Missing track ID' }, { status: 400 });
  }

  try {
    // Utilize the Cobalt API Engine - Highly resilient against YouTube datacenter blocks
    const response = await fetch('https://api.cobalt.tools/api/json', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: `https://www.youtube.com/watch?v=${id}`,
        isAudioOnly: true,
        aFormat: 'mp3' // Force standard audio format for maximum browser compatibility
      }),
      // 6-second timeout to prevent the serverless function from hanging
      signal: AbortSignal.timeout(6000) 
    });

    if (!response.ok) {
      throw new Error(`Cobalt extraction rejected: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data && data.url) {
      // Instantly redirect the frontend <audio> tag to the unblocked media stream
      return NextResponse.redirect(data.url);
    }
    
    throw new Error('No audio stream URL returned by Cobalt layer');

  } catch (err) {
    console.error('[AuraSynq Stream Error]:', err.message);
    return NextResponse.json(
      { error: 'Audio extraction blocked by YouTube anti-bot systems.' }, 
      { status: 500 }
    );
  }
}
