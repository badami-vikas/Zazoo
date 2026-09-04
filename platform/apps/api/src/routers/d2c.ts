import { z } from "zod";
import { desc } from "drizzle-orm";
import { d2cSchema } from "../d2c-store.js";
import { D2C_INVENTORY_SPEC, D2C_ORDERS_SPEC, assertPilotOrganization, procedure, t } from "../router-shared.js";

/**
 * D2C — wires the imported `@bridge/d2c` domain types (ADR-246)
 * to their own sqlite (`d2c-store.ts`, `d2c-schema.ts`) for the first time.
 * TASK-074: the two declared toggle Pages (Orders, Inventory) plus the two
 * nested sub-modules (Research, Notes) get real, minimal queries — not the
 * full costing/invoicing/WhatsApp-capture feature set CVN shipped.
 */
export const d2cRouter = t.router({
  ordersDefinition: procedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(({ input }) => {
      assertPilotOrganization(input.organizationId);
      return D2C_ORDERS_SPEC;
    }),

  ordersList: procedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      const orders = await ctx.wiring.d2cDb
        .select()
        .from(d2cSchema.orders)
        .orderBy(desc(d2cSchema.orders.placedAt));
      const customers = await ctx.wiring.d2cDb.select().from(d2cSchema.customers);
      const customerById = new Map(customers.map((c) => [c.id, c]));
      const items = orders.map((order) => ({
        ...order,
        customerName: customerById.get(order.customerId)?.name ?? order.customerId,
      }));
      return { items, total: items.length };
    }),

  inventoryDefinition: procedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(({ input }) => {
      assertPilotOrganization(input.organizationId);
      return D2C_INVENTORY_SPEC;
    }),

  /** One row per stock batch, with the ledger-derived quantity on hand
   * (sum of `stockMoves.delta`) — never a mutated counter (schema comment,
   * d2c-schema.ts). */
  inventoryList: procedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      const batches = await ctx.wiring.d2cDb.select().from(d2cSchema.stockBatches);
      const moves = await ctx.wiring.d2cDb.select().from(d2cSchema.stockMoves);
      const qtyByBatch = new Map<string, number>();
      for (const move of moves) {
        qtyByBatch.set(move.batchId, (qtyByBatch.get(move.batchId) ?? 0) + move.delta);
      }
      const items = batches.map((batch) => ({
        ...batch,
        quantityOnHand: qtyByBatch.get(batch.id) ?? 0,
      }));
      return { items, total: items.length };
    }),
});
