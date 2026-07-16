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
import { and, count, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
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
  relationId: string | null;
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
}

export interface NodeTypeOwner {
  nodeType: string;
  plane: string;
  owningModule: string | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertRelationInput(input: UpsertRelationInput): void {
  if (!UUID_PATTERN.test(input.srcId) || !UUID_PATTERN.test(input.dstId)) {
    throw new Error("Relation endpoints must be UUIDs");
  }
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    throw new Error("Relation confidence must be between 0 and 1");
  }
  if (input.evidenceRefs.length === 0) {
    throw new Error("A Relation requires at least one evidence reference");
  }
  for (const evidence of input.evidenceRefs) {
    if (!evidence.entityType.trim() || !UUID_PATTERN.test(evidence.entityId)) {
      throw new Error("Relation evidence references require an entity type and UUID");
    }
  }
  if (!input.relationType.trim() || !input.source.trim() || !input.sourceModule.trim()) {
    throw new Error("Relation type, source, and source Module are required");
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

function signalReason(signal: typeof signals.$inferSelect): { reason: string; source: "event" | "inferred" } {
  if (typeof signal.payload === "object" && signal.payload !== null && !Array.isArray(signal.payload)) {
    const reason = (signal.payload as Record<string, unknown>).reason;
    if (typeof reason === "string" && reason.trim()) return { reason: reason.trim(), source: "event" };
  }
  return {
    reason: `Surfaced by the ${signal.type} detector from available Event evidence.`,
    source: "inferred",
  };
}

export class DrizzleGraphStore {
  #db: Database;
  constructor(db: Database) {
    this.#db = db;
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

  async listRelations(
    workspaceId: string,
    viewerUserId: string,
    anchor: { nodeType: string; nodeId: string },
    opts: PageOpts,
  ): Promise<Page<RelationRecord>> {
    if (!(await this.#canReadNode(workspaceId, viewerUserId, anchor.nodeType, anchor.nodeId))) {
      return { items: [], total: 0 };
    }
    const where = and(
      eq(edges.workspaceId, workspaceId),
      or(eq(edges.ownerUserId, viewerUserId), ne(edges.visibility, "private")),
      or(
        and(eq(edges.srcType, anchor.nodeType), eq(edges.srcId, anchor.nodeId)),
        and(eq(edges.dstType, anchor.nodeType), eq(edges.dstId, anchor.nodeId)),
      ),
    );
    const rows = await this.#db
      .select()
      .from(edges)
      .where(where)
      .orderBy(desc(edges.observedAt));
    const visible: RelationRecord[] = [];
    for (const relation of rows) {
      const anchorIsSource = relation.srcType === anchor.nodeType && relation.srcId === anchor.nodeId;
      const otherType = anchorIsSource ? relation.dstType : relation.srcType;
      const otherId = anchorIsSource ? relation.dstId : relation.srcId;
      if (await this.#canReadNode(workspaceId, viewerUserId, otherType, otherId)) {
        visible.push(relation);
      }
    }
    return {
      items: visible.slice(opts.offset, opts.offset + opts.limit),
      total: visible.length,
    };
  }

  async upsertRelation(input: UpsertRelationInput): Promise<RelationRecord> {
    assertRelationInput(input);
    const [canReadSource, canReadDestination] = await Promise.all([
      this.#canReadNode(input.workspaceId, input.ownerUserId, input.srcType, input.srcId),
      this.#canReadNode(input.workspaceId, input.ownerUserId, input.dstType, input.dstId),
    ]);
    if (!canReadSource || !canReadDestination) {
      throw new Error("Relation endpoints must both exist and be accessible");
    }
    const [srcOwner, dstOwner] = await Promise.all([
      this.getNodeTypeOwner(input.srcType),
      this.getNodeTypeOwner(input.dstType),
    ]);
    if (!srcOwner || !dstOwner) {
      throw new Error(`Unknown Relation node type: ${!srcOwner ? input.srcType : input.dstType}`);
    }

    const rows = await this.#db
      .insert(edges)
      .values({
        workspaceId: input.workspaceId,
        srcType: input.srcType,
        srcId: input.srcId,
        dstType: input.dstType,
        dstId: input.dstId,
        edgeType: input.relationType,
        properties: input.properties ?? {},
        evidenceRefs: input.evidenceRefs,
        confidence: String(input.confidence),
        observedAt: input.observedAt,
        validFrom: input.validFrom ?? null,
        validTo: input.validTo ?? null,
        userConfirmed: input.userConfirmed,
        visibility: input.visibility,
        source: input.source,
        sourceModule: input.sourceModule,
        ownerUserId: input.ownerUserId,
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
          properties: sql`${edges.properties} || excluded."properties"`,
          evidenceRefs: sql`(
            SELECT COALESCE(jsonb_agg(item), '[]'::jsonb)
            FROM (
              SELECT DISTINCT value AS item
              FROM jsonb_array_elements(${edges.evidenceRefs} || excluded."evidence_refs")
            ) merged_evidence
          )`,
          confidence: sql`excluded."confidence"`,
          observedAt: sql`excluded."observed_at"`,
          validFrom: sql`excluded."valid_from"`,
          validTo: sql`excluded."valid_to"`,
          userConfirmed: sql`excluded."user_confirmed"`,
          visibility: sql`excluded."visibility"`,
          source: sql`excluded."source"`,
          sourceModule: sql`excluded."source_module"`,
          ownerUserId: sql`excluded."owner_user_id"`,
        },
      })
      .returning();
    return rows[0]!;
  }

  async materializeSignalEvidence(
    input: MaterializeSignalEvidenceInput,
  ): Promise<{ sourceEvent: RelationRecord; participants: RelationRecord[] }> {
    const signal = await this.#getAccessibleSignal(input.workspaceId, input.ownerUserId, input.signalId);
    if (!signal) throw new Error("Signal not found or not accessible");
    const sourceEvent = await this.getEvent(input.workspaceId, input.sourceEventId);
    if (!sourceEvent || sourceEvent.entityType !== "signal" || sourceEvent.entityId !== signal.id) {
      throw new Error("Source Event must belong to the Signal");
    }
    if (input.participants.length === 0) throw new Error("Signal evidence requires at least one participant");
    const participantKeys = input.participants.map(
      (participant) => `${participant.recordType}:${participant.recordId}`,
    );
    if (new Set(participantKeys).size !== participantKeys.length) {
      throw new Error("Signal evidence participants must be unique by Record");
    }
    if (
      !input.participants.some(
        (participant) =>
          participant.recordType === signal.subjectType && participant.recordId === signal.subjectId,
      )
    ) {
      throw new Error("Signal evidence participants must include the Signal subject");
    }
    for (const participant of input.participants) {
      if (!(await this.#canReadNode(input.workspaceId, input.ownerUserId, participant.recordType, participant.recordId))) {
        throw new Error(`Participant ${participant.recordType}:${participant.recordId} is not accessible`);
      }
      if (!Number.isFinite(participant.confidence) || participant.confidence < 0 || participant.confidence > 1) {
        throw new Error("Participant confidence must be between 0 and 1");
      }
    }

    const evidenceRef: RelationEvidenceRef = {
      entityType: "event",
      entityId: sourceEvent.id,
      source: input.source,
    };
    const values: Array<typeof edges.$inferInsert> = [
      {
        workspaceId: input.workspaceId,
        ownerUserId: input.ownerUserId,
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
        source: input.source,
        sourceModule: "relationship",
      },
      ...input.participants.map(
        (participant): typeof edges.$inferInsert => ({
          workspaceId: input.workspaceId,
          ownerUserId: input.ownerUserId,
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
          source: input.source,
          sourceModule: "relationship",
        }),
      ),
    ];
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
          properties: sql`excluded."properties"`,
          evidenceRefs: sql`excluded."evidence_refs"`,
          confidence: sql`excluded."confidence"`,
          observedAt: sql`excluded."observed_at"`,
          userConfirmed: sql`excluded."user_confirmed"`,
          visibility: sql`excluded."visibility"`,
          source: sql`excluded."source"`,
          sourceModule: sql`excluded."source_module"`,
          ownerUserId: sql`excluded."owner_user_id"`,
        },
      })
      .returning();
    const sourceEventRelation = rows.find((relation) => relation.edgeType === "source_event");
    if (!sourceEventRelation) throw new Error("Signal source Event Relation was not materialized");
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
    const [visiblePeople, visibleCommunities] = await Promise.all([
      this.#db
        .select({ id: people.id })
        .from(people)
        .where(
          and(
            eq(people.workspaceId, workspaceId),
            or(eq(people.userId, viewerUserId), ne(people.visibility, "private")),
            isNull(people.archivedAt),
          ),
        ),
      this.#db
        .select({ id: communities.id })
        .from(communities)
        .where(
          and(
            eq(communities.workspaceId, workspaceId),
            or(eq(communities.userId, viewerUserId), ne(communities.visibility, "private")),
            isNull(communities.archivedAt),
          ),
        ),
    ]);
    const personIds = visiblePeople.map((record) => record.id);
    const communityIds = visibleCommunities.map((record) => record.id);
    const where = and(
      eq(signals.workspaceId, workspaceId),
      or(
        personIds.length > 0
          ? and(eq(signals.subjectType, "person"), inArray(signals.subjectId, personIds))
          : sql`false`,
        communityIds.length > 0
          ? and(eq(signals.subjectType, "community"), inArray(signals.subjectId, communityIds))
          : sql`false`,
      ),
    );
    const [rows, totalRows] = await Promise.all([
      this.#db.select().from(signals).where(where).orderBy(desc(signals.createdAt)).limit(opts.limit).offset(opts.offset),
      this.#db.select({ value: count() }).from(signals).where(where),
    ]);
    return { items: rows, total: Number(totalRows[0]?.value ?? 0) };
  }

  async listPeople(workspaceId: string, viewerUserId: string, opts: PageOpts): Promise<Page<PersonRecord>> {
    const where = and(
      eq(people.workspaceId, workspaceId),
      or(eq(people.userId, viewerUserId), ne(people.visibility, "private")),
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
          or(eq(people.userId, viewerUserId), ne(people.visibility, "private")),
          isNull(people.archivedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  // `communities` has no `createdAt` column (unlike `people`/`initiatives`/`signals`),
  // so pagination orders by `id` for a stable (if arbitrary) row order instead.
  async listCommunities(workspaceId: string, viewerUserId: string, opts: PageOpts): Promise<Page<CommunityRecord>> {
    const where = and(
      eq(communities.workspaceId, workspaceId),
      or(eq(communities.userId, viewerUserId), ne(communities.visibility, "private")),
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
          or(eq(communities.userId, viewerUserId), ne(communities.visibility, "private")),
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
    const signal = await this.#getAccessibleSignal(workspaceId, viewerUserId, id);
    if (!signal) return null;

    const payloadEventId = sourceEventIdFromPayload(signal.payload);
    let sourceEvent = payloadEventId ? await this.getEvent(workspaceId, payloadEventId) : null;
    if (!sourceEvent) {
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
      sourceEvent = eventRows[0] ?? null;
    }

    const signalRelations = await this.#db
      .select()
      .from(edges)
      .where(
        and(
          eq(edges.workspaceId, workspaceId),
          or(eq(edges.ownerUserId, viewerUserId), ne(edges.visibility, "private")),
          or(
            and(eq(edges.srcType, "signal"), eq(edges.srcId, signal.id)),
            and(eq(edges.dstType, "signal"), eq(edges.dstId, signal.id)),
          ),
        ),
      );
    const eventRelations = sourceEvent
      ? await this.#db
          .select()
          .from(edges)
          .where(
            and(
              eq(edges.workspaceId, workspaceId),
              or(eq(edges.ownerUserId, viewerUserId), ne(edges.visibility, "private")),
              or(
                and(eq(edges.srcType, "event"), eq(edges.srcId, sourceEvent.id)),
                and(eq(edges.dstType, "event"), eq(edges.dstId, sourceEvent.id)),
              ),
            ),
          )
      : [];

    const candidates: Array<Omit<SignalParticipant, "displayName">> = [
      ...signalRelations,
      ...eventRelations,
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

    if (
      (signal.subjectType === "person" || signal.subjectType === "community") &&
      !candidates.some((candidate) => candidate.recordType === signal.subjectType && candidate.recordId === signal.subjectId)
    ) {
      candidates.push({
        relationId: null,
        relationType: "signal_subject",
        recordType: signal.subjectType,
        recordId: signal.subjectId,
        confidence: null,
        evidenceRefs: [],
        sourceModule: null,
      });
    }

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

    const reason = signalReason(signal);
    return {
      signal,
      reason: reason.reason,
      reasonSource: reason.source,
      participants,
      sourceEvent: participants.length > 0 ? sourceEvent : null,
    };
  }

  /** Records the user's reaction to a Signal (act | dismiss | save). Does not
   * itself perform "act" — that's a separate governed `action.propose` call the
   * caller makes; this only logs which verb the user chose, for signal-status
   * bookkeeping (`signals.status` is left to a later pass to auto-derive from
   * this, not touched here — out of scope, see BUGS.md if that gap needs filing). */
  async recordSignalAction(input: { workspaceId: string; signalId: string; userId: string; verb: "act" | "dismiss" | "save" }): Promise<void> {
    await this.#db.insert(signalActions).values({
      id: randomUUID(),
      workspaceId: input.workspaceId,
      signalId: input.signalId,
      userId: input.userId,
      verb: input.verb,
    });
  }
}
