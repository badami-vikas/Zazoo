import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = async (path) => readFile(new URL(path, import.meta.url), "utf8");
const [
  dataViewsSource,
  registrySource,
  eligibilitySource,
  columnMenuSource,
  boardSource,
  tableSource,
  graphSource,
  mapSource,
  routeSource,
  moduleRoutesSource,
] = await Promise.all([
  source("../src/app/dataviews/DataViews.tsx"),
  source("../src/app/dataviews/registry.ts"),
  source("../src/app/dataviews/eligibility.ts"),
  source("../src/app/components/shared/StandardColumnMenu.tsx"),
  source("../src/app/dataviews/views/BoardView.tsx"),
  source("../src/app/dataviews/views/TableView.tsx"),
  source("../src/app/dataviews/views/GraphView.tsx"),
  source("../src/app/dataviews/views/MapView.tsx"),
  source("../src/app/routes.tsx"),
  source("../src/app/lib/moduleRoutes.ts"),
]);

test("one registry owns all canonical View kinds and metadata eligibility", () => {
  for (const kind of ["table", "board", "gallery", "form", "calendar", "map", "graph", "tree"]) {
    assert.match(registrySource, new RegExp(`${kind}:`));
  }
  assert.match(dataViewsSource, /VIEW_COMPONENT_REGISTRY\[activeView\.kind\]/);
  assert.match(eligibilitySource, /column\.kind === "date"/);
  assert.match(eligibilitySource, /column\.kind === "location"/);
  assert.match(eligibilitySource, /column\.kind === "relation"/);
  assert.match(eligibilitySource, /if \(kind !== "form"\) delete next\.formDefaults/);
  assert.doesNotMatch(registrySource, /kanban:|network:/);
});

test("the standard column menu exposes the canonical command set without unsafe mutation", () => {
  for (const command of [
    "Rename",
    "Edit column",
    "Change type",
    "AI Smartfill",
    "Filter",
    "Sort ascending",
    "Sort descending",
    "Group",
    "Calculate",
    "Lock column",
    "Hide column",
    "Add column left",
    "Add column right",
    "Duplicate column",
    "Delete column",
  ]) {
    assert.match(columnMenuSource, new RegExp(command));
  }
  assert.match(columnMenuSource, /databaseBacked &&/);
  assert.match(columnMenuSource, /Add page/);
  assert.match(columnMenuSource, /Remove page/);
  assert.match(columnMenuSource, /dependency preview, confirmation, and undo/);
  assert.match(boardSource, /groupColumn\?\.editable === true/);
  assert.match(boardSource, /groupColumn\.locked !== true/);
  assert.match(tableSource, /aria-sort=/);
  assert.match(tableSource, /Sorted \{activeSort\.dir/);
});

test("Graph uses one renderer for Page, selected-Database, and Second Brain scopes", () => {
  assert.match(graphSource, /single_database/);
  assert.match(graphSource, /multi_database/);
  assert.match(graphSource, /Full · Second Brain/);
  assert.match(graphSource, /Relation/);
  assert.match(graphSource, /Open Record/);
  assert.match(graphSource, /Open Relation/);
  assert.match(graphSource, /Governed Action/);
});

test("Map plots local coordinates without automatic public geocoding or tile egress", () => {
  assert.match(mapSource, /applyFilters\(projectedRows, view\.rowFilters, view\.filterMatch\)/);
  assert.match(mapSource, /applySorts\(/);
  assert.match(mapSource, /formatLocationInput\(row\[column\.id\]\)/);
  assert.match(mapSource, /parseLocationValue/);
  assert.match(mapSource, /world-atlas/);
  assert.match(mapSource, /confirmedLocalProvider/);
  assert.match(mapSource, /\}, \[locationColumn\?\.id\]\);/);
  assert.match(mapSource, /didFitRef\.current = false/);
  assert.match(mapSource, /Records at this location/);
  assert.match(mapSource, /colocated/);
  assert.match(mapSource, /aria-label=\{`Open \$\{record\.title\}`\}/);
  assert.match(mapSource, /Browse mapped Records/);
  assert.match(mapSource, /recordSearchText\(row, spec\.columns, title\)/);
  assert.doesNotMatch(mapSource, /\.\.\.item\.row/);
  assert.match(mapSource, /canUpdateRow && !canUpdateRow\(item\.row\)/);
  assert.doesNotMatch(mapSource, /nominatim\.openstreetmap\.org/);
  assert.doesNotMatch(mapSource, /tile\.openstreetmap\.org/);
});

test("Calendar no longer owns a route, Module route, or standalone catalog identity", () => {
  assert.doesNotMatch(routeSource, /path:\s*["']calendar(?:\/|["'])/);
  assert.doesNotMatch(moduleRoutesSource, /\bcalendar\s*:/);
});
