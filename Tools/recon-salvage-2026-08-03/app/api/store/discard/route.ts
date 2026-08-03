import { NextResponse } from 'next/server';
import { discardStaging } from '@/lib/store';

// Human rejection: clear staging without committing anything to permanent.
export async function POST() {
  return NextResponse.json(await discardStaging());
}
