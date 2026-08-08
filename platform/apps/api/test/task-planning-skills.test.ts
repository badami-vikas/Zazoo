/**
 * The TM3 planning Skills resolve through the real registry and EXECUTE.
 *
 * Before this slice all three were registered manifests whose `run()` fell
 * through to `return { proposedOutput: inputs }` — a governed Skill that
 * echoed its own inputs back and looked, from the outside, exactly like one
 * that had analyzed something. These assertions fail if that echo ever
 * returns.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";
import { buildWiring } from "../src/wiring.js";

function runCtx(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(1);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

function task(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    organizationId: "org-1",
    path: id,
    level: 0,
    sortOrder: 1,
    title: `Task ${id}`,
    taskType: "task",
    isGoal: false,
    outcomes: [],
    anchor: false,
    status: "pending",
    priority: "P2",
    ownerType: "human",
    ownerId: "human-1",
    evidenceRefs: [],
    visibility: "organization",
    version: 1,
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
    ...overrides,
  };
}

test("planning Skills execute real analysis instead of echoing inputs", async () => {
  const wiring = await buildWiring({ allowEphemeralLocalPlane: true });
  const ctx = runCtx();

  const queue = [
    task("1", { title: "Migrate billing invoices to Stripe", priority: "P2" }),
    task("2", { title: "Renew the office lease", priority: "P0" }),
  ];

  // Reconciliation finds the twin and refuses to merge it on its own.
  const reconciliation = wiring.skillRegistry.get("task-manager.task-reconciliation");
  assert.ok(reconciliation, "the reconciliation Skill must be registered");
  const reconciled = await reconciliation.run(
    { title: "Migrate billing invoices to Stripe", queue },
    ctx,
  );
  const reconciledOut = reconciled.proposedOutput as Record<string, unknown>;
  assert.equal(reconciledOut["kind"], "task_reconciliation", "not an echo of the inputs");
  assert.equal(reconciledOut["verdict"], "review_duplicates");
  assert.equal((reconciledOut["duplicates"] as unknown[]).length, 1);

  // Sequencing proposes a real order — P0 outranks P2 regardless of path.
  const sequencing = wiring.skillRegistry.get("task-manager.queue-sequencing");
  assert.ok(sequencing, "the sequencing Skill must be registered");
  const sequenced = await sequencing.run({ queue }, ctx);
  const sequencedOut = sequenced.proposedOutput as Record<string, unknown>;
  assert.equal(sequencedOut["kind"], "queue_sequence");
  assert.equal(sequencedOut["changed"], true);
  const order = (sequencedOut["proposed"] as { taskId: string }[]).map((entry) => entry.taskId);
  assert.deepEqual(order, ["2", "1"], "P0 is proposed ahead of P2");

  // Impact fit composes all three findings for the reviewer.
  const impact = wiring.skillRegistry.get("task-manager.impact-fit-analysis");
  assert.ok(impact, "the impact-fit Skill must be registered");
  const analyzed = await impact.run(
    { taskId: "new", title: "Migrate billing invoices to Stripe", queue },
    ctx,
  );
  const analyzedOut = analyzed.proposedOutput as Record<string, unknown>;
  assert.equal(analyzedOut["kind"], "task_impact_fit");
  assert.equal(analyzedOut["duplicateVerdict"], "review_duplicates");
  assert.ok(analyzedOut["placement"], "placement reasoning is part of the finding");
  assert.ok(analyzedOut["resequence"], "resequence is part of the finding");
});

test("a planning Skill refuses to answer without an authorized queue", async () => {
  const wiring = await buildWiring({ allowEphemeralLocalPlane: true });
  const skill = wiring.skillRegistry.get("task-manager.queue-sequencing");
  assert.ok(skill);
  // Fabricating a clean "nothing found" from missing context would be
  // indistinguishable from a real clean result, so this fails loudly instead.
  await assert.rejects(
    () => skill.run({ title: "no queue supplied" }, runCtx()),
    /requires an authorized 'queue' array/,
  );
});
