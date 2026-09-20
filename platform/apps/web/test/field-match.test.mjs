/**
 * field-match.test.mjs — the mapping the user reviews before the Avatar
 * fills a form, and the phrases that open the Fields body. A wrong tier
 * here pre-ticks a field the user did not mean, so it is pinned.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { bestMatch, fieldsIntent, planFill, tickedByPolicy } from "../src/app/avatar/field-match.ts";

const copied = [
  { label: "First Name", value: "Jane", kind: "text" },
  { label: "Last Name", value: "Okafor", kind: "text" },
  { label: "Email Address", value: "j@x.com", kind: "text" },
  { label: "Phone", value: "415", kind: "text" },
  { label: "ZIP", value: "94103", kind: "text" },
  { label: "State", value: "California", kind: "popup" },
  { label: "Vehicle Year", value: "2019", kind: "text" },
  { label: "Married", value: "yes", kind: "checkbox" },
];

test("synonyms are exact, overlaps are close, ambiguity is left empty", () => {
  assert.deepEqual(bestMatch("Given name", copied), { source: copied[0], tier: "exact" });
  assert.deepEqual(bestMatch("Surname", copied), { source: copied[1], tier: "exact" });
  assert.deepEqual(bestMatch("Postal code", copied), { source: copied[4], tier: "exact" });
  assert.deepEqual(bestMatch("Marital status", copied), { source: copied[7], tier: "exact" });
  assert.deepEqual(bestMatch("Year", copied), { source: copied[6], tier: "close" }, "unambiguous subset");
  assert.equal(bestMatch("Name", copied), null, "first/last are both possible: never guess");
  assert.equal(bestMatch("Annual mileage", copied), null);
});

test("policies decide what starts ticked, never what can be ticked", () => {
  const rows = planFill(
    [{ label: "Given name", value: "", kind: "text" }, { label: "Year", value: "", kind: "text" }, { label: "Mileage", value: "", kind: "text" }],
    copied,
  );
  assert.deepEqual(rows.map((r) => r.tier), ["exact", "close", "none"]);
  assert.deepEqual(tickedByPolicy(rows, "exact"), [true, false, false]);
  assert.deepEqual(tickedByPolicy(rows, "close"), [true, true, false]);
  assert.deepEqual(tickedByPolicy(rows, "each"), [false, false, false]);
});

test("only field phrases leave the ask box", () => {
  assert.equal(fieldsIntent("copy all fields"), "copy");
  assert.equal(fieldsIntent("Copy the details"), "copy");
  assert.equal(fieldsIntent("copy this sentence"), null, "copy without a form noun is a question");
  assert.equal(fieldsIntent("fill this form"), "fill");
  assert.equal(fieldsIntent("paste them here"), "fill");
  assert.equal(fieldsIntent("recall"), "recall");
  assert.equal(fieldsIntent("what did you copy?"), "recall");
  assert.equal(fieldsIntent("open Notes"), null);
});
