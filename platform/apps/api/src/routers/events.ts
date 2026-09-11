import { z } from "zod";
import { t, procedure, paginatedInput } from "../router-shared.js";

/**
 * Events — NetworkManager's Events sub-module (TASK-068, ADR-231). Plain
 * authenticated CRUD; speaker extraction is a later phase, not this router.
 */
export const eventsRouter = t.router({
  create: procedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        name: z.string().min(1),
        url: z.string().url().optional(),
        type: z.enum(["conference", "meetup", "summit", "webinar"]).optional(),
        startsAt: z.string().datetime().optional(),
        endsAt: z.string().datetime().optional(),
        location: z.string().optional(),
      }),
    )
    .mutation(({ input, ctx }) => {
      return ctx.wiring.eventsStore.create({
        organizationId: input.organizationId,
        name: input.name,
        ...(input.url ? { url: input.url } : {}),
        ...(input.type ? { type: input.type } : {}),
        ...(input.startsAt ? { startsAt: new Date(input.startsAt) } : {}),
        ...(input.endsAt ? { endsAt: new Date(input.endsAt) } : {}),
        ...(input.location ? { location: input.location } : {}),
      });
    }),

  list: procedure
    .input(paginatedInput)
    .query(async ({ input, ctx }) => {
      const { items, total } = await ctx.wiring.eventsStore.list(input.organizationId, {
        limit: input.limit,
        offset: input.offset,
      });
      return { items, total, hasMore: input.offset + items.length < total };
    }),

  update: procedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        id: z.string().uuid(),
        name: z.string().optional(),
        url: z.string().url().optional(),
        type: z.enum(["conference", "meetup", "summit", "webinar"]).optional(),
        startsAt: z.string().datetime().optional(),
        endsAt: z.string().datetime().optional(),
        location: z.string().optional(),
        status: z.enum(["watching", "registered", "attending", "attended"]).optional(),
      }),
    )
    .mutation(({ input, ctx }) => {
      return ctx.wiring.eventsStore.update(input.id, input.organizationId, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.url !== undefined ? { url: input.url } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.startsAt !== undefined ? { startsAt: new Date(input.startsAt) } : {}),
        ...(input.endsAt !== undefined ? { endsAt: new Date(input.endsAt) } : {}),
        ...(input.location !== undefined ? { location: input.location } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      });
    }),
});
