/**
 * DrizzleGraphStore — bounded Relationship Record/Relation/Event access over the
 * existing shared graph tables. Mutating methods are called only after the
 * Universal Action Pipeline has applied a Human request or recorded approval.
 *
 * Signal reactions are append-only Events. They are direct authenticated
 * bookkeeping writes; the safe Action itself still uses the governed pipeline.
 */
import { createHash, randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import {
  communities,
  communitiesCanonical,
  communityMembers,
  edges,
  events,
  fileRefs,
  files,
  goals,
  records,
  recordCommunities,
  recordParticipants,
  jobpilotApplications,
  jobpilotJobs,
  nodeTypes,
  people,
  peopleCanonical,
  resources,
  signals,
  tasks,
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

export interface GraphRelationPage {
  items: RelationRecord[];
  total: number;
  hasMore: boolean;
}

export interface FullGraphNodeRecord {
  id: string;
  recordId: string;
  recordType: string;
  label: string;
  databaseId: string;
  databaseLabel: string;
  moduleId: string;
  subtitle?: string;
  recordPath?: string;
  actionKind?: "signal";
  provenance: string;
}

export interface FullGraphEdgeRecord {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
  relationType: string;
  sourceModule: string;
  evidence: string;
}

export interface FullGraphPage {
  nodes: FullGraphNodeRecord[];
  edges: FullGraphEdgeRecord[];
  databases: Array<{ id: string; label: string; moduleId: string }>;
  hasMore: boolean;
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

interface FullGraphEdgeCandidate extends FullGraphEdgeRecord {
  sortAt: Date;
}

const FULL_GRAPH_NODE_TYPES = new Set([
  "person",
  "community",
  "signal",
  "event",
  "record",
  "file",
  "job",
  "application",
  "goal",
  "task",
  "resource",
]);

function normalizeFullGraphNodeType(value: string): string | null {
  const normalized = value.trim().toLowerCase().replaceAll("-", "_");
  const aliases: Record<string, string> = {
    people: "person",
    communities: "community",
    jobpilot_job: "job",
    jobpilot_jobs: "job",
    jobpilot_application: "application",
    jobpilot_applications: "application",
  };
  const nodeType = aliases[normalized] ?? normalized;
  return FULL_GRAPH_NODE_TYPES.has(nodeType) ? nodeType : null;
}

function fullGraphNodeId(nodeType: string, recordId: string): string {
  return `${nodeType}:${recordId}`;
}

function fullGraphDatabase(nodeType: string): { id: string; label: string; moduleId: string } {
  const databases: Record<string, { id: string; label: string; moduleId: string }> = {
    person: { id: "people", label: "People", moduleId: "relationship" },
    community: { id: "communities", label: "Communities", moduleId: "relationship" },
    signal: { id: "signals", label: "Signals", moduleId: "relationship" },
    event: { id: "events", label: "Events", moduleId: "relationship" },
    record: { id: "records", label: "Records", moduleId: "record" },
    file: { id: "files", label: "Files", moduleId: "files" },
    job: { id: "jobpilot.jobs", label: "Jobs", moduleId: "job-pilot" },
    application: { id: "jobpilot.applications", label: "Applications", moduleId: "job-pilot" },
    goal: { id: "task-manager.goals", label: "Goals", moduleId: "task-manager" },
    task: { id: "task-manager.tasks", label: "Tasks", moduleId: "task-manager" },
    resource: { id: "resources", label: "Resources", moduleId: "resources" },
  };
  return databases[nodeType] ?? { id: nodeType, label: nodeType, moduleId: nodeType };
}

function graphMetadataLabel(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const values = metadata as Record<string, unknown>;
  for (const key of ["name", "fileName", "title"]) {
    if (typeof values[key] === "string" && values[key].trim()) return values[key].trim();
  }
  return null;
}

export interface PersonRecord {
  id: string;
  organizationId: string;
  ownerUserId: string;
  isOwner: boolean;
  visibility: string;
  displayName: string | null;
  currentTitle: string | null;
  location?: string | null;
  currentCommunityId: string | null;
  source: string | null;
  lastInteractionAt: Date | null;
  contextFreshnessAt: Date | null;
  createdAt: Date;
}

export interface CommunityRecord {
  id: string;
  organizationId: string;
  ownerUserId: string;
  isOwner: boolean;
  visibility: string;
  displayName: string | null;
  description: string | null;
  kind: string | null;
  location?: string | null;
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

export interface CommunityMemberRecord extends PersonRecord {
  role: string | null;
  confidence: number | null;
}

export type RelationshipRecordVisibility = "private" | "organization";

export interface DecisionProvenance {
  decisionLedgerId: string;
  decisionSequence: number;
  decisionAt: Date;
}

export interface CreatePersonInput extends DecisionProvenance {
  id: string;
  organizationId: string;
  ownerUserId: string;
  displayName: string;
  currentTitle?: string | null;
  bio?: string | null;
  location?: string | null;
  emails?: string[];
  visibility: RelationshipRecordVisibility;
  source: string;
}

export interface UpdatePersonInput extends DecisionProvenance {
  id: string;
  organizationId: string;
  ownerUserId: string;
  displayName?: string;
  currentTitle?: string | null;
  bio?: string | null;
  location?: string | null;
  emails?: string[];
  visibility?: RelationshipRecordVisibility;
}

export interface CreateCommunityInput extends DecisionProvenance {
  id: string;
  organizationId: string;
  ownerUserId: string;
  displayName: string;
  description?: string | null;
  location?: string | null;
  kind?: string | null;
  visibility: RelationshipRecordVisibility;
  source: string;
}

export interface UpdateCommunityInput extends DecisionProvenance {
  id: string;
  organizationId: string;
  ownerUserId: string;
  displayName?: string;
  description?: string | null;
  location?: string | null;
  kind?: string | null;
  visibility?: RelationshipRecordVisibility;
}

export interface ArchiveRelationshipRecordInput extends DecisionProvenance {
  id: string;
  organizationId: string;
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
  organizationId: string;
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
  organizationId: string;
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
  organizationId: string;
  ownerUserId: string;
  sourcePersonId: string;
  targetPersonId: string;
  initiatorConsent: boolean;
  recipientConsent: boolean;
  status: IntroductionStatus;
  privateDeclineReason?: string | null;
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

export interface IndexModuleFileInput {
  organizationId: string;
  ownerUserId: string;
  moduleId: string;
  moduleName: string;
  path: string;
  size: number;
  modifiedAt: string;
}

export type RelationVisibility = "private" | "organization" | "public";
export type RelationRecord = typeof edges.$inferSelect;

export interface UpsertRelationInput {
  organizationId: string;
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
  organizationId: string;
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

function stableReferenceUuid(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}

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
    !UUID_PATTERN.test(input.organizationId) ||
    !UUID_PATTERN.test(input.ownerUserId) ||
    !UUID_PATTERN.test(input.srcId) ||
    !UUID_PATTERN.test(input.dstId)
  ) {
    throw new Error("Relation organization, owner, and endpoints must be UUIDs");
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

function eventPayloadForProjection(
  eventPayload: unknown,
  relations: RelationRecord[],
): Record<string, unknown> {
  const stored = payloadRecord(eventPayload);
  for (const relation of relations) {
    const privatePayload = payloadRecord(
      payloadRecord(relation.properties).privateEventPayload,
    );
    if (Object.keys(privatePayload).length > 0) {
      return { ...stored, ...privatePayload };
    }
  }
  return stored;
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
  #rlsContext: { organizationId: string; userId: string } | null;

  constructor(
    db: Database,
    rlsContext: { organizationId: string; userId: string } | null = null,
  ) {
    this.#db = db;
    this.#rlsContext = rlsContext;
  }

  #hasRlsContext(organizationId: string, userId: string): boolean {
    return (
      this.#rlsContext?.organizationId === organizationId.toLowerCase() &&
      this.#rlsContext.userId === userId.toLowerCase()
    );
  }

  async #withRlsContext<T>(
    organizationId: string,
    userId: string,
    operation: (store: DrizzleGraphStore) => Promise<T>,
  ): Promise<T> {
    const context = {
      organizationId: organizationId.toLowerCase(),
      userId: userId.toLowerCase(),
    };
    if (!UUID_PATTERN.test(context.organizationId) || !UUID_PATTERN.test(context.userId)) {
      throw new Error("Graph request organization and user must be UUIDs");
    }
    return this.#db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT
          set_config('app.organization_id', ${context.organizationId}, true),
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
    organizationId: string,
    viewerUserId: string,
    signalId: string,
  ): Promise<typeof signals.$inferSelect | null> {
    const rows = await this.#db
      .select()
      .from(signals)
      .where(and(eq(signals.organizationId, organizationId), eq(signals.id, signalId)))
      .limit(1);
    const signal = rows[0];
    if (!signal) return null;
    const subject =
      signal.subjectType === "person"
        ? await this.getPerson(organizationId, viewerUserId, signal.subjectId)
        : signal.subjectType === "community"
          ? await this.getCommunity(organizationId, viewerUserId, signal.subjectId)
          : null;
    return subject ? signal : null;
  }

  async getSignalEvidenceAnchor(
    organizationId: string,
    viewerUserId: string,
    signalId: string,
    sourceEventId?: string,
  ): Promise<SignalEvidenceAnchor | null> {
    if (!this.#hasRlsContext(organizationId, viewerUserId)) {
      return this.#withRlsContext(organizationId, viewerUserId, (store) =>
        store.getSignalEvidenceAnchor(organizationId, viewerUserId, signalId, sourceEventId),
      );
    }
    const signal = await this.#getAccessibleSignal(organizationId, viewerUserId, signalId);
    if (!signal) return null;
    if (sourceEventId && sourceEventId !== signal.id) return null;
    const sourceEvent = await this.getEvent(organizationId, signal.id);
    return sourceEvent ? { signal, sourceEvent } : null;
  }

  async #canReadNode(
    organizationId: string,
    viewerUserId: string,
    nodeType: string,
    nodeId: string,
  ): Promise<boolean> {
    if (nodeType === "person") return (await this.getPerson(organizationId, viewerUserId, nodeId)) !== null;
    if (nodeType === "community") return (await this.getCommunity(organizationId, viewerUserId, nodeId)) !== null;
    if (nodeType === "signal") return (await this.#getAccessibleSignal(organizationId, viewerUserId, nodeId)) !== null;
    if (nodeType === "event") {
      const event = await this.getEvent(organizationId, nodeId);
      if (!event) return false;
      if (event.entityType === "interaction") {
        const payload = payloadRecord(event.payload);
        return (
          payloadString(payload, "ownerUserId") === viewerUserId ||
          payloadString(payload, "visibility") === "organization"
        );
      }
      return (await this.#getAccessibleSignal(organizationId, viewerUserId, event.id)) !== null;
    }
    return false;
  }

  #accessibleNodeCondition(
    nodeType: typeof edges.srcType | typeof edges.dstType,
    nodeId: typeof edges.srcId | typeof edges.dstId,
    organizationId: string,
    viewerUserId: string,
  ) {
    return sql<boolean>`(
      (${nodeType} = 'person' AND EXISTS (
        SELECT 1
        FROM "people" AS "relation_person"
        WHERE "relation_person"."organization_id" = ${organizationId}
          AND "relation_person"."id" = ${nodeId}
          AND "relation_person"."archived_at" IS NULL
          AND (
            "relation_person"."visibility" = 'organization'
            OR (
              "relation_person"."visibility" IN ('private', 'team')
              AND "relation_person"."user_id" = ${viewerUserId}
            )
          )
      ))
      OR (${nodeType} = 'community' AND EXISTS (
        SELECT 1
        FROM "communities" AS "relation_community"
        WHERE "relation_community"."organization_id" = ${organizationId}
          AND "relation_community"."id" = ${nodeId}
          AND "relation_community"."archived_at" IS NULL
          AND (
            "relation_community"."visibility" = 'organization'
            OR (
              "relation_community"."visibility" IN ('private', 'team')
              AND "relation_community"."user_id" = ${viewerUserId}
            )
          )
      ))
      OR (${nodeType} = 'signal' AND EXISTS (
        SELECT 1
        FROM "signals" AS "relation_signal"
        WHERE "relation_signal"."organization_id" = ${organizationId}
          AND "relation_signal"."id" = ${nodeId}
          AND (
            ("relation_signal"."subject_type" = 'person' AND EXISTS (
              SELECT 1
              FROM "people" AS "relation_signal_person"
              WHERE "relation_signal_person"."organization_id" = ${organizationId}
                AND "relation_signal_person"."id" = "relation_signal"."subject_id"
                AND "relation_signal_person"."archived_at" IS NULL
                AND (
                  "relation_signal_person"."visibility" = 'organization'
                  OR (
                    "relation_signal_person"."visibility" IN ('private', 'team')
                    AND "relation_signal_person"."user_id" = ${viewerUserId}
                  )
                )
            ))
            OR ("relation_signal"."subject_type" = 'community' AND EXISTS (
              SELECT 1
              FROM "communities" AS "relation_signal_community"
              WHERE "relation_signal_community"."organization_id" = ${organizationId}
                AND "relation_signal_community"."id" = "relation_signal"."subject_id"
                AND "relation_signal_community"."archived_at" IS NULL
                AND (
                  "relation_signal_community"."visibility" = 'organization'
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
          ON "relation_event_signal"."organization_id" = "relation_event"."organization_id"
         AND "relation_event_signal"."id" = "relation_event"."id"
        WHERE "relation_event"."organization_id" = ${organizationId}
          AND "relation_event"."id" = ${nodeId}
          AND (
            (
              "relation_event"."entity_type" = 'interaction'
              AND (
                "relation_event"."payload" ->> 'ownerUserId' = ${viewerUserId}
                OR "relation_event"."payload" ->> 'visibility' = 'organization'
              )
            )
            OR (
              "relation_event_signal"."id" IS NOT NULL
              AND (
                ("relation_event_signal"."subject_type" = 'person' AND EXISTS (
                  SELECT 1
                  FROM "people" AS "relation_event_person"
                  WHERE "relation_event_person"."organization_id" = ${organizationId}
                    AND "relation_event_person"."id" = "relation_event_signal"."subject_id"
                    AND "relation_event_person"."archived_at" IS NULL
                    AND (
                      "relation_event_person"."visibility" = 'organization'
                      OR (
                        "relation_event_person"."visibility" IN ('private', 'team')
                        AND "relation_event_person"."user_id" = ${viewerUserId}
                      )
                    )
                ))
                OR ("relation_event_signal"."subject_type" = 'community' AND EXISTS (
                  SELECT 1
                  FROM "communities" AS "relation_event_community"
                  WHERE "relation_event_community"."organization_id" = ${organizationId}
                    AND "relation_event_community"."id" = "relation_event_signal"."subject_id"
                    AND "relation_event_community"."archived_at" IS NULL
                    AND (
                      "relation_event_community"."visibility" = 'organization'
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

  #readableSignalSubjectCondition(organizationId: string, viewerUserId: string) {
    return sql<boolean>`(
      (${signals.subjectType} = 'person' AND EXISTS (
        SELECT 1
        FROM "people" AS "signal_list_person"
        WHERE "signal_list_person"."organization_id" = ${organizationId}
          AND "signal_list_person"."id" = ${signals.subjectId}
          AND "signal_list_person"."archived_at" IS NULL
          AND (
            "signal_list_person"."visibility" = 'organization'
            OR (
              "signal_list_person"."visibility" IN ('private', 'team')
              AND "signal_list_person"."user_id" = ${viewerUserId}
            )
          )
      ))
      OR (${signals.subjectType} = 'community' AND EXISTS (
        SELECT 1
        FROM "communities" AS "signal_list_community"
        WHERE "signal_list_community"."organization_id" = ${organizationId}
          AND "signal_list_community"."id" = ${signals.subjectId}
          AND "signal_list_community"."archived_at" IS NULL
          AND (
            "signal_list_community"."visibility" = 'organization'
            OR (
              "signal_list_community"."visibility" IN ('private', 'team')
              AND "signal_list_community"."user_id" = ${viewerUserId}
            )
          )
      ))
    )`;
  }

  #signalHasReadableDetailCondition(organizationId: string, viewerUserId: string) {
    return sql<boolean>`EXISTS (
      SELECT 1
      FROM "events" AS "signal_list_event"
      WHERE "signal_list_event"."organization_id" = ${organizationId}
        AND "signal_list_event"."id" = ${signals.id}
        AND "signal_list_event"."payload" ? 'relationshipSignal'
        AND EXISTS (
          SELECT 1
          FROM "edges" AS "signal_list_participant"
          WHERE "signal_list_participant"."organization_id" = ${organizationId}
            AND "signal_list_participant"."edge_type" = 'participant'
            AND (
              "signal_list_participant"."owner_user_id" = ${viewerUserId}
              OR "signal_list_participant"."visibility" IN ('organization', 'public')
            )
            AND (
              (
                "signal_list_participant"."src_type" = 'event'
                AND "signal_list_participant"."src_id" = "signal_list_event"."id"
                AND (
                  (
                    "signal_list_participant"."dst_type" = 'person'
                    AND EXISTS (
                      SELECT 1
                      FROM "people" AS "signal_list_participant_person"
                      WHERE "signal_list_participant_person"."organization_id" = ${organizationId}
                        AND "signal_list_participant_person"."id" = "signal_list_participant"."dst_id"
                        AND "signal_list_participant_person"."archived_at" IS NULL
                        AND (
                          "signal_list_participant_person"."visibility" = 'organization'
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
                      WHERE "signal_list_participant_community"."organization_id" = ${organizationId}
                        AND "signal_list_participant_community"."id" = "signal_list_participant"."dst_id"
                        AND "signal_list_participant_community"."archived_at" IS NULL
                        AND (
                          "signal_list_participant_community"."visibility" = 'organization'
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
                  "signal_list_participant"."dst_type" = 'event'
                  AND "signal_list_participant"."dst_id" = "signal_list_event"."id"
                )
                AND (
                  (
                    "signal_list_participant"."src_type" = 'person'
                    AND EXISTS (
                      SELECT 1
                      FROM "people" AS "signal_list_participant_person"
                      WHERE "signal_list_participant_person"."organization_id" = ${organizationId}
                        AND "signal_list_participant_person"."id" = "signal_list_participant"."src_id"
                        AND "signal_list_participant_person"."archived_at" IS NULL
                        AND (
                          "signal_list_participant_person"."visibility" = 'organization'
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
                      WHERE "signal_list_participant_community"."organization_id" = ${organizationId}
                        AND "signal_list_participant_community"."id" = "signal_list_participant"."src_id"
                        AND "signal_list_participant_community"."archived_at" IS NULL
                        AND (
                          "signal_list_participant_community"."visibility" = 'organization'
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
    organizationId: string,
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
              organizationId: people.organizationId,
              ownerUserId: people.userId,
              isOwner: sql<boolean>`${people.userId} = ${viewerUserId}`,
              visibility: people.visibility,
              displayName: sql<string | null>`coalesce(${people.fullNameOverride}, ${peopleCanonical.preferredName}, ${peopleCanonical.fullName})`,
              currentTitle: sql<string | null>`CASE
                WHEN ${people.currentTitleOverride} IS NULL THEN ${peopleCanonical.currentTitle}
                ELSE nullif(${people.currentTitleOverride}, '')
              END`,
              location: sql<string | null>`CASE
                WHEN ${people.locationOverride} IS NULL THEN nullif(concat_ws(', ', ${peopleCanonical.locationCity}, ${peopleCanonical.locationCountry}), '')
                ELSE nullif(${people.locationOverride}, '')
              END`,
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
                eq(people.organizationId, organizationId),
                inArray(people.id, [...grouped.person]),
                or(
                  eq(people.visibility, "organization"),
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
              organizationId: communities.organizationId,
              ownerUserId: communities.userId,
              isOwner: sql<boolean>`${communities.userId} = ${viewerUserId}`,
              visibility: communities.visibility,
              displayName: sql<string | null>`coalesce(${communities.nameOverride}, ${communitiesCanonical.name})`,
              description: sql<string | null>`CASE
                WHEN ${communities.descriptionOverride} IS NULL THEN ${communitiesCanonical.description}
                ELSE nullif(${communities.descriptionOverride}, '')
              END`,
              kind: sql<string | null>`CASE
                WHEN ${communities.kind} IS NULL THEN ${communitiesCanonical.kind}
                ELSE nullif(${communities.kind}, '')
              END`,
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
                eq(communities.organizationId, organizationId),
                inArray(communities.id, [...grouped.community]),
                or(
                  eq(communities.visibility, "organization"),
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
                eq(signals.organizationId, organizationId),
                inArray(signals.id, [...grouped.signal]),
                this.#readableSignalSubjectCondition(
                  organizationId,
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
                eq(signals.organizationId, events.organizationId),
                eq(signals.id, events.id),
              ),
            )
            .where(
              and(
                eq(events.organizationId, organizationId),
                inArray(events.id, [...grouped.event]),
                or(
                  and(
                    eq(events.entityType, "interaction"),
                    sql<boolean>`(
                      ${events.payload} ->> 'ownerUserId' = ${viewerUserId}
                      OR ${events.payload} ->> 'visibility' = 'organization'
                    )`,
                  ),
                  and(
                    isNotNull(signals.id),
                    this.#readableSignalSubjectCondition(
                      organizationId,
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
    organizationId: string,
    viewerUserId: string,
    references: Array<{
      recordType: "person" | "community";
      recordId: string;
    }>,
  ): Promise<boolean> {
    if (!this.#hasRlsContext(organizationId, viewerUserId)) {
      return this.#withRlsContext(organizationId, viewerUserId, (store) =>
        store.areRelationshipRecordsAccessible(
          organizationId,
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
      organizationId,
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
    organizationId: string,
    viewerUserId: string,
    anchor: { nodeType: string; nodeId: string },
    opts: { limit: number; cursor?: RelationCursor | null },
  ): Promise<RelationPage> {
    if (!this.#hasRlsContext(organizationId, viewerUserId)) {
      return this.#withRlsContext(organizationId, viewerUserId, (store) =>
        store.listRelations(organizationId, viewerUserId, anchor, opts),
      );
    }

    if (!(await this.#canReadNode(organizationId, viewerUserId, anchor.nodeType, anchor.nodeId))) {
      return { items: [], total: 0, nextCursor: null };
    }
    const limit = Math.min(Math.max(opts.limit, 1), MAX_RELATION_PAGE_SIZE);
    const visibleRelation = or(
      eq(edges.ownerUserId, viewerUserId),
      inArray(edges.visibility, ["organization", "public"]),
    );
    const baseWhere = and(
      eq(edges.organizationId, organizationId),
      visibleRelation,
      or(
        and(
          eq(edges.srcType, anchor.nodeType),
          eq(edges.srcId, anchor.nodeId),
          this.#accessibleNodeCondition(edges.dstType, edges.dstId, organizationId, viewerUserId),
        ),
        and(
          eq(edges.dstType, anchor.nodeType),
          eq(edges.dstId, anchor.nodeId),
          this.#accessibleNodeCondition(edges.srcType, edges.srcId, organizationId, viewerUserId),
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
      organizationId,
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

  async listGraphRelations(
    organizationId: string,
    viewerUserId: string,
    opts: { limit: number; nodeTypes?: string[] },
  ): Promise<GraphRelationPage> {
    if (!this.#hasRlsContext(organizationId, viewerUserId)) {
      return this.#withRlsContext(organizationId, viewerUserId, (store) =>
        store.listGraphRelations(organizationId, viewerUserId, opts),
      );
    }
    const limit = clamp(opts.limit, 1, 500);
    const nodeTypes = [...new Set((opts.nodeTypes ?? []).map((value) => value.trim()).filter(Boolean))];
    const where = and(
      eq(edges.organizationId, organizationId),
      or(
        eq(edges.ownerUserId, viewerUserId),
        inArray(edges.visibility, ["organization", "public"]),
      ),
      nodeTypes.length > 0 ? inArray(edges.srcType, nodeTypes) : undefined,
      nodeTypes.length > 0 ? inArray(edges.dstType, nodeTypes) : undefined,
      this.#accessibleNodeCondition(edges.srcType, edges.srcId, organizationId, viewerUserId),
      this.#accessibleNodeCondition(edges.dstType, edges.dstId, organizationId, viewerUserId),
    );
    const [rows, totalRows] = await Promise.all([
      this.#db
        .select()
        .from(edges)
        .where(where)
        .orderBy(desc(edges.observedAt), desc(edges.createdAt), desc(edges.id))
        .limit(limit + 1),
      this.#db.select({ value: count() }).from(edges).where(where),
    ]);
    const pageRows = rows.slice(0, limit);
    const evidenceReferences = pageRows.flatMap((relation) =>
      relationEvidenceCandidates(relation).map((reference) => ({
        nodeType: reference.entityType,
        nodeId: reference.entityId,
      })),
    );
    const accessible = await this.#loadAccessibleNodes(
      organizationId,
      viewerUserId,
      evidenceReferences,
    );
    const total = Number(totalRows[0]?.value ?? 0);
    return {
      items: pageRows.map((relation) => this.#pruneRelationEvidence(relation, accessible)),
      total,
      hasMore: rows.length > limit || total > limit,
    };
  }

  async listFullGraph(
    organizationId: string,
    viewerUserId: string,
    opts: { limit: number },
  ): Promise<FullGraphPage> {
    if (!this.#hasRlsContext(organizationId, viewerUserId)) {
      return this.#withRlsContext(organizationId, viewerUserId, (store) =>
        store.listFullGraph(organizationId, viewerUserId, opts),
      );
    }
    const limit = clamp(opts.limit, 1, 200);
    const sourceLimit = Math.max(10, Math.ceil(limit / 8));
    const [
      relationPage,
      recordPersonRows,
      recordCommunityRows,
      fileReferenceRows,
      applicationRows,
      taskRows,
      entityEventRows,
    ] = await Promise.all([
      this.listGraphRelations(organizationId, viewerUserId, { limit: sourceLimit }),
      this.#db
        .select({
          recordId: recordParticipants.recordId,
          personId: recordParticipants.personId,
          createdAt: records.createdAt,
        })
        .from(recordParticipants)
        .innerJoin(records, eq(records.id, recordParticipants.recordId))
        .where(and(eq(records.organizationId, organizationId), isNull(records.archivedAt)))
        .orderBy(desc(records.createdAt))
        .limit(sourceLimit + 1),
      this.#db
        .select({
          recordId: recordCommunities.recordId,
          communityId: recordCommunities.communityId,
          createdAt: records.createdAt,
        })
        .from(recordCommunities)
        .innerJoin(records, eq(records.id, recordCommunities.recordId))
        .where(and(eq(records.organizationId, organizationId), isNull(records.archivedAt)))
        .orderBy(desc(records.createdAt))
        .limit(sourceLimit + 1),
      this.#db
        .select({
          fileId: fileRefs.fileId,
          entityType: fileRefs.entityType,
          entityId: fileRefs.entityId,
          createdAt: files.createdAt,
        })
        .from(fileRefs)
        .innerJoin(files, eq(files.id, fileRefs.fileId))
        .where(and(eq(files.organizationId, organizationId), isNull(files.archivedAt)))
        .orderBy(desc(files.createdAt))
        .limit(sourceLimit + 1),
      this.#db
        .select({
          id: jobpilotApplications.id,
          jobId: jobpilotApplications.jobId,
          updatedAt: jobpilotApplications.updatedAt,
        })
        .from(jobpilotApplications)
        .where(eq(jobpilotApplications.organizationId, organizationId))
        .orderBy(desc(jobpilotApplications.updatedAt))
        .limit(sourceLimit + 1),
      this.#db
        .select({
          id: tasks.id,
          goalId: tasks.goalId,
          createdAt: tasks.createdAt,
        })
        .from(tasks)
        .where(eq(tasks.organizationId, organizationId))
        .orderBy(desc(tasks.createdAt))
        .limit(sourceLimit + 1),
      this.#db
        .select({
          id: events.id,
          type: events.type,
          entityType: events.entityType,
          entityId: events.entityId,
          createdAt: events.createdAt,
        })
        .from(events)
        .where(eq(events.organizationId, organizationId))
        .orderBy(desc(events.createdAt))
        .limit(sourceLimit + 1),
    ]);

    const candidates: FullGraphEdgeCandidate[] = relationPage.items.map((relation) => ({
      id: `relation:${relation.id}`,
      sourceId: fullGraphNodeId(relation.srcType, relation.srcId),
      targetId: fullGraphNodeId(relation.dstType, relation.dstId),
      label: relation.edgeType,
      relationType: relation.edgeType,
      sourceModule: relation.sourceModule,
      evidence: `${relation.evidenceRefs.length} permitted evidence ${relation.evidenceRefs.length === 1 ? "reference" : "references"} · source ${relation.sourceModule}`,
      sortAt: relation.observedAt,
    }));
    for (const row of recordPersonRows.slice(0, sourceLimit)) {
      candidates.push({
        id: `record-person:${row.recordId}:${row.personId}`,
        sourceId: fullGraphNodeId("record", row.recordId),
        targetId: fullGraphNodeId("person", row.personId),
        label: "participant",
        relationType: "participant",
        sourceModule: "record",
        evidence: "Record participant · source record",
        sortAt: row.createdAt,
      });
    }
    for (const row of recordCommunityRows.slice(0, sourceLimit)) {
      candidates.push({
        id: `record-community:${row.recordId}:${row.communityId}`,
        sourceId: fullGraphNodeId("record", row.recordId),
        targetId: fullGraphNodeId("community", row.communityId),
        label: "community",
        relationType: "community",
        sourceModule: "record",
        evidence: "Record Community · source record",
        sortAt: row.createdAt,
      });
    }
    for (const row of fileReferenceRows.slice(0, sourceLimit)) {
      const targetType = normalizeFullGraphNodeType(row.entityType);
      if (!targetType) continue;
      candidates.push({
        id: `file-reference:${row.fileId}:${targetType}:${row.entityId}`,
        sourceId: fullGraphNodeId("file", row.fileId),
        targetId: fullGraphNodeId(targetType, row.entityId),
        label: "attached to",
        relationType: "file_reference",
        sourceModule: "files",
        evidence: `File reference · source ${row.entityType}`,
        sortAt: row.createdAt,
      });
    }
    for (const row of applicationRows.slice(0, sourceLimit)) {
      candidates.push({
        id: `application-job:${row.id}:${row.jobId}`,
        sourceId: fullGraphNodeId("application", row.id),
        targetId: fullGraphNodeId("job", row.jobId),
        label: "tracks",
        relationType: "tracks",
        sourceModule: "job-pilot",
        evidence: "Application Job reference · source job-pilot",
        sortAt: row.updatedAt,
      });
    }
    for (const row of taskRows.slice(0, sourceLimit)) {
      candidates.push({
        id: `task-goal:${row.id}:${row.goalId}`,
        sourceId: fullGraphNodeId("task", row.id),
        targetId: fullGraphNodeId("goal", row.goalId),
        label: "advances",
        relationType: "advances",
        sourceModule: "task-manager",
        evidence: "Task Goal reference · source task-manager",
        sortAt: row.createdAt,
      });
    }
    for (const row of entityEventRows.slice(0, sourceLimit)) {
      const targetType = normalizeFullGraphNodeType(row.entityType);
      if (!targetType || (targetType === "event" && row.entityId === row.id)) continue;
      const targetDatabase = fullGraphDatabase(targetType);
      candidates.push({
        id: `event-entity:${row.id}:${targetType}:${row.entityId}`,
        sourceId: fullGraphNodeId("event", row.id),
        targetId: fullGraphNodeId(targetType, row.entityId),
        label: row.type,
        relationType: "recorded_for",
        sourceModule: targetDatabase.moduleId,
        evidence: `Event ${row.type} · source ${targetDatabase.moduleId}`,
        sortAt: row.createdAt,
      });
    }

    candidates.sort((left, right) => right.sortAt.getTime() - left.sortAt.getTime());
    const nodeSourceLimit = Math.max(5, Math.ceil(limit / 16));
    const [
      basePeople,
      baseCommunities,
      baseSignals,
      baseRecords,
      baseFiles,
      baseJobs,
      baseApplications,
      baseGoals,
      baseTasks,
      baseResources,
    ] = await Promise.all([
      this.listPeople(organizationId, viewerUserId, { limit: nodeSourceLimit, offset: 0 }),
      this.listCommunities(organizationId, viewerUserId, { limit: nodeSourceLimit, offset: 0 }),
      this.listSignals(organizationId, viewerUserId, { limit: nodeSourceLimit, offset: 0 }),
      this.#db.select({ id: records.id }).from(records).where(and(
        eq(records.organizationId, organizationId),
        isNull(records.archivedAt),
      )).orderBy(desc(records.createdAt)).limit(nodeSourceLimit + 1),
      this.#db.select({ id: files.id }).from(files).where(and(
        eq(files.organizationId, organizationId),
        isNull(files.archivedAt),
      )).orderBy(desc(files.createdAt)).limit(nodeSourceLimit + 1),
      this.#db.select({ id: jobpilotJobs.id }).from(jobpilotJobs).where(and(
        eq(jobpilotJobs.organizationId, organizationId),
        isNull(jobpilotJobs.archivedAt),
      )).orderBy(desc(jobpilotJobs.createdAt)).limit(nodeSourceLimit + 1),
      this.#db.select({ id: jobpilotApplications.id }).from(jobpilotApplications).where(
        eq(jobpilotApplications.organizationId, organizationId),
      ).orderBy(desc(jobpilotApplications.updatedAt)).limit(nodeSourceLimit + 1),
      this.#db.select({ id: goals.id }).from(goals).where(
        eq(goals.organizationId, organizationId),
      ).orderBy(desc(goals.createdAt)).limit(nodeSourceLimit + 1),
      this.#db.select({ id: tasks.id }).from(tasks).where(
        eq(tasks.organizationId, organizationId),
      ).orderBy(desc(tasks.createdAt)).limit(nodeSourceLimit + 1),
      this.#db.select({ id: resources.id }).from(resources).where(and(
        eq(resources.organizationId, organizationId),
        isNull(resources.archivedAt),
      )).orderBy(desc(resources.createdAt)).limit(nodeSourceLimit + 1),
    ]);
    const baseReferences = [
      ...basePeople.items.map((row) => ({ nodeType: "person", nodeId: row.id })),
      ...baseCommunities.items.map((row) => ({ nodeType: "community", nodeId: row.id })),
      ...baseSignals.items.map((row) => ({ nodeType: "signal", nodeId: row.id })),
      ...baseRecords.slice(0, nodeSourceLimit).map((row) => ({ nodeType: "record", nodeId: row.id })),
      ...baseFiles.slice(0, nodeSourceLimit).map((row) => ({ nodeType: "file", nodeId: row.id })),
      ...baseJobs.slice(0, nodeSourceLimit).map((row) => ({ nodeType: "job", nodeId: row.id })),
      ...baseApplications.slice(0, nodeSourceLimit).map((row) => ({ nodeType: "application", nodeId: row.id })),
      ...baseGoals.slice(0, nodeSourceLimit).map((row) => ({ nodeType: "goal", nodeId: row.id })),
      ...baseTasks.slice(0, nodeSourceLimit).map((row) => ({ nodeType: "task", nodeId: row.id })),
      ...baseResources.slice(0, nodeSourceLimit).map((row) => ({ nodeType: "resource", nodeId: row.id })),
    ];
    const references = [...candidates.flatMap((edge) => [edge.sourceId, edge.targetId]).map((id) => {
      const separator = id.indexOf(":");
      return { nodeType: id.slice(0, separator), nodeId: id.slice(separator + 1) };
    }), ...baseReferences];
    const baseNodeIds = new Set(baseReferences.map((reference) =>
      fullGraphNodeId(reference.nodeType, reference.nodeId)));
    const idsByType = new Map<string, Set<string>>();
    for (const reference of references) {
      idsByType.set(reference.nodeType, new Set([
        ...(idsByType.get(reference.nodeType) ?? []),
        reference.nodeId,
      ]));
    }
    const ids = (nodeType: string) => [...(idsByType.get(nodeType) ?? [])];
    const accessible = await this.#loadAccessibleNodes(
      organizationId,
      viewerUserId,
      references.filter((reference) =>
        reference.nodeType === "person" ||
        reference.nodeType === "community" ||
        reference.nodeType === "signal" ||
        reference.nodeType === "event"),
    );
    const [
      signalRows,
      eventRows,
      recordRows,
      fileRows,
      jobRows,
      resolvedApplications,
      goalRows,
      resolvedTasks,
      resourceRows,
    ] = await Promise.all([
      accessible.signalIds.size === 0
        ? Promise.resolve<Array<typeof signals.$inferSelect>>([])
        : this.#db.select().from(signals).where(and(
            eq(signals.organizationId, organizationId),
            inArray(signals.id, [...accessible.signalIds]),
          )),
      ids("event").length === 0
        ? Promise.resolve<Array<typeof events.$inferSelect>>([])
        : this.#db.select().from(events).where(and(
            eq(events.organizationId, organizationId),
            inArray(events.id, ids("event")),
          )),
      ids("record").length === 0
        ? Promise.resolve<Array<typeof records.$inferSelect>>([])
        : this.#db.select().from(records).where(and(
            eq(records.organizationId, organizationId),
            inArray(records.id, ids("record")),
            isNull(records.archivedAt),
          )),
      ids("file").length === 0
        ? Promise.resolve<Array<typeof files.$inferSelect>>([])
        : this.#db.select().from(files).where(and(
            eq(files.organizationId, organizationId),
            inArray(files.id, ids("file")),
            isNull(files.archivedAt),
          )),
      ids("job").length === 0
        ? Promise.resolve<Array<typeof jobpilotJobs.$inferSelect>>([])
        : this.#db.select().from(jobpilotJobs).where(and(
            eq(jobpilotJobs.organizationId, organizationId),
            inArray(jobpilotJobs.id, ids("job")),
            isNull(jobpilotJobs.archivedAt),
          )),
      ids("application").length === 0
        ? Promise.resolve<Array<typeof jobpilotApplications.$inferSelect>>([])
        : this.#db.select().from(jobpilotApplications).where(and(
            eq(jobpilotApplications.organizationId, organizationId),
            inArray(jobpilotApplications.id, ids("application")),
          )),
      ids("goal").length === 0
        ? Promise.resolve<Array<typeof goals.$inferSelect>>([])
        : this.#db.select().from(goals).where(and(
            eq(goals.organizationId, organizationId),
            inArray(goals.id, ids("goal")),
          )),
      ids("task").length === 0
        ? Promise.resolve<Array<typeof tasks.$inferSelect>>([])
        : this.#db.select().from(tasks).where(and(
            eq(tasks.organizationId, organizationId),
            inArray(tasks.id, ids("task")),
          )),
      ids("resource").length === 0
        ? Promise.resolve<Array<typeof resources.$inferSelect>>([])
        : this.#db.select().from(resources).where(and(
            eq(resources.organizationId, organizationId),
            inArray(resources.id, ids("resource")),
            isNull(resources.archivedAt),
          )),
    ]);

    const nodes = new Map<string, FullGraphNodeRecord>();
    const addNode = (
      nodeType: string,
      recordId: string,
      values: Pick<FullGraphNodeRecord, "label" | "provenance"> & {
        subtitle?: string | undefined;
        recordPath?: string | undefined;
        actionKind?: "signal" | undefined;
        moduleId?: string | undefined;
      },
    ) => {
      const database = fullGraphDatabase(nodeType);
      const node: FullGraphNodeRecord = {
        id: fullGraphNodeId(nodeType, recordId),
        recordId,
        recordType: nodeType,
        label: values.label,
        databaseId: database.id,
        databaseLabel: database.label,
        moduleId: values.moduleId ?? database.moduleId,
        provenance: values.provenance,
        ...(values.subtitle ? { subtitle: values.subtitle } : {}),
        ...(values.recordPath ? { recordPath: values.recordPath } : {}),
        ...(values.actionKind ? { actionKind: values.actionKind } : {}),
      };
      nodes.set(node.id, node);
    };
    for (const person of accessible.people.values()) {
      addNode("person", person.id, {
        label: person.displayName ?? "Unnamed Person",
        subtitle: person.currentTitle ?? person.location ?? undefined,
        recordPath: `/module/relationship/people/${person.id}`,
        provenance: `Person · source ${person.source ?? "relationship"}`,
      });
    }
    for (const community of accessible.communities.values()) {
      addNode("community", community.id, {
        label: community.displayName ?? "Unnamed Community",
        subtitle: community.kind ?? undefined,
        recordPath: `/module/relationship/communities/${community.id}`,
        provenance: `Community · source ${community.source}`,
      });
    }
    for (const signal of signalRows) {
      addNode("signal", signal.id, {
        label: `Signal · ${signal.type}`,
        subtitle: signal.status,
        recordPath: `/module/relationship/signals/${signal.id}`,
        actionKind: "signal",
        provenance: "Signal · source relationship",
      });
    }
    for (const event of eventRows) {
      const relationshipEvent = event.entityType === "signal" || event.entityType === "interaction";
      if (relationshipEvent && !accessible.eventIds.has(event.id)) continue;
      const targetType = normalizeFullGraphNodeType(event.entityType);
      const targetDatabase = targetType ? fullGraphDatabase(targetType) : fullGraphDatabase("event");
      addNode("event", event.id, {
        label: `Event · ${event.type}`,
        subtitle: event.entityType,
        moduleId: targetDatabase.moduleId,
        recordPath: event.entityType === "signal"
          ? `/module/relationship/signals/${event.entityId}/event`
          : undefined,
        provenance: `Event · source ${targetDatabase.moduleId}`,
      });
    }
    for (const record of recordRows) {
      addNode("record", record.id, {
        label: record.title,
        subtitle: record.status ?? undefined,
        recordPath: `/record/${record.id}`,
        provenance: "Record · source record",
      });
    }
    for (const file of fileRows) {
      const storageName = file.storageRef?.split(/[\\/]/).at(-1);
      addNode("file", file.id, {
        label: graphMetadataLabel(file.metadata) ?? storageName ?? `File ${file.id.slice(0, 8)}`,
        subtitle: file.source,
        moduleId: file.source,
        provenance: `File · source ${file.source}`,
      });
    }
    for (const job of jobRows) {
      addNode("job", job.id, {
        label: job.title,
        subtitle: `${job.company}${job.location ? ` · ${job.location}` : ""}`,
        recordPath: "/jobpilot",
        provenance: `Job · source ${job.source ?? "job-pilot"}`,
      });
    }
    for (const application of resolvedApplications) {
      addNode("application", application.id, {
        label: `Application · ${application.stage}`,
        subtitle: application.flag ?? undefined,
        recordPath: "/jobpilot",
        provenance: "Application · source job-pilot",
      });
    }
    for (const goal of goalRows) {
      addNode("goal", goal.id, {
        label: goal.title,
        subtitle: goal.type,
        recordPath: "/task-manager",
        provenance: "Goal · source task-manager",
      });
    }
    for (const task of resolvedTasks) {
      addNode("task", task.id, {
        label: task.type,
        subtitle: task.status,
        recordPath: "/task-manager",
        provenance: "Task · source task-manager",
      });
    }
    for (const resource of resourceRows) {
      addNode("resource", resource.id, {
        label: resource.title,
        subtitle: resource.kind,
        recordPath: "/resources",
        provenance: "Resource · source resources",
      });
    }

    const permittedEdges = candidates.filter(
      (edge) => nodes.has(edge.sourceId) && nodes.has(edge.targetId),
    );
    const selectedEdges = permittedEdges.slice(0, limit).map(({ sortAt: _sortAt, ...edge }) => edge);
    const connectedNodeIds = new Set(selectedEdges.flatMap((edge) => [edge.sourceId, edge.targetId]));
    const selectedNodes = [...nodes.values()].filter(
      (node) => connectedNodeIds.has(node.id) || baseNodeIds.has(node.id),
    );
    const databases = [...new Map(selectedNodes.map((node) => [
      node.databaseId,
      { id: node.databaseId, label: node.databaseLabel, moduleId: node.moduleId },
    ])).values()];
    const sourceTruncated = [
      recordPersonRows,
      recordCommunityRows,
      fileReferenceRows,
      applicationRows,
      taskRows,
      entityEventRows,
    ].some((rows) => rows.length > sourceLimit);
    const nodeSourceTruncated =
      basePeople.total > basePeople.items.length ||
      baseCommunities.total > baseCommunities.items.length ||
      baseSignals.total > baseSignals.items.length ||
      [
        baseRecords,
        baseFiles,
        baseJobs,
        baseApplications,
        baseGoals,
        baseTasks,
        baseResources,
      ].some((rows) => rows.length > nodeSourceLimit);
    return {
      nodes: selectedNodes,
      edges: selectedEdges,
      databases,
      hasMore: relationPage.hasMore || sourceTruncated || nodeSourceTruncated || permittedEdges.length > limit,
    };
  }

  async findRelationshipPaths(
    organizationId: string,
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
    if (!this.#hasRlsContext(organizationId, viewerUserId)) {
      return this.#withRlsContext(organizationId, viewerUserId, (store) =>
        store.findRelationshipPaths(organizationId, viewerUserId, start, end, opts),
      );
    }
    const maxDepth = clamp(opts.maxDepth, 1, 6);
    const maxPaths = clamp(opts.maxPaths, 1, 5);
    const maxVisited = clamp(opts.maxVisited ?? 100, 1, 200);
    const maxEdgesPerNode = clamp(opts.maxEdgesPerNode ?? 50, 1, 100);
    const [canReadStart, canReadEnd] = await Promise.all([
      this.#canReadNode(
        organizationId,
        viewerUserId,
        start.nodeType,
        start.nodeId,
      ),
      this.#canReadNode(
        organizationId,
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
        organizationId,
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
    if (!this.#hasRlsContext(input.organizationId, input.ownerUserId)) {
      return this.#withRlsContext(input.organizationId, input.ownerUserId, (store) =>
        store.upsertRelation(input),
      );
    }
    const relationInput: UpsertRelationInput = {
      ...input,
      organizationId: input.organizationId.toLowerCase(),
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
        relationInput.organizationId,
        relationInput.ownerUserId,
        relationInput.srcType,
        relationInput.srcId,
      ),
      this.#canReadNode(
        relationInput.organizationId,
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
        organizationId: relationInput.organizationId,
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
          edges.organizationId,
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
    if (!this.#hasRlsContext(input.organizationId, input.ownerUserId)) {
      return this.#withRlsContext(input.organizationId, input.ownerUserId, (store) =>
        store.materializeSignalEvidence(input),
      );
    }
    const organizationId = input.organizationId.toLowerCase();
    const ownerUserId = input.ownerUserId.toLowerCase();
    const signalId = input.signalId.toLowerCase();
    const sourceEventId = input.sourceEventId.toLowerCase();
    const decisionLedgerId = input.decisionLedgerId.toLowerCase();
    const participants = input.participants.map((participant) => ({
      ...participant,
      recordId: participant.recordId.toLowerCase(),
    }));
    if (
      !UUID_PATTERN.test(organizationId) ||
      !UUID_PATTERN.test(ownerUserId) ||
      !UUID_PATTERN.test(signalId) ||
      !UUID_PATTERN.test(sourceEventId)
    ) {
      throw new Error("Signal evidence organization, owner, Signal, and Event must be UUIDs");
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
    if (signalId !== sourceEventId) {
      throw new Error("A Signal is projected from its own participant-linked Event");
    }
    const signal = await this.#getAccessibleSignal(
      organizationId,
      ownerUserId,
      signalId,
    );
    const signalEvent = await this.getEvent(organizationId, signalId);
    if (!signal || !signalEvent) {
      throw new Error("Signal Event not found or not accessible");
    }
    if (
      !participants.some(
        (participant) =>
          participant.recordType === signal.subjectType &&
          participant.recordId === signal.subjectId,
      )
    ) {
      throw new Error("Signal evidence participants must include the Signal subject");
    }
    if (
      !(await this.areRelationshipRecordsAccessible(
        organizationId,
        ownerUserId,
        participants,
      ))
    ) {
      throw new Error("Signal evidence participants are invalid or not accessible");
    }
    const currentRows = await this.#db
      .select()
      .from(edges)
      .where(and(
        eq(edges.organizationId, organizationId),
        eq(edges.ownerUserId, ownerUserId),
        eq(edges.edgeType, "participant"),
        eq(edges.sourceModule, "relationship"),
        eq(edges.srcType, "event"),
        eq(edges.srcId, signalId),
        isNotNull(edges.decisionSequence),
      ))
      .orderBy(desc(edges.decisionSequence), desc(edges.decisionAt), desc(edges.id));
    const watermark = currentRows[0];
    if (
      watermark &&
      watermark.decisionSequence !== null &&
      watermark.decisionSequence >= input.decisionSequence
    ) {
      return { sourceEvent: watermark, participants: currentRows };
    }
    await this.#db.delete(edges).where(and(
      eq(edges.organizationId, organizationId),
      eq(edges.ownerUserId, ownerUserId),
      eq(edges.edgeType, "participant"),
      eq(edges.sourceModule, "relationship"),
      eq(edges.srcType, "event"),
      eq(edges.srcId, signalId),
      isNotNull(edges.decisionSequence),
    ));
    const signalPayload = payloadRecord(signalEvent.payload);
    const source = payloadString(signalPayload, "source") ?? `event:${signalEvent.type}`;
    const materializedParticipants = await Promise.all(participants.map((participant) =>
      this.upsertRelation({
        organizationId,
        ownerUserId,
        srcType: "event",
        srcId: signalId,
        dstType: participant.recordType,
        dstId: participant.recordId,
        relationType: "participant",
        properties: participant.role ? { role: participant.role } : {},
        evidenceRefs: [{ entityType: "event", entityId: signalId, source }],
        confidence: participant.confidence,
        observedAt: signalEvent.createdAt,
        userConfirmed: input.userConfirmed,
        visibility: input.visibility,
        source,
        sourceModule: "relationship",
        decisionLedgerId,
        decisionSequence: input.decisionSequence,
        decisionAt: input.decisionAt,
      }),
    ));
    const anchor = materializedParticipants[0];
    if (!anchor) throw new Error("Signal Event participant Relations were not materialized");
    return { sourceEvent: anchor, participants: materializedParticipants };
  }

  async listRecords(organizationId: string, opts: PageOpts): Promise<Page<typeof records.$inferSelect>> {
    const where = eq(records.organizationId, organizationId);
    const [rows, totalRows] = await Promise.all([
      this.#db.select().from(records).where(where).orderBy(desc(records.createdAt)).limit(opts.limit).offset(opts.offset),
      this.#db.select({ value: count() }).from(records).where(where),
    ]);
    return { items: rows, total: Number(totalRows[0]?.value ?? 0) };
  }

  async getRecord(id: string): Promise<typeof records.$inferSelect | null> {
    const rows = await this.#db.select().from(records).where(eq(records.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async listSignals(
    organizationId: string,
    viewerUserId: string,
    opts: PageOpts & {
      subjectType?: "person" | "community";
      subjectId?: string;
    },
  ): Promise<Page<typeof signals.$inferSelect>> {
    if (!this.#hasRlsContext(organizationId, viewerUserId)) {
      return this.#withRlsContext(organizationId, viewerUserId, (store) =>
        store.listSignals(organizationId, viewerUserId, opts),
      );
    }
    const limit = Math.min(Math.max(opts.limit, 1), MAX_RELATION_PAGE_SIZE);
    const offset = Math.max(opts.offset, 0);
    const where = and(
      eq(signals.organizationId, organizationId),
      opts.subjectType ? eq(signals.subjectType, opts.subjectType) : undefined,
      opts.subjectId ? eq(signals.subjectId, opts.subjectId) : undefined,
      this.#readableSignalSubjectCondition(organizationId, viewerUserId),
      this.#signalHasReadableDetailCondition(organizationId, viewerUserId),
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
    organizationId: string,
    viewerUserId: string,
    opts: PageOpts & { query?: string },
  ): Promise<Page<PersonRecord>> {
    if (!this.#hasRlsContext(organizationId, viewerUserId)) {
      return this.#withRlsContext(organizationId, viewerUserId, (store) =>
        store.listPeople(organizationId, viewerUserId, opts),
      );
    }
    const limit = clamp(opts.limit, 1, 100);
    const offset = Math.max(0, opts.offset);
    const query = opts.query?.trim().slice(0, 120);
    const pattern = query
      ? `%${query.replace(/[!%_]/g, (value) => `!${value}`)}%`
      : null;
    const readable = and(
      eq(people.organizationId, organizationId),
      or(
        eq(people.visibility, "organization"),
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
            OR coalesce(
              CASE
                WHEN ${people.currentTitleOverride} IS NULL THEN ${peopleCanonical.currentTitle}
                ELSE nullif(${people.currentTitleOverride}, '')
              END,
              ''
            ) ILIKE ${pattern} ESCAPE '!'
          )`
        : undefined,
    );
    const [rows, totalRows] = await Promise.all([
      this.#db
        .select({
          id: people.id,
          organizationId: people.organizationId,
          ownerUserId: people.userId,
          isOwner: sql<boolean>`${people.userId} = ${viewerUserId}`,
          visibility: people.visibility,
          displayName: sql<string | null>`coalesce(${people.fullNameOverride}, ${peopleCanonical.preferredName}, ${peopleCanonical.fullName})`,
          currentTitle: sql<string | null>`CASE
            WHEN ${people.currentTitleOverride} IS NULL THEN ${peopleCanonical.currentTitle}
            ELSE nullif(${people.currentTitleOverride}, '')
          END`,
          location: sql<string | null>`CASE
            WHEN ${people.locationOverride} IS NULL THEN nullif(concat_ws(', ', ${peopleCanonical.locationCity}, ${peopleCanonical.locationCountry}), '')
            ELSE nullif(${people.locationOverride}, '')
          END`,
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
    organizationId: string,
    viewerUserId: string,
    id: string,
  ): Promise<PersonDetail | null> {
    if (!this.#hasRlsContext(organizationId, viewerUserId)) {
      return this.#withRlsContext(organizationId, viewerUserId, (store) =>
        store.getPerson(organizationId, viewerUserId, id),
      );
    }
    const rows = await this.#db
      .select({
        id: people.id,
        organizationId: people.organizationId,
        ownerUserId: people.userId,
        isOwner: sql<boolean>`${people.userId} = ${viewerUserId}`,
        visibility: people.visibility,
        displayName: sql<string | null>`coalesce(${people.fullNameOverride}, ${peopleCanonical.preferredName}, ${peopleCanonical.fullName})`,
        currentTitle: sql<string | null>`CASE
          WHEN ${people.currentTitleOverride} IS NULL THEN ${peopleCanonical.currentTitle}
          ELSE nullif(${people.currentTitleOverride}, '')
        END`,
        location: sql<string | null>`CASE
          WHEN ${people.locationOverride} IS NULL THEN nullif(concat_ws(', ', ${peopleCanonical.locationCity}, ${peopleCanonical.locationCountry}), '')
          ELSE nullif(${people.locationOverride}, '')
        END`,
        currentCommunityId: people.currentCommunityId,
        source: people.source,
        lastInteractionAt: people.lastInteractionAt,
        contextFreshnessAt: people.contextFreshnessAt,
        createdAt: people.createdAt,
        bio: sql<string | null>`CASE
          WHEN ${people.bioOverride} IS NULL THEN ${peopleCanonical.bio}
          ELSE nullif(${people.bioOverride}, '')
        END`,
        avatarUrl: sql<string | null>`coalesce(${people.avatarUrlOverride}, ${peopleCanonical.avatarUrl})`,
        emails: sql<string[]>`coalesce(${people.emailsOverride}, ${peopleCanonical.emails}, ARRAY[]::text[])`,
      })
      .from(people)
      .leftJoin(peopleCanonical, eq(people.canonicalPersonId, peopleCanonical.id))
      .where(
        and(
          eq(people.organizationId, organizationId),
          eq(people.id, id),
          or(
            eq(people.visibility, "organization"),
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
    organizationId: string,
    viewerUserId: string,
    email: string,
    limit = 2,
  ): Promise<PersonDetail[]> {
    if (!this.#hasRlsContext(organizationId, viewerUserId)) {
      return this.#withRlsContext(organizationId, viewerUserId, (store) =>
        store.findPeopleByEmail(organizationId, viewerUserId, email, limit),
      );
    }
    const normalizedEmail = email.trim().toLowerCase().slice(0, 320);
    if (!normalizedEmail) return [];
    return this.#db
      .select({
        id: people.id,
        organizationId: people.organizationId,
        ownerUserId: people.userId,
        isOwner: sql<boolean>`${people.userId} = ${viewerUserId}`,
        visibility: people.visibility,
        displayName: sql<string | null>`coalesce(${people.fullNameOverride}, ${peopleCanonical.preferredName}, ${peopleCanonical.fullName})`,
        currentTitle: sql<string | null>`CASE
          WHEN ${people.currentTitleOverride} IS NULL THEN ${peopleCanonical.currentTitle}
          ELSE nullif(${people.currentTitleOverride}, '')
        END`,
        currentCommunityId: people.currentCommunityId,
        source: people.source,
        lastInteractionAt: people.lastInteractionAt,
        contextFreshnessAt: people.contextFreshnessAt,
        createdAt: people.createdAt,
        bio: sql<string | null>`CASE
          WHEN ${people.bioOverride} IS NULL THEN ${peopleCanonical.bio}
          ELSE nullif(${people.bioOverride}, '')
        END`,
        avatarUrl: sql<string | null>`coalesce(${people.avatarUrlOverride}, ${peopleCanonical.avatarUrl})`,
        emails: sql<string[]>`coalesce(${people.emailsOverride}, ${peopleCanonical.emails}, ARRAY[]::text[])`,
      })
      .from(people)
      .leftJoin(peopleCanonical, eq(people.canonicalPersonId, peopleCanonical.id))
      .where(and(
        eq(people.organizationId, organizationId),
        or(
          eq(people.visibility, "organization"),
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
    organizationId: string,
    viewerUserId: string,
    opts: PageOpts & { query?: string },
  ): Promise<Page<CommunityRecord>> {
    if (!this.#hasRlsContext(organizationId, viewerUserId)) {
      return this.#withRlsContext(organizationId, viewerUserId, (store) =>
        store.listCommunities(organizationId, viewerUserId, opts),
      );
    }
    const limit = clamp(opts.limit, 1, 100);
    const offset = Math.max(0, opts.offset);
    const query = opts.query?.trim().slice(0, 120);
    const pattern = query
      ? `%${query.replace(/[!%_]/g, (value) => `!${value}`)}%`
      : null;
    const readable = and(
      eq(communities.organizationId, organizationId),
      or(
        eq(communities.visibility, "organization"),
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
            OR coalesce(
              CASE
                WHEN ${communities.kind} IS NULL THEN ${communitiesCanonical.kind}
                ELSE nullif(${communities.kind}, '')
              END,
              ''
            ) ILIKE ${pattern} ESCAPE '!'
          )`
        : undefined,
    );
    const memberCount = sql<number>`(
      SELECT count(*)::int
      FROM "community_members" AS "visible_community_member"
      JOIN "people" AS "visible_community_person"
        ON "visible_community_person"."id" = "visible_community_member"."person_id"
      WHERE "visible_community_person"."organization_id" = ${organizationId}
        AND "visible_community_member"."community_id" = ${communities.id}
        AND "visible_community_person"."archived_at" IS NULL
        AND (
          "visible_community_person"."visibility" = 'organization'
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
          organizationId: communities.organizationId,
          ownerUserId: communities.userId,
          isOwner: sql<boolean>`${communities.userId} = ${viewerUserId}`,
          visibility: communities.visibility,
          displayName: sql<string | null>`coalesce(${communities.nameOverride}, ${communitiesCanonical.name})`,
          description: sql<string | null>`CASE
            WHEN ${communities.descriptionOverride} IS NULL THEN ${communitiesCanonical.description}
            ELSE nullif(${communities.descriptionOverride}, '')
          END`,
          kind: sql<string | null>`CASE
            WHEN ${communities.kind} IS NULL THEN ${communitiesCanonical.kind}
            ELSE nullif(${communities.kind}, '')
          END`,
          location: sql<string | null>`CASE
            WHEN ${communities.locationOverride} IS NULL THEN nullif(concat_ws(', ', ${communitiesCanonical.headquartersCity}, ${communitiesCanonical.headquartersCountry}), '')
            ELSE nullif(${communities.locationOverride}, '')
          END`,
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
    organizationId: string,
    viewerUserId: string,
    id: string,
  ): Promise<CommunityDetail | null> {
    if (!this.#hasRlsContext(organizationId, viewerUserId)) {
      return this.#withRlsContext(organizationId, viewerUserId, (store) =>
        store.getCommunity(organizationId, viewerUserId, id),
      );
    }
    const rows = await this.#db
      .select({
        id: communities.id,
        organizationId: communities.organizationId,
        ownerUserId: communities.userId,
        isOwner: sql<boolean>`${communities.userId} = ${viewerUserId}`,
        visibility: communities.visibility,
        displayName: sql<string | null>`coalesce(${communities.nameOverride}, ${communitiesCanonical.name})`,
        description: sql<string | null>`CASE
          WHEN ${communities.descriptionOverride} IS NULL THEN ${communitiesCanonical.description}
          ELSE nullif(${communities.descriptionOverride}, '')
        END`,
        kind: sql<string | null>`CASE
          WHEN ${communities.kind} IS NULL THEN ${communitiesCanonical.kind}
          ELSE nullif(${communities.kind}, '')
        END`,
        location: sql<string | null>`CASE
          WHEN ${communities.locationOverride} IS NULL THEN nullif(concat_ws(', ', ${communitiesCanonical.headquartersCity}, ${communitiesCanonical.headquartersCountry}), '')
          ELSE nullif(${communities.locationOverride}, '')
        END`,
        source: communities.source,
        isUserConfirmed: communities.isUserConfirmed,
        memberCount: sql<number>`(
          SELECT count(*)::int
          FROM "community_members" AS "visible_community_member"
          JOIN "people" AS "visible_community_person"
            ON "visible_community_person"."id" = "visible_community_member"."person_id"
          WHERE "visible_community_person"."organization_id" = ${organizationId}
            AND "visible_community_member"."community_id" = ${communities.id}
            AND "visible_community_person"."archived_at" IS NULL
            AND (
              "visible_community_person"."visibility" = 'organization'
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
          eq(communities.organizationId, organizationId),
          eq(communities.id, id),
          or(
            eq(communities.visibility, "organization"),
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

  async listCommunityMembers(
    organizationId: string,
    viewerUserId: string,
    communityId: string,
    opts: PageOpts,
  ): Promise<Page<CommunityMemberRecord>> {
    if (!this.#hasRlsContext(organizationId, viewerUserId)) {
      return this.#withRlsContext(organizationId, viewerUserId, (store) =>
        store.listCommunityMembers(
          organizationId,
          viewerUserId,
          communityId,
          opts,
        ),
      );
    }
    if (!await this.getCommunity(organizationId, viewerUserId, communityId)) {
      return { items: [], total: 0 };
    }
    const limit = clamp(opts.limit, 1, 100);
    const offset = clamp(opts.offset, 0, 10_000);
    const readable = and(
      eq(communityMembers.communityId, communityId),
      eq(people.organizationId, organizationId),
      or(
        eq(people.visibility, "organization"),
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
          organizationId: people.organizationId,
          ownerUserId: people.userId,
          isOwner: sql<boolean>`${people.userId} = ${viewerUserId}`,
          visibility: people.visibility,
          displayName: sql<string | null>`coalesce(
            ${people.fullNameOverride},
            ${peopleCanonical.preferredName},
            ${peopleCanonical.fullName}
          )`,
          currentTitle: sql<string | null>`CASE
            WHEN ${people.currentTitleOverride} IS NULL THEN ${peopleCanonical.currentTitle}
            ELSE nullif(${people.currentTitleOverride}, '')
          END`,
          currentCommunityId: people.currentCommunityId,
          source: people.source,
          lastInteractionAt: people.lastInteractionAt,
          contextFreshnessAt: people.contextFreshnessAt,
          createdAt: people.createdAt,
          role: communityMembers.role,
          confidence: sql<number | null>`CASE
            WHEN ${communityMembers.confidence} IS NULL THEN NULL
            ELSE ${communityMembers.confidence}::double precision
          END`,
        })
        .from(communityMembers)
        .innerJoin(people, eq(communityMembers.personId, people.id))
        .leftJoin(
          peopleCanonical,
          eq(people.canonicalPersonId, peopleCanonical.id),
        )
        .where(readable)
        .orderBy(
          sql`lower(coalesce(
            ${people.fullNameOverride},
            ${peopleCanonical.preferredName},
            ${peopleCanonical.fullName},
            ''
          ))`,
          people.id,
        )
        .limit(limit)
        .offset(offset),
      this.#db
        .select({ value: count() })
        .from(communityMembers)
        .innerJoin(people, eq(communityMembers.personId, people.id))
        .where(readable),
    ]);
    return { items: rows, total: Number(totalRows[0]?.value ?? 0) };
  }

  async createPerson(input: CreatePersonInput): Promise<PersonDetail> {
    if (!this.#hasRlsContext(input.organizationId, input.ownerUserId)) {
      return this.#withRlsContext(input.organizationId, input.ownerUserId, (store) =>
        store.createPerson(input),
      );
    }
    const emails = normalizeEmails(input.emails);
    await this.#db
      .insert(people)
      .values({
        id: input.id,
        organizationId: input.organizationId,
        userId: input.ownerUserId,
        canonicalPersonId: null,
        visibility: input.visibility,
        fullNameOverride: input.displayName.trim(),
        currentTitleOverride: input.currentTitle?.trim() || null,
        bioOverride: input.bio?.trim() || null,
        locationOverride: input.location?.trim() || null,
        emailsOverride: emails,
        source: input.source.trim(),
      })
      .onConflictDoNothing();
    const person = await this.getPerson(input.organizationId, input.ownerUserId, input.id);
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
    if (!this.#hasRlsContext(input.organizationId, input.ownerUserId)) {
      return this.#withRlsContext(input.organizationId, input.ownerUserId, (store) =>
        store.updatePerson(input),
      );
    }
    const values: Partial<typeof people.$inferInsert> = {};
    if (input.displayName !== undefined) values.fullNameOverride = input.displayName.trim();
    if (input.currentTitle !== undefined) {
      values.currentTitleOverride = input.currentTitle?.trim() ?? "";
    }
    if (input.bio !== undefined) values.bioOverride = input.bio?.trim() ?? "";
    if (input.location !== undefined) values.locationOverride = input.location?.trim() ?? "";
    if (input.emails !== undefined) values.emailsOverride = normalizeEmails(input.emails);
    if (input.visibility !== undefined) values.visibility = input.visibility;
    if (Object.keys(values).length === 0) throw new Error("Person update requires at least one field");
    const locked = await this.#db
      .select({ id: people.id, archivedAt: people.archivedAt })
      .from(people)
      .where(and(
        eq(people.organizationId, input.organizationId),
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
        input.organizationId,
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
      return this.getPerson(input.organizationId, input.ownerUserId, input.id);
    }
    const rows = await this.#db
      .update(people)
      .set(values)
      .where(and(
        eq(people.organizationId, input.organizationId),
        eq(people.id, input.id),
        eq(people.userId, input.ownerUserId),
        isNull(people.archivedAt),
      ))
      .returning();
    if (!rows[0]) return null;
    const person = await this.getPerson(input.organizationId, input.ownerUserId, input.id);
    if (!person) throw new Error("Updated Person became unreadable");
    await this.#recordLifecycleEvent({
      ...input,
      recordType: "person",
      operation: "updated",
      displayName: person.displayName,
      visibility: person.visibility === "organization" ? "organization" : "private",
    });
    return person;
  }

  async archivePerson(input: ArchiveRelationshipRecordInput): Promise<boolean> {
    if (!this.#hasRlsContext(input.organizationId, input.ownerUserId)) {
      return this.#withRlsContext(input.organizationId, input.ownerUserId, (store) =>
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
        eq(people.organizationId, input.organizationId),
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
        input.organizationId,
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
      visibility: existing.visibility === "organization" ? "organization" : "private",
    });
    const rows = await this.#db
      .update(people)
      .set({ archivedAt: input.decisionAt })
      .where(and(
        eq(people.organizationId, input.organizationId),
        eq(people.id, input.id),
        eq(people.userId, input.ownerUserId),
        isNull(people.archivedAt),
      ))
      .returning();
    return rows.length === 1;
  }

  async createCommunity(input: CreateCommunityInput): Promise<CommunityDetail> {
    if (!this.#hasRlsContext(input.organizationId, input.ownerUserId)) {
      return this.#withRlsContext(input.organizationId, input.ownerUserId, (store) =>
        store.createCommunity(input),
      );
    }
    await this.#db
      .insert(communities)
      .values({
        id: input.id,
        organizationId: input.organizationId,
        userId: input.ownerUserId,
        canonicalCommunityId: null,
        visibility: input.visibility,
        nameOverride: input.displayName.trim(),
        descriptionOverride: input.description?.trim() || null,
        locationOverride: input.location?.trim() || null,
        kind: input.kind?.trim() || null,
        source: input.source.trim(),
        isUserConfirmed: true,
      })
      .onConflictDoNothing();
    const community = await this.getCommunity(input.organizationId, input.ownerUserId, input.id);
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
    if (!this.#hasRlsContext(input.organizationId, input.ownerUserId)) {
      return this.#withRlsContext(input.organizationId, input.ownerUserId, (store) =>
        store.updateCommunity(input),
      );
    }
    const values: Partial<typeof communities.$inferInsert> = {};
    if (input.displayName !== undefined) values.nameOverride = input.displayName.trim();
    if (input.description !== undefined) {
      values.descriptionOverride = input.description?.trim() ?? "";
    }
    if (input.location !== undefined) values.locationOverride = input.location?.trim() ?? "";
    if (input.kind !== undefined) values.kind = input.kind?.trim() ?? "";
    if (input.visibility !== undefined) values.visibility = input.visibility;
    if (Object.keys(values).length === 0) throw new Error("Community update requires at least one field");
    const locked = await this.#db
      .select({ id: communities.id, archivedAt: communities.archivedAt })
      .from(communities)
      .where(and(
        eq(communities.organizationId, input.organizationId),
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
        input.organizationId,
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
      return this.getCommunity(input.organizationId, input.ownerUserId, input.id);
    }
    const rows = await this.#db
      .update(communities)
      .set(values)
      .where(and(
        eq(communities.organizationId, input.organizationId),
        eq(communities.id, input.id),
        eq(communities.userId, input.ownerUserId),
        isNull(communities.archivedAt),
      ))
      .returning();
    if (!rows[0]) return null;
    const community = await this.getCommunity(input.organizationId, input.ownerUserId, input.id);
    if (!community) throw new Error("Updated Community became unreadable");
    await this.#recordLifecycleEvent({
      ...input,
      recordType: "community",
      operation: "updated",
      displayName: community.displayName,
      visibility: community.visibility === "organization" ? "organization" : "private",
    });
    return community;
  }

  async archiveCommunity(input: ArchiveRelationshipRecordInput): Promise<boolean> {
    if (!this.#hasRlsContext(input.organizationId, input.ownerUserId)) {
      return this.#withRlsContext(input.organizationId, input.ownerUserId, (store) =>
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
        eq(communities.organizationId, input.organizationId),
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
        input.organizationId,
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
      visibility: existing.visibility === "organization" ? "organization" : "private",
    });
    const rows = await this.#db
      .update(communities)
      .set({ archivedAt: input.decisionAt })
      .where(and(
        eq(communities.organizationId, input.organizationId),
        eq(communities.id, input.id),
        eq(communities.userId, input.ownerUserId),
        isNull(communities.archivedAt),
      ))
      .returning();
    return rows.length === 1;
  }

  async #recordLifecycleEvent(input: DecisionProvenance & {
    organizationId: string;
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
        organizationId: input.organizationId,
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
    organizationId: string;
    ownerUserId: string;
    recordType: "person" | "community";
    operation: "update" | "archive";
    reason: "record_archived" | "superseded_by_newer_decision";
  }): Promise<void> {
    await this.#db
      .insert(events)
      .values({
        id: input.decisionLedgerId,
        organizationId: input.organizationId,
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
    const receipt = await this.getEvent(input.organizationId, input.decisionLedgerId);
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
    organizationId: string,
    ownerUserId: string,
    recordType: "person" | "community",
    recordId: string,
    decisionSequence: number,
  ): Promise<boolean> {
    const rows = await this.#db
      .select({ id: events.id })
      .from(events)
      .where(and(
        eq(events.organizationId, organizationId),
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
          WHERE "record_decision_participant"."organization_id" = ${organizationId}
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
    if (!this.#hasRlsContext(input.organizationId, input.ownerUserId)) {
      return this.#withRlsContext(input.organizationId, input.ownerUserId, (store) =>
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
      !UUID_PATTERN.test(input.organizationId) ||
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
        ? await this.getPerson(input.organizationId, input.ownerUserId, participant.recordId)
        : await this.getCommunity(input.organizationId, input.ownerUserId, participant.recordId);
      if (!record) throw new Error("Interaction participant is not readable");
      if (record.visibility !== "organization") visibility = "private";
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
    const storedPayload = visibility === "private"
      ? {
          kind: payload.kind,
          occurredAt: payload.occurredAt,
          ownerUserId: payload.ownerUserId,
          visibility: payload.visibility,
          decisionLedgerId: payload.decisionLedgerId,
          decisionSequence: payload.decisionSequence,
          decisionAt: payload.decisionAt,
          privatePayloadStoredInRelations: true,
          ...(options.recordMutationLifecycle
            ? { recordMutationLifecycle: true }
            : {}),
        }
      : payload;
    await this.#db
      .insert(events)
      .values({
        id: input.id,
        organizationId: input.organizationId,
        type: `relationship.${input.kind.trim()}`,
        entityType: "interaction",
        entityId: input.id,
        payload: storedPayload,
      })
      .onConflictDoNothing();
    const event = await this.getEvent(input.organizationId, input.id);
    const existingPayload = payloadRecord(event?.payload);
    if (
      !event ||
      event.entityType !== "interaction" ||
      payloadString(existingPayload, "ownerUserId") !== input.ownerUserId ||
      payloadString(existingPayload, "decisionLedgerId") !== input.decisionLedgerId
    ) {
      throw new Error(
        `Interaction ${input.id} conflicts with a different Event receipt`,
      );
    }
    const relations: RelationRecord[] = [];
    for (const participant of participants.values()) {
      const relation = await this.upsertRelation({
        organizationId: input.organizationId,
        ownerUserId: input.ownerUserId,
        srcType: "event",
        srcId: input.id,
        dstType: participant.recordType,
        dstId: participant.recordId,
        relationType: "participant",
        properties: {
          role: participant.role?.trim() || null,
          attendanceState: participant.attendanceState?.trim() || null,
          ...(visibility === "private"
            ? { privateEventPayload: payload }
            : {}),
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
            eq(people.organizationId, input.organizationId),
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
    if (!this.#hasRlsContext(input.organizationId, input.ownerUserId)) {
      return this.#withRlsContext(input.organizationId, input.ownerUserId, (store) =>
        store.materializeCommitment(input),
      );
    }
    const occurredAt = input.decisionAt;
    await this.#createInteractionInContext({
      id: input.transitionEventId,
      organizationId: input.organizationId,
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
        result: "commitment",
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
      organizationId: input.organizationId,
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
        sourceEventId: input.sourceEventId ?? null,
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
    organizationId: string,
    viewerUserId: string,
    personId: string,
    opts: PageOpts & {
      includeArchived?: boolean;
      commitmentId?: string;
      status?: CommitmentStatus;
      snapshotAt?: Date;
    },
  ): Promise<CommitmentPage> {
    if (!this.#hasRlsContext(organizationId, viewerUserId)) {
      return this.#withRlsContext(organizationId, viewerUserId, (store) =>
        store.listCommitments(organizationId, viewerUserId, personId, opts),
      );
    }
    const person = await this.getPerson(organizationId, viewerUserId, personId);
    if (!person) return { items: [], total: 0 };
    const limit = clamp(opts.limit, 1, 100);
    const offset = clamp(opts.offset, 0, 10_000);
    const result = await this.#db.execute(sql`
      WITH latest AS (
        SELECT DISTINCT ON (
          coalesce(
            commitment.properties ->> 'commitmentId',
            transition.payload #>> '{metadata,commitmentId}'
          )
        )
          coalesce(
            commitment.properties ->> 'commitmentId',
            transition.payload #>> '{metadata,commitmentId}'
          ) AS commitment_id,
          commitment.dst_id::text AS person_id,
          coalesce(
            commitment.properties ->> 'text',
            transition.payload #>> '{metadata,text}'
          ) AS text,
          coalesce(
            commitment.properties ->> 'dueAt',
            transition.payload #>> '{metadata,dueAt}'
          ) AS due_at,
          coalesce(
            commitment.properties ->> 'status',
            transition.payload #>> '{metadata,status}'
          ) AS status,
          coalesce(
            commitment.properties ->> 'sourceEventId',
            transition.payload #>> '{metadata,sourceEventId}'
          ) AS source_event_id,
          transition.id::text AS transition_event_id,
          (transition.payload ->> 'occurredAt')::timestamptz AS occurred_at,
          transition.created_at AS created_at,
          transition.payload ->> 'decisionLedgerId' AS decision_ledger_id,
          (transition.payload ->> 'decisionSequence')::bigint AS decision_sequence,
          commitment.id::text AS relation_id,
          commitment.evidence_refs AS evidence_refs
        FROM ${events} AS transition
        INNER JOIN ${edges} AS commitment
          ON commitment.organization_id = transition.organization_id
          AND commitment.src_type = 'event'
          AND commitment.src_id = transition.id
          AND commitment.dst_type = 'person'
          AND commitment.dst_id = ${personId}::uuid
          AND commitment.edge_type = 'commitment'
          AND commitment.owner_user_id = ${viewerUserId}::uuid
        WHERE transition.organization_id = ${organizationId}::uuid
          AND transition.entity_type = 'interaction'
          ${opts.snapshotAt
            ? sql`AND transition.created_at <= ${opts.snapshotAt}`
            : sql``}
          AND coalesce(
            commitment.properties ->> 'commitmentId',
            transition.payload #>> '{metadata,commitmentId}'
          ) IS NOT NULL
          AND transition.payload ->> 'ownerUserId' = ${viewerUserId}
          ${opts.commitmentId
            ? sql`AND coalesce(
                commitment.properties ->> 'commitmentId',
                transition.payload #>> '{metadata,commitmentId}'
              ) = ${opts.commitmentId}`
            : sql``}
        ORDER BY
          coalesce(
            commitment.properties ->> 'commitmentId',
            transition.payload #>> '{metadata,commitmentId}'
          ),
          (transition.payload ->> 'decisionSequence')::bigint DESC,
          (transition.payload ->> 'occurredAt')::timestamptz DESC,
          transition.id DESC
      ),
      visible AS (
        SELECT *
        FROM latest
        WHERE commitment_id IS NOT NULL
          ${opts.includeArchived ? sql`` : sql`AND status <> 'archived'`}
          ${opts.status ? sql`AND status = ${opts.status}` : sql``}
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
    if (!this.#hasRlsContext(input.organizationId, input.ownerUserId)) {
      return this.#withRlsContext(input.organizationId, input.ownerUserId, (store) =>
        store.materializeIntroduction(input),
      );
    }
    if (input.sourcePersonId === input.targetPersonId) {
      throw new Error("An Introduction requires two different People");
    }
    await this.#db.execute(
      sql`SELECT pg_advisory_xact_lock(
        hashtextextended(
          ${`${input.organizationId}:${input.ownerUserId}:${input.introductionId}`},
          0::bigint
        )
      )`,
    );
    const currentPage = await this.listIntroductions(
      input.organizationId,
      input.ownerUserId,
      input.sourcePersonId,
      {
        limit: 1,
        offset: 0,
        introductionId: input.introductionId,
      },
    );
    const current = currentPage.items[0] ?? null;
    const declineReason = input.privateDeclineReason?.trim() ?? "";
    const declineReasonRecorded = declineReason.length > 0;
    const sameSnapshot =
      current?.sourcePersonId === input.sourcePersonId &&
      current.targetPersonId === input.targetPersonId &&
      current.initiatorConsent === input.initiatorConsent &&
      current.recipientConsent === input.recipientConsent &&
      current.status === input.status &&
      current.declineReasonRecorded === declineReasonRecorded;
    if (current) {
      if (current.provenance.decisionSequence > input.decisionSequence) {
        return current;
      }
      if (current.provenance.decisionSequence === input.decisionSequence) {
        if (
          current.provenance.decisionLedgerId !== input.decisionLedgerId ||
          !sameSnapshot
        ) {
          throw new Error(
            "Introduction decision sequence conflicts with another transition",
          );
        }
        if (
          declineReason &&
          current.transitionEventId === input.transitionEventId
        ) {
          const [existingReason] = await this.#db
            .select({ properties: edges.properties })
            .from(edges)
            .where(and(
              eq(edges.organizationId, input.organizationId),
              eq(edges.ownerUserId, input.ownerUserId),
              eq(edges.srcType, "event"),
              eq(edges.srcId, input.transitionEventId),
              eq(edges.dstType, "person"),
              eq(edges.dstId, input.sourcePersonId),
              eq(edges.edgeType, "introduction"),
              eq(edges.visibility, "private"),
            ))
            .limit(1);
          if (
            !existingReason ||
            payloadString(
              payloadRecord(existingReason.properties),
              "privateDeclineReason",
            ) !== declineReason
          ) {
            throw new Error(
              "Introduction private decline reason conflicts with its transition",
            );
          }
        }
        return current;
      }
      if (sameSnapshot) return current;
      if (
        current.sourcePersonId !== input.sourcePersonId ||
        current.targetPersonId !== input.targetPersonId
      ) {
        throw new Error("Introduction transition cannot retarget People");
      }
    }
    const terminal =
      current?.status === "declined" ||
      current?.status === "cancelled" ||
      current?.status === "introduced";
    if (input.operation === "create") {
      if (
        current ||
        !input.initiatorConsent ||
        input.recipientConsent ||
        input.status !== "awaiting_consents" ||
        declineReasonRecorded
      ) {
        throw new Error(
          "Introduction creation requires only the initiator's explicit consent",
        );
      }
    } else {
      if (!current || terminal) {
        throw new Error("Introduction is not in an actionable state");
      }
      if (input.operation === "consent") {
        if (
          (current.initiatorConsent && !input.initiatorConsent) ||
          (current.recipientConsent && !input.recipientConsent)
        ) {
          throw new Error("Introduction consent cannot be revoked");
        }
        const expectedStatus = declineReasonRecorded
          ? "declined"
          : input.initiatorConsent && input.recipientConsent
            ? "ready"
            : "awaiting_consents";
        if (input.status !== expectedStatus) {
          throw new Error("Introduction consent state is inconsistent");
        }
      } else if (
        input.operation === "complete"
          ? current.status !== "ready" || input.status !== "introduced"
          : input.status !== "cancelled"
      ) {
        throw new Error("Introduction transition is invalid");
      }
    }
    const statusLabel = input.status.replace(/_/g, " ");
    await this.#createInteractionInContext({
      id: input.transitionEventId,
      organizationId: input.organizationId,
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
        result: "introduction",
        introductionId: input.introductionId,
        sourcePersonId: input.sourcePersonId,
        targetPersonId: input.targetPersonId,
        initiatorConsent: input.initiatorConsent,
        recipientConsent: input.recipientConsent,
        status: input.status,
        declineReasonRecorded,
      },
      decisionLedgerId: input.decisionLedgerId,
      decisionSequence: input.decisionSequence,
      decisionAt: input.decisionAt,
    });
    const relations = await Promise.all(
      [input.sourcePersonId, input.targetPersonId].map((personId) =>
        this.upsertRelation({
          organizationId: input.organizationId,
          ownerUserId: input.ownerUserId,
          srcType: "event",
          srcId: input.transitionEventId,
          dstType: "person",
          dstId: personId,
          relationType: "introduction",
          properties: {
            introductionId: input.introductionId,
            sourcePersonId: input.sourcePersonId,
            targetPersonId: input.targetPersonId,
            initiatorConsent: input.initiatorConsent,
            recipientConsent: input.recipientConsent,
            status: input.status,
            declineReasonRecorded,
            ...(personId === input.sourcePersonId && declineReason
              ? { privateDeclineReason: declineReason }
              : {}),
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
      declineReasonRecorded,
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
    organizationId: string,
    viewerUserId: string,
    personId: string,
    opts: PageOpts & { introductionId?: string; snapshotAt?: Date },
  ): Promise<IntroductionPage> {
    if (!this.#hasRlsContext(organizationId, viewerUserId)) {
      return this.#withRlsContext(organizationId, viewerUserId, (store) =>
        store.listIntroductions(organizationId, viewerUserId, personId, opts),
      );
    }
    const person = await this.getPerson(organizationId, viewerUserId, personId);
    if (!person) return { items: [], total: 0 };
    const limit = clamp(opts.limit, 1, 100);
    const offset = clamp(opts.offset, 0, 10_000);
    const result = await this.#db.execute(sql`
      WITH latest AS (
        SELECT DISTINCT ON (
          coalesce(
            anchor.properties ->> 'introductionId',
            transition.payload #>> '{metadata,introductionId}'
          )
        )
          coalesce(
            anchor.properties ->> 'introductionId',
            transition.payload #>> '{metadata,introductionId}'
          ) AS introduction_id,
          coalesce(
            anchor.properties ->> 'sourcePersonId',
            transition.payload #>> '{metadata,sourcePersonId}'
          ) AS source_person_id,
          coalesce(
            anchor.properties ->> 'targetPersonId',
            transition.payload #>> '{metadata,targetPersonId}'
          ) AS target_person_id,
          coalesce(
            (anchor.properties ->> 'initiatorConsent')::boolean,
            (transition.payload #>> '{metadata,initiatorConsent}')::boolean
          ) AS initiator_consent,
          coalesce(
            (anchor.properties ->> 'recipientConsent')::boolean,
            (transition.payload #>> '{metadata,recipientConsent}')::boolean
          ) AS recipient_consent,
          coalesce(
            anchor.properties ->> 'status',
            transition.payload #>> '{metadata,status}'
          ) AS status,
          (
            coalesce(
              (anchor.properties ->> 'declineReasonRecorded')::boolean,
              (transition.payload #>> '{metadata,declineReasonRecorded}')::boolean,
              false
            )
            OR coalesce(transition.payload #>> '{metadata,declineReason}', '') <> ''
          ) AS decline_reason_recorded,
          transition.id::text AS transition_event_id,
          (transition.payload ->> 'occurredAt')::timestamptz AS occurred_at,
          transition.created_at AS created_at,
          transition.payload ->> 'decisionLedgerId' AS decision_ledger_id,
          (transition.payload ->> 'decisionSequence')::bigint AS decision_sequence,
          ARRAY(
            SELECT related.id::text
            FROM ${edges} AS related
            WHERE related.organization_id = transition.organization_id
              AND related.src_type = 'event'
              AND related.src_id = transition.id
              AND related.edge_type = 'introduction'
              AND related.owner_user_id = ${viewerUserId}::uuid
            ORDER BY related.id
          ) AS relation_ids,
          anchor.evidence_refs AS evidence_refs
        FROM ${events} AS transition
        INNER JOIN ${edges} AS anchor
          ON anchor.organization_id = transition.organization_id
          AND anchor.src_type = 'event'
          AND anchor.src_id = transition.id
          AND anchor.dst_type = 'person'
          AND anchor.dst_id = ${personId}::uuid
          AND anchor.edge_type = 'introduction'
          AND anchor.owner_user_id = ${viewerUserId}::uuid
        WHERE transition.organization_id = ${organizationId}::uuid
          AND transition.entity_type = 'interaction'
          ${opts.snapshotAt
            ? sql`AND transition.created_at <= ${opts.snapshotAt}`
            : sql``}
          AND coalesce(
            anchor.properties ->> 'introductionId',
            transition.payload #>> '{metadata,introductionId}'
          ) IS NOT NULL
          AND transition.payload ->> 'ownerUserId' = ${viewerUserId}
          ${opts.introductionId
            ? sql`AND coalesce(
                anchor.properties ->> 'introductionId',
                transition.payload #>> '{metadata,introductionId}'
              ) = ${opts.introductionId}`
            : sql``}
        ORDER BY
          coalesce(
            anchor.properties ->> 'introductionId',
            transition.payload #>> '{metadata,introductionId}'
          ),
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
    organizationId: string,
    viewerUserId: string,
    recordType: "person" | "community",
    recordId: string,
    opts: { limit: number; cursor?: TimelineCursor | null },
  ): Promise<TimelinePage> {
    if (!this.#hasRlsContext(organizationId, viewerUserId)) {
      return this.#withRlsContext(organizationId, viewerUserId, (store) =>
        store.listTimeline(organizationId, viewerUserId, recordType, recordId, opts),
      );
    }
    const anchor = recordType === "person"
      ? await this.getPerson(organizationId, viewerUserId, recordId)
      : await this.getCommunity(organizationId, viewerUserId, recordId);
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
        eq(events.organizationId, organizationId),
        eq(events.entityType, "interaction"),
        sql<boolean>`(
          ${events.payload} ->> 'ownerUserId' = ${viewerUserId}
          OR ${events.payload} ->> 'visibility' = 'organization'
        )`,
        sql<boolean>`EXISTS (
          SELECT 1
          FROM "edges" AS "timeline_anchor_relation"
          WHERE "timeline_anchor_relation"."organization_id" = ${organizationId}
            AND "timeline_anchor_relation"."edge_type" = 'participant'
            AND (
              "timeline_anchor_relation"."owner_user_id" = ${viewerUserId}
              OR "timeline_anchor_relation"."visibility" IN ('organization', 'public')
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
        eq(edges.organizationId, organizationId),
        eq(edges.edgeType, "participant"),
        or(
          and(eq(edges.srcType, "event"), inArray(edges.srcId, eventIds)),
          and(eq(edges.dstType, "event"), inArray(edges.dstId, eventIds)),
        ),
        or(
          eq(edges.ownerUserId, viewerUserId),
          inArray(edges.visibility, ["organization", "public"]),
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
    const nodeMap = await this.#loadAccessibleNodes(organizationId, viewerUserId, nodeRefs);
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
    const payload = eventPayloadForProjection(event.payload, relations);
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
      : relations.some((relation) => relation.visibility === "organization")
        ? "organization"
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

  async getEvent(organizationId: string, id: string): Promise<typeof events.$inferSelect | null> {
    const rows = await this.#db
      .select()
      .from(events)
      .where(and(eq(events.organizationId, organizationId), eq(events.id, id)))
      .limit(1);
    return rows[0] ?? null;
  }

  async indexModuleFile(input: IndexModuleFileInput): Promise<typeof files.$inferSelect> {
    if (!this.#hasRlsContext(input.organizationId, input.ownerUserId)) {
      return this.#withRlsContext(input.organizationId, input.ownerUserId, (store) =>
        store.indexModuleFile(input),
      );
    }
    if (
      !UUID_PATTERN.test(input.organizationId) ||
      !UUID_PATTERN.test(input.ownerUserId) ||
      !input.moduleId.trim() ||
      !input.path.trim() ||
      !Number.isSafeInteger(input.size) ||
      input.size < 0 ||
      Number.isNaN(Date.parse(input.modifiedAt))
    ) {
      throw new Error("Canonical Module File metadata is invalid");
    }
    const moduleRefId = UUID_PATTERN.test(input.moduleId)
      ? input.moduleId.toLowerCase()
      : stableReferenceUuid(
          `${input.organizationId}:${input.moduleId}:${input.moduleName}`,
        );
    const storageRef = `module://${input.moduleId}/${input.path}`;
    const metadata = {
      moduleId: input.moduleId,
      moduleName: input.moduleName,
      path: input.path,
      size: input.size,
      modifiedAt: input.modifiedAt,
    };
    await this.#db
      .insert(files)
      .values({
        id: randomUUID(),
        organizationId: input.organizationId,
        source: input.moduleName,
        storageRef,
        metadata,
      })
      .onConflictDoUpdate({
        target: [files.organizationId, files.storageRef],
        targetWhere: sql`${files.storageRef} IS NOT NULL AND ${files.archivedAt} IS NULL`,
        set: {
          source: input.moduleName,
          metadata,
        },
      });
    const rows = await this.#db
      .select()
      .from(files)
      .where(and(
        eq(files.organizationId, input.organizationId),
        eq(files.storageRef, storageRef),
        isNull(files.archivedAt),
      ))
      .limit(1);
    const file = rows[0];
    if (!file) throw new Error("Canonical Module File index write returned no row");
    await this.#db
      .insert(fileRefs)
      .values({
        fileId: file.id,
        entityType: "module",
        entityId: moduleRefId,
      })
      .onConflictDoNothing();
    return file;
  }

  async getSignalDetail(organizationId: string, viewerUserId: string, id: string): Promise<SignalDetail | null> {
    if (!this.#hasRlsContext(organizationId, viewerUserId)) {
      return this.#withRlsContext(organizationId, viewerUserId, (store) =>
        store.getSignalDetail(organizationId, viewerUserId, id),
      );
    }
    const anchor = await this.getSignalEvidenceAnchor(organizationId, viewerUserId, id);
    if (!anchor) return null;
    const { signal, sourceEvent } = anchor;

    const signalRelations: RelationRecord[] = [];
    const eventRelations = sourceEvent
      ? await this.#db
          .select()
          .from(edges)
          .where(
            and(
              eq(edges.organizationId, organizationId),
              eq(edges.edgeType, "participant"),
              or(
                eq(edges.ownerUserId, viewerUserId),
                inArray(edges.visibility, ["organization", "public"]),
              ),
              or(
                and(
                  eq(edges.srcType, "event"),
                  eq(edges.srcId, sourceEvent.id),
                  inArray(edges.dstType, ["person", "community"]),
                  this.#accessibleNodeCondition(
                    edges.dstType,
                    edges.dstId,
                    organizationId,
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
                    organizationId,
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
      organizationId,
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

  /** Records the user's reaction without performing the governed Action. */
  async recordSignalAction(input: { organizationId: string; signalId: string; userId: string; verb: "act" | "dismiss" | "save" }): Promise<void> {
    if (!this.#hasRlsContext(input.organizationId, input.userId)) {
      return this.#withRlsContext(input.organizationId, input.userId, (store) =>
        store.recordSignalAction(input),
      );
    }
    await this.#db.insert(events).values({
      id: randomUUID(),
      organizationId: input.organizationId,
      type: "relationship.signal.action",
      entityType: "event",
      entityId: input.signalId,
      payload: {
        kind: "relationship_signal_action",
        signalEventId: input.signalId,
        userId: input.userId,
        verb: input.verb,
      },
    });
  }
}
