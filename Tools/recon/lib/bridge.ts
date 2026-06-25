// Recon → Bridge intake seam (mirrors Tools/card-scanner/lib/bridge.ts).
//
// A recon report is NEVER committed to the Bridge graph here. It is mapped through a
// typed output_contract into a quarantined capture envelope and handed to Bridge,
// where it lands as a pending proposal (draft-then-approve). Facts → Memory, the
// subject → Person, risk/credit flags → Signal (every Signal → an action).

import type { Identity, ReconReport, Field } from './recon';

// ── ToolManifest (the rebindable "edge" surface) ───────────────────────────────

export interface ToolManifest {
  id: string;
  name: string;
  version: string;
  source_repo: string;
  run_modes: Array<'standalone' | 'account_bound'>;
  model_bindings: Array<{ use: 'vision' | 'transcription' | 'llm'; plane_default: 'local' | 'cloud' }>;
  capabilities: Array<{ resourceType: string; action: string; dataScope: 'public' | 'private' | 'all'; egress: boolean }>;
  output_contract: Array<{ from: string; to: 'Person' | 'Memory' | 'Touchpoint' | 'Signal' | 'Initiative'; note?: string }>;
  intake_policy: { quarantine: boolean; commit_via: 'pipeline_proposal' };
}

export const RECON_MANIFEST: ToolManifest = {
  id: 'recon',
  name: 'Recon (pre-meeting background check)',
  version: '1.0.0',
  source_repo: 'Tools/recon',
  run_modes: ['standalone', 'account_bound'],
  // Phase 1 is deterministic — NO model is bound. (AI enrichment is a deferred phase.)
  model_bindings: [],
  capabilities: [
    // Reads public data from external APIs (egress) and proposes to the graph (no direct write).
    { resourceType: 'person', action: 'read', dataScope: 'public', egress: true },
    { resourceType: 'person', action: 'write', dataScope: 'public', egress: false },
    { resourceType: 'memory', action: 'write', dataScope: 'public', egress: false },
    { resourceType: 'signal', action: 'write', dataScope: 'public', egress: false },
  ],
  output_contract: [
    { from: 'identity (name/company)', to: 'Person', note: 'verified subject' },
    { from: 'tiered fields (person + company)', to: 'Memory', note: 'researched knowledge, provenanced' },
    { from: 'litigation / UCC / credit flags', to: 'Signal', note: 'risk signals → action' },
  ],
  intake_policy: { quarantine: true, commit_via: 'pipeline_proposal' },
};

// ── output_contract: report → Person + Memory + Signal ─────────────────────────

export interface PersonDraft {
  name: string;
  company: string;
  domain?: string;
  identifiers: Record<string, string>;
}

export interface MemoryDraft {
  text: string;
  source: string;
  url?: string;
  tier: 'A' | 'B' | 'C';
}

export interface SignalDraft {
  text: string;
  source: string;
  url?: string;
}

export interface CaptureEnvelope {
  schemaVersion: 1;
  id: string;
  tool: { id: string; version: string; source_repo: string };
  capturedAt: string;
  runMode: 'standalone' | 'account_bound';
  dataScope: 'public';
  status: 'quarantined';
  provenance: { sources: string[]; deterministic: true };
  contract: 'recon.v1';
  payload: { person: PersonDraft; memories: MemoryDraft[]; signals: SignalDraft[] };
  raw: ReconReport;
}

function fieldToMemory(f: Field): MemoryDraft {
  return { text: `${f.label}: ${f.value}`, source: f.source, url: f.url, tier: f.tier };
}

export function mapReportToCapture(
  report: ReconReport,
  meta: { runMode?: 'standalone' | 'account_bound'; id?: string } = {},
): CaptureEnvelope {
  const identity: Identity = report.identity;
  const idStrings: Record<string, string> = {};
  for (const [k, v] of Object.entries(identity.identifiers)) if (v) idStrings[k] = String(v);

  const memories: MemoryDraft[] = [];
  for (const sub of [report.person, report.company]) {
    if (!sub) continue;
    for (const sec of sub.sections) for (const f of sec.fields) memories.push(fieldToMemory(f));
  }
  const signals: SignalDraft[] = report.signals.map((s) => ({ text: `${s.label}: ${s.value}`, source: s.source, url: s.url }));

  return {
    schemaVersion: 1,
    id: meta.id ?? (globalThis.crypto?.randomUUID?.() ?? `recon-${report.generatedAt}`),
    tool: { id: RECON_MANIFEST.id, version: RECON_MANIFEST.version, source_repo: RECON_MANIFEST.source_repo },
    capturedAt: report.generatedAt,
    runMode: meta.runMode ?? 'standalone',
    dataScope: 'public',
    status: 'quarantined',
    provenance: { sources: report.coverage.filter((c) => c.ok).map((c) => c.source), deterministic: true },
    contract: 'recon.v1',
    payload: {
      person: {
        name: identity.kind === 'person' ? identity.displayName : (identity.identifiers.name ?? identity.displayName),
        company: report.company?.name ?? identity.identifiers.company ?? '',
        domain: identity.identifiers.domain,
        identifiers: idStrings,
      },
      memories,
      signals,
    },
    raw: report,
  };
}

// ── outbox (zero-infra fallback) ───────────────────────────────────────────────

const OUTBOX_KEY = 'recon-bridge-outbox-v1';

export function loadOutbox(): CaptureEnvelope[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function pushOutbox(env: CaptureEnvelope): void {
  const list = loadOutbox();
  list.unshift(env);
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(list.slice(0, 200)));
}

// ── intake dispatch ────────────────────────────────────────────────────────────

export type IntakeSink = 'intake_url' | 'outbox';
export interface IntakeResult {
  ok: boolean;
  sink: IntakeSink;
  error?: string;
}

export async function addToBridge(env: CaptureEnvelope): Promise<IntakeResult> {
  const intakeUrl = process.env.NEXT_PUBLIC_BRIDGE_INTAKE_URL;
  if (intakeUrl) {
    try {
      const r = await fetch(intakeUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-recon-secret': process.env.NEXT_PUBLIC_BRIDGE_INTAKE_SECRET ?? '' }, body: JSON.stringify(env) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return { ok: true, sink: 'intake_url' };
    } catch (e) {
      return { ok: false, sink: 'intake_url', error: e instanceof Error ? e.message : 'intake failed' };
    }
  }
  try {
    pushOutbox(env);
    return { ok: true, sink: 'outbox' };
  } catch (e) {
    return { ok: false, sink: 'outbox', error: e instanceof Error ? e.message : 'outbox write failed' };
  }
}

// Re-post any envelopes stranded in the outbox (captured while the intake URL was unset).
// Returns how many were delivered. Successfully delivered items are removed from the outbox.
export async function flushOutbox(): Promise<{ delivered: number; remaining: number }> {
  const intakeUrl = process.env.NEXT_PUBLIC_BRIDGE_INTAKE_URL;
  if (!intakeUrl) return { delivered: 0, remaining: loadOutbox().length };
  const pending = loadOutbox();
  const stillStuck: CaptureEnvelope[] = [];
  let delivered = 0;
  for (const env of pending) {
    const r = await addToBridge(env);
    if (r.ok && r.sink === 'intake_url') delivered++;
    else stillStuck.push(env);
  }
  if (typeof window !== 'undefined') localStorage.setItem(OUTBOX_KEY, JSON.stringify(stillStuck));
  return { delivered, remaining: stillStuck.length };
}
