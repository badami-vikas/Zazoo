/**
 * DrizzleGraphStore — READ-only surface for Bridge's core vocabulary nouns
 * (Initiative/Touchpoint/Signal/Person/Community) that had zero tRPC coverage
 * (frontend-migration-scoping.md Phase 3). WRITES to `initiatives`/`touchpoints`
 * already flow through the governed pipeline generically (`action.propose` with
 * `resourceType: "initiative" | "touchpoint"`, see router.ts's `resourceTypeEnum`)
 * — this store exists only because the pipeline has no query-back path, the same
 * reason `dealpilot.list`/`integration.list` needed their own read stores.
 * `listPeople`/`listCommunities` were added later (KnowledgeBasePage's People/
 * Communities tabs) to the same store rather than a new one, since it's already
 * the generic home for workspace-scoped node reads.
 *
 * `signal_actions` (act/dismiss/save) is the one exception: it's the user's
 * reaction bookkeeping to a Signal, not a mutation of Person/Relationship data,
 * so it's a direct authenticated write here (same tier as workspace membership
 * CRUD — see workspace-store.ts's header comment) rather than routed through
 * UniversalActionPipeline.propose(). See docs/raw/decisions-log.md.
 */
import { randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
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

export interface PersonRecord {
  id: string;
  workspaceId: string;
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
  visibility: string;
  displayName: string | null;
  description: string | null;
  kind: string | null;
  source: string;
  isUserConfirmed: boolean;
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
  source: string;
  observedAt: Date;
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RELATION_EVIDENCE_REFS = 100;
const MAX_RELATION_PAGE_SIZE = 100;
const MAX_SIGNAL_RELATIONS = 200;

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
      if (!event || event.entityType !== "signal") return false;
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
        JOIN "signals" AS "relation_event_signal"
          ON "relation_event_signal"."workspace_id" = "relation_event"."workspace_id"
         AND "relation_event_signal"."id" = "relation_event"."entity_id"
        WHERE "relation_event"."workspace_id" = ${workspaceId}
          AND "relation_event"."id" = ${nodeId}
          AND "relation_event"."entity_type" = 'signal'
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

  async #pruneRelationEvidence(
    workspaceId: string,
    viewerUserId: string,
    relation: RelationRecord,
  ): Promise<RelationRecord> {
    const candidates = Array.isArray(relation.evidenceRefs)
      ? relation.evidenceRefs.filter(isRelationEvidenceRef).slice(0, MAX_RELATION_EVIDENCE_REFS)
      : [];
    const readable = await Promise.all(
      candidates.map((ref) => this.#canReadNode(workspaceId, viewerUserId, ref.entityType, ref.entityId)),
    );
    return {
      ...relation,
      evidenceRefs: candidates.filter((_, index) => readable[index]),
    };
  }

  async listRelations(
    workspaceId: string,
    viewerUserId: string,
    anchor: { nodeType: string; nodeId: string },
    opts: PageOpts,
  ): Promise<Page<RelationRecord>> {
    if (!this.#hasRlsContext(workspaceId, viewerUserId)) {
      return this.#withRlsContext(workspaceId, viewerUserId, (store) =>
        store.listRelations(workspaceId, viewerUserId, anchor, opts),
      );
    }
    if (!(await this.#canReadNode(workspaceId, viewerUserId, anchor.nodeType, anchor.nodeId))) {
      return { items: [], total: 0 };
    }
    const limit = Math.min(Math.max(opts.limit, 1), MAX_RELATION_PAGE_SIZE);
    const offset = Math.max(opts.offset, 0);
    const visibleRelation = or(
      eq(edges.ownerUserId, viewerUserId),
      inArray(edges.visibility, ["workspace", "public"]),
    );
    const where = and(
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
    const [rows, totalRows] = await Promise.all([
      this.#db
        .select()
        .from(edges)
        .where(where)
        .orderBy(desc(edges.observedAt), desc(edges.createdAt))
        .limit(limit)
        .offset(offset),
      this.#db.select({ value: count() }).from(edges).where(where),
    ]);
    return {
      items: await Promise.all(rows.map((relation) => this.#pruneRelationEvidence(workspaceId, viewerUserId, relation))),
      total: Number(totalRows[0]?.value ?? 0),
    };
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
      !input.source.trim() ||
      Number.isNaN(input.observedAt.getTime()) ||
      Number.isNaN(input.decisionAt.getTime())
    ) {
      throw new Error(
        "Signal evidence source, observedAt, and decision provenance are required",
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

    const signal = await this.#getAccessibleSignal(workspaceId, ownerUserId, signalId);
    if (!signal) throw new Error("Signal not found or not accessible");
    const sourceEvent = await this.getEvent(workspaceId, sourceEventId);
    if (!sourceEvent || sourceEvent.entityType !== "signal" || sourceEvent.entityId !== signal.id) {
      throw new Error("Source Event must belong to the Signal");
    }
    if (
      !participants.some(
        (participant) =>
          participant.recordType === signal.subjectType && participant.recordId === signal.subjectId,
      )
    ) {
      throw new Error("Signal evidence participants must include the Signal subject");
    }

    const nodeTypeNames = ["signal", "event", ...participants.map((participant) => participant.recordType)];
    const nodeTypeOwners = await Promise.all(
      [...new Set(nodeTypeNames)].map((nodeType) => this.getNodeTypeOwner(nodeType)),
    );
    if (
      nodeTypeOwners.some(
        (owner) => owner === null || owner.owningModule !== "relationship",
      )
    ) {
      throw new Error("Signal evidence node types must be owned by the Relationship Module");
    }

    const participantAccess = await Promise.all(
      participants.map(async (participant) => {
        if (!UUID_PATTERN.test(participant.recordId)) return false;
        if (!Number.isFinite(participant.confidence) || participant.confidence < 0 || participant.confidence > 1) {
          return false;
        }
        return this.#canReadNode(
          workspaceId,
          ownerUserId,
          participant.recordType,
          participant.recordId,
        );
      }),
    );
    const inaccessibleIndex = participantAccess.findIndex((accessible) => !accessible);
    if (inaccessibleIndex >= 0) {
      const participant = participants[inaccessibleIndex]!;
      throw new Error(`Participant ${participant.recordType}:${participant.recordId} is invalid or not accessible`);
    }

    await this.#db.execute(
      sql`SELECT pg_advisory_xact_lock(
        hashtextextended(${`${workspaceId}:${ownerUserId}:${signalId}`}, 0::bigint)
      )`,
    );
    const watermarkRows = await this.#db
      .select({
        decisionLedgerId: edges.decisionLedgerId,
        decisionSequence: edges.decisionSequence,
      })
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
      .orderBy(desc(edges.decisionSequence))
      .limit(1);
    const watermark = watermarkRows[0];
    if (
      watermark?.decisionSequence !== null &&
      watermark?.decisionSequence !== undefined &&
      (
        watermark.decisionSequence > input.decisionSequence ||
        (
          watermark.decisionSequence === input.decisionSequence &&
          watermark.decisionLedgerId !== decisionLedgerId
        )
      )
    ) {
      throw new Error("Stale Relationship decision cannot materialize Signal evidence");
    }

    const evidenceRef: RelationEvidenceRef = {
      entityType: "event",
      entityId: sourceEvent.id,
      source: input.source.trim(),
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
        observedAt: input.observedAt,
        userConfirmed: input.userConfirmed,
        visibility: input.visibility,
        source: input.source.trim(),
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
          observedAt: input.observedAt,
          userConfirmed: input.userConfirmed,
          visibility: input.visibility,
          source: input.source.trim(),
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
          userConfirmed: sql`CASE WHEN ${incomingDecisionWins} THEN ${edges.userConfirmed} OR excluded."user_confirmed" ELSE ${edges.userConfirmed} END`,
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

  async listSignals(workspaceId: string, viewerUserId: string, opts: PageOpts): Promise<Page<typeof signals.$inferSelect>> {
    if (!this.#hasRlsContext(workspaceId, viewerUserId)) {
      return this.#withRlsContext(workspaceId, viewerUserId, (store) =>
        store.listSignals(workspaceId, viewerUserId, opts),
      );
    }
    const limit = Math.min(Math.max(opts.limit, 1), MAX_RELATION_PAGE_SIZE);
    const offset = Math.max(opts.offset, 0);
    const where = and(
      eq(signals.workspaceId, workspaceId),
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

  async listPeople(workspaceId: string, viewerUserId: string, opts: PageOpts): Promise<Page<PersonRecord>> {
    if (!this.#hasRlsContext(workspaceId, viewerUserId)) {
      return this.#withRlsContext(workspaceId, viewerUserId, (store) =>
        store.listPeople(workspaceId, viewerUserId, opts),
      );
    }
    const where = and(
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
    const [rows, totalRows] = await Promise.all([
      this.#db
        .select({
          id: people.id,
          workspaceId: people.workspaceId,
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
        .orderBy(desc(people.createdAt))
        .limit(opts.limit)
        .offset(opts.offset),
      this.#db.select({ value: count() }).from(people).where(where),
    ]);
    return { items: rows, total: Number(totalRows[0]?.value ?? 0) };
  }

  async getPerson(workspaceId: string, viewerUserId: string, id: string): Promise<PersonRecord | null> {
    if (!this.#hasRlsContext(workspaceId, viewerUserId)) {
      return this.#withRlsContext(workspaceId, viewerUserId, (store) =>
        store.getPerson(workspaceId, viewerUserId, id),
      );
    }
    const rows = await this.#db
      .select({
        id: people.id,
        workspaceId: people.workspaceId,
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

  // `communities` has no `createdAt` column (unlike `people`/`initiatives`/`signals`),
  // so pagination orders by `id` for a stable (if arbitrary) row order instead.
  async listCommunities(workspaceId: string, viewerUserId: string, opts: PageOpts): Promise<Page<CommunityRecord>> {
    if (!this.#hasRlsContext(workspaceId, viewerUserId)) {
      return this.#withRlsContext(workspaceId, viewerUserId, (store) =>
        store.listCommunities(workspaceId, viewerUserId, opts),
      );
    }
    const where = and(
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
    const [rows, totalRows] = await Promise.all([
      this.#db
        .select({
          id: communities.id,
          workspaceId: communities.workspaceId,
          visibility: communities.visibility,
          displayName: sql<string | null>`coalesce(${communities.nameOverride}, ${communitiesCanonical.name})`,
          description: sql<string | null>`coalesce(${communities.descriptionOverride}, ${communitiesCanonical.description})`,
          kind: sql<string | null>`coalesce(${communities.kind}, ${communitiesCanonical.kind})`,
          source: communities.source,
          isUserConfirmed: communities.isUserConfirmed,
        })
        .from(communities)
        .leftJoin(communitiesCanonical, eq(communities.canonicalCommunityId, communitiesCanonical.id))
        .where(where)
        .orderBy(communities.id)
        .limit(opts.limit)
        .offset(opts.offset),
      this.#db.select({ value: count() }).from(communities).where(where),
    ]);
    return { items: rows, total: Number(totalRows[0]?.value ?? 0) };
  }

  async getCommunity(workspaceId: string, viewerUserId: string, id: string): Promise<CommunityRecord | null> {
    if (!this.#hasRlsContext(workspaceId, viewerUserId)) {
      return this.#withRlsContext(workspaceId, viewerUserId, (store) =>
        store.getCommunity(workspaceId, viewerUserId, id),
      );
    }
    const rows = await this.#db
      .select({
        id: communities.id,
        workspaceId: communities.workspaceId,
        visibility: communities.visibility,
        displayName: sql<string | null>`coalesce(${communities.nameOverride}, ${communitiesCanonical.name})`,
        description: sql<string | null>`coalesce(${communities.descriptionOverride}, ${communitiesCanonical.description})`,
        kind: sql<string | null>`coalesce(${communities.kind}, ${communitiesCanonical.kind})`,
        source: communities.source,
        isUserConfirmed: communities.isUserConfirmed,
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

    const readableRelations = await Promise.all(
      [...signalRelations, ...eventRelations].map((relation) =>
        this.#pruneRelationEvidence(workspaceId, viewerUserId, relation),
      ),
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
          ? await this.getPerson(workspaceId, viewerUserId, candidate.recordId)
          : await this.getCommunity(workspaceId, viewerUserId, candidate.recordId);
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
