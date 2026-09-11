import { z } from "zod";
import { syncGroqKeyToCompanionJson, t, credentialSettingsProcedure, assertModelProviderKeyId, assertModelProviderKeyStorage } from "../router-shared.js";

/**
 * Integration management — connected providers and their USER-EDITABLE scopes.
 * Backed by the governed integration store on the LOCAL plane. Granting an
 * agent-floor DENY scope (external:send, network_graph:full) is refused here.
 */
/**
 * Settings → API Keys. Model-provider API keys the user types are secrets, so
 * every procedure here obeys the same rules as DealPilot Source credentials
 * (ADR-181): a Human actor only, key bytes travel INBOUND only, and the store
 * behind them is the Local Plane credential vault. No procedure in this
 * router can return a key — `list` reports existence and age, and the raw
 * value is read exactly once by process wiring at boot.
 */
export const modelProviderKeyRouter = t.router({
  /** Per-slot status: stored?, active in this process?, set via environment? */
  list: credentialSettingsProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      return {
        /** Saving a key needs the desktop Local Plane; the cloud API refuses. */
        storageAvailable: !ctx.wiring.publicCloudOnly,
        providers: await ctx.wiring.modelProviderKeys.list(input.organizationId, {
          env: process.env,
          activeProviderIds: new Set(ctx.wiring.models.providers().keys()),
        }),
      };
    }),

  save: credentialSettingsProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        providerId: z.string().min(1),
        apiKey: z.string().trim().min(1).max(2_000),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const providerId = assertModelProviderKeyId(input.providerId);
      assertModelProviderKeyStorage(ctx.wiring);
      await ctx.wiring.modelProviderKeys.save(
        input.organizationId,
        providerId,
        input.apiKey,
      );
      if (providerId === "groq") syncGroqKeyToCompanionJson(input.apiKey);
      // Deliberately returns no echo of the value, not even masked. The
      // provider is constructed from the vault at boot, so this response
      // states the honest activation requirement rather than implying the
      // key is already routing traffic (AP-021).
      return {
        providerId,
        stored: true,
        activation: ctx.wiring.models.providers().has(providerId)
          ? ("already_active" as const)
          : ("restart_required" as const),
      };
    }),

  clear: credentialSettingsProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        providerId: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const providerId = assertModelProviderKeyId(input.providerId);
      assertModelProviderKeyStorage(ctx.wiring);
      const removed = await ctx.wiring.modelProviderKeys.clear(
        input.organizationId,
        providerId,
      );
      if (providerId === "groq") syncGroqKeyToCompanionJson(null);
      return {
        providerId,
        removed,
        // Removing the stored key does not un-register a provider this
        // process already built from it.
        stillActive: ctx.wiring.models.providers().has(providerId),
      };
    }),
});
