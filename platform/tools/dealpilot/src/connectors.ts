import type { SourceConnector, SourceQuery } from "@bridge/sourcing";
import { createApiClientConnector, createEmailAlertConnector } from "@bridge/sourcing";
import type { GoogleGatewayFactory } from "@bridge/integrations-google";

// The two P0 connectors named in the plan (BizBuySell email-alerts, BusinessBroker.net) — proof
// implementations only, built on @bridge/sourcing's shared connector shapes, never a bespoke
// scraper. Real HTTP/parsing logic is injected so these stay swappable and testable without a
// live network call, same pattern as packages/sourcing's own proof connectors.

// ---------------------------------------------------------------------------------------------
// BizBuySell — email-alert parser (real parse logic; live end-to-end)
// ---------------------------------------------------------------------------------------------
//
// BizBuySell's own site (bizbuysell.com) is Akamai-fronted and returns 403 to unauthenticated
// fetches (verified 2026-07-04) — matches the architecture doc's call to pin it to a proxy tier,
// which this platform does not operate. There is nothing to scrape here anyway: the documented
// pattern is a SAVED-SEARCH ALERT EMAIL the user already receives in their own inbox. Real wiring
// therefore composes the ONE governed Google integration (createGmailFetchMessages below) rather
// than owning any OAuth/HTTP client — per the plan's "no tool-owned OAuth" rule.

const MONEY_RE = /\$\s?([\d,]+(?:\.\d+)?)\s*([kKmM])?/;
const LOCATION_RE = /\b([A-Z][a-zA-Z.\s]+,\s*[A-Z]{2})\b/;
const BIZBUYSELL_URL_RE = /https?:\/\/(?:www\.)?bizbuysell\.com\/[^\s"'<>)]+/i;
const SUBJECT_PREFIX_RE = /^(new listing alert|business alert|saved search alert|listing alert)\s*[:\-]\s*/i;

function stripHtml(input: string): string {
  return input
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function parseMoney(text: string): number | undefined {
  const m = text.match(MONEY_RE);
  if (!m) return undefined;
  let value = Number.parseFloat(m[1]!.replace(/,/g, ""));
  if (Number.isNaN(value)) return undefined;
  const suffix = m[2]?.toLowerCase();
  if (suffix === "k") value *= 1_000;
  if (suffix === "m") value *= 1_000_000;
  return value;
}

/** Pull the value following a labeled field like "Asking Price: $850,000" (case-insensitive, tolerant of colon/dash separators). */
function labeledField(body: string, ...labels: string[]): string | undefined {
  for (const label of labels) {
    const re = new RegExp(`${label}\\s*[:\\-]\\s*([^\\n]+)`, "i");
    const m = body.match(re);
    if (m) return m[1]!.trim();
  }
  return undefined;
}

/**
 * Real parser for BizBuySell saved-search alert emails. Extracts the fields DealPilot's pipeline
 * expects (name/industry/geo/askPrice/revenue/sde/url) from a plain-text-or-HTML message body.
 * Returns null when the message doesn't look like a listing alert at all (e.g. a digest email with
 * no listing content) — unparseable messages are skipped, never fabricated.
 */
export function parseBizBuySellAlert(message: { subject: string; body: string }): Record<string, unknown> | null {
  const body = stripHtml(message.body);
  const url = body.match(BIZBUYSELL_URL_RE)?.[0];

  const titleField = labeledField(body, "business", "listing", "title");
  // Only trust the subject as a listing name when it actually carries a known alert prefix —
  // otherwise an unrelated email's subject (e.g. an account-settings notice) would look "named".
  const subjectMatch = message.subject.match(SUBJECT_PREFIX_RE);
  const subjectName = subjectMatch ? message.subject.slice(subjectMatch[0].length).trim() : undefined;
  const name = titleField || subjectName || undefined;

  const industry = labeledField(body, "industry", "business type", "category");
  const locationField = labeledField(body, "location");
  const geo = locationField ?? body.match(LOCATION_RE)?.[1]?.trim();

  const askPriceField = labeledField(body, "asking price", "price");
  const askPrice = askPriceField ? parseMoney(askPriceField) : undefined;

  const revenueField = labeledField(body, "gross revenue", "revenue", "annual revenue");
  const revenue = revenueField ? parseMoney(revenueField) : undefined;

  const sdeField = labeledField(body, "cash flow", "sde", "seller discretionary earnings");
  const sde = sdeField ? parseMoney(sdeField) : undefined;

  // Nothing usable — this wasn't a listing alert (e.g. an account/marketing email); skip it.
  if (!name && askPrice === undefined && revenue === undefined && sde === undefined) return null;

  const payload: Record<string, unknown> = {};
  if (name) payload.name = name;
  if (industry) payload.industry = industry;
  if (geo) payload.geo = geo;
  if (askPrice !== undefined) payload.askPrice = askPrice;
  if (revenue !== undefined) payload.revenue = revenue;
  if (sde !== undefined) payload.sde = sde;
  if (url) payload.url = url;
  return payload;
}

/**
 * Composes the ONE governed Google integration to read the user's own saved-search alert emails —
 * this connector never owns OAuth or calls Gmail directly. `query` defaults to BizBuySell's known
 * alert sender addresses; callers can narrow further (e.g. a per-tenant label).
 */
export function createGmailFetchMessages(
  gateways: GoogleGatewayFactory,
  integrationId: string,
  query = "from:(alerts@bizbuysell.com OR noreply@bizbuysell.com OR savedsearch@bizbuysell.com)",
): (sourceQuery: SourceQuery) => Promise<Array<{ subject: string; body: string }>> {
  return async () => {
    const gateway = await gateways.forIntegration(integrationId);
    const { threads } = await gateway.fetchThreads({ query });
    return threads.flatMap((thread) =>
      thread.messages.map((message) => ({ subject: message.subject || thread.subject, body: message.bodyText })),
    );
  };
}

export function createBizBuySellAlertConnector(
  fetchMessages: (query: SourceQuery) => Promise<Array<{ subject: string; body: string }>>,
  parse: (message: { subject: string; body: string }) => Record<string, unknown> | null = parseBizBuySellAlert,
): SourceConnector {
  return createEmailAlertConnector({ id: "bizbuysell-alerts", fetchMessages, parse, costPerMessage: 0.5 });
}

// ---------------------------------------------------------------------------------------------
// BusinessBroker.net — API connector
// ---------------------------------------------------------------------------------------------
//
// businessbroker.net/robots.txt (checked 2026-07-04) Disallows exactly the paths a live connector
// would need — `/listings/` and every query-string URL (`/*?`, which covers its search endpoint) —
// and the site publishes no RSS/sitemap feed to fall back to. A scraper here would violate the
// site's stated crawl policy, so this connector does NOT fetch live: `fetcher` stays an injected
// seam (a licensed/partner data feed, once one exists, plugs in without touching this file — see
// docs/wiki/known-issues.md "BusinessBroker.net live fetch blocked by robots.txt"). What IS real
// here is the normalization: turning whatever shape a compliant source hands back into DealPilot's
// payload fields, tolerant of the inconsistent key-casing/labeling broker feeds tend to use.

const BBN_FIELD_ALIASES: Record<string, string[]> = {
  name: ["name", "title", "businessName", "listingTitle"],
  industry: ["industry", "category", "businessType"],
  geo: ["geo", "location", "city", "region"],
  askPrice: ["askPrice", "askingPrice", "price"],
  revenue: ["revenue", "grossRevenue", "annualRevenue"],
  sde: ["sde", "cashFlow", "cashflow", "sellerDiscretionaryEarnings"],
  url: ["url", "link", "listingUrl"],
};

function coerceMoney(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") return parseMoney(value) ?? (value.trim() ? Number(value.replace(/[,$]/g, "")) : undefined);
  return undefined;
}

/** Maps a raw broker-feed row (arbitrary key casing/aliasing) onto DealPilot's payload shape. */
export function normalizeBusinessBrokerRow(row: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [field, aliases] of Object.entries(BBN_FIELD_ALIASES)) {
    const key = aliases.find((alias) => row[alias] !== undefined && row[alias] !== null && row[alias] !== "");
    if (!key) continue;
    const raw = row[key];
    payload[field] = field === "askPrice" || field === "revenue" || field === "sde" ? coerceMoney(raw) : raw;
  }
  return payload;
}

/** Confidence scales with how many of the payload's core fields the row actually populated. */
function bbnConfidence(row: Record<string, unknown>): number {
  const core = ["name", "askPrice", "revenue", "sde"] as const;
  const filled = core.filter((field) => row[field] !== undefined).length;
  return 0.5 + 0.1 * filled; // 0.5 floor (API tier is structured but source is 3rd-party) up to 0.9
}

export function createBusinessBrokerNetConnector(
  fetcher: (query: SourceQuery) => Promise<Array<Record<string, unknown>>>,
): SourceConnector {
  return createApiClientConnector({
    id: "businessbroker-net",
    fetcher: async (query) => (await fetcher(query)).map(normalizeBusinessBrokerRow),
    costPerCall: 1,
    confidenceOf: bbnConfidence,
  });
}
