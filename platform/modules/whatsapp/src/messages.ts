/**
 * Mapping and incremental-sync arithmetic for WhatsApp message capture.
 *
 * Pure, like the rest of this package: it holds no session, no clock, and no
 * store. The desktop shell reads raw messages out of the owner's own live
 * session; this module decides what each one MEANS, and the Local Plane decides
 * where it goes.
 *
 * Two properties are load-bearing.
 *
 * **Identity.** A message's sender lands in the same key space as
 * `LocalPerson.dedupeKey`, and the two WhatsApp spaces are DISJOINT:
 * `whatsapp:+<E164>` for a disclosed phone number, `whatsapp-lid:<id>` for an
 * opaque Linked-ID handle. A LID is digits and is NOT a phone number. On the
 * live account measured 2026-08-01, 4,203 of 8,384 contacts reported `@lid`
 * ids, and an earlier implementation minted a fabricated number for each of
 * them. So `senderOf` below resolves through `normalize.ts` and returns
 * `unknown` — with NO key — wherever it cannot attribute a sender honestly.
 * Guessing is never one of the outcomes.
 *
 * **Boundedness.** A linked device holds a recent history window, not the
 * account's whole archive. Everything here therefore records what was actually
 * seen (`oldestTimestamp`) rather than implying completeness, so a surface can
 * say "history from here" instead of presenting a truncated thread as whole.
 */
import { isLidId, toE164 } from "./normalize.js";

// ── What the shell reports ───────────────────────────────────────────────────

/**
 * One raw message as a message read op reports it.
 *
 * Every field is UNTRUSTED third-party content. `body` in particular is a
 * string another person wrote and is only ever treated as data.
 */
export interface RawMessage {
  /** WhatsApp's own message id. Unique within the account. */
  id: string;
  /** The thread: `…@c.us`, `…@lid`, `…@g.us`, or a broadcast/newsletter id. */
  chatId: string;
  /** True when the account owner sent it. */
  fromMe: boolean;
  /** Seconds since the epoch, as WhatsApp reports it. */
  timestamp: number;
  /** Who wrote it in a GROUP thread. Absent in a direct chat. */
  author?: string;
  /** Sender id as WhatsApp reports it, used when there is no `author`. */
  from?: string;
  /** The text. Empty or absent for a media-only message. */
  body?: string;
  /** WhatsApp's own type tag, e.g. "chat", "image", "ptt". */
  type?: string;
  /** WhatsApp's numeric ack, -1..4. Anything else is not modelled. */
  ack?: number;
  mimetype?: string;
  filename?: string;
  size?: number;
}

/** One chat, as a chat-list read op reports it. Drives sync scheduling. */
export interface RawChatSummary {
  id: string;
  name?: string;
  isGroup: boolean;
  /** Seconds since the epoch for the newest message, when the chat has one. */
  lastMessageTimestamp?: number;
  unreadCount?: number;
}

// ── What this module produces ────────────────────────────────────────────────

export type CapturedMessageAck =
  | "error"
  | "pending"
  | "sent"
  | "delivered"
  | "read"
  | "played"
  | "unknown";

export type CapturedMessageDirection = "inbound" | "outbound";

/** Which identity space `senderKey` lives in. `phone` and `lid` never mix. */
export type CapturedSenderKind = "phone" | "lid" | "self" | "unknown";

export interface CapturedAttachment {
  kind:
    | "image"
    | "video"
    | "audio"
    | "document"
    | "sticker"
    | "location"
    | "contact"
    | "other";
  mimeType?: string;
  fileName?: string;
  byteSize?: number;
}

/**
 * One mapped message, structurally the Local Plane's `LocalMessage` minus the
 * fields only the store can supply (`organizationId`, `source`, `capturedAt`).
 *
 * Deliberately NOT an import of `@bridge/local`: this package stays free of the
 * persistence tier, and the store re-validates every field at its own boundary
 * anyway (`assertMessageShape`). Two independent checks of the same identity
 * rule is the point, not duplication to be tidied away.
 */
export interface CapturedMessage {
  messageId: string;
  chatId: string;
  senderKey?: string;
  senderKind: CapturedSenderKind;
  direction: CapturedMessageDirection;
  /** ISO-8601, derived from the reported epoch seconds. */
  sentAt: string;
  body: string;
  attachment?: CapturedAttachment;
  ack: CapturedMessageAck;
}

/** Why a raw message produced nothing. Counted, never silently dropped. */
export type SkipReason =
  | "no_message_id"
  | "no_chat_id"
  | "unusable_timestamp";

export interface MessageMapping {
  messages: CapturedMessage[];
  /** How many raw entries each reason rejected. */
  skipped: Record<SkipReason, number>;
}

// ── Sender resolution — the identity guard ───────────────────────────────────

/** WhatsApp thread suffixes that are never a person. */
const NON_PERSON_SUFFIXES = ["@g.us", "@broadcast", "@newsletter"];

function isNonPersonId(id: string): boolean {
  return NON_PERSON_SUFFIXES.some((suffix) => id.endsWith(suffix));
}

/** The sender's key and kind, or `unknown` with no key. */
export interface ResolvedSender {
  senderKind: CapturedSenderKind;
  senderKey?: string;
}

/**
 * Resolve who wrote a message.
 *
 * The order is the whole safety property:
 *
 *  1. The owner's own messages are `self` and carry NO key — the owner is not a
 *     counterparty and must never be minted as one.
 *  2. A `@lid` author is a Linked ID: an opaque handle. It gets a LID key and
 *     never touches `toE164`, so no phone number can be derived from it.
 *  3. Only a `@c.us` author — WhatsApp's phone-addressed space — becomes a phone
 *     key, and only if E.164 digits actually come out.
 *  4. Everything else (a group id where an author was expected, a broadcast, a
 *     newsletter, an absent sender, an unrecognised suffix) is `unknown` with no
 *     key. An unattributed message stays unattributed.
 */
export function senderOf(raw: RawMessage): ResolvedSender {
  if (raw.fromMe) return { senderKind: "self" };

  // In a group the writer is `author`; in a direct chat WhatsApp reports the
  // counterparty as `from`, and the chat id is the same identity. Never fall
  // back to the chat id for a group — that would attribute every group message
  // to the group itself.
  const candidate = raw.author?.trim() || raw.from?.trim() || raw.chatId.trim();
  if (!candidate || isNonPersonId(candidate)) {
    return { senderKind: "unknown" };
  }

  if (isLidId(candidate)) {
    return { senderKind: "lid", senderKey: `whatsapp-lid:${candidate}` };
  }

  // Phone identity is only claimed for WhatsApp's phone-addressed space. An id
  // with any other suffix is not a number with decoration, it is a different
  // kind of thing.
  if (candidate.endsWith("@c.us")) {
    const e164 = toE164(candidate);
    if (e164) return { senderKind: "phone", senderKey: `whatsapp:${e164}` };
  }
  return { senderKind: "unknown" };
}

// ── Field mapping ────────────────────────────────────────────────────────────

/** WhatsApp's numeric ack. Anything outside -1..4 is not modelled. */
export function ackOf(raw: number | undefined): CapturedMessageAck {
  switch (raw) {
    case -1:
      return "error";
    case 0:
      return "pending";
    case 1:
      return "sent";
    case 2:
      return "delivered";
    case 3:
      return "read";
    case 4:
      return "played";
    default:
      return "unknown";
  }
}

const ATTACHMENT_KIND: Record<string, CapturedAttachment["kind"]> = {
  image: "image",
  video: "video",
  audio: "audio",
  ptt: "audio",
  document: "document",
  sticker: "sticker",
  location: "location",
  vcard: "contact",
  multi_vcard: "contact",
};

/**
 * What was attached, never the attachment itself.
 *
 * No URL is carried through. A stored remote URL would turn opening a message
 * into a network fetch against WhatsApp's media hosts, which leaks a read
 * signal the owner never asked to send.
 */
export function attachmentOf(raw: RawMessage): CapturedAttachment | undefined {
  const type = raw.type?.trim();
  // "chat" is plain text and is the overwhelming majority; treat an absent type
  // the same way rather than inventing an "other" attachment for every message.
  if (!type || type === "chat") return undefined;
  const kind = ATTACHMENT_KIND[type] ?? "other";
  const byteSize =
    typeof raw.size === "number" && Number.isFinite(raw.size) && raw.size >= 0
      ? Math.floor(raw.size)
      : undefined;
  return {
    kind,
    ...(raw.mimetype ? { mimeType: raw.mimetype } : {}),
    ...(raw.filename ? { fileName: raw.filename } : {}),
    ...(byteSize !== undefined ? { byteSize } : {}),
  };
}

/**
 * Epoch SECONDS to ISO-8601, or `null` when the value cannot be trusted.
 *
 * A message with no usable time cannot be ordered in a thread or compared to a
 * sync cursor, so it is refused rather than stamped with "now" — a fabricated
 * timestamp would silently reorder someone's conversation.
 */
export function isoFromEpochSeconds(seconds: number | undefined): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  const date = new Date(Math.floor(seconds) * 1000);
  const iso = date.toISOString();
  return Number.isNaN(date.getTime()) ? null : iso;
}

/** Map a batch of raw messages, counting whatever could not be mapped. */
export function mapMessages(raw: readonly RawMessage[]): MessageMapping {
  const messages: CapturedMessage[] = [];
  const skipped: Record<SkipReason, number> = {
    no_message_id: 0,
    no_chat_id: 0,
    unusable_timestamp: 0,
  };

  for (const entry of raw) {
    const messageId = entry?.id?.trim();
    if (!messageId) {
      skipped.no_message_id += 1;
      continue;
    }
    const chatId = entry.chatId?.trim();
    if (!chatId) {
      skipped.no_chat_id += 1;
      continue;
    }
    const sentAt = isoFromEpochSeconds(entry.timestamp);
    if (!sentAt) {
      skipped.unusable_timestamp += 1;
      continue;
    }
    const attachment = attachmentOf(entry);
    messages.push({
      messageId,
      chatId,
      ...senderOf(entry),
      direction: entry.fromMe ? "outbound" : "inbound",
      sentAt,
      body: typeof entry.body === "string" ? entry.body : "",
      ...(attachment ? { attachment } : {}),
      ack: ackOf(entry.ack),
    });
  }

  return { messages, skipped };
}

// ── Incremental sync ─────────────────────────────────────────────────────────

/**
 * What has been synced for ONE chat.
 *
 * `oldestTimestamp` exists so a surface can be honest about the history it
 * holds. A linked device keeps a bounded recent window, so "the oldest message
 * we have" is a real edge the user should see named, not a thread that appears
 * to start from nothing.
 */
export interface ChatSyncCursor {
  chatId: string;
  /** Newest message timestamp stored, in epoch seconds. */
  newestTimestamp: number;
  /** Oldest message timestamp stored, in epoch seconds. */
  oldestTimestamp: number;
  /** How many messages this chat has contributed across all runs. */
  messageCount: number;
  /** ISO-8601, supplied by the caller — this module has no clock. */
  syncedAt: string;
  /**
   * The thread's display name, as WhatsApp reported it. A LABEL, never an
   * identifier: for a direct chat it is whatever the owner saved or the
   * counterparty set for themselves, both of which can change at any time.
   * Deliberately no message text — a chat list is built from these cursors, and
   * a cached preview would put message bodies in a second place for no gain.
   */
  name?: string;
  isGroup?: boolean;
}

/** Display facts a caller may attach to a cursor as it advances. */
export interface ChatSyncMeta {
  name?: string;
  isGroup?: boolean;
}

export interface MessageSyncState {
  version: 1;
  chats: Record<string, ChatSyncCursor>;
}

export function emptySyncState(): MessageSyncState {
  return { version: 1, chats: {} };
}

/**
 * Accept an unknown persisted value as sync state, or start fresh.
 *
 * The stored value comes back from a JSON column and could be anything —
 * including state written by an older shape. Anything unrecognised yields an
 * empty state, which costs one full re-read and is correct, rather than a
 * partially-trusted cursor, which would silently skip messages forever.
 */
export function readSyncState(value: unknown): MessageSyncState {
  if (typeof value !== "object" || value === null) return emptySyncState();
  const candidate = value as Partial<MessageSyncState>;
  if (candidate.version !== 1 || typeof candidate.chats !== "object" || candidate.chats === null) {
    return emptySyncState();
  }
  const chats: Record<string, ChatSyncCursor> = {};
  for (const [chatId, cursor] of Object.entries(candidate.chats)) {
    if (
      cursor &&
      typeof cursor === "object" &&
      typeof (cursor as ChatSyncCursor).newestTimestamp === "number" &&
      Number.isFinite((cursor as ChatSyncCursor).newestTimestamp)
    ) {
      const entry = cursor as ChatSyncCursor;
      chats[chatId] = {
        chatId,
        newestTimestamp: entry.newestTimestamp,
        oldestTimestamp:
          typeof entry.oldestTimestamp === "number" && Number.isFinite(entry.oldestTimestamp)
            ? entry.oldestTimestamp
            : entry.newestTimestamp,
        messageCount:
          typeof entry.messageCount === "number" && Number.isFinite(entry.messageCount)
            ? entry.messageCount
            : 0,
        syncedAt: typeof entry.syncedAt === "string" ? entry.syncedAt : "",
        ...(typeof entry.name === "string" ? { name: entry.name } : {}),
        ...(typeof entry.isGroup === "boolean" ? { isGroup: entry.isGroup } : {}),
      };
    }
  }
  return { version: 1, chats };
}

/**
 * The epoch-second watermark to ask the shell for, for one chat.
 *
 * `0` means "everything the device holds" — the first run for a chat. The read
 * op treats it as EXCLUSIVE, and `newMessagesSince` re-applies the same rule so
 * an inclusive shell can never re-write a message that is already stored.
 */
export function sinceFor(state: MessageSyncState, chatId: string): number {
  return state.chats[chatId]?.newestTimestamp ?? 0;
}

/** Drop anything at or below the watermark, so a re-read is idempotent. */
export function newMessagesSince(
  messages: readonly CapturedMessage[],
  since: number,
): CapturedMessage[] {
  if (since <= 0) return [...messages];
  const cutoff = since * 1000;
  return messages.filter((message) => Date.parse(message.sentAt) > cutoff);
}

/**
 * Move one chat's cursor forward over a batch that has just been stored.
 *
 * Returns a NEW state — the caller persists it only after the write succeeded,
 * so a failed write cannot advance a watermark past messages that were never
 * stored. An empty batch still refreshes `syncedAt`, because "we looked and
 * there was nothing new" is a real fact worth keeping.
 */
export function advanceCursor(
  state: MessageSyncState,
  chatId: string,
  stored: readonly CapturedMessage[],
  syncedAt: string,
  meta: ChatSyncMeta = {},
): MessageSyncState {
  const existing = state.chats[chatId];
  const name = meta.name ?? existing?.name;
  const isGroup = meta.isGroup ?? existing?.isGroup;
  let newest = existing?.newestTimestamp ?? 0;
  let oldest = existing?.oldestTimestamp ?? 0;

  for (const message of stored) {
    const seconds = Math.floor(Date.parse(message.sentAt) / 1000);
    if (!Number.isFinite(seconds)) continue;
    if (seconds > newest) newest = seconds;
    if (oldest === 0 || seconds < oldest) oldest = seconds;
  }

  return {
    version: 1,
    chats: {
      ...state.chats,
      [chatId]: {
        chatId,
        newestTimestamp: newest,
        oldestTimestamp: oldest,
        messageCount: (existing?.messageCount ?? 0) + stored.length,
        syncedAt,
        // A newly reported name replaces the old one; an absent one keeps
        // whatever was already known rather than blanking the chat's label.
        ...(name !== undefined ? { name } : {}),
        ...(isGroup !== undefined ? { isGroup } : {}),
      },
    },
  };
}

/** Synced threads, most recent activity first — the chat list's input. */
export function syncedThreads(state: MessageSyncState): ChatSyncCursor[] {
  return Object.values(state.chats).sort((a, b) => b.newestTimestamp - a.newestTimestamp);
}

/**
 * Which chats to read next, newest activity first.
 *
 * A chat is due when the shell reports activity strictly newer than its cursor,
 * or when it has never been synced and has any activity at all. Chats with no
 * messages are not due — reading them would cost a round trip to learn nothing.
 *
 * Ordering by recency is deliberate: sync is interruptible (the app closes, the
 * session drops), so the chats the owner is most likely to open should be the
 * ones already stored when it stops.
 */
export function chatsDueForSync(
  summaries: readonly RawChatSummary[],
  state: MessageSyncState,
  limit?: number,
): RawChatSummary[] {
  const due = summaries.filter((summary) => {
    const activity = summary.lastMessageTimestamp;
    if (typeof activity !== "number" || !Number.isFinite(activity) || activity <= 0) {
      return false;
    }
    return activity > (state.chats[summary.id]?.newestTimestamp ?? 0);
  });
  due.sort((a, b) => (b.lastMessageTimestamp ?? 0) - (a.lastMessageTimestamp ?? 0));
  return typeof limit === "number" && limit >= 0 ? due.slice(0, limit) : due;
}

/** Roll-up for the surface, so progress can be stated rather than implied. */
export interface SyncProgress {
  chatsSynced: number;
  messagesSynced: number;
  chatsDue: number;
  /** Oldest message held across all chats, epoch seconds. 0 when nothing is. */
  oldestTimestamp: number;
  /** Newest message held across all chats, epoch seconds. */
  newestTimestamp: number;
}

export function summarizeSync(
  state: MessageSyncState,
  summaries: readonly RawChatSummary[] = [],
): SyncProgress {
  const cursors = Object.values(state.chats);
  let oldest = 0;
  let newest = 0;
  let messages = 0;
  for (const cursor of cursors) {
    messages += cursor.messageCount;
    if (cursor.oldestTimestamp > 0 && (oldest === 0 || cursor.oldestTimestamp < oldest)) {
      oldest = cursor.oldestTimestamp;
    }
    if (cursor.newestTimestamp > newest) newest = cursor.newestTimestamp;
  }
  return {
    chatsSynced: cursors.length,
    messagesSynced: messages,
    chatsDue: chatsDueForSync(summaries, state).length,
    oldestTimestamp: oldest,
    newestTimestamp: newest,
  };
}
