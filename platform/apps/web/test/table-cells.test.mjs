/**
 * TASK-109 — the grid renders values as their KIND, and its columns can be
 * manipulated (Notion-database parity, user directive 2026-09-06).
 *
 * The audit this gate encodes: `cell-format.tsx` rendered the literal text
 * "true" for a checkbox, no anchor for a url, no date formatting; `TableView`
 * committed a STRING for every kind; and resize / reorder / wrap / freeze /
 * row-height / grouping did not exist at all — `StandardColumnMenu` said so out
 * loud ("grouping is not wired for this View yet").
 *
 * Source-text assertions, in the house style of `column-menu-capability.test.mjs`:
 * these files have no headless render harness, and the failure mode being
 * guarded is a MISSING branch, which reads reliably from the source.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "app");
const read = (...parts) => readFileSync(join(APP, ...parts), "utf8");
/** An ABSENT module is the same failure as a missing branch inside one, and it
 *  should read that way: one clear assertion per capability, rather than the
 *  whole file dying at import with an ENOENT. */
const readOptional = (...parts) =>
  existsSync(join(APP, ...parts)) ? read(...parts) : "";

const FORMAT = read("dataviews", "cell-format.tsx");
const TABLE = read("dataviews", "views", "TableView.tsx");
const EDITOR = readOptional("dataviews", "cell-editor.tsx");
const MENU = read("components", "shared", "StandardColumnMenu.tsx");

// ── 1. Cells render as their kind ────────────────────────────────────────────

test("checkbox renders a real checkbox, not the text 'true'", () => {
  assert.match(FORMAT, /case "checkbox"/);
  assert.match(FORMAT, /type="checkbox"/);
  assert.match(FORMAT, /onToggle/, "the checkbox has to toggle in place, not just display");
});

test("url, email and phone render as links that open", () => {
  assert.match(FORMAT, /case "url"/);
  assert.match(FORMAT, /mailto:/);
  assert.match(FORMAT, /tel:/);
  assert.match(
    FORMAT,
    /stopPropagation/,
    "a link click must not also open the Record behind it",
  );
});

test("date and the derived timestamps read as local dates", () => {
  assert.match(FORMAT, /case "date"/);
  assert.match(FORMAT, /toLocaleDateString/);
});

test("multiselect renders chips and status a lifecycle-coloured pill", () => {
  assert.match(FORMAT, /case "multiselect"/);
  assert.match(FORMAT, /case "status"/);
  assert.match(FORMAT, /statusGroups/, "the pill's colour comes from the column's lifecycle groups");
});

test("number and autoNumber are right-aligned; longText clamps with the full value", () => {
  assert.match(FORMAT, /case "autoNumber"/);
  assert.match(FORMAT, /case "longText"/);
  assert.match(FORMAT, /line-clamp/);
});

test("files is a count, person a name chip, rollup read-only, button states its reason", () => {
  assert.match(FORMAT, /case "files"/);
  assert.match(FORMAT, /case "person"/);
  assert.match(FORMAT, /case "rollup"/);
  assert.match(FORMAT, /case "button"/);
  assert.match(
    FORMAT,
    /actionId/,
    "a button cell runs its column's Action id, or says why it cannot",
  );
});

// ── 2. Editors match the kind ────────────────────────────────────────────────

test("a number commits a number, never a string", () => {
  assert.match(EDITOR, /kind === "number"|case "number"/);
  assert.match(EDITOR, /Number\(/);
  assert.doesNotMatch(
    TABLE,
    /onCommit=\{async \(next: string\)/,
    "the table's commit is no longer string-typed",
  );
});

test("date gets a date input and multiselect a multi-choice editor", () => {
  assert.match(EDITOR, /type="date"/);
  assert.match(EDITOR, /multiselect/);
});

test("uneditable kinds are refused by ONE predicate, not by scattered branches", () => {
  assert.match(EDITOR, /export function isCellEditable/);
  for (const kind of ["rollup", "button", "autoNumber"]) {
    assert.ok(EDITOR.includes(`"${kind}"`), `${kind} must be named as never editable`);
  }
  // The four metadata kinds are refused through @bridge/tables' own predicate
  // rather than re-listed here — a second copy of that list is how they drift.
  assert.match(EDITOR, /isMetadataColumn\(col\.kind\)/);
});

test("checkbox toggles in place rather than opening an editor", () => {
  assert.match(TABLE, /col\.kind !== "checkbox"/);
});

// ── 3. Column mechanics, persisted through the view config ───────────────────

test("resize writes columnWidths through onViewChange, not local state", () => {
  assert.match(TABLE, /columnWidths/);
  assert.match(TABLE, /onPointerDown|onPointerMove/, "the resize handle is a pointer drag");
  assert.doesNotMatch(TABLE, /useState<Record<string, number>>/);
});

test("reorder writes columnOrder", () => {
  assert.match(TABLE, /columnOrder/);
  assert.match(TABLE, /onDragStart|draggable/);
});

test("wrap, freeze and row height are view config, and row height feeds the virtualizer", () => {
  assert.match(TABLE, /wrapCells/);
  assert.match(TABLE, /frozenColumnId/);
  assert.match(TABLE, /rowHeight/);
  assert.doesNotMatch(
    TABLE,
    /estimateSize: \(\) => ROW_HEIGHT,/,
    "the virtualizer estimate must follow the chosen row height, not a constant",
  );
});

// ── 4. Grouping in the table ─────────────────────────────────────────────────

test("the table passes onGroup, so the menu's Group command can act", () => {
  assert.match(TABLE, /onGroup=\{/);
  assert.match(TABLE, /groupBy/);
  assert.match(TABLE, /subGroupBy/);
  assert.match(TABLE, /collapsedGroups/);
  assert.match(TABLE, /from "@bridge\/tables"/);
});

test("grouping reuses @bridge/tables' groupBy rather than a second bucketer", () => {
  assert.match(TABLE, /\bgroupBy\b[^\n]*\}? from "@bridge\/tables"|applySorts, groupBy|groupBy,/);
});

// ── 5. The per-column summary is remembered ──────────────────────────────────

test("the aggregate choice lives in the view config, not in useState", () => {
  assert.doesNotMatch(
    TABLE,
    /useState<Record<string, AggregateKind>>/,
    "a summary chosen on a saved List has to survive a reload",
  );
  assert.match(TABLE, /view\.aggregates/);
});

// ── 6. Menu cleanup ──────────────────────────────────────────────────────────

test("the redundant 'Edit column' item is gone — Rename already does it", () => {
  assert.doesNotMatch(MENU, /"Edit column"/);
});

test("'Duplicate column' has a real handler, not a permanent disable", () => {
  assert.match(MENU, /onDuplicateColumn/);
});

test("a column's description is its tooltip", () => {
  assert.match(MENU, /description/);
  assert.match(TABLE, /col\.description/);
});
