/**
 * graph.listPeople / graph.listCommunities — read surface for KnowledgeBasePage's
 * People/Communities tabs (currently `NotWiredYet` placeholders in apps/web).
 * Mirrors graph.listInitiatives/listSignals: workspace-scoped, paginated, rejects
 * any workspaceId that isn't the pilot workspace (assertPilotWorkspace).
 *
 * `Wiring` doesn't expose a raw db handle (graphStore/workspaceStore keep it
 * private), so fixtures are seeded through a short-lived `createLocalDb`
 * connection bound to the SAME `BRIDGE_LOCAL_DIR` `buildWiring()` will use —
 * same one-connection-at-a-time approach pagination.test.ts uses for
 * `integration.list`, since pglite doesn't reliably share writes across two
 * concurrently-open connections against one on-disk directory.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalDb, schema } from "@bridge/db";
import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_WORKSPACE, PILOT_USER, type Wiring } from "../src/wiring.js";

const FIXTURE_COUNT = 5;

function makeRun(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(1);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

async function makeCaller(wiring: Wiring) {
  return appRouter.createCaller({
    wiring,
    run: makeRun(),
    identity: { type: "user", id: PILOT_USER },
    auth: { verified: true, pilotFallbackAllowed: false },
  });
}

/** Seed FIXTURE_COUNT people + FIXTURE_COUNT communities under PILOT_WORKSPACE/
 * PILOT_USER via a connection to `dir`, then close it BEFORE `buildWiring()` opens
 * its own connection against the same directory. */
async function seedFixtures(dir: string): Promise<void> {
  const { db, close } = await createLocalDb({ dataDir: dir });
  try {
    // Idempotent: workspace/user rows may already exist from a prior buildWiring()
    // bootstrap against this directory; onConflictDoNothing keeps this safe to
    // call before that bootstrap ever runs too.
    await db.insert(schema.workspaces).values({ id: PILOT_WORKSPACE, name: "Pilot workspace (graph test)" }).onConflictDoNothing({
      target: schema.workspaces.id,
    });
    await db.insert(schema.users).values({ id: PILOT_USER, email: "test_fixture_pilot@example.com" }).onConflictDoNothing({
      target: schema.users.id,
    });
    for (let i = 0; i < FIXTURE_COUNT; i += 1) {
      await db.insert(schema.people).values({
        workspaceId: PILOT_WORKSPACE,
        userId: PILOT_USER,
        fullNameOverride: `test_fixture_person_${i}`,
      });
      await db.insert(schema.communities).values({
        workspaceId: PILOT_WORKSPACE,
        userId: PILOT_USER,
        nameOverride: `test_fixture_community_${i}`,
      });
    }
  } finally {
    await close();
  }
}

test("graph.listPeople: paginates people under the pilot workspace", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bridge-graph-people-test-"));
  await seedFixtures(dir);

  const prior = process.env.BRIDGE_LOCAL_DIR;
  process.env.BRIDGE_LOCAL_DIR = dir;
  let wiring: Wiring | undefined;
  try {
    wiring = await buildWiring();
    const caller = await makeCaller(wiring);

    const page = await caller.graph.listPeople({ workspaceId: PILOT_WORKSPACE, limit: 2, offset: 0 });
    assert.equal(page.items.length, 2);
    assert.equal(page.total, FIXTURE_COUNT);
    assert.equal(page.hasMore, true);

    const lastPage = await caller.graph.listPeople({ workspaceId: PILOT_WORKSPACE, limit: 2, offset: 4 });
    assert.equal(lastPage.items.length, 1);
    assert.equal(lastPage.hasMore, false);

    await assert.rejects(() =>
      caller.graph.listPeople({ workspaceId: "test_fixture_other_workspace", limit: 10, offset: 0 }),
    );
  } finally {
    if (wiring) await wiring.close();
    if (prior === undefined) delete process.env.BRIDGE_LOCAL_DIR;
    else process.env.BRIDGE_LOCAL_DIR = prior;
  }
});

test("graph.listCommunities: paginates communities under the pilot workspace", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bridge-graph-communities-test-"));
  await seedFixtures(dir);

  const prior = process.env.BRIDGE_LOCAL_DIR;
  process.env.BRIDGE_LOCAL_DIR = dir;
  let wiring: Wiring | undefined;
  try {
    wiring = await buildWiring();
    const caller = await makeCaller(wiring);

    const page = await caller.graph.listCommunities({ workspaceId: PILOT_WORKSPACE, limit: 3, offset: 0 });
    assert.equal(page.items.length, 3);
    assert.equal(page.total, FIXTURE_COUNT);
    assert.equal(page.hasMore, true);

    const lastPage = await caller.graph.listCommunities({ workspaceId: PILOT_WORKSPACE, limit: 3, offset: 3 });
    assert.equal(lastPage.items.length, 2);
    assert.equal(lastPage.hasMore, false);

    await assert.rejects(() =>
      caller.graph.listCommunities({ workspaceId: "test_fixture_other_workspace", limit: 10, offset: 0 }),
    );
  } finally {
    if (wiring) await wiring.close();
    if (prior === undefined) delete process.env.BRIDGE_LOCAL_DIR;
    else process.env.BRIDGE_LOCAL_DIR = prior;
  }
});
