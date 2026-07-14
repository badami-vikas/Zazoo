import { test } from "node:test";
import assert from "node:assert/strict";

import {
  evaluateSandboxRequirement,
  sandboxTrifectaLegs,
  packageHasLethalTrifecta,
  computePackageRisk,
  parsePackageManifest,
  PackageManifestValidationError,
  type CapabilityManifest,
  type CapabilityExecutionSpec,
  type PackageManifest,
} from "../src/index.js";

function cap(overrides: Partial<CapabilityManifest> = {}): CapabilityManifest {
  return {
    id: "test_fixture_cap",
    name: "test_fixture_capability",
    version: "1.0.0",
    capabilityType: "tool",
    origin: "user_code",
    audience: "private",
    permissions: [],
    connectors: [],
    dependencies: [],
    ...overrides,
  };
}

function exec(overrides: Partial<CapabilityExecutionSpec["sandbox"]> = {}, isolation: CapabilityExecutionSpec["isolation"] = "container"): CapabilityExecutionSpec {
  return { executable: true, isolation, sandbox: { network: false, filesystem: [], env: [], ...overrides } };
}

// --- Isolation floor: "require sandboxing for any executable capability" ---

test("evaluateSandboxRequirement: a declarative capability (no execution) is trivially satisfied", () => {
  const r = evaluateSandboxRequirement(cap({ capabilityType: "view" }));
  assert.equal(r.requiresSandbox, false);
  assert.equal(r.satisfied, true);
});

test("evaluateSandboxRequirement: an executable capability with isolation 'none' cannot run (satisfied=false)", () => {
  const r = evaluateSandboxRequirement(cap({ execution: exec({}, "none") }));
  assert.equal(r.requiresSandbox, true);
  assert.equal(r.satisfied, false);
  assert.equal(r.reason, "executable_requires_isolation");
});

test("evaluateSandboxRequirement: an executable capability with a real isolation tier is satisfied", () => {
  const r = evaluateSandboxRequirement(cap({ execution: exec({}, "container") }));
  assert.equal(r.requiresSandbox, true);
  assert.equal(r.satisfied, true);
  assert.equal(r.reason, undefined);
});

test("evaluateSandboxRequirement: network/fs caps under only 'process' isolation are refused (need container/vm)", () => {
  const net = evaluateSandboxRequirement(cap({ execution: exec({ network: true }, "process") }));
  assert.equal(net.satisfied, false);
  assert.equal(net.reason, "executable_caps_require_stronger_isolation");

  const fs = evaluateSandboxRequirement(cap({ execution: exec({ filesystem: ["/tmp/**"] }, "process") }));
  assert.equal(fs.satisfied, false);

  // process isolation is fine when it grants NO network/fs (pure compute).
  const pure = evaluateSandboxRequirement(cap({ execution: exec({}, "process") }));
  assert.equal(pure.satisfied, true);
});

// --- Sandbox-cap trifecta: "gate sandbox network/fs/env caps before Active" ---

test("sandboxTrifectaLegs: declarative capability contributes no legs", () => {
  assert.deepEqual(sandboxTrifectaLegs(cap()), { privateRead: false, untrustedIngest: false, egress: false });
});

test("sandboxTrifectaLegs: network -> egress+ingest; filesystem/env -> privateRead", () => {
  assert.deepEqual(sandboxTrifectaLegs(cap({ execution: exec({ network: true }) })), {
    privateRead: false,
    untrustedIngest: true,
    egress: true,
  });
  assert.deepEqual(sandboxTrifectaLegs(cap({ execution: exec({ filesystem: ["/data"] }) })).privateRead, true);
  assert.deepEqual(sandboxTrifectaLegs(cap({ execution: exec({ env: ["OPENAI_API_KEY"] }) })).privateRead, true);
});

test("packageHasLethalTrifecta: a single executable whose SANDBOX grants network + filesystem assembles the trifecta", () => {
  // network => egress + untrusted-ingest; filesystem => private read. All three
  // legs from ONE executable capability's sandbox grants — no declared
  // permission needed. This is the sandbox-cap gate doing real work.
  const executable = cap({ id: "runner", execution: exec({ network: true, filesystem: ["/workspace/**"] }, "container") });
  assert.equal(packageHasLethalTrifecta([executable]), true);
});

test("packageHasLethalTrifecta: sandbox network egress completes a trifecta whose other legs come from permissions", () => {
  // Capability A reads private data; Capability B is an executable whose sandbox
  // has network (egress + ingest). Union across the two = full trifecta.
  const a = cap({ id: "a", permissions: [{ resourceType: "person", action: "read", dataScope: "private", egress: false }] });
  const b = cap({ id: "b", execution: exec({ network: true }, "container") });
  assert.equal(packageHasLethalTrifecta([a, b]), true);
});

test("computePackageRisk: a bundled executable whose sandbox forms the trifecta escalates the package to external", () => {
  const p: PackageManifest = {
    name: "runner-package",
    version: "1.0.0",
    kind: "tool",
    summary: "s",
    description: "d",
    lineageManifestId: null,
    dependencies: [],
    capabilities: [cap({ id: "runner", execution: exec({ network: true, env: ["SECRET"] }, "container") })],
    contextProviders: [],
    workspaceVocab: { alignsToBridgeTheme: true, domainTerms: {} },
  };
  const result = computePackageRisk(p, () => undefined, () => undefined);
  assert.equal(result.trifectaEscalated, true);
  assert.equal(result.effectiveRisk, "external");
});

// --- Package manifest parsing of the execution spec ---

test("parsePackageManifest: parses a well-formed capability execution spec", () => {
  const parsed = parsePackageManifest({
    name: "exec-pkg",
    version: "1.0.0",
    kind: "tool",
    summary: "s",
    capabilities: [
      {
        id: "runner",
        capability_type: "tool",
        permissions: [],
        execution: { executable: true, isolation: "container", sandbox: { network: true, filesystem: ["/tmp/**"] } },
      },
    ],
  });
  const spec = parsed.capabilities[0]?.execution;
  assert.ok(spec);
  assert.equal(spec?.isolation, "container");
  assert.equal(spec?.sandbox.network, true);
  assert.deepEqual(spec?.sandbox.filesystem, ["/tmp/**"]);
  assert.deepEqual(spec?.sandbox.env, []);
});

test("parsePackageManifest: a malformed execution spec fails loudly (never silently declarative)", () => {
  assert.throws(
    () =>
      parsePackageManifest({
        name: "bad-exec-pkg",
        version: "1.0.0",
        kind: "tool",
        summary: "s",
        capabilities: [{ id: "runner", capability_type: "tool", permissions: [], execution: { executable: true, isolation: "rocket" } }],
      }),
    PackageManifestValidationError,
  );
});
