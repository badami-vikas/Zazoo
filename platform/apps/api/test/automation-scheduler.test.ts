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
import { supersedeDuplicateProposals } from "../src/automation-scheduler.js";
import {
  buildWiring,
  INTERNAL_STRATEGIST_AGENT,
  LEARNING_AGENT,
  LEARNING_DIGEST_AUTOMATION_ID,
  OBSERVATION_DIGEST_SKILL_ID,
  PILOT_ORGANIZATION,
  type Wiring,
} from "../src/wiring.js";
import { makeRun } from "./caller.js";

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

// ── One open proposal per identical step (ADR 2026-09-04 "Approvals belong to Tasks") ──
//
// The learning digest is the real case: wiring registers it, it ticks every 15
// minutes, and its write of organization-wide scope parks for a Human — which is
// how one Local Plane came to hold 254 identical undecided digests.

const DIGEST_STEP = {
  skill: OBSERVATION_DIGEST_SKILL_ID,
  action: "write" as const,
  resourceType: "signal" as const,
  dataScope: "all" as const,
  inputs: {},
};

function digestPending(wiring: Wiring) {
  return wiring.pipeline.openAutomationProposals(PILOT_ORGANIZATION);
}

test("an Automation whose earlier proposal is still undecided waits on it instead of proposing again", async () => {
  const wiring = await buildWiring();
  try {
    const first = await wiring.automationExecutor.runById(
      { organizationId: PILOT_ORGANIZATION, automationId: LEARNING_DIGEST_AUTOMATION_ID },
      scheduledRunCtx(LEARNING_DIGEST_AUTOMATION_ID),
    );
    assert.equal(first.status, "completed");
    assert.equal(first.proposals[0]?.status, "pending_review", "the digest parks for a Human");
    const open = (await digestPending(wiring)).filter((entry) => entry.context?.id === LEARNING_DIGEST_AUTOMATION_ID);
    assert.equal(open.length, 1);

    // The next tick: the identical step is still waiting, so the Run halts on
    // it and adds nothing — the 254-row pile can no longer form.
    const second = await wiring.automationExecutor.runById(
      { organizationId: PILOT_ORGANIZATION, automationId: LEARNING_DIGEST_AUTOMATION_ID },
      scheduledRunCtx(LEARNING_DIGEST_AUTOMATION_ID),
    );
    assert.equal(second.status, "halted");
    assert.equal(second.haltedAtStep, 0);
    assert.equal(second.proposals.length, 0);
    assert.equal((await digestPending(wiring)).filter((entry) => entry.context?.id === LEARNING_DIGEST_AUTOMATION_ID).length, 1);
    const run = await wiring.automationRunRecorder.get(PILOT_ORGANIZATION, second.runId);
    assert.equal(run?.status, "halted");
    assert.equal((run?.output as { waitingOn?: string } | null)?.waitingOn, open[0]!.id);
  } finally {
    await wiring.close();
  }
});

test("the tick withdraws stale duplicate proposals a Local Plane already holds, keeping the newest", async () => {
  const wiring = await buildWiring();
  try {
    const { log } = silentLog();
    // Three identical digest proposals, the way the old executor left them,
    // plus one from another Automation that must stay untouched.
    const ids: string[] = [];
    const proposeDigest = async (automationId: string) => {
      const ctx = scheduledRunCtx(automationId);
      const proposal = await wiring.pipeline.propose(
        {
          organizationId: PILOT_ORGANIZATION,
          actor: { type: "agent", id: LEARNING_AGENT, plane: "local" },
          ...DIGEST_STEP,
          context: { type: "automation", id: automationId, runId: ctx.ids.next() },
        },
        ctx,
      );
      assert.equal(proposal.status, "pending_review");
      return proposal.id;
    };
    for (let i = 0; i < 3; i++) ids.push(await proposeDigest(LEARNING_DIGEST_AUTOMATION_ID));
    const other = await proposeDigest("test-fixture-other-digest");
    assert.equal((await digestPending(wiring)).length, 4);

    const superseded = await supersedeDuplicateProposals(wiring.pipeline, PILOT_ORGANIZATION, scheduledRunCtx("sweep"));
    assert.equal(superseded, 2);
    const remaining = (await digestPending(wiring)).map((entry) => entry.id).sort();
    assert.deepEqual(remaining, [ids[2]!, other].sort(), "the newest of the pile and the other Automation's remain");

    // Withdrawn rows read as superseded in history — not approved, not vetoed,
    // and nothing executed.
    const history = await wiring.ledger.listHistory(PILOT_ORGANIZATION, { limit: 100, offset: 0 });
    const withdrawn = history.items.filter((entry) => entry.userDecision === "superseded");
    assert.equal(withdrawn.length, 2);
    assert.ok(withdrawn.every((entry) => entry.refLedgerId !== undefined && ids.slice(0, 2).includes(entry.refLedgerId)));

    // The tick itself runs the sweep, so a second sweep finds nothing left.
    await runSchedulerTick({
      registry: wiring.automationRegistry,
      runRecorder: wiring.automationRunRecorder,
      executor: wiring.automationExecutor,
      pipeline: wiring.pipeline,
      organizationId: PILOT_ORGANIZATION,
      log,
    });
    assert.equal(await supersedeDuplicateProposals(wiring.pipeline, PILOT_ORGANIZATION, scheduledRunCtx("sweep")), 0);
  } finally {
    await wiring.close();
  }
});

test("the sweep withdraws duplicates on a MIGRATED Local Plane, not only on in-memory stores (BUGS 2026-09-05)", async () => {
  // The first installed Egg never withdrew a row: `ledger_user_decision_check`
  // (migration 0015) did not admit `superseded`, the insert failed, and the
  // whole scheduler tick died with it. In-memory stores have no constraint,
  // so the in-memory test above stayed green. This one runs the real chain.
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = await mkdtemp(join(tmpdir(), "bridge-sweep-migrated-"));
  const wiring = await buildWiring({ localDir: join(root, "local") });
  try {
    const ctx = scheduledRunCtx("test");
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const proposal = await wiring.pipeline.propose(
        {
          organizationId: PILOT_ORGANIZATION,
          actor: { type: "agent", id: LEARNING_AGENT },
          action: "write",
          resourceType: "signal",
          inputs: {},
          skill: OBSERVATION_DIGEST_SKILL_ID,
          dataScope: "private",
          context: { type: "automation", id: LEARNING_DIGEST_AUTOMATION_ID, runId: ctx.ids.next() },
        },
        ctx,
      );
      ids.push(proposal.id);
    }
    const before = await wiring.pipeline.listPending(PILOT_ORGANIZATION, { limit: 50, offset: 0 });
    assert.equal(before.items.filter((item) => ids.includes(item.id)).length, 3);

    // Through the tick itself, so a sweep failure would surface as "no rows
    // withdrawn" here rather than as a swallowed log line.
    const tick = await runSchedulerTick({
      registry: wiring.automationRegistry,
      pipeline: wiring.pipeline,
      runRecorder: wiring.automationRunRecorder,
      executor: wiring.automationExecutor,
      organizationId: PILOT_ORGANIZATION,
      log: { info: () => undefined, warn: () => undefined, error: () => undefined },
    });
    assert.ok(tick, "the tick completes");

    const after = await wiring.pipeline.listPending(PILOT_ORGANIZATION, { limit: 50, offset: 0 });
    assert.equal(after.items.filter((item) => ids.includes(item.id)).length, 1, "one open proposal per identical step");
    const history = await wiring.ledger.listHistory(PILOT_ORGANIZATION, { limit: 50, offset: 0 });
    assert.equal(
      history.items.filter((entry) => entry.userDecision === "superseded" && ids.includes(entry.refLedgerId ?? "")).length,
      2,
      "the withdrawn rows read as superseded on a migrated plane",
    );
    // And the persisted Skill name survives replay — Home must never show "(replayed)".
    assert.equal(after.items.find((item) => ids.includes(item.id))?.request.skill, OBSERVATION_DIGEST_SKILL_ID);
  } finally {
    await wiring.close();
    await rm(root, { recursive: true, force: true });
  }
});
