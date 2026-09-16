import assert from "node:assert/strict";
import test from "node:test";
import { issuesTableSpec, issuesUpdatedListView, pullsTableSpec, pullsTriageBoardView, reposTableSpec } from "../src/table.js";

test("devpilot Table specs declare a locked identifying column", () => {
  for (const spec of [reposTableSpec, pullsTableSpec, issuesTableSpec]) {
    assert.ok(spec.columns.length > 0);
    assert.equal(spec.columns[0]!.locked, true, `${spec.id} should lock its first column`);
  }
});

test("repos Table has exactly one editable column: tracked", () => {
  const editable = reposTableSpec.columns.filter((c) => c.editable !== false);
  assert.deepEqual(editable.map((c) => c.id), ["tracked"]);
});

test("pullsTriageBoardView groups by reviewState", () => {
  const view = pullsTriageBoardView();
  assert.equal(view.kind, "board");
  assert.equal(view.groupBy, "reviewState");
});

test("issuesUpdatedListView sorts by externalUpdatedAt desc", () => {
  const view = issuesUpdatedListView();
  assert.deepEqual(view.sorts, [{ id: "externalUpdatedAt", dir: "desc" }]);
});
