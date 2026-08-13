/**
 * TASK-069 follow-on Skills — lecture-synthesis, reference-resolve,
 * workload-forecast (ADR-238's Study Steward roster growing beyond
 * syllabus-intake). Same style as academics-skills.test.ts: pure, no I/O,
 * honesty-over-guessing cases first.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  synthesizeLecture,
  lectureSynthesisSkill,
  extractReferences,
  referenceResolveSkill,
  forecastWorkload,
  workloadForecastSkill,
} from "../src/academics-skills.js";
import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";

function run(): RunCtx {
  const clock = new SystemClock();
  return { clock, rng: new SeededRng(1), ids: new UuidGen(clock, new SeededRng(1)) };
}

// --- lecture-synthesis ---

test("synthesizeLecture reports could-not-extract on empty/whitespace text, never a fabricated summary", () => {
  assert.deepEqual(synthesizeLecture(""), { extractable: false, keyPoints: [] });
  assert.deepEqual(synthesizeLecture("   \n  \n"), { extractable: false, keyPoints: [] });
});

test("synthesizeLecture keeps substantive lines and drops page-number/short noise", () => {
  const text = [
    "Page 3 of 40",
    "12",
    "Private equity funds typically target a 20-25% gross IRR over a five to seven year hold.",
    "Slide 4",
    "www.example.com",
    "General partners earn a 2% management fee and 20% carried interest on realized gains.",
  ].join("\n");
  const result = synthesizeLecture(text);
  assert.equal(result.extractable, true);
  assert.equal(result.keyPoints.length, 2);
  assert.ok(result.keyPoints[0]!.includes("gross IRR"));
  assert.ok(result.keyPoints[1]!.includes("carried interest"));
});

test("synthesizeLecture deduplicates and caps at 25 key points", () => {
  const line = "This exact sentence repeats many times across the lecture deck slides.";
  const text = Array(40).fill(line).join("\n");
  const result = synthesizeLecture(text);
  assert.equal(result.keyPoints.length, 1);

  const distinctLines = Array.from({ length: 40 }, (_, i) => `Distinct substantive lecture point number ${i} about private equity.`);
  const capped = synthesizeLecture(distinctLines.join("\n"));
  assert.equal(capped.keyPoints.length, 25);
});

test("lectureSynthesisSkill wraps the heuristic, is pure, and rejects non-string input", () => {
  assert.equal(lectureSynthesisSkill.executionClass, undefined);
  return assert.rejects(() => lectureSynthesisSkill.run({}, run()), /extracted lecture text/);
});

// --- reference-resolve ---

test("extractReferences finds in-text parenthetical citations, skips a bare year or unrelated parenthetical", () => {
  const text = [
    "Due diligence failures are a leading cause of deal underperformance (Harroch et al., 2019).",
    "Multiple studies confirm this pattern (Smith & Jones, 2020).",
    "This happened around (2020) sometime.",
    "The process took several weeks (see appendix for detail).",
  ].join("\n");
  const refs = extractReferences(text);
  assert.deepEqual(
    refs.map((r) => `${r.author}|${r.year}`),
    ["Harroch et al.|2019", "Smith & Jones|2020"],
  );
});

test("extractReferences parses a reference-list entry with a title, and dedupes repeats", () => {
  const text = [
    "Harroch, R. (2019). Comprehensive Guide to M&A Due Diligence.",
    "Harroch, R. (2019). Comprehensive Guide to M&A Due Diligence.",
    "Smith, J. D. (2020). Private Equity Fundamentals.",
  ].join("\n");
  const refs = extractReferences(text);
  assert.equal(refs.length, 2);
  assert.equal(refs[0]!.title, "Comprehensive Guide to M&A Due Diligence");
});

test("extractReferences never matches ordinary prose with no citation shape", () => {
  const text = [
    "The fund closed its final round in 2019 with strong investor demand.",
    "Returns over the period were roughly 20%.",
    "Meeting notes from March 2020 covered the exit timeline.",
  ].join("\n");
  assert.deepEqual(extractReferences(text), []);
});

test("referenceResolveSkill rejects empty text rather than silently returning nothing", () => {
  return assert.rejects(() => referenceResolveSkill.run({ text: "" }, run()), /extracted material text/);
});

// --- workload-forecast ---

test("forecastWorkload buckets not-yet-submitted assignments by the Monday of their due week", () => {
  const { weeks, unscheduledCount } = forecastWorkload([
    { dueAt: "2026-09-15T00:00:00.000Z", weight: 10, status: "not_started" }, // Tue -> week of 2026-09-14
    { dueAt: "2026-09-17T00:00:00.000Z", weight: 5, status: "in_progress" }, // Thu -> same week
    { dueAt: "2026-09-22T00:00:00.000Z", weight: 25, status: "not_started" }, // next week
    { dueAt: "2026-01-01T00:00:00.000Z", weight: 50, status: "submitted" }, // excluded: already submitted
    { dueAt: null, weight: 10, status: "not_started" }, // unscheduled
  ]);
  assert.deepEqual(
    weeks.map((w) => [w.weekStart, w.assignmentCount, w.totalWeight]),
    [
      ["2026-09-14", 2, 15],
      ["2026-09-21", 1, 25],
    ],
  );
  assert.equal(unscheduledCount, 1);
});

test("forecastWorkload excludes graded assignments and treats a missing weight as zero, not a crash", () => {
  const { weeks } = forecastWorkload([
    { dueAt: "2026-10-01T00:00:00.000Z", status: "graded" },
    { dueAt: "2026-10-05T00:00:00.000Z", status: "not_started" },
  ]);
  assert.equal(weeks.length, 1);
  assert.equal(weeks[0]!.totalWeight, 0);
});

test("workloadForecastSkill rejects a non-array input rather than silently forecasting nothing", () => {
  return assert.rejects(() => workloadForecastSkill.run({}, run()), /assignments array/);
});
