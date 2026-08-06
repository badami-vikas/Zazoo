/**
 * Automation triggers and the pure due-calculation (ADR-179).
 *
 * "Scheduled Automation" was glossary vocabulary with no runtime for months.
 * These tests pin the behaviours that make a scheduler safe to leave running
 * unattended — not that it fires, which is easy, but that it does not fire when
 * it shouldn't, and that a trigger which cannot work says so.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AutomationTriggerError,
  MAX_SCHEDULE_MINUTES,
  cadenceLabel,
  dueAutomations,
  parseAutomationTrigger,
  undispatchedTriggers,
  type AutomationScheduleState,
} from "../src/index.js";

const NOW = new Date("2026-08-05T12:00:00.000Z");

function state(over: Partial<AutomationScheduleState> = {}): AutomationScheduleState {
  return {
    automationId: "a1",
    organizationId: "org1",
    trigger: { kind: "schedule", everyMinutes: 15 },
    ...over,
  };
}

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

test("parseAutomationTrigger: reads every valid shape in both directions", () => {
  assert.deepEqual(parseAutomationTrigger({ kind: "manual" }), { kind: "manual" });
  assert.deepEqual(parseAutomationTrigger({ kind: "schedule", everyMinutes: 15 }), {
    kind: "schedule",
    everyMinutes: 15,
  });
  assert.deepEqual(parseAutomationTrigger({ kind: "event", event: "signal.created" }), {
    kind: "event",
    event: "signal.created",
  });
});

test("parseAutomationTrigger: a pre-ADR-179 row reads as manual, not corrupt", () => {
  // `DrizzleAutomationRegistry.save` hardcoded `trigger: {}` on every row it
  // ever wrote. Manual is the honest description of how those rows behaved —
  // treating them as invalid would fail the load path for existing data.
  assert.deepEqual(parseAutomationTrigger({}), { kind: "manual" });
  assert.deepEqual(parseAutomationTrigger(undefined), { kind: "manual" });
  assert.deepEqual(parseAutomationTrigger(null), { kind: "manual" });
});

test("parseAutomationTrigger: throws rather than defaulting on a malformed trigger", () => {
  // Both silent defaults are worse than a loud failure: defaulting to manual
  // makes a Scheduled Automation stop firing with no signal; defaulting to a
  // schedule makes an unreviewed Automation start firing on its own.
  for (const bad of [
    { kind: "cron", expr: "*/5 * * * *" },
    { kind: "schedule" },
    { kind: "schedule", everyMinutes: "15" },
    { kind: "schedule", everyMinutes: 0 },
    { kind: "schedule", everyMinutes: 2.5 },
    { kind: "event", event: "" },
    "manual",
    [],
  ]) {
    assert.throws(() => parseAutomationTrigger(bad), AutomationTriggerError, JSON.stringify(bad));
  }
});

test("parseAutomationTrigger: rejects an interval past the sanity bound", () => {
  assert.deepEqual(parseAutomationTrigger({ kind: "schedule", everyMinutes: MAX_SCHEDULE_MINUTES }), {
    kind: "schedule",
    everyMinutes: MAX_SCHEDULE_MINUTES,
  });
  // 900_000 is what you get by passing milliseconds where minutes belong — the
  // exact units mistake that would make an Automation appear to never run.
  assert.throws(
    () => parseAutomationTrigger({ kind: "schedule", everyMinutes: 900_000 }),
    /units mistake/,
  );
});

test("cadenceLabel: renders a schedule, and only a schedule", () => {
  assert.equal(cadenceLabel({ kind: "schedule", everyMinutes: 15 }), "PT15M");
  assert.equal(cadenceLabel({ kind: "schedule", everyMinutes: 360 }), "PT6H");
  assert.equal(cadenceLabel({ kind: "schedule", everyMinutes: 1440 }), "P1D");
  assert.equal(cadenceLabel({ kind: "manual" }), null);
  assert.equal(cadenceLabel({ kind: "event", event: "x" }), null);
});

test("dueAutomations: a never-run schedule is due immediately", () => {
  // Waiting a full interval after install makes a fresh Organization look
  // broken. Boot latency is the host's problem (it delays the first tick).
  const due = dueAutomations([state({ lastStartedAt: undefined })], NOW);
  assert.deepEqual(due.map((d) => d.automationId), ["a1"]);
  assert.equal(due[0]?.minutesSinceLastStart, undefined);
});

test("dueAutomations: not due before the interval, due at and after it", () => {
  assert.deepEqual(dueAutomations([state({ lastStartedAt: minutesAgo(14) })], NOW), []);
  assert.equal(dueAutomations([state({ lastStartedAt: minutesAgo(15) })], NOW).length, 1);
  assert.equal(dueAutomations([state({ lastStartedAt: minutesAgo(16) })], NOW).length, 1);
});

test("dueAutomations: an overdue Automation fires ONCE, not once per missed slot", () => {
  // The property that makes a restart after downtime safe. Six hours of
  // downtime on a 15-minute Automation is 24 missed occurrences; draining them
  // would turn "we deployed" into a burst of 24 governed Runs the system has
  // no way to recognise as duplicates.
  const due = dueAutomations([state({ lastStartedAt: minutesAgo(360) })], NOW);
  assert.equal(due.length, 1);
  assert.equal(due[0]?.minutesSinceLastStart, 360);
});

test("dueAutomations: manual and event triggers are never clock-due", () => {
  const states = [
    state({ automationId: "manual", trigger: { kind: "manual" }, lastStartedAt: minutesAgo(10_000) }),
    state({ automationId: "evt", trigger: { kind: "event", event: "signal.created" } }),
  ];
  assert.deepEqual(dueAutomations(states, NOW), []);
});

test("dueAutomations: a corrupt lastStartedAt cannot silence a schedule forever", () => {
  // Treated as never-run, so the Automation resumes. The alternative — skipping
  // rows we cannot parse — makes one bad timestamp a permanent, invisible stop.
  const due = dueAutomations([state({ lastStartedAt: "not-a-date" })], NOW);
  assert.equal(due.length, 1);
  assert.equal(due[0]?.minutesSinceLastStart, undefined);
});

test("undispatchedTriggers: names every Automation that cannot fire yet", () => {
  // The whole reason `event` is modelled. Without this, a declared event
  // trigger is indistinguishable from a working one until someone notices the
  // Automation has never run — the exact defect the scheduler exists to end.
  const states = [
    state({ automationId: "sched" }),
    state({ automationId: "man", trigger: { kind: "manual" } }),
    state({ automationId: "evt", trigger: { kind: "event", event: "signal.created" } }),
  ];
  const gaps = undispatchedTriggers(states);
  assert.deepEqual(gaps.map((g) => g.automationId), ["evt"]);
  assert.match(gaps[0]!.reason, /signal\.created/);
  assert.match(gaps[0]!.reason, /will not run on its own/);
});
