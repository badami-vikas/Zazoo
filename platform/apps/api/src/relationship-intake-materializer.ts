import {
  labelFromLegacyTrustOrigin,
  type LedgerEntry,
} from "@bridge/core";
import type { DrizzleGraphStore, TimelineItem } from "@bridge/db";
import { z } from "zod";
import { relationshipDateTimeSchema } from "./relationship-datetime.js";

const canonicalUuidSchema = z.string().uuid().transform((value) => value.toLowerCase());

const googleInteractionEntitySchema = z.object({
  localId: canonicalUuidSchema,
  kind: z.literal("event"),
  personId: canonicalUuidSchema,
  payload: z.object({
    interactionKind: z.string().trim().min(1).max(100),
    subject: z.string().max(5_000),
    occurredAt: relationshipDateTimeSchema,
  }).passthrough(),
  source: z.enum(["gmail", "google-calendar"]),
  sourceRecordId: z.string().trim().min(1).max(500),
}).passthrough();

const googlePersonDirectiveSchema = z.object({
  localPersonId: canonicalUuidSchema,
  canonicalIdIfNew: canonicalUuidSchema.optional(),
  fullName: z.string().trim().min(1).max(500).optional(),
  emails: z.array(z.string().trim().min(1).max(500)).min(1).max(100),
  dedupKey: z.string().trim().min(1).max(500),
  company: z.string().trim().min(1).max(500).optional(),
});

const googleIntakePayloadSchema = z.object({
  directive: z.object({
    person: googlePersonDirectiveSchema.optional(),
    entities: z.array(z.unknown()).min(1).max(100),
    external: z.array(z.unknown()).max(100),
  }).passthrough(),
}).passthrough();

export interface GoogleInteractionIntake {
  payload: z.infer<typeof googleIntakePayloadSchema>;
  event: z.infer<typeof googleInteractionEntitySchema>;
  person?: z.infer<typeof googlePersonDirectiveSchema>;
}

export function parseGoogleLinkedInteractionIntake(
  value: unknown,
): GoogleInteractionIntake {
  const payload = googleIntakePayloadSchema.parse(value);
  const events = payload.directive.entities.flatMap((entity) => {
    const parsed = googleInteractionEntitySchema.safeParse(entity);
    return parsed.success ? [parsed.data] : [];
  });
  if (events.length !== 1) {
    throw new Error("Google Interaction intake requires exactly one linked Event");
  }
  const event = events[0]!;
  const person = payload.directive.person;
  if (person && person.localPersonId !== event.personId) {
    throw new Error("Google Interaction intake Person must own the linked Event identity");
  }
  return { payload, event, ...(person ? { person } : {}) };
}

export function isGoogleLinkedInteractionIntake(value: unknown): boolean {
  try {
    parseGoogleLinkedInteractionIntake(value);
    return true;
  } catch {
    return false;
  }
}

export function validateGoogleInteractionEdit(
  originalValue: unknown,
  editedValue: unknown,
): z.infer<typeof googleIntakePayloadSchema> {
  const original = parseGoogleLinkedInteractionIntake(originalValue);
  const edited = parseGoogleLinkedInteractionIntake(editedValue);
  if (
    edited.event.localId !== original.event.localId ||
    edited.event.personId !== original.event.personId ||
    edited.event.source !== original.event.source ||
    edited.event.sourceRecordId !== original.event.sourceRecordId ||
    edited.event.payload.occurredAt !== original.event.payload.occurredAt
  ) {
    throw new Error(
      "Google intake review edits cannot retarget the participant or source Event",
    );
  }
  if (JSON.stringify(edited.person ?? null) !== JSON.stringify(original.person ?? null)) {
    throw new Error("Google intake review edits cannot change private identity data");
  }
  return edited.payload;
}

export async function materializeApprovedGoogleInteraction(
  graphStore: DrizzleGraphStore,
  original: LedgerEntry,
  resolution: LedgerEntry,
): Promise<TimelineItem> {
  if (
    resolution.refLedgerId !== original.id ||
    (resolution.userDecision !== "approve" && resolution.userDecision !== "edit") ||
    original.organizationId !== resolution.organizationId ||
    original.actorType !== resolution.actorType ||
    original.actorId !== resolution.actorId ||
    original.onBehalfOfType !== resolution.onBehalfOfType ||
    original.onBehalfOfId !== resolution.onBehalfOfId ||
    original.action !== "write" ||
    resolution.action !== original.action ||
    original.resourceType !== "event" ||
    resolution.resourceType !== original.resourceType ||
    original.dataScope !== "private" ||
    resolution.dataScope !== original.dataScope ||
    !Number.isSafeInteger(resolution.appendSequence) ||
    (resolution.appendSequence ?? 0) <= 0
  ) {
    throw new Error(
      "Google Interaction materialization requires its authority-checked decision",
    );
  }
  const ownerUserId =
    original.onBehalfOfType === "user" && original.onBehalfOfId
      ? original.onBehalfOfId
      : original.actorType === "user"
        ? original.actorId
        : null;
  if (!ownerUserId) {
    throw new Error("Google Interaction materialization requires a Human owner");
  }
  const parsed =
    resolution.userDecision === "edit"
      ? parseGoogleLinkedInteractionIntake(
          validateGoogleInteractionEdit(
            original.inputs,
            resolution.proposedOutput,
          ),
        )
      : parseGoogleLinkedInteractionIntake(resolution.proposedOutput);
  const decisionAt = new Date(resolution.createdAt);
  if (Number.isNaN(decisionAt.getTime())) {
    throw new Error("Google Interaction decision timestamp is invalid");
  }
  const summary =
    parsed.event.payload.subject.trim() ||
    (parsed.event.source === "gmail"
      ? "Email interaction"
      : "Calendar interaction");
  if (parsed.person) {
    await graphStore.createPerson({
      id: parsed.person.localPersonId,
      organizationId: original.organizationId,
      ownerUserId,
      displayName: parsed.person.fullName ?? parsed.person.emails[0]!,
      ...(parsed.person.company ? { currentTitle: parsed.person.company } : {}),
      emails: parsed.person.emails,
      visibility: "private",
      source: "google_approved_intake",
      decisionLedgerId: resolution.id,
      decisionSequence: resolution.appendSequence!,
      decisionAt,
    });
  }
  const participant = await graphStore.getPerson(
    original.organizationId,
    ownerUserId,
    parsed.event.personId,
  );
  if (!participant) {
    throw new Error(
      "Google Interaction materialization requires an owner-scoped Person participant",
    );
  }
  return graphStore.createInteraction({
    id: parsed.event.localId,
    organizationId: original.organizationId,
    ownerUserId,
    kind: parsed.event.payload.interactionKind,
    occurredAt: new Date(parsed.event.payload.occurredAt),
    summary,
    source:
      parsed.event.source === "gmail" ? "gmail" : "google_calendar",
    sourceRecordId: parsed.event.sourceRecordId,
    visibility: "private",
    participants: [
      { recordType: "person", recordId: parsed.event.personId },
    ],
    decisionLedgerId: resolution.id,
    decisionSequence: resolution.appendSequence!,
    decisionAt,
    taintLabel:
      resolution.taintLabel ??
      original.taintLabel ??
      labelFromLegacyTrustOrigin(
        resolution.trustOrigin ?? original.trustOrigin,
        `google-intake:${resolution.id}`,
      ),
  });
}
