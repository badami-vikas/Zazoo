/**
 * enrich-washu-board.ts
 *
 * Reads the WashU Board Members Roster (pre-extracted to data/washu-board-roster.json)
 * and runs the Recon enrichment pipeline on each person. Results are written to:
 *   data/enriched-washu-board.jsonl   — one JSON line per person (people_canonical shape)
 *   data/staging.jsonl               — appended (shows in the Recon UI immediately)
 *
 * Usage:
 *   npx tsx scripts/enrich-washu-board.ts
 *
 * Env tunables (in .env.local):
 *   RECON_OFFSET       — resume from this index (default 0)
 *   RECON_LIMIT        — how many to process this run (default: all remaining)
 *   RECON_MIN_DELAY_MS — min pause between profiles (default 3000)
 *   RECON_MAX_DELAY_MS — max pause between profiles (default 12000)
 *   BREAKER_INRUN_CONSEC — abort after N consecutive blocked (default 5)
 *
 * Supabase is optional: set SUPABASE_URL + SUPABASE_SERVICE_KEY to also upsert
 * into people_canonical / communities_canonical.
 */

import path from 'path';
import { promises as fs } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { resolveIdentities, buildReport } from '../lib/recon';
import type { ReconReport, Field } from '../lib/recon';
import { appendStaging, reportToRows } from '../lib/store';

// ── Bootstrap env from .env.local ─────────────────────────────────────────────
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

// ── Roster row shape (from washu-board-roster.json) ───────────────────────────
interface RosterRow {
  Category?: string;
  Board?: string;
  Unit?: string;
  Role?: string;
  Name?: string;
  'Title/Position'?: string;
  'Employer/Organization'?: string;
  'WashU Degree & Class Year'?: string;
  Location?: string;
  'Other Boards/Affiliations'?: string;
  Bio?: string;
  'Source URL'?: string;
}

// ── Outcome classification ─────────────────────────────────────────────────────
type Outcome = 'ok' | 'soft' | 'blocked';
const CANARY_STEP_RE = /searxng|web search|github/i;
const BLOCK_OUTPUT_RE = /\b(403|429)\b|captcha|too many|rate.?limit|timed?\s*out|timeout/i;
const BLOCK_ERR_RE = /\b(403|429)\b|captcha|too many|rate.?limit|timed?\s*out|timeout|fetch failed|etimedout|econnreset|enotfound|socket|network|aborted/i;

function classifyReport(report: ReconReport): { outcome: Outcome; blockedCanaries: string[] } {
  const blockedCanaries: string[] = [];
  for (const s of report.steps ?? []) {
    if (s.ok) continue;
    if (CANARY_STEP_RE.test(s.step) && BLOCK_OUTPUT_RE.test(s.output)) {
      blockedCanaries.push(s.step);
    }
  }
  if (blockedCanaries.length) return { outcome: 'blocked', blockedCanaries };
  const conf = report.identity?.confidence ?? 0;
  const hasPerson = report.person?.sections?.some((sec) => sec.fields.length) ?? false;
  if (conf < 0.25 && !hasPerson) return { outcome: 'soft', blockedCanaries };
  return { outcome: 'ok', blockedCanaries };
}

function classifyError(msg: string): Outcome {
  return BLOCK_ERR_RE.test(msg) ? 'blocked' : 'soft';
}

const randInt = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));

// ── Helpers for mapping report fields ─────────────────────────────────────────
function pickField(fields: Field[], ...frags: string[]): string | null {
  for (const frag of frags) {
    const f = fields.find((f) => f.label.toLowerCase().includes(frag.toLowerCase()));
    if (f?.value) return f.value;
  }
  return null;
}

function extractHandle(url: string | undefined, domain: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    if (!u.hostname.includes(domain)) return null;
    return u.pathname.replace(/^\/(@?)/, '').split('/')[0] || null;
  } catch { return null; }
}

function dedupKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ── Output row shape ───────────────────────────────────────────────────────────
interface EnrichedRow {
  // source metadata
  washu_board: string;
  washu_unit: string;
  washu_role: string;
  washu_degree: string | null;
  // identity
  full_name: string;
  current_title: string | null;
  current_company_name: string | null;
  bio: string | null;
  location_city: string | null;
  location_country: string | null;
  // socials
  linkedin_url: string | null;
  twitter_handle: string | null;
  instagram_handle: string | null;
  tiktok_handle: string | null;
  github_handle: string | null;
  bluesky_handle: string | null;
  mastodon_url: string | null;
  website_url: string | null;
  // contact
  emails: string[] | null;
  // academic
  orcid_id: string | null;
  scholar_url: string | null;
  skills: string[] | null;
  // career
  education: Array<{ institution: string; degree?: string; field?: string; year?: string }> | null;
  previous_companies: Array<{ name: string; title?: string; period?: string }> | null;
  // signals
  recon_signals: Array<{ label: string; value: string; source: string; url?: string }> | null;
  // meta
  enrichment_confidence: number;
  recon_run_at: string;
  dedup_key: string;
}

function mapReport(report: ReconReport, row: RosterRow): EnrichedRow {
  const pFields: Field[] = report.person?.sections.flatMap((s) => s.fields) ?? [];
  const cFields: Field[] = report.company?.sections.flatMap((s) => s.fields) ?? [];

  const title = pickField(pFields, 'title', 'position', 'role', 'job');
  const companyName = report.company?.name ?? report.companySuggestion?.name
    ?? pickField([...pFields, ...cFields], 'employer', 'company', 'organization') ?? null;
  const rawLocation = pickField(pFields, 'location', 'city', 'hq', 'address');
  const [locationCity, locationCountry] = rawLocation ? rawLocation.split(',').map((s) => s.trim()) : [null, null];

  // Emails — regex-harvest from all person fields
  const emails: string[] = [];
  for (const f of pFields) {
    const emailRe = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
    for (const m of (f.value.match(emailRe) ?? [])) emails.push(m.toLowerCase());
  }

  // Social fields
  const twField = pFields.find((f) => f.url?.includes('twitter.com') || f.url?.includes('x.com'));
  const igField = pFields.find((f) => f.url?.includes('instagram.com'));
  const ttField = pFields.find((f) => f.url?.includes('tiktok.com'));
  const ghField = pFields.find((f) => f.url?.includes('github.com'));
  const bskyField = pFields.find((f) => f.url?.includes('bsky.app') || f.source?.toLowerCase().includes('bluesky'));
  const mastoField = pFields.find((f) => f.source?.toLowerCase().includes('mastodon'));
  const liField = pFields.find((f) => f.url?.includes('linkedin.com'));

  const website = pickField([...pFields, ...cFields], 'website', 'homepage', 'domain');
  const bio = pickField(pFields, 'bio', 'about', 'description', 'summary', 'abstract');
  const skillsRaw = pickField(pFields, 'keyword', 'skill', 'expertise', 'area');
  const skills = skillsRaw ? skillsRaw.split(/[,;|·]+/).map((s) => s.trim()).filter(Boolean) : null;

  // Academic
  const orcidField = pFields.find((f) => f.url?.includes('orcid.org') || f.label.toLowerCase().includes('orcid'));
  const orcid_id = orcidField?.url?.match(/orcid\.org\/(\d{4}-\d{4}-\d{4}-\d{3}[\dX])/)?.[1] ?? null;
  const scholar_url = pFields.find((f) => f.url?.includes('scholar.google'))?.url ?? null;

  // Education
  const educationSection = report.person?.sections.find((sec) => /\beducation\b/i.test(sec.title));
  const educationFields = educationSection?.fields ?? pFields.filter((f) =>
    /\b(education|degree|university|college|school|alumni|graduated)\b/i.test(f.label)
  );
  const education: EnrichedRow['education'] = educationFields.length
    ? educationFields.map((f) => {
        const parts = f.value.split(/[|·,]/).map((p) => p.trim()).filter(Boolean);
        return {
          institution: parts[0] ?? f.value,
          degree: parts[1] ?? undefined,
          field: parts[2] ?? undefined,
          year: parts[3] ?? undefined,
        };
      })
    : null;

  // Previous companies
  const experienceSection = report.person?.sections.find((sec) =>
    /\b(experience|work history|employment|career|previous)\b/i.test(sec.title)
  );
  const expFields = experienceSection?.fields ?? pFields.filter((f) =>
    /\b(previous|former|past|employer|experience|worked at)\b/i.test(f.label)
  );
  const currentCompanyNorm = (companyName ?? '').toLowerCase().trim();
  const previous_companies: EnrichedRow['previous_companies'] = expFields.length
    ? expFields
        .map((f) => {
          const parts = f.value.split(/[|·]/).map((p) => p.trim()).filter(Boolean);
          return { name: parts[0] ?? f.value, title: parts[1] ?? undefined, period: parts[2] ?? undefined };
        })
        .filter((c) => c.name.toLowerCase().trim() !== currentCompanyNorm)
    : null;

  const signals = report.signals.map((s) => ({ label: s.label, value: s.value, source: s.source, url: s.url }));

  return {
    washu_board: row.Board ?? '',
    washu_unit: row.Unit ?? '',
    washu_role: row.Role ?? '',
    washu_degree: row['WashU Degree & Class Year'] ?? null,
    full_name: report.identity.displayName,
    current_title: title ?? row['Title/Position'] ?? null,
    current_company_name: companyName ?? row['Employer/Organization'] ?? null,
    bio: bio ?? row.Bio ?? null,
    location_city: locationCity ?? (row.Location ? row.Location.split(',')[0].trim() : null),
    location_country: locationCountry ?? (row.Location?.includes(',') ? row.Location.split(',').slice(-1)[0].trim() : null),
    linkedin_url: liField?.url ?? null,
    twitter_handle: twField ? (extractHandle(twField.url ?? twField.value, 'twitter.com') ?? extractHandle(twField.url ?? twField.value, 'x.com')) : null,
    instagram_handle: igField ? extractHandle(igField.url ?? igField.value, 'instagram.com') : null,
    tiktok_handle: ttField ? extractHandle(ttField.url ?? ttField.value, 'tiktok.com') : null,
    github_handle: ghField ? extractHandle(ghField.url ?? ghField.value, 'github.com') : null,
    bluesky_handle: bskyField ? (bskyField.value.replace(/^@/, '') || null) : null,
    mastodon_url: mastoField?.url ?? null,
    website_url: website,
    emails: emails.length ? [...new Set(emails)] : null,
    orcid_id,
    scholar_url,
    skills,
    education: education?.length ? education : null,
    previous_companies: previous_companies?.length ? previous_companies : null,
    recon_signals: signals.length ? signals : null,
    enrichment_confidence: report.identity.confidence,
    recon_run_at: new Date().toISOString(),
    dedup_key: dedupKey(report.identity.displayName),
  };
}

// ── Progress file (cursor) ─────────────────────────────────────────────────────
interface Progress {
  nextOffset: number;
  total: number;
  ok: number;
  soft: number;
  blocked: number;
  updatedAt: string;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  await loadEnv();

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;
  if (!supabase) {
    console.warn('⚠  No SUPABASE_SERVICE_KEY — writing locally only (data/enriched-washu-board.jsonl)');
  }

  const DATA_DIR = path.join(process.cwd(), 'data');
  await fs.mkdir(DATA_DIR, { recursive: true });

  const ROSTER_FILE = path.join(DATA_DIR, 'washu-board-roster.json');
  const OUT_FILE = path.join(DATA_DIR, 'enriched-washu-board.jsonl');
  const PROGRESS_FILE = path.join(DATA_DIR, 'washu-board-progress.json');

  // Load roster
  const allPeople: RosterRow[] = JSON.parse(await fs.readFile(ROSTER_FILE, 'utf8'));

  // Tuning
  const minDelayMs = parseInt(process.env.RECON_MIN_DELAY_MS ?? '3000', 10);
  const maxDelayMs = parseInt(process.env.RECON_MAX_DELAY_MS ?? '12000', 10);
  const breakerInrunConsec = parseInt(process.env.BREAKER_INRUN_CONSEC ?? '5', 10);

  // Resume from saved cursor if present, else use env/default
  let savedProgress: Progress | null = null;
  try {
    savedProgress = JSON.parse(await fs.readFile(PROGRESS_FILE, 'utf8'));
  } catch { /* no cursor yet */ }

  const offset = parseInt(process.env.RECON_OFFSET ?? String(savedProgress?.nextOffset ?? 0), 10);
  const limit = parseInt(process.env.RECON_LIMIT ?? String(allPeople.length - offset), 10);
  const batch = allPeople.slice(offset, offset + limit);

  console.log(`\n🎓  WashU Board Members Recon`);
  console.log(`📋  Total roster: ${allPeople.length}`);
  console.log(`▶   Processing ${batch.length} people (offset=${offset}, limit=${limit})`);
  if (savedProgress) {
    console.log(`📊  Prior progress: ok=${savedProgress.ok}  soft=${savedProgress.soft}  blocked=${savedProgress.blocked}`);
  }
  console.log();

  if (batch.length === 0) {
    console.log('✅  All people already processed. Delete data/washu-board-progress.json to restart.');
    return;
  }

  let ok = 0, softCount = 0, blockedCount = 0, attempted = 0;
  let consecutiveBlocked = 0, aborted = false;
  const errors: Array<{ name: string; error: string }> = [];

  for (const row of batch) {
    if (aborted) break;
    attempted++;
    const idx = offset + attempted;
    const name = row.Name?.trim() ?? '';
    const company = row['Employer/Organization']?.trim() ?? '';
    const title = row['Title/Position']?.trim() ?? '';
    const location = row.Location?.trim() ?? '';
    const board = row.Board ?? '';

    if (!name) {
      console.log(`[${idx}/${allPeople.length}] ⚠ Skipping row with no name`);
      softCount++;
      continue;
    }

    console.log(`[${idx}/${allPeople.length}] ${name} — ${title || row.Role} @ ${company || board}`);

    try {
      // Phase 1: resolve
      const { candidates } = await resolveIdentities({
        name,
        company: company || undefined,
        location: location || undefined,
      });

      const candidate = candidates[0];
      if (!candidate) throw new Error('No candidate from resolver');

      // Phase 2: enrich
      const report = await buildReport(candidate, {
        name,
        company: company || undefined,
        location: location || undefined,
      });

      const { outcome, blockedCanaries: bc } = classifyReport(report);

      if (outcome === 'blocked') {
        blockedCount++; consecutiveBlocked++;
        bc.forEach((s) => console.warn(`  ⚠ blocked: ${s}`));
        if (consecutiveBlocked >= breakerInrunConsec) {
          aborted = true;
          console.error(`  ⛔ circuit breaker: ${consecutiveBlocked} consecutive blocked → aborting`);
        }
      } else {
        if (outcome === 'soft') softCount++;
        consecutiveBlocked = 0;
      }

      // Write to staging (shows in Recon UI)
      await appendStaging(reportToRows(report));

      // Write to output JSONL
      const enriched = mapReport(report, row);
      await fs.appendFile(OUT_FILE, JSON.stringify(enriched) + '\n');

      // Upsert to Supabase if available
      if (supabase) {
        const { data, error } = await supabase
          .from('people_canonical')
          .upsert({
            full_name: enriched.full_name,
            current_title: enriched.current_title,
            current_company_name: enriched.current_company_name,
            bio: enriched.bio,
            linkedin_url: enriched.linkedin_url ?? '',
            twitter_handle: enriched.twitter_handle,
            instagram_handle: enriched.instagram_handle,
            tiktok_handle: enriched.tiktok_handle,
            github_handle: enriched.github_handle,
            bluesky_handle: enriched.bluesky_handle,
            mastodon_url: enriched.mastodon_url,
            website_url: enriched.website_url,
            emails: enriched.emails,
            location_city: enriched.location_city,
            location_country: enriched.location_country,
            orcid_id: enriched.orcid_id,
            scholar_url: enriched.scholar_url,
            skills: enriched.skills,
            education: enriched.education,
            previous_companies: enriched.previous_companies,
            recon_signals: enriched.recon_signals,
            recon_run_at: enriched.recon_run_at,
            enrichment_source: 'recon-washu-board',
            last_enriched_at: enriched.recon_run_at,
            enrichment_confidence: enriched.enrichment_confidence,
            dedup_key: enriched.dedup_key,
          }, { onConflict: 'dedup_key' })
          .select('id')
          .single();
        if (error) console.warn(`  ⚠ Supabase: ${error.message}`);
        else console.log(`  ✓ upserted  id=${data?.id}  conf=${(enriched.enrichment_confidence * 100).toFixed(0)}%`);
      } else {
        console.log(`  ✓ local  conf=${(enriched.enrichment_confidence * 100).toFixed(0)}%`);
      }

      ok++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ${name}: ${msg}`);
      errors.push({ name, error: msg });
      if (classifyError(msg) === 'blocked') {
        blockedCount++; consecutiveBlocked++;
        if (consecutiveBlocked >= breakerInrunConsec) {
          aborted = true;
          console.error(`  ⛔ circuit breaker tripped → aborting`);
        }
      } else {
        softCount++; consecutiveBlocked = 0;
      }
    }

    // Save cursor after every profile so we can resume
    const cumulativeOk = (savedProgress?.ok ?? 0) + ok;
    const cumulativeSoft = (savedProgress?.soft ?? 0) + softCount;
    const cumulativeBlocked = (savedProgress?.blocked ?? 0) + blockedCount;
    await fs.writeFile(PROGRESS_FILE, JSON.stringify({
      nextOffset: offset + attempted,
      total: allPeople.length,
      ok: cumulativeOk,
      soft: cumulativeSoft,
      blocked: cumulativeBlocked,
      updatedAt: new Date().toISOString(),
    } satisfies Progress, null, 2));

    if (!aborted) {
      const delay = randInt(minDelayMs, maxDelayMs);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`✅  Run complete — ${ok} ok, ${softCount} soft, ${blockedCount} blocked`);
  if (aborted) console.warn(`⚠  Aborted early due to consecutive blocks. Resume with: npx tsx scripts/enrich-washu-board.ts`);
  if (errors.length) {
    console.log('\nFailed:');
    errors.forEach(({ name, error }) => console.log(`  • ${name}: ${error}`));
  }
  console.log(`\n📁  Output: data/enriched-washu-board.jsonl`);
  console.log(`📍  Cursor saved: data/washu-board-progress.json`);

  const progress = JSON.parse(await fs.readFile(PROGRESS_FILE, 'utf8')) as Progress;
  const remaining = allPeople.length - progress.nextOffset;
  if (remaining > 0 && !aborted) {
    console.log(`\n⏭  ${remaining} people remaining. Re-run the script to continue.`);
  } else if (remaining === 0) {
    console.log(`\n🎉  All ${allPeople.length} board members processed!`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
