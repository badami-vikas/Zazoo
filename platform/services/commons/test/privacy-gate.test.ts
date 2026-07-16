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

test("cloud-provider credentials embedded in scalar values are denied", () => {
  const paths = findWorkspaceDataPaths({
    aws: "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE",
    secret: "aws_secret_access_key=******",
    google: "AIzaSyDUMMYDUMMYDUMMYDUMMYDUMMYDUMMYDUM",
    slack: "xoxb-123456789012-example-token",
    oauth: "GOCSPX-exampleOAuthSecretValue123",
    slackApp: "xapp-1-example-app-token",
    nested: { clientSecret: "not-even-a-pattern" },
  });
  assert.deepEqual(paths.sort(), ["aws", "google", "nested.clientSecret", "oauth", "secret", "slack", "slackApp"]);
});

test("personal and workspace identifiers embedded in scalar values are denied", () => {
  const paths = findWorkspaceDataPaths({
    summary: "Contact Alice at alice@example.com",
    tags: ["customer:Acme"],
    provenance: { sourceRef: "users/alice/private" },
    nested: { target: "ws_12345678" },
  });

  test("personal-data field names inside retained manifest maps are denied", () => {
    const paths = findWorkspaceDataPaths({
      workspaceVocab: {
        domainTerms: {
          primaryContact: "Alice Smith",
          companyName: "Acme",
        },
      },
    });
    assert.deepEqual(paths.sort(), [
      "workspaceVocab.domainTerms.companyName",
      "workspaceVocab.domainTerms.primaryContact",
    ]);
  });
  assert.deepEqual(paths.sort(), ["nested.target", "provenance.sourceRef", "summary", "tags[0]"]);
});

test("common phone, government identifier, payment, and address forms are denied", () => {
  const paths = findWorkspaceDataPaths({
    phone: "Call +1 (415) 555-2671",
    governmentId: "SSN 123-45-6789",
    payment: "4111 1111 1111 1111",
    address: "1600 Amphitheatre Parkway",
  });
  assert.deepEqual(paths.sort(), ["address", "governmentId", "payment", "phone"]);
});
