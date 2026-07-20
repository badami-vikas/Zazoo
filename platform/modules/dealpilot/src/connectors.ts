import type { CaptureEnvelope, SourceConnector, SourceQuery } from "@bridge/sourcing";
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
// rather than owning any OAuth/HTTP client; credential ownership stays with the Integration.

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
type AlertMessage = { id?: string; subject: string; body: string };

export interface GmailContinuation {
  cursorKey: string;
  pageToken?: string;
  checkpointAt?: string;
  visitedPageTokens?: string[];
}

export interface GmailFetchReceipt {
  organizationId: string;
  sourceId: string;
  batchId: string;
  ownerId: string;
  complete: boolean;
  checkpointAt?: string;
}

export interface GmailFetchState {
  seenMessageIds: string[];
  continuation?: GmailContinuation;
  lastFetchComplete: boolean;
  lastCheckpointAt?: string;
  pending?: {
    batchId: string;
    ownerId: string;
    seenMessageIds: string[];
    continuation: GmailContinuation | null;
    complete: boolean;
    checkpointAt?: string;
  };
}

export interface GmailFetchStateStore {
  load(organizationId: string, sourceId: string): Promise<GmailFetchState>;
  stage(receipt: GmailFetchReceipt, seenMessageIds: string[], continuation: GmailContinuation | null): Promise<void>;
  acknowledge(receipt: GmailFetchReceipt): Promise<void>;
  discard(receipt: GmailFetchReceipt): Promise<void>;
  fail(input: {
    organizationId: string;
    sourceId: string;
    batchId: string;
    ownerId: string;
    cursorKey: string;
  }): Promise<void>;
}

const MAX_SEEN_MESSAGE_IDS = 10_000;

function emptyGmailFetchState(): GmailFetchState {
  return { seenMessageIds: [], lastFetchComplete: false };
}

function gmailStateKey(organizationId: string, sourceId: string): string {
  return JSON.stringify([organizationId, sourceId]);
}

export class InMemoryGmailFetchStateStore implements GmailFetchStateStore {
  readonly rows = new Map<string, GmailFetchState>();

  async load(organizationId: string, sourceId: string): Promise<GmailFetchState> {
    return structuredClone(this.rows.get(gmailStateKey(organizationId, sourceId)) ?? emptyGmailFetchState());
  }

  async stage(
    receipt: GmailFetchReceipt,
    seenMessageIds: string[],
    continuation: GmailContinuation | null,
  ): Promise<void> {
    const key = gmailStateKey(receipt.organizationId, receipt.sourceId);
    const current = this.rows.get(key) ?? emptyGmailFetchState();
    if (current.pending) {
      throw new Error(`Gmail fetch for Source "${receipt.sourceId}" must be acknowledged or discarded before retry`);
    }
    this.rows.set(key, {
      ...current,
      pending: {
        batchId: receipt.batchId,
        ownerId: receipt.ownerId,
        seenMessageIds: [...seenMessageIds],
        continuation: continuation ? structuredClone(continuation) : null,
        complete: receipt.complete,
        ...(receipt.checkpointAt ? { checkpointAt: receipt.checkpointAt } : {}),
      },
    });
  }

  async acknowledge(receipt: GmailFetchReceipt): Promise<void> {
    const key = gmailStateKey(receipt.organizationId, receipt.sourceId);
    const current = this.rows.get(key) ?? emptyGmailFetchState();
    const pending = current.pending;
    if (
      !pending ||
      pending.batchId !== receipt.batchId ||
      pending.ownerId !== receipt.ownerId ||
      pending.complete !== receipt.complete ||
      pending.checkpointAt !== receipt.checkpointAt
    ) {
      throw new Error(`Gmail fetch acknowledgement for Source "${receipt.sourceId}" is stale`);
    }
    const seen = [...new Set([...current.seenMessageIds, ...pending.seenMessageIds])].slice(
      -MAX_SEEN_MESSAGE_IDS,
    );
    this.rows.set(key, {
      seenMessageIds: seen,
      ...(pending.continuation ? { continuation: structuredClone(pending.continuation) } : {}),
      lastFetchComplete: pending.complete,
      ...(pending.checkpointAt ? { lastCheckpointAt: pending.checkpointAt } : {}),
    });
  }

  async discard(receipt: GmailFetchReceipt): Promise<void> {
    const key = gmailStateKey(receipt.organizationId, receipt.sourceId);
    const current = this.rows.get(key);
    if (!current?.pending) return;
    if (
      current.pending.batchId !== receipt.batchId ||
      current.pending.ownerId !== receipt.ownerId ||
      current.pending.complete !== receipt.complete ||
      current.pending.checkpointAt !== receipt.checkpointAt
    ) {
      throw new Error(`Gmail fetch discard for Source "${receipt.sourceId}" is stale`);
    }
    const { pending: _pending, ...committed } = current;
    this.rows.set(key, committed);
  }

  async fail(input: {
    organizationId: string;
    sourceId: string;
    batchId: string;
    ownerId: string;
    cursorKey: string;
  }): Promise<void> {
    const key = gmailStateKey(input.organizationId, input.sourceId);
    const current = this.rows.get(key) ?? emptyGmailFetchState();
    const { pending, continuation, ...rest } = current;
    this.rows.set(key, {
      ...rest,
      ...(continuation?.cursorKey !== input.cursorKey ? { continuation } : {}),
      ...(pending &&
      (pending.batchId !== input.batchId || pending.ownerId !== input.ownerId)
        ? { pending }
        : {}),
      lastFetchComplete: false,
    });
  }
}

export type AlertMessageFetcher = ((
  sourceQuery: SourceQuery,
) => Promise<AlertMessage[]>) & {
  lastFetchComplete?(sourceId: string, organizationId?: string): boolean;
  lastCheckpointAt?(sourceId: string, organizationId?: string): string | undefined;
  lastReceipt?(sourceId: string, organizationId?: string): GmailFetchReceipt | undefined;
  acknowledge?(sourceId: string, organizationId?: string): Promise<void>;
  discard?(sourceId: string, organizationId?: string): Promise<void>;
};

const BIZBUYSELL_ALERT_SENDERS = new Set([
  "alerts@bizbuysell.com",
  "noreply@bizbuysell.com",
  "savedsearch@bizbuysell.com",
]);
const GMAIL_CURSOR_OVERLAP_MS = 24 * 60 * 60 * 1_000;
const MAX_GMAIL_PAGES_PER_RUN = 5;

export function createGmailFetchMessages(
  gateways: GoogleGatewayFactory,
  integrationId: string,
  query = "from:(alerts@bizbuysell.com OR noreply@bizbuysell.com OR savedsearch@bizbuysell.com)",
  options: {
    stateStore?: GmailFetchStateStore;
    instanceId?: string;
  } = {},
): AlertMessageFetcher {
  const stateStore = options.stateStore ?? new InMemoryGmailFetchStateStore();
  const ownerId = options.instanceId ?? globalThis.crypto.randomUUID();
  const receiptsBySource = new Map<string, GmailFetchReceipt>();
  const summariesBySource = new Map<
    string,
    { complete: boolean; checkpointAt?: string }
  >();
  const fetcher: AlertMessageFetcher = async (sourceQuery) => {
    const sourceId = sourceQuery.hints.sourceId ?? "default";
    const organizationId = sourceQuery.hints.organizationId ?? "default";
    const receiptKey = gmailStateKey(organizationId, sourceId);
    let committed = await stateStore.load(organizationId, sourceId);
    if (committed.pending?.ownerId === ownerId) {
      throw new Error(`Gmail fetch for Source "${sourceId}" must be acknowledged or discarded before retry`);
    }
    if (committed.pending) {
      await stateStore.discard({
        organizationId,
        sourceId,
        batchId: committed.pending.batchId,
        ownerId: committed.pending.ownerId,
        complete: committed.pending.complete,
        ...(committed.pending.checkpointAt ? { checkpointAt: committed.pending.checkpointAt } : {}),
      });
      committed = await stateStore.load(organizationId, sourceId);
    }
    const gateway = await gateways.forIntegration(integrationId);
    const requestedMax = Number(sourceQuery.hints.maxResults);
    const maxResults =
      Number.isInteger(requestedMax) && requestedMax > 0
        ? Math.min(requestedMax, 100)
        : 25;
    const cursorKey = sourceQuery.hints.after ?? "";
    const cursorAt = Date.parse(cursorKey);
    const scanAfter = Number.isFinite(cursorAt)
      ? cursorAt - GMAIL_CURSOR_OVERLAP_MS
      : Number.NaN;
    const effectiveQuery = Number.isFinite(scanAfter)
      ? `${query} after:${Math.floor(scanAfter / 1_000)}`
      : query;
    const seen = new Set(committed.seenMessageIds);
    const stagedSeen = new Set<string>();
    const unseen: AlertMessage[] = [];
    const committedContinuation = committed.continuation;
    const continuationMatches = committedContinuation?.cursorKey === cursorKey;
    const checkpointAt = continuationMatches
      ? committedContinuation?.checkpointAt ?? sourceQuery.hints.scanStartedAt
      : sourceQuery.hints.scanStartedAt;
    const continuationFor = (token?: string): GmailContinuation => ({
      cursorKey,
      ...(token ? { pageToken: token } : {}),
      ...(checkpointAt ? { checkpointAt } : {}),
    });
    let pageToken =
      continuationMatches
        ? committedContinuation.pageToken
        : undefined;
    let nextContinuation: GmailContinuation | null = null;
    let firstIncompletePage: GmailContinuation | null = null;
    const visitedPageTokens = new Set<string>(
      continuationMatches ? committedContinuation?.visitedPageTokens ?? [] : [],
    );
    let pagesFetched = 0;
    let complete = true;
    const batchId = globalThis.crypto.randomUUID();
    try {
      do {
        const currentPageToken = pageToken;
        const pageKey = currentPageToken ?? "__first_page__";
        if (visitedPageTokens.has(pageKey)) {
          throw new Error("Gmail pagination returned a repeated page token");
        }
        visitedPageTokens.add(pageKey);
        const result = await gateway.fetchThreads({
          query: effectiveQuery,
          maxResults,
          ...(currentPageToken ? { pageToken: currentPageToken } : {}),
        });
        pagesFetched += 1;
        let pageIncomplete = result.incomplete === true;
        if (result.incomplete && !firstIncompletePage) {
          complete = false;
          firstIncompletePage = continuationFor(currentPageToken);
        }
        let moreEligibleMessages = false;
        for (const thread of result.threads) {
          for (const message of thread.messages) {
            if (!BIZBUYSELL_ALERT_SENDERS.has(message.from.email.toLowerCase())) continue;
            const id = message.messageId || `${thread.threadId}:${message.date}:${message.subject}`;
            if (seen.has(id) || stagedSeen.has(id)) continue;
            const receivedAt = Date.parse(message.receivedAt ?? "");
            if (Number.isFinite(scanAfter) && Number.isFinite(receivedAt) && receivedAt <= scanAfter) {
              stagedSeen.add(id);
              continue;
            }
            if (Number.isFinite(cursorAt) && !Number.isFinite(receivedAt) && !firstIncompletePage) {
              complete = false;
              firstIncompletePage = continuationFor(currentPageToken);
              pageIncomplete = true;
            }
            if (unseen.length >= maxResults) {
              moreEligibleMessages = true;
              break;
            }
            stagedSeen.add(id);
            unseen.push({
              id,
              subject: message.subject || thread.subject,
              body: message.bodyText,
            });
          }
          if (moreEligibleMessages) break;
        }
        if (moreEligibleMessages) {
          complete = false;
          nextContinuation = firstIncompletePage ?? continuationFor(currentPageToken);
          break;
        }
        if (pageIncomplete) {
          complete = false;
          nextContinuation = firstIncompletePage ?? continuationFor(currentPageToken);
          break;
        }
        if (!result.nextPageToken) {
          if (firstIncompletePage) {
            complete = false;
            nextContinuation = firstIncompletePage;
          }
          break;
        }
        if (visitedPageTokens.has(result.nextPageToken)) {
          throw new Error("Gmail pagination returned a repeated page token");
        }
        if (unseen.length >= maxResults) {
          complete = false;
          nextContinuation = firstIncompletePage ?? continuationFor(result.nextPageToken);
          break;
        }
        if (pagesFetched >= MAX_GMAIL_PAGES_PER_RUN) {
          complete = false;
          nextContinuation = firstIncompletePage ?? continuationFor(result.nextPageToken);
          break;
        }
        pageToken = result.nextPageToken;
      } while (true);
      let pendingContinuation = complete ? null : nextContinuation;
      if (pendingContinuation) {
        const persistedVisited = new Set(visitedPageTokens);
        persistedVisited.delete(pendingContinuation.pageToken ?? "__first_page__");
        pendingContinuation = {
          ...pendingContinuation,
          visitedPageTokens: [...persistedVisited],
        };
      }
      const receipt: GmailFetchReceipt = {
        organizationId,
        sourceId,
        batchId,
        ownerId,
        complete,
        ...(checkpointAt ? { checkpointAt } : {}),
      };
      await stateStore.stage(receipt, [...stagedSeen], pendingContinuation);
      receiptsBySource.set(receiptKey, receipt);
      summariesBySource.set(receiptKey, {
        complete,
        ...(checkpointAt ? { checkpointAt } : {}),
      });
      return unseen;
    } catch (error) {
      if (receiptsBySource.get(receiptKey)?.batchId === batchId) {
        receiptsBySource.delete(receiptKey);
      }
      const priorSummary = summariesBySource.get(receiptKey);
      summariesBySource.set(receiptKey, {
        complete: false,
        ...(priorSummary?.checkpointAt
          ? { checkpointAt: priorSummary.checkpointAt }
          : {}),
      });
      await stateStore.fail({ organizationId, sourceId, batchId, ownerId, cursorKey });
      throw error;
    }
  };
  const receiptKey = (sourceId: string, organizationId = "default") =>
    gmailStateKey(organizationId, sourceId);
  fetcher.lastFetchComplete = (sourceId, organizationId) =>
    summariesBySource.get(receiptKey(sourceId, organizationId))?.complete ?? false;
  fetcher.lastCheckpointAt = (sourceId, organizationId) =>
    summariesBySource.get(receiptKey(sourceId, organizationId))?.checkpointAt;
  fetcher.lastReceipt = (sourceId, organizationId) =>
    receiptsBySource.get(receiptKey(sourceId, organizationId));
  fetcher.acknowledge = async (sourceId, organizationId) => {
    const key = receiptKey(sourceId, organizationId);
    const receipt = receiptsBySource.get(key);
    if (!receipt) return;
    await stateStore.acknowledge(receipt);
    receiptsBySource.delete(key);
  };
  fetcher.discard = async (sourceId, organizationId) => {
    const key = receiptKey(sourceId, organizationId);
    const receipt = receiptsBySource.get(key);
    if (!receipt) return;
    await stateStore.discard(receipt);
    receiptsBySource.delete(key);
  };
  return fetcher;
}

/**
 * Batch parse-rate summary for one `fetchMessages` call's worth of alert emails. Exposed so
 * callers (and tests) can inspect the rate directly instead of only ever seeing "fewer results"
 * with no signal as to why.
 */
export interface ParseBatchSummary {
  attempted: number;
  parsed: number;
  parseRate: number; // 0..1; 1 when attempted === 0 (nothing to fail on)
}

/** Below this parse rate (with at least this many attempts) a batch is considered suspect. */
const LOW_PARSE_RATE_THRESHOLD = 0.5;
const LOW_PARSE_RATE_MIN_ATTEMPTS = 2;

/**
 * When more than half a batch fails to parse, logs a loud `console.warn` naming the likely cause
 * explicitly (BizBuySell template drift) — matching this platform's existing convention of plain
 * `console.warn`/`console.error` calls prefixed with a `"<namespace>: ..."` label (see
 * @bridge/integrations-google's gateway-google.ts / intake.ts; there is no shared logger/metrics
 * module in this monorepo to plug into instead).
 */
function warnIfLowParseRate(attempted: number, parsed: number): void {
  const parseRate = attempted === 0 ? 1 : parsed / attempted;
  if (attempted >= LOW_PARSE_RATE_MIN_ATTEMPTS && parseRate < LOW_PARSE_RATE_THRESHOLD) {
    console.warn(
      `bizbuysell-alerts: parse rate ${(parseRate * 100).toFixed(0)}% (${parsed}/${attempted}) fell below the ` +
        `${(LOW_PARSE_RATE_THRESHOLD * 100).toFixed(0)}% healthy floor for this batch — likely cause: TEMPLATE ` +
        `DRIFT. BizBuySell appears to have changed its alert-email template and the regex-based parser ` +
        `(parseBizBuySellAlert) no longer matches it. Results are being silently under-reported, not failing ` +
        `loudly, so check this before trusting a sudden drop in DealPilot listings.`,
    );
  }
}

/**
 * Runs `parse` (default `parseBizBuySellAlert`) over a batch of alert messages, tracking
 * successful-parses vs total-attempts. Warns loudly (see `warnIfLowParseRate`) when the batch's
 * parse rate is unhealthy, and returns the batch summary alongside the parsed results so callers
 * can inspect the rate themselves rather than only seeing fewer results with no signal why.
 */
export function parseBizBuySellAlertBatch(
  messages: Array<{ subject: string; body: string }>,
  parse: (message: { subject: string; body: string }) => Record<string, unknown> | null = parseBizBuySellAlert,
): { results: Array<Record<string, unknown>>; summary: ParseBatchSummary } {
  const results: Array<Record<string, unknown>> = [];
  let parsed = 0;
  for (const message of messages) {
    const payload = parse(message);
    if (payload) {
      parsed += 1;
      results.push(payload);
    }
  }
  const attempted = messages.length;
  warnIfLowParseRate(attempted, parsed);

  return { results, summary: { attempted, parsed, parseRate: attempted === 0 ? 1 : parsed / attempted } };
}

export interface BizBuySellAlertConnector extends SourceConnector {
  fetchWithSummary(query: SourceQuery): Promise<{
    envelopes: CaptureEnvelope[];
    summary: ParseBatchSummary & {
      complete: boolean;
      checkpointAt?: string;
      receipt?: GmailFetchReceipt;
    };
  }>;
  acknowledge(query: SourceQuery): Promise<void>;
  discard(query: SourceQuery): Promise<void>;
}

export function createBizBuySellAlertConnector(
  fetchMessages: AlertMessageFetcher,
  parse: (message: { subject: string; body: string }) => Record<string, unknown> | null = parseBizBuySellAlert,
): BizBuySellAlertConnector {
  const costPerMessage = 0.5;
  const sourceId = (query: SourceQuery) => query.hints.sourceId ?? "default";
  const organizationId = (query: SourceQuery) => query.hints.organizationId ?? "default";
  const acknowledge = async (query: SourceQuery) => {
    await fetchMessages.acknowledge?.(sourceId(query), organizationId(query));
  };
  const discard = async (query: SourceQuery) => {
    await fetchMessages.discard?.(sourceId(query), organizationId(query));
  };
  const fetchWithSummary = async (query: SourceQuery) => {
    const batchTally = { attempted: 0, parsed: 0 };
    const connector = createEmailAlertConnector({
      id: "bizbuysell-alerts",
      fetchMessages,
      parse(message) {
        const payload = parse(message);
        batchTally.attempted += 1;
        if (payload) batchTally.parsed += 1;
        return payload;
      },
      costPerMessage,
    });
    let envelopes: CaptureEnvelope[];
    try {
      envelopes = await connector.fetch(query);
    } catch (error) {
      await discard(query);
      throw error;
    }
    const checkpointAt = fetchMessages.lastCheckpointAt?.(sourceId(query), organizationId(query));
    const receipt = fetchMessages.lastReceipt?.(sourceId(query), organizationId(query));
    const summary = {
      ...batchTally,
      parseRate: batchTally.attempted === 0 ? 1 : batchTally.parsed / batchTally.attempted,
      complete: fetchMessages.lastFetchComplete?.(sourceId(query), organizationId(query)) ?? true,
      ...(checkpointAt ? { checkpointAt } : {}),
      ...(receipt ? { receipt } : {}),
    };
    warnIfLowParseRate(summary.attempted, summary.parsed);
    return { envelopes, summary };
  };
  return {
    id: "bizbuysell-alerts",
    tier: "email",
    estimateCost: () => costPerMessage,
    async fetch(query) {
      const batch = await fetchWithSummary(query);
      await acknowledge(query);
      return batch.envelopes;
    },
    fetchWithSummary,
    acknowledge,
    discard,
  };
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
