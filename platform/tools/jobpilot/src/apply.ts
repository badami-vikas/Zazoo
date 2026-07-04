import type { AnswerBank } from "./answer-bank.js";
import { NeedsHuman } from "./answer-bank.js";
import type { EvalVerdict } from "./types.js";

// Apply waterfall (architecture doc S3 `apply.Dispatcher` + S7 failure taxonomy): "resolves ATS
// from jobs.ats, walks tiers 1->4". This module owns the DECISION logic only — which tier to
// enter, how to map answer-bank answers onto a form schema, and how a tier's outcome routes to
// the next step — never the actual HTTP POST / Playwright / browser-agent execution (those are
// real I/O, out of scope for this anchor, same as connectors.ts injecting a fetcher rather than
// doing real network calls itself).

const BIG_THREE = new Set(["greenhouse", "lever", "ashby"]);

// architecture doc S3 `apply.Dispatcher`: "resolve ATS from jobs.ats -> Tier 1 if
// greenhouse/lever/ashby -> else Tier 2". Workday/iCIMS/etc. and anything unrecognized enters at
// Tier 2 (Playwright form-fill), never Tier 1 (no known predictable form schema).
export function resolveEntryTier(ats: string): 1 | 2 {
  return BIG_THREE.has(ats.toLowerCase()) ? 1 : 2;
}

export interface FormField {
  id: string;
  label: string; // the screening-question text passed to AnswerBank.resolve
  required: boolean;
}

export interface FormMapping {
  payload: Record<string, string>;
  unresolved: FormField[]; // required fields the answer bank could not resolve (NeedsHuman)
}

// Maps a form schema onto answer-bank answers (architecture doc S4.4: "each encountered question
// goes through AnswerBank.resolve"). Required fields that raise NeedsHuman are collected, not
// thrown — the caller (a future Dispatcher) decides whether an unresolved-but-optional field is
// fine to skip or an unresolved-required field means "park with partially-saved state" (S4.4).
export function mapAnswersToForm(fields: FormField[], bank: AnswerBank): FormMapping {
  const payload: Record<string, string> = {};
  const unresolved: FormField[] = [];

  for (const field of fields) {
    try {
      const answer = bank.resolve(field.label);
      payload[field.id] = answer.answer;
    } catch (err) {
      if (!(err instanceof NeedsHuman)) throw err;
      if (field.required) unresolved.push(field);
    }
  }

  return { payload, unresolved };
}

export type ApplyOutcome = "APPLIED" | "EXPIRED" | "CAPTCHA" | "LOGIN_ISSUE" | "FAILED";

export type DispatchAction =
  | { kind: "submitted" } // APPLIED
  | { kind: "stopped"; reason: "expired" } // permanent, no more attempts (posting gone)
  | { kind: "escalate"; nextTier: 2 | 3 | 4 } // retriable failure, try the next tier
  | { kind: "parked"; reason: "captcha" | "login_issue" | "exhausted" }; // human-gated, never silent

// The failure-taxonomy router (architecture doc S7: "Retriable: ... Playwright timeouts (<=2
// retries) ... Permanent: EXPIRED ... Human-gated: CAPTCHA, LOGIN_ISSUE ... always parked, never
// retried"). CAPTCHA/LOGIN_ISSUE never escalate to a later tier — they are immediate safety stops
// per S4.3, not a "try tier 3 instead" case.
export function nextDispatchAction(currentTier: 1 | 2 | 3 | 4, outcome: ApplyOutcome): DispatchAction {
  if (outcome === "APPLIED") return { kind: "submitted" };
  if (outcome === "EXPIRED") return { kind: "stopped", reason: "expired" };
  if (outcome === "CAPTCHA") return { kind: "parked", reason: "captcha" };
  if (outcome === "LOGIN_ISSUE") return { kind: "parked", reason: "login_issue" };
  // FAILED: retriable — escalate to the next tier, or park if Tier 4 (human handoff) itself failed.
  if (currentTier === 4) return { kind: "parked", reason: "exhausted" };
  return { kind: "escalate", nextTier: (currentTier + 1) as 2 | 3 | 4 };
}

// Safety invariant S7(1): "No submit without eval_report.approved=true". A future real Dispatcher
// must call this gate before entering the waterfall at all — encoded as a function, not a comment,
// so it's testable and can't be silently skipped by a caller.
export function assertApprovedForSubmit(verdict: EvalVerdict): void {
  if (!verdict.approved) {
    throw new Error(`cannot submit: evaluator did not approve (${verdict.blockingIssues.join("; ")})`);
  }
}
