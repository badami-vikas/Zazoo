/**
 * upsert-communities — backfill consumer.
 *
 * Reads company-scope rows from data/staging.jsonl and materialises Community
 * pages via lib/communities.ts (the SAME code path /api/linkedin-import runs
 * automatically on save). Use this to backfill historical staging rows.
 *
 * Env (from .env.local):
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY   — required for the upsert
 *   BRIDGE_WORKSPACE_ID, BRIDGE_USER_ID  — optional, enables person association
 *   RECON_ALL_COMPANY_ROWS=1             — include ALL company rows, not just
 *                                          LinkedIn-extension ones (default: off)
 *   RECON_DRY_RUN=1                      — preview only, no DB writes
 *
 * Run:  npm run upsert:communities
 */

import path from 'path';
import { promises as fs } from 'fs';
import { collapseCommunities, upsertCommunities, type CommunityInput } from '../lib/communities';

const STAGING = path.join(process.cwd(), 'data', 'staging.jsonl');
const LINKEDIN_SOURCE = 'LinkedIn (browser)';

async function loadEnv() {
  try {
    const raw = await fs.readFile(path.join(process.cwd(), '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* rely on existing env */ }
}

interface StoreRow {
  scope: string; label: string; value: string; url?: string; subjectName: string; source: string;
}

async function main() {
  await loadEnv();
  const includeAll = process.env.RECON_ALL_COMPANY_ROWS === '1';

  let raw: string;
  try {
    raw = await fs.readFile(STAGING, 'utf8');
  } catch {
    console.error(`No staging file at ${STAGING}. Nothing to do.`);
    return;
  }

  const rows: StoreRow[] = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l) as StoreRow);
  const items: CommunityInput[] = rows
    .filter((r) => r.scope === 'company' && r.value?.trim() && (includeAll || r.source === LINKEDIN_SOURCE))
    .map((r) => ({ name: r.value, url: r.url, label: r.label, subjectName: r.subjectName }));

  if (!items.length) {
    console.log(`No company-scope rows${includeAll ? '' : ` from "${LINKEDIN_SOURCE}"`} in staging.`);
    if (!includeAll) console.log('Tip: set RECON_ALL_COMPANY_ROWS=1 to include non-LinkedIn company rows.');
    return;
  }

  const { list, associations } = collapseCommunities(items);
  console.log(`Found ${list.length} distinct communities across ${items.length} company rows.\n`);

  if (process.env.RECON_DRY_RUN === '1') {
    for (const c of list) console.log(`  • ${c.kind.padEnd(7)} ${c.name}${c.linkedin_url ? `  ${c.linkedin_url}` : ''}`);
    console.log(`\n(dry run) ${list.length} communities, ${associations.length} associations — no DB writes.`);
    return;
  }

  const res = await upsertCommunities(items);
  console.log(`\n${'─'.repeat(60)}`);
  if (res.reason === 'no-supabase-key') {
    console.warn('⚠  No SUPABASE_SERVICE_KEY — nothing upserted.');
  } else {
    console.log(`✅  ${res.upserted}/${list.length} communities upserted, ${res.associated} person links`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
