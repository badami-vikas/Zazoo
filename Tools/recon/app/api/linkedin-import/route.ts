// POST /api/linkedin-import
// Receives a LinkedInProfile from the Bridge Recon browser extension,
// expands it into StoreRow[] (one row per field/fact), and appends to staging.jsonl.

import { NextRequest, NextResponse } from 'next/server';
import { appendStaging, subjectKeyOf } from '../../../lib/store';
import type { StoreRow } from '../../../lib/store';

interface LinkedInExperience {
  title: string;
  company: string;
  companyType?: string;
  duration: string;
  location?: string;
  description?: string;
}

interface LinkedInProfile {
  url: string;
  handle: string;
  name: string;
  headline: string;
  location: string;
  about: string;
  experience: LinkedInExperience[];
  education: Array<{ school: string; degree?: string; field?: string; years?: string }>;
  skills: string[];
  extractedAt: string;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { profile: LinkedInProfile };
    const { profile } = body;

    if (!profile?.name || !profile?.url) {
      return NextResponse.json({ ok: false, error: 'Missing name or url' }, { status: 400, headers: corsHeaders() });
    }

    const subjectKey = subjectKeyOf(profile.name);
    const reportId = `linkedin-ext-${subjectKey}-${Date.now()}`;
    const eid = subjectKey;
    const discoveredAt = profile.extractedAt;
    const SOURCE = 'LinkedIn (browser)';
    const CONF = 0.95;

    let seq = 0;
    const row = (scope: StoreRow['scope'], label: string, value: string, url?: string): StoreRow => ({
      id: `${reportId}-${++seq}`,
      reportId,
      subjectName: profile.name,
      subjectKey,
      subjectKind: 'person',
      scope,
      label,
      value,
      tier: 'A',
      source: SOURCE,
      url,
      discoveredAt,
      eid,
      confidence: CONF,
      verificationState: 'probable',
    });

    const rows: StoreRow[] = [];

    // Core identity
    rows.push(row('person', 'LinkedIn URL', profile.url, profile.url));
    if (profile.headline) rows.push(row('person', 'Headline', profile.headline));
    if (profile.location) rows.push(row('person', 'Location', profile.location));
    if (profile.about)    rows.push(row('person', 'About', profile.about.slice(0, 500)));

    // Experience
    profile.experience.forEach((e, i) => {
      const label = i === 0 ? 'Current Role' : `Previous Role ${i}`;
      const value = [e.title, e.company, e.companyType, e.duration, e.location]
        .filter(Boolean).join(' · ');
      rows.push(row('person', label, value));
      if (e.description) rows.push(row('person', `${label} — description`, e.description.slice(0, 300)));
    });

    // Education
    profile.education.forEach((e) => {
      const value = [e.school, e.degree, e.field, e.years].filter(Boolean).join(' · ');
      rows.push(row('person', 'Education', value));
    });

    // Skills (batch into one row to avoid row explosion)
    if (profile.skills.length) {
      rows.push(row('person', 'Skills', profile.skills.slice(0, 30).join(', ')));
    }

    // Company row from latest experience
    const latest = profile.experience[0];
    if (latest?.company) {
      rows.push(row('company', 'Employer', latest.company));
    }

    await appendStaging(rows);

    return NextResponse.json(
      { ok: true, stagingCount: rows.length, dedup_key: subjectKey },
      { headers: corsHeaders() },
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500, headers: corsHeaders() },
    );
  }
}
