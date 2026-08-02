import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { trpc } from "../../lib/trpc";
import { rectOf, whatsAppEngine, type ConnectionState } from "./engine";
import { runMessageSync, type SyncProgressEvent } from "./sync";

/**
 * The Chats surface — rendered BY BRIDGE, from the Local Plane store.
 *
 * The WhatsApp session still runs; it is simply never seen. It is the engine:
 * linked, synced, executing operations, parked off-screen and hidden. Chats are
 * drawn here with Bridge's own components, so the product is one application
 * rather than a Bridge window with someone else's window sitting on top of it.
 *
 * Deliberately NOT a WhatsApp replica. No green, no bubble tails, no delivery
 * ticks, no wallpaper. This is a Bridge surface showing WhatsApp data, and it
 * should look like the rest of Bridge.
 *
 * The one moment the session becomes visible is device linking: a QR code has
 * to be looked at by a human with a phone. That is a real exception with a real
 * reason, and it ends the moment the socket connects.
 *
 * The message list is virtualised. The store holds an archive — a `.map()` over
 * a thread is fine in a screenshot and unusable on a real account.
 */

type Thread = Awaited<ReturnType<typeof trpc.whatsapp.syncState.query>>["threads"][number];
type StoredMessage = Awaited<ReturnType<typeof trpc.whatsapp.thread.query>>["messages"][number];
type SearchHit = Awaited<ReturnType<typeof trpc.whatsapp.searchMessages.query>>["hits"][number];

const MUTED = { color: "var(--color-navy-mid)" } as const;
const BORDER = { borderColor: "var(--color-border)" } as const;

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

function formatEpochSeconds(seconds: number): string {
  if (!seconds) return "";
  return new Date(seconds * 1000).toLocaleDateString();
}

/**
 * Who wrote a message, in the terms the store actually knows.
 *
 * A Linked-ID sender is labelled as a Linked ID, not dressed up as a number.
 * The whole point of keeping the two identity spaces disjoint is lost if the UI
 * renders them identically.
 */
function senderLabel(message: StoredMessage): string {
  if (message.senderKind === "self") return "You";
  if (message.senderKind === "phone" && message.senderKey) {
    return message.senderKey.replace(/^whatsapp:/, "");
  }
  if (message.senderKind === "lid") return "Linked ID";
  return "Unattributed";
}

export function ChatsSurface() {
  const available = whatsAppEngine.isAvailable();

  const [status, setStatus] = useState<ConnectionState | null>(null);
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<StoredMessage[] | null>(null);
  const [progress, setProgress] = useState<SyncProgressEvent | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [linking, setLinking] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const [storeError, setStoreError] = useState<string | null>(null);

  const linkAnchor = useRef<HTMLDivElement | null>(null);
  const stopped = useRef(false);

  const refreshThreads = useCallback(async () => {
    try {
      const state = await trpc.whatsapp.syncState.query();
      setThreads(state.threads);
      setStoreError(null);
    } catch (failure) {
      setStoreError(failure instanceof Error ? failure.message : String(failure));
    }
  }, []);

  // ── Session lifecycle ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!available) {
      void refreshThreads();
      return;
    }
    stopped.current = false;

    // Start the session INVISIBLE. Nothing shows it unless the user asks to
    // link a device.
    void whatsAppEngine.ensureHiddenSession();
    void refreshThreads();

    const poll = window.setInterval(() => {
      void whatsAppEngine.getConnectionState().then((next) => {
        if (!stopped.current) setStatus(next);
      });
    }, 3_000);
    void whatsAppEngine.getConnectionState().then((next) => {
      if (!stopped.current) setStatus(next);
    });

    return () => {
      stopped.current = true;
      window.clearInterval(poll);
      // The session keeps running as the engine; only the linking window, if it
      // was ever shown, needs putting away.
      void whatsAppEngine.hideSession();
    };
  }, [available, refreshThreads]);

  // Linking is the ONE case where the session webview is visible. Track its
  // rect while it is up, then hide it the moment the socket connects.
  useEffect(() => {
    if (!linking) return;
    const element = linkAnchor.current;
    if (!element) return;
    const track = () => {
      if (linkAnchor.current) void whatsAppEngine.positionSession(rectOf(linkAnchor.current));
    };
    void whatsAppEngine.showSession(rectOf(element));
    const observer = new ResizeObserver(track);
    observer.observe(element);
    window.addEventListener("scroll", track, true);
    window.addEventListener("resize", track);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", track, true);
      window.removeEventListener("resize", track);
      void whatsAppEngine.hideSession();
    };
  }, [linking]);

  useEffect(() => {
    if (linking && status?.socket === "CONNECTED") setLinking(false);
  }, [linking, status?.socket]);

  // ── Thread contents ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!selected) {
      setMessages(null);
      return;
    }
    let cancelled = false;
    setMessages(null);
    void trpc.whatsapp.thread
      .query({ chatId: selected })
      .then((result) => {
        if (!cancelled) setMessages(result.messages);
      })
      .catch((failure: unknown) => {
        if (!cancelled) {
          setStoreError(failure instanceof Error ? failure.message : String(failure));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  async function sync() {
    setSyncing(true);
    try {
      await runMessageSync({
        onProgress: setProgress,
        shouldStop: () => stopped.current,
      });
      await refreshThreads();
      if (selected) {
        const result = await trpc.whatsapp.thread.query({ chatId: selected });
        setMessages(result.messages);
      }
    } finally {
      setSyncing(false);
    }
  }

  async function search(text: string) {
    if (!text.trim()) {
      setHits(null);
      setSearchNote(null);
      return;
    }
    try {
      const result = await trpc.whatsapp.searchMessages.query({ text, mode: "fulltext" });
      setHits(result.hits);
      setSearchNote(
        result.hits.length === 0 && !result.capabilities.fullText
          ? "This store has no full-text index, so search is limited."
          : null,
      );
    } catch (failure) {
      setSearchNote(failure instanceof Error ? failure.message : String(failure));
    }
  }

  const selectedThread = useMemo(
    () => threads?.find((thread) => thread.chatId === selected) ?? null,
    [threads, selected],
  );

  // ── Virtualised message list ──────────────────────────────────────────────
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rows = messages ?? [];
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    // A starting guess only — `measureElement` below replaces it with the real
    // height per row, which matters because message length varies wildly.
    estimateSize: () => 76,
    overscan: 12,
  });

  if (!available) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md space-y-2 text-center">
          <p className="text-sm font-medium" style={{ color: "var(--color-navy)" }}>
            WhatsApp runs in the Bridge desktop app
          </p>
          <p className="text-sm" style={MUTED}>
            A browser page cannot host a WhatsApp Web session. Whatever the
            desktop app has already captured stays readable here.
          </p>
        </div>
      </div>
    );
  }

  const needsLink = status !== null && status.socket !== "CONNECTED" && !status.live;

  return (
    <div className="flex h-full w-full flex-col">
      {/* Status + actions. Three distinct states, never one indefinite spinner. */}
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2" style={BORDER}>
        <span className="text-xs" style={MUTED}>
          {status === null
            ? "Starting the WhatsApp session…"
            : status.live
              ? `Session live — ${status.chats} chats`
              : status.syncing
                ? `WhatsApp is downloading your messages (${status.chats} chats so far)`
                : status.socket === "CONNECTED"
                  ? "Connected — waiting for your chats"
                  : "This device is not linked"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {needsLink ? (
            <Button size="sm" variant="outline" onClick={() => setLinking((on) => !on)}>
              {linking ? "Done linking" : "Link this device"}
            </Button>
          ) : null}
          <Button size="sm" onClick={() => void sync()} disabled={syncing}>
            {syncing ? "Syncing…" : "Sync messages"}
          </Button>
        </div>
      </div>

      {progress ? (
        <div className="border-b px-3 py-1.5 text-xs" style={{ ...BORDER, ...MUTED }}>
          {progress.detail}
          {progress.chatsTotal > 0
            ? ` (${progress.chatsDone}/${progress.chatsTotal}, ${progress.messagesStored} messages)`
            : null}
        </div>
      ) : null}

      {storeError ? (
        <div className="border-b px-3 py-1.5 text-xs" style={{ ...BORDER, color: "var(--color-danger, #b42318)" }}>
          {storeError}
        </div>
      ) : null}

      {/*
        The linking pane. This is the only element the session webview is ever
        pinned over, and it disappears as soon as the socket connects.
      */}
      {linking ? (
        <div className="border-b p-3" style={BORDER}>
          <p className="mb-2 text-xs" style={MUTED}>
            Scan this code with WhatsApp on your phone. Bridge hides this window
            again as soon as the device is linked.
          </p>
          <div ref={linkAnchor} className="h-[420px] w-full rounded-md border" style={BORDER} />
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {/* ── Chat list ──────────────────────────────────────────────────── */}
        <aside className="flex w-72 min-w-56 flex-col border-r" style={BORDER}>
          <div className="border-b p-2" style={BORDER}>
            <Input
              value={query}
              placeholder="Search messages"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void search(query);
              }}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {threads === null ? (
              <p className="p-3 text-xs" style={MUTED}>
                Reading what has been synced…
              </p>
            ) : threads.length === 0 ? (
              <div className="space-y-1 p-3">
                <p className="text-xs font-medium" style={{ color: "var(--color-navy)" }}>
                  No messages have been synced yet
                </p>
                <p className="text-xs" style={MUTED}>
                  Nothing is stored for this account. Run a sync to read what
                  your linked device is holding.
                </p>
              </div>
            ) : (
              <ul>
                {threads.map((thread) => (
                  <li key={thread.chatId}>
                    <button
                      type="button"
                      onClick={() => setSelected(thread.chatId)}
                      className="w-full border-b px-3 py-2 text-left"
                      style={{
                        ...BORDER,
                        backgroundColor:
                          thread.chatId === selected ? "var(--color-surface)" : "transparent",
                      }}
                    >
                      <span className="block truncate text-sm">
                        {thread.name?.trim() || thread.chatId}
                      </span>
                      <span className="block text-xs" style={MUTED}>
                        {thread.messageCount} stored ·{" "}
                        {formatEpochSeconds(thread.newestTimestamp)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* ── Thread / search results ────────────────────────────────────── */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          {hits !== null ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center gap-2 border-b px-3 py-2" style={BORDER}>
                <span className="text-xs" style={MUTED}>
                  {hits.length} match{hits.length === 1 ? "" : "es"} for “{query}”
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  onClick={() => {
                    setHits(null);
                    setSearchNote(null);
                  }}
                >
                  Clear
                </Button>
              </div>
              {searchNote ? (
                <p className="px-3 py-1.5 text-xs" style={MUTED}>
                  {searchNote}
                </p>
              ) : null}
              <ul className="min-h-0 flex-1 overflow-auto">
                {hits.map((hit) => (
                  <li key={`${hit.chatId}:${hit.messageId}`} className="border-b p-3" style={BORDER}>
                    <button
                      type="button"
                      className="text-left"
                      onClick={() => {
                        setSelected(hit.chatId);
                        setHits(null);
                      }}
                    >
                      <span className="block text-xs" style={MUTED}>
                        {senderLabel(hit)} · {formatTime(hit.sentAt)}
                      </span>
                      <span className="block text-sm">{hit.body}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : selected === null ? (
            <div className="flex flex-1 items-center justify-center p-8">
              <p className="max-w-sm text-center text-sm" style={MUTED}>
                Choose a conversation, or search across everything that has been
                synced.
              </p>
            </div>
          ) : (
            <>
              <div className="border-b px-3 py-2" style={BORDER}>
                <p className="truncate text-sm font-medium" style={{ color: "var(--color-navy)" }}>
                  {selectedThread?.name?.trim() || selected}
                </p>
                {selectedThread ? (
                  <p className="text-xs" style={MUTED}>
                    {/*
                      Honest about the window: a linked device holds recent
                      history, not the whole archive, so this says where what we
                      have actually starts instead of implying it is complete.
                    */}
                    History held from {formatEpochSeconds(selectedThread.oldestTimestamp)} — a
                    linked device keeps only recent messages, so anything older
                    was never available to sync.
                  </p>
                ) : null}
              </div>

              <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
                {messages === null ? (
                  <p className="p-3 text-xs" style={MUTED}>
                    Reading this conversation…
                  </p>
                ) : rows.length === 0 ? (
                  <p className="p-3 text-xs" style={MUTED}>
                    Nothing is stored for this conversation yet.
                  </p>
                ) : (
                  <div
                    style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}
                  >
                    {virtualizer.getVirtualItems().map((item) => {
                      const message = rows[item.index];
                      if (!message) return null;
                      const own = message.direction === "outbound";
                      return (
                        <div
                          key={message.messageId}
                          data-index={item.index}
                          ref={virtualizer.measureElement}
                          style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: "100%",
                            transform: `translateY(${item.start}px)`,
                          }}
                        >
                          <div className="border-b px-3 py-2" style={BORDER}>
                            <div className="flex items-baseline gap-2">
                              <span
                                className="text-xs font-medium"
                                style={{ color: own ? "var(--color-navy)" : "var(--color-navy-mid)" }}
                              >
                                {senderLabel(message)}
                              </span>
                              <span className="text-xs" style={MUTED}>
                                {formatTime(message.sentAt)}
                              </span>
                              {message.attachment ? (
                                <span className="text-xs" style={MUTED}>
                                  · {message.attachment.kind}
                                  {message.attachment.fileName
                                    ? ` (${message.attachment.fileName})`
                                    : ""}
                                </span>
                              ) : null}
                            </div>
                            {message.body ? (
                              <p className="whitespace-pre-wrap break-words text-sm">
                                {message.body}
                              </p>
                            ) : (
                              <p className="text-sm italic" style={MUTED}>
                                No text — attachment only
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/*
                The composer is present but inert until the governed send path
                lands. It says so rather than looking usable: an interactive-
                looking control that does nothing is exactly what the product
                canon forbids.
              */}
              <div className="flex items-center gap-2 border-t p-2" style={BORDER}>
                <Input disabled placeholder="Sending from Bridge needs the approved send path" />
                <Button size="sm" disabled>
                  Send
                </Button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
