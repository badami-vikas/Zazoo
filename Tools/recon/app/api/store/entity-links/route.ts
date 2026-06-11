import { NextResponse } from 'next/server';
import { getEntityLinks, recordEntityLink } from '@/lib/store';
import type { EntityLink } from '@/lib/store';

export async function GET() {
  return NextResponse.json(await getEntityLinks());
}

export async function POST(req: Request) {
  const body = await req.json() as Partial<EntityLink>;
  if (!Array.isArray(body.rowIds) || body.rowIds.length < 2) {
    return NextResponse.json({ error: 'rowIds must be an array of ≥ 2 row IDs' }, { status: 400 });
  }
  if (!body.entityId?.trim()) {
    return NextResponse.json({ error: 'entityId is required' }, { status: 400 });
  }
  const link: EntityLink = {
    id: `el-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    rowIds: body.rowIds,
    entityId: body.entityId.trim().toLowerCase().replace(/\s+/g, '-'),
    entityLabel: body.entityLabel?.trim() || body.entityId.trim(),
    analystId: body.analystId?.trim() || 'analyst',
    createdAt: new Date().toISOString(),
  };
  await recordEntityLink(link);
  return NextResponse.json(link, { status: 201 });
}
