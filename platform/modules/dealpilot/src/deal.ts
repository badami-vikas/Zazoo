// Canonical Deal domain — stage model and deterministic transition contract.
// DP0 scope: Deals list + Deal shell (docs/raw/dealpilot-module-plan-2026-07.md §6, slice DP0,
// §1.2 column "stage": sourced → triage → engaged → NDA/CIM → diligence → IC → LOI →
// closing → portfolio / passed).

/** All stage identifiers in pipeline order. `triage` is a process stage where a Human
 * evaluates a Deal; it is unrelated to platform Red Flag feedback or Thesis fit bands.
 * Names are normalized to snake_case for code; display labels are a UI concern. */
export type DealStage =
  | "sourced"
  | "triage"
  | "engaged"
  | "nda_cim"
  | "diligence"
  | "ic"
  | "loi"
  | "closing"
  | "portfolio"
  | "passed";

/**
 * Directed stage graph — every allowed next-stage from a given current stage.
 * "passed" is a valid exit from any non-terminal stage (early-exit decision).
 * "portfolio" and "passed" are terminal; their allowed lists are empty.
 */
export const VALID_TRANSITIONS: Readonly<Record<DealStage, ReadonlyArray<DealStage>>> = {
  sourced: ["triage", "passed"],
  triage: ["engaged", "passed"],
  engaged: ["nda_cim", "passed"],
  nda_cim: ["diligence", "passed"],
  diligence: ["ic", "passed"],
  ic: ["loi", "passed"],
  loi: ["closing", "passed"],
  closing: ["portfolio", "passed"],
  portfolio: [],
  passed: [],
};

/** Stages that admit no further transition. */
export const TERMINAL_STAGES: ReadonlySet<DealStage> = new Set<DealStage>(["portfolio", "passed"]);

/** Ordered list of pipeline stages (sourced … closing) — terminal stages excluded. */
export const PIPELINE_STAGES: ReadonlyArray<DealStage> = [
  "sourced",
  "triage",
  "engaged",
  "nda_cim",
  "diligence",
  "ic",
  "loi",
  "closing",
];

/** Minimal Deal identity. Full field richness lives in FactStore; this is the shell. */
export interface DealShell {
  id: string;
  name: string;
  stage: DealStage;
  thesisId?: string;
  ownerId?: string;
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
}

export interface StageTransitionError {
  code: "INVALID_TRANSITION";
  from: DealStage;
  to: DealStage;
  reason: string;
}

export type TransitionResult =
  | { ok: true; stage: DealStage }
  | { ok: false; error: StageTransitionError };

/**
 * Deterministic stage transition.
 *
 * Returns `{ ok: true, stage }` if `to` is a valid next stage from `from`.
 * Returns `{ ok: false, error }` with a human-readable reason otherwise.
 * Never throws — use the discriminated union at the call-site.
 */
export function transitionStage(from: DealStage, to: DealStage): TransitionResult {
  const allowed = VALID_TRANSITIONS[from];
  if ((allowed as ReadonlyArray<string>).includes(to)) {
    return { ok: true, stage: to };
  }
  const reason = TERMINAL_STAGES.has(from)
    ? `stage "${from}" is terminal — no further transitions are valid`
    : `"${to}" is not a valid next stage from "${from}"; allowed: [${allowed.join(", ")}]`;
  return { ok: false, error: { code: "INVALID_TRANSITION", from, to, reason } };
}

/** Quick boolean guard — use when you only need a yes/no without error detail. */
export function canTransition(from: DealStage, to: DealStage): boolean {
  return (VALID_TRANSITIONS[from] as ReadonlyArray<string>).includes(to);
}
