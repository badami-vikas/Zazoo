import type { SourceQuery } from "@bridge/sourcing";
import { ashbyFetcher, greenhouseFetcher, leverFetcher, type FetchedPosting } from "./fetchers.js";

// The source CATALOG — which boards JobPilot knows how to read. Catalog is code;
// only per-Organization on/off state and last-run results are persisted
// (jobpilot_sources). That split is deliberate: the catalog is the same for
// every Organization and changes when an engineer adds a board, while the
// toggles are user data. Storing the catalog in rows too would mean a seed
// migration every time a slug is added, and two places to disagree about what
// exists.
//
// Why the list is hand-written: no ATS exposes a directory endpoint. Board slugs
// cannot be enumerated or searched — they can only be known. A probe of 50
// guessed slugs on 2026-09-02 returned 404 for 24 of them, so entries here decay
// and a source whose last run 404'd is expected, not broken (see `health`).

export type SourceKind = "greenhouse" | "lever" | "ashby" | "curated";

export interface JobSource {
  /** Stable id — persisted in jobpilot_sources, so never renumber or reuse. */
  id: string;
  label: string;
  kind: SourceKind;
  /** Board slug for ATS sources; null for the curated source, which reads
   * mba-targets.ts rather than the network. */
  slug: string | null;
  company: string;
  /** Sponsorship-relevant note shown on the toggle page. The ATS boards are
   * overwhelmingly venture-backed startups, which is exactly the population
   * least likely to sponsor — surfacing that at the toggle stops the volume
   * from being mistaken for opportunity. */
  note?: string;
}

/** ATS boards, each verified responding on 2026-09-02 with at least one
 * MBA-relevant full-time posting. Two exclusion rules, same reasoning: a slug
 * that 404'd (doordash, plaid, ramp, notion, asana, palantir, …) and a board that
 * resolved but yielded nothing relevant (netlify, planetscale, tala) are both
 * noise on the toggle page. 66 of 150 probed slugs failed one of the two —
 * expect this list to decay as companies rename or migrate ATS. */
export const SOURCE_CATALOG: readonly JobSource[] = [
  { id: "gh-databricks", label: "Databricks", kind: "greenhouse", slug: "databricks", company: "Databricks" },
  { id: "gh-stripe", label: "Stripe", kind: "greenhouse", slug: "stripe", company: "Stripe" },
  { id: "gh-anthropic", label: "Anthropic", kind: "greenhouse", slug: "anthropic", company: "Anthropic" },
  { id: "gh-cloudflare", label: "Cloudflare", kind: "greenhouse", slug: "cloudflare", company: "Cloudflare" },
  { id: "gh-brex", label: "Brex", kind: "greenhouse", slug: "brex", company: "Brex" },
  { id: "gh-samsara", label: "Samsara", kind: "greenhouse", slug: "samsara", company: "Samsara" },
  { id: "gh-coinbase", label: "Coinbase", kind: "greenhouse", slug: "coinbase", company: "Coinbase" },
  { id: "gh-figma", label: "Figma", kind: "greenhouse", slug: "figma", company: "Figma" },
  { id: "gh-instacart", label: "Instacart", kind: "greenhouse", slug: "instacart", company: "Instacart" },
  { id: "gh-flexport", label: "Flexport", kind: "greenhouse", slug: "flexport", company: "Flexport" },
  { id: "gh-discord", label: "Discord", kind: "greenhouse", slug: "discord", company: "Discord" },
  { id: "gh-dropbox", label: "Dropbox", kind: "greenhouse", slug: "dropbox", company: "Dropbox" },
  { id: "gh-robinhood", label: "Robinhood", kind: "greenhouse", slug: "robinhood", company: "Robinhood" },
  { id: "lv-spotify", label: "Spotify", kind: "lever", slug: "spotify", company: "Spotify" },
  { id: "gh-datadog", label: "Datadog", kind: "greenhouse", slug: "datadog", company: "Datadog" },
  { id: "gh-elastic", label: "Elastic", kind: "greenhouse", slug: "elastic", company: "Elastic" },
  { id: "gh-fivetran", label: "Fivetran", kind: "greenhouse", slug: "fivetran", company: "Fivetran" },
  { id: "gh-mongodb", label: "MongoDB", kind: "greenhouse", slug: "mongodb", company: "MongoDB" },
  { id: "gh-airbnb", label: "Airbnb", kind: "greenhouse", slug: "airbnb", company: "Airbnb" },
  { id: "gh-lyft", label: "Lyft", kind: "greenhouse", slug: "lyft", company: "Lyft" },
  { id: "gh-pinterest", label: "Pinterest", kind: "greenhouse", slug: "pinterest", company: "Pinterest" },
  { id: "gh-remotecom", label: "Remote", kind: "greenhouse", slug: "remotecom", company: "Remote" },
  { id: "gh-reddit", label: "Reddit", kind: "greenhouse", slug: "reddit", company: "Reddit" },
  { id: "gh-twitch", label: "Twitch", kind: "greenhouse", slug: "twitch", company: "Twitch" },
  { id: "gh-roblox", label: "Roblox", kind: "greenhouse", slug: "roblox", company: "Roblox" },
  { id: "gh-mercury", label: "Mercury", kind: "greenhouse", slug: "mercury", company: "Mercury" },
  { id: "gh-justworks", label: "Justworks", kind: "greenhouse", slug: "justworks", company: "Justworks" },
  { id: "gh-mixpanel", label: "Mixpanel", kind: "greenhouse", slug: "mixpanel", company: "Mixpanel" },
  { id: "gh-checkr", label: "Checkr", kind: "greenhouse", slug: "checkr", company: "Checkr" },
  { id: "gh-gusto", label: "Gusto", kind: "greenhouse", slug: "gusto", company: "Gusto" },
  { id: "gh-amplitude", label: "Amplitude", kind: "greenhouse", slug: "amplitude", company: "Amplitude" },
  { id: "gh-peloton", label: "Peloton", kind: "greenhouse", slug: "peloton", company: "Peloton" },
  { id: "gh-airtable", label: "Airtable", kind: "greenhouse", slug: "airtable", company: "Airtable" },
  { id: "gh-sigmacomputing", label: "Sigma Computing", kind: "greenhouse", slug: "sigmacomputing", company: "Sigma Computing" },
  { id: "gh-launchdarkly", label: "LaunchDarkly", kind: "greenhouse", slug: "launchdarkly", company: "LaunchDarkly" },
  { id: "gh-webflow", label: "Webflow", kind: "greenhouse", slug: "webflow", company: "Webflow" },
  { id: "gh-calendly", label: "Calendly", kind: "greenhouse", slug: "calendly", company: "Calendly" },
  { id: "gh-modernhealth", label: "Modern Health", kind: "greenhouse", slug: "modernhealth", company: "Modern Health" },
  { id: "gh-alloy", label: "Alloy", kind: "greenhouse", slug: "alloy", company: "Alloy" },
  { id: "gh-glossier", label: "Glossier", kind: "greenhouse", slug: "glossier", company: "Glossier" },
  { id: "gh-sweetgreen", label: "Sweetgreen", kind: "greenhouse", slug: "sweetgreen", company: "Sweetgreen" },
  { id: "gh-postman", label: "Postman", kind: "greenhouse", slug: "postman", company: "Postman" },
  { id: "gh-lithic", label: "Lithic", kind: "greenhouse", slug: "lithic", company: "Lithic" },
  { id: "lv-matchgroup", label: "Match Group", kind: "lever", slug: "matchgroup", company: "Match Group" },
  {
    id: "curated-mba-full-time",
    label: "Curated MBA full-time targets",
    kind: "curated",
    slug: null,
    company: "—",
    note: "The only source carrying application deadlines. Sponsoring employers, entered by hand.",
  },
];

export function findSource(id: string): JobSource | undefined {
  return SOURCE_CATALOG.find((s) => s.id === id);
}

/** Builds the network fetcher for an ATS source. Returns null for the curated
 * source, which has no endpoint — callers read mba-targets.ts for that one. */
export function fetcherFor(source: JobSource): ((query: SourceQuery) => Promise<FetchedPosting[]>) | null {
  if (source.slug === null) return null;
  switch (source.kind) {
    case "greenhouse":
      return greenhouseFetcher(source.slug, source.company);
    case "lever":
      return leverFetcher(source.slug, source.company);
    case "ashby":
      return ashbyFetcher(source.slug, source.company);
    case "curated":
      return null;
  }
}
