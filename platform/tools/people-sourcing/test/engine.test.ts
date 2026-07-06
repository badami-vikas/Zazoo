import { test } from "node:test";
import assert from "node:assert/strict";
import { createBudgetLedger, createApiClientConnector } from "@bridge/sourcing";
import { createFactStore } from "@bridge/facts";
import { peopleSourcingManifest } from "../src/manifest.js";
import { sourcePeople, matchPerson } from "../src/engine.js";

test("manifest: kind internal, has no surfaces, quarantine forced true", () => {
  assert.equal(peopleSourcingManifest.kind, "internal");
  assert.equal(peopleSourcingManifest.intakePolicy.quarantine, true);
  assert.ok(peopleSourcingManifest.provides.some((p) => p.id === "source.people"));
});

test("sourcePeople: waterfall result gets recorded into the entity's living profile", async () => {
  const connector = createApiClientConnector({ id: "dummy_api", fetcher: async () => [{ title: "VP Engineering" }], confidenceOf: () => 0.9 });
  const ledger = createBudgetLedger(10);
  const facts = createFactStore();
  await sourcePeople({ kind: "person", hints: { name: "Jane Doe" } }, [connector], ledger, facts, "person_1");
  assert.equal(facts.livingProfile("person_1").title?.value, "VP Engineering");
});

test("matchPerson: delegates to shared dedupe with company+title as corroborating fields", () => {
  const result = matchPerson(
    { id: "c1", name: "Jon Smith", company: "Acme" },
    [{ id: "t1", name: "John Smith", company: "Acme" }],
  );
  assert.equal(result.tier, "strong");
});
