import { z } from "zod";
import { assertPilotOrganization, paginatedInput, procedure, t } from "../router-shared.js";

/**
 * Resources — replaces the prototype's Supabase-direct `resources_canonical`
 * read (frontend-migration-scoping.md gap #4) with a governed, organization-
 * scoped catalog. Plain authenticated CRUD, not a pipeline action.
 */
export const resourcesRouter = t.router({
  create: procedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        title: z.string().min(1),
        kind: z.enum(["book", "podcast", "vlog", "article", "other"]),
        url: z.string().url().optional(),
        notes: z.string().optional(),
        tags: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      return ctx.wiring.resourcesStore.create({
        organizationId: input.organizationId,
        title: input.title,
        kind: input.kind,
        ...(input.url ? { url: input.url } : {}),
        ...(input.notes ? { notes: input.notes } : {}),
        ...(input.tags ? { tags: input.tags } : {}),
      });
    }),

  list: procedure
    .input(paginatedInput)
    .query(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      const { items, total } = await ctx.wiring.resourcesStore.list(input.organizationId, {
        limit: input.limit,
        offset: input.offset,
      });
      return { items, total, hasMore: input.offset + items.length < total };
    }),
});
