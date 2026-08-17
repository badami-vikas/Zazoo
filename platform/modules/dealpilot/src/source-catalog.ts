import type { CreateSourceInput, SourceConnectionType } from "./domain.js";

// The investor's standing deal-source list, as supplied 2026-08-17, with each site's crawl posture
// verified against its live robots.txt on the same date (recorded below per entry).
//
// Three things this file deliberately encodes rather than leaves to runtime discovery:
//
//  1. POSTURE IS EVIDENCE, NOT GUESSWORK. `crawlPosture` records what the site actually said when
//     asked. `bot_protected` means robots.txt itself came back 403 or behind a JS challenge — the
//     site is refusing automated clients, and DealPilot does not argue with that. Those entries
//     seed as `rightsState: "blocked"` so `assertSourceDiscoveryAllowed` refuses them at the gate;
//     a Human can still override per Source, but the default is obedience.
//
//  2. NOTHING IS PRE-ATTESTED. Every crawlable entry seeds `unattested`. A Human attests data
//     rights and intended use per Source before a single request goes out. Seeding 20 sources as
//     "attested" because they were pasted into a chat message would put the platform's rights gate
//     on the wrong side of its own rule.
//
//  3. ENABLED IS `health`, NOT A NEW COLUMN. A Source the user unchecks becomes `health: "paused"`,
//     which the existing discovery gate already refuses with `source_paused`. Adding a parallel
//     `enabled` boolean would create two sources of truth for one question.
//
// Tracking parameters (gclid, _gl, utm_*) are stripped from the stored URLs: they are ad-click
// attribution from however the link was originally found, they are not part of the resource, and
// keeping them would send someone else's campaign identifiers back to the site on every crawl.

export type CrawlPosture =
  /** robots.txt read cleanly and permits the listing path. */
  | "crawlable"
  /** robots.txt itself is 403/challenged — the site refuses automated clients. */
  | "bot_protected"
  /** Listings sit behind an account; a credential is required before anything is readable. */
  | "login_required";

export interface DealSourceCatalogEntry {
  /** Stable slug; also the connector id for this Source. */
  id: string;
  name: string;
  listingUrl: string;
  connectionType: SourceConnectionType;
  crawlPosture: CrawlPosture;
  /** What robots.txt actually returned when checked, so the posture can be re-verified. */
  robotsEvidence: string;
  /** Verbatim note from the investor's list, where one was given. */
  note?: string;
  /** Politeness floor in seconds when robots.txt publishes a Crawl-delay. */
  crawlDelaySeconds?: number;
}

export const SOURCE_CATALOG_CHECKED_ON = "2026-08-17";

export const DEAL_SOURCE_CATALOG: readonly DealSourceCatalogEntry[] = [
  {
    id: "accounting-practice-sales",
    name: "APS (Accounting Practice Sales)",
    listingUrl: "https://accountingpracticesales.com/portal/start.php",
    connectionType: "account",
    crawlPosture: "login_required",
    robotsEvidence: "robots.txt 200, no Disallow rules; the listing URL is a buyer-portal sign-in",
    note: "Good",
  },
  {
    id: "poe-group-advisors",
    name: "POE Group Advisors",
    listingUrl: "https://poegroupadvisors.com/buying/usa-cpa-firms-for-sale/?sort_by=listing_id&sort_order=ASC",
    connectionType: "url",
    crawlPosture: "crawlable",
    robotsEvidence: "robots.txt 200, Yoast block with no Disallow rules",
  },
  {
    id: "accounting-practice-exchange",
    name: "Accounting Practice Exchange",
    listingUrl: "https://accountingpracticeexchange.com/cpa-firms-for-sale",
    connectionType: "url",
    crawlPosture: "crawlable",
    robotsEvidence: "robots.txt 200, only `Disallow: /*_rsc=` (a Next.js RSC query parameter)",
  },
  {
    id: "accounting-biz-brokers",
    name: "Accounting Biz Brokers",
    listingUrl: "https://accountingbizbrokers.com/listings/",
    connectionType: "url",
    crawlPosture: "crawlable",
    robotsEvidence: "robots.txt 200, only `Disallow: /wp-admin/`",
  },
  {
    id: "accounting-tax-brokerage",
    name: "Accounting & Tax Brokerage",
    listingUrl: "https://www.atbcal.com/listings/",
    connectionType: "url",
    crawlPosture: "crawlable",
    robotsEvidence: "robots.txt 200, only `Disallow: /wp-admin/`",
    note: "Just CA",
  },
  {
    id: "fusion-advantage",
    name: "Fusion",
    listingUrl: "https://fusionadvantage.com/businesses-for-sale/",
    connectionType: "url",
    crawlPosture: "crawlable",
    robotsEvidence: "robots.txt 200, only `Disallow: /wp-admin/`",
  },
  {
    id: "capstone-ma",
    name: "Capstone M&A",
    listingUrl: "https://www.capstonema.com/cma-opportunities",
    connectionType: "url",
    crawlPosture: "crawlable",
    robotsEvidence: "robots.txt 200, `Allow: /` with `Disallow: *?lightbox=`",
  },
  {
    id: "saint-louis-group",
    name: "Saint Louis Group",
    listingUrl: "https://saintlouisgroup.com/listings/",
    connectionType: "url",
    crawlPosture: "crawlable",
    robotsEvidence: "robots.txt 200; blocks /search/ and /?s= only, listings path unrestricted",
  },
  {
    id: "grand-business-brokers",
    name: "Grand Business Brokers",
    listingUrl: "https://www.grandbusinessbrokers.com/buy-business/businesses-for-sale",
    connectionType: "url",
    crawlPosture: "crawlable",
    robotsEvidence: "robots.txt 200 but empty — no rules published",
  },
  {
    id: "kendall-capital",
    name: "Kendall Capital",
    listingUrl: "https://www.kendallcapitalgroup.com/pages/our-listings",
    connectionType: "url",
    crawlPosture: "crawlable",
    robotsEvidence: "robots.txt 200, `User-agent: *` / `Allow: /`",
  },
  {
    id: "premier-business-brokers",
    name: "Premier Business Brokers",
    listingUrl: "https://premierbb.com/search-listings/",
    connectionType: "url",
    crawlPosture: "bot_protected",
    robotsEvidence: "robots.txt returned 403 Forbidden — the site refuses automated clients",
  },
  {
    id: "sunbelt-stl-west",
    name: "Sunbelt (St. Louis West)",
    listingUrl: "https://www.sunbeltnetwork.com/st-louis-west-mo/buy-a-business/listings/",
    connectionType: "url",
    crawlPosture: "bot_protected",
    robotsEvidence: "robots.txt served a Cloudflare managed JS challenge instead of a rules file",
  },
  {
    id: "vr-gateway-stl",
    name: "VR Gateway STL",
    listingUrl: "https://vrgatewaystl.com/businesses-for-sale/",
    connectionType: "url",
    crawlPosture: "crawlable",
    robotsEvidence: "robots.txt 200, `Disallow:` (allow all) with `Crawl-delay: 10`",
    crawlDelaySeconds: 10,
  },
  {
    id: "metro-business-advisors",
    name: "Metro Business Advisors",
    listingUrl: "https://metrobusinessadvisors.com/business-for-sale/",
    connectionType: "url",
    crawlPosture: "crawlable",
    robotsEvidence: "robots.txt 200, only `Disallow: /wp-admin/`",
  },
  {
    id: "innovative-business-advisors",
    name: "Innovative Business Advisors",
    listingUrl: "https://stlbusinessbrokers.com/businesses-for-sale/",
    connectionType: "url",
    crawlPosture: "crawlable",
    robotsEvidence: "robots.txt 200, `Disallow:` (allow all)",
  },
  {
    id: "transworld-stl-west",
    name: "Transworld (St. Louis West)",
    listingUrl:
      "https://www.tworld.com/locations/missouri/stlouiswest/buy-a-business/active-business-listings",
    connectionType: "url",
    crawlPosture: "crawlable",
    robotsEvidence: "robots.txt 200, `Allow: /`; blocks /maps/ and ?_prerender_=1 only",
  },
  {
    id: "bizbuysell",
    name: "BizBuySell",
    listingUrl: "https://www.bizbuysell.com/",
    connectionType: "email_alert",
    crawlPosture: "bot_protected",
    robotsEvidence:
      "robots.txt returned an Akamai 403 Access Denied; saved-search alert email is the supported path (see connectors.ts)",
  },
  {
    id: "kumo",
    name: "Kumo",
    listingUrl: "https://app.withkumo.com/suggested-search/1to5million",
    connectionType: "account",
    crawlPosture: "login_required",
    robotsEvidence: "robots.txt 200 `Disallow:` (allow all), but the URL is an authenticated app view",
  },
  {
    id: "quiet-light",
    name: "Quiet Light",
    listingUrl: "https://quietlight.com/listings/",
    connectionType: "url",
    crawlPosture: "crawlable",
    robotsEvidence: "robots.txt 200; blocks wp internals and /?s= only, /listings/ unrestricted",
  },
  {
    id: "website-closers",
    name: "Website Closers",
    listingUrl: "https://www.websiteclosers.com/businesses-for-sale/",
    connectionType: "url",
    crawlPosture: "crawlable",
    robotsEvidence: "robots.txt 200; `Disallow: /?` covers root query URLs, `/businesses-for-sale/` is allowed",
  },
];

/** Tracking parameters stripped from any catalog or user-supplied Source URL before it is stored. */
const TRACKING_PARAMS = /^(gclid|fbclid|msclkid|_gl|_ga|mc_cid|mc_eid|igshid|utm_[a-z_]+)$/i;

/**
 * Removes ad-attribution parameters from a listing URL. Returns the input unchanged when it is not
 * a parseable absolute URL — validation belongs to the caller, not to a cleaning helper.
 */
export function stripTrackingParams(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  for (const key of [...parsed.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) parsed.searchParams.delete(key);
  }
  return parsed.toString();
}

/**
 * Maps a catalog entry onto the Source record the store creates.
 *
 * Posture drives three defaults and nothing else touches them:
 *   - `bot_protected` seeds `rightsState: "blocked"` and `health: "paused"` — the gate refuses it
 *     and the Sources page renders it unchecked, with the robots evidence as the explanation.
 *   - `login_required` seeds `health: "paused"` until a credential exists; there is nothing to read
 *     without one, so a "ready" Source would be a lie.
 *   - `crawlable` seeds `unattested` + `ready`: checked in the UI, but still gated on the Human's
 *     rights attestation before the first request.
 */
export function catalogEntryToSourceInput(
  entry: DealSourceCatalogEntry,
  organizationId: string,
): { input: Omit<CreateSourceInput, "id">; health: "ready" | "paused" } {
  const blocked = entry.crawlPosture === "bot_protected";
  return {
    // `health` is returned alongside rather than inside the input because Source creation does not
    // accept it — the caller applies it with a follow-up update, and keeping the two apart stops a
    // caller from quietly passing a field `createSource` would drop on the floor.
    input: {
      organizationId,
      name: entry.name,
      link: stripTrackingParams(entry.listingUrl),
      connectionType: entry.connectionType,
      spendCap: blocked ? 0 : 100,
      rightsState: blocked ? "blocked" : "unattested",
    },
    health: entry.crawlPosture === "crawlable" ? "ready" : "paused",
  };
}

/** The subset a crawl run may consider, before per-Source rights/pause/spend gating. */
export function crawlableCatalogEntries(): DealSourceCatalogEntry[] {
  return DEAL_SOURCE_CATALOG.filter((entry) => entry.crawlPosture === "crawlable");
}

export function catalogEntryById(id: string): DealSourceCatalogEntry | undefined {
  return DEAL_SOURCE_CATALOG.find((entry) => entry.id === id);
}
