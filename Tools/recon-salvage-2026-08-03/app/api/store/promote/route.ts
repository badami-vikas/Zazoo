import { NextResponse } from 'next/server';
import { promoteStaging } from '@/lib/store';

// Human approval: commit staged rows to the permanent store (deduped), clear staging.
export async function POST() {
  return NextResponse.json(await promoteStaging());
}
