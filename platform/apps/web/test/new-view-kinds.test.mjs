/**
 * TASK-111 — the three view kinds Notion has and this build did not (list,
 * timeline, chart), plus the gallery becoming a real gallery.
 *
 * Same shape as the existing dataviews-behavior/ui-conformance pair: the
 * eligibility grammar is imported and DRIVEN with specs (so it fails on broken
 * behaviour, not on a rename), and the parts that are inherently source-shaped
 * — is the kind wired into the component registry, does the component state an
 * honest reason when its driver column is missing — are asserted against the
 * source, because a registry entry that is not there cannot be driven.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { computeEligibleKinds, viewConfigForKind } from "../src/app/dataviews/eligibility.ts";

const DATAVIEWS = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "app", "dataviews");
const read = (rel) => readFileSync(join(DATAVIEWS, rel), "utf8");
/** A view file that does not exist yet fails the assertion instead of the run. */
const readOrEmpty = (rel) => {
  try {
    return read(rel);
  } catch {
    return "";
  }
};

const bareSpec = {
  id: "things",
  columns: [
    { id: "name", label: "Name", kind: "text" },
    { id: "notes", label: "Notes", kind: "text" },
  ],
};

const datedSpec = {
  id: "deals",
  columns: [
    { id: "name", label: "Name", kind: "text" },
    { id: "start", label: "Start", kind: "date" },
  ],
};

const groupableSpec = {
  id: "tickets",
  columns: [
    { id: "name", label: "Name", kind: "text" },
    { id: "stage", label: "Stage", kind: "select", options: ["new", "done"] },
    { id: "value", label: "Value", kind: "number" },
  ],
};

test("registry: list, timeline and chart all have a component in this build", () => {
  const registry = read("registry.ts");
  const body = registry.slice(registry.indexOf("VIEW_COMPONENT_REGISTRY"));
  for (const kind of ["list", "timeline", "chart"]) {
    assert.match(body, new RegExp(`\\n\\s*${kind}:\\s*\\w`), `${kind} is not registered`);
  }
  for (const component of ["ListView", "TimelineView", "ChartView"]) {
    assert.match(registry, new RegExp(`import \\{ ${component} \\}`), `${component} is not imported`);
  }
});

test("eligibility: list needs no driver — a bare text table can always list", () => {
  assert.ok(computeEligibleKinds(bareSpec).includes("list"));
});

test("eligibility: timeline is offered only where a date column drives it", () => {
  assert.ok(!computeEligibleKinds(bareSpec).includes("timeline"));
  assert.ok(computeEligibleKinds(datedSpec).includes("timeline"));
});

test("eligibility: chart is offered only where a groupable column drives it", () => {
  assert.ok(!computeEligibleKinds(bareSpec).includes("chart"));
  assert.ok(computeEligibleKinds(groupableSpec).includes("chart"));
});

test("viewConfigForKind: timeline defaults its date column, chart its group-by", () => {
  assert.equal(viewConfigForKind(datedSpec, "timeline").dateBy, "start");
  assert.equal(viewConfigForKind(groupableSpec, "chart").groupBy, "stage");
});

test("honest empty states: each new view states its missing driver rather than rendering blank", () => {
  assert.match(readOrEmpty("views/TimelineView.tsx"), /Timeline needs a date column/);
  assert.match(readOrEmpty("views/ChartView.tsx"), /Chart needs a column to group by/);
  // A view with no rows still says so, like every other view.
  for (const file of ["views/ListView.tsx", "views/TimelineView.tsx", "views/ChartView.tsx"]) {
    assert.match(readOrEmpty(file), /No .*records? /, `${file} has no empty state`);
  }
});

test("chart reuses the shared aggregate reductions rather than its own arithmetic", () => {
  assert.match(readOrEmpty("views/ChartView.tsx"), /computeAggregate.*from "\.\.\/aggregate\.js"/s);
});

test("list reuses the shared cell formatting rather than a renderer of its own", () => {
  assert.match(readOrEmpty("views/ListView.tsx"), /from "\.\.\/cell-format\.js"/);
});

test("gallery is a real gallery: card size, preview field and a property picker", () => {
  const gallery = read("views/GalleryView.tsx");
  assert.match(gallery, /view\.cardSize/, "gallery ignores ViewConfig.cardSize");
  assert.match(gallery, /cardPreviewField/, "gallery ignores ViewConfig.cardPreviewField");
  assert.match(gallery, /<img/, "gallery never renders a cover image");
  assert.match(gallery, /Properties/, "gallery has no property picker");
});

// A setting the user chose and then saved as a List has to come back. Timeline's
// zoom and end-date column, the chart's shape/reduction/value column and the
// gallery's chosen properties were local component state when these three views
// first landed, so a saved List forgot them (2026-09-06).
test("timeline, chart and gallery settings live in the saved View, not in local state", () => {
  const timeline = read("views/TimelineView.tsx");
  assert.match(timeline, /view\.timelineZoom/, "timeline zoom is not persisted");
  assert.match(timeline, /view\.endDateBy/, "timeline end-date column is not persisted");

  const chart = read("views/ChartView.tsx");
  for (const field of ["chartShape", "chartAggregate", "chartValueField"]) {
    assert.match(chart, new RegExp(`view\\.${field}`), `chart ${field} is not persisted`);
  }

  assert.match(read("views/GalleryView.tsx"), /view\.cardProperties/, "gallery properties are not persisted");

  for (const file of ["views/TimelineView.tsx", "views/ChartView.tsx", "views/GalleryView.tsx"]) {
    assert.doesNotMatch(readOrEmpty(file), /useState/, `${file} still holds a view setting in local state`);
  }
});
