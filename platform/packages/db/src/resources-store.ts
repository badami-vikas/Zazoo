/**
 * DrizzleResourcesStore — platform-side home for the prototype's Resources page,
 * which previously read `resources_canonical` directly from Supabase, bypassing
 * the governed API entirely (frontend-migration-scoping.md gap #4). Plain
 * workspace-authenticated CRUD, same tier as workspace membership — pinning a
 * book/podcast/vlog has no external effect requiring approval.
 */
import { randomUUID } from "node:crypto";
import { desc, eq, count } from "drizzle-orm";
import type { Database } from "./client.js";
import { resources } from "./schema.js";

export interface PageOpts {
  limit: number;
  offset: number;
}
export interface Page<T> {
  items: T[];
  total: number;
}

export type ResourceRow = typeof resources.$inferSelect;

export interface CreateResourceInput {
  workspaceId: string;
  title: string;
  kind: string;
  url?: string;
  notes?: string;
  tags?: string[];
}

export class DrizzleResourcesStore {
  #db: Database;
  constructor(db: Database) {
    this.#db = db;
  }

  async create(input: CreateResourceInput): Promise<ResourceRow> {
    const [row] = await this.#db
      .insert(resources)
      .values({
        id: randomUUID(),
        workspaceId: input.workspaceId,
        title: input.title,
        kind: input.kind,
        ...(input.url ? { url: input.url } : {}),
        ...(input.notes ? { notes: input.notes } : {}),
        tags: input.tags ?? [],
      })
      .returning();
    return row!;
  }

  async list(workspaceId: string, opts: PageOpts): Promise<Page<ResourceRow>> {
    const where = eq(resources.workspaceId, workspaceId);
    const [rows, totalRows] = await Promise.all([
      this.#db.select().from(resources).where(where).orderBy(desc(resources.createdAt)).limit(opts.limit).offset(opts.offset),
      this.#db.select({ value: count() }).from(resources).where(where),
    ]);
    return { items: rows, total: Number(totalRows[0]?.value ?? 0) };
  }
}
