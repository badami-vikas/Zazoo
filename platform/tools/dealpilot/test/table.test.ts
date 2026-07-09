import { test } from "node:test";
import assert from "node:assert/strict";
import { dealsTableSpec, dealsKanbanView } from "../src/table.js";

test("dealsTableSpec: declares the triage column with green/yellow/red options", () => {
  const triageCol = dealsTableSpec.columns.find((c) => c.id === "triage");
  assert.deepEqual(triageCol?.options, ["green", "yellow", "red"]);
});

test("dealsKanbanView: groups by triage, kind kanban", () => {
  const view = dealsKanbanView();
  assert.equal(view.kind, "kanban");
  assert.equal(view.groupBy, "triage");
});
