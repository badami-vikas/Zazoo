import { test } from "node:test";
import assert from "node:assert/strict";

import {
  canGovernanceAutoApprove,
  classifyApprovalBand,
  rollupOrgHealth,
  type ApprovalBand,
  type OrgHealthInput,
} from "../src/governance/org-health.js";

test("classifyApprovalBand: maps approval bands and auto-approval stays minor-only", () => {
  const cases: Array<{ name: string; input: Parameters<typeof classifyApprovalBand>[0]; expected: ApprovalBand }> = [
    { name: "informational built-in", input: { risk: "informational", origin: "built_in" }, expected: "minor" },
    { name: "advisory template", input: { risk: "advisory", origin: "template" }, expected: "minor" },
    { name: "advisory ai-generated", input: { risk: "advisory", origin: "ai_generated" }, expected: "moderate" },
    { name: "informational user code", input: { risk: "informational", origin: "user_code" }, expected: "moderate" },
    { name: "transformational built-in", input: { risk: "transformational", origin: "built_in" }, expected: "moderate" },
    { name: "community origin", input: { risk: "informational", origin: "community" }, expected: "moderate" },
    { name: "operational built-in", input: { risk: "operational", origin: "built_in" }, expected: "major" },
    { name: "external template", input: { risk: "external", origin: "template" }, expected: "major" },
    { name: "safety touch override", input: { risk: "informational", origin: "built_in", safetyTouch: true }, expected: "major" },
  ];

  for (const { name, input, expected } of cases) {
    assert.equal(classifyApprovalBand(input), expected, name);
  }

  assert.equal(canGovernanceAutoApprove("minor"), true);
  assert.equal(canGovernanceAutoApprove("moderate"), false);
  assert.equal(canGovernanceAutoApprove("major"), false);
});

test("rollupOrgHealth: renders workspace health with odd approval median and rising trend", () => {
  const input: OrgHealthInput = {
    capabilities: [
      { manifestId: "active-low-success", state: "active", successRate: 0.7, trustExpiresInDays: 20 },
      { manifestId: "trusted-healthy", state: "trusted", successRate: 0.9 },
      { manifestId: "draft-low-success", state: "draft", successRate: 0.5 },
      { manifestId: "expiring-trust", state: "active", successRate: 0.95, trustExpiresInDays: 3 },
      { manifestId: "changed-dependency", state: "trusted", successRate: 0.96, dependencyChanged: true, reValidated: false },
      { manifestId: "revalidated-dependency", state: "trusted", successRate: 0.97, dependencyChanged: true, reValidated: true },
    ],
    pendingProposals: [
      { proposalId: "p1", risk: "informational", ageHours: 1 },
      { proposalId: "p2", risk: "advisory", ageHours: 5 },
      { proposalId: "p3", risk: "advisory", ageHours: 9 },
      { proposalId: "p4", risk: "external", ageHours: 13 },
      { proposalId: "p5", risk: "operational", ageHours: 17 },
    ],
    violationSeries: [
      { at: "2026-07-01T00:00:00.000Z", violationCount: 1 },
      { at: "2026-07-02T00:00:00.000Z", violationCount: 2 },
      { at: "2026-07-03T00:00:00.000Z", violationCount: 3 },
      { at: "2026-07-04T00:00:00.000Z", violationCount: 4 },
    ],
  };

  const rollup = rollupOrgHealth(input);

  assert.deepEqual(rollup.autonomyPressure, { count: 1, manifestIds: ["active-low-success"] });
  assert.equal(rollup.trustDebt.count, 2);
  assert.deepEqual(rollup.trustDebt.manifestIds, ["expiring-trust", "changed-dependency"]);
  assert.equal(rollup.approvalLoad.total, 5);
  assert.deepEqual(rollup.approvalLoad.byRisk, {
    informational: 1,
    advisory: 2,
    transformational: 0,
    operational: 1,
    external: 1,
  });
  assert.equal(rollup.approvalLoad.medianTimeToDecisionHours, 9);
  assert.ok(rollup.violationTrend.slope > 0);
  assert.equal(rollup.violationTrend.label, "rising");
});

test("rollupOrgHealth: computes even approval median and empty risk shape", () => {
  const rollup = rollupOrgHealth({
    capabilities: [],
    pendingProposals: [
      { proposalId: "p1", risk: "transformational", ageHours: 2 },
      { proposalId: "p2", risk: "external", ageHours: 10 },
    ],
    violationSeries: [],
  });

  assert.equal(rollup.approvalLoad.total, 2);
  assert.equal(rollup.approvalLoad.medianTimeToDecisionHours, 6);
  assert.deepEqual(rollup.approvalLoad.byRisk, {
    informational: 0,
    advisory: 0,
    transformational: 1,
    operational: 0,
    external: 1,
  });
  assert.deepEqual(rollup.autonomyPressure, { count: 0, manifestIds: [] });
  assert.deepEqual(rollup.trustDebt, { count: 0, manifestIds: [] });
});

test("rollupOrgHealth: labels flat, falling, and single-point violation trends", () => {
  const flat = rollupOrgHealth({
    capabilities: [],
    pendingProposals: [],
    violationSeries: [
      { at: "2026-07-01T00:00:00.000Z", violationCount: 2 },
      { at: "2026-07-02T00:00:00.000Z", violationCount: 2 },
      { at: "2026-07-03T00:00:00.000Z", violationCount: 2 },
    ],
  });
  assert.equal(flat.violationTrend.slope, 0);
  assert.equal(flat.violationTrend.label, "flat");
  assert.equal(flat.approvalLoad.medianTimeToDecisionHours, 0);

  const falling = rollupOrgHealth({
    capabilities: [],
    pendingProposals: [],
    violationSeries: [
      { at: "2026-07-01T00:00:00.000Z", violationCount: 4 },
      { at: "2026-07-02T00:00:00.000Z", violationCount: 3 },
      { at: "2026-07-03T00:00:00.000Z", violationCount: 2 },
    ],
  });
  assert.ok(falling.violationTrend.slope < 0);
  assert.equal(falling.violationTrend.label, "falling");

  const singlePoint = rollupOrgHealth({
    capabilities: [],
    pendingProposals: [],
    violationSeries: [{ at: "2026-07-01T00:00:00.000Z", violationCount: 9 }],
  });
  assert.equal(singlePoint.violationTrend.slope, 0);
  assert.equal(singlePoint.violationTrend.label, "flat");
});
