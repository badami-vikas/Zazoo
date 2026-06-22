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

function extractPlainText(payload: GmailPayloadPart | undefined): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf8");
  }
  for (const part of payload.parts ?? []) {
    const text = extractPlainText(part);
    if (text) return text;
  }
  // Fallback: any body data at the root.
  if (payload.body?.data) return Buffer.from(payload.body.data, "base64url").toString("utf8");
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
    const threads: GmailThread[] = [];
    for (const ref of list.data.threads ?? []) {
      if (!ref.id) continue;
      const full = await this.#gmail.users.threads.get({ userId: "me", id: ref.id, format: "full" });
      const messages: GmailMessage[] = (full.data.messages ?? []).map((msg) => {
        const headers = msg.payload?.headers ?? undefined;
        const from = parseAddresses(headerOf(headers, "From"))[0] ?? { email: "unknown" };
        return {
          messageId: msg.id ?? "",
          from,
          to: parseAddresses(headerOf(headers, "To")),
          cc: parseAddresses(headerOf(headers, "Cc")),
          date: headerOf(headers, "Date") ?? new Date(Number(msg.internalDate ?? 0)).toISOString(),
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
    };
  }

  async fetchEvents(opts: FetchEventsOpts): Promise<FetchEventsResult> {
    const list = await this.#calendar.events.list({
      calendarId: "primary",
      maxResults: opts.maxResults ?? 25,
      singleEvents: true,
      orderBy: "startTime",
      timeMin: opts.timeMin ?? new Date().toISOString(),
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
        start: { dateTime: envelope.start },
        end: { dateTime: envelope.end },
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
        ...(envelope.start ? { start: { dateTime: envelope.start } } : {}),
        ...(envelope.end ? { end: { dateTime: envelope.end } } : {}),
      },
    });
    return {
      providerEventId: res.data.id ?? eventId,
      ...(res.data.htmlLink ? { htmlLink: res.data.htmlLink } : {}),
    };
  }
}

/** Real factory: loads tokens from the LOCAL SecretStore, refreshes, and persists. */
export class GoogleApiGatewayFactory implements GoogleGatewayFactory {
  constructor(
    private readonly cfg: GoogleOAuthConfig,
    private readonly secrets: SecretStore,
  ) {}

  async forIntegration(integrationId: string): Promise<GoogleGateway> {
    const token = await this.secrets.getToken(integrationId);
    if (!token) throw new Error(`google: integration ${integrationId} is not connected (no token)`);
    const client = clientFromToken(this.cfg, token);
    // Persist refreshed access tokens back to the local store (offline access).
    client.on("tokens", (t) => {
      void this.secrets.putToken({
        ...token,
        ...(t.access_token ? { accessToken: t.access_token } : {}),
        ...(t.refresh_token ? { refreshToken: t.refresh_token } : {}),
        ...(t.expiry_date ? { expiryDate: t.expiry_date } : {}),
        updatedAt: new Date(t.expiry_date ?? Date.now()).toISOString(),
      });
    });
    return new GoogleApiGateway(client);
  }
}
