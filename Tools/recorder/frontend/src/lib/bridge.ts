// "Add to Bridge" intake seam (recorder produce-side). Maps a project's summary +
// next_steps → a PRIVATE conversation.v1 capture envelope and hands it to Bridge,
// where it lands under Tools → Recorder as a pending item (Add = the governed
// Memory + Touchpoints + Initiative proposal). Capture ≠ commit.
//
// Private captures are ACCOUNT-BOUND: they must be inserted as the authenticated
// Bridge user (anon insert of a private capture is correctly rejected by RLS —
// private ∩ egress = none). Sink resolution:
//   1. VITE_BRIDGE_INTAKE_URL → POST the envelope (platform pipeline propose)
//   2. VITE_BRIDGE_SUPABASE_URL + ANON_KEY (+ VITE_BRIDGE_ACCESS_TOKEN) → tool_captures insert
//   3. localStorage outbox (zero-infra fallback)
import { RECORDER_MANIFEST } from './tool-manifest';
import type { NextStep } from './api';

const OUTBOX_KEY = 'recorder-bridge-outbox-v1';
const env = (import.meta as any).env || {};

export interface ConversationEnvelope {
  schemaVersion: 1;
  id: string;
  tool: { id: string; version: string; source_repo: string };
  capturedAt: string;
  runMode: 'account_bound';
  dataScope: 'private';
  status: 'quarantined';
  provenance: { model?: string; source?: string };
  contract: 'conversation.v1';
  payload: {
    conversation: {
      title: string; summary: string; transcript?: string;
      nextSteps: NextStep[];
      initiative: { name: string; description?: string };
    };
  };
}

export type IntakeSink = 'intake_url' | 'supabase' | 'outbox';
export interface IntakeResult { ok: boolean; sink: IntakeSink; error?: string }

export function buildConversationEnvelope(input: {
  projectName: string; summary: string; nextSteps: NextStep[];
  transcript?: string; provider?: string; model?: string;
}): ConversationEnvelope {
  const capturedAt = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: (globalThis.crypto?.randomUUID?.() ?? `cap-${capturedAt}`),
    tool: { id: RECORDER_MANIFEST.id, version: RECORDER_MANIFEST.version, source_repo: RECORDER_MANIFEST.source_repo },
    capturedAt,
    runMode: 'account_bound',
    dataScope: 'private',
    status: 'quarantined',
    provenance: { model: input.model, source: input.provider || 'local' },
    contract: 'conversation.v1',
    payload: {
      conversation: {
        title: input.projectName || 'Conversation',
        summary: input.summary,
        transcript: input.transcript,
        nextSteps: input.nextSteps,
        initiative: { name: input.projectName || 'Conversation', description: 'From a recorded conversation' },
      },
    },
  };
}

export async function addToBridge(envelope: ConversationEnvelope): Promise<IntakeResult> {
  const INTAKE_URL = env.VITE_BRIDGE_INTAKE_URL;
  const SB_URL = env.VITE_BRIDGE_SUPABASE_URL;
  const SB_KEY = env.VITE_BRIDGE_SUPABASE_ANON_KEY;
  const ACCESS = env.VITE_BRIDGE_ACCESS_TOKEN; // authenticated Bridge user JWT (required for private)

  if (INTAKE_URL) {
    try {
      const r = await fetch(INTAKE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(envelope) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return { ok: true, sink: 'intake_url' };
    } catch (e) { return { ok: false, sink: 'intake_url', error: e instanceof Error ? e.message : 'intake failed' }; }
  }
  if (SB_URL && SB_KEY) {
    try {
      const r = await fetch(`${String(SB_URL).replace(/\/$/, '')}/rest/v1/tool_captures`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SB_KEY,
          // Private captures need the authenticated user's token; without it, RLS
          // rejects (by design). Falls back to the anon key (will 401 for private).
          Authorization: `Bearer ${ACCESS || SB_KEY}`,
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          id: envelope.id, tool_id: envelope.tool.id, status: envelope.status,
          data_scope: envelope.dataScope, contract: envelope.contract,
          payload: envelope.payload, provenance: envelope.provenance, captured_at: envelope.capturedAt,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}${r.status === 401 ? ' — private capture needs an authenticated Bridge session' : ''}`);
      return { ok: true, sink: 'supabase' };
    } catch (e) { return { ok: false, sink: 'supabase', error: e instanceof Error ? e.message : 'supabase insert failed' }; }
  }
  try {
    const list = JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? '[]');
    list.unshift(envelope);
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(list.slice(0, 200)));
    return { ok: true, sink: 'outbox' };
  } catch (e) { return { ok: false, sink: 'outbox', error: e instanceof Error ? e.message : 'outbox write failed' }; }
}
