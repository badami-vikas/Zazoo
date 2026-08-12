import { describe, expect, it } from "vitest";
import {
  MissingScalingConstantError,
  computeLandedCost,
  computeRawCost,
} from "../src/costing.js";
import type { FormulaLine, Product, RawMaterial } from "../src/schema.js";

const material = (id: string, pricePerKg: number): RawMaterial => ({
  id,
  name: id,
  pricePerKg,
  active: true,
});

const product = (overrides: Partial<Product> = {}): Product => ({
  id: "p1",
  code: "pKAsw",
  displayName: "Ashwagandha Kashaya",
  gstRate: 0.18,
  sellingPrice: 200,
  active: true,
  ...overrides,
});

describe("computeRawCost", () => {
  it("throws MissingScalingConstantError when neither the product nor a default supplies one", () => {
    const materials = new Map([["m1", material("m1", 100)]]);
    const lines: FormulaLine[] = [{ productId: "p1", rawMaterialId: "m1", sampleWt: 0.1 }];
    expect(() => computeRawCost(product(), lines, materials)).toThrow(
      MissingScalingConstantError,
    );
  });

  it("uses the product's own scalingConstant over the default when both are present", () => {
    const materials = new Map([["m1", material("m1", 100)]]);
    const lines: FormulaLine[] = [{ productId: "p1", rawMaterialId: "m1", sampleWt: 0.1 }];
    const result = computeRawCost(product({ scalingConstant: 10 }), lines, materials, 999);
    // pktWt = 0.1 * 10 = 1; cost = 1 * 100 = 100
    expect(result.scalingConstant).toBe(10);
    expect(result.total).toBe(100);
  });

  it("falls back to the supplied default when the product has none set", () => {
    const materials = new Map([["m1", material("m1", 100)]]);
    const lines: FormulaLine[] = [{ productId: "p1", rawMaterialId: "m1", sampleWt: 0.1 }];
    const result = computeRawCost(product(), lines, materials, 5);
    expect(result.scalingConstant).toBe(5);
    expect(result.total).toBe(0.1 * 5 * 100);
  });

  it("sums multiple formula lines and ignores lines for other products", () => {
    const materials = new Map([
      ["m1", material("m1", 100)],
      ["m2", material("m2", 200)],
    ]);
    const lines: FormulaLine[] = [
      { productId: "p1", rawMaterialId: "m1", sampleWt: 0.1 },
      { productId: "p1", rawMaterialId: "m2", sampleWt: 0.2 },
      { productId: "other", rawMaterialId: "m1", sampleWt: 999 },
    ];
    const result = computeRawCost(product({ scalingConstant: 10 }), lines, materials);
    // m1: 0.1*10*100 = 100; m2: 0.2*10*200 = 400
    expect(result.total).toBe(500);
    expect(result.lines).toHaveLength(2);
  });

  it("reprices automatically when a material's price changes — nothing is snapshotted", () => {
    const lines: FormulaLine[] = [{ productId: "p1", rawMaterialId: "m1", sampleWt: 1 }];
    const before = computeRawCost(
      product({ scalingConstant: 1 }),
      lines,
      new Map([["m1", material("m1", 100)]]),
    );
    const after = computeRawCost(
      product({ scalingConstant: 1 }),
      lines,
      new Map([["m1", material("m1", 150)]]),
    );
    expect(before.total).toBe(100);
    expect(after.total).toBe(150);
  });
});

describe("computeLandedCost", () => {
  it("defaults every absent cost component to 0", () => {
    const result = computeLandedCost(product({ sellingPrice: 200 }), 50);
    expect(result.landedCost).toBe(50);
    expect(result.marginAtSellingPrice).toBe(150);
  });

  it("applies ops/packaging/transport and a percentage retailer margin on top", () => {
    const p = product({
      sellingPrice: 200,
      opsCost: 10,
      packagingCost: 5,
      transportCost: 5,
      retailerMarginPct: 0.1,
    });
    const result = computeLandedCost(p, 50);
    // subtotal = 50+10+5+5 = 70; margin = 7; landed = 77
    expect(result.subtotal).toBe(70);
    expect(result.retailerMargin).toBe(7);
    expect(result.landedCost).toBe(77);
    expect(result.marginAtSellingPrice).toBe(123);
  });
});
