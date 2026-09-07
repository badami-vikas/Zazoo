/**
 * Filters, sorts, saved Lists and pagination (TASK-110) — a source-conformance
 * gate in the shape of `ui-conformance.test.mjs`.
 *
 * WHY SOURCE CONFORMANCE: the defects this task fixes were not wrong output,
 * they were CAPABILITIES THE UI COULD NOT REACH. One hardcoded `contains`
 * expression, a `filterMatch` field seven views read and nothing wrote, a
 * `remove()` in the hook with no caller, a sort array every write site
 * replaced. None of those show up as a failing render — they show up as an
 * absence, and an absence is what these assertions are for.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "app");
const read = (...parts) => readFileSync(join(SRC, ...parts), "utf8");

const dataViews = read("dataviews", "DataViews.tsx");
const filterBuilder = read("dataviews", "FilterBuilder.tsx");
const sortEditor = read("dataviews", "SortEditor.tsx");
const paginationBar = read("dataviews", "PaginationBar.tsx");
const savedViews = read("dataviews", "useSavedViews.ts");
const modulePage = read("pages", "ModulePage.tsx");

test("the Filter popover builds filters from the grammar, not from one hardcoded operator", () => {
  assert.doesNotMatch(
    dataViews,
    /op:\s*"contains"/,
    'the shell must not hardcode an operator — the old bug was `[{ field, op: "contains", value }]`',
  );
  assert.match(filterBuilder, /filterOpsForKind\(/, "operators come from filterOpsForKind(kind)");
  assert.match(filterBuilder, /FILTER_OP_LABELS\[/, "wording comes from FILTER_OP_LABELS");
  assert.doesNotMatch(
    filterBuilder,
    /const \w*_?OPS_?\w*\s*(:|=)\s*\[\s*"contains"/,
    "no private copy of the operator list",
  );
});

test("a filter can be added and removed, and more than one can exist at a time", () => {
  assert.match(filterBuilder, /Add filter/, "there is an add control");
  assert.match(filterBuilder, /aria-label="Remove filter"/, "each row can be removed");
  assert.match(
    filterBuilder,
    /filters\.filter\(\(_, i\) => i !== index\)/,
    "removal drops one row rather than clearing the array",
  );
});

test("Match all / Match any actually writes filterMatch (it was read by seven views and written by nothing)", () => {
  assert.match(filterBuilder, /aria-label="Match filters"/);
  assert.match(filterBuilder, /"all" \| "any"/);
  assert.match(
    dataViews,
    /filterMatch:\s*nextMatch/,
    "the shell writes the chosen match into the ViewConfig",
  );
});

test("the value control follows the operator: hidden when valueless, a date field for date operators, choices for is_any_of", () => {
  assert.match(filterBuilder, /VALUELESS_FILTER_OPS\.includes/, "valueless operators hide the box");
  assert.match(filterBuilder, /type=\{needsDateBox\([^)]*\) \? "date" : "text"\}/);
  assert.match(filterBuilder, /"is_any_of", "is_none_of"/, "the list operators get a multi-choice");
  assert.match(filterBuilder, /type="checkbox"/);
});

test("the column kinds reach applyFilters — a date compared as text was the whole point of the map", () => {
  assert.match(dataViews, /columnKinds/, "the shell builds a columnId -> kind map");
  assert.match(
    dataViews,
    /applyFilters\(\s*searchedData,\s*activeView\.rowFilters,\s*activeView\.filterMatch,\s*columnKinds,?\s*\)/s,
    "applyFilters is called WITH the kinds",
  );
  assert.match(
    dataViews,
    /rowFilters:\s*\[\]/,
    "the view is handed an already-filtered page, so it cannot re-filter without kinds",
  );
});

test("sorting is multi-level: rows are appended and reordered, never replaced by one entry", () => {
  assert.match(sortEditor, /Add tie-breaker/, "the wording says later rows break ties");
  assert.match(sortEditor, /aria-label="Move sort up"/);
  assert.match(sortEditor, /aria-label="Move sort down"/);
  assert.match(sortEditor, /\[\.\.\.sorts, \{ id: unused\[0\]\.id, dir: "asc" \}\]/, "adding APPENDS");
  assert.doesNotMatch(
    dataViews,
    /sorts:\s*\[\{\s*id:\s*col\.id/,
    "the shell's own menu no longer replaces the array with a single column",
  );
  assert.match(dataViews, /<SortEditor/, "the ⋮ menu renders the editor");
});

test("saved Lists have the rest of their verbs, and remove() finally has a caller", () => {
  for (const verb of ["rename", "setScope", "setDefault", "duplicate", "remove"]) {
    assert.match(savedViews, new RegExp(`\\b${verb}:`), `useSavedViews exposes ${verb}`);
    assert.match(
      dataViews,
      new RegExp(`savedViews\\.${verb}\\(`),
      `the shell calls savedViews.${verb}() — an unreachable capability is not a capability`,
    );
  }
});

test("a Database can open on a chosen List rather than always on All", () => {
  assert.match(savedViews, /isDefault/, "the hook carries the flag");
  assert.match(
    savedViews,
    /rows\.find\(\(row\) => row\.isDefault\)/,
    "with nothing remembered locally, the owner's default opens",
  );
  assert.match(dataViews, /aria-label="Open on this list"/);
});

test("a List can be personal or shared — the scope existed in the type with no way to choose it", () => {
  assert.match(dataViews, /aria-label="List visibility"/);
  assert.match(dataViews, /value="organization"/);
  assert.match(dataViews, /value="personal"/);
});

test("deleting a List asks first", () => {
  assert.match(dataViews, /confirmDelete/);
  assert.match(dataViews, /Delete for good/, "the confirmation is a second, explicit click");
});

test("there is ONE pagination control and it lives in the shell", () => {
  assert.match(paginationBar, /Showing \$\{first\} to \$\{last\} of \$\{total\}/);
  assert.match(paginationBar, /aria-label="Rows per page"/);
  assert.match(paginationBar, /aria-label="Previous page"/);
  assert.match(paginationBar, /aria-label="Next page"/);
  assert.match(dataViews, /<PaginationBar/, "the shell mounts it, not a page");
  assert.match(dataViews, /pageSize:\s*next/, "the page size is stored in the ViewConfig");
  assert.doesNotMatch(
    modulePage,
    /<PaginationBar|Previous page/,
    "a page must not grow a pagination control of its own",
  );
});

test("the page size is the List's, not the browser's, and 25/50/100 are the choices", () => {
  const pagination = read("dataviews", "pagination.ts");
  assert.match(pagination, /\[25, 50, 100\]/);
  assert.match(dataViews, /activeView\?\.pageSize \?\? DEFAULT_PAGE_SIZE/);
});

test("the Module Page keeps the View across a reload, so a filter survives adding a row", () => {
  assert.doesNotMatch(
    modulePage,
    /setRows\(list\.items\);\s*\n\s*setView\(/,
    "load() must not rebuild the View — that discarded the user's filters, sorts and page size",
  );
  assert.match(modulePage, /currentPageId/, "the View resets on a PAGE change instead");
});

test("the toolbar row still holds only List, View and Search on the left and Filter and ⋮ on the right", () => {
  // The new controls are reachable from the row's existing two addresses — the
  // Filter popover and the ⋮ menu — and add no third button (user directive
  // 2026-09-06).
  const row = dataViews.slice(
    dataViews.indexOf("<div ref={rowRef}"),
    dataViews.indexOf("{insights && insightsOpen"),
  );
  assert.ok(row.length > 0, "the toolbar row must still be findable");
  assert.doesNotMatch(row, /<SortEditor[^]*?<\/Popover>/, "sort is not a row button");
  const triggers = row.match(/<PopoverTrigger|<DropdownMenuTrigger/g) ?? [];
  assert.ok(
    triggers.length <= 3,
    `the row opens at most the List popover, the Filter popover and the ⋮ menu (found ${triggers.length})`,
  );
});
