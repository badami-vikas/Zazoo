/**
 * GoogleService — the integration's application surface, called by apps/api.
 *
 * Bundles the READ pipeline (IntakeService), the post-approval materializer +
 * EgressExecutor, and connection state (token presence). Keeps the API router thin:
 * propose/decide stay generic; this orchestrates the Google-specific side effects
 * that run only AFTER the governed approval.
 */
import type { Proposal, ProposalStatus, RunCtx, UniversalActionPipeline } from "@bridge/core";
import type { SecretStore } from "@bridge/local";
import type { CalendarEvent, CreateEventEnvelope, SendEmailEnvelope } from "./contracts.js";
import { EgressExecutor } from "./egress.js";
import { IntakeMaterializer, IntakeService, type IntakeIdentities, type IntakeResult } from "./intake.js";
import {
  SKILL_COMPOSE_DELETE_EVENT,
  SKILL_COMPOSE_EMAIL,
  SKILL_COMPOSE_EVENT,
  SKILL_COMPOSE_UPDATE_EVENT,
  SKILL_LIST_CALENDAR,
} from "./skills.js";

export interface GoogleServiceDeps {
  pipeline: UniversalActionPipeline;
  intake: IntakeService;
  materializer: IntakeMaterializer;
  egress: EgressExecutor;
  secrets: SecretStore;
  identities: IntakeIdentities;
  /** The user's own addresses — excluded from counterparty matching. */
  selfEmails: string[];
}

/** A calendar write verb. `create` is the default when omitted (back-compat). */
export type CalendarWriteAction = "create" | "update" | "delete";

export interface ProposeSendInput {
  kind: "email" | "calendar";
  /** For calendar writes: create (default) | update | delete. Ignored for email. */
  action?: CalendarWriteAction;
  /** Envelope shape depends on action: create = CreateEventEnvelope, update =
   * Partial<CreateEventEnvelope> & { eventId }, delete = { eventId }. */
  envelope: SendEmailEnvelope | (Partial<CreateEventEnvelope> & { eventId?: string });
}

export class GoogleService {
  constructor(private readonly deps: GoogleServiceDeps) {}

  get integrationId(): string {
    return `${this.deps.identities.workspaceId}:google`;
  }

  async isConnected(): Promise<boolean> {
    return (await this.deps.secrets.getToken(this.integrationId)) !== null;
  }

  async connectionInfo(): Promise<{ connected: boolean; scopes: string[]; connectedAt?: string }> {
    const tok = await this.deps.secrets.getToken(this.integrationId);
    if (!tok) return { connected: false, scopes: [] };
    return { connected: true, scopes: tok.scope ? tok.scope.split(" ").filter(Boolean) : [], connectedAt: tok.updatedAt };
  }

  async disconnect(): Promise<void> {
    await this.deps.secrets.deleteToken(this.integrationId);
  }

  syncGmail(ctx: RunCtx, opts?: { maxResults?: number; query?: string }): Promise<IntakeResult> {
    return this.deps.intake.syncGmail(
      {
        integrationId: this.integrationId,
        identities: this.deps.identities,
        selfEmails: this.deps.selfEmails,
        ...(opts?.maxResults ? { maxResults: opts.maxResults } : {}),
        ...(opts?.query ? { query: opts.query } : {}),
      },
      ctx,
    );
  }

  syncCalendar(ctx: RunCtx, opts?: { maxResults?: number; timeMin?: string; timeMax?: string }): Promise<IntakeResult> {
    return this.deps.intake.syncCalendar(
      {
        integrationId: this.integrationId,
        identities: this.deps.identities,
        selfEmails: this.deps.selfEmails,
        ...(opts?.maxResults ? { maxResults: opts.maxResults } : {}),
        ...(opts?.timeMin ? { timeMin: opts.timeMin } : {}),
        ...(opts?.timeMax ? { timeMax: opts.timeMax } : {}),
      },
      ctx,
    );
  }

  /**
   * Read-only projection for the Calendar surface: fetch FULL events for display.
   * Goes through the gate as external:fetch (the egress agent sources; the user's own
   * calendar view authorizes the inbound read, so the service approves it). Does NOT
   * propose Touchpoints — that's syncCalendar. Returns the events for rendering.
   */
  async listCalendarEvents(ctx: RunCtx, opts?: { maxResults?: number; timeMin?: string; timeMax?: string }): Promise<CalendarEvent[]> {
    const { workspaceId, egressAgentId, userId } = this.deps.identities;
    const proposal = await this.deps.pipeline.propose(
      {
        workspaceId,
        actor: { type: "agent", id: egressAgentId, plane: "cloud" },
        onBehalfOf: { type: "user", id: userId },
        action: "read",
        resourceType: "external:fetch",
        skill: SKILL_LIST_CALENDAR,
        dataScope: "public",
        inputs: {
          integrationId: this.integrationId,
          ...(opts?.maxResults ? { maxResults: opts.maxResults } : {}),
          ...(opts?.timeMin ? { timeMin: opts.timeMin } : {}),
          ...(opts?.timeMax ? { timeMax: opts.timeMax } : {}),
        },
      },
      ctx,
    );
    if (proposal.status === "rejected") {
      throw new Error(`calendar list rejected at the gate: ${proposal.rejectionReason ?? "unknown"}`);
    }
    // The skill already ran at propose() time, so events are in the output regardless of
    // status. Approve the (agent-drafted) fetch so the inbound crossing is audited.
    if (proposal.status === "pending_review") {
      await this.deps.pipeline.decide(proposal.id, "approve", { type: "user", id: userId }, ctx);
    }
    const out = proposal.output?.proposedOutput as { events?: CalendarEvent[] } | undefined;
    return out?.events ?? [];
  }

  /**
   * Human-initiated outbound draft → external:send proposal (require_approval).
   * For calendar, `action` selects create (default) | update | delete; the EgressExecutor
   * performs the real Google write only after a human approves the proposal (>= L2).
   */
  async proposeSend(ctx: RunCtx, input: ProposeSendInput): Promise<Proposal> {
    const action: CalendarWriteAction = input.action ?? "create";
    let skill: string;
    let resource: string | undefined;
    let skillInputs: Record<string, unknown>;
    let channel: string;

    if (input.kind === "email") {
      skill = SKILL_COMPOSE_EMAIL;
      const env = input.envelope as SendEmailEnvelope;
      resource = env.to?.join(", ");
      channel = "Email";
      skillInputs = { integrationId: this.integrationId, envelope: env };
    } else {
      channel = "Calendar";
      const env = input.envelope as Partial<CreateEventEnvelope> & { eventId?: string };
      resource = env.summary ?? env.eventId;
      if (action === "delete") {
        skill = SKILL_COMPOSE_DELETE_EVENT;
        skillInputs = { integrationId: this.integrationId, eventId: env.eventId };
      } else if (action === "update") {
        skill = SKILL_COMPOSE_UPDATE_EVENT;
        skillInputs = { integrationId: this.integrationId, envelope: env };
      } else {
        skill = SKILL_COMPOSE_EVENT;
        skillInputs = { integrationId: this.integrationId, envelope: env };
      }
    }

    const verb = input.kind === "calendar" ? `${action} event` : "send";
    return this.deps.pipeline.propose(
      {
        workspaceId: this.deps.identities.workspaceId,
        actor: { type: "user", id: this.deps.identities.userId, plane: "cloud" },
        action: "share",
        resourceType: "external:send",
        skill,
        dataScope: "public",
        inputs: {
          ...skillInputs,
          display: {
            actor: "You",
            actorKind: "human",
            onBehalfOf: "You",
            resource: resource ?? "outbound",
            policy: "external send/share requires approval",
            channel,
            verb,
          },
        },
      },
      ctx,
    );
  }

  /**
   * Post-approval side effects, called by the API after pipeline.decide(approve).
   * Materializes an intake proposal to the LOCAL graph, OR executes an approved
   * external:send through the gate. No-op for unrelated proposals.
   */
  async onApproved(originalProposalId: string, resolved: Proposal, ctx: RunCtx): Promise<{ materialized: boolean; sent: boolean }> {
    // Free up the propose-time dedup slot (see IntakeService.pendingSeeds) now that this
    // proposal has resolved — whether it ends up materializing or not.
    this.deps.intake.clearPendingSeed(resolved.request.seed);
    if (resolved.status !== "applied") return { materialized: false, sent: false };
    const materialized = await this.deps.materializer.applyApproved(resolved, ctx);
    let sent = false;
    if (resolved.request.resourceType === "external:send") {
      const outcome = await this.deps.egress.executeApprovedSend(originalProposalId, ctx);
      sent = outcome.executed;
    }
    return { materialized, sent };
  }
}

export type { ProposalStatus };
