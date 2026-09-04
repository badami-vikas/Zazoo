import { describe, expect, it } from "vitest";
import {
  NonSequentialInvoiceNumberError,
  buildInvoiceSnapshot,
  computeTaxSplit,
  financialYearFor,
  nextInvoiceNumber,
} from "../src/invoicing.js";
import type { Customer, Order, OrderItem, Product } from "../src/schema.js";

describe("financialYearFor", () => {
  it("labels dates from Apr 1 through Mar 31 as the same FY", () => {
    expect(financialYearFor(new Date("2026-04-01T00:00:00Z"))).toBe("2026-27");
    expect(financialYearFor(new Date("2026-12-31T00:00:00Z"))).toBe("2026-27");
    expect(financialYearFor(new Date("2027-03-31T00:00:00Z"))).toBe("2026-27");
    expect(financialYearFor(new Date("2027-04-01T00:00:00Z"))).toBe("2027-28");
  });
});

describe("nextInvoiceNumber", () => {
  it("is exactly one more than the last issued number", () => {
    expect(nextInvoiceNumber(251)).toBe(252);
    expect(nextInvoiceNumber(0)).toBe(1);
  });

  it("refuses a negative or non-integer last number rather than silently coercing it", () => {
    expect(() => nextInvoiceNumber(-1)).toThrow(NonSequentialInvoiceNumberError);
    expect(() => nextInvoiceNumber(1.5)).toThrow(NonSequentialInvoiceNumberError);
  });
});

describe("computeTaxSplit", () => {
  it("splits into CGST+SGST for an intra-state supply", () => {
    const split = computeTaxSplit(1000, 0.18, false);
    expect(split).toEqual({ cgst: 90, sgst: 90, igst: 0 });
  });

  it("charges IGST only for an inter-state supply", () => {
    const split = computeTaxSplit(1000, 0.18, true);
    expect(split).toEqual({ cgst: 0, sgst: 0, igst: 180 });
  });
});

describe("buildInvoiceSnapshot", () => {
  const product: Product = {
    id: "p1",
    code: "pTR",
    displayName: "Tooth Powder Red",
    hsnCode: "3306",
    gstRate: 0.18,
    sellingPrice: 150,
    active: true,
  };
  const order: Order = {
    id: "o1",
    orderNo: "252",
    customerId: "c1",
    source: "manual",
    status: "confirmed",
    placedAt: "2026-08-01T00:00:00Z",
    transportCharge: 50,
  };
  const items: OrderItem[] = [{ orderId: "o1", productId: "p1", qty: 10, unitPrice: 150, gstRate: 0.18 }];

  it("charges CGST+SGST when the customer's state matches the seller's", () => {
    const customer: Customer = { id: "c1", name: "Shivanand H S", stateCode: "KA", openingBalance: 0 };
    const snapshot = buildInvoiceSnapshot({
      orders: [order],
      items,
      customer,
      productsById: new Map([["p1", product]]),
      sellerStateCode: "KA",
    });
    expect(snapshot.taxSplit.kind).toBe("intra_state");
    // taxable = 1500; tax = 270; split 135/135
    expect(snapshot.taxSplit.cgst).toBe(135);
    expect(snapshot.taxSplit.sgst).toBe(135);
    expect(snapshot.taxSplit.igst).toBe(0);
    expect(snapshot.grandTotal).toBe(1500 + 270 + 50);
  });

  it("charges IGST when the customer's state differs from the seller's", () => {
    const customer: Customer = { id: "c1", name: "Saddiq Ahmed Jaipur", stateCode: "RJ", openingBalance: 0 };
    const snapshot = buildInvoiceSnapshot({
      orders: [order],
      items,
      customer,
      productsById: new Map([["p1", product]]),
      sellerStateCode: "KA",
    });
    expect(snapshot.taxSplit.kind).toBe("inter_state");
    expect(snapshot.taxSplit.igst).toBe(270);
  });

  it("treats a customer with no recorded state as intra-state rather than guessing inter-state tax", () => {
    const customer: Customer = { id: "c1", name: "No Address On File", openingBalance: 0 };
    const snapshot = buildInvoiceSnapshot({
      orders: [order],
      items,
      customer,
      productsById: new Map([["p1", product]]),
      sellerStateCode: "KA",
    });
    expect(snapshot.taxSplit.kind).toBe("intra_state");
  });

  it("freezes product name/hsn/price into the snapshot at issue time", () => {
    const customer: Customer = { id: "c1", name: "X", stateCode: "KA", openingBalance: 0 };
    const snapshot = buildInvoiceSnapshot({
      orders: [order],
      items,
      customer,
      productsById: new Map([["p1", product]]),
      sellerStateCode: "KA",
    });
    expect(snapshot.lines[0]).toMatchObject({
      productCode: "pTR",
      productName: "Tooth Powder Red",
      hsnCode: "3306",
      qty: 10,
      unitPrice: 150,
      lineTotal: 1500,
    });
  });
});
