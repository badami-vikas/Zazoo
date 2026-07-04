import { test } from "node:test";
import assert from "node:assert/strict";
import type { GoogleGateway, GoogleGatewayFactory } from "@bridge/integrations-google";
import {
  parseBizBuySellAlert,
  createGmailFetchMessages,
  normalizeBusinessBrokerRow,
  createBizBuySellAlertConnector,
  createBusinessBrokerNetConnector,
} from "../src/connectors.js";

test("parseBizBuySellAlert: extracts fields from a labeled plain-text alert body", () => {
  const message = {
    subject: "New Listing Alert: Profitable HVAC Company",
    body: [
      "Business: Profitable HVAC Company",
      "Industry: HVAC / Home Services",
      "Location: Dallas, TX",
      "Asking Price: $850,000",
      "Gross Revenue: $600,000",
      "Cash Flow: $250,000",
      "View Listing: https://www.bizbuysell.com/Business-Opportunity/profitable-hvac/123456",
    ].join("\n"),
  };

  const payload = parseBizBuySellAlert(message);

  assert.deepEqual(payload, {
    name: "Profitable HVAC Company",
    industry: "HVAC / Home Services",
    geo: "Dallas, TX",
    askPrice: 850_000,
    revenue: 600_000,
    sde: 250_000,
    url: "https://www.bizbuysell.com/Business-Opportunity/profitable-hvac/123456",
  });
});

test("parseBizBuySellAlert: strips HTML tags/entities before extracting fields", () => {
  const message = {
    subject: "Business Alert: Coastal Laundromat",
    body: "<p>Asking Price:&nbsp;$1.2M</p><br><p>Location: Tampa, FL</p>",
  };

  const payload = parseBizBuySellAlert(message);

  assert.equal(payload?.askPrice, 1_200_000);
  assert.equal(payload?.geo, "Tampa, FL");
  assert.equal(payload?.name, "Coastal Laundromat");
});

test("parseBizBuySellAlert: falls back to subject when body has no title/business field", () => {
  const message = { subject: "Saved Search Alert: Auto Repair Shop", body: "Asking Price: $400,000" };
  const payload = parseBizBuySellAlert(message);
  assert.equal(payload?.name, "Auto Repair Shop");
  assert.equal(payload?.askPrice, 400_000);
});

test("parseBizBuySellAlert: returns null for a non-listing email (nothing parseable)", () => {
  const message = { subject: "Your BizBuySell account settings changed", body: "You updated your notification preferences." };
  assert.equal(parseBizBuySellAlert(message), null);
});

test("createGmailFetchMessages: composes the governed Google gateway, never owns OAuth", async () => {
  let capturedQuery: string | undefined;
  const fakeGateway: Pick<GoogleGateway, "fetchThreads"> = {
    fetchThreads: async (opts) => {
      capturedQuery = opts.query;
      return {
        threads: [
          {
            threadId: "t1",
            subject: "New Listing Alert: HVAC Co",
            participants: [],
            lastMessageAt: "2026-07-01T00:00:00Z",
            snippet: "",
            messages: [
              {
                messageId: "m1",
                from: { email: "alerts@bizbuysell.com" },
                to: [],
                date: "2026-07-01T00:00:00Z",
                subject: "New Listing Alert: HVAC Co",
                bodyText: "Asking Price: $500,000",
              },
            ],
          },
        ],
      };
    },
  };
  const gateways: GoogleGatewayFactory = { forIntegration: async () => fakeGateway as GoogleGateway };

  const fetchMessages = createGmailFetchMessages(gateways, "integration_1");
  const messages = await fetchMessages({ kind: "company", hints: {} });

  assert.equal(messages.length, 1);
  assert.equal(messages[0]!.subject, "New Listing Alert: HVAC Co");
  assert.match(capturedQuery ?? "", /bizbuysell\.com/);
});

test("createBizBuySellAlertConnector: end-to-end fetch -> parse -> CaptureEnvelope, using the real parser by default", async () => {
  const connector = createBizBuySellAlertConnector(async () => [
    { subject: "New Listing Alert: Deli", body: "Asking Price: $300,000\nLocation: Austin, TX" },
  ]);

  const envelopes = await connector.fetch({ kind: "company", hints: {} });

  assert.equal(envelopes.length, 1);
  assert.equal(envelopes[0]!.payload.name, "Deli");
  assert.equal(envelopes[0]!.payload.askPrice, 300_000);
});

test("normalizeBusinessBrokerRow: maps varied broker-feed key aliases onto DealPilot's payload shape", () => {
  const row = {
    businessName: "Riverside Car Wash",
    businessType: "Automotive",
    city: "Portland, OR",
    askingPrice: "$725,000",
    grossRevenue: 410_000,
    cashflow: "$180,500",
  };

  assert.deepEqual(normalizeBusinessBrokerRow(row), {
    name: "Riverside Car Wash",
    industry: "Automotive",
    geo: "Portland, OR",
    askPrice: 725_000,
    revenue: 410_000,
    sde: 180_500,
  });
});

test("normalizeBusinessBrokerRow: drops missing/empty fields rather than emitting undefined", () => {
  assert.deepEqual(normalizeBusinessBrokerRow({ name: "Empty Co", price: "" }), { name: "Empty Co" });
});

test("createBusinessBrokerNetConnector: confidence scales with how many core fields were populated", async () => {
  const connector = createBusinessBrokerNetConnector(async () => [
    { name: "Full Co", askPrice: 100, revenue: 200, sde: 50 },
    { name: "Thin Co" },
  ]);

  const envelopes = await connector.fetch({ kind: "company", hints: {} });

  assert.equal(envelopes[0]!.confidence, 0.9);
  assert.equal(envelopes[1]!.confidence, 0.6);
});
