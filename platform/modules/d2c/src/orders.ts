/**
 * Order lifecycle and payment status. Both are pure state machines over
 * plain data — no I/O, no clock (the caller supplies "now" where it matters).
 */
import type { OrderItem, OrderStatus, Payment, PaymentStatus } from "./schema.js";

const FORWARD_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  draft: ["confirmed", "cancelled"],
  confirmed: ["packed", "cancelled"],
  packed: ["dispatched", "cancelled"],
  dispatched: ["delivered"],
  delivered: [],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return FORWARD_TRANSITIONS[from].includes(to);
}

export class InvalidOrderTransitionError extends Error {
  constructor(from: OrderStatus, to: OrderStatus) {
    super(`Cannot move an order from "${from}" to "${to}".`);
    this.name = "InvalidOrderTransitionError";
  }
}

export function transition(from: OrderStatus, to: OrderStatus): OrderStatus {
  if (!canTransition(from, to)) throw new InvalidOrderTransitionError(from, to);
  return to;
}

/** Sum of `qty * unitPrice` across an order's items, before transport/tax. */
export function itemsSubtotal(items: readonly OrderItem[]): number {
  return items.reduce((sum, item) => sum + item.qty * item.unitPrice, 0);
}

/** GST across an order's items, each line at its own rate. */
export function itemsTax(items: readonly OrderItem[]): number {
  return items.reduce((sum, item) => sum + item.qty * item.unitPrice * item.gstRate, 0);
}

/** Money rounds to paise everywhere in this module. Without it the
 * discount round-trip (percentage → amount → percentage) drifts by float
 * noise and the two stored columns stop reconciling. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** What the order is worth before any discount: items + their GST + transport. */
export function orderGross(items: readonly OrderItem[], transportCharge: number): number {
  return round2(itemsSubtotal(items) + itemsTax(items) + transportCharge);
}

/**
 * What the customer owes. Tax-inclusive — this used to return
 * `itemsSubtotal + transportCharge`, silently dropping GST, while
 * `orders.list` computed the same figure *with* tax, so the list and the
 * detail page disagreed about the same order. One tax-inclusive definition
 * now backs both, plus `customers.ledger` and `payments.markOrderPaid`.
 */
export function orderTotal(
  items: readonly OrderItem[],
  transportCharge: number,
  discountAmount = 0,
): number {
  return round2(orderGross(items, transportCharge) - discountAmount);
}

/** TASK-031: percentage is the stored primary; this is the amount it comes to. */
export function discountAmountFor(gross: number, discountPct: number): number {
  return round2((gross * discountPct) / 100);
}

/**
 * Inverse of `discountAmountFor` — the percentage that makes `gross` land on
 * `finalAmount`. This is what "edit the final amount" writes back, so the two
 * stored columns always reconcile rather than drifting apart.
 *
 * Clamped to 0–100: a final amount above gross is a surcharge, not a discount,
 * and a negative one is meaningless. A zero gross has no percentage that means
 * anything, so it discounts by nothing rather than dividing by zero.
 */
export function discountPctFor(gross: number, finalAmount: number): number {
  if (gross <= 0) return 0;
  const pct = ((gross - finalAmount) / gross) * 100;
  return round2(Math.min(100, Math.max(0, pct)));
}

/**
 * Payment status is tracked separately from order status on purpose: this
 * business runs COD, so "dispatched" and "paid" are independent facts and
 * conflating them (as a single order-status enum would) misrepresents COD
 * orders as either unshippable or prepaid.
 */
export function paymentStatus(total: number, payments: readonly Payment[]): PaymentStatus {
  const paid = payments.reduce((sum, p) => sum + p.amount, 0);
  if (paid <= 0) return "unpaid";
  if (paid >= total) return "paid";
  return "partial";
}
