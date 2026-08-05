/**
 * Automation triggers — the model behind "Scheduled Automation" (glossary),
 * which until now was vocabulary with no runtime (ADR-179).
 *
 * What existed before: `AutomationDefinition` had no trigger field at all; the
 * `automations` table carried `trigger jsonb NOT NULL` and `cadence text` that
 * NOTHING ever read or wrote; the module manifest's `trigger` was a free-text
 * English string rendered in the UI ("Upcoming meeting Event") and ignored by
 * every runtime path; and the sole non-human runner in the platform was one
 * `setInterval(..., 15 * 60_000)` hardcoded to a single automation id. A
 * manifest could say "Scheduled" and nothing scheduled it.
 *
 * This module is deliberately the PURE half. It decides *which Automations are
 * due at an instant you hand it* and nothing else — no timers, no I/O, no
 * `Date.now()` (determinism.ts: "Engine code NEVER calls Date.now() directly").
 * The host that owns a real clock lives at the API edge, so the interesting
 * behaviour here is testable without waiting for wall time.
 */

/**
 * How an Automation is started.
 *
 * `event` is declared-but-not-dispatched: there is no event bus hook that
 * starts Automations yet. It is modelled anyway, and
 * {@link undispatchedTriggers} exists so that gap is REPORTABLE rather than
 * silent. An Automation that can never fire must say so out loud — a surface
 * that quietly does nothing is the failure this repo keeps re-learning.
 */
export type AutomationTrigger =
  | { kind: "manual" }
  | { kind: "schedule"; everyMinutes: number }
  | { kind: "event"; event: string };

/** The scheduling state the host tracks per Automation. */
export interface AutomationScheduleState {
  automationId: string;
  organizationId: string;
  trigger: AutomationTrigger;
  /** ISO timestamp of the last start, or undefined if it has never run. */
  lastStartedAt?: string | undefined;
}

export interface DueAutomation {
  automationId: string;
  organizationId: string;
  /** Whole minutes since the last start; undefined for a never-run Automation. */
  minutesSinceLastStart: number | undefined;
}

/** Upper bound on a schedule interval: one week. A larger number is almost
 * always a units mistake (seconds or milliseconds passed as minutes), and a
 * trigger that silently never fires is worse than one that fails to parse. */
export const MAX_SCHEDULE_MINUTES = 7 * 24 * 60;

export class AutomationTriggerError extends Error {
  constructor(reason: string) {
    super(`automation trigger invalid: ${reason}`);
    this.name = "AutomationTriggerError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse a stored/declared trigger. Throws rather than defaulting, because the
 * two silent-failure shapes are both worse than a loud one: defaulting an
 * unreadable trigger to `manual` means a Scheduled Automation stops firing with
 * no signal, and defaulting it to a schedule means an unreviewed Automation
 * starts firing on its own.
 *
 * The one exception is an EMPTY object, which is what `DrizzleAutomationRegistry`
 * wrote into every existing row (`trigger: {}`) before this existed. That is
 * read as `manual` — the honest description of how those rows have always
 * behaved — rather than treated as corrupt.
 */
export function parseAutomationTrigger(raw: unknown): AutomationTrigger {
  if (raw === undefined || raw === null) return { kind: "manual" };
  if (!isPlainObject(raw)) throw new AutomationTriggerError("must be an object");
  // Pre-ADR-179 rows: `trigger: {}`. Manual is what they actually did.
  if (Object.keys(raw).length === 0) return { kind: "manual" };

  const kind = raw.kind;
  if (kind === "manual") return { kind: "manual" };

  if (kind === "schedule") {
    const everyMinutes = raw.everyMinutes;
    if (typeof everyMinutes !== "number" || !Number.isInteger(everyMinutes)) {
      throw new AutomationTriggerError("schedule.everyMinutes must be an integer");
    }
    if (everyMinutes < 1) {
      throw new AutomationTriggerError("schedule.everyMinutes must be at least 1");
    }
    if (everyMinutes > MAX_SCHEDULE_MINUTES) {
      throw new AutomationTriggerError(
        `schedule.everyMinutes must be at most ${MAX_SCHEDULE_MINUTES} (a larger value is usually a units mistake)`,
      );
    }
    return { kind: "schedule", everyMinutes };
  }

  if (kind === "event") {
    const event = raw.event;
    if (typeof event !== "string" || event.length === 0) {
      throw new AutomationTriggerError("event.event must be a non-empty string");
    }
    return { kind: "event", event };
  }

  throw new AutomationTriggerError(
    `kind must be manual, schedule, or event (got ${JSON.stringify(kind)})`,
  );
}

/** Human-readable projection stored in the `automations.cadence` column. The
 * jsonb `trigger` stays the source of truth; this exists so a person reading
 * the table, or a support query, can see the cadence without parsing JSON. */
export function cadenceLabel(trigger: AutomationTrigger): string | null {
  if (trigger.kind !== "schedule") return null;
  const { everyMinutes } = trigger;
  if (everyMinutes % (24 * 60) === 0) return `P${everyMinutes / (24 * 60)}D`;
  if (everyMinutes % 60 === 0) return `PT${everyMinutes / 60}H`;
  return `PT${everyMinutes}M`;
}

function minutesBetween(fromIso: string, now: Date): number | undefined {
  const from = Date.parse(fromIso);
  if (Number.isNaN(from)) return undefined;
  return Math.floor((now.getTime() - from) / 60_000);
}

/**
 * Which Automations are due at `now`.
 *
 * Three properties are load-bearing and each has a test:
 *
 *  1. **No catch-up storm.** An Automation overdue by six hours fires ONCE, not
 *     twenty-four times. Missed occurrences are not a queue to drain — draining
 *     it would turn a restart after downtime into a burst of governed Runs
 *     against a system that has no idea they are duplicates.
 *  2. **A never-run schedule is due immediately.** Waiting a full interval after
 *     install makes a fresh Organization look broken for 15 minutes. Boot
 *     latency is the HOST's problem (it delays the first tick), not a reason to
 *     model first-run as not-due.
 *  3. **Only `schedule` is ever clock-due.** `manual` and `event` are never
 *     returned, however long they sit. An `event` Automation cannot fire at all
 *     today; see {@link undispatchedTriggers}.
 *
 * An unparseable `lastStartedAt` is treated as never-run rather than skipped —
 * a corrupt timestamp must not be able to silence a schedule permanently.
 */
export function dueAutomations(
  states: readonly AutomationScheduleState[],
  now: Date,
): DueAutomation[] {
  const due: DueAutomation[] = [];
  for (const state of states) {
    if (state.trigger.kind !== "schedule") continue;
    const elapsed = state.lastStartedAt === undefined
      ? undefined
      : minutesBetween(state.lastStartedAt, now);
    if (elapsed !== undefined && elapsed < state.trigger.everyMinutes) continue;
    due.push({
      automationId: state.automationId,
      organizationId: state.organizationId,
      minutesSinceLastStart: elapsed,
    });
  }
  return due;
}

/**
 * Automations whose declared trigger CANNOT fire with the machinery that
 * exists. Today that is every `event` trigger: no event-bus subscription starts
 * an Automation Run.
 *
 * This function is the point of modelling `event` at all. Without it the
 * declaration would be indistinguishable from a working trigger right up until
 * someone noticed their Automation had never once run — the exact shape of the
 * bugs this codebase keeps recording. The host logs this at boot so the gap is
 * stated by the running system rather than by a doc nobody reads.
 */
export function undispatchedTriggers(
  states: readonly AutomationScheduleState[],
): { automationId: string; organizationId: string; reason: string }[] {
  return states
    .filter((state) => state.trigger.kind === "event")
    .map((state) => ({
      automationId: state.automationId,
      organizationId: state.organizationId,
      reason:
        `declares event trigger "${(state.trigger as { kind: "event"; event: string }).event}" — ` +
        `no event dispatch starts Automations yet, so this Automation will not run on its own`,
    }));
}
