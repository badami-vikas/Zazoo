import { test } from "node:test";
import assert from "node:assert/strict";
import type { GoogleGateway, GoogleGatewayFactory } from "@bridge/integrations-google";
import {
  parseBizBuySellAlert,
  parseBizBuySellAlertBatch,
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
                receivedAt: "2026-07-01T00:00:00Z",
                date: "2020-01-01T00:00:00Z",
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
  const messages = await fetchMessages({
    kind: "company",
    hints: { sourceId: "test_fixture_source", after: "2026-06-30T00:00:00.000Z" },
  });
  await fetchMessages.acknowledge?.("test_fixture_source");
  const repeated = await fetchMessages({
    kind: "company",
    hints: { sourceId: "test_fixture_source", after: "2026-06-30T00:00:00.000Z" },
  });
  await fetchMessages.acknowledge?.("test_fixture_source");

  assert.equal(messages.length, 1);
  assert.equal(messages[0]!.id, "m1");
  assert.equal(messages[0]!.subject, "New Listing Alert: HVAC Co");
  assert.match(capturedQuery ?? "", /bizbuysell\.com/);
  assert.match(capturedQuery ?? "", /after:\d+/);
  assert.equal(repeated.length, 0);
});

test("createGmailFetchMessages: resumes a budget-limited backlog without advancing past it", async () => {
  const pageTokens: Array<string | undefined> = [];
  const thread = (id: string, date: string, sender = "alerts@bizbuysell.com") => ({
    threadId: `thread_${id}`,
    subject: `New Listing Alert: ${id}`,
    participants: [],
    lastMessageAt: date,
    snippet: "",
    messages: [
      {
        messageId: id,
        from: { email: sender },
        to: [],
        receivedAt: date,
        date,
        subject: `New Listing Alert: ${id}`,
        bodyText: "Asking Price: $500,000",
      },
    ],
  });
  const fakeGateway: Pick<GoogleGateway, "fetchThreads"> = {
    fetchThreads: async (opts) => {
      pageTokens.push(opts.pageToken);
      return opts.pageToken
        ? { threads: [thread("m2", "2026-07-02T00:00:00Z")] }
        : {
            threads: [
              thread("old", "2026-06-29T00:00:00Z"),
              thread("reply", "2026-07-01T12:00:00Z", "test_fixture_user@example.com"),
              thread("m1", "2026-07-01T00:00:00Z"),
            ],
            nextPageToken: "page-2",
          };
    },
  };
  const gateways: GoogleGatewayFactory = { forIntegration: async () => fakeGateway as GoogleGateway };
  const fetchMessages = createGmailFetchMessages(gateways, "integration_1");
  const query = {
    kind: "company" as const,
    hints: {
      sourceId: "test_fixture_source",
      after: "2026-06-30T00:00:00.000Z",
      maxResults: "1",
      scanStartedAt: "2026-07-01T08:00:00.000Z",
    },
  };

  const first = await fetchMessages(query);
  const firstComplete = fetchMessages.lastFetchComplete?.("test_fixture_source");
  await fetchMessages.acknowledge?.("test_fixture_source");
  const second = await fetchMessages(query);
  await fetchMessages.acknowledge?.("test_fixture_source");

  assert.deepEqual(first.map((message) => message.id), ["m1"]);
  assert.equal(firstComplete, false);
  assert.deepEqual(second.map((message) => message.id), ["m2"]);
  assert.equal(fetchMessages.lastFetchComplete?.("test_fixture_source"), true);
  assert.deepEqual(pageTokens, [undefined, "page-2"]);
});

test("createGmailFetchMessages: an incomplete provider page retains the Source checkpoint", async () => {
  const fakeGateway: Pick<GoogleGateway, "fetchThreads"> = {
    fetchThreads: async () => ({
      incomplete: true,
      threads: [
        {
          threadId: "thread_m1",
          subject: "New Listing Alert: m1",
          participants: [],
          lastMessageAt: "2026-07-01T00:00:00Z",
          snippet: "",
          messages: [
            {
              messageId: "m1",
              from: { email: "alerts@bizbuysell.com" },
              to: [],
              receivedAt: "2026-07-01T00:00:00Z",
              date: "2026-07-01T00:00:00Z",
              subject: "New Listing Alert: m1",
              bodyText: "Asking Price: $500,000",
            },
          ],
        },
      ],
    }),
  };
  const gateways: GoogleGatewayFactory = { forIntegration: async () => fakeGateway as GoogleGateway };
  const fetchMessages = createGmailFetchMessages(gateways, "integration_1");

  const messages = await fetchMessages({
    kind: "company",
    hints: { sourceId: "test_fixture_source", after: "2026-06-30T00:00:00.000Z" },
  });

  assert.deepEqual(messages.map((message) => message.id), ["m1"]);
  assert.equal(fetchMessages.lastFetchComplete?.("test_fixture_source"), false);
  await fetchMessages.discard?.("test_fixture_source");
});

test("createGmailFetchMessages: a later-page failure does not acknowledge earlier messages", async () => {
  let failLaterPage = true;
  const thread = (id: string) => ({
    threadId: `thread_${id}`,
    subject: `New Listing Alert: ${id}`,
    participants: [],
    lastMessageAt: "2026-07-01T00:00:00Z",
    snippet: "",
    messages: [
      {
        messageId: id,
        from: { email: "alerts@bizbuysell.com" },
        to: [],
        receivedAt: "2026-07-01T00:00:00Z",
        date: "2026-07-01T00:00:00Z",
        subject: `New Listing Alert: ${id}`,
        bodyText: "Asking Price: $500,000",
      },
    ],
  });
  const fakeGateway: Pick<GoogleGateway, "fetchThreads"> = {
    fetchThreads: async (opts) => {
      if (!opts.pageToken) return { threads: [thread("m1")], nextPageToken: "page-2" };
      if (failLaterPage) throw new Error("test_fixture_later_page_failure");
      return { threads: [thread("m2")] };
    },
  };
  const gateways: GoogleGatewayFactory = { forIntegration: async () => fakeGateway as GoogleGateway };
  const fetchMessages = createGmailFetchMessages(gateways, "integration_1");
  const query = {
    kind: "company" as const,
    hints: { sourceId: "test_fixture_source", after: "2026-06-30T00:00:00.000Z" },
  };

  await assert.rejects(fetchMessages(query), /test_fixture_later_page_failure/);
  failLaterPage = false;
  const retry = await fetchMessages(query);

  assert.deepEqual(retry.map((message) => message.id), ["m1", "m2"]);
  await fetchMessages.acknowledge?.("test_fixture_source");
});

test("createGmailFetchMessages: provider page calls are capped and resume from continuation", async () => {
  let calls = 0;
  const fakeGateway: Pick<GoogleGateway, "fetchThreads"> = {
    fetchThreads: async (opts) => {
      calls += 1;
      const page = opts.pageToken ? Number(opts.pageToken.slice("page-".length)) : 1;
      if (page < 6) {
        return {
          threads: [
            {
              threadId: `thread_reply_${page}`,
              subject: "test_fixture_reply",
              participants: [],
              lastMessageAt: "2026-07-01T00:00:00Z",
              snippet: "",
              messages: [
                {
                  messageId: `reply_${page}`,
                  from: { email: "test_fixture_user@example.com" },
                  to: [],
                  receivedAt: "2026-07-01T00:00:00Z",
                  date: "2026-07-01T00:00:00Z",
                  subject: "test_fixture_reply",
                  bodyText: "test_fixture_reply",
                },
              ],
            },
          ],
          nextPageToken: `page-${page + 1}`,
        };
      }
      return {
        threads: [
          {
            threadId: "thread_m6",
            subject: "New Listing Alert: m6",
            participants: [],
            lastMessageAt: "2026-07-01T00:00:00Z",
            snippet: "",
            messages: [
              {
                messageId: "m6",
                from: { email: "alerts@bizbuysell.com" },
                to: [],
                receivedAt: "2026-07-01T00:00:00Z",
                date: "2026-07-01T00:00:00Z",
                subject: "New Listing Alert: m6",
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
  const query = {
    kind: "company" as const,
    hints: {
      sourceId: "test_fixture_source",
      after: "2026-06-30T00:00:00.000Z",
      maxResults: "1",
      scanStartedAt: "2026-07-01T08:00:00.000Z",
    },
  };

  const first = await fetchMessages(query);
  assert.deepEqual(first, []);
  assert.equal(calls, 5);
  assert.equal(fetchMessages.lastFetchComplete?.("test_fixture_source"), false);
  await fetchMessages.acknowledge?.("test_fixture_source");
  const second = await fetchMessages({
    ...query,
    hints: { ...query.hints, scanStartedAt: "2026-07-03T08:00:00.000Z" },
  });

  assert.deepEqual(second.map((message) => message.id), ["m6"]);
  assert.equal(calls, 6);
  assert.equal(fetchMessages.lastFetchComplete?.("test_fixture_source"), true);
  assert.equal(fetchMessages.lastCheckpointAt?.("test_fixture_source"), "2026-07-01T08:00:00.000Z");
  await fetchMessages.acknowledge?.("test_fixture_source");
});

test("createGmailFetchMessages: rejects repeated provider page tokens", async () => {
  const fakeGateway: Pick<GoogleGateway, "fetchThreads"> = {
    fetchThreads: async (opts) => ({
      threads: [],
      nextPageToken: opts.pageToken ?? "repeated",
    }),
  };
  const gateways: GoogleGatewayFactory = { forIntegration: async () => fakeGateway as GoogleGateway };
  const fetchMessages = createGmailFetchMessages(gateways, "integration_1");

  await assert.rejects(
    fetchMessages({
      kind: "company",
      hints: { sourceId: "test_fixture_source" },
    }),
    /repeated page token/,
  );
});

test("createGmailFetchMessages: rejects page-token cycles that cross continuation runs", async () => {
  const nextToken: Record<string, string> = {
    "__first_page__": "A",
    A: "B",
    B: "C",
    C: "D",
    D: "E",
    E: "F",
    F: "A",
  };
  const fakeGateway: Pick<GoogleGateway, "fetchThreads"> = {
    fetchThreads: async (opts) => ({
      threads: [],
      nextPageToken: nextToken[opts.pageToken ?? "__first_page__"]!,
    }),
  };
  const gateways: GoogleGatewayFactory = { forIntegration: async () => fakeGateway as GoogleGateway };
  const fetchMessages = createGmailFetchMessages(gateways, "integration_1");
  const query = {
    kind: "company" as const,
    hints: { sourceId: "test_fixture_source", maxResults: "1" },
  };

  await fetchMessages(query);
  await fetchMessages.acknowledge?.("test_fixture_source");

  await assert.rejects(fetchMessages(query), /repeated page token/);
});

test("createGmailFetchMessages: a failed saved continuation restarts from the first page", async () => {
  const tokens: Array<string | undefined> = [];
  let mode: "paginate" | "invalid" | "restart" = "paginate";
  const fakeGateway: Pick<GoogleGateway, "fetchThreads"> = {
    fetchThreads: async (opts) => {
      tokens.push(opts.pageToken);
      if (mode === "invalid") throw new Error("test_fixture_invalid_page_token");
      if (mode === "restart") return { threads: [] };
      const page = opts.pageToken ? Number(opts.pageToken.slice("page-".length)) : 1;
      return {
        threads: [],
        nextPageToken: `page-${page + 1}`,
      };
    },
  };
  const gateways: GoogleGatewayFactory = { forIntegration: async () => fakeGateway as GoogleGateway };
  const fetchMessages = createGmailFetchMessages(gateways, "integration_1");
  const query = {
    kind: "company" as const,
    hints: { sourceId: "test_fixture_source", maxResults: "1" },
  };

  await fetchMessages(query);
  await fetchMessages.acknowledge?.("test_fixture_source");
  mode = "invalid";
  await assert.rejects(fetchMessages(query), /test_fixture_invalid_page_token/);
  mode = "restart";
  await fetchMessages(query);

  assert.deepEqual(tokens, [undefined, "page-2", "page-3", "page-4", "page-5", "page-6", undefined]);
  await fetchMessages.acknowledge?.("test_fixture_source");
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

// -------------------------------------------------------------------------------------------
// Parse-null-rate metric — guards against BizBuySell template drift silently zeroing results.
// -------------------------------------------------------------------------------------------

function withConsoleWarnSpy<T>(fn: () => T): { result: T; warnings: string[] } {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    const result = fn();
    return { result, warnings };
  } finally {
    console.warn = original;
  }
}

async function withConsoleWarnSpyAsync<T>(fn: () => Promise<T>): Promise<{ result: T; warnings: string[] }> {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    const result = await fn();
    return { result, warnings };
  } finally {
    console.warn = original;
  }
}

test("parseBizBuySellAlertBatch: healthy batch parses fully and does not warn", () => {
  const messages = [
    {
      subject: "New Listing Alert: test_fixture_hvac_co",
      body: "Business: test_fixture_hvac_co\nAsking Price: $850,000\nLocation: Dallas, TX",
    },
    {
      subject: "New Listing Alert: test_fixture_laundromat_co",
      body: "Business: test_fixture_laundromat_co\nAsking Price: $500,000\nLocation: Tampa, FL",
    },
    {
      subject: "New Listing Alert: test_fixture_deli_co",
      body: "Business: test_fixture_deli_co\nAsking Price: $300,000\nLocation: Austin, TX",
    },
  ];

  const { result, warnings } = withConsoleWarnSpy(() => parseBizBuySellAlertBatch(messages));

  assert.equal(result.summary.attempted, 3);
  assert.equal(result.summary.parsed, 3);
  assert.equal(result.summary.parseRate, 1);
  assert.equal(result.results.length, 3);
  assert.equal(warnings.length, 0);
});

test("parseBizBuySellAlertBatch: template-drift batch (low parse rate) logs a loud warning naming template drift", () => {
  // Simulates BizBuySell changing its alert-email template: none of the old labeled-field markup
  // survives, so the regex-based parser can't find anything usable in most messages.
  const messages = [
    { subject: "test_fixture_notice_1", body: "<div class='test_fixture_new_layout'>test_fixture_unstructured_blob_1</div>" },
    { subject: "test_fixture_notice_2", body: "<div class='test_fixture_new_layout'>test_fixture_unstructured_blob_2</div>" },
    { subject: "test_fixture_notice_3", body: "<div class='test_fixture_new_layout'>test_fixture_unstructured_blob_3</div>" },
    {
      subject: "New Listing Alert: test_fixture_survivor_co",
      body: "Business: test_fixture_survivor_co\nAsking Price: $200,000",
    },
  ];

  const { result, warnings } = withConsoleWarnSpy(() => parseBizBuySellAlertBatch(messages));

  assert.equal(result.summary.attempted, 4);
  assert.equal(result.summary.parsed, 1);
  assert.equal(result.summary.parseRate, 0.25);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /template drift/i);
  assert.match(warnings[0]!, /bizbuysell-alerts/);
});

test("createBizBuySellAlertConnector: warns when a fetched batch's parse rate is unhealthy", async () => {
  const connector = createBizBuySellAlertConnector(async () => [
    { subject: "test_fixture_notice_1", body: "<div class='test_fixture_new_layout'>test_fixture_unstructured_blob_1</div>" },
    { subject: "test_fixture_notice_2", body: "<div class='test_fixture_new_layout'>test_fixture_unstructured_blob_2</div>" },
    { subject: "test_fixture_notice_3", body: "<div class='test_fixture_new_layout'>test_fixture_unstructured_blob_3</div>" },
  ]);

  const { result: envelopes, warnings } = await withConsoleWarnSpyAsync(() =>
    connector.fetch({ kind: "company", hints: {} }),
  );

  assert.equal(envelopes.length, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /template drift/i);
});

test("createBizBuySellAlertConnector: does not warn when a fetched batch parses well", async () => {
  const connector = createBizBuySellAlertConnector(async () => [
    { subject: "New Listing Alert: test_fixture_hvac_co", body: "Business: test_fixture_hvac_co\nAsking Price: $850,000" },
    { subject: "New Listing Alert: test_fixture_deli_co", body: "Business: test_fixture_deli_co\nAsking Price: $300,000" },
  ]);

  const { result: envelopes, warnings } = await withConsoleWarnSpyAsync(() =>
    connector.fetch({ kind: "company", hints: {} }),
  );

  assert.equal(envelopes.length, 2);
  assert.equal(warnings.length, 0);
});

test("createBizBuySellAlertConnector: reports every attempted message for spend accounting", async () => {
  const fetchMessages = Object.assign(
    async () => [
      { subject: "New Listing Alert: test_fixture_hvac_co", body: "Business: test_fixture_hvac_co\nAsking Price: $850,000" },
      { subject: "test_fixture_notice_1", body: "test_fixture_unstructured_blob_1" },
      { subject: "test_fixture_notice_2", body: "test_fixture_unstructured_blob_2" },
    ],
    { lastFetchComplete: () => false },
  );
  const connector = createBizBuySellAlertConnector(fetchMessages);

  const batch = await connector.fetchWithSummary({ kind: "company", hints: {} });

  assert.equal(batch.envelopes.length, 1);
  assert.equal(batch.summary.attempted, 3);
  assert.equal(batch.summary.parsed, 1);
  assert.equal(batch.summary.parseRate, 1 / 3);
  assert.equal(batch.summary.complete, false);
});
