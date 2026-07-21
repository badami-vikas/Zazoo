import { test } from "node:test";
import assert from "node:assert/strict";
import { EchoModelProvider } from "@bridge/core";
import { createModelRouter } from "../src/router.js";
import type { ModelBinding } from "@bridge/tool-kit";

const localA = new EchoModelProvider("local-a", "local");
const localB = new EchoModelProvider("local-b", "local");
const cloudA = new EchoModelProvider("cloud-a", "cloud");
const cheapCloud = new EchoModelProvider("cheap-cloud", "cloud", ["cheap"]);
const reasoningCloud = new EchoModelProvider("reasoning-cloud", "cloud", ["reasoning"]);

function binding(partial: Partial<ModelBinding> & Pick<ModelBinding, "planeDefault">): ModelBinding {
  return { use: "llm", ...partial } as ModelBinding;
}

test("planeDefault local resolves a local provider", () => {
  const r = createModelRouter([cloudA, localA]);
  assert.equal(r.resolve(binding({ planeDefault: "local" }), "cheap").id, "local-a");
});

test("planeDefault local NEVER falls back to cloud (capture/sensor rule)", () => {
  const r = createModelRouter([cloudA]);
  assert.throws(() => r.resolve(binding({ planeDefault: "local" }), "cheap"), /LOCAL-plane/);
});

test("planeDefault cloud prefers cloud, honors provider hints", () => {
  const r = createModelRouter([localA, cloudA]);
  assert.equal(r.resolve(binding({ planeDefault: "cloud" }), "default").id, "cloud-a");
});

test("planeDefault cloud falls back to local when no cloud registered (privacy-safe direction)", () => {
  const r = createModelRouter([localA]);
  assert.equal(r.resolve(binding({ planeDefault: "cloud" }), "default").id, "local-a");
});

test("local hint picks the named local provider over registration order", () => {
  const r = createModelRouter([localA, localB]);
  const b = binding({ planeDefault: "local", providers: { local: "local-b" } });
  assert.equal(r.resolve(b, "cheap").id, "local-b");
});

test("cheap CoS work and reasoning work resolve by explicit tier, not registration order", () => {
  const r = createModelRouter([reasoningCloud, cheapCloud]);
  const b = binding({ planeDefault: "cloud" });
  assert.equal(r.resolve(b, "cheap").id, "cheap-cloud");
  assert.equal(r.resolve(b, "reasoning").id, "reasoning-cloud");
});

test("a tier mismatch fails instead of silently using an incapable provider", () => {
  const r = createModelRouter([cheapCloud]);
  assert.throws(() => r.resolve(binding({ planeDefault: "cloud" }), "reasoning"), /tier=reasoning/);
});

test("duplicate provider ids are rejected", () => {
  assert.throws(() => createModelRouter([localA, new EchoModelProvider("local-a", "local")]), /duplicate/);
});

test("no providers at all fails loud", () => {
  const r = createModelRouter([]);
  assert.throws(() => r.resolve(binding({ planeDefault: "cloud" }), "cheap"), /no provider/);
});
