import assert from "node:assert/strict";
import test from "node:test";
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
    assert.equal([first, second].filter((result) => result.status === "fulfilled").length, 1);
    const tasks = await db.store.list(db.organizationId);
    assert.equal(tasks.find((task) => task.id === child.task.id)?.parentTaskId, undefined);
    assert.equal(new Set(tasks.map((task) => task.id)).size, 2);
    const events = await db.db.select().from(schema.events);
    assert.ok(events.some((event) => event.type === "task.promote.approved" && event.entityId === child.task.id));
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
