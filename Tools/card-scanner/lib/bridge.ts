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

// ── intake dispatch ────────────────────────────────────────────────────────────

const INTAKE_URL = process.env.NEXT_PUBLIC_BRIDGE_INTAKE_URL;
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function addToBridge(env: CaptureEnvelope): Promise<IntakeResult> {
  // 1. Explicit intake endpoint (the platform pipeline propose surface)
  if (INTAKE_URL) {
    try {
      const r = await fetch(INTAKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(env),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return { ok: true, sink: 'intake_url' };
    } catch (e) {
      return { ok: false, sink: 'intake_url', error: e instanceof Error ? e.message : 'intake failed' };
    }
  }
  // 2. Supabase quarantine table (shared backend handoff)
  if (SB_URL && SB_KEY) {
    try {
      const r = await fetch(`${SB_URL.replace(/\/$/, '')}/rest/v1/tool_captures`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SB_KEY,
          Authorization: `Bearer ${SB_KEY}`,
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          id: env.id,
          tool_id: env.tool.id,
          status: env.status,
          data_scope: env.dataScope,
          contract: env.contract,
          payload: env.payload,
          provenance: env.provenance,
          captured_at: env.capturedAt,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return { ok: true, sink: 'supabase' };
    } catch (e) {
      return { ok: false, sink: 'supabase', error: e instanceof Error ? e.message : 'supabase insert failed' };
    }
  }
  // 3. Zero-infra fallback
  try {
    pushOutbox(env);
    return { ok: true, sink: 'outbox' };
  } catch (e) {
    return { ok: false, sink: 'outbox', error: e instanceof Error ? e.message : 'outbox write failed' };
  }
}
