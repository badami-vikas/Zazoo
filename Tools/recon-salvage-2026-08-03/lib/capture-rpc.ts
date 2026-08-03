// Calls the Supabase `capture_profile(jsonb)` function — the single source of truth
// for landing a captured LinkedIn profile: upserts people_canonical, materialises
// company/school communities + memberships, sets current employer, and marks
// extension_captured_at. Used by /api/linkedin-import (manual + auto-capture).

import { createClient } from '@supabase/supabase-js';
import { dedupKey } from './communities';

export interface CaptureProfileInput {
  url: string;
  name: string;
  about?: string;          // already has the headline prepended by the extractor
  services?: string[];
  notes?: string;
  experience?: Array<{ title?: string; company?: string; companyUrl?: string }>;
  education?: Array<{ school?: string; schoolUrl?: string; degree?: string; field?: string; years?: string }>;
}

export interface CaptureRpcResult { ok: boolean; id?: string; reason?: string }

export async function captureProfile(p: CaptureProfileInput): Promise<CaptureRpcResult> {
  if (!p?.name || !p?.url) return { ok: false, reason: 'missing-name-or-url' };

  const supabaseUrl = process.env.SUPABASE_URL, supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) return { ok: false, reason: 'no-supabase-key' };
  const supabase = createClient(supabaseUrl, supabaseKey);

  // `about` already carries the headline at its top, so pass headline empty to
  // avoid the function doubling it.
  const payload = {
    linkedin_url: p.url,
    dedup_key: dedupKey(p.name),
    name: p.name,
    headline: '',
    about: p.about ?? '',
    services: p.services ?? [],
    experience: (p.experience ?? []).map((e) => ({ title: e.title, company: e.company, companyUrl: e.companyUrl })),
    education: (p.education ?? []).map((e) => ({ school: e.school, schoolUrl: e.schoolUrl, degree: e.degree, field: e.field, years: e.years })),
  };

  const { data, error } = await supabase.rpc('capture_profile', { p: payload });
  if (error) return { ok: false, reason: error.message };

  const id = data as string | null;
  if (id && p.notes?.trim()) {
    await supabase.from('people_canonical').update({ notes: p.notes.trim().slice(0, 1000) }).eq('id', id);
  }
  return { ok: true, id: id ?? undefined };
}
