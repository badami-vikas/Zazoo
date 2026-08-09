/**
 * DrizzleClaimStore — binds @bridge/core's `ClaimStorePort` (K3,
 * TASK-047) to the `claim_entities`/`claims` tables.
 *
 * Owner scoping is pushed into every WHERE: claims are personal knowledge
 * (memories-style), so every read and write predicates on
 * (organization_id, owner_user_id) — a caller never sees another owner's rows.
 *
 * `materializeClaim` is the supersedence seam: inserting a claim for an
 * (entity, field) that already has a LIVE claim invalidates the predecessor
 * in the same transaction — `superseded_by` + bi-temporal `valid_to`/
 * `invalidated_at` — never deletes it. `deleteClaim` (the user's forget path)
 * is the only true delete.
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type {
  ClaimEvidenceRef,
  ClaimRecord,
  ClaimEntityKind,
  ClaimEntityRecord,
  ClaimStorePort,
  MaterializeClaimInput,
  ProposableClaimClass,
  TaintLabel,
  TaintSensitivity,
} from "@bridge/core";
import type { Database } from "./client.js";
import { claimRows, claimEntities } from "./schema.js";

type EntityRow = typeof claimEntities.$inferSelect;
type ClaimRow = typeof claimRows.$inferSelect;

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function unpackEntity(row: EntityRow): ClaimEntityRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    ownerUserId: row.ownerUserId,
    kind: row.kind as ClaimEntityKind,
    name: row.name,
    refRecordId: row.refRecordId ?? null,
    createdAt: row.createdAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

function unpackClaim(row: ClaimRow): ClaimRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    ownerUserId: row.ownerUserId,
    entityId: row.entityId,
    field: row.field,
    value: row.value,
    claimClass: row.claimClass as ProposableClaimClass,
    sensitivity: row.sensitivity as TaintSensitivity,
    evidence: (row.evidence ?? []) as ClaimEvidenceRef[],
    taintLabel: (row.taintLabel ?? null) as TaintLabel | null,
    validFrom: row.validFrom.toISOString(),
    validTo: row.validTo?.toISOString() ?? null,
    recordedAt: row.recordedAt.toISOString(),
    invalidatedAt: row.invalidatedAt?.toISOString() ?? null,
    supersededBy: row.supersededBy ?? null,
    decisionRef: row.decisionRef,
    createdBy: row.createdBy,
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

export class DrizzleClaimStore implements ClaimStorePort {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async ensureEntity(input: {
    organizationId: string;
    ownerUserId: string;
    kind: ClaimEntityKind;
    name: string;
    refRecordId?: string | null;
  }): Promise<ClaimEntityRecord> {
    const name = normalizeName(input.name);
    const owned = and(
      eq(claimEntities.organizationId, input.organizationId),
      eq(claimEntities.ownerUserId, input.ownerUserId),
      eq(claimEntities.kind, input.kind),
      eq(claimEntities.name, name),
    );
    const [existing] = await this.#db.select().from(claimEntities).where(owned).limit(1);
    if (existing) return unpackEntity(existing);
    const [inserted] = await this.#db
      .insert(claimEntities)
      .values({
        organizationId: input.organizationId,
        ownerUserId: input.ownerUserId,
        kind: input.kind,
        name,
        refRecordId: input.refRecordId ?? null,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted) return unpackEntity(inserted);
    // Concurrent create won the unique index — read the winner.
    const [winner] = await this.#db.select().from(claimEntities).where(owned).limit(1);
    if (!winner) throw new Error("claims: entity upsert lost a race and found no winner");
    return unpackEntity(winner);
  }

  async materializeClaim(
    input: MaterializeClaimInput,
  ): Promise<{ claim: ClaimRecord; supersededClaimId: string | null }> {
    const now = input.now ? new Date(input.now) : new Date();
    const entity = await this.ensureEntity({
      organizationId: input.organizationId,
      ownerUserId: input.ownerUserId,
      kind: input.claim.entity.kind,
      name: input.claim.entity.name,
      refRecordId: input.claim.entity.refRecordId ?? null,
    });
    return this.#db.transaction(async (tx) => {
      const [live] = await tx
        .select()
        .from(claimRows)
        .where(
          and(
            eq(claimRows.organizationId, input.organizationId),
            eq(claimRows.ownerUserId, input.ownerUserId),
            eq(claimRows.entityId, entity.id),
            eq(claimRows.field, input.claim.field),
            isNull(claimRows.supersededBy),
            isNull(claimRows.invalidatedAt),
          ),
        )
        .limit(1);
      const [inserted] = await tx
        .insert(claimRows)
        .values({
          organizationId: input.organizationId,
          ownerUserId: input.ownerUserId,
          entityId: entity.id,
          field: input.claim.field,
          value: input.claim.value,
          claimClass: input.claim.claimClass,
          sensitivity: input.claim.sensitivity,
          evidence: input.claim.evidence,
          taintLabel: input.claim.taintLabel ?? null,
          validFrom: input.claim.validFrom ? new Date(input.claim.validFrom) : now,
          recordedAt: now,
          decisionRef: input.decisionRef,
          createdBy: input.createdBy,
        })
        .returning();
      if (!inserted) throw new Error("claims: claim insert returned no row");
      if (live) {
        await tx
          .update(claimRows)
          .set({ supersededBy: inserted.id, validTo: now, invalidatedAt: now })
          .where(eq(claimRows.id, live.id));
      }
      return { claim: unpackClaim(inserted), supersededClaimId: live?.id ?? null };
    });
  }

  async listEntities(
    organizationId: string,
    ownerUserId: string,
  ): Promise<Array<ClaimEntityRecord & { liveClaimCount: number }>> {
    const rows = await this.#db
      .select({
        entity: claimEntities,
        liveClaimCount: sql<number>`count(${claimRows.id}) filter (where ${claimRows.supersededBy} is null and ${claimRows.invalidatedAt} is null)`,
      })
      .from(claimEntities)
      .leftJoin(claimRows, eq(claimRows.entityId, claimEntities.id))
      .where(
        and(
          eq(claimEntities.organizationId, organizationId),
          eq(claimEntities.ownerUserId, ownerUserId),
          isNull(claimEntities.archivedAt),
        ),
      )
      .groupBy(claimEntities.id)
      .orderBy(desc(claimEntities.createdAt));
    return rows.map((row) => ({ ...unpackEntity(row.entity), liveClaimCount: Number(row.liveClaimCount) }));
  }

  async liveClaims(
    organizationId: string,
    ownerUserId: string,
    filter?: { entityId?: string },
  ): Promise<ClaimRecord[]> {
    const rows = await this.#db
      .select()
      .from(claimRows)
      .where(
        and(
          eq(claimRows.organizationId, organizationId),
          eq(claimRows.ownerUserId, ownerUserId),
          isNull(claimRows.supersededBy),
          isNull(claimRows.invalidatedAt),
          isNull(claimRows.archivedAt),
          ...(filter?.entityId ? [eq(claimRows.entityId, filter.entityId)] : []),
        ),
      )
      .orderBy(desc(claimRows.recordedAt));
    return rows.map(unpackClaim);
  }

  async claimHistory(
    organizationId: string,
    ownerUserId: string,
    entityId: string,
    field: string,
  ): Promise<ClaimRecord[]> {
    const rows = await this.#db
      .select()
      .from(claimRows)
      .where(
        and(
          eq(claimRows.organizationId, organizationId),
          eq(claimRows.ownerUserId, ownerUserId),
          eq(claimRows.entityId, entityId),
          eq(claimRows.field, field),
        ),
      )
      .orderBy(desc(claimRows.recordedAt));
    return rows.map(unpackClaim);
  }

  async deleteClaim(organizationId: string, ownerUserId: string, claimId: string): Promise<boolean> {
    return this.#db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(claimRows)
        .where(
          and(
            eq(claimRows.id, claimId),
            eq(claimRows.organizationId, organizationId),
            eq(claimRows.ownerUserId, ownerUserId),
          ),
        )
        .limit(1);
      if (!row) return false;
      // Forgetting the row a predecessor points at must not dangle the
      // lineage: clear inbound superseded_by refs first.
      await tx
        .update(claimRows)
        .set({ supersededBy: null })
        .where(eq(claimRows.supersededBy, claimId));
      await tx.delete(claimRows).where(eq(claimRows.id, claimId));
      return true;
    });
  }
}
