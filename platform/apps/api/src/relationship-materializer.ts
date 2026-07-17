import type { LedgerEntry, Proposal } from "@bridge/core";
import type { DrizzleGraphStore, RelationRecord } from "@bridge/db";
import { z } from "zod";

const canonicalUuidSchema = z.string().uuid().transform((value) => value.toLowerCase());

const relationshipParticipantSchema = z.object({
  recordType: z.enum(["person", "community"]),
  recordId: canonicalUuidSchema,
  role: z.string().trim().min(1).max(100).optional(),
  confidence: z.number().min(0).max(1),
});

export const relationshipSignalEvidencePayloadSchema = z.object({
  kind: z.literal("relationship_signal_evidence"),
  signalId: canonicalUuidSchema,
  sourceEventId: canonicalUuidSchema,
  visibility: z.enum(["private", "workspace", "public"]),
  userConfirmed: z.boolean(),
  participants: z
    .array(relationshipParticipantSchema)
    .min(1)
    .max(100)
    .superRefine((participants, context) => {
      const keys = participants.map((participant) => `${participant.recordType}:${participant.recordId}`);
      if (new Set(keys).size !== keys.length) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "participants must be unique by Record" });
      }
    }),
});

export function isRelationshipSignalEvidence(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { kind?: unknown }).kind === "relationship_signal_evidence"
  );
}

export function parseRelationshipSignalEvidence(value: unknown) {
  return relationshipSignalEvidencePayloadSchema.parse(value);
}

export interface RelationshipMaterialization {
  sourceEvent: RelationRecord;
  participants: RelationRecord[];
}

export function relationshipOwnerFromLedger(entry: LedgerEntry): string | null {
  if (entry.onBehalfOfType === "user" && entry.onBehalfOfId) return entry.onBehalfOfId;
  return entry.actorType === "user" ? entry.actorId : null;
}

function relationshipOwner(proposal: Proposal): string | null {
  if (proposal.request.onBehalfOf?.type === "user") return proposal.request.onBehalfOf.id;
  return proposal.request.actor.type === "user" ? proposal.request.actor.id : null;
}

function stableJson(value: unknown): string {
  const normalize = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) return candidate.map(normalize);
    if (typeof candidate !== "object" || candidate === null) return candidate ?? null;
    return Object.fromEntries(
      Object.entries(candidate as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalize(nested)]),
    );
  };
  return JSON.stringify(normalize(value));
}

export function proposalFromResolvedRelationshipLedger(
  original: LedgerEntry,
  decision: LedgerEntry,
): Proposal {
  return {
    id: original.id,
    status: "applied",
    request: {
      workspaceId: original.workspaceId,
      actor: { type: original.actorType, id: original.actorId, plane: "local" },
      ...(original.onBehalfOfType && original.onBehalfOfId
        ? {
            onBehalfOf: {
              type: original.onBehalfOfType,
              id: original.onBehalfOfId,
              ...(original.delegationId ? { delegationId: original.delegationId } : {}),
            },
          }
        : {}),
      action: original.action,
      resourceType: original.resourceType,
      ...(original.resourceId ? { resourceId: original.resourceId } : {}),
      inputs: original.inputs,
      skill: "(replayed)",
      ...(original.dataScope ? { dataScope: original.dataScope } : {}),
      ...(original.context ? { context: original.context } : {}),
      ...(original.seed ? { seed: original.seed } : {}),
      ...(original.trustOrigin ? { trustOrigin: original.trustOrigin } : {}),
    },
    authority: {
      allowed: true,
      reason: "authorized; approved at review",
      basis: "role",
      dataScope: original.dataScope ?? "all",
    },
    policyResults: original.policyResults,
    output: { proposedOutput: decision.proposedOutput },
  };
}

export async function materializeApprovedRelationshipProposal(
  graphStore: DrizzleGraphStore,
  proposal: Proposal,
  decision: LedgerEntry | null = null,
): Promise<RelationshipMaterialization | null> {
  if (
    proposal.status !== "applied" ||
    proposal.request.action !== "write" ||
    proposal.request.resourceType !== "relation"
  ) {
    return null;
  }
  if (
    !decision ||
    (decision.userDecision !== "approve" && decision.userDecision !== "edit") ||
    decision.refLedgerId !== proposal.id ||
    decision.workspaceId !== proposal.request.workspaceId ||
    decision.actorType !== proposal.request.actor.type ||
    decision.actorId !== proposal.request.actor.id ||
    decision.onBehalfOfType !== proposal.request.onBehalfOf?.type ||
    decision.onBehalfOfId !== proposal.request.onBehalfOf?.id ||
    decision.delegationId !== proposal.request.onBehalfOf?.delegationId ||
    decision.action !== proposal.request.action ||
    decision.resourceType !== proposal.request.resourceType ||
    decision.resourceId !== proposal.request.resourceId ||
    decision.seed !== proposal.request.seed ||
    decision.dataScope !== proposal.request.dataScope ||
    stableJson(decision.inputs) !== stableJson(proposal.request.inputs) ||
    stableJson(decision.proposedOutput) !== stableJson(proposal.output?.proposedOutput) ||
    stableJson(decision.context) !== stableJson(proposal.request.context) ||
    stableJson(decision.policyResults) !== stableJson(proposal.policyResults) ||
    decision.trustOrigin !== proposal.request.trustOrigin ||
    !Number.isSafeInteger(decision.appendSequence) ||
    (decision.appendSequence ?? 0) <= 0
  ) {
    throw new Error("Approved Relationship materialization requires its append-only decision row");
  }
  const candidate = decision.proposedOutput;
  if (!isRelationshipSignalEvidence(candidate)) {
    throw new Error("Approved Relationship decision payload is invalid");
  }
  const parsed = parseRelationshipSignalEvidence(candidate);
  const decisionAt = new Date(decision.createdAt);
  if (Number.isNaN(decisionAt.getTime())) {
    throw new Error("Approved Relationship decision timestamp is invalid");
  }
  if (
    proposal.request.seed?.toLowerCase() !== parsed.sourceEventId ||
    proposal.request.dataScope !== "private"
  ) {
    throw new Error("Approved Relationship proposal is missing its server-owned evidence boundary");
  }
  const ownerUserId = relationshipOwner(proposal);
  if (!ownerUserId || relationshipOwnerFromLedger(decision) !== ownerUserId) {
    throw new Error("Approved Relationship proposal requires an authority-checked user principal");
  }

  const anchor = await graphStore.getSignalEvidenceAnchor(
    proposal.request.workspaceId,
    ownerUserId,
    parsed.signalId,
    parsed.sourceEventId,
  );
  if (!anchor || anchor.sourceEvent.id !== parsed.sourceEventId) {
    throw new Error("Approved Relationship proposal no longer has its accessible source Event");
  }
  const payload =
    typeof anchor.sourceEvent.payload === "object" &&
    anchor.sourceEvent.payload !== null &&
    !Array.isArray(anchor.sourceEvent.payload)
      ? anchor.sourceEvent.payload as Record<string, unknown>
      : {};
  const source =
    typeof payload.source === "string" && payload.source.trim()
      ? payload.source.trim()
      : `event:${anchor.sourceEvent.type}`;

  return graphStore.materializeSignalEvidence({
    workspaceId: proposal.request.workspaceId,
    ownerUserId,
    signalId: parsed.signalId,
    sourceEventId: parsed.sourceEventId,
    source,
    observedAt: anchor.sourceEvent.createdAt,
    userConfirmed: parsed.userConfirmed,
    visibility: parsed.visibility,
    decisionLedgerId: decision.id,
    decisionSequence: decision.appendSequence!,
    decisionAt,
    participants: parsed.participants.map((participant) => ({
      recordType: participant.recordType,
      recordId: participant.recordId,
      confidence: participant.confidence,
      ...(participant.role ? { role: participant.role } : {}),
    })),
  });
}
