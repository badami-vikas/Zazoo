import { test } from "node:test";
import assert from "node:assert/strict";
import { createBudgetLedger, createApiClientConnector } from "@bridge/sourcing";
import { createFactStore } from "@bridge/facts";
import { buildExecutableRegistry } from "@bridge/capability-kit";
import { companySourcingManifest } from "../src/manifest.js";
import { sourceCompany, matchCompany } from "../src/engine.js";
import { peopleSourcingManifest } from "@bridge/people-sourcing";

test("manifest: kind internal, provides source.company", () => {
  assert.equal(companySourcingManifest.kind, "skill");
  assert.ok(companySourcingManifest.provides.some((p) => p.id === "source.company"));
});

test("sourceCompany: waterfall result gets recorded into the entity's living profile", async () => {
  const connector = createApiClientConnector({ id: "test_fixture_registry", fetcher: async () => [{ revenue: 500000 }], confidenceOf: () => 0.9 });
  const ledger = createBudgetLedger(10);
  const facts = createFactStore();
  await sourceCompany({ kind: "company", hints: { name: "Acme" } }, [connector], ledger, facts, "deal_1");
  assert.equal(facts.livingProfile("deal_1").revenue?.value, 500000);
});

test("matchCompany: delegates to shared dedupe with domain+industry as corroborating fields", () => {
  const result = matchCompany(
    { id: "c1", name: "Acme Inc", domain: "acme.com" },
    [{ id: "t1", name: "Acme Corp", domain: "acme.com" }],
  );
  assert.equal(result.tier, "strong");
});

test("cross-Module registry: both sourcing Engines register clean and a DealPilot-shaped external composes both", () => {
  const dealpilot = {
    id: "dealpilot",
    name: "DealPilot",
    version: "0.1.0",
    kind: "module" as const,
    runModes: ["account_bound" as const],
    surfaces: [{ route: "/dealpilot", nav: "Work" }],
    skillDependencies: ["people-sourcing", "company-sourcing"],
    intakePolicy: { quarantine: true as const, commitVia: "pipeline_proposal" as const, scope: "public" as const },
  };
  const registry = buildExecutableRegistry([peopleSourcingManifest, companySourcingManifest, dealpilot]);
  assert.equal(registry.skills().length, 2);
  assert.equal(registry.get("dealpilot")?.id, "dealpilot");
});
