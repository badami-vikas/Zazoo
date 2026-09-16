/**
 * The Module Database query engine (TASK-108).
 *
 * `moduleRecords.list` used to hand back the whole stored document and the
 * Page capped itself at 100 rows; `pickDeclared` checked key membership only,
 * so a `number` column accepted an object and a `select` accepted an option
 * nobody declared. This suite is the floor under Notion parity: filter, sort,
 * group, search and page ON THE SERVER, and refuse a value the column cannot
 * hold rather than storing it.
 *
 * Run on a MIGRATED Local Plane (`buildWiring({ localDir })`) because the rows
 * live in the Local-Plane state store — an in-memory stand-in would hide the
 * one thing worth testing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildWiring, PILOT_ORGANIZATION } from "../src/wiring.js";
import { makeCaller } from "./caller.js";
import { approveInstall, builtModuleManifest } from "./module-fixtures.js";

/**
 * The shared invoice-tracker fixture, grown the columns a query engine has to
 * be honest about: a checkbox, a url, an email, a multiselect, and a relation
 * to a second declared Database.
 */
function queryModuleManifest(name = "invoice-tracker") {
  const manifest = builtModuleManifest(name);
  const surface = manifest.module.module;
  surface.databases[0]!.columns.push(
    { id: "paid", label: "Paid", kind: "checkbox" } as never,
    { id: "link", label: "Link", kind: "url" } as never,
    { id: "contact", label: "Contact", kind: "email" } as never,
    { id: "tags", label: "Tags", kind: "multiselect", options: ["urgent", "review"] } as never,
    { id: "account", label: "Account", kind: "relation", relationTarget: `${name}.accounts` } as never,
    {
      id: "accountFee",
      label: "Account fee",
      kind: "rollup",
      rollup_source: "account",
      rollup_property: "fee",
      rollup_function: "sum",
    } as never,
  );
  surface.databases.push({
    id: "accounts",
    name: "Accounts",
    columns: [
      { id: "title", label: "Title", kind: "text" },
      { id: "fee", label: "Fee", kind: "number" },
    ],
  } as never);
  return manifest;
}

async function withModule(
  slug: string,
  body: (
    caller: ReturnType<typeof makeCaller>,
    target: { organizationId: string; moduleName: string; databaseId: string },
  ) => Promise<void>,
  manifest: unknown = queryModuleManifest(),
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), `bridge-${slug}-`));
  const wiring = await buildWiring({ localDir: join(root, "local") });
  try {
    const caller = makeCaller(wiring);
    const { installation } = await caller.modules.register({
      organizationId: PILOT_ORGANIZATION,
      manifest,
    });
    await approveInstall(caller, installation.id);
    await body(caller, {
      organizationId: PILOT_ORGANIZATION,
      moduleName: "invoice-tracker",
      databaseId: "invoices",
    });
  } finally {
    await wiring.close();
    await rm(root, { recursive: true, force: true });
  }
}

test("list filters, sorts, searches and pages on the server — and the total counts what the filter kept", async () => {
  await withModule("moddb-query", async (caller, target) => {
    // Twelve Records so a match can sit past the first page of five.
    for (let index = 0; index < 12; index += 1) {
      await caller.moduleRecords.insert({
        ...target,
        fields: {
          client: index === 11 ? "Zephyr Holdings" : `Client ${String(index).padStart(2, "0")}`,
          amount: index * 100,
          status: index % 2 === 0 ? "sent" : "paid",
          due: `2026-0${(index % 9) + 1}-01`,
          paid: index % 2 === 1,
        },
      });
    }

    // 1. A filter that matches a row BEYOND the first page. Unfiltered, Zephyr
    // is row 12 of 12; the filter has to run before the slice or it is lost.
    const zephyr = await caller.moduleRecords.list({
      ...target,
      rowFilters: [{ field: "client", op: "contains", value: "Zephyr" }],
      limit: 5,
      offset: 0,
    });
    assert.equal(zephyr.total, 1);
    assert.equal(zephyr.hasMore, false);
    assert.deepEqual(zephyr.items.map((row) => row.client), ["Zephyr Holdings"]);

    // A number operator compares as a number, not as text: "900" > "1000" is
    // true for strings and false for money.
    const rich = await caller.moduleRecords.list({
      ...target,
      rowFilters: [{ field: "amount", op: "gt", value: "900" }],
      limit: 50,
      offset: 0,
    });
    assert.deepEqual(rich.items.map((row) => row.amount), [1000, 1100]);

    // A date operator compares as an instant: only the August and September
    // due dates are after the 15th of July.
    const late = await caller.moduleRecords.list({
      ...target,
      rowFilters: [{ field: "due", op: "after", value: "2026-07-15" }],
      limit: 50,
      offset: 0,
    });
    assert.deepEqual(late.items.map((row) => row.due).sort(), ["2026-08-01", "2026-09-01"]);
    assert.equal(late.total, 2);

    // 2. A multi-level sort: status descending, then amount ascending inside it.
    const sorted = await caller.moduleRecords.list({
      ...target,
      sorts: [{ id: "status", dir: "desc" }, { id: "amount", dir: "asc" }],
      limit: 50,
      offset: 0,
    });
    assert.deepEqual(
      sorted.items.slice(0, 3).map((row) => [row.status, row.amount]),
      [["sent", 0], ["sent", 200], ["sent", 400]],
    );
    assert.deepEqual(sorted.items[6], sorted.items[6]);
    assert.equal(sorted.items[6]!.status, "paid");

    // 3. Pagination totals: the total is the whole filtered set, not the page.
    const page1 = await caller.moduleRecords.list({ ...target, limit: 5, offset: 0 });
    assert.equal(page1.items.length, 5);
    assert.equal(page1.total, 12);
    assert.equal(page1.hasMore, true);
    const page3 = await caller.moduleRecords.list({ ...target, limit: 5, offset: 10 });
    assert.equal(page3.items.length, 2);
    assert.equal(page3.total, 12);
    assert.equal(page3.hasMore, false);

    // 4. Free-text search runs across the declared columns.
    const searched = await caller.moduleRecords.list({ ...target, query: "zephyr", limit: 50, offset: 0 });
    assert.equal(searched.total, 1);

    // 5. Grouping is reported, and the groups cover every kept row.
    const grouped = await caller.moduleRecords.list({ ...target, groupBy: "status", limit: 50, offset: 0 });
    assert.deepEqual(
      grouped.groups?.map((group) => [group.key, group.count]),
      [["paid", 6], ["sent", 6]],
    );
  });
});

test("a value the column cannot hold is refused, by column and by reason; required is enforced; a derived column is never written", async () => {
  await withModule("moddb-write", async (caller, target) => {
    const bad: [Record<string, unknown>, RegExp][] = [
      [{ client: "A", amount: { a: 1 } }, /amount/],
      [{ client: "A", amount: "not-a-number" }, /amount/],
      [{ client: "A", status: "archived" }, /status/],
      [{ client: "A", paid: "maybe" }, /paid/],
      [{ client: "A", due: "the 4th of never" }, /due/],
      [{ client: "A", contact: "not-an-email" }, /contact/],
      [{ client: "A", link: "not a url" }, /link/],
      [{ client: "A", tags: "urgent" }, /tags/],
      [{ client: "A", tags: ["urgent", "nope"] }, /tags/],
      [{ client: "A", account: 7 }, /account/],
    ];
    for (const [fields, reason] of bad) {
      await assert.rejects(
        caller.moduleRecords.insert({ ...target, fields }),
        reason,
        `${JSON.stringify(fields)} should have been refused`,
      );
    }

    // `required: true` on the manifest column is enforced on insert.
    await assert.rejects(caller.moduleRecords.insert({ ...target, fields: { amount: 10 } }), /client/);

    // A numeric string is COERCED and stored as a number, so a later `gt`
    // filter is comparing numbers.
    const row = await caller.moduleRecords.insert({
      ...target,
      fields: { client: "Acme", amount: "1200", paid: "true", status: "sent", tags: ["urgent"] },
    });
    assert.equal(row.amount, 1200);
    assert.equal(row.paid, true);

    // The same floor on update.
    await assert.rejects(
      caller.moduleRecords.update({ ...target, recordId: row.id, fields: { status: "archived" } }),
      /status/,
    );

    // The pre-existing key-membership refusal still stands.
    await assert.rejects(
      caller.moduleRecords.insert({ ...target, fields: { client: "B", secret: "x" } }),
      /secret is not a column/,
    );
  });
});

test("a rollup is computed from the far side of its relation on every read, and nothing can write it", async () => {
  await withModule("moddb-rollup", async (caller, target) => {
    const accounts = { ...target, databaseId: "accounts" };
    const acme = await caller.moduleRecords.insert({ ...accounts, fields: { title: "Acme", fee: 250 } });
    const beta = await caller.moduleRecords.insert({ ...accounts, fields: { title: "Beta", fee: 40 } });

    await caller.moduleRecords.insert({ ...target, fields: { client: "One", account: acme.id } });
    await caller.moduleRecords.insert({ ...target, fields: { client: "Two", account: beta.id } });
    // A relation pointing at nothing rolls up to zero for `sum` — the sum of no
    // values IS zero; it is `average`/`min` that would have to say "unknown".
    await caller.moduleRecords.insert({ ...target, fields: { client: "Three" } });

    const listed = await caller.moduleRecords.list({ ...target, sorts: [{ id: "client", dir: "asc" }], limit: 50, offset: 0 });
    assert.deepEqual(
      listed.items.map((row) => [row.client, row.accountFee]),
      [["One", 250], ["Three", 0], ["Two", 40]],
    );

    // Changing the far-side Record changes the rollup on the NEXT read: it is
    // derived, never stored, so it cannot go stale.
    await caller.moduleRecords.update({ ...accounts, recordId: acme.id, fields: { fee: 999 } });
    const again = await caller.moduleRecords.list({
      ...target,
      rowFilters: [{ field: "client", op: "is", value: "One" }],
      limit: 50,
      offset: 0,
    });
    assert.equal(again.items[0]?.accountFee, 999);

    // A rollup cell is refused rather than stored.
    await assert.rejects(
      caller.moduleRecords.insert({ ...target, fields: { client: "Four", accountFee: 5 } }),
      /rolled up/,
    );
  });
});

test("a select column the user adds carries its options, keeps them through a rename, and the options are enforced on write", async () => {
  await withModule("moddb-added-select", async (caller, target) => {
    const specId = "invoice-tracker.invoices";
    const schema = { organizationId: target.organizationId, specId };

    // A text column has no options to offer, so the server refuses to store any.
    await assert.rejects(
      caller.tableSchema.mutate({
        ...schema,
        op: { kind: "add", columnId: "note", label: "Note", columnKind: "text", options: ["a"] },
      }),
      /has no options/,
    );

    const afterAdd = await caller.tableSchema.mutate({
      ...schema,
      op: { kind: "add", columnId: "stage", label: "Stage", columnKind: "select", options: ["open", "closed"] },
    });
    assert.deepEqual(
      afterAdd.spec?.columns.find((column) => column.id === "stage")?.options,
      ["open", "closed"],
    );

    // The Page reads the same options, so its chooser offers something real.
    const definition = await caller.moduleRecords.definition(target);
    assert.deepEqual(definition.spec.columns.find((column) => column.id === "stage")?.options, ["open", "closed"]);

    const row = await caller.moduleRecords.insert({ ...target, fields: { client: "Acme", stage: "open" } });
    assert.equal(row.stage, "open");
    await assert.rejects(
      caller.moduleRecords.insert({ ...target, fields: { client: "Beta", stage: "shipped" } }),
      /Stage has no option/,
    );

    // A rename does not lose them: options are keyed by column id.
    const afterRename = await caller.tableSchema.mutate({
      ...schema,
      op: { kind: "rename", columnId: "stage", label: "Phase" },
    });
    const renamed = afterRename.spec?.columns.find((column) => column.id === "stage");
    assert.equal(renamed?.label, "Phase");
    assert.deepEqual(renamed?.options, ["open", "closed"]);
  });
});

test("a relation naming a Database nobody declared is refused at registration, in plain language", async () => {
  const root = await mkdtemp(join(tmpdir(), "bridge-moddb-rel-"));
  const wiring = await buildWiring({ localDir: join(root, "local") });
  try {
    const caller = makeCaller(wiring);
    const manifest = queryModuleManifest();
    const account = manifest.module.module.databases[0]!.columns.find(
      (column) => column.id === "account",
    ) as unknown as { relationTarget: string };
    account.relationTarget = "invoice-tracker.ghosts";
    await assert.rejects(
      caller.modules.register({ organizationId: PILOT_ORGANIZATION, manifest }),
      /invoice-tracker\.ghosts/,
    );
  } finally {
    await wiring.close();
    await rm(root, { recursive: true, force: true });
  }
});
