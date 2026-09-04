import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { uuidv7 } from "@bridge/core";
import { assertPilotOrganization, authenticatedProcedure, consumePhoneOtpProof, isLegacyOnboardingContent, isPreferenceAdjustmentContent, isRedFlagContent, organizationGuard, parseLearningMemory, phoneOtpProofs, procedure, proposeRoleModelRecommendation, t, type LegacyOnboardingMemoryContent } from "../router-shared.js";

export const onboardingRouter = t.router({
  getProfile: procedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      return { profile: await ctx.wiring.onboardingProfileStore.get(input.organizationId) };
    }),

  saveProfile: procedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        avatarStyle: z.string().min(1),
        // Whitelisted onboarding answer keys. E3 (2026-08-05) trimmed the
        // USER-FACING question set to the five documented manual questions
        // and added `workday` / `work_context` / `work_lives`; the older keys
        // stay accepted because saved profiles still carry them and an
        // explicit answer still overrides the derived value.
        answers: z.object({
          profession: z.string().optional(),
          avatar_style: z.string().optional(),
          workday: z.array(z.string()).optional(),
          work_context: z.string().optional(),
          work_lives: z.array(z.string()).optional(),
          role_model: z.string().optional(),
          role_model_why: z.string().optional(),
          domain: z.string().optional(),
          watch_first: z.array(z.string()).optional(),
          vocab_name: z.string().optional(),
          view_style: z.string().optional(),
          organization_name: z.string().optional(),
        }).strict().default({}),
        // SEC-7: `linkedin` was removed from this trust-bearing enum. There is no
        // real LinkedIn OAuth proof wired, so accepting a client-asserted
        // `verificationMethod:"linkedin"` would let the browser fabricate a
        // verification/trust signal. Only `phone` (the explicitly-dummy OTP flow
        // below) is accepted until a real OAuth proof exists.
        verificationMethod: z.enum(["phone"]).nullable().default(null),
        connectedSourceIds: z.array(z.string()).default([]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      const existing = await ctx.wiring.onboardingProfileStore.get(input.organizationId);
      const row = {
        organizationId: input.organizationId,
        avatarStyle: input.avatarStyle,
        answers: { ...input.answers, avatar_style: input.avatarStyle },
        phoneVerified: (input.verificationMethod === "phone" && consumePhoneOtpProof(ctx.identity.id))
          ? true
          : (existing?.phoneVerified ?? false),
        verificationMethod: input.verificationMethod ?? existing?.verificationMethod ?? null,
        connectedSourceIds: input.connectedSourceIds,
        updatedAtISO: new Date().toISOString(),
      };
      await ctx.wiring.onboardingProfileStore.save(row);
      const existingMemories = await ctx.wiring.memoryStore.retrieve(
        { limit: 100 },
        { organizationId: input.organizationId, userId: ctx.wiring.pilotUserId },
      );
      if (!existingMemories.some((memory) => parseLearningMemory(memory.content)?.kind === "reflection_schedule")) {
        await ctx.wiring.memoryStore.write({
          id: uuidv7(),
          organizationId: input.organizationId,
          type: "procedural",
          scope: "private",
          content: JSON.stringify({
            kind: "reflection_schedule",
            dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
            status: "scheduled",
          }),
          confidence: 1,
          trustOrigin: "operator",
          plane: "local",
          createdBy: "learning",
          ownerUserId: ctx.wiring.pilotUserId,
        });
      }
      return { profile: row };
    }),

  /** TASK-010 review round-5 item 1 — this legacy onboarding surface must
   * NEVER leak `red_flag`/`preference_adjustment` content: it now (a)
   * requires authentication + organization membership (was a bare
   * `procedure`, which only gates MUTATIONS, leaving this QUERY reachable
   * unauthenticated), (b) is owner-scoped to the REAL caller
   * (`ctx.identity.id`), never the shared `pilotUserId` constant, and (c)
   * whitelists the returned `kind`s to ONLY the three this surface has
   * ever displayed (`onboarding_preference`/`reflection_schedule`/
   * `trust_capture` — confirmed against SettingsPage.tsx's own
   * `LearningSection`, which never reads anything else from this query) —
   * a red-flag correction or its synthesized preference adjustment must
   * only ever be read through the owner-scoped `redFlag.*` surface. */
  learningState: authenticatedProcedure
      .input(z.object({ organizationId: z.string().min(1) }))
      .use(organizationGuard).query(async ({ input, ctx }) => {
        const rows = await ctx.wiring.memoryStore.retrieve(
          { limit: 100 },
          { organizationId: input.organizationId, userId: ctx.identity.id },
        );
        return {
          memories: rows
            .map((row) => ({ row, value: parseLearningMemory(row.content) }))
            .filter((item): item is typeof item & { value: LegacyOnboardingMemoryContent } => isLegacyOnboardingContent(item.value)),
        };
      }),

  recordTrustCapture: procedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        appName: z.string().trim().min(1).max(200),
        bundleId: z.string().trim().min(1).max(300).optional(),
        capturedAt: z.string().datetime(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      const memory = await ctx.wiring.memoryStore.write({
        id: uuidv7(),
        organizationId: input.organizationId,
        type: "episodic",
        scope: "private",
        content: JSON.stringify({
          kind: "trust_capture",
          appName: input.appName,
          ...(input.bundleId ? { bundleId: input.bundleId } : {}),
          capturedAt: input.capturedAt,
        }),
        confidence: 1,
        trustOrigin: "untrusted_external",
        plane: "local",
        createdBy: "desktop:apps",
        ownerUserId: ctx.wiring.pilotUserId,
      });
      return { memory };
    }),

  recommendFromRoleModel: procedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          figure: z.string().trim().min(2).max(120),
          admiredFor: z.string().trim().min(2).max(500),
        }),
      )
      .use(organizationGuard).mutation(async ({ input, ctx }) => {
        return proposeRoleModelRecommendation(
          ctx.wiring,
          ctx.run,
          ctx.identity.id,
          input,
        );
      }),

  correctMemory: procedure
      .input(z.object({ organizationId: z.string().min(1), memoryId: z.string().uuid(), content: z.string().trim().min(1).max(500) }))
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        const auth = { organizationId: input.organizationId, userId: ctx.wiring.pilotUserId };
        const current = await ctx.wiring.memoryStore.get(input.memoryId, auth);
        const value = current && parseLearningMemory(current.content);
        if (!current || value?.kind !== "onboarding_preference") throw new TRPCError({ code: "NOT_FOUND" });
        return ctx.wiring.memoryStore.supersede(input.memoryId, {
          ...current,
          id: uuidv7(),
          content: JSON.stringify({ ...value, admiredFor: input.content }),
          trustOrigin: "user_content",
          createdBy: ctx.identity.id,
        });
      }),

  /** TASK-010 review round-5 item 1 — owner-scoped + kind-whitelisted, the
   * same rationale as `learningState` above: this generic delete must
   * REJECT a `red_flag`/`preference_adjustment` Memory id outright (not
   * silently no-op) so all correction deletion is forced through
   * `redFlag.forget`, which withdraws/revokes the linked governed
   * proposal BEFORE deleting — a bare `memoryStore.forget` here would
   * delete the evidence while leaving an approvable/appliable proposal
   * referencing nothing. */
  forgetMemory: authenticatedProcedure
      .input(z.object({ organizationId: z.string().min(1), memoryId: z.string().uuid() }))
      .use(organizationGuard).mutation(async ({ input, ctx }) => {
        const auth = { organizationId: input.organizationId, userId: ctx.identity.id };
        const current = await ctx.wiring.memoryStore.get(input.memoryId, auth);
        const value = current && parseLearningMemory(current.content);
        if (current && (isRedFlagContent(value) || isPreferenceAdjustmentContent(value))) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Red-flag corrections must be deleted via redFlag.forget, which withdraws their governed proposal first",
          });
        }
        return {
          forgotten: await ctx.wiring.memoryStore.forget(input.memoryId, auth),
        };
      }),

  setReflection: procedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          memoryId: z.string().uuid(),
          action: z.enum(["snooze", "pause", "resume", "skip"]),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        const auth = { organizationId: input.organizationId, userId: ctx.wiring.pilotUserId };
        const current = await ctx.wiring.memoryStore.get(input.memoryId, auth);
        const value = current && parseLearningMemory(current.content);
        if (!current || value?.kind !== "reflection_schedule") throw new TRPCError({ code: "NOT_FOUND" });
        const status = input.action === "resume" ? "scheduled" : input.action === "snooze" ? "snoozed" : input.action === "pause" ? "paused" : "skipped";
        const dueAt = input.action === "snooze"
          ? new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString()
          : input.action === "resume"
            ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString()
            : value.dueAt;
        return ctx.wiring.memoryStore.supersede(input.memoryId, {
          ...current,
          id: uuidv7(),
          content: JSON.stringify({ ...value, dueAt, status }),
          trustOrigin: "user_content",
          createdBy: ctx.identity.id,
        });
      }),

  /** DUMMY — see router-level doc comment above. Any 6-digit code passes. */
  verifyPhoneOtp: procedure
    .input(z.object({ phone: z.string().min(3), code: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const verified = /^\d{6}$/.test(input.code.trim());
      if (verified) phoneOtpProofs.set(ctx.identity.id, Date.now() + 600_000);
      return {
        verified,
        dummy: true as const,
        verificationSource: "dummy" as const,
        message: verified
          ? "Demo verification passed — no SMS was actually sent."
          : "Enter any 6-digit code (demo mode — no real SMS is sent).",
      };
    }),
});
