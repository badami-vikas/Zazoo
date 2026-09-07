/**
 * Behavioural replacement for the deleted source-grep suites (2026-08-03 test
 * audit). The old view-grammar/table-renderers tests read .tsx source and
 * regex-matched strings — they could not fail on broken behaviour, only on
 * renames. These import the REAL dataviews logic and drive it with data, so
 * they fail when the grammar actually breaks.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  computeEligibleKinds,
  migrateViewConfig,
  viewConfigForKind,
  isFlaggableValue,
  moduleIdFromDatabaseId,
} from "../src/app/dataviews/eligibility.ts";
import { filterRowsByQuery } from "../src/app/dataviews/rowSearch.ts";

const bareSpec = {
  id: "things",
  columns: [
    { id: "name", label: "Name", kind: "text" },
    { id: "notes", label: "Notes", kind: "text" },
  ],
};

const richSpec = {
  id: "deals",
  columns: [
    { id: "name", label: "Name", kind: "text" },
    { id: "stage", label: "Stage", kind: "select", options: ["new", "won"] },
    { id: "close_date", label: "Close date", kind: "date" },
    { id: "hq", label: "HQ", kind: "location" },
    { id: "parent", label: "Parent", kind: "relation", relationTarget: "deals" },
    { id: "sponsor", label: "Sponsor", kind: "relation", relationTarget: "people" },
  ],
};

test("eligibility: a bare text table gets exactly the driverless kinds", () => {
  assert.deepEqual(computeEligibleKinds(bareSpec), ["table", "list", "gallery", "form"]);
});

test("eligibility: each driver column unlocks exactly its view kind", () => {
  const kinds = computeEligibleKinds(richSpec);
  // select → board AND chart, date → calendar AND timeline, location → map,
  // self-relation → tree, outward relation → graph. `list` needs no driver.
  // Order is the grammar's canonical order.
  assert.deepEqual(kinds, [
    "table",
    "board",
    "list",
    "gallery",
    "form",
    "calendar",
    "timeline",
    "chart",
    "map",
    "graph",
    "tree",
  ]);
});

test("eligibility: a relation targeting the spec's own id drives tree, not graph", () => {
  const selfOnly = {
    id: "tasks",
    columns: [
      { id: "name", label: "Name", kind: "text" },
      { id: "parent", label: "Parent", kind: "relation", relationTarget: "tasks" },
    ],
  };
  const kinds = computeEligibleKinds(selfOnly);
  assert.ok(kinds.includes("tree"));
  assert.ok(!kinds.includes("graph"));
});

test("migrateViewConfig: retired kinds map to their canonical replacements", () => {
  // "kanban" and "network" are pre-vocab kinds; the migration must land them on
  // board/graph — and only when the spec is actually eligible for the target.
  const migrated = migrateViewConfig(richSpec, {
    ...viewConfigForKind(richSpec, "table"),
    kind: "kanban",
  });
  assert.equal(migrated?.kind, "board");

  const graphMigrated = migrateViewConfig(richSpec, {
    ...viewConfigForKind(richSpec, "table"),
    kind: "network",
  });
  assert.equal(graphMigrated?.kind, "graph");
});

test("migrateViewConfig: an unknown kind is rejected with null, never guessed", () => {
  const result = migrateViewConfig(bareSpec, {
    ...viewConfigForKind(bareSpec, "table"),
    kind: "sparkline-dashboard",
  });
  // Unregistered kinds normalize to null; DataViews' registry-miss boundary
  // renders the explicit error for that. (Eligibility of a KNOWN kind is the
  // shell's job, not the migration's — migrating "calendar" onto a spec with
  // no date column still returns a calendar config, and the shell shows its
  // "not eligible" message rather than rendering it.)
  assert.equal(result, null);
  const knownButIneligible = migrateViewConfig(bareSpec, {
    ...viewConfigForKind(bareSpec, "table"),
    kind: "calendar",
  });
  assert.equal(knownButIneligible?.kind, "calendar");
});

test("viewConfigForKind: board binds groupBy to the select driver column", () => {
  const board = viewConfigForKind(richSpec, "board");
  assert.equal(board.kind, "board");
  assert.equal(board.groupBy, "stage");
});

test("filterRowsByQuery: case-insensitive match across all columns, empty query is identity", () => {
  const rows = [
    { name: "Grace Hopper", notes: "compiler" },
    { name: "Alan Kay", notes: "Smalltalk" },
  ];
  assert.equal(filterRowsByQuery(rows, "").length, 2);
  assert.deepEqual(
    filterRowsByQuery(rows, "gRaCe").map((r) => r.name),
    ["Grace Hopper"],
  );
  // Matches values in ANY column, not just name.
  assert.deepEqual(
    filterRowsByQuery(rows, "smalltalk").map((r) => r.name),
    ["Alan Kay"],
  );
  assert.equal(filterRowsByQuery(rows, "no-such-value").length, 0);
});

test("red-flag anchors: empty/absent values are never flaggable (mirrors the '—' fallback)", () => {
  assert.ok(isFlaggableValue("text"));
  assert.ok(isFlaggableValue(42));
  assert.ok(isFlaggableValue(["chip"]));
  // The rule mirrors formatCell's emptiness fallback: what renders as "—" is
  // not a data value a Human can meaningfully flag.
  assert.ok(!isFlaggableValue(null));
  assert.ok(!isFlaggableValue(undefined));
  assert.ok(!isFlaggableValue("   "));
  assert.ok(!isFlaggableValue([]));
});

test("moduleIdFromDatabaseId strips the database segment", () => {
  assert.equal(moduleIdFromDatabaseId("dealpilot.deals"), "dealpilot");
  assert.equal(moduleIdFromDatabaseId("people"), "people");
});
