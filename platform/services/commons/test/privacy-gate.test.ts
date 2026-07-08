/**
 * Knowledge-only gate — the Commons' one non-negotiable rule (CLAUDE.md:
 * generalized capability knowledge only, NEVER user data) enforced in code.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { findWorkspaceDataPaths } from "../src/privacy-gate.js";

test("clean generalized manifest passes the gate", () => {
  const manifest = {
    name: "example-skill",
    version: "1.0.0",
    kind: "skill",
    summary: "Generalized capability knowledge.",
    capabilities: [{ id: "example-skill.core", capability_type: "skill", permissions: [] }],
  };
  assert.deepEqual(findWorkspaceDataPaths(manifest), []);
});

test("workspace/user identifiers are flagged with exact JSON paths, at any depth and casing", () => {
  const manifest = {
    name: "leaky-skill",
    workspaceId: "ws_123",
    capabilities: [
      {
        id: "leaky-skill.core",
        created_by: "user_9",
        connectors: [{ id: "gmail", user_email: "someone@example.com" }],
      },
    ],
    workspaceVocab: { domainTerms: {} },
  };
  const paths = findWorkspaceDataPaths(manifest);
  assert.deepEqual(paths.sort(), [
    "capabilities[0].connectors[0].user_email",
    "capabilities[0].created_by",
    "workspaceId",
  ]);
  // workspaceVocab is a legitimate manifest field — the vocab DECLARATION is
  // generalized knowledge; only instance identifiers are denied.
  assert.ok(!paths.some((p) => p.startsWith("workspaceVocab")));
});

test("credentials and tokens are denied — secrets are never registry content", () => {
  const paths = findWorkspaceDataPaths({ config: { api_key: "sk-...", nested: [{ refreshToken: "t" }] } });
  assert.deepEqual(paths.sort(), ["config.api_key", "config.nested[0].refreshToken"]);
});
