/**
 * The table's aggregate footer (ADR-194).
 *
 * This is the summary row ADR-182 had to report as permanently unreachable on
 * the canvas renderer, so it is new behaviour in the shell rather than a
 * restatement of something already covered. The cases below are the ones where
 * a plausible implementation is silently wrong — empty-cell handling and the
 * even/odd median split — not a re-test of arithmetic.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  availableAggregates,
  computeAggregate,
  defaultAggregate,
} from "../src/app/dataviews/aggregate.ts";

test("empty cells are excluded from statistics rather than counted as zero", () => {
  // The whole point: averaging a column where two of five rows have no data
  // must average the three that do. Treating gaps as 0 would report 6 here.
  const values = [10, null, 20, "", 30];
  assert.equal(computeAggregate(values, "average").value, 20);
  assert.equal(computeAggregate(values, "sum").value, 60);
  assert.equal(computeAggregate(values, "min").value, 10);
  assert.equal(computeAggregate(values, "max").value, 30);
});

test("count/filled/empty/unique describe the column itself, gaps included", () => {
  const values = [10, null, 20, "", 30, 10];
  assert.equal(computeAggregate(values, "count").value, 6, "every row, gaps too");
  assert.equal(computeAggregate(values, "filled").value, 4);
  assert.equal(computeAggregate(values, "empty").value, 2);
  assert.equal(computeAggregate(values, "unique").value, 3, "10 twice counts once");
});

test("a whitespace-only string is empty, not a value", () => {
  assert.equal(computeAggregate(["  ", "x"], "filled").value, 1);
  assert.equal(computeAggregate(["  ", "x"], "empty").value, 1);
});

test("median splits even and odd row counts differently", () => {
  assert.equal(computeAggregate([1, 3, 5], "median").value, 3, "odd → middle value");
  assert.equal(computeAggregate([1, 3, 5, 9], "median").value, 4, "even → mean of the middle two");
  // Unsorted input must not change the answer.
  assert.equal(computeAggregate([9, 1, 5, 3], "median").value, 4);
});

test("range is max minus min, not the count of distinct values", () => {
  assert.equal(computeAggregate([4, 10, 6], "range").value, 6);
});

test("a column with nothing to measure reports null, never 0", () => {
  // 0 would render as a real figure and read as "the average is zero".
  for (const kind of ["average", "sum", "min", "max", "median", "range"]) {
    assert.equal(computeAggregate([null, "", undefined], kind).value, null, kind);
  }
  // Counts still answer honestly over an all-empty column.
  assert.equal(computeAggregate([null, ""], "empty").value, 2);
});

test("numeric strings are measured; non-numeric ones are ignored", () => {
  assert.equal(computeAggregate(["10", "20"], "average").value, 15);
  assert.equal(computeAggregate(["10", "abc", "20"], "average").value, 15);
  assert.equal(computeAggregate(["abc"], "average").value, null);
});

test("counts are flagged as counts, so the column's unit formatter is not applied to them", () => {
  // A currency column summarised by "Filled" must render 3, not $3.
  assert.equal(computeAggregate([1, 2, 3], "filled").isCount, true);
  assert.equal(computeAggregate([1, 2, 3], "average").isCount, false);
});

test("a text column never advertises an aggregate it cannot compute", () => {
  const text = availableAggregates(false);
  for (const numericOnly of ["sum", "average", "min", "max", "median", "range"]) {
    assert.ok(!text.includes(numericOnly), `text column must not offer ${numericOnly}`);
  }
  assert.ok(availableAggregates(true).includes("sum"));
});

test("defaults differ by column type", () => {
  assert.equal(defaultAggregate(true), "average");
  assert.equal(defaultAggregate(false), "unique");
  // Whatever the default is, it must be one the column actually offers.
  assert.ok(availableAggregates(true).includes(defaultAggregate(true)));
  assert.ok(availableAggregates(false).includes(defaultAggregate(false)));
});
