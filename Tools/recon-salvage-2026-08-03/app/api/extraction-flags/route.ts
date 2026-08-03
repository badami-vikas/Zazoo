// POST /api/extraction-flags
// Records an analyst flag that a specific extracted field looks wrong.
// Reuses the global flag store (data/flags.jsonl) so extraction-quality flags
// aggregate alongside every other Recon flag. We tag each with
// reason = "extraction-field:<category>" so we can later count flags PER PARSER
// category (education, experience, …) and prioritise which extractor to fix.

import { NextRequest, NextResponse } from 'next/server';
import { appendFlag, getFlags, removeFlags } from '../../../lib/flags';
import { subjectKeyOf } from '../../../lib/store';

const SOURCE = 'LinkedIn (browser)';
const REASON_PREFIX = 'extraction-field:';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

// DELETE /api/extraction-flags — UNDO an accidental flag.
export async function DELETE(req: NextRequest) {
  try {
    const body = (await req.json()) as { subjectName: string; category: string; label: string; value: string };
    if (!body?.subjectName || !body?.category) {
      return NextResponse.json({ ok: false, error: 'Missing subjectName or category' }, { status: 400, headers: corsHeaders() });
    }
    const reason = `${REASON_PREFIX}${body.category}`;
    const removed = await removeFlags({
      subjectKey: subjectKeyOf(body.subjectName),
      reason,
      label: body.label ?? body.category,
      value: (body.value ?? '').slice(0, 500),
    });
    const all = await getFlags();
    const categoryCount = all.filter((f) => f.reason === reason).length;
    return NextResponse.json({ ok: true, removed, categoryCount }, { headers: corsHeaders() });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500, headers: corsHeaders() },
    );
  }
}

interface FlagBody {
  subjectName: string;
  category: string; // parser category: education | experience | headline | location | about | post | skills | name | connections
  label: string;    // human field label shown in the popup
  value: string;    // the (possibly wrong) extracted value
  scope?: 'person' | 'company' | 'signal';
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as FlagBody;
    if (!body?.subjectName || !body?.category) {
      return NextResponse.json({ ok: false, error: 'Missing subjectName or category' }, { status: 400, headers: corsHeaders() });
    }

    const reason = `${REASON_PREFIX}${body.category}`;
    await appendFlag({
      subjectKey: subjectKeyOf(body.subjectName),
      scope: body.scope ?? 'person',
      label: body.label ?? body.category,
      value: (body.value ?? '').slice(0, 500),
      source: SOURCE,
      reason,
    });

    // Aggregate: how many flags exist for this parser category, platform-wide.
    const all = await getFlags();
    const categoryCount = all.filter((f) => f.reason === reason).length;
    const subjectCategoryCount = all.filter(
      (f) => f.reason === reason && f.subjectKey === subjectKeyOf(body.subjectName),
    ).length;

    return NextResponse.json(
      { ok: true, category: body.category, categoryCount, subjectCategoryCount, totalFlags: all.length },
      { headers: corsHeaders() },
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500, headers: corsHeaders() },
    );
  }
}

// GET /api/extraction-flags  → aggregated counts per parser category (for a "which to fix next" view).
export async function GET() {
  try {
    const all = await getFlags();
    const byCategory: Record<string, number> = {};
    for (const f of all) {
      if (!f.reason?.startsWith(REASON_PREFIX)) continue;
      const cat = f.reason.slice(REASON_PREFIX.length);
      byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    }
    return NextResponse.json({ ok: true, byCategory }, { headers: corsHeaders() });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500, headers: corsHeaders() },
    );
  }
}
