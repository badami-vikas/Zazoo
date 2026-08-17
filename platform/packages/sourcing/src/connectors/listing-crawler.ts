import type { CaptureEnvelope, SourceConnector, SourceQuery } from "../types.js";
import { EMPTY_ROBOTS, isPathAllowed, parseRobotsTxt, type RobotsDecision, type RobotsTxt } from "../robots.js";

// Listing-page crawler — the `free` tier connector for broker/marketplace sites that publish their
// inventory as ordinary HTML.
//
// Two seams are injected rather than imported: `fetchPage` and `fetchRobots`. Server wiring passes
// @bridge/net-guard's `guardedFetch` into both, keeping this package free of network code and
// keeping `guardedFetch` the single audited egress site (see apps/api/src/wiring.ts). Tests drive
// the same seams with canned responses, so every behavior below is provable without a live site.
//
// What this connector will NOT do:
//   - fetch a page before robots.txt has been read and consulted for that exact path;
//   - treat a robots.txt it could not read as permission (see `robotsRefusalFor`);
//   - solve a bot challenge, rotate a user agent, or otherwise present itself as something other
//     than what it is. Sites that refuse crawlers stay refused and are reported as such.

/** Minimal response shape both seams return; matches guardedFetch's result closely enough to adapt. */
export interface CrawlResponse {
  status: number;
  body: string;
  /** Final URL after redirects, when the fetcher followed any. */
  url?: string;
}

export type PageFetcher = (url: string) => Promise<CrawlResponse>;

export type ListingExtractor = (
  html: string,
  pageUrl: string,
) => Array<Record<string, unknown>>;

export interface ListingCrawlerConfig {
  id: string;
  /** Listing index pages to read, in order. */
  startUrls: string[];
  /** Sent as User-Agent and matched against robots.txt groups. */
  userAgent: string;
  fetchPage: PageFetcher;
  /** Fetches `<origin>/robots.txt`. Separated so the crawler can tell "no rules" from "refused". */
  fetchRobots: PageFetcher;
  extract: ListingExtractor;
  costPerPage?: number;
  /** Hard ceiling on pages fetched per run, across all start URLs. */
  maxPages?: number;
  /** Applied when robots.txt states no Crawl-delay. Politeness floor, not a rate limit. */
  defaultCrawlDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export type CrawlSkipReason =
  | "robots_disallowed"
  | "robots_unreadable"
  | "page_error"
  | "page_cap_reached";

export interface CrawlSkip {
  url: string;
  reason: CrawlSkipReason;
  detail: string;
}

export interface CrawlSummary {
  pagesFetched: number;
  listingsExtracted: number;
  skips: CrawlSkip[];
  /** True when every start URL was either fetched or deliberately skipped without error. */
  complete: boolean;
}

export interface ListingCrawlerConnector extends SourceConnector {
  crawl(query: SourceQuery): Promise<{ envelopes: CaptureEnvelope[]; summary: CrawlSummary }>;
}

const DEFAULT_MAX_PAGES = 5;
const DEFAULT_CRAWL_DELAY_MS = 1_000;
const DEFAULT_COST_PER_PAGE = 1;

/**
 * Decides what an unreadable robots.txt means.
 *
 * RFC 9309 lets a crawler treat a 4xx robots.txt as "unrestricted". This connector deliberately
 * does NOT take that latitude for 401/403/429: on the sites in DealPilot's catalog those statuses
 * come from Akamai and Cloudflare bot management (bizbuysell.com and premierbb.com return 403 for
 * robots.txt itself; sunbeltnetwork.com serves a JS challenge), and a server actively refusing
 * automated clients is the opposite of a server that has no opinion. 404/410 is the genuine "no
 * robots.txt published" case and means no rules. Anything else — 5xx, a network failure — fails
 * closed, because "we could not ask" must never resolve to "so we went ahead".
 */
export function robotsRefusalFor(status: number): { refuse: boolean; detail: string } {
  if (status === 404 || status === 410) {
    return { refuse: false, detail: "no robots.txt published; no rules apply" };
  }
  if (status >= 200 && status < 300) return { refuse: false, detail: "robots.txt read" };
  if (status === 401 || status === 403) {
    return {
      refuse: true,
      detail: `robots.txt returned ${status} — the site is actively refusing automated clients, which is not permission`,
    };
  }
  if (status === 429) {
    return { refuse: true, detail: "robots.txt returned 429 — the site is rate-limiting this client" };
  }
  return {
    refuse: true,
    detail: `robots.txt could not be read (status ${status}); failing closed rather than assuming permission`,
  };
}

function originOf(url: string): string {
  return new URL(url).origin;
}

function pathWithQueryOf(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

/**
 * Builds the `free`-tier listing connector. `fetch` runs a crawl and returns only the envelopes;
 * `crawl` returns the same envelopes alongside a summary naming every page that was skipped and
 * why, so a run that produced nothing can be explained instead of looking like an empty market.
 */
export function createListingCrawlerConnector(config: ListingCrawlerConfig): ListingCrawlerConnector {
  const costPerPage = config.costPerPage ?? DEFAULT_COST_PER_PAGE;
  const maxPages = config.maxPages ?? DEFAULT_MAX_PAGES;
  const defaultDelayMs = config.defaultCrawlDelayMs ?? DEFAULT_CRAWL_DELAY_MS;
  const sleep = config.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = config.now ?? (() => Date.now());

  const crawl = async (query: SourceQuery) => {
    const envelopes: CaptureEnvelope[] = [];
    const skips: CrawlSkip[] = [];
    // One robots.txt read per origin per run, shared across that origin's start URLs.
    const robotsByOrigin = new Map<string, { robots: RobotsTxt; refusal: string | null }>();
    let pagesFetched = 0;
    let complete = true;
    let lastFetchAt: number | null = null;

    for (const startUrl of config.startUrls) {
      if (pagesFetched >= maxPages) {
        skips.push({
          url: startUrl,
          reason: "page_cap_reached",
          detail: `per-run page cap of ${maxPages} reached before this URL`,
        });
        complete = false;
        continue;
      }

      let origin: string;
      let pathWithQuery: string;
      try {
        origin = originOf(startUrl);
        pathWithQuery = pathWithQueryOf(startUrl);
      } catch {
        skips.push({ url: startUrl, reason: "page_error", detail: "start URL is not a valid absolute URL" });
        complete = false;
        continue;
      }

      let entry = robotsByOrigin.get(origin);
      if (!entry) {
        try {
          const response = await config.fetchRobots(`${origin}/robots.txt`);
          const verdict = robotsRefusalFor(response.status);
          entry = {
            robots: verdict.refuse || response.status >= 300 ? EMPTY_ROBOTS : parseRobotsTxt(response.body),
            refusal: verdict.refuse ? verdict.detail : null,
          };
        } catch (error) {
          entry = {
            robots: EMPTY_ROBOTS,
            refusal: `robots.txt request failed (${error instanceof Error ? error.message : String(error)}); failing closed`,
          };
        }
        robotsByOrigin.set(origin, entry);
      }

      if (entry.refusal) {
        skips.push({ url: startUrl, reason: "robots_unreadable", detail: entry.refusal });
        complete = false;
        continue;
      }

      const decision: RobotsDecision = isPathAllowed(entry.robots, pathWithQuery, config.userAgent);
      if (!decision.allowed) {
        skips.push({
          url: startUrl,
          reason: "robots_disallowed",
          detail: `robots.txt ${decision.matchedRule?.kind ?? "rule"} "${decision.matchedRule?.pattern ?? ""}" disallows this path`,
        });
        // A disallowed path is a correct, complete outcome — the site said no and we obeyed.
        continue;
      }

      const delayMs = decision.crawlDelaySeconds != null ? decision.crawlDelaySeconds * 1_000 : defaultDelayMs;
      if (lastFetchAt != null) {
        const waited = now() - lastFetchAt;
        if (waited < delayMs) await sleep(delayMs - waited);
      }

      let response: CrawlResponse;
      try {
        response = await config.fetchPage(startUrl);
      } catch (error) {
        skips.push({
          url: startUrl,
          reason: "page_error",
          detail: error instanceof Error ? error.message : String(error),
        });
        complete = false;
        continue;
      }
      lastFetchAt = now();
      pagesFetched += 1;

      if (response.status < 200 || response.status >= 300) {
        skips.push({ url: startUrl, reason: "page_error", detail: `listing page returned status ${response.status}` });
        complete = false;
        continue;
      }

      let rows: Array<Record<string, unknown>>;
      try {
        rows = config.extract(response.body, response.url ?? startUrl);
      } catch (error) {
        skips.push({
          url: startUrl,
          reason: "page_error",
          detail: `extraction failed: ${error instanceof Error ? error.message : String(error)}`,
        });
        complete = false;
        continue;
      }

      const capturedAt = new Date(now()).toISOString();
      for (const row of rows) {
        const listingUrl = typeof row.url === "string" ? row.url : undefined;
        envelopes.push({
          sourceConnectorId: config.id,
          ...(listingUrl ? { sourceRecordId: listingUrl } : {}),
          tier: "free",
          query,
          payload: row,
          // Public HTML with no provider guarantees: the intake seam re-scores independently.
          confidence: 0.5,
          costUnits: costPerPage,
          capturedAt,
          trustOrigin: "untrusted_external",
        });
      }
    }

    return {
      envelopes,
      summary: { pagesFetched, listingsExtracted: envelopes.length, skips, complete },
    };
  };

  return {
    id: config.id,
    tier: "free",
    estimateCost: () => costPerPage * Math.min(config.startUrls.length, maxPages),
    async fetch(query) {
      return (await crawl(query)).envelopes;
    },
    crawl,
  };
}
