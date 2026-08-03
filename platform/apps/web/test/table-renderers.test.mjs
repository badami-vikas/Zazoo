/**
 * ADR-160 — the `table` view kind keeps TWO renderers behind ONE contract.
 *
 * These pin the properties that made reviving Glide safe, so a later edit
 * cannot quietly recreate the drift that orphaned it the first time:
 * one registered component, shared cell semantics, no view-grammar widening,
 * and no fake red-flag affordance on the canvas path (AP-021).
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = async (path) => readFile(new URL(path, import.meta.url), "utf8");
const [tableSource, glideSource, cellFormatSource, registrySource, packageJson] = await Promise.all([
  source("../src/app/dataviews/views/TableView.tsx"),
  source("../src/app/dataviews/views/GlideTableView.tsx"),
  source("../src/app/dataviews/cell-format.tsx"),
  source("../src/app/dataviews/registry.ts"),
  source("../package.json"),
]);

test("the table kind stays ONE registered component; Glide is not a new view kind", () => {
  // The registry maps kind -> component. Widening ViewKind would be a canon
  // change to @bridge/tables' view grammar, which ADR-160 explicitly avoided.
  assert.match(registrySource, /table: TableView/);
  assert.doesNotMatch(registrySource, /GlideTableView/);
  assert.doesNotMatch(registrySource, /\bgrid:/);
});

test("TableView dispatches to the canvas renderer on VISIBLE row count", () => {
  assert.match(tableSource, /GLIDE_ROW_THRESHOLD/);
  assert.match(tableSource, /return <GlideTableView \{\.\.\.props\} \/>/);
  // Counted AFTER applyFilters — a filtered-down slice of a huge dataset must
  // still get the richer DOM path, so the threshold cannot read `data.length`.
  assert.match(tableSource, /applyFilters\(data, view\.rowFilters, view\.filterMatch\)\.length/);
  assert.doesNotMatch(tableSource, /data\.length > GLIDE_ROW_THRESHOLD/);
});

test("both renderers read cell semantics from the shared module, not their own copies", () => {
  assert.match(tableSource, /from "\.\.\/cell-format\.js"/);
  assert.match(glideSource, /from "\.\.\/cell-format\.js"/);
  // The ADR-155 glyph logic must live in exactly one place.
  assert.match(cellFormatSource, /case "badge"/);
  assert.match(cellFormatSource, /case "rag"/);
  assert.match(cellFormatSource, /case "meter"/);
  for (const duplicated of [/function formatCurrency/, /const BADGE_TONES/, /const RAG_DOT/]) {
    assert.doesNotMatch(tableSource, duplicated);
    assert.doesNotMatch(glideSource, duplicated);
  }
});

test("the canvas renderer never paints a red-flag affordance it cannot govern (AP-021)", () => {
  // Assert on real usage, not mentions — the file's header comment explains the
  // omission and must be allowed to name the component it deliberately omits.
  const glideCode = glideSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(glideCode, /import[^;]*RedFlag/);
  assert.doesNotMatch(glideCode, /<RedFlag/);
  // The DOM path is the one that carries it, and stays the default.
  assert.match(tableSource, /<RedFlagControl/);
});

test("canvas cells are editable ONLY through a governed update sink", () => {
  // allowOverlay (Glide's inline editor) must be gated on the caller-supplied
  // onUpdate, the row-level permission check, and the column's own editable
  // flag — never an editable-looking cell with no governed commit path.
  assert.match(glideSource, /Boolean\(onUpdate\)/);
  assert.match(glideSource, /canUpdateRow/);
  assert.match(glideSource, /col\.editable/);
  assert.match(glideSource, /allowOverlay: editable/);
  assert.match(glideSource, /void onUpdate\(rowId/);
});

test("the reinstated grid dependency is declared", () => {
  const pkg = JSON.parse(packageJson);
  assert.ok(pkg.dependencies["@glideapps/glide-data-grid"], "glide-data-grid must stay a real dependency");
  // Deleted with the dead prototype table — nothing may reintroduce them.
  for (const pruned of ["tesseract.js", "idb", "browser-image-compression", "date-fns"]) {
    assert.equal(pkg.dependencies[pruned], undefined, `${pruned} was pruned as dead`);
  }
});
