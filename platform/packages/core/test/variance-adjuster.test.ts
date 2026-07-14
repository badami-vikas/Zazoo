import assert from "node:assert/strict";
import test from "node:test";

import { cloneDefaultPolicyParams } from "../src/policy/params.js";
import { proposeVarianceAdjustment } from "../src/policy/variance-adjuster.js";
import type { VettedVeto } from "../src/policy/variance-adjuster.js";

function vetoes(chip: string, count: number): VettedVeto[] {
  return Array.from({ length: count }, (_, index) => ({ decisionId: `${chip}-${index + 1}`, chip }));
}

test("three vetted too_casual vetoes propose a governed tone nudge", () => {
  const params = cloneDefaultPolicyParams();
  const proposal = proposeVarianceAdjustment(params, vetoes("too_casual", 3));

  assert.ok(proposal);
  assert.equal(proposal.paramKey, "tone_threshold");
  assert.equal(proposal.chip, "too_casual");
  assert.equal(proposal.direction, "increase");
  assert.equal(proposal.from, 0.5);
  assert.equal(proposal.to, 0.52);
  assert.equal(proposal.delta, 0.02);
  assert.equal(proposal.governed, true);
  assert.equal(proposal.applied, false);
  assert.equal(proposal.vetoCount, 3);
  assert.equal(proposal.clampedAtCeiling, false);
  assert.equal(proposal.clampedAtFloor, false);
  assert.match(proposal.rationale, /3 'too_casual' vetoes → nudge tone_threshold increase from 0\.5 to 0\.52/);
  assert.equal(params.variance.params.tone_threshold?.value, 0.5);
});

test("two too_casual vetoes are below the default signal threshold", () => {
  const params = cloneDefaultPolicyParams();

  assert.equal(proposeVarianceAdjustment(params, vetoes("too_casual", 2)), null);
});

test("ceiling clamps prevent crossing above the tunable bound", () => {
  const params = cloneDefaultPolicyParams();
  params.variance.params.tone_threshold = { value: 0.99, floor: 0, ceil: 1 };

  const proposal = proposeVarianceAdjustment(params, vetoes("too_casual", 3));

  assert.ok(proposal);
  assert.equal(proposal.from, 0.99);
  assert.equal(proposal.to, 1);
  assert.equal(proposal.clampedAtCeiling, true);
  assert.equal(proposal.clampedAtFloor, false);
  assert.match(proposal.rationale, /clamped at ceiling/);
});

test("ceiling clamps when the value is already at the ceiling", () => {
  const params = cloneDefaultPolicyParams();
  params.variance.params.tone_threshold = { value: 1, floor: 0, ceil: 1 };

  const proposal = proposeVarianceAdjustment(params, vetoes("too_casual", 3));

  assert.ok(proposal);
  assert.equal(proposal.from, 1);
  assert.equal(proposal.to, 1);
  assert.equal(proposal.clampedAtCeiling, true);
});

test("floor clamps prevent crossing below the tunable bound", () => {
  const params = cloneDefaultPolicyParams();
  params.variance.params.tone_threshold = { value: 0.01, floor: 0, ceil: 1 };

  const proposal = proposeVarianceAdjustment(params, vetoes("too_formal", 3));

  assert.ok(proposal);
  assert.equal(proposal.paramKey, "tone_threshold");
  assert.equal(proposal.direction, "decrease");
  assert.equal(proposal.from, 0.01);
  assert.equal(proposal.to, 0);
  assert.equal(proposal.clampedAtFloor, true);
  assert.equal(proposal.clampedAtCeiling, false);
  assert.match(proposal.rationale, /clamped at floor/);
});

test("unknown chips do not propose adjustments", () => {
  const params = cloneDefaultPolicyParams();

  assert.equal(proposeVarianceAdjustment(params, vetoes("too_long", 5)), null);
});

test("missing tunable params do not invent knobs", () => {
  const params = cloneDefaultPolicyParams();
  delete params.variance.params.tone_threshold;

  assert.equal(proposeVarianceAdjustment(params, vetoes("too_casual", 3)), null);
});

test("opts can lower minVetoes and override delta", () => {
  const params = cloneDefaultPolicyParams();
  const proposal = proposeVarianceAdjustment(params, vetoes("too_casual", 2), { minVetoes: 2, delta: 0.1 });

  assert.ok(proposal);
  assert.equal(proposal.vetoCount, 2);
  assert.equal(proposal.delta, 0.1);
  assert.equal(proposal.from, 0.5);
  assert.equal(proposal.to, 0.6);
});

test("the highest mapped chip count wins deterministically by first-seen tie", () => {
  const params = cloneDefaultPolicyParams();
  const mixed: VettedVeto[] = [
    { decisionId: "formal-1", chip: "too_formal" },
    { decisionId: "casual-1", chip: "too_casual" },
    { decisionId: "formal-2", chip: "too_formal" },
    { decisionId: "casual-2", chip: "too_casual" },
    { decisionId: "ignored-1", chip: "too_long" },
  ];

  const proposal = proposeVarianceAdjustment(params, mixed, { minVetoes: 2 });

  assert.ok(proposal);
  assert.equal(proposal.chip, "too_formal");
  assert.equal(proposal.direction, "decrease");
  assert.equal(proposal.to, 0.48);
});
