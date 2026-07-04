import { test } from "node:test";
import assert from "node:assert/strict";
import { createBudgetLedger, createApiClientConnector } from "@bridge/sourcing";
import { createFactStore } from "@bridge/facts";
import { processJobCandidate } from "../src/pipeline.js";
import type { CandidateProfile } from "../src/types.js";

const candidate: CandidateProfile = { categories: ["data engineer"], skills: ["sql"], locations: ["remote"] };
const query = { kind: "company" as const, hints: { name: "Acme HVAC" } };

test("processJobCandidate: new posting (no existing match) sources, records facts, and scores fit", async () => {
  const connector = createApiClientConnector({
    id: "test-source",
    fetcher: async () => [{ company: "Acme HVAC", title: "Data Engineer", location: "Remote", isRemote: true }],
    confidenceOf: () => 0.9,
  });
  const ledger = createBudgetLedger(10);
  const facts = createFactStore();

  const result = await processJobCandidate(query, [connector], ledger, facts, "job_1", [], candidate);

  assert.equal(result.dedupedAgainst, null);
  assert.equal(result.alreadyAppliedToCompany, null);
  assert.equal(result.fit.flag, "green");
  assert.equal(facts.livingProfile("job_1").company?.value, "Acme HVAC");
});

test("processJobCandidate: identical company+title+location dedupes against the existing posting", async () => {
  const connector = createApiClientConnector({
    id: "test-source",
    fetcher: async () => [{ company: "Acme HVAC", title: "Data Engineer", location: "Remote" }],
    confidenceOf: () => 0.9,
  });
  const ledger = createBudgetLedger(10);
  const facts = createFactStore();
  const existing = [{ id: "job_existing", name: "Data Engineer", keyId: "acme hvac|data engineer|remote", blockingKey: "Acme HVAC" }];

  const result = await processJobCandidate(query, [connector], ledger, facts, "job_2", existing, candidate);

  assert.equal(result.dedupedAgainst, "job_existing");
});

test("processJobCandidate: different posting at a company already applied to flags alreadyAppliedToCompany", async () => {
  const connector = createApiClientConnector({
    id: "test-source",
    fetcher: async () => [{ company: "Acme HVAC", title: "Platform Engineer", location: "Remote" }],
    confidenceOf: () => 0.9,
  });
  const ledger = createBudgetLedger(10);
  const facts = createFactStore();
  const existing = [{ id: "job_prior", name: "Data Engineer", keyId: "acme hvac|data engineer|remote", blockingKey: "Acme HVAC" }];

  const result = await processJobCandidate(query, [connector], ledger, facts, "job_3", existing, candidate);

  assert.equal(result.dedupedAgainst, null);
  assert.equal(result.alreadyAppliedToCompany, "job_prior");
});
