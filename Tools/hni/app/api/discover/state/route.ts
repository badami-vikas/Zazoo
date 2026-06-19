import { NextRequest, NextResponse } from 'next/server';
import { discoverByState } from '@/lib/discovery';

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const state = req.nextUrl.searchParams.get('state') ?? 'CA';
  const results = await discoverByState(state);
  return NextResponse.json(results);
}
