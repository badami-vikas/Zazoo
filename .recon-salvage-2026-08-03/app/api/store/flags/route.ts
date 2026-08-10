import { NextRequest, NextResponse } from 'next/server';
import { appendFlag, getFlags } from '@/lib/flags';

export async function GET() {
  return NextResponse.json(await getFlags());
}

export async function POST(req: NextRequest) {
  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { subjectKey, scope, label, value, source, reason } = body;
  if (!subjectKey || !label || !value || !source) {
    return NextResponse.json({ error: 'subjectKey, label, value, source required' }, { status: 400 });
  }
  const flag = await appendFlag({ subjectKey, scope: scope ?? 'person', label, value, source, reason });
  return NextResponse.json(flag, { status: 201 });
}
