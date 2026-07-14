import { test } from "node:test";
import assert from "node:assert/strict";

import {
  clampToBounds,
  cloneDefaultPolicyParams,
  DEFAULT_POLICY_PARAMS,
  getTunable,
  InMemoryPolicyParamStore,
  mergePolicyParams,
  resolveGates,
} from "../src/policy/params.js";

test("DEFAULT_POLICY_PARAMS: matches the agent-quality §5 starting proxies", () => {
  const g = DEFAULT_POLICY_PARAMS.aqv.gates;
  assert.equal(g.qualityMin, 0.85);
  assert.equal(g.routePMin, 0.85);
  assert.equal(g.routeRMin, 0.8);
  assert.equal(g.correctionMax, 0.2);
  assert.equal(g.minCases, 20);
  assert.equal(g.ci, 0.95);
  assert.equal(DEFAULT_POLICY_PARAMS.aqv.windowDays, 30);
  assert.equal(DEFAULT_POLICY_PARAMS.variance.delta, 0.02);
  assert.deepEqual(DEFAULT_POLICY_PARAMS.variance.params["tone_threshold"], { value: 0.5, floor: 0, ceil: 1 });
});

test("cloneDefaultPolicyParams: returns an independent deep copy", () => {
  const a = cloneDefaultPolicyParams();
  a.aqv.gates.qualityMin = 0.1;
  a.variance.params["tone_threshold"]!.value = 0.99;
  // Mutating the clone must not touch the exported constant.
  assert.equal(DEFAULT_POLICY_PARAMS.aqv.gates.qualityMin, 0.85);
  assert.equal(DEFAULT_POLICY_PARAMS.variance.params["tone_threshold"]!.value, 0.5);
});

test("mergePolicyParams: undefined override returns defaults", () => {
  assert.deepEqual(mergePolicyParams(undefined), DEFAULT_POLICY_PARAMS);
});

test("mergePolicyParams: partial gate + windowDays override", () => {
  const merged = mergePolicyParams({ aqv: { windowDays: 14, gates: { qualityMin: 0.9 } } });
  assert.equal(merged.aqv.windowDays, 14);
  assert.equal(merged.aqv.gates.qualityMin, 0.9);
  // Unspecified gate fields keep their default.
  assert.equal(merged.aqv.gates.routePMin, 0.85);
});

test("mergePolicyParams: tunable partial keeps default bounds, new key added", () => {
  const merged = mergePolicyParams({
    variance: {
      delta: 0.05,
      params: { tone_threshold: { value: 0.7 }, confidence_floor: { value: 0.3, floor: 0, ceil: 1 } },
    },
  });
  assert.equal(merged.variance.delta, 0.05);
  // Only value was overridden — floor/ceil stay the default bounds.
  assert.deepEqual(merged.variance.params["tone_threshold"], { value: 0.7, floor: 0, ceil: 1 });
  assert.deepEqual(merged.variance.params["confidence_floor"], { value: 0.3, floor: 0, ceil: 1 });
});

test("resolveGates: reads the merged gate document", () => {
  const params = mergePolicyParams({ aqv: { gates: { minCases: 5 } } });
  assert.equal(resolveGates(params).minCases, 5);
});

test("getTunable: returns the param or undefined", () => {
  const params = cloneDefaultPolicyParams();
  assert.deepEqual(getTunable(params, "tone_threshold"), { value: 0.5, floor: 0, ceil: 1 });
  assert.equal(getTunable(params, "no_such_param"), undefined);
});

test("clampToBounds: clamps below floor, above ceil, leaves within", () => {
  const bounds = { floor: 0, ceil: 1 };
  assert.equal(clampToBounds(-0.2, bounds), 0);
  assert.equal(clampToBounds(1.4, bounds), 1);
  assert.equal(clampToBounds(0.6, bounds), 0.6);
});

test("InMemoryPolicyParamStore: defaults, override, and single-tunable write", async () => {
  const store = new InMemoryPolicyParamStore();
  assert.deepEqual(await store.get("ws_unknown"), DEFAULT_POLICY_PARAMS);

  store.setOverride("ws_1", { aqv: { gates: { qualityMin: 0.95 } } });
  assert.equal((await store.get("ws_1")).aqv.gates.qualityMin, 0.95);

  store.setTunable("ws_1", "tone_threshold", { value: 0.6, floor: 0, ceil: 1 });
  const resolved = await store.get("ws_1");
  // The single-tunable write must not clobber the earlier gate override.
  assert.equal(resolved.aqv.gates.qualityMin, 0.95);
  assert.equal(resolved.variance.params["tone_threshold"]!.value, 0.6);
});
