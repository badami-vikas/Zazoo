import { test } from "node:test";
import assert from "node:assert/strict";
import { createBudgetLedger, createApiClientConnector } from "@bridge/sourcing";
import { createFactStore } from "@bridge/facts";
import { processDealCandidate } from "../src/pipeline.js";
import type { ThesisProfile } from "../src/types.js";

const thesis: ThesisProfile = { industries: ["HVAC"], geo: ["Texas"] };
const query = { kind: "company" as const, hints: { name: "Acme HVAC" } };

test("processDealCandidate: new deal (no existing match) sources, records facts, and scores fit", async () => {
  const connector = createApiClientConnector({
    id: "test_fixture_source",
    fetcher: async () => [{ name: "Acme HVAC", industry: "HVAC", geo: "Texas", domain: "acmehvac.com" }],
    confidenceOf: () => 0.9,
  });
  const ledger = createBudgetLedger(10);
  const facts = createFactStore();

  const result = await processDealCandidate(query, [connector], ledger, facts, "deal_1", [], thesis);

  assert.equal(result.dedupedAgainst, null);
  assert.equal(result.fit.triage, "green");
  assert.equal(facts.livingProfile("deal_1").industry?.value, "HVAC");
});

test("processDealCandidate: exact domain match against an existing deal dedupes instead of creating a new one", async () => {
  const connector = createApiClientConnector({
    id: "test_fixture_source",
    fetcher: async () => [{ name: "Acme HVAC Inc", industry: "HVAC", domain: "acmehvac.com" }],
    confidenceOf: () => 0.9,
  });
  const ledger = createBudgetLedger(10);
  const facts = createFactStore();
  const existing = [{ id: "deal_existing", name: "Acme HVAC Corp", domain: "acmehvac.com" }];

  const result = await processDealCandidate(query, [connector], ledger, facts, "deal_2", existing, thesis);

  assert.equal(result.dedupedAgainst, "deal_existing");
});
