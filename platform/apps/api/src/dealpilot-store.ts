/**
 * DrizzleDealPilotStore — the Cloud-Plane (Supabase) persistence for DealPilot
 * Deal/Source/Thesis Records and their Relations (ADR-151, AP-083). It
 * implements the SAME `DealPilotStore` record contract as the module's
 * `InMemoryDealPilotStore` (@bridge/dealpilot domain.ts) and the Local-Plane
 * `LocalDealPilotStore`, so the wiring can compose it in for the record half
 * while the capture/credential half stays Local.
 *
 * It lives in the api package (not @bridge/db) because `@bridge/dealpilot`
 * transitively depends on `@bridge/db` (via @bridge/integrations-google), so a
 * db -> dealpilot reference would be circular. The api sits atop the graph and
 * already depends on both, mirroring how the wiring composes every store.
 *
 * RESIDENCY: this store persists ONLY governed Records. Source credentials and
 * raw capture bodies never reach these tables — `credential_ref` /
 * `credential_owner_id` are opaque pointers into the Local-Plane vault, never
 * secret bytes. Every method runs under `withOrganizationOnly` so the caller's
 * Organization RLS session (`app_private.same_organization`) is enforced at the
 * database, mirroring `DrizzleTaskManagerStore`.
 */
import { and, count, desc, eq, or } from "drizzle-orm";
import { schema, withOrganizationOnly, type Database } from "@bridge/db";
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
  type DealPilotRuntimeStore,
  type DealPilotStore,
  type DealRecord,
  type RelationKind,
  type SourceRecord,
  type ThesisRecord,
} from "@bridge/dealpilot";

const { dealpilotDeals, dealpilotRelations, dealpilotSources, dealpilotTheses } = schema;

type DealRow = typeof dealpilotDeals.$inferSelect;
type SourceRow = typeof dealpilotSources.$inferSelect;
type ThesisRow = typeof dealpilotTheses.$inferSelect;
type RelationRow = typeof dealpilotRelations.$inferSelect;

function parseStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => String(entry)) : [];
}

function relationKinds(kind: RelationKind): [DealPilotRecordKind, DealPilotRecordKind] {
  if (kind === "deal_source") return ["deal", "source"];
  if (kind === "deal_thesis") return ["deal", "thesis"];
  return ["source", "thesis"];
}

/**
 * The `DealPilotStore` record methods that the public-cloud composite routes to
 * the Cloud-Plane Drizzle store. Everything else on `DealPilotRuntimeStore`
 * (Gmail fetch state, captures, credential operations) is Local-Plane only.
 */
const DEALPILOT_RECORD_METHODS = new Set<string>([
  "createDeal",
  "createSource",
  "createThesis",
  "get",
  "list",
  "updateDeal",
  "updateSource",
  "link",
  "linkSourceThesisWithBackfill",
  "relations",
  "detail",
]);

/**
 * Public-cloud composite `DealPilotStore` -> `DealPilotRuntimeStore` adapter
 * (ADR-151, AP-083). RECORD operations resolve to the Cloud-Plane Drizzle store;
 * every capture / credential / Gmail-fetch runtime operation is refused with a
 * desktop-only error, because those touch Source credentials and raw capture
 * bodies that stay on the Local Plane (canon: "raw capture stays Local").
 *
 * Reachability: in public-cloud mode the deployment boundary
 * (`PUBLIC_CLOUD_PROCEDURES`) already blocks every capture/credential procedure,
 * and the discovery pipeline closures hold the real `LocalDealPilotStore`
 * directly — so a refused method here is defense-in-depth, never the normal
 * path. Only `wiring.dealpilot.store` is backed by this composite.
 */
export function cloudRecordsDealPilotStore(
  records: DealPilotStore,
): DealPilotRuntimeStore {
  const recordFns = records as unknown as Record<string, unknown>;
  return new Proxy({} as DealPilotRuntimeStore, {
    get(_target, prop) {
      // Guard against thenable/iterator probing so this never looks awaitable.
      if (typeof prop !== "string" || prop === "then") return undefined;
      if (DEALPILOT_RECORD_METHODS.has(prop)) {
        const fn = recordFns[prop];
        return typeof fn === "function"
          ? (fn as (...args: unknown[]) => unknown).bind(records)
          : fn;
      }
      return () => {
        throw new DealPilotStoreError(
          "conflict",
          `DealPilot "${prop}" requires the desktop Local Plane and is unavailable from the public cloud API.`,
        );
      };
    },
  });
}

function unpackDeal(row: DealRow): DealRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    kind: "deal",
    company: row.company,
    stage: row.stage as DealRecord["stage"],
    ...(row.revenue != null ? { revenue: row.revenue } : {}),
    ...(row.ebitda != null ? { ebitda: row.ebitda } : {}),
    ...(row.sde != null ? { sde: row.sde } : {}),
    ...(row.askingPrice != null ? { askingPrice: row.askingPrice } : {}),
    ...(row.evidenceHealth
      ? { evidenceHealth: row.evidenceHealth as NonNullable<DealRecord["evidenceHealth"]> }
      : {}),
    ...(row.ownerId ? { ownerId: row.ownerId } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function unpackSource(row: SourceRow): SourceRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    kind: "source",
    name: row.name,
    link: row.link,
    connectionType: row.connectionType as SourceRecord["connectionType"],
    ...(row.credentialRef ? { credentialRef: row.credentialRef } : {}),
    ...(row.credentialOwnerId ? { credentialOwnerId: row.credentialOwnerId } : {}),
    ...(row.lastCheckedAt ? { lastCheckedAt: row.lastCheckedAt.toISOString() } : {}),
    spendCap: row.spendCap,
    spendToDate: row.spendToDate,
    health: row.health as SourceRecord["health"],
    ...(row.schedule ? { schedule: row.schedule } : {}),
    ...(row.yield != null ? { yield: row.yield } : {}),
    rightsState: row.rightsState as SourceRecord["rightsState"],
    ...(row.rightsAttestedAt ? { rightsAttestedAt: row.rightsAttestedAt.toISOString() } : {}),
    ...(row.rightsAttestedBy ? { rightsAttestedBy: row.rightsAttestedBy } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function unpackThesis(row: ThesisRow): ThesisRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    kind: "thesis",
    name: row.name,
    focus: row.focus,
    ...(row.targetCagr != null ? { targetCagr: row.targetCagr } : {}),
    criteria: parseStringArray(row.criteria),
    exclusions: parseStringArray(row.exclusions),
    ...(row.sourcingStrategy ? { sourcingStrategy: row.sourcingStrategy } : {}),
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function unpackRelation(row: RelationRow): DealPilotRelation {
  return {
    id: row.id,
    organizationId: row.organizationId,
    kind: row.kind as RelationKind,
    fromId: row.fromId,
    toId: row.toId,
    confidence: row.confidence,
    provenance: row.provenance,
    evidenceRefs: parseStringArray(row.evidenceRefs),
    createdAt: row.createdAt.toISOString(),
  };
}

export class DrizzleDealPilotStore implements DealPilotStore {
  constructor(private readonly db: Database) {}

  async createDeal(input: CreateDealInput): Promise<DealRecord> {
    return withOrganizationOnly(this.db, input.organizationId, async (tx) => {
      const [row] = await tx
        .insert(dealpilotDeals)
        .values({
          ...(input.id ? { id: input.id } : {}),
          organizationId: input.organizationId,
          company: input.company,
          stage: input.stage ?? "sourced",
          ...(input.revenue != null ? { revenue: input.revenue } : {}),
          ...(input.ebitda != null ? { ebitda: input.ebitda } : {}),
          ...(input.sde != null ? { sde: input.sde } : {}),
          ...(input.askingPrice != null ? { askingPrice: input.askingPrice } : {}),
          ...(input.ownerId ? { ownerId: input.ownerId } : {}),
        })
        .returning();
      if (!row) throw new DealPilotStoreError("conflict", "DealPilot deal insert returned no row");
      return unpackDeal(row);
    });
  }

  async createSource(input: CreateSourceInput): Promise<SourceRecord> {
    return withOrganizationOnly(this.db, input.organizationId, async (tx) => {
      const attested = input.rightsState === "attested";
      const [row] = await tx
        .insert(dealpilotSources)
        .values({
          ...(input.id ? { id: input.id } : {}),
          organizationId: input.organizationId,
          name: input.name,
          link: input.link,
          connectionType: input.connectionType,
          ...(input.credentialRef ? { credentialRef: input.credentialRef } : {}),
          ...(input.credentialOwnerId ? { credentialOwnerId: input.credentialOwnerId } : {}),
          spendCap: input.spendCap,
          spendToDate: 0,
          health: "ready",
          rightsState: input.rightsState,
          ...(attested ? { rightsAttestedAt: new Date() } : {}),
          ...(attested && input.rightsAttestedBy ? { rightsAttestedBy: input.rightsAttestedBy } : {}),
        })
        .returning();
      if (!row) throw new DealPilotStoreError("conflict", "DealPilot source insert returned no row");
      return unpackSource(row);
    });
  }

  async createThesis(input: CreateThesisInput): Promise<ThesisRecord> {
    return withOrganizationOnly(this.db, input.organizationId, async (tx) => {
      const [row] = await tx
        .insert(dealpilotTheses)
        .values({
          organizationId: input.organizationId,
          name: input.name,
          focus: input.focus,
          ...(input.targetCagr != null ? { targetCagr: input.targetCagr } : {}),
          criteria: [...(input.criteria ?? [])],
          exclusions: [...(input.exclusions ?? [])],
          ...(input.sourcingStrategy ? { sourcingStrategy: input.sourcingStrategy } : {}),
          version: 1,
        })
        .returning();
      if (!row) throw new DealPilotStoreError("conflict", "DealPilot thesis insert returned no row");
      return unpackThesis(row);
    });
  }

  async get(
    kind: DealPilotRecordKind,
    organizationId: string,
    id: string,
  ): Promise<DealPilotRecord | null> {
    return withOrganizationOnly(this.db, organizationId, (tx) =>
      this.#getTx(tx, kind, organizationId, id),
    );
  }

  async list(
    page: DealPilotPageId,
    organizationId: string,
    opts: { limit: number; offset: number },
  ): Promise<DealPilotPage> {
    return withOrganizationOnly(this.db, organizationId, async (tx) => {
      if (page === "deals") {
        const where = eq(dealpilotDeals.organizationId, organizationId);
        const [rows, totals] = await Promise.all([
          tx
            .select()
            .from(dealpilotDeals)
            .where(where)
            .orderBy(desc(dealpilotDeals.createdAt), desc(dealpilotDeals.id))
            .limit(opts.limit)
            .offset(opts.offset),
          tx.select({ value: count() }).from(dealpilotDeals).where(where),
        ]);
        const items = rows.map(unpackDeal);
        const total = Number(totals[0]?.value ?? 0);
        return { items, total, hasMore: opts.offset + items.length < total };
      }
      if (page === "sources") {
        const where = eq(dealpilotSources.organizationId, organizationId);
        const [rows, totals] = await Promise.all([
          tx
            .select()
            .from(dealpilotSources)
            .where(where)
            .orderBy(desc(dealpilotSources.createdAt), desc(dealpilotSources.id))
            .limit(opts.limit)
            .offset(opts.offset),
          tx.select({ value: count() }).from(dealpilotSources).where(where),
        ]);
        const items = rows.map(unpackSource);
        const total = Number(totals[0]?.value ?? 0);
        return { items, total, hasMore: opts.offset + items.length < total };
      }
      const where = eq(dealpilotTheses.organizationId, organizationId);
      const [rows, totals] = await Promise.all([
        tx
          .select()
          .from(dealpilotTheses)
          .where(where)
          .orderBy(desc(dealpilotTheses.createdAt), desc(dealpilotTheses.id))
          .limit(opts.limit)
          .offset(opts.offset),
        tx.select({ value: count() }).from(dealpilotTheses).where(where),
      ]);
      const items = rows.map(unpackThesis);
      const total = Number(totals[0]?.value ?? 0);
      return { items, total, hasMore: opts.offset + items.length < total };
    });
  }

  async updateDeal(
    id: string,
    organizationId: string,
    patch: Partial<DealRecord>,
  ): Promise<DealRecord> {
    return withOrganizationOnly(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .update(dealpilotDeals)
        .set({
          ...(patch.company !== undefined ? { company: patch.company } : {}),
          ...(patch.stage !== undefined ? { stage: patch.stage } : {}),
          ...(patch.revenue !== undefined ? { revenue: patch.revenue } : {}),
          ...(patch.ebitda !== undefined ? { ebitda: patch.ebitda } : {}),
          ...(patch.sde !== undefined ? { sde: patch.sde } : {}),
          ...(patch.askingPrice !== undefined ? { askingPrice: patch.askingPrice } : {}),
          ...(patch.evidenceHealth !== undefined ? { evidenceHealth: patch.evidenceHealth } : {}),
          ...(patch.ownerId !== undefined ? { ownerId: patch.ownerId } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(dealpilotDeals.organizationId, organizationId), eq(dealpilotDeals.id, id)))
        .returning();
      if (!row) throw new DealPilotStoreError("not_found", `Deal "${id}" was not found`);
      return unpackDeal(row);
    });
  }

  async updateSource(
    id: string,
    organizationId: string,
    patch: Partial<SourceRecord>,
  ): Promise<SourceRecord> {
    return withOrganizationOnly(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .update(dealpilotSources)
        .set({
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.link !== undefined ? { link: patch.link } : {}),
          ...(patch.connectionType !== undefined ? { connectionType: patch.connectionType } : {}),
          ...(patch.credentialRef !== undefined ? { credentialRef: patch.credentialRef ?? null } : {}),
          ...(patch.credentialOwnerId !== undefined
            ? { credentialOwnerId: patch.credentialOwnerId ?? null }
            : {}),
          ...(patch.lastCheckedAt !== undefined
            ? { lastCheckedAt: patch.lastCheckedAt ? new Date(patch.lastCheckedAt) : null }
            : {}),
          ...(patch.spendCap !== undefined ? { spendCap: patch.spendCap } : {}),
          ...(patch.spendToDate !== undefined ? { spendToDate: patch.spendToDate } : {}),
          ...(patch.health !== undefined ? { health: patch.health } : {}),
          ...(patch.schedule !== undefined ? { schedule: patch.schedule ?? null } : {}),
          ...(patch.yield !== undefined ? { yield: patch.yield ?? null } : {}),
          ...(patch.rightsState !== undefined ? { rightsState: patch.rightsState } : {}),
          ...(patch.rightsAttestedAt !== undefined
            ? { rightsAttestedAt: patch.rightsAttestedAt ? new Date(patch.rightsAttestedAt) : null }
            : {}),
          ...(patch.rightsAttestedBy !== undefined
            ? { rightsAttestedBy: patch.rightsAttestedBy ?? null }
            : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(dealpilotSources.organizationId, organizationId), eq(dealpilotSources.id, id)))
        .returning();
      if (!row) throw new DealPilotStoreError("not_found", `Source "${id}" was not found`);
      return unpackSource(row);
    });
  }

  async link(input: CreateRelationInput): Promise<DealPilotRelation> {
    return withOrganizationOnly(this.db, input.organizationId, (tx) => this.#linkTx(tx, input));
  }

  async linkSourceThesisWithBackfill(
    input: CreateRelationInput & { kind: "source_thesis" },
  ): Promise<DealPilotRelation[]> {
    return withOrganizationOnly(this.db, input.organizationId, async (tx) => {
      const sourceThesis = await this.#linkTx(tx, input);
      const rows = [sourceThesis];
      const sourceRelations = await this.#relationsTx(tx, input.organizationId, input.fromId);
      for (const dealSource of sourceRelations.filter(
        (row) => row.kind === "deal_source" && row.toId === input.fromId,
      )) {
        rows.push(
          await this.#linkTx(tx, {
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
    });
  }

  async relations(organizationId: string, recordId: string): Promise<DealPilotRelation[]> {
    return withOrganizationOnly(this.db, organizationId, (tx) =>
      this.#relationsTx(tx, organizationId, recordId),
    );
  }

  async detail(
    kind: DealPilotRecordKind,
    organizationId: string,
    id: string,
    bindings: DealPilotBindings,
  ): Promise<DealPilotRecordDetail | null> {
    return withOrganizationOnly(this.db, organizationId, async (tx) => {
      const record = await this.#getTx(tx, kind, organizationId, id);
      if (!record) return null;
      const relations = await this.#relationsTx(tx, organizationId, id);
      const relatedRecords: DealPilotRecord[] = [];
      for (const relation of relations) {
        const otherId = relation.fromId === id ? relation.toId : relation.fromId;
        const [fromKind, toKind] = relationKinds(relation.kind);
        const otherKind = relation.fromId === id ? toKind : fromKind;
        const related = await this.#getTx(tx, otherKind, organizationId, otherId);
        if (related) relatedRecords.push(related);
      }
      return {
        record,
        relations,
        relatedRecords,
        sections: dealPilotModuleManifest(bindings).recordDetail[kind],
      };
    });
  }

  async #getTx(
    tx: Database,
    kind: DealPilotRecordKind,
    organizationId: string,
    id: string,
  ): Promise<DealPilotRecord | null> {
    if (kind === "deal") {
      const [row] = await tx
        .select()
        .from(dealpilotDeals)
        .where(and(eq(dealpilotDeals.organizationId, organizationId), eq(dealpilotDeals.id, id)))
        .limit(1);
      return row ? unpackDeal(row) : null;
    }
    if (kind === "source") {
      const [row] = await tx
        .select()
        .from(dealpilotSources)
        .where(and(eq(dealpilotSources.organizationId, organizationId), eq(dealpilotSources.id, id)))
        .limit(1);
      return row ? unpackSource(row) : null;
    }
    const [row] = await tx
      .select()
      .from(dealpilotTheses)
      .where(and(eq(dealpilotTheses.organizationId, organizationId), eq(dealpilotTheses.id, id)))
      .limit(1);
    return row ? unpackThesis(row) : null;
  }

  async #relationsTx(
    tx: Database,
    organizationId: string,
    recordId: string,
  ): Promise<DealPilotRelation[]> {
    const rows = await tx
      .select()
      .from(dealpilotRelations)
      .where(
        and(
          eq(dealpilotRelations.organizationId, organizationId),
          or(eq(dealpilotRelations.fromId, recordId), eq(dealpilotRelations.toId, recordId)),
        ),
      );
    return rows.map(unpackRelation);
  }

  async #linkTx(tx: Database, input: CreateRelationInput): Promise<DealPilotRelation> {
    const [fromKind, toKind] = relationKinds(input.kind);
    const [fromRecord, toRecord] = await Promise.all([
      this.#getTx(tx, fromKind, input.organizationId, input.fromId),
      this.#getTx(tx, toKind, input.organizationId, input.toId),
    ]);
    if (!fromRecord || !toRecord) {
      throw new DealPilotStoreError(
        "invalid_relation",
        `${input.kind} requires existing ${fromKind} and ${toKind} Records in the same Organization`,
      );
    }
    const clamped = Math.max(0, Math.min(1, input.confidence));
    const [existing] = await tx
      .select()
      .from(dealpilotRelations)
      .where(
        and(
          eq(dealpilotRelations.organizationId, input.organizationId),
          eq(dealpilotRelations.kind, input.kind),
          eq(dealpilotRelations.fromId, input.fromId),
          eq(dealpilotRelations.toId, input.toId),
        ),
      )
      .limit(1);
    if (existing) {
      const mergedEvidence = [
        ...new Set([...parseStringArray(existing.evidenceRefs), ...(input.evidenceRefs ?? [])]),
      ];
      const [updated] = await tx
        .update(dealpilotRelations)
        .set({ confidence: Math.max(existing.confidence, clamped), evidenceRefs: mergedEvidence })
        .where(eq(dealpilotRelations.id, existing.id))
        .returning();
      return unpackRelation(updated!);
    }
    const [inserted] = await tx
      .insert(dealpilotRelations)
      .values({
        organizationId: input.organizationId,
        kind: input.kind,
        fromId: input.fromId,
        toId: input.toId,
        confidence: clamped,
        provenance: input.provenance,
        evidenceRefs: [...(input.evidenceRefs ?? [])],
      })
      .returning();
    return unpackRelation(inserted!);
  }
}
