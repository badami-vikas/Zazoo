/**
 * Local-store capture emitters (AI Harness K2, ADR-210 — "chat threads +
 * WhatsApp store → learning signals, per-source toggles").
 *
 * Pure envelope→signal mappers for the two K2 sources. The consent gate
 * (capture-consent.ts) decides WHETHER an emission point may emit; these
 * decide WHAT a signal says when it may. Same discipline as the K1 ledger
 * miner, adapted to capture:
 *
 *  - **Envelope fields only, structurally.** A chat turn's `content` and a
 *    WhatsApp message's `body` are private text. The mappers receive
 *    pre-narrowed envelope types that cannot express those fields — there
 *    is no code path from message text to a signal row.
 *  - **The user's own acts only.** A WhatsApp INBOUND message is someone
 *    else's act; learning the owner's behavior from it would attribute
 *    another person's rhythm to the owner, so inbound maps to null (the
 *    message store still holds it — K3's knowledge substrate reads it as
 *    knowledge, not behavior). The chat mapper takes the USER turn — the
 *    assistant's reply is machine output, and the K1 rule against learning
 *    from the machine's own calibration applies unchanged.
 *  - **Local Plane only.** A cloud-plane chat thread maps to null before
 *    any consent check happens — raw capture never leaves the Local Plane,
 *    and a capture signal ABOUT a cloud thread parked on the local store
 *    would still be a use the consent surface never named.
 *  - **Low-cardinality attributes with a downstream consumer.** `timeOfDay`
 *    is the one envelope facet with a genuine use (K6's brief and rhythm
 *    recommendations); `surface` (chat) and `chatKind` (WhatsApp) are the
 *    honest structural facets. High-cardinality identifiers (thread ids,
 *    chat JIDs, person keys) are deliberately NOT attributes — they cannot
 *    generalize into a pattern, and the digest would drown in them. The
 *    source record id lives in `recordId` for evidence linkage, exactly
 *    like K1.
 */
import type { TaintLabel } from "../taint.js";
import type { ObservedSignal } from "./observation.js";

/** Capture is always OWNER-scoped: signals about the owner's behavior,
 * written as the owner's private Memory. Narrower than `MemoryAuthScope`
 * (whose userId is optional) because an ownerless capture signal cannot
 * exist. */
export interface CaptureScope {
  organizationId: string;
  userId: string;
}

export const CHAT_CAPTURE_MODULE_ID = "chat";
export const WHATSAPP_CAPTURE_MODULE_ID = "whatsapp";
export const GOOGLE_CAPTURE_MODULE_ID = "google";
export const BROWSER_CAPTURE_MODULE_ID = "browser";
export const APP_FOCUS_CAPTURE_MODULE_ID = "apps";
export const INPUT_CAPTURE_MODULE_ID = "input";

export type TimeOfDayBucket = "morning" | "afternoon" | "evening" | "night";

/** Bucket an ISO timestamp's LOCAL hour into the four coarse day parts the
 * brief/rhythm rungs consume. Deliberately coarse: four values can pattern
 * at digest thresholds; twenty-four cannot. */
export function timeOfDayBucket(iso: string, hourOverride?: number): TimeOfDayBucket {
  const hour = hourOverride ?? new Date(iso).getHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

export type KeyCountBucket = "brief" | "short" | "medium" | "long";

/** Bucket a keystroke count into coarse volume bands, for the same reason
 * `timeOfDayBucket` exists: the rhythm lane wants "was this a quick reply or
 * a long compose", not a keystroke tally. An exact per-burst count is a
 * higher-resolution behavioural fact than any consumer needs, and coarse
 * bands are what actually pattern at digest thresholds. */
export function keyCountBucket(keyCount: number): KeyCountBucket {
  if (keyCount <= 10) return "brief";
  if (keyCount <= 60) return "short";
  if (keyCount <= 300) return "medium";
  return "long";
}

/** The slice of a user chat turn capture may see. `content` is structurally
 * inexpressible — adding it here is the mutation the privacy tests catch. */
export interface ChatTurnCaptureEnvelope {
  turnId: string;
  threadId: string;
  plane: "local" | "cloud";
  surface: string;
  sentAt: string;
  /** The turn's own taint label, carried onto the signal at source. */
  taintLabel?: TaintLabel;
}

export function chatTurnCaptureSignal(
  envelope: ChatTurnCaptureEnvelope,
  scope: CaptureScope,
  signalId: string,
): ObservedSignal | null {
  if (envelope.plane !== "local") return null;
  return {
    id: signalId,
    organizationId: scope.organizationId,
    ownerUserId: scope.userId,
    moduleId: CHAT_CAPTURE_MODULE_ID,
    recordKind: "turn",
    recordId: envelope.turnId,
    action: "converse",
    attributes: {
      surface: envelope.surface,
      timeOfDay: timeOfDayBucket(envelope.sentAt),
    },
    observedAt: envelope.sentAt,
    ...(envelope.taintLabel ? { taintLabel: envelope.taintLabel } : {}),
  };
}

/** The slice of a captured WhatsApp message capture may see. `body` and the
 * attachment are structurally inexpressible. */
export interface WhatsAppMessageCaptureEnvelope {
  messageId: string;
  chatId: string;
  direction: "inbound" | "outbound";
  isGroup: boolean;
  /** The message's own sent time; null when the source did not carry one. */
  sentAt: string | null;
  capturedAt: string;
  taintLabel?: TaintLabel;
}

/**
 * K5 (ADR-210 "Capture: email + calendar") — the Google mappers differ from
 * the K2 pair in one deliberate way: the plan names the metadata itself as
 * the signal content ("metadata-first: sender/subject/time, calendar events
 * + attendees"), so `subject`/`counterparty`/`attendees` ARE attributes here
 * even though they are higher-cardinality than K2's facets. The digest
 * shrugs at one-off values (they never reach `minRepetitions`), while a
 * repeated counterparty or time-of-day is exactly the rhythm K6's brief and
 * commitment rungs consume. What stays structurally inexpressible is CONTENT:
 * a thread's `snippet`/`bodyText` and an event's `description` have no field
 * on these envelopes — content summarization is a later, separately-gated
 * rung. Both mappers also differ from K2's "own acts only" rule on purpose:
 * an approved intake row is not a behavior signal about the owner's act, it
 * is an interaction-metadata signal about a record the owner explicitly
 * approved into the graph — the human approval IS the emission warrant.
 */

/** The slice of an approved Gmail-thread intake capture may see. `snippet`
 * and message bodies are structurally inexpressible. */
export interface GmailThreadCaptureEnvelope {
  threadId: string;
  subject: string;
  /** The matched counterparty's email; null when the thread had none. */
  counterpartyEmail: string | null;
  lastMessageAt: string;
  taintLabel?: TaintLabel;
}

export function gmailThreadCaptureSignal(
  envelope: GmailThreadCaptureEnvelope,
  scope: CaptureScope,
  signalId: string,
): ObservedSignal | null {
  return {
    id: signalId,
    organizationId: scope.organizationId,
    ownerUserId: scope.userId,
    moduleId: GOOGLE_CAPTURE_MODULE_ID,
    recordKind: "thread",
    recordId: envelope.threadId,
    action: "email",
    attributes: {
      subject: envelope.subject,
      timeOfDay: timeOfDayBucket(envelope.lastMessageAt),
      ...(envelope.counterpartyEmail ? { counterparty: envelope.counterpartyEmail } : {}),
    },
    observedAt: envelope.lastMessageAt,
    ...(envelope.taintLabel ? { taintLabel: envelope.taintLabel } : {}),
  };
}

/** The slice of an approved Calendar-event intake capture may see. The
 * event's `description` is structurally inexpressible. */
export interface CalendarEventCaptureEnvelope {
  eventId: string;
  summary: string;
  startsAt: string;
  /** Invitee emails as staged in the approved payload (may include the owner). */
  attendeeEmails: string[];
  taintLabel?: TaintLabel;
}

export function calendarEventCaptureSignal(
  envelope: CalendarEventCaptureEnvelope,
  scope: CaptureScope,
  signalId: string,
): ObservedSignal | null {
  return {
    id: signalId,
    organizationId: scope.organizationId,
    ownerUserId: scope.userId,
    moduleId: GOOGLE_CAPTURE_MODULE_ID,
    recordKind: "event",
    recordId: envelope.eventId,
    action: "meet",
    attributes: {
      summary: envelope.summary,
      timeOfDay: timeOfDayBucket(envelope.startsAt),
      ...(envelope.attendeeEmails.length > 0
        ? { attendees: envelope.attendeeEmails.join(", ") }
        : {}),
    },
    observedAt: envelope.startsAt,
    ...(envelope.taintLabel ? { taintLabel: envelope.taintLabel } : {}),
  };
}

/**
 * K8 (ADR-210 "Capture: browser") — the browser envelope follows the K5
 * metadata-first precedent (`domain`/`title` ARE the signal, exactly as
 * subject/counterparty are for Gmail), with one structural property beyond
 * it: there is NO URL FIELD. Paths and query strings — where session
 * tokens, document ids, and search terms live — are inexpressible on this
 * envelope; the extension reduces a URL to its hostname before a payload
 * exists, so the full URL never crosses the process boundary at all. Page
 * CONTENT is a later, separately gated rung. Private-window visits are
 * excluded upstream by construction (the extension manifest declares
 * incognito "not_allowed", so no capture code runs there — absent, not
 * filtered).
 */

/** The slice of a browser visit capture may see. The URL and the page
 * content are structurally inexpressible. */
export interface BrowserVisitCaptureEnvelope {
  /** Extension-minted id for this visit; the idempotency anchor. */
  visitId: string;
  /** Bare hostname, already reduced from the URL inside the browser. */
  domain: string;
  title: string;
  visitedAt: string;
  taintLabel?: TaintLabel;
}

export function browserVisitCaptureSignal(
  envelope: BrowserVisitCaptureEnvelope,
  scope: CaptureScope,
  signalId: string,
): ObservedSignal | null {
  return {
    id: signalId,
    organizationId: scope.organizationId,
    ownerUserId: scope.userId,
    moduleId: BROWSER_CAPTURE_MODULE_ID,
    recordKind: "visit",
    recordId: envelope.visitId,
    action: "browse",
    attributes: {
      domain: envelope.domain,
      title: envelope.title,
      timeOfDay: timeOfDayBucket(envelope.visitedAt),
    },
    observedAt: envelope.visitedAt,
    ...(envelope.taintLabel ? { taintLabel: envelope.taintLabel } : {}),
  };
}

/**
 * K7 (TASK-051) — the desktop shell's app-focus capture. The envelope is
 * what the Rust `apps` provider derives and nothing more: app name, bundle
 * id, window title (null whenever the Accessibility grant is absent or the
 * AX read failed — fail-closed, never a guess), and when focus landed.
 * Structurally inexpressible here: window CONTENT, AX trees, screen pixels,
 * input events — none of those have a field, so no code path can smuggle
 * them into a signal row. `bundleId` is an attribute deliberately (K5
 * precedent: higher-cardinality but the stable app identity is exactly the
 * rhythm facet K6's brief consumes; localized names wobble across locales).
 */
export interface AppFocusCaptureEnvelope {
  /** Shell-minted id for this focus event; the idempotency anchor. */
  focusId: string;
  appName: string;
  bundleId: string;
  /** null = suppressed (no Accessibility grant / AX read failed) — the
   * fail-closed state, distinct from an app that titled its window "". */
  windowTitle: string | null;
  focusedAt: string;
  taintLabel?: TaintLabel;
}

export function appFocusCaptureSignal(
  envelope: AppFocusCaptureEnvelope,
  scope: CaptureScope,
  signalId: string,
): ObservedSignal | null {
  return {
    id: signalId,
    organizationId: scope.organizationId,
    ownerUserId: scope.userId,
    moduleId: APP_FOCUS_CAPTURE_MODULE_ID,
    recordKind: "focus",
    recordId: envelope.focusId,
    action: "focus",
    attributes: {
      appName: envelope.appName,
      bundleId: envelope.bundleId,
      ...(envelope.windowTitle === null ? {} : { windowTitle: envelope.windowTitle }),
      timeOfDay: timeOfDayBucket(envelope.focusedAt),
    },
    observedAt: envelope.focusedAt,
    ...(envelope.taintLabel ? { taintLabel: envelope.taintLabel } : {}),
  };
}

/**
 * K11 (TASK-054, AP-157) — the desktop shell's continuous input capture, the
 * most invasive sensor in the product. The envelope carries what the Rust
 * `input` provider has ALREADY DISTILLED through the fail-closed boundary
 * (`input-capture.ts`): a summary, the key count, and — only when the
 * field-role gate returned "content" and pattern redaction has run — the
 * redacted typed text.
 *
 * Structurally inexpressible here, by design: the RAW keystroke stream. There
 * is no field for it, so no code path can carry raw keys into a signal row,
 * exactly as K7's envelope cannot carry window content. `content` is present
 * only for a captured (non-suppressed, non-denylisted) burst and is already
 * redacted before it reaches this type — the distiller is the only producer.
 * A suppressed burst arrives with `content` absent and its reason set, so the
 * stored Memory says honestly that typing happened and why the text was
 * withheld. A denylisted burst never reaches here at all (the distiller
 * returns null and the provider emits nothing).
 */
export interface InputCaptureEnvelope {
  /** Shell-minted id for this burst; the idempotency anchor. */
  burstId: string;
  appName: string;
  bundleId: string;
  /** One-line human-inspectable summary (already distilled). */
  summary: string;
  /** Present ONLY for a captured burst. Absent when suppressed: the count of
   * characters typed into a secure/undeterminable field is itself sensitive
   * (it publishes a password's length), so the distiller withholds it and
   * this envelope cannot carry it either. */
  keyCount?: number;
  /** Present ONLY for a captured burst; already redacted. Absent = suppressed. */
  content?: string;
  disposition: "captured" | "suppressed";
  suppressionReason?: "secure_field" | "undeterminable_field" | "denylisted";
  /** How many redactions the backstop applied to `content`. */
  redactionCount: number;
  typedAt: string;
  taintLabel?: TaintLabel;
}

export function inputCaptureSignal(
  envelope: InputCaptureEnvelope,
  scope: CaptureScope,
  signalId: string,
): ObservedSignal | null {
  return {
    id: signalId,
    organizationId: scope.organizationId,
    ownerUserId: scope.userId,
    moduleId: INPUT_CAPTURE_MODULE_ID,
    recordKind: "input",
    recordId: envelope.burstId,
    action: "type",
    attributes: {
      appName: envelope.appName,
      bundleId: envelope.bundleId,
      // Attributes are string-valued facets (the digest groups on them), so
      // counts are bucketed rather than raw: an exact keystroke count is a
      // higher-resolution behavioural fact than the rhythm lane needs. Absent
      // entirely for a suppressed burst — see the envelope's `keyCount`.
      ...(envelope.keyCount === undefined
        ? {}
        : { keyCount: keyCountBucket(envelope.keyCount) }),
      disposition: envelope.disposition,
      ...(envelope.suppressionReason ? { suppressionReason: envelope.suppressionReason } : {}),
      ...(envelope.redactionCount > 0 ? { redacted: "true" } : {}),
      timeOfDay: timeOfDayBucket(envelope.typedAt),
    },
    // The redacted typed text, and the one place it lives: the signal BODY,
    // never `attributes`. Attributes are grouping facets the digest mines and
    // fans out to rhythm detection — putting prose there would make the text
    // a pattern key. Present only for a captured burst; `distilKeystrokeBurst`
    // omits it entirely for a suppressed one, and that absence is carried
    // through rather than normalized to "" (AP-157, task #80).
    ...(envelope.content !== undefined ? { content: envelope.content } : {}),
    observedAt: envelope.typedAt,
    ...(envelope.taintLabel ? { taintLabel: envelope.taintLabel } : {}),
  };
}

export function whatsAppMessageCaptureSignal(
  envelope: WhatsAppMessageCaptureEnvelope,
  scope: CaptureScope,
  signalId: string,
): ObservedSignal | null {
  if (envelope.direction !== "outbound") return null;
  const observedAt = envelope.sentAt ?? envelope.capturedAt;
  return {
    id: signalId,
    organizationId: scope.organizationId,
    ownerUserId: scope.userId,
    moduleId: WHATSAPP_CAPTURE_MODULE_ID,
    recordKind: "message",
    recordId: envelope.messageId,
    action: "send",
    attributes: {
      chatKind: envelope.isGroup ? "group" : "direct",
      timeOfDay: timeOfDayBucket(observedAt),
    },
    observedAt,
    ...(envelope.taintLabel ? { taintLabel: envelope.taintLabel } : {}),
  };
}
