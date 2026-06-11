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
    const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');
    
    if (!audioFormats || audioFormats.length === 0) {
      return NextResponse.json({ error: 'No audio formats found' }, { status: 404 });
    }

    const bestFormat = audioFormats.find(f => f.container === 'mp4') || audioFormats[0];
    return NextResponse.json({ url: bestFormat.url });
  } catch (error) {
    console.error('Streaming API Error:', error.message);
    return NextResponse.json({ error: 'Video unavailable or streaming failed' }, { status: 404 });
  }
}
