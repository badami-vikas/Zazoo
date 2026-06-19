// "Add to Bridge" intake seam — the gated-intake edge.
//
// A capture is NEVER committed to the Bridge graph here. It is mapped through the
// typed output_contract (card → Person + Touchpoint) into a quarantined capture
// envelope and handed to Bridge, where it lands in the Tools section as a pending
// item with an "Add" button (= the pipeline proposal → review → commit).
//
// Sink is intentionally broad/flexible (the user's ask). Resolution order:
//   1. NEXT_PUBLIC_BRIDGE_INTAKE_URL  → POST the envelope (platform pipeline propose)
//   2. NEXT_PUBLIC_SUPABASE_URL + key → insert into the `tool_captures` quarantine table
//   3. localStorage outbox            → zero-infra fallback (same-device handoff)

import type { CardData } from './types';
import { CARD_SCANNER_MANIFEST } from './tool-manifest';

const OUTBOX_KEY = 'card-scanner-bridge-outbox-v1';

export interface PersonDraft {
  name: string;
  title: string;
  company: string;
  emails: string[];
  phones: string[];
  address: string;
  website: string;
  notes: string;
}

export interface TouchpointDraft {
  text: string;
  capturedAt: string;
}

export interface CaptureEnvelope {
  schemaVersion: 1;
  id: string;
  tool: { id: string; version: string; source_repo: string };
  capturedAt: string;
  runMode: 'standalone' | 'account_bound';
  dataScope: 'public';
  status: 'quarantined';
  provenance: { model?: string; source?: string };
  contract: 'person.v1';
  payload: { person: PersonDraft; touchpoint: TouchpointDraft };
  raw: CardData;
}

export type IntakeSink = 'intake_url' | 'supabase' | 'outbox';
export interface IntakeResult { ok: boolean; sink: IntakeSink; error?: string }

function splitMulti(v: string): string[] {
  return (v || '').split('|').map(s => s.trim()).filter(Boolean);
}

// ── output_contract: card → Person + Touchpoint ────────────────────────────────

export function mapCardToCapture(
  card: CardData,
  meta: { model?: string; source?: string; runMode?: 'standalone' | 'account_bound'; capturedAt?: string; id?: string },
): CaptureEnvelope {
  const capturedAt = meta.capturedAt ?? new Date().toISOString();
  const person: PersonDraft = {
    name: card.name.trim(),
    title: card.role.trim(),
    company: card.company.trim(),
    emails: splitMulti(card.email),
    phones: splitMulti(card.phone),
    address: card.address.trim(),
    website: splitMulti(card.website)[0] ?? '',
    notes: card.additional.trim(),
  };
  const who = person.name || person.company || 'a new contact';
  const touchpoint: TouchpointDraft = { text: `Met ${who} — scanned business card`, capturedAt };
  return {
    schemaVersion: 1,
    id: meta.id ?? (globalThis.crypto?.randomUUID?.() ?? `cap-${capturedAt}`),
    tool: { id: CARD_SCANNER_MANIFEST.id, version: CARD_SCANNER_MANIFEST.version, source_repo: CARD_SCANNER_MANIFEST.source_repo },
    capturedAt,
    runMode: meta.runMode ?? 'standalone',
    dataScope: 'public',
    status: 'quarantined',
    provenance: { model: meta.model, source: meta.source },
    contract: 'person.v1',
    payload: { person, touchpoint },
    raw: card,
  };
}

// ── outbox (zero-infra fallback) ───────────────────────────────────────────────

export function loadOutbox(): CaptureEnvelope[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? '[]'); } catch { return []; }
}
export function outboxCount(): number { return loadOutbox().length; }
function pushOutbox(env: CaptureEnvelope): void {
  const list = loadOutbox();
  list.unshift(env);
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(list.slice(0, 500)));
}

// ── intake dispatch (native — Bridge's own Supabase client) ─────────────────────
// The scanner now runs INSIDE Bridge, so a capture inserts straight into the shared
// `tool_captures` quarantine table that the Pending-captures panel reads. capture ≠
// commit: it lands as a quarantined row → Add routes it through the governed pipeline.
export async function addToBridge(env: CaptureEnvelope): Promise<IntakeResult> {
  // 1. Supabase quarantine table (live — same store the Tools panel reads)
  try {
    const { error } = await supabase.from('tool_captures').insert({
      id: env.id,
      tool_id: env.tool.id,
      status: env.status,
      data_scope: env.dataScope,
      contract: env.contract,
      payload: env.payload,
      provenance: env.provenance,
      captured_at: env.capturedAt,
    });
    if (error) throw error;
    return { ok: true, sink: 'supabase' };
  } catch (e) {
    // 2. Zero-infra fallback (signed-out / RLS / offline) — same-device handoff
    try {
      pushOutbox(env);
      return { ok: true, sink: 'outbox' };
    } catch (e2) {
      return { ok: false, sink: 'outbox', error: e2 instanceof Error ? e2.message : (e instanceof Error ? e.message : 'add failed') };
    }
  }
}
