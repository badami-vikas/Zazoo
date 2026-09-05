/**
 * Records of a Builder-built Module (ADR 2026-09-04): the manifest declares a
 * Database with columns, the standard Module Page reads its TableSpec and rows
 * from `moduleRecords.*`, and nothing outside the declared columns is stored.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseModuleManifest } from "@bridge/core";

import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_ORGANIZATION } from "../src/wiring.js";
import { makeCaller, makeRun } from "./caller.js";
import { moduleDatabaseSpec } from "../src/routers/moduleRecords.js";

export function builtModuleManifest(name = "invoice-tracker") {
  return {
    module: {
      name,
      version: "0.1.0",
      kind: "organization_definition",
      summary: "Client invoices and their status",
      description: "A Module the Builder made from a user request",
      dependencies: [],
      capabilities: [
        {
          id: `${name}.invoices`,
          capability_type: "database",
          version: "0.1.0",
          permissions: [
            { resource_type: "record", action: "read", data_scope: "private", egress: false },
            { resource_type: "record", action: "write", data_scope: "private", egress: false },
          ],
          connectors: [],
        },
      ],
      module: {
        displayName: "Invoice Tracker",
        route: `/module/${name}`,
        databases: [
          {
            id: "invoices",
            name: "Invoices",
            columns: [
              { id: "client", label: "Client", kind: "text", required: true },
              { id: "amount", label: "Amount", kind: "number" },
              { id: "status", label: "Status", kind: "select", options: ["draft", "sent", "paid"] },
              { id: "due", label: "Due", kind: "date" },
            ],
          },
        ],
        pages: [
          {
            id: "invoices",
            name: "Invoices",
            route: `/module/${name}/invoices`,
            database_id: "invoices",
            capability_id: `${name}.invoices`,
          },
        ],
        agents: [],
        automations: [],
      },
    },
  };
}

test("a manifest declares its Databases; a Page must point at one of them", () => {
  const parsed = parseModuleManifest(builtModuleManifest());
  assert.equal(parsed.module?.databases?.length, 1);
  assert.deepEqual(
    parsed.module?.databases?.[0]?.columns.map((column) => column.kind),
    ["text", "number", "select", "date"],
  );

  const wrongPage = builtModuleManifest();
  wrongPage.module.module.pages[0]!.database_id = "nowhere";
  assert.throws(() => parseModuleManifest(wrongPage), /database_id nowhere is not a declared database/);

  const badKind = builtModuleManifest();
  (badKind.module.module.databases[0]!.columns[0] as { kind: string }).kind = "blob";
  assert.throws(() => parseModuleManifest(badKind), /kind must be one of/);
});

test("the declared columns become the Page's TableSpec, with the Organization's overlay applied", () => {
  const parsed = parseModuleManifest(builtModuleManifest());
  const database = parsed.module!.databases![0]!;
  const spec = moduleDatabaseSpec("invoice-tracker", database, {
    overlay: { labels: { amount: "Total" } },
    previous: null,
  });
  assert.equal(spec.id, "invoice-tracker.invoices");
  assert.deepEqual(
    spec.columns.map((column) => [column.id, column.label]),
    [["client", "Client"], ["amount", "Total"], ["status", "Status"], ["due", "Due"]],
  );
  assert.deepEqual(spec.columns[2]!.options, ["draft", "sent", "paid"]);
});

test("a registered, installed Module serves its definition and rows; an undeclared column is refused; an Agent cannot write", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { installation } = await caller.modules.register({
      organizationId: PILOT_ORGANIZATION,
      manifest: builtModuleManifest(),
    });
    // Read-only + private-write, no egress: informational, so install flows
    // through the same pipeline round trip every Module takes.
    await approveInstall(caller, installation.id);

    const target = {
      organizationId: PILOT_ORGANIZATION,
      moduleName: "invoice-tracker",
      databaseId: "invoices",
    };
    const definition = await caller.moduleRecords.definition(target);
    assert.equal(definition.name, "Invoices");
    assert.deepEqual(
      definition.spec.columns.map((column) => column.id),
      ["client", "amount", "status", "due"],
    );

    const empty = await caller.moduleRecords.list(target);
    assert.deepEqual(empty, { items: [], total: 0 });

    const row = await caller.moduleRecords.insert({
      ...target,
      fields: { client: "Acme", amount: 1200, status: "sent" },
    });
    assert.equal(row.client, "Acme");
    assert.ok(row.id);

    await assert.rejects(
      caller.moduleRecords.insert({ ...target, fields: { client: "Beta", secret: "x" } }),
      /secret is not a column/,
    );

    const updated = await caller.moduleRecords.update({
      ...target,
      recordId: row.id,
      fields: { status: "paid" },
    });
    assert.equal(updated.status, "paid");
    assert.equal(updated.client, "Acme");

    const listed = await caller.moduleRecords.list(target);
    assert.equal(listed.total, 1);
    assert.equal(listed.items[0]?.status, "paid");

    await assert.rejects(
      caller.moduleRecords.definition({ ...target, databaseId: "ledger" }),
      /declares no Database ledger/,
    );

    const agent = appRouter.createCaller({
      wiring,
      run: makeRun(),
      identity: { type: "agent", id: "b0000000-0000-4000-a000-00000000ee01" },
      authenticated: true,
      verifying: false,
    });
    await assert.rejects(
      agent.moduleRecords.insert({ ...target, fields: { client: "Robot" } }),
      /[Hh]uman/,
    );

    const removed = await caller.moduleRecords.remove({ ...target, recordIds: [row.id] });
    assert.deepEqual(removed, { removed: 1 });
    assert.equal((await caller.moduleRecords.list(target)).total, 0);
  } finally {
    await wiring.close();
  }
});

/** The invoice tracker grown along the Rulebook's structure (TASK-100): a
 * Payments Database that needs its own toolbar becomes a sub-module, and the
 * Invoices Database switches Intelligence off for every one of its Records. */
function structuredModuleManifest(name = "invoice-tracker") {
  const manifest = builtModuleManifest(name);
  const surface = manifest.module.module as typeof manifest.module.module & {
    sub_modules?: { id: string; name: string; pages: string[] }[];
  };
  (surface.databases[0] as { sections?: Record<string, boolean> }).sections = { intelligence: false };
  surface.databases.push({
    id: "payments",
    name: "Payments",
    columns: [
      { id: "invoice", label: "Invoice", kind: "text", required: true },
      { id: "amount", label: "Amount", kind: "number" },
    ],
  });
  surface.pages.push({
    id: "payments",
    name: "Payments",
    route: `/module/${name}/payments`,
    database_id: "payments",
    capability_id: `${name}.invoices`,
  });
  surface.sub_modules = [{ id: "billing", name: "Billing", pages: ["payments"] }];
  return manifest;
}

test("the resolved structure is served, and a declared Database's Sections are the default the Record page reads (TASK-100)", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { installation } = await caller.modules.register({
      organizationId: PILOT_ORGANIZATION,
      manifest: structuredModuleManifest(),
    });
    await approveInstall(caller, installation.id);

    const structure = await caller.moduleRecords.structure({
      organizationId: PILOT_ORGANIZATION,
      moduleName: "invoice-tracker",
    });
    assert.deepEqual(structure.rootPages.map((page) => page.id), ["invoices"]);
    assert.deepEqual(
      structure.subModules.map((sub) => [sub.id, sub.name, sub.pages.map((page) => page.id)]),
      [["billing", "Billing", ["payments"]]],
    );
    assert.deepEqual(structure.databases, [
      { id: "invoices", name: "Invoices", sections: { notes: true, intelligence: false, governance: true } },
      { id: "payments", name: "Payments", sections: { notes: true, intelligence: true, governance: true } },
    ]);

    const definition = await caller.moduleRecords.definition({
      organizationId: PILOT_ORGANIZATION,
      moduleName: "invoice-tracker",
      databaseId: "invoices",
    });
    assert.deepEqual(definition.sections, { notes: true, intelligence: false, governance: true });

    // What every Record page of the Database shows comes from the manifest
    // until the owner switches a Section, and switching one keeps the rest.
    const specId = "invoice-tracker.invoices";
    assert.deepEqual(
      await caller.records.sections({ organizationId: PILOT_ORGANIZATION, specId }),
      { notes: true, intelligence: false, governance: true },
    );
    assert.deepEqual(
      await caller.records.setSection({ organizationId: PILOT_ORGANIZATION, specId, section: "governance", enabled: false }),
      { notes: true, intelligence: false, governance: false },
    );
    // A built-in Database that declares nothing keeps the all-off default.
    assert.deepEqual(
      await caller.records.sections({ organizationId: PILOT_ORGANIZATION, specId: "task-manager.tasks" }),
      { notes: false, intelligence: false, governance: false },
    );
  } finally {
    await wiring.close();
  }
});

/** Install is a governed proposal. A Module that writes Records is
 * transformational, so it parks for the human's decision rather than
 * auto-installing — the same path every non-informational Module takes. */
export async function approveInstall(
  caller: ReturnType<typeof makeCaller>,
  installationId: string,
): Promise<void> {
  const result = await caller.modules.install({
    organizationId: PILOT_ORGANIZATION,
    installationId,
    todayKey: "2026-09-04",
  });
  if (!result.installed) {
    assert.ok(result.proposal, "a parked install carries its proposal");
    await caller.action.decide({ proposalId: result.proposal.id, decision: "approve" });
  }
  const row = await caller.modules.list({ organizationId: PILOT_ORGANIZATION, limit: 100, offset: 0 });
  const mine = row.items.find((item) => item.id === installationId);
  assert.equal(mine?.status, "installed");
}
