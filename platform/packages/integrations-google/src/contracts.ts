/**
 * Wire contracts for the Google integration — the typed edge between the egress
 * adapter (googleapis or the fake) and the rest of the platform. Bodies in these
 * shapes are PRIVATE relationship data: they persist to @bridge/local only and
 * never cross the gate.
 */

export interface EmailAddress {
  name?: string;
  email: string;
}

/** One message inside a Gmail thread. `bodyText` is private. */
export interface GmailMessage {
  messageId: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc?: EmailAddress[];
  /** Provider receipt time derived from Gmail `internalDate`, not the sender-controlled Date header. */
  receivedAt?: string;
  date: string;
  subject: string;
  bodyText: string;
}

/** A Gmail thread (the unit we source). All fields private. */
export interface GmailThread {
  threadId: string;
  historyId?: string;
  subject: string;
  /** Distinct participants across all messages (drives person-matching). */
  participants: EmailAddress[];
  lastMessageAt: string;
  snippet: string;
  messages: GmailMessage[];
}

/** A Google Calendar event (the unit we source). `description` is private. */
export interface CalendarEvent {
  eventId: string;
  summary: string;
  description?: string;
  start: string;
  end: string;
  location?: string;
  organizer: EmailAddress;
  attendees: EmailAddress[];
}

export interface FetchThreadsOpts {
  maxResults?: number;
  /** Gmail search query (e.g. "newer_than:30d -in:chats"). */
  query?: string;
  pageToken?: string;
}

export interface FetchEventsOpts {
  maxResults?: number;
  /** RFC3339 lower bound. */
  timeMin?: string;
  /** RFC3339 upper bound. Defaults to `timeMin` + 90 days when omitted — an unbounded
   * forward window means a sparse calendar pages arbitrarily far into the future. */
  timeMax?: string;
  pageToken?: string;
}

export interface FetchThreadsResult {
  threads: GmailThread[];
  nextPageToken?: string;
  /** At least one listed thread could not be fetched after retries. */
  incomplete?: boolean;
}

export interface FetchEventsResult {
  events: CalendarEvent[];
  nextPageToken?: string;
}

/** An outbound email — composed as a draft, sent only after >= L2 approval. */
export interface SendEmailEnvelope {
  to: string[];
  cc?: string[];
  subject: string;
  bodyText: string;
  /** Reply threading. */
  threadId?: string;
  inReplyToMessageId?: string;
}

/** An outbound calendar event — composed as a draft, created only after approval. */
export interface CreateEventEnvelope {
  summary: string;
  description?: string;
  start: string;
  end: string;
  attendees?: string[];
  location?: string;
}

export interface SendEmailResult {
  providerMessageId: string;
  threadId?: string;
}

export interface CreateDraftResult {
  providerDraftId: string;
  providerMessageId?: string;
}

export interface CreateEventResult {
  providerEventId: string;
  htmlLink?: string;
}

/** Egress kinds that flow through external:send (the gate). */
export type EgressKind = "email.draft" | "calendar.create" | "calendar.update" | "calendar.delete";

export const GMAIL_SOURCE = "gmail" as const;
export const CALENDAR_SOURCE = "google-calendar" as const;

/**
 * The OAuth scopes Bridge requests — least-privilege, read + draft (no auto-send).
 *   - gmail.readonly       : source threads (READ pipeline)
 *   - gmail.drafts.create  : compose a Gmail DRAFT on approval (never auto-sends)
 *   - calendar.events      : read events + create/update on approval
 */
export const GOOGLE_SCOPES: readonly string[] = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.drafts.create",
  "https://www.googleapis.com/auth/calendar.events",
  "openid",
  "email",
  "profile",
];
