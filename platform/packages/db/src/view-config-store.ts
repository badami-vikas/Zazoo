/**
 * DrizzleViewConfigStore — binds the core `ViewConfigStore` port
 * (@bridge/core's view-config.ts) to `view_configs` (TASK-062, migration 0047).
 *
 * Scoping is enforced twice, deliberately, the same way the chat and Research
 * Run stores do it: every statement carries its explicit predicate AND runs
 * inside `withOrganizationContext`, so the FORCE-RLS policies apply at the
 * database itself. Reads deliberately use a WIDER predicate than writes — an
 * `organization`-scoped View is readable by every member and writable only by
 * its owner — which is the same asymmetry the policies encode.
 */
import { and, asc, eq, ne, or } from "drizzle-orm";
import { z } from "zod";
import {
  SavedViewNameTakenError,
  SavedViewNotFoundError,
  SAVED_VIEW_SCOPES,
  type SavedViewRecord,
  type SavedViewScope,
  type SavedViewUpdate,
  type ViewConfigStore,
} from "@bridge/core";
import type { Database } from "./client.js";
import { viewConfigs } from "./schema.js";
import { withOrganizationContext } from "./organization-context.js";

const hiddenColumnsSchema = z.array(z.string());

function parseScope(raw: string): SavedViewScope {
  if (!(SAVED_VIEW_SCOPES as readonly string[]).includes(raw)) {
    throw new Error(`Invalid view_configs.scope: ${raw}`);
  }
  return raw as SavedViewScope;
}

function unpack(row: typeof viewConfigs.$inferSelect): SavedViewRecord {
  const hidden = hiddenColumnsSchema.safeParse(row.hiddenColumns ?? []);
  if (!hidden.success) {
    throw new Error(`Invalid view_configs.hidden_columns jsonb: ${hidden.error.message}`);
  }
  return {
    id: row.id,
    organizationId: row.organizationId,
    ownerUserId: row.ownerUserId,
    databaseId: row.databaseId,
    name: row.name,
    scope: parseScope(row.scope),
    config: row.config,
    hiddenColumns: hidden.data,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Postgres reports the one-name-per-Database-per-owner constraint by name;
 * translating it here keeps "already taken" a domain error rather than a
 * driver error the router would have to sniff. */
function isNameConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    /view_configs_owner_name_uq/.test(`${error.message}${(error as { detail?: string }).detail ?? ""}`)
  );
}

export class DrizzleViewConfigStore implements ViewConfigStore {
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

  /**
   * One View by id. The predicate is org + id ONLY: which of those rows this
   * caller may actually read is decided by the `view_configs_read` policy —
   * owner, `organization` scope, or a live share grant (TASK-064, migration
   * 0048). Duplicating that rule here would be a second place for it to drift.
   */
  async get(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<SavedViewRecord | null> {
    return this.#scoped(organizationId, userId, async (tx) => {
      const rows = await tx
        .select()
        .from(viewConfigs)
        .where(and(eq(viewConfigs.organizationId, organizationId), eq(viewConfigs.id, id)))
        .limit(1);
      return rows[0] ? unpack(rows[0]) : null;
    });
  }

  async list(
    organizationId: string,
    userId: string,
    databaseId: string,
  ): Promise<SavedViewRecord[]> {
    return this.#scoped(organizationId, userId, async (tx) => {
      const rows = await tx
        .select()
        .from(viewConfigs)
        .where(
          and(
            eq(viewConfigs.organizationId, organizationId),
            eq(viewConfigs.databaseId, databaseId),
            or(
              eq(viewConfigs.ownerUserId, userId),
              eq(viewConfigs.scope, "organization"),
            ),
          ),
        )
        .orderBy(asc(viewConfigs.name), asc(viewConfigs.id));
      return rows.map(unpack);
    });
  }

  async create(record: SavedViewRecord): Promise<SavedViewRecord> {
    return this.#scoped(record.organizationId, record.ownerUserId, async (tx) => {
      try {
        const [row] = await tx
          .insert(viewConfigs)
          .values({
            id: record.id,
            organizationId: record.organizationId,
            ownerUserId: record.ownerUserId,
            databaseId: record.databaseId,
            name: record.name,
            scope: record.scope,
            config: record.config,
            hiddenColumns: [...record.hiddenColumns],
            isDefault: record.isDefault ?? false,
            createdAt: new Date(record.createdAt),
            updatedAt: new Date(record.updatedAt),
          })
          .returning();
        if (!row) throw new Error("view_configs insert returned no row");
        return unpack(row);
      } catch (error) {
        if (isNameConflict(error)) throw new SavedViewNameTakenError(record.name);
        throw error;
      }
    });
  }

  async update(
    organizationId: string,
    ownerUserId: string,
    id: string,
    update: SavedViewUpdate,
    updatedAtISO: string,
  ): Promise<SavedViewRecord> {
    return this.#scoped(organizationId, ownerUserId, async (tx) => {
      try {
        // Demotion runs BEFORE promotion: the partial unique index is checked
        // at the end of each statement, so promoting first would collide with
        // the outgoing default instead of replacing it.
        if (update.isDefault === true) {
          const [target] = await tx
            .select({ databaseId: viewConfigs.databaseId })
            .from(viewConfigs)
            .where(
              and(
                eq(viewConfigs.organizationId, organizationId),
                eq(viewConfigs.ownerUserId, ownerUserId),
                eq(viewConfigs.id, id),
              ),
            )
            .limit(1);
          if (!target) throw new SavedViewNotFoundError(id);
          await tx
            .update(viewConfigs)
            .set({ isDefault: false })
            .where(
              and(
                eq(viewConfigs.organizationId, organizationId),
                eq(viewConfigs.ownerUserId, ownerUserId),
                eq(viewConfigs.databaseId, target.databaseId),
                ne(viewConfigs.id, id),
                eq(viewConfigs.isDefault, true),
              ),
            );
        }
        const [row] = await tx
          .update(viewConfigs)
          .set({
            ...(update.name !== undefined ? { name: update.name } : {}),
            ...(update.scope !== undefined ? { scope: update.scope } : {}),
            ...(update.config !== undefined ? { config: update.config } : {}),
            ...(update.hiddenColumns !== undefined
              ? { hiddenColumns: [...update.hiddenColumns] }
              : {}),
            ...(update.isDefault !== undefined ? { isDefault: update.isDefault } : {}),
            updatedAt: new Date(updatedAtISO),
          })
          .where(
            and(
              eq(viewConfigs.organizationId, organizationId),
              eq(viewConfigs.ownerUserId, ownerUserId),
              eq(viewConfigs.id, id),
            ),
          )
          .returning();
        // No row means it does not exist OR belongs to someone else. Both
        // report as not-found: the caller has no business learning which.
        if (!row) throw new SavedViewNotFoundError(id);
        return unpack(row);
      } catch (error) {
        if (isNameConflict(error)) {
          throw new SavedViewNameTakenError(update.name ?? id);
        }
        throw error;
      }
    });
  }

  async remove(organizationId: string, ownerUserId: string, id: string): Promise<void> {
    await this.#scoped(organizationId, ownerUserId, async (tx) => {
      const rows = await tx
        .delete(viewConfigs)
        .where(
          and(
            eq(viewConfigs.organizationId, organizationId),
            eq(viewConfigs.ownerUserId, ownerUserId),
            eq(viewConfigs.id, id),
          ),
        )
        .returning();
      if (rows.length === 0) throw new SavedViewNotFoundError(id);
    });
  }
}
