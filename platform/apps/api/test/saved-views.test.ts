/**
 * view.saved.* (TASK-062) — the durable View surface over the real
 * `buildWiring()` composition root. What matters here is what the store tests
 * cannot see: that the router validates the ViewConfig shape at the edge,
 * refuses a name collision as a conflict rather than a crash, and keeps one
 * Database's Views out of another's.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  SeededRng,
  SystemClock,
  UuidGen,
  labelFromLegacyTrustOrigin,
  type RunCtx,
} from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_ORGANIZATION, PILOT_USER, type Wiring } from "../src/wiring.js";

function makeRun(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(11);
  return {
    clock,
    rng,
    ids: new UuidGen(clock, rng),
    taintLabel: labelFromLegacyTrustOrigin("operator", "saved-views-test"),
  };
}

function makeCaller(wiring: Wiring, id: string = PILOT_USER) {
  return appRouter.createCaller({
    wiring,
    run: makeRun(),
    identity: { type: "user", id },
    authenticated: true,
    verifying: false,
  });
}

const tableView = (overrides: Record<string, unknown> = {}) => ({
  id: "view-a",
  kind: "table" as const,
  sorts: [{ id: "name", dir: "asc" as const }],
  rowFilters: [{ field: "stage", op: "is" as const, value: "won" }],
  filterMatch: "all" as const,
  groupBy: null,
  ...overrides,
});

test("a named View survives — saved with its filters, sorts and hidden columns, and read back", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const saved = await caller.view.saved.save({
      organizationId: PILOT_ORGANIZATION,
      databaseId: "dealpilot.deals",
      name: "Won deals",
      config: tableView(),
      hiddenColumns: ["notes"],
    });
    assert.equal(saved.name, "Won deals");
    assert.equal(saved.scope, "personal", "a View is personal unless it is deliberately shared");

    // The read a browser makes after a reload.
    const listed = await caller.view.saved.list({
      organizationId: PILOT_ORGANIZATION,
      databaseId: "dealpilot.deals",
    });
    assert.equal(listed.length, 1);
    assert.deepEqual(listed[0]?.config, tableView());
    assert.deepEqual(listed[0]?.hiddenColumns, ["notes"]);
  } finally {
    await wiring.close();
  }
});

test("a second Database shows its own Views and never the first's", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    await caller.view.saved.save({
      organizationId: PILOT_ORGANIZATION,
      databaseId: "dealpilot.deals",
      name: "Won deals",
      config: tableView(),
    });
    await caller.view.saved.save({
      organizationId: PILOT_ORGANIZATION,
      databaseId: "relationship.people",
      name: "Warm contacts",
      config: tableView({ id: "view-b" }),
    });

    const deals = await caller.view.saved.list({
      organizationId: PILOT_ORGANIZATION,
      databaseId: "dealpilot.deals",
    });
    assert.deepEqual(deals.map((view) => view.name), ["Won deals"]);
  } finally {
    await wiring.close();
  }
});

test("the ViewConfig shape is validated at the edge — an unknown key is refused, not stored", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    await assert.rejects(
      caller.view.saved.save({
        organizationId: PILOT_ORGANIZATION,
        databaseId: "dealpilot.deals",
        name: "Smuggled",
        // A key no view kind declares. Storing it would make the config a
        // place to carry state past every validator downstream of here.
        config: { ...tableView(), somethingElse: "payload" } as never,
      }),
      /unrecognized|Unrecognized/,
    );
    await assert.rejects(
      caller.view.saved.save({
        organizationId: PILOT_ORGANIZATION,
        databaseId: "dealpilot.deals",
        name: "Bad kind",
        config: { ...tableView(), kind: "spreadsheet" } as never,
      }),
      /invalid|Invalid/,
    );
  } finally {
    await wiring.close();
  }
});

test("two Views cannot share a name on one Database — the dropdown would be unusable", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    await caller.view.saved.save({
      organizationId: PILOT_ORGANIZATION,
      databaseId: "dealpilot.deals",
      name: "Won deals",
      config: tableView(),
    });
    await assert.rejects(
      caller.view.saved.save({
        organizationId: PILOT_ORGANIZATION,
        databaseId: "dealpilot.deals",
        name: "won deals",
        config: tableView(),
      }),
      /already exists/,
    );
  } finally {
    await wiring.close();
  }
});

test("re-saving a View overwrites it in place, and deleting it removes it", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const saved = await caller.view.saved.save({
      organizationId: PILOT_ORGANIZATION,
      databaseId: "dealpilot.deals",
      name: "Won deals",
      config: tableView(),
      hiddenColumns: ["notes"],
    });
    const updated = await caller.view.saved.update({
      organizationId: PILOT_ORGANIZATION,
      viewId: saved.id,
      config: tableView({ kind: "board", groupBy: "stage" }),
      hiddenColumns: [],
    });
    assert.equal(updated.config.kind, "board");
    assert.deepEqual(updated.hiddenColumns, []);
    assert.equal(updated.id, saved.id, "re-saving is an overwrite, not a second List");

    await caller.view.saved.remove({
      organizationId: PILOT_ORGANIZATION,
      viewId: saved.id,
    });
    assert.deepEqual(
      await caller.view.saved.list({
        organizationId: PILOT_ORGANIZATION,
        databaseId: "dealpilot.deals",
      }),
      [],
    );
    await assert.rejects(
      caller.view.saved.remove({ organizationId: PILOT_ORGANIZATION, viewId: saved.id }),
      /unknown saved View/,
    );
  } finally {
    await wiring.close();
  }
});
