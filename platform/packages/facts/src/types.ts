// Append-only fact store — one implementation for the "living profile" pattern that DealPilot's
// deal_facts, JobPilot's job/application facts, and people/company enrichment all need
// independently today. Facts are never mutated in place; a correction is a NEW fact whose
// supersedes points at the old one, so provenance and history are never lost.

export type Provenance = "listing" | "document" | "email" | "seller_stated" | "public_record" | "ai_inferred" | "user_entered";

export interface Fact<T = unknown> {
  id: string;
  entityId: string; // person/company/deal/job id this fact is about
  field: string; // e.g. "revenue", "title", "email"
  value: T;
  provenance: Provenance;
  confidence: number; // 0..1
  supersededBy?: string; // id of the fact that replaced this one, if any
  recordedAt: string; // ISO timestamp
}

export interface NewFactInput<T = unknown> {
  entityId: string;
  field: string;
  value: T;
  provenance: Provenance;
  confidence: number;
}

// Confidence ranking used to pick a winner when two live (non-superseded) facts collide on the
// same field with equal recency — provenance quality breaks the tie, not just arrival order.
export const PROVENANCE_RANK: Record<Provenance, number> = {
  public_record: 6,
  document: 5,
  seller_stated: 4,
  email: 3,
  listing: 2,
  user_entered: 4,
  ai_inferred: 1,
};
