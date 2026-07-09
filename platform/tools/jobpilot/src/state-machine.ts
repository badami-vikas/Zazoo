import type { ApplicationStage } from "./types.js";

// The application pipeline state machine (architecture doc S2: "Every transition writes a
// stage_events row; no status is ever updated without one — enforced in one
// `transition(application, to, actor, meta)` helper, the only code path allowed to touch
// status"). This module IS that helper: a pure validate-and-log function, not a persistence
// layer — applying the returned stage to a stored `applications` row is a future DB/ritual
// concern, deliberately out of scope for this anchor.

export type StageActor = "system" | "user" | "gmail_router" | string; // agent name, per architecture doc

export interface StageEvent {
  applicationId: string;
  from: ApplicationStage | null;
  to: ApplicationStage;
  actor: StageActor;
  meta: Record<string, unknown>;
  at: string;
}

export class InvalidTransitionError extends Error {}

// Mirrors the diagram in architecture doc S2 exactly: queued -> tailoring -> evaluating splits
// into approved (auto) or awaiting_review (yellow flag), both funnel into applying, which either
// completes (submitted -> confirmed) or parks (needs_you) and can resume back into applying.
const ALLOWED_TRANSITIONS: Record<ApplicationStage, ApplicationStage[]> = {
  queued: ["tailoring"],
  tailoring: ["evaluating"],
  evaluating: ["tailoring", "approved", "awaiting_review"], // tailoring = retry loop, capped by the caller (<=3 iterations)
  approved: ["applying"],
  awaiting_review: ["applying", "rejected_by_user"], // human approve / reject
  applying: ["submitted", "parked", "failed", "expired"],
  parked: ["applying"], // resumed after needs_you is resolved
  submitted: ["confirmed"],
  confirmed: [],
  rejected_by_user: [],
  failed: [],
  expired: [],
};

export function transition(
  current: ApplicationStage,
  to: ApplicationStage,
  applicationId: string,
  actor: StageActor,
  meta: Record<string, unknown> = {},
): StageEvent {
  const allowed = ALLOWED_TRANSITIONS[current];
  if (!allowed.includes(to)) {
    throw new InvalidTransitionError(`cannot transition application "${applicationId}" from "${current}" to "${to}"`);
  }
  return { applicationId, from: current, to, actor, meta, at: new Date().toISOString() };
}
