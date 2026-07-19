import { test } from "node:test";
import assert from "node:assert/strict";
import { dealsTableSpec, dealsThesisBoardView, dealsStageBoardView } from "../src/table.js";
import { PIPELINE_STAGES } from "../src/deal.js";

test("dealsTableSpec: declares explicit domain thesis-fit bands", () => {
  const fitBandColumn = dealsTableSpec.columns.find((column) => column.id === "thesisFitBand");
  assert.deepEqual(fitBandColumn?.options, ["strong_fit", "needs_review", "weak_fit"]);
});

test("dealsThesisBoardView: groups by thesis-fit band, kind board", () => {
  const view = dealsThesisBoardView();
  assert.equal(view.kind, "board");
  assert.equal(view.groupBy, "thesisFitBand");
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

test("dealsStageBoardView: groups by stage, kind board", () => {
  const view = dealsStageBoardView();
  assert.equal(view.kind, "board");
  assert.equal(view.groupBy, "stage");
});
