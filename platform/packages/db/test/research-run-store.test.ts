/**
 * DrizzleResearchRunStore (TASK-028, migration 0035) — owner-scoped durable
 * Research Run records + append-only step evidence over real PGlite:
 * restart durability, complete-exactly-once CAS, the 0035 trigger freezing
 * terminal rows, the raise-only stop flag, and owner isolation.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ResearchRunAlreadyTerminalError,
  ResearchRunNotFoundError,
  uuidv7,
  type ResearchRunRecord,
  type ResearchStepRecord,
} from "@bridge/core";
import { createLocalDb, DrizzleResearchRunStore, schema } from "../src/index.js";

const organizationId = "10000000-0000-4000-8000-000000000135";
const ownerUserId = "20000000-0000-4000-8000-000000000135";
const otherUserId = "20000000-0000-4000-8000-000000000136";

async function seedIdentity(
  db: Awaited<ReturnType<typeof createLocalDb>>["db"],
): Promise<void> {
  await db.insert(schema.users).values([
    { id: ownerUserId, email: "research-run-owner@example.test" },
    { id: otherUserId, email: "research-run-other@example.test" },
  ]);
  await db
    .insert(schema.organizations)
    .values([{ id: organizationId, name: "Research run organization" }]);
}

function makeRun(overrides: Partial<ResearchRunRecord> = {}): ResearchRunRecord {
  return {
    id: uuidv7(),
    organizationId,
    ownerUserId,
    objective: "durable research objective",
    status: "running",
    stopRequested: false,
    parentRunId: uuidv7(),
    goalId: uuidv7(),
    taskId: uuidv7(),
    stopReason: null,
    brief: null,
    citations: [],
    blockedActions: [],
    injectionReports: [],
    stepsTaken: 0,
    startedAt: new Date().toISOString(),
    endedAt: null,
    ...overrides,
  };
}

function makeStep(
  runId: string,
  stepIndex: number,
  overrides: Partial<ResearchStepRecord> = {},
): ResearchStepRecord {
  return {
    id: uuidv7(),
    runId,
    organizationId,
    ownerUserId,
    stepIndex,
    tool: "read",
    summary: `step ${stepIndex}`,
    sourceUrl: "https://example.com/page",
    childRunId: null,
    quarantinedText: "untrusted page text",
    quarantinedSourceUrl: "https://example.com/page",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

test("DrizzleResearchRunStore: lifecycle + step evidence survive a restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "bridge-research-run-store-"));
  let local: Awaited<ReturnType<typeof createLocalDb>> | undefined;
  try {
    local = await createLocalDb({ dataDir: root });
    await seedIdentity(local.db);
    const store = new DrizzleResearchRunStore(local.db);

    const run = await store.create(makeRun());
    await store.appendStep(makeStep(run.id, 0, { tool: "search", sourceUrl: null }));
    await store.appendStep(makeStep(run.id, 1));
    const flagged = await store.requestStop(organizationId, ownerUserId, run.id);
    assert.equal(flagged.stopRequested, true);
    // requestStop is idempotent.
    await store.requestStop(organizationId, ownerUserId, run.id);

    const done = await store.complete(
      organizationId,
      ownerUserId,
      run.id,
      {
        status: "completed",
        stopReason: "planner_finished",
        brief: "the cited brief",
        citations: ["https://example.com/page"],
        blockedActions: ["refused click"],
        injectionReports: [],
        stepsTaken: 2,
      },
      new Date().toISOString(),
    );
    assert.equal(done.status, "completed");
    assert.equal(done.brief, "the cited brief");

    await local.close();
    local = undefined;
    local = await createLocalDb({ dataDir: root });
    const reopened = new DrizzleResearchRunStore(local.db);

    const persisted = await reopened.get(organizationId, ownerUserId, run.id);
    assert.equal(persisted?.status, "completed");
    assert.equal(persisted?.stopReason, "planner_finished");
    assert.equal(persisted?.brief, "the cited brief");
    assert.deepEqual(persisted?.citations, ["https://example.com/page"]);
    assert.equal(persisted?.stopRequested, true);
    assert.ok(persisted?.endedAt);

    const steps = await reopened.listSteps(organizationId, ownerUserId, run.id);
    assert.deepEqual(
      steps.map((step) => ({ index: step.stepIndex, tool: step.tool })),
      [
        { index: 0, tool: "search" },
        { index: 1, tool: "read" },
      ],
    );
    assert.equal(steps[1]?.quarantinedText, "untrusted page text");
  } finally {
    await local?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("DrizzleResearchRunStore: terminal is frozen — CAS, late steps, and direct SQL all fail", async () => {
  const root = await mkdtemp(join(tmpdir(), "bridge-research-run-terminal-"));
  let local: Awaited<ReturnType<typeof createLocalDb>> | undefined;
  try {
    local = await createLocalDb({ dataDir: root });
    await seedIdentity(local.db);
    const store = new DrizzleResearchRunStore(local.db);
    const run = await store.create(makeRun());
    await store.complete(
      organizationId,
      ownerUserId,
      run.id,
      {
        status: "failed",
        stopReason: "executor_error",
        brief: null,
        citations: [],
        blockedActions: [],
        injectionReports: [],
        stepsTaken: 0,
      },
      new Date().toISOString(),
    );

    await assert.rejects(
      store.complete(
        organizationId,
        ownerUserId,
        run.id,
        {
          status: "completed",
          stopReason: "planner_finished",
          brief: "rewritten",
          citations: [],
          blockedActions: [],
          injectionReports: [],
          stepsTaken: 1,
        },
        new Date().toISOString(),
      ),
      ResearchRunAlreadyTerminalError,
    );
    await assert.rejects(
      store.appendStep(makeStep(run.id, 0)),
      ResearchRunAlreadyTerminalError,
    );
    // The 0035 trigger holds even for a direct UPDATE that bypasses the store.
    const { eq } = await import("drizzle-orm");
    await assert.rejects(
      local.db
        .update(schema.researchRuns)
        .set({ brief: "tampered" })
        .where(eq(schema.researchRuns.id, run.id)),
      (error: unknown) => {
        const text = `${(error as Error).message} ${String(
          (error as { cause?: { message?: string } }).cause?.message ?? "",
        )}`;
        return /terminal research run .* is immutable/.test(text);
      },
    );
    // requestStop on a terminal run is a clean no-op, not a trigger exception.
    const afterStop = await store.requestStop(organizationId, ownerUserId, run.id);
    assert.equal(afterStop.status, "failed");
    assert.equal(afterStop.stopRequested, false);
  } finally {
    await local?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("DrizzleResearchRunStore: runs and steps are invisible to a different owner", async () => {
  const root = await mkdtemp(join(tmpdir(), "bridge-research-run-owner-"));
  let local: Awaited<ReturnType<typeof createLocalDb>> | undefined;
  try {
    local = await createLocalDb({ dataDir: root });
    await seedIdentity(local.db);
    const store = new DrizzleResearchRunStore(local.db);
    const run = await store.create(makeRun());
    await store.appendStep(makeStep(run.id, 0));

    assert.equal(await store.get(organizationId, otherUserId, run.id), null);
    assert.deepEqual(await store.list(organizationId, otherUserId, 10), []);
    assert.deepEqual(await store.listSteps(organizationId, otherUserId, run.id), []);
    await assert.rejects(
      store.requestStop(organizationId, otherUserId, run.id),
      ResearchRunNotFoundError,
    );
    await assert.rejects(
      store.complete(
        organizationId,
        otherUserId,
        run.id,
        {
          status: "cancelled",
          stopReason: "cancelled",
          brief: null,
          citations: [],
          blockedActions: [],
          injectionReports: [],
          stepsTaken: 0,
        },
        new Date().toISOString(),
      ),
      ResearchRunNotFoundError,
    );

    const owned = await store.list(organizationId, ownerUserId, 10);
    assert.equal(owned.length, 1);
  } finally {
    await local?.close();
    await rm(root, { recursive: true, force: true });
  }
});
