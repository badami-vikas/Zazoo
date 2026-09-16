import { describe, expect, it } from "vitest";
import {
  discountAmountFor,
  discountPctFor,
  itemsSubtotal,
  itemsTax,
  orderGross,
  orderTotal,
  round2,
} from "../src/orders.js";
import type { OrderItem } from "../src/schema.js";

const item = (qty: number, unitPrice: number, gstRate: number): OrderItem =>
  ({ id: `i${qty}${unitPrice}`, orderId: "o1", productId: "p1", qty, unitPrice, gstRate }) as OrderItem;

describe("order totals", () => {
  const items = [item(2, 100, 0.18), item(1, 50, 0.05)];

  it("separates subtotal from tax", () => {
    expect(itemsSubtotal(items)).toBe(250);
    expect(itemsTax(items)).toBeCloseTo(38.5, 2); // 200*0.18 + 50*0.05
  });

  it("includes GST in the total — the defect this replaced dropped it", () => {
    expect(orderGross(items, 40)).toBe(328.5);
    expect(orderTotal(items, 40)).toBe(328.5);
  });

  it("subtracts the discount from the tax-inclusive gross", () => {
    expect(orderTotal(items, 40, 28.5)).toBe(300);
  });
});

describe("discount round-trip", () => {
  it("percentage and final amount always reconcile", () => {
    const gross = 328.5;
    const amount = discountAmountFor(gross, 10);
    expect(amount).toBe(32.85);
    expect(discountPctFor(gross, gross - amount)).toBe(10);
  });

  it("back-solves the percentage from an edited final amount", () => {
    expect(discountPctFor(1000, 900)).toBe(10);
    expect(discountPctFor(1000, 1000)).toBe(0);
  });

  it("clamps rather than inventing a surcharge or a negative discount", () => {
    expect(discountPctFor(1000, 1200)).toBe(0); // above gross is not a discount
    expect(discountPctFor(1000, -50)).toBe(100); // never discounts past free
  });

  it("a typed final amount survives the 2-dp percentage it is stored alongside", () => {
    // 2124 → 2000 is 5.8380…%, which stores as 5.84. Re-deriving the money from
    // that rounded percentage prints ₹1999.96, so `orders.update` keeps the
    // typed amount and lets only the displayed percentage round.
    const gross = 2124;
    const pct = discountPctFor(gross, 2000);
    expect(pct).toBe(5.84);
    expect(gross - discountAmountFor(gross, pct)).not.toBe(2000);
    expect(round2(gross - 2000)).toBe(124);
  });

  it("does not divide by zero on a valueless order", () => {
    expect(discountPctFor(0, 0)).toBe(0);
    expect(discountAmountFor(0, 25)).toBe(0);
  });
});
