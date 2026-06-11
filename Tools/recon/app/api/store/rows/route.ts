import { NextResponse } from 'next/server';
import { getStagingWithLinks } from '@/lib/store';

// Staging rows with entity link overrides applied — used by the staging viewer UI.
export async function GET() {
  return NextResponse.json(await getStagingWithLinks());
}
