import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryAutoActivationBudgetStore,
  InMemoryKillSwitch,
  StateBackedAutoActivationBudgetStore,
  StateBackedKillSwitch,
  type AtomicStatePort,
} from "../src/index.js";

/** Fake atomic port over a Map — the Map outlives store instances, so a new
 * store over the same Map is a "process restart". */
class MapStatePort implements AtomicStatePort {
  constructor(readonly rows = new Map<string, unknown>()) {}
  async read(organizationId: string, namespace: string): Promise<unknown | null> {
    return structuredClone(this.rows.get(`${organizationId}|${namespace}`) ?? null);
  }
  async update<T>(
    organizationId: string,
    namespace: string,
    initialState: unknown,
    reduce: (current: unknown) => { state: unknown; result: T },
  ): Promise<T> {
    const key = `${organizationId}|${namespace}`;
    const mutation = reduce(structuredClone(this.rows.get(key) ?? initialState));
    this.rows.set(key, structuredClone(mutation.state));
    return mutation.result;
  }
}

const ORG = "org-1";

test("budget counts survive a restart when state-backed; in-memory does not", async () => {
  const rows = new Map<string, unknown>();
  const first = new StateBackedAutoActivationBudgetStore(new MapStatePort(rows));
  await first.recordAutoActivation(ORG, "advisory", "2026-09-10"); // yesterday — pruned by today's write
  await first.recordAutoActivation(ORG, "informational", "2026-09-11");
  await first.recordAutoActivation(ORG, "informational", "2026-09-11");
  assert.equal(await first.countToday(ORG, "informational", "2026-09-11"), 2);

  const restarted = new StateBackedAutoActivationBudgetStore(new MapStatePort(rows));
  assert.equal(await restarted.countToday(ORG, "informational", "2026-09-11"), 2);
  assert.equal(await restarted.countToday(ORG, "advisory", "2026-09-11"), 0);
  await restarted.recordAutoActivation(ORG, "advisory", "2026-09-11");
  const state = rows.get(`${ORG}|capability:auto-activation-budget`) as { version: number; counts: Record<string, number> };
  assert.deepEqual(state, { version: 1, counts: { "informational:2026-09-11": 2, "advisory:2026-09-11": 1 } });

  const memory = new InMemoryAutoActivationBudgetStore();
  await memory.recordAutoActivation(ORG, "informational", "2026-09-11");
  assert.equal(await new InMemoryAutoActivationBudgetStore().countToday(ORG, "informational", "2026-09-11"), 0);
});

test("kill switch engagement survives a restart when state-backed; in-memory does not", async () => {
  const rows = new Map<string, unknown>();
  const first = new StateBackedKillSwitch(new MapStatePort(rows));
  assert.equal(await first.isEngaged(ORG), false);
  await first.engage(ORG);
  assert.equal(await first.isEngaged(ORG), true);

  const restarted = new StateBackedKillSwitch(new MapStatePort(rows));
  assert.equal(await restarted.isEngaged(ORG), true);
  assert.deepEqual(rows.get(`${ORG}|capability:kill-switch`), { version: 1, engaged: true });
  await restarted.disengage(ORG);
  assert.equal(await new StateBackedKillSwitch(new MapStatePort(rows)).isEngaged(ORG), false);

  const memory = new InMemoryKillSwitch();
  memory.engage(ORG);
  assert.equal(await new InMemoryKillSwitch().isEngaged(ORG), false);
});
