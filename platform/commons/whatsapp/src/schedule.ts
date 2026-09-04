/**
 * Scheduled actions — the queue of Agent Runs waiting for their moment, and the
 * record of WHY each one is waiting for the moment it is.
 *
 * ## What this is not
 *
 * It is not a send queue and it holds no message bodies. Every entry is a
 * pending **Agent Run start**: `automation.ts` decided a rule matched, and this
 * module holds that decision until its time comes. When the Run happens and the
 * Agent wants to send something, it goes through `performAutomatedSend` —
 * policy refusals, then `decideSend`, then the Rust-enforced ceiling, then the
 * send. **The scheduler proposes; the policy and that ceiling dispose.** There
 * is deliberately no import of `outbound.ts` here, so there is no second write
 * path for one to be built into.
 *
 * ## The rule that shapes the whole file
 *
 * A REFUSAL never becomes a scheduled action. `scheduleFromPolicy` queues a
 * `deferred` decision and records a `refused` one as a refusal that the owner
 * can read. Turning "this would be a first contact" into "retrying at 09:00"
 * would convert a permanent no into a pending yes, which is the failure mode
 * the whole consent design exists to prevent. `schedule.test.ts` pins it.
 *
 * ## Why every entry explains itself
 *
 * A queue that shows a time and nothing else teaches the owner to trust it
 * blindly. Every `ScheduledAction` carries a `reason` naming the policy rule
 * that set the time — `business_hours`, `recipient_cooldown`, `daily_cap` — so
 * "why is this going out on Tuesday" is answerable from the row itself.
 *
 * Pacing note, since a scheduler is where it would be misdescribed: the jitter
 * added on top of an earliest-allowed time exists so automated sending is
 * genuinely human-paced rather than fired the instant a job runs. It is not
 * concealment, and nothing here treats it as such.
 *
 * Pure: `now`, ids and the jitter draw are supplied by the caller.
 */

import type { AssignmentSubject } from "./assignment.js";
import { jitterSeconds, type SendPolicyDecision, type SendPolicyLimits, type SendPolicyRule } from "./policy.js";

// ── Reasons ──────────────────────────────────────────────────────────────────

/**
 * Why this action is scheduled for when it is.
 *
 *  - `trigger_delay` — the rule's own "wait a while before acting".
 *  - `policy_deferral` — the send discipline said not yet, and named a rule.
 *  - `pacing` — the human-pacing delay on an otherwise-allowed action.
 */
export type ScheduleReasonCode = "trigger_delay" | "policy_deferral" | "pacing";

export interface ScheduleReason {
  code: ScheduleReasonCode;
  /** The policy rule that set the time, when one did. */
  policyRule?: SendPolicyRule;
  /** A sentence the panel renders as-is. Always concrete, never a placeholder. */
  explanation: string;
}

// ── Actions ──────────────────────────────────────────────────────────────────

export type ScheduledActionStatus = "queued" | "cancelled" | "started";

export interface ScheduledAction {
  id: string;
  /** The rule that produced this, when a rule did. Absent for a manual queue. */
  ruleId?: string;
  /** The Agent that will be run. Always an assigned, attributable Agent. */
  agentId: string;
  subject: AssignmentSubject;
  /** What the Run is for. A goal, never message text. */
  goal: string;
  skillId?: string;
  queuedAt: string;
  scheduledFor: string;
  reason: ScheduleReason;
  status: ScheduledActionStatus;
  cancelledAt?: string;
  cancelledBy?: string;
  startedAt?: string;
  /** The Agent Run this became, once it started. The link to the audit trail. */
  agentRunId?: string;
}

export interface ScheduleLedger {
  actions: readonly ScheduledAction[];
}

export const EMPTY_SCHEDULE_LEDGER: ScheduleLedger = { actions: [] };

export class ScheduleError extends Error {}

function instant(iso: string): number {
  const value = Date.parse(iso);
  if (Number.isNaN(value)) throw new ScheduleError(`"${iso}" is not an ISO-8601 instant`);
  return value;
}

// ── Queueing ─────────────────────────────────────────────────────────────────

export interface QueueActionInput {
  id: string;
  ruleId?: string;
  agentId: string;
  subject: AssignmentSubject;
  goal: string;
  skillId?: string;
  now: string;
  scheduledFor: string;
  reason: ScheduleReason;
}

export function queueAction(
  ledger: ScheduleLedger,
  input: QueueActionInput,
): { ledger: ScheduleLedger; action: ScheduledAction } {
  if (ledger.actions.some((existing) => existing.id === input.id)) {
    throw new ScheduleError(`A scheduled action with id "${input.id}" already exists.`);
  }
  if (!input.agentId.trim()) {
    throw new ScheduleError(
      "A scheduled action names the Agent that will run — an Automation starts an Agent Run.",
    );
  }
  // Validates both instants and, incidentally, refuses a NaN date silently
  // becoming "now".
  instant(input.now);
  instant(input.scheduledFor);

  const action: ScheduledAction = {
    id: input.id,
    ...(input.ruleId ? { ruleId: input.ruleId } : {}),
    agentId: input.agentId,
    subject: { kind: input.subject.kind, key: input.subject.key },
    goal: input.goal,
    ...(input.skillId ? { skillId: input.skillId } : {}),
    queuedAt: input.now,
    scheduledFor: input.scheduledFor,
    reason: input.reason,
    status: "queued",
  };
  return { ledger: { actions: [action, ...ledger.actions] }, action };
}

export type SchedulingOutcome =
  | { status: "queued"; ledger: ScheduleLedger; action: ScheduledAction }
  /**
   * Refused. Deliberately NOT a ledger change: a refusal is not a pending
   * thing, and a queue that lists refusals as rows is a queue that will
   * eventually retry them.
   */
  | { status: "refused"; rule: SendPolicyRule; reason: string };

export interface ScheduleFromPolicyInput extends Omit<QueueActionInput, "scheduledFor" | "reason"> {
  decision: SendPolicyDecision;
  limits: SendPolicyLimits;
  /** In [0, 1), from the caller. Keeps this a pure function of its inputs. */
  jitterDraw: number;
}

/**
 * Turn a send-policy decision into a queue entry — or into a refusal.
 *
 * The three cases, and why each behaves as it does:
 *
 *  - **refused** → no entry, ever. Waiting does not fix a refusal, so a row
 *    that says "waiting" would be a lie, and a scheduler that retries refusals
 *    is a scheduler that eventually walks into the consent gate on purpose.
 *  - **deferred** → queued at `earliestAt` plus the pacing delay, with the
 *    policy rule recorded so the row can explain itself. The pacing delay is
 *    added on top rather than replacing the deferral: `earliestAt` is the
 *    earliest the discipline permits, and firing at exactly that instant across
 *    a queue would produce a synchronised burst the moment a cap window rolls.
 *  - **allowed** → queued at `now` plus the pacing delay. Even a permitted
 *    action waits: an Agent Run that starts the millisecond a message arrives
 *    is the clearest automation tell there is.
 */
export function scheduleFromPolicy(
  ledger: ScheduleLedger,
  input: ScheduleFromPolicyInput,
): SchedulingOutcome {
  const { decision } = input;

  if (decision.status === "refused") {
    return { status: "refused", rule: decision.rule, reason: decision.reason };
  }

  const delaySeconds = jitterSeconds(input.jitterDraw, input.limits);
  const base =
    decision.status === "deferred" ? instant(decision.earliestAt) : instant(input.now);
  const scheduledFor = new Date(base + delaySeconds * 1_000).toISOString();

  const reason: ScheduleReason =
    decision.status === "deferred"
      ? {
          code: "policy_deferral",
          policyRule: decision.rule,
          explanation: `${decision.reason} Waiting until ${decision.earliestAt}, then pacing by ${delaySeconds}s.`,
        }
      : {
          code: "pacing",
          explanation: `Ready to run, paced by ${delaySeconds}s so it does not fire the instant it was triggered.`,
        };

  const queued = queueAction(ledger, {
    ...input,
    scheduledFor,
    reason,
  });
  return { status: "queued", ledger: queued.ledger, action: queued.action };
}

// ── Reads ────────────────────────────────────────────────────────────────────

/** Everything still waiting, soonest first. What the panel lists. */
export function queuedActions(ledger: ScheduleLedger): readonly ScheduledAction[] {
  return ledger.actions
    .filter((action) => action.status === "queued")
    .slice()
    .sort((a, b) => instant(a.scheduledFor) - instant(b.scheduledFor));
}

/** Queued actions whose time has come. The runner's input. */
export function dueActions(ledger: ScheduleLedger, now: string): readonly ScheduledAction[] {
  const nowMs = instant(now);
  return queuedActions(ledger).filter((action) => instant(action.scheduledFor) <= nowMs);
}

export function findAction(
  ledger: ScheduleLedger,
  actionId: string,
): ScheduledAction | undefined {
  return ledger.actions.find((action) => action.id === actionId);
}

// ── Writes ───────────────────────────────────────────────────────────────────

/**
 * Cancel a queued action.
 *
 * Cancelling stamps rather than deletes, so "I stopped that one" is a fact with
 * a date and a name on it. Cancelling something already started or already
 * cancelled throws: silently succeeding would tell the owner they stopped
 * something they did not.
 */
export function cancelAction(
  ledger: ScheduleLedger,
  actionId: string,
  cancelledBy: string,
  cancelledAt: string,
): { ledger: ScheduleLedger; action: ScheduledAction } {
  const action = findAction(ledger, actionId);
  if (!action) throw new ScheduleError(`No scheduled action with id "${actionId}".`);
  const human = cancelledBy.trim();
  if (!human) throw new ScheduleError("Cancelling records the person who did it.");
  if (action.status !== "queued") {
    throw new ScheduleError(
      `That action is already ${action.status}, so there is nothing to cancel.`,
    );
  }
  const cancelled: ScheduledAction = {
    ...action,
    status: "cancelled",
    cancelledAt,
    cancelledBy: human,
  };
  return {
    ledger: {
      actions: ledger.actions.map((existing) => (existing.id === actionId ? cancelled : existing)),
    },
    action: cancelled,
  };
}

/** Cancel every queued action a rule produced. What deleting a rule calls. */
export function cancelActionsForRule(
  ledger: ScheduleLedger,
  ruleId: string,
  cancelledBy: string,
  cancelledAt: string,
): { ledger: ScheduleLedger; cancelled: number } {
  let next = ledger;
  let cancelled = 0;
  for (const action of ledger.actions) {
    if (action.ruleId === ruleId && action.status === "queued") {
      next = cancelAction(next, action.id, cancelledBy, cancelledAt).ledger;
      cancelled += 1;
    }
  }
  return { ledger: next, cancelled };
}

/** Record that a queued action became a real Agent Run. */
export function markStarted(
  ledger: ScheduleLedger,
  actionId: string,
  startedAt: string,
  agentRunId: string,
): ScheduleLedger {
  const action = findAction(ledger, actionId);
  if (!action) throw new ScheduleError(`No scheduled action with id "${actionId}".`);
  if (action.status !== "queued") {
    throw new ScheduleError(`That action is ${action.status} and cannot start.`);
  }
  const started: ScheduledAction = { ...action, status: "started", startedAt, agentRunId };
  return {
    actions: ledger.actions.map((existing) => (existing.id === actionId ? started : existing)),
  };
}

// ── Explaining ───────────────────────────────────────────────────────────────

/**
 * Why this action is scheduled for when it is, in one sentence.
 *
 * Every branch returns something concrete. There is no "scheduled" fallback,
 * because a row the surface cannot explain is a row that should not have been
 * queued.
 */
export function explainSchedule(action: ScheduledAction, now?: string): string {
  if (action.status === "cancelled") {
    return `Cancelled by ${action.cancelledBy ?? "an unrecorded person"} on ${action.cancelledAt}.`;
  }
  if (action.status === "started") {
    return `Started on ${action.startedAt} as Agent Run ${action.agentRunId}.`;
  }
  const wait = now ? ` ${relativeWait(action.scheduledFor, now)}` : "";
  return `${action.reason.explanation}${wait}`;
}

function relativeWait(scheduledFor: string, now: string): string {
  const deltaMs = instant(scheduledFor) - instant(now);
  if (deltaMs <= 0) return "Due now.";
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 60) return `Due in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `Due in ${hours} hour${hours === 1 ? "" : "s"}.`;
  return `Due in ${Math.round(hours / 24)} days.`;
}
