import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  MAX_SAVED_VIEW_NAME_LENGTH,
  SAVED_VIEW_SCOPES,
  SHARE_ACCESS_LEVELS,
  SHARE_TARGET_KINDS,
  SavedViewNameTakenError,
  SavedViewNotFoundError,
  ShareGrantNotFoundError,
  atLeast,
  isGrantUsable,
} from "@bridge/core";
import { LocalGeocodingProviderError } from "../geocoding-provider.js";
import {
  assertHumanIdentity,
  assertMembership,
  assertPilotOrganization,
  assertSharableView,
  authenticatedProcedure,
  findSharedView,
  organizationGuard,
  resolveShareLevel,
  savedViewConfigSchema,
  t,
} from "../router-shared.js";

export const viewRouter = t.router({
  geocoderStatus: authenticatedProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .use(organizationGuard).query(async ({ input, ctx }) => {
      const provider = ctx.wiring.geocodingProvider;
      return {
        available: provider !== null,
        providerId: provider?.id ?? null,
        plane: provider?.plane ?? null,
        attribution: provider?.attribution ?? null,
      };
    }),

  resolveLocations: authenticatedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        labels: z
          .array(z.string().trim().min(1).max(500))
          .min(1)
          .max(20),
        confirmedLocalProvider: z.literal(true),
      }),
    )
    .use(organizationGuard).mutation(async ({ input, ctx }) => {
      const provider = ctx.wiring.geocodingProvider;
      if (!provider) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "No private Local Plane geocoder is configured. Enter coordinates directly or configure BRIDGE_LOCAL_GEOCODER_URL.",
        });
      }

      const labels = new Map<string, string>();
      for (const label of input.labels) {
        const trimmed = label.trim();
        const key = trimmed.toLocaleLowerCase("en-US");
        if (!labels.has(key)) labels.set(key, trimmed);
      }

      const results: Array<{
        query: string;
        coordinate: Awaited<ReturnType<typeof provider.geocode>>;
      }> = [];
      for (const query of labels.values()) {
        try {
          results.push({
            query,
            coordinate: await provider.geocode({ query }),
          });
        } catch (error) {
          if (error instanceof LocalGeocodingProviderError) {
            throw new TRPCError({
              code: "BAD_GATEWAY",
              message: error.message,
              cause: error,
            });
          }
          throw error;
        }
      }
      return {
        providerId: provider.id,
        attribution: provider.attribution ?? null,
        results,
      };
    }),

  /**
   * TASK-062 — saved Views. A View is configuration, and configuration that
   * lives only in React state is discarded on reload, which is why Lists,
   * sharing, personal-vs-collaborative views and linked views were all
   * absent from surfaces whose UI already existed.
   *
   * The stored `config` is a `ViewConfig` (@bridge/tables), validated HERE
   * rather than in the store: the shape belongs to the view kinds, and a
   * database column that encoded it would have to migrate every time a kind
   * gained a field. What the table owns is identity, ownership and bounds.
   */
  saved: t.router({
    list: authenticatedProcedure
      .input(
        z
          .object({
            organizationId: z.string().min(1),
            databaseId: z.string().trim().min(1).max(200),
          })
          .strict(),
      )
      .use(organizationGuard).query(async ({ input, ctx }) => {
        return ctx.wiring.viewConfigs.list(
          input.organizationId,
          ctx.identity.id,
          input.databaseId,
        );
      }),

    save: authenticatedProcedure
      .input(
        z
          .object({
            organizationId: z.string().min(1),
            databaseId: z.string().trim().min(1).max(200),
            name: z.string().trim().min(1).max(MAX_SAVED_VIEW_NAME_LENGTH),
            scope: z.enum(SAVED_VIEW_SCOPES).default("personal"),
            config: savedViewConfigSchema,
            hiddenColumns: z.array(z.string().trim().min(1).max(200)).max(200).default([]),
          })
          .strict(),
      )
      .use(organizationGuard).mutation(async ({ input, ctx }) => {
        const now = ctx.run.clock.nowISO();
        try {
          return await ctx.wiring.viewConfigs.create({
            id: ctx.run.ids.next(),
            organizationId: input.organizationId,
            ownerUserId: ctx.identity.id,
            databaseId: input.databaseId,
            name: input.name,
            scope: input.scope,
            config: input.config as Record<string, unknown>,
            hiddenColumns: input.hiddenColumns,
            createdAt: now,
            updatedAt: now,
          });
        } catch (error) {
          if (error instanceof SavedViewNameTakenError) {
            throw new TRPCError({ code: "CONFLICT", message: error.message });
          }
          throw error;
        }
      }),

    /** Owner-only. Every field is optional so renaming, re-scoping and
     * re-saving the current configuration are one procedure, not three. */
    update: authenticatedProcedure
      .input(
        z
          .object({
            organizationId: z.string().min(1),
            viewId: z.string().min(1),
            name: z.string().trim().min(1).max(MAX_SAVED_VIEW_NAME_LENGTH).optional(),
            scope: z.enum(SAVED_VIEW_SCOPES).optional(),
            config: savedViewConfigSchema.optional(),
            hiddenColumns: z.array(z.string().trim().min(1).max(200)).max(200).optional(),
          })
          .strict(),
      )
      .use(organizationGuard).mutation(async ({ input, ctx }) => {
        try {
          return await ctx.wiring.viewConfigs.update(
            input.organizationId,
            ctx.identity.id,
            input.viewId,
            {
              ...(input.name !== undefined ? { name: input.name } : {}),
              ...(input.scope !== undefined ? { scope: input.scope } : {}),
              ...(input.config !== undefined
                ? { config: input.config as Record<string, unknown> }
                : {}),
              ...(input.hiddenColumns !== undefined
                ? { hiddenColumns: input.hiddenColumns }
                : {}),
            },
            ctx.run.clock.nowISO(),
          );
        } catch (error) {
          if (error instanceof SavedViewNameTakenError) {
            throw new TRPCError({ code: "CONFLICT", message: error.message });
          }
          if (error instanceof SavedViewNotFoundError) {
            throw new TRPCError({ code: "NOT_FOUND", message: error.message });
          }
          throw error;
        }
      }),

    remove: authenticatedProcedure
      .input(
        z.object({ organizationId: z.string().min(1), viewId: z.string().min(1) }).strict(),
      )
      .use(organizationGuard).mutation(async ({ input, ctx }) => {
        try {
          await ctx.wiring.viewConfigs.remove(
            input.organizationId,
            ctx.identity.id,
            input.viewId,
          );
          return { removed: input.viewId };
        } catch (error) {
          if (error instanceof SavedViewNotFoundError) {
            throw new TRPCError({ code: "NOT_FOUND", message: error.message });
          }
          throw error;
        }
      }),
  }),

  /**
   * Scoped share grants (TASK-064, ADR-279) — the Share panel's server side.
   *
   * A grant points at a saved View and names an access level. Only the View's
   * OWNER (or a co-owner grant holder) may create or revoke one: sharing is an
   * authority change, so it follows the same human-only floor as every other
   * authority change in this router.
   */
  share: t.router({
    list: authenticatedProcedure
      .input(
        z.object({ organizationId: z.string().min(1), viewId: z.string().min(1) }).strict(),
      )
      .use(organizationGuard).query(async ({ input, ctx }) => {
        await assertSharableView(ctx, input.organizationId, input.viewId, "view");
        const grants = await ctx.wiring.shareGrants.listForTarget(
          input.organizationId,
          ctx.identity.id,
          "view",
          input.viewId,
        );
        const now = ctx.run.clock.nowISO();
        // `usable` is computed by the kernel's own rule, never by the client:
        // a surface that decided expiry for itself would eventually disagree
        // with the server about who has access.
        return grants.map((grant) => ({ ...grant, usable: isGrantUsable(grant, now) }));
      }),

    grant: authenticatedProcedure
      .input(
        z
          .object({
            organizationId: z.string().min(1),
            viewId: z.string().min(1),
            targetKind: z.enum(SHARE_TARGET_KINDS).default("view"),
            accessLevel: z.enum(SHARE_ACCESS_LEVELS).default("view"),
            /** A member grant. Omit for a link grant. */
            granteeUserId: z.string().min(1).optional(),
            expiresAt: z.string().datetime().optional(),
          })
          .strict(),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        assertHumanIdentity(ctx, "Sharing a View");
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        await assertSharableView(ctx, input.organizationId, input.viewId, "coowner");
        if (input.granteeUserId) {
          // A grant to someone outside the Organization would be a share the
          // Organization never authorised. Membership is checked, not assumed.
          await assertMembership(
            ctx.wiring.organizationStore,
            input.organizationId,
            input.granteeUserId,
          );
        }
        const now = ctx.run.clock.nowISO();
        if (input.expiresAt && input.expiresAt <= now) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "A share that has already expired grants nothing — pick a future instant.",
          });
        }
        return ctx.wiring.shareGrants.create({
          id: ctx.run.ids.next(),
          organizationId: input.organizationId,
          targetKind: input.targetKind,
          targetId: input.viewId,
          granteeUserId: input.granteeUserId ?? null,
          // The link credential is minted server-side and never echoed back
          // from client input: an unguessable token the caller chose is not
          // unguessable.
          accessToken: input.granteeUserId ? null : `shr_${ctx.run.ids.next()}${ctx.run.ids.next()}`.replace(/-/g, ""),
          accessLevel: input.accessLevel,
          expiresAt: input.expiresAt ?? null,
          revokedAt: null,
          createdByUserId: ctx.identity.id,
          createdAt: now,
        });
      }),

    revoke: authenticatedProcedure
      .input(
        z.object({ organizationId: z.string().min(1), grantId: z.string().min(1) }).strict(),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        assertHumanIdentity(ctx, "Revoking a share");
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        try {
          return await ctx.wiring.shareGrants.revoke(
            input.organizationId,
            ctx.identity.id,
            input.grantId,
            ctx.run.clock.nowISO(),
          );
        } catch (error) {
          if (error instanceof ShareGrantNotFoundError) {
            throw new TRPCError({ code: "NOT_FOUND", message: error.message });
          }
          throw error;
        }
      }),

    /**
     * Open a View someone shared with you.
     *
     * The View comes back with its hidden columns REMOVED from the payload
     * rather than merely flagged: a column the sharer hid is not a column the
     * recipient may read, and a client that "knows" not to render it is not a
     * boundary. `canEdit` is the server's answer, not the client's guess.
     */
    resolve: authenticatedProcedure
      .input(
        z.object({ organizationId: z.string().min(1), viewId: z.string().min(1) }).strict(),
      )
      .use(organizationGuard).query(async ({ input, ctx }) => {
        const level = await resolveShareLevel(ctx, input.organizationId, input.viewId);
        if (level === null) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "This View has not been shared with you.",
          });
        }
        const view = await findSharedView(ctx, input.organizationId, input.viewId);
        const hidden = new Set(view.hiddenColumns);
        const config = { ...view.config } as Record<string, unknown>;
        return {
          id: view.id,
          databaseId: view.databaseId,
          name: view.name,
          config,
          /** Names the recipient may see. Hidden ones are absent, not marked. */
          hiddenColumns: [...hidden],
          accessLevel: level,
          canEdit: atLeast(level, "edit"),
          canReshare: atLeast(level, "coowner"),
        };
      }),
  }),
});
