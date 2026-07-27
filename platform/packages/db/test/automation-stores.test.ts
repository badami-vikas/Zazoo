import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  FixedClock,
  SeededRng,
  UuidGen,
  hashTaintValue,
  labelAtSource,
  type RunCtx,
} from "@bridge/core";
import {
  createLocalDb,
  DrizzleAutomationRegistry,
  DrizzleAutomationRunRecorder,
  schema,
} from "../src/index.js";

const validStep = {
  skill: "test_fixture_send_note",
  action: "write" as const,
  resourceType: "event" as const,
};

function runCtx(now = "2026-07-20T00:00:00.000Z"): RunCtx {
  const clock = new FixedClock(now);
  const rng = new SeededRng(7);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

async function seedOrganization(db: Awaited<ReturnType<typeof createLocalDb>>["db"], suffix: string) {
  const [organization] = await db
    .insert(schema.organizations)
    .values({ name: `test_fixture_automation_${suffix}` })
    .returning({ id: schema.organizations.id });
  assert.ok(organization);
  return organization.id;
}

async function seedAgent(
  db: Awaited<ReturnType<typeof createLocalDb>>["db"],
  organizationId: string,
) {
  const [agent] = await db
    .insert(schema.agents)
    .values({ organizationId, name: "test_fixture_automation_owner" })
    .returning({ id: schema.agents.id });
  assert.ok(agent);
  return agent.id;
}

test("Automation store validates steps at write and read boundaries", async () => {
  const { db, close } = await createLocalDb();
  try {
    const organizationId = await seedOrganization(db, "validation");
    const agentId = await seedAgent(db, organizationId);
    const registry = new DrizzleAutomationRegistry(db);
    const automationId = "b0000000-0000-4000-a000-0000000000f1";

    await registry.save({
      id: automationId,
      organizationId,
      name: "Validated Automation",
      agentId,
      agentPlane: "local",
      steps: [],
    });

    await assert.rejects(
      () =>
        registry.saveSteps(organizationId, automationId, [
          { skill: "test_fixture_bad_step", resourceType: "event" },
        ]),
      /Invalid Automation skill_pipeline jsonb/,
    );
    assert.deepEqual((await registry.load(organizationId, automationId))?.steps, []);

    await db
      .update(schema.automations)
      .set({
        skillPipeline: [
          {
            skill: "test_fixture_bad_step",
            action: "not-an-action",
            resourceType: "event",
          },
        ],
      })
      .where(eq(schema.automations.id, automationId));
    await assert.rejects(
      () => registry.load(organizationId, automationId),
      /Invalid Automation skill_pipeline jsonb/,
    );
  } finally {
    await close();
  }
});

test("Automation store round-trips one owning Agent and rejects cross-organization ownership", async () => {
  const { db, close } = await createLocalDb();
  try {
    const organizationId = await seedOrganization(db, "owner");
    const otherOrganizationId = await seedOrganization(db, "foreign");
    const agentId = await seedAgent(db, organizationId);
    const foreignAgentId = await seedAgent(db, otherOrganizationId);
    const registry = new DrizzleAutomationRegistry(db);
    const automationId = "b0000000-0000-4000-a000-0000000000f2";

    await registry.save({
      id: automationId,
      organizationId,
      name: "Owned Automation",
      agentId,
      agentPlane: "cloud",
      steps: [validStep],
    });
    const loaded = await registry.load(organizationId, automationId);
    assert.equal(loaded?.agentId, agentId);
    assert.equal(loaded?.agentPlane, "cloud");
    assert.deepEqual(loaded?.steps, [validStep]);

    await assert.rejects(
      () =>
        registry.save({
          id: "b0000000-0000-4000-a000-0000000000f3",
          organizationId,
          name: "Cross-organization Automation",
          agentId: foreignAgentId,
          agentPlane: "local",
          steps: [validStep],
        }),
      /owning Agent must belong to the Automation organization/,
    );
  } finally {
    await close();
  }
});

test("Automation Run records retain Agent attribution and organization scope", async () => {
  const { db, close } = await createLocalDb();
  try {
    const organizationId = await seedOrganization(db, "run");
    const otherOrganizationId = await seedOrganization(db, "run_foreign");
    const agentId = await seedAgent(db, organizationId);
    const automationId = "b0000000-0000-4000-a000-0000000000f4";
    const runId = "b0000000-0000-4000-a000-0000000000f5";
    const registry = new DrizzleAutomationRegistry(db);
    const recorder = new DrizzleAutomationRunRecorder(db);
    const preliminaryTaint = labelAtSource("human_input", {
      ref: `automation-run:${runId}`,
      valueHash: hashTaintValue({ runId }),
      sensitivity: "organization",
      instructionRisk: "instruction_like",
    });

    await registry.save({
      id: automationId,
      organizationId,
      name: "Recorded Automation",
      agentId,
      agentPlane: "local",
      steps: [validStep],
    });
    await recorder.start({ runId, automationId, organizationId, agentId }, runCtx());
    await assert.rejects(
      () =>
        recorder.finish(
          { runId, organizationId: otherOrganizationId, status: "completed", output: {} },
          runCtx(),
        ),
      /not found in organization/,
    );
    await recorder.finish(
      {
        runId,
        organizationId,
        status: "completed",
        output: { steps: 1, taintLabel: preliminaryTaint },
      },
      runCtx(),
    );
    await recorder.finish(
      {
        runId,
        organizationId,
        status: "completed",
        output: { steps: 1, taintLabel: preliminaryTaint },
      },
      runCtx("2026-07-21T00:00:00.000Z"),
    );
    await recorder.finish(
      { runId, organizationId, status: "completed", output: { decision: "approve" } },
      runCtx("2026-07-21T01:00:00.000Z"),
    );
    await recorder.finish(
      { runId, organizationId, status: "completed", output: { decision: "approve" } },
      runCtx("2026-07-21T02:00:00.000Z"),
    );
    await assert.rejects(
      () =>
        recorder.finish(
          { runId, organizationId, status: "completed", output: { decision: "veto" } },
          runCtx(),
        ),
      /conflicts with existing terminal result/,
    );

    const [stored] = await db
      .select()
      .from(schema.automationRuns)
      .where(eq(schema.automationRuns.id, runId));
    assert.equal(stored?.automationId, automationId);
    assert.equal(stored?.agentId, agentId);
    assert.equal(stored?.organizationId, organizationId);
    assert.equal(stored?.status, "completed");
    assert.equal(stored?.startedAt.toISOString(), "2026-07-20T00:00:00.000Z");
    assert.deepEqual(stored?.output, { decision: "approve" });
    assert.equal(stored?.finishedAt?.toISOString(), "2026-07-21T01:00:00.000Z");
    const recent = await recorder.list(organizationId, [automationId], { limit: 10 });
    assert.equal(recent.length, 1);
    assert.equal(recent[0]?.runId, runId);
    assert.equal(recent[0]?.status, "completed");
    assert.equal(recent[0]?.finishedAt !== undefined, true);
    assert.deepEqual(await recorder.list(otherOrganizationId, [automationId], { limit: 10 }), []);

    const racingRunId = "b0000000-0000-4000-a000-0000000000f6";
    await recorder.start(
      { runId: racingRunId, automationId, organizationId, agentId },
      runCtx(),
    );
    const finishes = await Promise.allSettled([
      recorder.finish(
        { runId: racingRunId, organizationId, status: "completed", output: { winner: 1 } },
        runCtx(),
      ),
      recorder.finish(
        { runId: racingRunId, organizationId, status: "halted", output: { winner: 2 } },
        runCtx(),
      ),
    ]);
    assert.equal(finishes.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(finishes.filter((result) => result.status === "rejected").length, 1);
  } finally {
    await close();
  }
});
