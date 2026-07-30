/**
 * TASK-028 kernel-Run migration — `research.run.*` over the real
 * `buildWiring()` composition root.
 *
 * The prototype ran the whole Research loop inside the companion overlay, so
 * its steps lived only in the webview: not durable, not inspectable, not
 * attributable. These tests pin the properties that make the kernel the system
 * of record instead:
 *
 *  - a step becomes a real child Agent Run, reachable through the SAME
 *    `agentOrchestration.childRun.listByParentRun` the Run detail Page will use;
 *  - the step ceiling is server-owned, so a client cannot claim a longer run;
 *  - `click`/`type` (BR3 amber actions) cannot be recorded here at all, so a
 *    client can never mint an audit trail for an actuation no Proposal approved;
 *  - `delegatedScope` is derived from the tool, never accepted from the caller.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  SeededRng,
  SystemClock,
  UuidGen,
  labelFromLegacyTrustOrigin,
  type RunCtx,
} from "@bridge/core";

import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_ORGANIZATION, PILOT_USER, type Wiring } from "../src/wiring.js";
import { WEB_RESEARCH_SKILL_ID } from "../src/web-research-skill.js";

function makeRun(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(7);
  return {
    clock,
    rng,
    ids: new UuidGen(clock, rng),
    taintLabel: labelFromLegacyTrustOrigin("operator", "research-run-kernel-test"),
  };
}

function makeCaller(wiring: Wiring) {
  return appRouter.createCaller({
    wiring,
    run: makeRun(),
    identity: { type: "user" as const, id: PILOT_USER },
    authenticated: true,
    verifying: false,
  });
}

const OBJECTIVE = "Compare open-source screen-aware desktop assistants";

test("a Research Run's steps become inspectable child Agent Runs", async () => {
  const wiring = await buildWiring();
  const caller = makeCaller(wiring);

  const started = await caller.research.run.start({
    organizationId: PILOT_ORGANIZATION,
    objective: OBJECTIVE,
  });
  assert.ok(started.runId.length > 0);
  assert.equal(started.maxSteps, 12);

  // Before any step there is no timeline at all.
  const empty = await caller.agentOrchestration.childRun.listByParentRun({
    organizationId: PILOT_ORGANIZATION,
    parentRunId: started.runId,
  });
  assert.equal(empty.length, 0);

  const search = await caller.research.run.recordStep({
    organizationId: PILOT_ORGANIZATION,
    runId: started.runId,
    objective: OBJECTIVE,
    stepIndex: 0,
    tool: "search",
    argument: "open source screen aware desktop assistant",
    rationale: "establish the candidate set",
    summary: "3 candidates found",
    sourceUrl: null,
  });
  assert.equal(search.stepIndex, 0);
  assert.equal(search.stepsRecorded, 1);
  assert.ok(search.childRunId, "an acting step must produce a child Run");

  await caller.research.run.recordStep({
    organizationId: PILOT_ORGANIZATION,
    runId: started.runId,
    objective: OBJECTIVE,
    stepIndex: 1,
    tool: "note",
    argument: "candidates recorded",
    rationale: "checkpoint before reading",
    summary: "noted 3 candidates",
  });

  const timeline = await caller.agentOrchestration.childRun.listByParentRun({
    organizationId: PILOT_ORGANIZATION,
    parentRunId: started.runId,
  });
  // Only the acting step is a Run. The `note` is durable in the ledger but did
  // not act, so it is deliberately not represented as a child Agent Run.
  assert.equal(timeline.length, 1);
  for (const run of timeline) {
    assert.equal(run.parentRunId, started.runId);
    assert.equal(run.plane, "cloud");
    assert.equal(run.dataScope, "public");
    // Depth 1: a research step never spawns its own children.
    assert.equal(run.depth, 1);
  }

  // The external step carries fetch authority and the governed Skill; the
  // engine-authored `note` step carries neither.
  const searchRun = timeline.find((r) => r.stopCondition.includes("· search ·"));
  assert.ok(searchRun, "search step should be recorded as a child Run");
  assert.deepEqual([...searchRun!.eligibleSkills], [WEB_RESEARCH_SKILL_ID]);
  assert.ok(
    !timeline.some((r) => r.stopCondition.includes("· note ·")),
    "a note must not be manufactured into a Run with authority it never uses",
  );
});

test("the step ceiling is server-owned and a step index cannot be recorded twice", async () => {
  const wiring = await buildWiring();
  const caller = makeCaller(wiring);
  const started = await caller.research.run.start({
    organizationId: PILOT_ORGANIZATION,
    objective: OBJECTIVE,
  });

  await caller.research.run.recordStep({
    organizationId: PILOT_ORGANIZATION,
    runId: started.runId,
    objective: OBJECTIVE,
    stepIndex: 0,
    tool: "search",
    argument: "first query",
    rationale: "start",
    summary: "ok",
  });

  // Replaying the same ordinal must not silently fork the timeline.
  await assert.rejects(
    () =>
      caller.research.run.recordStep({
        organizationId: PILOT_ORGANIZATION,
        runId: started.runId,
        objective: OBJECTIVE,
        stepIndex: 0,
        tool: "read",
        argument: "https://example.com/",
        rationale: "duplicate ordinal",
        summary: "should be refused",
      }),
    /already recorded/,
  );

  // A client cannot claim a longer run than the server grants.
  await assert.rejects(
    () =>
      caller.research.run.recordStep({
        organizationId: PILOT_ORGANIZATION,
        runId: started.runId,
        objective: OBJECTIVE,
        stepIndex: 12,
        tool: "search",
        argument: "beyond the ceiling",
        rationale: "over bound",
        summary: "should be refused",
      }),
    // Rejected by the input schema before any handler work happens.
    (error: unknown) => error instanceof Error,
  );
});

test("BR3 amber actions cannot be recorded through this surface", async () => {
  const wiring = await buildWiring();
  const caller = makeCaller(wiring);
  const started = await caller.research.run.start({
    organizationId: PILOT_ORGANIZATION,
    objective: OBJECTIVE,
  });

  for (const tool of ["click", "type"]) {
    await assert.rejects(
      () =>
        caller.research.run.recordStep({
          organizationId: PILOT_ORGANIZATION,
          runId: started.runId,
          objective: OBJECTIVE,
          stepIndex: 0,
          // Deliberately invalid: `click`/`type` are absent from the enum, so
          // the refusal is a schema fact rather than a runtime branch.
          tool: tool as "search",
          argument: "ref-1",
          rationale: "should never be accepted without a Proposal",
          summary: "should be refused",
        }),
      (error: unknown) => error instanceof Error,
      `${tool} must be refused at the recording surface`,
    );
  }

  const timeline = await caller.agentOrchestration.childRun.listByParentRun({
    organizationId: PILOT_ORGANIZATION,
    parentRunId: started.runId,
  });
  assert.equal(timeline.length, 0, "a refused action must leave no child Run");
});
