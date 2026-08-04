/**
 * DrizzleEvalStore against a real Postgres (PGlite), ADR-164.
 *
 * The point of these tests is not CRUD coverage — it is the one property the
 * in-memory binding could never have: an eval run written before a restart is
 * readable after it. `capability.approve` only compares candidate vs baseline
 * when it can load a run for both, so an amnesiac store did not make the
 * promotion gate noisy, it made it silently inapplicable.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EvalDataset, EvalRun } from "@bridge/core";
import { createLocalDb } from "../src/client-local.js";
import { DrizzleEvalStore } from "../src/eval-store.js";
import { organizations } from "../src/schema.js";

async function freshDb() {
  const { db, close } = await createLocalDb();
  const organizationId = randomUUID();
  await db.insert(organizations).values({ id: organizationId, name: "Eval Org" });
  return { db, close, organizationId };
}

const DATASET: EvalDataset = {
  id: "eval-internal-strategist-seed",
  capability_type: "agent",
  version: "1.0.0",
  cases: [
    { id: "case-a", input: { message: "hi" }, origin: "seed", labels: { correct_route: "advise" } },
    { id: "case-b", input: { message: "bye" }, reference: "string", origin: "red-team", rubric: "must refuse" },
  ],
};

function run(overrides: Partial<EvalRun> = {}): Omit<EvalRun, "id"> {
  return {
    capability_id: "manifest-1",
    capability_version: "1.0.0",
    dataset_id: DATASET.id,
    perCase: [{ caseId: "case-a", axes: { success: 1, safety: 1 } }],
    aggregate: { success: 1, safety: 1 },
    started_at: "2026-08-04T10:00:00.000Z",
    finished_at: "2026-08-04T10:00:05.000Z",
    ...overrides,
  };
}

test("eval dataset round-trips through Postgres with its cases intact", async () => {
  const { db, close, organizationId } = await freshDb();
  try {
    const store = new DrizzleEvalStore(db, organizationId);
    await store.createDataset(DATASET);
    const loaded = await store.getDataset(DATASET.id);
    assert.deepEqual(loaded, DATASET);
    const listed = await store.listDatasets({ limit: 10, offset: 0 });
    assert.equal(listed.total, 1);
    assert.equal(listed.items[0]?.cases.length, 2);
    assert.equal(await store.getDataset("no-such-dataset"), null);
  } finally {
    await close();
  }
});

test("a duplicate dataset id is refused rather than silently overwriting scored history", async () => {
  const { db, close, organizationId } = await freshDb();
  try {
    const store = new DrizzleEvalStore(db, organizationId);
    await store.createDataset(DATASET);
    await assert.rejects(() => store.createDataset({ ...DATASET, version: "2.0.0" }), /duplicate id/);
    assert.equal((await store.getDataset(DATASET.id))?.version, "1.0.0");
  } finally {
    await close();
  }
});

test("eval runs survive a restart — the property the promotion gate depends on", async () => {
  // A genuinely file-backed store opened twice. `memory://` would NOT prove
  // this — a memory-backed PGlite starts empty on every open, so the test would
  // pass or fail for reasons unrelated to persistence. Real bytes on disk are
  // the only way the restart claim means anything.
  const root = mkdtempSync(join(tmpdir(), "bridge-eval-restart-"));
  const dataDir = join(root, "pgdata");
  const organizationId = randomUUID();

  const first = await createLocalDb({ dataDir });
  try {
    await first.db.insert(organizations).values({ id: organizationId, name: "Eval Org" });
    const store = new DrizzleEvalStore(first.db, organizationId);
    await store.createDataset(DATASET);
    await store.createRun(run({ capability_id: "baseline-manifest", aggregate: { success: 0.6, safety: 1 } }));
    await store.createRun(run({ capability_id: "candidate-manifest", aggregate: { success: 0.9, safety: 1 } }));
  } finally {
    await first.close();
  }

  const second = await createLocalDb({ dataDir });
  try {
    const store = new DrizzleEvalStore(second.db, organizationId);
    const baseline = await store.listRuns("baseline-manifest", { limit: 100, offset: 0 });
    const candidate = await store.listRuns("candidate-manifest", { limit: 100, offset: 0 });
    // Both sides present after restart => compareRuns() runs => the gate applies.
    assert.equal(baseline.total, 1);
    assert.equal(candidate.total, 1);
    assert.equal(baseline.items.at(-1)?.aggregate.success, 0.6);
    assert.equal(candidate.items.at(-1)?.aggregate.success, 0.9);
    assert.deepEqual((await store.getDataset(DATASET.id))?.cases.length, 2);
  } finally {
    await second.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("listRuns filters by capability and returns oldest-first so .at(-1) is the latest run", async () => {
  const { db, close, organizationId } = await freshDb();
  try {
    const store = new DrizzleEvalStore(db, organizationId);
    await store.createRun(run({ started_at: "2026-08-04T12:00:00.000Z", aggregate: { success: 0.3 } }));
    await store.createRun(run({ started_at: "2026-08-04T09:00:00.000Z", aggregate: { success: 0.1 } }));
    await store.createRun(run({ started_at: "2026-08-04T15:00:00.000Z", aggregate: { success: 0.9 } }));
    await store.createRun(run({ capability_id: "other-manifest", aggregate: { success: 0.99 } }));

    const listed = await store.listRuns("manifest-1", { limit: 100, offset: 0 });
    assert.equal(listed.total, 3, "the other capability's run must not leak in");
    assert.deepEqual(
      listed.items.map((item) => item.started_at),
      ["2026-08-04T09:00:00.000Z", "2026-08-04T12:00:00.000Z", "2026-08-04T15:00:00.000Z"],
    );
    assert.equal(listed.items.at(-1)?.aggregate.success, 0.9, "the promotion gate reads .at(-1) as the latest run");
  } finally {
    await close();
  }
});

test("timestamps and optional model_version round-trip exactly, without normalisation", async () => {
  const { db, close, organizationId } = await freshDb();
  try {
    const store = new DrizzleEvalStore(db, organizationId);
    const withModel = await store.createRun(run({ model_version: "claude-x-2026-08" }));
    const withoutModel = await store.createRun(run({ started_at: "2026-08-04T11:00:00.000Z" }));

    const loaded = await store.getRun(withModel.id);
    assert.equal(loaded?.model_version, "claude-x-2026-08");
    // The port types these as opaque strings; storing them as timestamptz would
    // silently rewrite the caller's own value on read.
    assert.equal(loaded?.started_at, "2026-08-04T10:00:00.000Z");
    assert.deepEqual(loaded?.perCase, [{ caseId: "case-a", axes: { success: 1, safety: 1 } }]);

    const bare = await store.getRun(withoutModel.id);
    assert.ok(bare && !("model_version" in bare), "an absent model_version must stay absent, not become null");
    assert.equal(await store.getRun("evalrun_missing"), null);
  } finally {
    await close();
  }
});

test("comparisons persist both run snapshots and the verdict as promotion evidence", async () => {
  const { db, close, organizationId } = await freshDb();
  try {
    const store = new DrizzleEvalStore(db, organizationId);
    const baseline = await store.createRun(run({ aggregate: { success: 0.5, safety: 1 } }));
    const candidate = await store.createRun(run({ aggregate: { success: 0.8, safety: 1 } }));
    const created = await store.createComparison({
      baseline,
      candidate,
      deltas: { success: 0.3 },
      verdict: "promote",
      significance: { n: 2, ci95: { success: [0.1, 0.5] } },
    });

    const loaded = await store.getComparison(created.id);
    assert.equal(loaded?.verdict, "promote");
    assert.equal(loaded?.baseline.aggregate.success, 0.5);
    assert.equal(loaded?.candidate.aggregate.success, 0.8);
    assert.deepEqual(loaded?.significance.ci95.success, [0.1, 0.5]);
  } finally {
    await close();
  }
});

test("one Organization's eval history is invisible to another", async () => {
  const { db, close, organizationId } = await freshDb();
  try {
    const otherOrganizationId = randomUUID();
    await db.insert(organizations).values({ id: otherOrganizationId, name: "Other" });

    const mine = new DrizzleEvalStore(db, organizationId);
    const theirs = new DrizzleEvalStore(db, otherOrganizationId);
    await mine.createDataset(DATASET);
    const myRun = await mine.createRun(run());

    assert.equal(await theirs.getDataset(DATASET.id), null);
    assert.equal(await theirs.getRun(myRun.id), null);
    assert.equal((await theirs.listRuns("manifest-1", { limit: 10, offset: 0 })).total, 0);
    // Same slug id in a different Organization is a different dataset, not a
    // duplicate — this is why the primary key is (organization_id, id).
    await theirs.createDataset({ ...DATASET, version: "9.9.9" });
    assert.equal((await mine.getDataset(DATASET.id))?.version, "1.0.0");
    assert.equal((await theirs.getDataset(DATASET.id))?.version, "9.9.9");
  } finally {
    await close();
  }
});
