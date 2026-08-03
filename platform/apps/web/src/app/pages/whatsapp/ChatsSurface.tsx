import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { trpc } from "../../lib/trpc";
import { rectOf, whatsAppEngine, type ConnectionState } from "./engine";
import { runMessageSync, type SyncOutcome, type SyncProgressEvent } from "./sync";
import { ChatAnnotations } from "./ChatAnnotations";
import { ThreadComposer } from "./ThreadComposer";

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

/**
 * A shell refusal arrives as the raw `{ code, message }` struct, not an
 * `Error` — stringify both shapes honestly instead of "[object Object]".
 */
function failureMessage(failure: unknown): string {
  if (failure instanceof Error) return failure.message;
  if (typeof failure === "object" && failure !== null && "message" in failure) {
    return String((failure as { message?: unknown }).message ?? "The desktop shell refused.");
  }
  return String(failure);
}

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
  const [outcome, setOutcome] = useState<SyncOutcome | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [linking, setLinking] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const [storeError, setStoreError] = useState<string | null>(null);
  // Session recovery (TASK-030 shell fixes). Reload is the cheap retry; reset
  // is the escape hatch for invalidated storage and asks for confirmation
  // because it forces a re-link.
  const [sessionNote, setSessionNote] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  const linkAnchor = useRef<HTMLDivElement | null>(null);
  const stopped = useRef(false);
  /** The thread whose view has already been pinned to its newest message. */
  const pinnedThread = useRef<string | null>(null);

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

    // A probe that could not run is NOT evidence of anything.
    //
    // The shell serialises WhatsApp operations behind one busy flag, so every
    // status poll during a sync is refused with WHATSAPP_BUSY and the shell
    // wrapper returns a socket of "UNKNOWN". Overwriting the real status with
    // that made a live, actively-syncing session announce "This device is not
    // linked" (user-hit, 2026-08-02) — the same mistake as reading a failed
    // read as an empty result. Keep the last known answer instead; only a
    // probe that actually reached the session may replace it.
    const applyStatus = (next: ConnectionState) => {
      if (stopped.current) return;
      setStatus((previous) =>
        next.socket === "UNKNOWN" && previous !== null ? previous : next,
      );
    };

    const poll = window.setInterval(() => {
      void whatsAppEngine.getConnectionState().then(applyStatus);
    }, 3_000);
    void whatsAppEngine.getConnectionState().then(applyStatus);

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

  // Close the linking pane only on wa-js's own AUTHENTICATED verdict. The
  // socket is the wrong signal here: the QR screen itself holds a CONNECTED
  // socket, so keying on it snapped the pane shut the moment it opened —
  // "the link the device disappeared" (user-hit, 2026-08-02).
  useEffect(() => {
    if (linking && status?.authenticated === true) setLinking(false);
  }, [linking, status?.authenticated]);

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

  /**
   * Re-read the open thread. Used after a manual send so the message the user
   * just wrote appears where WhatsApp would put it — at the bottom — rather
   * than only after the next full sync.
   */
  const reloadThread = useCallback(async () => {
    if (!selected) return;
    try {
      const result = await trpc.whatsapp.thread.query({ chatId: selected });
      setMessages(result.messages);
      // A message the user just sent is the newest one, so the view goes back
      // to the bottom to show it.
      pinnedThread.current = null;
    } catch (failure) {
      setStoreError(failure instanceof Error ? failure.message : String(failure));
    }
  }, [selected]);

  async function sync() {
    setSyncing(true);
    try {
      const result = await runMessageSync({
        onProgress: setProgress,
        shouldStop: () => stopped.current,
      });
      setOutcome(result);
      await refreshThreads();
      if (selected) {
        const result = await trpc.whatsapp.thread.query({ chatId: selected });
        setMessages(result.messages);
      }
    } finally {
      setSyncing(false);
    }
  }

  async function reloadSession() {
    setSessionNote(null);
    try {
      const reloaded = await whatsAppEngine.reloadSession();
      setSessionNote(
        reloaded
          ? "Reloaded the WhatsApp session — give it a moment to settle."
          : "There was no session window to reload; starting one.",
      );
      if (!reloaded) await whatsAppEngine.ensureHiddenSession();
    } catch (failure) {
      setSessionNote(failureMessage(failure));
    }
  }

  async function resetSession() {
    setResetting(true);
    setSessionNote(null);
    try {
      // The shell MOVES the session's storage aside (never deletes) and clears
      // the persisted store id, then a fresh session starts and needs a QR scan.
      await whatsAppEngine.resetSession();
      setConfirmingReset(false);
      setStatus(null);
      await whatsAppEngine.ensureHiddenSession();
      setSessionNote(
        "Session storage was set aside (not deleted). Use “Link this device” to scan the QR code again.",
      );
    } catch (failure) {
      setSessionNote(failureMessage(failure));
    } finally {
      setResetting(false);
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

  /**
   * Open a conversation at its NEWEST message.
   *
   * The store already returns a thread oldest-first (`listMessages` orders by
   * `sent_at`, and the tRPC procedure documents it), which is the order
   * WhatsApp reads in — so the rendering order is left exactly as it was. What
   * was actually wrong is where the view STARTED: a virtualised list opens at
   * scroll position zero, which is the oldest message in the archive. Opening a
   * chat therefore showed messages from months ago and made the surface look
   * like it had the ordering backwards.
   *
   * Pinned once per thread, so scrolling back through history is never yanked
   * away by a re-render.
   */
  useEffect(() => {
    if (!selected || messages === null || rows.length === 0) return;
    if (pinnedThread.current === selected) return;
    pinnedThread.current = selected;
    const toNewest = () => virtualizer.scrollToIndex(rows.length - 1, { align: "end" });
    toNewest();
    // Row heights are measured lazily, so the first jump lands short of the
    // real bottom. One more pass after the measurements settle finishes it.
    const again = window.requestAnimationFrame(toNewest);
    return () => window.cancelAnimationFrame(again);
  }, [selected, messages, rows.length, virtualizer]);

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

  // Linkedness comes from wa-js's own verdict, never inferred from the
  // socket: the QR screen also holds a CONNECTED socket, and inferring from
  // it once hid the Link button on exactly the screen that needed it. An
  // unknown verdict (null) keeps the button visible with a populated store as
  // the only exception — offering a needless re-link is recoverable; hiding
  // the only way in is not.
  // An unreachable session (socket "UNKNOWN") is excluded outright: it means
  // the probe failed, not that the device is unlinked, and offering "Reset
  // session" on a probe failure invites a needless re-link.
  const reachable = status !== null && status.socket !== "UNKNOWN";
  const needsLink =
    reachable &&
    status !== null &&
    (status.authenticated === false || (status.authenticated === null && !status.live));
  // "Connected — waiting for your chats" that never resolves is the OTHER wedge
  // a reload cures (seen live 2026-08-02: a connected socket over a store
  // WhatsApp had emptied, sync honestly reporting "no chats at all"). Reload is
  // offered here too; Reset stays behind needsLink because moving storage aside
  // while a device is linked forces a re-link the user did not ask for.
  // Excludes the needsLink state so the two recovery rows never both render.
  const connectedButEmpty =
    status !== null && status.socket === "CONNECTED" && !status.live && !needsLink;

  // What BRIDGE holds, as distinct from what WhatsApp holds. `null` threads
  // means the store has not answered yet, which is not the same as zero.
  const storedLabel =
    threads === null
      ? "checking what Bridge has stored"
      : threads.length === 0
        ? "nothing stored in Bridge yet"
        : `${threads.length} stored in Bridge`;

  return (
    <div className="flex h-full w-full flex-col">
      {/* Status + actions. Three distinct states, never one indefinite spinner. */}
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2" style={BORDER}>
        {/*
          Two different planes, so the counts are LABELLED rather than left to
          be read as one number. The session is authoritative about what
          WhatsApp holds; the Local Plane store is authoritative about what
          Bridge has actually captured. Saying "Session live — 500 chats" next
          to an empty chat list read as a contradiction; it was two true facts
          with only one of them named.
        */}
        <span className="text-xs" style={MUTED}>
          {status === null
            ? "Starting the WhatsApp session…"
            : status.live
              ? `Session live — ${status.chats} chats on WhatsApp · ${storedLabel}`
              : status.authenticated === false
                ? "This device is not linked — scan the QR code to connect"
                : status.syncing
                  ? `WhatsApp is downloading your messages (${status.chats} chats so far) · ${storedLabel}`
                  : status.socket === "CONNECTED"
                    ? `Connected — waiting for your chats · ${storedLabel}`
                    : status.socket === "UNKNOWN"
                      ? // Not a claim about the device — the probe could not
                        // reach the session (it is busy, or still starting).
                        "Checking the WhatsApp session…"
                      : "This device is not linked"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {needsLink || connectedButEmpty ? (
            /*
              Recovery, in escalation order (2026-08-02 incident: the session
              wedged on WhatsApp's splash screen with no affordance at all).
              Reload retries the page against the same storage and is offered
              for BOTH wedges — not linked, and connected-but-chatless. Reset
              moves the storage aside and forces a re-link, so it exists only
              in the not-linked state and confirms first.
            */
            <Button size="sm" variant="outline" onClick={() => void reloadSession()}>
              Reload
            </Button>
          ) : null}
          {needsLink ? (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={resetting}
                onClick={() => setConfirmingReset((on) => !on)}
              >
                {confirmingReset ? "Keep session" : "Reset session"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setLinking((on) => !on)}>
                {linking ? "Done linking" : "Link this device"}
              </Button>
            </>
          ) : null}
          {/*
            Tags and Internal Notes, next to Sync messages and scoped to the
            selected chat — no subject to re-pick, because this page already
            knows which conversation is open. Bridge's own Local-Plane data; it
            declares no WhatsApp permission and makes no engine call, so it is
            shown whatever the session is doing.
          */}
          <ChatAnnotations thread={selectedThread} />
          <Button size="sm" onClick={() => void sync()} disabled={syncing}>
            {syncing ? "Syncing…" : "Sync messages"}
          </Button>
        </div>
      </div>

      {/*
        A run that read nothing must not look like a run that succeeded. The
        `failed` phase now covers "the session listed no chats" and "no chat
        reported a last-activity time", so both read as problems here rather
        than as quiet grey progress text.
      */}
      {progress ? (
        <div
          className="border-b px-3 py-1.5 text-xs"
          style={
            progress.phase === "failed"
              ? { ...BORDER, color: "var(--color-danger, #b42318)" }
              : { ...BORDER, ...MUTED }
          }
        >
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

      {/* The one confirm step before a reset: it forces a re-link, so it says so. */}
      {confirmingReset && needsLink ? (
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2" style={BORDER}>
          <span className="text-xs" style={MUTED}>
            Resetting closes the session and moves its stored data aside (nothing
            is deleted). You will need to scan the QR code with your phone again.
          </span>
          <Button size="sm" variant="outline" disabled={resetting} onClick={() => void resetSession()}>
            {resetting ? "Resetting…" : "Reset and re-link"}
          </Button>
          <Button size="sm" variant="outline" disabled={resetting} onClick={() => setConfirmingReset(false)}>
            Cancel
          </Button>
        </div>
      ) : null}

      {sessionNote ? (
        <div className="border-b px-3 py-1.5 text-xs" style={{ ...BORDER, ...MUTED }}>
          {sessionNote}
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
                {/*
                  Why the store is empty is a different question from the fact
                  that it is, and the surface must not tell the user to run a
                  sync that has already run and failed. When the last run could
                  not read the session, say so; otherwise invite the sync.
                */}
                {outcome?.status === "nothing-readable" ? (
                  <p className="text-xs" style={{ color: "var(--color-danger, #b42318)" }}>
                    The last sync could not read your chats
                    {outcome.chatsListed > 0
                      ? ` — the session listed ${outcome.chatsListed} chats but reported no
                         last-activity time for ${outcome.chatsWithoutActivityTime} of them`
                      : " — the session reported no chats at all"}
                    . Nothing was stored, and this is not an up-to-date store.
                  </p>
                ) : (
                  <p className="text-xs" style={MUTED}>
                    Nothing is stored for this account. Run a sync to read what
                    your linked device is holding.
                  </p>
                )}
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
                Write access (ADR-160). The composer is live and reaches the
                wire through the SAME governed shell command an Agent's send
                uses, so the durable Rust ceiling still binds. It refuses out
                loud and never silently.
              */}
              <ThreadComposer
                chatId={selected}
                isGroup={selectedThread?.isGroup}
                threadName={selectedThread?.name}
                linked={status?.authenticated ?? null}
                onSent={() => void reloadThread()}
              />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
