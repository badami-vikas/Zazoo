import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FixedClock,
  SeededRng,
  UuidGen,
  UniversalActionPipeline,
  InMemoryRoleStore,
  InMemoryAgentStore,
  InMemoryEphemeralStore,
  InMemoryPolicyStore,
  InMemoryLedger,
  InMemoryEventBus,
  InMemorySkillRegistry,
  RecordingVarianceAdjuster,
  InMemoryGoalTaskStore,
  InMemorySkillManifestRegistry,
  InMemoryAutomationRegistry,
  InProcessAutomationExecutor,
  hashTaintValue,
  labelAtSource,
  type RunCtx,
  type ActionRequest,
  type Skill,
  type SkillManifest,
  type Goal,
  type Task,
} from "../src/index.js";

const WS = "ws-1";

const stageStrategicRecommendation: Skill = {
  name: "stageStrategicRecommendation",
  async run(inputs) {
    return { proposedOutput: inputs, diff: { to: inputs } };
  },
};

const GOVERNED_MANIFEST: SkillManifest = {
  organizationId: WS,
  skillId: "stageStrategicRecommendation",
  version: "1.0.0",
  goalTypes: ["relationship.learning"],
  taskTypes: ["synthesize_recommendation"],
  permissions: ["signal:write"],
  plane: "local",
  dataScopes: ["all"],
  riskBand: "advisory",
  evalVersion: "1.0.0",
  defaultAgents: ["learning", "internal_strategist"],
};

function harness() {
  const roles = new InMemoryRoleStore();
  const agents = new InMemoryAgentStore();
  const ephemeral = new InMemoryEphemeralStore();
  const policies = new InMemoryPolicyStore([]);
  const ledger = new InMemoryLedger();
  const events = new InMemoryEventBus();
  const skills = new InMemorySkillRegistry().register(stageStrategicRecommendation);
  const variance = new RecordingVarianceAdjuster();
  const goalTasks = new InMemoryGoalTaskStore();
  const skillManifests = new InMemorySkillManifestRegistry();
  skillManifests.register(GOVERNED_MANIFEST);

  const pipeline = new UniversalActionPipeline({
    authority: { roles, agents, ephemeral, nowISO: "" },
    policies,
    skills,
    ledger,
    events,
    variance,
    skillManifests,
    goalTasks,
  });

  return { roles, agents, ephemeral, policies, ledger, events, skills, variance, goalTasks, skillManifests, pipeline };
}

/**
 * Mirrors context.ts's `makeContextFactory`, which attaches a `human_input`-derived
 * taintLabel to `ctx.run` for every authenticated request. These AGS1 harness tests
 * build the RunCtx directly (bypassing that factory), so they must reproduce the SAME
 * label a genuine authenticated request always carries — otherwise ADR-142's
 * fail-closed unknown-taint-axis quarantine (taint.ts's `evaluateTaintSink`)
 * misclassifies a real authenticated turn as unlabeled/untrusted and blocks the
 * `skill_execution` sink for every governed skill (none of which set
 * `executionClass: "pure_data"`).
 */
function freshCtx(startISO = "2026-06-01T00:00:00.000Z", seed = 42): RunCtx {
  const clock = new FixedClock(startISO);
  const rng = new SeededRng(seed);
  return {
    clock,
    rng,
    ids: new UuidGen(clock, rng),
    taintLabel: labelAtSource("human_input", {
      ref: "test-fixture:authenticated-caller",
      valueHash: hashTaintValue("test-fixture-authenticated-caller"),
      sensitivity: "organization",
      instructionRisk: "none",
    }),
  };
}

async function seedGoalTask(h: ReturnType<typeof harness>, assignedAgentId: string): Promise<{ goal: Goal; task: Task }> {
  const seam = { nextId: () => "id-" + Math.random().toString(36).slice(2), nowISO: () => "2026-07-16T00:00:00.000Z" };
  const goal = await h.goalTasks.createGoal({ organizationId: WS, type: "relationship.learning", title: "goal" }, seam);
  const task = await h.goalTasks.createTask(
    { organizationId: WS, goalId: goal.id, type: "synthesize_recommendation", assignedAgentId },
    seam,
  );
  return { goal, task };
}

/** Grants base authority for "signal:write" to an Agent (capability_scope ceiling
 * AND an assumed-role allow grant — both are required by authority.ts's Layer 1
 * before an agent actor's request even reaches the pipeline's AGS1 gate). */
function authorizeAgent(h: ReturnType<typeof harness>, agentId: string): void {
  h.agents.organizations.set(agentId, WS);
  h.agents.statuses.set(agentId, "active");
  h.agents.scope.set(agentId, ["signal:write"]);
  h.agents.assumed.set(agentId, `role-${agentId}`);
  h.roles.roleGrants.set(`role-${agentId}`, [
    { resourceType: "signal", resourceId: null, action: "write", effect: "allow" },
  ]);
}

/** Grants base authority for "signal:write" to a human/team principal — used only
 * to prove the AGS1 gate itself (not the base authority layer) is what rejects a
 * direct non-Agent invocation of a governed skill. */
function authorizePrincipal(h: ReturnType<typeof harness>, actorType: "user" | "team", id: string): void {
  h.roles.direct.set(`${actorType}:${id}`, [
    { resourceType: "signal", resourceId: null, action: "write", effect: "allow" },
  ]);
}

function req(partial: Partial<ActionRequest>): ActionRequest {
  return {
    organizationId: WS,
    actor: { type: "agent", id: "internal_strategist" },
    action: "write",
    resourceType: "signal",
    inputs: { text: "recommendation" },
    skill: "stageStrategicRecommendation",
    ...partial,
  };
}

/** AP-182: the Agent-only rule and the Goal/Task ceremony are FLAGS. The Run
 * proceeds; the ledger row carries a `governance.flag` policy result. */
function governanceFlags(p: { policyResults: Array<{ policyId: string; reason: string }> }): string[] {
  return p.policyResults.filter((r) => r.policyId === "governance.flag").map((r) => r.reason);
}

test("AGS1/AP-182: a Human actor directly invoking a governed skill is flagged, not refused", async () => {
  const h = harness();
  authorizePrincipal(h, "user", "human-1");
  const { task } = await seedGoalTask(h, "internal_strategist");
  const p = await h.pipeline.propose(
    req({ actor: { type: "user", id: "human-1" }, goalTaskRef: { goalId: task.goalId, taskId: task.id } }),
    freshCtx(),
  );
  assert.equal(p.status, "applied");
  assert.match(governanceFlags(p).join("\n"), /invoked directly by a user actor/);
  // Audited: one ledger row, carrying the flag.
  assert.equal(h.ledger.entries.length, 1);
  assert.ok(h.ledger.entries[0]!.policyResults.some((r) => r.policyId === "governance.flag"));
});

test("AGS1/AP-182: a Team actor (Automation-shaped) directly invoking a governed skill is flagged", async () => {
  const h = harness();
  authorizePrincipal(h, "team", "automation-1");
  const { task } = await seedGoalTask(h, "internal_strategist");
  const p = await h.pipeline.propose(
    req({ actor: { type: "team", id: "automation-1" }, goalTaskRef: { goalId: task.goalId, taskId: task.id } }),
    freshCtx(),
  );
  assert.notEqual(p.status, "rejected");
  assert.match(governanceFlags(p).join("\n"), /invoked directly by a team actor/);
});

test("AGS1/AP-182: an Agent invoking a governed skill with no goalTaskRef is flagged and still drafts (advisory band)", async () => {
  const h = harness();
  authorizeAgent(h, "internal_strategist");
  const p = await h.pipeline.propose(req({}), freshCtx());
  assert.equal(p.status, "pending_review");
  assert.match(governanceFlags(p).join("\n"), /without a Goal\/Task assignment/);
});

test("AGS1/AP-182: an informational-band governed skill auto-applies for an Agent, audited", async () => {
  const h = harness();
  authorizeAgent(h, "internal_strategist");
  h.skillManifests.register({ ...GOVERNED_MANIFEST, version: "1.1.0", riskBand: "informational" });
  const { task } = await seedGoalTask(h, "internal_strategist");
  const p = await h.pipeline.propose(
    req({ goalTaskRef: { goalId: task.goalId, taskId: task.id } }),
    freshCtx(),
  );
  assert.equal(p.status, "applied");
  assert.ok(p.policyResults.some((r) => r.policyId === "governance.auto-apply" && /informational/.test(r.reason)));
  assert.equal(h.ledger.entries.at(-1)!.userDecision, "auto");
});

test("AGS1/AP-182: an unknown or mismatched Goal/Task is flagged, not refused", async () => {
  const h = harness();
  authorizeAgent(h, "internal_strategist");
  const p = await h.pipeline.propose(req({ goalTaskRef: { goalId: "no-such-goal", taskId: "no-such-task" } }), freshCtx());
  assert.notEqual(p.status, "rejected");
  assert.match(governanceFlags(p).join("\n"), /unknown or mismatched Goal\/Task/);
});

test("AGS1/AP-182: an inactive Agent is still refused without a Task (the kill switch is a gate, not a flag)", async () => {
  const h = harness();
  authorizeAgent(h, "internal_strategist");
  h.agents.statuses.delete("internal_strategist");
  const p = await h.pipeline.propose(req({}), freshCtx());
  assert.equal(p.status, "rejected");
  assert.match(p.rejectionReason ?? "", /agent-inactive/);
});

test("AGS1: an Agent not assigned the Task fails closed even though it holds capability scope", async () => {
  const h = harness();
  authorizeAgent(h, "internal_strategist");
  const { task } = await seedGoalTask(h, "learning"); // assigned to a DIFFERENT agent
  const p = await h.pipeline.propose(
    req({ goalTaskRef: { goalId: task.goalId, taskId: task.id } }),
    freshCtx(),
  );
  assert.equal(p.status, "rejected");
  assert.match(p.rejectionReason ?? "", /resolution failed: not-assigned-agent/);
});

test("AGS1: an eligible assigned Agent resolves the governed skill and drafts (advisory proposals are the product)", async () => {
  const h = harness();
  authorizeAgent(h, "internal_strategist");
  const { task } = await seedGoalTask(h, "internal_strategist");
  const p = await h.pipeline.propose(
    req({ goalTaskRef: { goalId: task.goalId, taskId: task.id } }),
    freshCtx(),
  );
  assert.equal(p.status, "pending_review");
  assert.deepEqual(governanceFlags(p), []);
  assert.equal(h.events.events.length, 0);
});

test("AGS1/AP-182: an operational-band governed skill still drafts for an Agent", async () => {
  const h = harness();
  authorizeAgent(h, "internal_strategist");
  h.skillManifests.register({ ...GOVERNED_MANIFEST, version: "1.1.0", riskBand: "operational" });
  const { task } = await seedGoalTask(h, "internal_strategist");
  const p = await h.pipeline.propose(
    req({ goalTaskRef: { goalId: task.goalId, taskId: task.id } }),
    freshCtx(),
  );
  assert.equal(p.status, "pending_review");
});

test("AGS1: an assigned Agent without explicit active status fails closed", async () => {
  const h = harness();
  authorizeAgent(h, "internal_strategist");
  h.agents.statuses.delete("internal_strategist");
  const { task } = await seedGoalTask(h, "internal_strategist");
  const proposal = await h.pipeline.propose(
    req({ goalTaskRef: { goalId: task.goalId, taskId: task.id } }),
    freshCtx(),
  );
  assert.equal(proposal.status, "rejected");
  assert.match(proposal.rejectionReason ?? "", /agent-inactive/); // the kill switch fires before resolution (AP-182)
});

test("AGS1: a non-default eligible Agent (assigned but not in defaultAgents) can still resolve the same governed skill", async () => {
  const h = harness();
  authorizeAgent(h, "governance");
  const { task } = await seedGoalTask(h, "governance"); // "governance" is NOT in GOVERNED_MANIFEST.defaultAgents
  const p = await h.pipeline.propose(
    req({ actor: { type: "agent", id: "governance" }, goalTaskRef: { goalId: task.goalId, taskId: task.id } }),
    freshCtx(),
  );
  assert.equal(p.status, "pending_review");
});

test("AGS1: an unregistered skill on a NON-floor-protected resourceType/action now fails closed by default (no silent pass-through)", async () => {
  const h = harness();
  h.skills.register({ name: "someNewSkill", async run(inputs) { return { proposedOutput: inputs }; } });
  h.roles.direct.set("user:human-1", [{ resourceType: "signal", resourceId: null, action: "write", effect: "allow" }]);
  const p = await h.pipeline.propose(
    req({ actor: { type: "user", id: "human-1" }, skill: "someNewSkill" }),
    freshCtx(),
  );
  assert.equal(p.status, "rejected");
  assert.match(p.rejectionReason ?? "", /has no registered SkillManifest and \(write, signal\) is not agent-floor-protected/);
});

test("AGS1: the kernel passthrough is Human-only on unprotected resources", async () => {
  const h = harness();
  h.skills.register({ name: "stageMutation", async run(inputs) { return { proposedOutput: inputs }; } });
  authorizeAgent(h, "internal_strategist");
  const proposal = await h.pipeline.propose(
    req({ skill: "stageMutation" }),
    freshCtx(),
  );
  assert.equal(proposal.status, "rejected");
  assert.match(proposal.rejectionReason ?? "", /has no registered SkillManifest/);
});

test("AGS1: an unregistered skill on an agent-floor-PROTECTED resourceType/action is structurally exempt — no manifest needed, no allowlist maintained", async () => {
  const h = harness();
  h.skills.register({ name: "stageMutation", async run(inputs) { return { proposedOutput: inputs }; } });
  // capability.approve/blueprint.activate/modules.install's real shape: a Human
  // approving something on the interim "skill" governance token — agent-floor
  // already makes (approve, skill) impossible for ANY agent, unconditionally.
  h.roles.direct.set("user:human-1", [{ resourceType: "skill", resourceId: null, action: "approve", effect: "allow" }]);
  const p = await h.pipeline.propose(
    req({ actor: { type: "user", id: "human-1" }, skill: "stageMutation", action: "approve", resourceType: "skill" }),
    freshCtx(),
  );
  // Exempt structurally (derived from agent-floor, not a maintained list) — a
  // human can invoke it directly, no goalTaskRef required.
  assert.equal(p.status, "applied");
});

test("AGS1: a NON-floor-protected skill still fails closed even though OTHER skills are structurally exempt", async () => {
  const h = harness();
  h.skills.register({ name: "someOtherSkill", async run(inputs) { return { proposedOutput: inputs }; } });
  h.roles.direct.set("user:human-1", [{ resourceType: "signal", resourceId: null, action: "write", effect: "allow" }]);
  const p = await h.pipeline.propose(
    req({ actor: { type: "user", id: "human-1" }, skill: "someOtherSkill" }),
    freshCtx(),
  );
  assert.equal(p.status, "rejected");
});

// ---------------------------------------------------------------------------
// Automation-to-declared-Agent-Run integration: an Automation
// does NOT get a second, parallel actor-binding mechanism — an Automation step
// whose skill has a registered manifest resolves through the SAME
// `resolveSkillForTask` gate a direct Agent call would, using the step's own
// `goalTaskRef` (AutomationStepDef.goalTaskRef, threaded unchanged by
// InProcessAutomationExecutor into `pipeline.propose`).
// ---------------------------------------------------------------------------
test("Automation integration: a step whose declared Agent is eligible for its Task resolves the governed Skill", async () => {
  const h = harness();
  authorizeAgent(h, "internal_strategist");
  const { task } = await seedGoalTask(h, "internal_strategist");
  const automationRegistry = new InMemoryAutomationRegistry();
  automationRegistry.register({
    id: "automation-1",
    name: "test_fixture automation",
    organizationId: WS,
    agentId: "internal_strategist",
    agentPlane: "local",
    steps: [
      {
        skill: "stageStrategicRecommendation",
        action: "write",
        resourceType: "signal",
        inputs: { text: "automation-produced recommendation" },
        goalTaskRef: { goalId: task.goalId, taskId: task.id },
      },
    ],
  });
  const executor = new InProcessAutomationExecutor(h.pipeline, { registry: automationRegistry });
  const result = await executor.runById(
    { organizationId: WS, automationId: "automation-1" },
    freshCtx(),
  );
  assert.equal(result.status, "completed");
  assert.equal(result.proposals[0]!.status, "pending_review"); // advisory drafts; only informational auto-applies (AP-182)
});

test("Automation integration/AP-182: a step targeting a governed Skill with no Goal/Task reference proceeds, flagged", async () => {
  const h = harness();
  authorizeAgent(h, "internal_strategist");
  const automationRegistry = new InMemoryAutomationRegistry();
  automationRegistry.register({
    id: "automation-2",
    name: "test_fixture automation missing goalTaskRef",
    organizationId: WS,
    agentId: "internal_strategist",
    agentPlane: "local",
    steps: [
      { skill: "stageStrategicRecommendation", action: "write", resourceType: "signal", inputs: { text: "x" } },
    ],
  });
  const executor = new InProcessAutomationExecutor(h.pipeline, { registry: automationRegistry });
  const result = await executor.runById(
    { organizationId: WS, automationId: "automation-2" },
    freshCtx(),
  );
  assert.equal(result.status, "completed");
  assert.match(governanceFlags(result.proposals[0]!).join("\n"), /without a Goal\/Task assignment/);
});
