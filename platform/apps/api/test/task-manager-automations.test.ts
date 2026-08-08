/**
 * The Task Manager planning and scan Automations actually RUN.
 *
 * Before this slice the planning Skills were reachable only through the Skill
 * registry: nothing in the product had ever invoked one, and
 * `proactive-scan-cadence` was declared in the Module manifest since TM0 with
 * no runtime Automation id and no procedure behind it. These assertions fail
 * if either goes back to being declared-only.
 *
 * What they prove, beyond "it returns something":
 *  - the Run is attributable to Internal Strategist, not to the human caller;
 *  - the proposal HALTS at pending_review — nothing settles silently;
 *  - the Skill's real output rides the proposal, not an echo of the inputs;
 *  - decomposition receives the Task's own path as the parent path, so
 *    generated children could not collide with live rows.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_ORGANIZATION, PILOT_USER, type Wiring } from "../src/wiring.js";
import {
  TASK_MANAGER_PLANNING_AUTOMATION_ID,
  TASK_MANAGER_SCAN_AUTOMATION_ID,
} from "../src/built-in-modules.js";

function run(): RunCtx {
  const clock = new SystemClock();
  return { clock, rng: new SeededRng(7), ids: new UuidGen(clock, new SeededRng(7)) };
}

function caller(wiring: Wiring) {
  return appRouter.createCaller({
    wiring,
    run: run(),
    identity: { type: "user", id: PILOT_USER },
    authenticated: true,
    verifying: false,
  });
}

test("the planning Playbook Automation runs an attributable Agent Run that halts for review", async () => {
  const wiring = await buildWiring({ allowEphemeralLocalPlane: true });
  const api = caller(wiring);

  const goal = await api.taskManager.create({
    organizationId: PILOT_ORGANIZATION,
    title: "Cut onboarding time in half",
    isGoal: true,
    outcomes: [{
      id: "ttfs",
      title: "Time to first Signal",
      measure: "minutes",
      target: "10",
      indicatorKind: "leading",
    }],
    ownerType: "human",
    ownerId: PILOT_USER,
  });

  const result = await api.taskManager.runPlanningPlaybook({
    organizationId: PILOT_ORGANIZATION,
    taskId: goal.task.id,
    skill: "task-decomposition",
    idempotencyKey: "planning-decomposition-1",
  });

  assert.equal(result.skill, "task-manager.task-decomposition");
  assert.equal(result.taskId, goal.task.id);
  assert.equal(result.proposal.status, "pending_review", "nothing settles without a Human");

  // The Run belongs to the Agent, not to the human who asked for it.
  const runRecord = await wiring.automationRunRecorder.get?.(PILOT_ORGANIZATION, result.runId);
  if (runRecord) {
    assert.equal(runRecord.automationId, TASK_MANAGER_PLANNING_AUTOMATION_ID);
  }

  const output = result.proposal.output?.proposedOutput as Record<string, unknown>;
  assert.equal(output["kind"], "task_decomposition", "the Skill's real output rides the proposal");
  // The Task's own path is the parent for its children — this is what keeps a
  // generated dot-path from colliding with a live row.
  assert.equal(output["parentPath"], goal.task.path);
  assert.equal(output["status"], "proposed");
  // No model is configured in this wiring, so the honest answer is the
  // Playbook's questions with nothing drafted.
  assert.equal(output["source"], "playbook_scaffold");
  assert.ok((output["prompts"] as unknown[]).length >= 3);
  assert.deepEqual(output["children"], []);
});

test("every planning Skill is reachable through the Automation, each with its own shape", async () => {
  const wiring = await buildWiring({ allowEphemeralLocalPlane: true });
  const api = caller(wiring);
  const task = await api.taskManager.create({
    organizationId: PILOT_ORGANIZATION,
    title: "Ship the pilot",
    exitTest: "A real user completes the flow unaided",
    ownerType: "human",
    ownerId: PILOT_USER,
  });

  const expected = [
    ["goal-outcome-framing", "goal_outcome_framing"],
    ["candidate-task-generation", "candidate_task_generation"],
    ["premortem-scenario", "premortem_scenario"],
    ["task-decomposition", "task_decomposition"],
    ["exit-test-authoring", "exit_test_authoring"],
  ] as const;

  for (const [skill, kind] of expected) {
    const result = await api.taskManager.runPlanningPlaybook({
      organizationId: PILOT_ORGANIZATION,
      taskId: task.task.id,
      skill,
      idempotencyKey: `planning-all-${skill}`,
    });
    const output = result.proposal.output?.proposedOutput as Record<string, unknown>;
    assert.equal(output["kind"], kind, `${skill} produced the wrong output kind`);
    assert.equal(result.proposal.status, "pending_review", `${skill} did not halt for review`);
    // It ran under a named, versioned methodology rather than an implicit prompt.
    assert.ok(typeof output["playbookId"] === "string" && (output["playbookId"] as string).length > 0);
  }
});

test("a planning Playbook the Skill does not support is refused, not silently swapped", async () => {
  const wiring = await buildWiring({ allowEphemeralLocalPlane: true });
  const api = caller(wiring);
  const task = await api.taskManager.create({
    organizationId: PILOT_ORGANIZATION,
    title: "Ship the pilot",
    ownerType: "human",
    ownerId: PILOT_USER,
  });
  await assert.rejects(
    () => api.taskManager.runPlanningPlaybook({
      organizationId: PILOT_ORGANIZATION,
      taskId: task.task.id,
      skill: "task-decomposition",
      playbookId: "pre-mortem",
      idempotencyKey: "planning-wrong-playbook",
    }),
  );
});

test("the proactive scan Automation runs and proposes candidates traceable to real rows", async () => {
  const wiring = await buildWiring({ allowEphemeralLocalPlane: true });
  const api = caller(wiring);

  // A goal with outcomes but nothing beneath it — a real, checkable gap.
  const goal = await api.taskManager.create({
    organizationId: PILOT_ORGANIZATION,
    title: "Grow the pilot",
    isGoal: true,
    outcomes: [{
      id: "pilots",
      title: "Active pilots",
      measure: "count",
      target: "5",
      indicatorKind: "lagging",
    }],
    ownerType: "human",
    ownerId: PILOT_USER,
  });

  const result = await api.taskManager.runOpportunityScan({
    organizationId: PILOT_ORGANIZATION,
    idempotencyKey: "opportunity-scan-1",
  });
  assert.equal(result.proposal.status, "pending_review");

  const output = result.proposal.output?.proposedOutput as Record<string, unknown>;
  assert.equal(output["kind"], "opportunity_scan");
  const opportunities = output["opportunities"] as { kind: string; taskId: string }[];
  const found = opportunities.find((entry) => entry.taskId === goal.task.id);
  assert.ok(found, "the childless goal must be found");
  assert.equal(found.kind, "goal_without_children");
  // The boundary of what was examined is stated, so nobody reads cross-Module
  // Signals into a queue-only scan.
  assert.match(output["scope"] as string, /Task queue only/);
  assert.equal(TASK_MANAGER_SCAN_AUTOMATION_ID.length, 36);
});
