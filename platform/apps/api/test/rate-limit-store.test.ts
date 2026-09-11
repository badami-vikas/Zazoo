import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import test from "node:test";
import { createLocalDb, DrizzleRateLimitStore } from "@bridge/db";
import { pgRateLimitStore } from "../src/rate-limit-store.js";

test("pg rate-limit store: shared counter increments and resets after the window", async () => {
  const { db, close } = await createLocalDb();
  try {
    const Store = pgRateLimitStore(new DrizzleRateLimitStore(db));
    const store = new Store({});
    const incr = (key: string, windowMs: number) =>
      new Promise<{ current: number; ttl: number }>((resolve, reject) => {
        // Plugin contract (10.x): incr(key, cb, timeWindow, max) → cb(null, { current, ttl }).
        (store.incr as (k: string, cb: (e: Error | null, r?: { current: number; ttl: number }) => void, t: number) => void)(
          key,
          (err, res) => (err ? reject(err) : resolve(res!)),
          windowMs,
        );
      });

    const first = await incr("1.2.3.4:global", 200);
    const second = await incr("1.2.3.4:global", 200);
    assert.equal(first.current, 1);
    assert.equal(second.current, 2);
    assert.ok(second.ttl > 0 && second.ttl <= 200, `ttl within window, got ${second.ttl}`);
    // Independent keys are independent budgets (the sensitive bucket vs global).
    assert.equal((await incr("1.2.3.4:sensitive", 200)).current, 1);

    await sleep(220);
    assert.equal((await incr("1.2.3.4:global", 200)).current, 1, "window reset");
    assert.equal(store.child({} as never).constructor, Store, "child stays on the shared counter");
  } finally {
    await close();
  }
});
