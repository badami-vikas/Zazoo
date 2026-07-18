/**
 * DrizzleGraphStore — bounded Relationship Record/Relation/Event access over the
 * existing shared graph tables. Mutating methods are called only after the
 * Universal Action Pipeline has applied a Human request or recorded approval.
 *
 * `signal_actions` (act/dismiss/save) is the one exception: it's the user's
 * reaction bookkeeping to a Signal, not a mutation of Person/Relationship data,
 * so it's a direct authenticated write here (same tier as workspace membership
 * CRUD — see workspace-store.ts's header comment) rather than routed through
 * UniversalActionPipeline.propose(). See docs/raw/decisions-log.md.
 */
import { randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import {
  communities,
  communitiesCanonical,
  edges,
  events,
  initiatives,
  nodeTypes,
  people,
  peopleCanonical,
  signalActions,
  signals,
  touchpoints,
} from "./schema.js";
import type { RelationEvidenceRef } from "./schema.js";

export interface PageOpts {
  limit: number;
  offset: number;
}
export interface Page<T> {
  items: T[];
  total: number;
}

export interface RelationCursor {
  observedAt: Date;
  createdAt: Date;
  id: string;
}

export interface RelationPage {
  items: RelationRecord[];
  total: number;
  nextCursor: RelationCursor | null;
}

export interface RelationshipPathNode {
  nodeType: string;
  nodeId: string;
}

export interface RelationshipPathStep {
  from: RelationshipPathNode;
  to: RelationshipPathNode;
  relation: RelationRecord;
}

export interface RelationshipPath {
  nodes: RelationshipPathNode[];
  steps: RelationshipPathStep[];
  confidence: number;
}

export interface RelationshipPathResult {
  paths: RelationshipPath[];
  visited: number;
  truncated: boolean;
}

export interface PersonRecord {
  id: string;
  workspaceId: string;
  ownerUserId: string;
  isOwner: boolean;
  visibility: string;
  displayName: string | null;
  currentTitle: string | null;
  currentCommunityId: string | null;
  source: string | null;
  lastInteractionAt: Date | null;
  contextFreshnessAt: Date | null;
  createdAt: Date;
}

export interface CommunityRecord {
  id: string;
  workspaceId: string;
  ownerUserId: string;
  isOwner: boolean;
  visibility: string;
  displayName: string | null;
  description: string | null;
  kind: string | null;
  source: string;
  isUserConfirmed: boolean;
  memberCount: number;
}

export interface PersonDetail extends PersonRecord {
  bio: string | null;
  avatarUrl: string | null;
  emails: string[];
}

export interface CommunityDetail extends CommunityRecord {}

export type RelationshipRecordVisibility = "private" | "workspace";

export interface DecisionProvenance {
  decisionLedgerId: string;
  decisionSequence: number;
  decisionAt: Date;
}

export interface CreatePersonInput extends DecisionProvenance {
  id: string;
  workspaceId: string;
  ownerUserId: string;
  displayName: string;
  currentTitle?: string | null;
  bio?: string | null;
  emails?: string[];
  visibility: RelationshipRecordVisibility;
  source: string;
}

export interface UpdatePersonInput extends DecisionProvenance {
  id: string;
  workspaceId: string;
  ownerUserId: string;
  displayName?: string;
  currentTitle?: string | null;
  bio?: string | null;
  emails?: string[];
  visibility?: RelationshipRecordVisibility;
}

export interface CreateCommunityInput extends DecisionProvenance {
  id: string;
  workspaceId: string;
  ownerUserId: string;
  displayName: string;
  description?: string | null;
  kind?: string | null;
  visibility: RelationshipRecordVisibility;
  source: string;
}

export interface UpdateCommunityInput extends DecisionProvenance {
  id: string;
  workspaceId: string;
  ownerUserId: string;
  displayName?: string;
  description?: string | null;
  kind?: string | null;
  visibility?: RelationshipRecordVisibility;
}

export interface ArchiveRelationshipRecordInput extends DecisionProvenance {
  id: string;
  workspaceId: string;
  ownerUserId: string;
}

export interface InteractionParticipantInput {
  recordType: "person" | "community";
  recordId: string;
  role?: string;
  attendanceState?: string;
}

export interface CreateInteractionInput extends DecisionProvenance {
  id: string;
  workspaceId: string;
  ownerUserId: string;
  kind: string;
  occurredAt: Date;
  summary: string;
  source: string;
  sourceRecordId?: string | null;
  visibility: RelationshipRecordVisibility;
  participants: InteractionParticipantInput[];
  updatesPersonFreshness?: boolean;
  metadata?: Record<string, unknown>;
}

export interface TimelineCursor {
  occurredAt: Date;
  id: string;
}

export interface TimelineParticipant {
  relationId: string;
  recordType: "person" | "community";
  recordId: string;
  displayName: string | null;
  role: string | null;
  attendanceState: string | null;
}

export interface TimelineItem {
  id: string;
  type: string;
  kind: string;
  summary: string | null;
  source: string;
  sourceRecordId: string | null;
  visibility: RelationVisibility;
  occurredAt: Date;
  createdAt: Date;
  participants: TimelineParticipant[];
  provenance: {
    eventId: string;
    relationIds: string[];
    evidenceRefs: RelationEvidenceRef[];
    decisionLedgerIds: string[];
  };
}

export interface TimelinePage {
  items: TimelineItem[];
  nextCursor: TimelineCursor | null;
}

export type CommitmentStatus = "pending" | "completed" | "cancelled" | "archived";

export interface CommitmentRecord {
  id: string;
  personId: string;
  text: string;
  dueAt: Date | null;
  status: CommitmentStatus;
  sourceEventId: string | null;
  transitionEventId: string;
  occurredAt: Date;
  createdAt: Date;
  provenance: {
    decisionLedgerId: string;
    decisionSequence: number;
    relationId: string;
    evidenceRefs: RelationEvidenceRef[];
  };
}

export interface CommitmentPage extends Page<CommitmentRecord> {}

export interface MaterializeCommitmentInput extends DecisionProvenance {
  operation: "create" | "update" | "archive";
  commitmentId: string;
  transitionEventId: string;
  workspaceId: string;
  ownerUserId: string;
  personId: string;
  text: string;
  dueAt?: Date | null;
  status: CommitmentStatus;
  sourceEventId?: string | null;
}

export type IntroductionStatus =
  | "awaiting_consents"
  | "ready"
  | "declined"
  | "cancelled"
  | "introduced";

export interface IntroductionRecord {
  id: string;
  sourcePersonId: string;
  targetPersonId: string;
  initiatorConsent: boolean;
  recipientConsent: boolean;
  status: IntroductionStatus;
  declineReasonRecorded: boolean;
  transitionEventId: string;
  occurredAt: Date;
  createdAt: Date;
  provenance: {
    decisionLedgerId: string;
    decisionSequence: number;
    relationIds: string[];
    evidenceRefs: RelationEvidenceRef[];
  };
}

export interface IntroductionPage extends Page<IntroductionRecord> {}

export interface MaterializeIntroductionInput extends DecisionProvenance {
  operation: "create" | "consent" | "cancel" | "complete";
  introductionId: string;
  transitionEventId: string;
  workspaceId: string;
  ownerUserId: string;
  sourcePersonId: string;
  targetPersonId: string;
  initiatorConsent: boolean;
  recipientConsent: boolean;
  status: IntroductionStatus;
  declineReason?: string | null;
}

export interface SignalParticipant {
  relationId: string;
  relationType: string;
  recordType: "person" | "community";
  recordId: string;
  displayName: string | null;
  confidence: number | null;
  evidenceRefs: RelationEvidenceRef[];
  sourceModule: string | null;
}

export interface SignalDetail {
  signal: typeof signals.$inferSelect;
  reason: string;
  reasonSource: "event" | "inferred";
  participants: SignalParticipant[];
  sourceEvent: typeof events.$inferSelect | null;
}

export interface SignalEvidenceAnchor {
  signal: typeof signals.$inferSelect;
  sourceEvent: typeof events.$inferSelect;
}

export type RelationVisibility = "private" | "workspace" | "public";
export type RelationRecord = typeof edges.$inferSelect;

export interface UpsertRelationInput {
  workspaceId: string;
  ownerUserId: string;
  srcType: string;
  srcId: string;
  dstType: string;
  dstId: string;
  relationType: string;
  properties?: Record<string, unknown>;
  evidenceRefs: RelationEvidenceRef[];
  confidence: number;
  observedAt: Date;
  validFrom?: Date | null;
  validTo?: Date | null;
  userConfirmed: boolean;
  visibility: RelationVisibility;
  source: string;
  sourceModule: string;
  decisionLedgerId?: string;
  decisionSequence?: number;
  decisionAt?: Date;
}

export interface SignalParticipantRelationInput {
  recordType: "person" | "community";
  recordId: string;
  role?: string;
  confidence: number;
}

export interface MaterializeSignalEvidenceInput {
  workspaceId: string;
  ownerUserId: string;
  signalId: string;
  sourceEventId: string;
  userConfirmed: boolean;
  visibility: RelationVisibility;
  participants: SignalParticipantRelationInput[];
  decisionLedgerId: string;
  decisionSequence: number;
  decisionAt: Date;
}

export interface NodeTypeOwner {
  nodeType: string;
  plane: string;
  owningModule: string | null;
}

interface AccessibleNodes {
  people: Map<string, PersonRecord>;
  communities: Map<string, CommunityRecord>;
  signalIds: Set<string>;
  eventIds: Set<string>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RELATION_EVIDENCE_REFS = 100;
const MAX_RELATION_PAGE_SIZE = 100;
const MAX_SIGNAL_RELATIONS = 200;
const MAX_BATCH_NODE_REFS = 10_000;
const MAX_TIMELINE_PAGE_SIZE = 50;
const MAX_INTERACTION_PARTICIPANTS = 100;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function compareRelationPreference(
  left: RelationRecord,
  right: RelationRecord,
  viewerUserId: string,
): number {
  const ownerRank =
    Number(right.ownerUserId === viewerUserId) -
    Number(left.ownerUserId === viewerUserId);
  if (ownerRank !== 0) return ownerRank;
  const governedRank =
    Number(right.decisionSequence !== null) -
    Number(left.decisionSequence !== null);
  if (governedRank !== 0) return governedRank;
  const sequenceRank =
    (right.decisionSequence ?? -1) - (left.decisionSequence ?? -1);
  if (sequenceRank !== 0) return sequenceRank;
  const decisionAtRank =
    (right.decisionAt?.getTime() ?? -1) - (left.decisionAt?.getTime() ?? -1);
  if (decisionAtRank !== 0) return decisionAtRank;
  const observedAtRank = right.observedAt.getTime() - left.observedAt.getTime();
  if (observedAtRank !== 0) return observedAtRank;
  const createdAtRank = right.createdAt.getTime() - left.createdAt.getTime();
  if (createdAtRank !== 0) return createdAtRank;
  return right.id.localeCompare(left.id);
}

function isRelationEvidenceRef(value: unknown): value is RelationEvidenceRef {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const ref = value as Record<string, unknown>;
  return (
    typeof ref.entityType === "string" &&
    ref.entityType.trim().length > 0 &&
    typeof ref.entityId === "string" &&
    UUID_PATTERN.test(ref.entityId) &&
    (ref.source === undefined || typeof ref.source === "string")
  );
}

function relationEvidenceCandidates(relation: RelationRecord): RelationEvidenceRef[] {
  const seen = new Set<string>();
  const candidates: RelationEvidenceRef[] = [];
  if (!Array.isArray(relation.evidenceRefs)) return candidates;
  for (const value of relation.evidenceRefs) {
    if (!isRelationEvidenceRef(value) || !UUID_PATTERN.test(value.entityId)) continue;
    const key = `${value.entityType}:${value.entityId.toLowerCase()}:${value.source ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ ...value, entityId: value.entityId.toLowerCase() });
    if (candidates.length >= MAX_RELATION_EVIDENCE_REFS) break;
  }
  return candidates;
}

function assertRelationInput(input: UpsertRelationInput): void {
  if (
    !UUID_PATTERN.test(input.workspaceId) ||
    !UUID_PATTERN.test(input.ownerUserId) ||
    !UUID_PATTERN.test(input.srcId) ||
    !UUID_PATTERN.test(input.dstId)
  ) {
    throw new Error("Relation workspace, owner, and endpoints must be UUIDs");
  }
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    throw new Error("Relation confidence must be between 0 and 1");
  }
  if (input.evidenceRefs.length === 0 || input.evidenceRefs.length > MAX_RELATION_EVIDENCE_REFS) {
    throw new Error(`A Relation requires 1-${MAX_RELATION_EVIDENCE_REFS} evidence references`);
  }
  for (const evidence of input.evidenceRefs) {
    if (!isRelationEvidenceRef(evidence)) {
      throw new Error("Relation evidence references require an entity type and UUID");
    }
  }
  if (
    !input.srcType.trim() ||
    !input.dstType.trim() ||
    !input.relationType.trim() ||
    !input.source.trim() ||
    !input.sourceModule.trim()
  ) {
    throw new Error("Relation node types, semantic type, source, and source Module are required");
  }
  if (Number.isNaN(input.observedAt.getTime())) {
    throw new Error("Relation observedAt must be a valid timestamp");
  }
  if (input.validFrom && input.validTo && input.validTo < input.validFrom) {
    throw new Error("Relation validTo cannot precede validFrom");
  }
  const hasDecisionProvenance =
    input.decisionLedgerId !== undefined ||
    input.decisionSequence !== undefined ||
    input.decisionAt !== undefined;
  if (
    hasDecisionProvenance &&
    (
      !input.decisionLedgerId ||
      !UUID_PATTERN.test(input.decisionLedgerId) ||
      !Number.isSafeInteger(input.decisionSequence) ||
      (input.decisionSequence ?? 0) < 0 ||
      !input.decisionAt ||
      Number.isNaN(input.decisionAt.getTime())
    )
  ) {
    throw new Error("Relation decision provenance must include a ledger UUID, sequence, and timestamp");
  }
}

function payloadRecord(payload: unknown): Record<string, unknown> {
  return typeof payload === "object" && payload !== null && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
}

function payloadString(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function payloadDate(
  payload: Record<string, unknown>,
  key: string,
  fallback: Date,
): Date {
  const value = payloadString(payload, key);
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function normalizeEmails(values: string[] | undefined): string[] {
  if (!values) return [];
  return [...new Set(
    values
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  )];
}

function sourceEventIdFromPayload(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>).sourceEventId ?? (payload as Record<string, unknown>).eventId;
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function signalReason(
  signal: typeof signals.$inferSelect,
  hasValidatedEventEvidence: boolean,
): { reason: string; source: "event" | "inferred" } {
  if (typeof signal.payload === "object" && signal.payload !== null && !Array.isArray(signal.payload)) {
    const reason = (signal.payload as Record<string, unknown>).reason;
    if (typeof reason === "string" && reason.trim()) {
      return {
        reason: reason.trim(),
        source: hasValidatedEventEvidence ? "event" : "inferred",
      };
    }
  }
  return {
    reason: `Surfaced by the ${signal.type} detector from available Event evidence.`,
    source: "inferred",
  };
}

export class DrizzleGraphStore {
  #db: Database;
  #rlsContext: { workspaceId: string; userId: string } | null;

  constructor(
    db: Database,
    rlsContext: { workspaceId: string; userId: string } | null = null,
  ) {
    this.#db = db;
    this.#rlsContext = rlsContext;
  }

  #hasRlsContext(workspaceId: string, userId: string): boolean {
    return (
      this.#rlsContext?.workspaceId === workspaceId.toLowerCase() &&
      this.#rlsContext.userId === userId.toLowerCase()
    );
  }

  async #withRlsContext<T>(
    workspaceId: string,
    userId: string,
    operation: (store: DrizzleGraphStore) => Promise<T>,
  ): Promise<T> {
    const context = {
      workspaceId: workspaceId.toLowerCase(),
      userId: userId.toLowerCase(),
    };
    if (!UUID_PATTERN.test(context.workspaceId) || !UUID_PATTERN.test(context.userId)) {
      throw new Error("Graph request workspace and user must be UUIDs");
    }
    return this.#db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT
          set_config('app.workspace_id', ${context.workspaceId}, true),
          set_config('app.user_id', ${context.userId}, true)
      `);
      return operation(new DrizzleGraphStore(tx, context));
    });
  }

  #relationPreferenceOrder(viewerUserId: string) {
    return [
      sql<number>`CASE WHEN ${edges.ownerUserId} = ${viewerUserId} THEN 0 ELSE 1 END`,
      sql<number>`CASE WHEN ${edges.decisionSequence} IS NULL THEN 1 ELSE 0 END`,
      desc(edges.decisionSequence),
      desc(edges.decisionAt),
      desc(edges.observedAt),
      desc(edges.createdAt),
      desc(edges.id),
    ];
  }

  async getMaxRelationDecisionSequence(): Promise<number> {
    const rows = await this.#db
      .select({
        value: sql<string | number>`coalesce(max(${edges.decisionSequence}), 0)`,
      })
      .from(edges);
    const value = Number(rows[0]?.value ?? 0);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("Relation decision sequence exceeds the safe local ledger range");
    }
    return value;
  }

  async getNodeTypeOwner(nodeType: string): Promise<NodeTypeOwner | null> {
    const rows = await this.#db
      .select({
        nodeType: nodeTypes.type,
        plane: nodeTypes.plane,
        owningModule: nodeTypes.owningModule,
      })
      .from(nodeTypes)
      .where(eq(nodeTypes.type, nodeType))
      .limit(1);
    return rows[0] ?? null;
  }

  async #getAccessibleSignal(
    workspaceId: string,
    viewerUserId: string,
    signalId: string,
  ): Promise<typeof signals.$inferSelect | null> {
    const rows = await this.#db
      .select()
      .from(signals)
      .where(and(eq(signals.workspaceId, workspaceId), eq(signals.id, signalId)))
      .limit(1);
    const signal = rows[0];
    if (!signal) return null;
    const subject =
      signal.subjectType === "person"
        ? await this.getPerson(workspaceId, viewerUserId, signal.subjectId)
        : signal.subjectType === "community"
          ? await this.getCommunity(workspaceId, viewerUserId, signal.subjectId)
          : null;
    return subject ? signal : null;
  }

  async getSignalEvidenceAnchor(
    workspaceId: string,
    viewerUserId: string,
    signalId: string,
    sourceEventId?: string,
  ): Promise<SignalEvidenceAnchor | null> {
    if (!this.#hasRlsContext(workspaceId, viewerUserId)) {
      return this.#withRlsContext(workspaceId, viewerUserId, (store) =>
        store.getSignalEvidenceAnchor(workspaceId, viewerUserId, signalId, sourceEventId),
      );
    }
    const signal = await this.#getAccessibleSignal(workspaceId, viewerUserId, signalId);
    if (!signal) return null;
    if (sourceEventId) {
      const sourceEvent = await this.getEvent(workspaceId, sourceEventId);
      return sourceEvent?.entityType === "signal" && sourceEvent.entityId === signal.id
        ? { signal, sourceEvent }
        : null;
    }
    const approvedSourceEvent = await this.#getApprovedSourceEvent(
      workspaceId,
      viewerUserId,
      signal.id,
    );
    if (approvedSourceEvent) return { signal, sourceEvent: approvedSourceEvent };
    const payloadEventId = sourceEventIdFromPayload(signal.payload);
    const payloadEvent = payloadEventId ? await this.getEvent(workspaceId, payloadEventId) : null;
    if (payloadEvent?.entityType === "signal" && payloadEvent.entityId === signal.id) {
      return { signal, sourceEvent: payloadEvent };
    }
    const eventRows = await this.#db
      .select()
      .from(events)
      .where(
        and(
          eq(events.workspaceId, workspaceId),
          eq(events.entityType, "signal"),
          eq(events.entityId, signal.id),
        ),
      )
      .orderBy(desc(events.createdAt))
      .limit(1);
    const sourceEvent = eventRows[0];
    return sourceEvent ? { signal, sourceEvent } : null;
  }

  async #getApprovedSourceEvent(
    workspaceId: string,
    viewerUserId: string,
    signalId: string,
  ): Promise<typeof events.$inferSelect | null> {
    const rows = await this.#db
      .select()
      .from(edges)
      .where(
        and(
          eq(edges.workspaceId, workspaceId),
          eq(edges.edgeType, "source_event"),
          isNotNull(edges.decisionSequence),
          or(
            eq(edges.ownerUserId, viewerUserId),
            inArray(edges.visibility, ["workspace", "public"]),
          ),
          or(
            and(
              eq(edges.srcType, "signal"),
              eq(edges.srcId, signalId),
              eq(edges.dstType, "event"),
              sql<boolean>`EXISTS (
                SELECT 1
                FROM "events" AS "approved_source_event"
                WHERE "approved_source_event"."workspace_id" = ${workspaceId}
                  AND "approved_source_event"."id" = ${edges.dstId}
                  AND "approved_source_event"."entity_type" = 'signal'
                  AND "approved_source_event"."entity_id" = ${signalId}
              )`,
            ),
            and(
              eq(edges.dstType, "signal"),
              eq(edges.dstId, signalId),
              eq(edges.srcType, "event"),
              sql<boolean>`EXISTS (
                SELECT 1
                FROM "events" AS "approved_source_event"
                WHERE "approved_source_event"."workspace_id" = ${workspaceId}
                  AND "approved_source_event"."id" = ${edges.srcId}
                  AND "approved_source_event"."entity_type" = 'signal'
                  AND "approved_source_event"."entity_id" = ${signalId}
              )`,
            ),
          ),
        ),
      )
      .orderBy(...this.#relationPreferenceOrder(viewerUserId))
      .limit(1);
    const relation = rows[0];
    if (!relation) return null;
    const eventId = relation.srcType === "event" ? relation.srcId : relation.dstId;
    const sourceEvent = await this.getEvent(workspaceId, eventId);
    return sourceEvent?.entityType === "signal" && sourceEvent.entityId === signalId
      ? sourceEvent
      : null;
  }

  async #canReadNode(
    workspaceId: string,
    viewerUserId: string,
    nodeType: string,
    nodeId: string,
  ): Promise<boolean> {
    if (nodeType === "person") return (await this.getPerson(workspaceId, viewerUserId, nodeId)) !== null;
    if (nodeType === "community") return (await this.getCommunity(workspaceId, viewerUserId, nodeId)) !== null;
    if (nodeType === "signal") return (await this.#getAccessibleSignal(workspaceId, viewerUserId, nodeId)) !== null;
    if (nodeType === "event") {
      const event = await this.getEvent(workspaceId, nodeId);
      if (!event) return false;
      if (event.entityType === "interaction") {
        const payload = payloadRecord(event.payload);
        return (
          payloadString(payload, "ownerUserId") === viewerUserId ||
          payloadString(payload, "visibility") === "workspace"
        );
      }
      if (event.entityType !== "signal") return false;
      return (await this.#getAccessibleSignal(workspaceId, viewerUserId, event.entityId)) !== null;
    }
    return false;
  }

  #accessibleNodeCondition(
    nodeType: typeof edges.srcType | typeof edges.dstType,
    nodeId: typeof edges.srcId | typeof edges.dstId,
    workspaceId: string,
    viewerUserId: string,
  ) {
    return sql<boolean>`(
      (${nodeType} = 'person' AND EXISTS (
        SELECT 1
        FROM "people" AS "relation_person"
        WHERE "relation_person"."workspace_id" = ${workspaceId}
          AND "relation_person"."id" = ${nodeId}
          AND "relation_person"."archived_at" IS NULL
          AND (
            "relation_person"."visibility" = 'workspace'
            OR (
              "relation_person"."visibility" IN ('private', 'team')
              AND "relation_person"."user_id" = ${viewerUserId}
            )
          )
      ))
      OR (${nodeType} = 'community' AND EXISTS (
        SELECT 1
        FROM "communities" AS "relation_community"
        WHERE "relation_community"."workspace_id" = ${workspaceId}
          AND "relation_community"."id" = ${nodeId}
          AND "relation_community"."archived_at" IS NULL
          AND (
            "relation_community"."visibility" = 'workspace'
            OR (
              "relation_community"."visibility" IN ('private', 'team')
              AND "relation_community"."user_id" = ${viewerUserId}
            )
          )
      ))
      OR (${nodeType} = 'signal' AND EXISTS (
        SELECT 1
        FROM "signals" AS "relation_signal"
        WHERE "relation_signal"."workspace_id" = ${workspaceId}
          AND "relation_signal"."id" = ${nodeId}
          AND (
            ("relation_signal"."subject_type" = 'person' AND EXISTS (
              SELECT 1
              FROM "people" AS "relation_signal_person"
              WHERE "relation_signal_person"."workspace_id" = ${workspaceId}
                AND "relation_signal_person"."id" = "relation_signal"."subject_id"
                AND "relation_signal_person"."archived_at" IS NULL
                AND (
                  "relation_signal_person"."visibility" = 'workspace'
                  OR (
                    "relation_signal_person"."visibility" IN ('private', 'team')
                    AND "relation_signal_person"."user_id" = ${viewerUserId}
                  )
                )
            ))
            OR ("relation_signal"."subject_type" = 'community' AND EXISTS (
              SELECT 1
              FROM "communities" AS "relation_signal_community"
              WHERE "relation_signal_community"."workspace_id" = ${workspaceId}
                AND "relation_signal_community"."id" = "relation_signal"."subject_id"
                AND "relation_signal_community"."archived_at" IS NULL
                AND (
                  "relation_signal_community"."visibility" = 'workspace'
                  OR (
                    "relation_signal_community"."visibility" IN ('private', 'team')
                    AND "relation_signal_community"."user_id" = ${viewerUserId}
                  )
                )
            ))
          )
      ))
      OR (${nodeType} = 'event' AND EXISTS (
        SELECT 1
        FROM "events" AS "relation_event"
        LEFT JOIN "signals" AS "relation_event_signal"
          ON "relation_event_signal"."workspace_id" = "relation_event"."workspace_id"
         AND "relation_event_signal"."id" = "relation_event"."entity_id"
        WHERE "relation_event"."workspace_id" = ${workspaceId}
          AND "relation_event"."id" = ${nodeId}
          AND (
            (
              "relation_event"."entity_type" = 'interaction'
              AND (
                "relation_event"."payload" ->> 'ownerUserId' = ${viewerUserId}
                OR "relation_event"."payload" ->> 'visibility' = 'workspace'
              )
            )
            OR (
              "relation_event"."entity_type" = 'signal'
              AND (
                ("relation_event_signal"."subject_type" = 'person' AND EXISTS (
                  SELECT 1
                  FROM "people" AS "relation_event_person"
                  WHERE "relation_event_person"."workspace_id" = ${workspaceId}
                    AND "relation_event_person"."id" = "relation_event_signal"."subject_id"
                    AND "relation_event_person"."archived_at" IS NULL
                    AND (
                      "relation_event_person"."visibility" = 'workspace'
                      OR (
                        "relation_event_person"."visibility" IN ('private', 'team')
                        AND "relation_event_person"."user_id" = ${viewerUserId}
                      )
                    )
                ))
                OR ("relation_event_signal"."subject_type" = 'community' AND EXISTS (
                  SELECT 1
                  FROM "communities" AS "relation_event_community"
                  WHERE "relation_event_community"."workspace_id" = ${workspaceId}
                    AND "relation_event_community"."id" = "relation_event_signal"."subject_id"
                    AND "relation_event_community"."archived_at" IS NULL
                    AND (
                      "relation_event_community"."visibility" = 'workspace'
                      OR (
                        "relation_event_community"."visibility" IN ('private', 'team')
                        AND "relation_event_community"."user_id" = ${viewerUserId}
                      )
                    )
                ))
              )
            )
          )
      ))
    )`;
  }

  #readableSignalSubjectCondition(workspaceId: string, viewerUserId: string) {
    return sql<boolean>`(
      (${signals.subjectType} = 'person' AND EXISTS (
        SELECT 1
        FROM "people" AS "signal_list_person"
        WHERE "signal_list_person"."workspace_id" = ${workspaceId}
          AND "signal_list_person"."id" = ${signals.subjectId}
          AND "signal_list_person"."archived_at" IS NULL
          AND (
            "signal_list_person"."visibility" = 'workspace'
            OR (
              "signal_list_person"."visibility" IN ('private', 'team')
              AND "signal_list_person"."user_id" = ${viewerUserId}
            )
          )
      ))
      OR (${signals.subjectType} = 'community' AND EXISTS (
        SELECT 1
        FROM "communities" AS "signal_list_community"
        WHERE "signal_list_community"."workspace_id" = ${workspaceId}
          AND "signal_list_community"."id" = ${signals.subjectId}
          AND "signal_list_community"."archived_at" IS NULL
          AND (
            "signal_list_community"."visibility" = 'workspace'
            OR (
              "signal_list_community"."visibility" IN ('private', 'team')
              AND "signal_list_community"."user_id" = ${viewerUserId}
            )
          )
      ))
    )`;
  }

  #signalHasReadableDetailCondition(workspaceId: string, viewerUserId: string) {
    return sql<boolean>`EXISTS (
      SELECT 1
      FROM "events" AS "signal_list_event"
      WHERE "signal_list_event"."workspace_id" = ${workspaceId}
        AND "signal_list_event"."entity_type" = 'signal'
        AND "signal_list_event"."entity_id" = ${signals.id}
        AND "signal_list_event"."id" = COALESCE(
          (
            SELECT CASE
              WHEN "signal_list_source_relation"."src_type" = 'event'
                THEN "signal_list_source_relation"."src_id"
              ELSE "signal_list_source_relation"."dst_id"
            END
            FROM "edges" AS "signal_list_source_relation"
            WHERE "signal_list_source_relation"."workspace_id" = ${workspaceId}
              AND "signal_list_source_relation"."edge_type" = 'source_event'
              AND "signal_list_source_relation"."decision_sequence" IS NOT NULL
              AND (
                "signal_list_source_relation"."owner_user_id" = ${viewerUserId}
                OR "signal_list_source_relation"."visibility" IN ('workspace', 'public')
              )
              AND (
                (
                  "signal_list_source_relation"."src_type" = 'signal'
                  AND "signal_list_source_relation"."src_id" = ${signals.id}
                  AND "signal_list_source_relation"."dst_type" = 'event'
                  AND EXISTS (
                    SELECT 1
                    FROM "events" AS "signal_list_approved_event"
                    WHERE "signal_list_approved_event"."workspace_id" = ${workspaceId}
                      AND "signal_list_approved_event"."id" = "signal_list_source_relation"."dst_id"
                      AND "signal_list_approved_event"."entity_type" = 'signal'
                      AND "signal_list_approved_event"."entity_id" = ${signals.id}
                  )
                )
                OR (
                  "signal_list_source_relation"."dst_type" = 'signal'
                  AND "signal_list_source_relation"."dst_id" = ${signals.id}
                  AND "signal_list_source_relation"."src_type" = 'event'
                  AND EXISTS (
                    SELECT 1
                    FROM "events" AS "signal_list_approved_event"
                    WHERE "signal_list_approved_event"."workspace_id" = ${workspaceId}
                      AND "signal_list_approved_event"."id" = "signal_list_source_relation"."src_id"
                      AND "signal_list_approved_event"."entity_type" = 'signal'
                      AND "signal_list_approved_event"."entity_id" = ${signals.id}
                  )
                )
              )
            ORDER BY
              CASE
                WHEN "signal_list_source_relation"."owner_user_id" = ${viewerUserId}
                  THEN 0
                ELSE 1
              END,
              "signal_list_source_relation"."decision_sequence" DESC,
              "signal_list_source_relation"."decision_at" DESC,
              "signal_list_source_relation"."observed_at" DESC,
              "signal_list_source_relation"."created_at" DESC
            LIMIT 1
          ),
          (
            SELECT "signal_list_payload_event"."id"
            FROM "events" AS "signal_list_payload_event"
            WHERE "signal_list_payload_event"."workspace_id" = ${workspaceId}
              AND "signal_list_payload_event"."entity_type" = 'signal'
              AND "signal_list_payload_event"."entity_id" = ${signals.id}
              AND lower("signal_list_payload_event"."id"::text) = lower(
                COALESCE(
                  ${signals.payload}->>'sourceEventId',
                  ${signals.payload}->>'eventId'
                )
              )
            LIMIT 1
          ),
          (
            SELECT "signal_list_latest_event"."id"
            FROM "events" AS "signal_list_latest_event"
            WHERE "signal_list_latest_event"."workspace_id" = ${workspaceId}
              AND "signal_list_latest_event"."entity_type" = 'signal'
              AND "signal_list_latest_event"."entity_id" = ${signals.id}
            ORDER BY "signal_list_latest_event"."created_at" DESC
            LIMIT 1
          )
        )
        AND EXISTS (
          SELECT 1
          FROM "edges" AS "signal_list_participant"
          WHERE "signal_list_participant"."workspace_id" = ${workspaceId}
            AND "signal_list_participant"."edge_type" = 'participant'
            AND (
              "signal_list_participant"."owner_user_id" = ${viewerUserId}
              OR "signal_list_participant"."visibility" IN ('workspace', 'public')
            )
            AND (
              (
                (
                  (
                    "signal_list_participant"."src_type" = 'signal'
                    AND "signal_list_participant"."src_id" = ${signals.id}
                  )
                  OR (
                    "signal_list_participant"."src_type" = 'event'
                    AND "signal_list_participant"."src_id" = "signal_list_event"."id"
                  )
                )
                AND (
                  (
                    "signal_list_participant"."dst_type" = 'person'
                    AND EXISTS (
                      SELECT 1
                      FROM "people" AS "signal_list_participant_person"
                      WHERE "signal_list_participant_person"."workspace_id" = ${workspaceId}
                        AND "signal_list_participant_person"."id" = "signal_list_participant"."dst_id"
                        AND "signal_list_participant_person"."archived_at" IS NULL
                        AND (
                          "signal_list_participant_person"."visibility" = 'workspace'
                          OR (
                            "signal_list_participant_person"."visibility" IN ('private', 'team')
                            AND "signal_list_participant_person"."user_id" = ${viewerUserId}
                          )
                        )
                    )
                  )
                  OR (
                    "signal_list_participant"."dst_type" = 'community'
                    AND EXISTS (
                      SELECT 1
                      FROM "communities" AS "signal_list_participant_community"
                      WHERE "signal_list_participant_community"."workspace_id" = ${workspaceId}
                        AND "signal_list_participant_community"."id" = "signal_list_participant"."dst_id"
                        AND "signal_list_participant_community"."archived_at" IS NULL
                        AND (
                          "signal_list_participant_community"."visibility" = 'workspace'
                          OR (
                            "signal_list_participant_community"."visibility" IN ('private', 'team')
                            AND "signal_list_participant_community"."user_id" = ${viewerUserId}
                          )
                        )
                    )
                  )
                )
              )
              OR (
                (
                  (
                    "signal_list_participant"."dst_type" = 'signal'
                    AND "signal_list_participant"."dst_id" = ${signals.id}
                  )
                  OR (
                    "signal_list_participant"."dst_type" = 'event'
                    AND "signal_list_participant"."dst_id" = "signal_list_event"."id"
                  )
                )
                AND (
                  (
                    "signal_list_participant"."src_type" = 'person'
                    AND EXISTS (
                      SELECT 1
                      FROM "people" AS "signal_list_participant_person"
                      WHERE "signal_list_participant_person"."workspace_id" = ${workspaceId}
                        AND "signal_list_participant_person"."id" = "signal_list_participant"."src_id"
                        AND "signal_list_participant_person"."archived_at" IS NULL
                        AND (
                          "signal_list_participant_person"."visibility" = 'workspace'
                          OR (
                            "signal_list_participant_person"."visibility" IN ('private', 'team')
                            AND "signal_list_participant_person"."user_id" = ${viewerUserId}
                          )
                        )
                    )
                  )
                  OR (
                    "signal_list_participant"."src_type" = 'community'
                    AND EXISTS (
                      SELECT 1
                      FROM "communities" AS "signal_list_participant_community"
                      WHERE "signal_list_participant_community"."workspace_id" = ${workspaceId}
                        AND "signal_list_participant_community"."id" = "signal_list_participant"."src_id"
                        AND "signal_list_participant_community"."archived_at" IS NULL
                        AND (
                          "signal_list_participant_community"."visibility" = 'workspace'
                          OR (
                            "signal_list_participant_community"."visibility" IN ('private', 'team')
                            AND "signal_list_participant_community"."user_id" = ${viewerUserId}
                          )
                        )
                    )
                  )
                )
              )
            )
        )
    )`;
  }

  async #loadAccessibleNodes(
    workspaceId: string,
    viewerUserId: string,
    references: Array<{ nodeType: string; nodeId: string }>,
    seed: { signalIds?: string[]; eventIds?: string[] } = {},
  ): Promise<AccessibleNodes> {
    const grouped = {
      person: new Set<string>(),
      community: new Set<string>(),
      signal: new Set<string>(),
      event: new Set<string>(),
    };
    let accepted = 0;
    for (const reference of references) {
      if (
        !UUID_PATTERN.test(reference.nodeId) ||
        !Object.hasOwn(grouped, reference.nodeType)
      ) {
        continue;
      }
      const values = grouped[reference.nodeType as keyof typeof grouped];
      const id = reference.nodeId.toLowerCase();
      if (values.has(id)) continue;
      if (accepted >= MAX_BATCH_NODE_REFS) break;
      values.add(id);
      accepted += 1;
    }
    const seededSignalIds = new Set(
      (seed.signalIds ?? []).map((id) => id.toLowerCase()),
    );
    const seededEventIds = new Set(
      (seed.eventIds ?? []).map((id) => id.toLowerCase()),
    );
    for (const id of seededSignalIds) grouped.signal.delete(id);
    for (const id of seededEventIds) grouped.event.delete(id);

    const [personRows, communityRows, signalRows, eventRows] = await Promise.all([
      grouped.person.size === 0
        ? Promise.resolve<PersonRecord[]>([])
        : this.#db
            .select({
              id: people.id,
              workspaceId: people.workspaceId,
              ownerUserId: people.userId,
              isOwner: sql<boolean>`${people.userId} = ${viewerUserId}`,
              visibility: people.visibility,
              displayName: sql<string | null>`coalesce(${people.fullNameOverride}, ${peopleCanonical.preferredName}, ${peopleCanonical.fullName})`,
              currentTitle: sql<string | null>`coalesce(${people.currentTitleOverride}, ${peopleCanonical.currentTitle})`,
              currentCommunityId: people.currentCommunityId,
              source: people.source,
              lastInteractionAt: people.lastInteractionAt,
              contextFreshnessAt: people.contextFreshnessAt,
              createdAt: people.createdAt,
            })
            .from(people)
            .leftJoin(
              peopleCanonical,
              eq(people.canonicalPersonId, peopleCanonical.id),
            )
            .where(
              and(
                eq(people.workspaceId, workspaceId),
                inArray(people.id, [...grouped.person]),
                or(
                  eq(people.visibility, "workspace"),
                  and(
                    inArray(people.visibility, ["private", "team"]),
                    eq(people.userId, viewerUserId),
                  ),
                ),
                isNull(people.archivedAt),
              ),
            ),
      grouped.community.size === 0
        ? Promise.resolve<CommunityRecord[]>([])
        : this.#db
            .select({
              id: communities.id,
              workspaceId: communities.workspaceId,
              ownerUserId: communities.userId,
              isOwner: sql<boolean>`${communities.userId} = ${viewerUserId}`,
              visibility: communities.visibility,
              displayName: sql<string | null>`coalesce(${communities.nameOverride}, ${communitiesCanonical.name})`,
              description: sql<string | null>`coalesce(${communities.descriptionOverride}, ${communitiesCanonical.description})`,
              kind: sql<string | null>`coalesce(${communities.kind}, ${communitiesCanonical.kind})`,
              source: communities.source,
              isUserConfirmed: communities.isUserConfirmed,
              memberCount: sql<number>`0`,
            })
            .from(communities)
            .leftJoin(
              communitiesCanonical,
              eq(communities.canonicalCommunityId, communitiesCanonical.id),
            )
            .where(
              and(
                eq(communities.workspaceId, workspaceId),
                inArray(communities.id, [...grouped.community]),
                or(
                  eq(communities.visibility, "workspace"),
                  and(
                    inArray(communities.visibility, ["private", "team"]),
                    eq(communities.userId, viewerUserId),
                  ),
                ),
                isNull(communities.archivedAt),
              ),
            ),
      grouped.signal.size === 0
        ? Promise.resolve<Array<{ id: string }>>([])
        : this.#db
            .select({ id: signals.id })
            .from(signals)
            .where(
              and(
                eq(signals.workspaceId, workspaceId),
                inArray(signals.id, [...grouped.signal]),
                this.#readableSignalSubjectCondition(
                  workspaceId,
                  viewerUserId,
                ),
              ),
            ),
      grouped.event.size === 0
        ? Promise.resolve<Array<{ id: string }>>([])
        : this.#db
            .select({ id: events.id })
            .from(events)
            .leftJoin(
              signals,
              and(
                eq(signals.workspaceId, events.workspaceId),
                eq(signals.id, events.entityId),
              ),
            )
            .where(
              and(
                eq(events.workspaceId, workspaceId),
                inArray(events.id, [...grouped.event]),
                or(
                  and(
                    eq(events.entityType, "interaction"),
                    sql<boolean>`(
                      ${events.payload} ->> 'ownerUserId' = ${viewerUserId}
                      OR ${events.payload} ->> 'visibility' = 'workspace'
                    )`,
                  ),
                  and(
                    eq(events.entityType, "signal"),
                    this.#readableSignalSubjectCondition(
                      workspaceId,
                      viewerUserId,
                    ),
                  ),
                ),
              ),
            ),
    ]);
    return {
      people: new Map(personRows.map((row) => [row.id, row])),
      communities: new Map(communityRows.map((row) => [row.id, row])),
      signalIds: new Set([
        ...seededSignalIds,
        ...signalRows.map((row) => row.id),
      ]),
      eventIds: new Set([
        ...seededEventIds,
        ...eventRows.map((row) => row.id),
      ]),
    };
  }

  #pruneRelationEvidence(
    relation: RelationRecord,
    accessible: AccessibleNodes,
  ): RelationRecord {
    const candidates = relationEvidenceCandidates(relation);
    return {
      ...relation,
      evidenceRefs: candidates.filter((reference) => {
        if (reference.entityType === "person") {
          return accessible.people.has(reference.entityId);
        }
        if (reference.entityType === "community") {
          return accessible.communities.has(reference.entityId);
        }
        if (reference.entityType === "signal") {
          return accessible.signalIds.has(reference.entityId);
        }
        if (reference.entityType === "event") {
          return accessible.eventIds.has(reference.entityId);
        }
        return false;
      }),
    };
  }

  async areRelationshipRecordsAccessible(
    workspaceId: string,
    viewerUserId: string,
    references: Array<{
      recordType: "person" | "community";
      recordId: string;
    }>,
  ): Promise<boolean> {
    if (!this.#hasRlsContext(workspaceId, viewerUserId)) {
      return this.#withRlsContext(workspaceId, viewerUserId, (store) =>
        store.areRelationshipRecordsAccessible(
          workspaceId,
          viewerUserId,
          references,
        ),
      );
    }
    if (references.length === 0 || references.length > 100) return false;
    const unique = new Map(
      references.map((reference) => [
        `${reference.recordType}:${reference.recordId.toLowerCase()}`,
        {
          nodeType: reference.recordType,
          nodeId: reference.recordId.toLowerCase(),
        },
      ]),
    );
    if (unique.size !== references.length) return false;
    const accessible = await this.#loadAccessibleNodes(
      workspaceId,
      viewerUserId,
      [...unique.values()],
    );
    return [...unique.values()].every((reference) =>
      reference.nodeType === "person"
        ? accessible.people.has(reference.nodeId)
        : accessible.communities.has(reference.nodeId),
    );
  }

  async listRelations(
    workspaceId: string,
    viewerUserId: string,
    anchor: { nodeType: string; nodeId: string },
    opts: { limit: number; cursor?: RelationCursor | null },
  ): Promise<RelationPage> {
    if (!this.#hasRlsContext(workspaceId, viewerUserId)) {
      return this.#withRlsContext(workspaceId, viewerUserId, (store) =>
        store.listRelations(workspaceId, viewerUserId, anchor, opts),
      );
    }
    if (!(await this.#canReadNode(workspaceId, viewerUserId, anchor.nodeType, anchor.nodeId))) {
      return { items: [], total: 0, nextCursor: null };
    }
    const limit = Math.min(Math.max(opts.limit, 1), MAX_RELATION_PAGE_SIZE);
    const visibleRelation = or(
      eq(edges.ownerUserId, viewerUserId),
      inArray(edges.visibility, ["workspace", "public"]),
    );
    const baseWhere = and(
      eq(edges.workspaceId, workspaceId),
      visibleRelation,
      or(
        and(
          eq(edges.srcType, anchor.nodeType),
          eq(edges.srcId, anchor.nodeId),
          this.#accessibleNodeCondition(edges.dstType, edges.dstId, workspaceId, viewerUserId),
        ),
        and(
          eq(edges.dstType, anchor.nodeType),
          eq(edges.dstId, anchor.nodeId),
          this.#accessibleNodeCondition(edges.srcType, edges.srcId, workspaceId, viewerUserId),
        ),
      ),
    );
    const cursorWhere = opts.cursor
      ? or(
          lt(edges.observedAt, opts.cursor.observedAt),
          and(
            eq(edges.observedAt, opts.cursor.observedAt),
            lt(edges.createdAt, opts.cursor.createdAt),
          ),
          and(
            eq(edges.observedAt, opts.cursor.observedAt),
            eq(edges.createdAt, opts.cursor.createdAt),
            lt(edges.id, opts.cursor.id),
          ),
        )
      : undefined;
    const [rows, totalRows] = await Promise.all([
      this.#db
        .select()
        .from(edges)
        .where(and(baseWhere, cursorWhere))
        .orderBy(
          desc(edges.observedAt),
          desc(edges.createdAt),
          desc(edges.id),
        )
        .limit(limit + 1),
      this.#db.select({ value: count() }).from(edges).where(baseWhere),
    ]);
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const evidenceReferences = pageRows.flatMap((relation) =>
      relationEvidenceCandidates(relation).map((reference) => ({
        nodeType: reference.entityType,
        nodeId: reference.entityId,
      })),
    );
    const accessible = await this.#loadAccessibleNodes(
      workspaceId,
      viewerUserId,
      evidenceReferences,
      {
        signalIds: anchor.nodeType === "signal" ? [anchor.nodeId] : [],
        eventIds: anchor.nodeType === "event" ? [anchor.nodeId] : [],
      },
    );
    const last = pageRows.at(-1);
    return {
      items: pageRows.map((relation) =>
        this.#pruneRelationEvidence(relation, accessible),
      ),
      total: Number(totalRows[0]?.value ?? 0),
      nextCursor:
        hasMore && last
          ? {
              observedAt: last.observedAt,
              createdAt: last.createdAt,
              id: last.id,
            }
          : null,
    };
  }

  async findRelationshipPaths(
    workspaceId: string,
    viewerUserId: string,
    start: RelationshipPathNode,
    end: RelationshipPathNode,
    opts: {
      maxDepth: number;
      maxPaths: number;
      maxVisited?: number;
      maxEdgesPerNode?: number;
    },
  ): Promise<RelationshipPathResult> {
    if (!this.#hasRlsContext(workspaceId, viewerUserId)) {
      return this.#withRlsContext(workspaceId, viewerUserId, (store) =>
        store.findRelationshipPaths(workspaceId, viewerUserId, start, end, opts),
      );
    }
    const maxDepth = clamp(opts.maxDepth, 1, 6);
    const maxPaths = clamp(opts.maxPaths, 1, 5);
    const maxVisited = clamp(opts.maxVisited ?? 100, 1, 200);
    const maxEdgesPerNode = clamp(opts.maxEdgesPerNode ?? 50, 1, 100);
    const [canReadStart, canReadEnd] = await Promise.all([
      this.#canReadNode(
        workspaceId,
        viewerUserId,
        start.nodeType,
        start.nodeId,
      ),
      this.#canReadNode(
        workspaceId,
        viewerUserId,
        end.nodeType,
        end.nodeId,
      ),
    ]);
    if (!canReadStart || !canReadEnd) {
      return { paths: [], visited: 0, truncated: false };
    }
    const key = (node: RelationshipPathNode) =>
      `${node.nodeType}:${node.nodeId}`;
    if (key(start) === key(end)) {
      return {
        paths: [{ nodes: [start], steps: [], confidence: 1 }],
        visited: 1,
        truncated: false,
      };
    }
    const queue: Array<{
      node: RelationshipPathNode;
      nodes: RelationshipPathNode[];
      steps: RelationshipPathStep[];
      confidence: number;
      seen: Set<string>;
    }> = [{
      node: start,
      nodes: [start],
      steps: [],
      confidence: 1,
      seen: new Set([key(start)]),
    }];
    const shortestDepthByNode = new Map<string, number>([[key(start), 0]]);
    const paths: RelationshipPath[] = [];
    let visited = 0;
    let truncated = false;
    let shortestFoundDepth: number | null = null;
    while (queue.length > 0 && paths.length < maxPaths) {
      const current = queue.shift()!;
      const depth = current.steps.length;
      if (depth >= maxDepth || (shortestFoundDepth !== null && depth >= shortestFoundDepth)) {
        continue;
      }
      if (visited >= maxVisited) {
        truncated = true;
        break;
      }
      visited += 1;
      const page = await this.listRelations(
        workspaceId,
        viewerUserId,
        {
          nodeType: current.node.nodeType,
          nodeId: current.node.nodeId,
        },
        { limit: maxEdgesPerNode },
      );
      if (page.nextCursor !== null || page.total > page.items.length) {
        truncated = true;
      }
      for (const relation of page.items) {
        const currentIsSource =
          relation.srcType === current.node.nodeType &&
          relation.srcId === current.node.nodeId;
        const next: RelationshipPathNode = currentIsSource
          ? { nodeType: relation.dstType, nodeId: relation.dstId }
          : { nodeType: relation.srcType, nodeId: relation.srcId };
        const nextKey = key(next);
        if (current.seen.has(nextKey)) continue;
        const nextDepth = depth + 1;
        const step: RelationshipPathStep = {
          from: current.node,
          to: next,
          relation,
        };
        const nextPath: RelationshipPath = {
          nodes: [...current.nodes, next],
          steps: [...current.steps, step],
          confidence:
            current.confidence *
            Math.min(1, Math.max(0, Number(relation.confidence))),
        };
        if (nextKey === key(end)) {
          shortestFoundDepth ??= nextDepth;
          if (nextDepth === shortestFoundDepth) paths.push(nextPath);
          if (paths.length >= maxPaths) break;
          continue;
        }
        if (nextDepth >= maxDepth || shortestFoundDepth !== null) continue;
        const priorDepth = shortestDepthByNode.get(nextKey);
        if (priorDepth !== undefined && priorDepth < nextDepth) continue;
        shortestDepthByNode.set(nextKey, nextDepth);
        queue.push({
          node: next,
          nodes: nextPath.nodes,
          steps: nextPath.steps,
          confidence: nextPath.confidence,
          seen: new Set([...current.seen, nextKey]),
        });
      }
    }
    return { paths, visited, truncated };
  }

  async upsertRelation(input: UpsertRelationInput): Promise<RelationRecord> {
    if (!this.#hasRlsContext(input.workspaceId, input.ownerUserId)) {
      return this.#withRlsContext(input.workspaceId, input.ownerUserId, (store) =>
        store.upsertRelation(input),
      );
    }
    const relationInput: UpsertRelationInput = {
      ...input,
      workspaceId: input.workspaceId.toLowerCase(),
      ownerUserId: input.ownerUserId.toLowerCase(),
      srcId: input.srcId.toLowerCase(),
      dstId: input.dstId.toLowerCase(),
      evidenceRefs: input.evidenceRefs.map((reference) => ({
        ...reference,
        entityId: reference.entityId.toLowerCase(),
      })),
    };
    assertRelationInput(relationInput);
    const [canReadSource, canReadDestination, srcOwner, dstOwner] = await Promise.all([
      this.#canReadNode(
        relationInput.workspaceId,
        relationInput.ownerUserId,
        relationInput.srcType,
        relationInput.srcId,
      ),
      this.#canReadNode(
        relationInput.workspaceId,
        relationInput.ownerUserId,
        relationInput.dstType,
        relationInput.dstId,
      ),
      this.getNodeTypeOwner(relationInput.srcType),
      this.getNodeTypeOwner(relationInput.dstType),
    ]);
    if (!canReadSource || !canReadDestination) {
      throw new Error("Relation endpoints must both exist and be accessible");
    }
    if (!srcOwner || !dstOwner) {
      throw new Error(
        `Unknown Relation node type: ${!srcOwner ? relationInput.srcType : relationInput.dstType}`,
      );
    }

    const rows = await this.#db
      .insert(edges)
      .values({
        workspaceId: relationInput.workspaceId,
        ownerUserId: relationInput.ownerUserId,
        srcType: relationInput.srcType,
        srcId: relationInput.srcId,
        dstType: relationInput.dstType,
        dstId: relationInput.dstId,
        edgeType: relationInput.relationType.trim(),
        properties: relationInput.properties ?? {},
        evidenceRefs: relationInput.evidenceRefs,
        confidence: String(relationInput.confidence),
        observedAt: relationInput.observedAt,
        validFrom: relationInput.validFrom ?? null,
        validTo: relationInput.validTo ?? null,
        userConfirmed: relationInput.userConfirmed,
        visibility: relationInput.visibility,
        source: relationInput.source.trim(),
        sourceModule: relationInput.sourceModule.trim(),
        decisionLedgerId: relationInput.decisionLedgerId ?? null,
        decisionSequence: relationInput.decisionSequence ?? null,
        decisionAt: relationInput.decisionAt ?? null,
      })
      .onConflictDoUpdate({
        target: [
          edges.workspaceId,
          edges.srcType,
          edges.srcId,
          edges.dstType,
          edges.dstId,
          edges.edgeType,
          edges.ownerUserId,
        ],
        set: {
          properties: sql`CASE WHEN ${edges.decisionAt} IS NULL THEN ${edges.properties} || excluded."properties" ELSE ${edges.properties} END`,
          evidenceRefs: sql`CASE WHEN ${edges.decisionAt} IS NULL THEN (
              SELECT COALESCE(jsonb_agg(item ORDER BY item::text), '[]'::jsonb)
              FROM (
                SELECT value AS item
                FROM jsonb_array_elements(${edges.evidenceRefs} || excluded."evidence_refs")
                GROUP BY value
                ORDER BY value::text
                LIMIT ${MAX_RELATION_EVIDENCE_REFS}
              ) merged_evidence
            ) ELSE ${edges.evidenceRefs} END`,
          confidence: sql`CASE WHEN ${edges.decisionAt} IS NULL THEN excluded."confidence" ELSE ${edges.confidence} END`,
          observedAt: sql`CASE WHEN ${edges.decisionAt} IS NULL THEN excluded."observed_at" ELSE ${edges.observedAt} END`,
          validFrom: sql`CASE WHEN ${edges.decisionAt} IS NULL THEN excluded."valid_from" ELSE ${edges.validFrom} END`,
          validTo: sql`CASE WHEN ${edges.decisionAt} IS NULL THEN excluded."valid_to" ELSE ${edges.validTo} END`,
          userConfirmed: sql`CASE WHEN ${edges.decisionAt} IS NULL THEN ${edges.userConfirmed} OR excluded."user_confirmed" ELSE ${edges.userConfirmed} END`,
          visibility: sql`CASE WHEN ${edges.decisionAt} IS NULL THEN excluded."visibility" ELSE ${edges.visibility} END`,
          source: sql`CASE WHEN ${edges.decisionAt} IS NULL THEN excluded."source" ELSE ${edges.source} END`,
          sourceModule: sql`CASE WHEN ${edges.decisionAt} IS NULL THEN excluded."source_module" ELSE ${edges.sourceModule} END`,
          decisionLedgerId: sql`CASE WHEN ${edges.decisionAt} IS NULL THEN excluded."decision_ledger_id" ELSE ${edges.decisionLedgerId} END`,
          decisionSequence: sql`CASE WHEN ${edges.decisionAt} IS NULL THEN excluded."decision_sequence" ELSE ${edges.decisionSequence} END`,
          decisionAt: sql`CASE WHEN ${edges.decisionAt} IS NULL THEN excluded."decision_at" ELSE ${edges.decisionAt} END`,
        },
      })
      .returning();
    const relation = rows[0];
    if (!relation) throw new Error("Relation upsert returned no row");
    return relation;
  }

  async materializeSignalEvidence(
    input: MaterializeSignalEvidenceInput,
  ): Promise<{ sourceEvent: RelationRecord; participants: RelationRecord[] }> {
    if (!this.#hasRlsContext(input.workspaceId, input.ownerUserId)) {
      return this.#withRlsContext(input.workspaceId, input.ownerUserId, (store) =>
        store.materializeSignalEvidence(input),
      );
    }
    const workspaceId = input.workspaceId.toLowerCase();
    const ownerUserId = input.ownerUserId.toLowerCase();
    const signalId = input.signalId.toLowerCase();
    const sourceEventId = input.sourceEventId.toLowerCase();
    const decisionLedgerId = input.decisionLedgerId.toLowerCase();
    const participants = input.participants.map((participant) => ({
      ...participant,
      recordId: participant.recordId.toLowerCase(),
    }));
    if (
      !UUID_PATTERN.test(workspaceId) ||
      !UUID_PATTERN.test(ownerUserId) ||
      !UUID_PATTERN.test(signalId) ||
      !UUID_PATTERN.test(sourceEventId)
    ) {
      throw new Error("Signal evidence workspace, owner, Signal, and Event must be UUIDs");
    }
    if (
      !UUID_PATTERN.test(decisionLedgerId) ||
      !Number.isSafeInteger(input.decisionSequence) ||
      input.decisionSequence <= 0 ||
      Number.isNaN(input.decisionAt.getTime())
    ) {
      throw new Error(
        "Signal evidence decision provenance is required",
      );
    }
    if (participants.length === 0 || participants.length > 100) {
      throw new Error("Signal evidence requires 1-100 participants");
    }
    const participantKeys = participants.map(
      (participant) => `${participant.recordType}:${participant.recordId}`,
    );
    if (new Set(participantKeys).size !== participantKeys.length) {
      throw new Error("Signal evidence participants must be unique by Record");
    }

    await this.#db.execute(
      sql`SELECT pg_advisory_xact_lock(
        hashtextextended(${`${workspaceId}:${ownerUserId}:${signalId}`}, 0::bigint)
      )`,
    );
    const watermarkRows = await this.#db
      .select()
      .from(edges)
      .where(
        and(
          eq(edges.workspaceId, workspaceId),
          eq(edges.ownerUserId, ownerUserId),
          eq(edges.edgeType, "source_event"),
          isNotNull(edges.decisionSequence),
          or(
            and(eq(edges.srcType, "signal"), eq(edges.srcId, signalId)),
            and(eq(edges.dstType, "signal"), eq(edges.dstId, signalId)),
          ),
        ),
      )
      .orderBy(
        desc(edges.decisionSequence),
        desc(edges.decisionAt),
        desc(edges.id),
      )
      .limit(1);
    const watermark = watermarkRows[0];
    const pruneSupersededRelations = async (
      winningDecisionSequence: number,
      winningDecisionLedgerId: string,
    ) => {
      const sourceRelations = await this.#db
        .select({
          srcType: edges.srcType,
          srcId: edges.srcId,
          dstType: edges.dstType,
          dstId: edges.dstId,
        })
        .from(edges)
        .where(
          and(
            eq(edges.workspaceId, workspaceId),
            eq(edges.ownerUserId, ownerUserId),
            eq(edges.edgeType, "source_event"),
            eq(edges.sourceModule, "relationship"),
            isNotNull(edges.decisionSequence),
            or(
              and(eq(edges.srcType, "signal"), eq(edges.srcId, signalId)),
              and(eq(edges.dstType, "signal"), eq(edges.dstId, signalId)),
            ),
          ),
        );
      const eventIds = [
        ...new Set(
          sourceRelations.flatMap((relation) => [
            ...(relation.srcType === "event" ? [relation.srcId] : []),
            ...(relation.dstType === "event" ? [relation.dstId] : []),
          ]),
        ),
      ];
      const supersededDecision = sql<boolean>`(
        ${edges.decisionSequence} < ${winningDecisionSequence}
        OR (
          ${edges.decisionSequence} = ${winningDecisionSequence}
          AND ${edges.decisionLedgerId} <> ${winningDecisionLedgerId}
        )
      )`;
      if (eventIds.length > 0) {
        await this.#db
          .delete(edges)
          .where(
            and(
              eq(edges.workspaceId, workspaceId),
              eq(edges.ownerUserId, ownerUserId),
              eq(edges.edgeType, "participant"),
              eq(edges.sourceModule, "relationship"),
              isNotNull(edges.decisionSequence),
              supersededDecision,
              or(
                and(
                  eq(edges.srcType, "event"),
                  inArray(edges.srcId, eventIds),
                ),
                and(
                  eq(edges.dstType, "event"),
                  inArray(edges.dstId, eventIds),
                ),
              ),
            ),
          );
      }
      await this.#db
        .delete(edges)
        .where(
          and(
            eq(edges.workspaceId, workspaceId),
            eq(edges.ownerUserId, ownerUserId),
            eq(edges.edgeType, "source_event"),
            eq(edges.sourceModule, "relationship"),
            isNotNull(edges.decisionSequence),
            supersededDecision,
            or(
              and(eq(edges.srcType, "signal"), eq(edges.srcId, signalId)),
              and(eq(edges.dstType, "signal"), eq(edges.dstId, signalId)),
            ),
          ),
        );
    };
    if (
      watermark?.decisionSequence !== null &&
      watermark?.decisionSequence !== undefined &&
      (
        watermark.decisionSequence >= input.decisionSequence
      )
    ) {
      if (!watermark.decisionLedgerId) {
        throw new Error("Canonical Relationship decision provenance is incomplete");
      }
      await pruneSupersededRelations(
        watermark.decisionSequence,
        watermark.decisionLedgerId,
      );
      const canonicalEventId =
        watermark.srcType === "event"
          ? watermark.srcId
          : watermark.dstType === "event"
            ? watermark.dstId
            : null;
      if (!canonicalEventId) {
        throw new Error("Canonical Relationship source Event is invalid");
      }
      const canonicalParticipants = await this.#db
        .select()
        .from(edges)
        .where(
          and(
            eq(edges.workspaceId, workspaceId),
            eq(edges.ownerUserId, ownerUserId),
            eq(edges.edgeType, "participant"),
            eq(edges.sourceModule, "relationship"),
            eq(edges.decisionSequence, watermark.decisionSequence),
            eq(edges.decisionLedgerId, watermark.decisionLedgerId),
            or(
              and(
                eq(edges.srcType, "event"),
                eq(edges.srcId, canonicalEventId),
              ),
              and(
                eq(edges.dstType, "event"),
                eq(edges.dstId, canonicalEventId),
              ),
            ),
          ),
        );
      return {
        sourceEvent: watermark,
        participants: canonicalParticipants,
      };
    }

    const signal = await this.#getAccessibleSignal(
      workspaceId,
      ownerUserId,
      signalId,
    );
    if (!signal) throw new Error("Signal not found or not accessible");
    const sourceEvent = await this.getEvent(workspaceId, sourceEventId);
    if (
      !sourceEvent ||
      sourceEvent.entityType !== "signal" ||
      sourceEvent.entityId !== signal.id
    ) {
      throw new Error("Source Event must belong to the Signal");
    }
    const sourceEventPayload =
      typeof sourceEvent.payload === "object" &&
      sourceEvent.payload !== null &&
      !Array.isArray(sourceEvent.payload)
        ? sourceEvent.payload as Record<string, unknown>
        : {};
    const source =
      typeof sourceEventPayload.source === "string" &&
      sourceEventPayload.source.trim()
        ? sourceEventPayload.source.trim()
        : `event:${sourceEvent.type}`;
    const observedAt = sourceEvent.createdAt;
    if (
      !participants.some(
        (participant) =>
          participant.recordType === signal.subjectType &&
          participant.recordId === signal.subjectId,
      )
    ) {
      throw new Error("Signal evidence participants must include the Signal subject");
    }

    const nodeTypeNames = [
      "signal",
      "event",
      ...participants.map((participant) => participant.recordType),
    ];
    const nodeTypeOwners = await Promise.all(
      [...new Set(nodeTypeNames)].map((nodeType) =>
        this.getNodeTypeOwner(nodeType),
      ),
    );
    if (
      nodeTypeOwners.some(
        (owner) => owner === null || owner.owningModule !== "relationship",
      )
    ) {
      throw new Error("Signal evidence node types must be owned by the Relationship Module");
    }

    const invalidParticipant = participants.find(
      (participant) =>
        !UUID_PATTERN.test(participant.recordId) ||
        !Number.isFinite(participant.confidence) ||
        participant.confidence < 0 ||
        participant.confidence > 1,
    );
    if (
      invalidParticipant ||
      !(await this.areRelationshipRecordsAccessible(
        workspaceId,
        ownerUserId,
        participants,
      ))
    ) {
      throw new Error(
        "Signal evidence participants are invalid or not accessible",
      );
    }

    const evidenceRef: RelationEvidenceRef = {
      entityType: "event",
      entityId: sourceEvent.id,
      source,
    };
    const values: Array<typeof edges.$inferInsert> = [
      {
        workspaceId,
        ownerUserId,
        srcType: "signal",
        srcId: signal.id,
        dstType: "event",
        dstId: sourceEvent.id,
        edgeType: "source_event",
        properties: {},
        evidenceRefs: [evidenceRef],
        confidence: "1",
        observedAt,
        userConfirmed: input.userConfirmed,
        visibility: input.visibility,
        source,
        sourceModule: "relationship",
        decisionLedgerId,
        decisionSequence: input.decisionSequence,
        decisionAt: input.decisionAt,
      },
      ...participants.map(
        (participant): typeof edges.$inferInsert => ({
          workspaceId,
          ownerUserId,
          srcType: "event",
          srcId: sourceEvent.id,
          dstType: participant.recordType,
          dstId: participant.recordId,
          edgeType: "participant",
          properties: participant.role ? { role: participant.role } : {},
          evidenceRefs: [evidenceRef],
          confidence: String(participant.confidence),
          observedAt,
          userConfirmed: input.userConfirmed,
          visibility: input.visibility,
          source,
          sourceModule: "relationship",
          decisionLedgerId,
          decisionSequence: input.decisionSequence,
          decisionAt: input.decisionAt,
        }),
      ),
    ];
    const incomingDecisionWins = sql<boolean>`(
      ${edges.decisionSequence} IS NULL
      OR excluded."decision_sequence" > ${edges.decisionSequence}
      OR (
        excluded."decision_sequence" = ${edges.decisionSequence}
        AND excluded."decision_ledger_id" = ${edges.decisionLedgerId}
      )
    )`;
    const rows = await this.#db
      .insert(edges)
      .values(values)
      .onConflictDoUpdate({
        target: [
          edges.workspaceId,
          edges.srcType,
          edges.srcId,
          edges.dstType,
          edges.dstId,
          edges.edgeType,
          edges.ownerUserId,
        ],
        set: {
          properties: sql`CASE WHEN ${incomingDecisionWins} THEN excluded."properties" ELSE ${edges.properties} END`,
          evidenceRefs: sql`CASE WHEN ${incomingDecisionWins} THEN excluded."evidence_refs" ELSE ${edges.evidenceRefs} END`,
          confidence: sql`CASE WHEN ${incomingDecisionWins} THEN excluded."confidence" ELSE ${edges.confidence} END`,
          observedAt: sql`CASE WHEN ${incomingDecisionWins} THEN excluded."observed_at" ELSE ${edges.observedAt} END`,
          validFrom: sql`CASE WHEN ${incomingDecisionWins} THEN excluded."valid_from" ELSE ${edges.validFrom} END`,
          validTo: sql`CASE WHEN ${incomingDecisionWins} THEN excluded."valid_to" ELSE ${edges.validTo} END`,
          userConfirmed: sql`CASE WHEN ${incomingDecisionWins} THEN excluded."user_confirmed" ELSE ${edges.userConfirmed} END`,
          visibility: sql`CASE WHEN ${incomingDecisionWins} THEN excluded."visibility" ELSE ${edges.visibility} END`,
          source: sql`CASE WHEN ${incomingDecisionWins} THEN excluded."source" ELSE ${edges.source} END`,
          sourceModule: sql`CASE WHEN ${incomingDecisionWins} THEN excluded."source_module" ELSE ${edges.sourceModule} END`,
          decisionLedgerId: sql`CASE WHEN ${incomingDecisionWins} THEN excluded."decision_ledger_id" ELSE ${edges.decisionLedgerId} END`,
          decisionSequence: sql`CASE WHEN ${incomingDecisionWins} THEN excluded."decision_sequence" ELSE ${edges.decisionSequence} END`,
          decisionAt: sql`CASE WHEN ${incomingDecisionWins} THEN excluded."decision_at" ELSE ${edges.decisionAt} END`,
        },
      })
      .returning();
    const sourceEventRelation = rows.find((relation) => relation.edgeType === "source_event");
    if (!sourceEventRelation || rows.length !== values.length) {
      throw new Error("Signal evidence Relations were not materialized atomically");
    }
    await pruneSupersededRelations(input.decisionSequence, decisionLedgerId);
    return {
      sourceEvent: sourceEventRelation,
      participants: rows.filter((relation) => relation.edgeType === "participant"),
    };
  }

  async listInitiatives(workspaceId: string, opts: PageOpts): Promise<Page<typeof initiatives.$inferSelect>> {
    const where = eq(initiatives.workspaceId, workspaceId);
    const [rows, totalRows] = await Promise.all([
      this.#db.select().from(initiatives).where(where).orderBy(desc(initiatives.createdAt)).limit(opts.limit).offset(opts.offset),
      this.#db.select({ value: count() }).from(initiatives).where(where),
    ]);
    return { items: rows, total: Number(totalRows[0]?.value ?? 0) };
  }

  async getInitiative(id: string): Promise<typeof initiatives.$inferSelect | null> {
    const rows = await this.#db.select().from(initiatives).where(eq(initiatives.id, id)).limit(1);
    return rows[0] ?? null;
  }

  /** Optionally scoped to one initiative (the tree view) or left workspace-wide. */
  async listTouchpoints(
    workspaceId: string,
    opts: PageOpts & { initiativeId?: string },
  ): Promise<Page<typeof touchpoints.$inferSelect>> {
    const where = opts.initiativeId
      ? and(eq(touchpoints.workspaceId, workspaceId), eq(touchpoints.initiativeId, opts.initiativeId))
      : eq(touchpoints.workspaceId, workspaceId);
    const [rows, totalRows] = await Promise.all([
      this.#db.select().from(touchpoints).where(where).orderBy(touchpoints.sortOrder).limit(opts.limit).offset(opts.offset),
      this.#db.select({ value: count() }).from(touchpoints).where(where),
    ]);
    return { items: rows, total: Number(totalRows[0]?.value ?? 0) };
  }

  async listSignals(
    workspaceId: string,
    viewerUserId: string,
    opts: PageOpts & {
      subjectType?: "person" | "community";
      subjectId?: string;
    },
  ): Promise<Page<typeof signals.$inferSelect>> {
    if (!this.#hasRlsContext(workspaceId, viewerUserId)) {
      return this.#withRlsContext(workspaceId, viewerUserId, (store) =>
        store.listSignals(workspaceId, viewerUserId, opts),
      );
    }
    const limit = Math.min(Math.max(opts.limit, 1), MAX_RELATION_PAGE_SIZE);
    const offset = Math.max(opts.offset, 0);
    const where = and(
      eq(signals.workspaceId, workspaceId),
      opts.subjectType ? eq(signals.subjectType, opts.subjectType) : undefined,
      opts.subjectId ? eq(signals.subjectId, opts.subjectId) : undefined,
      this.#readableSignalSubjectCondition(workspaceId, viewerUserId),
      this.#signalHasReadableDetailCondition(workspaceId, viewerUserId),
    );
    const [rows, totalRows] = await Promise.all([
      this.#db
        .select()
        .from(signals)
        .where(where)
        .orderBy(desc(signals.createdAt))
        .limit(limit)
        .offset(offset),
      this.#db.select({ value: count() }).from(signals).where(where),
    ]);
    return {
      items: rows,
      total: Number(totalRows[0]?.value ?? 0),
    };
  }

  async listPeople(
    workspaceId: string,
    viewerUserId: string,
    opts: PageOpts & { query?: string },
  ): Promise<Page<PersonRecord>> {
    if (!this.#hasRlsContext(workspaceId, viewerUserId)) {
      return this.#withRlsContext(workspaceId, viewerUserId, (store) =>
        store.listPeople(workspaceId, viewerUserId, opts),
      );
    }
    const limit = clamp(opts.limit, 1, 100);
    const offset = Math.max(0, opts.offset);
    const query = opts.query?.trim().slice(0, 120);
    const pattern = query
      ? `%${query.replace(/[!%_]/g, (value) => `!${value}`)}%`
      : null;
    const readable = and(
      eq(people.workspaceId, workspaceId),
      or(
        eq(people.visibility, "workspace"),
        and(
          or(eq(people.visibility, "private"), eq(people.visibility, "team")),
          eq(people.userId, viewerUserId),
        ),
      ),
      isNull(people.archivedAt),
    );
    const where = and(
      readable,
      pattern
        ? sql<boolean>`(
            coalesce(${people.fullNameOverride}, ${peopleCanonical.preferredName}, ${peopleCanonical.fullName}, '') ILIKE ${pattern} ESCAPE '!'
            OR coalesce(${people.currentTitleOverride}, ${peopleCanonical.currentTitle}, '') ILIKE ${pattern} ESCAPE '!'
          )`
        : undefined,
    );
    const [rows, totalRows] = await Promise.all([
      this.#db
        .select({
          id: people.id,
          workspaceId: people.workspaceId,
          ownerUserId: people.userId,
          isOwner: sql<boolean>`${people.userId} = ${viewerUserId}`,
          visibility: people.visibility,
          displayName: sql<string | null>`coalesce(${people.fullNameOverride}, ${peopleCanonical.preferredName}, ${peopleCanonical.fullName})`,
          currentTitle: sql<string | null>`coalesce(${people.currentTitleOverride}, ${peopleCanonical.currentTitle})`,
          currentCommunityId: people.currentCommunityId,
          source: people.source,
          lastInteractionAt: people.lastInteractionAt,
          contextFreshnessAt: people.contextFreshnessAt,
          createdAt: people.createdAt,
        })
        .from(people)
        .leftJoin(peopleCanonical, eq(people.canonicalPersonId, peopleCanonical.id))
        .where(where)
        .orderBy(
          sql`lower(coalesce(${people.fullNameOverride}, ${peopleCanonical.preferredName}, ${peopleCanonical.fullName}, ''))`,
          people.id,
        )
        .limit(limit)
        .offset(offset),
      this.#db
        .select({ value: count() })
        .from(people)
        .leftJoin(peopleCanonical, eq(people.canonicalPersonId, peopleCanonical.id))
        .where(where),
    ]);
    return { items: rows, total: Number(totalRows[0]?.value ?? 0) };
  }

  async getPerson(
    workspaceId: string,
    viewerUserId: string,
    id: string,
  ): Promise<PersonDetail | null> {
    if (!this.#hasRlsContext(workspaceId, viewerUserId)) {
      return this.#withRlsContext(workspaceId, viewerUserId, (store) =>
        store.getPerson(workspaceId, viewerUserId, id),
      );
    }
    const rows = await this.#db
      .select({
        id: people.id,
        workspaceId: people.workspaceId,
        ownerUserId: people.userId,
        isOwner: sql<boolean>`${people.userId} = ${viewerUserId}`,
        visibility: people.visibility,
        displayName: sql<string | null>`coalesce(${people.fullNameOverride}, ${peopleCanonical.preferredName}, ${peopleCanonical.fullName})`,
        currentTitle: sql<string | null>`coalesce(${people.currentTitleOverride}, ${peopleCanonical.currentTitle})`,
        currentCommunityId: people.currentCommunityId,
        source: people.source,
        lastInteractionAt: people.lastInteractionAt,
        contextFreshnessAt: people.contextFreshnessAt,
        createdAt: people.createdAt,
        bio: sql<string | null>`coalesce(${people.bioOverride}, ${peopleCanonical.bio})`,
        avatarUrl: sql<string | null>`coalesce(${people.avatarUrlOverride}, ${peopleCanonical.avatarUrl})`,
        emails: sql<string[]>`coalesce(${people.emailsOverride}, ${peopleCanonical.emails}, ARRAY[]::text[])`,
      })
      .from(people)
      .leftJoin(peopleCanonical, eq(people.canonicalPersonId, peopleCanonical.id))
      .where(
        and(
          eq(people.workspaceId, workspaceId),
          eq(people.id, id),
          or(
            eq(people.visibility, "workspace"),
            and(
              or(eq(people.visibility, "private"), eq(people.visibility, "team")),
              eq(people.userId, viewerUserId),
            ),
          ),
          isNull(people.archivedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findPeopleByEmail(
    workspaceId: string,
    viewerUserId: string,
    email: string,
    limit = 2,
  ): Promise<PersonDetail[]> {
    if (!this.#hasRlsContext(workspaceId, viewerUserId)) {
      return this.#withRlsContext(workspaceId, viewerUserId, (store) =>
        store.findPeopleByEmail(workspaceId, viewerUserId, email, limit),
      );
    }
    const normalizedEmail = email.trim().toLowerCase().slice(0, 320);
    if (!normalizedEmail) return [];
    return this.#db
      .select({
        id: people.id,
        workspaceId: people.workspaceId,
        ownerUserId: people.userId,
        isOwner: sql<boolean>`${people.userId} = ${viewerUserId}`,
        visibility: people.visibility,
        displayName: sql<string | null>`coalesce(${people.fullNameOverride}, ${peopleCanonical.preferredName}, ${peopleCanonical.fullName})`,
        currentTitle: sql<string | null>`coalesce(${people.currentTitleOverride}, ${peopleCanonical.currentTitle})`,
        currentCommunityId: people.currentCommunityId,
        source: people.source,
        lastInteractionAt: people.lastInteractionAt,
        contextFreshnessAt: people.contextFreshnessAt,
        createdAt: people.createdAt,
        bio: sql<string | null>`coalesce(${people.bioOverride}, ${peopleCanonical.bio})`,
        avatarUrl: sql<string | null>`coalesce(${people.avatarUrlOverride}, ${peopleCanonical.avatarUrl})`,
        emails: sql<string[]>`coalesce(${people.emailsOverride}, ${peopleCanonical.emails}, ARRAY[]::text[])`,
      })
      .from(people)
      .leftJoin(peopleCanonical, eq(people.canonicalPersonId, peopleCanonical.id))
      .where(and(
        eq(people.workspaceId, workspaceId),
        or(
          eq(people.visibility, "workspace"),
          and(
            or(eq(people.visibility, "private"), eq(people.visibility, "team")),
            eq(people.userId, viewerUserId),
          ),
        ),
        isNull(people.archivedAt),
        sql<boolean>`EXISTS (
          SELECT 1
          FROM unnest(coalesce(
            ${people.emailsOverride},
            ${peopleCanonical.emails},
            ARRAY[]::text[]
          )) AS visible_email
          WHERE lower(trim(visible_email)) = ${normalizedEmail}
        )`,
      ))
      .orderBy(people.id)
      .limit(clamp(limit, 1, 2));
  }

  async listCommunities(
    workspaceId: string,
    viewerUserId: string,
    opts: PageOpts & { query?: string },
  ): Promise<Page<CommunityRecord>> {
    if (!this.#hasRlsContext(workspaceId, viewerUserId)) {
      return this.#withRlsContext(workspaceId, viewerUserId, (store) =>
        store.listCommunities(workspaceId, viewerUserId, opts),
      );
    }
    const limit = clamp(opts.limit, 1, 100);
    const offset = Math.max(0, opts.offset);
    const query = opts.query?.trim().slice(0, 120);
    const pattern = query
      ? `%${query.replace(/[!%_]/g, (value) => `!${value}`)}%`
      : null;
    const readable = and(
      eq(communities.workspaceId, workspaceId),
      or(
        eq(communities.visibility, "workspace"),
        and(
          or(eq(communities.visibility, "private"), eq(communities.visibility, "team")),
          eq(communities.userId, viewerUserId),
        ),
      ),
      isNull(communities.archivedAt),
    );
    const where = and(
      readable,
      pattern
        ? sql<boolean>`(
            coalesce(${communities.nameOverride}, ${communitiesCanonical.name}, '') ILIKE ${pattern} ESCAPE '!'
            OR coalesce(${communities.kind}, ${communitiesCanonical.kind}, '') ILIKE ${pattern} ESCAPE '!'
          )`
        : undefined,
    );
    const memberCount = sql<number>`(
      SELECT count(*)::int
      FROM "community_members" AS "visible_community_member"
      JOIN "people" AS "visible_community_person"
        ON "visible_community_person"."id" = "visible_community_member"."person_id"
      WHERE "visible_community_person"."workspace_id" = ${workspaceId}
        AND "visible_community_member"."community_id" = ${communities.id}
        AND "visible_community_person"."archived_at" IS NULL
        AND (
          "visible_community_person"."visibility" = 'workspace'
          OR (
            "visible_community_person"."visibility" IN ('private', 'team')
            AND "visible_community_person"."user_id" = ${viewerUserId}
          )
        )
    )`;
    const [rows, totalRows] = await Promise.all([
      this.#db
        .select({
          id: communities.id,
          workspaceId: communities.workspaceId,
          ownerUserId: communities.userId,
          isOwner: sql<boolean>`${communities.userId} = ${viewerUserId}`,
          visibility: communities.visibility,
          displayName: sql<string | null>`coalesce(${communities.nameOverride}, ${communitiesCanonical.name})`,
          description: sql<string | null>`coalesce(${communities.descriptionOverride}, ${communitiesCanonical.description})`,
          kind: sql<string | null>`coalesce(${communities.kind}, ${communitiesCanonical.kind})`,
          source: communities.source,
          isUserConfirmed: communities.isUserConfirmed,
          memberCount,
        })
        .from(communities)
        .leftJoin(communitiesCanonical, eq(communities.canonicalCommunityId, communitiesCanonical.id))
        .where(where)
        .orderBy(
          sql`lower(coalesce(${communities.nameOverride}, ${communitiesCanonical.name}, ''))`,
          communities.id,
        )
        .limit(limit)
        .offset(offset),
      this.#db
        .select({ value: count() })
        .from(communities)
        .leftJoin(communitiesCanonical, eq(communities.canonicalCommunityId, communitiesCanonical.id))
        .where(where),
    ]);
    return { items: rows, total: Number(totalRows[0]?.value ?? 0) };
  }

  async getCommunity(
    workspaceId: string,
    viewerUserId: string,
    id: string,
  ): Promise<CommunityDetail | null> {
    if (!this.#hasRlsContext(workspaceId, viewerUserId)) {
      return this.#withRlsContext(workspaceId, viewerUserId, (store) =>
        store.getCommunity(workspaceId, viewerUserId, id),
      );
    }
    const rows = await this.#db
      .select({
        id: communities.id,
        workspaceId: communities.workspaceId,
        ownerUserId: communities.userId,
        isOwner: sql<boolean>`${communities.userId} = ${viewerUserId}`,
        visibility: communities.visibility,
        displayName: sql<string | null>`coalesce(${communities.nameOverride}, ${communitiesCanonical.name})`,
        description: sql<string | null>`coalesce(${communities.descriptionOverride}, ${communitiesCanonical.description})`,
        kind: sql<string | null>`coalesce(${communities.kind}, ${communitiesCanonical.kind})`,
        source: communities.source,
        isUserConfirmed: communities.isUserConfirmed,
        memberCount: sql<number>`(
          SELECT count(*)::int
          FROM "community_members" AS "visible_community_member"
          JOIN "people" AS "visible_community_person"
            ON "visible_community_person"."id" = "visible_community_member"."person_id"
          WHERE "visible_community_person"."workspace_id" = ${workspaceId}
            AND "visible_community_member"."community_id" = ${communities.id}
            AND "visible_community_person"."archived_at" IS NULL
            AND (
              "visible_community_person"."visibility" = 'workspace'
              OR (
                "visible_community_person"."visibility" IN ('private', 'team')
                AND "visible_community_person"."user_id" = ${viewerUserId}
              )
            )
        )`,
      })
      .from(communities)
      .leftJoin(communitiesCanonical, eq(communities.canonicalCommunityId, communitiesCanonical.id))
      .where(
        and(
          eq(communities.workspaceId, workspaceId),
          eq(communities.id, id),
          or(
            eq(communities.visibility, "workspace"),
            and(
              or(eq(communities.visibility, "private"), eq(communities.visibility, "team")),
              eq(communities.userId, viewerUserId),
            ),
          ),
          isNull(communities.archivedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async createPerson(input: CreatePersonInput): Promise<PersonDetail> {
    if (!this.#hasRlsContext(input.workspaceId, input.ownerUserId)) {
      return this.#withRlsContext(input.workspaceId, input.ownerUserId, (store) =>
        store.createPerson(input),
      );
    }
    const emails = normalizeEmails(input.emails);
    await this.#db
      .insert(peopleCanonical)
      .values({
        id: input.id,
        fullName: input.displayName.trim(),
        preferredName: input.displayName.trim(),
        currentTitle: input.currentTitle?.trim() || null,
        bio: input.bio?.trim() || null,
        emails,
      })
      .onConflictDoNothing();
    await this.#db
      .insert(people)
      .values({
        id: input.id,
        workspaceId: input.workspaceId,
        userId: input.ownerUserId,
        canonicalPersonId: input.id,
        visibility: input.visibility,
        fullNameOverride: input.displayName.trim(),
        currentTitleOverride: input.currentTitle?.trim() || null,
        bioOverride: input.bio?.trim() || null,
        emailsOverride: emails,
        source: input.source.trim(),
      })
      .onConflictDoNothing();
    const person = await this.getPerson(input.workspaceId, input.ownerUserId, input.id);
    if (!person || person.ownerUserId !== input.ownerUserId) {
      throw new Error("Person create did not materialize an owner-readable Record");
    }
    await this.#recordLifecycleEvent({
      ...input,
      recordType: "person",
      operation: "created",
      displayName: person.displayName,
    });
    return person;
  }

  async updatePerson(input: UpdatePersonInput): Promise<PersonDetail | null> {
    if (!this.#hasRlsContext(input.workspaceId, input.ownerUserId)) {
      return this.#withRlsContext(input.workspaceId, input.ownerUserId, (store) =>
        store.updatePerson(input),
      );
    }
    const values: Partial<typeof people.$inferInsert> = {};
    if (input.displayName !== undefined) values.fullNameOverride = input.displayName.trim();
    if (input.currentTitle !== undefined) values.currentTitleOverride = input.currentTitle?.trim() || null;
    if (input.bio !== undefined) values.bioOverride = input.bio?.trim() || null;
    if (input.emails !== undefined) values.emailsOverride = normalizeEmails(input.emails);
    if (input.visibility !== undefined) values.visibility = input.visibility;
    if (Object.keys(values).length === 0) throw new Error("Person update requires at least one field");
    const locked = await this.#db
      .select({ id: people.id, archivedAt: people.archivedAt })
      .from(people)
      .where(and(
        eq(people.workspaceId, input.workspaceId),
        eq(people.id, input.id),
        eq(people.userId, input.ownerUserId),
      ))
      .for("update", { of: people })
      .limit(1);
    if (!locked[0]) return null;
    if (locked[0].archivedAt) {
      await this.#recordSkippedMutationReceipt({
        ...input,
        recordType: "person",
        operation: "update",
        reason: "record_archived",
      });
      return null;
    }
    if (
      await this.#hasNewerRecordDecision(
        input.workspaceId,
        input.ownerUserId,
        "person",
        input.id,
        input.decisionSequence,
      )
    ) {
      await this.#recordSkippedMutationReceipt({
        ...input,
        recordType: "person",
        operation: "update",
        reason: "superseded_by_newer_decision",
      });
      return this.getPerson(input.workspaceId, input.ownerUserId, input.id);
    }
    const rows = await this.#db
      .update(people)
      .set(values)
      .where(and(
        eq(people.workspaceId, input.workspaceId),
        eq(people.id, input.id),
        eq(people.userId, input.ownerUserId),
        isNull(people.archivedAt),
      ))
      .returning();
    if (!rows[0]) return null;
    const person = await this.getPerson(input.workspaceId, input.ownerUserId, input.id);
    if (!person) throw new Error("Updated Person became unreadable");
    await this.#recordLifecycleEvent({
      ...input,
      recordType: "person",
      operation: "updated",
      displayName: person.displayName,
      visibility: person.visibility === "workspace" ? "workspace" : "private",
    });
    return person;
  }

  async archivePerson(input: ArchiveRelationshipRecordInput): Promise<boolean> {
    if (!this.#hasRlsContext(input.workspaceId, input.ownerUserId)) {
      return this.#withRlsContext(input.workspaceId, input.ownerUserId, (store) =>
        store.archivePerson(input),
      );
    }
    const [existing] = await this.#db
      .select({
        id: people.id,
        archivedAt: people.archivedAt,
        visibility: people.visibility,
        displayName: sql<string | null>`coalesce(${people.fullNameOverride}, ${peopleCanonical.preferredName}, ${peopleCanonical.fullName})`,
      })
      .from(people)
      .leftJoin(peopleCanonical, eq(people.canonicalPersonId, peopleCanonical.id))
      .where(and(
        eq(people.workspaceId, input.workspaceId),
        eq(people.id, input.id),
        eq(people.userId, input.ownerUserId),
      ))
      .for("update", { of: people })
      .limit(1);
    if (!existing) return false;
    if (existing.archivedAt) {
      await this.#recordSkippedMutationReceipt({
        ...input,
        recordType: "person",
        operation: "archive",
        reason: "record_archived",
      });
      return true;
    }
    if (
      await this.#hasNewerRecordDecision(
        input.workspaceId,
        input.ownerUserId,
        "person",
        input.id,
        input.decisionSequence,
      )
    ) {
      await this.#recordSkippedMutationReceipt({
        ...input,
        recordType: "person",
        operation: "archive",
        reason: "superseded_by_newer_decision",
      });
      return true;
    }
    await this.#recordLifecycleEvent({
      ...input,
      recordType: "person",
      operation: "archived",
      displayName: existing.displayName,
      visibility: existing.visibility === "workspace" ? "workspace" : "private",
    });
    const rows = await this.#db
      .update(people)
      .set({ archivedAt: input.decisionAt })
      .where(and(
        eq(people.workspaceId, input.workspaceId),
        eq(people.id, input.id),
        eq(people.userId, input.ownerUserId),
        isNull(people.archivedAt),
      ))
      .returning();
    return rows.length === 1;
  }

  async createCommunity(input: CreateCommunityInput): Promise<CommunityDetail> {
    if (!this.#hasRlsContext(input.workspaceId, input.ownerUserId)) {
      return this.#withRlsContext(input.workspaceId, input.ownerUserId, (store) =>
        store.createCommunity(input),
      );
    }
    await this.#db
      .insert(communitiesCanonical)
      .values({
        id: input.id,
        name: input.displayName.trim(),
        description: input.description?.trim() || null,
        kind: input.kind?.trim() || null,
      })
      .onConflictDoNothing();
    await this.#db
      .insert(communities)
      .values({
        id: input.id,
        workspaceId: input.workspaceId,
        userId: input.ownerUserId,
        canonicalCommunityId: input.id,
        visibility: input.visibility,
        nameOverride: input.displayName.trim(),
        descriptionOverride: input.description?.trim() || null,
        kind: input.kind?.trim() || null,
        source: input.source.trim(),
        isUserConfirmed: true,
      })
      .onConflictDoNothing();
    const community = await this.getCommunity(input.workspaceId, input.ownerUserId, input.id);
    if (!community || community.ownerUserId !== input.ownerUserId) {
      throw new Error("Community create did not materialize an owner-readable Record");
    }
    await this.#recordLifecycleEvent({
      ...input,
      recordType: "community",
      operation: "created",
      displayName: community.displayName,
    });
    return community;
  }

  async updateCommunity(input: UpdateCommunityInput): Promise<CommunityDetail | null> {
    if (!this.#hasRlsContext(input.workspaceId, input.ownerUserId)) {
      return this.#withRlsContext(input.workspaceId, input.ownerUserId, (store) =>
        store.updateCommunity(input),
      );
    }
    const values: Partial<typeof communities.$inferInsert> = {};
    if (input.displayName !== undefined) values.nameOverride = input.displayName.trim();
    if (input.description !== undefined) values.descriptionOverride = input.description?.trim() || null;
    if (input.kind !== undefined) values.kind = input.kind?.trim() || null;
    if (input.visibility !== undefined) values.visibility = input.visibility;
    if (Object.keys(values).length === 0) throw new Error("Community update requires at least one field");
    const locked = await this.#db
      .select({ id: communities.id, archivedAt: communities.archivedAt })
      .from(communities)
      .where(and(
        eq(communities.workspaceId, input.workspaceId),
        eq(communities.id, input.id),
        eq(communities.userId, input.ownerUserId),
      ))
      .for("update", { of: communities })
      .limit(1);
    if (!locked[0]) return null;
    if (locked[0].archivedAt) {
      await this.#recordSkippedMutationReceipt({
        ...input,
        recordType: "community",
        operation: "update",
        reason: "record_archived",
      });
      return null;
    }
    if (
      await this.#hasNewerRecordDecision(
        input.workspaceId,
        input.ownerUserId,
        "community",
        input.id,
        input.decisionSequence,
      )
    ) {
      await this.#recordSkippedMutationReceipt({
        ...input,
        recordType: "community",
        operation: "update",
        reason: "superseded_by_newer_decision",
      });
      return this.getCommunity(input.workspaceId, input.ownerUserId, input.id);
    }
    const rows = await this.#db
      .update(communities)
      .set(values)
      .where(and(
        eq(communities.workspaceId, input.workspaceId),
        eq(communities.id, input.id),
        eq(communities.userId, input.ownerUserId),
        isNull(communities.archivedAt),
      ))
      .returning();
    if (!rows[0]) return null;
    const community = await this.getCommunity(input.workspaceId, input.ownerUserId, input.id);
    if (!community) throw new Error("Updated Community became unreadable");
    await this.#recordLifecycleEvent({
      ...input,
      recordType: "community",
      operation: "updated",
      displayName: community.displayName,
      visibility: community.visibility === "workspace" ? "workspace" : "private",
    });
    return community;
  }

  async archiveCommunity(input: ArchiveRelationshipRecordInput): Promise<boolean> {
    if (!this.#hasRlsContext(input.workspaceId, input.ownerUserId)) {
      return this.#withRlsContext(input.workspaceId, input.ownerUserId, (store) =>
        store.archiveCommunity(input),
      );
    }
    const [existing] = await this.#db
      .select({
        id: communities.id,
        archivedAt: communities.archivedAt,
        visibility: communities.visibility,
        displayName: sql<string | null>`coalesce(${communities.nameOverride}, ${communitiesCanonical.name})`,
      })
      .from(communities)
      .leftJoin(communitiesCanonical, eq(communities.canonicalCommunityId, communitiesCanonical.id))
      .where(and(
        eq(communities.workspaceId, input.workspaceId),
        eq(communities.id, input.id),
        eq(communities.userId, input.ownerUserId),
      ))
      .for("update", { of: communities })
      .limit(1);
    if (!existing) return false;
    if (existing.archivedAt) {
      await this.#recordSkippedMutationReceipt({
        ...input,
        recordType: "community",
        operation: "archive",
        reason: "record_archived",
      });
      return true;
    }
    if (
      await this.#hasNewerRecordDecision(
        input.workspaceId,
        input.ownerUserId,
        "community",
        input.id,
        input.decisionSequence,
      )
    ) {
      await this.#recordSkippedMutationReceipt({
        ...input,
        recordType: "community",
        operation: "archive",
        reason: "superseded_by_newer_decision",
      });
      return true;
    }
    await this.#recordLifecycleEvent({
      ...input,
      recordType: "community",
      operation: "archived",
      displayName: existing.displayName,
      visibility: existing.visibility === "workspace" ? "workspace" : "private",
    });
    const rows = await this.#db
      .update(communities)
      .set({ archivedAt: input.decisionAt })
      .where(and(
        eq(communities.workspaceId, input.workspaceId),
        eq(communities.id, input.id),
        eq(communities.userId, input.ownerUserId),
        isNull(communities.archivedAt),
      ))
      .returning();
    return rows.length === 1;
  }

  async #recordLifecycleEvent(input: DecisionProvenance & {
    workspaceId: string;
    ownerUserId: string;
    recordType: "person" | "community";
    id: string;
    operation: "created" | "updated" | "archived";
    displayName: string | null;
    visibility: RelationshipRecordVisibility;
  }): Promise<void> {
    await this.#createInteractionInContext(
      {
        id: input.decisionLedgerId,
        workspaceId: input.workspaceId,
        ownerUserId: input.ownerUserId,
        kind: `${input.recordType}_${input.operation}`,
        occurredAt: input.decisionAt,
        summary: `${input.operation[0]?.toUpperCase()}${input.operation.slice(1)} ${input.displayName ?? input.recordType}`,
        source: "user",
        sourceRecordId: input.decisionLedgerId,
        visibility: input.visibility,
        participants: [{ recordType: input.recordType, recordId: input.id }],
        updatesPersonFreshness: false,
        decisionLedgerId: input.decisionLedgerId,
        decisionSequence: input.decisionSequence,
        decisionAt: input.decisionAt,
      },
      { recordMutationLifecycle: true },
    );
  }

  async #recordSkippedMutationReceipt(input: DecisionProvenance & {
    workspaceId: string;
    ownerUserId: string;
    recordType: "person" | "community";
    operation: "update" | "archive";
    reason: "record_archived" | "superseded_by_newer_decision";
  }): Promise<void> {
    await this.#db
      .insert(events)
      .values({
        id: input.decisionLedgerId,
        workspaceId: input.workspaceId,
        type: "relationship.materialization_skipped",
        entityType: "materialization_receipt",
        entityId: input.decisionLedgerId,
        payload: {
          kind: "relationship_record_mutation_receipt",
          recordType: input.recordType,
          operation: input.operation,
          outcome: "skipped",
          reason: input.reason,
          ownerUserId: input.ownerUserId,
          visibility: "private",
          decisionLedgerId: input.decisionLedgerId,
          decisionSequence: input.decisionSequence,
          decisionAt: input.decisionAt.toISOString(),
        },
      })
      .onConflictDoNothing();
    const receipt = await this.getEvent(input.workspaceId, input.decisionLedgerId);
    const payload = payloadRecord(receipt?.payload);
    const expectedLifecycleKind =
      `${input.recordType}_${input.operation === "archive" ? "archived" : "updated"}`;
    const kind = payloadString(payload, "kind");
    const decisionSequence = payload.decisionSequence;
    if (
      !receipt ||
      payloadString(payload, "ownerUserId") !== input.ownerUserId ||
      payloadString(payload, "decisionLedgerId") !== input.decisionLedgerId ||
      typeof decisionSequence !== "number" ||
      decisionSequence !== input.decisionSequence ||
      (kind !== "relationship_record_mutation_receipt" && kind !== expectedLifecycleKind)
    ) {
      throw new Error("Relationship mutation receipt conflicts with a different Event");
    }
  }

  async #hasNewerRecordDecision(
    workspaceId: string,
    ownerUserId: string,
    recordType: "person" | "community",
    recordId: string,
    decisionSequence: number,
  ): Promise<boolean> {
    const rows = await this.#db
      .select({ id: events.id })
      .from(events)
      .where(and(
        eq(events.workspaceId, workspaceId),
        eq(events.entityType, "interaction"),
        inArray(events.type, [
          `relationship.${recordType}_created`,
          `relationship.${recordType}_updated`,
          `relationship.${recordType}_archived`,
        ]),
        sql<boolean>`${events.payload} ->> 'recordMutationLifecycle' = 'true'`,
        sql<boolean>`${events.payload} ->> 'ownerUserId' = ${ownerUserId}`,
        sql<boolean>`(${events.payload} ->> 'decisionSequence') ~ '^[0-9]+$'`,
        sql<boolean>`(${events.payload} ->> 'decisionSequence')::bigint > ${decisionSequence}`,
        sql<boolean>`EXISTS (
          SELECT 1
          FROM "edges" AS "record_decision_participant"
          WHERE "record_decision_participant"."workspace_id" = ${workspaceId}
            AND "record_decision_participant"."owner_user_id" = ${ownerUserId}
            AND "record_decision_participant"."edge_type" = 'participant'
            AND "record_decision_participant"."src_type" = 'event'
            AND "record_decision_participant"."src_id" = ${events.id}
            AND "record_decision_participant"."dst_type" = ${recordType}
            AND "record_decision_participant"."dst_id" = ${recordId}
        )`,
      ))
      .limit(1);
    return rows.length > 0;
  }

  async createInteraction(input: CreateInteractionInput): Promise<TimelineItem> {
    if (!this.#hasRlsContext(input.workspaceId, input.ownerUserId)) {
      return this.#withRlsContext(input.workspaceId, input.ownerUserId, (store) =>
        store.createInteraction(input),
      );
    }
    return this.#createInteractionInContext(input);
  }

  async #createInteractionInContext(
    input: CreateInteractionInput,
    options: { recordMutationLifecycle?: boolean } = {},
  ): Promise<TimelineItem> {
    if (
      !UUID_PATTERN.test(input.id) ||
      !UUID_PATTERN.test(input.workspaceId) ||
      !UUID_PATTERN.test(input.ownerUserId) ||
      !UUID_PATTERN.test(input.decisionLedgerId)
    ) {
      throw new Error("Interaction identifiers must be UUIDs");
    }
    if (
      input.participants.length === 0 ||
      input.participants.length > MAX_INTERACTION_PARTICIPANTS
    ) {
      throw new Error(`An Interaction requires 1-${MAX_INTERACTION_PARTICIPANTS} participants`);
    }
    if (Number.isNaN(input.occurredAt.getTime())) {
      throw new Error("Interaction occurredAt must be a valid timestamp");
    }
    const participants = new Map<string, InteractionParticipantInput>();
    const participantNodes: AccessibleNodes = {
      people: new Map(),
      communities: new Map(),
      signalIds: new Set(),
      eventIds: new Set([input.id]),
    };
    let visibility = input.visibility;
    for (const participant of input.participants) {
      const key = `${participant.recordType}:${participant.recordId}`;
      if (participants.has(key)) continue;
      const record = participant.recordType === "person"
        ? await this.getPerson(input.workspaceId, input.ownerUserId, participant.recordId)
        : await this.getCommunity(input.workspaceId, input.ownerUserId, participant.recordId);
      if (!record) throw new Error("Interaction participant is not readable");
      if (record.visibility !== "workspace") visibility = "private";
      participants.set(key, participant);
      if (participant.recordType === "person") {
        participantNodes.people.set(participant.recordId, record as PersonRecord);
      } else {
        participantNodes.communities.set(participant.recordId, record as CommunityRecord);
      }
    }
    const payload = {
      kind: input.kind.trim(),
      occurredAt: input.occurredAt.toISOString(),
      summary: input.summary.trim(),
      source: input.source.trim(),
      sourceRecordId: input.sourceRecordId?.trim() || null,
      ownerUserId: input.ownerUserId,
      visibility,
      decisionLedgerId: input.decisionLedgerId,
      decisionSequence: input.decisionSequence,
      decisionAt: input.decisionAt.toISOString(),
      ...(input.metadata ? { metadata: input.metadata } : {}),
      ...(options.recordMutationLifecycle ? { recordMutationLifecycle: true } : {}),
    };
    await this.#db
      .insert(events)
      .values({
        id: input.id,
        workspaceId: input.workspaceId,
        type: `relationship.${input.kind.trim()}`,
        entityType: "interaction",
        entityId: input.id,
        payload,
      })
      .onConflictDoNothing();
    const event = await this.getEvent(input.workspaceId, input.id);
    const existingPayload = payloadRecord(event?.payload);
    if (
      !event ||
      event.entityType !== "interaction" ||
      payloadString(existingPayload, "ownerUserId") !== input.ownerUserId ||
      payloadString(existingPayload, "decisionLedgerId") !== input.decisionLedgerId
    ) {
      throw new Error("Interaction id conflicts with a different Event");
    }
    const relations: RelationRecord[] = [];
    for (const participant of participants.values()) {
      const relation = await this.upsertRelation({
        workspaceId: input.workspaceId,
        ownerUserId: input.ownerUserId,
        srcType: "event",
        srcId: input.id,
        dstType: participant.recordType,
        dstId: participant.recordId,
        relationType: "participant",
        properties: {
          role: participant.role?.trim() || null,
          attendanceState: participant.attendanceState?.trim() || null,
        },
        evidenceRefs: [{ entityType: "event", entityId: input.id, source: input.source }],
        confidence: 1,
        observedAt: input.occurredAt,
        validFrom: input.occurredAt,
        userConfirmed: true,
        visibility,
        source: input.source,
        sourceModule: "relationship",
        decisionLedgerId: input.decisionLedgerId,
        decisionSequence: input.decisionSequence,
        decisionAt: input.decisionAt,
      });
      relations.push(relation);
    }
    if (input.updatesPersonFreshness !== false) {
      const ownedPersonIds = [...participants.values()]
        .filter((participant) => participant.recordType === "person")
        .map((participant) => participant.recordId);
      if (ownedPersonIds.length > 0) {
        await this.#db
          .update(people)
          .set({ lastInteractionAt: input.occurredAt })
          .where(and(
            eq(people.workspaceId, input.workspaceId),
            eq(people.userId, input.ownerUserId),
            inArray(people.id, ownedPersonIds),
            isNull(people.archivedAt),
            or(
              isNull(people.lastInteractionAt),
              lt(people.lastInteractionAt, input.occurredAt),
            ),
          ));
      }
    }
    return this.#timelineItemFromRows(event, relations, participantNodes);
  }

  async materializeCommitment(
    input: MaterializeCommitmentInput,
  ): Promise<CommitmentRecord> {
    if (!this.#hasRlsContext(input.workspaceId, input.ownerUserId)) {
      return this.#withRlsContext(input.workspaceId, input.ownerUserId, (store) =>
        store.materializeCommitment(input),
      );
    }
    const occurredAt = input.decisionAt;
    await this.#createInteractionInContext({
      id: input.transitionEventId,
      workspaceId: input.workspaceId,
      ownerUserId: input.ownerUserId,
      kind: `commitment_${input.operation}`,
      occurredAt,
      summary: `${input.operation === "create" ? "Committed" : input.operation === "archive" ? "Archived commitment" : "Updated commitment"}: ${input.text}`,
      source: "user",
      sourceRecordId: input.sourceEventId ?? null,
      visibility: "private",
      participants: [{
        recordType: "person",
        recordId: input.personId,
        role: "commitment_subject",
      }],
      updatesPersonFreshness: false,
      metadata: {
        artifact: "commitment",
        commitmentId: input.commitmentId,
        personId: input.personId,
        text: input.text,
        dueAt: input.dueAt?.toISOString() ?? null,
        status: input.status,
        sourceEventId: input.sourceEventId ?? null,
      },
      decisionLedgerId: input.decisionLedgerId,
      decisionSequence: input.decisionSequence,
      decisionAt: input.decisionAt,
    });
    const evidenceRefs: RelationEvidenceRef[] = [
      {
        entityType: "event",
        entityId: input.transitionEventId,
        source: "relationship",
      },
      ...(input.sourceEventId
        ? [{
            entityType: "event",
            entityId: input.sourceEventId,
            source: "relationship",
          }]
        : []),
    ];
    const relation = await this.upsertRelation({
      workspaceId: input.workspaceId,
      ownerUserId: input.ownerUserId,
      srcType: "event",
      srcId: input.transitionEventId,
      dstType: "person",
      dstId: input.personId,
      relationType: "commitment",
      properties: {
        commitmentId: input.commitmentId,
        text: input.text,
        dueAt: input.dueAt?.toISOString() ?? null,
        status: input.status,
      },
      evidenceRefs,
      confidence: 1,
      observedAt: occurredAt,
      validFrom: occurredAt,
      userConfirmed: true,
      visibility: "private",
      source: "user",
      sourceModule: "relationship",
      decisionLedgerId: input.decisionLedgerId,
      decisionSequence: input.decisionSequence,
      decisionAt: input.decisionAt,
    });
    return {
      id: input.commitmentId,
      personId: input.personId,
      text: input.text,
      dueAt: input.dueAt ?? null,
      status: input.status,
      sourceEventId: input.sourceEventId ?? null,
      transitionEventId: input.transitionEventId,
      occurredAt,
      createdAt: occurredAt,
      provenance: {
        decisionLedgerId: input.decisionLedgerId,
        decisionSequence: input.decisionSequence,
        relationId: relation.id,
        evidenceRefs: relation.evidenceRefs,
      },
    };
  }

  async listCommitments(
    workspaceId: string,
    viewerUserId: string,
    personId: string,
    opts: PageOpts & { includeArchived?: boolean; commitmentId?: string },
  ): Promise<CommitmentPage> {
    if (!this.#hasRlsContext(workspaceId, viewerUserId)) {
      return this.#withRlsContext(workspaceId, viewerUserId, (store) =>
        store.listCommitments(workspaceId, viewerUserId, personId, opts),
      );
    }
    const person = await this.getPerson(workspaceId, viewerUserId, personId);
    if (!person) return { items: [], total: 0 };
    const limit = clamp(opts.limit, 1, 100);
    const offset = clamp(opts.offset, 0, 10_000);
    const result = await this.#db.execute(sql`
      WITH latest AS (
        SELECT DISTINCT ON (
          transition.payload #>> '{metadata,commitmentId}'
        )
          transition.payload #>> '{metadata,commitmentId}' AS commitment_id,
          transition.payload #>> '{metadata,personId}' AS person_id,
          transition.payload #>> '{metadata,text}' AS text,
          transition.payload #>> '{metadata,dueAt}' AS due_at,
          transition.payload #>> '{metadata,status}' AS status,
          transition.payload #>> '{metadata,sourceEventId}' AS source_event_id,
          transition.id::text AS transition_event_id,
          (transition.payload ->> 'occurredAt')::timestamptz AS occurred_at,
          transition.created_at AS created_at,
          transition.payload ->> 'decisionLedgerId' AS decision_ledger_id,
          (transition.payload ->> 'decisionSequence')::bigint AS decision_sequence,
          commitment.id::text AS relation_id,
          commitment.evidence_refs AS evidence_refs
        FROM ${events} AS transition
        INNER JOIN ${edges} AS commitment
          ON commitment.workspace_id = transition.workspace_id
          AND commitment.src_type = 'event'
          AND commitment.src_id = transition.id
          AND commitment.dst_type = 'person'
          AND commitment.dst_id = ${personId}::uuid
          AND commitment.edge_type = 'commitment'
          AND commitment.owner_user_id = ${viewerUserId}::uuid
        WHERE transition.workspace_id = ${workspaceId}::uuid
          AND transition.entity_type = 'interaction'
          AND transition.payload #>> '{metadata,artifact}' = 'commitment'
          AND transition.payload #>> '{metadata,personId}' = ${personId}
          AND transition.payload ->> 'ownerUserId' = ${viewerUserId}
          ${opts.commitmentId
            ? sql`AND transition.payload #>> '{metadata,commitmentId}' = ${opts.commitmentId}`
            : sql``}
        ORDER BY
          transition.payload #>> '{metadata,commitmentId}',
          (transition.payload ->> 'decisionSequence')::bigint DESC,
          (transition.payload ->> 'occurredAt')::timestamptz DESC,
          transition.id DESC
      ),
      visible AS (
        SELECT *
        FROM latest
        WHERE commitment_id IS NOT NULL
          ${opts.includeArchived ? sql`` : sql`AND status <> 'archived'`}
      )
      SELECT *, count(*) OVER() AS total_count
      FROM visible
      ORDER BY
        CASE WHEN due_at IS NULL OR due_at = '' THEN 1 ELSE 0 END,
        due_at ASC NULLS LAST,
        occurred_at DESC,
        commitment_id DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `);
    const rows = (
      Array.isArray(result)
        ? result
        : (result as { rows?: unknown[] }).rows ?? []
    ) as Array<{
      commitment_id: string;
      person_id: string;
      text: string;
      due_at: string | null;
      status: CommitmentStatus;
      source_event_id: string | null;
      transition_event_id: string;
      occurred_at: Date | string;
      created_at: Date | string;
      decision_ledger_id: string;
      decision_sequence: number | string;
      relation_id: string;
      evidence_refs: RelationEvidenceRef[];
      total_count: number | string;
    }>;
    return {
      items: rows.map((row) => ({
        id: row.commitment_id,
        personId: row.person_id,
        text: row.text,
        dueAt: row.due_at ? new Date(row.due_at) : null,
        status: row.status,
        sourceEventId: row.source_event_id || null,
        transitionEventId: row.transition_event_id,
        occurredAt: new Date(row.occurred_at),
        createdAt: new Date(row.created_at),
        provenance: {
          decisionLedgerId: row.decision_ledger_id,
          decisionSequence: Number(row.decision_sequence),
          relationId: row.relation_id,
          evidenceRefs: row.evidence_refs,
        },
      })),
      total: Number(rows[0]?.total_count ?? 0),
    };
  }

  async materializeIntroduction(
    input: MaterializeIntroductionInput,
  ): Promise<IntroductionRecord> {
    if (!this.#hasRlsContext(input.workspaceId, input.ownerUserId)) {
      return this.#withRlsContext(input.workspaceId, input.ownerUserId, (store) =>
        store.materializeIntroduction(input),
      );
    }
    if (input.sourcePersonId === input.targetPersonId) {
      throw new Error("An Introduction requires two different People");
    }
    const statusLabel = input.status.replace(/_/g, " ");
    await this.#createInteractionInContext({
      id: input.transitionEventId,
      workspaceId: input.workspaceId,
      ownerUserId: input.ownerUserId,
      kind: `introduction_${input.operation}`,
      occurredAt: input.decisionAt,
      summary: `Introduction ${statusLabel}`,
      source: "user",
      sourceRecordId: input.introductionId,
      visibility: "private",
      participants: [
        {
          recordType: "person",
          recordId: input.sourcePersonId,
          role: "introducer",
        },
        {
          recordType: "person",
          recordId: input.targetPersonId,
          role: "recipient",
        },
      ],
      updatesPersonFreshness: false,
      metadata: {
        artifact: "introduction",
        introductionId: input.introductionId,
        sourcePersonId: input.sourcePersonId,
        targetPersonId: input.targetPersonId,
        initiatorConsent: input.initiatorConsent,
        recipientConsent: input.recipientConsent,
        status: input.status,
        ...(input.declineReason ? { declineReason: input.declineReason } : {}),
      },
      decisionLedgerId: input.decisionLedgerId,
      decisionSequence: input.decisionSequence,
      decisionAt: input.decisionAt,
    });
    const relations = await Promise.all(
      [input.sourcePersonId, input.targetPersonId].map((personId) =>
        this.upsertRelation({
          workspaceId: input.workspaceId,
          ownerUserId: input.ownerUserId,
          srcType: "event",
          srcId: input.transitionEventId,
          dstType: "person",
          dstId: personId,
          relationType: "introduction",
          properties: {
            introductionId: input.introductionId,
            status: input.status,
          },
          evidenceRefs: [{
            entityType: "event",
            entityId: input.transitionEventId,
            source: "relationship",
          }],
          confidence: 1,
          observedAt: input.decisionAt,
          validFrom: input.decisionAt,
          userConfirmed: input.initiatorConsent && input.recipientConsent,
          visibility: "private",
          source: "user",
          sourceModule: "relationship",
          decisionLedgerId: input.decisionLedgerId,
          decisionSequence: input.decisionSequence,
          decisionAt: input.decisionAt,
        }),
      ),
    );
    return {
      id: input.introductionId,
      sourcePersonId: input.sourcePersonId,
      targetPersonId: input.targetPersonId,
      initiatorConsent: input.initiatorConsent,
      recipientConsent: input.recipientConsent,
      status: input.status,
      declineReasonRecorded: Boolean(input.declineReason),
      transitionEventId: input.transitionEventId,
      occurredAt: input.decisionAt,
      createdAt: input.decisionAt,
      provenance: {
        decisionLedgerId: input.decisionLedgerId,
        decisionSequence: input.decisionSequence,
        relationIds: relations.map((relation) => relation.id),
        evidenceRefs: relations.flatMap((relation) => relation.evidenceRefs),
      },
    };
  }

  async listIntroductions(
    workspaceId: string,
    viewerUserId: string,
    personId: string,
    opts: PageOpts & { introductionId?: string },
  ): Promise<IntroductionPage> {
    if (!this.#hasRlsContext(workspaceId, viewerUserId)) {
      return this.#withRlsContext(workspaceId, viewerUserId, (store) =>
        store.listIntroductions(workspaceId, viewerUserId, personId, opts),
      );
    }
    const person = await this.getPerson(workspaceId, viewerUserId, personId);
    if (!person) return { items: [], total: 0 };
    const limit = clamp(opts.limit, 1, 100);
    const offset = clamp(opts.offset, 0, 10_000);
    const result = await this.#db.execute(sql`
      WITH latest AS (
        SELECT DISTINCT ON (
          transition.payload #>> '{metadata,introductionId}'
        )
          transition.payload #>> '{metadata,introductionId}' AS introduction_id,
          transition.payload #>> '{metadata,sourcePersonId}' AS source_person_id,
          transition.payload #>> '{metadata,targetPersonId}' AS target_person_id,
          (transition.payload #>> '{metadata,initiatorConsent}')::boolean AS initiator_consent,
          (transition.payload #>> '{metadata,recipientConsent}')::boolean AS recipient_consent,
          transition.payload #>> '{metadata,status}' AS status,
          coalesce(transition.payload #>> '{metadata,declineReason}', '') <> '' AS decline_reason_recorded,
          transition.id::text AS transition_event_id,
          (transition.payload ->> 'occurredAt')::timestamptz AS occurred_at,
          transition.created_at AS created_at,
          transition.payload ->> 'decisionLedgerId' AS decision_ledger_id,
          (transition.payload ->> 'decisionSequence')::bigint AS decision_sequence,
          ARRAY(
            SELECT related.id::text
            FROM ${edges} AS related
            WHERE related.workspace_id = transition.workspace_id
              AND related.src_type = 'event'
              AND related.src_id = transition.id
              AND related.edge_type = 'introduction'
              AND related.owner_user_id = ${viewerUserId}::uuid
            ORDER BY related.id
          ) AS relation_ids,
          anchor.evidence_refs AS evidence_refs
        FROM ${events} AS transition
        INNER JOIN ${edges} AS anchor
          ON anchor.workspace_id = transition.workspace_id
          AND anchor.src_type = 'event'
          AND anchor.src_id = transition.id
          AND anchor.dst_type = 'person'
          AND anchor.dst_id = ${personId}::uuid
          AND anchor.edge_type = 'introduction'
          AND anchor.owner_user_id = ${viewerUserId}::uuid
        WHERE transition.workspace_id = ${workspaceId}::uuid
          AND transition.entity_type = 'interaction'
          AND transition.payload #>> '{metadata,artifact}' = 'introduction'
          AND transition.payload ->> 'ownerUserId' = ${viewerUserId}
          ${opts.introductionId
            ? sql`AND transition.payload #>> '{metadata,introductionId}' = ${opts.introductionId}`
            : sql``}
        ORDER BY
          transition.payload #>> '{metadata,introductionId}',
          (transition.payload ->> 'decisionSequence')::bigint DESC,
          (transition.payload ->> 'occurredAt')::timestamptz DESC,
          transition.id DESC
      )
      SELECT *, count(*) OVER() AS total_count
      FROM latest
      WHERE introduction_id IS NOT NULL
      ORDER BY occurred_at DESC, introduction_id DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `);
    const rows = (
      Array.isArray(result)
        ? result
        : (result as { rows?: unknown[] }).rows ?? []
    ) as Array<{
      introduction_id: string;
      source_person_id: string;
      target_person_id: string;
      initiator_consent: boolean;
      recipient_consent: boolean;
      status: IntroductionStatus;
      decline_reason_recorded: boolean;
      transition_event_id: string;
      occurred_at: Date | string;
      created_at: Date | string;
      decision_ledger_id: string;
      decision_sequence: number | string;
      relation_ids: string[];
      evidence_refs: RelationEvidenceRef[];
      total_count: number | string;
    }>;
    return {
      items: rows.map((row) => ({
        id: row.introduction_id,
        sourcePersonId: row.source_person_id,
        targetPersonId: row.target_person_id,
        initiatorConsent: row.initiator_consent,
        recipientConsent: row.recipient_consent,
        status: row.status,
        declineReasonRecorded: row.decline_reason_recorded,
        transitionEventId: row.transition_event_id,
        occurredAt: new Date(row.occurred_at),
        createdAt: new Date(row.created_at),
        provenance: {
          decisionLedgerId: row.decision_ledger_id,
          decisionSequence: Number(row.decision_sequence),
          relationIds: row.relation_ids,
          evidenceRefs: row.evidence_refs,
        },
      })),
      total: Number(rows[0]?.total_count ?? 0),
    };
  }

  async listTimeline(
    workspaceId: string,
    viewerUserId: string,
    recordType: "person" | "community",
    recordId: string,
    opts: { limit: number; cursor?: TimelineCursor | null },
  ): Promise<TimelinePage> {
    if (!this.#hasRlsContext(workspaceId, viewerUserId)) {
      return this.#withRlsContext(workspaceId, viewerUserId, (store) =>
        store.listTimeline(workspaceId, viewerUserId, recordType, recordId, opts),
      );
    }
    const anchor = recordType === "person"
      ? await this.getPerson(workspaceId, viewerUserId, recordId)
      : await this.getCommunity(workspaceId, viewerUserId, recordId);
    if (!anchor) return { items: [], nextCursor: null };
    const limit = clamp(opts.limit, 1, MAX_TIMELINE_PAGE_SIZE);
    const occurredAt = sql<Date>`coalesce(
      (${events.payload} ->> 'occurredAt')::timestamptz,
      ${events.createdAt}
    )`;
    const cursorCondition = opts.cursor
      ? or(
          lt(occurredAt, opts.cursor.occurredAt),
          and(eq(occurredAt, opts.cursor.occurredAt), lt(events.id, opts.cursor.id)),
        )
      : undefined;
    const rows = await this.#db
      .select()
      .from(events)
      .where(and(
        eq(events.workspaceId, workspaceId),
        eq(events.entityType, "interaction"),
        sql<boolean>`(
          ${events.payload} ->> 'ownerUserId' = ${viewerUserId}
          OR ${events.payload} ->> 'visibility' = 'workspace'
        )`,
        sql<boolean>`EXISTS (
          SELECT 1
          FROM "edges" AS "timeline_anchor_relation"
          WHERE "timeline_anchor_relation"."workspace_id" = ${workspaceId}
            AND "timeline_anchor_relation"."edge_type" = 'participant'
            AND (
              "timeline_anchor_relation"."owner_user_id" = ${viewerUserId}
              OR "timeline_anchor_relation"."visibility" IN ('workspace', 'public')
            )
            AND (
              (
                "timeline_anchor_relation"."src_type" = 'event'
                AND "timeline_anchor_relation"."src_id" = ${events.id}
                AND "timeline_anchor_relation"."dst_type" = ${recordType}
                AND "timeline_anchor_relation"."dst_id" = ${recordId}
              )
              OR (
                "timeline_anchor_relation"."dst_type" = 'event'
                AND "timeline_anchor_relation"."dst_id" = ${events.id}
                AND "timeline_anchor_relation"."src_type" = ${recordType}
                AND "timeline_anchor_relation"."src_id" = ${recordId}
              )
            )
        )`,
        cursorCondition,
      ))
      .orderBy(desc(occurredAt), desc(events.id))
      .limit(limit + 1);
    const pageRows = rows.slice(0, limit);
    if (pageRows.length === 0) return { items: [], nextCursor: null };
    const eventIds = pageRows.map((event) => event.id);
    const relationRows = await this.#db
      .select()
      .from(edges)
      .where(and(
        eq(edges.workspaceId, workspaceId),
        eq(edges.edgeType, "participant"),
        or(
          and(eq(edges.srcType, "event"), inArray(edges.srcId, eventIds)),
          and(eq(edges.dstType, "event"), inArray(edges.dstId, eventIds)),
        ),
        or(
          eq(edges.ownerUserId, viewerUserId),
          inArray(edges.visibility, ["workspace", "public"]),
        ),
      ))
      .orderBy(edges.id)
      .limit(Math.min(MAX_BATCH_NODE_REFS, pageRows.length * MAX_INTERACTION_PARTICIPANTS));
    const nodeRefs = relationRows.flatMap((relation) => {
      if (relation.srcType === "event") {
        return [{ nodeType: relation.dstType, nodeId: relation.dstId }];
      }
      if (relation.dstType === "event") {
        return [{ nodeType: relation.srcType, nodeId: relation.srcId }];
      }
      return [];
    });
    const nodeMap = await this.#loadAccessibleNodes(workspaceId, viewerUserId, nodeRefs);
    const relationsByEvent = new Map<string, RelationRecord[]>();
    for (const relation of relationRows) {
      const eventId = relation.srcType === "event" ? relation.srcId : relation.dstId;
      const otherType = relation.srcType === "event" ? relation.dstType : relation.srcType;
      const otherId = relation.srcType === "event" ? relation.dstId : relation.srcId;
      const otherNode = otherType === "person"
        ? nodeMap.people.get(otherId)
        : otherType === "community"
          ? nodeMap.communities.get(otherId)
          : null;
      if (!otherNode) continue;
      const bucket = relationsByEvent.get(eventId) ?? [];
      bucket.push(relation);
      relationsByEvent.set(eventId, bucket);
    }
    const items = pageRows
      .map((event) => this.#timelineItemFromRows(
        event,
        relationsByEvent.get(event.id) ?? [],
        nodeMap,
      ))
      .filter((item) => item.participants.length > 0);
    const last = pageRows.at(-1);
    const lastOccurredAt = last
      ? new Date(
          payloadString(payloadRecord(last.payload), "occurredAt") ??
            last.createdAt.toISOString(),
        )
      : null;
    return {
      items,
      nextCursor:
        rows.length > limit &&
        last &&
        lastOccurredAt &&
        !Number.isNaN(lastOccurredAt.getTime())
        ? { occurredAt: lastOccurredAt, id: last.id }
        : null,
    };
  }

  #timelineItemFromRows(
    event: typeof events.$inferSelect,
    relations: RelationRecord[],
    nodeMap: AccessibleNodes,
  ): TimelineItem {
    const payload = payloadRecord(event.payload);
    const participants: TimelineParticipant[] = [];
    for (const relation of relations) {
      const recordType = relation.srcType === "event" ? relation.dstType : relation.srcType;
      const recordId = relation.srcType === "event" ? relation.dstId : relation.srcId;
      if (recordType !== "person" && recordType !== "community") continue;
      const node = recordType === "person"
        ? nodeMap.people.get(recordId)
        : nodeMap.communities.get(recordId);
      if (!node) continue;
      const properties = payloadRecord(relation.properties);
      participants.push({
        relationId: relation.id,
        recordType,
        recordId,
        displayName: typeof node.displayName === "string" ? node.displayName : null,
        role: payloadString(properties, "role"),
        attendanceState: payloadString(properties, "attendanceState"),
      });
    }
    const evidenceRefs = relations.flatMap((relation) =>
      relationEvidenceCandidates(relation).filter((evidence) => (
        (evidence.entityType === "event" && evidence.entityId === event.id) ||
        (evidence.entityType === "person" && nodeMap.people.has(evidence.entityId)) ||
        (evidence.entityType === "community" && nodeMap.communities.has(evidence.entityId))
      )),
    );
    const decisionLedgerIds = [
      ...new Set(relations.flatMap((relation) =>
        relation.decisionLedgerId ? [relation.decisionLedgerId] : [],
      )),
    ];
    const visibility = relations.some((relation) => relation.visibility === "private")
      ? "private"
      : relations.some((relation) => relation.visibility === "workspace")
        ? "workspace"
        : "public";
    return {
      id: event.id,
      type: event.type,
      kind: payloadString(payload, "kind") ?? event.type,
      summary: payloadString(payload, "summary"),
      source: payloadString(payload, "source") ?? "unknown",
      sourceRecordId: payloadString(payload, "sourceRecordId"),
      visibility,
      occurredAt: payloadDate(payload, "occurredAt", event.createdAt),
      createdAt: event.createdAt,
      participants,
      provenance: {
        eventId: event.id,
        relationIds: relations.map((relation) => relation.id),
        evidenceRefs: [...new Map(evidenceRefs.map((evidence) => [
          `${evidence.entityType}:${evidence.entityId}:${evidence.source ?? ""}`,
          evidence,
        ])).values()],
        decisionLedgerIds,
      },
    };
  }

  async getEvent(workspaceId: string, id: string): Promise<typeof events.$inferSelect | null> {
    const rows = await this.#db
      .select()
      .from(events)
      .where(and(eq(events.workspaceId, workspaceId), eq(events.id, id)))
      .limit(1);
    return rows[0] ?? null;
  }

  async getSignalDetail(workspaceId: string, viewerUserId: string, id: string): Promise<SignalDetail | null> {
    if (!this.#hasRlsContext(workspaceId, viewerUserId)) {
      return this.#withRlsContext(workspaceId, viewerUserId, (store) =>
        store.getSignalDetail(workspaceId, viewerUserId, id),
      );
    }
    const anchor = await this.getSignalEvidenceAnchor(workspaceId, viewerUserId, id);
    if (!anchor) return null;
    const { signal, sourceEvent } = anchor;

    const signalRelations = await this.#db
      .select()
      .from(edges)
      .where(
        and(
          eq(edges.workspaceId, workspaceId),
          eq(edges.edgeType, "participant"),
          or(
            eq(edges.ownerUserId, viewerUserId),
            inArray(edges.visibility, ["workspace", "public"]),
          ),
          or(
            and(
              eq(edges.srcType, "signal"),
              eq(edges.srcId, signal.id),
              inArray(edges.dstType, ["person", "community"]),
              this.#accessibleNodeCondition(edges.dstType, edges.dstId, workspaceId, viewerUserId),
            ),
            and(
              eq(edges.dstType, "signal"),
              eq(edges.dstId, signal.id),
              inArray(edges.srcType, ["person", "community"]),
              this.#accessibleNodeCondition(edges.srcType, edges.srcId, workspaceId, viewerUserId),
            ),
          ),
        ),
      )
      .orderBy(...this.#relationPreferenceOrder(viewerUserId))
      .limit(MAX_SIGNAL_RELATIONS);
    const eventRelations = sourceEvent
      ? await this.#db
          .select()
          .from(edges)
          .where(
            and(
              eq(edges.workspaceId, workspaceId),
              eq(edges.edgeType, "participant"),
              or(
                eq(edges.ownerUserId, viewerUserId),
                inArray(edges.visibility, ["workspace", "public"]),
              ),
              or(
                and(
                  eq(edges.srcType, "event"),
                  eq(edges.srcId, sourceEvent.id),
                  inArray(edges.dstType, ["person", "community"]),
                  this.#accessibleNodeCondition(
                    edges.dstType,
                    edges.dstId,
                    workspaceId,
                    viewerUserId,
                  ),
                ),
                and(
                  eq(edges.dstType, "event"),
                  eq(edges.dstId, sourceEvent.id),
                  inArray(edges.srcType, ["person", "community"]),
                  this.#accessibleNodeCondition(
                    edges.srcType,
                    edges.srcId,
                    workspaceId,
                    viewerUserId,
                  ),
                ),
              ),
            ),
          )
          .orderBy(...this.#relationPreferenceOrder(viewerUserId))
          .limit(MAX_SIGNAL_RELATIONS)
      : [];

    const allRelations = [...signalRelations, ...eventRelations];
    const participantReferences = allRelations.flatMap((relation) => {
      const sourceIsAnchor =
        (relation.srcType === "signal" && relation.srcId === signal.id) ||
        (sourceEvent !== null &&
          relation.srcType === "event" &&
          relation.srcId === sourceEvent.id);
      const recordType = sourceIsAnchor ? relation.dstType : relation.srcType;
      const recordId = sourceIsAnchor ? relation.dstId : relation.srcId;
      return recordType === "person" || recordType === "community"
        ? [{ nodeType: recordType, nodeId: recordId }]
        : [];
    });
    const evidenceReferences = allRelations.flatMap((relation) =>
      relationEvidenceCandidates(relation).map((reference) => ({
        nodeType: reference.entityType,
        nodeId: reference.entityId,
      })),
    );
    const accessible = await this.#loadAccessibleNodes(
      workspaceId,
      viewerUserId,
      [...participantReferences, ...evidenceReferences],
      {
        signalIds: [signal.id],
        eventIds: sourceEvent ? [sourceEvent.id] : [],
      },
    );
    const readableRelations = allRelations.map((relation) =>
      this.#pruneRelationEvidence(relation, accessible),
    );
    readableRelations.sort((left, right) =>
      compareRelationPreference(left, right, viewerUserId),
    );
    const candidates: Array<Omit<SignalParticipant, "displayName">> = [
      ...readableRelations,
    ].flatMap((relation): Array<Omit<SignalParticipant, "displayName">> => {
      const sourceIsAnchor =
        (relation.srcType === "signal" && relation.srcId === signal.id) ||
        (sourceEvent !== null && relation.srcType === "event" && relation.srcId === sourceEvent.id);
      const recordType = sourceIsAnchor ? relation.dstType : relation.srcType;
      const recordId = sourceIsAnchor ? relation.dstId : relation.srcId;
      if (recordType !== "person" && recordType !== "community") return [];
      return [{
        relationId: relation.id,
        relationType: relation.edgeType,
        recordType,
        recordId,
        confidence: Number(relation.confidence),
        evidenceRefs: relation.evidenceRefs,
        sourceModule: relation.sourceModule,
      }];
    });

    const participants: SignalParticipant[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      const key = `${candidate.recordType}:${candidate.recordId}`;
      if (seen.has(key)) continue;
      const record =
        candidate.recordType === "person"
          ? accessible.people.get(candidate.recordId)
          : accessible.communities.get(candidate.recordId);
      if (!record) continue;
      seen.add(key);
      participants.push({ ...candidate, displayName: record.displayName });
    }

    if (participants.length === 0) return null;
    const reason = signalReason(signal, true);
    return {
      signal,
      reason: reason.reason,
      reasonSource: reason.source,
      participants,
      sourceEvent,
    };
  }

  /** Records the user's reaction to a Signal (act | dismiss | save). Does not
   * itself perform "act" — that's a separate governed `action.propose` call the
   * caller makes; this only logs which verb the user chose, for signal-status
   * bookkeeping (`signals.status` is left to a later pass to auto-derive from
   * this, not touched here — out of scope, see BUGS.md if that gap needs filing). */
  async recordSignalAction(input: { workspaceId: string; signalId: string; userId: string; verb: "act" | "dismiss" | "save" }): Promise<void> {
    if (!this.#hasRlsContext(input.workspaceId, input.userId)) {
      return this.#withRlsContext(input.workspaceId, input.userId, (store) =>
        store.recordSignalAction(input),
      );
    }
    await this.#db.insert(signalActions).values({
      id: randomUUID(),
      workspaceId: input.workspaceId,
      signalId: input.signalId,
      userId: input.userId,
      verb: input.verb,
    });
  }
}
