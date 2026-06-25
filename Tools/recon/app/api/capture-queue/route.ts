// GET  /api/capture-queue?limit=N  → next pending profiles (cap + breaker enforced)
// POST /api/capture-queue           → record a tick's results { results: [...] }
//
// The extension's background scheduler polls this; recon owns pacing/safety.

import { NextRequest, NextResponse } from 'next/server';
import {
  getQueue,
  recordResults,
  recordConnectResults,
  type CaptureResult,
  type ConnectResult,
  type QueueAction,
} from '../../../lib/capture';

function parseAction(raw: string | null | undefined): QueueAction {
  return raw === 'connect' ? 'connect' : 'capture';
}

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors() });
}

export async function GET(req: NextRequest) {
  try {
    const limit = Number(req.nextUrl.searchParams.get('limit') ?? '1');
    const action = parseAction(req.nextUrl.searchParams.get('action'));
    const q = await getQueue(Number.isFinite(limit) ? limit : 1, action);
    return NextResponse.json(q, { headers: cors() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500, headers: cors() });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { action?: string; results?: CaptureResult[] | ConnectResult[] };
    const results = Array.isArray(body?.results) ? body.results : [];

    // Connect result-report path: write connect_sent_at for terminal outcomes only.
    if (parseAction(body?.action) === 'connect') {
      const connect = await recordConnectResults(results as ConnectResult[]);
      return NextResponse.json({ ok: true, connect }, { headers: cors() });
    }

    const state = await recordResults(results as CaptureResult[]);
    return NextResponse.json({ ok: true, state }, { headers: cors() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500, headers: cors() });
  }
}
