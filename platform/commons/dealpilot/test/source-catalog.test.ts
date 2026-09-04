import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEAL_SOURCE_CATALOG,
  catalogEntryById,
  catalogEntryToSourceInput,
  crawlableCatalogEntries,
  stripTrackingParams,
} from "../src/source-catalog.js";

const ORG = "org-1";

test("the catalog carries every source on the investor's list", () => {
  assert.equal(DEAL_SOURCE_CATALOG.length, 20);
  const ids = DEAL_SOURCE_CATALOG.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, "source ids must be unique");
});

test("every catalog URL is absolute, https, and parseable", () => {
  for (const entry of DEAL_SOURCE_CATALOG) {
    const url = new URL(entry.listingUrl);
    assert.equal(url.protocol, "https:", `${entry.id} must be https`);
  }
});

test("every entry records the robots evidence its posture rests on", () => {
  for (const entry of DEAL_SOURCE_CATALOG) {
    assert.ok(entry.robotsEvidence.length > 20, `${entry.id} needs real robots evidence`);
  }
});

test("bot-protected sources seed blocked and paused so the gate refuses them", () => {
  const protectedIds = DEAL_SOURCE_CATALOG.filter((e) => e.crawlPosture === "bot_protected").map((e) => e.id);
  // Verified 2026-08-17: all three refuse robots.txt itself.
  assert.deepEqual(protectedIds.sort(), ["bizbuysell", "premier-business-brokers", "sunbelt-stl-west"]);
  for (const id of protectedIds) {
    const { input, health } = catalogEntryToSourceInput(catalogEntryById(id)!, ORG);
    assert.equal(input.rightsState, "blocked", `${id} must seed blocked`);
    assert.equal(health, "paused", `${id} must seed paused`);
    assert.equal(input.spendCap, 0, `${id} must seed with no spend budget`);
  }
});

test("login-gated sources seed paused as an account connection", () => {
  const gated = DEAL_SOURCE_CATALOG.filter((e) => e.crawlPosture === "login_required");
  assert.deepEqual(gated.map((e) => e.id).sort(), ["accounting-practice-sales", "kumo"]);
  for (const entry of gated) {
    const { input, health } = catalogEntryToSourceInput(entry, ORG);
    assert.equal(input.connectionType, "account");
    // Nothing is readable without a credential, so "ready" would be a false state.
    assert.equal(health, "paused");
  }
});

test("no source is ever seeded pre-attested", () => {
  for (const entry of DEAL_SOURCE_CATALOG) {
    const { input } = catalogEntryToSourceInput(entry, ORG);
    assert.notEqual(input.rightsState, "attested", `${entry.id} must not seed attested`);
  }
});

test("crawlable sources seed ready but still unattested", () => {
  const entry = catalogEntryById("quiet-light")!;
  const { input, health } = catalogEntryToSourceInput(entry, ORG);
  assert.equal(health, "ready");
  assert.equal(input.rightsState, "unattested");
  assert.equal(input.connectionType, "url");
});

test("crawlableCatalogEntries excludes bot-protected and login-gated sources", () => {
  const ids = new Set(crawlableCatalogEntries().map((e) => e.id));
  assert.equal(ids.has("bizbuysell"), false);
  assert.equal(ids.has("premier-business-brokers"), false);
  assert.equal(ids.has("sunbelt-stl-west"), false);
  assert.equal(ids.has("kumo"), false);
  assert.equal(ids.has("accounting-practice-sales"), false);
  assert.equal(ids.size, 15);
});

test("ad-tracking parameters are stripped from stored URLs", () => {
  // The Website Closers link arrived carrying a gclid and a _gl campaign identifier.
  const cleaned = stripTrackingParams(
    "https://www.websiteclosers.com/businesses-for-sale/?_gl=1*86zyi6*_up*MQ..&gclid=Cj0KCQjw&page=2",
  );
  assert.equal(cleaned, "https://www.websiteclosers.com/businesses-for-sale/?page=2");
  assert.ok(!cleaned.includes("gclid"));
  assert.ok(!cleaned.includes("_gl"));
});

test("stripping tracking parameters preserves meaningful query state", () => {
  // POE Advisors' sort parameters are part of the resource and must survive.
  const url = "https://poegroupadvisors.com/buying/usa-cpa-firms-for-sale/?sort_by=listing_id&sort_order=ASC&utm_source=x";
  const cleaned = stripTrackingParams(url);
  assert.ok(cleaned.includes("sort_by=listing_id"));
  assert.ok(cleaned.includes("sort_order=ASC"));
  assert.ok(!cleaned.includes("utm_source"));
});

test("a non-URL string passes through the cleaner unchanged", () => {
  assert.equal(stripTrackingParams("not a url"), "not a url");
});

test("no stored catalog URL carries a tracking parameter", () => {
  for (const entry of DEAL_SOURCE_CATALOG) {
    assert.equal(stripTrackingParams(entry.listingUrl), entry.listingUrl, `${entry.id} URL is already clean`);
  }
});

test("the VR Gateway entry carries the crawl-delay its robots.txt publishes", () => {
  assert.equal(catalogEntryById("vr-gateway-stl")?.crawlDelaySeconds, 10);
});

test("BizBuySell stays on the email-alert path rather than a scraper", () => {
  const entry = catalogEntryById("bizbuysell")!;
  assert.equal(entry.connectionType, "email_alert");
  assert.equal(entry.crawlPosture, "bot_protected");
});

test("the investor's own notes are preserved verbatim", () => {
  assert.equal(catalogEntryById("accounting-practice-sales")?.note, "Good");
  assert.equal(catalogEntryById("accounting-tax-brokerage")?.note, "Just CA");
});
