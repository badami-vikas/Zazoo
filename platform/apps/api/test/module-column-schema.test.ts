/**
 * A Module Database's columns, through the governed schema capability.
 *
 * User report, 2026-09-05/06, on a Module the Builder made:
 *
 *   "Also I dont see add list option in academics module, why is add column
 *    inactive in academics module, I should always be able to add columns in
 *    all modules. ... Also I'm unable to rename columns, why?"
 *
 * Every command was dead for the same reason: `readTableSchemaCapability` knew
 * six hard-coded shipped specs and answered "no governed schema-mutation
 * capability is installed" for everything else — so a Module Database, whose
 * spec comes from its installed manifest, could not be renamed, retyped,
 * locked or deleted. And nothing anywhere could ADD a column.
 *
 * These run on a MIGRATED Local Plane (`buildWiring({ localDir })`), because
 * the overlay, the Module installation and the Records are all persisted: an
 * in-memory store would prove the rules and none of the storage.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_ORGANIZATION, type Wiring } from "../src/wiring.js";
import { makeCaller, makeRun } from "./caller.js";
import { approveInstall, builtModuleManifest } from "./module-fixtures.js";

const SPEC = "invoice-tracker.invoices";
const TARGET = {
  organizationId: PILOT_ORGANIZATION,
  moduleName: "invoice-tracker",
  databaseId: "invoices",
};

/** A migrated Local Plane with the Builder's Module installed on it. */
async function withInstalledModule(
  operation: (caller: ReturnType<typeof makeCaller>, wiring: Wiring) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bridge-module-columns-"));
  const wiring = await buildWiring({ localDir: join(dir, "local") });
  try {
    const caller = makeCaller(wiring);
    const { installation } = await caller.modules.register({
      organizationId: PILOT_ORGANIZATION,
      manifest: builtModuleManifest(),
    });
    await approveInstall(caller, installation.id);
    await operation(caller, wiring);
  } finally {
    await wiring.close?.();
    await rm(dir, { recursive: true, force: true });
  }
}

test("a Module Database resolves the schema capability from its installed manifest", async () => {
  await withInstalledModule(async (caller) => {
    const view = await caller.tableSchema.get({ organizationId: PILOT_ORGANIZATION, specId: SPEC });
    assert.equal(view.available, true, "every installed Module's Database is schema-mutable");
    assert.equal(view.reason, null);
    assert.equal(view.spec?.id, SPEC);
    assert.deepEqual(
      view.spec?.columns.map((column) => column.id),
      ["client", "amount", "status", "due"],
      "the columns are the manifest's own",
    );
    // Adding depends on the ROW STORE, not just on the spec: a Module Database
    // keeps its Records as documents of the columns the resolved spec
    // declares, so a new column has somewhere to put its values.
    assert.equal(view.canAddColumn, true);
    assert.equal(view.addReason, null);
  });
});

test("a Module column renames, and the Module Page reads the new label back", async () => {
  await withInstalledModule(async (caller) => {
    const saved = await caller.tableSchema.mutate({
      organizationId: PILOT_ORGANIZATION,
      specId: SPEC,
      op: { kind: "rename", columnId: "due", label: "Payable by" },
    });
    assert.equal(saved.spec?.columns.find((column) => column.id === "due")?.label, "Payable by");

    // The surface the user was looking at — not just the capability's own echo.
    const definition = await caller.moduleRecords.definition(TARGET);
    assert.equal(
      definition.spec.columns.find((column) => column.id === "due")?.label,
      "Payable by",
      "the standard Module Page renders the renamed column",
    );
  });
});

test("a column added to a Module Database is placed, stored, and holds values", async () => {
  await withInstalledModule(async (caller) => {
    const added = await caller.tableSchema.mutate({
      organizationId: PILOT_ORGANIZATION,
      specId: SPEC,
      op: {
        kind: "add",
        columnId: "poNumber",
        label: "PO number",
        columnKind: "text",
        position: { relativeTo: "client", side: "right" },
      },
    });
    assert.deepEqual(
      added.spec?.columns.map((column) => column.id),
      ["client", "poNumber", "amount", "status", "due"],
      "'Add column right' puts it to the right of the column it was opened on",
    );

    // The point of the column: a Record can carry a value in it. Before the
    // add, `moduleRecords.insert` refuses `poNumber` as undeclared.
    const row = await caller.moduleRecords.insert({
      ...TARGET,
      fields: { client: "Acme", poNumber: "PO-88" },
    });
    assert.equal(row.poNumber, "PO-88");
    assert.equal((await caller.moduleRecords.list(TARGET)).items[0]?.poNumber, "PO-88");

    // And it behaves like any other column afterwards — one code path, not two.
    const renamed = await caller.tableSchema.mutate({
      organizationId: PILOT_ORGANIZATION,
      specId: SPEC,
      op: { kind: "rename", columnId: "poNumber", label: "Purchase order" },
    });
    assert.equal(
      renamed.spec?.columns.find((column) => column.id === "poNumber")?.label,
      "Purchase order",
    );
  });
});

test("add is refused on a duplicate id and on an id that is not a field name", async () => {
  await withInstalledModule(async (caller) => {
    await assert.rejects(
      () =>
        caller.tableSchema.mutate({
          organizationId: PILOT_ORGANIZATION,
          specId: SPEC,
          op: { kind: "add", columnId: "amount", label: "Amount again", columnKind: "number" },
        }),
      /already has a column amount/,
      "a duplicate would render twice and write to one cell",
    );
    for (const columnId of ["__proto__", "2nd", "has space", "no-dashes"]) {
      await assert.rejects(
        () =>
          caller.tableSchema.mutate({
            organizationId: PILOT_ORGANIZATION,
            specId: SPEC,
            op: { kind: "add", columnId, label: "Smuggled", columnKind: "text" },
          }),
        /column id|invalid|Invalid/,
        `${columnId} is not a field name and must be refused at the edge`,
      );
    }
  });
});

test("undo takes an added column back off, one level like every other command", async () => {
  await withInstalledModule(async (caller) => {
    await caller.tableSchema.mutate({
      organizationId: PILOT_ORGANIZATION,
      specId: SPEC,
      op: { kind: "add", columnId: "notes", label: "Notes", columnKind: "text" },
    });
    const undone = await caller.tableSchema.undo({
      organizationId: PILOT_ORGANIZATION,
      specId: SPEC,
    });
    assert.ok(
      !undone.spec?.columns.some((column) => column.id === "notes"),
      "undo removes the column the add put there",
    );
    assert.equal(undone.canUndo, false);
  });
});

test("a shipped sqlite-backed Database refuses the add and says why", async () => {
  await withInstalledModule(async (caller) => {
    const view = await caller.tableSchema.get({
      organizationId: PILOT_ORGANIZATION,
      specId: "accounting.reports",
    });
    // Reshaping the columns it HAS stays available; gaining one does not, and
    // the two answers are separate so the menu can be honest about each.
    assert.equal(view.available, true);
    assert.equal(view.canAddColumn, false);
    assert.ok(view.addReason && view.addReason.length > 0, "an impossibility must say why");
    await assert.rejects(
      () =>
        caller.tableSchema.mutate({
          organizationId: PILOT_ORGANIZATION,
          specId: "accounting.reports",
          op: { kind: "add", columnId: "invented", label: "Invented", columnKind: "text" },
        }),
      /nowhere to put its values/,
    );
  });
});

test("an Agent cannot add a column to a Module Database", async () => {
  await withInstalledModule(async (_caller, wiring) => {
    const agent = appRouter.createCaller({
      wiring,
      run: makeRun(),
      identity: { type: "agent", id: "b0000000-0000-4000-a000-00000000ee02" },
      authenticated: true,
      verifying: false,
    });
    await assert.rejects(
      () =>
        agent.tableSchema.mutate({
          organizationId: PILOT_ORGANIZATION,
          specId: SPEC,
          op: { kind: "add", columnId: "robotColumn", label: "Robot", columnKind: "text" },
        }),
      /Human decision/,
      "a schema an Agent can rewrite is not a schema",
    );
  });
});

test("saved Lists are available on a Module Database, the same as any other", async () => {
  // The other half of the same report ("I dont see add list option in academics
  // module"). `view.saved.*` takes any databaseId, so a Module Database is not
  // excluded — this is the regression guard for that, and the evidence that the
  // control's disabled reason can only ever be a real server failure.
  await withInstalledModule(async (caller) => {
    const empty = await caller.view.saved.list({
      organizationId: PILOT_ORGANIZATION,
      databaseId: SPEC,
    });
    assert.deepEqual(empty, []);
    const saved = await caller.view.saved.save({
      organizationId: PILOT_ORGANIZATION,
      databaseId: SPEC,
      name: "Unpaid",
      config: {
        id: `${SPEC}:table`,
        kind: "table",
        sorts: [],
        rowFilters: [{ field: "status", op: "is", value: "sent" }],
        filterMatch: "all",
        groupBy: null,
      },
    });
    assert.equal(saved.name, "Unpaid");
    assert.deepEqual(
      (
        await caller.view.saved.list({ organizationId: PILOT_ORGANIZATION, databaseId: SPEC })
      ).map((view) => view.name),
      ["Unpaid"],
    );
  });
});
