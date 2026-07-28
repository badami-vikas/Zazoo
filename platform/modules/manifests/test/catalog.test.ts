import assert from "node:assert/strict";
import test from "node:test";
import { BUILT_IN_MODULES, moduleNavTarget, requireBuiltInModule } from "../src/index.js";
import { canonicalizeManifest, parseModuleManifest } from "@bridge/core";

test("built-in Module catalog has one manifest per Module name", () => {
  const names = BUILT_IN_MODULES.map(({ manifest }) => manifest.name);
  assert.deepEqual(names, ["deal-pilot", "job-pilot", "relationship", "task-manager"]);
  assert.equal(new Set(names).size, names.length);
});

test("Task Manager is a signed installable Module with one Task Database and Agent-owned Skills", () => {
  const taskManager = requireBuiltInModule("task-manager").manifest;
  assert.equal(taskManager.module?.route, "/task-manager");
  assert.deepEqual(taskManager.module?.pages.map((page) => page.databaseId), ["task-manager.tasks"]);
  assert.equal(taskManager.module?.agents.length, 5);
  assert.ok(taskManager.module?.agents.find((agent) => agent.id === "chief-of-staff")?.skillIds.includes("task-manager.skill.agent-task-routing"));
  assert.ok(taskManager.module?.automations.every((automation) => Boolean(automation.agentId)));
  const normalized = parseModuleManifest({ module: taskManager });
  assert.equal(
    canonicalizeManifest(parseModuleManifest({ module: normalized })),
    canonicalizeManifest(normalized),
  );
  assert.deepEqual(normalized.module?.commonsNeeds, []);
});

test("Relationship exposes governed web research only through the Learning Agent", () => {
  const relationship = requireBuiltInModule("relationship").manifest;
  const webResearch = relationship.capabilities.find(
    (capability) => capability.id === "web-research",
  );
  assert.equal(webResearch?.capabilityType, "skill");
  assert.ok(
    webResearch?.permissions.some(
      (permission) =>
        permission.resourceType === "external:fetch" &&
        permission.action === "read" &&
        permission.dataScope === "public" &&
        permission.egress,
    ),
  );
  const consumers = relationship.module?.agents.filter((agent) =>
    agent.skillIds.includes("web-research"),
  );
  assert.deepEqual(consumers?.map((agent) => agent.id), ["learning-agent"]);
});

test("moduleNavTarget lands each Module on its primary data Page with a highlight base", () => {
  // Landing = the first Page's route (the buttons-at-top data section), NOT the
  // /module/:name capability inventory. Base = shared Page-route prefix so every
  // sibling Page highlights the same rail entry.
  assert.deepEqual(moduleNavTarget("deal-pilot"), {
    landing: "/dealpilot/deals",
    base: "/dealpilot",
  });
  assert.deepEqual(moduleNavTarget("relationship"), {
    landing: "/module/relationship/signals",
    base: "/module/relationship",
  });
  // Single-Page Modules land on (and highlight from) that one route.
  assert.deepEqual(moduleNavTarget("job-pilot"), { landing: "/jobpilot", base: "/jobpilot" });
  assert.deepEqual(moduleNavTarget("task-manager"), {
    landing: "/task-manager",
    base: "/task-manager",
  });
  // Landing is never the capability-inventory overview.
  for (const { manifest } of BUILT_IN_MODULES) {
    const nav = moduleNavTarget(manifest.name);
    assert.ok(nav);
    assert.notEqual(nav.landing, `/module/${manifest.name}`);
    assert.ok(nav.landing.startsWith(nav.base));
  }
  // Unknown / non-data Modules fall back (caller uses /module/:name instead).
  assert.equal(moduleNavTarget("interview-calendar-availability"), undefined);
  assert.equal(moduleNavTarget("does-not-exist"), undefined);
});

test("every built-in Module route is declared by its manifest", () => {
  for (const { manifest } of BUILT_IN_MODULES) {
    assert.ok(manifest.module);
    assert.ok(manifest.module.route.startsWith("/"));
    for (const page of manifest.module.pages) {
      assert.ok(page.route.startsWith(`${manifest.module.route.split("/").slice(0, -1).join("/")}/`));
    }
    assert.equal(requireBuiltInModule(manifest.name).manifest, manifest);
  }
});
