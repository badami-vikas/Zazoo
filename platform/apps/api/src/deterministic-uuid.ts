import { createHash } from "node:crypto";

/**
 * Deterministic uuid from a stable string seed (sha256 → RFC-4122 shape,
 * version nibble 5-style). The SAME seed always yields the SAME uuid — the
 * convention every uuid-typed lineage key (red-flag anchors, TASK-029
 * learning-suggestion lineages) uses so re-derivation on any instance
 * addresses the same row. Extracted from router.ts so wiring.ts can share it
 * without a router→wiring→router import cycle.
 */
export function deterministicUuid(seed: string): string {
  const hash = createHash("sha256").update(seed).digest();
  const bytes = Uint8Array.prototype.slice.call(hash, 0, 16) as Uint8Array;
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
