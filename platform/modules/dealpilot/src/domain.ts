import type { DealStage } from "./deal.js";

export type DealPilotPageId = "deals" | "sources" | "theses";
export type DealPilotRecordKind = "deal" | "source" | "thesis";
export type RelationKind = "deal_source" | "deal_thesis" | "source_thesis";
export type SourceRightsState = "unattested" | "attested" | "blocked";
export type SourceHealth = "ready" | "degraded" | "paused";
export type SourceConnectionType = "url" | "email_alert" | "api" | "account";

interface RecordBase {
  id: string;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}

export type DealRag = "red" | "yellow" | "green";

export interface DealRecord extends RecordBase {
  kind: "deal";
  company: string;
  stage: DealStage;
  revenue?: number;
  ebitda?: number;
  sde?: number;
  askingPrice?: number;
  evidenceHealth?: "unknown" | "partial" | "supported" | "contradicted";
  /** Deal-triage signals (AP-087/ADR-155). All optional — an unscored deal
   * renders an honest empty cell, never a fabricated value. `rag` is a coarse
   * pursue signal, distinct from `evidenceHealth` and from platform Red Flags.
   * fitScore/evidenceScore are 0..100; p0Flags counts P0 diligence flags;
   * thesisTag/sourceChannel are lightweight triage labels. */
  rag?: DealRag;
  fitScore?: number;
  evidenceScore?: number;
  p0Flags?: number;
  thesisTag?: string;
  sourceChannel?: string;
  ownerId?: string;
}

export interface SourceRecord extends RecordBase {
  kind: "source";
  name: string;
  link: string;
  connectionType: SourceConnectionType;
  credentialRef?: string;
  credentialOwnerId?: string;
  lastCheckedAt?: string;
  spendCap: number;
  spendToDate: number;
  health: SourceHealth;
  schedule?: string;
  yield?: number;
  rightsState: SourceRightsState;
  rightsAttestedAt?: string;
  rightsAttestedBy?: string;
}

export interface ThesisRecord extends RecordBase {
  kind: "thesis";
  name: string;
  focus: string;
  targetCagr?: number;
  criteria: string[];
  exclusions: string[];
  sourcingStrategy?: string;
  version: number;
}

export type DealPilotRecord = DealRecord | SourceRecord | ThesisRecord;

export interface DealPilotRelation {
  id: string;
  organizationId: string;
  kind: RelationKind;
  fromId: string;
  toId: string;
  confidence: number;
  provenance: string;
  evidenceRefs: string[];
  createdAt: string;
}

export interface DealPilotPage<T extends DealPilotRecord = DealPilotRecord> {
  items: T[];
  total: number;
  hasMore: boolean;
}

export interface DealPilotBindings {
  relationshipAuthorized: boolean;
  tasksAuthorized: boolean;
}

export interface DealPilotColumn {
  id: string;
  label: string;
  kind: "text" | "number" | "select" | "url" | "date" | "relation" | "credential" | "checkbox";
  virtual?: boolean;
}

export interface DealPilotPageManifest {
  id: DealPilotPageId;
  name: "Deals" | "Sources" | "Theses";
  route: string;
  databaseId: string;
  columns: DealPilotColumn[];
}

export interface DealPilotModuleManifest {
  id: "deal-pilot";
  displayName: "DealPilot";
  route: "/dealpilot/deals";
  pages: DealPilotPageManifest[];
  recordDetail: Record<DealPilotRecordKind, string[]>;
}

const BASE_COLUMNS: Record<DealPilotPageId, DealPilotColumn[]> = {
  deals: [
    { id: "company", label: "Company", kind: "text" },
    { id: "stage", label: "Stage", kind: "select" },
    { id: "rag", label: "R/Y/G", kind: "select" },
    { id: "fitScore", label: "Fit", kind: "number" },
    { id: "thesisTag", label: "Thesis", kind: "text" },
    { id: "sourceChannel", label: "Source", kind: "text" },
    { id: "revenue", label: "Revenue", kind: "number" },
    { id: "ebitda", label: "EBITDA", kind: "number" },
    { id: "sde", label: "SDE", kind: "number" },
    { id: "askingPrice", label: "Asking price", kind: "number" },
    { id: "evidenceScore", label: "Evidence", kind: "number" },
    { id: "p0Flags", label: "P0 flags", kind: "number" },
    { id: "evidenceHealth", label: "Evidence health", kind: "select" },
    { id: "sources", label: "Sources", kind: "relation" },
    { id: "theses", label: "Theses", kind: "relation" },
  ],
  sources: [
    // Virtual: `enabled` is a view onto `health` (paused = unchecked), not a stored column. One
    // question, one source of truth — the discovery gate already refuses a paused Source.
    { id: "enabled", label: "On", kind: "checkbox", virtual: true },
    { id: "name", label: "Source", kind: "text" },
    { id: "link", label: "Link", kind: "url" },
    { id: "connectionType", label: "Connection type", kind: "select" },
    { id: "userId", label: "User ID", kind: "credential", virtual: true },
    { id: "password", label: "Password", kind: "credential", virtual: true },
    { id: "lastCheckedAt", label: "Last checked", kind: "date" },
    { id: "spendCap", label: "Spend cap", kind: "number" },
    { id: "spendToDate", label: "Spend to date", kind: "number" },
    { id: "rightsAttested", label: "Rights attested", kind: "checkbox", virtual: true },
    { id: "rightsState", label: "Rights", kind: "select" },
    { id: "health", label: "Health", kind: "select" },
    { id: "deals", label: "Deals", kind: "relation" },
    { id: "theses", label: "Theses", kind: "relation" },
  ],
  theses: [
    { id: "name", label: "Thesis", kind: "text" },
    { id: "focus", label: "Focus", kind: "text" },
    { id: "targetCagr", label: "Target CAGR", kind: "number" },
    { id: "criteria", label: "Criteria", kind: "text" },
    { id: "exclusions", label: "Exclusions", kind: "text" },
    { id: "sourcingStrategy", label: "Sourcing strategy", kind: "text" },
    { id: "version", label: "Version", kind: "number" },
    { id: "sources", label: "Sources", kind: "relation" },
    { id: "deals", label: "Deals", kind: "relation" },
  ],
};

export function dealPilotModuleManifest(bindings: DealPilotBindings): DealPilotModuleManifest {
  const conditional: DealPilotColumn[] = [
    ...(bindings.relationshipAuthorized
      ? [{ id: "relationships", label: "Relationships", kind: "relation" as const }]
      : []),
    ...(bindings.tasksAuthorized ? [{ id: "tasks", label: "Tasks", kind: "relation" as const }] : []),
  ];
  const page = (
    id: DealPilotPageId,
    name: DealPilotPageManifest["name"],
  ): DealPilotPageManifest => ({
    id,
    name,
    route: `/dealpilot/${id}`,
    databaseId: `dealpilot.${id}`,
    columns: [...BASE_COLUMNS[id], ...conditional],
  });
  return {
    id: "deal-pilot",
    displayName: "DealPilot",
    route: "/dealpilot/deals",
    pages: [
      page("deals", "Deals"),
      page("sources", "Sources"),
      page("theses", "Theses"),
    ],
    recordDetail: {
      deal: [
        "key Fields",
        "evaluation and decision state",
        "Theses",
        "Sources",
        "Files",
        "Results",
        "Integrations",
        "evidence and diligence",
        "financial analysis",
        ...(bindings.relationshipAuthorized ? ["Relations"] : []),
        ...(bindings.tasksAuthorized ? ["Tasks"] : []),
        "Agent and Automation activity",
        "Event history",
      ],
      source: [
        "connection Fields",
        "credential controls",
        "rights and approval state",
        "Integrations",
        "dynamic acquisition Skills",
        "crawl health and Runs",
        "linked Deals",
        "linked Theses",
        "spend and usage",
        "Files and Results",
        "Event history",
      ],
      thesis: [
        "criteria and exclusions",
        "industry and market assumptions",
        "versions",
        "evidence",
        "sourcing strategy",
        "linked Sources",
        "linked Deals",
        "fit Results",
        "Files",
        "Agent and Automation activity",
        "Event history",
      ],
    },
  };
}

export interface CreateDealInput {
  id?: string;
  organizationId: string;
  company: string;
  stage?: DealStage;
  revenue?: number;
  ebitda?: number;
  sde?: number;
  askingPrice?: number;
  evidenceHealth?: DealRecord["evidenceHealth"];
  rag?: DealRag;
  fitScore?: number;
  evidenceScore?: number;
  p0Flags?: number;
  thesisTag?: string;
  sourceChannel?: string;
  ownerId?: string;
}

export interface CreateSourceInput {
  id?: string;
  organizationId: string;
  name: string;
  link: string;
  connectionType: SourceConnectionType;
  credentialRef?: string;
  credentialOwnerId?: string;
  spendCap: number;
  rightsState: SourceRightsState;
  rightsAttestedBy?: string;
}

export interface CreateThesisInput {
  organizationId: string;
  name: string;
  focus: string;
  targetCagr?: number;
  criteria?: string[];
  exclusions?: string[];
  sourcingStrategy?: string;
}

export interface CreateRelationInput {
  organizationId: string;
  kind: RelationKind;
  fromId: string;
  toId: string;
  confidence: number;
  provenance: string;
  evidenceRefs?: string[];
}

export interface DealPilotRecordDetail {
  record: DealPilotRecord;
  relations: DealPilotRelation[];
  relatedRecords: DealPilotRecord[];
  sections: string[];
}

export interface DealPilotStore {
  createDeal(input: CreateDealInput): Promise<DealRecord>;
  createSource(input: CreateSourceInput): Promise<SourceRecord>;
  createThesis(input: CreateThesisInput): Promise<ThesisRecord>;
  get(kind: DealPilotRecordKind, organizationId: string, id: string): Promise<DealPilotRecord | null>;
  list(page: DealPilotPageId, organizationId: string, opts: { limit: number; offset: number }): Promise<DealPilotPage>;
  updateDeal(id: string, organizationId: string, patch: Partial<DealRecord>): Promise<DealRecord>;
  updateSource(id: string, organizationId: string, patch: Partial<SourceRecord>): Promise<SourceRecord>;
  link(input: CreateRelationInput): Promise<DealPilotRelation>;
  linkSourceThesisWithBackfill(input: CreateRelationInput & { kind: "source_thesis" }): Promise<DealPilotRelation[]>;
  relations(organizationId: string, recordId: string): Promise<DealPilotRelation[]>;
  detail(
    kind: DealPilotRecordKind,
    organizationId: string,
    id: string,
    bindings: DealPilotBindings,
  ): Promise<DealPilotRecordDetail | null>;
}

export class DealPilotStoreError extends Error {
  constructor(
    readonly code: "not_found" | "invalid_relation" | "organization_mismatch" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "DealPilotStoreError";
  }
}

function recordKindForPage(page: DealPilotPageId): DealPilotRecordKind {
  return page === "deals" ? "deal" : page === "sources" ? "source" : "thesis";
}

function relationKinds(kind: RelationKind): [DealPilotRecordKind, DealPilotRecordKind] {
  if (kind === "deal_source") return ["deal", "source"];
  if (kind === "deal_thesis") return ["deal", "thesis"];
  return ["source", "thesis"];
}

function cloneRecord(record: DealPilotRecord): DealPilotRecord {
  if (record.kind === "thesis") {
    return { ...record, criteria: [...record.criteria], exclusions: [...record.exclusions] };
  }
  return { ...record };
}

export class InMemoryDealPilotStore implements DealPilotStore {
  readonly deals = new Map<string, DealRecord>();
  readonly sources = new Map<string, SourceRecord>();
  readonly theses = new Map<string, ThesisRecord>();
  readonly relationRows = new Map<string, DealPilotRelation>();
  #sequence = 0;
  #now: () => string;
  #id: (prefix: string) => string;

  constructor(deps?: { now?: () => string; id?: (prefix: string) => string }) {
    this.#now = deps?.now ?? (() => new Date().toISOString());
    this.#id = deps?.id ?? ((prefix) => `${prefix}_${++this.#sequence}`);
  }

  async createDeal(input: CreateDealInput): Promise<DealRecord> {
    const now = this.#now();
    const record: DealRecord = {
      id: input.id ?? this.#id("deal"),
      organizationId: input.organizationId,
      kind: "deal",
      company: input.company,
      stage: input.stage ?? "sourced",
      ...(input.revenue != null ? { revenue: input.revenue } : {}),
      ...(input.ebitda != null ? { ebitda: input.ebitda } : {}),
      ...(input.sde != null ? { sde: input.sde } : {}),
      ...(input.askingPrice != null ? { askingPrice: input.askingPrice } : {}),
      ...(input.evidenceHealth != null ? { evidenceHealth: input.evidenceHealth } : {}),
      ...(input.rag != null ? { rag: input.rag } : {}),
      ...(input.fitScore != null ? { fitScore: input.fitScore } : {}),
      ...(input.evidenceScore != null ? { evidenceScore: input.evidenceScore } : {}),
      ...(input.p0Flags != null ? { p0Flags: input.p0Flags } : {}),
      ...(input.thesisTag != null ? { thesisTag: input.thesisTag } : {}),
      ...(input.sourceChannel != null ? { sourceChannel: input.sourceChannel } : {}),
      ...(input.ownerId ? { ownerId: input.ownerId } : {}),
      createdAt: now,
      updatedAt: now,
    };
    this.deals.set(this.#recordKey(record.organizationId, record.id), record);
    return { ...record };
  }

  async createSource(input: CreateSourceInput): Promise<SourceRecord> {
    const now = this.#now();
    const attested = input.rightsState === "attested";
    const record: SourceRecord = {
      id: input.id ?? this.#id("source"),
      organizationId: input.organizationId,
      kind: "source",
      name: input.name,
      link: input.link,
      connectionType: input.connectionType,
      ...(input.credentialRef ? { credentialRef: input.credentialRef } : {}),
      ...(input.credentialOwnerId ? { credentialOwnerId: input.credentialOwnerId } : {}),
      spendCap: input.spendCap,
      spendToDate: 0,
      health: "ready",
      rightsState: input.rightsState,
      ...(attested ? { rightsAttestedAt: now } : {}),
      ...(attested && input.rightsAttestedBy ? { rightsAttestedBy: input.rightsAttestedBy } : {}),
      createdAt: now,
      updatedAt: now,
    };
    this.sources.set(this.#recordKey(record.organizationId, record.id), record);
    return { ...record };
  }

  async createThesis(input: CreateThesisInput): Promise<ThesisRecord> {
    const now = this.#now();
    const record: ThesisRecord = {
      id: this.#id("thesis"),
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
    this.theses.set(this.#recordKey(record.organizationId, record.id), record);
    return cloneRecord(record) as ThesisRecord;
  }

  async get(kind: DealPilotRecordKind, organizationId: string, id: string): Promise<DealPilotRecord | null> {
    const record = this.#map(kind).get(this.#recordKey(organizationId, id));
    return record ? cloneRecord(record) : null;
  }

  async list(
    page: DealPilotPageId,
    organizationId: string,
    opts: { limit: number; offset: number },
  ): Promise<DealPilotPage> {
    const kind = recordKindForPage(page);
    const rows = [...this.#map(kind).values()]
      .filter((record) => record.organizationId === organizationId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const items = rows.slice(opts.offset, opts.offset + opts.limit).map(cloneRecord);
    return { items, total: rows.length, hasMore: opts.offset + items.length < rows.length };
  }

  async updateSource(
    id: string,
    organizationId: string,
    patch: Partial<SourceRecord>,
  ): Promise<SourceRecord> {
    const key = this.#recordKey(organizationId, id);
    const source = this.sources.get(key);
    if (!source) {
      throw new DealPilotStoreError("not_found", `Source "${id}" was not found`);
    }
    const next: SourceRecord = {
      ...source,
      ...patch,
      id: source.id,
      organizationId: source.organizationId,
      kind: "source",
      updatedAt: this.#now(),
    };
    this.sources.set(key, next);
    return { ...next };
  }

  async updateDeal(
    id: string,
    organizationId: string,
    patch: Partial<DealRecord>,
  ): Promise<DealRecord> {
    const key = this.#recordKey(organizationId, id);
    const deal = this.deals.get(key);
    if (!deal) {
      throw new DealPilotStoreError("not_found", `Deal "${id}" was not found`);
    }
    const next: DealRecord = {
      ...deal,
      ...patch,
      id: deal.id,
      organizationId: deal.organizationId,
      kind: "deal",
      updatedAt: this.#now(),
    };
    this.deals.set(key, next);
    return { ...next };
  }

  async link(input: CreateRelationInput): Promise<DealPilotRelation> {
    const [fromKind, toKind] = relationKinds(input.kind);
    const [from, to] = await Promise.all([
      this.get(fromKind, input.organizationId, input.fromId),
      this.get(toKind, input.organizationId, input.toId),
    ]);
    if (!from || !to) {
      throw new DealPilotStoreError(
        "invalid_relation",
        `${input.kind} requires existing ${fromKind} and ${toKind} Records in the same Organization`,
      );
    }
    const key = JSON.stringify([input.organizationId, input.kind, input.fromId, input.toId]);
    const existing = this.relationRows.get(key);
    if (existing) {
      const next = {
        ...existing,
        confidence: Math.max(existing.confidence, Math.max(0, Math.min(1, input.confidence))),
        evidenceRefs: [...new Set([...existing.evidenceRefs, ...(input.evidenceRefs ?? [])])],
      };
      this.relationRows.set(key, next);
      return { ...next, evidenceRefs: [...next.evidenceRefs] };
    }
    const row: DealPilotRelation = {
      id: this.#id("relation"),
      organizationId: input.organizationId,
      kind: input.kind,
      fromId: input.fromId,
      toId: input.toId,
      confidence: Math.max(0, Math.min(1, input.confidence)),
      provenance: input.provenance,
      evidenceRefs: [...(input.evidenceRefs ?? [])],
      createdAt: this.#now(),
    };
    this.relationRows.set(key, row);
    return { ...row, evidenceRefs: [...row.evidenceRefs] };
  }

  async relations(organizationId: string, recordId: string): Promise<DealPilotRelation[]> {
    return [...this.relationRows.values()]
      .filter((row) => row.organizationId === organizationId && (row.fromId === recordId || row.toId === recordId))
      .map((row) => ({ ...row, evidenceRefs: [...row.evidenceRefs] }));
  }

  async linkSourceThesisWithBackfill(
    input: CreateRelationInput & { kind: "source_thesis" },
  ): Promise<DealPilotRelation[]> {
    const sourceThesis = await this.link(input);
    const rows = [sourceThesis];
    const sourceRelations = await this.relations(input.organizationId, input.fromId);
    for (const dealSource of sourceRelations.filter(
      (row) => row.kind === "deal_source" && row.toId === input.fromId,
    )) {
      rows.push(
        await this.link({
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
    return rows;
  }

  async detail(
    kind: DealPilotRecordKind,
    organizationId: string,
    id: string,
    bindings: DealPilotBindings,
  ): Promise<DealPilotRecordDetail | null> {
    const record = await this.get(kind, organizationId, id);
    if (!record) return null;
    const relations = await this.relations(organizationId, id);
    const relatedRecords: DealPilotRecord[] = [];
    for (const relation of relations) {
      const otherId = relation.fromId === id ? relation.toId : relation.fromId;
      const [fromKind, toKind] = relationKinds(relation.kind);
      const otherKind = relation.fromId === id ? toKind : fromKind;
      const related = await this.get(otherKind, organizationId, otherId);
      if (related) relatedRecords.push(related);
    }
    return {
      record,
      relations,
      relatedRecords,
      sections: dealPilotModuleManifest(bindings).recordDetail[kind],
    };
  }

  #map(kind: DealPilotRecordKind): Map<string, DealPilotRecord> {
    if (kind === "deal") return this.deals as Map<string, DealPilotRecord>;
    if (kind === "source") return this.sources as Map<string, DealPilotRecord>;
    return this.theses as Map<string, DealPilotRecord>;
  }

  #recordKey(organizationId: string, id: string): string {
    return JSON.stringify([organizationId, id]);
  }
}

export class SourceDiscoveryGateError extends Error {
  constructor(
    readonly code: "rights_required" | "source_blocked" | "source_paused" | "spend_cap_exceeded",
    message: string,
  ) {
    super(message);
    this.name = "SourceDiscoveryGateError";
  }
}

export function assertSourceDiscoveryAllowed(source: SourceRecord, estimatedSpend: number): void {
  if (source.rightsState === "blocked") {
    throw new SourceDiscoveryGateError("source_blocked", "Source rights are blocked; discovery cannot run");
  }
  if (source.rightsState !== "attested") {
    throw new SourceDiscoveryGateError(
      "rights_required",
      "A Human must attest data rights and intended use before discovery can run",
    );
  }
  if (source.health === "paused") {
    throw new SourceDiscoveryGateError("source_paused", "This Source is paused");
  }
  if (estimatedSpend < 0 || source.spendToDate + estimatedSpend > source.spendCap) {
    throw new SourceDiscoveryGateError(
      "spend_cap_exceeded",
      `Estimated spend ${estimatedSpend} exceeds the remaining Source cap ${Math.max(0, source.spendCap - source.spendToDate)}`,
    );
  }
}

export interface ThesisSourceDiscoveryProposal {
  kind: "thesis_source_discovery";
  organizationId: string;
  thesisId: string;
  relations: Array<{
    sourceId: string;
    thesisId: string;
    confidence: number;
    provenance: "authorized_source_inventory";
    reason: "Authorized Source inventory candidate; Thesis fit is not scored";
  }>;
}

export async function proposeThesisSourceDiscovery(
  store: DealPilotStore,
  organizationId: string,
  thesisId: string,
): Promise<ThesisSourceDiscoveryProposal> {
  const thesis = await store.get("thesis", organizationId, thesisId);
  if (!thesis) throw new DealPilotStoreError("not_found", `Thesis "${thesisId}" was not found`);
  const sourceRecords: SourceRecord[] = [];
  let offset = 0;
  do {
    const page = await store.list("sources", organizationId, { limit: 200, offset });
    sourceRecords.push(
      ...page.items.filter((record): record is SourceRecord => record.kind === "source"),
    );
    offset += page.items.length;
    if (!page.hasMore) break;
    if (page.items.length === 0) {
      throw new DealPilotStoreError("not_found", "Source pagination did not advance");
    }
  } while (true);
  return {
    kind: "thesis_source_discovery",
    organizationId,
    thesisId,
    relations: sourceRecords
      .filter((source) => source.rightsState === "attested")
      .map((source) => ({
        sourceId: source.id,
        thesisId,
        confidence: 0,
        provenance: "authorized_source_inventory",
        reason: "Authorized Source inventory candidate; Thesis fit is not scored",
      })),
  };
}

export async function applyThesisSourceDiscovery(
  store: DealPilotStore,
  proposal: ThesisSourceDiscoveryProposal,
): Promise<DealPilotRelation[]> {
  const rows: DealPilotRelation[] = [];
  for (const relation of proposal.relations) {
    const linked = await store.linkSourceThesisWithBackfill({
      organizationId: proposal.organizationId,
      kind: "source_thesis",
      fromId: relation.sourceId,
      toId: relation.thesisId,
      confidence: relation.confidence,
      provenance: relation.provenance,
    });
    rows.push(...linked);
  }
  return rows;
}
