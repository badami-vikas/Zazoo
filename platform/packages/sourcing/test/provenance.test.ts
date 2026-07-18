import { test } from "node:test";
import assert from "node:assert/strict";
import { createApiClientConnector } from "../src/connectors/api-client.js";
import { createEmailAlertConnector } from "../src/connectors/email-alert.js";

const query = { kind: "company" as const, hints: { name: "Acme" } };

// PI-1: content fetched from outside is UNTRUSTED at the ingestion edge. A scraped
// page / external API row lands tagged `untrusted_external` end-to-end.
test("api-client connector tags every envelope untrusted_external (PI-1)", async () => {
  const connector = createApiClientConnector({ id: "api", fetcher: async () => [{ name: "Acme Corp" }, { name: "Acme Inc" }] });
  const envelopes = await connector.fetch(query);
  assert.equal(envelopes.length, 2);
  for (const e of envelopes) assert.equal(e.trustOrigin, "untrusted_external");
});

test("email-alert connector tags every parsed envelope untrusted_external (PI-1)", async () => {
  const connector = createEmailAlertConnector({
    id: "email",
    fetchMessages: async () => [{ id: "provider-message-1", subject: "Match", body: "Acme is for sale" }],
    parse: (m) => ({ headline: m.subject }),
  });
  const envelopes = await connector.fetch(query);
  assert.equal(envelopes.length, 1);
  assert.equal(envelopes[0]?.trustOrigin, "untrusted_external");
  assert.equal(envelopes[0]?.sourceRecordId, "provider-message-1");
});
