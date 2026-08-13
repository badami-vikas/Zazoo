/**
 * DrizzleEventExtractionStore — the speaker-extraction review queue and
 * outreach queue behind NetworkManager's Events sub-module (TASK-070
 * follow-on, ADR-239). Plain organization-scoped CRUD, same shape as
 * `DrizzleEventsStore`; Person/edge materialization on approval is the
 * caller's job (the router composes this with `LocalGraphStore`), not this
 * store's — this store only owns the two staging tables.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { Database } from "./client.js";
import { eventOutreachDrafts, eventSpeakerDrafts } from "./schema.js";
import { withOrganizationOnly } from "./organization-context.js";

export type EventSpeakerDraftRow = typeof eventSpeakerDrafts.$inferSelect;
export type EventOutreachDraftRow = typeof eventOutreachDrafts.$inferSelect;

export interface InsertSpeakerDraftInput {
  organizationId: string;
  eventId: string;
  runId: string;
  name: string;
  affiliation?: string;
  talkTitle?: string;
  openAlexId?: string;
  orcid?: string;
  tier: "strong" | "moderate" | "flag" | "none";
  score: number;
  matchedPersonId?: string;
}

export interface InsertOutreachDraftInput {
  organizationId: string;
  eventId: string;
  speakerDraftId: string;
  personId: string;
  noteText: string;
}

export class DrizzleEventExtractionStore {
  #db: Database;
  constructor(db: Database) {
    this.#db = db;
  }

  /** Idempotent per (eventId, runId, name) — a re-run over the same event/run never double-stages. */
  async insertSpeakerDrafts(inputs: InsertSpeakerDraftInput[]): Promise<EventSpeakerDraftRow[]> {
    if (inputs.length === 0) return [];
    const organizationId = inputs[0]!.organizationId;
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
      const rows = await tx
        .insert(eventSpeakerDrafts)
        .values(
          inputs.map((input) => ({
            id: randomUUID(),
            organizationId: input.organizationId,
            eventId: input.eventId,
            runId: input.runId,
            name: input.name,
            affiliation: input.affiliation ?? null,
            talkTitle: input.talkTitle ?? null,
            openAlexId: input.openAlexId ?? null,
            orcid: input.orcid ?? null,
            tier: input.tier,
            score: String(input.score),
            matchedPersonId: input.matchedPersonId ?? null,
          })),
        )
        .onConflictDoNothing()
        .returning();
      return rows;
    });
  }

  async listSpeakerDrafts(
    organizationId: string,
    eventId: string,
    status?: "pending" | "approved" | "rejected",
  ): Promise<EventSpeakerDraftRow[]> {
    return withOrganizationOnly(this.#db, organizationId, (tx) =>
      tx
        .select()
        .from(eventSpeakerDrafts)
        .where(
          status
            ? and(eq(eventSpeakerDrafts.eventId, eventId), eq(eventSpeakerDrafts.status, status))
            : eq(eventSpeakerDrafts.eventId, eventId),
        )
        .orderBy(desc(eventSpeakerDrafts.createdAt)),
    );
  }

  async getSpeakerDraft(organizationId: string, id: string): Promise<EventSpeakerDraftRow | null> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
      const [row] = await tx.select().from(eventSpeakerDrafts).where(eq(eventSpeakerDrafts.id, id));
      return row ?? null;
    });
  }

  /**
   * Move a pending draft to approved/rejected. Only a `pending` row may be
   * decided — deciding twice (e.g. a double-click) is a no-op returning
   * `null`, never a silent overwrite of an earlier decision.
   */
  async decideSpeakerDraft(
    organizationId: string,
    id: string,
    decision: "approved" | "rejected",
    resolvedPersonId: string | undefined,
    decidedAt: string,
  ): Promise<EventSpeakerDraftRow | null> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
      const [row] = await tx
        .update(eventSpeakerDrafts)
        .set({
          status: decision,
          resolvedPersonId: resolvedPersonId ?? null,
          decidedAt: new Date(decidedAt),
        })
        .where(
          and(
            eq(eventSpeakerDrafts.id, id),
            eq(eventSpeakerDrafts.organizationId, organizationId),
            eq(eventSpeakerDrafts.status, "pending"),
          ),
        )
        .returning();
      return row ?? null;
    });
  }

  /** Idempotent on `speakerDraftId` — a retried approval never doubles the outreach row. */
  async insertOutreachDraft(input: InsertOutreachDraftInput): Promise<EventOutreachDraftRow> {
    return withOrganizationOnly(this.#db, input.organizationId, async (tx) => {
      const [inserted] = await tx
        .insert(eventOutreachDrafts)
        .values({
          id: randomUUID(),
          organizationId: input.organizationId,
          eventId: input.eventId,
          speakerDraftId: input.speakerDraftId,
          personId: input.personId,
          noteText: input.noteText,
        })
        .onConflictDoNothing()
        .returning();
      if (inserted) return inserted;
      const [existing] = await tx
        .select()
        .from(eventOutreachDrafts)
        .where(eq(eventOutreachDrafts.speakerDraftId, input.speakerDraftId));
      return existing!;
    });
  }

  async listOutreachDrafts(organizationId: string, eventId?: string): Promise<EventOutreachDraftRow[]> {
    return withOrganizationOnly(this.#db, organizationId, (tx) =>
      tx
        .select()
        .from(eventOutreachDrafts)
        .where(
          eventId
            ? and(eq(eventOutreachDrafts.organizationId, organizationId), eq(eventOutreachDrafts.eventId, eventId))
            : eq(eventOutreachDrafts.organizationId, organizationId),
        )
        .orderBy(desc(eventOutreachDrafts.createdAt)),
    );
  }
}
