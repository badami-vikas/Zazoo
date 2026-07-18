import type { LedgerEntry } from "@bridge/core";
import type {
  CommunityDetail,
  DrizzleGraphStore,
  PersonDetail,
  TimelineItem,
} from "@bridge/db";
import { z } from "zod";

const canonicalUuidSchema = z.string().uuid().transform((value) => value.toLowerCase());
const visibilitySchema = z.enum(["private", "workspace"]);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const personCreateFieldsSchema = z.object({
  displayName: z.string().trim().min(1).max(300),
  currentTitle: optionalText(300),
  bio: optionalText(5_000),
  emails: z.array(z.string().trim().email().max(320)).max(20).optional(),
  visibility: visibilitySchema.default("private"),
});

export const personUpdateFieldsSchema = z.object({
  displayName: z.string().trim().min(1).max(300).optional(),
  currentTitle: optionalText(300),
  bio: optionalText(5_000),
  emails: z.array(z.string().trim().email().max(320)).max(20).optional(),
  visibility: visibilitySchema.optional(),
}).refine((fields) => Object.values(fields).some((value) => value !== undefined), {
  message: "Person update requires at least one field",
});

export const communityCreateFieldsSchema = z.object({
  displayName: z.string().trim().min(1).max(300),
  description: optionalText(5_000),
  kind: optionalText(100),
  visibility: visibilitySchema.default("private"),
});

export const communityUpdateFieldsSchema = z.object({
  displayName: z.string().trim().min(1).max(300).optional(),
  description: optionalText(5_000),
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
  occurredAt: z.string().datetime(),
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

export const relationshipMutationPayloadSchema = z.union([
  personCreatePayloadSchema,
  personUpdatePayloadSchema,
  personArchivePayloadSchema,
  communityCreatePayloadSchema,
  communityUpdatePayloadSchema,
  communityArchivePayloadSchema,
  interactionCreatePayloadSchema,
]);

export type RelationshipMutationPayload = z.infer<typeof relationshipMutationPayloadSchema>;
export type RelationshipMutationMaterialization =
  | PersonDetail
  | CommunityDetail
  | TimelineItem
  | boolean
  | null;

export function isRelationshipMutation(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === "relationship_record_mutation" || kind === "relationship_interaction_create";
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
  if (original.kind !== edited.kind || original.recordId !== edited.recordId) {
    throw new Error("Relationship review edits cannot retarget the Record or Event");
  }
  if (original.kind === "relationship_record_mutation") {
    if (
      edited.kind !== "relationship_record_mutation" ||
      original.recordType !== edited.recordType ||
      original.operation !== edited.operation
    ) {
      throw new Error("Relationship review edits cannot change the Record type or operation");
    }
    return edited;
  }
  if (edited.kind !== "relationship_interaction_create") {
    throw new Error("Relationship review edits cannot change the Event operation");
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
  if (
    payload.recordId !== original.resourceId ||
    (payload.kind === "relationship_interaction_create"
      ? original.resourceType !== "event" || original.action !== "write"
      : original.resourceType !== payload.recordType ||
        original.action !== (payload.operation === "archive" ? "archive" : "write"))
  ) {
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
