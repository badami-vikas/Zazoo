import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  MBA_FULL_TIME_TARGETS,
  targetsClosingIn,
  unverifiedTargets,
  sponsoringTargets,
} from "../src/mba-targets.js";

test("targetsClosingIn matches only VERIFIED deadlines in the month", () => {
  const september = targetsClosingIn("2026-09");
  assert.ok(september.length > 0, "September must return the one dated row");
  for (const t of september) assert.ok(t.deadline?.startsWith("2026-09"));
  assert.equal(targetsClosingIn("2026-12").length, 0);
});

test("a null deadline is never counted as a match", () => {
  // The whole point of ADR-247 here: an unverified row must not answer a
  // date question. If this ever passes with nulls included, the module has
  // started fabricating deadlines.
  const undated = MBA_FULL_TIME_TARGETS.filter((t) => t.deadline === null);
  assert.ok(undated.length > 0, "fixture must contain undated rows to be meaningful");
  const allMonths = new Set(MBA_FULL_TIME_TARGETS.flatMap((t) => (t.deadline ? [t.deadline.slice(0, 7)] : [])));
  const matched = [...allMonths].flatMap((m) => targetsClosingIn(m));
  for (const t of matched) assert.notEqual(t.deadline, null);
  assert.equal(matched.length + undated.length, MBA_FULL_TIME_TARGETS.length);
});

test("undated opportunities stay reachable instead of being silently dropped", () => {
  assert.equal(unverifiedTargets().length, MBA_FULL_TIME_TARGETS.length - targetsClosingIn("2026-09").length);
  for (const t of unverifiedTargets()) {
    assert.equal(t.deadline, null);
    assert.ok(t.deadlineNote, "an undated row must say what IS known about its timing");
  }
});

test("every row carries a source and a sponsorship tier", () => {
  for (const t of MBA_FULL_TIME_TARGETS) {
    assert.ok(t.source.length > 0, `${t.company} needs a provenance string`);
    assert.ok(["reliable", "selective", "mba_only", "none"].includes(t.sponsorship));
  }
});

test("sponsoringTargets excludes non-sponsors", () => {
  for (const t of sponsoringTargets()) assert.notEqual(t.sponsorship, "none");
});
