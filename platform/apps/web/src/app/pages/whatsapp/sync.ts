/**
 * Incremental message sync: WhatsApp session → Local Plane store.
 *
 * The shape of this loop is dictated by four facts, none of them negotiable.
 *
 *  1. **Sequential.** One read at a time, one chat at a time. Parallel bursts
 *     against a personal WhatsApp number are the behaviour that draws
 *     enforcement, and the shell serialises operations anyway
 *     (`WHATSAPP_BUSY`), so firing concurrently would only produce errors.
 *
 *  2. **Incremental.** Each chat carries a watermark. A run reads only what is
 *     newer, and the watermark advances only after the write to the store
 *     succeeded — so a crash re-reads a window rather than skipping it.
 *
 *  3. **Interruptible.** The user closes the app, the session drops, the route
 *     changes. Chats are therefore visited newest-activity-first, so whatever
 *     did get synced is the part they are most likely to open, and every chat
 *     is committed on its own before the next begins.
 *
 *  4. **Bounded history.** A linked device holds a recent window, not the
 *     account's archive. This loop syncs what is there and keeps listening
 *     forward. It never claims completeness, and the surface says where the
 *     history it holds actually begins.
 *
 * Residency: bodies go to the Local Plane and stop there. Nothing in this file
 * touches a cloud path.
 */
import { trpc } from "../../lib/trpc";
import { isOpRefused, whatsAppEngine, type RawChatSummary } from "./engine";

/** How many messages one read op asks for. The shell clamps this too. */
const PAGE_SIZE = 300;

/** How many pages one chat may pull in a single run before yielding. */
const MAX_PAGES_PER_CHAT = 20;

/** Progress, as the surface reports it while a run is in flight. */
export interface SyncProgressEvent {
  phase: "listing" | "chat" | "done" | "unavailable" | "failed";
  /** Human-readable, already safe to render. Never a raw error object. */
  detail: string;
  chatsDone: number;
  chatsTotal: number;
  messagesStored: number;
}

export type SyncProgressListener = (event: SyncProgressEvent) => void;

export interface SyncOptions {
  /** Stop after this many chats. Absent means every chat that is due. */
  maxChats?: number;
  onProgress?: SyncProgressListener;
  /** Checked between chats so a route change can stop a long run promptly. */
  shouldStop?: () => boolean;
}

export interface SyncOutcome {
  status: "completed" | "stopped" | "unavailable" | "failed";
  chatsSynced: number;
  messagesStored: number;
  /** Present only for `failed`. Already a message, never a thrown value. */
  error?: string;
}

function describe(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

/**
 * A chat's display label, or its id.
 *
 * A WhatsApp-supplied name is a LABEL set by the owner or by the counterparty,
 * never an identifier, and it is only used for display.
 */
function labelOf(chat: RawChatSummary): string {
  const name = chat.name?.trim();
  return name && name.length > 0 ? name : chat.id;
}

/**
 * Sync one chat forward from its stored watermark.
 *
 * Returns how many messages were stored. Pages until the shell returns nothing
 * new or the page budget runs out — a very active thread that has never been
 * synced will need several runs, which is correct: it also gets visited first
 * every time, so it converges.
 */
async function syncOneChat(chat: RawChatSummary, capturedAt: string): Promise<number> {
  let stored = 0;

  for (let page = 0; page < MAX_PAGES_PER_CHAT; page += 1) {
    // The watermark is re-read from the store each page rather than tracked
    // locally. The store is the authority on what was actually written, and
    // trusting a local copy is how a failed write silently becomes a gap.
    const state = await trpc.whatsapp.syncState.query();
    const since = state.threads.find((thread) => thread.chatId === chat.id)?.newestTimestamp ?? 0;

    const messages = await whatsAppEngine.listMessages(chat.id, since, PAGE_SIZE);
    if (messages.length === 0) {
      // Still record the visit, so "we looked and there was nothing" is a fact
      // the chat list can show rather than an absence it has to guess about.
      await trpc.whatsapp.ingestMessages.mutate({
        chatId: chat.id,
        capturedAt,
        since,
        messages: [],
        ...(chat.name ? { chatName: chat.name } : {}),
        isGroup: chat.isGroup,
      });
      break;
    }

    const result = await trpc.whatsapp.ingestMessages.mutate({
      chatId: chat.id,
      capturedAt,
      since,
      messages,
      ...(chat.name ? { chatName: chat.name } : {}),
      isGroup: chat.isGroup,
    });
    stored += result.stored;
    // Nothing new after the watermark filter means the shell is returning the
    // same window again — paging further would loop.
    if (result.stored === 0) break;
  }

  return stored;
}

/**
 * Run one sync pass.
 *
 * Never throws for the two conditions that are not errors: a shell that cannot
 * read messages, and a caller that asked to stop. Both come back as a status.
 */
export async function runMessageSync(options: SyncOptions = {}): Promise<SyncOutcome> {
  const { onProgress, shouldStop, maxChats } = options;
  const report = (event: SyncProgressEvent) => onProgress?.(event);

  if (!whatsAppEngine.isAvailable()) {
    report({
      phase: "unavailable",
      detail: "WhatsApp runs in the Bridge desktop app.",
      chatsDone: 0,
      chatsTotal: 0,
      messagesStored: 0,
    });
    return { status: "unavailable", chatsSynced: 0, messagesStored: 0 };
  }

  let chats: RawChatSummary[];
  try {
    report({
      phase: "listing",
      detail: "Reading your chat list…",
      chatsDone: 0,
      chatsTotal: 0,
      messagesStored: 0,
    });
    chats = await whatsAppEngine.listChatSummaries();
  } catch (failure) {
    if (isOpRefused(failure)) {
      report({
        phase: "unavailable",
        detail:
          "This build of the Bridge desktop app cannot read messages yet — its WhatsApp session only exposes contacts and groups.",
        chatsDone: 0,
        chatsTotal: 0,
        messagesStored: 0,
      });
      return { status: "unavailable", chatsSynced: 0, messagesStored: 0 };
    }
    report({
      phase: "failed",
      detail: describe(failure),
      chatsDone: 0,
      chatsTotal: 0,
      messagesStored: 0,
    });
    return { status: "failed", chatsSynced: 0, messagesStored: 0, error: describe(failure) };
  }

  // Scheduling is decided against the stored cursors, so a chat with no new
  // activity costs nothing.
  const state = await trpc.whatsapp.syncState.query();
  const cursors = new Map(state.threads.map((thread) => [thread.chatId, thread.newestTimestamp]));
  const due = chats
    .filter((chat) => {
      const activity = chat.lastMessageTimestamp;
      if (typeof activity !== "number" || !Number.isFinite(activity) || activity <= 0) return false;
      return activity > (cursors.get(chat.id) ?? 0);
    })
    .sort((a, b) => (b.lastMessageTimestamp ?? 0) - (a.lastMessageTimestamp ?? 0));
  const queue = typeof maxChats === "number" ? due.slice(0, maxChats) : due;

  let chatsSynced = 0;
  let messagesStored = 0;

  for (const chat of queue) {
    if (shouldStop?.()) {
      return { status: "stopped", chatsSynced, messagesStored };
    }
    report({
      phase: "chat",
      detail: `Syncing “${labelOf(chat)}”…`,
      chatsDone: chatsSynced,
      chatsTotal: queue.length,
      messagesStored,
    });
    try {
      messagesStored += await syncOneChat(chat, new Date().toISOString());
      chatsSynced += 1;
    } catch (failure) {
      // One unreadable chat must not abandon the rest of the run — but it is
      // reported, not swallowed, so a systemic failure is still visible.
      report({
        phase: "chat",
        detail: `Could not sync “${labelOf(chat)}”: ${describe(failure)}`,
        chatsDone: chatsSynced,
        chatsTotal: queue.length,
        messagesStored,
      });
    }
  }

  report({
    phase: "done",
    detail:
      queue.length === 0
        ? "Everything is already up to date."
        : `Synced ${chatsSynced} of ${queue.length} chats.`,
    chatsDone: chatsSynced,
    chatsTotal: queue.length,
    messagesStored,
  });
  return { status: "completed", chatsSynced, messagesStored };
}
