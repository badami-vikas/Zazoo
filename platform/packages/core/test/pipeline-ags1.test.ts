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
  InMemoryRitualRegistry,
  InProcessRitualExecutor,
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
  workspaceId: WS,
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

function freshCtx(startISO = "2026-06-01T00:00:00.000Z", seed = 42): RunCtx {
  const clock = new FixedClock(startISO);
  const rng = new SeededRng(seed);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

async function seedGoalTask(h: ReturnType<typeof harness>, assignedAgentId: string): Promise<{ goal: Goal; task: Task }> {
  const seam = { nextId: () => "id-" + Math.random().toString(36).slice(2), nowISO: () => "2026-07-16T00:00:00.000Z" };
  const goal = await h.goalTasks.createGoal({ workspaceId: WS, type: "relationship.learning", title: "goal" }, seam);
  const task = await h.goalTasks.createTask(
    { workspaceId: WS, goalId: goal.id, type: "synthesize_recommendation", assignedAgentId },
    seam,
  );
  return { goal, task };
}

/** Grants base authority for "signal:write" to an Agent (capability_scope ceiling
 * AND an assumed-role allow grant — both are required by authority.ts's Layer 1
 * before an agent actor's request even reaches the pipeline's AGS1 gate). */
function authorizeAgent(h: ReturnType<typeof harness>, agentId: string): void {
  h.agents.workspaces.set(agentId, WS);
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
    workspaceId: WS,
    actor: { type: "agent", id: "internal_strategist" },
    action: "write",
    resourceType: "signal",
    inputs: { text: "recommendation" },
    skill: "stageStrategicRecommendation",
    ...partial,
  };
}

test("AGS1: a Human actor directly invoking a governed skill fails closed", async () => {
  const h = harness();
  authorizePrincipal(h, "user", "human-1");
  const { task } = await seedGoalTask(h, "internal_strategist");
  const p = await h.pipeline.propose(
    req({ actor: { type: "user", id: "human-1" }, goalTaskRef: { goalId: task.goalId, taskId: task.id } }),
    freshCtx(),
  );
  assert.equal(p.status, "rejected");
  assert.match(p.rejectionReason ?? "", /may only be invoked by an eligible Agent Run/);
  // Still audited (append-only), even a rejected direct-invocation attempt.
  assert.equal(h.ledger.entries.length, 1);
});

test("AGS1: a Team actor (Automation-shaped) directly invoking a governed skill fails closed", async () => {
  const h = harness();
  authorizePrincipal(h, "team", "automation-1");
  const { task } = await seedGoalTask(h, "internal_strategist");
  const p = await h.pipeline.propose(
    req({ actor: { type: "team", id: "automation-1" }, goalTaskRef: { goalId: task.goalId, taskId: task.id } }),
    freshCtx(),
  );
  assert.equal(p.status, "rejected");
  assert.match(p.rejectionReason ?? "", /may only be invoked by an eligible Agent Run/);
});

test("AGS1: an Agent invoking a governed skill with no goalTaskRef fails closed", async () => {
  const h = harness();
  authorizeAgent(h, "internal_strategist");
  const p = await h.pipeline.propose(req({}), freshCtx());
  assert.equal(p.status, "rejected");
  assert.match(p.rejectionReason ?? "", /requires a resolved Goal\/Task assignment/);
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

test("AGS1: an eligible assigned Agent resolves the governed skill and drafts (still agent-always-approves)", async () => {
  const h = harness();
  authorizeAgent(h, "internal_strategist");
  const { task } = await seedGoalTask(h, "internal_strategist");
  const p = await h.pipeline.propose(
    req({ goalTaskRef: { goalId: task.goalId, taskId: task.id } }),
    freshCtx(),
  );
  assert.equal(p.status, "pending_review"); // agents always draft — existing invariant unaffected
  assert.equal(h.events.events.length, 0);
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
  assert.match(proposal.rejectionReason ?? "", /resolution failed: agent-inactive/);
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
  // capability.approve/blueprint.activate/packages.install's real shape: a Human
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
// Reconciled Automation→declared-Agent-Run integration: an Automation (Ritual)
// does NOT get a second, parallel actor-binding mechanism — a Ritual step
// whose skill has a registered manifest resolves through the SAME
// `resolveSkillForTask` gate a direct Agent call would, using the step's own
// `goalTaskRef` (RitualStepDef.goalTaskRef, threaded unchanged by
// InProcessRitualExecutor into `pipeline.propose`).
// ---------------------------------------------------------------------------
test("Automation/Ritual integration: a Ritual step whose declared Agent is eligible for its Task resolves the governed skill", async () => {
  const h = harness();
  authorizeAgent(h, "internal_strategist");
  const { task } = await seedGoalTask(h, "internal_strategist");
  const ritualRegistry = new InMemoryRitualRegistry();
  ritualRegistry.register({
    id: "ritual-1",
    name: "test_fixture automation",
    workspaceId: WS,
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
  const executor = new InProcessRitualExecutor(h.pipeline, { registry: ritualRegistry });
  const result = await executor.runById(
    { workspaceId: WS, ritualId: "ritual-1", actor: { type: "agent", id: "internal_strategist" } },
    freshCtx(),
  );
  assert.equal(result.status, "completed");
  assert.equal(result.proposals[0]!.status, "pending_review"); // agents always draft
});

test("Automation/Ritual integration: a Ritual step targeting a governed skill with NO goalTaskRef halts (fails closed), never silently skipped", async () => {
  const h = harness();
  authorizeAgent(h, "internal_strategist");
  const ritualRegistry = new InMemoryRitualRegistry();
  ritualRegistry.register({
    id: "ritual-2",
    name: "test_fixture automation missing goalTaskRef",
    workspaceId: WS,
    agentId: "internal_strategist",
    agentPlane: "local",
    steps: [
      { skill: "stageStrategicRecommendation", action: "write", resourceType: "signal", inputs: { text: "x" } },
    ],
  });
  const executor = new InProcessRitualExecutor(h.pipeline, { registry: ritualRegistry });
  const result = await executor.runById(
    { workspaceId: WS, ritualId: "ritual-2", actor: { type: "agent", id: "internal_strategist" } },
    freshCtx(),
  );
  assert.equal(result.status, "halted");
  assert.match(result.proposals[0]!.rejectionReason ?? "", /requires a resolved Goal\/Task assignment/);
});

test("Automation/Ritual integration: a Human caller cannot replace the declared owning Agent", async () => {
  const h = harness();
  authorizePrincipal(h, "user", "human-1");
  const { task } = await seedGoalTask(h, "internal_strategist");
  const ritualRegistry = new InMemoryRitualRegistry();
  ritualRegistry.register({
    id: "ritual-3",
    name: "test_fixture automation rejects human caller",
    workspaceId: WS,
    agentId: "internal_strategist",
    agentPlane: "local",
    steps: [
      {
        skill: "stageStrategicRecommendation",
        action: "write",
        resourceType: "signal",
        inputs: { text: "x" },
        goalTaskRef: { goalId: task.goalId, taskId: task.id },
      },
    ],
  });
  const executor = new InProcessRitualExecutor(h.pipeline, { registry: ritualRegistry });
  await assert.rejects(
    () =>
      executor.runById(
        { workspaceId: WS, ritualId: "ritual-3", actor: { type: "user", id: "human-1" } },
        freshCtx(),
      ),
    /caller actor does not match owning Agent internal_strategist/,
  );
});
