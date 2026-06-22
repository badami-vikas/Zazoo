// @bridge/api seam (#8) — routes Signal→propose and Approvals→decide through the GOVERNED
// Universal Action Pipeline instead of inserting straight into the `ledger` table.
//
// The pipeline (apps/api) is the only writer: it runs authority → policy → skill →
// draft-then-approve → append-only ledger. When the API is configured (VITE_API_URL) AND it
// holds DATABASE_URL pointing at the same Supabase project, proposals/decisions land in the
// SAME `ledger` the prototype reads — so the loop is fully governed end-to-end.
//
// Default OFF: with no VITE_API_URL the helpers report "unavailable" and callers fall back to
// the existing direct-Supabase path (data/ledger.ts) — zero behavior change when the API isn't up.
import type { LedgerEntry, Decision } from './governance';

const API_URL = import.meta.env.VITE_API_URL || ''; // e.g. http://localhost:4000
export const API_ENABLED = Boolean(API_URL);
const TRPC = `${API_URL}/trpc`;

// Pilot identities (uuids) — the agent that surfaces proposals, on behalf of the signed-in user.
// Must be real uuids: the pipeline writes them into Postgres `uuid` columns.
const PILOT_WORKSPACE = 'b0000000-0000-4000-a000-000000000001';
const OUTREACH_AGENT = 'b0000000-0000-4000-a000-0000000000d1';
const DEMO_USER = 'e0f0053b-fc44-476e-be27-1371e179e958';

// One unbatched tRPC mutation. No data transformer is configured server-side, so input is sent
// raw and the result rides at `result.data`. Throws on transport or procedure error.
async function mutate<T = unknown>(path: string, input: unknown): Promise<T> {
  const res = await fetch(`${TRPC}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => ({}));
  if (body?.error) throw new Error(body.error?.message || body.error?.json?.message || `trpc ${path} error`);
  if (!res.ok) throw new Error(`trpc ${path} HTTP ${res.status}`);
  return body?.result?.data as T;
}

// One unbatched tRPC query (GET). Input rides as a urlencoded `?input=` param; result at `result.data`.
async function query<T = unknown>(path: string, input?: unknown): Promise<T> {
  const qs = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`;
  const res = await fetch(`${TRPC}/${path}${qs}`, { headers: { 'content-type': 'application/json' } });
  const body = await res.json().catch(() => ({}));
  if (body?.error) throw new Error(body.error?.message || body.error?.json?.message || `trpc ${path} error`);
  if (!res.ok) throw new Error(`trpc ${path} HTTP ${res.status}`);
  return body?.result?.data as T;
}

// ── Integration permissions (the `integration` sub-router) ─────────────────────
// Governed, user-editable scopes for a connected integration. Each helper reports "unavailable"
// (null/false) when the API is OFF, so the Permissions panel falls back to its offline mirror.
export interface ApiScopeGrant {
  id: string;
  resourceType: string;
  action: string;
  effect: string;
  expiresAt: string | null;
}

/** Active (non-revoked) standing grants held by an integration. */
export async function apiListScopes(integrationId: string): Promise<ApiScopeGrant[] | null> {
  if (!API_ENABLED) return null;
  return query<ApiScopeGrant[]>('integration.listScopes', { workspaceId: PILOT_WORKSPACE, integrationId });
}

/** Grant a standing Bridge capability. The server refuses agent-floor DENY scopes (FORBIDDEN). */
export async function apiGrantScope(a: {
  integrationId: string;
  resourceType: string;
  action: string;
}): Promise<ApiScopeGrant | null> {
  if (!API_ENABLED) return null;
  return mutate<ApiScopeGrant>('integration.grantScope', { workspaceId: PILOT_WORKSPACE, ...a });
}

/** Narrow access: revoke a single standing grant (append-only — sets revoked_at server-side). */
export async function apiRevokeScope(permissionId: string): Promise<boolean> {
  if (!API_ENABLED) return false;
  await mutate('integration.revokeScope', { workspaceId: PILOT_WORKSPACE, permissionId });
  return true;
}

interface ProposeResult {
  id: string;
  status: 'pending_review' | 'applied' | 'rejected';
  rejectionReason?: string;
}

// A signal-driven draft is a Touchpoint the agent stages for human review (draft-then-approve) —
// NOT a direct external send. `touchpoint:write` is inside the Outreach Agent's capability scope,
// so authority passes and the row lands as pending_review. Display payload mirrors the A3b shape
// so loadLedger()/the Approvals inbox render it identically.
export async function apiPropose(entry: LedgerEntry): Promise<ProposeResult | null> {
  if (!API_ENABLED) return null;
  return mutate<ProposeResult>('action.propose', {
    workspaceId: PILOT_WORKSPACE,
    actor: { type: 'agent', id: OUTREACH_AGENT },
    onBehalfOf: { type: 'user', id: DEMO_USER },
    action: 'write',
    resourceType: 'touchpoint',
    skill: 'stageMutation',
    dataScope: 'public',
    inputs: {
      signal_id: entry.id,
      runId: entry.runId ?? null,
      text: entry.proposed,
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
    ...(entry.runId ? { context: { type: 'ritual', id: entry.runId } } : {}),
  });
}

// Map the UI's Decision vocabulary → the pipeline's decide verbs.
function toVerb(d: Decision): 'approve' | 'veto' | 'edit' | null {
  switch (d) {
    case 'approved':
    case 'auto_approved':
      return 'approve';
    case 'edited_approved':
      return 'edit';
    case 'vetoed':
      return 'veto';
    default:
      return null;
  }
}

// Resolve a pending proposal through the pipeline: it appends a NEW decision row referencing the
// proposal (append-only) and commits/varies per policy. `proposalId` is the live ledger row id (uuid).
export async function apiDecide(
  proposalId: string,
  decision: Decision,
  editedOutput?: unknown,
): Promise<boolean> {
  const verb = toVerb(decision);
  if (!API_ENABLED || !verb) return false;
  await mutate('action.decide', {
    proposalId,
    decision: verb,
    ...(verb === 'edit' && editedOutput !== undefined ? { editedOutput } : {}),
  });
  return true;
}

// ── Gmail + Google Calendar integration ───────────────────────────────────────
// All default OFF (no VITE_API_URL → null), so the prototype renders a "connect a
// platform API" state instead of erroring. The platform is the only writer.

export interface IntegrationConnection {
  connected: boolean;
  scopes: string[];
  connectedAt?: string;
}
export interface IntegrationListResult {
  oauthConfigured: boolean;
  gatewayKind: 'google' | 'unconfigured';
  integrationId: string;
  connection: IntegrationConnection;
  surfaces: { provider: string; name: string }[];
  manifest: {
    capabilities: { resourceType: string; action: string; dataScope: string; egress: boolean }[];
    output_contract: { from: string; to: string; note?: string }[];
    intake_policy: { quarantine: boolean; commit_via: string };
  };
}
export interface IntakeProposalSummary {
  proposalId: string;
  status: string;
  resourceType: string;
  sourceRecordId: string;
  match: 'linked' | 'new' | 'ambiguous';
  resource: string;
}
export interface IntakeResult {
  source: string;
  sourced: number;
  fetchProposalId: string;
  proposals: IntakeProposalSummary[];
}

/** Live connection + manifest for the Google integration. null when API disabled. */
export async function apiIntegrationList(): Promise<IntegrationListResult | null> {
  if (!API_ENABLED) return null;
  return query<IntegrationListResult>('google.list');
}

/** Get the Google consent URL (read+write, offline). Caller redirects the browser. */
export async function apiConnectGoogle(): Promise<{ url: string | null; error?: string } | null> {
  if (!API_ENABLED) return null;
  return mutate<{ url: string | null; error?: string }>('google.connectUrl', {});
}

export async function apiDisconnectGoogle(): Promise<boolean> {
  if (!API_ENABLED) return false;
  await mutate('google.disconnect', {});
  return true;
}

/** Source Gmail through the gate → returns the Touchpoint/Memory/Signal proposals. */
export async function apiSyncGmail(maxResults?: number): Promise<IntakeResult | null> {
  if (!API_ENABLED) return null;
  return mutate<IntakeResult>('google.syncGmail', maxResults ? { maxResults } : {});
}

export async function apiSyncCalendar(maxResults?: number): Promise<IntakeResult | null> {
  if (!API_ENABLED) return null;
  return mutate<IntakeResult>('google.syncCalendar', maxResults ? { maxResults } : {});
}

/** Compose an outbound email/event as a DRAFT → external:send proposal (>= L2 approval). */
export async function apiProposeSend(
  kind: 'email' | 'calendar',
  envelope: Record<string, unknown>,
): Promise<{ id: string; status: string } | null> {
  if (!API_ENABLED) return null;
  return mutate<{ id: string; status: string }>('google.proposeSend', { kind, envelope });
}

// ── Agent + Ritual authoring (layered, gated permissions) ──────────────────────
// All default OFF (no VITE_API_URL → null), so the create/edit pages fall back to local
// state and stay demoable. When the API is up, these route through the governed pipeline,
// which is the only writer of agent authority + ritual definitions.
//
// agent-floor (external:send DENY, action:approve DENY) and the ritual ⊆ agent scope
// constraint are re-enforced server-side regardless of what the UI sends.

export type AgentDataScope = 'all' | 'public' | 'private';
export type AgentEgressTier = 'none' | 'read-graph' | 'draft-graph' | 'source-internet';

export interface AgentPermissionInput {
  name: string;
  capabilityScope: string[];
  allowedSkills: string[];
  dataScope: AgentDataScope;
  egressTier: AgentEgressTier;
}

export interface AgentRecord {
  agentId: string;
  name: string;
  capabilityScope: string[];
  allowedSkills: string[];
  dataScope: AgentDataScope;
  egressTier: AgentEgressTier;
}

export interface RitualStepInput {
  skill: string;
  action: string;
  resourceType: string;
  dataScope: AgentDataScope;
}

export interface RitualRecord {
  ritualId: string;
  name: string;
  agentIds: string[];
  steps: RitualStepInput[];
}

/** Create an agent with its layered authority. null when API disabled (caller keeps local state). */
export async function apiCreateAgent(input: AgentPermissionInput): Promise<AgentRecord | null> {
  if (!API_ENABLED) return null;
  return mutate<AgentRecord>('agent.create', { workspaceId: PILOT_WORKSPACE, ...input });
}

/** Update an existing agent's layered authority. null when API disabled. */
export async function apiUpdateAgent(
  agentId: string,
  input: AgentPermissionInput,
): Promise<AgentRecord | null> {
  if (!API_ENABLED) return null;
  return mutate<AgentRecord>('agent.update', { agentId, ...input });
}

/** Create a ritual bound to its agents. Server re-checks ritual scope ⊆ agent scope. */
export async function apiCreateRitual(input: {
  name: string;
  agentIds: string[];
  steps: RitualStepInput[];
}): Promise<RitualRecord | null> {
  if (!API_ENABLED) return null;
  return mutate<RitualRecord>('ritual.create', { workspaceId: PILOT_WORKSPACE, ...input });
}
