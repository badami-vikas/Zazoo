/**
 * DrizzleRecordMetadataStore — the Event-log read behind the four derived
 * metadata columns (TASK-063).
 *
 * It is a READ over `events` and nothing else: created/last-edited are a
 * projection of the append-only log, never a second copy on the Record row that
 * could disagree with it. The fold itself lives in the API (`record-metadata.ts`)
 * so it can be tested without a database; this file only fetches.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Database } from "./client.js";
import { events } from "./schema.js";
import { withOrganizationContext } from "./organization-context.js";

export interface RecordMetadataEvent {
  entityId: string;
  createdAt: string;
  payload: unknown;
}

export interface RecordMetadataSource {
  /** Every Event for these entities, oldest first. */
  eventsFor(
    organizationId: string,
    userId: string,
    entityType: string,
    entityIds: readonly string[],
  ): Promise<RecordMetadataEvent[]>;
}

/** The in-memory mode keeps no durable Event log, so metadata reads honestly
 * empty rather than inventing a creation time from the row's own arrival. */
export class EmptyRecordMetadataSource implements RecordMetadataSource {
  async eventsFor(): Promise<RecordMetadataEvent[]> {
    return [];
  }
}

export class DrizzleRecordMetadataStore implements RecordMetadataSource {
  #db: Database;
  constructor(db: Database) {
    this.#db = db;
  }

  async eventsFor(
    organizationId: string,
    userId: string,
    entityType: string,
    entityIds: readonly string[],
  ): Promise<RecordMetadataEvent[]> {
    if (entityIds.length === 0) return [];
    return withOrganizationContext(this.#db, { organizationId, userId }, async (tx) => {
      const rows = await tx
        .select({
          entityId: events.entityId,
          createdAt: events.createdAt,
          payload: events.payload,
        })
        .from(events)
        .where(
          and(
            eq(events.organizationId, organizationId),
            eq(events.entityType, entityType),
            inArray(events.entityId, [...entityIds]),
          ),
        )
        .orderBy(asc(events.createdAt));
      return rows.map((row) => ({
        entityId: row.entityId,
        createdAt: row.createdAt.toISOString(),
        payload: row.payload,
      }));
    });
  }
}
