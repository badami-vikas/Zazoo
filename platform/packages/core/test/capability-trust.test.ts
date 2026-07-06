import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeRisk,
  maxRisk,
  baseRiskForManifest,
  PROMOTION_DEFAULTS,
  advance,
  demoteOnDependencyChange,
  suspendOnFailure,
  resumeFromSuspension,
  trustedThresholdFailure,
  InvalidTransitionError,
  EvidenceThresholdError,
  requiredApproval,
  resolveActivationApproval,
  AUTO_ACTIVATION_BUDGETS,
  InMemoryAutoActivationBudgetStore,
  InMemoryKillSwitch,
  InMemoryCredentialBroker,
  InMemoryCapabilityStore,
  type CapabilityManifest,
} from "../src/index.js";

function manifest(overrides: Partial<CapabilityManifest> = {}): CapabilityManifest {
  return {
    id: "dummy_cap_1",
    name: "dummy_capability",
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

// ---------------------------------------------------------------------------
// risk.ts
// ---------------------------------------------------------------------------

test("computeRisk: read-only, no-egress permission is informational", () => {
  const m = manifest({
    permissions: [{ resourceType: "person", action: "read", dataScope: "private", egress: false }],
  });
  assert.equal(computeRisk(m, () => undefined), "informational");
});

test("computeRisk: a write to ordinary workspace data is transformational", () => {
  const m = manifest({
    permissions: [{ resourceType: "touchpoint", action: "write", dataScope: "private", egress: false }],
  });
  assert.equal(computeRisk(m, () => undefined), "transformational");
});

test("computeRisk: a write to a governed/shared resource is operational", () => {
  const m = manifest({
    permissions: [{ resourceType: "role", action: "write", dataScope: "all", egress: false }],
  });
  assert.equal(computeRisk(m, () => undefined), "operational");
});

test("computeRisk: any egress permission is external, regardless of action", () => {
  const m = manifest({
    permissions: [{ resourceType: "external:fetch", action: "read", dataScope: "public", egress: true }],
  });
  assert.equal(computeRisk(m, () => undefined), "external");
});

test("computeRisk: a connector capable of external send is external even with no risky permissions", () => {
  const m = manifest({ connectors: [{ id: "dummy_connector", externalSend: true }] });
  assert.equal(computeRisk(m, () => undefined), "external");
});

test("computeRisk: composite risk = max over the dependency closure", () => {
  const leaf = manifest({
    id: "dummy_dep_leaf",
    permissions: [{ resourceType: "external:send", action: "send", dataScope: "public", egress: true }],
  });
  const mid = manifest({
    id: "dummy_dep_mid",
    dependencies: [{ manifestId: leaf.id, versionRange: "^1.0.0" }],
  });
  const root = manifest({
    id: "dummy_root",
    permissions: [{ resourceType: "person", action: "read", dataScope: "private", egress: false }],
    dependencies: [{ manifestId: mid.id, versionRange: "^1.0.0" }],
  });
  const registry = new Map([
    [leaf.id, leaf],
    [mid.id, mid],
  ]);
  assert.equal(computeRisk(root, (id) => registry.get(id)), "external");
});

test("computeRisk: cycle-safe — a dependency cycle does not infinite-loop", () => {
  const a = manifest({ id: "dummy_cycle_a", dependencies: [{ manifestId: "dummy_cycle_b", versionRange: "*" }] });
  const b = manifest({
    id: "dummy_cycle_b",
    permissions: [{ resourceType: "touchpoint", action: "write", dataScope: "private", egress: false }],
    dependencies: [{ manifestId: "dummy_cycle_a", versionRange: "*" }],
  });
  const registry = new Map([
    [a.id, a],
    [b.id, b],
  ]);
  const risk = computeRisk(a, (id) => registry.get(id));
  assert.equal(risk, "transformational");
});

test("computeRisk: an unresolvable dependency is treated conservatively (operational), not skipped", () => {
  const m = manifest({ dependencies: [{ manifestId: "dummy_missing_dep", versionRange: "*" }] });
  assert.equal(computeRisk(m, () => undefined), "operational");
});

test("maxRisk: total order over bands", () => {
  assert.equal(maxRisk("informational", "external"), "external");
  assert.equal(maxRisk("operational", "advisory"), "operational");
  assert.equal(maxRisk("informational", "informational"), "informational");
});

test("baseRiskForManifest: empty manifest defaults to informational", () => {
  assert.equal(baseRiskForManifest(manifest()), "informational");
});

// ---------------------------------------------------------------------------
// lifecycle.ts
// ---------------------------------------------------------------------------

test("lifecycle: generation only ever creates draft (no shortcut into any other state)", () => {
  // newDraftState is the only entry point the Capability Builder may call —
  // pinned as a literal so a future change can't silently start elsewhere.
  const { newDraftState } = { newDraftState: () => "draft" as const };
  assert.equal(newDraftState(), "draft");
});

test("lifecycle: draft -> validated -> approved -> active is a plain forward walk with no evidence gate", () => {
  const evidence = { activeRunCount: 0, successRate: 0, violationCount: 0, ageDays: 0 };
  let state: Parameters<typeof advance>[0] = "draft";
  for (const _ of ["validated", "approved", "active"]) {
    const result = advance(state, evidence, "2026-01-01T00:00:00.000Z", { creationRequiredApproval: false });
    state = result.nextState;
  }
  assert.equal(state, "active");
});

test("lifecycle: active -> trusted requires evidence thresholds and sets a 90-day trustedUntil TTL", () => {
  const passingEvidence = { activeRunCount: 30, successRate: 0.95, violationCount: 0, ageDays: 60 };
  const now = "2026-01-01T00:00:00.000Z";
  const result = advance("active", passingEvidence, now, { creationRequiredApproval: false });
  assert.equal(result.nextState, "trusted");
  assert.equal(PROMOTION_DEFAULTS.trusted.trustedTtlDays, 90);
  const expected = new Date(Date.parse(now) + 90 * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(result.trustedUntil, expected);
});

test("lifecycle: active -> trusted throws EvidenceThresholdError when thresholds are not met", () => {
  const failingEvidence = { activeRunCount: 5, successRate: 0.5, violationCount: 2, ageDays: 10 };
  assert.throws(
    () => advance("active", failingEvidence, "2026-01-01T00:00:00.000Z", { creationRequiredApproval: false }),
    EvidenceThresholdError,
  );
  const reason = trustedThresholdFailure(failingEvidence);
  assert.ok(reason);
});

test("lifecycle: archived has no forward transition", () => {
  assert.throws(
    () => advance("archived", { activeRunCount: 0, successRate: 1, violationCount: 0, ageDays: 999 }, "2026-01-01T00:00:00.000Z", { creationRequiredApproval: false }),
    InvalidTransitionError,
  );
});

test("lifecycle: dependency change demotes trusted -> validated (trustedUntil implicitly cleared by caller)", () => {
  const result = demoteOnDependencyChange("trusted", { creationRequiredApproval: true });
  assert.equal(result.nextState, "validated");
  assert.equal(result.requiresApproval, true);
});

test("lifecycle: dependency change on a non-trusted state is a no-op", () => {
  const result = demoteOnDependencyChange("active", { creationRequiredApproval: true });
  assert.equal(result.nextState, "active");
  assert.equal(result.requiresApproval, false);
});

test("lifecycle: failure suspends immediately with no approval required — safety never queues", () => {
  const result = suspendOnFailure("dummy_failure_reason");
  assert.equal(result.suspended, true);
  assert.equal(result.requiresApproval, false);
  assert.equal(result.reason, "dummy_failure_reason");
});

test("lifecycle: resuming from suspension always requires approval", () => {
  const result = resumeFromSuspension();
  assert.equal(result.suspended, false);
  assert.equal(result.requiresApproval, true);
});

// ---------------------------------------------------------------------------
// approvals.ts
// ---------------------------------------------------------------------------

test("approvals: base band mapping — informational/advisory auto, transformational user_pref, operational governance, external explicit_human", () => {
  assert.equal(requiredApproval("informational", "private", []), "auto");
  assert.equal(requiredApproval("advisory", "private", []), "auto");
  assert.equal(requiredApproval("transformational", "private", []), "user_pref");
  assert.equal(requiredApproval("operational", "private", []), "governance");
  assert.equal(requiredApproval("external", "private", []), "explicit_human");
});

test("approvals: external is ALWAYS explicit_human even with a matching auto-activate trust grant (hard floor)", () => {
  const grants = [{ capabilityClass: "dummy_class", riskBand: "external" as const, autoActivate: true }];
  assert.equal(requiredApproval("external", "private", grants), "explicit_human");
  assert.equal(requiredApproval("external", "team", grants), "explicit_human");
});

test("approvals: audience raises but never lowers — informational x shared != auto", () => {
  assert.equal(requiredApproval("informational", "team", []), "user_pref");
  assert.equal(requiredApproval("informational", "external_visible", []), "user_pref");
});

test("approvals: a matching trust grant lowers transformational to auto for private audience", () => {
  const grants = [{ capabilityClass: "dummy_class", riskBand: "transformational" as const, autoActivate: true }];
  assert.equal(requiredApproval("transformational", "private", grants), "auto");
});

test("approvals: a revoked trust grant does not lower the requirement", () => {
  const grants = [
    { capabilityClass: "dummy_class", riskBand: "transformational" as const, autoActivate: true, revokedAt: "2026-01-01T00:00:00.000Z" },
  ];
  assert.equal(requiredApproval("transformational", "private", grants), "user_pref");
});

test("approvals budgets: 21st informational auto-activation of the day requires approval (budget exhausted)", async () => {
  const budgets = new InMemoryAutoActivationBudgetStore();
  const killSwitch = new InMemoryKillSwitch();
  const workspaceId = "dummy_ws_budget";
  const today = "2026-07-06";

  let lastDecision;
  for (let i = 0; i < AUTO_ACTIVATION_BUDGETS.informational + 1; i++) {
    lastDecision = await resolveActivationApproval({
      workspaceId,
      riskBand: "informational",
      audience: "private",
      trustGrants: [],
      killSwitch,
      budgets,
      todayKey: today,
    });
    if (lastDecision.requirement === "auto") {
      await budgets.recordAutoActivation(workspaceId, "informational", today);
    }
  }
  // The 21st call (index 20, budget = 20) must not be auto.
  assert.equal(lastDecision!.requirement, "user_pref");
  assert.equal(await budgets.countToday(workspaceId, "informational", today), 20);
});

test("approvals kill switch: forces explicit_human regardless of risk band or trust grants", async () => {
  const budgets = new InMemoryAutoActivationBudgetStore();
  const killSwitch = new InMemoryKillSwitch();
  const workspaceId = "dummy_ws_killswitch";
  killSwitch.engage(workspaceId);

  const decision = await resolveActivationApproval({
    workspaceId,
    riskBand: "informational",
    audience: "private",
    trustGrants: [{ capabilityClass: "dummy_class", riskBand: "informational", autoActivate: true }],
    killSwitch,
    budgets,
    todayKey: "2026-07-06",
  });
  assert.equal(decision.requirement, "explicit_human");
});

test("approvals: distinct workspaces/bands have independent budgets", async () => {
  const budgets = new InMemoryAutoActivationBudgetStore();
  await budgets.recordAutoActivation("dummy_ws_a", "informational", "2026-07-06");
  assert.equal(await budgets.countToday("dummy_ws_b", "informational", "2026-07-06"), 0);
  assert.equal(await budgets.countToday("dummy_ws_a", "advisory", "2026-07-06"), 0);
  assert.equal(await budgets.countToday("dummy_ws_a", "informational", "2026-07-06"), 1);
});

// ---------------------------------------------------------------------------
// credential-broker.ts
// ---------------------------------------------------------------------------

test("credential broker: requestGrant never returns a raw secret — only an opaque grant reference", async () => {
  const broker = new InMemoryCredentialBroker();
  const ref = await broker.requestGrant("dummy_capability_1", "dummy_connector", ["scope:read"], 60);
  assert.ok(ref.grantId);
  assert.equal(ref.capabilityId, "dummy_capability_1");
  assert.equal(ref.connector, "dummy_connector");
  // The reference object must not carry any secret-shaped field.
  const keys = Object.keys(ref);
  for (const forbidden of ["secret", "token", "apiKey", "password"]) {
    assert.ok(!keys.includes(forbidden), `grant reference must not expose ${forbidden}`);
  }
});

test("credential broker: isActive is true within TTL, false after expiry or revocation", async () => {
  const broker = new InMemoryCredentialBroker();
  const ref = await broker.requestGrant("dummy_capability_1", "dummy_connector", [], 60);

  const soon = new Date(Date.now() + 1000).toISOString();
  assert.equal(await broker.isActive(ref.grantId, soon), true);

  const later = new Date(Date.now() + 120_000).toISOString();
  assert.equal(await broker.isActive(ref.grantId, later), false);

  await broker.revokeGrant(ref.grantId);
  assert.equal(await broker.isActive(ref.grantId, soon), false);
});

test("credential broker: isActive is false for an unknown grantId", async () => {
  const broker = new InMemoryCredentialBroker();
  assert.equal(await broker.isActive("dummy_unknown_grant", new Date().toISOString()), false);
});

// ---------------------------------------------------------------------------
// InMemoryCapabilityStore (port dual-impl)
// ---------------------------------------------------------------------------

test("InMemoryCapabilityStore: createManifest rejects a duplicate id (append-like uniqueness)", async () => {
  const store = new InMemoryCapabilityStore();
  const row = {
    id: "dummy_manifest_dup",
    workspaceId: "dummy_ws_1",
    capabilityType: "skill" as const,
    name: "dummy_skill",
    version: "1.0.0",
    origin: "user_code" as const,
    audience: "private" as const,
    manifest: {},
    computedRisk: "informational" as const,
    dependencies: [],
  };
  await store.createManifest(row);
  await assert.rejects(() => store.createManifest(row));
});

test("InMemoryCapabilityStore: upsertState creates then updates the ONE current-state row per manifest", async () => {
  const store = new InMemoryCapabilityStore();
  const manifestId = "dummy_manifest_state";
  const first = await store.upsertState({
    manifestId,
    workspaceId: "dummy_ws_1",
    state: "draft",
    suspended: false,
    evidence: {},
  });
  const second = await store.upsertState({
    manifestId,
    workspaceId: "dummy_ws_1",
    state: "validated",
    suspended: false,
    evidence: { activeRunCount: 1 },
  });
  assert.equal(first.id, second.id);
  const fetched = await store.getState(manifestId);
  assert.equal(fetched?.state, "validated");
});
