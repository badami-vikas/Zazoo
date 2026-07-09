import { test } from "node:test";
import assert from "node:assert/strict";
import { buildToolRegistry } from "@bridge/tool-kit";
import { dealPilotManifest } from "../src/manifest.js";
import { companySourcingManifest } from "@bridge/company-sourcing";
import { peopleSourcingManifest } from "@bridge/people-sourcing";
import { recorderManifest } from "@bridge/recorder";

test("manifest: kind external, has surfaces, no provides", () => {
  assert.equal(dealPilotManifest.kind, "external");
  assert.ok(dealPilotManifest.surfaces.some((s) => s.route === "/dealpilot"));
});

test("registry: dealpilot composes company-sourcing + people-sourcing + recorder cleanly (Phase 3 anchor)", () => {
  const registry = buildToolRegistry([companySourcingManifest, peopleSourcingManifest, recorderManifest, dealPilotManifest]);
  assert.equal(registry.internal().length, 3);
  assert.equal(registry.external().length, 1);
  const found = registry.get("dealpilot");
  assert.deepEqual(found?.kind === "external" ? found.composes : [], ["company-sourcing", "people-sourcing", "recorder"]);
});
