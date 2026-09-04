/**
 * DrizzleShareGrantStore — binds the core `ShareGrantStore` port
 * (@bridge/core's share-grant.ts) to `share_grants` (TASK-064, migration 0048).
 *
 * Scoped the same way every other store here is: an explicit predicate on every
 * statement AND `withOrganizationContext`, so the FORCE-RLS policies apply at
 * the database itself.
 *
 * ONE DELIBERATE EXCEPTION: `findByToken` runs unscoped, because the token IS
 * the scope. That is the Helpdesk trust model this generalizes — a link holder
 * has no session and no organization to set — so the caller receives the grant
 * and everything downstream is decided from the grant's own organization.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import {
  ShareGrantNotFoundError,
  SHARE_ACCESS_LEVELS,
  SHARE_TARGET_KINDS,
  type ShareAccessLevel,
  type ShareGrantRecord,
  type ShareGrantStore,
  type ShareTargetKind,
} from "@bridge/core";
import type { Database } from "./client.js";
import { shareGrants } from "./schema.js";
import { withOrganizationContext } from "./organization-context.js";

function parseLevel(raw: string): ShareAccessLevel {
  if (!(SHARE_ACCESS_LEVELS as readonly string[]).includes(raw)) {
    throw new Error(`Invalid share_grants.access_level: ${raw}`);
  }
  return raw as ShareAccessLevel;
}

function parseKind(raw: string): ShareTargetKind {
  if (!(SHARE_TARGET_KINDS as readonly string[]).includes(raw)) {
    throw new Error(`Invalid share_grants.target_kind: ${raw}`);
  }
  return raw as ShareTargetKind;
}

function unpack(row: typeof shareGrants.$inferSelect): ShareGrantRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    targetKind: parseKind(row.targetKind),
    targetId: row.targetId,
    granteeUserId: row.granteeUserId,
    accessToken: row.accessToken,
    accessLevel: parseLevel(row.accessLevel),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

export class DrizzleShareGrantStore implements ShareGrantStore {
  #db: Database;
  constructor(db: Database) {
    this.#db = db;
  }

  #scoped<T>(
    organizationId: string,
    userId: string,
    operation: (tx: Database) => Promise<T>,
  ): Promise<T> {
    return withOrganizationContext(this.#db, { organizationId, userId }, operation);
  }

  async listForTarget(
    organizationId: string,
    actingUserId: string,
    targetKind: ShareTargetKind,
    targetId: string,
  ): Promise<ShareGrantRecord[]> {
    return this.#scoped(organizationId, actingUserId, async (tx) => {
      const rows = await tx
        .select()
        .from(shareGrants)
        .where(
          and(
            eq(shareGrants.organizationId, organizationId),
            eq(shareGrants.targetKind, targetKind),
            eq(shareGrants.targetId, targetId),
          ),
        )
        .orderBy(asc(shareGrants.createdAt), asc(shareGrants.id));
      return rows.map(unpack);
    });
  }

  async listForGrantee(
    organizationId: string,
    granteeUserId: string,
  ): Promise<ShareGrantRecord[]> {
    return this.#scoped(organizationId, granteeUserId, async (tx) => {
      const rows = await tx
        .select()
        .from(shareGrants)
        .where(
          and(
            eq(shareGrants.organizationId, organizationId),
            eq(shareGrants.granteeUserId, granteeUserId),
            isNull(shareGrants.revokedAt),
          ),
        )
        .orderBy(asc(shareGrants.createdAt), asc(shareGrants.id));
      return rows.map(unpack);
    });
  }

  async findByToken(accessToken: string): Promise<ShareGrantRecord | null> {
    const rows = await this.#db
      .select()
      .from(shareGrants)
      .where(eq(shareGrants.accessToken, accessToken))
      .limit(1);
    return rows[0] ? unpack(rows[0]) : null;
  }

  async create(record: ShareGrantRecord): Promise<ShareGrantRecord> {
    return this.#scoped(record.organizationId, record.createdByUserId, async (tx) => {
      const [row] = await tx
        .insert(shareGrants)
        .values({
          id: record.id,
          organizationId: record.organizationId,
          targetKind: record.targetKind,
          targetId: record.targetId,
          granteeUserId: record.granteeUserId,
          accessToken: record.accessToken,
          accessLevel: record.accessLevel,
          expiresAt: record.expiresAt ? new Date(record.expiresAt) : null,
          revokedAt: null,
          createdByUserId: record.createdByUserId,
          createdAt: new Date(record.createdAt),
        })
        .returning();
      if (!row) throw new Error("share_grants insert returned no row");
      return unpack(row);
    });
  }

  async revoke(
    organizationId: string,
    actingUserId: string,
    id: string,
    revokedAtISO: string,
  ): Promise<ShareGrantRecord> {
    return this.#scoped(organizationId, actingUserId, async (tx) => {
      // Only the still-live rows are touched, so a second revoke keeps the
      // first instant instead of quietly rewriting when access ended.
      await tx
        .update(shareGrants)
        .set({ revokedAt: new Date(revokedAtISO) })
        .where(
          and(
            eq(shareGrants.organizationId, organizationId),
            eq(shareGrants.id, id),
            isNull(shareGrants.revokedAt),
          ),
        );
      const rows = await tx
        .select()
        .from(shareGrants)
        .where(and(eq(shareGrants.organizationId, organizationId), eq(shareGrants.id, id)))
        .limit(1);
      if (!rows[0]) throw new ShareGrantNotFoundError(id);
      return unpack(rows[0]);
    });
  }
}
