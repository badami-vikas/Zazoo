/**
 * The Automation scheduler, end to end through real wiring (ADR-179).
 *
 * `automation-trigger.test.ts` covers the pure due-calculation. This covers the
 * half that could not be unit-tested away: that a stored trigger survives the
 * registry round-trip, that a due Automation actually reaches the executor and
 * produces an attributable Run, and that the scheduler's own failure modes
 * (one broken Automation, an unreadable schedule) do not take the loop down.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";

import {
  readScheduleStates,
  runSchedulerTick,
  scheduledRunCtx,
} from "../src/automation-scheduler.js";
import {
  buildWiring,
  INTERNAL_STRATEGIST_AGENT,
  PILOT_ORGANIZATION,
  type Wiring,
} from "../src/wiring.js";

function makeRun(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(1);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

function silentLog() {
  const warns: unknown[] = [];
  const errors: unknown[] = [];
  return {
    warns,
    errors,
    log: {
      info: () => {},
      warn: (obj: unknown) => void warns.push(obj),
      error: (obj: unknown) => void errors.push(obj),
    },
  };
}

test("a stored schedule survives the registry round-trip", async () => {
  // The field could parse perfectly and still be dropped on the way to the
  // database — which is exactly what happened before: `save` hardcoded
  // `trigger: {}` and `load` never selected the column.
  const wiring = await buildWiring();
  try {
    const run = makeRun();
    const agentId = INTERNAL_STRATEGIST_AGENT;
    await wiring.automationRegistry.save({
      id: "test-fixture-scheduled",
      name: "Scheduled fixture",
      organizationId: PILOT_ORGANIZATION,
      agentId,
      agentPlane: "local",
      trigger: { kind: "schedule", everyMinutes: 30 },
      steps: [],
    });
    void run;

    const loaded = await wiring.automationRegistry.load(
      PILOT_ORGANIZATION,
      "test-fixture-scheduled",
    );
    assert.deepEqual(loaded?.trigger, { kind: "schedule", everyMinutes: 30 });

    const listed = await wiring.automationRegistry.listByStatus(PILOT_ORGANIZATION, "active");
    const found = listed.find((definition) => definition.id === "test-fixture-scheduled");
    assert.deepEqual(found?.trigger, { kind: "schedule", everyMinutes: 30 });
  } finally {
    await wiring.close();
  }
});

test("an Automation with no stored trigger reads as manual and is never clock-due", async () => {
  const wiring = await buildWiring();
  try {
    await wiring.automationRegistry.save({
      id: "test-fixture-untriggered",
      name: "Untriggered fixture",
      organizationId: PILOT_ORGANIZATION,
      agentId: INTERNAL_STRATEGIST_AGENT,
      agentPlane: "local",
      steps: [],
    });

    const loaded = await wiring.automationRegistry.load(
      PILOT_ORGANIZATION,
      "test-fixture-untriggered",
    );
    assert.deepEqual(loaded?.trigger, { kind: "manual" });

    const states = await readScheduleStates({
      registry: wiring.automationRegistry,
      runRecorder: wiring.automationRunRecorder,
      organizationId: PILOT_ORGANIZATION,
    });
    const state = states.find((s) => s.automationId === "test-fixture-untriggered");
    assert.deepEqual(state?.trigger, { kind: "manual" });
  } finally {
    await wiring.close();
  }
});

test("a due Automation is started by the tick and produces an attributable Run", async () => {
  const wiring = await buildWiring();
  try {
    const { log } = silentLog();
    await wiring.automationRegistry.save({
      id: "test-fixture-due",
      name: "Due fixture",
      organizationId: PILOT_ORGANIZATION,
      agentId: INTERNAL_STRATEGIST_AGENT,
      agentPlane: "local",
      trigger: { kind: "schedule", everyMinutes: 15 },
      steps: [],
    });

    const result = await runSchedulerTick({
      registry: wiring.automationRegistry,
      runRecorder: wiring.automationRunRecorder,
      executor: wiring.automationExecutor,
      organizationId: PILOT_ORGANIZATION,
      log,
    });

    assert.ok(
      result.started.includes("test-fixture-due"),
      `expected the due Automation to start, got ${JSON.stringify(result)}`,
    );

    // A Run row exists and is attributed to the Automation's own Agent — the
    // scheduler must not invent an actor.
    const runs = await wiring.automationRunRecorder.list(
      PILOT_ORGANIZATION,
      ["test-fixture-due"],
      { limit: 10 },
    );
    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.agentId, INTERNAL_STRATEGIST_AGENT);
  } finally {
    await wiring.close();
  }
});

test("a just-run Automation is not started again on the next tick", async () => {
  // The anti-storm property proven against the DURABLE run history rather than
  // an in-process cursor, because the cursor is what a restart would lose.
  const wiring = await buildWiring();
  try {
    const { log } = silentLog();
    const deps = {
      registry: wiring.automationRegistry,
      runRecorder: wiring.automationRunRecorder,
      executor: wiring.automationExecutor,
      organizationId: PILOT_ORGANIZATION,
      log,
    };
    await wiring.automationRegistry.save({
      id: "test-fixture-once",
      name: "Once fixture",
      organizationId: PILOT_ORGANIZATION,
      agentId: INTERNAL_STRATEGIST_AGENT,
      agentPlane: "local",
      trigger: { kind: "schedule", everyMinutes: 15 },
      steps: [],
    });

    const first = await runSchedulerTick(deps);
    assert.ok(first.started.includes("test-fixture-once"));

    const second = await runSchedulerTick(deps);
    assert.ok(
      !second.started.includes("test-fixture-once"),
      "an Automation that just ran must not run again within its interval",
    );
  } finally {
    await wiring.close();
  }
});

test("one failing Automation does not stop the others on the same tick", async () => {
  // The way a scheduler usually fails invisibly: an exception in the loop
  // aborts the batch, and every other Automation silently stops.
  const wiring = await buildWiring();
  try {
    const { log, errors } = silentLog();
    await wiring.automationRegistry.save({
      id: "test-fixture-healthy",
      name: "Healthy fixture",
      organizationId: PILOT_ORGANIZATION,
      agentId: INTERNAL_STRATEGIST_AGENT,
      agentPlane: "local",
      trigger: { kind: "schedule", everyMinutes: 15 },
      steps: [],
    });

    const exploding = {
      runById: async (req: { automationId: string }) => {
        if (req.automationId === "test-fixture-boom") throw new Error("boom");
        return { runId: "r", status: "completed" as const, outputs: [] };
      },
    };
    await wiring.automationRegistry.save({
      id: "test-fixture-boom",
      name: "Exploding fixture",
      organizationId: PILOT_ORGANIZATION,
      agentId: INTERNAL_STRATEGIST_AGENT,
      agentPlane: "local",
      trigger: { kind: "schedule", everyMinutes: 15 },
      steps: [],
    });

    const result = await runSchedulerTick({
      registry: wiring.automationRegistry,
      runRecorder: wiring.automationRunRecorder,
      executor: exploding as unknown as Wiring["automationExecutor"],
      organizationId: PILOT_ORGANIZATION,
      log,
    });

    assert.ok(result.started.includes("test-fixture-healthy"), "the healthy Automation still ran");
    assert.deepEqual(
      result.failed.map((f) => f.automationId),
      ["test-fixture-boom"],
    );
    assert.equal(errors.length, 1, "the failure is logged, not swallowed");
  } finally {
    await wiring.close();
  }
});

test("a scheduled Run carries an explicit system_generated taint label", async () => {
  // The sink gate fails closed on UNKNOWN, so a scheduled start with no label
  // would be blocked at the first egress-adjacent step rather than run.
  // `system_generated` is the SOURCE id; the registry maps it to
  // trust `verified_system` / source `system`. Asserting the mapped values (not
  // the source id) is the point — it proves the label went through the source
  // registry rather than being hand-assembled with a plausible-looking string.
  const ctx = scheduledRunCtx("some-automation");
  assert.equal(ctx.taintLabel?.trust, "verified_system");
  assert.equal(ctx.taintLabel?.source, "system");
  assert.equal(ctx.taintLabel?.instructionRisk, "data");
  assert.equal(ctx.taintLabel?.sensitivity, "organization");
});
