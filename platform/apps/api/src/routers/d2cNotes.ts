import { z } from "zod";
import { desc } from "drizzle-orm";
import { d2cSchema } from "../d2c-store.js";
import { D2C_NOTES_SPEC, procedure, t } from "../router-shared.js";

/**
 * D2C Notes — the owner's working notes (TASK-074 sub-module, `d2c-notes`
 * manifest). One Page, one table: `noteDocuments`.
 */
export const d2cNotesRouter = t.router({
  documentsDefinition: procedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(({ input }) => {
      return D2C_NOTES_SPEC;
    }),

  documentsList: procedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const items = await ctx.wiring.d2cDb
        .select()
        .from(d2cSchema.noteDocuments)
        .orderBy(desc(d2cSchema.noteDocuments.updatedAt));
      return { items, total: items.length };
    }),
});
