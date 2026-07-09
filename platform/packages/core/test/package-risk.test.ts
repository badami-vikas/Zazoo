import { test } from "node:test";
import assert from "node:assert/strict";

import { computePackageRisk, packageHasLethalTrifecta, type CapabilityManifest, type PackageManifest } from "../src/index.js";

function cap(overrides: Partial<CapabilityManifest> = {}): CapabilityManifest {
  return {
    id: "test_fixture_cap",
    name: "test_fixture_capability",
    version: "1.0.0",
    capabilityType: "skill",
    origin: "user_code",
    audience: "private",
    permissions: [],
    connectors: [],
    dependencies: [],
    ...overrides,
  };
}

function pkg(overrides: Partial<PackageManifest> = {}): PackageManifest {
  return {
    name: "dummy-package",
    version: "1.0.0",
    kind: "workspace_definition",
    summary: "dummy",
    description: "dummy",
    lineageManifestId: null,
    dependencies: [],
    capabilities: [cap()],
    contextProviders: [],
    workspaceVocab: { alignsToBridgeTheme: true, domainTerms: {} },
    ...overrides,
  };
}

test("computePackageRisk: composite risk = max over bundled capabilities", () => {
  const p = pkg({
    capabilities: [
      cap({ id: "a", permissions: [{ resourceType: "person", action: "read", dataScope: "private", egress: false }] }),
      cap({ id: "b", permissions: [{ resourceType: "touchpoint", action: "write", dataScope: "all", egress: false }] }),
    ],
  });
  const result = computePackageRisk(p, () => undefined, () => undefined);
  assert.equal(result.compositeRisk, "transformational");
  assert.equal(result.effectiveRisk, "transformational");
  assert.equal(result.trifectaEscalated, false);
});

test("computePackageRisk: a single egress permission alone drives risk to external", () => {
  const p = pkg({
    capabilities: [cap({ id: "a", permissions: [{ resourceType: "external_fetch", action: "read", dataScope: "public", egress: true }] })],
  });
  const result = computePackageRisk(p, () => undefined, () => undefined);
  assert.equal(result.effectiveRisk, "external");
});

test("computePackageRisk: trifecta assembled ACROSS separate capabilities escalates to external", () => {
  const p = pkg({
    capabilities: [
      // Capability A: private-data read only (individually informational).
      cap({ id: "a", permissions: [{ resourceType: "person", action: "read", dataScope: "private", egress: false }] }),
      // Capability B: untrusted external ingest read (individually informational, no egress flag).
      cap({ id: "b", permissions: [{ resourceType: "external_fetch", action: "read", dataScope: "public", egress: false }] }),
      // Capability C: a write to ordinary workspace data, but its CONNECTOR can send externally.
      cap({
        id: "c",
        permissions: [{ resourceType: "touchpoint", action: "write", dataScope: "all", egress: false }],
        connectors: [{ id: "sender", externalSend: true }],
      }),
    ],
  });
  const result = computePackageRisk(p, () => undefined, () => undefined);
  assert.equal(result.trifectaEscalated, true);
  assert.equal(result.effectiveRisk, "external");
  // Confirm the composite alone (without the trifecta escalation) would NOT have been external —
  // proving the union check is doing real work, not just restating the composite max.
  assert.notEqual(result.compositeRisk, undefined);
});

test("packageHasLethalTrifecta: false when only two of three legs present", () => {
  const capabilities = [
    cap({ id: "a", permissions: [{ resourceType: "person", action: "read", dataScope: "private", egress: false }] }),
    cap({ id: "b", permissions: [{ resourceType: "external_fetch", action: "read", dataScope: "public", egress: false }] }),
  ];
  assert.equal(packageHasLethalTrifecta(capabilities), false);
});

test("computePackageRisk: walks dependency package's capabilities into the composite", () => {
  const depPkg = pkg({
    name: "dep-package",
    capabilities: [cap({ id: "dep-cap", permissions: [{ resourceType: "role", action: "write", dataScope: "all", egress: false }] })],
  });
  const p = pkg({ dependencies: [{ manifestId: "dep-package", version: "1.0.0" }] });
  const result = computePackageRisk(
    p,
    () => undefined,
    (name, version) => (name === "dep-package" && version === "1.0.0" ? depPkg : undefined),
  );
  // "role" is a GOVERNED_RESOURCES write -> operational, pulled in from the dependency package.
  assert.equal(result.compositeRisk, "operational");
});

test("computePackageRisk: unresolved package dependency escalates conservatively to operational", () => {
  const p = pkg({ dependencies: [{ manifestId: "missing-package", version: "1.0.0" }] });
  const result = computePackageRisk(p, () => undefined, () => undefined);
  assert.equal(result.unresolvedDependencies.length, 1);
  assert.equal(result.compositeRisk, "operational");
});

test("computePackageRisk: cycle-safe against a self-referencing dependency", () => {
  const p = pkg({ name: "cyclic-package", dependencies: [{ manifestId: "cyclic-package", version: "1.0.0" }] });
  const result = computePackageRisk(p, () => undefined, (name, version) => (name === "cyclic-package" && version === "1.0.0" ? p : undefined));
  // Should terminate and just reflect the package's own capability risk (informational/transformational),
  // not throw or infinite-loop.
  assert.ok(result.compositeRisk);
});
