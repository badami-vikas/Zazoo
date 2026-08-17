import type { ListingCrawlerConnector, SourceQuery } from "@bridge/sourcing";
import { SourceDiscoveryGateError, assertSourceDiscoveryAllowed, type SourceRecord } from "./domain.js";
import { scoreThesisFit } from "./scoring.js";
import type { DealProfile, ThesisFitResult, ThesisProfile } from "./types.js";
import type { ListingPayload } from "./listing-extract.js";

// One discovery run across the investor's enabled Sources.
//
// The ordering here is deliberate and is the whole point of the file: GATE, then crawl. Every
// Source passes `assertSourceDiscoveryAllowed` — rights attested, not paused, inside its spend cap
// — BEFORE its connector is touched. A Source that fails the gate contributes a skip row naming
// the gate code; it never contributes a silent absence.
//
// This function does not write anything. It returns what it found and what it refused to look at,
// and the caller decides what becomes a capture. Keeping the run read-only means a discovery pass
// can be previewed, logged, and re-read without mutating the Deal graph as a side effect.

export type DiscoverySkipReason =
  | "rights_required"
  | "source_blocked"
  | "source_paused"
  | "spend_cap_exceeded"
  | "no_connector"
  | "crawl_error"
  | "robots_disallowed"
  | "robots_unreadable"
  | "page_error"
  | "page_cap_reached";

export interface DiscoverySkip {
  sourceId: string;
  sourceName: string;
  reason: DiscoverySkipReason;
  detail: string;
}

export interface DiscoveredListing {
  sourceId: string;
  sourceName: string;
  payload: ListingPayload;
  /** Present only when a Thesis profile was supplied; absent means unranked, not "scored zero". */
  fit?: ThesisFitResult;
}

export interface DiscoveryRunResult {
  listings: DiscoveredListing[];
  skipped: DiscoverySkip[];
  pagesFetched: number;
  /** Cost units actually consumed, for settling each Source's spendToDate. */
  spendBySourceId: Record<string, number>;
  /** True when every enabled Source either completed or was cleanly refused. */
  complete: boolean;
}

export interface DiscoveryRunInput {
  sources: SourceRecord[];
  /** Returns the crawler for a Source, or null when this Source has no crawl connector. */
  connectorFor: (source: SourceRecord) => ListingCrawlerConnector | null;
  /** Ranking is skipped entirely when absent — no thesis, no invented scores. */
  thesis?: ThesisProfile;
  organizationId: string;
}

/** Maps a crawler skip onto the run's vocabulary; both already speak in the same terms. */
function crawlSkipReason(reason: string): DiscoverySkipReason {
  switch (reason) {
    case "robots_disallowed":
    case "robots_unreadable":
    case "page_error":
    case "page_cap_reached":
      return reason;
    default:
      return "crawl_error";
  }
}

function profileFrom(payload: ListingPayload): DealProfile {
  // Built additively: `exactOptionalPropertyTypes` forbids writing an explicit `undefined`, and
  // omitting the key is the correct way to say "this listing did not state a value".
  const profile: DealProfile = {};
  if (payload.industry) profile.industry = payload.industry;
  if (payload.geo) profile.geo = payload.geo;
  if (payload.sde != null) profile.sde = payload.sde;
  if (payload.revenue != null) profile.revenue = payload.revenue;
  return profile;
}

/**
 * Ranks strongest fit first. Listings with no fit result (no Thesis supplied) keep their discovery
 * order — a stable sort, so an unranked run reads as "what we found, in the order we found it"
 * rather than an arbitrary shuffle that looks like a ranking.
 */
function rank(listings: DiscoveredListing[]): DiscoveredListing[] {
  return [...listings].sort((a, b) => {
    if (a.fit && b.fit) return b.fit.score - a.fit.score;
    if (a.fit) return -1;
    if (b.fit) return 1;
    return 0;
  });
}

export async function runSourceDiscovery(input: DiscoveryRunInput): Promise<DiscoveryRunResult> {
  const listings: DiscoveredListing[] = [];
  const skipped: DiscoverySkip[] = [];
  const spendBySourceId: Record<string, number> = {};
  let pagesFetched = 0;
  let complete = true;

  for (const source of input.sources) {
    const connector = input.connectorFor(source);
    if (!connector) {
      // An email-alert or account Source has no crawl path; that is a fact about the Source, not
      // an error, but it is still reported so the run's coverage is legible.
      skipped.push({
        sourceId: source.id,
        sourceName: source.name,
        reason: "no_connector",
        detail: `Source connection type "${source.connectionType}" has no listing crawler`,
      });
      continue;
    }

    const query: SourceQuery = {
      kind: "company",
      hints: { sourceId: source.id, organizationId: input.organizationId },
    };

    // Reserve against the estimate BEFORE fetching, exactly as the waterfall does, so a Source
    // cannot exceed its cap by discovering the overrun only after the requests went out.
    const estimate = connector.estimateCost(query);
    try {
      assertSourceDiscoveryAllowed(source, estimate);
    } catch (error) {
      if (error instanceof SourceDiscoveryGateError) {
        skipped.push({
          sourceId: source.id,
          sourceName: source.name,
          reason: error.code,
          detail: error.message,
        });
        continue;
      }
      throw error;
    }

    let crawled: Awaited<ReturnType<ListingCrawlerConnector["crawl"]>>;
    try {
      crawled = await connector.crawl(query);
    } catch (error) {
      skipped.push({
        sourceId: source.id,
        sourceName: source.name,
        reason: "crawl_error",
        detail: error instanceof Error ? error.message : String(error),
      });
      complete = false;
      continue;
    }

    pagesFetched += crawled.summary.pagesFetched;
    spendBySourceId[source.id] = crawled.summary.pagesFetched;
    if (!crawled.summary.complete) complete = false;
    for (const skip of crawled.summary.skips) {
      skipped.push({
        sourceId: source.id,
        sourceName: source.name,
        reason: crawlSkipReason(skip.reason),
        detail: `${skip.url}: ${skip.detail}`,
      });
    }

    for (const envelope of crawled.envelopes) {
      const payload = envelope.payload as ListingPayload;
      listings.push({
        sourceId: source.id,
        sourceName: source.name,
        payload,
        ...(input.thesis ? { fit: scoreThesisFit(profileFrom(payload), input.thesis) } : {}),
      });
    }
  }

  return { listings: rank(listings), skipped, pagesFetched, spendBySourceId, complete };
}
