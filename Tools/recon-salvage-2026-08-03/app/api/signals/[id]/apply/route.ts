import { NextResponse } from 'next/server';
import { applySignal, dismissSignal } from '@/lib/signals';

// POST /api/signals/:id/apply        — execute the approved signal (privileged, service key).
// POST /api/signals/:id/apply?dismiss — mark dismissed without applying.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const dismiss = new URL(req.url).searchParams.has('dismiss');
  const res = dismiss ? await dismissSignal(id) : await applySignal(id);
  return NextResponse.json(res, { status: res.ok ? 200 : 500 });
}
