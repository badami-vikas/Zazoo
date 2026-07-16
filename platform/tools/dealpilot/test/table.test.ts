import { test } from "node:test";
import assert from "node:assert/strict";
import { dealsTableSpec, dealsKanbanView, dealsStageBoardView } from "../src/table.js";
import { PIPELINE_STAGES } from "../src/deal.js";

test("dealsTableSpec: declares the triage column with green/yellow/red options", () => {
  const triageCol = dealsTableSpec.columns.find((c) => c.id === "triage");
  assert.deepEqual(triageCol?.options, ["green", "yellow", "red"]);
});

test("dealsKanbanView: groups by triage, kind kanban", () => {
  const view = dealsKanbanView();
  assert.equal(view.kind, "kanban");
  assert.equal(view.groupBy, "triage");
});

test("dealsTableSpec: declares a stage column with all pipeline stages plus portfolio and passed", () => {
  const stageCol = dealsTableSpec.columns.find((c) => c.id === "stage");
  assert.ok(stageCol, "stage column should be present");
  for (const stage of PIPELINE_STAGES) {
    assert.ok(stageCol?.options?.includes(stage), `stage column should include "${stage}"`);
  }
  assert.ok(stageCol?.options?.includes("portfolio"), "stage column should include portfolio");
  assert.ok(stageCol?.options?.includes("passed"), "stage column should include passed");
});

test("dealsTableSpec: declares an askPrice column", () => {
  const col = dealsTableSpec.columns.find((c) => c.id === "askPrice");
  assert.ok(col, "askPrice column should be present");
  assert.equal(col?.kind, "number");
});

test("dealsStageBoardView: groups by stage, kind kanban", () => {
  const view = dealsStageBoardView();
  assert.equal(view.kind, "kanban");
  assert.equal(view.groupBy, "stage");
});
