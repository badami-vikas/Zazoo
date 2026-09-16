import { test } from "node:test";
import assert from "node:assert/strict";
import type { ListingCrawlerConnector } from "@bridge/sourcing";
import { runSourceDiscovery } from "../src/discovery.js";
import type { SourceRecord } from "../src/domain.js";
import type { ThesisProfile } from "../src/types.js";

const ORG = "org-1";

function source(patch: Partial<SourceRecord> = {}): SourceRecord {
  return {
    kind: "source",
    id: "src-1",
    organizationId: ORG,
    name: "Saint Louis Group",
    link: "https://saintlouisgroup.com/listings/",
    connectionType: "url",
    spendCap: 100,
    spendToDate: 0,
    health: "ready",
    rightsState: "attested",
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
    ...patch,
  };
}

/** A crawler stub that records whether it was ever asked to crawl. */
function crawler(
  payloads: Array<Record<string, unknown>>,
  options: { skips?: Array<{ url: string; reason: string; detail: string }>; complete?: boolean } = {},
): ListingCrawlerConnector & { crawled: boolean } {
  const stub = {
    id: "stub",
    tier: "free" as const,
    crawled: false,
    estimateCost: () => 1,
    async fetch() {
      return [];
    },
    async crawl(query: { kind: "person" | "company"; hints: Record<string, string | undefined> }) {
      stub.crawled = true;
      return {
        envelopes: payloads.map((payload) => ({
          sourceConnectorId: "stub",
          tier: "free" as const,
          query,
          payload,
          confidence: 0.5,
          costUnits: 1,
          capturedAt: "2026-08-17T00:00:00.000Z",
          trustOrigin: "untrusted_external" as const,
        })),
        summary: {
          pagesFetched: 1,
          listingsExtracted: payloads.length,
          skips: (options.skips ?? []) as never,
          complete: options.complete ?? true,
        },
      };
    },
  };
  return stub as ListingCrawlerConnector & { crawled: boolean };
}

const THESIS: ThesisProfile = {
  industries: ["Accounting"],
  geo: ["St. Louis, MO"],
  sdeMin: 200_000,
  sdeMax: 900_000,
};

test("an unattested Source is refused before its crawler is ever called", async () => {
  const stub = crawler([{ name: "Should not appear" }]);
  const result = await runSourceDiscovery({
    organizationId: ORG,
    sources: [source({ rightsState: "unattested" })],
    connectorFor: () => stub,
  });
  assert.equal(stub.crawled, false, "the gate must run before the crawler");
  assert.deepEqual(result.listings, []);
  assert.equal(result.skipped[0]?.reason, "rights_required");
});

test("a paused Source is refused — this is what unchecking a source does", async () => {
  const stub = crawler([{ name: "Should not appear" }]);
  const result = await runSourceDiscovery({
    organizationId: ORG,
    sources: [source({ health: "paused" })],
    connectorFor: () => stub,
  });
  assert.equal(stub.crawled, false);
  assert.equal(result.skipped[0]?.reason, "source_paused");
});

test("a blocked Source is refused", async () => {
  const stub = crawler([{ name: "Should not appear" }]);
  const result = await runSourceDiscovery({
    organizationId: ORG,
    sources: [source({ rightsState: "blocked" })],
    connectorFor: () => stub,
  });
  assert.equal(stub.crawled, false);
  assert.equal(result.skipped[0]?.reason, "source_blocked");
});

test("a Source at its spend cap is refused before spending more", async () => {
  const stub = crawler([{ name: "Should not appear" }]);
  const result = await runSourceDiscovery({
    organizationId: ORG,
    sources: [source({ spendCap: 5, spendToDate: 5 })],
    connectorFor: () => stub,
  });
  assert.equal(stub.crawled, false);
  assert.equal(result.skipped[0]?.reason, "spend_cap_exceeded");
});

test("a Source with no crawl connector is reported, not silently dropped", async () => {
  const result = await runSourceDiscovery({
    organizationId: ORG,
    sources: [source({ connectionType: "email_alert", name: "BizBuySell" })],
    connectorFor: () => null,
  });
  assert.equal(result.skipped[0]?.reason, "no_connector");
  assert.match(result.skipped[0]!.detail, /email_alert/);
});

test("an eligible Source yields its listings", async () => {
  const result = await runSourceDiscovery({
    organizationId: ORG,
    sources: [source()],
    connectorFor: () => crawler([{ name: "STL CPA Practice", askPrice: 850_000 }]),
  });
  assert.equal(result.listings.length, 1);
  assert.equal(result.listings[0]?.payload.name, "STL CPA Practice");
  assert.equal(result.listings[0]?.sourceName, "Saint Louis Group");
  assert.equal(result.pagesFetched, 1);
  assert.equal(result.complete, true);
});

test("listings are ranked strongest thesis fit first", async () => {
  const result = await runSourceDiscovery({
    organizationId: ORG,
    sources: [source()],
    thesis: THESIS,
    connectorFor: () =>
      crawler([
        { name: "Weak", industry: "Logistics", geo: "Dallas, TX", sde: 50_000 },
        { name: "Strong", industry: "Accounting", geo: "St. Louis, MO", sde: 400_000 },
      ]),
  });
  assert.deepEqual(result.listings.map((l) => l.payload.name), ["Strong", "Weak"]);
  assert.equal(result.listings[0]?.fit?.band, "strong_fit");
  assert.ok(result.listings[0]!.fit!.score > result.listings[1]!.fit!.score);
});

test("without a Thesis nothing is scored and discovery order is preserved", async () => {
  const result = await runSourceDiscovery({
    organizationId: ORG,
    sources: [source()],
    connectorFor: () => crawler([{ name: "First" }, { name: "Second" }]),
  });
  assert.deepEqual(result.listings.map((l) => l.payload.name), ["First", "Second"]);
  // Absent, not zero — an unranked listing must not read as "scored badly".
  assert.equal(result.listings[0]?.fit, undefined);
});

test("crawler skips are surfaced with the Source that produced them", async () => {
  const result = await runSourceDiscovery({
    organizationId: ORG,
    sources: [source()],
    connectorFor: () =>
      crawler([], {
        skips: [{ url: "https://saintlouisgroup.com/listings/", reason: "robots_disallowed", detail: "rule /listings/" }],
        complete: true,
      }),
  });
  assert.equal(result.skipped[0]?.reason, "robots_disallowed");
  assert.equal(result.skipped[0]?.sourceName, "Saint Louis Group");
  assert.match(result.skipped[0]!.detail, /saintlouisgroup/);
});

test("one Source throwing does not abort the run", async () => {
  const good = crawler([{ name: "Survivor" }]);
  const result = await runSourceDiscovery({
    organizationId: ORG,
    sources: [source({ id: "bad", name: "Broken" }), source({ id: "good", name: "Healthy" })],
    connectorFor: (s) =>
      s.id === "bad"
        ? ({
            id: "boom",
            tier: "free",
            estimateCost: () => 1,
            fetch: async () => [],
            crawl: async () => {
              throw new Error("connection reset");
            },
          } as unknown as ListingCrawlerConnector)
        : good,
  });
  assert.equal(result.listings.length, 1);
  assert.equal(result.listings[0]?.payload.name, "Survivor");
  assert.equal(result.skipped[0]?.reason, "crawl_error");
  assert.match(result.skipped[0]!.detail, /connection reset/);
  assert.equal(result.complete, false);
});

test("spend is attributed per Source so caps can be settled", async () => {
  const result = await runSourceDiscovery({
    organizationId: ORG,
    sources: [source({ id: "a", name: "A" }), source({ id: "b", name: "B" })],
    connectorFor: () => crawler([{ name: "x" }]),
  });
  assert.deepEqual(result.spendBySourceId, { a: 1, b: 1 });
  assert.equal(result.pagesFetched, 2);
});

test("a refused Source consumes no spend", async () => {
  const result = await runSourceDiscovery({
    organizationId: ORG,
    sources: [source({ health: "paused" })],
    connectorFor: () => crawler([{ name: "x" }]),
  });
  assert.deepEqual(result.spendBySourceId, {});
  assert.equal(result.pagesFetched, 0);
});
