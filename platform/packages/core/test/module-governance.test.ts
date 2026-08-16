import test from "node:test";
import assert from "node:assert/strict";

import {
  governanceVerdict,
  governanceRuleMatches,
  assertModuleGovernance,
  ModuleGovernanceDenied,
  parseModuleManifest,
  ModuleManifestValidationError,
} from "../src/index.js";
import type { ModuleGovernancePolicy } from "../src/index.js";

const accountingPolicy: ModuleGovernancePolicy = {
  allow: [
    { action: "books.read", reason: "The report view reads the open client's imported facts." },
  ],
  deny: [
    {
      action: "model.call.unattended",
      reason: "No model call without an explicit user action — nothing calls out on upload, render, navigation or a timer.",
    },
  ],
};

test("an absent policy allows — a Module nobody has governed yet still works", () => {
  const verdict = governanceVerdict(undefined, "model.call.unattended");
  assert.equal(verdict.allowed, true);
});

test("an empty policy is not a default-deny", () => {
  const verdict = governanceVerdict({ allow: [], deny: [] }, "anything.at.all");
  assert.equal(verdict.allowed, true);
});

test("a deny rule refuses and carries the user's own stated reason", () => {
  const verdict = governanceVerdict(accountingPolicy, "model.call.unattended");
  assert.equal(verdict.allowed, false);
  assert.match(verdict.allowed === false ? verdict.reason : "", /without an explicit user action/);
});

test("deny wins over allow regardless of declaration order", () => {
  const policy: ModuleGovernancePolicy = {
    allow: [{ action: "model", reason: "broadly permitted" }],
    deny: [{ action: "model.call", reason: "except this one" }],
  };
  const verdict = governanceVerdict(policy, "model.call");
  assert.equal(verdict.allowed, false, "an allow must never widen past a deny");
});

test("matching is segment-prefix, so a rule cannot leak across a name boundary", () => {
  // The bug this exists to prevent: `model` denying `models.list` because one
  // string happens to start with the other.
  assert.equal(governanceRuleMatches("model", "model.call"), true);
  assert.equal(governanceRuleMatches("model", "model"), true);
  assert.equal(governanceRuleMatches("model", "models.list"), false);
  assert.equal(governanceRuleMatches("*", "anything"), true);
});

test("a deny below the rule's segment still matches (model.call covers model.call.summary)", () => {
  const verdict = governanceVerdict(accountingPolicy, "model.call.unattended.summary");
  assert.equal(verdict.allowed, false);
});

test("assertModuleGovernance throws naming the Module, the action and the rule", () => {
  assert.throws(
    () => assertModuleGovernance("accounting", accountingPolicy, "model.call.unattended"),
    (error: unknown) => {
      assert.ok(error instanceof ModuleGovernanceDenied);
      assert.equal(error.moduleName, "accounting");
      assert.equal(error.action, "model.call.unattended");
      assert.match(error.message, /accounting is not allowed to model\.call\.unattended/);
      return true;
    },
  );
  // The allowed path must not throw, or every governed call site breaks.
  assert.doesNotThrow(() => assertModuleGovernance("accounting", accountingPolicy, "books.read"));
});

test("a malformed governance block fails loudly rather than installing as empty", () => {
  // "Empty" is the PERMISSIVE state here, so a corrupt policy silently becoming
  // empty would silently remove every boundary the user declared.
  const base = {
    name: "test-module",
    version: "0.1.0",
    kind: "organization_definition",
    summary: "s",
    description: "d",
    lineageManifestId: null,
    dependencies: [],
    capabilities: [
      {
        id: "test.cap",
        capabilityType: "database",
        permissions: [{ resourceType: "record", action: "read", dataScope: "private", egress: false }],
      },
    ],
    contextProviders: [],
    organizationVocab: { alignsToBridgeTheme: true, domainTerms: {} },
  };

  assert.throws(
    () => parseModuleManifest({ module: { ...base, governance: { deny: [{ action: "model.call" }] } } }),
    ModuleManifestValidationError,
    "a rule with no reason must be rejected — it could not explain itself to the user",
  );
  assert.throws(
    () => parseModuleManifest({ module: { ...base, governance: { allow: "not-an-array" } } }),
    ModuleManifestValidationError,
  );

  const ok = parseModuleManifest({
    module: { ...base, governance: { allow: [], deny: [{ action: "*", reason: "quarantined" }] } },
  });
  assert.equal(ok.governance?.deny[0]?.action, "*");
  // A `*` deny quarantines the Module outright.
  assert.equal(governanceVerdict(ok.governance, "literally.anything").allowed, false);
});
