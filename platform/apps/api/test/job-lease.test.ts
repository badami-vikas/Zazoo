import assert from "node:assert/strict";
import test from "node:test";
import { withLease, type JobLeaseStore } from "../src/job-lease.js";

/** In-memory lease with the same take-over-when-expired rule as the Postgres row. */
function fakeStore(clock: { now: number }): JobLeaseStore & { rows: Map<string, { holder: string; expiresAt: number }> } {
  const rows = new Map<string, { holder: string; expiresAt: number }>();
  return {
    rows,
    async tryAcquire(name, holder, ttlMs) {
      const row = rows.get(name);
      if (row && row.expiresAt >= clock.now) return false;
      rows.set(name, { holder, expiresAt: clock.now + ttlMs });
      return true;
    },
    async release(name, holder) {
      if (rows.get(name)?.holder === holder) rows.delete(name);
    },
  };
}

test("withLease: a held lease skips, an expired one runs, no store always runs", async () => {
  const clock = { now: 1_000 };
  const store = fakeStore(clock);
  // Simulate the other instance holding the lease (not released yet).
  assert.equal(await store.tryAcquire("job", "other", 60_000), true);

  let runs = 0;
  const run = async () => {
    runs += 1;
  };
  await withLease(store, "job", 60_000, run);
  assert.equal(runs, 0, "second acquire within ttl is skipped");

  clock.now += 60_001;
  await withLease(store, "job", 60_000, run);
  assert.equal(runs, 1, "runs once the holder's lease expired");
  assert.equal(store.rows.has("job"), false, "released after the run");

  await withLease(null, "job", 60_000, run);
  assert.equal(runs, 2, "no store (single instance) always runs");
});

test("withLease: releases the lease even when the job throws", async () => {
  const store = fakeStore({ now: 0 });
  await assert.rejects(
    withLease(store, "job", 1_000, async () => {
      throw new Error("boom");
    }),
    /boom/,
  );
  assert.equal(store.rows.has("job"), false);
});
