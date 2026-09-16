/**
 * The persisted shape of the three automation ledgers, and a tolerant reader
 * for it.
 *
 * All three live in ONE Local Plane state namespace and are read and written
 * together. That is not a convenience: deleting a rule must also cancel the
 * actions it queued, and starting a scheduled action must be able to check that
 * the Agent is still assigned. Splitting them across namespaces would make each
 * of those two writes that can half-fail.
 *
 * Residency: `whatsapp:automation` is a `LocalStateStore` namespace, which is
 * Local Plane by construction. Rules name chats and Person keys, assignments
 * name humans, and scheduled actions name goals — all private facts about the
 * owner's own address book. None of it has a cloud canonical destination and
 * there is no promote path, exactly as with message bodies (ADR-158, AP-091).
 *
 * The reader mirrors `readSyncState`'s posture: anything unrecognised yields
 * EMPTY ledgers rather than a partially-trusted structure. The cost of that is
 * that the owner's rules appear to be gone and they re-author them, which is
 * visible and recoverable. The cost of partial trust is an automation running
 * under half-parsed limits, which is neither.
 */

import type { AgentAssignment, AssignmentLedger, AssignmentSubject } from "./assignment.js";
import type { AutomationRule, AutomationRuleLedger, AutomationTrigger } from "./automation.js";
import type { ScheduleLedger, ScheduledAction, ScheduleReason } from "./schedule.js";

/** The Local Plane state namespace these ledgers live in. */
export const WHATSAPP_AUTOMATION_NAMESPACE = "whatsapp:automation";

export interface WhatsAppAutomationState {
  version: 1;
  rules: readonly AutomationRule[];
  assignments: readonly AgentAssignment[];
  scheduled: readonly ScheduledAction[];
}

export function emptyAutomationState(): WhatsAppAutomationState {
  return { version: 1, rules: [], assignments: [], scheduled: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function subject(value: unknown): AssignmentSubject | undefined {
  if (!isRecord(value)) return undefined;
  const kind = value["kind"];
  const key = str(value["key"]);
  if ((kind !== "chat" && kind !== "person") || !key) return undefined;
  return { kind, key };
}

function trigger(value: unknown): AutomationTrigger | undefined {
  if (!isRecord(value)) return undefined;
  if (value["kind"] === "inbound_message") {
    const contains = str(value["bodyContains"]);
    return { kind: "inbound_message", ...(contains ? { bodyContains: contains } : {}) };
  }
  if (value["kind"] === "thread_quiet") {
    const days = value["quietDays"];
    if (typeof days !== "number" || !Number.isFinite(days) || days < 1) return undefined;
    return { kind: "thread_quiet", quietDays: Math.floor(days) };
  }
  return undefined;
}

/**
 * Limit overrides survive a reload only as plain finite numbers and booleans.
 *
 * Nothing is range-checked here on purpose: `tightenLimits` takes the stricter
 * of each field against the shipped limits, so a tampered value can only ever
 * make the discipline harsher. Validating twice would imply the reader is the
 * thing keeping the cap honest, and it is not — `tightenLimits` and the Rust
 * ceiling are.
 */
function limitOverrides(value: unknown): AutomationRule["limitOverrides"] {
  if (!isRecord(value)) return undefined;
  const out: Record<string, number | boolean> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "number" && Number.isFinite(entry)) out[key] = entry;
    else if (typeof entry === "boolean") out[key] = entry;
  }
  return Object.keys(out).length > 0
    ? (out as AutomationRule["limitOverrides"])
    : undefined;
}

function rule(value: unknown): AutomationRule | undefined {
  if (!isRecord(value)) return undefined;
  const id = str(value["id"]);
  const name = str(value["name"]);
  const goal = str(value["goal"]);
  const createdBy = str(value["createdBy"]);
  const createdAt = str(value["createdAt"]);
  const target = subject(value["subject"]);
  const fired = trigger(value["trigger"]);
  if (!id || !name || !goal || !createdBy || !createdAt || !target || !fired) return undefined;

  const skillId = str(value["skillId"]);
  const overrides = limitOverrides(value["limitOverrides"]);
  const disabledAt = str(value["disabledAt"]);
  const disabledBy = str(value["disabledBy"]);
  const disabledReason = str(value["disabledReason"]);
  return {
    id,
    name,
    // A missing/garbled flag reads as OFF. A rule that resurrects itself as
    // enabled after a bad write is the wrong failure direction for anything
    // that starts Agent Runs.
    enabled: value["enabled"] === true,
    subject: target,
    trigger: fired,
    goal,
    ...(skillId ? { skillId } : {}),
    ...(overrides ? { limitOverrides: overrides } : {}),
    createdBy,
    createdAt,
    updatedAt: str(value["updatedAt"]) ?? createdAt,
    ...(disabledAt ? { disabledAt } : {}),
    ...(disabledBy ? { disabledBy } : {}),
    ...(disabledReason ? { disabledReason } : {}),
  };
}

function assignment(value: unknown): AgentAssignment | undefined {
  if (!isRecord(value)) return undefined;
  const id = str(value["id"]);
  const agentId = str(value["agentId"]);
  const assignedBy = str(value["assignedBy"]);
  const assignedAt = str(value["assignedAt"]);
  const target = subject(value["subject"]);
  if (!id || !agentId || !assignedBy || !assignedAt || !target) return undefined;
  const note = str(value["note"]);
  const unassignedAt = str(value["unassignedAt"]);
  const unassignedBy = str(value["unassignedBy"]);
  const supersededBy = str(value["supersededBy"]);
  return {
    id,
    subject: target,
    agentId,
    assignedBy,
    assignedAt,
    ...(note ? { note } : {}),
    ...(unassignedAt ? { unassignedAt } : {}),
    ...(unassignedBy ? { unassignedBy } : {}),
    ...(supersededBy ? { supersededBy } : {}),
  };
}

function reason(value: unknown): ScheduleReason | undefined {
  if (!isRecord(value)) return undefined;
  const code = value["code"];
  const explanation = str(value["explanation"]);
  if (
    (code !== "trigger_delay" && code !== "policy_deferral" && code !== "pacing") ||
    !explanation
  ) {
    return undefined;
  }
  const policyRule = str(value["policyRule"]);
  return {
    code,
    explanation,
    ...(policyRule ? { policyRule: policyRule as NonNullable<ScheduleReason["policyRule"]> } : {}),
  };
}

function scheduled(value: unknown): ScheduledAction | undefined {
  if (!isRecord(value)) return undefined;
  const id = str(value["id"]);
  const agentId = str(value["agentId"]);
  const goal = str(value["goal"]);
  const queuedAt = str(value["queuedAt"]);
  const scheduledFor = str(value["scheduledFor"]);
  const target = subject(value["subject"]);
  const why = reason(value["reason"]);
  const status = value["status"];
  if (!id || !agentId || !goal || !queuedAt || !scheduledFor || !target || !why) return undefined;
  if (status !== "queued" && status !== "cancelled" && status !== "started") return undefined;

  const ruleId = str(value["ruleId"]);
  const skillId = str(value["skillId"]);
  const cancelledAt = str(value["cancelledAt"]);
  const cancelledBy = str(value["cancelledBy"]);
  const startedAt = str(value["startedAt"]);
  const agentRunId = str(value["agentRunId"]);
  return {
    id,
    ...(ruleId ? { ruleId } : {}),
    agentId,
    subject: target,
    goal,
    ...(skillId ? { skillId } : {}),
    queuedAt,
    scheduledFor,
    reason: why,
    status,
    ...(cancelledAt ? { cancelledAt } : {}),
    ...(cancelledBy ? { cancelledBy } : {}),
    ...(startedAt ? { startedAt } : {}),
    ...(agentRunId ? { agentRunId } : {}),
  };
}

function readArray<T>(value: unknown, parse: (entry: unknown) => T | undefined): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const entry of value) {
    // An unparseable row is dropped, not defaulted. A rule or scheduled action
    // reconstructed from guesses would run under terms nobody authored.
    const parsed = parse(entry);
    if (parsed) out.push(parsed);
  }
  return out;
}

/** Accept an unknown persisted value as automation state, or start fresh. */
export function readAutomationState(value: unknown): WhatsAppAutomationState {
  if (!isRecord(value) || value["version"] !== 1) return emptyAutomationState();
  return {
    version: 1,
    rules: readArray(value["rules"], rule),
    assignments: readArray(value["assignments"], assignment),
    scheduled: readArray(value["scheduled"], scheduled),
  };
}

// ── Ledger views ─────────────────────────────────────────────────────────────
//
// The ledger types are what `automation.ts`, `assignment.ts` and `schedule.ts`
// operate on. These are free conversions in both directions; they exist so the
// persisted envelope and the operating types stay separable.

export function ruleLedgerOf(state: WhatsAppAutomationState): AutomationRuleLedger {
  return { rules: state.rules };
}

export function assignmentLedgerOf(state: WhatsAppAutomationState): AssignmentLedger {
  return { assignments: state.assignments };
}

export function scheduleLedgerOf(state: WhatsAppAutomationState): ScheduleLedger {
  return { actions: state.scheduled };
}

export function withLedgers(
  state: WhatsAppAutomationState,
  next: {
    rules?: AutomationRuleLedger;
    assignments?: AssignmentLedger;
    schedule?: ScheduleLedger;
  },
): WhatsAppAutomationState {
  return {
    version: 1,
    rules: next.rules?.rules ?? state.rules,
    assignments: next.assignments?.assignments ?? state.assignments,
    scheduled: next.schedule?.actions ?? state.scheduled,
  };
}
