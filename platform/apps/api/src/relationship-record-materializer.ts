import type { LedgerEntry, MemoryEntry, MemoryStore, MemoryWrite } from "@bridge/core";
import type {
  CommitmentRecord,
  CommunityDetail,
  DrizzleGraphStore,
  IntroductionRecord,
  PersonDetail,
  TimelineItem,
} from "@bridge/db";
import { z } from "zod";
import { relationshipDateTimeSchema } from "./relationship-datetime.js";

const canonicalUuidSchema = z.string().uuid().transform((value) => value.toLowerCase());
const visibilitySchema = z.enum(["private", "workspace"]);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const personCreateFieldsSchema = z.object({
  displayName: z.string().trim().min(1).max(300),
  currentTitle: optionalText(300),
  bio: optionalText(5_000),
  location: optionalText(500),
  emails: z.array(z.string().trim().email().max(320)).max(20).optional(),
  visibility: visibilitySchema.default("private"),
});

export const personUpdateFieldsSchema = z.object({
  displayName: z.string().trim().min(1).max(300).optional(),
  currentTitle: optionalText(300),
  bio: optionalText(5_000),
  location: optionalText(500),
  emails: z.array(z.string().trim().email().max(320)).max(20).optional(),
  visibility: visibilitySchema.optional(),
}).refine((fields) => Object.values(fields).some((value) => value !== undefined), {
  message: "Person update requires at least one field",
});

export const communityCreateFieldsSchema = z.object({
  displayName: z.string().trim().min(1).max(300),
  description: optionalText(5_000),
  location: optionalText(500),
  kind: optionalText(100),
  visibility: visibilitySchema.default("private"),
});

export const communityUpdateFieldsSchema = z.object({
  displayName: z.string().trim().min(1).max(300).optional(),
  description: optionalText(5_000),
  location: optionalText(500),
  kind: optionalText(100),
  visibility: visibilitySchema.optional(),
}).refine((fields) => Object.values(fields).some((value) => value !== undefined), {
  message: "Community update requires at least one field",
});

const personCreatePayloadSchema = z.object({
  kind: z.literal("relationship_record_mutation"),
  recordType: z.literal("person"),
  operation: z.literal("create"),
  recordId: canonicalUuidSchema,
  values: personCreateFieldsSchema,
});

const personUpdatePayloadSchema = z.object({
  kind: z.literal("relationship_record_mutation"),
  recordType: z.literal("person"),
  operation: z.literal("update"),
  recordId: canonicalUuidSchema,
  values: personUpdateFieldsSchema,
});

const personArchivePayloadSchema = z.object({
  kind: z.literal("relationship_record_mutation"),
  recordType: z.literal("person"),
  operation: z.literal("archive"),
  recordId: canonicalUuidSchema,
});

const communityCreatePayloadSchema = z.object({
  kind: z.literal("relationship_record_mutation"),
  recordType: z.literal("community"),
  operation: z.literal("create"),
  recordId: canonicalUuidSchema,
  values: communityCreateFieldsSchema,
});

const communityUpdatePayloadSchema = z.object({
  kind: z.literal("relationship_record_mutation"),
  recordType: z.literal("community"),
  operation: z.literal("update"),
  recordId: canonicalUuidSchema,
  values: communityUpdateFieldsSchema,
});

const communityArchivePayloadSchema = z.object({
  kind: z.literal("relationship_record_mutation"),
  recordType: z.literal("community"),
  operation: z.literal("archive"),
  recordId: canonicalUuidSchema,
});

export const interactionParticipantSchema = z.object({
  recordType: z.enum(["person", "community"]),
  recordId: canonicalUuidSchema,
  role: z.string().trim().min(1).max(100).optional(),
  attendanceState: z.string().trim().min(1).max(100).optional(),
});

export const interactionCreateFieldsSchema = z.object({
  kind: z.string().trim().min(1).max(100),
  occurredAt: relationshipDateTimeSchema,
  summary: z.string().trim().min(1).max(5_000),
  source: z.enum(["user", "gmail", "google_calendar", "capture"]).default("user"),
  sourceRecordId: z.string().trim().min(1).max(500).nullable().optional(),
  visibility: visibilitySchema.default("private"),
  participants: z.array(interactionParticipantSchema).min(1).max(100)
    .superRefine((participants, context) => {
      const keys = participants.map((participant) =>
        `${participant.recordType}:${participant.recordId}`,
      );
      if (new Set(keys).size !== keys.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Interaction participants must be unique",
        });
      }
    }),
});

const interactionCreatePayloadSchema = z.object({
  kind: z.literal("relationship_interaction_create"),
  recordId: canonicalUuidSchema,
  values: interactionCreateFieldsSchema,
});

const memoryTypeSchema = z.enum(["episodic", "semantic", "procedural", "preference"]);
const memoryScopeSchema = z.enum(["private", "workspace"]);
const memoryContentSchema = z.string().trim().min(1).max(5_000);

const memoryCreatePayloadSchema = z.object({
  kind: z.literal("relationship_memory_mutation"),
  operation: z.literal("create"),
  personId: canonicalUuidSchema,
  memoryId: canonicalUuidSchema,
  values: z.object({
    type: memoryTypeSchema.default("semantic"),
    content: memoryContentSchema,
    scope: memoryScopeSchema.default("private"),
  }),
});

const memoryCorrectPayloadSchema = z.object({
  kind: z.literal("relationship_memory_mutation"),
  operation: z.literal("correct"),
  personId: canonicalUuidSchema,
  memoryId: canonicalUuidSchema,
  replacementMemoryId: canonicalUuidSchema,
  values: z.object({ content: memoryContentSchema }),
});

const memoryForgetPayloadSchema = z.object({
  kind: z.literal("relationship_memory_mutation"),
  operation: z.literal("forget"),
  personId: canonicalUuidSchema,
  memoryId: canonicalUuidSchema,
});

const commitmentValuesSchema = z.object({
  text: z.string().trim().min(1).max(2_000),
  dueAt: relationshipDateTimeSchema.nullable().optional(),
  status: z.enum(["pending", "completed", "cancelled"]),
});

const commitmentCreatePayloadSchema = z.object({
  kind: z.literal("relationship_commitment_mutation"),
  operation: z.literal("create"),
  commitmentId: canonicalUuidSchema,
  transitionEventId: canonicalUuidSchema,
  personId: canonicalUuidSchema,
  sourceEventId: canonicalUuidSchema.nullable().optional(),
  values: commitmentValuesSchema,
});

const commitmentUpdatePayloadSchema = z.object({
  kind: z.literal("relationship_commitment_mutation"),
  operation: z.literal("update"),
  commitmentId: canonicalUuidSchema,
  transitionEventId: canonicalUuidSchema,
  personId: canonicalUuidSchema,
  sourceEventId: canonicalUuidSchema.nullable().optional(),
  values: commitmentValuesSchema,
});

const commitmentArchivePayloadSchema = z.object({
  kind: z.literal("relationship_commitment_mutation"),
  operation: z.literal("archive"),
  commitmentId: canonicalUuidSchema,
  transitionEventId: canonicalUuidSchema,
  personId: canonicalUuidSchema,
  sourceEventId: canonicalUuidSchema.nullable().optional(),
  values: z.object({
    text: z.string().trim().min(1).max(2_000),
    dueAt: relationshipDateTimeSchema.nullable().optional(),
    status: z.literal("archived"),
  }),
});

const introductionStatusSchema = z.enum([
  "awaiting_consents",
  "ready",
  "declined",
  "cancelled",
  "introduced",
]);

const introductionMutationPayloadSchema = z.object({
  kind: z.literal("relationship_introduction_mutation"),
  operation: z.enum(["create", "consent", "cancel", "complete"]),
  introductionId: canonicalUuidSchema,
  transitionEventId: canonicalUuidSchema,
  sourcePersonId: canonicalUuidSchema,
  targetPersonId: canonicalUuidSchema,
  values: z.object({
    initiatorConsent: z.boolean(),
    recipientConsent: z.boolean(),
    status: introductionStatusSchema,
    declineReason: z.string().trim().min(1).max(1_000).nullable().optional(),
  }),
}).refine((payload) => payload.sourcePersonId !== payload.targetPersonId, {
  message: "An Introduction requires two different People",
});

export const relationshipMutationPayloadSchema = z.union([
  personCreatePayloadSchema,
  personUpdatePayloadSchema,
  personArchivePayloadSchema,
  communityCreatePayloadSchema,
  communityUpdatePayloadSchema,
  communityArchivePayloadSchema,
  interactionCreatePayloadSchema,
  memoryCreatePayloadSchema,
  memoryCorrectPayloadSchema,
  memoryForgetPayloadSchema,
  commitmentCreatePayloadSchema,
  commitmentUpdatePayloadSchema,
  commitmentArchivePayloadSchema,
  introductionMutationPayloadSchema,
]);

export type RelationshipMutationPayload = z.infer<typeof relationshipMutationPayloadSchema>;
export type RelationshipMutationMaterialization =
  | PersonDetail
  | CommunityDetail
  | TimelineItem
  | MemoryEntry
  | CommitmentRecord
  | IntroductionRecord
  | boolean
  | null;

export function isRelationshipMutation(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === "relationship_record_mutation" ||
    kind === "relationship_interaction_create" ||
    kind === "relationship_memory_mutation" ||
    kind === "relationship_commitment_mutation" ||
    kind === "relationship_introduction_mutation";
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

export function validateRelationshipMutationEdit(
  originalValue: unknown,
  editedValue: unknown,
): RelationshipMutationPayload {
  const original = relationshipMutationPayloadSchema.parse(originalValue);
  const edited = relationshipMutationPayloadSchema.parse(editedValue);
  if (original.kind !== edited.kind) {
    throw new Error("Relationship review edits cannot change the mutation kind");
  }
  if (original.kind === "relationship_record_mutation") {
    if (
      edited.kind !== "relationship_record_mutation" ||
      original.recordId !== edited.recordId
    ) {
      throw new Error("Relationship review edits cannot retarget the Record");
    }
    if (
      original.recordType !== edited.recordType ||
      original.operation !== edited.operation
    ) {
      throw new Error("Relationship review edits cannot change the Record type or operation");
    }
    return edited;
  }
  if (original.kind === "relationship_memory_mutation") {
    if (
      edited.kind !== "relationship_memory_mutation" ||
      original.operation !== edited.operation ||
      original.personId !== edited.personId ||
      original.memoryId !== edited.memoryId ||
      ("replacementMemoryId" in original
        ? !("replacementMemoryId" in edited) ||
          original.replacementMemoryId !== edited.replacementMemoryId
        : "replacementMemoryId" in edited)
    ) {
      throw new Error("Relationship review edits cannot retarget a Memory mutation");
    }
    return edited;
  }
  if (original.kind === "relationship_commitment_mutation") {
    if (
      edited.kind !== "relationship_commitment_mutation" ||
      original.operation !== edited.operation ||
      original.personId !== edited.personId ||
      original.commitmentId !== edited.commitmentId ||
      original.transitionEventId !== edited.transitionEventId ||
      (original.sourceEventId ?? null) !== (edited.sourceEventId ?? null)
    ) {
      throw new Error("Relationship review edits cannot retarget a Commitment mutation");
    }
    return edited;
  }
  if (original.kind === "relationship_introduction_mutation") {
    if (
      edited.kind !== "relationship_introduction_mutation" ||
      original.operation !== edited.operation ||
      original.introductionId !== edited.introductionId ||
      original.transitionEventId !== edited.transitionEventId ||
      original.sourcePersonId !== edited.sourcePersonId ||
      original.targetPersonId !== edited.targetPersonId
    ) {
      throw new Error("Relationship review edits cannot retarget an Introduction mutation");
    }
    return edited;
  }
  if (edited.kind !== "relationship_interaction_create") {
    throw new Error("Relationship review edits cannot change the Event operation");
  }
  if (original.recordId !== edited.recordId) {
    throw new Error("Relationship review edits cannot retarget the Event");
  }
  const originalParticipants = original.values.participants
    .map((participant) => `${participant.recordType}:${participant.recordId}`)
    .sort();
  const editedParticipants = edited.values.participants
    .map((participant) => `${participant.recordType}:${participant.recordId}`)
    .sort();
  if (stableJson(originalParticipants) !== stableJson(editedParticipants)) {
    throw new Error("Relationship review edits cannot retarget Interaction participants");
  }
  if (
    original.values.source !== edited.values.source ||
    (original.values.sourceRecordId ?? null) !== (edited.values.sourceRecordId ?? null)
  ) {
    throw new Error("Relationship review edits cannot change Interaction source provenance");
  }
  return edited;
}

export async function materializeRelationshipMutation(
  graphStore: DrizzleGraphStore,
  original: LedgerEntry,
  resolution: LedgerEntry,
  memoryStore?: MemoryStore,
): Promise<RelationshipMutationMaterialization> {
  const isAutoResolution =
    resolution.id === original.id &&
    resolution.userDecision === "auto";
  const isHumanResolution =
    resolution.refLedgerId === original.id &&
    (resolution.userDecision === "approve" || resolution.userDecision === "edit");
  if (
    (!isAutoResolution && !isHumanResolution) ||
    original.workspaceId !== resolution.workspaceId ||
    original.actorType !== resolution.actorType ||
    original.actorId !== resolution.actorId ||
    original.onBehalfOfType !== resolution.onBehalfOfType ||
    original.onBehalfOfId !== resolution.onBehalfOfId ||
    original.resourceType !== resolution.resourceType ||
    original.resourceId !== resolution.resourceId ||
    original.dataScope !== "private" ||
    !Number.isSafeInteger(resolution.appendSequence) ||
    (resolution.appendSequence ?? 0) <= 0
  ) {
    throw new Error("Relationship materialization requires its authority-checked ledger resolution");
  }
  const ownerUserId =
    original.onBehalfOfType === "user" && original.onBehalfOfId
      ? original.onBehalfOfId
      : original.actorType === "user"
        ? original.actorId
        : null;
  if (!ownerUserId) {
    throw new Error("Relationship materialization requires a Human owner");
  }
  const originalPayload = relationshipMutationPayloadSchema.parse(original.inputs);
  const payload = resolution.userDecision === "edit"
    ? validateRelationshipMutationEdit(originalPayload, resolution.proposedOutput)
    : relationshipMutationPayloadSchema.parse(resolution.proposedOutput);
  const resourceMatches =
    payload.kind === "relationship_interaction_create"
      ? payload.recordId === original.resourceId &&
        original.resourceType === "event" &&
        original.action === "write"
      : payload.kind === "relationship_record_mutation"
        ? payload.recordId === original.resourceId &&
          original.resourceType === payload.recordType &&
          original.action === (payload.operation === "archive" ? "archive" : "write")
        : payload.kind === "relationship_memory_mutation"
          ? payload.personId === original.resourceId &&
            original.resourceType === "person" &&
            original.action === "write"
          : payload.kind === "relationship_commitment_mutation"
            ? payload.commitmentId === original.resourceId &&
              original.resourceType === "relation" &&
              original.action === "write"
            : payload.introductionId === original.resourceId &&
              original.resourceType === "relation" &&
              original.action === "write";
  if (!resourceMatches) {
    throw new Error("Relationship materialization payload does not match its governed resource");
  }
  const decisionAt = new Date(resolution.createdAt);
  if (Number.isNaN(decisionAt.getTime())) {
    throw new Error("Relationship materialization decision timestamp is invalid");
  }
  const provenance = {
    decisionLedgerId: resolution.id,
    decisionSequence: resolution.appendSequence!,
    decisionAt,
  };
  if (payload.kind === "relationship_interaction_create") {
    return graphStore.createInteraction({
      ...provenance,
      id: payload.recordId,
      workspaceId: original.workspaceId,
      ownerUserId,
      kind: payload.values.kind,
      occurredAt: new Date(payload.values.occurredAt),
      summary: payload.values.summary,
      source: payload.values.source,
      visibility: payload.values.visibility,
      ...(payload.values.sourceRecordId !== undefined
        ? { sourceRecordId: payload.values.sourceRecordId }
        : {}),
      participants: payload.values.participants.map((participant) => ({
        recordType: participant.recordType,
        recordId: participant.recordId,
        ...(participant.role ? { role: participant.role } : {}),
        ...(participant.attendanceState
          ? { attendanceState: participant.attendanceState }
          : {}),
      })),
    });
  }
  if (payload.kind === "relationship_memory_mutation") {
    if (!memoryStore) {
      throw new Error("Relationship Memory materialization requires a MemoryStore");
    }
    const person = await graphStore.getPerson(
      original.workspaceId,
      ownerUserId,
      payload.personId,
    );
    if (!person || !person.isOwner) {
      throw new Error("Relationship Memory mutation requires its owning Person");
    }
    const authScope = { workspaceId: original.workspaceId, userId: ownerUserId };
    let materialization: MemoryEntry | boolean;
    let resultingMemoryId: string | null = null;
    if (payload.operation === "create") {
      const existing = await memoryStore.get(payload.memoryId, authScope);
      if (existing) {
        if (
          existing.subjectElementId !== payload.personId ||
          existing.ownerUserId !== ownerUserId ||
          existing.content !== payload.values.content
        ) {
          throw new Error("Memory id conflicts with a different Relationship Memory");
        }
        materialization = existing;
      } else {
        materialization = await memoryStore.write({
          id: payload.memoryId,
          workspaceId: original.workspaceId,
          type: payload.values.type,
          subjectElementId: payload.personId,
          scope: payload.values.scope,
          content: payload.values.content,
          sourceRefType: "feedback",
          sourceRefId: resolution.id,
          confidence: 1,
          trustOrigin: "user_content",
          plane: "local",
          createdBy: ownerUserId,
          ownerUserId,
          createdAt: resolution.createdAt,
        });
      }
      resultingMemoryId = materialization.id;
    } else if (payload.operation === "correct") {
      const existingReplacement = await memoryStore.get(
        payload.replacementMemoryId,
        authScope,
      );
      if (existingReplacement) {
        if (
          existingReplacement.supersedesId !== payload.memoryId ||
          existingReplacement.subjectElementId !== payload.personId ||
          existingReplacement.ownerUserId !== ownerUserId ||
          existingReplacement.content !== payload.values.content
        ) {
          throw new Error("Corrected Memory id conflicts with a different correction");
        }
        materialization = existingReplacement;
      } else {
        const current = await memoryStore.get(payload.memoryId, authScope);
        if (
          !current ||
          current.subjectElementId !== payload.personId ||
          current.ownerUserId !== ownerUserId
        ) {
          throw new Error("Relationship Memory is not owned by the Person owner");
        }
        const next: MemoryWrite = {
          id: payload.replacementMemoryId,
          workspaceId: current.workspaceId,
          type: current.type,
          subjectElementId: current.subjectElementId,
          scope: current.scope,
          content: payload.values.content,
          sourceRefType: "feedback",
          sourceRefId: resolution.id,
          confidence: 1,
          trustOrigin: "user_content",
          plane: "local",
          createdBy: ownerUserId,
          ownerUserId,
          createdAt: resolution.createdAt,
        };
        materialization = await memoryStore.supersede(payload.memoryId, next);
      }
      resultingMemoryId = materialization.id;
    } else {
      const current = await memoryStore.get(payload.memoryId, authScope);
      if (
        current &&
        (current.subjectElementId !== payload.personId ||
          current.ownerUserId !== ownerUserId)
      ) {
        throw new Error("Relationship Memory is not owned by the Person owner");
      }
      materialization = current
        ? await memoryStore.forget(payload.memoryId, authScope)
        : true;
    }
    await graphStore.createInteraction({
      ...provenance,
      id: resolution.id,
      workspaceId: original.workspaceId,
      ownerUserId,
      kind: `memory_${payload.operation === "create" ? "added" : payload.operation === "correct" ? "corrected" : "forgotten"}`,
      occurredAt: decisionAt,
      summary:
        payload.operation === "create"
          ? "Added Relationship Memory"
          : payload.operation === "correct"
            ? "Corrected Relationship Memory"
            : "Forgot Relationship Memory",
      source: "user",
      sourceRecordId: resolution.id,
      visibility: "private",
      participants: [{ recordType: "person", recordId: payload.personId }],
      updatesPersonFreshness: false,
      metadata: {
        artifact: "memory",
        operation: payload.operation,
        memoryId: payload.memoryId,
        resultingMemoryId,
      },
    });
    return materialization;
  }
  if (payload.kind === "relationship_commitment_mutation") {
    const person = await graphStore.getPerson(
      original.workspaceId,
      ownerUserId,
      payload.personId,
    );
    if (!person) {
      throw new Error("Commitment Person is not accessible");
    }
    if (payload.operation !== "create") {
      const current = await graphStore.listCommitments(
        original.workspaceId,
        ownerUserId,
        payload.personId,
        {
          limit: 1,
          offset: 0,
          includeArchived: true,
          commitmentId: payload.commitmentId,
        },
      );
      if (current.items.length !== 1) {
        throw new Error("Commitment is not accessible");
      }
    }
    return graphStore.materializeCommitment({
      ...provenance,
      operation: payload.operation,
      commitmentId: payload.commitmentId,
      transitionEventId: payload.transitionEventId,
      workspaceId: original.workspaceId,
      ownerUserId,
      personId: payload.personId,
      text: payload.values.text,
      dueAt: payload.values.dueAt ? new Date(payload.values.dueAt) : null,
      status: payload.values.status,
      sourceEventId: payload.sourceEventId ?? null,
    });
  }
  if (payload.kind === "relationship_introduction_mutation") {
    const [sourcePerson, targetPerson] = await Promise.all([
      graphStore.getPerson(
        original.workspaceId,
        ownerUserId,
        payload.sourcePersonId,
      ),
      graphStore.getPerson(
        original.workspaceId,
        ownerUserId,
        payload.targetPersonId,
      ),
    ]);
    if (!sourcePerson?.isOwner || !targetPerson) {
      throw new Error("Introduction People are not accessible to the owner");
    }
    const declineReason = payload.values.declineReason?.trim() ?? "";
    return graphStore.materializeIntroduction({
      ...provenance,
      operation: payload.operation,
      introductionId: payload.introductionId,
      transitionEventId: payload.transitionEventId,
      workspaceId: original.workspaceId,
      ownerUserId,
      sourcePersonId: payload.sourcePersonId,
      targetPersonId: payload.targetPersonId,
      initiatorConsent: payload.values.initiatorConsent,
      recipientConsent: payload.values.recipientConsent,
      status: payload.values.status,
      ...(declineReason ? { privateDeclineReason: declineReason } : {}),
    });
  }
  if (payload.recordType === "person") {
    if (payload.operation === "create") {
      return graphStore.createPerson({
        ...provenance,
        id: payload.recordId,
        workspaceId: original.workspaceId,
        ownerUserId,
        displayName: payload.values.displayName,
        visibility: payload.values.visibility,
        source: "user",
        ...(payload.values.currentTitle !== undefined
          ? { currentTitle: payload.values.currentTitle }
          : {}),
        ...(payload.values.bio !== undefined ? { bio: payload.values.bio } : {}),
        ...(payload.values.location !== undefined ? { location: payload.values.location } : {}),
        ...(payload.values.emails !== undefined ? { emails: payload.values.emails } : {}),
      });
    }
    if (payload.operation === "update") {
      return graphStore.updatePerson({
        ...provenance,
        id: payload.recordId,
        workspaceId: original.workspaceId,
        ownerUserId,
        ...(payload.values.displayName !== undefined
          ? { displayName: payload.values.displayName }
          : {}),
        ...(payload.values.currentTitle !== undefined
          ? { currentTitle: payload.values.currentTitle }
          : {}),
        ...(payload.values.bio !== undefined ? { bio: payload.values.bio } : {}),
        ...(payload.values.location !== undefined ? { location: payload.values.location } : {}),
        ...(payload.values.emails !== undefined ? { emails: payload.values.emails } : {}),
        ...(payload.values.visibility !== undefined
          ? { visibility: payload.values.visibility }
          : {}),
      });
    }
    return graphStore.archivePerson({
      ...provenance,
      id: payload.recordId,
      workspaceId: original.workspaceId,
      ownerUserId,
    });
  }
  if (payload.operation === "create") {
    return graphStore.createCommunity({
      ...provenance,
      id: payload.recordId,
      workspaceId: original.workspaceId,
      ownerUserId,
      displayName: payload.values.displayName,
      visibility: payload.values.visibility,
      source: "user",
      ...(payload.values.description !== undefined
        ? { description: payload.values.description }
        : {}),
      ...(payload.values.location !== undefined ? { location: payload.values.location } : {}),
      ...(payload.values.kind !== undefined ? { kind: payload.values.kind } : {}),
    });
  }
  if (payload.operation === "update") {
    return graphStore.updateCommunity({
      ...provenance,
      id: payload.recordId,
      workspaceId: original.workspaceId,
      ownerUserId,
      ...(payload.values.displayName !== undefined
        ? { displayName: payload.values.displayName }
        : {}),
      ...(payload.values.description !== undefined
        ? { description: payload.values.description }
        : {}),
      ...(payload.values.location !== undefined ? { location: payload.values.location } : {}),
      ...(payload.values.kind !== undefined ? { kind: payload.values.kind } : {}),
      ...(payload.values.visibility !== undefined
        ? { visibility: payload.values.visibility }
        : {}),
    });
  }
  return graphStore.archiveCommunity({
    ...provenance,
    id: payload.recordId,
    workspaceId: original.workspaceId,
    ownerUserId,
  });
}
