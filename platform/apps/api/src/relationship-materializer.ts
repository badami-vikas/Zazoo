import type { Proposal } from "@bridge/core";
import type { DrizzleGraphStore, RelationRecord } from "@bridge/db";
import { z } from "zod";

const approvedRelationshipSignalEvidenceSchema = z.object({
  kind: z.literal("relationship_signal_evidence"),
  signalId: z.string().uuid(),
  sourceEventId: z.string().uuid(),
  visibility: z.enum(["private", "workspace", "public"]),
  userConfirmed: z.boolean(),
  participants: z
    .array(
      z.object({
        recordType: z.enum(["person", "community"]),
        recordId: z.string().uuid(),
        role: z.string().trim().min(1).max(100).optional(),
        confidence: z.number().min(0).max(1),
      }),
    )
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
  return approvedRelationshipSignalEvidenceSchema.parse(value);
}

export interface RelationshipMaterialization {
  sourceEvent: RelationRecord;
  participants: RelationRecord[];
}

export async function materializeApprovedRelationshipProposal(
  graphStore: DrizzleGraphStore,
  proposal: Proposal,
): Promise<RelationshipMaterialization | null> {
  if (proposal.status !== "applied" || proposal.request.resourceType !== "relation") return null;
  const candidate = proposal.output?.proposedOutput ?? proposal.request.inputs;
  if (!isRelationshipSignalEvidence(candidate)) return null;
  const parsed = parseRelationshipSignalEvidence(candidate);
  const ownerUserId =
    proposal.request.onBehalfOf?.type === "user"
      ? proposal.request.onBehalfOf.id
      : proposal.request.actor.type === "user"
        ? proposal.request.actor.id
        : null;
  if (!ownerUserId) {
    throw new Error("Approved Relationship proposal requires an authority-checked user principal");
  }

  const detail = await graphStore.getSignalDetail(
    proposal.request.workspaceId,
    ownerUserId,
    parsed.signalId,
  );
  if (!detail?.sourceEvent || detail.sourceEvent.id !== parsed.sourceEventId) {
    throw new Error("Approved Relationship proposal no longer has its accessible source Event");
  }
  const payload =
    typeof detail.sourceEvent.payload === "object" &&
    detail.sourceEvent.payload !== null &&
    !Array.isArray(detail.sourceEvent.payload)
      ? detail.sourceEvent.payload as Record<string, unknown>
      : {};
  const source =
    typeof payload.source === "string" && payload.source.trim()
      ? payload.source.trim()
      : `event:${detail.sourceEvent.type}`;

  return graphStore.materializeSignalEvidence({
    workspaceId: proposal.request.workspaceId,
    ownerUserId,
    signalId: parsed.signalId,
    sourceEventId: parsed.sourceEventId,
    source,
    observedAt: detail.sourceEvent.createdAt,
    userConfirmed: parsed.userConfirmed,
    visibility: parsed.visibility,
    participants: parsed.participants.map((participant) => ({
      recordType: participant.recordType,
      recordId: participant.recordId,
      confidence: participant.confidence,
      ...(participant.role ? { role: participant.role } : {}),
    })),
  });
}
