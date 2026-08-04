/**
 * DrizzlePolicyParamStore against a real Postgres (PGlite), ADR-165.
 *
 * The consumer is `router.ts`'s `resolveGates(await policyParams.get(org))` —
 * the promotion gate's thresholds. Two properties matter more than CRUD here:
 * a stored override must actually reach the gate, and a row that CANNOT reach
 * the gate must fail loudly instead of leaving an operator believing a
 * threshold moved when it did not.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { DEFAULT_POLICY_PARAMS, resolveGates, getTunable } from "@bridge/core";
import { createLocalDb } from "../src/client-local.js";
import { DrizzlePolicyParamStore } from "../src/policy-param-store.js";
import { organizations, policies, policyParams } from "../src/schema.js";

async function freshDb() {
  const { db, close } = await createLocalDb();
  const organizationId = randomUUID();
  await db.insert(organizations).values({ id: organizationId, name: "Params Org" });
  return { db, close, organizationId, store: new DrizzlePolicyParamStore(db) };
}

type Row = { paramKey: string; value: unknown; policyId?: string };

async function seed(db: Awaited<ReturnType<typeof freshDb>>["db"], organizationId: string, rows: Row[]) {
  await db.insert(policyParams).values(
    rows.map((row) => ({
      organizationId,
      paramKey: row.paramKey,
      value: row.value,
      ...(row.policyId ? { policyId: row.policyId } : {}),
    })),
  );
}

test("an Organization with no stored rows resolves to the defaults, not an error", async () => {
  const { close, organizationId, store } = await freshDb();
  try {
    assert.deepEqual(await store.get(organizationId), DEFAULT_POLICY_PARAMS);
  } finally {
    await close();
  }
});

test("stored gate thresholds actually reach resolveGates — the promotion gate reads the Organization's values", async () => {
  const { db, close, organizationId, store } = await freshDb();
  try {
    await seed(db, organizationId, [
      { paramKey: "aqv.gates.qualityMin", value: 0.95 },
      { paramKey: "aqv.gates.minCases", value: 50 },
    ]);
    const gates = resolveGates(await store.get(organizationId));
    assert.equal(gates.qualityMin, 0.95, "a stricter stored gate must be the one the promotion gate enforces");
    assert.equal(gates.minCases, 50);
    // Unspecified gates keep their defaults rather than becoming undefined.
    assert.equal(gates.routePMin, DEFAULT_POLICY_PARAMS.aqv.gates.routePMin);
    assert.equal(gates.ci, DEFAULT_POLICY_PARAMS.aqv.gates.ci);
  } finally {
    await close();
  }
});

test("a tunable param round-trips whole, and a value-only row keeps the default bounds", async () => {
  const { db, close, organizationId, store } = await freshDb();
  try {
    await seed(db, organizationId, [
      { paramKey: "variance.params.tone_threshold", value: { value: 0.8 } },
      { paramKey: "variance.params.brevity", value: { value: 0.4, floor: 0.1, ceil: 0.9 } },
      { paramKey: "variance.delta", value: 0.05 },
    ]);
    const params = await store.get(organizationId);
    const tone = getTunable(params, "tone_threshold");
    assert.equal(tone?.value, 0.8);
    assert.equal(tone?.floor, DEFAULT_POLICY_PARAMS.variance.params.tone_threshold?.floor, "value-only override must keep the default floor");
    assert.equal(tone?.ceil, DEFAULT_POLICY_PARAMS.variance.params.tone_threshold?.ceil);
    assert.deepEqual(getTunable(params, "brevity"), { value: 0.4, floor: 0.1, ceil: 0.9 });
    assert.equal(params.variance.delta, 0.05);
  } finally {
    await close();
  }
});

test("an unknown param_key THROWS rather than silently doing nothing", async () => {
  const { db, close, organizationId, store } = await freshDb();
  try {
    // The realistic failure: a typo in a key an operator believes tightened a
    // gate. Silently ignoring it reports success while the gate never moved.
    await seed(db, organizationId, [{ paramKey: "aqv.gates.qualityMinn", value: 0.99 }]);
    await assert.rejects(() => store.get(organizationId), /unknown param_key "aqv\.gates\.qualityMinn"/);
  } finally {
    await close();
  }
});

test("out-of-range and malformed values are refused at the persistence boundary", async () => {
  const { db, close, organizationId, store } = await freshDb();
  try {
    // A negative quality threshold is not a preference — every candidate would
    // clear it, so the gate is disabled while still appearing configured.
    await seed(db, organizationId, [{ paramKey: "aqv.gates.qualityMin", value: -1 }]);
    await assert.rejects(() => store.get(organizationId), /invalid for param_key "aqv\.gates\.qualityMin"/);
  } finally {
    await close();
  }
});

test("a tunable whose floor exceeds its ceil is refused — the clamp would be nonsense", async () => {
  const { db, close, organizationId, store } = await freshDb();
  try {
    await seed(db, organizationId, [
      { paramKey: "variance.params.tone_threshold", value: { value: 0.5, floor: 0.9, ceil: 0.1 } },
    ]);
    await assert.rejects(() => store.get(organizationId), /floor must be <= ceil/);
  } finally {
    await close();
  }
});

test("policy-scoped rows are ignored, not folded into the Organization document", async () => {
  const { db, close, organizationId, store } = await freshDb();
  try {
    const policyId = randomUUID();
    await db.insert(policies).values({
      id: policyId,
      organizationId,
      scopeType: "organization",
      name: "Some policy",
      rule: {},
      effect: "allow",
    });
    await seed(db, organizationId, [
      { paramKey: "aqv.gates.qualityMin", value: 0.9 },
      // PolicyParams has no per-policy dimension; this row cannot be
      // represented by the port and must not leak into the Organization doc.
      { paramKey: "aqv.gates.qualityMin", value: 0.1, policyId },
    ]);
    assert.equal(resolveGates(await store.get(organizationId)).qualityMin, 0.9);
  } finally {
    await close();
  }
});

test("one Organization's overrides never leak into another's", async () => {
  const { db, close, organizationId, store } = await freshDb();
  try {
    const otherOrganizationId = randomUUID();
    await db.insert(organizations).values({ id: otherOrganizationId, name: "Other Org" });
    await seed(db, organizationId, [{ paramKey: "aqv.gates.qualityMin", value: 0.99 }]);

    assert.equal(resolveGates(await store.get(organizationId)).qualityMin, 0.99);
    assert.equal(
      resolveGates(await store.get(otherOrganizationId)).qualityMin,
      DEFAULT_POLICY_PARAMS.aqv.gates.qualityMin,
      "an Organization with no rows of its own must resolve to defaults",
    );
  } finally {
    await close();
  }
});
