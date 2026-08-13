/**
 * DrizzleEventsStore — NetworkManager's Events sub-module (TASK-068, ADR-231).
 * Plain organization-authenticated CRUD over `conference_events`. Speaker
 * extraction writing into `people`/`edges` is a later phase of TASK-068, not
 * this store.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, count } from "drizzle-orm";
import type { Database } from "./client.js";
import { conferenceEvents } from "./schema.js";
import { withOrganizationOnly } from "./organization-context.js";

export interface PageOpts {
  limit: number;
  offset: number;
}
export interface Page<T> {
  items: T[];
  total: number;
}

export type ConferenceEventRow = typeof conferenceEvents.$inferSelect;

export interface CreateConferenceEventInput {
  organizationId: string;
  name: string;
  url?: string;
  type?: string;
  startsAt?: Date;
  endsAt?: Date;
  location?: string;
}

export class DrizzleEventsStore {
  #db: Database;
  constructor(db: Database) {
    this.#db = db;
  }

  async create(input: CreateConferenceEventInput): Promise<ConferenceEventRow> {
    return withOrganizationOnly(this.#db, input.organizationId, async (tx) => {
      const [row] = await tx
        .insert(conferenceEvents)
        .values({
          id: randomUUID(),
          organizationId: input.organizationId,
          name: input.name,
          ...(input.url ? { url: input.url } : {}),
          ...(input.type ? { type: input.type } : {}),
          ...(input.startsAt ? { startsAt: input.startsAt } : {}),
          ...(input.endsAt ? { endsAt: input.endsAt } : {}),
          ...(input.location ? { location: input.location } : {}),
        })
        .returning();
      return row!;
    });
  }

  async list(organizationId: string, opts: PageOpts): Promise<Page<ConferenceEventRow>> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
      const where = eq(conferenceEvents.organizationId, organizationId);
      const [rows, totalRows] = await Promise.all([
        tx.select().from(conferenceEvents).where(where).orderBy(desc(conferenceEvents.createdAt)).limit(opts.limit).offset(opts.offset),
        tx.select({ value: count() }).from(conferenceEvents).where(where),
      ]);
      return { items: rows, total: Number(totalRows[0]?.value ?? 0) };
    });
  }

  async update(
    id: string,
    organizationId: string,
    patch: Partial<Omit<CreateConferenceEventInput, "organizationId">> & { status?: string; extractionStatus?: string },
  ): Promise<ConferenceEventRow | null> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
      const [row] = await tx
        .update(conferenceEvents)
        .set({
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.url !== undefined ? { url: patch.url } : {}),
          ...(patch.type !== undefined ? { type: patch.type } : {}),
          ...(patch.startsAt !== undefined ? { startsAt: patch.startsAt } : {}),
          ...(patch.endsAt !== undefined ? { endsAt: patch.endsAt } : {}),
          ...(patch.location !== undefined ? { location: patch.location } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.extractionStatus !== undefined ? { extractionStatus: patch.extractionStatus } : {}),
        })
        .where(and(eq(conferenceEvents.id, id), eq(conferenceEvents.organizationId, organizationId)))
        .returning();
      return row ?? null;
    });
  }
}
