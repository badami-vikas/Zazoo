import { NextRequest, NextResponse } from 'next/server';
import { resolveIdentities, type ReconInput } from '@/lib/recon';

// Phase 1 of the internal API: take whatever the caller knows (name ± email,
// company, domain, github, state) and return ranked candidate identities for the
// human to verify before any deep background check runs.
export async function POST(req: NextRequest) {
  let body: ReconInput;
  try {
    body = (await req.json()) as ReconInput;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.name && !body.company) {
    return NextResponse.json({ error: 'Provide at least a name or a company.' }, { status: 400 });
  }

  try {
    const { candidates, steps } = await resolveIdentities(body);
    return NextResponse.json({ input: body, candidates, steps });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'resolve failed' }, { status: 502 });
  }
}
