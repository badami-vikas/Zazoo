/**
 * The stock ledger.
 *
 * Stock on hand is never a mutable counter — it is `sum(delta)` over a
 * batch's moves, always. That is the whole safety property: any level can
 * be audited back to the moves that produced it, and nothing can silently
 * drift the way a `qty` column does when two writers race.
 */
import type { StockBatch, StockMove, StockMoveReason } from "./schema.js";

export function stockOnHand(batchId: string, moves: readonly StockMove[]): number {
  return moves
    .filter((m) => m.batchId === batchId)
    .reduce((sum, m) => sum + m.delta, 0);
}

export function stockOnHandByItem(
  itemId: string,
  batches: readonly StockBatch[],
  moves: readonly StockMove[],
): number {
  const batchIds = new Set(batches.filter((b) => b.itemId === itemId).map((b) => b.id));
  return moves
    .filter((m) => batchIds.has(m.batchId))
    .reduce((sum, m) => sum + m.delta, 0);
}

let moveCounter = 0;
/** Deterministic-enough id for a move within one process; callers persisting
 * moves should supply their own id strategy (uuid, autoincrement, ...). This
 * exists only so pure planning functions below can return complete objects. */
function nextMoveId(): string {
  moveCounter += 1;
  return `move-${moveCounter}`;
}

export function planMove(
  batchId: string,
  delta: number,
  reason: StockMoveReason,
  at: string,
  ref?: { refType: "order" | "production_run" | "purchase"; refId: string },
): StockMove {
  return {
    id: nextMoveId(),
    batchId,
    delta,
    reason,
    at,
    ...(ref ? { refType: ref.refType, refId: ref.refId } : {}),
  };
}

export interface LowStockEntry {
  itemId: string;
  onHand: number;
  reorderLevel: number;
}

/** Items at or below their reorder level, given each item's current stock. */
export function lowStockItems(
  onHandByItem: ReadonlyMap<string, number>,
  reorderLevelByItem: ReadonlyMap<string, number>,
): LowStockEntry[] {
  const entries: LowStockEntry[] = [];
  for (const [itemId, reorderLevel] of reorderLevelByItem) {
    const onHand = onHandByItem.get(itemId) ?? 0;
    if (onHand <= reorderLevel) entries.push({ itemId, onHand, reorderLevel });
  }
  return entries;
}

export interface ExpiringBatch {
  batch: StockBatch;
  daysUntilExpiry: number;
}

/** Batches with stock on hand whose expiry falls within `withinDays` of `now`. */
export function nearExpiryBatches(
  batches: readonly StockBatch[],
  moves: readonly StockMove[],
  now: Date,
  withinDays: number,
): ExpiringBatch[] {
  const results: ExpiringBatch[] = [];
  for (const batch of batches) {
    if (!batch.expiryDate) continue;
    if (stockOnHand(batch.id, moves) <= 0) continue;
    const expiry = new Date(batch.expiryDate);
    const daysUntilExpiry = Math.ceil((expiry.getTime() - now.getTime()) / 86_400_000);
    if (daysUntilExpiry <= withinDays) results.push({ batch, daysUntilExpiry });
  }
  return results.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
}

/**
 * Given a batch, every order whose dispatch consumed stock from it — the
 * traceability read: "which customers received this batch".
 */
export function ordersForBatch(batchId: string, moves: readonly StockMove[]): string[] {
  return moves
    .filter((m) => m.batchId === batchId && m.reason === "sale" && m.refType === "order" && m.refId)
    .map((m) => m.refId as string);
}
