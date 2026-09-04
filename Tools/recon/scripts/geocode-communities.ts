/**
 * geocode-communities.ts
 *
 * Fills in headquarters_lat, headquarters_lng, and location_display for every
 * row in communities_canonical that is missing geo data.
 *
 * Resolution strategy per community (first hit wins):
 *   1. If headquarters_city is already set → Nominatim text geocode of "city, country"
 *   2. Wikidata HQ resolution by org name → P159 (HQ location) → P625 (coordinates)
 *   3. Nominatim text geocode of "<name> headquarters" (last resort)
 *
 * Ordering: communities with the most associated people are processed first so
 * the highest-value rows get coordinates even if the run is interrupted.
 *
 * Usage:
 *   npx tsx scripts/geocode-communities.ts
 *
 * Required env (in tools/recon/.env.local):
 *   SUPABASE_URL          – https://<ref>.supabase.co
 *   SUPABASE_SERVICE_KEY  – service_role key (bypasses RLS)
 *
 * Optional:
 *   GEOCODE_CONCURRENCY   – parallel workers (default: 3)
 */

import path from 'path';
import { promises as fs } from 'fs';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { resolveLocation } from '../lib/geocode';

// ── Load .env.local ───────────────────────────────────────────────────────────
async function loadEnv() {
  const envPath = path.join(process.cwd(), '.env.local');
  try {
    const raw = await fs.readFile(envPath, 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* rely on existing env */ }
}

function dedupKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

type GeoRow = {
  id: string;
  name: string;
  headquarters_city: string | null;
  headquarters_country: string | null;
  headquarters_lat: number | null;
  peopleCount: number;
};

// Paginate through all communities missing geo data.
async function fetchCommunitiesToGeocode(supabase: SupabaseClient): Promise<GeoRow[]> {
  const PAGE = 1000;
  const all: GeoRow[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('communities_canonical')
      .select('id, name, headquarters_city, headquarters_country, headquarters_lat')
      .is('headquarters_lat', null)
      .not('name', 'is', null)
      .order('name')
      .range(offset, offset + PAGE - 1);
    if (error) { console.error('✗  communities fetch error:', error.message); break; }
    if (!data?.length) break;
    for (const r of data) all.push({ ...r, peopleCount: 0 });
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

// Count how many people (from people_canonical) are associated with each company,
// keyed by dedup_key. Paginated so it handles 22k+ rows.
async function fetchPeopleCounts(supabase: SupabaseClient): Promise<Map<string, number>> {
  const PAGE = 1000;
  const counts = new Map<string, number>();
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('people_canonical')
      .select('current_company_name')
      .not('current_company_name', 'is', null)
      .range(offset, offset + PAGE - 1);
    if (error || !data?.length) break;
    for (const row of data) {
      if (!row.current_company_name) continue;
      const key = dedupKey(row.current_company_name);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return counts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  await loadEnv();

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('✗  SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const concurrency = parseInt(process.env.GEOCODE_CONCURRENCY ?? '3', 10);

  console.log('⏳  Fetching communities + people counts…');
  const [rows, peopleCounts] = await Promise.all([
    fetchCommunitiesToGeocode(supabase),
    fetchPeopleCounts(supabase),
  ]);

  if (rows.length === 0) {
    console.log('✓  All communities already have geo data.');
    return;
  }

  // Attach people count and sort highest → lowest
  for (const row of rows) {
    row.peopleCount = peopleCounts.get(dedupKey(row.name)) ?? 0;
  }
  rows.sort((a, b) => b.peopleCount - a.peopleCount || a.name.localeCompare(b.name));

  console.log(`→  ${rows.length} communities to geocode  (concurrency=${concurrency})`);
  console.log('\nTop 10 by people count:');
  for (const r of rows.slice(0, 10)) {
    console.log(`   ${String(r.peopleCount).padStart(4)} people — ${r.name}`);
  }
  console.log();

  let ok = 0;
  let failed = 0;

  async function processRow(row: GeoRow) {
    const label = row.peopleCount > 0 ? `[${row.peopleCount}p] ${row.name}` : row.name;
    process.stdout.write(`  ${label} … `);

    const result = await resolveLocation({
      orgName: row.name,
      city: row.headquarters_city,
      country: row.headquarters_country,
    });

    if (!result) {
      console.log('✗ no result');
      failed++;
      return;
    }

    const { error: updateErr } = await supabase
      .from('communities_canonical')
      .update({
        headquarters_lat: result.lat,
        headquarters_lng: result.lng,
        location_display: result.display,
        ...(result.source === 'wikidata' && !row.headquarters_city &&
            result.display.toLowerCase() !== row.name.toLowerCase()
          ? { headquarters_city: result.display.split(',')[0].trim() }
          : {}),
      })
      .eq('id', row.id);

    if (updateErr) {
      console.log(`✗ DB error: ${updateErr.message}`);
      failed++;
    } else {
      console.log(`✓  ${result.display} (${result.lat.toFixed(4)}, ${result.lng.toFixed(4)}) [${result.source}]`);
      ok++;
    }
  }

  for (let i = 0; i < rows.length; i += concurrency) {
    await Promise.all(rows.slice(i, i + concurrency).map(processRow));
  }

  console.log(`\n✓  Done: ${ok} geocoded, ${failed} failed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
