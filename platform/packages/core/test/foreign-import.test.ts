import { test } from "node:test";
import assert from "node:assert/strict";

import type { CapabilityManifest, ForeignCapabilityImport, PackageManifest } from "../src/index.js";

function test_fixture_capability_manifest(
  overrides: Partial<Omit<CapabilityManifest, "origin">> = {},
): CapabilityManifest & { origin: "community" } {
  return {
    id: "test_fixture_cap",
    name: "test_fixture_capability",
    version: "1.0.0",
    capabilityType: "tool",
    audience: "private",
    permissions: [],
    connectors: [],
    dependencies: [],
    ...overrides,
    origin: "community",
  };
}

function test_fixture_foreign_import(overrides: Partial<ForeignCapabilityImport> = {}): ForeignCapabilityImport {
  return {
    source: "mcp-server",
    sourceRef: "test_fixture_mcp_server_ref",
    versionPin: "1.2.3",
    permissionDeclarations: [{ resourceType: "filesystem", action: "read", scope: "workspace" }],
    sandboxPolicy: { isolation: "process", networkEgress: false, filesystemAccess: [] },
    riskLabel: "advisory",
    auditRequired: true,
    rollbackRef: "test_fixture_rollback_snapshot_1",
    translatedManifest: test_fixture_capability_manifest(),
    ...overrides,
  };
}

test("ForeignCapabilityImport: translatedManifest origin is always community", () => {
  const imp = test_fixture_foreign_import();
  assert.equal(imp.translatedManifest.origin, "community");
});

test("ForeignCapabilityImport: auditRequired is the literal true", () => {
  const imp = test_fixture_foreign_import();
  assert.equal(imp.auditRequired, true);
});

test("ForeignCapabilityImport: covers all four foreign sources", () => {
  const sources: ForeignCapabilityImport["source"][] = [
    "pi-package",
    "mcp-server",
    "activepieces-piece",
    "oss-integration",
  ];
  for (const source of sources) {
    const imp = test_fixture_foreign_import({ source });
    assert.equal(imp.source, source);
  }
});

test("ForeignCapabilityImport: sandboxPolicy carries isolation/egress/filesystem fields", () => {
  const imp = test_fixture_foreign_import({
    sandboxPolicy: { isolation: "container", networkEgress: true, filesystemAccess: ["/tmp/test_fixture_scratch"] },
  });
  assert.equal(imp.sandboxPolicy.isolation, "container");
  assert.equal(imp.sandboxPolicy.networkEgress, true);
  assert.deepEqual(imp.sandboxPolicy.filesystemAccess, ["/tmp/test_fixture_scratch"]);
});

test("ForeignCapabilityImport: translatedPackage is optional and reuses PackageManifest verbatim", () => {
  const withoutPackage = test_fixture_foreign_import();
  assert.equal(withoutPackage.translatedPackage, undefined);

  const translatedPackage: PackageManifest = {
    name: "test-fixture-package",
    version: "1.0.0",
    kind: "integration_bundle",
    summary: "test_fixture summary",
    description: "test_fixture description",
    lineageManifestId: null,
    dependencies: [],
    capabilities: [test_fixture_capability_manifest()],
    contextProviders: [],
    workspaceVocab: { alignsToBridgeTheme: true, domainTerms: {} },
  };
  const withPackage = test_fixture_foreign_import({ translatedPackage });
  assert.equal(withPackage.translatedPackage?.name, "test-fixture-package");
});

test("ForeignCapabilityImport: versionPin and sourceRef are opaque source-specific strings", () => {
  const imp = test_fixture_foreign_import({ source: "activepieces-piece", sourceRef: "test_fixture_piece_slug", versionPin: "0.9.9" });
  assert.equal(imp.sourceRef, "test_fixture_piece_slug");
  assert.equal(imp.versionPin, "0.9.9");
});
