import { z } from "zod";
import { d2cSchema } from "../d2c-store.js";
import { t, procedure, D2C_RESEARCH_SPEC } from "../router-shared.js";

/**
 * D2C Research — Plant Records (TASK-074 sub-module, `d2c-research`
 * manifest). One Page, one table: `plants`.
 */
export const d2cResearchRouter = t.router({
  plantsDefinition: procedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(({ input }) => {
      return D2C_RESEARCH_SPEC;
    }),

  plantsList: procedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const items = await ctx.wiring.d2cDb.select().from(d2cSchema.plants);
      return { items, total: items.length };
    }),
});
