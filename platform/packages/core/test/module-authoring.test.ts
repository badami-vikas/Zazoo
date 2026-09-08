import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AUTHORABLE_COLUMN_KINDS,
  AuthoredModuleValidationError,
  authoredDatabaseCapabilityId,
  authoredModuleToManifest,
  parseAuthoredModuleSpec,
  validateAuthoredRecord,
  AuthoredRecordValidationError,
} from "../src/module/authoring.js";
import { parseModuleManifest } from "../src/module/manifest.js";

function draft(overrides: Record<string, unknown> = {}) {
  return {
    name: "reading-log",
    displayName: "Reading Log",
    summary: "Books I am reading and what I took from them.",
    description: "Tracks books, their status, and the notes worth keeping.",
    databases: [
      {
        id: "books",
        label: "Books",
        columns: [
          { id: "title", label: "Title", kind: "text", required: true },
          { id: "status", label: "Status", kind: "select", options: ["reading", "finished"] },
          { id: "finished-on", label: "Finished on", kind: "date" },
        ],
      },
    ],
    ...overrides,
  };
}

function rejects(raw: unknown, needle: string, reserved: string[] = []) {
  assert.throws(
    () => parseAuthoredModuleSpec(raw, reserved),
    (error: unknown) => {
      assert.ok(error instanceof AuthoredModuleValidationError, `expected a validation error, got ${String(error)}`);
      assert.match((error as Error).message, new RegExp(needle));
      return true;
    },
  );
}

test("a well-formed draft parses and keeps every declared column", () => {
  const spec = parseAuthoredModuleSpec(draft());
  assert.equal(spec.name, "reading-log");
  assert.equal(spec.databases.length, 1);
  assert.deepEqual(
    spec.databases[0]!.columns.map((column) => column.id),
    ["title", "status", "finished-on"],
  );
  assert.deepEqual(spec.databases[0]!.columns[1]!.options, ["reading", "finished"]);
});

// The whole point of the format: what it produces has to survive the gate that
// every built-in Module goes through, or an authored Module could never install.
test("the produced manifest passes the real parseModuleManifest gate", () => {
  const manifest = authoredModuleToManifest(parseAuthoredModuleSpec(draft()));
  const parsed = parseModuleManifest({ module: manifest });
  assert.equal(parsed.name, "reading-log");
  assert.equal(parsed.kind, "module");
  assert.equal(parsed.module?.pages.length, 1);
  assert.equal(parsed.module?.pages[0]?.route, "/module/reading-log/books");
  assert.equal(parsed.module?.pages[0]?.databaseId, authoredDatabaseCapabilityId("reading-log", "books"));
  // The Module's landing route is its first Page, matching moduleNavTarget's
  // contract for every built-in.
  assert.equal(parsed.module?.route, "/module/reading-log/books");
});

test("an authored Module can never ship an Agent, an Automation, or a non-database capability", () => {
  const manifest = authoredModuleToManifest(parseAuthoredModuleSpec(draft()));
  assert.deepEqual(manifest.module?.agents, []);
  assert.deepEqual(manifest.module?.automations, []);
  assert.ok(manifest.capabilities.length > 0);
  for (const capability of manifest.capabilities) {
    assert.equal(capability.capabilityType, "database");
    assert.equal(capability.origin, "ai_generated");
    assert.equal(capability.audience, "private");
    // No egress, no widening: an authored Module cannot reach the network.
    for (const permission of capability.permissions) {
      assert.equal(permission.egress, false);
      assert.equal(permission.dataScope, "private");
      assert.equal(permission.resourceType, "record");
    }
  }
});

test("the same spec always projects the same manifest", () => {
  const spec = parseAuthoredModuleSpec(draft());
  assert.deepEqual(authoredModuleToManifest(spec), authoredModuleToManifest(spec));
});

// Each of these refusals exists because admitting it would install something
// that looks like it works and does not.
test("column kinds needing machinery outside the manifest are refused by name", () => {
  for (const [kind, needle] of [
    ["relation", "target Database"],
    ["formula", "expression evaluator"],
    ["skill", "governed Skill implementation"],
  ] as const) {
    rejects(
      draft({ databases: [{ id: "books", label: "Books", columns: [{ id: "x", label: "X", kind }] }] }),
      needle,
    );
  }
  assert.ok(!AUTHORABLE_COLUMN_KINDS.includes("relation" as never));
});

test("malformed drafts are refused rather than silently defaulted", () => {
  rejects(draft({ name: "Reading Log" }), "kebab-case");
  rejects(draft({ name: "relationship" }), "already taken", ["relationship"]);
  rejects(draft({ databases: [] }), "nothing to show");
  rejects(draft({ databases: [{ id: "books", label: "Books", columns: [] }] }), "holds nothing");
  rejects(
    draft({ databases: [{ id: "books", label: "Books", columns: [{ id: "s", label: "S", kind: "select" }] }] }),
    "options must be a non-empty array",
  );
  rejects(
    draft({ databases: [{ id: "books", label: "B", columns: [{ id: "t", label: "T", kind: "text", options: ["a"] }] }] }),
    "only meaningful for select",
  );
  // But an EMPTY list is how the model's strict schema says "none" — accepted.
  assert.equal(
    parseAuthoredModuleSpec(
      draft({ databases: [{ id: "books", label: "B", columns: [{ id: "t", label: "T", kind: "text", options: [] }] }] }),
    ).databases[0]!.columns[0]!.options,
    undefined,
  );
  rejects(
    draft({
      databases: [
        { id: "books", label: "B", columns: [{ id: "t", label: "T", kind: "text" }] },
        { id: "books", label: "B2", columns: [{ id: "t", label: "T", kind: "text" }] },
      ],
    }),
    "id must be unique within the Module",
  );
  rejects(
    draft({
      databases: [
        {
          id: "books",
          label: "B",
          columns: [
            { id: "t", label: "T", kind: "text" },
            { id: "t", label: "T2", kind: "text" },
          ],
        },
      ],
    }),
    "unique within the Database",
  );
  rejects(draft({ summary: "   " }), "must not be empty");
});

test("caps refuse an unreviewably large draft", () => {
  const columns = Array.from({ length: 25 }, (_, index) => ({ id: `c${index}`, label: `C${index}`, kind: "text" }));
  rejects(draft({ databases: [{ id: "books", label: "B", columns }] }), "at most 24 columns");
  const databases = Array.from({ length: 7 }, (_, index) => ({
    id: `d${index}`,
    label: `D${index}`,
    columns: [{ id: "t", label: "T", kind: "text" }],
  }));
  rejects(draft({ databases }), "at most 6 entries");
});

// ---------------------------------------------------------------------------
// Record validation — the ONLY place an authored Database's shape is enforced
// (Postgres cannot type-check a cell inside jsonb).
// ---------------------------------------------------------------------------

const COLUMNS = parseAuthoredModuleSpec(
  draft({
    databases: [
      {
        id: "books",
        label: "Books",
        columns: [
          { id: "title", label: "Title", kind: "text", required: true },
          { id: "pages", label: "Pages", kind: "number" },
          { id: "status", label: "Status", kind: "select", options: ["reading", "finished"] },
          { id: "tags", label: "Tags", kind: "multiselect", options: ["fiction", "history"] },
          { id: "read-on", label: "Read on", kind: "date" },
          { id: "favourite", label: "Favourite", kind: "checkbox" },
        ],
      },
    ],
  }),
).databases[0]!.columns;

function rejectsRecord(raw: unknown, needle: string) {
  assert.throws(
    () => validateAuthoredRecord(COLUMNS, raw),
    (error: unknown) => {
      assert.ok(error instanceof AuthoredRecordValidationError, `expected a record error, got ${String(error)}`);
      assert.match((error as Error).message, new RegExp(needle));
      return true;
    },
  );
}

test("a valid Record normalizes to declared columns only", () => {
  const out = validateAuthoredRecord(COLUMNS, {
    title: "  Piranesi  ",
    pages: 245,
    status: "finished",
    tags: ["fiction"],
    "read-on": "2026-03-04",
    favourite: true,
  });
  assert.deepEqual(out, {
    title: "Piranesi",
    pages: 245,
    status: "finished",
    tags: ["fiction"],
    "read-on": "2026-03-04",
    favourite: true,
  });
});

test("an empty optional cell is null, and an absent one stays absent", () => {
  const out = validateAuthoredRecord(COLUMNS, { title: "Piranesi", pages: null });
  assert.equal(out.pages, null);
  assert.ok(!("status" in out), "a cell that was never set must not be invented");
});

test("every declared constraint is actually enforced", () => {
  rejectsRecord({ title: "x", nope: 1 }, "not a column of this Database");
  rejectsRecord({ pages: 1 }, '"Title" is required');
  rejectsRecord({ title: "   " }, '"Title" is required');
  rejectsRecord({ title: "x", pages: "245" }, "must be a finite number");
  rejectsRecord({ title: "x", pages: Number.POSITIVE_INFINITY }, "must be a finite number");
  rejectsRecord({ title: "x", status: "abandoned" }, "must be one of reading, finished");
  rejectsRecord({ title: "x", tags: ["fiction", "cookery"] }, "must only contain");
  rejectsRecord({ title: "x", tags: ["fiction", "fiction"] }, "must not repeat");
  rejectsRecord({ title: "x", "read-on": "4 March" }, "must be an ISO date");
  rejectsRecord({ title: "x", "read-on": "2026-13-45" }, "must be an ISO date");
  rejectsRecord({ title: "x", favourite: "yes" }, "must be true or false");
  rejectsRecord("not an object", "must be an object");
});

// The column shape must survive INTO the manifest: it is what the storage gets
// built from after approval, so anything not in the reviewed artifact is
// something the approval never covered.
test("declared columns survive the manifest round trip", () => {
  const manifest = parseModuleManifest({ module: authoredModuleToManifest(parseAuthoredModuleSpec(draft())) });
  const stored = manifest.authoredDatabases?.find((database) => database.id === "books");
  assert.ok(stored, "the authored Database must reach the manifest");
  assert.deepEqual(stored.columns, [
    { id: "title", label: "Title", kind: "text", required: true },
    { id: "status", label: "Status", kind: "select", options: ["reading", "finished"] },
    { id: "finished-on", label: "Finished on", kind: "date" },
  ]);
  // Every Page has a matching stored Database, or storage would be built for a
  // Page that renders nothing.
  for (const page of manifest.module?.pages ?? []) {
    assert.ok(
      manifest.authoredDatabases?.some((database) => database.id === page.id),
      `page ${page.id} has no authored Database`,
    );
  }
});

test("a built-in-shaped manifest carries no authoredDatabases", () => {
  const manifest = parseModuleManifest({
    module: {
      name: "plain", version: "1.0.0", kind: "module", summary: "s", description: "d",
      lineageManifestId: null, dependencies: [],
      capabilities: [{
        id: "plain.db", name: "DB", version: "1.0.0", capabilityType: "database",
        origin: "built_in", audience: "team",
        permissions: [{ resourceType: "record", action: "read", dataScope: "all", egress: false }],
        connectors: [], dependencies: [],
      }],
      contextProviders: [], organizationVocab: { alignsToBridgeTheme: true, domainTerms: {} },
    },
  });
  assert.equal(manifest.authoredDatabases, undefined);
});
