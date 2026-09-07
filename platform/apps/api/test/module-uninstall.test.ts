/**
 * Deleting a Module (2026-09-07 user directive, verbatim): *"Currently I can
 * only hide modules, provide me an option to delete module, clicking on which
 * it should show confirmation with delete module only (data is not deleted),
 * delete module and associated data and Hide module (no deletion)"*.
 *
 * Hiding was the only thing that existed, and it is rail presentation — it
 * never reached the server. These cover the two answers that do: the Module
 * without what it collected, and the Module with it.
 *
 * On a MIGRATED Local Plane (`buildWiring({ localDir })`), because every fact
 * under test is a persisted one: the installation rows, the Records, and
 * whether a document is gone or merely empty.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildWiring, PILOT_ORGANIZATION, PILOT_USER, type Wiring } from "../src/wiring.js";
import { makeCaller } from "./caller.js";
import { approveInstall, builtModuleManifest } from "./module-fixtures.js";
import { MODULE_RECORDS_NAMESPACE_PREFIX } from "../src/routers/moduleRecords.js";

const TARGET = { organizationId: PILOT_ORGANIZATION, moduleName: "invoice-tracker", databaseId: "invoices" };
const RECORDS_KEY = `${MODULE_RECORDS_NAMESPACE_PREFIX}invoice-tracker.invoices`;

async function withInstalledModule(
  operation: (caller: ReturnType<typeof makeCaller>, wiring: Wiring) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bridge-module-uninstall-"));
  const wiring = await buildWiring({ localDir: join(dir, "local") });
  try {
    const caller = makeCaller(wiring);
    const { installation } = await caller.modules.register({
      organizationId: PILOT_ORGANIZATION,
      manifest: builtModuleManifest(),
    });
    await approveInstall(caller, installation.id);
    await caller.moduleRecords.insert({ ...TARGET, fields: { client: "Acme", amount: 120 } });
    await caller.moduleRecords.insert({ ...TARGET, fields: { client: "Globex", amount: 240 } });
    await operation(caller, wiring);
  } finally {
    await wiring.close?.();
    await rm(dir, { recursive: true, force: true });
  }
}

test("deleting the Module alone removes it and leaves what it collected", async () => {
  await withInstalledModule(async (caller, wiring) => {
    const result = await caller.modules.uninstall({
      organizationId: PILOT_ORGANIZATION,
      moduleName: "invoice-tracker",
      deleteData: false,
    });

    assert.equal(result.dataDeleted, false);
    assert.equal(result.deletedRecords, 0, "nothing was deleted, so nothing is counted");
    assert.ok(result.removedVersions >= 1, "every version row the Module had is gone");

    const listed = await caller.modules.list({ organizationId: PILOT_ORGANIZATION, limit: 100, offset: 0 });
    assert.equal(
      listed.items.some((item) => item.moduleName === "invoice-tracker"),
      false,
      "the Module is no longer installed",
    );

    // The point of this answer: the Records are still there, so reinstalling
    // finds them where they were left.
    const stored = (await wiring.localPlane.state.read(PILOT_ORGANIZATION, RECORDS_KEY)) as { rows?: unknown[] } | null;
    assert.equal(stored?.rows?.length, 2, "the Records survive a Module-only delete");
  });
});

test("deleting the Module with its data removes the Records too, and says how many", async () => {
  await withInstalledModule(async (caller, wiring) => {
    const result = await caller.modules.uninstall({
      organizationId: PILOT_ORGANIZATION,
      moduleName: "invoice-tracker",
      deleteData: true,
    });

    assert.equal(result.dataDeleted, true);
    assert.equal(result.deletedRecords, 2, "the user is owed the count of what went");
    assert.deepEqual(result.clearedDatabases, ["Invoices"]);

    // Gone, not emptied: an empty document reads back as "this Database has no
    // Records", which is a different fact from "this Database is gone".
    assert.equal(
      await wiring.localPlane.state.read(PILOT_ORGANIZATION, RECORDS_KEY),
      null,
      "the Records document is removed, not blanked",
    );
  });
});

test("deleting a Module that is not installed here is refused by name", async () => {
  await withInstalledModule(async (caller) => {
    await assert.rejects(
      caller.modules.uninstall({
        organizationId: PILOT_ORGANIZATION,
        moduleName: "no-such-module",
        deleteData: false,
      }),
      /is not installed here/,
    );
  });
});

test("an Agent cannot delete a Module", async () => {
  await withInstalledModule(async (_caller, wiring) => {
    const agent = makeCaller(wiring, { type: "agent", id: PILOT_USER });
    await assert.rejects(
      agent.modules.uninstall({
        organizationId: PILOT_ORGANIZATION,
        moduleName: "invoice-tracker",
        deleteData: true,
      }),
      /human/i,
    );
  });
});
