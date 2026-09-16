import test from "node:test";
import assert from "node:assert/strict";

import {
  governanceVerdict,
  governanceRuleMatches,
  readModuleGovernanceOverlay,
  resolveModuleGovernance,
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

// ── The engine-held overlay (TASK-088) ───────────────────────────────────────
//
// Manifests are immutable (ADR-178), so `userEdited` — parsed since ADR-248 and
// read by the Governance Section — could never be set by anything in the repo.
// The overlay is the missing half: user policy held by the engine per
// Organization + Module, resolved OVER the manifest's declared default. The
// manifest itself is never mutated.

test("no overlay resolves to the manifest's declared policy, untouched", () => {
  const resolved = resolveModuleGovernance(accountingPolicy, null);
  assert.deepEqual(resolved, accountingPolicy);
  assert.equal(resolved?.userEdited, undefined, "an unedited policy must not claim to be edited");
});

test("an overlay replaces the declared policy and marks it edited", () => {
  const overlay = readModuleGovernanceOverlay({
    allow: [{ action: "books.read", reason: "still fine" }],
    deny: [{ action: "books.write", reason: "I turned all writes off" }],
    updatedAt: "2026-08-30T00:00:00.000Z",
  });
  const resolved = resolveModuleGovernance(accountingPolicy, overlay);
  assert.equal(resolved?.userEdited, true, "the flag nothing could set is now set by the overlay");
  assert.equal(governanceVerdict(resolved, "books.write.human").allowed, false);
  // The manifest's own deny is gone because the USER removed it — the overlay is
  // the whole policy, not an addition to one the user can no longer see or edit.
  assert.equal(governanceVerdict(resolved, "model.call.unattended").allowed, true);
});

test("deny still wins inside an overlay", () => {
  const overlay = readModuleGovernanceOverlay({
    allow: [{ action: "model", reason: "broadly permitted" }],
    deny: [{ action: "model.call", reason: "except this one" }],
    updatedAt: "2026-08-30T00:00:00.000Z",
  });
  assert.equal(
    governanceVerdict(resolveModuleGovernance(undefined, overlay), "model.call").allowed,
    false,
  );
});

test("an overlay may govern a Module whose manifest declares nothing", () => {
  const overlay = readModuleGovernanceOverlay({
    allow: [],
    deny: [{ action: "*", reason: "I am quarantining this Module" }],
    updatedAt: "2026-08-30T00:00:00.000Z",
  });
  assert.equal(governanceVerdict(resolveModuleGovernance(undefined, overlay), "anything").allowed, false);
});

test("a malformed overlay row falls back to the manifest, never to an empty policy", () => {
  // Fail CLOSED in the only direction that matters here: "empty" is the
  // PERMISSIVE state, so a corrupt row must never silently delete the deny
  // rules the manifest declared.
  const bad: unknown[] = [
    null,
    undefined,
    "not-an-object",
    {}, // a missing list is not an empty one — that would drop the manifest's denies
    { allow: [] }, // ditto, half-written
    { allow: "nope", deny: [] },
    { allow: [], deny: [{ action: "books.write" }] }, // a rule that cannot explain itself
    { allow: [], deny: [{ action: "", reason: "empty action" }] },
  ];
  for (const value of bad) {
    assert.equal(readModuleGovernanceOverlay(value), null, `expected null for ${JSON.stringify(value)}`);
    assert.deepEqual(
      resolveModuleGovernance(accountingPolicy, readModuleGovernanceOverlay(value)),
      accountingPolicy,
    );
  }
});

test("an emptied overlay is an honest user edit, not a default-deny", () => {
  const overlay = readModuleGovernanceOverlay({ allow: [], deny: [], updatedAt: "2026-08-30T00:00:00.000Z" });
  const resolved = resolveModuleGovernance(accountingPolicy, overlay);
  assert.equal(resolved?.userEdited, true);
  assert.equal(governanceVerdict(resolved, "model.call.unattended").allowed, true);
});
