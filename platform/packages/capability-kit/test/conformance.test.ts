import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildExecutableRegistry,
  ExecutableRegistryError,
  parseExecutableManifest,
} from "../src/index.js";

const peopleSourcing = {
  id: "people-sourcing",
  name: "People Sourcing",
  version: "0.1.0",
  kind: "skill" as const,
  runModes: ["account_bound" as const],
  provides: [{ id: "source.people", input: "SourceQuery", output: "CaptureEnvelope[]" }],
  capabilities: [{ resourceType: "external:fetch", action: "read" as const, dataScope: "public" as const, egress: true }],
  intakePolicy: { quarantine: true as const, commitVia: "pipeline_proposal" as const, scope: "public" as const },
};

const dealPilot = {
  id: "dealpilot",
  name: "DealPilot",
  version: "0.1.0",
  kind: "module" as const,
  runModes: ["account_bound" as const],
  surfaces: [{ route: "/dealpilot", nav: "Work" }],
  skillDependencies: ["people-sourcing"],
  intakePolicy: { quarantine: true as const, commitVia: "pipeline_proposal" as const, scope: "public" as const },
};

test("Skill executable manifest with no `provides` is rejected", () => {
  assert.throws(() =>
    parseExecutableManifest({ ...peopleSourcing, provides: [] }),
  );
});

test("Module executable manifest with no `surfaces` is rejected", () => {
  assert.throws(() =>
    parseExecutableManifest({ ...dealPilot, surfaces: [] }),
  );
});

test("intake_policy.quarantine must be true — structural, not optional (mirrors agent-floor: capture never bypasses review)", () => {
  assert.throws(() =>
    parseExecutableManifest({ ...peopleSourcing, intakePolicy: { ...peopleSourcing.intakePolicy, quarantine: false } }),
  );
});

test("registry builds from manifests and classifies Skills and Modules", () => {
  const registry = buildExecutableRegistry([peopleSourcing, dealPilot]);
  assert.equal(registry.all().length, 2);
  assert.equal(registry.skills().length, 1);
  assert.equal(registry.modules().length, 1);
  assert.equal(registry.get("dealpilot")?.id, "dealpilot");
});

test("duplicate executable id throws", () => {
  assert.throws(
    () => buildExecutableRegistry([peopleSourcing, peopleSourcing]),
    ExecutableRegistryError,
  );
});

test("Module referencing an unknown Skill fails closed", () => {
  const orphan = { ...dealPilot, skillDependencies: ["does-not-exist"] };
  assert.throws(
    () => buildExecutableRegistry([peopleSourcing, orphan]),
    ExecutableRegistryError,
  );
});

test("Module Skill dependencies resolve through the executable registry", () => {
  const companySourcing = { ...peopleSourcing, id: "company-sourcing", name: "Company Sourcing" };
  const registry = buildExecutableRegistry([peopleSourcing, companySourcing, {
    ...dealPilot,
    skillDependencies: ["people-sourcing", "company-sourcing"],
  }]);
  assert.equal(registry.skills().length, 2);
  const found = registry.get("dealpilot");
  assert.deepEqual(found?.kind === "module" ? found.skillDependencies : [], [
    "people-sourcing",
    "company-sourcing",
  ]);
});
