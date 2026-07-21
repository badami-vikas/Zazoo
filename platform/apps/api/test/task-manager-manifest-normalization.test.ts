import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryModuleStore, canonicalizeManifest, parseModuleManifest } from "@bridge/core";
import { BUILT_IN_MODULES } from "../src/built-in-modules.js";
import { PILOT_ORGANIZATION, seedBuiltInModules } from "../src/wiring.js";

test("built-in Task Manager upgrade converges to the same canonical manifest Commons signs", async () => {
  const builtIn = BUILT_IN_MODULES.find((candidate) => candidate.manifest.name === "task-manager");
  assert.ok(builtIn);
  const store = new InMemoryModuleStore();
  const legacy = await store.create({
    organizationId: PILOT_ORGANIZATION,
    moduleName: builtIn.manifest.name,
    moduleVersion: builtIn.manifest.version,
    manifest: builtIn.manifest,
    computedRisk: builtIn.computedRisk,
    state: "available",
    status: "installed",
    lineageManifestId: null,
  });
  assert.equal(legacy.manifest.module?.commonsNeeds, undefined);
  await seedBuiltInModules(store, PILOT_ORGANIZATION);
  const normalized = await store.get(legacy.id);
  assert.ok(normalized);
  const expected = parseModuleManifest({ module: builtIn.manifest });
  assert.equal(canonicalizeManifest(normalized.manifest), canonicalizeManifest(expected));
  assert.deepEqual(normalized.manifest.module?.commonsNeeds, []);
});
