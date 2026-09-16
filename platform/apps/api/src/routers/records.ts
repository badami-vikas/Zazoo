import { z } from "zod";
import { moduleStructure } from "@bridge/core";
import { installedManifest } from "./moduleRecords.js";
import type { Wiring } from "../wiring.js";
import {
  RECORD_NOTES_NAMESPACE_PREFIX,
  RECORD_SECTIONS,
  RECORD_SECTIONS_NAMESPACE_PREFIX,
  applyRecordNote,
  assertHumanIdentity,
  deriveRecordMetadata,
  emptyRecordMetadata,
  organizationGuard,
  procedure,
  readRecordNotes,
  readRecordSections,
  t,
} from "../router-shared.js";

// ── Record Sections and Record notes (TASK-083, ADR-261 under AP-171) ─────
//
// The ⋮ → Records toggles, server-side. Keyed by DATABASE, never by Record:
// two Records of one Database showing different Sections is the single-page
// divergence the UI gate exists to catch.
//
// It rides the same Local-Plane state store as the column overlay
// (`table:schema:`) rather than a table of its own — this is per-Organization
// presentation state about a shipped Database, and unlike the overlay it must
// answer for EVERY Database, including the ones this process holds no spec
// for, so there is nothing to register it against.
/**
 * What a Database's Record pages show before the owner has switched anything
 * (TASK-100). A Database a manifest DECLARES (`<module>.<database>` of a
 * Builder-built Module) starts from the Sections its manifest declares —
 * Notes and Governance on by default (UI Rulebook Part IV §1); everything
 * else keeps the all-off default. The stored choice, once made, wins.
 */
async function resolvedRecordSections(
  ctx: { wiring: Wiring },
  organizationId: string,
  specId: string,
  stored: unknown,
) {
  if (stored && typeof stored === "object") return readRecordSections(stored);
  const dot = specId.indexOf(".");
  if (dot <= 0) return readRecordSections(stored);
  try {
    const manifest = await installedManifest(ctx, organizationId, specId.slice(0, dot));
    const databaseId = specId.slice(dot + 1);
    if (!manifest.module?.databases?.some((database) => database.id === databaseId)) {
      return readRecordSections(stored);
    }
    return moduleStructure(manifest).sections(databaseId);
  } catch {
    // Not an installed Module's Database: the built-in default stands.
    return readRecordSections(stored);
  }
}

export const recordsRouter = t.router({
  sections: procedure
    .input(z.object({ organizationId: z.string().min(1), specId: z.string().trim().min(1) }))
    .query(async ({ input, ctx }) => {
      return resolvedRecordSections(
        ctx,
        input.organizationId,
        input.specId,
        await ctx.wiring.localPlane.state.read(
          input.organizationId,
          `${RECORD_SECTIONS_NAMESPACE_PREFIX}${input.specId}`,
        ),
      );
    }),

  setSection: procedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        specId: z.string().trim().min(1),
        section: z.enum(RECORD_SECTIONS),
        enabled: z.boolean(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // What every Record page of a Database shows is not something an Agent
      // decides — same floor as the column overlay next door.
      assertHumanIdentity(ctx, "Changing which Sections a Database's Records show");
      // The first switch starts from the declared default, so turning one
      // Section off does not silently turn the other two off with it.
      const declared = await resolvedRecordSections(ctx, input.organizationId, input.specId, null);
      return ctx.wiring.localPlane.state.update(
        input.organizationId,
        `${RECORD_SECTIONS_NAMESPACE_PREFIX}${input.specId}`,
        null,
        (current) => {
          const base = current && typeof current === "object" ? readRecordSections(current) : declared;
          const next = { ...base, [input.section]: input.enabled };
          return { state: next, result: next };
        },
      );
    }),

  /**
   * One Record's note. Held in its OWN namespace, which is what makes
   * switching the Notes Section off a hide rather than a delete.
   */
  note: procedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        specId: z.string().trim().min(1),
        recordId: z.string().trim().min(1),
      }),
    )
    .query(async ({ input, ctx }) => {
      const notes = readRecordNotes(
        await ctx.wiring.localPlane.state.read(
          input.organizationId,
          `${RECORD_NOTES_NAMESPACE_PREFIX}${input.specId}`,
        ),
      );
      return notes[input.recordId] ?? { text: "", updatedAt: "" };
    }),

  /**
   * The four derived metadata columns (TASK-063), folded from the Event log.
   *
   * A READ, and only a read: there is no write path to these values, because
   * a second copy of "when was this last touched" on the Record row could
   * disagree with the append-only log that produced it.
   */
  metadata: procedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        entityType: z.string().trim().min(1).max(120),
        recordIds: z.array(z.string().trim().min(1).max(200)).max(500),
      }),
    )
    .use(organizationGuard).query(async ({ input, ctx }) => {
      const events = await ctx.wiring.recordMetadata.eventsFor(
        input.organizationId,
        ctx.identity.id,
        input.entityType,
        input.recordIds,
      );
      const derived = deriveRecordMetadata(events);
      // Every requested id gets an answer, including the ones nothing has
      // happened to: a missing key would read as "still loading" on the
      // surface, and an empty cell is the truthful rendering of "unknown".
      return Object.fromEntries(
        input.recordIds.map((id) => [id, derived.get(id) ?? emptyRecordMetadata()]),
      );
    }),

  saveNote: procedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        specId: z.string().trim().min(1),
        recordId: z.string().trim().min(1),
        text: z.string().max(20_000),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      assertHumanIdentity(ctx, "Writing a note on a Record");
      const updatedAt = ctx.run.clock.nowISO();
      return ctx.wiring.localPlane.state.update(
        input.organizationId,
        `${RECORD_NOTES_NAMESPACE_PREFIX}${input.specId}`,
        null,
        (current) => {
          const next = applyRecordNote(
            readRecordNotes(current),
            input.recordId,
            input.text,
            updatedAt,
          );
          return { state: next, result: next[input.recordId] ?? { text: "", updatedAt } };
        },
      );
    }),
});
