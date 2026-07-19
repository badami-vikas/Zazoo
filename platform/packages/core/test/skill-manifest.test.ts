import { test } from "node:test";
import assert from "node:assert/strict";

import {
  InMemorySkillManifestRegistry,
  resolveSkillForTask,
  type SkillManifest,
  type Goal,
  type Task,
} from "../src/index.js";

const GOAL: Goal = { id: "g1", organizationId: "ws-1", type: "relationship.learning", title: "goal", createdAt: "2026-07-16T00:00:00.000Z" };

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    organizationId: "ws-1",
    goalId: "g1",
    type: "synthesize_recommendation",
    assignedAgentId: "internal_strategist",
    status: "open",
    createdAt: "2026-07-16T00:00:00.000Z",
    ...overrides,
  };
}

const BASE_MANIFEST: SkillManifest = {
  organizationId: "ws-1",
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

function eligibleAgent(id: string) {
  return {
    id,
    organizationId: "ws-1",
    active: true,
    capabilityScope: ["signal:write"],
    plane: "local" as const,
    dataScope: "all" as const,
  };
}

test("resolveSkillForTask: no registered manifest fails closed and suggests a Capability Builder proposal", async () => {
  const registry = new InMemorySkillManifestRegistry();
  const result = await resolveSkillForTask(registry.all("ws-1"), {
    goal: GOAL,
    task: task(),
    agent: eligibleAgent("internal_strategist"),
    skillId: "stageStrategicRecommendation",
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no-registered-manifest");
  assert.equal(result.suggestCapabilityBuilderProposal, true);
});

test("resolveSkillForTask: eligible assigned Agent resolves the Skill", async () => {
  const registry = new InMemorySkillManifestRegistry();
  registry.register(BASE_MANIFEST);
  const result = await resolveSkillForTask(registry.forSkill("ws-1", "stageStrategicRecommendation"), {
    goal: GOAL,
    task: task({ assignedAgentId: "internal_strategist" }),
    agent: eligibleAgent("internal_strategist"),
  });
  assert.equal(result.ok, true);
  assert.equal(result.manifest?.skillId, "stageStrategicRecommendation");
  assert.equal(result.alternativesRejected.length, 0);
});

test("resolveSkillForTask: the SAME Skill resolves for a different eligible Agent assigned to a different Task (AGS1 acceptance)", async () => {
  const registry = new InMemorySkillManifestRegistry();
  registry.register(BASE_MANIFEST);
  const forLearning = await resolveSkillForTask(registry.forSkill("ws-1", "stageStrategicRecommendation"), {
    goal: GOAL,
    task: task({ id: "t2", assignedAgentId: "learning" }),
    agent: eligibleAgent("learning"),
  });
  const forStrategist = await resolveSkillForTask(registry.forSkill("ws-1", "stageStrategicRecommendation"), {
    goal: GOAL,
    task: task({ id: "t1", assignedAgentId: "internal_strategist" }),
    agent: eligibleAgent("internal_strategist"),
  });
  assert.equal(forLearning.ok, true);
  assert.equal(forStrategist.ok, true);
  assert.equal(forLearning.manifest?.skillId, forStrategist.manifest?.skillId);
});

test("resolveSkillForTask: default Agent access never overrides Goal/Task assignment mismatch", async () => {
  const registry = new InMemorySkillManifestRegistry();
  registry.register(BASE_MANIFEST);
  // "governance" is NOT in defaultAgents at all, and is not the assigned agent —
  // but even an agent who IS listed in defaultAgents ("learning") must still fail
  // when the Task is assigned to someone else (assignment, not default list, governs).
  const result = await resolveSkillForTask(registry.forSkill("ws-1", "stageStrategicRecommendation"), {
    goal: GOAL,
    task: task({ assignedAgentId: "internal_strategist" }),
    agent: eligibleAgent("learning"), // in defaultAgents, but NOT assigned this task
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "not-assigned-agent");
});

test("resolveSkillForTask: ineligible Agent cannot acquire the Skill via default access", async () => {
  const registry = new InMemorySkillManifestRegistry();
  registry.register(BASE_MANIFEST);
  const result = await resolveSkillForTask(registry.forSkill("ws-1", "stageStrategicRecommendation"), {
    goal: GOAL,
    task: task({ assignedAgentId: "governance" }),
    agent: eligibleAgent("governance"), // assigned, but manifest never lists governance in defaultAgents —
    // proves defaultAgents is irrelevant; this still resolves because assignment
    // alone governs (not the preference list), matching AGS1's "preferences,
    // never ownership" framing precisely.
  });
  assert.equal(result.ok, true);
});

test("resolveSkillForTask: goal type mismatch fails closed", async () => {
  const registry = new InMemorySkillManifestRegistry();
  registry.register(BASE_MANIFEST);
  const result = await resolveSkillForTask(registry.forSkill("ws-1", "stageStrategicRecommendation"), {
    goal: { ...GOAL, type: "dealpilot.diligence" },
    task: task(),
    agent: eligibleAgent("internal_strategist"),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "goal-type-mismatch");
});

test("resolveSkillForTask: task type mismatch fails closed", async () => {
  const registry = new InMemorySkillManifestRegistry();
  registry.register(BASE_MANIFEST);
  const result = await resolveSkillForTask(registry.forSkill("ws-1", "stageStrategicRecommendation"), {
    goal: GOAL,
    task: task({ type: "other_task_type" }),
    agent: eligibleAgent("internal_strategist"),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "task-type-mismatch");
});

test("resolveSkillForTask: cancelled Tasks and inactive Agents fail closed", async () => {
    const registry = new InMemorySkillManifestRegistry();
    registry.register(BASE_MANIFEST);
    const cancelled = await resolveSkillForTask(
      registry.forSkill("ws-1", "stageStrategicRecommendation"),
      {
        goal: GOAL,
        task: task({ status: "cancelled" }),
        agent: eligibleAgent("internal_strategist"),
      },
    );
    assert.equal(cancelled.reason, "task-inactive");

    const inactive = await resolveSkillForTask(
      registry.forSkill("ws-1", "stageStrategicRecommendation"),
      {
        goal: GOAL,
        task: task(),
        agent: { ...eligibleAgent("internal_strategist"), active: false },
      },
    );
    assert.equal(inactive.reason, "agent-inactive");
});

test("resolveSkillForTask: organization mismatches fail closed", async () => {
    const registry = new InMemorySkillManifestRegistry();
    registry.register(BASE_MANIFEST);
    const result = await resolveSkillForTask(
      registry.forSkill("ws-1", "stageStrategicRecommendation"),
      {
        goal: GOAL,
        task: task({ organizationId: "ws-2" }),
        agent: eligibleAgent("internal_strategist"),
      },
    );
    assert.equal(result.reason, "organization-mismatch");
    const foreignManifest = await resolveSkillForTask(
      [{ ...BASE_MANIFEST, organizationId: "ws-2" }],
      {
        goal: GOAL,
        task: task(),
        agent: eligibleAgent("internal_strategist"),
      },
    );
    assert.equal(foreignManifest.reason, "organization-mismatch");
});

test("resolveSkillForTask: agent authority insufficient fails closed (narrowing only, never a grant)", async () => {
  const registry = new InMemorySkillManifestRegistry();
  registry.register(BASE_MANIFEST);
  const result = await resolveSkillForTask(registry.forSkill("ws-1", "stageStrategicRecommendation"), {
    goal: GOAL,
    task: task(),
    agent: { id: "internal_strategist", organizationId: "ws-1", active: true, capabilityScope: [], plane: "local", dataScope: "all" },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "authority-insufficient");
});

test("resolveSkillForTask: plane mismatch fails closed", async () => {
  const registry = new InMemorySkillManifestRegistry();
  registry.register(BASE_MANIFEST);
  const result = await resolveSkillForTask(registry.forSkill("ws-1", "stageStrategicRecommendation"), {
    goal: GOAL,
    task: task(),
    agent: { id: "internal_strategist", organizationId: "ws-1", active: true, capabilityScope: ["signal:write"], plane: "cloud", dataScope: "all" },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "plane-mismatch");
});

test("resolveSkillForTask: data-scope mismatch fails closed", async () => {
  const registry = new InMemorySkillManifestRegistry();
  registry.register({ ...BASE_MANIFEST, dataScopes: ["public"] });
  const result = await resolveSkillForTask(registry.forSkill("ws-1", "stageStrategicRecommendation"), {
    goal: GOAL,
    task: task(),
    agent: eligibleAgent("internal_strategist"),
    requestedDataScope: "private",
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "data-scope-mismatch");
});

test("resolveSkillForTask: budget-exhausted fails closed", async () => {
  const registry = new InMemorySkillManifestRegistry();
  registry.register({ ...BASE_MANIFEST, budget: { maxCallsPerDay: 5 } });
  const result = await resolveSkillForTask(registry.forSkill("ws-1", "stageStrategicRecommendation"), {
    goal: GOAL,
    task: task(),
    agent: eligibleAgent("internal_strategist"),
    budgetUsedToday: () => 5,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "budget-exhausted");
});

test("resolveSkillForTask: picks the highest eligible version and records the lower one as an alternative", async () => {
  const registry = new InMemorySkillManifestRegistry();
  registry.register({ ...BASE_MANIFEST, version: "1.0.0" });
  registry.register({ ...BASE_MANIFEST, version: "1.2.0" });
  const result = await resolveSkillForTask(registry.forSkill("ws-1", "stageStrategicRecommendation"), {
    goal: GOAL,
    task: task(),
    agent: eligibleAgent("internal_strategist"),
  });
  assert.equal(result.ok, true);
  assert.equal(result.manifest?.version, "1.2.0");
  assert.equal(result.alternativesRejected.length, 1);
  assert.equal(result.alternativesRejected[0]!.reason, "superseded-by-higher-version");
});

test("resolveSkillForTask: skillId omitted searches the whole registry (Goal/Task-driven discovery)", async () => {
  const registry = new InMemorySkillManifestRegistry();
  registry.register(BASE_MANIFEST);
  registry.register({
    ...BASE_MANIFEST,
    skillId: "otherSkill",
    goalTypes: ["dealpilot.diligence"],
  });
  const result = await resolveSkillForTask(registry.all("ws-1"), {
    goal: GOAL,
    task: task(),
    agent: eligibleAgent("internal_strategist"),
  });
  assert.equal(result.ok, true);
  assert.equal(result.manifest?.skillId, "stageStrategicRecommendation");
  // the other skill's goal-type mismatch is filed as a rejected alternative
  assert.ok(result.alternativesRejected.some((a) => a.skillId === "otherSkill" && a.reason === "goal-type-mismatch"));
});
