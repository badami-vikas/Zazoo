import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AGENT_FLOOR_PROTECTED_RESOURCES,
  AGENT_FLOOR_MUTATIONS,
  AGENT_FLOOR_ALWAYS_DENIED_SCOPES,
  ALWAYS_APPROVAL_SCOPES,
  agentFloorDeny,
  isForbiddenAgentToken,
} from "../src/index.js";

/**
 * Smoke test for the agent-floor consolidation (was triplicated across
 * authority.ts, agent-scope.ts, and @bridge/db's integration-store.ts — see
 * docs/raw/decisions-log.md). All three consumers must derive from the single
 * canonical set in agent-floor.ts; this test pins that relationship so a future
 * edit to only one of them fails loudly instead of silently drifting again.
 */

test("agentFloorDeny (authority.ts) denies every protected-resource × mutation pair", () => {
  for (const resourceType of AGENT_FLOOR_PROTECTED_RESOURCES) {
    for (const action of AGENT_FLOOR_MUTATIONS) {
      const reason = agentFloorDeny({ type: "agent", id: "test_fixture_agent_1" }, action, resourceType);
      assert.ok(reason, `agentFloorDeny should deny agent ${action} on ${resourceType}`);
    }
  }
  // Non-agent actors are never subject to the floor.
  for (const resourceType of AGENT_FLOOR_PROTECTED_RESOURCES) {
    assert.equal(agentFloorDeny({ type: "user", id: "test_fixture_user_1" }, "write", resourceType), null);
  }
});

test("isForbiddenAgentToken (agent-scope.ts) forbids every protected resource for every action, plus the always-denied scopes and wildcard", () => {
  for (const resourceType of AGENT_FLOOR_PROTECTED_RESOURCES) {
    // Not just the mutation set — isForbiddenAgentToken is the strictest of the
    // three original lists and blocked ALL actions (e.g. `agent:read` too).
    for (const action of [...AGENT_FLOOR_MUTATIONS, "read"]) {
      const token = `${resourceType}:${action}`;
      assert.ok(isForbiddenAgentToken(token), `${token} must be forbidden`);
    }
  }
  for (const scope of AGENT_FLOOR_ALWAYS_DENIED_SCOPES) {
    assert.ok(isForbiddenAgentToken(scope), `${scope} must be forbidden`);
  }
  assert.ok(isForbiddenAgentToken("*"));
});

test("ALWAYS_APPROVAL_SCOPES (@bridge/db integration-store.ts) equals the canonical always-denied exact-scope set", () => {
  // This is the exact relationship: ALWAYS_APPROVAL_SCOPES is the exact-scope half
  // of the floor (resourceType-only, no action), not the full protected-resource
  // matrix. It must be equal to, never a narrower subset of, the canonical set —
  // narrower would silently re-introduce the drift this consolidation fixes.
  assert.deepEqual([...ALWAYS_APPROVAL_SCOPES].sort(), [...AGENT_FLOOR_ALWAYS_DENIED_SCOPES].sort());
});

test("drift regression: every always-denied scope is also caught by isForbiddenAgentToken and agentFloorDeny", () => {
  for (const scope of ALWAYS_APPROVAL_SCOPES) {
    assert.ok(isForbiddenAgentToken(scope));
  }
  assert.ok(agentFloorDeny({ type: "agent", id: "test_fixture_agent_1" }, "read", "network_graph:full"));
  assert.ok(agentFloorDeny({ type: "agent", id: "test_fixture_agent_1" }, "write", "external:send"));
});
