import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createListingCrawlerConnector,
  robotsRefusalFor,
  type CrawlResponse,
} from "../src/connectors/listing-crawler.js";

const query = { kind: "company" as const, hints: { sourceId: "src-1" } };
const UA = "BridgeDealPilot/1.0";

function responder(map: Record<string, CrawlResponse>): {
  fetch: (url: string) => Promise<CrawlResponse>;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    fetch: async (url) => {
      calls.push(url);
      const hit = map[url];
      if (!hit) throw new Error(`unexpected fetch: ${url}`);
      return hit;
    },
  };
}

const ALLOW_ALL = { status: 200, body: "User-agent: *\nDisallow:" };
const ONE_LISTING = `<html><body><h2>Acme CPA Firm</h2><p>Asking Price: $850,000</p></body></html>`;
const extractOne = () => [{ name: "Acme CPA Firm", askPrice: 850_000, url: "https://example.com/l/1" }];

test("a disallowed path is never fetched and the refusal names the rule", async () => {
  const robots = responder({
    "https://example.com/robots.txt": { status: 200, body: "User-agent: *\nDisallow: /listings/" },
  });
  const pages = responder({});
  const connector = createListingCrawlerConnector({
    id: "test",
    startUrls: ["https://example.com/listings/"],
    userAgent: UA,
    fetchRobots: robots.fetch,
    fetchPage: pages.fetch,
    extract: extractOne,
  });

  const { envelopes, summary } = await connector.crawl(query);
  assert.equal(envelopes.length, 0);
  assert.equal(pages.calls.length, 0, "the listing page must not be fetched at all");
  assert.equal(summary.pagesFetched, 0);
  assert.equal(summary.skips[0]?.reason, "robots_disallowed");
  assert.match(summary.skips[0]!.detail, /\/listings\//);
  // Obeying robots is a complete, correct run — not a failure.
  assert.equal(summary.complete, true);
});

test("a 403 on robots.txt is a refusal, never permission", async () => {
  // bizbuysell.com and premierbb.com both do exactly this.
  const robots = responder({ "https://example.com/robots.txt": { status: 403, body: "Access Denied" } });
  const pages = responder({});
  const connector = createListingCrawlerConnector({
    id: "test",
    startUrls: ["https://example.com/listings/"],
    userAgent: UA,
    fetchRobots: robots.fetch,
    fetchPage: pages.fetch,
    extract: extractOne,
  });

  const { envelopes, summary } = await connector.crawl(query);
  assert.equal(envelopes.length, 0);
  assert.equal(pages.calls.length, 0);
  assert.equal(summary.skips[0]?.reason, "robots_unreadable");
  assert.match(summary.skips[0]!.detail, /not permission/);
  assert.equal(summary.complete, false);
});

test("a network failure fetching robots.txt fails closed", async () => {
  const pages = responder({});
  const connector = createListingCrawlerConnector({
    id: "test",
    startUrls: ["https://example.com/listings/"],
    userAgent: UA,
    fetchRobots: async () => {
      throw new Error("ETIMEDOUT");
    },
    fetchPage: pages.fetch,
    extract: extractOne,
  });

  const { summary } = await connector.crawl(query);
  assert.equal(pages.calls.length, 0);
  assert.equal(summary.skips[0]?.reason, "robots_unreadable");
  assert.match(summary.skips[0]!.detail, /ETIMEDOUT/);
});

test("a 404 on robots.txt means no rules and the crawl proceeds", async () => {
  const robots = responder({ "https://example.com/robots.txt": { status: 404, body: "" } });
  const pages = responder({ "https://example.com/listings/": { status: 200, body: ONE_LISTING } });
  const connector = createListingCrawlerConnector({
    id: "test",
    startUrls: ["https://example.com/listings/"],
    userAgent: UA,
    fetchRobots: robots.fetch,
    fetchPage: pages.fetch,
    extract: extractOne,
  });

  const { envelopes, summary } = await connector.crawl(query);
  assert.equal(envelopes.length, 1);
  assert.equal(summary.pagesFetched, 1);
  assert.equal(summary.complete, true);
});

test("every emitted envelope is tagged untrusted_external at the free tier", async () => {
  const robots = responder({ "https://example.com/robots.txt": ALLOW_ALL });
  const pages = responder({ "https://example.com/listings/": { status: 200, body: ONE_LISTING } });
  const connector = createListingCrawlerConnector({
    id: "apx",
    startUrls: ["https://example.com/listings/"],
    userAgent: UA,
    fetchRobots: robots.fetch,
    fetchPage: pages.fetch,
    extract: extractOne,
  });

  const envelopes = await connector.fetch(query);
  assert.equal(envelopes.length, 1);
  assert.equal(envelopes[0]?.trustOrigin, "untrusted_external");
  assert.equal(envelopes[0]?.tier, "free");
  assert.equal(envelopes[0]?.sourceConnectorId, "apx");
  // The listing URL becomes the dedupe key so a re-crawl does not duplicate the row.
  assert.equal(envelopes[0]?.sourceRecordId, "https://example.com/l/1");
});

test("robots.txt is read once per origin, not once per start URL", async () => {
  const robots = responder({ "https://example.com/robots.txt": ALLOW_ALL });
  const pages = responder({
    "https://example.com/a": { status: 200, body: ONE_LISTING },
    "https://example.com/b": { status: 200, body: ONE_LISTING },
  });
  const connector = createListingCrawlerConnector({
    id: "test",
    startUrls: ["https://example.com/a", "https://example.com/b"],
    userAgent: UA,
    fetchRobots: robots.fetch,
    fetchPage: pages.fetch,
    extract: extractOne,
    sleep: async () => {},
  });

  await connector.crawl(query);
  assert.equal(robots.calls.length, 1);
  assert.equal(pages.calls.length, 2);
});

test("the crawl-delay published by robots.txt is waited out between pages", async () => {
  // vrgatewaystl.com publishes Crawl-delay: 10.
  const robots = responder({
    "https://example.com/robots.txt": { status: 200, body: "User-agent: *\nCrawl-delay: 10\nDisallow:" },
  });
  const pages = responder({
    "https://example.com/a": { status: 200, body: ONE_LISTING },
    "https://example.com/b": { status: 200, body: ONE_LISTING },
  });
  const slept: number[] = [];
  let clock = 0;
  const connector = createListingCrawlerConnector({
    id: "test",
    startUrls: ["https://example.com/a", "https://example.com/b"],
    userAgent: UA,
    fetchRobots: robots.fetch,
    fetchPage: pages.fetch,
    extract: extractOne,
    now: () => clock,
    sleep: async (ms) => {
      slept.push(ms);
      clock += ms;
    },
  });

  await connector.crawl(query);
  assert.deepEqual(slept, [10_000]);
});

test("the per-run page cap stops the crawl and says so", async () => {
  const robots = responder({ "https://example.com/robots.txt": ALLOW_ALL });
  const pages = responder({
    "https://example.com/a": { status: 200, body: ONE_LISTING },
    "https://example.com/b": { status: 200, body: ONE_LISTING },
  });
  const connector = createListingCrawlerConnector({
    id: "test",
    startUrls: ["https://example.com/a", "https://example.com/b"],
    userAgent: UA,
    fetchRobots: robots.fetch,
    fetchPage: pages.fetch,
    extract: extractOne,
    maxPages: 1,
    sleep: async () => {},
  });

  const { summary } = await connector.crawl(query);
  assert.equal(summary.pagesFetched, 1);
  assert.equal(pages.calls.length, 1);
  assert.equal(summary.skips[0]?.reason, "page_cap_reached");
  assert.equal(summary.complete, false);
});

test("a listing page error is reported, not thrown, and other sources still run", async () => {
  const robots = responder({ "https://example.com/robots.txt": ALLOW_ALL });
  const pages = responder({
    "https://example.com/a": { status: 503, body: "" },
    "https://example.com/b": { status: 200, body: ONE_LISTING },
  });
  const connector = createListingCrawlerConnector({
    id: "test",
    startUrls: ["https://example.com/a", "https://example.com/b"],
    userAgent: UA,
    fetchRobots: robots.fetch,
    fetchPage: pages.fetch,
    extract: extractOne,
    sleep: async () => {},
  });

  const { envelopes, summary } = await connector.crawl(query);
  assert.equal(envelopes.length, 1, "the healthy page still yields its listing");
  assert.equal(summary.skips[0]?.reason, "page_error");
  assert.match(summary.skips[0]!.detail, /503/);
  assert.equal(summary.complete, false);
});

test("an extractor that finds nothing yields no envelopes and no fabrication", async () => {
  const robots = responder({ "https://example.com/robots.txt": ALLOW_ALL });
  const pages = responder({ "https://example.com/listings/": { status: 200, body: "<html></html>" } });
  const connector = createListingCrawlerConnector({
    id: "test",
    startUrls: ["https://example.com/listings/"],
    userAgent: UA,
    fetchRobots: robots.fetch,
    fetchPage: pages.fetch,
    extract: () => [],
  });

  const { envelopes, summary } = await connector.crawl(query);
  assert.deepEqual(envelopes, []);
  assert.equal(summary.listingsExtracted, 0);
  assert.equal(summary.pagesFetched, 1);
  assert.equal(summary.complete, true);
});

test("an extractor that throws is contained as a page error", async () => {
  const robots = responder({ "https://example.com/robots.txt": ALLOW_ALL });
  const pages = responder({ "https://example.com/listings/": { status: 200, body: ONE_LISTING } });
  const connector = createListingCrawlerConnector({
    id: "test",
    startUrls: ["https://example.com/listings/"],
    userAgent: UA,
    fetchRobots: robots.fetch,
    fetchPage: pages.fetch,
    extract: () => {
      throw new Error("selector drift");
    },
  });

  const { envelopes, summary } = await connector.crawl(query);
  assert.deepEqual(envelopes, []);
  assert.match(summary.skips[0]!.detail, /selector drift/);
});

test("robots status handling is explicit about what each class means", () => {
  assert.equal(robotsRefusalFor(200).refuse, false);
  assert.equal(robotsRefusalFor(404).refuse, false);
  assert.equal(robotsRefusalFor(410).refuse, false);
  assert.equal(robotsRefusalFor(401).refuse, true);
  assert.equal(robotsRefusalFor(403).refuse, true);
  assert.equal(robotsRefusalFor(429).refuse, true);
  assert.equal(robotsRefusalFor(500).refuse, true);
  assert.equal(robotsRefusalFor(503).refuse, true);
});

test("estimateCost is bounded by the page cap, not the start-URL count", () => {
  const connector = createListingCrawlerConnector({
    id: "test",
    startUrls: ["https://a.example/1", "https://a.example/2", "https://a.example/3"],
    userAgent: UA,
    fetchRobots: async () => ALLOW_ALL,
    fetchPage: async () => ({ status: 200, body: "" }),
    extract: () => [],
    maxPages: 2,
    costPerPage: 3,
  });
  assert.equal(connector.estimateCost(query), 6);
});
