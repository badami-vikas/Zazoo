import { test } from "node:test";
import assert from "node:assert/strict";
import { createGreenhouseConnector, createAshbyConnector, createLeverConnector } from "../src/connectors.js";

// Pins the externally observable behavior of all 3 Tier-1 ATS connectors now that they share one
// parameterized factory (createAtsConnector) instead of 3 copy-pasted createApiClientConnector
// calls. Each connector must still: carry its own `id`, cost nothing per call (public unauthenticated
// JSON endpoints), report the fixed 0.95 confidence for every row, and pass query/rows through to
// the injected fetcher untouched — i.e. identical to what the old per-connector copies produced.

const dummyRows = [{ dummy_title: "Software Engineer" }, { dummy_title: "Product Manager" }];

async function assertConnectorBehavior(
  createConnector: (fetcher: (query: any) => Promise<Array<Record<string, unknown>>>) => any,
  expectedId: string,
) {
  const calls: any[] = [];
  const fetcher = async (query: any) => {
    calls.push(query);
    return dummyRows;
  };

  const connector = createConnector(fetcher);

  assert.equal(connector.id, expectedId);
  assert.equal(connector.tier, "free");
  assert.equal(connector.estimateCost({ kind: "company", hints: {} }), 0);

  const query = { kind: "company", hints: { name: "dummy_acme" } };
  const envelopes = await connector.fetch(query);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], query);

  assert.equal(envelopes.length, dummyRows.length);
  for (let i = 0; i < envelopes.length; i++) {
    const envelope = envelopes[i];
    assert.equal(envelope.sourceToolId, expectedId);
    assert.equal(envelope.tier, "free");
    assert.deepEqual(envelope.query, query);
    assert.deepEqual(envelope.payload, dummyRows[i]);
    assert.equal(envelope.confidence, 0.95);
    assert.equal(envelope.costUnits, 0);
    assert.equal(typeof envelope.capturedAt, "string");
  }
}

test("createGreenhouseConnector: id=greenhouse, free tier, zero cost, 0.95 confidence, passes query/rows through", async () => {
  await assertConnectorBehavior(createGreenhouseConnector, "greenhouse");
});

test("createAshbyConnector: id=ashby, free tier, zero cost, 0.95 confidence, passes query/rows through", async () => {
  await assertConnectorBehavior(createAshbyConnector, "ashby");
});

test("createLeverConnector: id=lever, free tier, zero cost, 0.95 confidence, passes query/rows through", async () => {
  await assertConnectorBehavior(createLeverConnector, "lever");
});
