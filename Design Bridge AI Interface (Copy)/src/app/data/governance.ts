// Governance mock data — shapes mirror SCHEMA.sql v2 (ledger · decision_traces · delegations · policies).
// F2 (Approvals inbox) reads the PENDING slice (decision === null); F3 (Execution Ledger) reads the full
// append-only history. One source so the live queue and the archive stay coupled, exactly like the real
// `ledger` table would. NOTE: no naked relationship scores anywhere — warmth is phrased qualitatively.

export type ActorKind = 'agent' | 'human';
export type Decision = 'approved' | 'vetoed' | 'edited_approved' | 'auto_approved' | null;
export type PolicyPhase = 'pre' | 'runtime' | 'post';

export interface PolicyResult {
  phase: PolicyPhase;
  policy: string;        // policies.name
  result: 'pass' | 'flag' | 'block';
  note?: string;
}

export interface DecisionTrace {
  // decision_traces — the *why* behind a proposed action (1:1 with a ledger row)
  signals: string[];     // the Signals that fired
  context: string;       // qualitative context the agent used
  reasoning: string;     // the agent's rationale, in plain language
}

export interface LedgerEntry {
  id: string;
  ts: string;            // ISO-ish display timestamp
  age: string;           // humanized age for the queue
  actorKind: ActorKind;
  actor: string;         // who proposed it (agent or human name)
  // provenance: on-behalf-of + delegation + ritual run (ledger.on_behalf_of_*, delegation_id, run_id)
  onBehalfOfType?: 'user' | null;
  onBehalfOf?: string | null;
  delegationId?: string | null;
  runId?: string | null;
  action: string;        // verb, e.g. "Send intro email"
  resourceType: 'person' | 'initiative' | 'community' | 'ritual' | 'external';
  resource: string;      // target label, e.g. "Priya Anand"
  policy: string;        // the policy that forced review (policies.name)
  decision: Decision;    // null === pending (awaiting review)
  // proposed output + optional prior version for the diff drawer
  proposed: string;
  prior?: string | null;
  trace: DecisionTrace;
  channel?: string;      // e.g. "Email", "Calendar"
}

// ── PENDING (F2 Approvals inbox) — ledger rows where decision IS NULL ─────────────
export const pendingApprovals: LedgerEntry[] = [
  {
    id: 'led_0a91',
    ts: 'dummy_9009-9009-9009 9009:9009',
    age: 'dummy_9009m',
    actorKind: 'agent',
    actor: 'dummy_Reconnect Advisor',
    onBehalfOfType: 'user',
    onBehalfOf: 'dummy_Priya Anand',
    delegationId: 'dlg_77',
    runId: 'run_recon_0531',
    action: 'dummy_Send reconnect email',
    resourceType: 'person',
    resource: 'dummy_Marcus Webb',
    policy: 'dummy_Outbound message requires review',
    decision: null,
    channel: 'dummy_Email',
    prior:
      'dummy_Hi Marcus,\n\nIt has been a while. We should catch up sometime — let me know when you are free.\n\nPriya',
    proposed:
      'dummy_Hi Marcus,\n\nI was just reading about Helio’s Series B — congratulations, that’s a huge milestone for the team. It reminded me we hadn’t spoken since the Lisbon offsite.\n\nWould you be open to a short call in the next couple of weeks? I’d love to hear how scaling has been going.\n\nWarmly,\nPriya',
    trace: {
      signals: ['dummy_Long-dormant relationship', 'dummy_Public funding announcement (Helio Series B)'],
      context: 'dummy_A long-dormant but historically close relationship; last meaningful touchpoint was the Lisbon offsite.',
      reasoning:
        'dummy_Surfaced the funding milestone as a genuine, specific reason to reach out rather than a generic check-in. Kept the ask small (a short call) to respect a dormant tie.',
    },
  },
  {
    id: 'led_0a93',
    ts: 'dummy_9009-9009-9009 9009:9009',
    age: 'dummy_9009m',
    actorKind: 'agent',
    actor: 'dummy_Event Coordinator',
    onBehalfOfType: 'user',
    onBehalfOf: 'dummy_You',
    delegationId: 'dlg_12',
    runId: 'run_evt_0531',
    action: 'dummy_Schedule intro call',
    resourceType: 'initiative',
    resource: 'dummy_Atlas Fund II — LP outreach',
    policy: 'dummy_Calendar action on behalf of principal requires review',
    decision: null,
    channel: 'dummy_Calendar',
    prior: null,
    proposed:
      'dummy_Hold 9009 min — Tuesday Jun 9009, 9009:9009pm PT with Dana Cole (introductory call). Agenda: fund thesis, Q9009 timeline, follow-up materials.',
    trace: {
      signals: ['dummy_Open thread > 9009 days', 'dummy_Initiative milestone approaching'],
      context: 'dummy_Dana replied positively last week; the LP-outreach initiative has a milestone this month.',
      reasoning:
        'dummy_Proposed a slot inside the principal’s stated working hours and left the invite unsent pending approval — no calendar hold is placed until you approve.',
    },
  },
  {
    id: 'led_0a95',
    ts: 'dummy_9009-9009-9009 9009:9009',
    age: 'dummy_9009h 9009m',
    actorKind: 'agent',
    actor: 'dummy_Community Mapper',
    onBehalfOfType: null,
    onBehalfOf: null,
    delegationId: null,
    runId: 'run_comm_0531',
    action: 'dummy_Add Person to Community',
    resourceType: 'community',
    resource: 'dummy_Climate-tech founders',
    policy: 'dummy_Membership change requires review',
    decision: null,
    channel: 'dummy_Internal',
    prior: null,
    proposed:
      'dummy_Add “Elena Rost” to Community “Climate-tech founders” based on three shared events and an overlapping co-investor.',
    trace: {
      signals: ['dummy_Co-attendance at 9009 events', 'dummy_Shared co-investor edge'],
      context: 'dummy_Elena shows strong overlap with the existing community but is not yet a member.',
      reasoning:
        'dummy_Membership is a structural change to a Community, so it is routed for review rather than applied silently. Suggested, not asserted.',
    },
  },
];

// ── HISTORY (F3 Execution Ledger) — append-only, decisions already made ───────────
export const ledgerHistory: LedgerEntry[] = [
  {
    id: 'led_0a72',
    ts: 'dummy_9009-9009-9009 9009:9009',
    age: 'dummy_9009h',
    actorKind: 'agent',
    actor: 'dummy_Reconnect Advisor',
    onBehalfOfType: 'user',
    onBehalfOf: 'dummy_Priya Anand',
    delegationId: 'dlg_77',
    runId: 'run_recon_0530',
    action: 'dummy_Send reconnect email',
    resourceType: 'person',
    resource: 'dummy_Aisha Karim',
    policy: 'dummy_Outbound message requires review',
    decision: 'edited_approved',
    channel: 'dummy_Email',
    prior: 'dummy_Hi Aisha, long time! Want to catch up?',
    proposed:
      'dummy_Hi Aisha,\n\nCongratulations on the new role at Vantage — well deserved. Would love to reconnect over coffee when you have a moment.\n\nPriya',
    trace: {
      signals: ['dummy_Job-change signal (Vantage)', 'dummy_Warm relationship'],
      context: 'dummy_A warm, recently-active relationship with a fresh job-change signal.',
      reasoning: 'dummy_Anchored the outreach on the specific job change. Reviewer tightened the closing line before approving.',
    },
  },
  {
    id: 'led_0a68',
    ts: 'dummy_9009-9009-9009 9009:9009',
    age: 'dummy_9009h',
    actorKind: 'agent',
    actor: 'dummy_Outreach Agent',
    onBehalfOfType: 'user',
    onBehalfOf: 'dummy_You',
    delegationId: 'dlg_04',
    runId: 'run_out_0530',
    action: 'dummy_Send external email',
    resourceType: 'external',
    resource: 'dummy_press@competitor.com',
    policy: 'dummy_External recipient outside network',
    decision: 'vetoed',
    channel: 'dummy_Email',
    prior: null,
    proposed: 'dummy_Draft outreach to an external press contact regarding the fund announcement.',
    trace: {
      signals: ['dummy_Outbound to non-network recipient'],
      context: 'dummy_Recipient is outside the trusted network and flagged by policy.',
      reasoning: 'dummy_Agent proposed; reviewer vetoed as out of scope. Veto reason "wrong recipient" was recorded to tune future drafts.',
    },
  },
  {
    id: 'led_0a55',
    ts: 'dummy_9009-9009-9009 9009:9009',
    age: 'dummy_9009h',
    actorKind: 'human',
    actor: 'dummy_Priya Anand',
    onBehalfOfType: null,
    onBehalfOf: null,
    delegationId: null,
    runId: null,
    action: 'dummy_Update relationship note',
    resourceType: 'person',
    resource: 'dummy_Marcus Webb',
    policy: 'dummy_—',
    decision: 'approved',
    channel: 'dummy_Internal',
    prior: null,
    proposed: 'dummy_Added a private note after the Lisbon offsite.',
    trace: {
      signals: ['dummy_Manual edit'],
      context: 'dummy_Direct human action, logged for the audit trail.',
      reasoning: 'dummy_Human-authored change; recorded for completeness and tamper-evidence.',
    },
  },
  {
    id: 'led_0a40',
    ts: 'dummy_9009-9009-9009 9009:9009',
    age: 'dummy_9009d 9009h',
    actorKind: 'agent',
    actor: 'dummy_Memory Keeper',
    onBehalfOfType: null,
    onBehalfOf: null,
    delegationId: null,
    runId: 'run_mem_0529',
    action: 'dummy_Summarize touchpoint',
    resourceType: 'person',
    resource: 'dummy_Dana Cole',
    policy: 'dummy_Auto-approved (read-only, within policy)',
    decision: 'auto_approved',
    channel: 'dummy_Internal',
    prior: null,
    proposed: 'dummy_Generated a Memory summary of last week’s call with Dana Cole.',
    trace: {
      signals: ['dummy_New touchpoint recorded'],
      context: 'dummy_A read-only summarization fully inside policy.',
      reasoning: 'dummy_No outbound side-effect and read-only, so the policy engine auto-approved without human review.',
    },
  },
];

export const allLedger: LedgerEntry[] = [...pendingApprovals, ...ledgerHistory];

// delegations — resolves the "on whose behalf" question (delegations table)
export const delegations: Record<string, { from: string; to: string; scope: string }> = {
  dlg_77: { from: 'dummy_Priya Anand', to: 'dummy_Reconnect Advisor', scope: 'dummy_Reconnect rituals · outbound email' },
  dlg_12: { from: 'dummy_You', to: 'dummy_Event Coordinator', scope: 'dummy_Calendar scheduling within working hours' },
  dlg_04: { from: 'dummy_You', to: 'dummy_Outreach Agent', scope: 'dummy_Outbound email to network contacts' },
};

export const pendingCount = pendingApprovals.length;

// Veto reason chips → feed the Variance Adjuster (policy_params), never code.
export const vetoReasons = ['dummy_Too casual', 'dummy_Wrong recipient', 'dummy_Bad timing', 'dummy_Off-strategy', 'dummy_Tone'];

export function decisionLabel(d: Decision): string {
  switch (d) {
    case 'approved': return 'Approved';
    case 'vetoed': return 'Vetoed';
    case 'edited_approved': return 'Edited + approved';
    case 'auto_approved': return 'Auto-approved';
    default: return 'Pending';
  }
}

// token name for a decision's color (kept qualitative, no numeric scores)
export function decisionToken(d: Decision): string {
  switch (d) {
    case 'approved':
    case 'edited_approved': return 'var(--success)';
    case 'vetoed': return 'var(--danger)';
    case 'auto_approved': return 'var(--info)';
    default: return 'var(--warning)';
  }
}
