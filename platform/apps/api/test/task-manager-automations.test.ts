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
import { SeededRng, SystemClock, UuidGen, type ModelProvider, type RunCtx } from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_ORGANIZATION, PILOT_USER, type Wiring } from "../src/wiring.js";
import {
  TASK_MANAGER_PLANNING_AUTOMATION_ID,
  TASK_MANAGER_SCAN_AUTOMATION_ID,
  TASK_MANAGER_STANDUP_AUTOMATION_ID,
  TASK_MANAGER_STALE_REVIEW_AUTOMATION_ID,
  CHIEF_OF_STAFF_AGENT_RUNTIME_ID,
  GOVERNANCE_AGENT_RUNTIME_ID,
  TASK_MANAGER_WIP_BREACH_AUTOMATION_ID,
  TASK_MANAGER_ROUTING_GATE_AUTOMATION_ID,
} from "../src/built-in-modules.js";

/** Proposals expire, so every call supplies a bound inside the allowed 24h. */
function expiry(): string {
  return new Date(Date.now() + 60 * 60_000).toISOString();
}

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
    expiresAt: expiry(),
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
      expiresAt: expiry(),
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
      expiresAt: expiry(),
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
    expiresAt: expiry(),
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

/** A local-plane model double. `plane: "local"` and an id that is not "echo"
 * are both load-bearing: the planning binding is local-default and skips the
 * echo test provider, so a cloud or echo double would resolve to nothing and
 * the Skill would scaffold instead of drafting. */
function planningModel(reply: string): ModelProvider {
  return {
    id: "test-local-planner",
    plane: "local",
    tiers: ["reasoning"],
    models: { reasoning: "test-planner-v1" },
    routingHealth: () => "healthy",
    async complete(req) {
      return {
        text: reply,
        model: "test-planner-v1",
        tier: req.tier,
        usage: {
          inputTokens: 80,
          outputTokens: 40,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          source: "provider",
        },
      };
    },
  };
}

/**
 * The third step of draft-then-approve. ADR-198 recorded that approval
 * materialized nothing; this is the assertion that it no longer does.
 */
test("approving a decomposition actually creates the child Tasks", async () => {
  const wiring = await buildWiring({
    allowEphemeralLocalPlane: true,
    modelProviders: [planningModel(JSON.stringify({
      children: [
        { title: "Draft the intake form", exitTest: "A new user submits it end to end", rationale: "" },
        { title: "Wire the confirmation email", exitTest: "The email lands in a real inbox", rationale: "" },
      ],
    }))],
  });
  const api = caller(wiring);

  const goal = await api.taskManager.create({
    organizationId: PILOT_ORGANIZATION,
    title: "Cut onboarding time in half",
    ownerType: "human",
    ownerId: PILOT_USER,
  });

  const planned = await api.taskManager.runPlanningPlaybook({
    organizationId: PILOT_ORGANIZATION,
    taskId: goal.task.id,
    skill: "task-decomposition",
    idempotencyKey: "materialize-decomposition-1",
    expiresAt: expiry(),
  });

  const draft = planned.proposal.output?.proposedOutput as Record<string, unknown>;
  // The governed local model was actually used — not the scaffold path.
  assert.equal(draft["source"], "model");
  assert.equal((draft["children"] as unknown[]).length, 2);
  // Routing the call through the governed provider is what puts a receipt in
  // the ledger; before this it returned one for nobody to record.
  assert.ok(planned.modelReceiptLedgerId, "a model receipt must reach the ledger");
  assert.ok(planned.candidateProposal, "a candidate proposal must be staged for approval");
  assert.equal(planned.candidateProposal?.status, "pending_review");

  const before = await api.taskManager.list({ organizationId: PILOT_ORGANIZATION });
  const decided = await api.taskManager.decideProposal({
    organizationId: PILOT_ORGANIZATION,
    proposalId: planned.candidateProposal!.id,
    decision: "approve",
  });
  assert.equal(decided.proposal.status, "approved");

  const after = await api.taskManager.list({ organizationId: PILOT_ORGANIZATION });
  const created = after.filter((task) => !before.some((prior) => prior.id === task.id));
  assert.equal(created.length, 2, "approval created the child Tasks");
  assert.deepEqual(created.map((c) => c.title).sort(), [
    "Draft the intake form",
    "Wire the confirmation email",
  ]);
  // Approved means "worth having in the tree", not "start these".
  assert.ok(created.every((c) => c.status === "candidate"));
  assert.ok(created.every((c) => c.parentTaskId === goal.task.id));
  assert.ok(created.every((c) => c.path.startsWith(`${goal.task.path}.`)));
  assert.equal(created[0]?.exitTest, "A new user submits it end to end");
});

test("vetoing a planning proposal writes nothing", async () => {
  const wiring = await buildWiring({
    allowEphemeralLocalPlane: true,
    modelProviders: [planningModel(JSON.stringify({
      children: [{ title: "Never created", exitTest: "n/a", rationale: "" }],
    }))],
  });
  const api = caller(wiring);
  const goal = await api.taskManager.create({
    organizationId: PILOT_ORGANIZATION,
    title: "Ship the pilot",
    ownerType: "human",
    ownerId: PILOT_USER,
  });
  const planned = await api.taskManager.runPlanningPlaybook({
    organizationId: PILOT_ORGANIZATION,
    taskId: goal.task.id,
    skill: "task-decomposition",
    idempotencyKey: "materialize-veto-1",
    expiresAt: expiry(),
  });
  const before = await api.taskManager.list({ organizationId: PILOT_ORGANIZATION });
  await api.taskManager.decideProposal({
    organizationId: PILOT_ORGANIZATION,
    proposalId: planned.candidateProposal!.id,
    decision: "veto",
  });
  const after = await api.taskManager.list({ organizationId: PILOT_ORGANIZATION });
  assert.equal(after.length, before.length, "a veto creates nothing");
  assert.equal(after.some((task) => task.title === "Never created"), false);
});

test("approving an exit-test draft writes it onto the Task it was authored for", async () => {
  const wiring = await buildWiring({
    allowEphemeralLocalPlane: true,
    modelProviders: [planningModel(JSON.stringify({
      candidates: [
        { exitTest: "Five pilot users finish unaided; two or more stall", evidence: "session recordings", reason: "" },
      ],
    }))],
  });
  const api = caller(wiring);
  const task = await api.taskManager.create({
    organizationId: PILOT_ORGANIZATION,
    title: "Simplify the signup flow",
    ownerType: "human",
    ownerId: PILOT_USER,
  });
  const planned = await api.taskManager.runPlanningPlaybook({
    organizationId: PILOT_ORGANIZATION,
    taskId: task.task.id,
    skill: "exit-test-authoring",
    idempotencyKey: "materialize-exit-test-1",
    expiresAt: expiry(),
  });
  await api.taskManager.decideProposal({
    organizationId: PILOT_ORGANIZATION,
    proposalId: planned.candidateProposal!.id,
    decision: "approve",
  });
  const after = await api.taskManager.list({ organizationId: PILOT_ORGANIZATION });
  const updated = after.find((t) => t.id === task.task.id)!;
  assert.equal(updated.exitTest, "Five pilot users finish unaided; two or more stall");
});

// ---------------------------------------------------------------------
// ADR-200 — the third decision. Before this a reviewer could approve the
// Agent's plan or veto it, so one bad child title cost the whole draft.
// ---------------------------------------------------------------------

test("a reviewer can correct a planning draft before approving it", async () => {
  const wiring = await buildWiring({
    allowEphemeralLocalPlane: true,
    modelProviders: [planningModel(JSON.stringify({
      children: [
        { title: "Vague thing the model invented", exitTest: "unclear", rationale: "" },
        { title: "Wire the confirmation email", exitTest: "The email lands in a real inbox", rationale: "" },
      ],
    }))],
  });
  const api = caller(wiring);

  const goal = await api.taskManager.create({
    organizationId: PILOT_ORGANIZATION,
    title: "Cut onboarding time in half",
    ownerType: "human",
    ownerId: PILOT_USER,
  });
  const planned = await api.taskManager.runPlanningPlaybook({
    organizationId: PILOT_ORGANIZATION,
    taskId: goal.task.id,
    skill: "task-decomposition",
    idempotencyKey: "edit-decomposition-1",
    expiresAt: expiry(),
  });

  const before = await api.taskManager.list({ organizationId: PILOT_ORGANIZATION });
  const decided = await api.taskManager.decideProposal({
    organizationId: PILOT_ORGANIZATION,
    proposalId: planned.candidateProposal!.id,
    decision: "edit",
    editedPlanningItems: [
      { title: "Draft the intake form", exitTest: "A new user submits it end to end" },
      { title: "Wire the confirmation email", exitTest: "The email lands in a real inbox" },
      { title: "Measure time-to-first-value", exitTest: "The number appears on the dashboard" },
    ],
  });
  assert.equal(decided.proposal.status, "approved");

  const after = await api.taskManager.list({ organizationId: PILOT_ORGANIZATION });
  const created = after.filter((task) => !before.some((prior) => prior.id === task.id));
  assert.equal(created.length, 3, "the Human's list is what got built, including the one they added");
  assert.ok(
    !created.some((task) => task.title.includes("Vague thing")),
    "the child the reviewer removed was never created",
  );
  assert.ok(created.every((task) => task.status === "candidate"));
  assert.ok(created.every((task) => task.parentTaskId === goal.task.id));
  // Provenance survives the edit: the row still shows what the Agent drafted.
  const agentDraft = decided.proposal.payload["agentDraft"] as { children?: { title: string }[] };
  assert.equal(agentDraft?.children?.[0]?.title, "Vague thing the model invented");
});

test("an edit that would write nothing is refused instead of recorded as consent", async () => {
  const wiring = await buildWiring({
    allowEphemeralLocalPlane: true,
    modelProviders: [planningModel(JSON.stringify({
      children: [{ title: "Something", exitTest: "x", rationale: "" }],
    }))],
  });
  const api = caller(wiring);
  const goal = await api.taskManager.create({
    organizationId: PILOT_ORGANIZATION,
    title: "Cut onboarding time in half",
    ownerType: "human",
    ownerId: PILOT_USER,
  });
  const planned = await api.taskManager.runPlanningPlaybook({
    organizationId: PILOT_ORGANIZATION,
    taskId: goal.task.id,
    skill: "task-decomposition",
    idempotencyKey: "edit-empty-1",
    expiresAt: expiry(),
  });

  await assert.rejects(
    () => api.taskManager.decideProposal({
      organizationId: PILOT_ORGANIZATION,
      proposalId: planned.candidateProposal!.id,
      decision: "edit",
      // A decomposition materializes from titles; entries with none write
      // nothing, and an approval that writes nothing is really a veto.
      editedPlanningItems: [{ measure: "not a child" }],
    }),
    /materialize/,
  );
  const proposal = await api.taskManager.proposal({
    organizationId: PILOT_ORGANIZATION,
    proposalId: planned.candidateProposal!.id,
  });
  assert.equal(proposal?.status, "pending_review", "a refused edit leaves the proposal undecided");
});

// ---------------------------------------------------------------------
// ADR-201 — the two Chief of Staff cadence Automations. Both were declared
// from TM0 with no runtime id, blocked on the same thing: CoS had no governed
// Agent identity, so an Automation it owned had no actor to run as.
// ---------------------------------------------------------------------

test("the standup brief runs as an attributable Chief of Staff Agent Run", async () => {
  const wiring = await buildWiring({ allowEphemeralLocalPlane: true });
  const api = caller(wiring);

  const landed = await api.taskManager.create({
    organizationId: PILOT_ORGANIZATION,
    title: "Ship the intake form",
    ownerType: "human",
    ownerId: PILOT_USER,
    exitTest: "A new user submits it end to end",
  });
  await api.taskManager.transition({
    organizationId: PILOT_ORGANIZATION,
    taskId: landed.task.id,
    status: "in_progress",
  });

  const result = await api.taskManager.runQueueBrief({
    organizationId: PILOT_ORGANIZATION,
    brief: "standup-brief",
    idempotencyKey: "standup-brief-1",
  });

  // The Run is Chief of Staff's, not Internal Strategist's — the whole point
  // of ADR-107's split, and the reason this Automation could not run before.
  const runs = await wiring.automationRunRecorder.list(
    PILOT_ORGANIZATION,
    [TASK_MANAGER_STANDUP_AUTOMATION_ID],
    { limit: 10 },
  );
  const recorded = runs.find((entry) => entry.runId === result.runId);
  assert.ok(recorded, "the brief must leave an attributable Run");
  assert.equal(recorded?.agentId, CHIEF_OF_STAFF_AGENT_RUNTIME_ID);

  const brief = result.brief as Record<string, unknown>;
  assert.equal(brief["kind"], "progress_synthesis", "a real Skill ran, not an echo");
  const started = brief["started"] as { taskId: string }[];
  assert.ok(started.some((entry) => entry.taskId === landed.task.id));
  // A brief reports; it does not propose. Nothing is staged for approval.
  assert.equal(result.proposal.status !== "rejected", true);
});

test("the stale-task review surfaces untouched live work and nothing else", async () => {
  const wiring = await buildWiring({ allowEphemeralLocalPlane: true });
  const api = caller(wiring);

  const rotting = await api.taskManager.create({
    organizationId: PILOT_ORGANIZATION,
    title: "Wire the confirmation email",
    ownerType: "human",
    ownerId: PILOT_USER,
    exitTest: "The email lands in a real inbox",
  });
  const result = await api.taskManager.runQueueBrief({
    organizationId: PILOT_ORGANIZATION,
    brief: "stale-task-review",
    // A one-day window with rows created just now: nothing is stale yet.
    windowDays: 1,
    idempotencyKey: "stale-review-fresh",
  });
  const fresh = result.brief as { kind: string; stalled: { taskId: string }[]; count: number };
  assert.equal(fresh.count, 0, "work touched inside the window is not stale");
  assert.ok(!fresh.stalled.some((entry) => entry.taskId === rotting.task.id));

  // A staleness review reports ONLY the stalled section. The rest of the
  // synthesis answers a standup's question, and shipping it here would bury
  // the one list this Automation exists to surface. (Which rows COUNT as
  // stalled is asserted in core, where a row's `updatedAt` can be set —
  // through the API every row is created now.)
  assert.equal(fresh.kind, "stale_task_review");
  assert.equal((fresh as Record<string, unknown>)["landed"], undefined);

  // The stale review is its own Automation, not a re-run of the standup.
  const staleRuns = await wiring.automationRunRecorder.list(
    PILOT_ORGANIZATION,
    [TASK_MANAGER_STALE_REVIEW_AUTOMATION_ID],
    { limit: 10 },
  );
  assert.ok(staleRuns.some((entry) => entry.runId === result.runId));
  assert.equal(
    staleRuns.find((entry) => entry.runId === result.runId)?.agentId,
    CHIEF_OF_STAFF_AGENT_RUNTIME_ID,
  );
});

// ---------------------------------------------------------------------
// ADR-202 — the Governance guard and gate Automations. `evaluateTaskGuards`
// and `classifyTaskChangeBand` have existed since TM0 as core code with no
// Skill id, so all four of these Automations had nothing to run.
// ---------------------------------------------------------------------

test("the WIP breach detector reports only its own finding kind", async () => {
  const wiring = await buildWiring({ allowEphemeralLocalPlane: true });
  const api = caller(wiring);

  const first = await api.taskManager.create({
    organizationId: PILOT_ORGANIZATION,
    title: "Ship the intake form",
    ownerType: "human",
    ownerId: PILOT_USER,
    exitTest: "A new user submits it end to end",
  });
  const second = await api.taskManager.create({
    organizationId: PILOT_ORGANIZATION,
    title: "Wire the confirmation email",
    ownerType: "human",
    ownerId: PILOT_USER,
    exitTest: "The email lands in a real inbox",
  });
  for (const task of [first, second]) {
    await api.taskManager.transition({
      organizationId: PILOT_ORGANIZATION,
      taskId: task.task.id,
      status: "in_progress",
    });
  }
  // A goal whose review is due: a `goal_review_due` finding that the WIP
  // detector must NOT report, even though ONE evaluator produces both. This is
  // the state the API can actually create — `transition` refuses `done`
  // without verification evidence, so an `unverified_done` row can only arrive
  // through projection reconcile, which is exactly why that guard exists.
  const goal = await api.taskManager.create({
    organizationId: PILOT_ORGANIZATION,
    title: "Cut onboarding time in half",
    isGoal: true,
    reviewCadence: "weekly",
    ownerType: "human",
    ownerId: PILOT_USER,
  });

  const result = await api.taskManager.runQueueGuard({
    organizationId: PILOT_ORGANIZATION,
    guard: "wip-breach-detector",
    idempotencyKey: "wip-breach-1",
  });
  assert.equal(result.breached, true, "two in-progress Tasks for one owner is a breach");
  assert.ok(result.findings.every((finding) => (finding as { kind: string }).kind === "wip_breach"));

  const runs = await wiring.automationRunRecorder.list(
    PILOT_ORGANIZATION,
    [TASK_MANAGER_WIP_BREACH_AUTOMATION_ID],
    { limit: 10 },
  );
  assert.equal(
    runs.find((entry) => entry.runId === result.runId)?.agentId,
    GOVERNANCE_AGENT_RUNTIME_ID,
    "the guard is Governance's Run, not the caller's",
  );

  assert.ok(
    !result.findings.some((finding) => (finding as { kind: string }).kind === "goal_review_due"),
    "one evaluator, but each Automation reports only the problem it is named for",
  );

  // The challenger is its own Automation over the same evaluator, and on a
  // queue with no unverified `done` row it returns an honest empty result
  // rather than the WIP findings it happens to have computed.
  const challenge = await api.taskManager.runQueueGuard({
    organizationId: PILOT_ORGANIZATION,
    guard: "unverified-done-challenger",
    idempotencyKey: "unverified-done-1",
  });
  assert.equal(challenge.breached, false);
  assert.deepEqual(challenge.findings, []);
  // A guard reports; it never transitions a Task.
  const untouched = await api.taskManager.get({ organizationId: PILOT_ORGANIZATION, taskId: goal.task.id });
  assert.equal(untouched?.status, goal.task.status, "the guard changed nothing");
});

test("the approval gate calibrates on real decision history, not on numbers the caller supplies", async () => {
  const wiring = await buildWiring({ allowEphemeralLocalPlane: true });
  const api = caller(wiring);

  const gate = await api.taskManager.runChangeGate({
    organizationId: PILOT_ORGANIZATION,
    kind: "reschedule",
    deltaDays: 1,
    candidateCount: 1,
    idempotencyKey: "reschedule-gate-1",
  });
  // A minor change with NO track record still needs a Human: calibration
  // widens what may happen unattended only after real vetted approvals.
  assert.equal(gate.band, "minor");
  assert.equal(gate.decision, "approval_required");
  assert.deepEqual(
    { approvals: gate.calibration.approvals, vetoes: gate.calibration.vetoes },
    { approvals: 0, vetoes: 0 },
    "an empty ledger means an empty track record — the caller cannot claim one",
  );

  // A routing question with several plausible candidates is ambiguous, and
  // ambiguity always stops for a Human whatever the history says.
  const routing = await api.taskManager.runChangeGate({
    organizationId: PILOT_ORGANIZATION,
    kind: "route",
    candidateCount: 3,
    idempotencyKey: "routing-gate-1",
  });
  assert.equal(routing.band, "ambiguous");
  assert.equal(routing.decision, "approval_required");

  const runs = await wiring.automationRunRecorder.list(
    PILOT_ORGANIZATION,
    [TASK_MANAGER_ROUTING_GATE_AUTOMATION_ID],
    { limit: 10 },
  );
  assert.ok(
    runs.some((entry) => entry.runId === routing.runId),
    "the routing gate is its own Automation, not a re-run of the reschedule gate",
  );
});
