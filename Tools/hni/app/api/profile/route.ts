import { NextRequest, NextResponse } from 'next/server';
import { buildProfile } from '@/lib/hni';
import type { HNIInput } from '@/lib/hni';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as HNIInput;
    if (!body?.name?.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    const profile = await buildProfile({ ...body, name: body.name.trim() });
    return NextResponse.json(profile);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
