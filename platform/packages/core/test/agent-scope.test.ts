import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildAgentCapability,
  egressTierTokens,
  isForbiddenAgentToken,
  validateAutomationWithinAgents,
} from "../src/index.js";

test("egress tiers are layered + narrowing: none ⊂ read ⊂ draft ⊂ source-internet", () => {
  assert.deepEqual(egressTierTokens("none"), []);
  const read = egressTierTokens("read-graph");
  const draft = egressTierTokens("draft-graph");
  const src = egressTierTokens("source-internet");
  assert.ok(read.every((t) => draft.includes(t)));
  assert.ok(draft.every((t) => src.includes(t)));
  // only source-internet reaches the internet, and only to SOURCE (fetch:read)
  assert.ok(src.includes("external:fetch:read"));
  assert.ok(!draft.includes("external:fetch:read"));
  // no tier EVER grants send
  for (const tier of ["none", "read-graph", "draft-graph", "source-internet"] as const) {
    assert.ok(!egressTierTokens(tier).some((t) => t.startsWith("external:send")));
  }
});

test("forbidden tokens: send, governance, full-graph, and god-mode wildcard", () => {
  for (const t of [
    "*",
    "external:send:share",
    "network_graph:full:read",
    "policy:write",
    "agent:write",
    "role:write",
    "ledger:approve",
    "permission:write",
    "delegation:write",
  ]) {
    assert.ok(isForbiddenAgentToken(t), `${t} must be forbidden`);
  }
  for (const t of ["person:read", "event:write", "external:fetch:read"]) {
    assert.ok(!isForbiddenAgentToken(t), `${t} must be allowed`);
  }
});

test("buildAgentCapability strips escalation + dedupes, reports dropped", () => {
  const built = buildAgentCapability({
    capabilityScope: ["person:read", "person:read", "external:send:share", "*", "ledger:approve"],
    egressTier: "draft-graph",
  });
  // escalating tokens removed
  assert.ok(!built.scope.includes("external:send:share"));
  assert.ok(!built.scope.includes("*"));
  assert.ok(!built.scope.includes("ledger:approve"));
  assert.deepEqual(built.dropped.sort(), ["*", "external:send:share", "ledger:approve"].sort());
  // tier tokens merged, deduped
  assert.ok(built.scope.includes("event:write"));
  assert.equal(built.scope.filter((t) => t === "person:read").length, 1);
});

test("Automation within Agent: a step outside the owning Agent's capability is flagged", () => {
  const agents = [{ scope: ["person:read", "event:write"], dataScope: "all" as const }];
  const violations = validateAutomationWithinAgents(
    [
      { action: "read", resourceType: "person" },
      { action: "write", resourceType: "community" }, // not in any agent scope
    ],
    agents,
  );
  assert.equal(violations.length, 1);
  assert.equal(violations[0]!.stepIndex, 1);
  assert.equal(violations[0]!.reason, "outside-agent-capability");
});

test("Automation within Agent: a step exceeding the Agent's data tier is flagged", () => {
  const agents = [{ scope: ["person:read"], dataScope: "public" as const }];
  const violations = validateAutomationWithinAgents(
    [{ action: "read", resourceType: "person", dataScope: "private" }],
    agents,
  );
  assert.equal(violations.length, 1);
  assert.equal(violations[0]!.reason, "exceeds-agent-data-tier");
});

test("Automation validation reports no violations when the supplied Agents cover all steps", () => {
  const agents = [
    { scope: ["person:read"], dataScope: "all" as const },
    { scope: ["community:write"], dataScope: "all" as const },
  ];
  const violations = validateAutomationWithinAgents(
    [
      { action: "read", resourceType: "person" },
      { action: "write", resourceType: "community" },
    ],
    agents,
  );
  assert.equal(violations.length, 0);
});
