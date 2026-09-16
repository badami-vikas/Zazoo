import { describe, expect, it } from "vitest";
import {
  lowStockItems,
  nearExpiryBatches,
  ordersForBatch,
  planMove,
  stockOnHand,
  stockOnHandByItem,
} from "../src/inventory.js";
import type { StockBatch, StockMove } from "../src/schema.js";

describe("stockOnHand", () => {
  it("is the sum of a batch's moves, not a stored counter", () => {
    const moves: StockMove[] = [
      planMove("b1", 100, "purchase", "2026-01-01"),
      planMove("b1", -30, "sale", "2026-01-02", { refType: "order", refId: "o1" }),
      planMove("b1", -10, "sale", "2026-01-03", { refType: "order", refId: "o2" }),
      planMove("b2", 500, "purchase", "2026-01-01"),
    ];
    expect(stockOnHand("b1", moves)).toBe(60);
    expect(stockOnHand("b2", moves)).toBe(500);
    expect(stockOnHand("nonexistent", moves)).toBe(0);
  });
});

describe("stockOnHandByItem", () => {
  it("sums across every batch belonging to an item", () => {
    const batches: StockBatch[] = [
      { id: "b1", itemType: "product", itemId: "p1", batchNo: "A", unitCost: 10 },
      { id: "b2", itemType: "product", itemId: "p1", batchNo: "B", unitCost: 12 },
    ];
    const moves: StockMove[] = [
      planMove("b1", 50, "production_in", "2026-01-01"),
      planMove("b2", 30, "production_in", "2026-01-02"),
      planMove("b1", -5, "sale", "2026-01-03"),
    ];
    expect(stockOnHandByItem("p1", batches, moves)).toBe(75);
  });
});

describe("lowStockItems", () => {
  it("flags items at or below their reorder level, including items with no stock recorded at all", () => {
    const onHand = new Map([["m1", 5], ["m2", 50]]);
    const reorder = new Map([["m1", 10], ["m2", 10], ["m3", 1]]);
    const result = lowStockItems(onHand, reorder);
    expect(result).toEqual(
      expect.arrayContaining([
        { itemId: "m1", onHand: 5, reorderLevel: 10 },
        { itemId: "m3", onHand: 0, reorderLevel: 1 },
      ]),
    );
    expect(result.find((e) => e.itemId === "m2")).toBeUndefined();
  });
});

describe("nearExpiryBatches", () => {
  const now = new Date("2026-08-01T00:00:00Z");

  it("only reports batches with stock on hand, sorted soonest-first", () => {
    const batches: StockBatch[] = [
      { id: "b1", itemType: "raw_material", itemId: "m1", batchNo: "A", unitCost: 1, expiryDate: "2026-08-20" },
      { id: "b2", itemType: "raw_material", itemId: "m1", batchNo: "B", unitCost: 1, expiryDate: "2026-08-05" },
      { id: "b3", itemType: "raw_material", itemId: "m1", batchNo: "C", unitCost: 1, expiryDate: "2026-08-03" },
    ];
    const moves: StockMove[] = [
      planMove("b1", 10, "purchase", "2026-01-01"),
      planMove("b2", 10, "purchase", "2026-01-01"),
      planMove("b3", 0, "purchase", "2026-01-01"), // sold out — must be excluded
    ];
    const result = nearExpiryBatches(batches, moves, now, 30);
    expect(result.map((r) => r.batch.id)).toEqual(["b2", "b1"]);
  });
});

describe("ordersForBatch", () => {
  it("traces a batch to the orders it was dispatched against", () => {
    const moves: StockMove[] = [
      planMove("b1", -5, "sale", "2026-01-01", { refType: "order", refId: "o1" }),
      planMove("b1", -3, "sale", "2026-01-02", { refType: "order", refId: "o2" }),
      planMove("b1", 100, "purchase", "2026-01-01"),
    ];
    expect(ordersForBatch("b1", moves)).toEqual(["o1", "o2"]);
  });
});
