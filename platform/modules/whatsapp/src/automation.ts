/**
 * Automation rules — "when this happens in this thread, start an Agent Run".
 *
 * Bridge canon is precise about what an Automation is, and this module holds to
 * it literally: **an Automation starts an Agent Run.** It does not send. It
 * does not call a Skill. It names a subject and a trigger, and when the trigger
 * matches it produces a request for the Agent that the owner assigned to that
 * subject (`assignment.ts`) to be run. Whatever that Agent then wants to send
 * goes through the one outbound gate in `outbound.ts` like everything else.
 *
 * ## Why a rule cannot get around the consent gate
 *
 * The consent gate — automation may only write into a thread where the
 * recipient wrote first, never a first contact — is the reason this Module is
 * allowed to send at all. A rules engine is exactly the kind of feature that
 * quietly grows a way around it, so the defences here are structural rather
 * than a matter of remembering to check:
 *
 *  1. **A rule has no send.** `AutomationRule` has no body, no recipient, and
 *     no transport. The richest thing it can produce is `start_agent_run`.
 *  2. **`planAutomationRun` refuses on the same fact `evaluateSendPolicy` does.**
 *     A thread with no inbound message blocks the Run before it starts, so the
 *     Agent is not even woken for a first contact.
 *  3. **A rule may only TIGHTEN the discipline.** `limitOverrides` is passed
 *     through `tightenLimits`, which takes the stricter of each field. A rule
 *     asking for a daily cap of 5,000 gets 30. A rule asking for
 *     `requireRecipientInitiated: false` gets whatever the shipped limits say,
 *     which is the only direction that setting is allowed to move.
 *  4. **The gate runs anyway.** Even if all of the above were bypassed, the
 *     send path is `performAutomatedSend` → `evaluateSendPolicy` → `decideSend`
 *     → the Rust ceiling. There is no second write path, and this file
 *     deliberately imports nothing that could send.
 *
 * `automation.test.ts` asserts 2 and 3 directly, and asserts 4 by routing a
 * planned Run's proposed message through the real gate against a thread nobody
 * wrote in.
 *
 * Everything here is pure: `now`, ids and the ledger are supplied.
 */

import {
  activeAssignment,
  sameSubject,
  type AgentAssignment,
  type AssignmentLedger,
  type AssignmentSubject,
} from "./assignment.js";
import {
  SEND_POLICY_LIMITS,
  type SendPolicyLimits,
  type ThreadActivity,
} from "./policy.js";

// ── Triggers ─────────────────────────────────────────────────────────────────

/**
 * What can wake a rule.
 *
 * Both triggers are REACTIVE — they describe something the counterparty or the
 * clock did in an existing thread. There is deliberately no "on a list of
 * contacts" or "on import" trigger: a trigger that fans out over an address
 * book is a campaign, and a campaign is the thing the consent gate exists to
 * prevent.
 */
export type AutomationTriggerKind = "inbound_message" | "thread_quiet";

export interface AutomationTrigger {
  kind: AutomationTriggerKind;
  /**
   * `inbound_message` only: fire when the incoming text contains this, matched
   * case-insensitively. Absent means any inbound message.
   */
  bodyContains?: string;
  /**
   * `thread_quiet` only: fire when nothing has been said either way for this
   * many days. Required for that kind, and must be at least 1 — a zero-day
   * quiet period fires continuously.
   */
  quietDays?: number;
}

// ── Rules ────────────────────────────────────────────────────────────────────

export interface AutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  /** The one chat or Person this rule watches. Never a list, never "all". */
  subject: AssignmentSubject;
  trigger: AutomationTrigger;
  /**
   * What the Agent Run is asked to achieve, in the owner's words. This is a
   * goal handed to an Agent, not a message template — the rule never writes the
   * text that would be sent.
   */
  goal: string;
  /** Optional Skill the Agent should reach for. Must be one the Agent owns. */
  skillId?: string;
  /** Only ever tightening. See `tightenLimits`. */
  limitOverrides?: Partial<SendPolicyLimits>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Set while disabled, so "off since when, and why" is answerable. */
  disabledAt?: string;
  disabledBy?: string;
  disabledReason?: string;
}

export interface AutomationRuleLedger {
  rules: readonly AutomationRule[];
}

export const EMPTY_RULE_LEDGER: AutomationRuleLedger = { rules: [] };

export class AutomationRuleError extends Error {}

// ── Limits may only tighten ──────────────────────────────────────────────────

/**
 * Combine the shipped discipline with a rule's requested overrides, taking the
 * STRICTER value of each field.
 *
 * Which direction is stricter is not uniform, so each field is spelled out
 * rather than handled by a generic min/max:
 *
 *  - `dailyCap`, `similarBodyRecipientLimit`, `warmUpFirstDayCap`,
 *    `warmUpDailyIncrement` — fewer sends is stricter, so `min`.
 *  - `similarityThreshold` — a LOWER threshold makes more bodies count as
 *    near-identical, so `min` is stricter here too.
 *  - `recipientCooldownDays`, `similarBodyWindowDays` — a longer window catches
 *    more, so `max`.
 *  - `businessHourStart` — a later start narrows the window, so `max`.
 *  - `businessHourEnd` — an earlier end narrows it, so `min`.
 *  - `minJitterSeconds`, `maxJitterSeconds` — longer pacing delays are slower
 *    and therefore stricter, so `max`. (Pacing, not concealment: the delay
 *    exists so automated sending is genuinely human-paced.)
 *  - `requireRecipientInitiated` — `true` is stricter, so logical OR.
 *
 * The result is that no rule, however it is authored or however its stored JSON
 * is tampered with, can widen the discipline. That is the property the test
 * `a_rule_cannot_widen_the_send_discipline` pins.
 */
export function tightenLimits(
  base: SendPolicyLimits,
  requested: Partial<SendPolicyLimits> | undefined,
): SendPolicyLimits {
  if (!requested) return { ...base };
  const num = (
    key: keyof SendPolicyLimits,
    pick: (a: number, b: number) => number,
  ): number => {
    const asked = requested[key];
    const current = base[key] as number;
    return typeof asked === "number" && Number.isFinite(asked)
      ? pick(current, asked)
      : current;
  };
  return {
    dailyCap: num("dailyCap", Math.min),
    recipientCooldownDays: num("recipientCooldownDays", Math.max),
    similarityThreshold: num("similarityThreshold", Math.min),
    similarBodyRecipientLimit: num("similarBodyRecipientLimit", Math.min),
    similarBodyWindowDays: num("similarBodyWindowDays", Math.max),
    warmUpFirstDayCap: num("warmUpFirstDayCap", Math.min),
    warmUpDailyIncrement: num("warmUpDailyIncrement", Math.min),
    businessHourStart: num("businessHourStart", Math.max),
    businessHourEnd: num("businessHourEnd", Math.min),
    minJitterSeconds: num("minJitterSeconds", Math.max),
    maxJitterSeconds: num("maxJitterSeconds", Math.max),
    requireRecipientInitiated:
      base.requireRecipientInitiated || requested.requireRecipientInitiated === true,
  };
}

/** The limits a rule actually runs under. Never wider than the shipped ones. */
export function limitsForRule(rule: AutomationRule): SendPolicyLimits {
  return tightenLimits(SEND_POLICY_LIMITS, rule.limitOverrides);
}

// ── Authoring ────────────────────────────────────────────────────────────────

export interface DraftRuleInput {
  id: string;
  name: string;
  subject: AssignmentSubject;
  trigger: AutomationTrigger;
  goal: string;
  skillId?: string;
  limitOverrides?: Partial<SendPolicyLimits>;
  createdBy: string;
  now: string;
  /** Start enabled? Defaults to true; the panel offers "save disabled". */
  enabled?: boolean;
}

/**
 * Validate and build a rule. Throws `AutomationRuleError` with a sentence a
 * person can act on — these surface directly in the panel.
 */
export function draftAutomationRule(input: DraftRuleInput): AutomationRule {
  const name = input.name.trim();
  if (!name) throw new AutomationRuleError("Give the rule a name.");
  const goal = input.goal.trim();
  if (!goal) {
    throw new AutomationRuleError(
      "Say what the Agent Run should achieve — a rule starts an Agent Run, so it needs a goal.",
    );
  }
  const createdBy = input.createdBy.trim();
  if (!createdBy) {
    throw new AutomationRuleError("A rule records the person who created it.");
  }
  if (!input.subject.key.trim()) {
    throw new AutomationRuleError("Choose the chat or Person this rule watches.");
  }

  const trigger = normalizeTrigger(input.trigger);
  const skillId = input.skillId?.trim();

  return {
    id: input.id,
    name,
    enabled: input.enabled !== false,
    subject: { kind: input.subject.kind, key: input.subject.key },
    trigger,
    goal,
    ...(skillId ? { skillId } : {}),
    ...(input.limitOverrides ? { limitOverrides: input.limitOverrides } : {}),
    createdBy,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

function normalizeTrigger(trigger: AutomationTrigger): AutomationTrigger {
  if (trigger.kind === "inbound_message") {
    const contains = trigger.bodyContains?.trim();
    return { kind: "inbound_message", ...(contains ? { bodyContains: contains } : {}) };
  }
  if (trigger.kind === "thread_quiet") {
    const days = trigger.quietDays;
    if (typeof days !== "number" || !Number.isFinite(days) || days < 1) {
      throw new AutomationRuleError(
        "A quiet-thread rule needs a quiet period of at least one day.",
      );
    }
    return { kind: "thread_quiet", quietDays: Math.floor(days) };
  }
  throw new AutomationRuleError(
    `"${String((trigger as { kind?: unknown }).kind)}" is not a trigger this Module knows.`,
  );
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

export function addRule(
  ledger: AutomationRuleLedger,
  rule: AutomationRule,
): AutomationRuleLedger {
  if (ledger.rules.some((existing) => existing.id === rule.id)) {
    throw new AutomationRuleError(`A rule with id "${rule.id}" already exists.`);
  }
  return { rules: [rule, ...ledger.rules] };
}

export function findRule(
  ledger: AutomationRuleLedger,
  ruleId: string,
): AutomationRule | undefined {
  return ledger.rules.find((rule) => rule.id === ruleId);
}

/**
 * Turn a rule on or off.
 *
 * Disabling records who and why. Enabling clears those stamps — a rule that is
 * on has no "disabled since", and leaving a stale one behind would make the
 * list read as if it were still off.
 */
export function setRuleEnabled(
  ledger: AutomationRuleLedger,
  ruleId: string,
  enabled: boolean,
  by: string,
  at: string,
  reason?: string,
): AutomationRuleLedger {
  const rule = findRule(ledger, ruleId);
  if (!rule) throw new AutomationRuleError(`No rule with id "${ruleId}".`);
  const human = by.trim();
  if (!human) {
    throw new AutomationRuleError("Enabling or disabling a rule records who did it.");
  }

  const next: AutomationRule = enabled
    ? (() => {
        const { disabledAt: _at, disabledBy: _by, disabledReason: _reason, ...rest } = rule;
        return { ...rest, enabled: true, updatedAt: at };
      })()
    : {
        ...rule,
        enabled: false,
        updatedAt: at,
        disabledAt: at,
        disabledBy: human,
        ...(reason?.trim() ? { disabledReason: reason.trim() } : {}),
      };

  return { rules: ledger.rules.map((existing) => (existing.id === ruleId ? next : existing)) };
}

/**
 * Delete a rule outright.
 *
 * Unlike an assignment, a rule IS removed rather than stamped. A rule is a
 * standing instruction, not a record of something that happened, and keeping
 * dead instructions in the list is how a surface ends up showing an automation
 * the owner believes they deleted. What the rule actually DID survives in the
 * schedule ledger and in the Agent Runs it started.
 */
export function deleteRule(
  ledger: AutomationRuleLedger,
  ruleId: string,
): AutomationRuleLedger {
  if (!findRule(ledger, ruleId)) {
    throw new AutomationRuleError(`No rule with id "${ruleId}".`);
  }
  return { rules: ledger.rules.filter((rule) => rule.id !== ruleId) };
}

/** Rules watching one subject, enabled first. */
export function rulesForSubject(
  ledger: AutomationRuleLedger,
  subject: AssignmentSubject,
): readonly AutomationRule[] {
  return ledger.rules.filter((rule) => sameSubject(rule.subject, subject));
}

// ── Evaluation ───────────────────────────────────────────────────────────────

export interface AutomationContext {
  /** ISO-8601. This module has no clock. */
  now: string;
  /** Who is answerable for this subject. */
  assignments: AssignmentLedger;
  /** The consent facts from the Local Plane message store. */
  thread: ThreadActivity;
  /**
   * Body of the message that woke this evaluation, for `inbound_message`.
   * Absent for a `thread_quiet` sweep.
   */
  inboundBody?: string;
}

export type AutomationBlockReason =
  | "disabled"
  | "no_agent_assigned"
  | "consent_gate";

export type AutomationPlan =
  /**
   * Start an Agent Run. This is the MOST a rule can produce — note there is no
   * body and no recipient on it. Composing a message, if the goal calls for
   * one, is the Agent's work, and sending it is `performAutomatedSend`'s.
   */
  | {
      status: "start_agent_run";
      ruleId: string;
      agentId: string;
      assignment: AgentAssignment;
      subject: AssignmentSubject;
      goal: string;
      skillId?: string;
      /** Already tightened. Hand these to `evaluateSendPolicy` as `limits`. */
      limits: SendPolicyLimits;
      /** Why this rule matched, for the schedule entry and the audit trail. */
      because: string;
    }
  /** The trigger did not match. Not an error, and not worth surfacing. */
  | { status: "not_due"; ruleId: string; reason: string }
  /** The rule matched but must not act. Surfaced, because it is worth knowing. */
  | { status: "blocked"; ruleId: string; reason: AutomationBlockReason; explanation: string };

const MS_PER_DAY = 86_400_000;

function instant(iso: string): number {
  const value = Date.parse(iso);
  if (Number.isNaN(value)) throw new AutomationRuleError(`"${iso}" is not an ISO-8601 instant`);
  return value;
}

/**
 * Decide what one rule should do right now.
 *
 * Order is deliberate and mirrors `evaluateSendPolicy`: the things that BLOCK
 * are checked before the trigger is even considered, so a rule pointed at a
 * thread nobody has written in reports "this recipient has never written here"
 * rather than "not due" — the owner should learn that their rule can never
 * fire, not that it happens to be quiet today.
 */
export function planAutomationRun(
  rule: AutomationRule,
  context: AutomationContext,
): AutomationPlan {
  if (!rule.enabled) {
    return {
      status: "blocked",
      ruleId: rule.id,
      reason: "disabled",
      explanation: rule.disabledReason
        ? `This rule is switched off (${rule.disabledReason}).`
        : "This rule is switched off.",
    };
  }

  // The consent gate, checked here as well as at send time. A rule must not
  // even wake an Agent for a thread the recipient has never written in: an
  // Agent Run that can only end in a refusal is wasted attention, and the one
  // way a bypass gets built is by having somewhere for it to be built.
  if (context.thread.inboundCount <= 0 || !context.thread.firstInboundAt) {
    return {
      status: "blocked",
      ruleId: rule.id,
      reason: "consent_gate",
      explanation:
        "This recipient has never written in this thread, so no automation may act on it. " +
        "Automation never opens a conversation.",
    };
  }

  // Attribution: only an Agent the owner named for this subject may be run.
  const assignment = activeAssignment(context.assignments, rule.subject);
  if (!assignment) {
    return {
      status: "blocked",
      ruleId: rule.id,
      reason: "no_agent_assigned",
      explanation:
        "No Agent is assigned to this chat, and an Automation starts an Agent Run — assign one first.",
    };
  }

  const match = triggerMatches(rule.trigger, context);
  if (!match.matched) {
    return { status: "not_due", ruleId: rule.id, reason: match.reason };
  }

  return {
    status: "start_agent_run",
    ruleId: rule.id,
    agentId: assignment.agentId,
    assignment,
    subject: rule.subject,
    goal: rule.goal,
    ...(rule.skillId ? { skillId: rule.skillId } : {}),
    limits: limitsForRule(rule),
    because: match.reason,
  };
}

function triggerMatches(
  trigger: AutomationTrigger,
  context: AutomationContext,
): { matched: boolean; reason: string } {
  if (trigger.kind === "inbound_message") {
    const body = context.inboundBody;
    if (body === undefined) {
      return { matched: false, reason: "No incoming message to react to." };
    }
    if (!trigger.bodyContains) {
      return { matched: true, reason: "They sent a message." };
    }
    const needle = trigger.bodyContains.toLowerCase();
    return body.toLowerCase().includes(needle)
      ? { matched: true, reason: `Their message mentions “${trigger.bodyContains}”.` }
      : { matched: false, reason: `Their message does not mention “${trigger.bodyContains}”.` };
  }

  const quietDays = trigger.quietDays ?? 0;
  const lastActivity = [context.thread.lastInboundAt, context.thread.lastOutboundAt]
    .filter((value): value is string => typeof value === "string")
    .map(instant)
    .reduce((a, b) => Math.max(a, b), Number.NEGATIVE_INFINITY);
  if (lastActivity === Number.NEGATIVE_INFINITY) {
    // Unreachable in practice — the consent gate above already required an
    // inbound message — but a silent `true` here would be a fire-on-no-data
    // path, which is the wrong default for anything that starts a Run.
    return { matched: false, reason: "This thread has no recorded activity to measure quiet from." };
  }
  const quietFor = instant(context.now) - lastActivity;
  const days = Math.floor(quietFor / MS_PER_DAY);
  return quietFor >= quietDays * MS_PER_DAY
    ? { matched: true, reason: `Nothing has been said for ${days} days.` }
    : {
        matched: false,
        reason: `Only ${days} of the ${quietDays} quiet days have passed.`,
      };
}

/** One sentence describing what a rule does, for the list. Never invented. */
export function describeRule(rule: AutomationRule): string {
  const target = rule.subject.kind === "chat" ? "this chat" : "this Person";
  const when =
    rule.trigger.kind === "inbound_message"
      ? rule.trigger.bodyContains
        ? `when they message ${target} mentioning “${rule.trigger.bodyContains}”`
        : `when they message ${target}`
      : `when ${target} has been quiet for ${rule.trigger.quietDays} days`;
  return `${when}, start an Agent Run to: ${rule.goal}`;
}
