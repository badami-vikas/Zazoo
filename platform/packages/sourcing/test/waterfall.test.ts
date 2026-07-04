import { test } from "node:test";
import assert from "node:assert/strict";
import { runWaterfall } from "../src/waterfall.js";
import { createBudgetLedger } from "../src/types.js";
import { createApiClientConnector } from "../src/connectors/api-client.js";
import { createEmailAlertConnector } from "../src/connectors/email-alert.js";

const query = { kind: "company" as const, hints: { name: "Acme" } };

test("runWaterfall: stops at the first tier that meets the confidence floor", async () => {
  const cheap = createApiClientConnector({ id: "api", fetcher: async () => [{ name: "Acme Corp" }], confidenceOf: () => 0.9 });
  const expensive = createApiClientConnector({ id: "fallback", fetcher: async () => [{ name: "Acme Corp (fallback)" }] });
  const ledger = createBudgetLedger(100);
  const result = await runWaterfall(query, [cheap, expensive], ledger);
  assert.equal(result.stoppedReason, "satisfied");
  assert.deepEqual(result.triedTiers, ["api"]);
});

test("runWaterfall: falls through to the next tier when confidence is too low", async () => {
  const weak = createApiClientConnector({ id: "weak", fetcher: async () => [{ name: "maybe" }], confidenceOf: () => 0.3 });
  const strong = createApiClientConnector({ id: "strong", fetcher: async () => [{ name: "confirmed" }], confidenceOf: () => 0.95 });
  const ledger = createBudgetLedger(100);
  const result = await runWaterfall(query, [weak, strong], ledger);
  assert.equal(result.stoppedReason, "satisfied");
  assert.deepEqual(result.triedTiers, ["weak", "strong"]);
});

test("runWaterfall: budget exhaustion skips connectors it cannot afford", async () => {
  const costly = createApiClientConnector({ id: "costly", fetcher: async () => [{ name: "x" }], costPerCall: 50, confidenceOf: () => 0.3 });
  const alsoCostly = createApiClientConnector({ id: "also-costly", fetcher: async () => [{ name: "y" }], costPerCall: 60, confidenceOf: () => 0.9 });
  const ledger = createBudgetLedger(50); // enough for one call, not both
  const result = await runWaterfall(query, [costly, alsoCostly], ledger);
  assert.ok(result.triedTiers.includes("also-costly(skipped:budget)"));
});

test("email-alert connector: unparseable messages are skipped, not fabricated into envelopes", async () => {
  const connector = createEmailAlertConnector({
    id: "bizbuysell-alerts",
    fetchMessages: async () => [{ subject: "New listing", body: "revenue: $500k" }, { subject: "Newsletter", body: "unrelated content" }],
    parse: (m) => (m.subject === "New listing" ? { revenue: 500000 } : null),
  });
  const envelopes = await connector.fetch(query);
  assert.equal(envelopes.length, 1);
  assert.equal(envelopes[0]?.payload.revenue, 500000);
});

test("BudgetLedger: reserve/settle round-trips and reserve fails over budget", () => {
  const ledger = createBudgetLedger(10);
  assert.equal(ledger.reserve(6), true);
  assert.equal(ledger.reserve(6), false); // would exceed 10 with the 6 already held
  ledger.settle(6, 4); // actual cost was lower than reserved
  assert.equal(ledger.remaining(), 6);
});
