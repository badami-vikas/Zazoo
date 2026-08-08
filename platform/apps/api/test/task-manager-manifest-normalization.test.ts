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

test("built-in Task Manager publishes create-task as a new immutable version", async () => {
  const builtIn = BUILT_IN_MODULES.find((candidate) => candidate.manifest.name === "task-manager");
  assert.ok(builtIn);
  // 1.3.0: ADR-201 gives Chief of Staff a runtime Agent identity, and
  // `standup-brief`/`stale-task-review` gain runtime Automation ids. Pinned
  // deliberately so a manifest change cannot land without someone choosing
  // the version it ships under.
  assert.equal(builtIn.manifest.version, "1.3.0");
  const createTaskCapability = "task-manager.skill.create-task";
  const previousManifest = parseModuleManifest({
    module: {
      ...builtIn.manifest,
      version: "1.0.2",
      capabilities: builtIn.manifest.capabilities
        .filter((capability) => capability.id !== createTaskCapability)
        .map((capability) => ({
          ...capability,
          dependencies: capability.dependencies.filter(
            (dependency) => dependency.manifestId !== createTaskCapability,
          ),
        })),
      module: {
        ...builtIn.manifest.module!,
        agents: builtIn.manifest.module!.agents.map((agent) => ({
          ...agent,
          skillIds: agent.skillIds.filter((skillId) => skillId !== createTaskCapability),
        })),
      },
    },
  });
  const store = new InMemoryModuleStore();
  const previous = await store.create({
    organizationId: PILOT_ORGANIZATION,
    moduleName: previousManifest.name,
    moduleVersion: previousManifest.version,
    manifest: previousManifest,
    computedRisk: builtIn.computedRisk,
    state: "available",
    status: "installed",
    lineageManifestId: null,
  });

  await seedBuiltInModules(store, PILOT_ORGANIZATION);

  assert.equal((await store.get(previous.id))?.state, "legacy");
  const upgraded = await store.getAvailable(PILOT_ORGANIZATION, "task-manager");
  assert.equal(upgraded?.moduleVersion, "1.3.0");
  assert.ok(
    upgraded?.manifest.capabilities.some(
      (capability) => capability.id === createTaskCapability,
    ),
  );
});
