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
import type { CreateEventEnvelope, SendEmailEnvelope } from "./contracts.js";
import { EgressExecutor } from "./egress.js";
import { IntakeMaterializer, IntakeService, type IntakeIdentities, type IntakeResult } from "./intake.js";
import { SKILL_COMPOSE_EMAIL, SKILL_COMPOSE_EVENT } from "./skills.js";

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

export interface ProposeSendInput {
  kind: "email" | "calendar";
  envelope: SendEmailEnvelope | CreateEventEnvelope;
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

  syncCalendar(ctx: RunCtx, opts?: { maxResults?: number }): Promise<IntakeResult> {
    return this.deps.intake.syncCalendar(
      {
        integrationId: this.integrationId,
        identities: this.deps.identities,
        selfEmails: this.deps.selfEmails,
        ...(opts?.maxResults ? { maxResults: opts.maxResults } : {}),
      },
      ctx,
    );
  }

  /** Human-initiated outbound draft → external:send proposal (require_approval). */
  async proposeSend(ctx: RunCtx, input: ProposeSendInput): Promise<Proposal> {
    const skill = input.kind === "email" ? SKILL_COMPOSE_EMAIL : SKILL_COMPOSE_EVENT;
    const resource =
      input.kind === "email"
        ? (input.envelope as SendEmailEnvelope).to?.join(", ")
        : (input.envelope as CreateEventEnvelope).summary;
    return this.deps.pipeline.propose(
      {
        workspaceId: this.deps.identities.workspaceId,
        actor: { type: "user", id: this.deps.identities.userId, plane: "cloud" },
        action: "share",
        resourceType: "external:send",
        skill,
        dataScope: "public",
        inputs: {
          integrationId: this.integrationId,
          envelope: input.envelope,
          display: {
            actor: "You",
            actorKind: "human",
            onBehalfOf: "You",
            resource: resource ?? "outbound",
            policy: "external send/share requires approval",
            channel: input.kind === "email" ? "Email" : "Calendar",
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
