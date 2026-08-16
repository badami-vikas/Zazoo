/**
 * Invoice numbering and the GST tax split.
 *
 * Both are deliberately dumb: gap-free sequential numbering is a compliance
 * requirement, not a UX nicety, so `nextInvoiceNumber` takes the last-used
 * number for a financial year and returns exactly one more — no id
 * generation, no "just in case" gaps. The tax split is CGST+SGST when the
 * place of supply matches the seller's state, IGST otherwise; nothing more
 * elaborate than that until turnover crosses the e-invoicing threshold.
 */
import type {
  Customer,
  Invoice,
  InvoiceSnapshot,
  InvoiceSnapshotLine,
  Order,
  OrderItem,
  Product,
  TaxSplit,
} from "./schema.js";

/**
 * Indian financial year label for a date: Apr 1–Mar 31, e.g. "2026-27" for
 * any date from 2026-04-01 through 2027-03-31.
 */
export function financialYearFor(date: Date): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0-indexed; 3 = April
  const startYear = month >= 3 ? year : year - 1;
  const endYearShort = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${endYearShort}`;
}

export class NonSequentialInvoiceNumberError extends Error {
  constructor(fy: string, lastNumber: number) {
    super(
      `Refusing to skip an invoice number for FY ${fy}: last issued was ${lastNumber}, ` +
        "next must be exactly one more. Gap-free numbering is a GST requirement.",
    );
    this.name = "NonSequentialInvoiceNumberError";
  }
}

/** `lastNumberInFy` is the highest invoice number already issued for `fy`,
 * or `0` if none has been issued yet. */
export function nextInvoiceNumber(lastNumberInFy: number): number {
  if (!Number.isInteger(lastNumberInFy) || lastNumberInFy < 0) {
    throw new NonSequentialInvoiceNumberError("unknown", lastNumberInFy);
  }
  return lastNumberInFy + 1;
}

export function computeTaxSplit(taxableValue: number, gstRate: number, isInterState: boolean): {
  cgst: number;
  sgst: number;
  igst: number;
} {
  const totalTax = taxableValue * gstRate;
  if (isInterState) {
    return { cgst: 0, sgst: 0, igst: totalTax };
  }
  const half = totalTax / 2;
  return { cgst: half, sgst: half, igst: 0 };
}

export interface BuildInvoiceSnapshotInput {
  /** Every order billed on this invoice — one is the common case, but an
   * invoice may cover several orders for the same customer. */
  orders: readonly Order[];
  items: readonly OrderItem[];
  customer: Customer;
  productsById: ReadonlyMap<string, Product>;
  /** Seller's own GST state code, e.g. "KA". Determines intra- vs inter-state. */
  sellerStateCode: string;
}

export class UnknownProductError extends Error {
  constructor(productId: string) {
    super(`Order item references unknown product ${productId}.`);
    this.name = "UnknownProductError";
  }
}

export class MixedCustomerInvoiceError extends Error {
  constructor() {
    super("Every order on an invoice must belong to the same customer.");
    this.name = "MixedCustomerInvoiceError";
  }
}

export class EmptyInvoiceError extends Error {
  constructor() {
    super("An invoice needs at least one order.");
    this.name = "EmptyInvoiceError";
  }
}

/**
 * Freeze everything an invoice needs at issue time — prices, address, tax
 * split — so a later edit to an order or the customer record cannot alter
 * a document already handed to someone.
 */
export function buildInvoiceSnapshot(input: BuildInvoiceSnapshotInput): InvoiceSnapshot {
  const { orders, items, customer, productsById, sellerStateCode } = input;
  if (orders.length === 0) throw new EmptyInvoiceError();
  if (orders.some((o) => o.customerId !== customer.id)) throw new MixedCustomerInvoiceError();

  const lines: InvoiceSnapshotLine[] = items.map((item) => {
    const product = productsById.get(item.productId);
    if (!product) throw new UnknownProductError(item.productId);
    return {
      productCode: product.code,
      productName: product.displayName,
      ...(product.hsnCode !== undefined ? { hsnCode: product.hsnCode } : {}),
      qty: item.qty,
      unitPrice: item.unitPrice,
      gstRate: item.gstRate,
      lineTotal: item.qty * item.unitPrice,
    };
  });

  const taxableValue = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  // A mixed-rate order taxed at its dominant line's rate would misstate
  // every other line, so the split is computed once per invoice only when
  // every line shares one GST rate — otherwise callers must invoice
  // per-rate-group. That policy lives at the call site, not here.
  const isInterState = Boolean(customer.stateCode) && customer.stateCode !== sellerStateCode;
  const gstRate = lines[0]?.gstRate ?? 0;
  const { cgst, sgst, igst } = computeTaxSplit(taxableValue, gstRate, isInterState);

  const taxSplit: TaxSplit = {
    kind: isInterState ? "inter_state" : "intra_state",
    taxableValue,
    cgst,
    sgst,
    igst,
  };

  const transportCharge = orders.reduce((sum, o) => sum + o.transportCharge, 0);
  // TASK-031. Amounts sum across a multi-order invoice; the percentage is then
  // re-derived from the summed amount rather than averaged, because two orders
  // at different percentages have no meaningful average — only a combined
  // effective rate, which is what the invoice should state.
  const discountAmount = orders.reduce((sum, o) => sum + (o.discountAmount ?? 0), 0);
  const beforeDiscount = taxableValue + cgst + sgst + igst + transportCharge;
  const discountPct = beforeDiscount > 0 ? (discountAmount / beforeDiscount) * 100 : 0;
  const grandTotal = beforeDiscount - discountAmount;

  return {
    orderNos: orders.map((o) => o.orderNo),
    customerName: customer.name,
    ...(customer.address !== undefined ? { customerAddress: customer.address } : {}),
    ...(customer.gstin !== undefined ? { customerGstin: customer.gstin } : {}),
    ...(customer.stateCode !== undefined ? { placeOfSupplyState: customer.stateCode } : {}),
    lines,
    transportCharge,
    discountPct,
    discountAmount,
    taxSplit,
    grandTotal,
  };
}

export function buildInvoice(
  id: string,
  orders: readonly Order[],
  number: number,
  fy: string,
  issuedAt: string,
  snapshot: InvoiceSnapshot,
): Invoice {
  return { id, orderIds: orders.map((o) => o.id), number, fy, issuedAt, snapshot };
}
