import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { IntegrationFloorScopeError } from "@bridge/db";
import { listProviderIds, oauthScopesFor } from "../social/registry.js";
import { t, procedure, actionEnum } from "../router-shared.js";

export const integrationRouter = t.router({
  /** The platforms Bridge can connect, with their declared OAuth scopes. */
  providers: procedure.query(() =>
    listProviderIds().map((id) => ({ id, oauthScopes: oauthScopesFor(id) })),
  ),

  /**
   * Paginated (offset/limit): `store.list` returns the full connected-integrations
   * array with no store-level pagination support, so the router slices after the
   * fetch. Same shape as `dealpilot.list` (All fixes.md §3 P1 "No pagination on any
   * list surface").
   */
  list: procedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ input, ctx }) => {
      const all = await ctx.wiring.integrationStore.list(input.organizationId);
      const total = all.length;
      const items = all.slice(input.offset, input.offset + input.limit);
      return { items, total, hasMore: input.offset + items.length < total };
    }),

  connect: procedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        provider: z.enum(["x", "instagram", "facebook", "linkedin"]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.wiring.integrationStore.connect(
        input.organizationId,
        input.provider,
        oauthScopesFor(input.provider),
      );
    }),

  disconnect: procedure
    .input(z.object({ organizationId: z.string().min(1), integrationId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.wiring.integrationStore.disconnect(
        input.organizationId,
        input.integrationId,
      );
      return { ok: true };
    }),

  listScopes: procedure
    .input(z.object({ organizationId: z.string().min(1), integrationId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      return ctx.wiring.integrationStore.listScopes(
        input.organizationId,
        input.integrationId,
      );
    }),

  grantScope: procedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        integrationId: z.string().uuid(),
        resourceType: z.string().min(1),
        action: actionEnum,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await ctx.wiring.integrationStore.grantScope({
          organizationId: input.organizationId,
          integrationId: input.integrationId,
          resourceType: input.resourceType,
          action: input.action,
        });
      } catch (err) {
        if (err instanceof IntegrationFloorScopeError) {
          // Agent-floor DENY: surfaced as always-approval, never a standing grant.
          throw new TRPCError({ code: "FORBIDDEN", message: err.message });
        }
        throw err;
      }
    }),

  revokeScope: procedure
    .input(z.object({ organizationId: z.string().min(1), permissionId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.wiring.integrationStore.revokeScope(
        input.organizationId,
        input.permissionId,
      );
      return { ok: true };
    }),
});
