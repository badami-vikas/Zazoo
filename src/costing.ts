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

/**
 * Every product weighs this much per packet unless its own scaling constant
 * says otherwise. The scaling constant is the lab→shelf multiplier: a formula
 * is written as a small sample (grams per ingredient in one trial batch), and
 * the constant scales that sample up to a saleable packet. It exists because
 * the source data (Notion `form.sample wt`) only ever recorded the sample, and
 * guessing the multiplier per product would have written wrong weights into
 * live costing. Expressing it as a packet weight instead of a bare multiplier
 * is what AP-011 asks for — the user thinks in "this is a 100 g pack", not in
 * "this formula is scaled 12.5×".
 */
export const DEFAULT_PACKET_WEIGHT_G = 100;

/** Total grams one packet weighs at a given scaling constant. */
export function totalPacketWeight(
  formulaLines: readonly FormulaLine[],
  scalingConstant: number,
): number {
  return formulaLines.reduce((s, l) => s + packetWeight(l.sampleWt, scalingConstant), 0);
}

/**
 * The scaling constant to actually cost with: the product's own when set,
 * otherwise whatever makes one packet weigh `DEFAULT_PACKET_WEIGHT_G`.
 * `null` only when the formula is empty — with no lines there is no sample to
 * scale, and no amount of default weight invents one.
 */
export function effectiveScalingConstant(
  // Storage rows carry `null`, the domain type carries `undefined`; both mean
  // "not set", and this is the one function that has to accept either.
  product: { scalingConstant?: number | null },
  formulaLines: readonly FormulaLine[],
  defaultPacketWeightG: number = DEFAULT_PACKET_WEIGHT_G,
): number | null {
  if (product.scalingConstant != null) return product.scalingConstant;
  const sampleTotal = formulaLines.reduce((s, l) => s + l.sampleWt, 0);
  return sampleTotal > 0 ? defaultPacketWeightG / sampleTotal : null;
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
