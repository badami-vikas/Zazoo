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
import { and, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import {
  communities,
  communitiesCanonical,
  edges,
  events,
  initiatives,
  people,
  peopleCanonical,
  signalActions,
  signals,
  touchpoints,
} from "./schema.js";

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
}

export interface SignalDetail {
  signal: typeof signals.$inferSelect;
  reason: string;
  reasonSource: "event" | "inferred";
  participants: SignalParticipant[];
  sourceEvent: typeof events.$inferSelect | null;
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
  constructor(db: Database) {
    this.#db = db;
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

  /** TASK-010 review round-4 item 6 — a single, workspace-scoped touchpoint
   * lookup mirroring `getInitiative`'s shape. Used to validate a red-flag
   * anchor's `recordId` server-side rather than trusting an unchecked
   * client-supplied string. Returns null for a nonexistent id OR one that
   * belongs to a different workspace (never leaks cross-workspace existence). */
  async getTouchpoint(workspaceId: string, id: string): Promise<typeof touchpoints.$inferSelect | null> {
    const rows = await this.#db
      .select()
      .from(touchpoints)
      .where(and(eq(touchpoints.id, id), eq(touchpoints.workspaceId, workspaceId)))
      .limit(1);
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
            or(
              eq(people.visibility, "workspace"),
              and(
                or(eq(people.visibility, "private"), eq(people.visibility, "team")),
                eq(people.userId, viewerUserId),
              ),
            ),
            isNull(people.archivedAt),
          ),
        ),
      this.#db
        .select({ id: communities.id })
        .from(communities)
        .where(
          and(
            eq(communities.workspaceId, workspaceId),
            or(
              eq(communities.visibility, "workspace"),
              and(
                or(eq(communities.visibility, "private"), eq(communities.visibility, "team")),
                eq(communities.userId, viewerUserId),
              ),
            ),
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
    const candidateRows = await this.#db
      .select()
      .from(signals)
      .where(where)
      .orderBy(desc(signals.createdAt));
    const evidenceBacked = (
      await Promise.all(
        candidateRows.map(async (signal) => ({
          signal,
          detail: await this.getSignalDetail(workspaceId, viewerUserId, signal.id),
        })),
      )
    ).filter((candidate) => candidate.detail !== null);
    return {
      items: evidenceBacked
        .slice(opts.offset, opts.offset + opts.limit)
        .map((candidate) => candidate.signal),
      total: evidenceBacked.length,
    };
  }

  async listPeople(workspaceId: string, viewerUserId: string, opts: PageOpts): Promise<Page<PersonRecord>> {
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
    const signalRows = await this.#db
      .select()
      .from(signals)
      .where(and(eq(signals.workspaceId, workspaceId), eq(signals.id, id)))
      .limit(1);
    const signal = signalRows[0];
    if (!signal) return null;
    const subject =
      signal.subjectType === "person"
        ? await this.getPerson(workspaceId, viewerUserId, signal.subjectId)
        : signal.subjectType === "community"
          ? await this.getCommunity(workspaceId, viewerUserId, signal.subjectId)
          : null;
    if (!subject) return null;

    const payloadEventId = sourceEventIdFromPayload(signal.payload);
    const payloadEvent = payloadEventId ? await this.getEvent(workspaceId, payloadEventId) : null;
    let sourceEvent =
      payloadEvent?.entityType === "signal" && payloadEvent.entityId === signal.id
        ? payloadEvent
        : null;
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
          eq(edges.edgeType, "participant"),
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
              eq(edges.edgeType, "participant"),
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
      return [{ relationId: relation.id, relationType: relation.edgeType, recordType, recordId }];
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

    if (!sourceEvent || participants.length === 0) return null;
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
    await this.#db.insert(signalActions).values({
      id: randomUUID(),
      workspaceId: input.workspaceId,
      signalId: input.signalId,
      userId: input.userId,
      verb: input.verb,
    });
  }
}
