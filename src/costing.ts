/**
 * Formula costing — the pure-function replacement for Notion's form → Pro
 * chain (`form.pkt wt` → `form.cost` → `Pro.Raw Cost`).
 *
 * Nothing here is stored. Raw cost is recomputed on demand from the current
 * formula and current raw-material prices, exactly like the Notion rollup
 * chain it replaces: change a supplier's price and every product costed
 * from it reprices, instead of drifting from a snapshot nobody remembers
 * to refresh.
 */
import type { FormulaLine, Product, RawMaterial } from "./schema.js";

export class MissingScalingConstantError extends Error {
  constructor(productId: string) {
    super(
      `Product ${productId} has no scalingConstant set and no default was supplied. ` +
        "Set it from the product's costing panel before costing this product.",
    );
    this.name = "MissingScalingConstantError";
  }
}

export class UnknownRawMaterialError extends Error {
  constructor(rawMaterialId: string) {
    super(`Formula line references unknown raw material ${rawMaterialId}.`);
    this.name = "UnknownRawMaterialError";
  }
}

/** The packet weight in GRAMS a formula line contributes, once scaled.
 * `sampleWt` is grams (see `FormulaLine`), so this is grams too — every
 * consumer that needs kg divides by 1000 itself. */
export function packetWeight(sampleWt: number, scalingConstant: number): number {
  return sampleWt * scalingConstant;
}

/** Cost of one formula line: its scaled weight priced at the material's rate.
 * The /1000 is the only place grams meet ₹/kg in this module — without it raw
 * cost came out 1000× high (a 500 g line of ₹800/kg material read ₹400000). */
export function lineCost(
  line: FormulaLine,
  material: RawMaterial,
  scalingConstant: number,
): number {
  return (packetWeight(line.sampleWt, scalingConstant) / 1000) * material.pricePerKg;
}

export interface RawCostBreakdownLine {
  rawMaterialId: string;
  rawMaterialName: string;
  sampleWt: number;
  pktWt: number;
  pricePerKg: number;
  cost: number;
}

export interface RawCostBreakdown {
  productId: string;
  scalingConstant: number;
  lines: RawCostBreakdownLine[];
  total: number;
}

/**
 * Sum a product's formula into a raw cost, using the product's own
 * `scalingConstant` when set, else `defaultScalingConstant` when the caller
 * supplies one. Throws rather than assuming 1 — an unset scaling constant
 * silently treated as 1 would understate every uncosted product's raw cost.
 */
export function computeRawCost(
  product: Product,
  formulaLines: readonly FormulaLine[],
  materialsById: ReadonlyMap<string, RawMaterial>,
  defaultScalingConstant?: number,
): RawCostBreakdown {
  const scalingConstant = product.scalingConstant ?? defaultScalingConstant;
  if (scalingConstant === undefined) {
    throw new MissingScalingConstantError(product.id);
  }

  const lines: RawCostBreakdownLine[] = [];
  let total = 0;
  for (const line of formulaLines.filter((l) => l.productId === product.id)) {
    const material = materialsById.get(line.rawMaterialId);
    if (!material) throw new UnknownRawMaterialError(line.rawMaterialId);
    const pktWt = packetWeight(line.sampleWt, scalingConstant);
    const cost = lineCost(line, material, scalingConstant);
    lines.push({
      rawMaterialId: material.id,
      rawMaterialName: material.name,
      sampleWt: line.sampleWt,
      pktWt,
      pricePerKg: material.pricePerKg,
      cost,
    });
    total += cost;
  }

  return { productId: product.id, scalingConstant, lines, total };
}

export interface LandedCost {
  rawCost: number;
  opsCost: number;
  packagingCost: number;
  transportCost: number;
  subtotal: number;
  retailerMargin: number;
  landedCost: number;
  marginAtSellingPrice: number;
}

/**
 * The full landed-cost model Notion scaffolded (ops/pkg/tpt/rt%) but never
 * populated. Every component defaults to 0 when absent on the product, so
 * costing a product with only a formula still works — it just reports a
 * landed cost equal to raw cost until the other fields are filled in.
 */
export function computeLandedCost(product: Product, rawCost: number): LandedCost {
  const opsCost = product.opsCost ?? 0;
  const packagingCost = product.packagingCost ?? 0;
  const transportCost = product.transportCost ?? 0;
  const subtotal = rawCost + opsCost + packagingCost + transportCost;
  const retailerMargin = subtotal * (product.retailerMarginPct ?? 0);
  const landedCost = subtotal + retailerMargin;
  const marginAtSellingPrice = product.sellingPrice - landedCost;
  return { rawCost, opsCost, packagingCost, transportCost, subtotal, retailerMargin, landedCost, marginAtSellingPrice };
}
