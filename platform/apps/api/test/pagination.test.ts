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
import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_USER, PILOT_ORGANIZATION, type Wiring } from "../src/wiring.js";

// `integration.list` now rejects any organizationId that isn't PILOT_ORGANIZATION (interim
// single-tenant safety fix, All fixes.md Phase 3 item 11a — see router.ts's
// `assertPilotOrganization`), so these fixtures must be seeded under PILOT_ORGANIZATION
// itself rather than an arbitrary test_fixture_ organization id.
const FIXTURE_COUNT = 75; // > default limit (50), so an unbounded default would leak the whole set

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
    authenticated: true, // SEC-1: in-process test caller is a trusted, authenticated actor
    verifying: false,
  });
}

async function seedDealPilotCandidates(wiring: Wiring, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await wiring.dealpilot.store.createDeal({
      id: `test_fixture_candidate_${i}`,
      organizationId: PILOT_ORGANIZATION,
      company: `Test Candidate ${i}`,
    });
  }
}

async function seedDealPilotCaptures(
  wiring: Wiring,
  sourceId: string,
  count: number,
): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await wiring.dealpilot.store.quarantineCapture(PILOT_ORGANIZATION, sourceId, {
      captureId: `test_fixture_capture_${i}`,
      moduleId: "dealpilot",
      sourceConnectorId: "test_fixture_connector",
      sourceRecordId: `test_fixture_message_${i}`,
      tier: "email",
      query: {
        kind: "company",
        hints: { organizationId: PILOT_ORGANIZATION, sourceId },
      },
      payload: { name: `Test Capture ${i}` },
      confidence: 0.8,
      costUnits: 1,
      capturedAt: new Date(Date.UTC(2026, 6, 18, 0, 0, i)).toISOString(),
      trustOrigin: "untrusted_external",
    });
  }
}

test("dealpilot.list: honors an explicit limit and returns a bounded page", async () => {
  const wiring = await buildWiring();
  try {
    await seedDealPilotCandidates(wiring, FIXTURE_COUNT);
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
    await seedDealPilotCandidates(wiring, FIXTURE_COUNT);
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

test("dealpilot.captures: defaults to a bounded, Source-scoped page", async () => {
  const wiring = await buildWiring();
  try {
    const source = await wiring.dealpilot.store.createSource({
      organizationId: PILOT_ORGANIZATION,
      name: "Test Source",
      link: "https://example.invalid/source",
      connectionType: "email_alert",
      spendCap: 100,
      rightsState: "attested",
    });
    await seedDealPilotCaptures(wiring, source.id, 55);
    const caller = await makeCaller(wiring);

    const first = await caller.dealpilot.captures({
      organizationId: PILOT_ORGANIZATION,
      sourceId: source.id,
    });
    assert.equal(first.items.length, 50);
    assert.equal(first.total, 55);
    assert.equal(first.hasMore, true);
    assert.ok(first.items.every((capture) => capture.sourceId === source.id));

    const last = await caller.dealpilot.captures({
      organizationId: PILOT_ORGANIZATION,
      sourceId: source.id,
      limit: 10,
      offset: 50,
    });
    assert.equal(last.items.length, 5);
    assert.equal(last.hasMore, false);
  } finally {
    await wiring.close();
  }
});

test("integration.list: honors an explicit limit and returns a bounded page", async () => {
  const wiring = await buildWiring();
  const organizationId = PILOT_ORGANIZATION;
  try {
    const store = wiring.integrationStore;
    const before = (await store.list(organizationId)).length;
    for (let i = 0; i < FIXTURE_COUNT; i += 1) {
      await store.connect(organizationId, "x", []);
    }
    const caller = await makeCaller(wiring);
    const expectedTotal = before + FIXTURE_COUNT;

    const page = await caller.integration.list({ organizationId, limit: 10, offset: before });
    assert.equal(page.items.length, 10);
    assert.equal(page.total, expectedTotal);
    assert.equal(page.hasMore, true);

    const lastPage = await caller.integration.list({ organizationId, limit: 10, offset: before + 70 });
    assert.equal(lastPage.items.length, 5);
    assert.equal(lastPage.hasMore, false);
  } finally {
    await wiring.close();
  }
});

test("integration.list: default limit is not unbounded — no-limit call does not return everything", async () => {
  const wiring = await buildWiring();
  const organizationId = PILOT_ORGANIZATION;
  try {
    const store = wiring.integrationStore;
    const before = (await store.list(organizationId)).length;
    for (let i = 0; i < FIXTURE_COUNT; i += 1) {
      await store.connect(organizationId, "x", []);
    }
    const caller = await makeCaller(wiring);
    const expectedTotal = before + FIXTURE_COUNT;

    const page = await caller.integration.list({ organizationId });
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
