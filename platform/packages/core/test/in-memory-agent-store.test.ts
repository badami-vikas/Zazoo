/**
 * InMemoryAgentStore — fail-closed Agent status vocabulary regressions
 * (TASK-011 remediation, 2026-07-17 security review).
 *
 * `AgentQuery.isActive()`'s canonical contract (mirrored exactly from
 * `DrizzleAgentStore.isActive`, `packages/db/src/governance-stores.ts`:
 * `rows[0]?.status === "active"`) is an EXACT match against the literal
 * string `"active"` — everything else (unset/unseeded, `"inactive"`,
 * `"paused"`, `"retired"`, or any other/unknown status string) is INACTIVE.
 * This is deliberately authoritative over any weaker fallback (e.g. treating
 * the mere PRESENCE of an `assumedRole`/`capabilityScope` entry as proof of
 * "active", or defaulting an unset agent to active) — an Agent must be
 * explicitly seeded active; nothing else may imply it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemoryAgentStore } from "../src/memory/stores.js";

test("isActive: an entirely unseeded agent id is inactive (fail closed, never guessed)", async () => {
  const agents = new InMemoryAgentStore();
  assert.equal(await agents.isActive("never-seeded-agent"), false);
});

test("isActive: an agent with assumedRole/capabilityScope/dataScope set but NO explicit status is still inactive — presence of other fields never implies active", async () => {
  const agents = new InMemoryAgentStore();
  const agentId = "agent-with-role-but-no-status";
  agents.assumed.set(agentId, "role-something");
  agents.scope.set(agentId, ["signal:write"]);
  agents.tiers.set(agentId, "all");
  agents.organizations.set(agentId, "ws-1");
  // Deliberately NOT calling agents.statuses.set(...) — this is the exact
  // "weaker fallback" scenario the semantic choice below rejects.
  assert.equal(await agents.isActive(agentId), false);
});

test("isActive: only an EXACT \"active\" status string is treated as active — every other value (including plausible-looking ones) is inactive", async () => {
  const agents = new InMemoryAgentStore();
  for (const status of ["inactive", "paused", "retired", "Active", "ACTIVE", "activated", ""] as const) {
    const agentId = `agent-status-${status || "empty"}`;
    // @ts-expect-error — deliberately probing non-canonical strings to prove
    // they are rejected, not silently coerced to true.
    agents.statuses.set(agentId, status);
    assert.equal(await agents.isActive(agentId), false, `status "${status}" must not be treated as active`);
  }
});

test("isActive: an agent explicitly seeded \"active\" is active", async () => {
  const agents = new InMemoryAgentStore();
  const agentId = "properly-seeded-agent";
  agents.statuses.set(agentId, "active");
  assert.equal(await agents.isActive(agentId), true);
});

test("organizationId: an unseeded agent resolves to null, never a guessed organization", async () => {
  const agents = new InMemoryAgentStore();
  assert.equal(await agents.organizationId("never-seeded-agent"), null);
});

test("organizationId + isActive together: this is the exact pair pipeline.ts's AGS1 gate and resolveAuthority check before permitting any governed Skill or mutation for an Agent actor — both must be explicitly seeded, or the Agent is authoritatively unusable", async () => {
  const agents = new InMemoryAgentStore();
  const agentId = "partially-seeded-agent";
  agents.organizations.set(agentId, "ws-1");
  // No status set — even though the agent IS known to a organization, it must
  // still be inactive without an explicit "active" status.
  assert.equal(await agents.organizationId(agentId), "ws-1");
  assert.equal(await agents.isActive(agentId), false);
});
