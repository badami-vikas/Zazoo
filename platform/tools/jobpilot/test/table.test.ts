import { test } from "node:test";
import assert from "node:assert/strict";
import { jobsTableSpec, jobsCardFeedView, jobsTrackerView } from "../src/table.js";

test("jobsTableSpec: declares the flag column with green/yellow/red options", () => {
  const flagCol = jobsTableSpec.columns.find((c) => c.id === "flag");
  assert.deepEqual(flagCol?.options, ["green", "yellow", "red"]);
});

test("jobsCardFeedView: groups by flag, kind gallery", () => {
  const view = jobsCardFeedView();
  assert.equal(view.kind, "gallery");
  assert.equal(view.groupBy, "flag");
});

test("jobsTrackerView: groups by stage, kind kanban", () => {
  const view = jobsTrackerView();
  assert.equal(view.kind, "kanban");
  assert.equal(view.groupBy, "stage");
});
