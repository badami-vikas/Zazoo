import { test } from "node:test";
import assert from "node:assert/strict";
import {
  transitionStage,
  canTransition,
  VALID_TRANSITIONS,
  TERMINAL_STAGES,
  PIPELINE_STAGES,
} from "../src/deal.js";
import type { DealStage } from "../src/deal.js";

// ─── Happy-path transitions ───────────────────────────────────────────────────

test("transitionStage: sourced → triage succeeds", () => {
  const r = transitionStage("sourced", "triage");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.stage, "triage");
});

test("transitionStage: each pipeline stage advances to its canonical next stage", () => {
  const chain: Array<[DealStage, DealStage]> = [
    ["sourced", "triage"],
    ["triage", "engaged"],
    ["engaged", "nda_cim"],
    ["nda_cim", "diligence"],
    ["diligence", "ic"],
    ["ic", "loi"],
    ["loi", "closing"],
    ["closing", "portfolio"],
  ];
  for (const [from, to] of chain) {
    const r = transitionStage(from, to);
    assert.equal(r.ok, true, `expected ${from} → ${to} to succeed`);
  }
});

test("transitionStage: every non-terminal stage can pass (early exit)", () => {
  for (const stage of PIPELINE_STAGES) {
    const r = transitionStage(stage, "passed");
    assert.equal(r.ok, true, `expected ${stage} → passed to be valid`);
  }
});

// ─── Invalid transitions ──────────────────────────────────────────────────────

test("transitionStage: skipping a stage returns INVALID_TRANSITION", () => {
  const r = transitionStage("sourced", "engaged");
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.error.code, "INVALID_TRANSITION");
    assert.equal(r.error.from, "sourced");
    assert.equal(r.error.to, "engaged");
    assert.match(r.error.reason, /engaged/);
  }
});

test("transitionStage: going backwards returns INVALID_TRANSITION", () => {
  const r = transitionStage("diligence", "triage");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.code, "INVALID_TRANSITION");
});

test("transitionStage: transitioning to the same stage is invalid", () => {
  const r = transitionStage("triage", "triage");
  assert.equal(r.ok, false);
});

// ─── Terminal stages ──────────────────────────────────────────────────────────

test("transitionStage: portfolio is terminal — all targets rejected", () => {
  const all: DealStage[] = [...PIPELINE_STAGES, "portfolio", "passed"];
  for (const to of all) {
    const r = transitionStage("portfolio", to);
    assert.equal(r.ok, false, `portfolio → ${to} should be invalid`);
    if (!r.ok) assert.match(r.error.reason, /terminal/);
  }
});

test("transitionStage: passed is terminal — all targets rejected", () => {
  const all: DealStage[] = [...PIPELINE_STAGES, "portfolio", "passed"];
  for (const to of all) {
    const r = transitionStage("passed", to);
    assert.equal(r.ok, false, `passed → ${to} should be invalid`);
    if (!r.ok) assert.match(r.error.reason, /terminal/);
  }
});

// ─── canTransition helper ─────────────────────────────────────────────────────

test("canTransition: returns true for allowed transitions", () => {
  assert.equal(canTransition("triage", "engaged"), true);
  assert.equal(canTransition("triage", "passed"), true);
  assert.equal(canTransition("closing", "portfolio"), true);
});

test("canTransition: returns false for disallowed transitions", () => {
  assert.equal(canTransition("sourced", "diligence"), false);
  assert.equal(canTransition("portfolio", "passed"), false);
  assert.equal(canTransition("passed", "sourced"), false);
});

// ─── Structural invariants ───────────────────────────────────────────────────

test("VALID_TRANSITIONS: every DealStage has an entry", () => {
  const allStages: DealStage[] = [...PIPELINE_STAGES, "portfolio", "passed"];
  for (const s of allStages) {
    assert.ok(s in VALID_TRANSITIONS, `${s} missing from VALID_TRANSITIONS`);
  }
});

test("TERMINAL_STAGES: portfolio and passed are the only terminals", () => {
  assert.ok(TERMINAL_STAGES.has("portfolio"));
  assert.ok(TERMINAL_STAGES.has("passed"));
  assert.equal(TERMINAL_STAGES.size, 2);
});

test("PIPELINE_STAGES: does not include terminal stages", () => {
  for (const s of PIPELINE_STAGES) {
    assert.equal(TERMINAL_STAGES.has(s), false, `${s} should not be in PIPELINE_STAGES`);
  }
});
