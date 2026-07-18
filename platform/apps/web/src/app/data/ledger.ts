// Governance data-access seam — reads the append-only ledger through authenticated
// Action Pipeline APIs. Browsers never query or mutate the ledger table directly.
//
// Display fields live in the row's jsonb (`inputs.display`, `proposed_output.text`) so the UI doesn't
// have to resolve actor_id/resource_id uuids — the same shape the real app would project server-side.
import { useSyncExternalStore } from 'react';
import { PILOT_WORKSPACE, trpc } from '../lib/trpc';
import { pendingApprovals, allLedger, type LedgerEntry, type Decision } from './governance';

export type LedgerSource = 'api' | 'local';
const LEDGER_PAGE_SIZE = 100;
const LEDGER_READ_WINDOW = 500;

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

function isRejectedAuditRow(row: { diff?: unknown }): boolean {
  return Boolean(asRecord(row.diff)?.rejected);
}

type LedgerHistoryPage = Awaited<ReturnType<typeof trpc.action.listHistory.query>>;
type LedgerHistoryRow = LedgerHistoryPage['items'][number];

function historyRowToEntry(row: LedgerHistoryRow): LedgerEntry {
  const inputs = asRecord(row.inputs);
  const display = asRecord(inputs?.display);
  const proposedOutput = row.proposedOutput;
  const proposedRecord = asRecord(proposedOutput);
  const trace = asRecord(display?.trace);
  const resource =
    asString(display?.resource) ??
    `${row.resourceType}${row.resourceId ? ` · ${row.resourceId}` : ''}`;
  const policy =
    asString(display?.policy) ??
    (row.policyResults
      .filter(result => result.effect === 'require_approval' || result.effect === 'block')
      .map(result => result.reason)
      .join('; ') || 'Governed action');
  const proposed =
    asString(proposedRecord?.draftBody) ??
    asString(proposedRecord?.text) ??
    (typeof proposedOutput === 'string'
      ? proposedOutput
      : JSON.stringify(proposedOutput ?? {}, null, 2));
  return {
    id: row.id,
    sourceId: asString(inputs?.sourceId) ?? undefined,
    ts: shortTs(row.createdAt),
    age: relAge(row.createdAt),
    actorKind: row.actorType === 'user' ? 'human' : 'agent',
    actor:
      asString(display?.actor) ??
      commonsAgentActorLabel(inputs, row.actorType, row.actorId) ??
      `${row.actorType} · ${row.actorId}`,
    onBehalfOfType: row.onBehalfOfType === 'user' ? 'user' : null,
    onBehalfOf:
      asString(display?.onBehalfOf) ??
      (row.onBehalfOfType === 'user' ? row.onBehalfOfId ?? null : null),
    delegationId: row.delegationId ?? asString(inputs?.delegationId),
    runId: asString(inputs?.runId),
    action: asString(display?.action) ?? row.action,
    resourceType: displayResourceType(row.resourceType),
    resource,
    policy,
    decision: normalizeDecision(row.userDecision),
    channel: asString(display?.channel) ?? undefined,
    prior: asString(display?.prior),
    proposed,
    proposalOutput: proposedOutput,
    trace: {
      signals: Array.isArray(trace?.signals)
        ? trace.signals.filter((signal): signal is string => typeof signal === 'string')
        : [],
      context:
        asString(trace?.context) ??
        `Governed ${row.action} ${normalizeDecision(row.userDecision) ? 'decision' : 'proposal'}.`,
      reasoning: asString(trace?.reasoning) ?? policy,
    },
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

function commonsAgentActorLabel(
  inputs: Record<string, unknown> | null,
  actorType: string,
  actorId: string,
): string | null {
  if (actorType !== 'agent') return null;
  const invocation = asRecord(inputs?.commonsInvocation);
  if (asString(invocation?.runtimeAgentId) !== actorId) return null;
  const moduleAgentId = asString(invocation?.moduleAgentId);
  if (!moduleAgentId) return null;
  const displayName = moduleAgentId
    .split(/[-_]/)
    .filter(Boolean)
    .map(part => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
  return `${displayName} · ${actorId}`;
}

function canonicalDecisionPrecedes(
  candidate: LedgerHistoryRow,
  current: LedgerHistoryRow,
): boolean {
  if (Boolean(candidate.refLedgerId) !== Boolean(current.refLedgerId)) {
    return Boolean(candidate.refLedgerId);
  }
  const candidateSequence =
    typeof candidate.appendSequence === 'number' ? candidate.appendSequence : Number.MAX_SAFE_INTEGER;
  const currentSequence =
    typeof current.appendSequence === 'number' ? current.appendSequence : Number.MAX_SAFE_INTEGER;
  if (candidateSequence !== currentSequence) return candidateSequence < currentSequence;
  const createdOrder = candidate.createdAt.localeCompare(current.createdAt);
  return createdOrder !== 0 ? createdOrder < 0 : candidate.id.localeCompare(current.id) < 0;
}

function displayResourceType(value: PendingProposal['request']['resourceType']): LedgerEntry['resourceType'] {
  switch (value) {
    case 'person':
    case 'initiative':
    case 'community':
    case 'relation':
    case 'ritual':
    case 'signal':
    case 'event':
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
    actor:
      asString(display?.actor) ??
      commonsAgentActorLabel(inputs, proposal.request.actor.type, proposal.request.actor.id) ??
      `${proposal.request.actor.type} · ${proposal.request.actor.id}`,
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

async function collectLedgerWindow<T>(
  load: (offset: number, limit: number) => Promise<{ items: T[]; total: number }>,
): Promise<{ items: T[]; total: number; truncated: boolean }> {
  const items: T[] = [];
  let total = 0;
  while (items.length < LEDGER_READ_WINDOW) {
    const limit = Math.min(LEDGER_PAGE_SIZE, LEDGER_READ_WINDOW - items.length);
    const page = await load(items.length, limit);
    total = page.total;
    items.push(...page.items);
    if (items.length >= total) break;
    if (page.items.length === 0) {
      throw new Error(`Ledger pagination did not advance at offset ${items.length} of ${total}`);
    }
  }
  return { items, total, truncated: items.length < total };
}

const localFallback = () => ({
  pending: pendingApprovals,
  all: allLedger,
  source: 'local' as LedgerSource,
  truncated: false,
});

export async function loadPendingApprovals(): Promise<{
  pending: LedgerEntry[];
  source: LedgerSource;
  total: number;
  truncated: boolean;
  error?: string;
}> {
  try {
    const window = await collectLedgerWindow((offset, limit) =>
      trpc.action.listPending.query({
        workspaceId: PILOT_WORKSPACE,
        limit,
        offset,
      }),
    );
    const pending = window.items.map(proposalToEntry);
    setLivePendingCount(window.total);
    return {
      pending,
      source: 'api',
      total: window.total,
      truncated: window.truncated,
      ...(window.truncated
        ? { error: `Showing the newest ${pending.length} of ${window.total} pending approvals.` }
        : {}),
    };
  } catch (cause) {
    setLivePendingCount(pendingApprovals.length);
    return {
      pending: pendingApprovals,
      source: 'local',
      total: pendingApprovals.length,
      truncated: false,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

export type OutstandingRelationshipMaterialization = Awaited<
  ReturnType<typeof trpc.relationship.outstandingMaterializations.query>
>['items'][number];

export async function loadOutstandingRelationshipMaterializations(): Promise<{
  items: OutstandingRelationshipMaterialization[];
  error?: string;
}> {
  try {
    const items: OutstandingRelationshipMaterialization[] = [];
    const seenCursors = new Set<string>();
    let cursor: { id: string } | undefined;
    do {
      const page = await trpc.relationship.outstandingMaterializations.query({
        workspaceId: PILOT_WORKSPACE,
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      items.push(...page.items);
      if (!page.nextCursor) return { items };
      if (seenCursors.has(page.nextCursor.id)) {
        throw new Error("Outstanding Relationship pagination did not advance");
      }
      seenCursors.add(page.nextCursor.id);
      cursor = page.nextCursor;
    } while (cursor);
    return { items };
  } catch (cause) {
    return {
      items: [],
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

export async function retryRelationshipMaterialization(proposalId: string) {
  return trpc.relationship.retryMaterialization.mutate({
    workspaceId: PILOT_WORKSPACE,
    proposalId,
  });
}

function editedProposalOutput(
  originalRecord: Record<string, unknown> | null,
  nextText: string,
): unknown {
  if (originalRecord?.kind === 'help_offer') {
    return { ...originalRecord, draftBody: nextText };
  }
  if (originalRecord?.kind === 'relationship_signal_evidence') {
    const parsed = JSON.parse(nextText) as unknown;
    if (asRecord(parsed)?.kind !== 'relationship_signal_evidence') {
      throw new Error('Edited Relationship output must remain a Signal evidence Relation object.');
    }
    return parsed;
  }
  if (originalRecord?.kind === 'learning_recommendation') {
    const parsed = asRecord(JSON.parse(nextText));
    if (parsed?.kind !== 'learning_recommendation') {
      throw new Error('Edited Learning output must remain a learning recommendation object.');
    }
    const canonical = { ...parsed };
    if (originalRecord.commonsInvocation === undefined) {
      delete canonical.commonsInvocation;
    } else {
      canonical.commonsInvocation = originalRecord.commonsInvocation;
    }
    return canonical;
  }
  if (originalRecord && 'text' in originalRecord) {
    return { ...originalRecord, text: nextText };
  }
  return nextText;
}

/**
 * Load the ledger. Returns:
 *  - `pending`: proposals awaiting review (user_decision null, no decision-append references them)
 *  - `all`: every proposal with its decision folded in (decision-append rows are hidden, their
 *           decision reflected on the proposal) — what the Execution Ledger shows
 *  - `source`: authenticated API or honest local empty fallback
 */
export async function loadLedger(): Promise<{
  pending: LedgerEntry[];
  all: LedgerEntry[];
  source: LedgerSource;
  truncated: boolean;
}> {
  try {
    const window = await collectLedgerWindow((offset, limit) =>
      trpc.action.listHistory.query({
        workspaceId: PILOT_WORKSPACE,
        limit,
        offset,
      }),
    );
    const data = window.items;

    // Fold only decisions linked by the server-owned refLedgerId column.
    // Null-decision referenced rows are blocked-attempt audits, not resolutions.
    const appendByProposal = new Map<string, LedgerHistoryRow>();
    const resolvingRowIds = new Set<string>();
    for (const row of data) {
      const proposalId = row.refLedgerId;
      if (proposalId && isReviewDecision(row.userDecision)) {
        const current = appendByProposal.get(proposalId);
        if (!current || canonicalDecisionPrecedes(row, current)) {
          appendByProposal.set(proposalId, row);
        }
        resolvingRowIds.add(row.id);
      }
    }
    const all = data
      .filter(row => !resolvingRowIds.has(row.id))
      .map(row => {
        const entry = historyRowToEntry(row);
        const decision = appendByProposal.get(row.id);
        if (decision && entry.decision === null) {
          const normalizedDecision = normalizeDecision(decision.userDecision);
          entry.decision = normalizedDecision;
          if (normalizedDecision === 'edited_approved') {
            const applied = historyRowToEntry(decision);
            entry.proposed = applied.proposed;
            entry.proposalOutput = applied.proposalOutput;
          }
        }
        return entry;
      });
    const pending = data
      .filter(
        row => {
          return (
            !row.refLedgerId &&
            normalizeDecision(row.userDecision) === null &&
            !isRejectedAuditRow(row) &&
            !appendByProposal.has(row.id)
          );
        },
      )
      .map(historyRowToEntry);
    setLivePendingCount(pending.length);
    return { pending, all, source: 'api', truncated: window.truncated };
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
  execution?: 'confirmed' | 'pending' | 'failed' | 'unconfirmed';
  executionError?: string;
}> {
  if (!decision) return { recorded: false };
  try {
    const originalOutput = entry.proposalOutput;
    const originalRecord = asRecord(originalOutput);
    const nextText = editedValue ?? entry.proposed;
    const editedOutput =
      decision === 'edited_approved'
        ? editedProposalOutput(originalRecord, nextText)
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
    const persistedDecision = normalizeDecision(result.recordedDecision);
    if (!persistedDecision) {
      throw new Error("The Action Pipeline did not return its persisted decision");
    }
    setLivePendingCount(Math.max(0, livePendingCount - 1));
    const relationshipStatus =
      'relationshipMaterialization' in result
        ? result.relationshipMaterialization?.status
        : undefined;
    const execution =
      relationshipStatus === 'pending'
        ? ('pending' as const)
        : result.effectsStatus;
    return {
      recorded: true,
      decision: persistedDecision,
      execution,
      ...(execution === 'failed' && 'effectsError' in result && result.effectsError
        ? { executionError: result.effectsError }
        : {}),
    };
  } catch {
    try {
      const resolution = await trpc.action.resolution.query({ proposalId: entry.id });
      if (resolution.status === 'resolved') {
        setLivePendingCount(Math.max(0, livePendingCount - 1));
        const recordedDecision = normalizeDecision(resolution.decision);
        if (
          entry.resourceType === 'relation' &&
          (recordedDecision === 'approved' ||
            recordedDecision === 'edited_approved')
        ) {
          try {
            const reconciliation =
              await trpc.relationship.reconcileApproved.mutate({
                workspaceId: PILOT_WORKSPACE,
                proposalId: entry.id,
              });
            return {
              recorded: true,
              decision: recordedDecision,
              execution:
                reconciliation.status === 'confirmed'
                  ? ('confirmed' as const)
                  : reconciliation.status === 'pending'
                    ? ('pending' as const)
                    : ('failed' as const),
              ...(reconciliation.status === 'failed'
                ? { executionError: reconciliation.error }
                : {}),
            };
          } catch (reconcileCause) {
            return {
              recorded: true,
              decision: recordedDecision,
              execution: 'unconfirmed',
              executionError:
                reconcileCause instanceof Error
                  ? reconcileCause.message
                  : String(reconcileCause),
            };
          }
        }
        return {
          recorded: true,
          decision: recordedDecision,
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
