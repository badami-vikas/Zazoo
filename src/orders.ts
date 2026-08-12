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

export function orderTotal(items: readonly OrderItem[], transportCharge: number): number {
  return itemsSubtotal(items) + transportCharge;
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
