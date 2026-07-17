// Governance data-access seam — reads the append-only `ledger` from Supabase when reachable, else
// falls back to the local governance demo data. Mirrors data/db.ts. The live `ledger` table has only
// SELECT + INSERT RLS policies (no UPDATE/DELETE) — it is append-only at the database layer — so a
// decision is recorded by APPENDING a decision row that references the proposal, never by mutating it.
//
// Display fields live in the row's jsonb (`inputs.display`, `proposed_output.text`) so the UI doesn't
// have to resolve actor_id/resource_id uuids — the same shape the real app would project server-side.
import { useSyncExternalStore } from 'react';
import { collectAllPages } from '../lib/pagination';
import { supabase } from '../lib/supabase';
import { PILOT_WORKSPACE, trpc } from '../lib/trpc';
import { pendingApprovals, allLedger, type LedgerEntry, type Decision } from './governance';

export type LedgerSource = 'api' | 'supabase' | 'local';

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
  'id, actor_type, action, resource_type, on_behalf_of_type, inputs, proposed_output, user_decision, policy_results, ref_ledger_id, diff, created_at';

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

function normalizeDecision(value: unknown): Decision {
  switch (value) {
    case 'approve':
    case 'approved':
      return 'approved';
    case 'veto':
    case 'vetoed':
      return 'vetoed';
    case 'edit':
    case 'edited_approved':
      return 'edited_approved';
    case 'auto':
    case 'auto_approved':
      return 'auto_approved';
    default:
      return null;
  }
}

function isReviewDecision(value: unknown): boolean {
  const decision = normalizeDecision(value);
  return decision === 'approved' || decision === 'vetoed' || decision === 'edited_approved';
}

function isRejectedAuditRow(row: any): boolean {
  return Boolean(asRecord(row.diff)?.rejected);
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
    decision: normalizeDecision(r.user_decision),
    channel: d.channel,
    prior: d.prior ?? null,
    proposed: (r.proposed_output && r.proposed_output.text) || '',
    trace: d.trace || { signals: [], context: '', reasoning: '' },
  };
}

type PendingProposalPage = Awaited<ReturnType<typeof trpc.action.listPending.query>>;
type PendingProposal = PendingProposalPage['items'][number];

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(value));
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function displayResourceType(value: PendingProposal['request']['resourceType']): LedgerEntry['resourceType'] {
  switch (value) {
    case 'person':
    case 'initiative':
    case 'community':
    case 'ritual':
    case 'signal':
      return value;
    case 'file':
    case 'tool':
    case 'skill':
    case 'agent':
    case 'role':
    case 'permission':
    case 'ledger':
    case 'delegation':
    case 'integration':
    case 'network_graph:full':
    case 'external:send':
    case 'external:fetch':
    case 'policy':
    case 'policy_param':
    case 'touchpoint':
      return 'external';
  }
}

function proposalToEntry(proposal: PendingProposal): LedgerEntry {
  const inputs = asRecord(proposal.request.inputs);
  const display = asRecord(inputs?.display);
  const output = asRecord(proposal.output);
  const proposedOutput = output?.proposedOutput;
  const proposedRecord = asRecord(proposedOutput);
  const routeEvidence = asRecord(proposedRecord?.routeEvidence);
  const trace = asRecord(display?.trace);
  const createdAt = String(proposal.createdAt);
  const matchedPerson = asString(routeEvidence?.displayName);
  const resource =
    asString(display?.resource) ??
    (proposedRecord?.kind === 'help_offer' && matchedPerson
      ? `Help Offer for ${matchedPerson}`
      : `${proposal.request.resourceType}${proposal.request.resourceId ? ` · ${proposal.request.resourceId}` : ''}`);
  const proposed =
    asString(proposedRecord?.draftBody) ??
    asString(proposedRecord?.text) ??
    (typeof proposedOutput === 'string' ? proposedOutput : JSON.stringify(proposedOutput ?? {}, null, 2));
  const policy = asString(display?.policy) ?? (
    proposal.policyResults
      .filter(result => result.effect === 'require_approval' || result.effect === 'block')
      .map(result => result.reason)
      .join('; ') || 'Human review required'
  );

  return {
    id: proposal.id,
    sourceId: asString(inputs?.sourceId) ?? undefined,
    ts: shortTs(createdAt),
    age: relAge(createdAt),
    actorKind: proposal.request.actor.type === 'agent' ? 'agent' : 'human',
    actor: asString(display?.actor) ?? `${proposal.request.actor.type} · ${proposal.request.actor.id}`,
    onBehalfOfType: proposal.request.onBehalfOf ? 'user' : null,
    onBehalfOf: proposal.request.onBehalfOf
      ? asString(display?.onBehalfOf) ?? proposal.request.onBehalfOf.id
      : null,
    delegationId: asString(inputs?.delegationId),
    runId: asString(inputs?.runId),
    action: asString(display?.action) ?? proposal.request.action,
    resourceType: displayResourceType(proposal.request.resourceType),
    resource,
    policy,
    decision: null,
    channel: asString(display?.channel) ?? (proposedRecord?.kind === 'help_offer' ? 'Helpdesk' : undefined),
    prior: asString(display?.prior),
    proposed,
    trace: {
      signals: Array.isArray(trace?.signals)
        ? trace.signals.filter((signal): signal is string => typeof signal === 'string')
        : [],
      context: asString(trace?.context) ?? `Governed ${proposal.request.action} proposal awaiting review.`,
      reasoning: asString(trace?.reasoning) ?? policy,
    },
    proposalOutput: proposedOutput,
  };
}

const localFallback = () => ({ pending: pendingApprovals, all: allLedger, source: 'local' as LedgerSource });

export async function loadPendingApprovals(): Promise<{
  pending: LedgerEntry[];
  source: LedgerSource;
  error?: string;
}> {
  try {
    const proposals = await collectAllPages(async (offset, limit) => {
      const page = await trpc.action.listPending.query({
        workspaceId: PILOT_WORKSPACE,
        limit,
        offset,
      });
      return {
        ...page,
        hasMore: offset + page.items.length < page.total,
      };
    });
    const pending = proposals.map(proposalToEntry);
    setLivePendingCount(pending.length);
    return { pending, source: 'api' };
  } catch (cause) {
    setLivePendingCount(pendingApprovals.length);
    return {
      pending: pendingApprovals,
      source: 'local',
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

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

    // Fold current ref_ledger_id decisions and legacy inputs.proposal_id decisions.
    // Null-decision referenced rows are blocked-attempt audits, not resolutions.
    const appendByProposal = new Map<string, any>();
    const resolvingRowIds = new Set<string>();
    for (const r of data) {
      const pid = r.ref_ledger_id || (r.inputs && r.inputs.proposal_id);
      if (pid && isReviewDecision(r.user_decision)) {
        if (!appendByProposal.has(pid)) appendByProposal.set(pid, r);
        resolvingRowIds.add(r.id);
      }
    }
    const all = data
      .filter(r => !resolvingRowIds.has(r.id))
      .map(r => {
        const e = rowToEntry(r);
        const ap = appendByProposal.get(r.id);
        if (ap && e.decision === null) e.decision = normalizeDecision(ap.user_decision);
        return e;
      });
    const pending = data
      .filter(
        r =>
          !r.ref_ledger_id &&
          !(r.inputs && r.inputs.proposal_id) &&
          normalizeDecision(r.user_decision) === null &&
          !isRejectedAuditRow(r) &&
          !appendByProposal.has(r.id),
      )
      .map(rowToEntry);
    setLivePendingCount(pending.length);
    return { pending, all, source: 'supabase' };
  } catch {
    setLivePendingCount(pendingApprovals.length);
    return localFallback();
  }
}

/**
 * Resolve a proposal through the authenticated Action Pipeline. The pipeline appends
 * the decision row and performs the approved commit; there is no browser-side write fallback.
 */
export async function recordDecisionAppend(
  entry: LedgerEntry,
  decision: Decision,
  reason?: string,
  editedValue?: string,
): Promise<{
  recorded: boolean;
  decision?: Decision;
  execution?: 'confirmed' | 'failed' | 'unconfirmed';
  executionError?: string;
}> {
  if (!decision) return { recorded: false };
  try {
    const originalOutput = entry.proposalOutput;
    const originalRecord = asRecord(originalOutput);
    const nextText = editedValue ?? entry.proposed;
    const editedOutput =
      decision === 'edited_approved'
        ? originalRecord?.kind === 'help_offer'
          ? { ...originalRecord, draftBody: nextText }
          : originalRecord && 'text' in originalRecord
            ? { ...originalRecord, text: nextText }
            : nextText
        : undefined;
    const result = await trpc.action.decide.mutate({
      proposalId: entry.id,
      decision:
        decision === 'vetoed'
          ? 'veto'
          : decision === 'edited_approved'
            ? 'edit'
            : 'approve',
      ...(editedOutput !== undefined ? { editedOutput } : {}),
      ...(reason ? { reason } : {}),
    });
    setLivePendingCount(Math.max(0, livePendingCount - 1));
    return {
      recorded: true,
      decision,
      execution: result.effectsStatus,
      ...("effectsError" in result && result.effectsError ? { executionError: result.effectsError } : {}),
    };
  } catch {
    try {
      const resolution = await trpc.action.resolution.query({ proposalId: entry.id });
      if (resolution.status === 'resolved') {
        setLivePendingCount(Math.max(0, livePendingCount - 1));
        return {
          recorded: true,
          decision: normalizeDecision(resolution.decision),
          execution: 'unconfirmed',
        };
      }
    } catch {
      // Preserve the pending row when neither the decision nor its current state can be confirmed.
    }
    return { recorded: false };
  }
}

/**
 * Ask the server-owned Outreach Agent to stage a pending Touchpoint through the
 * Action Pipeline. A failed or unavailable API never falls back to a browser ledger write.
 */
export type StagedProposal =
  | { proposalId: string; status: 'pending' }
  | { proposalId: string; status: 'resolved'; decision: Exclude<Decision, null> };

export async function proposeToLedger(entry: LedgerEntry): Promise<StagedProposal | null> {
  try {
    const proposal = await trpc.action.proposeOutreachDraft.mutate({
      workspaceId: PILOT_WORKSPACE,
      sourceId: entry.id,
      label: entry.action,
      resource: entry.resource,
      proposed: entry.proposed,
      ...(entry.channel ? { channel: entry.channel } : {}),
      ...(entry.prior !== undefined ? { prior: entry.prior } : {}),
      ...(entry.runId ? { runId: entry.runId } : {}),
      trace: entry.trace,
    });
    if (proposal.status === 'pending_review') {
      setLivePendingCount(livePendingCount + 1);
      return { proposalId: proposal.id, status: 'pending' as const };
    }
    if (proposal.status === 'already_resolved') {
      const decision = normalizeDecision(proposal.decision);
      if (!decision) return null;
      return { proposalId: proposal.id, status: 'resolved' as const, decision };
    }
    return null;
  } catch {
    return null;
  }
}
