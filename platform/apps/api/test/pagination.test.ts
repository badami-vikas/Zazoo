/**
 * Pagination — `dealpilot.list` and `integration.list` (All fixes.md §3 P1
 * "No pagination on any list surface", Phase 3 item 14c).
 *
 * Both procedures used to map/return the ENTIRE backing array on every call
 * (`candidateIds.map(...)` through `facts.livingProfile()`; `store.list()` with
 * no slicing). These tests seed a large in-memory fixture set and confirm:
 *  1. `dealpilot.list` honors an explicit `limit` and returns a bounded page.
 *  2. `integration.list` honors an explicit `limit` and returns a bounded page.
 *  3. Neither procedure defaults to "return everything" when called with no
 *     pagination params against a fixture set larger than the default limit.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalDb, schema } from "@bridge/db";
import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_WORKSPACE, type Wiring } from "../src/wiring.js";
import { getIntegrationStore } from "../src/social/integration-service.js";

// `integration.list` now rejects any workspaceId that isn't PILOT_WORKSPACE (interim
// single-tenant safety fix, All fixes.md Phase 3 item 11a — see router.ts's
// `assertPilotWorkspace`), so these fixtures must be seeded under PILOT_WORKSPACE
// itself rather than an arbitrary test_fixture_ workspace id. The two `integration.list`
// tests below share one process-lifetime pglite store (see setupIntegrationFixtures),
// so seeding both under the SAME workspace id means each test's assertions are
// against `<rows already present> + FIXTURE_COUNT`, not a bare FIXTURE_COUNT — see
// the `baselineIntegrationCount` helper each test now calls before seeding.
const FIXTURE_COUNT = 75; // > default limit (50), so an unbounded default would leak the whole set

/**
 * `getIntegrationStore()` (../src/social/integration-service.js) memoizes a single
 * pglite handle for the whole process, keyed off `BRIDGE_LOCAL_DIR` (file-backed)
 * or a fresh in-memory instance if unset — first call wins for the rest of the
 * process. `buildWiring()` ALSO reads `BRIDGE_LOCAL_DIR` for its own, separate
 * local-plane store, so this file must not leave the env var set around a
 * `buildWiring()` call (both would then open independent pglite instances
 * against the same on-disk directory and race on migrations — reproduced while
 * writing this test).
 *
 * `integrations.workspace_id` has a FK into `workspaces`, so the prerequisite
 * rows must exist before `store.connect()`. pglite is a single-process embedded
 * engine — two concurrently-open `PGlite` clients against the SAME on-disk
 * directory do not reliably see each other's writes (reproduced: an insert
 * through a second, parallel `createLocalDb` against the same dir was invisible
 * to the FK check on the first, already-open connection). So every workspace row
 * this file needs is seeded through ONE connection that fully closes BEFORE
 * `getIntegrationStore()` ever opens its own (singleton, process-lifetime)
 * connection against that directory — never concurrently.
 */
const LOCAL_DIR = mkdtempSync(join(tmpdir(), "bridge-pagination-test-"));

let setupPromise: Promise<void> | null = null;

/** Seed the PILOT_WORKSPACE row (idempotent), THEN bind `getIntegrationStore()` to LOCAL_DIR. Runs once. */
function setupIntegrationFixtures(): Promise<void> {
  if (!setupPromise) {
    setupPromise = (async () => {
      const { db, close } = await createLocalDb({ dataDir: LOCAL_DIR });
      try {
        await db
          .insert(schema.workspaces)
          .values({ id: PILOT_WORKSPACE, name: "Pilot workspace (pagination test)" })
          .onConflictDoNothing({ target: schema.workspaces.id });
      } finally {
        await close();
      }

      const prior = process.env.BRIDGE_LOCAL_DIR;
      process.env.BRIDGE_LOCAL_DIR = LOCAL_DIR;
      try {
        await getIntegrationStore(); // fixes the singleton's dataDir to LOCAL_DIR
      } finally {
        if (prior === undefined) delete process.env.BRIDGE_LOCAL_DIR;
        else process.env.BRIDGE_LOCAL_DIR = prior;
      }
    })();
  }
  return setupPromise;
}

function makeRun(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(1);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

async function makeCaller(wiring: Wiring) {
  return appRouter.createCaller({
    wiring,
    run: makeRun(),
    identity: { type: "user", id: "test_fixture_pagination_user" },
    authenticated: true, // SEC-1: in-process test caller is a trusted, authenticated actor
    verifying: false,
  });
}

function seedDealPilotCandidates(wiring: Wiring, count: number): void {
  for (let i = 0; i < count; i += 1) {
    const id = `test_fixture_candidate_${i}`;
    wiring.dealpilot.candidateIds.push(id);
    wiring.dealpilot.facts.append({
      entityId: id,
      field: "name",
      value: `Dummy Candidate ${i}`,
      provenance: "user_entered",
      confidence: 1,
    });
  }
}

test("dealpilot.list: honors an explicit limit and returns a bounded page", async () => {
  const wiring = await buildWiring();
  try {
    seedDealPilotCandidates(wiring, FIXTURE_COUNT);
    const caller = await makeCaller(wiring);

    const page = await caller.dealpilot.list({ limit: 10, offset: 0 });
    assert.equal(page.items.length, 10);
    assert.equal(page.total, FIXTURE_COUNT);
    assert.equal(page.hasMore, true);

    const nextPage = await caller.dealpilot.list({ limit: 10, offset: 70 });
    assert.equal(nextPage.items.length, 5);
    assert.equal(nextPage.hasMore, false);
  } finally {
    await wiring.close();
  }
});

test("dealpilot.list: default limit is not unbounded — no-params call does not return everything", async () => {
  const wiring = await buildWiring();
  try {
    seedDealPilotCandidates(wiring, FIXTURE_COUNT);
    const caller = await makeCaller(wiring);

    const page = await caller.dealpilot.list(undefined);
    assert.equal(page.total, FIXTURE_COUNT);
    assert.ok(
      page.items.length < FIXTURE_COUNT,
      `expected a bounded default page, got ${page.items.length} of ${FIXTURE_COUNT}`,
    );
    assert.equal(page.items.length, 50); // documented default
    assert.equal(page.hasMore, true);
  } finally {
    await wiring.close();
  }
});

test("integration.list: honors an explicit limit and returns a bounded page", async () => {
  await setupIntegrationFixtures();
  const wiring = await buildWiring();
  const workspaceId = PILOT_WORKSPACE;
  try {
    const { store } = await getIntegrationStore();
    // Baseline BEFORE seeding: the two `integration.list` tests in this file share one
    // process-lifetime pglite store and both now write under PILOT_WORKSPACE (list is
    // pilot-only post-fix), so this test's fixtures may land on top of rows the other
    // test already inserted — assert against the delta, not a bare FIXTURE_COUNT.
    const before = (await store.list(workspaceId)).length;
    for (let i = 0; i < FIXTURE_COUNT; i += 1) {
      await store.connect(workspaceId, "x", []);
    }
    const caller = await makeCaller(wiring);
    const expectedTotal = before + FIXTURE_COUNT;

    const page = await caller.integration.list({ workspaceId, limit: 10, offset: before });
    assert.equal(page.items.length, 10);
    assert.equal(page.total, expectedTotal);
    assert.equal(page.hasMore, true);

    const lastPage = await caller.integration.list({ workspaceId, limit: 10, offset: before + 70 });
    assert.equal(lastPage.items.length, 5);
    assert.equal(lastPage.hasMore, false);
  } finally {
    await wiring.close();
  }
});

test("integration.list: default limit is not unbounded — no-limit call does not return everything", async () => {
  await setupIntegrationFixtures();
  const wiring = await buildWiring();
  const workspaceId = PILOT_WORKSPACE;
  try {
    const { store } = await getIntegrationStore();
    const before = (await store.list(workspaceId)).length;
    for (let i = 0; i < FIXTURE_COUNT; i += 1) {
      await store.connect(workspaceId, "x", []);
    }
    const caller = await makeCaller(wiring);
    const expectedTotal = before + FIXTURE_COUNT;

    const page = await caller.integration.list({ workspaceId });
    assert.equal(page.total, expectedTotal);
    assert.ok(
      page.items.length < expectedTotal,
      `expected a bounded default page, got ${page.items.length} of ${expectedTotal}`,
    );
    assert.equal(page.items.length, 50); // documented default
    assert.equal(page.hasMore, true);
  } finally {
    await wiring.close();
  }
});
