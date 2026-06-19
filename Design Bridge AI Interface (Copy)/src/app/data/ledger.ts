// Governance data-access seam — reads the append-only `ledger` from Supabase when reachable, else
// falls back to the local governance demo data. Mirrors data/db.ts. The live `ledger` table has only
// SELECT + INSERT RLS policies (no UPDATE/DELETE) — it is append-only at the database layer — so a
// decision is recorded by APPENDING a decision row that references the proposal, never by mutating it.
//
// Display fields live in the row's jsonb (`inputs.display`, `proposed_output.text`) so the UI doesn't
// have to resolve actor_id/resource_id uuids — the same shape the real app would project server-side.
import { useSyncExternalStore } from 'react';
import { supabase } from '../lib/supabase';
import { API_ENABLED, apiPropose, apiDecide } from './api';
import { pendingApprovals, allLedger, type LedgerEntry, type Decision } from './governance';

export type LedgerSource = 'supabase' | 'local';

const PILOT_WORKSPACE = 'b0000000-0000-4000-a000-000000000001';
const DEMO_USER = 'e0f0053b-fc44-476e-be27-1371e179e958';
const OUTREACH_AGENT = 'b0000000-0000-4000-a000-0000000000d1'; // agent actor that surfaces proposals

// Reactive count of pending ledger rows, so the nav badge matches the Approvals page (single source).
let livePendingCount = pendingApprovals.length;
const countSubs = new Set<() => void>();
function setLivePendingCount(n: number) {
  if (n === livePendingCount) return;
  livePendingCount = n;
  countSubs.forEach(fn => fn());
}
export function useLivePendingCount(): number {
  return useSyncExternalStore(
    fn => { countSubs.add(fn); return () => { countSubs.delete(fn); }; },
    () => livePendingCount,
    () => livePendingCount,
  );
}

const LEDGER_COLS =
  'id, actor_type, action, resource_type, on_behalf_of_type, inputs, proposed_output, user_decision, policy_results, created_at';

function relAge(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

function shortTs(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

// One ledger row (jsonb display payload) → the UI's LedgerEntry shape.
function rowToEntry(r: any): LedgerEntry {
  const d = (r.inputs && r.inputs.display) || {};
  return {
    id: r.id,
    ts: shortTs(r.created_at),
    age: relAge(r.created_at),
    actorKind: d.actorKind || r.actor_type || 'agent',
    actor: d.actor || r.actor_type || 'Agent',
    onBehalfOfType: r.on_behalf_of_type || null,
    onBehalfOf: d.onBehalfOf ?? null,
    delegationId: null,
    runId: (r.inputs && r.inputs.runId) || null,
    action: r.action,
    resourceType: r.resource_type,
    resource: d.resource || '',
    policy: d.policy || '—',
    decision: (r.user_decision as Decision) ?? null,
    channel: d.channel,
    prior: d.prior ?? null,
    proposed: (r.proposed_output && r.proposed_output.text) || '',
    trace: d.trace || { signals: [], context: '', reasoning: '' },
  };
}

const localFallback = () => ({ pending: pendingApprovals, all: allLedger, source: 'local' as LedgerSource });

/**
 * Load the ledger. Returns:
 *  - `pending`: proposals awaiting review (user_decision null, no decision-append references them)
 *  - `all`: every proposal with its decision folded in (decision-append rows are hidden, their
 *           decision reflected on the proposal) — what the Execution Ledger shows
 *  - `source`: 'supabase' | 'local'
 */
export async function loadLedger(): Promise<{ pending: LedgerEntry[]; all: LedgerEntry[]; source: LedgerSource }> {
  try {
    const { data, error } = await supabase
      .from('ledger')
      .select(LEDGER_COLS)
      .order('created_at', { ascending: false });
    if (error || !data || data.length === 0) { setLivePendingCount(pendingApprovals.length); return localFallback(); }

    // Fold decision-append rows (inputs.proposal_id set) onto their proposals.
    const appendByProposal = new Map<string, any>();
    for (const r of data) {
      const pid = r.inputs && r.inputs.proposal_id;
      if (pid) appendByProposal.set(pid, r);
    }
    const all = data
      .filter(r => !(r.inputs && r.inputs.proposal_id)) // hide standalone decision rows
      .map(r => {
        const e = rowToEntry(r);
        const ap = appendByProposal.get(r.id);
        if (ap && e.decision === null) e.decision = (ap.user_decision as Decision) ?? null;
        return e;
      });
    const pending = all.filter(e => e.decision === null);
    setLivePendingCount(pending.length);
    return { pending, all, source: 'supabase' };
  } catch {
    setLivePendingCount(pendingApprovals.length);
    return localFallback();
  }
}

/**
 * Record a decision by APPENDING a new ledger row that references the proposal (append-only — the
 * table has no UPDATE policy). Returns true if the append succeeded against Supabase.
 */
export async function recordDecisionAppend(entry: LedgerEntry, decision: Decision, reason?: string): Promise<boolean> {
  // Governed path (#8): resolve through the pipeline, which appends the decision row itself.
  if (API_ENABLED && decision) {
    try {
      const edited = decision === 'edited_approved' ? { text: entry.proposed } : undefined;
      if (await apiDecide(entry.id, decision, edited)) {
        setLivePendingCount(Math.max(0, livePendingCount - 1));
        return true;
      }
    } catch {
      /* fall through to the direct-Supabase append below */
    }
  }
  try {
    const { error } = await supabase.from('ledger').insert({
      workspace_id: PILOT_WORKSPACE,
      actor_type: 'human',
      actor_id: DEMO_USER,
      action: 'decision',
      resource_type: entry.resourceType,
      inputs: {
        seed: 'a3',
        proposal_id: entry.id,
        reason: reason ?? null,
        display: {
          actor: 'You',
          actorKind: 'human',
          resource: entry.resource,
          policy: entry.policy,
          channel: entry.channel,
        },
      },
      proposed_output: { text: entry.proposed },
      user_decision: decision,
      created_at: new Date().toISOString(),
    });
    if (!error) setLivePendingCount(Math.max(0, livePendingCount - 1));
    return !error;
  } catch {
    return false;
  }
}

/**
 * Propose a signal-driven action by INSERTing a PENDING ledger row (user_decision null) — the same
 * append-only path the real agent would use. Mirrors the seeded proposal shape so loadLedger() and the
 * Approvals inbox pick it up identically. Returns true if the insert succeeded against Supabase; the
 * caller falls back to the local draft store when offline. (A3b — closes the Signal → live-ledger loop.)
 */
export async function proposeToLedger(entry: LedgerEntry): Promise<boolean> {
  // Governed path (#8): the pipeline runs authority → policy → skill → draft and appends the
  // pending_review ledger row itself. Falls back to the direct insert below when the API is off.
  if (API_ENABLED) {
    try {
      const r = await apiPropose(entry);
      if (r && r.status !== 'rejected') {
        setLivePendingCount(livePendingCount + 1);
        return true;
      }
      if (r && r.status === 'rejected') return false; // governance denied — surface as no-op
    } catch {
      /* fall through to the direct-Supabase insert below */
    }
  }
  try {
    const { error } = await supabase.from('ledger').insert({
      workspace_id: PILOT_WORKSPACE,
      actor_type: 'agent',
      actor_id: OUTREACH_AGENT,
      on_behalf_of_type: 'user',
      on_behalf_of_id: DEMO_USER,
      action: entry.action,
      resource_type: entry.resourceType,
      inputs: {
        seed: 'a3b',
        signal_id: entry.id,
        runId: entry.runId ?? null,
        display: {
          actor: entry.actor,
          actorKind: 'agent',
          onBehalfOf: 'You',
          resource: entry.resource,
          policy: entry.policy,
          channel: entry.channel,
          prior: entry.prior ?? null,
          trace: entry.trace,
        },
      },
      proposed_output: { text: entry.proposed },
      user_decision: null,
      created_at: new Date().toISOString(),
    });
    if (!error) { setLivePendingCount(livePendingCount + 1); return true; }
    return false;
  } catch {
    return false;
  }
}
