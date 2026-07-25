// @bridge/api seam (#8) — routes Signal→propose and Approvals→decide through the GOVERNED
// Universal Action Pipeline instead of inserting straight into the `ledger` table.
//
// The pipeline (apps/api) is the only writer: it runs authority → policy → skill →
// draft-then-approve → append-only ledger. When the API is configured (VITE_API_URL) AND it
// holds DATABASE_URL pointing at the same Supabase project, proposals/decisions land in the
// SAME `ledger` the prototype reads — so the loop is fully governed end-to-end.
//
// Default OFF: with no configured browser or desktop transport the integration
// helpers report "unavailable".
import {
  API_TRANSPORT_CONFIGURED,
  trpcAuthorizationHeaders,
} from '../lib/trpc';
import { API_URL, apiFetch } from '../lib/api-transport';

export const API_ENABLED = API_TRANSPORT_CONFIGURED;
const TRPC = `${API_URL}/trpc`;

const PILOT_ORGANIZATION = 'b0000000-0000-4000-a000-000000000001';

async function requestHeaders(): Promise<Record<string, string>> {
  return {
    'content-type': 'application/json',
    ...(await trpcAuthorizationHeaders()),
  };
}

// One unbatched tRPC mutation. No data transformer is configured server-side, so input is sent
// raw and the result rides at `result.data`. Throws on transport or procedure error.
async function mutate<T = unknown>(path: string, input: unknown): Promise<T> {
  const res = await apiFetch(`${TRPC}/${path}`, {
    method: 'POST',
    headers: await requestHeaders(),
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
  const res = await apiFetch(`${TRPC}/${path}${qs}`, { headers: await requestHeaders() });
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
  return query<ApiScopeGrant[]>('integration.listScopes', { organizationId: PILOT_ORGANIZATION, integrationId });
}

/** Grant a standing Bridge capability. The server refuses agent-floor DENY scopes (FORBIDDEN). */
export async function apiGrantScope(a: {
  integrationId: string;
  resourceType: string;
  action: string;
}): Promise<ApiScopeGrant | null> {
  if (!API_ENABLED) return null;
  return mutate<ApiScopeGrant>('integration.grantScope', { organizationId: PILOT_ORGANIZATION, ...a });
}

/** Narrow access: revoke a single standing grant (append-only — sets revoked_at server-side). */
export async function apiRevokeScope(permissionId: string): Promise<boolean> {
  if (!API_ENABLED) return false;
  await mutate('integration.revokeScope', { organizationId: PILOT_ORGANIZATION, permissionId });
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

/** Source Gmail through the gate → returns the Event/Memory/Signal proposals. */
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

// ── Calendar tool (read projection + governed create/update/delete) ────────────
// listEvents READS the user's own Google Calendar through the gate (external:fetch,
// auto-approved). create/update/delete DRAFT an external:send proposal; the real
// Google write runs only after a human approval (here: the user's own Save click).

/** A Google Calendar event, normalized for the Calendar surface. */
export interface CalendarEventDTO {
  eventId: string;
  summary: string;
  description?: string;
  start: string; // RFC3339 (date-only for all-day)
  end: string;
  location?: string;
  organizer: { name?: string; email: string };
  attendees: { name?: string; email: string }[];
}

export type CalendarWriteAction = 'create' | 'update' | 'delete';

/** Full Google Calendar events for display. null when API disabled (demo mode). */
export async function apiListCalendarEvents(opts?: { maxResults?: number; timeMin?: string; timeMax?: string }): Promise<CalendarEventDTO[] | null> {
  if (!API_ENABLED) return null;
  const r = await mutate<{ events: CalendarEventDTO[] }>('google.listEvents', {
    ...(opts?.maxResults ? { maxResults: opts.maxResults } : {}),
    ...(opts?.timeMin ? { timeMin: opts.timeMin } : {}),
    ...(opts?.timeMax ? { timeMax: opts.timeMax } : {}),
  });
  return r?.events ?? [];
}

/** Draft a calendar write (create | update | delete) → external:send proposal (pending). */
export async function apiProposeCalendarWrite(
  action: CalendarWriteAction,
  envelope: Record<string, unknown>,
): Promise<{ id: string; status: string } | null> {
  if (!API_ENABLED) return null;
  return mutate<{ id: string; status: string }>('google.proposeSend', { kind: 'calendar', action, envelope });
}

/** Approve a pending proposal (the user's Save = the human decision). Returns whether
 * the egress (real Google write) fired. The decision is append-only audited in the ledger. */
export async function apiApproveProposal(proposalId: string): Promise<{ sent: boolean } | null> {
  if (!API_ENABLED) return null;
  const r = await mutate<{ effects?: { sent?: boolean; materialized?: boolean } }>('action.decide', {
    proposalId,
    decision: 'approve',
  });
  return { sent: Boolean(r?.effects?.sent) };
}

// ── Agent + Automation authoring (layered, gated permissions) ─────────────────
// All default OFF (no VITE_API_URL → null), so the create/edit pages fall back to local
// state and stay demoable. When the API is up, these route through the governed pipeline,
// which is the only writer of Agent authority and Automation definitions.
//
// Agent floor (external:send DENY, action:approve DENY) and Automation-within-Agent scope
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

export interface AutomationStepInput {
  skill: string;
  action: string;
  resourceType: string;
  dataScope: AgentDataScope;
}

export interface AutomationRecord {
  automationId: string;
  name: string;
  agentId: string;
  steps: AutomationStepInput[];
}

/** Create an agent with its layered authority. null when API disabled (caller keeps local state). */
export async function apiCreateAgent(input: AgentPermissionInput): Promise<AgentRecord | null> {
  if (!API_ENABLED) return null;
  return mutate<AgentRecord>('agent.create', { organizationId: PILOT_ORGANIZATION, ...input });
}

/** Update an existing agent's layered authority. null when API disabled. */
export async function apiUpdateAgent(
  agentId: string,
  input: AgentPermissionInput,
): Promise<AgentRecord | null> {
  if (!API_ENABLED) return null;
  return mutate<AgentRecord>('agent.update', { agentId, ...input });
}

/** Create an Automation bound to its owning Agent. */
export async function apiCreateAutomation(input: {
  name: string;
  agentId: string;
  steps: AutomationStepInput[];
}): Promise<AutomationRecord | null> {
  if (!API_ENABLED) return null;
  return mutate<AutomationRecord>('automation.create', { organizationId: PILOT_ORGANIZATION, ...input });
}

// ── DealPilot (the first tool on the generic manifest intake seam) ─────────────
// source() proposes an external:fetch (audited); the pipeline quarantines every sourced
// listing and returns a LIGHT manifest (count + capture ids + a small sample) — never the
// full payload. commit() is the human "Add" that materializes ONE quarantined capture into
// DealPilot's facts (capture ≠ commit, same UX as Camera/Card Scanner). list() reads back the
// committed candidates, thesis-scored server-side. null/[] when the API is OFF (dummy mode).

export interface DealPilotCapturePreview {
  name?: string;
  industry?: string;
  geo?: string;
  askPrice?: number;
  revenue?: number;
  sde?: number;
  url?: string;
}
export interface DealPilotSourceResult {
  proposalId: string;
  status: 'pending_review' | 'applied' | 'rejected';
  count: number;
  captureIds: string[];
  sample: DealPilotCapturePreview[];
}
export interface DealPilotCandidateDTO {
  id: string;
  profile: DealPilotCapturePreview;
  fit: { score: number; triage: 'green' | 'yellow' | 'red'; reasons: string[] };
}

/** Fetch new listings via the BizBuySell-alert connector; quarantines them (no commit yet). */
export async function apiDealPilotSource(): Promise<DealPilotSourceResult | null> {
  if (!API_ENABLED) return null;
  const r = await mutate<{
    id: string;
    status: 'pending_review' | 'applied' | 'rejected';
    output?: { proposedOutput?: { count?: number; captureIds?: string[]; sample?: DealPilotCapturePreview[] } };
  }>('dealpilot.source', { organizationId: PILOT_ORGANIZATION });
  return {
    proposalId: r.id,
    status: r.status,
    count: r.output?.proposedOutput?.count ?? 0,
    captureIds: r.output?.proposedOutput?.captureIds ?? [],
    sample: r.output?.proposedOutput?.sample ?? [],
  };
}

/** The human "Add": materialize one quarantined capture into DealPilot's candidate list. */
export async function apiDealPilotCommit(captureId: string): Promise<boolean> {
  if (!API_ENABLED) return false;
  const r = await mutate<{ committed: boolean }>('dealpilot.commit', { captureId });
  return Boolean(r?.committed);
}

/** Committed candidates, thesis-scored. null when API disabled (caller falls back to the empty
 * local LISTINGS array). `dealpilot.list` is paginated server-side ({ items, total, hasMore });
 * this prototype UI has no pager yet, so we request the max page size to preserve today's
 * "show everything" behavior while the backend stays bounded. */
export async function apiDealPilotList(): Promise<DealPilotCandidateDTO[] | null> {
  if (!API_ENABLED) return null;
  const page = await query<{ items: DealPilotCandidateDTO[]; total: number; hasMore: boolean }>(
    'dealpilot.list',
    { limit: 200, offset: 0 },
  );
  return page?.items ?? null;
}

// ── Organization + Team (real backend, authenticated CRUD — not a governed pipeline action) ───────
export interface OrganizationDTO { id: string; name: string; createdAt: string }
export interface OrganizationMemberDTO { userId: string; email: string; name: string | null }

export async function apiListOrganizations(): Promise<OrganizationDTO[] | null> {
  if (!API_ENABLED) return null;
  return query<OrganizationDTO[]>('organization.list');
}
export async function apiCreateOrganization(name: string): Promise<OrganizationDTO | null> {
  if (!API_ENABLED) return null;
  return mutate<OrganizationDTO>('organization.create', { name });
}
export async function apiListMembers(organizationId: string): Promise<OrganizationMemberDTO[] | null> {
  if (!API_ENABLED) return null;
  return query<OrganizationMemberDTO[]>('organization.listMembers', { organizationId });
}
export async function apiInviteMember(organizationId: string, email: string): Promise<OrganizationMemberDTO | null> {
  if (!API_ENABLED) return null;
  return mutate<OrganizationMemberDTO>('organization.inviteMember', { organizationId, email });
}
