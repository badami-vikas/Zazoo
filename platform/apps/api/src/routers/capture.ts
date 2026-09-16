import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { LEARNING_AGENT, PILOT_ORGANIZATION } from "../wiring.js";
import type { DataScope } from "@bridge/core";
import { authenticatedProcedure, findPendingCaptureProposal, getCaptureReviewEnvelope, organizationGuard, pendingProposalFromLedger, procedure, provisionCaptureTask, putCaptureReviewEnvelope, t, withCaptureStageLock } from "../router-shared.js";

/** Gmail + Google Calendar integration — connect, sync (read), send (write). */
/** Gmail + Google Calendar — connect, sync (read), draft (write). Distinct from the
 * generic `integration` router below (social providers + governed scopes).
 *
 * Single-tenant note (All fixes.md Phase 3 item 11a): these procedures take NO
 * `organizationId` param at all — they are organization-IMPLICIT, always resolving
 * through `ctx.wiring.google`, which is itself pinned to `PILOT_ORGANIZATION` inside
 * `buildWiring()`. We deliberately did NOT add an optional `organizationId` param here
 * (unlike `dealpilot.list`): no frontend caller (`Design Bridge AI Interface
 * (Copy)/src/app/data/api.ts`) ever attempts to pass a organization context to any
 * `google.*` call, so there is no existing behavior that silently ignores a
 * client-supplied organization id to fix — these procedures never claimed
 * multi-tenancy in the first place. Adding an unused, always-optional param would
 * only add surface area without closing a real gap; if a caller ever needs
 * multi-organization Google integration, that's the same Phase 5 multi-tenancy work
 * the rest of this fix explicitly defers, not a one-off param here. */
/**
 * AGS1 (TASK-007 closure) — raw human capture (camera tool), migrated off a
 * client-constructed `action.propose` call (which previously sent a raw
 * `actor:{type:"user"}` for `skill:"stageCapture"`) onto a dedicated
 * procedure: the SERVER, never the client, decides the invoking Agent
 * (LEARNING_AGENT — "observes authorized evidence") and provisions the
 * Goal/Task `stageCapture`'s manifest requires (see wiring.ts's
 * STAGE_CAPTURE_SKILL_MANIFEST).
 */
export const captureRouter = t.router({
  stage: authenticatedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        localMediaId: z.string().trim().min(1).max(500),
        kind: z.enum(["photo", "video"]).optional(),
        caption: z.string().trim().max(4_000).optional(),
        ocrText: z.string().max(20_000).optional(),
        capturedAt: z.string().datetime({ offset: true }),
      }),
    )
    .use(organizationGuard).mutation(async ({ input, ctx }) => {
      return withCaptureStageLock(
        `${input.organizationId}:${ctx.identity.id}:${input.localMediaId}`,
        async () => {
          const receivedAt = ctx.run.clock.nowISO();
          const existingEnvelope = await getCaptureReviewEnvelope(
            ctx.wiring,
            input.organizationId,
            input.localMediaId,
          );
          if (
            existingEnvelope &&
            existingEnvelope.ownerUserId !== ctx.identity.id
          ) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Local Media not found",
            });
          }
          if (existingEnvelope?.status === "applied") {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Local Media was already materialized",
            });
          }

          let pending = await findPendingCaptureProposal(
            ctx.wiring,
            input.organizationId,
            ctx.identity.id,
            input.localMediaId,
          );
          if (
            !pending &&
            existingEnvelope?.status === "pending_review" &&
            existingEnvelope.proposalId
          ) {
            const candidate = await ctx.wiring.ledger.get(
              existingEnvelope.proposalId,
            );
            if (candidate) {
              const decision = await ctx.wiring.ledger.decisionFor(candidate.id);
              if (decision) {
                throw new TRPCError({
                  code: "CONFLICT",
                  message:
                    "The recorded capture decision still requires effect reconciliation",
                });
              }
              pending = candidate;
            }
          }
          if (pending) {
            await putCaptureReviewEnvelope(ctx.wiring, input.organizationId, {
              kind: "capture_review_envelope",
              localMediaId: input.localMediaId,
              ownerUserId: ctx.identity.id,
              capturedAt: existingEnvelope?.capturedAt ?? input.capturedAt,
              receivedAt: existingEnvelope?.receivedAt ?? receivedAt,
              status: "pending_review",
              proposalId: pending.id,
            });
            return pendingProposalFromLedger(pending);
          }

          const stagingEnvelope = {
            kind: "capture_review_envelope" as const,
            localMediaId: input.localMediaId,
            ownerUserId: ctx.identity.id,
            capturedAt: input.capturedAt,
            receivedAt,
            status: "staging" as const,
          };
          await putCaptureReviewEnvelope(
            ctx.wiring,
            input.organizationId,
            stagingEnvelope,
          );
          const goalTaskRef = await provisionCaptureTask(
            ctx.wiring,
            input.organizationId,
          );
          const proposal = await ctx.wiring.pipeline.propose(
            {
              organizationId: input.organizationId,
              actor: { type: "agent", id: LEARNING_AGENT, plane: "local" },
              onBehalfOf: { type: "user", id: ctx.identity.id },
              action: "write",
              resourceType: "event",
              dataScope: "private" as DataScope,
              skill: "stageCapture",
              seed: `capture:${input.organizationId}:${input.localMediaId}`,
              inputs: {
                local_media_id: input.localMediaId,
                ...(input.kind ? { kind: input.kind } : {}),
                ...(input.caption ? { caption: input.caption } : {}),
                ...(input.ocrText ? { ocrText: input.ocrText } : {}),
              },
              goalTaskRef,
            },
            ctx.run,
          );
          if (proposal.status === "applied") {
            throw new Error(
              "Capture staging bypassed its required review policy",
            );
          }
          await putCaptureReviewEnvelope(ctx.wiring, input.organizationId, {
            ...stagingEnvelope,
            status:
              proposal.status === "pending_review"
                ? "pending_review"
                : "rejected",
            proposalId: proposal.id,
          });
          return proposal;
        },
      );
    }),
  status: authenticatedProcedure
    .input(z.object({
      organizationId: z.string().min(1),
      localMediaIds: z.array(z.string().trim().min(1).max(500)).max(100),
    }))
    .use(organizationGuard).query(async ({ input, ctx }) => {
      const items = await Promise.all(
        input.localMediaIds.map(async (localMediaId) => {
          const envelope = await getCaptureReviewEnvelope(
            ctx.wiring,
            input.organizationId,
            localMediaId,
          );
          if (!envelope || envelope.ownerUserId !== ctx.identity.id) {
            return { localMediaId, status: "not_found" as const };
          }
          return {
            localMediaId,
            status: envelope.status,
            proposalId: envelope.proposalId ?? null,
            decisionLedgerId: envelope.decisionLedgerId ?? null,
          };
        }),
      );
      return { items };
    }),
});
