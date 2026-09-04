/**
 * TASK-086 — multi-select on every table, entered by long-press on touch.
 *
 * The gesture itself cannot be driven headlessly (no jsdom, no react-dom in
 * this suite — see dataviews-behavior.test.mjs's header for why the source-grep
 * suites were deleted). So the DECISIONS the gesture makes live in a pure
 * reducer, `dataviews/selection.ts`, and this suite drives that reducer with
 * the exact event sequences a finger produces. What remains unproven here is
 * only that the DOM handlers dispatch these events at the right moments; that
 * needs a real touch device.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EMPTY_SELECTION,
  LONG_PRESS_MS,
  reduceSelection,
} from "../src/app/dataviews/selection.ts";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "app");
const read = (...parts) => readFileSync(join(APP, ...parts), "utf8");

test("long-press enters multi-select with that row selected (C-12)", () => {
  const { state, open } = reduceSelection(EMPTY_SELECTION, { type: "longPress", key: "r1" });
  assert.deepEqual(state.selected, ["r1"]);
  assert.equal(open, false, "entering selection must never also open the row");
});

test("the synthetic click on finger-lift is swallowed (C-12, the trap)", () => {
  // A long-press fires while the finger is still down; the browser then emits a
  // click on lift. Without the swallow the same gesture selects AND opens.
  const pressed = reduceSelection(EMPTY_SELECTION, { type: "longPress", key: "r1" }).state;
  const lifted = reduceSelection(pressed, { type: "activate", key: "r1" });
  assert.equal(lifted.open, false, "the finger-lift click must not open the row");
  assert.deepEqual(lifted.state.selected, ["r1"], "and must not toggle the row back off either");
  assert.equal(lifted.state.swallowClick, false, "the swallow is consumed once, not sticky");

  // The NEXT real tap must be honoured — a permanently-armed swallow would make
  // the table inert.
  const nextTap = reduceSelection(lifted.state, { type: "activate", key: "r2" });
  assert.deepEqual(nextTap.state.selected, ["r1", "r2"]);
});

test("while multi-select is active a tap toggles the row, never opens it (C-12)", () => {
  let state = reduceSelection(EMPTY_SELECTION, { type: "longPress", key: "r1" }).state;
  state = reduceSelection(state, { type: "activate", key: "r1" }).state; // swallowed lift
  for (const key of ["r2", "r3"]) {
    const step = reduceSelection(state, { type: "activate", key });
    assert.equal(step.open, false, `tapping ${key} during multi-select must not open it`);
    state = step.state;
  }
  assert.equal(state.selected.length, 3, "count reads 3");

  const untoggled = reduceSelection(state, { type: "activate", key: "r2" });
  assert.deepEqual(untoggled.state.selected, ["r1", "r3"]);
  assert.equal(untoggled.open, false);
});

test("with nothing selected a tap opens the row (C-10 is unchanged)", () => {
  const { state, open } = reduceSelection(EMPTY_SELECTION, { type: "activate", key: "r1" });
  assert.equal(open, true);
  assert.deepEqual(state.selected, []);
});

test("deselecting the last row leaves multi-select, so taps open again", () => {
  let state = reduceSelection(EMPTY_SELECTION, { type: "checkbox", key: "r1" }).state;
  state = reduceSelection(state, { type: "checkbox", key: "r1" }).state;
  assert.deepEqual(state.selected, []);
  assert.equal(reduceSelection(state, { type: "activate", key: "r9" }).open, true);
});

test("Escape / Cancel clears the selection", () => {
  let state = reduceSelection(EMPTY_SELECTION, { type: "longPress", key: "r1" }).state;
  state = reduceSelection(state, { type: "checkbox", key: "r2" }).state;
  assert.equal(state.selected.length, 2);
  assert.deepEqual(reduceSelection(state, { type: "clear" }).state, EMPTY_SELECTION);
});

test("the long-press threshold is a real hold, not a tap", () => {
  assert.ok(LONG_PRESS_MS >= 400 && LONG_PRESS_MS <= 800, `${LONG_PRESS_MS}ms is not a hold`);
});

test("the action bar is shared chrome, not per-page (§5, TASK-086 Scope)", () => {
  const bar = read("components", "shared", "TableSelectionBar.tsx");
  assert.match(bar, /selected/i, "the bar must state the selection count");
  const table = read("dataviews", "views", "TableView.tsx");
  assert.match(
    table,
    /<TableSelectionBar[\s/>]/,
    "TableView — the ONE table renderer — must render the shared bar, so every table gets it",
  );
  assert.match(table, /onTouchStart=/, "long-press needs a touch handler on the row");
});

test("bulk delete and single delete are the SAME prop, so they cannot diverge", () => {
  const types = read("dataviews", "types.ts");
  assert.match(types, /onDeleteRows\?:/, "one delete prop, taking a list");
  assert.doesNotMatch(
    types,
    /onDeleteRow\?:/,
    "a second, singular delete prop is the thinner write path the Constraint forbids",
  );
  const table = read("dataviews", "views", "TableView.tsx");
  // The row caret's Delete and the cell menu's Delete row both route into the
  // list-taking prop with a one-element list.
  assert.ok(
    (table.match(/deleteRows\(\[/g) ?? []).length >= 2,
    "single-Record delete must call the bulk path with one id, not its own path",
  );
});

test("the row caret's Delete is wired, not permanently dead (§5f, AP-021)", () => {
  const menu = read("components", "shared", "StandardRowMenu.tsx");
  assert.match(menu, /disabled=\{!onDelete\}/, "Delete must be enabled when the Page wires one");
});
