/**
 * Domain types for CV Naturals Orders + Inventory.
 *
 * These mirror the Notion graph this app replaces (Pro, form, input, SD,
 * Client List, Bill, Receipt) but normalize its two structural problems:
 * Bill's 30 product-quantity columns become `OrderItem` rows, and form's
 * shared ingredient table becomes `FormulaLine` keyed by product id instead
 * of by free-text product name.
 *
 * Every id is a stable local key. Nothing here knows about Notion, SQLite,
 * or HTTP — this package is pure domain shape plus pure functions over it.
 */

// ── Catalogue ─────────────────────────────────────────────────────────────

/** One saleable product. Notion's "Pro" database, one row per product. */
export interface Product {
  id: string;
  /** Notion's short code, e.g. "pKAsw", "pTN". Kept because bills, staff
   * conversation, and packaging all still refer to products by this code. */
  code: string;
  displayName: string;
  hsnCode?: string;
  /** GST rate as a fraction, e.g. 0.18 for 18%. */
  gstRate: number;
  /** Selling price. Notion's "SP". */
  sellingPrice: number;
  /**
   * Multiplies a formula line's `sampleWt` into an actual packet weight for
   * costing. Notion had this baked into an opaque formula ("pkt wt"); here
   * it is a plain number you set per product from the mapping/costing panel
   * (kebab menu on the product). `undefined` means "not set yet" — costing
   * functions require a value (from here or a passed-in default) rather
   * than silently assuming 1.
   */
  scalingConstant?: number;
  /** Notion's abandoned costing slots — never populated in the source data.
   * Optional here too; `costing.ts` only uses whichever are present. */
  opsCost?: number;
  packagingCost?: number;
  transportCost?: number;
  retailerMarginPct?: number;
  active: boolean;
}

/** One raw material. Notion's "input" database. */
export interface RawMaterial {
  id: string;
  name: string;
  pricePerKg: number;
  active: boolean;
}

/** One supplier. Notion's "SD" database. */
export interface Supplier {
  id: string;
  name: string;
  phone?: string;
  address?: string;
  email?: string;
}

/** input↔SD is many-to-many in Notion: a raw material can list several sellers. */
export interface SupplierMaterial {
  supplierId: string;
  rawMaterialId: string;
}

/**
 * One ingredient line of a product's formula. Notion's "form" database,
 * filtered by product name per Pro page — here it is a direct relation.
 *
 * `sampleWt` is the weight recorded against a lab/trial sample batch, not a
 * finished packet. Notion's own "pkt wt" formula scaled a sample weight up
 * to a saleable packet, but the scaling factor was never disclosed by the
 * Notion API (formula bodies aren't fetchable) and no worked example was
 * available at migration time. Rather than guess it, `scalingConstant`
 * lives on `Product` as an explicit, user-editable number — see
 * `costing.ts`.
 */
export interface FormulaLine {
  productId: string;
  rawMaterialId: string;
  sampleWt: number;
}

// ── Manual product mapping ───────────────────────────────────────────────
// Bills predate a normalized schema: the 30 quantity columns on a Notion
// Bill row, and the free-text `form.name`, are two more naming spaces for
// the same products as Pro's product codes — and the three spaces have
// already drifted (pKobs/pKObs, pS vs "pS - children" / "pS - Mix"). An
// automatic match would silently paper over exactly that drift. Every
// mapping here is therefore a fact someone confirmed, entered through the
// mapping panel (reachable from a record's kebab / "..." menu), never a
// guess this package makes on their behalf.

export type MappingSourceKind = "bill_column" | "form_name";

/** One confirmed equivalence between a legacy source label and a Product. */
export interface ProductMapping {
  sourceKind: MappingSourceKind;
  /** The column header or form.name string exactly as it appeared in Notion. */
  sourceLabel: string;
  productId: string;
}

// ── Customers ─────────────────────────────────────────────────────────────

export interface Customer {
  id: string;
  name: string;
  phoneE164?: string;
  /** Key in @cvn/whatsapp's identity space (`whatsapp:+E164` or
   * `whatsapp-lid:<id>`), when this customer has been linked to a chat. */
  whatsappKey?: string;
  address?: string;
  /** Two-letter GST state code, e.g. "KA", "MH". Drives CGST+SGST vs IGST. */
  stateCode?: string;
  gstin?: string;
  /** Notion's "Old Balance" — an opening ledger entry carried at migration. */
  openingBalance: number;
}

// ── Orders ───────────────────────────────────────────────────────────────

export type OrderStatus =
  | "draft"
  | "confirmed"
  | "packed"
  | "dispatched"
  | "delivered"
  | "cancelled";

export type OrderSource = "whatsapp" | "manual";

export interface Order {
  id: string;
  /** Continues Notion's Bill No sequence (last observed: 251). */
  orderNo: string;
  customerId: string;
  source: OrderSource;
  status: OrderStatus;
  placedAt: string;
  transportCharge: number;
  notes?: string;
}

export interface OrderItem {
  orderId: string;
  productId: string;
  qty: number;
  /** Price at the time of sale — never re-read from `Product.sellingPrice`
   * after the fact, so a later price change cannot retroactively reprice a
   * standing order. */
  unitPrice: number;
  gstRate: number;
}

export interface Payment {
  id: string;
  orderId: string;
  customerId: string;
  amount: number;
  method: "cash" | "upi" | "bank_transfer" | "other";
  at: string;
  reference?: string;
}

export type PaymentStatus = "unpaid" | "partial" | "paid";

// ── Invoices ─────────────────────────────────────────────────────────────

export interface Invoice {
  id: string;
  /** One or more orders billed on this invoice. An order belongs to at
   * most one invoice — enforced at the persistence layer, not here. */
  orderIds: string[];
  /** Gap-free within `fy`. See `invoicing.ts`. */
  number: number;
  /** Financial year label, e.g. "2026-27". */
  fy: string;
  issuedAt: string;
  /** The invoice as issued — customer address, prices, tax split — frozen
   * at issue time so later edits to the order or customer record cannot
   * alter a document already handed to someone. */
  snapshot: InvoiceSnapshot;
}

export interface InvoiceSnapshot {
  orderNos: string[];
  customerName: string;
  customerAddress?: string;
  customerGstin?: string;
  placeOfSupplyState?: string;
  lines: InvoiceSnapshotLine[];
  transportCharge: number;
  taxSplit: TaxSplit;
  grandTotal: number;
}

export interface InvoiceSnapshotLine {
  productCode: string;
  productName: string;
  hsnCode?: string;
  qty: number;
  unitPrice: number;
  gstRate: number;
  lineTotal: number;
}

export interface TaxSplit {
  kind: "intra_state" | "inter_state";
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
}

// ── Inventory ────────────────────────────────────────────────────────────

export type StockItemType = "product" | "raw_material";

export interface StockBatch {
  id: string;
  itemType: StockItemType;
  itemId: string;
  batchNo: string;
  mfgDate?: string;
  expiryDate?: string;
  unitCost: number;
}

export type StockMoveReason =
  | "purchase"
  | "production_in"
  | "production_out"
  | "sale"
  | "adjustment"
  | "return";

/**
 * One entry in the append-only stock ledger. Stock on hand for a batch is
 * `sum(delta)` over its moves — never a mutable counter — so the ledger can
 * always be audited back to the moves that produced a given level.
 */
export interface StockMove {
  id: string;
  batchId: string;
  delta: number;
  reason: StockMoveReason;
  refType?: "order" | "production_run" | "purchase";
  refId?: string;
  at: string;
}
