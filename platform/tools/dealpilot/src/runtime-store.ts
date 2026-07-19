import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { matchCompany } from "@bridge/company-sourcing";
import type { DedupeCandidate } from "@bridge/dedupe";
import type { QuarantinedCapture } from "@bridge/capability-kit";
import type {
  GmailContinuation,
  GmailFetchReceipt,
  GmailFetchState,
  GmailFetchStateStore,
} from "./connectors.js";
import type {
  CredentialAuditEvent,
  CredentialAuditSink,
  SourceCredentialVault,
} from "./credentials.js";
import {
  DealPilotStoreError,
  dealPilotModuleManifest,
  type CreateDealInput,
  type CreateRelationInput,
  type CreateSourceInput,
  type CreateThesisInput,
  type DealPilotBindings,
  type DealPilotPage,
  type DealPilotPageId,
  type DealPilotRecord,
  type DealPilotRecordDetail,
  type DealPilotRecordKind,
  type DealPilotRelation,
  type DealPilotStore,
  type DealRecord,
  type RelationKind,
  type SourceRecord,
  type ThesisRecord,
} from "./domain.js";

const STATE_NAMESPACE = "dealpilot.runtime.v1";
const STATE_VERSION = 1;
const MAX_GMAIL_SEEN_IDS = 10_000;

export interface DealPilotStatePort {
  read(organizationId: string, namespace: string): Promise<unknown | null>;
  update<T>(
    organizationId: string,
    namespace: string,
    initialState: unknown,
    reduce: (current: unknown) => { state: unknown; result: T },
  ): Promise<T>;
}

interface StoredCapture {
  capture: QuarantinedCapture;
  sourceId: string;
  committedAt?: string;
}

export interface DiscoverySettlement {
  status: "settled" | "budget_exceeded";
  captureIds: string[];
  droppedForBudget: number;
  source: SourceRecord;
}

interface StoredDiscoverySettlement {
  sourceId: string;
  receipt: GmailFetchReceipt;
  actualSpend: number;
  droppedForBudget: number;
  captures: QuarantinedCapture[];
  result: DiscoverySettlement;
}

export type PendingCredentialOperation =
  | {
      kind: "create";
      organizationId: string;
      sourceId: string;
      ownerId: string;
      reference: string;
      source: CreateSourceInput & {
        id: string;
        credentialOwnerId: string;
        credentialRef: string;
      };
      preparedAt: string;
    }
  | {
      kind: "revoke";
      organizationId: string;
      sourceId: string;
      ownerId: string;
      reference: string;
      audit: CredentialAuditEvent;
      preparedAt: string;
    };

interface DealPilotOrganizationState {
  version: 1;
  deals: Record<string, DealRecord>;
  sources: Record<string, SourceRecord>;
  theses: Record<string, ThesisRecord>;
  relations: Record<string, DealPilotRelation>;
  captures: Record<string, StoredCapture>;
  captureByExternalKey: Record<string, string>;
  candidateProfiles: Record<string, Record<string, unknown>>;
  gmail: Record<string, GmailFetchState>;
  settlements: Record<string, StoredDiscoverySettlement>;
  settlementOrder: string[];
  credentialAudit: CredentialAuditEvent[];
  credentialOperations: Record<string, PendingCredentialOperation>;
}

export interface DealPilotCaptureProjection extends QuarantinedCapture {
  sourceId: string;
}

export interface DealPilotCapturePage {
  items: DealPilotCaptureProjection[];
  total: number;
  hasMore: boolean;
}

export interface SettleDiscoveryBatchInput {
  organizationId: string;
  sourceId: string;
  receipt: GmailFetchReceipt;
  captures: QuarantinedCapture[];
  actualSpend: number;
  droppedForBudget: number;
  completedAt: string;
}

export interface CommitCaptureResult {
  committed: boolean;
  alreadyCommitted: boolean;
  recordId?: string;
}

export interface DealPilotRuntimeStore
  extends DealPilotStore,
    GmailFetchStateStore,
    CredentialAuditSink {
  settleDiscoveryBatch(input: SettleDiscoveryBatchInput): Promise<DiscoverySettlement>;
  quarantineCapture(
    organizationId: string,
    sourceId: string,
    capture: QuarantinedCapture,
  ): Promise<string>;
  listPendingCaptures(
    organizationId: string,
    opts?: { sourceId?: string; limit?: number; offset?: number },
  ): Promise<DealPilotCapturePage>;
  captureStatus(
    organizationId: string,
    captureId: string,
  ): Promise<"pending" | "committed" | null>;
  getCapture(organizationId: string, captureId: string): Promise<QuarantinedCapture | null>;
  commitCapture(organizationId: string, captureId: string): Promise<CommitCaptureResult>;
  candidateProfile(organizationId: string, dealId: string): Promise<Record<string, unknown>>;
  credentialAuditEvents(organizationId: string): Promise<CredentialAuditEvent[]>;
  prepareCredentialCreate(
    input: CreateSourceInput & {
      id: string;
      credentialOwnerId: string;
      credentialRef: string;
    },
  ): Promise<PendingCredentialOperation & { kind: "create" }>;
  completeCredentialCreate(
    organizationId: string,
    sourceId: string,
    reference: string,
  ): Promise<SourceRecord>;
  discardCredentialCreate(
    organizationId: string,
    sourceId: string,
    reference: string,
  ): Promise<void>;
  prepareCredentialRevocation(
    organizationId: string,
    sourceId: string,
    ownerId: string,
    reference: string,
    audit: CredentialAuditEvent,
  ): Promise<PendingCredentialOperation & { kind: "revoke" }>;
  completeCredentialRevocation(
    organizationId: string,
    sourceId: string,
    ownerId: string,
    reference: string,
  ): Promise<{ source: SourceRecord; cleared: boolean }>;
  pendingCredentialOperations(
    organizationId: string,
  ): Promise<PendingCredentialOperation[]>;
  recordCredentialRevocation(
    organizationId: string,
    sourceId: string,
    ownerId: string,
    reference: string,
    audit: CredentialAuditEvent,
  ): Promise<{ source: SourceRecord; cleared: boolean }>;
}

function emptyState(): DealPilotOrganizationState {
  return {
    version: STATE_VERSION,
    deals: {},
    sources: {},
    theses: {},
    relations: {},
    captures: {},
    captureByExternalKey: {},
    candidateProfiles: {},
    gmail: {},
    settlements: {},
    settlementOrder: [],
    credentialAudit: [],
    credentialOperations: {},
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseState(value: unknown): DealPilotOrganizationState {
  if (
    !isObject(value) ||
    value.version !== STATE_VERSION ||
    !isObject(value.deals) ||
    !isObject(value.sources) ||
    !isObject(value.theses) ||
    !isObject(value.relations) ||
    !isObject(value.captures) ||
    !isObject(value.captureByExternalKey) ||
    !isObject(value.candidateProfiles) ||
    !isObject(value.gmail) ||
    !isObject(value.settlements) ||
    !Array.isArray(value.settlementOrder) ||
    !Array.isArray(value.credentialAudit) ||
    (value.credentialOperations !== undefined &&
      !isObject(value.credentialOperations))
  ) {
    throw new DealPilotStoreError("conflict", "DealPilot Local Plane state is invalid or unsupported");
  }
  return {
    ...(value as unknown as Omit<
      DealPilotOrganizationState,
      "credentialOperations"
    >),
    credentialOperations:
      (value.credentialOperations as
        | Record<string, PendingCredentialOperation>
        | undefined) ?? {},
  };
}

function cloneRecord(record: DealPilotRecord): DealPilotRecord {
  return record.kind === "thesis"
    ? { ...record, criteria: [...record.criteria], exclusions: [...record.exclusions] }
    : { ...record };
}

function cloneRelation(relation: DealPilotRelation): DealPilotRelation {
  return { ...relation, evidenceRefs: [...relation.evidenceRefs] };
}

function relationKinds(kind: RelationKind): [DealPilotRecordKind, DealPilotRecordKind] {
  if (kind === "deal_source") return ["deal", "source"];
  if (kind === "deal_thesis") return ["deal", "thesis"];
  return ["source", "thesis"];
}

function recordMap(
  state: DealPilotOrganizationState,
  kind: DealPilotRecordKind,
): Record<string, DealPilotRecord> {
  if (kind === "deal") return state.deals;
  if (kind === "source") return state.sources;
  return state.theses;
}

function pageKind(page: DealPilotPageId): DealPilotRecordKind {
  return page === "deals" ? "deal" : page === "sources" ? "source" : "thesis";
}

function relationKey(input: Pick<CreateRelationInput, "kind" | "fromId" | "toId">): string {
  return JSON.stringify([input.kind, input.fromId, input.toId]);
}

function captureExternalKey(sourceId: string, sourceRecordId: string): string {
  return JSON.stringify([sourceId, sourceRecordId]);
}

function gmailState(): GmailFetchState {
  return { seenMessageIds: [], lastFetchComplete: false };
}

function sameReceipt(
  pending: NonNullable<GmailFetchState["pending"]>,
  receipt: GmailFetchReceipt,
): boolean {
  return (
    pending.batchId === receipt.batchId &&
    pending.ownerId === receipt.ownerId &&
    pending.complete === receipt.complete &&
    pending.checkpointAt === receipt.checkpointAt
  );
}

export class LocalDealPilotStore implements DealPilotRuntimeStore {
  readonly #state: DealPilotStatePort;
  readonly #now: () => string;
  readonly #id: () => string;

  constructor(
    state: DealPilotStatePort,
    options: {
      now?: () => string;
      id?: () => string;
    } = {},
  ) {
    this.#state = state;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#id = options.id ?? randomUUID;
  }

  async createDeal(input: CreateDealInput): Promise<DealRecord> {
    return this.#update(input.organizationId, (state) => {
      const id = input.id ?? this.#id();
      if (state.deals[id]) {
        throw new DealPilotStoreError("conflict", `Deal "${id}" already exists`);
      }
      const now = this.#now();
      const record: DealRecord = {
        id,
        organizationId: input.organizationId,
        kind: "deal",
        company: input.company,
        stage: input.stage ?? "sourced",
        ...(input.revenue != null ? { revenue: input.revenue } : {}),
        ...(input.ebitda != null ? { ebitda: input.ebitda } : {}),
        ...(input.sde != null ? { sde: input.sde } : {}),
        ...(input.askingPrice != null ? { askingPrice: input.askingPrice } : {}),
        ...(input.ownerId ? { ownerId: input.ownerId } : {}),
        createdAt: now,
        updatedAt: now,
      };
      state.deals[id] = record;
      return { state, result: { ...record } };
    });
  }

  async createSource(input: CreateSourceInput): Promise<SourceRecord> {
    return this.#update(input.organizationId, (state) => {
      const record = this.#createSource(state, input);
      return { state, result: { ...record } };
    });
  }

  async prepareCredentialCreate(
    input: CreateSourceInput & {
      id: string;
      credentialOwnerId: string;
      credentialRef: string;
    },
  ): Promise<PendingCredentialOperation & { kind: "create" }> {
    return this.#update(input.organizationId, (state) => {
      if (state.sources[input.id]) {
        throw new DealPilotStoreError(
          "conflict",
          `Source "${input.id}" already exists`,
        );
      }
      if (state.credentialOperations[input.id]) {
        throw new DealPilotStoreError(
          "conflict",
          `Source "${input.id}" already has a pending credential operation`,
        );
      }
      const operation: PendingCredentialOperation & { kind: "create" } = {
        kind: "create",
        organizationId: input.organizationId,
        sourceId: input.id,
        ownerId: input.credentialOwnerId,
        reference: input.credentialRef,
        source: structuredClone(input),
        preparedAt: this.#now(),
      };
      state.credentialOperations[input.id] = operation;
      return { state, result: structuredClone(operation) };
    });
  }

  async completeCredentialCreate(
    organizationId: string,
    sourceId: string,
    reference: string,
  ): Promise<SourceRecord> {
    return this.#update(organizationId, (state) => {
      const operation = state.credentialOperations[sourceId];
      if (
        operation?.kind !== "create" ||
        operation.organizationId !== organizationId ||
        operation.reference !== reference
      ) {
        throw new DealPilotStoreError(
          "conflict",
          `Source "${sourceId}" has no matching pending credential creation`,
        );
      }
      const record = this.#createSource(state, operation.source);
      delete state.credentialOperations[sourceId];
      return { state, result: { ...record } };
    });
  }

  async discardCredentialCreate(
    organizationId: string,
    sourceId: string,
    reference: string,
  ): Promise<void> {
    return this.#update(organizationId, (state) => {
      const operation = state.credentialOperations[sourceId];
      if (!operation) return { state, result: undefined };
      if (
        operation.kind !== "create" ||
        operation.organizationId !== organizationId ||
        operation.reference !== reference
      ) {
        throw new DealPilotStoreError(
          "conflict",
          `Source "${sourceId}" has a different pending credential operation`,
        );
      }
      delete state.credentialOperations[sourceId];
      return { state, result: undefined };
    });
  }

  async createThesis(input: CreateThesisInput): Promise<ThesisRecord> {
    return this.#update(input.organizationId, (state) => {
      const id = this.#id();
      const now = this.#now();
      const record: ThesisRecord = {
        id,
        organizationId: input.organizationId,
        kind: "thesis",
        name: input.name,
        focus: input.focus,
        ...(input.targetCagr != null ? { targetCagr: input.targetCagr } : {}),
        criteria: [...(input.criteria ?? [])],
        exclusions: [...(input.exclusions ?? [])],
        ...(input.sourcingStrategy ? { sourcingStrategy: input.sourcingStrategy } : {}),
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      state.theses[id] = record;
      return { state, result: cloneRecord(record) as ThesisRecord };
    });
  }

  async get(
    kind: DealPilotRecordKind,
    organizationId: string,
    id: string,
  ): Promise<DealPilotRecord | null> {
    const state = await this.#read(organizationId);
    const record = recordMap(state, kind)[id];
    return record ? cloneRecord(record) : null;
  }

  async list(
    page: DealPilotPageId,
    organizationId: string,
    opts: { limit: number; offset: number },
  ): Promise<DealPilotPage> {
    const state = await this.#read(organizationId);
    const rows = Object.values(recordMap(state, pageKind(page))).sort(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
    );
    const items = rows
      .slice(opts.offset, opts.offset + opts.limit)
      .map(cloneRecord);
    return {
      items,
      total: rows.length,
      hasMore: opts.offset + items.length < rows.length,
    };
  }

  async updateDeal(
    id: string,
    organizationId: string,
    patch: Partial<DealRecord>,
  ): Promise<DealRecord> {
    return this.#update(organizationId, (state) => {
      const record = state.deals[id];
      if (!record) throw new DealPilotStoreError("not_found", `Deal "${id}" was not found`);
      const updated: DealRecord = {
        ...record,
        ...patch,
        id,
        organizationId,
        kind: "deal",
        updatedAt: this.#now(),
      };
      state.deals[id] = updated;
      return { state, result: { ...updated } };
    });
  }

  async updateSource(
    id: string,
    organizationId: string,
    patch: Partial<SourceRecord>,
  ): Promise<SourceRecord> {
    return this.#update(organizationId, (state) => {
      const record = state.sources[id];
      if (!record) throw new DealPilotStoreError("not_found", `Source "${id}" was not found`);
      const updated: SourceRecord = {
        ...record,
        ...patch,
        id,
        organizationId,
        kind: "source",
        updatedAt: this.#now(),
      };
      state.sources[id] = updated;
      return { state, result: { ...updated } };
    });
  }

  async recordCredentialRevocation(
    organizationId: string,
    sourceId: string,
    ownerId: string,
    reference: string,
    audit: CredentialAuditEvent,
  ): Promise<{ source: SourceRecord; cleared: boolean }> {
    return this.#update<{ source: SourceRecord; cleared: boolean }>(
      organizationId,
      (state) => {
        return {
          state,
          result: this.#recordCredentialRevocation(
            state,
            organizationId,
            sourceId,
            ownerId,
            reference,
            audit,
          ),
        };
      },
    );
  }

  async prepareCredentialRevocation(
    organizationId: string,
    sourceId: string,
    ownerId: string,
    reference: string,
    audit: CredentialAuditEvent,
  ): Promise<PendingCredentialOperation & { kind: "revoke" }> {
    return this.#update(organizationId, (state) => {
      const source = state.sources[sourceId];
      if (!source) {
        throw new DealPilotStoreError(
          "not_found",
          `Source "${sourceId}" was not found`,
        );
      }
      if (
        source.credentialOwnerId !== ownerId ||
        source.credentialRef !== reference
      ) {
        throw new DealPilotStoreError(
          "conflict",
          "Credential revocation no longer matches the Source credential",
        );
      }
      const existing = state.credentialOperations[sourceId];
      if (existing) {
        if (
          existing.kind === "revoke" &&
          existing.organizationId === organizationId &&
          existing.ownerId === ownerId &&
          existing.reference === reference
        ) {
          return { state, result: structuredClone(existing) };
        }
        throw new DealPilotStoreError(
          "conflict",
          `Source "${sourceId}" already has a pending credential operation`,
        );
      }
      this.#assertCredentialRevocationAudit(
        organizationId,
        sourceId,
        ownerId,
        audit,
      );
      const operation: PendingCredentialOperation & { kind: "revoke" } = {
        kind: "revoke",
        organizationId,
        sourceId,
        ownerId,
        reference,
        audit: { ...audit },
        preparedAt: this.#now(),
      };
      state.credentialOperations[sourceId] = operation;
      return { state, result: structuredClone(operation) };
    });
  }

  async completeCredentialRevocation(
    organizationId: string,
    sourceId: string,
    ownerId: string,
    reference: string,
  ): Promise<{ source: SourceRecord; cleared: boolean }> {
    return this.#update(organizationId, (state) => {
      const operation = state.credentialOperations[sourceId];
      if (
        operation?.kind !== "revoke" ||
        operation.organizationId !== organizationId ||
        operation.ownerId !== ownerId ||
        operation.reference !== reference
      ) {
        throw new DealPilotStoreError(
          "conflict",
          `Source "${sourceId}" has no matching pending credential revocation`,
        );
      }
      const result = this.#recordCredentialRevocation(
        state,
        organizationId,
        sourceId,
        ownerId,
        reference,
        operation.audit,
      );
      delete state.credentialOperations[sourceId];
      return { state, result };
    });
  }

  async pendingCredentialOperations(
    organizationId: string,
  ): Promise<PendingCredentialOperation[]> {
    const state = await this.#read(organizationId);
    return Object.values(state.credentialOperations).map((operation) =>
      structuredClone(operation),
    );
  }

  async link(input: CreateRelationInput): Promise<DealPilotRelation> {
    return this.#update(input.organizationId, (state) => {
      const relation = this.#link(state, input);
      return { state, result: cloneRelation(relation) };
    });
  }

  async linkSourceThesisWithBackfill(
    input: CreateRelationInput & { kind: "source_thesis" },
  ): Promise<DealPilotRelation[]> {
    return this.#update(input.organizationId, (state) => {
      const sourceThesis = this.#link(state, input);
      const rows = [sourceThesis];
      for (const dealSource of Object.values(state.relations)) {
        if (dealSource.kind !== "deal_source" || dealSource.toId !== input.fromId) continue;
        rows.push(
          this.#link(state, {
            organizationId: input.organizationId,
            kind: "deal_thesis",
            fromId: dealSource.fromId,
            toId: input.toId,
            confidence: Math.min(dealSource.confidence, input.confidence),
            provenance: `source:${input.fromId}`,
            evidenceRefs: [dealSource.id, sourceThesis.id],
          }),
        );
      }
      return { state, result: rows.map(cloneRelation) };
    });
  }

  async relations(
    organizationId: string,
    recordId: string,
  ): Promise<DealPilotRelation[]> {
    const state = await this.#read(organizationId);
    return Object.values(state.relations)
      .filter((row) => row.fromId === recordId || row.toId === recordId)
      .map(cloneRelation);
  }

  async detail(
    kind: DealPilotRecordKind,
    organizationId: string,
    id: string,
    bindings: DealPilotBindings,
  ): Promise<DealPilotRecordDetail | null> {
    const state = await this.#read(organizationId);
    const record = recordMap(state, kind)[id];
    if (!record) return null;
    const relations = Object.values(state.relations).filter(
      (row) => row.fromId === id || row.toId === id,
    );
    const relatedRecords: DealPilotRecord[] = [];
    for (const relation of relations) {
      const otherId = relation.fromId === id ? relation.toId : relation.fromId;
      const [fromKind, toKind] = relationKinds(relation.kind);
      const otherKind = relation.fromId === id ? toKind : fromKind;
      const related = recordMap(state, otherKind)[otherId];
      if (related) relatedRecords.push(cloneRecord(related));
    }
    return {
      record: cloneRecord(record),
      relations: relations.map(cloneRelation),
      relatedRecords,
      sections: dealPilotModuleManifest(bindings).recordDetail[kind],
    };
  }

  async load(organizationId: string, sourceId: string): Promise<GmailFetchState> {
    const state = await this.#read(organizationId);
    return structuredClone(state.gmail[sourceId] ?? gmailState());
  }

  async stage(
    receipt: GmailFetchReceipt,
    seenMessageIds: string[],
    continuation: GmailContinuation | null,
  ): Promise<void> {
    await this.#update(receipt.organizationId, (state) => {
      const current = state.gmail[receipt.sourceId] ?? gmailState();
      if (current.pending) {
        throw new DealPilotStoreError(
          "conflict",
          `Gmail fetch for Source "${receipt.sourceId}" must be acknowledged or discarded before retry`,
        );
      }
      state.gmail[receipt.sourceId] = {
        ...current,
        pending: {
          batchId: receipt.batchId,
          ownerId: receipt.ownerId,
          seenMessageIds: [...seenMessageIds],
          continuation: continuation ? structuredClone(continuation) : null,
          complete: receipt.complete,
          ...(receipt.checkpointAt ? { checkpointAt: receipt.checkpointAt } : {}),
        },
      };
      return { state, result: undefined };
    });
  }

  async acknowledge(receipt: GmailFetchReceipt): Promise<void> {
    await this.#update(receipt.organizationId, (state) => {
      if (state.settlements[receipt.batchId]) {
        if (!isDeepStrictEqual(state.settlements[receipt.batchId]?.receipt, receipt)) {
          throw new DealPilotStoreError(
            "conflict",
            `Gmail fetch acknowledgement for Source "${receipt.sourceId}" is stale`,
          );
        }
        return { state, result: undefined };
      }
      this.#acknowledgeGmail(state, receipt);
      return { state, result: undefined };
    });
  }

  async discard(receipt: GmailFetchReceipt): Promise<void> {
    await this.#update(receipt.organizationId, (state) => {
      const current = state.gmail[receipt.sourceId] ?? gmailState();
      if (!current.pending) return { state, result: undefined };
      if (!sameReceipt(current.pending, receipt)) {
        throw new DealPilotStoreError(
          "conflict",
          `Gmail fetch discard for Source "${receipt.sourceId}" is stale`,
        );
      }
      const { pending: _pending, ...committed } = current;
      state.gmail[receipt.sourceId] = committed;
      return { state, result: undefined };
    });
  }

  async fail(input: {
    organizationId: string;
    sourceId: string;
    batchId: string;
    ownerId: string;
    cursorKey: string;
  }): Promise<void> {
    await this.#update(input.organizationId, (state) => {
      const current = state.gmail[input.sourceId] ?? gmailState();
      const next: GmailFetchState = {
        seenMessageIds: [...current.seenMessageIds],
        lastFetchComplete: false,
        ...(current.lastCheckpointAt
          ? { lastCheckpointAt: current.lastCheckpointAt }
          : {}),
        ...(current.continuation?.cursorKey !== input.cursorKey && current.continuation
          ? { continuation: structuredClone(current.continuation) }
          : {}),
        ...(current.pending &&
        (current.pending.batchId !== input.batchId ||
          current.pending.ownerId !== input.ownerId)
          ? { pending: structuredClone(current.pending) }
          : {}),
      };
      state.gmail[input.sourceId] = next;
      return { state, result: undefined };
    });
  }

  async settleDiscoveryBatch(
    input: SettleDiscoveryBatchInput,
  ): Promise<DiscoverySettlement> {
    if (
      !Number.isFinite(input.actualSpend) ||
      input.actualSpend < 0 ||
      !Number.isInteger(input.droppedForBudget) ||
      input.droppedForBudget < 0
    ) {
      throw new DealPilotStoreError("conflict", "Discovery settlement contains invalid spend data");
    }
    if (
      input.receipt.organizationId !== input.organizationId ||
      input.receipt.sourceId !== input.sourceId
    ) {
      throw new DealPilotStoreError(
        "conflict",
        "Discovery settlement receipt is outside the requested Organization or Source",
      );
    }
    return this.#update(input.organizationId, (state) => {
      const prior = state.settlements[input.receipt.batchId];
      if (prior) {
        if (
          prior.sourceId !== input.sourceId ||
          prior.actualSpend !== input.actualSpend ||
          prior.droppedForBudget !== input.droppedForBudget ||
          !isDeepStrictEqual(prior.receipt, input.receipt) ||
          !isDeepStrictEqual(prior.captures, input.captures)
        ) {
          throw new DealPilotStoreError(
            "conflict",
            `Discovery settlement "${input.receipt.batchId}" was retried with different input`,
          );
        }
        return { state, result: structuredClone(prior.result) };
      }
      const source = state.sources[input.sourceId];
      if (!source) {
        throw new DealPilotStoreError("not_found", `Source "${input.sourceId}" was not found`);
      }
      const gmail = state.gmail[input.sourceId] ?? gmailState();
      if (!gmail.pending || !sameReceipt(gmail.pending, input.receipt)) {
        throw new DealPilotStoreError(
          "conflict",
          `Gmail fetch settlement for Source "${input.sourceId}" is stale`,
        );
      }
      const remaining = source.spendCap - source.spendToDate;
      if (input.actualSpend > remaining) {
        const paused: SourceRecord = {
          ...source,
          health: "paused",
          updatedAt: this.#now(),
        };
        state.sources[input.sourceId] = paused;
        const { pending: _pending, ...committed } = gmail;
        state.gmail[input.sourceId] = committed;
        const settlement: DiscoverySettlement = {
          status: "budget_exceeded",
          captureIds: [],
          droppedForBudget: input.droppedForBudget,
          source: { ...paused },
        };
        this.#recordSettlement(state, input, settlement);
        return { state, result: structuredClone(settlement) };
      }

      const captureIds: string[] = [];
      for (const capture of input.captures) {
        captureIds.push(this.#storeCapture(state, input.sourceId, capture));
      }

      const updatedSource: SourceRecord = {
        ...source,
        ...(input.receipt.complete
          ? { lastCheckedAt: input.receipt.checkpointAt ?? input.completedAt }
          : {}),
        spendToDate: source.spendToDate + input.actualSpend,
        health:
          input.droppedForBudget > 0
            ? "paused"
            : input.receipt.complete
              ? "ready"
              : "degraded",
        updatedAt: this.#now(),
      };
      state.sources[input.sourceId] = updatedSource;
      this.#acknowledgeGmail(state, input.receipt);
      const settlement: DiscoverySettlement = {
        status: "settled",
        captureIds,
        droppedForBudget: input.droppedForBudget,
        source: { ...updatedSource },
      };
      this.#recordSettlement(state, input, settlement);
      return { state, result: structuredClone(settlement) };
    });
  }

  async quarantineCapture(
    organizationId: string,
    sourceId: string,
    capture: QuarantinedCapture,
  ): Promise<string> {
    return this.#update(organizationId, (state) => {
      if (!state.sources[sourceId]) {
        throw new DealPilotStoreError("not_found", `Source "${sourceId}" was not found`);
      }
      return { state, result: this.#storeCapture(state, sourceId, capture) };
    });
  }

  async listPendingCaptures(
    organizationId: string,
    opts: { sourceId?: string; limit?: number; offset?: number } = {},
  ): Promise<DealPilotCapturePage> {
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 200 ||
      !Number.isInteger(offset) ||
      offset < 0
    ) {
      throw new DealPilotStoreError(
        "conflict",
        "Pending capture pagination requires limit 1..200 and a non-negative offset",
      );
    }
    const state = await this.#read(organizationId);
    const rows = Object.values(state.captures)
      .filter(
        (row) =>
          !row.committedAt &&
          (opts.sourceId === undefined || row.sourceId === opts.sourceId),
      )
      .sort(
        (left, right) =>
          right.capture.capturedAt.localeCompare(left.capture.capturedAt) ||
          right.capture.captureId.localeCompare(left.capture.captureId),
      );
    const items = rows
      .slice(offset, offset + limit)
      .map((row) => ({ ...structuredClone(row.capture), sourceId: row.sourceId }));
    return {
      items,
      total: rows.length,
      hasMore: offset + items.length < rows.length,
    };
  }

  async captureStatus(
    organizationId: string,
    captureId: string,
  ): Promise<"pending" | "committed" | null> {
    const state = await this.#read(organizationId);
    const stored = state.captures[captureId];
    return stored ? (stored.committedAt ? "committed" : "pending") : null;
  }

  async getCapture(
    organizationId: string,
    captureId: string,
  ): Promise<QuarantinedCapture | null> {
    const state = await this.#read(organizationId);
    const capture = state.captures[captureId]?.capture;
    return capture ? structuredClone(capture) : null;
  }

  async commitCapture(
    organizationId: string,
    captureId: string,
  ): Promise<CommitCaptureResult> {
    return this.#update<CommitCaptureResult>(organizationId, (state) => {
      const stored = state.captures[captureId];
      if (!stored) return { state, result: { committed: false, alreadyCommitted: false } };
      if (stored.committedAt) {
        const existingDealId = Object.values(state.relations).find(
          (row) =>
            row.kind === "deal_source" &&
            row.evidenceRefs.includes(captureId),
        )?.fromId;
        return {
          state,
          result: {
            committed: false,
            alreadyCommitted: true,
            ...(existingDealId ? { recordId: existingDealId } : {}),
          },
        };
      }

      const existingCandidates: DedupeCandidate[] = Object.values(state.deals).map(
        (deal) => {
          const profile = state.candidateProfiles[deal.id] ?? {};
          return {
            id: deal.id,
            name: deal.company,
            ...(typeof profile.domain === "string" ? { domain: profile.domain } : {}),
            ...(typeof profile.industry === "string"
              ? { industry: profile.industry }
              : {}),
          };
        },
      );
      const payload = stored.capture.payload;
      const candidate: DedupeCandidate = {
        id: captureId,
        name: String(payload.name ?? captureId),
        ...(typeof payload.domain === "string" ? { domain: payload.domain } : {}),
        ...(typeof payload.industry === "string"
          ? { industry: payload.industry }
          : {}),
      };
      const match = matchCompany(candidate, existingCandidates);
      const dealId = match.tier === "strong" ? match.targetId : captureId;
      const existingDeal = state.deals[dealId];
      const now = this.#now();
      state.candidateProfiles[dealId] = {
        ...(state.candidateProfiles[dealId] ?? {}),
        ...structuredClone(payload),
      };
      const fields = {
        company: String(payload.name ?? dealId),
        ...(typeof payload.revenue === "number" ? { revenue: payload.revenue } : {}),
        ...(typeof payload.sde === "number" ? { sde: payload.sde } : {}),
        ...(typeof payload.askPrice === "number"
          ? { askingPrice: payload.askPrice }
          : {}),
      };
      state.deals[dealId] = existingDeal
        ? {
            ...existingDeal,
            ...fields,
            updatedAt: now,
          }
        : {
            id: dealId,
            organizationId,
            kind: "deal",
            stage: "sourced",
            ...fields,
            createdAt: now,
            updatedAt: now,
          };

      if (state.sources[stored.sourceId]) {
        const dealSource = this.#link(state, {
          organizationId,
          kind: "deal_source",
          fromId: dealId,
          toId: stored.sourceId,
          confidence: stored.capture.confidence,
          provenance: stored.capture.sourceConnectorId,
          evidenceRefs: [captureId],
        });
        for (const relation of Object.values(state.relations)) {
          if (
            relation.kind !== "source_thesis" ||
            relation.fromId !== stored.sourceId
          ) {
            continue;
          }
          this.#link(state, {
            organizationId,
            kind: "deal_thesis",
            fromId: dealId,
            toId: relation.toId,
            confidence: Math.min(stored.capture.confidence, relation.confidence),
            provenance: `source:${stored.sourceId}`,
            evidenceRefs: [captureId, dealSource.id, relation.id],
          });
        }
      }
      stored.committedAt = now;
      return {
        state,
        result: { committed: true, alreadyCommitted: false, recordId: dealId },
      };
    });
  }

  async candidateProfile(
    organizationId: string,
    dealId: string,
  ): Promise<Record<string, unknown>> {
    const state = await this.#read(organizationId);
    return structuredClone(state.candidateProfiles[dealId] ?? {});
  }

  async append(event: CredentialAuditEvent): Promise<void> {
    await this.#update(event.organizationId, (state) => {
      state.credentialAudit.push({ ...event });
      return { state, result: undefined };
    });
  }

  async credentialAuditEvents(
    organizationId: string,
  ): Promise<CredentialAuditEvent[]> {
    const state = await this.#read(organizationId);
    return state.credentialAudit.map((event) => ({ ...event }));
  }

  #createSource(
    state: DealPilotOrganizationState,
    input: CreateSourceInput,
  ): SourceRecord {
    const id = input.id ?? this.#id();
    if (state.sources[id]) {
      throw new DealPilotStoreError(
        "conflict",
        `Source "${id}" already exists`,
      );
    }
    const now = this.#now();
    const attested = input.rightsState === "attested";
    const record: SourceRecord = {
      id,
      organizationId: input.organizationId,
      kind: "source",
      name: input.name,
      link: input.link,
      connectionType: input.connectionType,
      ...(input.credentialRef ? { credentialRef: input.credentialRef } : {}),
      ...(input.credentialOwnerId
        ? { credentialOwnerId: input.credentialOwnerId }
        : {}),
      spendCap: input.spendCap,
      spendToDate: 0,
      health: "ready",
      rightsState: input.rightsState,
      ...(attested ? { rightsAttestedAt: now } : {}),
      ...(attested && input.rightsAttestedBy
        ? { rightsAttestedBy: input.rightsAttestedBy }
        : {}),
      createdAt: now,
      updatedAt: now,
    };
    state.sources[id] = record;
    return record;
  }

  #assertCredentialRevocationAudit(
    organizationId: string,
    sourceId: string,
    ownerId: string,
    audit: CredentialAuditEvent,
  ): void {
    if (
      audit.organizationId !== organizationId ||
      audit.sourceId !== sourceId ||
      audit.actorId !== ownerId ||
      audit.action !== "revoke" ||
      audit.field !== "credential"
    ) {
      throw new DealPilotStoreError(
        "conflict",
        "Credential revocation audit is outside the requested Organization, Source, or Human",
      );
    }
  }

  #recordCredentialRevocation(
    state: DealPilotOrganizationState,
    organizationId: string,
    sourceId: string,
    ownerId: string,
    reference: string,
    audit: CredentialAuditEvent,
  ): { source: SourceRecord; cleared: boolean } {
    const record = state.sources[sourceId];
    if (!record) {
      throw new DealPilotStoreError(
        "not_found",
        `Source "${sourceId}" was not found`,
      );
    }
    this.#assertCredentialRevocationAudit(
      organizationId,
      sourceId,
      ownerId,
      audit,
    );
    const cleared =
      record.credentialOwnerId === ownerId &&
      record.credentialRef === reference;
    if (!cleared) {
      state.credentialAudit.push({ ...audit });
      return { source: { ...record }, cleared: false };
    }
    const {
      credentialRef: _credentialRef,
      credentialOwnerId: _credentialOwnerId,
      ...withoutCredential
    } = record;
    const updated: SourceRecord = {
      ...withoutCredential,
      updatedAt: this.#now(),
    };
    state.sources[sourceId] = updated;
    state.credentialAudit.push({ ...audit });
    return { source: { ...updated }, cleared: true };
  }

  async #read(organizationId: string): Promise<DealPilotOrganizationState> {
    const value = await this.#state.read(organizationId, STATE_NAMESPACE);
    return value == null ? emptyState() : parseState(value);
  }

  async #update<T>(
    organizationId: string,
    reduce: (
      state: DealPilotOrganizationState,
    ) => { state: DealPilotOrganizationState; result: T },
  ): Promise<T> {
    return this.#state.update(
      organizationId,
      STATE_NAMESPACE,
      emptyState(),
      (current) => reduce(parseState(current)),
    );
  }

  #link(
    state: DealPilotOrganizationState,
    input: CreateRelationInput,
  ): DealPilotRelation {
    const [fromKind, toKind] = relationKinds(input.kind);
    const from = recordMap(state, fromKind)[input.fromId];
    const to = recordMap(state, toKind)[input.toId];
    if (!from || !to) {
      throw new DealPilotStoreError(
        "invalid_relation",
        `${input.kind} requires existing ${fromKind} and ${toKind} Records in the same Organization`,
      );
    }
    const key = relationKey(input);
    const existing = state.relations[key];
    if (existing) {
      const updated: DealPilotRelation = {
        ...existing,
        confidence: Math.max(
          existing.confidence,
          Math.max(0, Math.min(1, input.confidence)),
        ),
        evidenceRefs: [
          ...new Set([...existing.evidenceRefs, ...(input.evidenceRefs ?? [])]),
        ],
      };
      state.relations[key] = updated;
      return updated;
    }
    const relation: DealPilotRelation = {
      id: this.#id(),
      organizationId: input.organizationId,
      kind: input.kind,
      fromId: input.fromId,
      toId: input.toId,
      confidence: Math.max(0, Math.min(1, input.confidence)),
      provenance: input.provenance,
      evidenceRefs: [...(input.evidenceRefs ?? [])],
      createdAt: this.#now(),
    };
    state.relations[key] = relation;
    return relation;
  }

  #storeCapture(
    state: DealPilotOrganizationState,
    sourceId: string,
    capture: QuarantinedCapture,
  ): string {
    let captureId = capture.captureId;
    if (capture.sourceRecordId) {
      const externalKey = captureExternalKey(sourceId, capture.sourceRecordId);
      captureId = state.captureByExternalKey[externalKey] ?? captureId;
      state.captureByExternalKey[externalKey] = captureId;
    }
    const existing = state.captures[captureId];
    const persistedCapture = { ...capture, captureId };
    if (existing) {
      if (
        existing.sourceId !== sourceId ||
        !isDeepStrictEqual(existing.capture, persistedCapture)
      ) {
        throw new DealPilotStoreError(
          "conflict",
          `Capture "${captureId}" collides with different persisted input`,
        );
      }
      return captureId;
    }
    state.captures[captureId] = {
      capture: structuredClone(persistedCapture),
      sourceId,
    };
    return captureId;
  }

  #acknowledgeGmail(
    state: DealPilotOrganizationState,
    receipt: GmailFetchReceipt,
  ): void {
    const current = state.gmail[receipt.sourceId] ?? gmailState();
    const pending = current.pending;
    if (!pending || !sameReceipt(pending, receipt)) {
      throw new DealPilotStoreError(
        "conflict",
        `Gmail fetch acknowledgement for Source "${receipt.sourceId}" is stale`,
      );
    }
    const seenMessageIds = [
      ...new Set([...current.seenMessageIds, ...pending.seenMessageIds]),
    ].slice(-MAX_GMAIL_SEEN_IDS);
    state.gmail[receipt.sourceId] = {
      seenMessageIds,
      ...(pending.continuation
        ? { continuation: structuredClone(pending.continuation) }
        : {}),
      lastFetchComplete: pending.complete,
      ...(pending.checkpointAt
        ? { lastCheckpointAt: pending.checkpointAt }
        : {}),
    };
  }

  #recordSettlement(
    state: DealPilotOrganizationState,
    input: SettleDiscoveryBatchInput,
    settlement: DiscoverySettlement,
  ): void {
    state.settlements[input.receipt.batchId] = structuredClone({
      sourceId: input.sourceId,
      receipt: input.receipt,
      actualSpend: input.actualSpend,
      droppedForBudget: input.droppedForBudget,
      captures: input.captures,
      result: settlement,
    });
    state.settlementOrder.push(input.receipt.batchId);
    // Settlement receipts are the durable idempotency ledger. Evicting one can
    // double-charge or turn a post-crash retry into a stale-receipt failure.
  }
}

export async function reconcileCredentialOperations(
  store: DealPilotRuntimeStore,
  vault: SourceCredentialVault,
  organizationId: string,
): Promise<void> {
  for (const operation of await store.pendingCredentialOperations(organizationId)) {
    const scope = {
      organizationId: operation.organizationId,
      sourceId: operation.sourceId,
    };
    if (operation.organizationId !== organizationId) {
      throw new DealPilotStoreError(
        "conflict",
        "Pending credential operation escaped its Organization",
      );
    }
    if (operation.kind === "create") {
      const metadata = await vault.metadata(scope, operation.reference);
      if (metadata) {
        await store.completeCredentialCreate(
          organizationId,
          operation.sourceId,
          operation.reference,
        );
      } else {
        await vault.delete(scope, operation.reference);
        await store.discardCredentialCreate(
          organizationId,
          operation.sourceId,
          operation.reference,
        );
      }
      continue;
    }
    await vault.delete(scope, operation.reference);
    await store.completeCredentialRevocation(
      organizationId,
      operation.sourceId,
      operation.ownerId,
      operation.reference,
    );
  }
}
