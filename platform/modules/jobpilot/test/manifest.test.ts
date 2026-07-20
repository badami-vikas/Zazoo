import { test } from "node:test";
import assert from "node:assert/strict";
import { buildExecutableRegistry } from "@bridge/capability-kit";
import { jobPilotManifest } from "../src/manifest.js";
import { companySourcingManifest } from "@bridge/company-sourcing";
import { peopleSourcingManifest } from "@bridge/people-sourcing";

test("manifest: kind external, has surfaces, no provides", () => {
  assert.equal(jobPilotManifest.kind, "module");
  assert.ok(jobPilotManifest.surfaces.some((s) => s.route === "/jobpilot"));
});

test("registry: jobpilot composes company-sourcing + people-sourcing cleanly (Phase 4 anchor)", () => {
  const registry = buildExecutableRegistry([companySourcingManifest, peopleSourcingManifest, jobPilotManifest]);
  assert.equal(registry.skills().length, 2);
  assert.equal(registry.modules().length, 1);
  const found = registry.get("jobpilot");
  assert.deepEqual(found?.kind === "module" ? found.skillDependencies : [], ["company-sourcing", "people-sourcing"]);
});
