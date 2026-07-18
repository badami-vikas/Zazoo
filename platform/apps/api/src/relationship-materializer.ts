import type { LedgerEntry, LedgerStore, Proposal } from "@bridge/core";
import type {
  DrizzleGraphStore,
  DrizzleRelationMaterializationStore,
  RelationMaterializationEffect,
  RelationRecord,
} from "@bridge/db";
import { z } from "zod";
import {
  isRelationshipMutation,
  materializeRelationshipMutation,
  type RelationshipMutationMaterialization,
} from "./relationship-record-materializer.js";
import {
  isGoogleLinkedInteractionIntake,
  materializeApprovedGoogleInteraction,
} from "./relationship-intake-materializer.js";

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

export interface RelationshipMaterializationEffectResult {
  effect: RelationMaterializationEffect;
  materialization:
    | RelationshipMaterialization
    | RelationshipMutationMaterialization;
}

function nextRelationshipRetryAt(
  attemptedAt: Date,
  attemptCount: number,
  maxAttempts: number,
): Date | null {
  return attemptCount < maxAttempts
    ? new Date(
        attemptedAt.getTime() +
          Math.min(
            60_000 * 2 ** Math.max(0, attemptCount - 1),
            15 * 60_000,
          ),
      )
    : null;
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
    id: decision.id,
    status: "applied",
    request: {
      workspaceId: original.workspaceId,
      actor: { type: original.actorType, id: original.actorId },
      ...(original.onBehalfOfType && original.onBehalfOfId
        ? {
            onBehalfOf: {
              type: original.onBehalfOfType,
              id: original.onBehalfOfId,
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
      dataScope: "all",
    },
    policyResults: original.policyResults,
    output: {
      proposedOutput: decision.proposedOutput,
      ...(decision.diff !== undefined ? { diff: decision.diff } : {}),
    },
  };
}

export async function materializeApprovedRelationshipProposal(
  graphStore: DrizzleGraphStore,
  proposal: Proposal,
  original: LedgerEntry,
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
    proposal.id !== decision.id ||
    decision.refLedgerId !== original.id ||
    decision.workspaceId !== original.workspaceId ||
    decision.actorType !== original.actorType ||
    decision.actorId !== original.actorId ||
    decision.onBehalfOfType !== original.onBehalfOfType ||
    decision.onBehalfOfId !== original.onBehalfOfId ||
    decision.delegationId !== original.delegationId ||
    decision.action !== original.action ||
    decision.resourceType !== original.resourceType ||
    decision.resourceId !== original.resourceId ||
    decision.seed !== original.seed ||
    decision.dataScope !== original.dataScope ||
    stableJson(decision.inputs) !== stableJson(original.inputs) ||
    stableJson(decision.proposedOutput) !== stableJson(proposal.output?.proposedOutput) ||
    stableJson(decision.context) !== stableJson(original.context) ||
    stableJson(decision.policyResults) !== stableJson(original.policyResults) ||
    decision.trustOrigin !== original.trustOrigin ||
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

  return graphStore.materializeSignalEvidence({
    workspaceId: proposal.request.workspaceId,
    ownerUserId,
    signalId: parsed.signalId,
    sourceEventId: parsed.sourceEventId,
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

export async function applyApprovedRelationshipMaterialization(
  graphStore: DrizzleGraphStore,
  effectStore: DrizzleRelationMaterializationStore,
  original: LedgerEntry,
  decision: LedgerEntry,
  attemptedAt: Date,
  opts: { allowExhausted?: boolean } = {},
): Promise<RelationshipMaterializationEffectResult> {
  const ownerUserId = relationshipOwnerFromLedger(original);
  if (!ownerUserId || relationshipOwnerFromLedger(decision) !== ownerUserId) {
    throw new Error(
      "Approved Relationship materialization requires its owning user",
    );
  }
  const attempt = await effectStore.beginAttempt(
    {
      workspaceId: original.workspaceId,
      ownerUserId,
      proposalLedgerId: original.id,
      decisionLedgerId: decision.id,
    },
    attemptedAt,
    opts,
  );
  if (attempt.effect.status === "applied") {
    return { effect: attempt.effect, materialization: null };
  }
  if (!attempt.started) {
    return { effect: attempt.effect, materialization: null };
  }
  const leaseToken = attempt.effect.leaseToken;
  if (!leaseToken) {
    throw new Error("Approved Relationship materialization attempt has no lease");
  }
  try {
    const isSignalEvidence = isRelationshipSignalEvidence(original.inputs);
    const materialization = isSignalEvidence
      ? await materializeApprovedRelationshipProposal(
          graphStore,
          proposalFromResolvedRelationshipLedger(original, decision),
          original,
          decision,
        )
      : isRelationshipMutation(original.inputs)
        ? await materializeRelationshipMutation(graphStore, original, decision)
        : isGoogleLinkedInteractionIntake(original.inputs)
          ? await materializeApprovedGoogleInteraction(
              graphStore,
              original,
              decision,
            )
        : null;
    if (materialization === null) {
      throw new Error(
        "Approved proposal did not produce Relationship materialization",
      );
    }
    const effect = await effectStore.markApplied(
      attempt.effect.id,
      original.workspaceId,
      ownerUserId,
      leaseToken,
      isSignalEvidence
        ? 1 + (materialization as RelationshipMaterialization).participants.length
        : 1,
      attemptedAt,
    );
    return { effect, materialization };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const nextRetryAt = nextRelationshipRetryAt(
      attemptedAt,
      attempt.effect.attemptCount,
      attempt.effect.maxAttempts,
    );
    await effectStore.markFailed(
      attempt.effect.id,
      original.workspaceId,
      ownerUserId,
      leaseToken,
      message,
      attemptedAt,
      nextRetryAt,
    );
    throw cause;
  }
}

export async function reconcileRetryableRelationshipMaterializations(
  graphStore: DrizzleGraphStore,
  effectStore: DrizzleRelationMaterializationStore,
  ledger: LedgerStore,
  workspaceId: string,
  ownerUserId: string,
  attemptedAt: Date,
  limit = 20,
): Promise<{
  discovered: number;
  attempted: number;
  applied: number;
  failed: number;
  errors: string[];
}> {
  let discovered = 0;
  const errors: string[] = [];
  try {
    discovered = await effectStore.discoverApproved(
      workspaceId,
      ownerUserId,
      { limit },
    );
  } catch (cause) {
    errors.push(cause instanceof Error ? cause.message : String(cause));
  }
  const retryable = await effectStore.listRetryable(
    workspaceId,
    ownerUserId,
    { limit, now: attemptedAt },
  );
  const autoMutationIds =
    await effectStore.listUnmaterializedAutoMutationIds(
      workspaceId,
      ownerUserId,
      { limit },
    );
  discovered += autoMutationIds.length;
  let applied = 0;
  let failed = 0;
  for (const proposalId of autoMutationIds) {
    try {
      const original = await ledger.get(proposalId);
      if (
        !original ||
        original.workspaceId !== workspaceId ||
        original.userDecision !== "auto" ||
        !isRelationshipMutation(original.inputs)
      ) {
        throw new Error(
          "Auto-applied Relationship materialization has no matching ledger resolution",
        );
      }
      const materialization = await materializeRelationshipMutation(
        graphStore,
        original,
        original,
      );
      if (materialization === null) {
        throw new Error(
          "Auto-applied Relationship proposal did not produce materialization",
        );
      }
      applied += 1;
    } catch (cause) {
      failed += 1;
      errors.push(cause instanceof Error ? cause.message : String(cause));
    }
  }
  for (const effect of retryable) {
    try {
      const original = await ledger.get(effect.proposalLedgerId);
      const decision = await ledger.decisionFor(effect.proposalLedgerId);
      if (
        !original ||
        !decision ||
        decision.id !== effect.decisionLedgerId ||
        (decision.userDecision !== "approve" &&
          decision.userDecision !== "edit")
      ) {
        const message =
          "Relationship materialization effect has no matching approved decision";
        const attempt = await effectStore.beginAttempt(
          {
            workspaceId,
            ownerUserId,
            proposalLedgerId: effect.proposalLedgerId,
            decisionLedgerId: effect.decisionLedgerId,
          },
          attemptedAt,
        );
        if (attempt.started) {
          const leaseToken = attempt.effect.leaseToken;
          if (!leaseToken) {
            throw new Error(
              "Relationship materialization mismatch attempt has no lease",
            );
          }
          await effectStore.markFailed(
            attempt.effect.id,
            workspaceId,
            ownerUserId,
            leaseToken,
            message,
            attemptedAt,
            nextRelationshipRetryAt(
              attemptedAt,
              attempt.effect.attemptCount,
              attempt.effect.maxAttempts,
            ),
          );
        }
        throw new Error(message);
      }
      const result = await applyApprovedRelationshipMaterialization(
        graphStore,
        effectStore,
        original,
        decision,
        attemptedAt,
      );
      if (result.effect.status === "applied") applied += 1;
    } catch (cause) {
      failed += 1;
      errors.push(cause instanceof Error ? cause.message : String(cause));
    }
  }
  return {
    discovered,
    attempted: autoMutationIds.length + retryable.length,
    applied,
    failed,
    errors,
  };
}

export async function reconcileWorkspaceRelationshipMaterializations(
  graphStore: DrizzleGraphStore,
  effectStore: DrizzleRelationMaterializationStore,
  ledger: LedgerStore,
  workspaceId: string,
  attemptedAt: Date,
  opts: {
    ownerLimit?: number;
    effectLimit?: number;
    afterOwnerUserId?: string;
  } = {},
): Promise<{
  ownersExamined: number;
  nextOwnerCursor: string | null;
  discovered: number;
  attempted: number;
  applied: number;
  failed: number;
  errors: string[];
}> {
  const owners = await effectStore.listApprovedOwners(workspaceId, {
    limit: opts.ownerLimit ?? 25,
    ...(opts.afterOwnerUserId
      ? { afterOwnerUserId: opts.afterOwnerUserId }
      : {}),
  });
  const aggregate = {
    ownersExamined: owners.ownerUserIds.length,
    nextOwnerCursor: owners.nextCursor,
    discovered: 0,
    attempted: 0,
    applied: 0,
    failed: 0,
    errors: [] as string[],
  };
  for (const ownerUserId of owners.ownerUserIds) {
    try {
      const result = await reconcileRetryableRelationshipMaterializations(
        graphStore,
        effectStore,
        ledger,
        workspaceId,
        ownerUserId,
        attemptedAt,
        opts.effectLimit ?? 20,
      );
      aggregate.discovered += result.discovered;
      aggregate.attempted += result.attempted;
      aggregate.applied += result.applied;
      aggregate.failed += result.failed;
      aggregate.errors.push(...result.errors);
    } catch (cause) {
      aggregate.failed += 1;
      aggregate.errors.push(
        `owner ${ownerUserId}: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }
  }
  return aggregate;
}
