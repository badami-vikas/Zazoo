/**
 * GoogleApiGateway — the REAL egress adapter (googleapis). Binds the GoogleGateway
 * port to Gmail v1 + Calendar v3. Constructed with an authenticated OAuth client;
 * the factory loads + refreshes tokens from the LOCAL SecretStore.
 *
 * This is the only file that talks to the Google internet APIs. Everything upstream
 * is governed by the pipeline/gate.
 */
import { google, type Auth } from "googleapis";
import type { SecretStore } from "@bridge/local";
import type {
  CalendarEvent,
  CreateDraftResult,
  CreateEventEnvelope,
  CreateEventResult,
  EmailAddress,
  FetchEventsOpts,
  FetchEventsResult,
  FetchThreadsOpts,
  FetchThreadsResult,
  GmailMessage,
  GmailThread,
  SendEmailEnvelope,
} from "./contracts.js";
import type { GoogleGateway, GoogleGatewayFactory } from "./gateway.js";
import { clientFromToken, type GoogleOAuthConfig } from "./oauth.js";

const DEFAULT_LOOKAHEAD_MS = 90 * 24 * 60 * 60 * 1000;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RFC3339_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function calendarDateValue(value: string): { date: string } | { dateTime: string } {
  if (DATE_ONLY_PATTERN.test(value)) {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      throw new Error(`google calendar: invalid all-day date ${value}`);
    }
    return { date: value };
  }
  if (!RFC3339_PATTERN.test(value) || Number.isNaN(new Date(value).getTime())) {
    throw new Error(`google calendar: invalid RFC3339 date-time ${value}`);
  }
  return { dateTime: value };
}

/** Cap on simultaneous in-flight `threads.get` calls per sync — parallelizes the
 * previously-sequential N+1 fetch without firing hundreds of requests at once against
 * Gmail's per-user rate limits. */
const THREAD_FETCH_CONCURRENCY = 15;

/** Bounded retries for a single transient Gmail API call (network blip, momentary
 * 429/5xx). Mirrors intake.ts's `withRetry` (bounded linear backoff, logs each retry) —
 * this package didn't have a retry helper before; scoped to this file only. */
async function withRetry<T>(label: string, attempts: number, delayMs: number, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === attempts) break;
      console.error(`${label}: attempt ${attempt} failed, retrying — ${(err as Error)?.message ?? err}`, err);
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
  throw lastErr;
}

/** Run `fn` over `items` with at most `concurrency` in flight at once, preserving
 * input order in the returned array. A rejection from one item does not abort the
 * others already in flight or queued (matches `Promise.allSettled` semantics per
 * chunk) — callers decide what to do with individual failures. */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i]!, i) };
      } catch (err) {
        results[i] = { status: "rejected", reason: err };
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function parseAddresses(header: string | undefined): EmailAddress[] {
  if (!header) return [];
  return header
    .split(",")
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => {
      const m = raw.match(/^(.*?)\s*<([^>]+)>$/);
      if (m) return { name: m[1]?.replace(/^"|"$/g, "").trim() || undefined, email: m[2]!.trim() };
      return { email: raw.replace(/^"|"$/g, "").trim() };
    })
    .map((a) => ({ ...(a.name ? { name: a.name } : {}), email: a.email }));
}

function headerOf(headers: Array<{ name?: string | null; value?: string | null }> | undefined, name: string): string | undefined {
  return headers?.find((h) => (h.name ?? "").toLowerCase() === name.toLowerCase())?.value ?? undefined;
}

interface GmailPayloadPart {
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  parts?: GmailPayloadPart[] | null;
}

/** Max multipart MIME recursion depth. Generous for any legitimate email (real
 * messages nest a handful of levels at most — mixed/alternative/related), but bounded
 * so a pathological or malicious deeply-nested multipart payload can't blow the stack. */
const MAX_MIME_DEPTH = 10;

/** Max decoded body size we'll base64-decode into memory per part, in bytes. A single
 * huge (possibly hostile) attachment/body part is truncated rather than fully decoded,
 * so it can't balloon process memory. 5MB is generous for plaintext/HTML email bodies. */
const MAX_BODY_BYTES = 5 * 1024 * 1024;

function decodeBodyPart(data: string, source: string): string {
  // Base64url expands ~4/3x; estimate decoded size from the encoded length before
  // allocating the Buffer, so we can skip decoding oversized parts outright instead of
  // materializing the full buffer first and cutting it after the fact.
  const estimatedBytes = Math.ceil((data.length * 3) / 4);
  if (estimatedBytes > MAX_BODY_BYTES) {
    console.warn(
      `google: skipping oversized ${source} body part (~${estimatedBytes} bytes > ${MAX_BODY_BYTES} cap) — truncated to avoid unbounded memory use`,
    );
    // Decode only up to the cap's worth of base64 chars (rounded to a multiple of 4).
    const safeCharLen = Math.floor((MAX_BODY_BYTES * 4) / 3 / 4) * 4;
    return Buffer.from(data.slice(0, safeCharLen), "base64url").toString("utf8");
  }
  return Buffer.from(data, "base64url").toString("utf8");
}

function extractPlainText(payload: GmailPayloadPart | undefined, depth = 0): string {
  if (!payload) return "";
  if (depth >= MAX_MIME_DEPTH) {
    console.warn(`google: multipart recursion exceeded max depth (${MAX_MIME_DEPTH}) — stopping, returning what was extracted so far`);
    return "";
  }
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBodyPart(payload.body.data, "text/plain");
  }
  for (const part of payload.parts ?? []) {
    const text = extractPlainText(part, depth + 1);
    if (text) return text;
  }
  // Fallback: any body data at the root.
  if (payload.body?.data) return decodeBodyPart(payload.body.data, "root");
  return "";
}

function uniqueParticipants(messages: GmailMessage[]): EmailAddress[] {
  const seen = new Map<string, EmailAddress>();
  for (const m of messages) {
    for (const a of [m.from, ...m.to, ...(m.cc ?? [])]) {
      const key = a.email.toLowerCase();
      if (!seen.has(key)) seen.set(key, a);
    }
  }
  return [...seen.values()];
}

export class GoogleApiGateway implements GoogleGateway {
  #gmail;
  #calendar;
  constructor(auth: Auth.OAuth2Client) {
    this.#gmail = google.gmail({ version: "v1", auth });
    this.#calendar = google.calendar({ version: "v3", auth });
  }

  async fetchThreads(opts: FetchThreadsOpts): Promise<FetchThreadsResult> {
    const list = await this.#gmail.users.threads.list({
      userId: "me",
      maxResults: opts.maxResults ?? 25,
      ...(opts.query ? { q: opts.query } : {}),
      ...(opts.pageToken ? { pageToken: opts.pageToken } : {}),
    });
    const refs = (list.data.threads ?? []).filter((ref): ref is typeof ref & { id: string } => Boolean(ref.id));

    // Fetch full thread bodies CONCURRENTLY (bounded), instead of one-at-a-time — a
    // sequential loop here means a 25-thread sync makes 25 serialized round-trips.
    // Each fetch is retried on transient failure; a thread that still fails after
    // retries is skipped (logged) rather than aborting the whole sync.
    const settled = await mapWithConcurrency(refs, THREAD_FETCH_CONCURRENCY, (ref) =>
      withRetry(`google: fetchThreads(${ref.id})`, 3, 200, () =>
        this.#gmail.users.threads.get({ userId: "me", id: ref.id, format: "full" }),
      ),
    );

    const threads: GmailThread[] = [];
    let incomplete = false;
    for (let i = 0; i < settled.length; i++) {
      const result = settled[i]!;
      const ref = refs[i]!;
      if (result.status === "rejected") {
        console.error(`google: fetchThreads(${ref.id}) failed after retries — skipping this thread for this sync`, result.reason);
        incomplete = true;
        continue;
      }
      const full = result.value;
      const messages: GmailMessage[] = (full.data.messages ?? []).map((msg) => {
        const headers = msg.payload?.headers ?? undefined;
        const from = parseAddresses(headerOf(headers, "From"))[0] ?? { email: "unknown" };
        const internalDateMs = Number(msg.internalDate);
        const receivedAt =
          Number.isFinite(internalDateMs) && internalDateMs > 0
            ? new Date(internalDateMs).toISOString()
            : undefined;
        return {
          messageId: msg.id ?? "",
          from,
          to: parseAddresses(headerOf(headers, "To")),
          cc: parseAddresses(headerOf(headers, "Cc")),
          ...(receivedAt ? { receivedAt } : {}),
          date: headerOf(headers, "Date") ?? receivedAt ?? "",
          subject: headerOf(headers, "Subject") ?? "",
          bodyText: extractPlainText(msg.payload as GmailPayloadPart | undefined) || (msg.snippet ?? ""),
        };
      });
      const last = messages[messages.length - 1];
      threads.push({
        threadId: ref.id,
        ...(full.data.historyId ? { historyId: full.data.historyId } : {}),
        subject: messages[0]?.subject ?? "",
        participants: uniqueParticipants(messages),
        lastMessageAt: last?.date ?? new Date().toISOString(),
        snippet: full.data.messages?.[full.data.messages.length - 1]?.snippet ?? "",
        messages,
      });
    }
    return {
      threads,
      ...(list.data.nextPageToken ? { nextPageToken: list.data.nextPageToken } : {}),
      ...(incomplete ? { incomplete: true } : {}),
    };
  }

  async fetchEvents(opts: FetchEventsOpts): Promise<FetchEventsResult> {
    const timeMin = opts.timeMin ?? new Date().toISOString();
    // Bound the forward window: without a timeMax, a sparse calendar makes the API page
    // arbitrarily far into the future to fill maxResults. Default to a 90-day lookahead.
    const timeMax = opts.timeMax ?? new Date(new Date(timeMin).getTime() + DEFAULT_LOOKAHEAD_MS).toISOString();
    const list = await this.#calendar.events.list({
      calendarId: "primary",
      maxResults: opts.maxResults ?? 25,
      singleEvents: true,
      orderBy: "startTime",
      timeMin,
      timeMax,
      ...(opts.pageToken ? { pageToken: opts.pageToken } : {}),
    });
    const events: CalendarEvent[] = (list.data.items ?? []).map((e) => ({
      eventId: e.id ?? "",
      summary: e.summary ?? "(no title)",
      ...(e.description ? { description: e.description } : {}),
      start: e.start?.dateTime ?? e.start?.date ?? "",
      end: e.end?.dateTime ?? e.end?.date ?? "",
      ...(e.location ? { location: e.location } : {}),
      organizer: { ...(e.organizer?.displayName ? { name: e.organizer.displayName } : {}), email: e.organizer?.email ?? "" },
      attendees: (e.attendees ?? []).map((a) => ({
        ...(a.displayName ? { name: a.displayName } : {}),
        email: a.email ?? "",
      })),
    }));
    return {
      events,
      ...(list.data.nextPageToken ? { nextPageToken: list.data.nextPageToken } : {}),
    };
  }

  async createDraft(envelope: SendEmailEnvelope): Promise<CreateDraftResult> {
    const lines = [
      `To: ${envelope.to.join(", ")}`,
      ...(envelope.cc && envelope.cc.length ? [`Cc: ${envelope.cc.join(", ")}`] : []),
      `Subject: ${envelope.subject}`,
      "Content-Type: text/plain; charset=\"UTF-8\"",
      "MIME-Version: 1.0",
      "",
      envelope.bodyText,
    ];
    const raw = Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
    // Create a DRAFT (gmail.drafts.create) — never sends. The user reviews + sends in Gmail.
    const res = await this.#gmail.users.drafts.create({
      userId: "me",
      requestBody: { message: { raw, ...(envelope.threadId ? { threadId: envelope.threadId } : {}) } },
    });
    return {
      providerDraftId: res.data.id ?? "",
      ...(res.data.message?.id ? { providerMessageId: res.data.message.id } : {}),
    };
  }

  async createEvent(envelope: CreateEventEnvelope): Promise<CreateEventResult> {
    const res = await this.#calendar.events.insert({
      calendarId: "primary",
      requestBody: {
        summary: envelope.summary,
        ...(envelope.description ? { description: envelope.description } : {}),
        ...(envelope.location ? { location: envelope.location } : {}),
        start: calendarDateValue(envelope.start),
        end: calendarDateValue(envelope.end),
        ...(envelope.attendees && envelope.attendees.length
          ? { attendees: envelope.attendees.map((email) => ({ email })) }
          : {}),
      },
    });
    return {
      providerEventId: res.data.id ?? "",
      ...(res.data.htmlLink ? { htmlLink: res.data.htmlLink } : {}),
    };
  }

  async updateEvent(eventId: string, envelope: Partial<CreateEventEnvelope>): Promise<CreateEventResult> {
    const res = await this.#calendar.events.patch({
      calendarId: "primary",
      eventId,
      requestBody: {
        ...(envelope.summary ? { summary: envelope.summary } : {}),
        ...(envelope.description ? { description: envelope.description } : {}),
        ...(envelope.location ? { location: envelope.location } : {}),
        ...(envelope.start ? { start: calendarDateValue(envelope.start) } : {}),
        ...(envelope.end ? { end: calendarDateValue(envelope.end) } : {}),
      },
    });
    return {
      providerEventId: res.data.id ?? eventId,
      ...(res.data.htmlLink ? { htmlLink: res.data.htmlLink } : {}),
    };
  }

  async deleteEvent(eventId: string): Promise<CreateEventResult> {
    // events.delete returns 204 No Content — no body. Echo the id we removed.
    await this.#calendar.events.delete({ calendarId: "primary", eventId });
    return { providerEventId: eventId };
  }
}

interface CachedGateway {
  gateway: GoogleApiGateway;
  /** The token snapshot the cached client was built from — lets us detect an
   * out-of-band token replacement (e.g. a fresh OAuth consent after disconnect)
   * without needing an explicit invalidate() call for that path. */
  tokenUpdatedAt: string;
}

/**
 * Real factory: loads tokens from the LOCAL SecretStore, refreshes, and persists.
 *
 * Caches one OAuth2Client/GoogleApiGateway per integrationId (a plain in-process
 * Map — the integration count for a single-tenant pilot is naturally small, so no
 * eviction policy is needed beyond explicit invalidation on disconnect/reconnect).
 * Before this cache existed, EVERY skill invocation called `forIntegration()` fresh,
 * which built a brand-new `OAuth2Client` and attached a brand-new `tokens` listener
 * to it on every single call — one gateway per call instead of one per integration,
 * each with its own listener that's never removed (a slow listener/client leak across
 * a long-running session, on top of the wasted client construction). Reusing the
 * same client for the same integration means ONE listener total per integration.
 */
export class GoogleApiGatewayFactory implements GoogleGatewayFactory {
  readonly #cache = new Map<string, CachedGateway>();

  constructor(
    private readonly cfg: GoogleOAuthConfig,
    private readonly secrets: SecretStore,
  ) {}

  /** Evict a cached client — call this when credentials are known to have changed
   * out from under the factory (explicit disconnect/rotate). */
  invalidate(integrationId: string): void {
    this.#cache.delete(integrationId);
  }

  async forIntegration(integrationId: string): Promise<GoogleGateway> {
    const token = await this.secrets.getToken(integrationId);
    if (!token) {
      this.#cache.delete(integrationId);
      throw new Error(`google: integration ${integrationId} is not connected (no token)`);
    }

    const cached = this.#cache.get(integrationId);
    // Reuse the cached client unless the stored token has been replaced out from
    // under us (e.g. disconnect+reconnect without going through invalidate()) —
    // updatedAt changing is our signal that the cached client's credentials are stale.
    if (cached && cached.tokenUpdatedAt === token.updatedAt) {
      return cached.gateway;
    }

    const client = clientFromToken(this.cfg, token);
    // Persist refreshed access tokens back to the local store (offline access). Google may
    // rotate the refresh token on this event; if the persist fails, the client keeps working
    // for the rest of THIS request off the in-memory token, but the next `forIntegration` call
    // loads the stale (possibly now-invalid) token from the store — silently bricking the
    // integration with an opaque "invalid_grant" and no diagnostic. Surface the failure loudly
    // instead of swallowing it (`void` previously discarded the promise entirely).
    client.on("tokens", (t) => {
      this.secrets
        .putToken({
          ...token,
          ...(t.access_token ? { accessToken: t.access_token } : {}),
          ...(t.refresh_token ? { refreshToken: t.refresh_token } : {}),
          ...(t.expiry_date ? { expiryDate: t.expiry_date } : {}),
          updatedAt: new Date(t.expiry_date ?? Date.now()).toISOString(),
        })
        .catch((err: unknown) => {
          console.error(`google: failed to persist refreshed token for integration ${integrationId} — next sync will use a stale token`, err);
        });
    });
    const gateway = new GoogleApiGateway(client);
    this.#cache.set(integrationId, { gateway, tokenUpdatedAt: token.updatedAt });
    return gateway;
  }
}
