/**
 * `view.saved.duplicate` and the default List (TASK-110), on a MIGRATED Local
 * Plane.
 *
 * `buildWiring()` with no `localDir` binds the in-memory double, and a double
 * has no `is_default` column to get wrong. These run against `localDir`, so the
 * migration, the partial unique index and the demote-before-promote ordering
 * are all under test — a fresh in-memory database hides exactly the migration
 * bug this file exists to catch.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWiring, PILOT_ORGANIZATION, type Wiring } from "../src/wiring.js";
import { makeCaller } from "./caller.js";

const DATABASE = "dealpilot.deals";

const config = (overrides: Record<string, unknown> = {}) => ({
  id: "view-a",
  kind: "table" as const,
  sorts: [
    { id: "stage", dir: "asc" as const },
    { id: "name", dir: "desc" as const },
  ],
  rowFilters: [
    { field: "stage", op: "is_any_of" as const, value: "won,closing" },
    { field: "closed", op: "before" as const, value: "2026-01-01" },
  ],
  filterMatch: "any" as const,
  groupBy: null,
  pageSize: 25,
  ...overrides,
});

async function onLocalPlane(body: (wiring: Wiring) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "bridge-task110-"));
  const wiring = await buildWiring({ profile: "egg", localDir: join(root, "local") });
  try {
    await body(wiring);
  } finally {
    await wiring.close?.();
    await rm(root, { recursive: true, force: true });
  }
}

test("a multi-level sort, a two-clause OR filter and a page size all survive a save", async () => {
  await onLocalPlane(async (wiring) => {
    const caller = makeCaller(wiring);
    await caller.view.saved.save({
      organizationId: PILOT_ORGANIZATION,
      databaseId: DATABASE,
      name: "Closing soon",
      config: config(),
      hiddenColumns: ["notes"],
    });
    const [stored] = await caller.view.saved.list({
      organizationId: PILOT_ORGANIZATION,
      databaseId: DATABASE,
    });
    assert.ok(stored, "the List is there after the write");
    // The grammar the old UI could not express is the grammar that must
    // round-trip: two filters, an OR, a tie-breaker and a page size.
    assert.equal((stored.config as { filterMatch: string }).filterMatch, "any");
    assert.equal((stored.config as { rowFilters: unknown[] }).rowFilters.length, 2);
    assert.equal((stored.config as { sorts: unknown[] }).sorts.length, 2);
    assert.equal((stored.config as { pageSize: number }).pageSize, 25);
    assert.equal(stored.isDefault, false, "a new List is not the default until asked");
  });
});

test("duplicate copies the configuration, names the copy itself, and never re-shares or re-defaults it", async () => {
  await onLocalPlane(async (wiring) => {
    const caller = makeCaller(wiring);
    const source = await caller.view.saved.save({
      organizationId: PILOT_ORGANIZATION,
      databaseId: DATABASE,
      name: "Closing soon",
      scope: "organization",
      config: config(),
      hiddenColumns: ["notes"],
    });
    await caller.view.saved.update({
      organizationId: PILOT_ORGANIZATION,
      viewId: source.id,
      isDefault: true,
    });

    const copy = await caller.view.saved.duplicate({
      organizationId: PILOT_ORGANIZATION,
      viewId: source.id,
    });
    assert.equal(copy.name, "Closing soon (copy)");
    assert.equal(copy.scope, "personal", "duplicating a shared List must not re-share it");
    assert.equal(copy.isDefault, false, "two defaults is the one state the table refuses");
    assert.deepEqual(copy.config, source.config);
    assert.deepEqual(copy.hiddenColumns, ["notes"]);

    // A second copy cannot take the name the first one holds: the
    // one-name-per-owner rule is the server's, so the server picks around it
    // rather than handing the client a CONFLICT to read.
    const second = await caller.view.saved.duplicate({
      organizationId: PILOT_ORGANIZATION,
      viewId: source.id,
    });
    assert.equal(second.name, "Closing soon (copy) 2");

    const listed = await caller.view.saved.list({
      organizationId: PILOT_ORGANIZATION,
      databaseId: DATABASE,
    });
    assert.equal(listed.length, 3, "all three are durable, not just the original");
  });
});

test("exactly one List is the default, and promoting a second demotes the first", async () => {
  await onLocalPlane(async (wiring) => {
    const caller = makeCaller(wiring);
    const first = await caller.view.saved.save({
      organizationId: PILOT_ORGANIZATION,
      databaseId: DATABASE,
      name: "Mine",
      config: config(),
    });
    const second = await caller.view.saved.save({
      organizationId: PILOT_ORGANIZATION,
      databaseId: DATABASE,
      name: "Theirs",
      config: config(),
    });

    await caller.view.saved.update({
      organizationId: PILOT_ORGANIZATION,
      viewId: first.id,
      isDefault: true,
    });
    await caller.view.saved.update({
      organizationId: PILOT_ORGANIZATION,
      viewId: second.id,
      isDefault: true,
    });

    const listed = await caller.view.saved.list({
      organizationId: PILOT_ORGANIZATION,
      databaseId: DATABASE,
    });
    assert.deepEqual(
      listed.filter((view) => view.isDefault).map((view) => view.id),
      [second.id],
      "the outgoing default is demoted in the same write, not left beside the new one",
    );

    // Clearing it leaves the Database opening on "All" again.
    await caller.view.saved.update({
      organizationId: PILOT_ORGANIZATION,
      viewId: second.id,
      isDefault: false,
    });
    const cleared = await caller.view.saved.list({
      organizationId: PILOT_ORGANIZATION,
      databaseId: DATABASE,
    });
    assert.equal(cleared.some((view) => view.isDefault), false);
  });
});

test("rename, re-scope and delete all persist", async () => {
  await onLocalPlane(async (wiring) => {
    const caller = makeCaller(wiring);
    const saved = await caller.view.saved.save({
      organizationId: PILOT_ORGANIZATION,
      databaseId: DATABASE,
      name: "Draft",
      config: config(),
    });
    await caller.view.saved.update({
      organizationId: PILOT_ORGANIZATION,
      viewId: saved.id,
      name: "Won deals",
      scope: "organization",
    });
    const [renamed] = await caller.view.saved.list({
      organizationId: PILOT_ORGANIZATION,
      databaseId: DATABASE,
    });
    assert.equal(renamed?.name, "Won deals");
    assert.equal(renamed?.scope, "organization");

    await caller.view.saved.remove({
      organizationId: PILOT_ORGANIZATION,
      viewId: saved.id,
    });
    assert.deepEqual(
      await caller.view.saved.list({
        organizationId: PILOT_ORGANIZATION,
        databaseId: DATABASE,
      }),
      [],
      "delete is a delete — a List a user removed must not come back on the next read",
    );
  });
});
