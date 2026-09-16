import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { LEARNING_AGENT } from "../wiring.js";
import { desc } from "drizzle-orm";
import { uuidv7 } from "@bridge/core";
import { deterministicUuid } from "../deterministic-uuid.js";
import { anchorLineageKey, assertMembership, attemptGovernedLearningStep, authenticatedProcedure, canonicalAnchorString, decodeRedFlagCursor, encodeRedFlagCursor, isPreferenceAdjustmentContent, isRedFlagContent, monotonicRedFlagNowISO, organizationGuard, parseLearningMemory, procedure, redFlagAnchorInput, revokePreferenceAdjustmentPermanently, t, validateAnchorTarget, withdrawPendingRedFlagProposal, type LearningMemoryContent } from "../router-shared.js";

/**
 * TASK-010 — platform red-flag correction feedback (docs/raw/ui-
 * architecture-rules-2026-07.md §5d, docs/glossary.md "Red Flag"). One
 * platform-wide feedback primitive, separate from onboarding's learning
 * controls above even though it reuses the exact same MemoryStore
 * mechanism — a Red Flag targets ANY eligible data cell or rendered
 * bullet across Modules, not onboarding-specific state.
 *
 * Every procedure here is `authenticatedProcedure` + `assertMembership` —
 * review remediation item 1: a red flag is always `scope: "private"`, so
 * its owner MUST be the real caller (`ctx.identity.id`), never the
 * pilot/demo constant. `get()`'s own authority-scoped visibility predicate
 * (private → owner-only) is the PRIMARY defense — passing `ctx.identity.id`
 * as the auth-scope `userId` everywhere means a non-owner's `get()` already
 * returns `null` (indistinguishable from "doesn't exist," avoiding an IDOR
 * existence oracle) — and every mutation ALSO explicitly re-asserts
 * `ownerUserId === ctx.identity.id` and the parsed `kind === "red_flag"`
 * before acting, so `forget`/`clear`/`reopen`/`updateReason` can never be
 * pointed at an arbitrary Memory id belonging to someone else or to an
 * unrelated Memory kind.
 *
 * `create` writes the Human's own correction directly via `memoryStore`
 * (never routed through `pipeline.propose`, per TASK-007's TASK-010
 * handoff §1) and ALSO starts the separate, governed learning step in the
 * same request (§2 of that handoff): a `pipeline.propose` call, actor
 * `LEARNING_AGENT`, resolved through a real Goal/Task assignment, that
 * stages a reviewable (never auto-applied) preference-adjustment
 * proposal citing the flag as evidence — but see the PRIVACY note on
 * `create` below (review item 2): the ledger entry itself never carries
 * the flag's private detail.
 */
export const redFlagRouter = t.router({
  /**
   * review item 3 (saga/idempotency): `operationId` is a client-generated
   * UUID reused across retries of the SAME logical flagging action.
   * Every id this handler creates (the Memory, the governed Task, the
   * ledger proposal) is DERIVED deterministically from it, so a retried
   * call converges onto the same rows instead of duplicating them. The
   * Human's correction Memory (step 1) and the governed learning attempt
   * (step 2) are tracked as separate idempotent steps: if step 1
   * previously succeeded but step 2 previously failed/never ran
   * (`learningStatus` still `"none"`), a retry RESUMES at step 2 rather
   * than silently reporting stale state — "Memory is Human truth and may
   * survive learning failure," but the learning attempt itself is
   * retryable evidence-bearing state, not silently dropped.
   */
  create: authenticatedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        operationId: z.string().uuid(),
        anchor: redFlagAnchorInput,
        renderedValue: z.string().max(2000),
        renderedVersion: z.string().max(200).optional(),
        reason: z.string().trim().max(500).optional(),
      }),
    )
    .use(organizationGuard).mutation(async ({ input, ctx }) => {
      const ownerId = ctx.identity.id;
      const authScope = { organizationId: input.organizationId, userId: ownerId };
      await validateAnchorTarget(ctx.wiring, input.organizationId, ownerId, input.anchor);
      const anchorKey = anchorLineageKey(input.anchor);
      const memoryId = deterministicUuid(`redflag-memory:${ownerId}:${input.operationId}`);

      // Step 1 (idempotent): the Human's own correction. Never routed
      // through the Agent/Skill pipeline.
      let flagged = await ctx.wiring.memoryStore.get(memoryId, authScope);
      if (flagged) {
        const existingValue = parseLearningMemory(flagged.content);
        if (
          !isRedFlagContent(existingValue) ||
          canonicalAnchorString(existingValue.anchor) !== canonicalAnchorString(input.anchor) ||
          existingValue.renderedValue !== input.renderedValue
        ) {
          throw new TRPCError({ code: "CONFLICT", message: "operationId was already used for a different flag — generate a new one" });
        }
      } else {
        const created = await ctx.wiring.memoryStore.casSupersede({
          organizationId: input.organizationId,
          ownerUserId: ownerId,
          lineageKey: anchorKey,
          expectedCurrentId: null,
          next: {
            id: memoryId,
            organizationId: input.organizationId,
            type: "semantic",
            subjectRecordId: anchorKey,
            scope: "private",
            content: JSON.stringify({
              kind: "red_flag",
              anchor: input.anchor,
              renderedValue: input.renderedValue,
              ...(input.renderedVersion ? { renderedVersion: input.renderedVersion } : {}),
              ...(input.reason ? { reason: input.reason } : {}),
              status: "open",
              learningStatus: "none",
            } satisfies LearningMemoryContent),
            sourceRefType: "feedback",
            trustOrigin: "user_content",
            confidence: 1,
            plane: "local",
            createdBy: ownerId,
            ownerUserId: ownerId,
            createdAt: monotonicRedFlagNowISO(),
          },
        });
        if (!created) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This target already has an open red flag — refresh and use clear/reopen instead of creating a new one",
          });
        }
        flagged = created;
      }

      const currentValue0 = parseLearningMemory(flagged.content);
      if (!isRedFlagContent(currentValue0)) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "red flag memory content was not the expected shape" });
      }

      // Step 2 (idempotent, resumable): the SEPARATE governed learning
      // step, shared with `reopen` (review round-4 item 4: reopening a
      // withdrawn/dismissed flag must also start a FRESH governed review).
      const currentRow = (await ctx.wiring.memoryStore.currentForLineage(input.organizationId, ownerId, anchorKey)) ?? flagged;
      return { memory: await attemptGovernedLearningStep(ctx.wiring, ctx.run, input.organizationId, ownerId, currentRow, flagged.id, `${ownerId}:${input.operationId}`) };
    }),

  /** TASK-010 review round-5 item 4 — "exposes retry for failed
   * pre-proposal state." A `learningStatus: "failed"` flag means the
   * governed learning step itself errored BEFORE ever reaching the
   * ledger (never the Human's own correction, which already succeeded in
   * step 1) — the only prior way to retry it was Clear-then-Reopen, which
   * needlessly forks the flag's own open/cleared history just to retry an
   * unrelated step. This re-attempts the SAME idempotent governed step
   * directly on the CURRENT (still-open-or-cleared) version, seeded by a
   * fresh client-supplied `operationId` (stable across a client's own
   * retry-of-a-retry, mirroring `create`'s idempotency contract) rather
   * than the original attempt's seed — safe because a genuinely "failed"
   * outcome never reached ledger append for its OLD seed (review item 4's
   * `attemptGovernedLearningStep` fix), so there is nothing to reconcile
   * against there; a fresh seed simply starts over cleanly. */
  retryLearning: authenticatedProcedure
    .input(z.object({ organizationId: z.string().min(1), flagId: z.string().uuid(), operationId: z.string().min(1) }))
    .use(organizationGuard).mutation(async ({ input, ctx }) => {
      const ownerId = ctx.identity.id;
      const auth = { organizationId: input.organizationId, userId: ownerId };
      const current = await ctx.wiring.memoryStore.get(input.flagId, auth);
      const value = current && parseLearningMemory(current.content);
      if (!current || !isRedFlagContent(value) || current.ownerUserId !== ownerId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (value.learningStatus !== "failed") {
        throw new TRPCError({ code: "CONFLICT", message: `Only a failed learning step can be retried (current status: "${value.learningStatus}")` });
      }
      return { memory: await attemptGovernedLearningStep(ctx.wiring, ctx.run, input.organizationId, ownerId, current, current.id, `${ownerId}:retry:${input.flagId}:${input.operationId}`) };
    }),

  /** Reversible: appends a new row tagged "cleared" — the flagged Memory's
   * full history (including the original anchor/value/reason) stays intact,
   * never deleted (glossary: "It never silently changes source data").
   * CAS-protected (review item 4): a stale `flagId` (already superseded by
   * some other action) is rejected with CONFLICT rather than silently
   * forking the lineage. */
  clear: authenticatedProcedure
    .input(z.object({ organizationId: z.string().min(1), flagId: z.string().uuid() }))
    .use(organizationGuard).mutation(async ({ input, ctx }) => {
      const ownerId = ctx.identity.id;
      const auth = { organizationId: input.organizationId, userId: ownerId };
      const current = await ctx.wiring.memoryStore.get(input.flagId, auth);
      const value = current && parseLearningMemory(current.content);
      if (!current || !isRedFlagContent(value) || current.ownerUserId !== ownerId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      // review round-4 items 1+4: withdraw/revoke BEFORE flipping status —
      // if either throws, NOTHING here has mutated yet (the flag stays
      // exactly as it was), so the caller sees a clean error and can
      // simply retry `clear` again; both helpers are themselves
      // idempotent (swallow "nothing left to withdraw"/"already
      // revoked"), so a retry after a partial failure converges rather
      // than double-acting or erroring. This closes "do not leave a
      // cleared flag with an approvable proposal on withdrawal failure."
      if (value.proposalId) await withdrawPendingRedFlagProposal(ctx.wiring, ctx.run, value.proposalId, ownerId);
      if (value.preferenceAdjustmentId) {
        await revokePreferenceAdjustmentPermanently(ctx.wiring, input.organizationId, ownerId, value.preferenceAdjustmentId);
      }

      const updated = await ctx.wiring.memoryStore.casSupersede({
        organizationId: input.organizationId,
        ownerUserId: ownerId,
        lineageKey: current.subjectRecordId!,
        expectedCurrentId: input.flagId,
        next: {
          ...current,
          id: uuidv7(),
          content: JSON.stringify({
            ...value,
            status: "cleared",
            // review round-4 item 4 ("set accurate learning state"): a
            // withdrawn/revoked correction is no longer actionable —
            // reflect that directly on the flag itself, not only on the
            // ledger/preference-adjustment side an owner would otherwise
            // have to cross-reference to notice.
            ...(value.proposalId || value.preferenceAdjustmentId ? { learningStatus: "dismissed" as const } : {}),
          } satisfies LearningMemoryContent),
          trustOrigin: "user_content",
          createdBy: ownerId,
          createdAt: monotonicRedFlagNowISO(),
        },
      });
      if (!updated) {
        throw new TRPCError({ code: "CONFLICT", message: "This flag was already changed by another action — refresh and try again" });
      }
      return { memory: updated };
    }),

  /** The "undo" for `clear` — symmetric CAS-protected supersede back to
   * "open." Review round-4 item 4: reopening starts a FRESH governed
   * review for this newly-active version — it never resurrects a prior
   * (vetoed/withdrawn/revoked) proposal, which stays permanently resolved
   * exactly as it was. */
  reopen: authenticatedProcedure
    .input(z.object({ organizationId: z.string().min(1), flagId: z.string().uuid() }))
    .use(organizationGuard).mutation(async ({ input, ctx }) => {
      const ownerId = ctx.identity.id;
      const auth = { organizationId: input.organizationId, userId: ownerId };
      const current = await ctx.wiring.memoryStore.get(input.flagId, auth);
      const value = current && parseLearningMemory(current.content);
      if (!current || !isRedFlagContent(value) || current.ownerUserId !== ownerId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const reopenedId = uuidv7();
      // Reopening starts a FRESH governed review — clear every field the
      // OLD (resolved) proposal/preference-adjustment left behind rather
      // than nulling them (`exactOptionalPropertyTypes` forbids setting
      // an optional field to `undefined` explicitly).
      const { proposalId: _staleProposalId, preferenceAdjustmentId: _staleAdjustmentId, learningFailureReason: _staleFailureReason, ...valueBase } = value;
      const updated = await ctx.wiring.memoryStore.casSupersede({
        organizationId: input.organizationId,
        ownerUserId: ownerId,
        lineageKey: current.subjectRecordId!,
        expectedCurrentId: input.flagId,
        next: {
          ...current,
          id: reopenedId,
          content: JSON.stringify({
            ...valueBase,
            status: "open",
            learningStatus: "none",
          } satisfies LearningMemoryContent),
          trustOrigin: "user_content",
          createdBy: ownerId,
          createdAt: monotonicRedFlagNowISO(),
        },
      });
      if (!updated) {
        throw new TRPCError({ code: "CONFLICT", message: "This flag was already changed by another action — refresh and try again" });
      }
      return {
        memory: await attemptGovernedLearningStep(ctx.wiring, ctx.run, input.organizationId, ownerId, updated, updated.id, `${ownerId}:reopen:${reopenedId}`),
      };
    }),

  /** The "edit" half of inspect/edit/clear (§5d). CAS-protected like
   * clear/reopen above. */
  updateReason: authenticatedProcedure
    .input(z.object({ organizationId: z.string().min(1), flagId: z.string().uuid(), reason: z.string().trim().min(1).max(500) }))
    .use(organizationGuard).mutation(async ({ input, ctx }) => {
      const ownerId = ctx.identity.id;
      const auth = { organizationId: input.organizationId, userId: ownerId };
      const current = await ctx.wiring.memoryStore.get(input.flagId, auth);
      const value = current && parseLearningMemory(current.content);
      if (!current || !isRedFlagContent(value) || current.ownerUserId !== ownerId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (value.reason === input.reason) return { memory: current }; // no-op: nothing changed, don't fork the lineage for free
      const updated = await ctx.wiring.memoryStore.casSupersede({
        organizationId: input.organizationId,
        ownerUserId: ownerId,
        lineageKey: current.subjectRecordId!,
        expectedCurrentId: input.flagId,
        next: {
          ...current,
          id: uuidv7(),
          content: JSON.stringify({ ...value, reason: input.reason } satisfies LearningMemoryContent),
          trustOrigin: "user_content",
          createdBy: ownerId,
          createdAt: monotonicRedFlagNowISO(),
        },
      });
      if (!updated) {
        throw new TRPCError({ code: "CONFLICT", message: "This flag was already changed by another action — refresh and try again" });
      }
      return { memory: updated };
    }),

  /** TASK-010 review round-4 item 1 — the SEPARATE, Human-authorized
   * enactment path: once the flag owner has approved the governed
   * proposal (via `action.decide`), THIS endpoint (never the Agent, never
   * `pipeline.propose`) applies the actual correction — flipping the
   * private PreferenceAdjustment to "applied" and the flag's own
   * `learningStatus` to "applied," the ONLY state where `RedFlagControl`
   * visibly withholds the flagged rendered value. Idempotent (already-
   * applied is a no-op); fully reversible via `revokeCorrection`. */
  enactCorrection: authenticatedProcedure
    .input(z.object({ organizationId: z.string().min(1), flagId: z.string().uuid() }))
    .use(organizationGuard).mutation(async ({ input, ctx }) => {
      const ownerId = ctx.identity.id;
      const auth = { organizationId: input.organizationId, userId: ownerId };
      const current = await ctx.wiring.memoryStore.get(input.flagId, auth);
      const value = current && parseLearningMemory(current.content);
      if (!current || !isRedFlagContent(value) || current.ownerUserId !== ownerId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (value.learningStatus === "applied") return { memory: current };
      if (!value.proposalId || !value.preferenceAdjustmentId || value.learningStatus !== "proposed") {
        throw new TRPCError({ code: "CONFLICT", message: `This correction cannot be enacted from status "${value.learningStatus}"` });
      }
      const decision = await ctx.wiring.ledger.decisionFor(value.proposalId);
      if (!decision || decision.userDecision !== "approve") {
        throw new TRPCError({ code: "CONFLICT", message: "This correction has not been approved yet — approve it in Approvals first" });
      }
      const adjustment = await ctx.wiring.memoryStore.currentForLineage(input.organizationId, ownerId, value.preferenceAdjustmentId);
      const adjustmentValue = adjustment && parseLearningMemory(adjustment.content);
      if (!adjustment || !isPreferenceAdjustmentContent(adjustmentValue) || adjustment.ownerUserId !== ownerId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "the linked preference adjustment could not be found" });
      }
      if (adjustmentValue.status === "revoked") {
        throw new TRPCError({ code: "CONFLICT", message: "This correction was permanently revoked — reopen the flag to submit a new one" });
      }
      if (adjustmentValue.status !== "applied") {
        const appliedAdjustment = await ctx.wiring.memoryStore.casSupersede({
          organizationId: input.organizationId,
          ownerUserId: ownerId,
          lineageKey: adjustment.subjectRecordId!,
          expectedCurrentId: adjustment.id,
          next: {
            ...adjustment,
            id: uuidv7(),
            content: JSON.stringify({ ...adjustmentValue, status: "applied", appliedAt: new Date().toISOString() } satisfies LearningMemoryContent),
            trustOrigin: "user_content",
            createdBy: ownerId,
            createdAt: monotonicRedFlagNowISO(),
          },
        });
        if (!appliedAdjustment) {
          throw new TRPCError({ code: "CONFLICT", message: "This correction was already changed — refresh and try again" });
        }
      }
      const updatedFlag = await ctx.wiring.memoryStore.casSupersede({
        organizationId: input.organizationId,
        ownerUserId: ownerId,
        lineageKey: current.subjectRecordId!,
        expectedCurrentId: input.flagId,
        next: {
          ...current,
          id: uuidv7(),
          content: JSON.stringify({ ...value, learningStatus: "applied" } satisfies LearningMemoryContent),
          trustOrigin: "user_content",
          createdBy: ownerId,
          createdAt: monotonicRedFlagNowISO(),
        },
      });
      if (!updatedFlag) {
        throw new TRPCError({ code: "CONFLICT", message: "This flag was already changed by another action — refresh and try again" });
      }
      return { memory: updatedFlag };
    }),

  /** The "undo" for `enactCorrection` — proves review round-4 item 1's
   * "behavior changes only after approval and can be undone." Terminally
   * revokes the linked PreferenceAdjustment (never re-enactable — the
   * owner must `clear`+`reopen` to submit a fresh correction) and reverts
   * the flag's `learningStatus` to "dismissed," the same terminal state
   * `clear`'s own withdrawal path uses. */
  revokeCorrection: authenticatedProcedure
    .input(z.object({ organizationId: z.string().min(1), flagId: z.string().uuid() }))
    .use(organizationGuard).mutation(async ({ input, ctx }) => {
      const ownerId = ctx.identity.id;
      const auth = { organizationId: input.organizationId, userId: ownerId };
      const current = await ctx.wiring.memoryStore.get(input.flagId, auth);
      const value = current && parseLearningMemory(current.content);
      if (!current || !isRedFlagContent(value) || current.ownerUserId !== ownerId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (value.learningStatus !== "applied") {
        throw new TRPCError({ code: "CONFLICT", message: "This flag has no applied correction to revoke" });
      }
      if (value.preferenceAdjustmentId) {
        await revokePreferenceAdjustmentPermanently(ctx.wiring, input.organizationId, ownerId, value.preferenceAdjustmentId);
      }
      const updatedFlag = await ctx.wiring.memoryStore.casSupersede({
        organizationId: input.organizationId,
        ownerUserId: ownerId,
        lineageKey: current.subjectRecordId!,
        expectedCurrentId: input.flagId,
        next: {
          ...current,
          id: uuidv7(),
          content: JSON.stringify({ ...value, learningStatus: "dismissed" } satisfies LearningMemoryContent),
          trustOrigin: "user_content",
          createdBy: ownerId,
          createdAt: monotonicRedFlagNowISO(),
        },
      });
      if (!updatedFlag) {
        throw new TRPCError({ code: "CONFLICT", message: "This flag was already changed by another action — refresh and try again" });
      }
      return { memory: updatedFlag };
    }),

  /** Genuine personal-data deletion — distinct from `clear` (a reversible
   * status change). Rejects arbitrary/foreign/wrong-kind Memory ids
   * (review item 1) and, before deleting, enumerates EVERY version across
   * the full lineage (review round-4 item 5 — `forget` deletes the whole
   * lineage, so a still-pending/applied proposal cited by an OLDER or
   * NEWER version than whichever id the caller happened to pass must
   * still be withdrawn/revoked) and withdraws/revokes every distinct
   * proposal/preference-adjustment id found, so nothing actionable can
   * survive referencing evidence that no longer exists. */
  forget: authenticatedProcedure
    .input(z.object({ organizationId: z.string().min(1), flagId: z.string().uuid() }))
    .use(organizationGuard).mutation(async ({ input, ctx }) => {
      const ownerId = ctx.identity.id;
      const auth = { organizationId: input.organizationId, userId: ownerId };
      const current = await ctx.wiring.memoryStore.get(input.flagId, auth);
      const value = current && parseLearningMemory(current.content);
      if (!current || !isRedFlagContent(value) || current.ownerUserId !== ownerId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const proposalIds = new Set<string>();
      const preferenceAdjustmentIds = new Set<string>();
      let cursor: { createdAt: string; id: string } | undefined;
      while (true) {
        const page = await ctx.wiring.memoryStore.retrieve(
          { subjectRecordId: current.subjectRecordId!, includeSuperseded: true, order: "asc", limit: 200, ...(cursor ? { cursor } : {}) },
          auth,
        );
        for (const row of page) {
          const v = parseLearningMemory(row.content);
          if (isRedFlagContent(v)) {
            if (v.proposalId) proposalIds.add(v.proposalId);
            if (v.preferenceAdjustmentId) preferenceAdjustmentIds.add(v.preferenceAdjustmentId);
          }
        }
        if (page.length < 200) break;
        const last = page[page.length - 1]!;
        cursor = { createdAt: last.createdAt, id: last.id };
      }
      for (const proposalId of proposalIds) {
        await withdrawPendingRedFlagProposal(ctx.wiring, ctx.run, proposalId, ownerId);
      }
      for (const preferenceAdjustmentId of preferenceAdjustmentIds) {
        await revokePreferenceAdjustmentPermanently(ctx.wiring, input.organizationId, ownerId, preferenceAdjustmentId);
      }
      const forgotten = await ctx.wiring.memoryStore.forget(input.flagId, auth);
      return { forgotten };
    }),

  /** Current (non-superseded) flag for ONE exact anchor — an indexed
   * `subjectRecordId` equality lookup (review items 5+6+7: the
   * deterministic anchor lineage key makes this O(1)-ish instead of a
   * full-table content scan). Powers a single cell/bullet's own
   * hover/focus state when a batched `listForScope` fetch isn't already
   * available. */
  listForAnchor: authenticatedProcedure
    .input(z.object({ organizationId: z.string().min(1), anchor: redFlagAnchorInput }))
    .use(organizationGuard).query(async ({ input, ctx }) => {
      const rows = await ctx.wiring.memoryStore.retrieve(
        { subjectRecordId: anchorLineageKey(input.anchor), sourceRefType: "feedback", contentPathEquals: [{ path: "kind", equals: "red_flag" }], limit: 1 },
        { organizationId: input.organizationId, userId: ctx.identity.id },
      );
      const flags = rows
        .map((row) => ({ row, value: parseLearningMemory(row.content) }))
        .filter((item): item is { row: (typeof rows)[number]; value: Extract<LearningMemoryContent, { kind: "red_flag" }> } => isRedFlagContent(item.value));
      return { flags };
    }),

  /**
   * Current flags across a whole scope (a Module, optionally narrowed to
   * one Database/table, or one record/file/result's bullets) in ONE call
   * — review item 7: the primitive a `RedFlagProvider` batches an entire
   * visible table/page's worth of cells/bullets through, instead of one
   * `listForAnchor` query per rendered cell. The dominant reducers
   * (`kind: "red_flag"`, `anchor.moduleId`) are pushed into the DB query
   * itself via `contentPathEquals` (review round-4 item 7) rather than
   * scanned app-side over an unbounded/artificially-capped page — the
   * `kind` predicate specifically excludes the SEPARATE
   * `preference_adjustment` Memories the governed step synthesizes (review
   * round-4 item 1), which also carry `sourceRefType: "feedback"` and the
   * SAME `anchor` shape as their originating flag, so without it they'd
   * silently interleave with (and, at the `listAll` cursor boundary,
   * crowd out) the actual red_flag rows a caller asked for. The
   * remaining, finer-grained database/record/file/result narrowing stays
   * app-side over that already-scoped (typically small) result set, since
   * it needs an OR across the cell/bullet shapes a single equality
   * predicate can't express.
   */
  listForScope: authenticatedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        moduleId: z.string().min(1),
        databaseId: z.string().min(1).optional(),
        recordId: z.string().min(1).optional(),
        fileId: z.string().min(1).optional(),
        resultId: z.string().min(1).optional(),
      }),
    )
    .use(organizationGuard).query(async ({ input, ctx }) => {
      const rows = await ctx.wiring.memoryStore.retrieve(
        {
          sourceRefType: "feedback",
          contentPathEquals: [
            { path: "kind", equals: "red_flag" },
            { path: "anchor.moduleId", equals: input.moduleId },
          ],
        },
        { organizationId: input.organizationId, userId: ctx.identity.id },
      );
      const flags = rows
        .map((row) => ({ row, value: parseLearningMemory(row.content) }))
        .filter((item): item is { row: (typeof rows)[number]; value: Extract<LearningMemoryContent, { kind: "red_flag" }> } => isRedFlagContent(item.value))
        .filter((item) => {
          const a = item.value.anchor;
          if (input.databaseId !== undefined && (a.kind !== "cell" || a.databaseId !== input.databaseId)) return false;
          if (input.recordId !== undefined) {
            const matchesRecord = (a.kind === "cell" && a.recordId === input.recordId) || (a.kind === "bullet" && a.target.type === "record" && a.target.recordId === input.recordId);
            if (!matchesRecord) return false;
          }
          if (input.fileId !== undefined && !(a.kind === "bullet" && a.target.type === "file" && a.target.fileId === input.fileId)) return false;
          if (input.resultId !== undefined && !(a.kind === "bullet" && a.target.type === "result" && a.target.resultId === input.resultId)) return false;
          return true;
        });
      return { flags };
    }),

  /**
   * The audit/inspect surface — "inspect the audit evidence" from the
   * Prototype test. Server-side filtered to `sourceRefType: "feedback"`,
   * `kind: "red_flag"`, AND (when requested) `status` — ALL pushed into
   * the store query BEFORE `limit` (review item 6 + round-4 item 1's
   * preference-adjustment exclusion + round-5 item 9: the `status`
   * predicate was previously applied app-side AFTER the page was already
   * capped, which could silently under-fill or empty a page whenever it
   * happened to be dominated by the OTHER status) — with a REAL keyset
   * `(createdAt, id)` cursor (review round-4 item 8) immune to a flag
   * inserted/superseded between page fetches.
   */
  listAll: authenticatedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        status: z.enum(["open", "cleared"]).optional(),
        limit: z.number().int().min(1).max(100).default(50),
        cursor: z.string().optional(),
      }),
    )
    .use(organizationGuard).query(async ({ input, ctx }) => {
      const cursor = decodeRedFlagCursor(input.cursor);
      const rows = await ctx.wiring.memoryStore.retrieve(
        {
          sourceRefType: "feedback",
          contentPathEquals: [
            { path: "kind", equals: "red_flag" },
            ...(input.status ? [{ path: "status", equals: input.status }] : []),
          ],
          order: "desc",
          limit: input.limit,
          ...(cursor ? { cursor } : {}),
        },
        { organizationId: input.organizationId, userId: ctx.identity.id },
      );
      const flags = rows
        .map((row) => ({ row, value: parseLearningMemory(row.content) }))
        .filter((item): item is { row: (typeof rows)[number]; value: Extract<LearningMemoryContent, { kind: "red_flag" }> } => isRedFlagContent(item.value));
      const lastRow = rows[rows.length - 1];
      const nextCursor = rows.length === input.limit && lastRow ? encodeRedFlagCursor(lastRow) : null;
      return { flags, nextCursor };
    }),

  /** Explicit lineage/history for one flag — every create/clear/reopen/
   * updateReason/learning-outcome version, oldest first, including
   * superseded rows (review item 6's "explicit lineage history"). A REAL
   * keyset cursor (review round-4 item 8) removes the prior 200-version
   * silent cap: a lineage with more versions than one page simply returns
   * a `nextCursor` rather than truncating. */
  history: authenticatedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        flagId: z.string().uuid(),
        limit: z.number().int().min(1).max(200).default(100),
        cursor: z.string().optional(),
      }),
    )
    .use(organizationGuard).query(async ({ input, ctx }) => {
      const ownerId = ctx.identity.id;
      const auth = { organizationId: input.organizationId, userId: ownerId };
      const current = await ctx.wiring.memoryStore.get(input.flagId, auth);
      const value = current && parseLearningMemory(current.content);
      if (!current || !isRedFlagContent(value) || current.ownerUserId !== ownerId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const cursor = decodeRedFlagCursor(input.cursor);
      const rows = await ctx.wiring.memoryStore.retrieve(
        {
          subjectRecordId: current.subjectRecordId!,
          includeSuperseded: true,
          order: "asc",
          // review round-7: this query is scoped to ONE lineage
          // (`subjectRecordId` above), so `lineageRevision` ordering is
          // valid here (see MemoryQuery.orderBy's doc) and replaces the
          // formerly process-local `monotonicRedFlagNowISO` counter for
          // "which version of THIS lineage came first" — durable across
          // any number of server processes/restarts. A legacy row written
          // before this column existed still sorts oldest (its revision
          // is `null`, always treated as older than any allocated one).
          orderBy: "lineageRevision",
          limit: input.limit,
          ...(cursor ? { cursor } : {}),
        },
        auth,
      );
      const versions = rows
        .map((row) => ({ row, value: parseLearningMemory(row.content) }))
        .filter((item): item is { row: (typeof rows)[number]; value: Extract<LearningMemoryContent, { kind: "red_flag" }> } => isRedFlagContent(item.value));
      const lastRow = rows[rows.length - 1];
      const nextCursor = rows.length === input.limit && lastRow ? encodeRedFlagCursor(lastRow) : null;
      return { versions, nextCursor };
    }),
});
