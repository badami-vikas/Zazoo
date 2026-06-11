/**
 * enrich-linkedin.ts
 *
 * Reads the first 30 rows from the LinkedIn Connections CSV export, runs the
 * Recon enrichment pipeline on each person, and upserts the results into
 * Supabase (people_canonical + communities_canonical). Optionally links them
 * into the per-user people / communities tables if BRIDGE_WORKSPACE_ID and
 * BRIDGE_USER_ID are set.
 *
 * Usage:
 *   npx tsx scripts/enrich-linkedin.ts
 *
 * Required env vars (in Tools/recon/.env.local):
 *   SUPABASE_URL          – https://<ref>.supabase.co
 *   SUPABASE_SERVICE_KEY  – service_role key (bypasses RLS)
 *
 * Optional:
 *   BRIDGE_WORKSPACE_ID   – workspace uuid → also upserts into people/communities
 *   BRIDGE_USER_ID        – user uuid (owner of the import)
 *   CONNECTIONS_CSV       – path to the LinkedIn export CSV (default: auto-detected)
 *   RECON_BATCH_SIZE      – concurrent enrichments (default: 3)
 *   RECON_LIMIT           – how many people to process (default: 30)
 */

import path from 'path';
import { promises as fs } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { resolveIdentities, buildReport } from '../lib/recon';
import type { ReconReport, Field } from '../lib/recon';
import { appendStaging, reportToRows } from '../lib/store';

// ── Bootstrap env from .env.local if dotenv-style file present ───────────────
// (Next.js loads .env.local automatically; running via tsx does not)
async function loadEnv() {
  const envPath = path.join(process.cwd(), '.env.local');
  try {
    const raw = await fs.readFile(envPath, 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* no .env.local — rely on existing env */ }
}

// ── CSV parser — handles LinkedIn's 3-line preamble + RFC 4180 quoting ───────
interface CsvRow { [key: string]: string }

function parseCsv(raw: string): CsvRow[] {
  const lines = raw.split('\n');
  // Find the header row: first line starting with "First Name"
  const headerIdx = lines.findIndex((l) => l.trim().startsWith('First Name'));
  if (headerIdx === -1) throw new Error('Could not find CSV header row starting with "First Name"');

  const parseFields = (line: string): string[] => {
    const fields: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === ',' && !inQ) {
        fields.push(cur); cur = '';
      } else {
        cur += ch;
      }
    }
    fields.push(cur);
    return fields;
  };

  const headers = parseFields(lines[headerIdx]);
  const rows: CsvRow[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const vals = parseFields(line);
    const row: CsvRow = {};
    headers.forEach((h, idx) => { row[h.trim()] = (vals[idx] ?? '').trim(); });
    rows.push(row);
  }
  return rows;
}

// ── Locate the LinkedIn CSV ───────────────────────────────────────────────────
async function findConnectionsCsv(): Promise<string> {
  if (process.env.CONNECTIONS_CSV) return process.env.CONNECTIONS_CSV;
  const candidates = [
    path.join(process.cwd(), '..', '..', 'Design Bridge AI Interface (Copy)', 'data', 'Connections.csv'),
    path.join(process.cwd(), 'data', 'Connections.csv'),
  ];
  for (const c of candidates) {
    try { await fs.access(c); return c; } catch { /* try next */ }
  }
  throw new Error(`LinkedIn CSV not found. Set CONNECTIONS_CSV env var. Tried:\n${candidates.join('\n')}`);
}

// ── Report → people_canonical row ────────────────────────────────────────────
interface PeopleCanonicalUpsert {
  full_name: string;
  current_title: string | null;
  current_company_name: string | null;
  bio: string | null;
  linkedin_url: string;
  twitter_handle: string | null;
  github_handle: string | null;
  instagram_handle: string | null;
  tiktok_handle: string | null;
  bluesky_handle: string | null;
  mastodon_url: string | null;
  website_url: string | null;
  emails: string[] | null;
  location_city: string | null;
  location_country: string | null;
  orcid_id: string | null;
  scholar_url: string | null;
  skills: string[] | null;
  recon_signals: Array<{ label: string; value: string; source: string; url?: string }> | null;
  recon_run_at: string;
  enrichment_source: string;
  last_enriched_at: string;
  enrichment_confidence: number;
  dedup_key: string;
}

function dedupKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function extractHandle(url: string | undefined, domain: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    if (!u.hostname.includes(domain)) return null;
    return u.pathname.replace(/^\/(@?)/, '').split('/')[0] || null;
  } catch { return null; }
}

function pickField(fields: Field[], ...labelFragments: string[]): string | null {
  for (const frag of labelFragments) {
    const f = fields.find((f) => f.label.toLowerCase().includes(frag.toLowerCase()));
    if (f?.value) return f.value;
  }
  return null;
}

function pickFieldBySource(fields: Field[], source: string): Field | undefined {
  return fields.find((f) => f.source.toLowerCase().includes(source.toLowerCase()));
}

function pickFieldByUrl(fields: Field[], urlFragment: string): Field | undefined {
  return fields.find((f) => f.url?.includes(urlFragment) || f.value.includes(urlFragment));
}

function mapReportToPeople(report: ReconReport, linkedinUrl: string): PeopleCanonicalUpsert {
  const pFields: Field[] = report.person?.sections.flatMap((s) => s.fields) ?? [];
  const cFields: Field[] = report.company?.sections.flatMap((s) => s.fields) ?? [];

  // Bio — prefer Wikipedia/Wikidata summary
  const bio = pickField(pFields, 'bio', 'about', 'description', 'summary', 'abstract');

  // Title
  const title = pickField(pFields, 'title', 'position', 'role', 'job');

  // Location
  const rawLocation = pickField(pFields, 'location', 'city', 'hq', 'address');
  const [locationCity, locationCountry] = rawLocation ? rawLocation.split(',').map((s) => s.trim()) : [null, null];

  // Emails
  const emails: string[] = [];
  for (const f of pFields) {
    const emailRe = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
    for (const m of (f.value.match(emailRe) ?? [])) emails.push(m.toLowerCase());
  }

  // Social handles
  const twField = pickFieldByUrl(pFields, 'twitter.com') ?? pickFieldByUrl(pFields, 'x.com');
  const ghField = pickFieldByUrl(pFields, 'github.com');
  const igField = pickFieldByUrl(pFields, 'instagram.com');
  const ttField = pickFieldByUrl(pFields, 'tiktok.com');
  const bskyField = pickFieldByUrl(pFields, 'bsky.app') ?? pickFieldBySource(pFields, 'bluesky');
  const mastoField = pickFieldBySource(pFields, 'mastodon');

  // Skills (from ORCID/OpenAlex/Semantic Scholar keywords field)
  const skillsRaw = pickField(pFields, 'keyword', 'skill', 'expertise', 'area');
  const skills = skillsRaw ? skillsRaw.split(/[,;|·]+/).map((s) => s.trim()).filter(Boolean) : null;

  // Signals (risk/compliance)
  const signals = report.signals.map((s) => ({ label: s.label, value: s.value, source: s.source, url: s.url }));

  // Company name from the report
  const companyName = report.company?.name ?? report.companySuggestion?.name
    ?? pickField([...pFields, ...cFields], 'employer', 'company', 'organization') ?? null;

  const website = pickField([...pFields, ...cFields], 'website', 'homepage', 'domain');

  const now = new Date().toISOString();
  return {
    full_name: report.identity.displayName,
    current_title: title,
    current_company_name: companyName,
    bio,
    linkedin_url: linkedinUrl,
    twitter_handle: twField ? extractHandle(twField.url ?? twField.value, 'twitter.com') ?? extractHandle(twField.url ?? twField.value, 'x.com') : null,
    github_handle: ghField ? extractHandle(ghField.url ?? ghField.value, 'github.com') : null,
    instagram_handle: igField ? extractHandle(igField.url ?? igField.value, 'instagram.com') : null,
    tiktok_handle: ttField ? extractHandle(ttField.url ?? ttField.value, 'tiktok.com') : null,
    bluesky_handle: bskyField ? (bskyField.value.replace(/^@/, '') || null) : null,
    mastodon_url: mastoField?.url ?? null,
    website_url: website,
    emails: emails.length ? [...new Set(emails)] : null,
    location_city: locationCity ?? null,
    location_country: locationCountry ?? null,
    orcid_id: pickField(pFields, 'orcid'),
    scholar_url: pFields.find((f) => f.url?.includes('scholar.google'))?.url ?? null,
    skills,
    recon_signals: signals.length ? signals : null,
    recon_run_at: now,
    enrichment_source: 'recon',
    last_enriched_at: now,
    enrichment_confidence: report.identity.confidence,
    dedup_key: dedupKey(report.identity.displayName),
  };
}

// ── Report → communities_canonical row ───────────────────────────────────────
interface CommunitiesCanonicalUpsert {
  name: string;
  kind: string;
  description: string | null;
  website_url: string | null;
  linkedin_url: string | null;
  twitter_handle: string | null;
  github_org: string | null;
  headquarters_city: string | null;
  tech_stack: string[] | null;
  hiring_signals: Array<{ title: string; url: string; postedAt?: string }> | null;
  recon_run_at: string;
  dedup_key: string;
}

function mapReportToCommunity(report: ReconReport): CommunitiesCanonicalUpsert | null {
  const companyName = report.company?.name ?? report.companySuggestion?.name;
  if (!companyName) return null;

  const cFields: Field[] = report.company?.sections.flatMap((s) => s.fields) ?? [];

  const website = pickField(cFields, 'website', 'homepage', 'domain', 'site name');
  const liField = cFields.find((f) => f.url?.includes('linkedin.com'));
  const twField = cFields.find((f) => f.url?.includes('twitter.com') || f.url?.includes('x.com'));
  const ghField = cFields.find((f) => f.url?.includes('github.com'));
  const hq = pickField(cFields, 'hq', 'headquarter', 'city', 'address', 'location');
  const desc = pickField(cFields, 'description', 'about', 'bio', 'summary');

  // Tech stack: prefer the explicit 'tech stack' field, else split social-links value
  const techRaw = pickField(cFields, 'tech stack');
  const techStack = techRaw ? techRaw.split(/[,;]+/).map((t) => t.trim()).filter(Boolean) : null;

  // Open roles from Greenhouse/Lever
  const hiringFields = cFields.filter((f) => f.source === 'Greenhouse' || f.source === 'Lever');
  const hiringSignals = hiringFields.length
    ? hiringFields.map((f) => ({ title: f.value, url: f.url ?? '', postedAt: undefined }))
    : null;

  return {
    name: companyName,
    kind: 'company',
    description: desc,
    website_url: website,
    linkedin_url: liField?.url ?? null,
    twitter_handle: twField ? extractHandle(twField.url, 'twitter.com') ?? extractHandle(twField.url, 'x.com') : null,
    github_org: ghField ? extractHandle(ghField.url, 'github.com') : null,
    headquarters_city: hq ? hq.split(',')[0].trim() : null,
    tech_stack: techStack,
    hiring_signals: hiringSignals,
    recon_run_at: new Date().toISOString(),
    dedup_key: dedupKey(companyName),
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  await loadEnv();

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  // Supabase is optional — script still runs and writes locally without a service key.
  const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;
  if (!supabase) {
    console.warn('⚠  No SUPABASE_SERVICE_KEY — results saved locally only (data/enriched-*.jsonl + staging.jsonl)');
  }

  const workspaceId = process.env.BRIDGE_WORKSPACE_ID ?? null;
  const userId = process.env.BRIDGE_USER_ID ?? null;
  const limit = parseInt(process.env.RECON_LIMIT ?? '30', 10);
  const batchSize = parseInt(process.env.RECON_BATCH_SIZE ?? '3', 10);

  // Output files for offline upsert (MCP or manual SQL)
  const DATA_DIR = path.join(process.cwd(), 'data');
  await fs.mkdir(DATA_DIR, { recursive: true });
  const PEOPLE_OUT = path.join(DATA_DIR, 'enriched-people.jsonl');
  const COMM_OUT = path.join(DATA_DIR, 'enriched-communities.jsonl');
  // Truncate output files for a fresh run
  await fs.writeFile(PEOPLE_OUT, '');
  await fs.writeFile(COMM_OUT, '');

  // Parse CSV
  const csvPath = await findConnectionsCsv();
  console.log(`📄  Reading LinkedIn CSV: ${csvPath}`);
  const raw = await fs.readFile(csvPath, 'utf8');
  const allRows = parseCsv(raw);
  const connections = allRows.slice(0, limit);
  console.log(`👥  Processing ${connections.length} of ${allRows.length} connections\n`);

  let ok = 0, failed = 0;
  const errors: Array<{ name: string; error: string }> = [];

  // Process in batches to avoid hammering rate-limited APIs
  for (let bStart = 0; bStart < connections.length; bStart += batchSize) {
    const batch = connections.slice(bStart, bStart + batchSize);
    await Promise.all(batch.map(async (row, bIdx) => {
      const idx = bStart + bIdx + 1;
      const firstName = row['First Name'] ?? '';
      const lastName = row['Last Name'] ?? '';
      const fullName = `${firstName} ${lastName}`.trim();
      const linkedinUrl = row['URL'] ?? '';
      const company = row['Company'] ?? '';
      const position = row['Position'] ?? '';

      console.log(`[${idx}/${connections.length}] ${fullName} — ${position} @ ${company}`);

      try {
        // Phase 1: resolve
        const { candidates } = await resolveIdentities({
          name: fullName,
          company: company || undefined,
          linkedin: linkedinUrl || undefined,
        });

        const candidate = candidates[0];
        if (!candidate) throw new Error('No candidate returned from resolver');

        // Phase 2: enrich
        const report = await buildReport(candidate, {
          name: fullName,
          company: company || undefined,
          linkedin: linkedinUrl || undefined,
        });

        // ── Write to staging.jsonl (shows in Recon pivot immediately) ────
        await appendStaging(reportToRows(report));

        const personRow = mapReportToPeople(report, linkedinUrl);
        const communityRow = mapReportToCommunity(report);

        // ── Write to local JSONL (used for MCP/SQL upsert when no service key) ──
        await fs.appendFile(PEOPLE_OUT, JSON.stringify(personRow) + '\n');
        if (communityRow) await fs.appendFile(COMM_OUT, JSON.stringify(communityRow) + '\n');

        // ── Upsert to Supabase (when service key available) ───────────────
        if (supabase) {
          const { data: personCanon, error: personErr } = await supabase
            .from('people_canonical')
            .upsert(personRow, { onConflict: 'dedup_key' })
            .select('id')
            .single();

          if (personErr) throw new Error(`people_canonical upsert: ${personErr.message}`);
          const canonPersonId = personCanon?.id as string;
          console.log(`  ✓ people_canonical  id=${canonPersonId}  conf=${(personRow.enrichment_confidence * 100).toFixed(0)}%`);

          let canonCommunityId: string | null = null;
          if (communityRow) {
            const { data: commCanon, error: commErr } = await supabase
              .from('communities_canonical')
              .upsert(communityRow, { onConflict: 'dedup_key' })
              .select('id')
              .single();
            if (commErr) console.warn(`  ⚠ communities_canonical: ${commErr.message}`);
            else {
              canonCommunityId = commCanon?.id as string;
              console.log(`  ✓ communities_canonical  id=${canonCommunityId}  name=${communityRow.name}`);
            }
          }

          if (workspaceId && userId) {
            let communityRowId: string | null = null;
            if (canonCommunityId) {
              const { data: comm, error: commRowErr } = await supabase
                .from('communities')
                .upsert({ workspace_id: workspaceId, user_id: userId, canonical_community_id: canonCommunityId, kind: 'company', source: 'linkedin_import', is_user_confirmed: false }, { onConflict: 'canonical_community_id,workspace_id,user_id' })
                .select('id').single();
              if (!commRowErr) communityRowId = comm?.id as string;
            }
            const { error: peopleRowErr } = await supabase
              .from('people')
              .upsert({ workspace_id: workspaceId, user_id: userId, canonical_person_id: canonPersonId, current_community_id: communityRowId, source: 'linkedin_import' }, { onConflict: 'canonical_person_id,workspace_id,user_id' });
            if (peopleRowErr) console.warn(`  ⚠ people row: ${peopleRowErr.message}`);
            else console.log(`  ✓ workspace rows (workspace=${workspaceId})`);
          }
        } else {
          console.log(`  ✓ local  conf=${(personRow.enrichment_confidence * 100).toFixed(0)}%  → staging.jsonl + enriched-people.jsonl`);
        }

        ok++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ ${fullName}: ${msg}`);
        errors.push({ name: fullName, error: msg });
        failed++;
      }

      // Small pause between requests to respect rate limits
      await new Promise((r) => setTimeout(r, 800));
    }));
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`✅  Done — ${ok} succeeded, ${failed} failed`);
  if (!supabase) console.log(`📁  Local output: data/enriched-people.jsonl  data/enriched-communities.jsonl`);
  if (errors.length) {
    console.log('\nFailed:');
    errors.forEach(({ name, error }) => console.log(`  • ${name}: ${error}`));
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
