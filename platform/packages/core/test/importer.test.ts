import { test } from "node:test";
import assert from "node:assert/strict";

import {
  translateForeignCapability,
  ForeignImportSandboxRequiredError,
  ForeignImportValidationError,
  type ForeignCapabilityImport,
} from "../src/index.js";

function test_fixture_import(overrides: Partial<ForeignCapabilityImport> = {}): ForeignCapabilityImport {
  return {
    source: "oss-integration",
    versionPin: { ref: "test_fixture_repo", version: "1.0.0" },
    permissionDeclarations: [],
    auditRequired: true,
    descriptor: {},
    targetId: "test_fixture.import",
    targetName: "Test Fixture Import",
    ...overrides,
  };
}

test("translateForeignCapability: pi-package extension -> tool with connector", () => {
  const result = translateForeignCapability(
    test_fixture_import({
      source: "pi-package",
      descriptor: { primitive: "extension" },
      permissionDeclarations: [{ resource: "touchpoint", action: "read", scoped: true }],
      sandboxPolicy: { kind: "subprocess", networkEgress: false, filesystemAccess: false },
    }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.manifest.capabilityType, "tool");
  assert.equal(result.manifest.origin, "community");
  assert.equal(result.manifest.connectors.length, 1);
  assert.equal(result.manifest.connectors[0]?.id, "test_fixture.import.connector");
});

test("translateForeignCapability: pi-package skill -> skill capability, no connectors", () => {
  const result = translateForeignCapability(
    test_fixture_import({
      source: "pi-package",
      descriptor: { primitive: "skill" },
    }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.manifest.capabilityType, "skill");
  assert.equal(result.manifest.connectors.length, 0);
});

test("translateForeignCapability: pi-package prompt -> skill capability (prompt asset)", () => {
  const result = translateForeignCapability(
    test_fixture_import({
      source: "pi-package",
      descriptor: { primitive: "prompt" },
    }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.manifest.capabilityType, "skill");
});

test("translateForeignCapability: pi-package theme -> view capability", () => {
  const result = translateForeignCapability(
    test_fixture_import({
      source: "pi-package",
      descriptor: { primitive: "theme" },
    }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.manifest.capabilityType, "view");
});

test("translateForeignCapability: pi-package rejects unknown primitive", () => {
  assert.throws(
    () =>
      translateForeignCapability(
        test_fixture_import({ source: "pi-package", descriptor: { primitive: "widget" } }),
      ),
    ForeignImportValidationError,
  );
});

test("translateForeignCapability: mcp-server maps tools to connectors and resources to read permissions", () => {
  const result = translateForeignCapability(
    test_fixture_import({
      source: "mcp-server",
      descriptor: {
        tools: [{ name: "search" }, { name: "fetch" }],
        resources: [{ uri: "mcp://test_fixture/resource-one" }],
      },
    }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.manifest.capabilityType, "tool");
  assert.equal(result.manifest.connectors.length, 2);
  assert.equal(result.manifest.connectors[0]?.id, "test_fixture.import.search");
  assert.equal(result.manifest.permissions.length, 1);
  assert.equal(result.manifest.permissions[0]?.resourceType, "mcp://test_fixture/resource-one");
  assert.equal(result.manifest.permissions[0]?.action, "read");
});

test("translateForeignCapability: activepieces-piece maps actions/triggers to skill + connectors", () => {
  const result = translateForeignCapability(
    test_fixture_import({
      source: "activepieces-piece",
      descriptor: {
        actions: [{ name: "send_message" }],
        triggers: [{ name: "on_new_item" }],
      },
      sandboxPolicy: { kind: "container", networkEgress: true, filesystemAccess: false },
    }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.manifest.capabilityType, "skill");
  assert.equal(result.manifest.connectors.length, 2);
});

test("translateForeignCapability: activepieces-piece without sandboxPolicy returns typed sandbox error", () => {
  const result = translateForeignCapability(
    test_fixture_import({
      source: "activepieces-piece",
      descriptor: { actions: [{ name: "send_message" }], triggers: [] },
    }),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.error instanceof ForeignImportSandboxRequiredError);
});

test("translateForeignCapability: activepieces-piece with sandboxPolicy kind:none still guards", () => {
  const result = translateForeignCapability(
    test_fixture_import({
      source: "activepieces-piece",
      descriptor: { actions: [{ name: "send_message" }], triggers: [] },
      sandboxPolicy: { kind: "none", networkEgress: false, filesystemAccess: false },
    }),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.error instanceof ForeignImportSandboxRequiredError);
});

test("translateForeignCapability: pi-package extension without sandboxPolicy returns typed sandbox error", () => {
  const result = translateForeignCapability(
    test_fixture_import({
      source: "pi-package",
      descriptor: { primitive: "extension" },
    }),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.error instanceof ForeignImportSandboxRequiredError);
});

test("translateForeignCapability: oss-integration is generic passthrough with no auto-inferred permissions", () => {
  const result = translateForeignCapability(
    test_fixture_import({
      source: "oss-integration",
      descriptor: { anything: "ignored", tools: [{ name: "should-not-appear" }] },
      permissionDeclarations: [{ resource: "test_fixture.custom_resource", action: "write", scoped: true }],
    }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.manifest.capabilityType, "integration");
  assert.equal(result.manifest.connectors.length, 0);
  assert.equal(result.manifest.permissions.length, 1);
  assert.equal(result.manifest.permissions[0]?.resourceType, "test_fixture.custom_resource");
});

test("translateForeignCapability: oss-integration with no permissionDeclarations yields zero permissions (no auto-inference)", () => {
  const result = translateForeignCapability(
    test_fixture_import({
      source: "oss-integration",
      descriptor: { tools: [{ name: "ignored" }], resources: [{ uri: "ignored" }] },
      permissionDeclarations: [],
    }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.manifest.permissions.length, 0);
});

test("translateForeignCapability: unscoped permission declaration falls back to dataScope 'all'", () => {
  const result = translateForeignCapability(
    test_fixture_import({
      permissionDeclarations: [{ resource: "test_fixture.thing", action: "read", scoped: false }],
    }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.manifest.permissions[0]?.dataScope, "all");
});

test("translateForeignCapability: send action always sets egress true", () => {
  const result = translateForeignCapability(
    test_fixture_import({
      permissionDeclarations: [{ resource: "test_fixture.thing", action: "send", scoped: true }],
    }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.manifest.permissions[0]?.egress, true);
});

test("translateForeignCapability: origin is always community regardless of source", () => {
  for (const source of ["pi-package", "mcp-server", "activepieces-piece", "oss-integration"] as const) {
    const overrides: Partial<ForeignCapabilityImport> = {
      source,
      descriptor: source === "pi-package" ? { primitive: "skill" } : {},
    };
    if (source === "activepieces-piece") {
      overrides.sandboxPolicy = { kind: "container", networkEgress: false, filesystemAccess: false };
    }
    const result = translateForeignCapability(test_fixture_import(overrides));
    assert.equal(result.ok, true);
    if (!result.ok) continue;
    assert.equal(result.manifest.origin, "community");
  }
});

test("translateForeignCapability: rejects missing targetId", () => {
  assert.throws(() => translateForeignCapability(test_fixture_import({ targetId: "" })), ForeignImportValidationError);
});

test("translateForeignCapability: rejects auditRequired !== true", () => {
  assert.throws(
    () => translateForeignCapability({ ...test_fixture_import(), auditRequired: false }),
    ForeignImportValidationError,
  );
});

test("translateForeignCapability: rejects missing versionPin fields", () => {
  assert.throws(
    () => translateForeignCapability(test_fixture_import({ versionPin: { ref: "", version: "1.0.0" } })),
    ForeignImportValidationError,
  );
});
