/**
 * DrizzleAuthoredModuleStore — persistence for Modules the owner authored
 * through Chief of Staff (see `@bridge/core`'s `module/authoring.ts`).
 *
 * A built-in Module gets its own table and its own migration. An authored one
 * cannot: the person asking for it is waiting. So the DECLARED shape lives in
 * `authored_databases.columns` and the rows live in `authored_records.
 * properties`, with `validateAuthoredRecord` enforcing the shape at the API
 * seam — jsonb is not self-checking, so nothing may write here unvalidated.
 *
 * `createDatabases` is idempotent on (organization, module, database): the
 * governed approval that installs a Module may be retried, and a retry must
 * not mint a second Database or orphan the Records already in the first.
 */
import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, isNull } from "drizzle-orm";
import type { Database } from "./client.js";
import { authoredDatabases, authoredRecords } from "./schema.js";
import { withOrganizationOnly } from "./organization-context.js";

export type AuthoredDatabaseRow = typeof authoredDatabases.$inferSelect;
export type AuthoredRecordRow = typeof authoredRecords.$inferSelect;

export interface AuthoredDatabaseInput {
  databaseId: string;
  capabilityId: string;
  label: string;
  /** AuthoredColumnSpec[] from the approved spec — stored verbatim. */
  columns: unknown[];
}

export interface AuthoredRecordPage {
  items: AuthoredRecordRow[];
  total: number;
}

export interface AuthoredModuleStore {
  createDatabases(
    organizationId: string,
    moduleName: string,
    databases: readonly AuthoredDatabaseInput[],
  ): Promise<AuthoredDatabaseRow[]>;
  listDatabases(organizationId: string, moduleName: string): Promise<AuthoredDatabaseRow[]>;
  getDatabase(
    organizationId: string,
    moduleName: string,
    databaseId: string,
  ): Promise<AuthoredDatabaseRow | null>;
  listRecords(
    organizationId: string,
    databaseRowId: string,
    page?: { limit: number; offset: number },
  ): Promise<AuthoredRecordPage>;
  createRecord(
    organizationId: string,
    databaseRowId: string,
    properties: Record<string, unknown>,
  ): Promise<AuthoredRecordRow>;
  updateRecord(
    organizationId: string,
    recordId: string,
    properties: Record<string, unknown>,
  ): Promise<AuthoredRecordRow | null>;
  archiveRecord(organizationId: string, recordId: string): Promise<AuthoredRecordRow | null>;
}

const DEFAULT_PAGE = { limit: 200, offset: 0 };

export class DrizzleAuthoredModuleStore implements AuthoredModuleStore {
  #db: Database;
  constructor(db: Database) {
    this.#db = db;
  }

  async createDatabases(
    organizationId: string,
    moduleName: string,
    databases: readonly AuthoredDatabaseInput[],
  ): Promise<AuthoredDatabaseRow[]> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
      const out: AuthoredDatabaseRow[] = [];
      for (const database of databases) {
        const [existing] = await tx
          .select()
          .from(authoredDatabases)
          .where(
            and(
              eq(authoredDatabases.organizationId, organizationId),
              eq(authoredDatabases.moduleName, moduleName),
              eq(authoredDatabases.databaseId, database.databaseId),
            ),
          )
          .limit(1);
        if (existing) {
          out.push(existing);
          continue;
        }
        const [row] = await tx
          .insert(authoredDatabases)
          .values({
            id: randomUUID(),
            organizationId,
            moduleName,
            databaseId: database.databaseId,
            capabilityId: database.capabilityId,
            label: database.label,
            columns: database.columns,
          })
          .returning();
        out.push(row!);
      }
      return out;
    });
  }

  async listDatabases(organizationId: string, moduleName: string): Promise<AuthoredDatabaseRow[]> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) =>
      tx
        .select()
        .from(authoredDatabases)
        .where(
          and(
            eq(authoredDatabases.organizationId, organizationId),
            eq(authoredDatabases.moduleName, moduleName),
            isNull(authoredDatabases.archivedAt),
          ),
        )
        .orderBy(asc(authoredDatabases.createdAt)),
    );
  }

  async getDatabase(
    organizationId: string,
    moduleName: string,
    databaseId: string,
  ): Promise<AuthoredDatabaseRow | null> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
      const [row] = await tx
        .select()
        .from(authoredDatabases)
        .where(
          and(
            eq(authoredDatabases.organizationId, organizationId),
            eq(authoredDatabases.moduleName, moduleName),
            eq(authoredDatabases.databaseId, databaseId),
            isNull(authoredDatabases.archivedAt),
          ),
        )
        .limit(1);
      return row ?? null;
    });
  }

  async listRecords(
    organizationId: string,
    databaseRowId: string,
    page: { limit: number; offset: number } = DEFAULT_PAGE,
  ): Promise<AuthoredRecordPage> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
      const where = and(
        eq(authoredRecords.organizationId, organizationId),
        eq(authoredRecords.databaseRowId, databaseRowId),
        isNull(authoredRecords.archivedAt),
      );
      const items = await tx
        .select()
        .from(authoredRecords)
        .where(where)
        .orderBy(desc(authoredRecords.createdAt))
        .limit(page.limit)
        .offset(page.offset);
      const [totalRow] = await tx.select({ value: count() }).from(authoredRecords).where(where);
      return { items, total: Number(totalRow?.value ?? 0) };
    });
  }

  async createRecord(
    organizationId: string,
    databaseRowId: string,
    properties: Record<string, unknown>,
  ): Promise<AuthoredRecordRow> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
      const [row] = await tx
        .insert(authoredRecords)
        .values({ id: randomUUID(), organizationId, databaseRowId, properties })
        .returning();
      return row!;
    });
  }

  async updateRecord(
    organizationId: string,
    recordId: string,
    properties: Record<string, unknown>,
  ): Promise<AuthoredRecordRow | null> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
      const [row] = await tx
        .update(authoredRecords)
        .set({ properties, updatedAt: new Date() })
        .where(
          and(
            eq(authoredRecords.organizationId, organizationId),
            eq(authoredRecords.id, recordId),
            isNull(authoredRecords.archivedAt),
          ),
        )
        .returning();
      return row ?? null;
    });
  }

  /** Soft delete — the schema's standing rule is archived_at, never DELETE. */
  async archiveRecord(organizationId: string, recordId: string): Promise<AuthoredRecordRow | null> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
      const [row] = await tx
        .update(authoredRecords)
        .set({ archivedAt: new Date() })
        .where(
          and(
            eq(authoredRecords.organizationId, organizationId),
            eq(authoredRecords.id, recordId),
            isNull(authoredRecords.archivedAt),
          ),
        )
        .returning();
      return row ?? null;
    });
  }
}
