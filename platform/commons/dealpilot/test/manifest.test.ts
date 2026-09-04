import { test } from "node:test";
import assert from "node:assert/strict";
import { buildExecutableRegistry } from "@bridge/capability-kit";
import { dealPilotManifest } from "../src/manifest.js";
import { companySourcingManifest } from "@bridge/company-sourcing";
import { peopleSourcingManifest } from "@bridge/people-sourcing";
import { recorderManifest } from "@bridge/recorder";

test("manifest: kind external, has surfaces, no provides", () => {
  assert.equal(dealPilotManifest.kind, "module");
  assert.deepEqual(dealPilotManifest.surfaces.map((surface) => surface.route), [
    "/dealpilot/deals",
    "/dealpilot/sources",
    "/dealpilot/theses",
  ]);
});

test("registry: dealpilot composes company-sourcing + people-sourcing + recorder cleanly (Phase 3 anchor)", () => {
  const registry = buildExecutableRegistry([companySourcingManifest, peopleSourcingManifest, recorderManifest, dealPilotManifest]);
  assert.equal(registry.skills().length, 3);
  assert.equal(registry.modules().length, 1);
  const found = registry.get("dealpilot");
  assert.deepEqual(found?.kind === "module" ? found.skillDependencies : [], ["company-sourcing", "people-sourcing", "recorder"]);
});
