import { test } from "node:test";
import assert from "node:assert/strict";
import { buildToolRegistry } from "@bridge/tool-kit";
import { jobPilotManifest } from "../src/manifest.js";
import { companySourcingManifest } from "@bridge/company-sourcing";
import { peopleSourcingManifest } from "@bridge/people-sourcing";

test("manifest: kind external, has surfaces, no provides", () => {
  assert.equal(jobPilotManifest.kind, "external");
  assert.ok(jobPilotManifest.surfaces.some((s) => s.route === "/jobpilot"));
});

test("registry: jobpilot composes company-sourcing + people-sourcing cleanly (Phase 4 anchor)", () => {
  const registry = buildToolRegistry([companySourcingManifest, peopleSourcingManifest, jobPilotManifest]);
  assert.equal(registry.internal().length, 2);
  assert.equal(registry.external().length, 1);
  const found = registry.get("jobpilot");
  assert.deepEqual(found?.kind === "external" ? found.composes : [], ["company-sourcing", "people-sourcing"]);
});
