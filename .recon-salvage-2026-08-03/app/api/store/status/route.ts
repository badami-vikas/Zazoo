import { NextResponse } from 'next/server';
import { storeStatus } from '@/lib/store';

// Current staging / permanent counts (the UI polls this on load and after writes).
export async function GET() {
  return NextResponse.json(await storeStatus());
}
