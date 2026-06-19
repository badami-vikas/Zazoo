import { NextRequest, NextResponse } from 'next/server';
import { discoverByCause } from '@/lib/discovery';

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const ntee = req.nextUrl.searchParams.get('ntee') ?? 'T';
  const state = req.nextUrl.searchParams.get('state') ?? undefined;
  const results = await discoverByCause(ntee, state || undefined);
  return NextResponse.json(results);
}
