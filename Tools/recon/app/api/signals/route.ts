import { NextRequest, NextResponse } from 'next/server';
import { listSignals, syncReconGates, type SignalStatus } from '@/lib/signals';

// GET /api/signals?status=new — list signals (also readable directly by the
// Bridge frontend via the public SELECT policy; this is the recon-side mirror).
export async function GET(req: NextRequest) {
  try {
    const status = req.nextUrl.searchParams.get('status') as SignalStatus | null;
    return NextResponse.json({ signals: await listSignals(status ?? undefined) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'list failed' }, { status: 500 });
  }
}

// POST /api/signals — recompute recon gates and publish/refresh their signals.
export async function POST() {
  try {
    return NextResponse.json(await syncReconGates());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'sync failed' }, { status: 500 });
  }
}
