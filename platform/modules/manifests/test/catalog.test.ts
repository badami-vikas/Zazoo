import assert from "node:assert/strict";
import test from "node:test";
import { BUILT_IN_MODULES, requireBuiltInModule } from "../src/index.js";

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
