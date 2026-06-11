import { NextResponse } from 'next/server';
import ytdl from '@distube/ytdl-core';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'Missing video ID' }, { status: 400 });
  }

  try {
    const info = await ytdl.getInfo(id);
    // Find the best audio-only format
    const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');
    
    if (!audioFormats || audioFormats.length === 0) {
      return NextResponse.json({ error: 'No audio formats found' }, { status: 404 });
    }

    // Prefer m4a/mp4 formats for best iOS/Safari compatibility
    const bestFormat = audioFormats.find(f => f.container === 'mp4') || audioFormats[0];

    // Return the direct streaming URL
    // Note: If IP binding causes 403 on client, consider returning an Invidious proxy URL as fallback
    return NextResponse.json({ url: bestFormat.url });
  } catch (error) {
    console.error('Streaming API Error:', error);
    
    // Graceful fallback to a public Invidious instance proxy
    const fallbackUrl = `https://vid.puffyan.us/latest_version?id=${id}&itag=140`;
    return NextResponse.json({ url: fallbackUrl });
  }
}
