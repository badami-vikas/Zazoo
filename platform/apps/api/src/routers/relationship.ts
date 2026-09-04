import { TRPCError } from "@trpc/server";
import { join } from "node:path";
import { z } from "zod";
import { databaseUuidSchema } from "@bridge/db";
import { communityCreateFieldsSchema, communityUpdateFieldsSchema, personCreateFieldsSchema, personUpdateFieldsSchema, relationshipMutationPayloadSchema } from "../relationship-record-materializer.js";
import { relationshipDateTimeSchema } from "../relationship-datetime.js";
import { LEARNING_AGENT, PILOT_ORGANIZATION } from "../wiring.js";
import type { Action } from "@bridge/core";
import { routeHelpRequest, draftHelpOffer, type HelpResponderCandidate } from "../relationship-help-routing.js";
import { transition } from "@bridge/jobpilot";
import { personIndexFrom as whatsAppPersonIndexFrom, readSyncState as readWhatsAppSyncState, syncedThreads as whatsAppSyncedThreads, chatsLinkedToPerson as whatsAppChatsLinkedToPerson } from "@bridge/whatsapp";
import { WHATSAPP_SOURCE, WHATSAPP_SYNC_NAMESPACE, approvedRelationshipResolution, archiveRelationshipRecord, assertPilotOrganization, authenticatedProcedure, humanInteractionFieldsSchema, intakeReviewView, organizationGuard, paginatedInput, procedure, proposeRelationshipMutation, provisionHelpRequestAnswerTask, publicProcedure, relationshipEffectView, relationshipNodeTypeEnum, relationshipSignalEvidenceInput, retryApprovedRelationship, t, viewRowFilterInput, viewSortSpecInput } from "../router-shared.js";

const relationshipListInput = z.object({
  organizationId: databaseUuidSchema,
  query: z.string().trim().max(120).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).max(10_000).default(0),
  // D10 (BUGS.md "paginated Relationship Views filter and sort only the
  // loaded page", OPEN 2026-07-19): the active View's sorts/rowFilters,
  // applied server-side (`packages/db/src/graph-store.ts`'s allowlisted
  // `personViewColumn`/`communityViewColumn`) BEFORE limit/offset, so a
  // filter can match a row on a later page and a sort is global rather than
  // per-page. Bounded arrays — same reasoning as `MAX_VIEW_SORTS`/
  // `MAX_VIEW_ROW_FILTERS` in graph-store.ts.
  sorts: z.array(viewSortSpecInput).max(5).optional(),
  rowFilters: z.array(viewRowFilterInput).max(20).optional(),
  filterMatch: z.enum(["all", "any"]).optional(),
});

/**
 * Dedicated Relation surface. Public callers can only stage Signal evidence
 * proposals here; owner, provenance, source Module, and approval behavior are
 * all assigned by the server and materialized only after a Human decision.
 */
export const relationshipRouter = t.router({
  listPeople: authenticatedProcedure
    .input(relationshipListInput)
    .use(organizationGuard).query(async ({ input, ctx }) => {
      const { items, total } = await ctx.wiring.graphStore.listPeople(
        input.organizationId,
        ctx.identity.id,
        {
          limit: input.limit,
          offset: input.offset,
          ...(input.query ? { query: input.query } : {}),
          ...(input.sorts ? { sorts: input.sorts } : {}),
          ...(input.rowFilters ? { rowFilters: input.rowFilters } : {}),
          ...(input.filterMatch ? { filterMatch: input.filterMatch } : {}),
        },
      );
      return { items, total, hasMore: input.offset + items.length < total };
    }),

  getPerson: authenticatedProcedure
    .input(z.object({ organizationId: databaseUuidSchema, id: databaseUuidSchema }))
    .use(organizationGuard).query(async ({ input, ctx }) => {
      return ctx.wiring.graphStore.getPerson(input.organizationId, ctx.identity.id, input.id);
    }),

  createPerson: authenticatedProcedure
    .input(z.object({ organizationId: z.string().uuid(), values: personCreateFieldsSchema }))
    .use(organizationGuard).mutation(async ({ input, ctx }) => {
      const recordId = ctx.run.ids.next();
      const payload = relationshipMutationPayloadSchema.parse({
        kind: "relationship_record_mutation",
        recordType: "person",
        operation: "create",
        recordId,
        values: input.values,
      });
      return proposeRelationshipMutation(ctx, input.organizationId, payload);
    }),

  updatePerson: authenticatedProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      id: z.string().uuid(),
      values: personUpdateFieldsSchema,
    }))
    .use(organizationGuard).mutation(async ({ input, ctx }) => {
      const person = await ctx.wiring.graphStore.getPerson(
        input.organizationId,
        ctx.identity.id,
        input.id,
      );
      if (!person?.isOwner) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Person not found" });
      }
      const payload = relationshipMutationPayloadSchema.parse({
        kind: "relationship_record_mutation",
        recordType: "person",
        operation: "update",
        recordId: input.id,
        values: input.values,
      });
      return proposeRelationshipMutation(ctx, input.organizationId, payload);
    }),

  archivePerson: authenticatedProcedure
    .input(z.object({ organizationId: databaseUuidSchema, id: databaseUuidSchema }))
    .use(organizationGuard).mutation(async ({ input, ctx }) => {
      return archiveRelationshipRecord(ctx, input.organizationId, "person", input.id);
    }),

  listCommunities: authenticatedProcedure
    .input(relationshipListInput)
    .use(organizationGuard).query(async ({ input, ctx }) => {
      const { items, total } = await ctx.wiring.graphStore.listCommunities(
        input.organizationId,
        ctx.identity.id,
        {
          limit: input.limit,
          offset: input.offset,
          ...(input.query ? { query: input.query } : {}),
          ...(input.sorts ? { sorts: input.sorts } : {}),
          ...(input.rowFilters ? { rowFilters: input.rowFilters } : {}),
          ...(input.filterMatch ? { filterMatch: input.filterMatch } : {}),
        },
      );
      return { items, total, hasMore: input.offset + items.length < total };
    }),

  getCommunity: authenticatedProcedure
    .input(z.object({ organizationId: z.string().uuid(), id: z.string().uuid() }))
    .use(organizationGuard).query(async ({ input, ctx }) => {
      return ctx.wiring.graphStore.getCommunity(input.organizationId, ctx.identity.id, input.id);
    }),

  createCommunity: authenticatedProcedure
    .input(z.object({ organizationId: z.string().uuid(), values: communityCreateFieldsSchema }))
    .use(organizationGuard).mutation(async ({ input, ctx }) => {
      const recordId = ctx.run.ids.next();
      const payload = relationshipMutationPayloadSchema.parse({
        kind: "relationship_record_mutation",
        recordType: "community",
        operation: "create",
        recordId,
        values: input.values,
      });
      return proposeRelationshipMutation(ctx, input.organizationId, payload);
    }),

  updateCommunity: authenticatedProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      id: z.string().uuid(),
      values: communityUpdateFieldsSchema,
    }))
    .use(organizationGuard).mutation(async ({ input, ctx }) => {
      const community = await ctx.wiring.graphStore.getCommunity(
        input.organizationId,
        ctx.identity.id,
        input.id,
      );
      if (!community?.isOwner) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Community not found" });
      }
      const payload = relationshipMutationPayloadSchema.parse({
        kind: "relationship_record_mutation",
        recordType: "community",
        operation: "update",
        recordId: input.id,
        values: input.values,
      });
      return proposeRelationshipMutation(ctx, input.organizationId, payload);
    }),

  archiveCommunity: authenticatedProcedure
    .input(z.object({ organizationId: z.string().uuid(), id: z.string().uuid() }))
    .use(organizationGuard).mutation(async ({ input, ctx }) => {
      return archiveRelationshipRecord(ctx, input.organizationId, "community", input.id);
    }),

  /**
   * The bulk form of the two procedures above — TASK-086's table multi-select.
   *
   * IT IS A LOOP, DELIBERATELY. Every id goes through
   * `archiveRelationshipRecord`, the same function `archivePerson` and
   * `archiveCommunity` call, so three Records produce three proposals and
   * three ledger decisions, each naming the Record it archived. There is no
   * batch write for a batch to be governed more thinly than a single delete —
   * which is the whole constraint. Sequential rather than `Promise.all` so
   * ledger append order stays deterministic and one failure cannot race the
   * others.
   *
   * A per-id failure is REPORTED, not thrown: a partial bulk that reported
   * nothing would leave the user unable to tell which Records survived.
   */
  archiveRecords: authenticatedProcedure
    .input(z.object({
      organizationId: databaseUuidSchema,
      recordType: z.enum(["person", "community"]),
      // Bounded: an unbounded list is an unbounded number of governed
      // proposals in one request.
      ids: z.array(databaseUuidSchema).min(1).max(50),
    }))
    .use(organizationGuard).mutation(async ({ input, ctx }) => {
      const results: Array<{
        id: string;
        proposalId: string | null;
        materialization: { status: string } | null;
        error: string | null;
      }> = [];
      for (const id of new Set(input.ids)) {
        try {
          const outcome = await archiveRelationshipRecord(
            ctx,
            input.organizationId,
            input.recordType,
            id,
          );
          results.push({
            id,
            proposalId: outcome.proposal.id,
            materialization: { status: outcome.materialization.status },
            error: null,
          });
        } catch (caught) {
          results.push({
            id,
            proposalId: null,
            materialization: null,
            error: caught instanceof TRPCError ? caught.message : "Archive failed",
          });
        }
      }
      return { results };
    }),

  createInteraction: authenticatedProcedure
    .input(z.object({ organizationId: z.string().uuid(), values: humanInteractionFieldsSchema }))
    .use(organizationGuard).mutation(async ({ input, ctx }) => {
      const participantsAccessible =
        await ctx.wiring.graphStore.areRelationshipRecordsAccessible(
          input.organizationId,
          ctx.identity.id,
          input.values.participants,
        );
      if (!participantsAccessible) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Every Interaction participant must be an accessible Relationship Record",
        });
      }
      const recordId = ctx.run.ids.next();
      const payload = relationshipMutationPayloadSchema.parse({
        kind: "relationship_interaction_create",
        recordId,
        values: { ...input.values, source: "user" },
      });
      return proposeRelationshipMutation(ctx, input.organizationId, payload);
    }),

  memories: authenticatedProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      personId: z.string().uuid(),
      limit: z.number().int().min(1).max(50).default(25),
      offset: z.number().int().min(0).max(10_000).default(0),
      snapshotAt: z.string().datetime({ offset: true }).optional(),
    }))
    .use(organizationGuard).query(async ({ input, ctx }) => {
      if (ctx.identity.type !== "user") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Relationship Memory requires a Human user principal" });
      }
      const person = await ctx.wiring.graphStore.getPerson(
        input.organizationId,
        ctx.identity.id,
        input.personId,
      );
      if (!person) throw new TRPCError({ code: "NOT_FOUND", message: "Person not found" });
      const snapshotAt = input.snapshotAt ?? ctx.run.clock.nowISO();
      const rows = await ctx.wiring.memoryStore.retrieve(
        {
          subjectRecordId: input.personId,
          snapshotAt,
          limit: input.limit + 1,
          offset: input.offset,
        },
        { organizationId: input.organizationId, userId: ctx.identity.id },
      );
      return {
        items: rows.slice(0, input.limit),
        nextOffset: rows.length > input.limit ? input.offset + input.limit : null,
        hasMore: rows.length > input.limit,
        snapshotAt,
      };
    }),

  addMemory: authenticatedProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      personId: z.string().uuid(),
      type: z.enum(["episodic", "semantic", "procedural", "preference"]).default("semantic"),
      content: z.string().trim().min(1).max(5_000),
      scope: z.enum(["private", "organization"]).default("private"),
    }))
    .use(organizationGuard).mutation(async ({ input, ctx }) => {
      const person = await ctx.wiring.graphStore.getPerson(
        input.organizationId,
        ctx.identity.id,
        input.personId,
      );
      if (!person?.isOwner) throw new TRPCError({ code: "NOT_FOUND", message: "Person not found" });
      const payload = relationshipMutationPayloadSchema.parse({
        kind: "relationship_memory_mutation",
        operation: "create",
        personId: input.personId,
        memoryId: ctx.run.ids.next(),
        values: {
          type: input.type,
          content: input.content,
          scope: input.scope,
        },
      });
      return proposeRelationshipMutation(ctx, input.organizationId, payload);
    }),

  correctMemory: authenticatedProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      personId: z.string().uuid(),
      memoryId: z.string().uuid(),
      content: z.string().trim().min(1).max(5_000),
    }))
    .use(organizationGuard).mutation(async ({ input, ctx }) => {
      if (ctx.identity.type !== "user") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Relationship Memory changes require a Human user principal" });
      }
      const [person, memory] = await Promise.all([
        ctx.wiring.graphStore.getPerson(input.organizationId, ctx.identity.id, input.personId),
        ctx.wiring.memoryStore.get(input.memoryId, {
          organizationId: input.organizationId,
          userId: ctx.identity.id,
        }),
      ]);
      if (
        !person?.isOwner ||
        !memory ||
        memory.subjectRecordId !== input.personId ||
        memory.ownerUserId !== ctx.identity.id
      ) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Relationship Memory not found" });
      }
      const payload = relationshipMutationPayloadSchema.parse({
        kind: "relationship_memory_mutation",
        operation: "correct",
        personId: input.personId,
        memoryId: input.memoryId,
        replacementMemoryId: ctx.run.ids.next(),
        values: { content: input.content },
      });
      return proposeRelationshipMutation(ctx, input.organizationId, payload);
    }),

  forgetMemory: authenticatedProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      personId: z.string().uuid(),
      memoryId: z.string().uuid(),
    }))
    .use(organizationGuard).mutation(async ({ input, ctx }) => {
      if (ctx.identity.type !== "user") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Relationship Memory changes require a Human user principal" });
      }
      const [person, memory] = await Promise.all([
        ctx.wiring.graphStore.getPerson(input.organizationId, ctx.identity.id, input.personId),
        ctx.wiring.memoryStore.get(input.memoryId, {
          organizationId: input.organizationId,
          userId: ctx.identity.id,
        }),
      ]);
      if (
        !person?.isOwner ||
        !memory ||
        memory.subjectRecordId !== input.personId ||
        memory.ownerUserId !== ctx.identity.id
      ) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Relationship Memory not found" });
      }
      const payload = relationshipMutationPayloadSchema.parse({
        kind: "relationship_memory_mutation",
        operation: "forget",
        personId: input.personId,
        memoryId: input.memoryId,
      });
      return proposeRelationshipMutation(ctx, input.organizationId, payload);
    }),

  commitments: authenticatedProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      personId: z.string().uuid(),
      limit: z.number().int().min(1).max(50).default(25),
      offset: z.number().int().min(0).max(10_000).default(0),
      includeArchived: z.boolean().default(false),
      snapshotAt: z.string().datetime({ offset: true }).optional(),
    }))
    .use(organizationGuard).query(async ({ input, ctx }) => {
      const snapshotAt = input.snapshotAt ?? ctx.run.clock.nowISO();
      const page = await ctx.wiring.graphStore.listCommitments(
        input.organizationId,
        ctx.identity.id,
        input.personId,
        {
          limit: input.limit,
          offset: input.offset,
          includeArchived: input.includeArchived,
          snapshotAt: new Date(snapshotAt),
        },
      );
      return {
        items: page.items.map((item) => ({
          ...item,
          dueAt: item.dueAt?.toISOString() ?? null,
          occurredAt: item.occurredAt.toISOString(),
          createdAt: item.createdAt.toISOString(),
        })),
        total: page.total,
        hasMore: input.offset + page.items.length < page.total,
        snapshotAt,
      };
    }),

  createCommitment: authenticatedProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      personId: z.string().uuid(),
      text: z.string().trim().min(1).max(2_000),
      dueAt: relationshipDateTimeSchema.nullable().optional(),
    }))
    .use(organizationGuard).mutation(async ({ input, ctx }) => {
      const person = await ctx.wiring.graphStore.getPerson(
        input.organizationId,
        ctx.identity.id,
        input.personId,
      );
      if (!person?.isOwner) throw new TRPCError({ code: "NOT_FOUND", message: "Person not found" });
      const commitmentId = ctx.run.ids.next();
      const payload = relationshipMutationPayloadSchema.parse({
        kind: "relationship_commitment_mutation",
        operation: "create",
        commitmentId,
        transitionEventId: commitmentId,
        personId: input.personId,
        values: {
          text: input.text,
          dueAt: input.dueAt ?? null,
          status: "pending",
        },
      });
      return proposeRelationshipMutation(ctx, input.organizationId, payload);
    }),

  updateCommitment: authenticatedProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      personId: z.string().uuid(),
      commitmentId: z.string().uuid(),
      text: z.string().trim().min(1).max(2_000),
      dueAt: relationshipDateTimeSchema.nullable().optional(),
      status: z.enum(["pending", "completed", "cancelled"]),
    }))
    .use(organizationGuard).mutation(async ({ input, ctx }) => {
      const current = await ctx.wiring.graphStore.listCommitments(
        input.organizationId,
        ctx.identity.id,
        input.personId,
        {
          limit: 1,
          offset: 0,
          includeArchived: true,
          commitmentId: input.commitmentId,
        },
      );
      if (current.items.length !== 1) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Commitment not found" });
      }
      const payload = relationshipMutationPayloadSchema.parse({
        kind: "relationship_commitment_mutation",
        operation: "update",
        commitmentId: input.commitmentId,
        transitionEventId: ctx.run.ids.next(),
        personId: input.personId,
        sourceEventId: current.items[0]!.sourceEventId,
        values: {
          text: input.text,
          dueAt: input.dueAt ?? null,
          status: input.status,
        },
      });
      return proposeRelationshipMutation(ctx, input.organizationId, payload);
    }),

  archiveCommitment: authenticatedProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      personId: z.string().uuid(),
      commitmentId: z.string().uuid(),
    }))
    .use(organizationGuard).mutation(async ({ input, ctx }) => {
      const current = await ctx.wiring.graphStore.listCommitments(
        input.organizationId,
        ctx.identity.id,
        input.personId,
        {
          limit: 1,
          offset: 0,
          includeArchived: true,
          commitmentId: input.commitmentId,
        },
      );
      const commitment = current.items[0];
      if (!commitment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Commitment not found" });
      }
      const payload = relationshipMutationPayloadSchema.parse({
        kind: "relationship_commitment_mutation",
        operation: "archive",
        commitmentId: input.commitmentId,
        transitionEventId: ctx.run.ids.next(),
        personId: input.personId,
        sourceEventId: commitment.sourceEventId,
        values: {
          text: commitment.text,
          dueAt: commitment.dueAt?.toISOString() ?? null,
          status: "archived",
        },
      });
      return proposeRelationshipMutation(ctx, input.organizationId, payload);
    }),

  introductions: authenticatedProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      personId: z.string().uuid(),
      limit: z.number().int().min(1).max(50).default(25),
      offset: z.number().int().min(0).max(10_000).default(0),
      snapshotAt: z.string().datetime({ offset: true }).optional(),
    }))
    .use(organizationGuard).query(async ({ input, ctx }) => {
      const snapshotAt = input.snapshotAt ?? ctx.run.clock.nowISO();
      const page = await ctx.wiring.graphStore.listIntroductions(
        input.organizationId,
        ctx.identity.id,
        input.personId,
        {
          limit: input.limit,
          offset: input.offset,
          snapshotAt: new Date(snapshotAt),
        },
      );
      const items = await Promise.all(page.items.map(async (item) => {
        const counterpartId = item.sourcePersonId === input.personId
          ? item.targetPersonId
          : item.sourcePersonId;
        const counterpart = await ctx.wiring.graphStore.getPerson(
          input.organizationId,
          ctx.identity.id,
          counterpartId,
        );
        return {
          ...item,
          counterpart: counterpart
            ? { id: counterpart.id, displayName: counterpart.displayName }
            : null,
          occurredAt: item.occurredAt.toISOString(),
          createdAt: item.createdAt.toISOString(),
        };
      }));
      return {
        items,
        total: page.total,
        hasMore: input.offset + page.items.length < page.total,
        snapshotAt,
      };
    }),

  createIntroduction: authenticatedProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      sourcePersonId: z.string().uuid(),
      targetPersonId: z.string().uuid(),
    }).refine((input) => input.sourcePersonId !== input.targetPersonId, {
      message: "An Introduction requires two different People",
    }))
    .use(organizationGuard).mutation(async ({ input, ctx }) => {
      const [sourcePerson, targetPerson] = await Promise.all([
        ctx.wiring.graphStore.getPerson(input.organizationId, ctx.identity.id, input.sourcePersonId),
        ctx.wiring.graphStore.getPerson(input.organizationId, ctx.identity.id, input.targetPersonId),
      ]);
      if (!sourcePerson?.isOwner || !targetPerson) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Introduction People not found" });
      }
      const introductionId = ctx.run.ids.next();
      const payload = relationshipMutationPayloadSchema.parse({
        kind: "relationship_introduction_mutation",
        operation: "create",
        introductionId,
        transitionEventId: introductionId,
        sourcePersonId: input.sourcePersonId,
        targetPersonId: input.targetPersonId,
        values: {
          initiatorConsent: true,
          recipientConsent: false,
          status: "awaiting_consents",
        },
      });
      return proposeRelationshipMutation(ctx, input.organizationId, payload);
    }),

  recordIntroductionConsent: authenticatedProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      personId: z.string().uuid(),
      introductionId: z.string().uuid(),
      party: z.enum(["initiator", "recipient"]),
      decision: z.enum(["consent", "decline"]),
      declineReason: z.string().trim().min(1).max(1_000).optional(),
    }).superRefine((input, refinementCtx) => {
      if (input.decision === "decline" && !input.declineReason) {
        refinementCtx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A private decline reason is required",
          path: ["declineReason"],
        });
      }
      if (input.decision === "consent" && input.declineReason) {
        refinementCtx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A decline reason is only valid for a decline",
          path: ["declineReason"],
        });
      }
    }))
    .use(organizationGuard).mutation(async ({ input, ctx }) => {
      const page = await ctx.wiring.graphStore.listIntroductions(
        input.organizationId,
        ctx.identity.id,
        input.personId,
        { limit: 1, offset: 0, introductionId: input.introductionId },
      );
      const current = page.items[0];
      if (!current || ["declined", "cancelled", "introduced"].includes(current.status)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Introduction not actionable" });
      }
      const initiatorConsent = input.party === "initiator"
        ? input.decision === "consent"
        : current.initiatorConsent;
      const recipientConsent = input.party === "recipient"
        ? input.decision === "consent"
        : current.recipientConsent;
      const status = input.decision === "decline"
        ? "declined"
        : initiatorConsent && recipientConsent
          ? "ready"
          : "awaiting_consents";
      const payload = relationshipMutationPayloadSchema.parse({
        kind: "relationship_introduction_mutation",
        operation: "consent",
        introductionId: current.id,
        transitionEventId: ctx.run.ids.next(),
        sourcePersonId: current.sourcePersonId,
        targetPersonId: current.targetPersonId,
        values: {
          initiatorConsent,
          recipientConsent,
          status,
          declineReason: input.declineReason ?? null,
        },
      });
      return proposeRelationshipMutation(ctx, input.organizationId, payload);
    }),

  transitionIntroduction: authenticatedProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      personId: z.string().uuid(),
      introductionId: z.string().uuid(),
      transition: z.enum(["cancel", "complete"]),
    }))
    .use(organizationGuard).mutation(async ({ input, ctx }) => {
      const page = await ctx.wiring.graphStore.listIntroductions(
        input.organizationId,
        ctx.identity.id,
        input.personId,
        { limit: 1, offset: 0, introductionId: input.introductionId },
      );
      const current = page.items[0];
      if (
        !current ||
        ["declined", "cancelled", "introduced"].includes(current.status) ||
        (input.transition === "complete" && current.status !== "ready")
      ) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Introduction not actionable" });
      }
      const payload = relationshipMutationPayloadSchema.parse({
        kind: "relationship_introduction_mutation",
        operation: input.transition,
        introductionId: current.id,
        transitionEventId: ctx.run.ids.next(),
        sourcePersonId: current.sourcePersonId,
        targetPersonId: current.targetPersonId,
        values: {
          initiatorConsent: current.initiatorConsent,
          recipientConsent: current.recipientConsent,
          status: input.transition === "complete" ? "introduced" : "cancelled",
        },
      });
      return proposeRelationshipMutation(ctx, input.organizationId, payload);
    }),

  meetingPrep: authenticatedProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      personId: z.string().uuid(),
      limit: z.number().int().min(1).max(25).default(10),
    }))
    .use(organizationGuard).query(async ({ input, ctx }) => {
      if (ctx.identity.type !== "user") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Meeting preparation requires a Human user principal" });
      }
      const person = await ctx.wiring.graphStore.getPerson(
        input.organizationId,
        ctx.identity.id,
        input.personId,
      );
      if (!person) throw new TRPCError({ code: "NOT_FOUND", message: "Person not found" });
      const [timeline, memories, commitments, pendingCommitments] = await Promise.all([
        ctx.wiring.graphStore.listTimeline(
          input.organizationId,
          ctx.identity.id,
          "person",
          input.personId,
          { limit: input.limit },
        ),
        ctx.wiring.memoryStore.retrieve(
          { subjectRecordId: input.personId, limit: input.limit },
          { organizationId: input.organizationId, userId: ctx.identity.id },
        ),
        ctx.wiring.graphStore.listCommitments(
          input.organizationId,
          ctx.identity.id,
          input.personId,
          { limit: input.limit, offset: 0 },
        ),
        ctx.wiring.graphStore.listCommitments(
          input.organizationId,
          ctx.identity.id,
          input.personId,
          { limit: 5, offset: 0, status: "pending" },
        ),
      ]);
      return {
        person: {
          id: person.id,
          displayName: person.displayName,
          currentTitle: person.currentTitle,
        },
        generatedAt: ctx.run.clock.nowISO(),
        context: {
          memories,
          recentEvents: timeline.items.map((item) => ({
            ...item,
            occurredAt: item.occurredAt.toISOString(),
            createdAt: item.createdAt.toISOString(),
          })),
          commitments: commitments.items.map((item) => ({
            ...item,
            dueAt: item.dueAt?.toISOString() ?? null,
            occurredAt: item.occurredAt.toISOString(),
            createdAt: item.createdAt.toISOString(),
          })),
        },
        recommendedActions: pendingCommitments.items.map((item) => ({
          kind: "log_follow_up" as const,
          commitmentId: item.id,
          label: `Log follow-up: ${item.text}`,
        })),
      };
    }),

  timeline: authenticatedProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      recordType: z.enum(["person", "community"]),
      recordId: z.string().uuid(),
      limit: z.number().int().min(1).max(50).default(25),
      cursor: z.object({
        occurredAt: z.string().datetime(),
        id: z.string().uuid(),
      }).optional(),
    }))
    .use(organizationGuard).query(async ({ input, ctx }) => {
      const page = await ctx.wiring.graphStore.listTimeline(
        input.organizationId,
        ctx.identity.id,
        input.recordType,
        input.recordId,
        {
          limit: input.limit,
          ...(input.cursor
            ? {
                cursor: {
                  occurredAt: new Date(input.cursor.occurredAt),
                  id: input.cursor.id,
                },
              }
            : {}),
        },
      );
      return {
        items: page.items.map((item) => ({
          ...item,
          occurredAt: item.occurredAt.toISOString(),
          createdAt: item.createdAt.toISOString(),
        })),
        nextCursor: page.nextCursor
          ? {
              occurredAt: page.nextCursor.occurredAt.toISOString(),
              id: page.nextCursor.id,
            }
          : null,
        hasMore: page.nextCursor !== null,
      };
    }),

  /**
   * WhatsApp activity for one Relationship Record, for its Timeline (ADR-159).
   *
   * ── Why this is a SEPARATE procedure from `timeline` ─────────────────────
   * `timeline` reads cloud Events. This reads the LOCAL plane. They are not
   * merged server-side and the WhatsApp rows are never written into `events`,
   * because that would copy Local-Plane facts into cloud canonical storage —
   * the one thing the residency rule forbids. The join happens at RENDER time
   * in the client, which is what keeps the two planes separate on disk while
   * still giving the user one Timeline to read.
   *
   * ── What crosses the wire ────────────────────────────────────────────────
   * Activity FACTS only: counts, timestamps, direction. No message body, no
   * phone number, no identity key. Bodies stay in the WhatsApp Module's own
   * thread surface, which the client links to.
   *
   * ── The identity bridge, stated honestly ─────────────────────────────────
   * A cloud Person id and a Local Plane person id are different key spaces.
   * The only bridge that exists today is ID EQUALITY — the Google intake and
   * Capture paths mint one uuid and write it as both `people.id` and
   * `local_people.id`. This procedure relies on that same bridge and invents
   * no new one. A Person whose local row was created by the WhatsApp Contact
   * Extractor has NO cloud row at all, so their chats cannot appear on a
   * cloud Person page until an explicit promote exists. That is reported as
   * `linkage: "no_local_record"`, not disguised as "no activity".
   */
  whatsappTimeline: authenticatedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        recordType: z.enum(["person", "community"]),
        recordId: z.string().uuid(),
      }),
    )
    .use(organizationGuard).query(async ({ input, ctx }) => {
      const organizationId = PILOT_ORGANIZATION;
      const localPlane = ctx.wiring.localPlane;

      // A WhatsApp group maps to a Community identity key, but the Local
      // Plane has no Community store and nothing stages WhatsApp groups as
      // Communities yet. Say so, rather than returning an empty list that
      // would read as "this Community has no WhatsApp activity".
      if (input.recordType === "community") {
        return { linkage: "community_unsupported" as const, entries: [] };
      }

      const people = await localPlane.graph.listPeople(organizationId);
      const local = people.find((person) => person.id === input.recordId);
      if (!local) return { linkage: "no_local_record" as const, entries: [] };
      if (!local.dedupeKey?.startsWith("whatsapp")) {
        // A local Person exists, but nothing has tied a WhatsApp identity to
        // them. Distinct from "no messages": there is no channel to read.
        return { linkage: "no_whatsapp_identity" as const, entries: [] };
      }

      const index = whatsAppPersonIndexFrom(
        people.flatMap((person) =>
          person.dedupeKey ? [{ personId: person.id, dedupeKey: person.dedupeKey }] : [],
        ),
      );
      const state = readWhatsAppSyncState(
        await localPlane.state.read(organizationId, WHATSAPP_SYNC_NAMESPACE),
      );
      const threads = whatsAppSyncedThreads(state);
      const mine = new Set(
        whatsAppChatsLinkedToPerson(
          input.recordId,
          threads.map((thread) => thread.chatId),
          index,
        ),
      );

      const entries = [];
      for (const thread of threads) {
        if (!mine.has(thread.chatId)) continue;
        const activity = await localPlane.graph.getThreadActivity(
          organizationId,
          WHATSAPP_SOURCE,
          thread.chatId,
        );
        entries.push({
          chatId: thread.chatId,
          // A label WhatsApp reported, never an identifier.
          ...(thread.name !== undefined ? { chatName: thread.name } : {}),
          messageCount: thread.messageCount,
          inboundCount: activity.inboundCount,
          outboundCount: activity.outboundCount,
          ...(activity.firstInboundAt ? { firstInboundAt: activity.firstInboundAt } : {}),
          ...(activity.lastInboundAt ? { lastInboundAt: activity.lastInboundAt } : {}),
          ...(activity.lastOutboundAt ? { lastOutboundAt: activity.lastOutboundAt } : {}),
          // Sort key for the merged Timeline: the most recent thing that
          // happened in this thread, whichever direction it went.
          occurredAt:
            [activity.lastInboundAt, activity.lastOutboundAt]
              .filter((at): at is string => Boolean(at))
              .sort()
              .at(-1) ?? null,
        });
      }
      entries.sort((a, b) => (b.occurredAt ?? "").localeCompare(a.occurredAt ?? ""));
      return { linkage: "linked" as const, entries };
    }),

  listSignals: authenticatedProcedure
    .input(paginatedInput)
    .use(organizationGuard).query(async ({ input, ctx }) => {
      const { items, total } = await ctx.wiring.graphStore.listSignals(
        input.organizationId,
        ctx.identity.id,
        { limit: input.limit, offset: input.offset },
      );
      return { items, total, hasMore: input.offset + items.length < total };
    }),

  getSignalDetail: authenticatedProcedure
    .input(z.object({ organizationId: z.string().min(1), signalId: z.string().uuid() }))
    .use(organizationGuard).query(async ({ input, ctx }) => {
      return ctx.wiring.graphStore.getSignalDetail(input.organizationId, ctx.identity.id, input.signalId);
    }),

  proposeSignalAction: authenticatedProcedure
    .input(z.object({ organizationId: z.string().min(1), signalId: z.string().uuid() }))
    .use(organizationGuard).mutation(async ({ input, ctx }) => {
      const detail = await ctx.wiring.graphStore.getSignalDetail(input.organizationId, ctx.identity.id, input.signalId);
      if (!detail) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Signal not found" });
      }
      if (
        !detail.sourceEvent ||
        !detail.participants.some(
          (participant) => participant.relationType === "participant" && participant.relationId,
        )
      ) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "A governed Relationship Action requires an accessible participant Relation and source Event.",
        });
      }
      const proposal = await ctx.wiring.pipeline.propose(
        {
          organizationId: input.organizationId,
          actor: { type: ctx.identity.type, id: ctx.identity.id, plane: "local" },
          action: "write",
          resourceType: "signal",
          resourceId: detail.signal.id,
          inputs: {
            kind: "relationship_signal_action",
            signalId: detail.signal.id,
            sourceEventId: detail.sourceEvent.id,
            participantRefs: detail.participants.map((participant) => ({
              relationId: participant.relationId,
              recordType: participant.recordType,
              recordId: participant.recordId,
            })),
            recommendation: detail.signal.recommendedAction,
          },
          skill: "stageMutation",
          dataScope: "private",
          seed: detail.sourceEvent.id,
        },
        ctx.run,
      );
      if (proposal.status !== "rejected") {
        await ctx.wiring.graphStore.recordSignalAction({
          organizationId: input.organizationId,
          signalId: input.signalId,
          userId: ctx.identity.id,
          verb: "act",
        });
      }
      return proposal;
    }),

  recordSignalAction: authenticatedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        signalId: z.string().uuid(),
        verb: z.enum(["act", "dismiss", "save"]),
      }),
    )
    .use(organizationGuard).mutation(async ({ input, ctx }) => {
      const detail = await ctx.wiring.graphStore.getSignalDetail(input.organizationId, ctx.identity.id, input.signalId);
      if (!detail) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Signal not found or not accessible" });
      }
      await ctx.wiring.graphStore.recordSignalAction({
        organizationId: input.organizationId,
        signalId: input.signalId,
        userId: ctx.identity.id,
        verb: input.verb,
      });
      return { ok: true };
    }),

  intakeReview: authenticatedProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      limit: z.number().int().min(1).max(50).default(25),
      offset: z.number().int().min(0).max(10_000).default(0),
    }))
    .use(organizationGuard).query(async ({ input, ctx }) => {
      const page = await ctx.wiring.pipeline.listPending(input.organizationId, {
        limit: input.limit,
        offset: input.offset,
        privateOwnerUserId: ctx.identity.id,
      });
      return {
        items: page.items.flatMap((proposal) => {
          const item = intakeReviewView(proposal);
          return item ? [item] : [];
        }),
        scanned: page.items.length,
        nextOffset:
          input.offset + page.items.length < page.total
            ? input.offset + page.items.length
            : null,
        hasMore: input.offset + page.items.length < page.total,
      };
    }),

  nodeTypeOwner: authenticatedProcedure
    .input(z.object({ organizationId: z.string().uuid(), nodeType: relationshipNodeTypeEnum }))
    .use(organizationGuard).query(async ({ input, ctx }) => {
      return ctx.wiring.graphStore.getNodeTypeOwner(input.nodeType);
    }),

  graph: authenticatedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        limit: z.number().int().min(1).max(500).default(200),
      }),
    )
    .use(organizationGuard).query(async ({ input, ctx }) => {
      const nodeLimit = Math.min(input.limit, 100);
      const [personPage, communityPage, relationPage] = await Promise.all([
        ctx.wiring.graphStore.listPeople(
          input.organizationId,
          ctx.identity.id,
          { limit: nodeLimit, offset: 0 },
        ),
        ctx.wiring.graphStore.listCommunities(
          input.organizationId,
          ctx.identity.id,
          { limit: nodeLimit, offset: 0 },
        ),
        ctx.wiring.graphStore.listGraphRelations(
          input.organizationId,
          ctx.identity.id,
          { limit: input.limit, nodeTypes: ["person", "community"] },
        ),
      ]);
      const personNodes = personPage.items.map((person) => ({
        id: `person:${person.id}`,
        recordId: person.id,
        label: person.displayName ?? "Unnamed Person",
        databaseId: "people",
        databaseLabel: "People",
        moduleId: "relationship",
        recordType: "person",
        subtitle: person.currentTitle ?? person.location ?? undefined,
        recordPath: `/module/relationship/people/${person.id}`,
        provenance: `Person · source ${person.source ?? "relationship"}`,
      }));
      const communityNodes = communityPage.items.map((community) => ({
        id: `community:${community.id}`,
        recordId: community.id,
        label: community.displayName ?? "Unnamed Community",
        databaseId: "communities",
        databaseLabel: "Communities",
        moduleId: "relationship",
        recordType: "community",
        subtitle: community.kind ?? community.location ?? undefined,
        recordPath: `/module/relationship/communities/${community.id}`,
        provenance: `Community · source ${community.source}`,
      }));
      const nodes = [...personNodes, ...communityNodes];
      const nodesById = new Map(nodes.map((node) => [node.id, node]));
      const visibleNodeIds = new Set(nodes.map((node) => node.id));
      const edges = relationPage.items.flatMap((relation) => {
        const sourceId = `${relation.srcType}:${relation.srcId}`;
        const targetId = `${relation.dstType}:${relation.dstId}`;
        if (!visibleNodeIds.has(sourceId) || !visibleNodeIds.has(targetId)) return [];
        const evidenceCount = relation.evidenceRefs.length;
        return [{
          id: relation.id,
          sourceId,
          targetId,
          label: relation.edgeType,
          relationType: relation.edgeType,
          sourceModule: relation.sourceModule,
          recordPath:
            nodesById.get(sourceId)?.recordPath ??
            nodesById.get(targetId)?.recordPath,
          evidence:
            `${evidenceCount} permitted evidence ${evidenceCount === 1 ? "reference" : "references"} · source ${relation.sourceModule}`,
        }];
      });
      return {
        nodes,
        edges,
        databases: [
          { id: "people", label: "People", moduleId: "relationship" },
          { id: "communities", label: "Communities", moduleId: "relationship" },
        ],
        hasMore:
          personPage.total > personPage.items.length ||
          communityPage.total > communityPage.items.length ||
          relationPage.hasMore ||
          edges.length < relationPage.items.length,
      };
    }),

  listRelations: authenticatedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        nodeType: relationshipNodeTypeEnum,
        nodeId: z.string().uuid(),
        limit: z.number().int().min(1).max(100).default(50),
        cursor: z
          .object({
            observedAt: z.string().datetime(),
            createdAt: z.string().datetime(),
            id: z.string().uuid(),
          })
          .optional(),
      }),
    )
    .use(organizationGuard).query(async ({ input, ctx }) => {
      const { items, total, nextCursor } = await ctx.wiring.graphStore.listRelations(
        input.organizationId,
        ctx.identity.id,
        { nodeType: input.nodeType, nodeId: input.nodeId },
        {
          limit: input.limit,
          ...(input.cursor
            ? {
                cursor: {
                  observedAt: new Date(input.cursor.observedAt),
                  createdAt: new Date(input.cursor.createdAt),
                  id: input.cursor.id,
                },
              }
            : {}),
        },
      );
      return {
        items,
        total,
        nextCursor: nextCursor
          ? {
              observedAt: nextCursor.observedAt.toISOString(),
              createdAt: nextCursor.createdAt.toISOString(),
              id: nextCursor.id,
            }
          : null,
        hasMore: nextCursor !== null,
      };
    }),

  findPaths: authenticatedProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      start: z.object({
        nodeType: z.enum(["person", "community"]),
        nodeId: z.string().uuid(),
      }),
      end: z.object({
        nodeType: z.enum(["person", "community"]),
        nodeId: z.string().uuid(),
      }),
      maxDepth: z.number().int().min(1).max(6).default(4),
      maxPaths: z.number().int().min(1).max(5).default(3),
    }))
    .use(organizationGuard).query(async ({ input, ctx }) => {
      const result = await ctx.wiring.graphStore.findRelationshipPaths(
        input.organizationId,
        ctx.identity.id,
        input.start,
        input.end,
        {
          maxDepth: input.maxDepth,
          maxPaths: input.maxPaths,
          maxVisited: 100,
          maxEdgesPerNode: 50,
        },
      );
      return {
        ...result,
        paths: result.paths.map((path) => ({
          ...path,
          steps: path.steps.map((step) => ({
            ...step,
            relation: {
              ...step.relation,
              observedAt: step.relation.observedAt.toISOString(),
              validFrom: step.relation.validFrom?.toISOString() ?? null,
              validTo: step.relation.validTo?.toISOString() ?? null,
              decisionAt: step.relation.decisionAt?.toISOString() ?? null,
              createdAt: step.relation.createdAt.toISOString(),
            },
          })),
        })),
      };
    }),

  communityOrganization: authenticatedProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      communityId: z.string().uuid(),
      limit: z.number().int().min(1).max(50).default(25),
    }))
    .use(organizationGuard).query(async ({ input, ctx }) => {
      const community = await ctx.wiring.graphStore.getCommunity(
        input.organizationId,
        ctx.identity.id,
        input.communityId,
      );
      if (!community) throw new TRPCError({ code: "NOT_FOUND", message: "Community not found" });
      const [timeline, relationPage, signalPage, memberPage] = await Promise.all([
        ctx.wiring.graphStore.listTimeline(
          input.organizationId,
          ctx.identity.id,
          "community",
          input.communityId,
          { limit: input.limit },
        ),
        ctx.wiring.graphStore.listRelations(
          input.organizationId,
          ctx.identity.id,
          { nodeType: "community", nodeId: input.communityId },
          { limit: input.limit },
        ),
        ctx.wiring.graphStore.listSignals(
          input.organizationId,
          ctx.identity.id,
          {
            limit: input.limit,
            offset: 0,
            subjectType: "community",
            subjectId: input.communityId,
          },
        ),
        ctx.wiring.graphStore.listCommunityMembers(
          input.organizationId,
          ctx.identity.id,
          input.communityId,
          { limit: input.limit, offset: 0 },
        ),
      ]);
      const directlyRelatedPersonIds = relationPage.items.flatMap((relation) => {
        if (relation.srcType === "person" && relation.dstType === "community") {
          return [relation.srcId];
        }
        if (relation.dstType === "person" && relation.srcType === "community") {
          return [relation.dstId];
        }
        return [];
      });
      const timelinePeople = timeline.items.flatMap((item) =>
        item.participants
          .filter((participant) => participant.recordType === "person")
          .map((participant) => ({
            id: participant.recordId,
            displayName: participant.displayName,
            relationId: participant.relationId,
            source: "timeline" as const,
          })),
      );
      const directPeople = await Promise.all(
        [...new Set(directlyRelatedPersonIds)].map(async (personId) => {
          const person = await ctx.wiring.graphStore.getPerson(
            input.organizationId,
            ctx.identity.id,
            personId,
          );
          return person
            ? {
                id: person.id,
                displayName: person.displayName,
                relationId: relationPage.items.find((relation) =>
                  relation.srcId === person.id || relation.dstId === person.id,
                )?.id ?? null,
                source: "relation" as const,
              }
            : null;
        }),
      );
      const people = [
        ...timelinePeople,
        ...directPeople.filter((person): person is NonNullable<typeof person> => person !== null),
        ...memberPage.items.map((person) => ({
          id: person.id,
          displayName: person.displayName,
          relationId: null,
          source: "membership" as const,
          role: person.role,
        })),
      ];
      return {
        community,
        people: [...new Map(people.map((person) => [person.id, person])).values()],
        events: timeline.items.map((item) => ({
          ...item,
          occurredAt: item.occurredAt.toISOString(),
          createdAt: item.createdAt.toISOString(),
        })),
        signals: signalPage.items.map((signal) => ({
          ...signal,
          createdAt: signal.createdAt.toISOString(),
        })),
        files: [],
        bounds: {
          relationTruncated: relationPage.nextCursor !== null,
          eventTruncated: timeline.nextCursor !== null,
          signalTruncated: signalPage.total > signalPage.items.length,
          memberTruncated: memberPage.total > memberPage.items.length,
        },
      };
    }),

  proposeSignalEvidence: authenticatedProcedure
    .input(relationshipSignalEvidenceInput)
    .use(organizationGuard).mutation(async ({ input, ctx }) => {
      if (ctx.identity.type !== "user") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Relationship evidence proposals require a Human user principal",
        });
      }
      const detail = await ctx.wiring.graphStore.getSignalEvidenceAnchor(
        input.organizationId,
        ctx.identity.id,
        input.signalId,
        input.sourceEventId,
      );
      if (!detail) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Signal not found or not accessible" });
      }
      const participantsAccessible =
        await ctx.wiring.graphStore.areRelationshipRecordsAccessible(
          input.organizationId,
          ctx.identity.id,
          input.participants,
        );
      if (!participantsAccessible) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "every participant must be an accessible Relationship Record",
        });
      }
      if (
        !input.participants.some(
          (participant) =>
            participant.recordType === detail.signal.subjectType &&
            participant.recordId === detail.signal.subjectId,
        )
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Relationship evidence participants must include the Signal subject",
        });
      }

      const proposal = await ctx.wiring.pipeline.propose(
        {
          organizationId: input.organizationId,
          actor: { type: ctx.identity.type, id: ctx.identity.id, plane: "local" },
          action: "write",
          resourceType: "relation",
          inputs: {
            kind: "relationship_signal_evidence",
            signalId: input.signalId,
            sourceEventId: input.sourceEventId,
            visibility: input.visibility,
            userConfirmed: input.userConfirmed,
            participants: input.participants,
          },
          skill: "stageMutation",
          dataScope: "private",
          seed: input.sourceEventId,
        },
        ctx.run,
        { requireHumanReview: true },
      );
      return {
        proposal,
        materialization:
          proposal.status === "pending_review"
            ? { status: "pending_approval" as const }
            : { status: "rejected" as const },
      };
    }),

  materializationStatus: authenticatedProcedure
    .input(z.object({ organizationId: z.string().uuid(), proposalId: z.string().min(1) }))
    .use(organizationGuard).query(async ({ input, ctx }) => {
      const { ownerUserId } = await approvedRelationshipResolution(
        ctx,
        input.organizationId,
        input.proposalId,
      );
      const effect = await ctx.wiring.relationMaterializations.getByProposal(
        input.organizationId,
        ownerUserId,
        input.proposalId,
      );
      return effect ? relationshipEffectView(effect) : null;
    }),

  outstandingMaterializations: authenticatedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        limit: z.number().int().min(1).max(100).default(50),
        cursor: z.object({ id: z.string().uuid() }).optional(),
      }),
    )
    .use(organizationGuard).query(async ({ input, ctx }) => {
      const { items, nextCursor } =
        await ctx.wiring.relationMaterializations.listOutstandingPage(
          input.organizationId,
          ctx.identity.id,
          {
            limit: input.limit,
            ...(input.cursor ? { cursor: input.cursor } : {}),
          },
        );
      return {
        items: items.map(relationshipEffectView),
        nextCursor,
        hasMore: nextCursor !== null,
      };
    }),

  retryMaterialization: authenticatedProcedure
    .input(z.object({ organizationId: z.string().uuid(), proposalId: z.string().min(1) }))
    .use(organizationGuard).mutation(async ({ input, ctx }) => {
      return retryApprovedRelationship(ctx, input.organizationId, input.proposalId);
    }),

  reconcileApproved: authenticatedProcedure
    .input(z.object({ organizationId: z.string().uuid(), proposalId: z.string().min(1) }))
    .use(organizationGuard).mutation(async ({ input, ctx }) => {
      return retryApprovedRelationship(ctx, input.organizationId, input.proposalId);
    }),

  helpdesk: t.router({
    public: t.router({
      createTicket: publicProcedure
        .input(
          z.object({
            organizationId: z.string().min(1),
            subject: z.string().trim().min(1).max(200),
            submitterEmail: z.string().trim().email().max(320),
            submitterName: z.string().trim().max(120).optional(),
            body: z.string().trim().min(1).max(10_000),
            operationId: z.string().uuid(),
            accessToken: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          const { ticket, message } = await ctx.wiring.helpdeskStore.createTicket({
            organizationId: input.organizationId,
            subject: input.subject,
            submitterEmail: input.submitterEmail,
            body: input.body,
            operationId: input.operationId,
            accessToken: input.accessToken,
            ...(input.submitterName ? { submitterName: input.submitterName } : {}),
          });
          return { ticket, message };
        }),

      getThread: publicProcedure
        .input(z.object({ accessToken: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/) }))
        .query(async ({ input, ctx }) => {
          const result = await ctx.wiring.helpdeskStore.getTicketByToken(input.accessToken);
          if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "unknown ticket" });
          return result;
        }),

      reply: publicProcedure
        .input(
          z.object({
            accessToken: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
            body: z.string().trim().min(1).max(10_000),
            operationId: z.string().uuid(),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          const message = await ctx.wiring.helpdeskStore.replyByToken(
            input.accessToken,
            input.body,
            input.operationId,
          );
          if (!message) throw new TRPCError({ code: "NOT_FOUND", message: "unknown ticket" });
          return message;
        }),
    }),

    list: authenticatedProcedure
      .input(paginatedInput)
      .use(organizationGuard).query(async ({ input, ctx }) => {
        const { items, total } = await ctx.wiring.helpdeskStore.listTickets(input.organizationId, {
          limit: input.limit,
          offset: input.offset,
        });
        return { items, total, hasMore: input.offset + items.length < total };
      }),

    get: authenticatedProcedure
      .input(z.object({ organizationId: z.string().min(1), ticketId: z.string().uuid() }))
      .use(organizationGuard).query(async ({ input, ctx }) => {
        const result = await ctx.wiring.helpdeskStore.getTicket(input.organizationId, input.ticketId);
        if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "unknown ticket" });
        return result;
      }),

    reply: authenticatedProcedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          ticketId: z.string().uuid(),
          body: z.string().trim().min(1).max(10_000),
          status: z.enum(["open", "pending", "resolved", "closed"]).optional(),
        }),
      )
      .use(organizationGuard).mutation(async ({ input, ctx }) => {
        const message = await ctx.wiring.helpdeskStore.replyAsAgent(
          input.organizationId,
          input.ticketId,
          ctx.identity.id,
          input.body,
          input.status,
        );
        if (!message) throw new TRPCError({ code: "NOT_FOUND", message: "unknown ticket" });
        return message;
      }),

    route: authenticatedProcedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          subject: z.string().min(1),
          body: z.string().default(""),
          /** WHO to consider — never their topics. Topics are derived
           * server-side from each candidate's own Person record (`skills`),
           * never accepted from the caller (a caller could otherwise stuff
           * arbitrary topics onto someone else's Person to steer routing). */
          candidatePersonIds: z
            .array(z.string().uuid())
            .max(500, "at most 500 candidate People may be routed")
            .optional(),
          limit: z.number().int().min(1).max(10).default(3),
        }),
      )
      .use(organizationGuard).query(async ({ input, ctx }) => {
        const candidates = (
          await Promise.all(
            (input.candidatePersonIds ?? []).map(async (personId) => {
              const person = await ctx.wiring.graphStore.getPerson(
                input.organizationId,
                ctx.identity.id,
                personId,
              );
              return person
                ? {
                    personId: person.id,
                    displayName: person.displayName ?? "Unnamed person",
                    // Server-side topics ONLY — never caller-supplied. A
                    // Person with no skills contributes no topics (honest
                    // empty state, not a dummy stand-in).
                    topics: person.skills,
                  } satisfies HelpResponderCandidate
                : null;
            }),
          )
        ).filter((candidate): candidate is HelpResponderCandidate => candidate !== null);
        return {
          routes: routeHelpRequest(
            { subject: input.subject, body: input.body },
            candidates,
            input.limit,
          ),
        };
      }),

    stageAnswer: authenticatedProcedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          subject: z.string().min(1),
          body: z.string().default(""),
          routedToPersonId: z.string().uuid(),
          candidateTopics: z.array(z.string().min(1)).max(50),
          draftBody: z.string().min(1),
        }),
      )
      .use(organizationGuard).mutation(async ({ input, ctx }) => {
        const routedPerson = await ctx.wiring.graphStore.getPerson(
          input.organizationId,
          ctx.identity.id,
          input.routedToPersonId,
        );
        if (!routedPerson) {
          throw new TRPCError({ code: "NOT_FOUND", message: "routed Person not found or not accessible" });
        }
        const [route] = routeHelpRequest(
          { subject: input.subject, body: input.body },
          [{
            personId: routedPerson.id,
            displayName: routedPerson.displayName ?? "Unnamed person",
            topics: input.candidateTopics,
          }],
          1,
        );
        if (!route) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "the selected Person no longer matches the supplied routing topics",
          });
        }
        const offer = draftHelpOffer(
          { subject: input.subject, body: input.body },
          route,
          input.draftBody,
        );
        const goalTaskRef = await provisionHelpRequestAnswerTask(ctx.wiring, input.organizationId);
        const proposal = await ctx.wiring.pipeline.propose(
          {
            organizationId: input.organizationId,
            actor: { type: "agent", id: LEARNING_AGENT },
            onBehalfOf: { type: "user", id: ctx.identity.id },
            action: "write",
            resourceType: "signal",
            resourceId: input.routedToPersonId,
            inputs: { ...offer },
            skill: "relationship.help-request.stage-offer",
            goalTaskRef,
          },
          ctx.run,
        );
        return { proposal, offer };
      }),
  }),
});
