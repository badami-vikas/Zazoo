import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeAqv,
  computeCorrectionDepth,
  computeEfficiency,
  computeReliability,
  computeSafety,
  computeSuccess,
  scoreCapability,
  type AqvRecord,
  type AqvSource,
} from "../src/index.js";

function record(overrides: Partial<AqvRecord>): AqvRecord {
  return {
    id: overrides.id ?? "aqv_record",
    createdAt: overrides.createdAt ?? "2026-07-01T00:00:00.000Z",
    userDecision: overrides.userDecision ?? "approve",
    executionSnapshot: overrides.executionSnapshot ?? { terminalState: "completed", cost: 10, baselineCost: 20 },
    ...overrides,
  };
}

test("computeAqv: returns zero axes for an empty window except safety", () => {
  const vector = computeAqv([], { from: "2026-07-01T00:00:00.000Z", to: "2026-07-31T00:00:00.000Z" });
  assert.equal(vector.episodeCount, 0);
  assert.equal(vector.success, 0);
  assert.equal(vector.correction, 0);
  assert.equal(vector.reliability, 0);
  assert.equal(vector.efficiency, 0);
  assert.equal(vector.safety, 1);
});

test("computeSuccess and correction: approve and auto are full success, edits are half success", () => {
  const records = [
    record({ id: "approve", userDecision: "approve" }),
    record({ id: "auto", userDecision: "auto" }),
    record({ id: "edit", userDecision: "edit", diff: { normalizedDiffSize: 0.4 } }),
    record({ id: "veto", userDecision: "veto" }),
    record({ id: "pending", userDecision: null }),
  ];

  const vector = computeAqv(records);
  assert.equal(vector.episodeCount, 4);
  assert.equal(vector.success, 0.625);
  assert.equal(vector.correction, 0.25);
  assert.equal(computeSuccess(records), 0.625);
  assert.equal(computeCorrectionDepth(records), 0.4);
});

test("computeReliability: counts only clean completed runs", () => {
  const records = [
    record({ id: "clean", executionSnapshot: { terminalState: "completed" } }),
    record({ id: "error", executionSnapshot: { terminalState: "error", error: true } }),
    record({ id: "timeout", executionSnapshot: { terminalState: "timeout", timedOut: true } }),
    record({ id: "fallback", executionSnapshot: { terminalState: "fallback", fallbackUsed: true } }),
  ];

  assert.equal(computeReliability(records), 0.25);
});

test("computeSafety: evidence violations, plane gate rejects, approval bypasses, and blocks veto safety", () => {
  assert.equal(computeSafety([record({ id: "clean" })], { violationCount: 0 }), 1);
  assert.equal(computeSafety([record({ id: "evidence" })], { violationCount: 1 }), 0);
  assert.equal(computeSafety([record({ id: "plane", executionSnapshot: { terminalState: "completed", planeGateRejected: true } })]), 0);
  assert.equal(computeSafety([record({ id: "bypass", executionSnapshot: { terminalState: "completed", approvalBypassAttempted: true } })]), 0);
  assert.equal(
    computeSafety([
      record({
        id: "block",
        policyResults: [{ policyId: "policy_external", phase: "runtime", effect: "block", reason: "blocked" }],
      }),
    ]),
    0,
  );
});

test("computeEfficiency: averages capped baseline-to-agent cost ratios for successful clean episodes", () => {
  const records = [
    record({ id: "equal", executionSnapshot: { terminalState: "completed", cost: 10, baselineCost: 10 } }),
    record({ id: "slower", executionSnapshot: { terminalState: "completed", cost: 20, baselineCost: 10 } }),
    record({ id: "cheaper-capped", executionSnapshot: { terminalState: "completed", cost: 5, baselineCost: 10 } }),
    record({ id: "edited-excluded", userDecision: "edit", executionSnapshot: { terminalState: "completed", cost: 10, baselineCost: 10 } }),
  ];

  assert.equal(computeEfficiency(records), (1 + 0.5 + 1) / 3);
});

test("computeAqv: filters records by the requested window", () => {
  const vector = computeAqv(
    [
      record({ id: "before", createdAt: "2026-06-30T23:59:00.000Z", userDecision: "veto" }),
      record({ id: "inside", createdAt: "2026-07-10T12:00:00.000Z", userDecision: "approve" }),
    ],
    { from: "2026-07-01T00:00:00.000Z", to: "2026-07-31T23:59:59.999Z" },
  );

  assert.equal(vector.episodeCount, 1);
  assert.equal(vector.success, 1);
});

test("scoreCapability: reads through the AQV source port", async () => {
  class Source implements AqvSource {
    async listAqvRecords(): Promise<{ records: AqvRecord[]; evidence: { violationCount: number } }> {
      return { records: [record({ id: "scored" })], evidence: { violationCount: 0 } };
    }
  }

  const vector = await scoreCapability(new Source(), "capability_quality", { from: "2026-07-01T00:00:00.000Z" });
  assert.equal(vector.success, 1);
  assert.equal(vector.safety, 1);
});
