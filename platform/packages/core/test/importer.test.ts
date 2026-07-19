import { test } from "node:test";
import assert from "node:assert/strict";

import {
  translateForeignCapability,
  ForeignImportSandboxRequiredError,
  ForeignImportValidationError,
  type ForeignCapabilityDescriptorInput,
} from "../src/index.js";

function test_fixture_input(overrides: Partial<ForeignCapabilityDescriptorInput> = {}): ForeignCapabilityDescriptorInput {
  return {
    source: "oss-integration",
    sourceRef: "test_fixture.import",
    versionPin: "1.0.0",
    permissionDeclarations: [],
    sandboxPolicy: { isolation: "none", networkEgress: false, filesystemAccess: [] },
    riskLabel: "informational",
    auditRequired: true,
    rollbackRef: "test_fixture.rollback",
    descriptor: {},
    ...overrides,
  };
}

test("translateForeignCapability: pi-package extension -> Skill with connector, requires sandbox", () => {
  const result = translateForeignCapability(
    test_fixture_input({
      source: "pi-package",
      descriptor: { primitive: "extension" },
      permissionDeclarations: [{ resourceType: "touchpoint", action: "read", scope: "private" }],
      sandboxPolicy: { isolation: "process", networkEgress: false, filesystemAccess: [] },
    }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.import.translatedManifest.capabilityType, "skill");
  assert.equal(result.import.translatedManifest.origin, "community");
  assert.equal(result.import.translatedManifest.connectors.length, 1);
  assert.equal(result.import.translatedManifest.permissions[0]?.resourceType, "touchpoint");
  assert.equal(result.import.translatedManifest.permissions[0]?.dataScope, "private");
});

test("translateForeignCapability: pi-package extension without sandboxPolicy is refused", () => {
  const result = translateForeignCapability(
    test_fixture_input({ source: "pi-package", descriptor: { primitive: "extension" } }),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.error instanceof ForeignImportSandboxRequiredError);
});

test("translateForeignCapability: pi-package skill/prompt does not require sandbox", () => {
  const result = translateForeignCapability(
    test_fixture_input({ source: "pi-package", descriptor: { primitive: "skill" } }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.import.translatedManifest.capabilityType, "skill");
});

test("translateForeignCapability: pi-package theme -> view", () => {
  const result = translateForeignCapability(
    test_fixture_input({ source: "pi-package", descriptor: { primitive: "theme" } }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.import.translatedManifest.capabilityType, "view");
});

test("translateForeignCapability: mcp-server without a sandboxPolicy is refused (PKG-1: carve-out removed)", () => {
  // The old "MCP is exempt from sandbox by protocol" carve-out is gone — an
  // mcp-server import is treated as executable/untrusted and must carry a real
  // sandboxPolicy (isolation !== "none"), like any other executable import.
  const result = translateForeignCapability(
    test_fixture_input({
      source: "mcp-server",
      descriptor: { tools: [{ name: "search" }, { name: "fetch" }], resources: [] },
    }),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.error instanceof ForeignImportSandboxRequiredError);
});

test("translateForeignCapability: mcp-server WITH a sandboxPolicy -> Integration with Action connectors", () => {
  const result = translateForeignCapability(
    test_fixture_input({
      source: "mcp-server",
      descriptor: { tools: [{ name: "search" }, { name: "fetch" }], resources: [] },
      sandboxPolicy: { isolation: "container", networkEgress: true, filesystemAccess: [] },
    }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.import.translatedManifest.capabilityType, "integration");
  assert.deepEqual(
    result.import.translatedManifest.connectors.map((c) => c.id),
    ["search", "fetch"],
  );
});

test("translateForeignCapability: activepieces-piece -> Integration, always requires sandbox", () => {
  const withoutSandbox = translateForeignCapability(test_fixture_input({ source: "activepieces-piece" }));
  assert.equal(withoutSandbox.ok, false);

  const withSandbox = translateForeignCapability(
    test_fixture_input({
      source: "activepieces-piece",
      descriptor: { actions: [{ name: "send_message" }], triggers: [{ name: "new_item" }] },
      sandboxPolicy: { isolation: "container", networkEgress: true, filesystemAccess: [] },
    }),
  );
  assert.equal(withSandbox.ok, true);
  if (!withSandbox.ok) return;
  assert.equal(withSandbox.import.translatedManifest.capabilityType, "integration");
  assert.equal(withSandbox.import.translatedManifest.connectors.length, 2);
  assert.equal(withSandbox.import.translatedManifest.connectors[0]?.externalSend, true);
});

test("translateForeignCapability: oss-integration is a permission-declarations-only passthrough", () => {
  const result = translateForeignCapability(
    test_fixture_input({
      source: "oss-integration",
      descriptor: { anything: "ignored, never read for permissions" },
      permissionDeclarations: [{ resourceType: "document", action: "read", scope: "public" }],
    }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.import.translatedManifest.capabilityType, "integration");
  assert.equal(result.import.translatedManifest.connectors.length, 0);
  assert.equal(result.import.translatedManifest.permissions.length, 1);
});

test("translateForeignCapability: throws on missing sourceRef/versionPin", () => {
  assert.throws(() => translateForeignCapability(test_fixture_input({ sourceRef: "" })), ForeignImportValidationError);
  assert.throws(() => translateForeignCapability(test_fixture_input({ versionPin: "" })), ForeignImportValidationError);
});

test("translateForeignCapability: unscoped permission falls back to dataScope 'all', never silently 'private'", () => {
  const result = translateForeignCapability(
    test_fixture_input({
      permissionDeclarations: [{ resourceType: "email", action: "read", scope: "unspecified" }],
    }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.import.translatedManifest.permissions[0]?.dataScope, "all");
});
