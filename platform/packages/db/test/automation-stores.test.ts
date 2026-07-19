import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { FixedClock, SeededRng, UuidGen, type RunCtx } from "@bridge/core";
import {
  createLocalDb,
  DrizzleAutomationRegistry,
  DrizzleAutomationRunRecorder,
  schema,
} from "../src/index.js";

const validStep = {
  skill: "test_fixture_send_note",
  action: "write" as const,
  resourceType: "touchpoint" as const,
};

function runCtx(): RunCtx {
  const clock = new FixedClock("2026-07-20T00:00:00.000Z");
  const rng = new SeededRng(7);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

async function seedWorkspace(db: Awaited<ReturnType<typeof createLocalDb>>["db"], suffix: string) {
  const [organization] = await db
    .insert(schema.workspaces)
    .values({ name: `test_fixture_automation_${suffix}` })
    .returning({ id: schema.workspaces.id });
  assert.ok(organization);
  return organization.id;
}

async function seedAgent(
  db: Awaited<ReturnType<typeof createLocalDb>>["db"],
  workspaceId: string,
) {
  const [agent] = await db
    .insert(schema.agents)
    .values({ workspaceId, name: "test_fixture_automation_owner" })
    .returning({ id: schema.agents.id });
  assert.ok(agent);
  return agent.id;
}

test("Automation store validates steps at write and read boundaries", async () => {
  const { db, close } = await createLocalDb();
  try {
    const workspaceId = await seedWorkspace(db, "validation");
    const agentId = await seedAgent(db, workspaceId);
    const registry = new DrizzleAutomationRegistry(db);
    const automationId = "b0000000-0000-4000-a000-0000000000f1";

    await registry.save({
      id: automationId,
      workspaceId,
      name: "Validated Automation",
      agentId,
      agentPlane: "local",
      steps: [],
    });

    await assert.rejects(
      () =>
        registry.saveSteps(workspaceId, automationId, [
          { skill: "test_fixture_bad_step", resourceType: "touchpoint" },
        ]),
      /Invalid Automation skill_pipeline jsonb/,
    );
    assert.deepEqual((await registry.load(workspaceId, automationId))?.steps, []);

    await db
      .update(schema.automations)
      .set({
        skillPipeline: [
          {
            skill: "test_fixture_bad_step",
            action: "not-an-action",
            resourceType: "touchpoint",
          },
        ],
      })
      .where(eq(schema.automations.id, automationId));
    await assert.rejects(
      () => registry.load(workspaceId, automationId),
      /Invalid Automation skill_pipeline jsonb/,
    );
  } finally {
    await close();
  }
});

test("Automation store round-trips one owning Agent and rejects cross-organization ownership", async () => {
  const { db, close } = await createLocalDb();
  try {
    const workspaceId = await seedWorkspace(db, "owner");
    const otherWorkspaceId = await seedWorkspace(db, "foreign");
    const agentId = await seedAgent(db, workspaceId);
    const foreignAgentId = await seedAgent(db, otherWorkspaceId);
    const registry = new DrizzleAutomationRegistry(db);
    const automationId = "b0000000-0000-4000-a000-0000000000f2";

    await registry.save({
      id: automationId,
      workspaceId,
      name: "Owned Automation",
      agentId,
      agentPlane: "cloud",
      steps: [validStep],
    });
    const loaded = await registry.load(workspaceId, automationId);
    assert.equal(loaded?.agentId, agentId);
    assert.equal(loaded?.agentPlane, "cloud");
    assert.deepEqual(loaded?.steps, [validStep]);

    await assert.rejects(
      () =>
        registry.save({
          id: "b0000000-0000-4000-a000-0000000000f3",
          workspaceId,
          name: "Cross-organization Automation",
          agentId: foreignAgentId,
          agentPlane: "local",
          steps: [validStep],
        }),
      /owning Agent must belong to the Automation workspace/,
    );
  } finally {
    await close();
  }
});

test("Automation Run records retain Agent attribution and organization scope", async () => {
  const { db, close } = await createLocalDb();
  try {
    const workspaceId = await seedWorkspace(db, "run");
    const otherWorkspaceId = await seedWorkspace(db, "run_foreign");
    const agentId = await seedAgent(db, workspaceId);
    const automationId = "b0000000-0000-4000-a000-0000000000f4";
    const runId = "b0000000-0000-4000-a000-0000000000f5";
    const registry = new DrizzleAutomationRegistry(db);
    const recorder = new DrizzleAutomationRunRecorder(db);

    await registry.save({
      id: automationId,
      workspaceId,
      name: "Recorded Automation",
      agentId,
      agentPlane: "local",
      steps: [validStep],
    });
    await recorder.start({ runId, automationId, workspaceId, agentId }, runCtx());
    await assert.rejects(
      () =>
        recorder.finish(
          { runId, workspaceId: otherWorkspaceId, status: "completed", output: {} },
          runCtx(),
        ),
      /not found in organization/,
    );
    await recorder.finish(
      { runId, workspaceId, status: "completed", output: { steps: 1 } },
      runCtx(),
    );

    const [stored] = await db
      .select()
      .from(schema.automationRuns)
      .where(eq(schema.automationRuns.id, runId));
    assert.equal(stored?.automationId, automationId);
    assert.equal(stored?.agentId, agentId);
    assert.equal(stored?.workspaceId, workspaceId);
    assert.equal(stored?.status, "completed");
  } finally {
    await close();
  }
});
