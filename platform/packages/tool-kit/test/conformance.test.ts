import { test } from "node:test";
import assert from "node:assert/strict";
import { buildToolRegistry, ToolRegistryError, parseToolManifest } from "../src/index.js";

const peopleSourcing = {
  id: "people-sourcing",
  name: "People Sourcing",
  version: "0.1.0",
  kind: "internal" as const,
  runModes: ["account_bound" as const],
  provides: [{ id: "source.people", input: "SourceQuery", output: "CaptureEnvelope[]" }],
  capabilities: [{ resourceType: "external:fetch", action: "read" as const, dataScope: "public" as const, egress: true }],
  intakePolicy: { quarantine: true as const, commitVia: "pipeline_proposal" as const, scope: "public" as const },
};

const dealPilot = {
  id: "dealpilot",
  name: "DealPilot",
  version: "0.1.0",
  kind: "external" as const,
  runModes: ["account_bound" as const],
  surfaces: [{ route: "/dealpilot", nav: "Work" }],
  composes: ["people-sourcing"],
  intakePolicy: { quarantine: true as const, commitVia: "pipeline_proposal" as const, scope: "public" as const },
};

test("internal manifest with no `provides` is rejected", () => {
  assert.throws(() =>
    parseToolManifest({ ...peopleSourcing, provides: [] }),
  );
});

test("external manifest with no `surfaces` is rejected", () => {
  assert.throws(() =>
    parseToolManifest({ ...dealPilot, surfaces: [] }),
  );
});

test("intake_policy.quarantine must be true — structural, not optional (mirrors agent-floor: capture never bypasses review)", () => {
  assert.throws(() =>
    parseToolManifest({ ...peopleSourcing, intakePolicy: { ...peopleSourcing.intakePolicy, quarantine: false } }),
  );
});

test("registry builds from manifests, internal/external filters work", () => {
  const registry = buildToolRegistry([peopleSourcing, dealPilot]);
  assert.equal(registry.all().length, 2);
  assert.equal(registry.internal().length, 1);
  assert.equal(registry.external().length, 1);
  assert.equal(registry.get("dealpilot")?.id, "dealpilot");
});

test("duplicate tool id throws", () => {
  assert.throws(() => buildToolRegistry([peopleSourcing, peopleSourcing]), ToolRegistryError);
});

test("external tool composing an unknown internal tool throws (compose, don't copy — must resolve)", () => {
  const orphan = { ...dealPilot, composes: ["does-not-exist"] };
  assert.throws(() => buildToolRegistry([peopleSourcing, orphan]), ToolRegistryError);
});

test("recon decomposition round-trip: company-sourcing + dealpilot composing it registers clean", () => {
  const companySourcing = { ...peopleSourcing, id: "company-sourcing", name: "Company Sourcing" };
  const registry = buildToolRegistry([peopleSourcing, companySourcing, { ...dealPilot, composes: ["people-sourcing", "company-sourcing"] }]);
  assert.equal(registry.internal().length, 2);
  const found = registry.get("dealpilot");
  assert.deepEqual(found?.kind === "external" ? found.composes : [], ["people-sourcing", "company-sourcing"]);
});
