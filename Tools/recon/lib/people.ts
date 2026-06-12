// Person materialiser — upserts a LinkedIn-extension profile into people_canonical
// (global, dedup_key). Mirrors scripts/enrich-linkedin.ts mapReportToPeople, but
// maps directly from the extension's LinkedInProfile shape.
//
// Runs on every /api/linkedin-import save so the person exists canonically and
// community association (lib/communities.ts) can link to them.

import { createClient } from '@supabase/supabase-js';
import { dedupKey } from './communities';

export interface PersonProfileInput {
  name: string;
  url: string;
  headline?: string;
  location?: string;
  about?: string;
  services?: string[];   // → people_canonical.services (tags)
  notes?: string;        // → people_canonical.notes (shown below the name)
  currentCompany?: string;
  experience?: Array<{ title?: string; company?: string }>;
}

export interface PersonUpsertResult {
  ok: boolean;
  id?: string;
  reason?: string; // 'no-supabase-key' | 'no-name' | error message
}

/** Split "Melville, New York, United States" → { city, country }. */
function splitLocation(loc?: string): { city: string | null; country: string | null } {
  if (!loc) return { city: null, country: null };
  const parts = loc.split(',').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return { city: null, country: null };
  return { city: parts[0] ?? null, country: parts.length > 1 ? parts[parts.length - 1] : null };
}

export async function upsertPersonCanonical(p: PersonProfileInput): Promise<PersonUpsertResult> {
  if (!p?.name) return { ok: false, reason: 'no-name' };

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) return { ok: false, reason: 'no-supabase-key' };

  const supabase = createClient(supabaseUrl, supabaseKey);
  const now = new Date().toISOString();
  const { city, country } = splitLocation(p.location);
  const currentTitle = p.experience?.[0]?.title || p.headline || null;
  const currentCompany = p.currentCompany || p.experience?.[0]?.company || null;

  const row = {
    full_name: p.name,
    current_title: currentTitle,
    current_company_name: currentCompany,
    bio: p.about?.slice(0, 2000) || null,   // about already has the headline at its top
    linkedin_url: p.url,
    location_city: city,
    location_country: country,
    services: p.services?.length ? p.services.slice(0, 30) : null,
    notes: p.notes?.slice(0, 1000) || null,
    extension_captured_at: now,   // marks the person done in the auto-capture queue
    recon_run_at: now,
    enrichment_source: 'linkedin_import',
    last_enriched_at: now,
    enrichment_confidence: 0.95,
    dedup_key: dedupKey(p.name),
  };

  const { data, error } = await supabase
    .from('people_canonical')
    .upsert(row, { onConflict: 'dedup_key' })
    .select('id')
    .single();

  if (error) return { ok: false, reason: error.message };
  return { ok: true, id: data!.id as string };
}
