/**
 * EgressExecutor — the WRITE pipeline's final, gated step.
 *
 * Sending an email / creating-updating a calendar event is EGRESS (external:send).
 * external:send is an agent-floor DENY — an agent can NEVER reach this; and the
 * external-approval policy forces a human decision (>= L2). The compose skills only
 * produced a DRAFT envelope at propose() time; NOTHING was sent.
 *
 * This executor runs ONLY after a human approves the external:send proposal: it
 * reads the approved ledger row, calls the gateway (the one place that touches the
 * Google internet APIs), records the crossing in the local external_records, and
 * appends an append-only audit row. Idempotent — keyed on the proposal id, it never
 * double-sends.
 */
import type { LedgerEntry, LedgerStore, RunCtx } from "@bridge/core";
import type { LocalGraphStore } from "@bridge/local";
import type { EgressKind, SendEmailEnvelope, CreateEventEnvelope } from "./contracts.js";
import type { GoogleGatewayFactory } from "./gateway.js";

const EGRESS_AUDIT_SOURCE = "egress";

export interface EgressExecutorDeps {
  ledger: LedgerStore;
  gateways: GoogleGatewayFactory;
  graph: LocalGraphStore;
}

export interface EgressOutcome {
  executed: boolean;
  alreadyExecuted?: boolean;
  skipped?: boolean;
  reason?: string;
  providerId?: string;
  auditLedgerId?: string;
}

interface CommittedSend {
  integrationId: string;
  egressKind: EgressKind;
  envelope: SendEmailEnvelope & CreateEventEnvelope & { eventId?: string };
}

export class EgressExecutor {
  constructor(private readonly deps: EgressExecutorDeps) {}

  /**
   * Execute a HUMAN-APPROVED external:send proposal. `proposalId` is the original
   * pending proposal's id. Safe to call after pipeline.decide(approve); no-op if the
   * proposal isn't an approved external:send, or was already executed.
   */
  async executeApprovedSend(proposalId: string, ctx: RunCtx): Promise<EgressOutcome> {
    const original = await this.deps.ledger.get(proposalId);
    if (!original) throw new Error(`egress: no proposal ${proposalId}`);
    if (original.resourceType !== "external:send") {
      return { executed: false, skipped: true, reason: "not an external:send proposal" };
    }

    const decision = await this.deps.ledger.decisionFor(proposalId);
    if (!decision || (decision.userDecision !== "approve" && decision.userDecision !== "edit")) {
      return { executed: false, skipped: true, reason: "external:send not human-approved (>= L2 required)" };
    }

    const workspaceId = original.workspaceId;
    // Idempotency: never send twice for the same approved proposal.
    if (await this.deps.graph.hasExternal(workspaceId, EGRESS_AUDIT_SOURCE, proposalId)) {
      return { executed: false, alreadyExecuted: true };
    }

    const committed = decision.proposedOutput as CommittedSend;
    if (!committed?.integrationId || !committed.egressKind || !committed.envelope) {
      throw new Error("egress: approved proposal missing integrationId/egressKind/envelope");
    }

    const gw = await this.deps.gateways.forIntegration(committed.integrationId);
    let providerId: string;
    let detail: unknown;
    switch (committed.egressKind) {
      case "email.draft": {
        // Trust-first: compose a Gmail DRAFT (never auto-send). The user presses
        // Send in Gmail. Still egress (content leaves the local plane to Google) →
        // gated as external:send, human-approved.
        const r = await gw.createDraft(committed.envelope);
        providerId = r.providerDraftId;
        detail = r;
        break;
      }
      case "calendar.create": {
        const r = await gw.createEvent(committed.envelope);
        providerId = r.providerEventId;
        detail = r;
        break;
      }
      case "calendar.update": {
        const eventId = committed.envelope.eventId ?? "";
        const r = await gw.updateEvent(eventId, committed.envelope);
        providerId = r.providerEventId;
        detail = r;
        break;
      }
      default:
        throw new Error(`egress: unknown egressKind ${String(committed.egressKind)}`);
    }

    // Append-only audit of the actual crossing.
    const auditId = ctx.ids.next();
    const auditRow: LedgerEntry = {
      id: auditId,
      workspaceId,
      actorType: original.actorType,
      actorId: original.actorId,
      ...(original.onBehalfOfType ? { onBehalfOfType: original.onBehalfOfType } : {}),
      ...(original.onBehalfOfId ? { onBehalfOfId: original.onBehalfOfId } : {}),
      action: "share",
      resourceType: "external:send",
      inputs: { originalProposalId: proposalId },
      proposedOutput: { executed: true, egressKind: committed.egressKind, providerId, detail },
      userDecision: "auto",
      policyResults: [],
      refLedgerId: decision.id,
      createdAt: ctx.clock.nowISO(),
    };
    await this.deps.ledger.append(auditRow);

    await this.deps.graph.recordExternal({
      workspaceId,
      source: EGRESS_AUDIT_SOURCE,
      sourceRecordId: proposalId,
      entityType: committed.egressKind,
      entityId: providerId,
      createdAt: ctx.clock.nowISO(),
    });

    return { executed: true, providerId, auditLedgerId: auditId };
  }
}
