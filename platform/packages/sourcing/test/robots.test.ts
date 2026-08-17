import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRobotsTxt, isPathAllowed, selectRobotsGroup } from "../src/robots.js";

const BRIDGE_UA = "BridgeDealPilot";

// The fixtures below are the REAL robots.txt bodies served by the DealPilot source catalog's
// sites (fetched 2026-08-17). Testing against synthetic robots files would prove the parser works
// on robots files we invented; these prove it works on the ones we actually have to obey.

test("an empty Disallow means the whole site is crawlable", () => {
  // stlbusinessbrokers.com and vrgatewaystl.com both ship this Yoast-generated shape.
  const robots = parseRobotsTxt("User-agent: *\nDisallow:\n\nSitemap: https://stlbusinessbrokers.com/sitemap_index.xml");
  assert.equal(isPathAllowed(robots, "/businesses-for-sale/", BRIDGE_UA).allowed, true);
  assert.deepEqual(robots.sitemaps, ["https://stlbusinessbrokers.com/sitemap_index.xml"]);
});

test("a wp-admin-only Disallow leaves the listings path crawlable", () => {
  // accountingbizbrokers.com / atbcal.com / metrobusinessadvisors.com / fusionadvantage.com.
  const robots = parseRobotsTxt("User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php");
  assert.equal(isPathAllowed(robots, "/listings/", BRIDGE_UA).allowed, true);
  assert.equal(isPathAllowed(robots, "/wp-admin/options.php", BRIDGE_UA).allowed, false);
  // Longer Allow beats the shorter Disallow it sits inside.
  assert.equal(isPathAllowed(robots, "/wp-admin/admin-ajax.php", BRIDGE_UA).allowed, true);
});

test("saintlouisgroup.com blocks search but not its listings", () => {
  const robots = parseRobotsTxt(
    "User-agent: *\nDisallow: /?s=\nDisallow: /page/*/?s=\nDisallow: /search/\nDisallow: /wp-json/\nDisallow: /?rest_route=",
  );
  assert.equal(isPathAllowed(robots, "/listings/", BRIDGE_UA).allowed, true);
  assert.equal(isPathAllowed(robots, "/search/", BRIDGE_UA).allowed, false);
  assert.equal(isPathAllowed(robots, "/?s=cpa", BRIDGE_UA).allowed, false);
  // The wildcard in the middle has to match a real path segment.
  assert.equal(isPathAllowed(robots, "/page/3/?s=cpa", BRIDGE_UA).allowed, false);
});

test("accountingpracticeexchange.com only blocks its RSC query parameter", () => {
  const robots = parseRobotsTxt("User-agent: *\nDisallow: /*_rsc=\nSitemap: https://accountingpracticeexchange.com/sitemap.xml");
  assert.equal(isPathAllowed(robots, "/cpa-firms-for-sale", BRIDGE_UA).allowed, true);
  assert.equal(isPathAllowed(robots, "/cpa-firms-for-sale?_rsc=abc123", BRIDGE_UA).allowed, false);
});

test("capstonema.com allows the opportunities page but not its lightbox query", () => {
  const robots = parseRobotsTxt(
    "User-agent: *\nAllow: /\nDisallow: *?lightbox=\n\nUser-agent: PetalBot\nDisallow: /\n\nUser-agent: dotbot\nCrawl-delay: 10",
  );
  assert.equal(isPathAllowed(robots, "/cma-opportunities", BRIDGE_UA).allowed, true);
  assert.equal(isPathAllowed(robots, "/cma-opportunities?lightbox=deal", BRIDGE_UA).allowed, false);
  // A named block for someone else must not leak onto us.
  assert.equal(isPathAllowed(robots, "/cma-opportunities", "PetalBot").allowed, false);
});

test("tworld.com allows the query-string listing URL DealPilot actually uses", () => {
  const robots = parseRobotsTxt("User-agent: *\nAllow: /\nDisallow: /maps/\nDisallow: /*?_prerender_=1");
  assert.equal(
    isPathAllowed(robots, "/locations/missouri/stlouiswest/buy-a-business/active-business-listings?listing=%7B%7D", BRIDGE_UA)
      .allowed,
    true,
  );
  assert.equal(isPathAllowed(robots, "/maps/", BRIDGE_UA).allowed, false);
});

test("websiteclosers.com blocks root-level query URLs but allows the listings path", () => {
  const robots = parseRobotsTxt(
    "User-agent: Scrapy\nAllow: /\n\nUser-agent: *\nDisallow: /cgi-bin\nDisallow: /wp-\nDisallow: /?\nAllow: */\nDisallow: /tag/\nDisallow: /category/",
  );
  assert.equal(isPathAllowed(robots, "/businesses-for-sale/", BRIDGE_UA).allowed, true);
  assert.equal(isPathAllowed(robots, "/?s=cpa", BRIDGE_UA).allowed, false);
  assert.equal(isPathAllowed(robots, "/tag/accounting/", BRIDGE_UA).allowed, false);
});

test("a named group replaces the wildcard group rather than merging with it", () => {
  // kendallcapitalgroup.com blocks facebookexternalhit from paginated indexes while allowing all.
  const robots = parseRobotsTxt(
    "User-agent: Googlebot\nAllow: /\n\nUser-agent: facebookexternalhit\nDisallow: /listings?page=*\n\nUser-agent: *\nAllow: /",
  );
  assert.equal(isPathAllowed(robots, "/listings?page=2", "facebookexternalhit").allowed, false);
  assert.equal(isPathAllowed(robots, "/listings?page=2", BRIDGE_UA).allowed, true);
  assert.equal(selectRobotsGroup(robots, BRIDGE_UA)?.agents.includes("*"), true);
});

test("the longest user-agent token wins among named groups", () => {
  const robots = parseRobotsTxt("User-agent: bot\nDisallow: /\n\nUser-agent: dealpilotbot\nAllow: /");
  assert.equal(isPathAllowed(robots, "/listings/", "DealPilotBot/1.0").allowed, true);
  assert.equal(isPathAllowed(robots, "/listings/", "SomeOtherBot/1.0").allowed, false);
});

test("an equal-length Allow and Disallow resolves to Allow", () => {
  const robots = parseRobotsTxt("User-agent: *\nDisallow: /listings\nAllow: /listings");
  assert.equal(isPathAllowed(robots, "/listings/cpa-firm", BRIDGE_UA).allowed, true);
});

test("a trailing $ anchors the pattern to the end of the path", () => {
  const robots = parseRobotsTxt("User-agent: *\nDisallow: /listings$");
  assert.equal(isPathAllowed(robots, "/listings", BRIDGE_UA).allowed, false);
  assert.equal(isPathAllowed(robots, "/listings/page/2", BRIDGE_UA).allowed, true);
});

test("consecutive User-agent lines share one rule group", () => {
  const robots = parseRobotsTxt("User-agent: AdsBot-Google-Mobile\nUser-agent: AdsBot-Google\nDisallow: /_partials*");
  assert.equal(isPathAllowed(robots, "/_partials/x", "AdsBot-Google").allowed, false);
  assert.equal(isPathAllowed(robots, "/_partials/x", "AdsBot-Google-Mobile").allowed, false);
  // A crawler outside those groups is unaffected: no wildcard group exists here.
  assert.equal(isPathAllowed(robots, "/_partials/x", BRIDGE_UA).allowed, true);
});

test("rule patterns are matched literally, never as regular expressions", () => {
  const robots = parseRobotsTxt("User-agent: *\nDisallow: /listings?a=1+2(x)");
  assert.equal(isPathAllowed(robots, "/listings?a=1+2(x)", BRIDGE_UA).allowed, false);
  assert.equal(isPathAllowed(robots, "/listings?a=1112x", BRIDGE_UA).allowed, true);
});

test("directives appearing before any User-agent line are discarded", () => {
  const robots = parseRobotsTxt("Disallow: /\nUser-agent: *\nAllow: /");
  assert.equal(isPathAllowed(robots, "/listings/", BRIDGE_UA).allowed, true);
});

test("comments and blank lines never contribute rules", () => {
  const robots = parseRobotsTxt("# START YOAST BLOCK\n# ---\nUser-agent: *\nDisallow: # not a real rule\n\n# END");
  assert.equal(isPathAllowed(robots, "/anything", BRIDGE_UA).allowed, true);
});

test("crawl-delay is parsed and reported with the decision", () => {
  // vrgatewaystl.com publishes Crawl-delay: 10.
  const robots = parseRobotsTxt("User-agent: *\nCrawl-delay: 10\nDisallow:");
  const decision = isPathAllowed(robots, "/businesses-for-sale/", BRIDGE_UA);
  assert.equal(decision.allowed, true);
  assert.equal(decision.crawlDelaySeconds, 10);
});

test("a robots.txt with no applicable group allows the path", () => {
  // grandbusinessbrokers.com serves an empty robots.txt.
  const robots = parseRobotsTxt("");
  assert.equal(isPathAllowed(robots, "/buy-business/businesses-for-sale", BRIDGE_UA).allowed, true);
  assert.equal(selectRobotsGroup(robots, BRIDGE_UA), null);
});

test("the deciding rule is reported so a refusal can be explained", () => {
  const robots = parseRobotsTxt("User-agent: *\nDisallow: /wp-admin/");
  const decision = isPathAllowed(robots, "/wp-admin/options.php", BRIDGE_UA);
  assert.equal(decision.allowed, false);
  assert.deepEqual(decision.matchedRule, { kind: "disallow", pattern: "/wp-admin/" });
});
