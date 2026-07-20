// DealPilot-owned shapes only — sourcing/dedupe/facts/table primitives are imported from the
// shared modules, never redefined here (docs/raw/dealpilot-architecture-requirement.md S4/S8,
// re-based onto @bridge/facts + @bridge/dedupe + @bridge/tables per the standardization plan).

export interface ThesisProfile {
  industries: string[]; // NAICS labels or free-text industry tags the tenant is targeting
  geo: string[];
  sdeMin?: number;
  sdeMax?: number;
  revenueMin?: number;
  revenueMax?: number;
}

// The "living profile" fields DealPilot reads back from @bridge/facts.livingProfile(dealId) —
// a subset projection, not a parallel store.
export interface DealProfile {
  industry?: string;
  geo?: string;
  sde?: number;
  revenue?: number;
  [field: string]: unknown;
}

/** Domain evaluation band. This is Thesis fit, not platform Red Flag feedback. */
export type ThesisFitBand = "strong_fit" | "needs_review" | "weak_fit";

export interface ThesisFitResult {
  score: number; // 0..1
  band: ThesisFitBand;
  reasons: string[];
}
