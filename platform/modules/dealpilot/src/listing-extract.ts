import { findLocation, labeledField, parseMoney, stripHtml } from "./text-fields.js";

// HTML -> DealPilot listing payloads.
//
// Two strategies, tried in order, because broker sites split cleanly into two populations:
//
//  1. JSON-LD. Most of the WordPress/Yoast sites in the catalog (POE Group, Saint Louis Group,
//     Innovative, VR Gateway) emit schema.org Product/Offer blocks. That is STRUCTURED data the
//     site publishes deliberately for machines — it is the most accurate and the least likely to
//     break, so it is tried first and trusted when present.
//  2. Listing cards. Sites without JSON-LD get a block-splitting pass: cut the page into candidate
//     card regions, then read labeled fields out of each ("Asking Price: $850,000").
//
// There is no third strategy that guesses. A page that yields neither returns an empty array, and
// the crawl summary reports a page fetched with zero listings — an honest "we could not read this"
// rather than a fabricated row. Selector drift on a broker site is normal and expected; it must
// show up as missing data, never as invented data.
//
// No DOM parser is available in this monorepo, so this is string/regex work in the same style as
// the BizBuySell alert parser it shares helpers with. That is a real limitation: deeply nested or
// unusually marked-up pages will fall back to the card heuristic and may extract less. Preferring
// under-extraction to mis-extraction is the deliberate trade.

export interface ListingPayload {
  name?: string;
  industry?: string;
  geo?: string;
  askPrice?: number;
  revenue?: number;
  sde?: number;
  url?: string;
}

const JSON_LD_RE = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/** Every JSON-LD object on the page, flattened out of @graph containers and arrays. */
export function readJsonLdNodes(html: string): Array<Record<string, unknown>> {
  const nodes: Array<Record<string, unknown>> = [];
  for (const match of html.matchAll(JSON_LD_RE)) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // A malformed JSON-LD block is skipped, never partially salvaged.
      continue;
    }
    const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
    while (queue.length > 0) {
      const node = queue.shift();
      if (!node || typeof node !== "object") continue;
      const record = node as Record<string, unknown>;
      const graph = record["@graph"];
      if (Array.isArray(graph)) {
        queue.push(...graph);
        continue;
      }
      nodes.push(record);
      // ItemList entries hold the actual listings.
      const items = record.itemListElement;
      if (Array.isArray(items)) {
        for (const item of items) {
          if (item && typeof item === "object") {
            const entry = item as Record<string, unknown>;
            queue.push(entry.item && typeof entry.item === "object" ? entry.item : entry);
          }
        }
      }
    }
  }
  return nodes;
}

function typeOf(node: Record<string, unknown>): string[] {
  const raw = node["@type"];
  if (typeof raw === "string") return [raw.toLowerCase()];
  if (Array.isArray(raw)) return raw.filter((t): t is string => typeof t === "string").map((t) => t.toLowerCase());
  return [];
}

const LISTING_TYPES = new Set(["product", "offer", "business", "localbusiness", "service", "realestatelisting"]);

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function moneyFrom(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const direct = Number(value.replace(/[,$\s]/g, ""));
    if (!Number.isNaN(direct) && value.trim() !== "") return direct;
    return parseMoney(value);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return moneyFrom(record.price ?? record.value ?? record.lowPrice);
  }
  return undefined;
}

function absolute(url: string | undefined, pageUrl: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url, pageUrl).toString();
  } catch {
    return undefined;
  }
}

/** Reads listing payloads out of the page's JSON-LD, if it publishes any. */
export function extractFromJsonLd(html: string, pageUrl: string): ListingPayload[] {
  const rows: ListingPayload[] = [];
  for (const node of readJsonLdNodes(html)) {
    if (!typeOf(node).some((type) => LISTING_TYPES.has(type))) continue;
    const offers = node.offers && typeof node.offers === "object" ? (node.offers as Record<string, unknown>) : {};
    const address = node.address && typeof node.address === "object" ? (node.address as Record<string, unknown>) : {};

    const name = firstString(node.name, node.headline, node.title);
    const askPrice = moneyFrom(node.price ?? offers.price ?? offers.lowPrice);
    const geo =
      firstString(node.areaServed, address.addressLocality && address.addressRegion
        ? `${String(address.addressLocality)}, ${String(address.addressRegion)}`
        : undefined, address.addressLocality, address.addressRegion) ?? undefined;
    const industry = firstString(node.category, node.brand, node.industry);
    const url = absolute(firstString(node.url, offers.url), pageUrl);

    // A node with no name AND no price is structural markup (a breadcrumb, an org card), not a listing.
    if (!name && askPrice === undefined) continue;

    rows.push({
      ...(name ? { name } : {}),
      ...(industry ? { industry } : {}),
      ...(geo ? { geo } : {}),
      ...(askPrice !== undefined ? { askPrice } : {}),
      ...(url ? { url } : {}),
    });
  }
  return rows;
}

// Blocks that plausibly wrap one listing card. Broad on purpose: the money check below is what
// actually decides, so a generous split costs nothing but a few discarded candidates.
const BLOCK_SPLIT_RE = /<(?:article|li|tr)\b[^>]*>|<div\b[^>]*class=["'][^"']*(?:listing|property|business|card|result|opportunity)[^"']*["'][^>]*>/gi;
const HREF_RE = /<a\b[^>]*href=["']([^"'#]+)["']/i;
const HEADING_RE = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i;

/**
 * Splits a page into candidate listing blocks and reads labeled fields from each. A block must
 * carry a money value AND a name to count — either alone is far more likely to be navigation
 * chrome or a sidebar than a real listing.
 */
export function extractFromCards(html: string, pageUrl: string): ListingPayload[] {
  const boundaries: number[] = [];
  for (const match of html.matchAll(BLOCK_SPLIT_RE)) {
    if (match.index !== undefined) boundaries.push(match.index);
  }
  if (boundaries.length === 0) return [];
  boundaries.push(html.length);

  const rows: ListingPayload[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < boundaries.length - 1; i += 1) {
    const block = html.slice(boundaries[i]!, boundaries[i + 1]!);
    // A block big enough to hold the whole page is a container, not a card.
    if (block.length > 20_000) continue;
    const text = stripHtml(block);
    if (!text) continue;

    const askPriceField = labeledField(text, "asking price", "price", "list price");
    const askPrice = askPriceField ? parseMoney(askPriceField) : undefined;
    const revenueField = labeledField(text, "gross revenue", "annual revenue", "revenue", "sales");
    const revenue = revenueField ? parseMoney(revenueField) : undefined;
    const sdeField = labeledField(text, "cash flow", "sde", "seller discretionary earnings", "ebitda");
    const sde = sdeField ? parseMoney(sdeField) : undefined;
    if (askPrice === undefined && revenue === undefined && sde === undefined) continue;

    const headingHtml = block.match(HEADING_RE)?.[1];
    const name =
      (headingHtml ? stripHtml(headingHtml) : undefined) ||
      labeledField(text, "business", "listing", "title") ||
      undefined;
    if (!name) continue;

    const url = absolute(block.match(HREF_RE)?.[1], pageUrl);
    const geo = labeledField(text, "location", "area", "region") ?? findLocation(text);
    const industry = labeledField(text, "industry", "business type", "category", "sector");

    const key = url ?? `${name}:${askPrice ?? revenue ?? sde}`;
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({
      name,
      ...(industry ? { industry } : {}),
      ...(geo ? { geo } : {}),
      ...(askPrice !== undefined ? { askPrice } : {}),
      ...(revenue !== undefined ? { revenue } : {}),
      ...(sde !== undefined ? { sde } : {}),
      ...(url ? { url } : {}),
    });
  }
  return rows;
}

export interface ExtractionResult {
  rows: ListingPayload[];
  strategy: "json_ld" | "cards" | "none";
}

/**
 * Runs JSON-LD first, then the card heuristic, and reports which one produced the rows so a
 * source that silently degrades from structured to heuristic extraction is visible rather than
 * quietly getting worse.
 */
export function extractListings(html: string, pageUrl: string): ExtractionResult {
  const structured = extractFromJsonLd(html, pageUrl);
  if (structured.length > 0) return { rows: structured, strategy: "json_ld" };
  const cards = extractFromCards(html, pageUrl);
  if (cards.length > 0) return { rows: cards, strategy: "cards" };
  return { rows: [], strategy: "none" };
}

/** Adapter matching the crawler's `ListingExtractor` seam. */
export function listingExtractor(html: string, pageUrl: string): Array<Record<string, unknown>> {
  return extractListings(html, pageUrl).rows as Array<Record<string, unknown>>;
}
