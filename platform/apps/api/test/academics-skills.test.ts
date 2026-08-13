/**
 * academics.syllabusIntake's extraction heuristic (TASK-069, ADR-237) — pure,
 * no I/O. Covers the deterministic-vs-model decision's actual behaviour: it
 * finds assignment-shaped lines (date/weight + assignment vocabulary), skips
 * plain prose, infers a type where the keywords are unambiguous, and leaves
 * type/dueAt/weight absent rather than guessing when a line doesn't parse
 * cleanly — an honest gap for a human reviewer to fill in, not a confident wrong value.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { extractSyllabusAssignments, syllabusIntakeSkill } from "../src/academics-skills.js";
import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";

function run(): RunCtx {
  const clock = new SystemClock();
  return { clock, rng: new SeededRng(1), ids: new UuidGen(clock, new SeededRng(1)) };
}

test("extracts a due date and a weight percentage into a draft-shaped candidate", () => {
  const text = "Assignment 1: Problem Set 1 due 09/15/2026 worth 10%";
  const [result] = extractSyllabusAssignments(text);
  assert.ok(result, "expected one candidate");
  assert.equal(result.type, "problem_set");
  assert.equal(result.weight, 10);
  assert.equal(result.dueAt, new Date("09/15/2026").toISOString());
  assert.ok(result.title.length > 0);
});

test("infers exam/project/essay/lab types from keywords", () => {
  const text = [
    "Midterm Exam due 10/20/2026 worth 25%",
    "Final Project due 12/01/2026 (30%)",
    "Reflection Essay due 11/05/2026 worth 15%",
    "Lab Report 2 due 09/30/2026 worth 5%",
  ].join("\n");
  const results = extractSyllabusAssignments(text);
  assert.deepEqual(
    results.map((r) => r.type),
    ["exam", "project", "essay", "lab"],
  );
});

test("plain prose with no date/weight and no assignment vocabulary is never a candidate", () => {
  const text = [
    "Welcome to ECON 301. This course meets twice a week.",
    "Office hours are held on Tuesdays.",
    "The reading list is posted on the course site.",
  ].join("\n");
  assert.deepEqual(extractSyllabusAssignments(text), []);
});

test("a line with only a percentage that isn't assignment-shaped is skipped", () => {
  // No due/assignment/exam/... vocabulary — a grading curve mention, not a row.
  const text = "The class average last year was 82%.";
  assert.deepEqual(extractSyllabusAssignments(text), []);
});

test("a date-only assignment line with no parseable weight leaves weight unset, not zero", () => {
  const text = "Assignment 3 due 01/10/2027";
  const [result] = extractSyllabusAssignments(text);
  assert.ok(result);
  assert.equal(result.weight, undefined);
  assert.ok(result.dueAt);
});

test("the Skill wraps the heuristic and never calls a model or touches I/O", () => {
  assert.equal(syllabusIntakeSkill.executionClass, undefined);
});

test("the Skill's run() rejects empty/missing text rather than silently proposing nothing", async () => {
  await assert.rejects(() => syllabusIntakeSkill.run({}, run()), /extracted PDF text/);
  await assert.rejects(() => syllabusIntakeSkill.run({ text: "   " }, run()), /extracted PDF text/);
});

test("the Skill's proposedOutput carries the extracted assignments for the caller to draft-write", async () => {
  const result = await syllabusIntakeSkill.run(
    { text: "Assignment 1: Problem Set 1 due 09/15/2026 worth 10%" },
    run(),
  );
  const output = result.proposedOutput as { assignments: Array<{ title: string }> };
  assert.equal(output.assignments.length, 1);
  assert.equal((result.diff as { draftAssignments: number }).draftAssignments, 1);
});
