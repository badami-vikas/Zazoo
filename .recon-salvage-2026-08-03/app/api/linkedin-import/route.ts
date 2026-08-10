// POST /api/linkedin-import
// Receives a LinkedInProfile from the Bridge Recon browser extension,
// expands it into StoreRow[] (one row per field/fact), and appends to staging.jsonl.

import { NextRequest, NextResponse } from 'next/server';
import { appendStaging, subjectKeyOf } from '../../../lib/store';
import type { StoreRow } from '../../../lib/store';
import { captureProfile } from '../../../lib/capture-rpc';

interface LinkedInExperience {
  title: string;
  company: string;
  companyType?: string;
  companyUrl?: string;
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
  education: Array<{ school: string; schoolUrl?: string; degree?: string; field?: string; years?: string }>;
  services?: string[];
  posts?: Array<{ url: string; meta?: string }>;
  extractedAt: string;
  photoUrl?: string;
  currentCompany?: string;
  currentSchool?: string;
  gated?: boolean;
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
    const body = await req.json() as { profile: LinkedInProfile; notes?: string };
    const { profile, notes } = body;

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

    // Core identity. About already carries the headline at its top (no separate Headline row).
    rows.push(row('person', 'LinkedIn URL', profile.url, profile.url));
    if (profile.location) rows.push(row('person', 'Location', profile.location));
    if (profile.photoUrl) rows.push(row('person', 'Photo', profile.photoUrl, profile.photoUrl));
    if (profile.about)    rows.push(row('person', 'About', profile.about.slice(0, 800)));
    if (notes?.trim())    rows.push(row('person', 'Notes', notes.trim().slice(0, 1000)));

    // Experience — person-scope role rows + company-scope Community rows (with page URL).
    const seenCompanies = new Set<string>();
    profile.experience.forEach((e, i) => {
      const label = i === 0 ? 'Current Role' : `Previous Role ${i}`;
      const value = [e.title, e.company, e.companyType, e.duration, e.location]
        .filter(Boolean).join(' · ');
      rows.push(row('person', label, value, e.companyUrl));
      if (e.description) rows.push(row('person', `${label} — description`, e.description.slice(0, 300)));

      // Community page: one company row per distinct employer, carrying the LinkedIn URL.
      if (e.company) {
        const key = e.company.toLowerCase();
        if (!seenCompanies.has(key)) {
          seenCompanies.add(key);
          rows.push(row('company', i === 0 ? 'Employer' : 'Past Employer', e.company, e.companyUrl));
        }
      }
    });

    // Education — person-scope row + school Community row (with page URL).
    const seenSchools = new Set<string>();
    profile.education.forEach((e) => {
      const value = [e.school, e.degree, e.field, e.years].filter(Boolean).join(' · ');
      rows.push(row('person', 'Education', value, e.schoolUrl));
      if (e.school) {
        const key = e.school.toLowerCase();
        if (!seenSchools.has(key)) {
          seenSchools.add(key);
          rows.push(row('company', 'School', e.school, e.schoolUrl));
        }
      }
    });

    // Services → tags on the Bridge person entity (batched row for staging visibility).
    if (profile.services?.length) {
      rows.push(row('person', 'Services', profile.services.slice(0, 30).join(', ')));
    }

    // Recent activity / social posts (cap 3) — link only, no post text.
    (profile.posts ?? []).slice(0, 3).forEach((p, i) => {
      if (p.url) rows.push(row('person', `Social Media Activity ${i + 1}`, p.meta || p.url, p.url));
    });

    await appendStaging(rows);

    // Materialise canonical Person + Community pages (fail-soft: the import has
    // already succeeded; a Supabase hiccup must not fail the request). Person is
    // upserted FIRST so community association (lib/communities) can link to them.
    // Single source of truth: capture_profile() upserts the person, materialises
    // company/school communities + memberships, sets current employer, and marks
    // extension_captured_at. Fail-soft — the import already succeeded into staging.
    let capture: Awaited<ReturnType<typeof captureProfile>> = { ok: false, reason: 'skipped' };
    try {
      capture = await captureProfile({
        url: profile.url,
        name: profile.name,
        about: profile.about,
        services: profile.services,
        notes: notes?.trim() || undefined,
        experience: profile.experience,
        education: profile.education,
      });
    } catch (e) {
      capture = { ok: false, reason: e instanceof Error ? e.message : 'capture failed' };
    }

    return NextResponse.json(
      { ok: true, stagingCount: rows.length, dedup_key: subjectKey, capture },
      { headers: corsHeaders() },
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500, headers: corsHeaders() },
    );
  }
}
