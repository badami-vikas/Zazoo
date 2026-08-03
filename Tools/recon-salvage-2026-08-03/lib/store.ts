// Recon global store — staged, draft-then-approve persistence.
//
// Every fact/signal a background-check discovers is flattened into rows and
// appended to STAGING (data/staging.jsonl). Staging is a holding pen: nothing is
// permanent until the human approves. When staging reaches APPROVAL_THRESHOLD
// rows, the UI raises an approval gate; on approval the rows are deduped and
// promoted to PERMANENT (data/permanent.jsonl). This is the same governed,
// draft-then-approve pattern Bridge uses for graph intake — applied locally.
//
// JSONL (not a DB engine) keeps this consistent with the tool's zero-dependency
// ethos: append-only, greppable, no native modules, no server to run.

import { promises as fs } from 'fs';
import path from 'path';
import type { ReconReport } from './recon';
import { getFlaggedKeys } from './flags';

const DATA_DIR = path.join(process.cwd(), 'data');
const STAGING = path.join(DATA_DIR, 'staging.jsonl');
const PERMANENT = path.join(DATA_DIR, 'permanent.jsonl');

/** Seek approval once staging crosses this many rows. */
export const APPROVAL_THRESHOLD = 100;

// ── Crowd-sourced entity-merge thresholds ──────────────────────────────────────
// Post-alpha: a merge requires ≥ MERGE_THRESHOLD analyst votes before it is
// "confirmed". Floor = 5. Rate = 0.1 % of platform users (scales as platform grows).
// At 500 users → max(5, 0) = 5.  At 50 000 users → max(5, 50) = 50.
// In alpha (single analyst) any merge vote is applied immediately to that analyst's
// own view; the record accumulates so future votes count once others join.
export const MERGE_THRESHOLD_FLOOR = 5;
export const MERGE_THRESHOLD_RATE = 0.001; // 0.1 % of platform user count

export function getMergeThreshold(platformUserCount: number): number {
  return Math.max(MERGE_THRESHOLD_FLOOR, Math.floor(platformUserCount * MERGE_THRESHOLD_RATE));
}

export interface StoreRow {
  id: string;
  reportId: string;
  subjectName: string;
  subjectKey: string; // normalized name — clusters rows about the same person
  subjectKind: string;
  scope: 'person' | 'company' | 'signal';
  label: string;
  value: string;
  tier: string;
  source: string;
  url?: string;
  discoveredAt: string;
  eid: string; // entity identifier — auto-assigned by heuristics; overridden by EntityLink votes
  confidence: number; // 0–1 source reliability score (see sourceConfidence)
  /** Lifecycle state: found (single source) → probable (multi-source) → verified (analyst-confirmed) → rejected (flagged). */
  verificationState: 'found' | 'probable' | 'verified' | 'rejected';
}

/** Analyst-confirmed grouping: these rows all belong to entity `entityId`. */
export interface EntityLink {
  id: string;
  rowIds: string[];     // staging row IDs grouped under one entity
  entityId: string;     // e.g. "andrew ng-2", "coinbase"
  entityLabel: string;  // human-readable, e.g. "Andrew Ng — Monash Malaysia"
  analystId: string;    // voter identity (email or session ID)
  createdAt: string;
}

export interface StoreStatus {
  stagingCount: number;
  permanentCount: number;
  subjectCount: number;
  threshold: number;
  needsApproval: boolean;
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function deriveVerificationState(r: { source: string; tier: string; confidence: number }): StoreRow['verificationState'] {
  if (r.source === 'Analyst input') return 'verified';
  if (r.tier === 'A' && r.confidence >= 0.80) return 'probable';
  return 'found';
}

async function readRows(file: string): Promise<StoreRow[]> {
  try {
    const text = await fs.readFile(file, 'utf8');
    return text
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const r = JSON.parse(l) as StoreRow;
        const confidence = r.confidence ?? sourceConfidence(r.source, r.tier);
        return {
          ...r,
          eid: r.eid ?? autoEntityId(r.scope as StoreRow['scope'], r.source, r.subjectKey),
          confidence,
          verificationState: r.verificationState ?? deriveVerificationState({ source: r.source, tier: r.tier, confidence }),
        };
      });
  } catch {
    return []; // missing file = empty store
  }
}

/** Dedup key — same subject + same fact + same source is one row. */
function dedupKey(r: StoreRow): string {
  return `${r.subjectKey}|${r.scope}|${r.label}|${r.value}|${r.source}`;
}

export function subjectKeyOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Per-source confidence score (0–1). Higher = more authoritative/reliable. */
function sourceConfidence(source: string, tier: string): number {
  const map: Record<string, number> = {
    'OFAC': 0.99, 'SEC EDGAR': 0.97, 'FINRA': 0.96, 'IAPD': 0.96,
    'USAspending': 0.94, 'Wikipedia': 0.93, 'Wikidata': 0.91,
    'State SoS': 0.89, 'State UCC': 0.87, 'CourtListener': 0.85, 'DNS': 0.85,
    'JSON-LD': 0.83, 'Web (LinkedIn)': 0.83, 'LinkedIn': 0.83, 'GitHub': 0.81,
    'Greenhouse': 0.80, 'Site fingerprint': 0.78, 'OpenAlex': 0.77, 'ORCID': 0.77,
    'Semantic Scholar': 0.75, 'WhatsMyName': 0.75, 'reuters.com': 0.75,
    'nytimes.com': 0.73, 'wsj.com': 0.73, 'HN': 0.72, 'Email inference': 0.70,
    'GDELT, Google News': 0.70, 'Google News': 0.70, 'Web': 0.68,
    'businesswire.com': 0.68, 'forbes.com': 0.66, 'cnbc.com': 0.66,
    'techcrunch.com': 0.65, 'Google Patents': 0.40, 'Google Scholar': 0.40,
    'OpenCorporates': 0.42,
  };
  if (map[source] !== undefined) return map[source];
  if (tier === 'A') return 0.80;
  if (tier === 'B') return 0.60;
  return 0.35;
}

/**
 * Heuristic entity ID assignment based on data source.
 *
 * Outputs:
 *  `${key}-1`  — confirmed target identity (high-signal primary sources)
 *  `${key}-co` — associated company / firm entity
 *  `?`         — unverified / ambiguous (name-collision-prone sources)
 *
 * Analysts override these via EntityLink votes recorded in entity-links.jsonl.
 */
function autoEntityId(scope: StoreRow['scope'], source: string, subjectKey: string): string {
  if (scope === 'company') return `${subjectKey}-co`;

  const primarySources = ['Wikipedia', 'Wikidata', 'WhatsMyName', 'Email inference', 'Web', 'HN'];
  if (primarySources.includes(source)) return `${subjectKey}-1`;
  if (source.includes('LinkedIn')) return `${subjectKey}-1`;
  if (source.includes('Google News') || source === 'GDELT, Google News') return `${subjectKey}-1`;
  if (source === 'GitHub') return `${subjectKey}-1`;

  // Signals are about the queried subject unless analyst overrides
  if (scope === 'signal') return `${subjectKey}-1`;

  // High name-collision-risk sources — let the analyst tag explicitly
  if (['ORCID', 'OpenAlex', 'Semantic Scholar'].includes(source)) return '?';
  if (source === 'FINRA' && scope === 'person') return '?';
  if (['Google Patents', 'Google Scholar', 'OpenCorporates'].includes(source)) return '?';

  return '?';
}

/** Flatten a report's person/company/signal fields into store rows. */
export function reportToRows(report: ReconReport): StoreRow[] {
  const subjectName = report.identity.displayName;
  const subjectKey = subjectKeyOf(subjectName);
  const discoveredAt = report.generatedAt || new Date().toISOString();
  const reportId = `${report.identity.id}:${discoveredAt}`;
  const rows: StoreRow[] = [];
  const push = (scope: StoreRow['scope'], f: { label: string; value: string; tier: string; source: string; url?: string }) => {
    const confidence = sourceConfidence(f.source, f.tier);
    rows.push({
      id: `${reportId}:${rows.length}`,
      reportId,
      subjectName,
      subjectKey,
      subjectKind: report.identity.kind,
      scope,
      label: f.label,
      value: String(f.value),
      tier: f.tier,
      source: f.source,
      url: f.url,
      discoveredAt,
      eid: autoEntityId(scope, f.source, subjectKey),
      confidence,
      verificationState: deriveVerificationState({ source: f.source, tier: f.tier, confidence }),
    });
  };

  report.person?.sections.forEach((s) => s.fields.forEach((f) => push('person', f)));
  report.company?.sections.forEach((s) => s.fields.forEach((f) => push('company', f)));
  report.signals.forEach((f) => push('signal', f));
  return rows;
}

export async function appendStaging(rows: StoreRow[]): Promise<StoreStatus> {
  await ensureDir();
  if (rows.length) {
    await fs.appendFile(STAGING, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  }
  return storeStatus();
}

export async function storeStatus(): Promise<StoreStatus> {
  const [s, p] = await Promise.all([readRows(STAGING), readRows(PERMANENT)]);
  const subjectCount = new Set(s.map((r) => r.subjectKey)).size;
  return { stagingCount: s.length, permanentCount: p.length, subjectCount, threshold: 100, needsApproval: subjectCount >= 100 };
}

/** Returns rows for a subject from both permanent and staging stores, deduped by dedupKey. */
export async function getRowsForSubject(subjectKey: string): Promise<StoreRow[]> {
  const [staging, permanent] = await Promise.all([readRows(STAGING), readRows(PERMANENT)]);
  const seen = new Set<string>();
  const out: StoreRow[] = [];
  for (const r of [...permanent, ...staging]) {
    if (r.subjectKey !== subjectKey) continue;
    const k = `${r.scope}|${r.label}|${r.value}|${r.source}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

export async function getStaging(): Promise<StoreRow[]> {
  return readRows(STAGING);
}

/** Approve: dedupe staged rows against permanent, exclude flagged rows, append the fresh ones, clear staging. */
export async function promoteStaging(): Promise<StoreStatus & { promoted: number; skipped: number }> {
  await ensureDir();
  const [staged, perm, flaggedKeys] = await Promise.all([readRows(STAGING), readRows(PERMANENT), getFlaggedKeys()]);
  const seen = new Set(perm.map(dedupKey));
  const fresh: StoreRow[] = [];
  for (const r of staged) {
    const flagKey = `${r.subjectKey}|${r.scope}|${r.label}|${r.value}|${r.source}`;
    if (flaggedKeys.has(flagKey)) continue; // analyst-flagged as inaccurate
    const k = dedupKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    fresh.push(r);
  }
  if (fresh.length) await fs.appendFile(PERMANENT, fresh.map((r) => JSON.stringify(r)).join('\n') + '\n');
  await fs.writeFile(STAGING, '');
  return { promoted: fresh.length, skipped: staged.length - fresh.length, ...(await storeStatus()) };
}

/** Reject: clear staging without committing anything. */
export async function discardStaging(): Promise<StoreStatus> {
  await ensureDir();
  await fs.writeFile(STAGING, '');
  return storeStatus();
}

// ── Entity link CRUD ───────────────────────────────────────────────────────────

const ENTITY_LINKS_FILE = path.join(DATA_DIR, 'entity-links.jsonl');

async function readEntityLinks(): Promise<EntityLink[]> {
  try {
    const text = await fs.readFile(ENTITY_LINKS_FILE, 'utf8');
    return text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as EntityLink);
  } catch {
    return [];
  }
}

export async function recordEntityLink(link: EntityLink): Promise<void> {
  await ensureDir();
  await fs.appendFile(ENTITY_LINKS_FILE, JSON.stringify(link) + '\n');
}

export async function getEntityLinks(): Promise<EntityLink[]> {
  return readEntityLinks();
}

/**
 * Returns staging rows with entity link overrides applied.
 * Last recorded vote for a given row ID wins.
 * In multi-user mode, promote to "confirmed" once vote count reaches getMergeThreshold().
 */
export async function getStagingWithLinks(): Promise<StoreRow[]> {
  const [rows, links] = await Promise.all([readRows(STAGING), readEntityLinks()]);
  const overrides = new Map<string, string>();
  for (const link of links) {
    for (const rowId of link.rowIds) {
      overrides.set(rowId, link.entityId); // last write wins; fine for single-analyst alpha
    }
  }
  return rows.map((r) => ({ ...r, eid: overrides.get(r.id) ?? r.eid }));
}
