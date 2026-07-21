import { test } from "node:test";
import assert from "node:assert/strict";
import { jobsTableSpec, jobsCardFeedView, jobsTrackerView } from "../src/table.js";

test("jobsTableSpec: declares the flag column with explicit pursue/review/pass labels (AP-023 — no green/yellow feedback semantics)", () => {
  const flagCol = jobsTableSpec.columns.find((c) => c.id === "flag");
  assert.deepEqual(flagCol?.options, ["pursue", "review", "pass"]);
});

test("jobsCardFeedView: groups by flag, kind gallery", () => {
  const view = jobsCardFeedView();
  assert.equal(view.kind, "gallery");
  assert.equal(view.groupBy, "flag");
});

test("jobsTrackerView: groups by stage, kind board", () => {
  const view = jobsTrackerView();
  assert.equal(view.kind, "board");
  assert.equal(view.groupBy, "stage");
});
