import assert from "node:assert/strict";
import test from "node:test";
import { detectTaskProjectionDrift, emitTasksMarkdown, planCompletedBaySweep } from "@bridge/core";
import { createLocalDb, DrizzleTaskManagerStore, schema } from "../src/index.js";

async function fixture() {
  const local = await createLocalDb();
  const [organization] = await local.db.insert(schema.organizations).values({ name: "test_fixture_task_manager" }).returning({ id: schema.organizations.id });
  const [user] = await local.db.insert(schema.users).values({ email: `test_fixture_task_manager_${crypto.randomUUID()}@example.com` }).returning({ id: schema.users.id });
  assert.ok(organization);
  assert.ok(user);
  return {
    ...local,
    organizationId: organization.id,
    userId: user.id,
    store: new DrizzleTaskManagerStore(local.db),
  };
}

function seam() {
  return { nextId: () => crypto.randomUUID(), nowISO: () => "2026-07-21T00:00:00.000Z" };
}

test("Task Manager store persists a real three-level tree and impact-fit proposals", async () => {
  const db = await fixture();
  try {
    const root = await db.store.create({
      organizationId: db.organizationId,
      title: "Ship Task Manager",
      ownerType: "human",
      ownerId: db.userId,
      isGoal: true,
      reviewCadence: "weekly",
      outcomes: [{ id: "o1", title: "Use", measure: "flows", target: "1", indicatorKind: "lagging" }],
    }, seam());
    const child = await db.store.create({
      organizationId: db.organizationId,
      title: "Build queue",
      ownerType: "human",
      ownerId: db.userId,
      parentTaskId: root.task.id,
      exitTest: "queue renders",
    }, seam());
    const leaf = await db.store.create({
      organizationId: db.organizationId,
      title: "Verify tree",
      ownerType: "human",
      ownerId: db.userId,
      parentTaskId: child.task.id,
      exitTest: "tree has three levels",
    }, seam());
    assert.deepEqual((await db.store.list(db.organizationId)).map((task) => task.path), ["1", "1.1", "1.1.1"]);
    assert.equal(child.impactFitProposal?.status, "pending_review");
    assert.equal(leaf.impactFitProposal?.actorId, "internal-strategist");
    const persisted = await db.db.select({
      id: schema.tasks.id,
      anchorTaskId: schema.tasks.anchorTaskId,
    }).from(schema.tasks);
    assert.equal(persisted.find((task) => task.id === leaf.task.id)?.anchorTaskId, root.task.id);
  } finally {
    await db.close();
  }
});

test("approved restructure is atomic, attributable, identity-preserving, and concurrency-safe", async () => {
  const db = await fixture();
  try {
    const root = await db.store.create({
      organizationId: db.organizationId,
      title: "Root",
      ownerType: "human",
      ownerId: db.userId,
      isGoal: true,
      reviewCadence: "weekly",
    }, seam());
    const child = await db.store.create({
      organizationId: db.organizationId,
      title: "Child",
      ownerType: "human",
      ownerId: db.userId,
      parentTaskId: root.task.id,
      exitTest: "child verified",
    }, seam());
    const proposal = await db.store.proposeRestructure(
      db.organizationId,
      { kind: "promote", taskId: child.task.id },
      "internal-strategist",
      seam(),
    );
    const [first, second] = await Promise.allSettled([
      db.store.decideProposal(db.organizationId, proposal.id, "approve", db.userId, seam()),
      db.store.decideProposal(db.organizationId, proposal.id, "approve", db.userId, seam()),
    ]);
    assert.equal([first, second].filter((result) => result.status === "fulfilled").length, 2);
    const tasks = await db.store.list(db.organizationId);
    assert.equal(tasks.find((task) => task.id === child.task.id)?.parentTaskId, undefined);
    assert.equal(new Set(tasks.map((task) => task.id)).size, 2);
    const events = await db.db.select().from(schema.events);
    assert.ok(events.some((event) => event.type === "task.promote.approved" && event.entityId === child.task.id));
  } finally {
    await db.close();
  }
});

test("durable projection reconciliation is UUID/idempotent and rejects stale versions", async () => {
  const db = await fixture();
  try {
    const created = await db.store.create({
      organizationId: db.organizationId,
      title: "Original title",
      ownerType: "human",
      ownerId: db.userId,
      isGoal: true,
      reviewCadence: "weekly",
    }, seam());
    // The dependency edges are projected CONTENT (ADR-209), so the before-hash
    // has to be computed over the same view the store recomputes at decision
    // time. Emitting without them here would compare two different documents
    // and report the difference as staleness — which is exactly what this
    // assertion caught when the edges first entered the projection.
    const before = emitTasksMarkdown(
      await db.store.list(db.organizationId),
      10,
      await db.store.listDependencies(db.organizationId),
    );
    const externalContent = before.content.replace("Original title", "Reconciled title");
    const drift = detectTaskProjectionDrift(before, externalContent, await db.store.list(db.organizationId));
    const proposalId = crypto.randomUUID();
    const staged = await db.store.stageProposal({
      id: proposalId,
      organizationId: db.organizationId,
      kind: "projection_reconcile",
      taskId: created.task.id,
      actorId: "internal-strategist",
      payload: {
        beforeProjectionHash: before.contentHash,
        externalContentHash: drift.externalContentHash,
        externalContent,
        recordVersions: before.recordVersions,
      },
      idempotencyKey: "projection-reconcile-1",
      expiresAt: "2026-07-22T00:00:00.000Z",
    }, seam());
    const retry = await db.store.stageProposal({
      id: crypto.randomUUID(),
      organizationId: db.organizationId,
      kind: "projection_reconcile",
      taskId: created.task.id,
      actorId: "internal-strategist",
      payload: staged.payload,
      idempotencyKey: "projection-reconcile-1",
      expiresAt: "2026-07-22T00:00:00.000Z",
    }, seam());
    assert.equal(retry.id, proposalId);
    const applied = await db.store.decideProposal(
      db.organizationId,
      proposalId,
      "approve",
      db.userId,
      seam(),
    );
    assert.equal(applied.tasks[0]?.title, "Reconciled title");
    assert.equal(
      (applied.result?.["projection"] as { contentHash: string }).contentHash,
      emitTasksMarkdown(applied.tasks, 10, await db.store.listDependencies(db.organizationId)).contentHash,
    );
    assert.match(String(applied.result?.["eventId"]), /^[0-9a-f-]{36}$/);
    assert.equal(
      (await db.db.select().from(schema.events)).some(
        (event) => event.id === applied.result?.["eventId"],
      ),
      true,
    );
    const replay = await db.store.decideProposal(
      db.organizationId,
      proposalId,
      "approve",
      db.userId,
      seam(),
    );
    assert.equal(replay.tasks[0]?.version, applied.tasks[0]?.version);

    const stale = await db.store.stageProposal({
      id: crypto.randomUUID(),
      organizationId: db.organizationId,
      kind: "projection_reconcile",
      taskId: created.task.id,
      actorId: "internal-strategist",
      payload: {
        beforeProjectionHash: before.contentHash,
        externalContentHash: drift.externalContentHash,
        externalContent,
        recordVersions: before.recordVersions,
      },
      idempotencyKey: "projection-reconcile-stale",
      expiresAt: "2026-07-22T00:00:00.000Z",
    }, seam());
    await assert.rejects(
      () => db.store.decideProposal(db.organizationId, stale.id, "approve", db.userId, seam()),
      /stale/,
    );
  } finally {
    await db.close();
  }
});

test("completed-bay sweep archives eligible done Tasks without deleting evidence", async () => {
  const db = await fixture();
  try {
    const created = await db.store.create({
      organizationId: db.organizationId,
      title: "Completed work",
      ownerType: "human",
      ownerId: db.userId,
      isGoal: false,
      exitTest: "evidence exists",
    }, seam());
    await db.store.verify(db.organizationId, created.task.id, {
      verifiedAt: "2026-07-21T00:00:00.000Z",
      verifiedBy: db.userId,
      evidenceRefs: ["event:completed"],
      result: "passed",
    }, seam());
    await db.store.transition(db.organizationId, created.task.id, "done", seam());
    const tasks = await db.store.list(db.organizationId);
    const plan = planCompletedBaySweep(tasks, "2026-07-21T00:00:00.000Z", 0, 7);
    const proposal = await db.store.stageProposal({
      id: crypto.randomUUID(),
      organizationId: db.organizationId,
      kind: "archive_sweep",
      taskId: created.task.id,
      actorId: "governance",
      payload: {
        taskIds: plan.eligibleTaskIds,
        recordVersions: plan.expectedVersions,
        policy: plan.policy,
      },
      idempotencyKey: "completed-bay-sweep-1",
      expiresAt: "2026-07-22T00:00:00.000Z",
    }, seam());
    const applied = await db.store.decideProposal(
      db.organizationId,
      proposal.id,
      "approve",
      db.userId,
      seam(),
    );
    const archived = applied.tasks.find((task) => task.id === created.task.id);
    assert.equal(archived?.status, "archived");
    assert.deepEqual(archived?.evidenceRefs, ["event:completed"]);
    assert.deepEqual(applied.result?.["archivedTaskIds"], [created.task.id]);
  } finally {
    await db.close();
  }
});

test("verification is required before done and survives restart-shaped store recreation", async () => {
  const db = await fixture();
  try {
    const created = await db.store.create({
      organizationId: db.organizationId,
      title: "Evidence flow",
      ownerType: "human",
      ownerId: db.userId,
      isGoal: false,
      exitTest: "event exists",
    }, seam());
    await assert.rejects(
      () => db.store.transition(db.organizationId, created.task.id, "done", seam()),
      /verification evidence/,
    );
    await db.store.verify(db.organizationId, created.task.id, {
      verifiedAt: "2026-07-21T00:00:00.000Z",
      verifiedBy: db.userId,
      evidenceRefs: ["event:real"],
      result: "passed",
    }, seam());
    await db.store.transition(db.organizationId, created.task.id, "done", seam());
    const restarted = new DrizzleTaskManagerStore(db.db);
    assert.equal((await restarted.get(db.organizationId, created.task.id))?.status, "done");
  } finally {
    await db.close();
  }
});
