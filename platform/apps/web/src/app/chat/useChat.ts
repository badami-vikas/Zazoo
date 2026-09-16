import { useCallback, useEffect, useRef, useState } from "react";
import { PILOT_ORGANIZATION, trpc } from "../lib/trpc";
import {
  canApplyChatResponse,
  mergeChatThreadState,
  needsCloudGrant,
} from "./chat-state.mjs";

export type ChatSurfaceKind =
  | "chat_panel"
  | "chief_of_staff_page"
  | "avatar_overlay"
  | "task_manager";

export type ChatThreadView = Awaited<ReturnType<typeof trpc.chat.thread.get.query>>;
export type ChatThread = ChatThreadView["thread"];
export type ChatTurn = ChatThreadView["turns"][number];
export type ChatModelStatus = Awaited<ReturnType<typeof trpc.chat.model.status.query>>;
export type CloudDisclosure = Awaited<
  ReturnType<typeof trpc.chat.turn.prepareCloud.mutate>
>;

export function mergeChatThreadViews(
  current: ChatThreadView | null,
  incoming: ChatThreadView,
  page: "latest" | "older" = "latest",
): ChatThreadView {
  return mergeChatThreadState(current, incoming, page);
}

interface PendingCloudRequest {
  message: string;
  clientRequestId: string;
  retryTurnId?: string;
}

const ACTIVE_THREAD_KEY = `bridge.${PILOT_ORGANIZATION}.chat.active.v2`;
const CHAT_CHANNEL = `bridge.${PILOT_ORGANIZATION}.chat.v2`;
/** Window event the left nav listens to for re-reading installed Modules. */
export const MODULES_CHANGED_EVENT = "bridge:modules-changed";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function activeThreadId(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_THREAD_KEY);
  } catch {
    return null;
  }
}

function persistActiveThread(id: string): void {
  try {
    window.localStorage.setItem(ACTIVE_THREAD_KEY, id);
  } catch {
    // Persistence still lives on the server; storage only synchronizes the selected thread.
  }
}

/**
 * `moduleName` binds this surface to a Module's own conversation: opening the
 * Module reopens its live thread with history rather than whatever thread was
 * last active (ADR-267e). Undefined = the standalone Chat, which keeps its
 * "resume the last thread you used" behaviour.
 */
export function useChat(surfaceKind: ChatSurfaceKind, moduleName?: string) {
  const [view, setView] = useState<ChatThreadView | null>(null);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [model, setModel] = useState<ChatModelStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cloudDisclosure, setCloudDisclosure] = useState<CloudDisclosure | null>(null);
  const [pendingCloudRequest, setPendingCloudRequest] =
    useState<PendingCloudRequest | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const desiredIdRef = useRef<string | null>(null);
  const selectionGenerationRef = useRef(0);

  const refreshThreads = useCallback(async () => {
    const result = await trpc.chat.thread.list.query({
      organizationId: PILOT_ORGANIZATION,
      status: "active",
      limit: 100,
    });
    setThreads([...result.items]);
    return result.items;
  }, []);

  const refreshModel = useCallback(async () => {
    const result = await trpc.chat.model.status.query({
      organizationId: PILOT_ORGANIZATION,
    });
    setModel(result);
    return result;
  }, []);

  const loadThread = useCallback(async (
    threadId: string,
    cursor?: { sequence: number },
    mode: "select" | "refresh" | "older" | "refresh_page" = "select",
  ) => {
    const selectsThread = mode === "select";
    const generation = selectsThread
      ? ++selectionGenerationRef.current
      : selectionGenerationRef.current;
    if (selectsThread) {
      desiredIdRef.current = threadId;
      setCloudDisclosure(null);
      setPendingCloudRequest(null);
    }
    let result: ChatThreadView;
    try {
      result = await trpc.chat.thread.get.query({
        organizationId: PILOT_ORGANIZATION,
        threadId,
        ...(cursor ? { cursor } : {}),
      });
    } catch (cause) {
      if (selectsThread && generation === selectionGenerationRef.current) {
        desiredIdRef.current = activeIdRef.current;
      }
      throw cause;
    }
    if (!canApplyChatResponse({
      generation,
      currentGeneration: selectionGenerationRef.current,
      threadId,
      activeThreadId: activeIdRef.current,
      desiredThreadId: desiredIdRef.current,
      selectsThread,
    })) return result;
    if (selectsThread) {
      activeIdRef.current = threadId;
      desiredIdRef.current = threadId;
      persistActiveThread(threadId);
    }
    setView((current) =>
      mergeChatThreadViews(current, result, mode === "older" ? "older" : "latest"),
    );
    return result;
  }, []);

  const loadOlder = useCallback(async () => {
    if (!view?.nextCursor) return;
    await loadThread(view.thread.id, view.nextCursor, "older");
  }, [loadThread, view]);

  const announce = useCallback((threadId: string, select = false) => {
    const detail = { type: "changed", threadId, select };
    channelRef.current?.postMessage(detail);
    window.dispatchEvent(new CustomEvent(CHAT_CHANNEL, { detail }));
  }, []);

  // `backend` picks WHICH engine answers the thread: the built-in Bridge model
  // path, or an agentic backend (Claude Code) that runs its own tool loop. The
  // server decides the plane for an agentic backend, so callers pass one or the
  // other, never both meaningfully.
  const newChat = useCallback(async (
    plane?: "local" | "cloud",
    clientRequestId: string = crypto.randomUUID(),
    backend?: "bridge" | "claude_code",
  ) => {
    setError(null);
    const generation = ++selectionGenerationRef.current;
    desiredIdRef.current = null;
    setCloudDisclosure(null);
    setPendingCloudRequest(null);
    let created: ChatThreadView;
    try {
      created = await trpc.chat.thread.create.mutate({
        organizationId: PILOT_ORGANIZATION,
        ...(plane ? { plane } : {}),
        ...(backend ? { backend } : {}),
        clientRequestId,
      });
    } catch (cause) {
      if (generation === selectionGenerationRef.current) {
        desiredIdRef.current = activeIdRef.current;
      }
      throw cause;
    }
    if (generation !== selectionGenerationRef.current) return created;
    activeIdRef.current = created.thread.id;
    desiredIdRef.current = created.thread.id;
    persistActiveThread(created.thread.id);
    setView(created);
    await refreshThreads();
    announce(created.thread.id, true);
    return created;
  }, [announce, refreshThreads]);

  /**
   * Point the CURRENT conversation at a different engine. Bridge holds the
   * context, so switching models keeps every turn — the thread is not cleared
   * and not replaced. Falls back to starting a fresh thread only when the
   * server refuses the switch (a deployment that stores the two planes
   * separately cannot move a thread between them).
   */
  const switchBackend = useCallback(async (
    backend: "bridge" | "claude_code",
    plane?: "local" | "cloud",
  ) => {
    setError(null);
    const threadId = activeIdRef.current;
    if (!threadId) {
      await newChat(plane, crypto.randomUUID(), backend);
      return;
    }
    setCloudDisclosure(null);
    setPendingCloudRequest(null);
    try {
      const updated = await trpc.chat.thread.setBackend.mutate({
        organizationId: PILOT_ORGANIZATION,
        threadId,
        backend,
        ...(plane ? { plane } : {}),
      });
      setView(updated);
      await refreshThreads();
      announce(updated.thread.id, true);
    } catch (cause) {
      // The one honest fallback: this deployment keeps Local and Cloud Chat in
      // separate stores, so the conversation genuinely cannot move. Say so and
      // start a new thread on the chosen model rather than leaving the user on
      // an engine they did not pick.
      setError(cause instanceof Error ? cause.message : "Could not switch model");
      await newChat(plane, crypto.randomUUID(), backend);
    }
  }, [announce, newChat, refreshThreads]);

  /** Reopen a Module's own conversation — resumed with its history, or created
   * on first visit and resumed from then on. */
  const openModuleChat = useCallback(async (moduleName: string) => {
    setError(null);
    const opened = await trpc.chat.thread.forModule.mutate({
      organizationId: PILOT_ORGANIZATION,
      moduleName,
    });
    activeIdRef.current = opened.thread.id;
    desiredIdRef.current = opened.thread.id;
    persistActiveThread(opened.thread.id);
    setView(opened);
    await refreshThreads();
    announce(opened.thread.id, true);
    return opened;
  }, [announce, refreshThreads]);

  /** Pull another Module into this same conversation. */
  const attachModule = useCallback(async (moduleName: string) => {
    const threadId = activeIdRef.current;
    if (!threadId) return;
    const updated = await trpc.chat.thread.attachModule.mutate({
      organizationId: PILOT_ORGANIZATION,
      threadId,
      moduleName,
    });
    setView(updated);
  }, []);

  const selectThread = useCallback(async (threadId: string) => {
    const result = await loadThread(threadId);
    if (activeIdRef.current === threadId) announce(threadId, true);
    return result;
  }, [announce, loadThread]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void (async () => {
      const [listed] = await Promise.all([refreshThreads(), refreshModel()]);
      if (!active) return;
      // A Module surface resumes THAT Module's conversation. The server
      // creates one on first visit and returns the same one after, so this is
      // resume-or-start rather than a new thread per navigation.
      if (moduleName) {
        await openModuleChat(moduleName);
        return;
      }
      const stored = activeThreadId();
      const selected = listed.find((thread) => thread.id === stored) ?? listed[0];
      if (selected) {
        await loadThread(selected.id);
      } else {
        await newChat(undefined, "default");
      }
    })()
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadThread, moduleName, newChat, openModuleChat, refreshModel, refreshThreads]);

  useEffect(() => {
    const handleChange = (threadId: string | undefined, select = false) => {
      if (!threadId) return;
      const refreshView = select
        ? loadThread(threadId)
        : activeIdRef.current === threadId
          ? loadThread(threadId, undefined, "refresh")
          : Promise.resolve(null);
      void Promise.all([refreshThreads(), refreshView]).catch((cause) =>
        setError(errorMessage(cause)),
      );
    };
    const handleWindow = (event: Event) => {
      const detail = (event as CustomEvent<{ threadId?: string; select?: boolean }>).detail;
      handleChange(detail?.threadId, detail?.select);
    };
    window.addEventListener(CHAT_CHANNEL, handleWindow);
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(CHAT_CHANNEL);
      channelRef.current = channel;
      channel.onmessage = (
        event: MessageEvent<{ threadId?: string; select?: boolean }>,
      ) => {
        handleChange(event.data?.threadId, event.data?.select);
      };
    }
    return () => {
      window.removeEventListener(CHAT_CHANNEL, handleWindow);
      channelRef.current?.close();
      channelRef.current = null;
    };
  }, [loadThread, refreshThreads]);

  useEffect(() => {
    if (!view) return;
    const shouldPoll =
      sending ||
      view.turns.some((turn) => turn.state === "queued" || turn.state === "processing") ||
      model?.local.state === "downloading" ||
      model?.local.state === "verifying" ||
      model?.local.state === "loading";
    const interval = window.setInterval(() => {
      const id = activeIdRef.current;
      if (id) void loadThread(id, undefined, "refresh").catch(() => undefined);
      void refreshModel().catch(() => undefined);
    }, shouldPoll ? 1_000 : 5_000);
    return () => window.clearInterval(interval);
  }, [loadThread, model?.local.state, refreshModel, sending, view]);

  const submit = useCallback(async (
    message: string,
    cloudGrantId?: string,
    request?: {
      clientRequestId: string;
      retryTurnId?: string;
    },
    /** Runtime ids of Agents addressed with `@` (2026-09-05). */
    mentions?: string[],
  ) => {
    if (!view) return false;
    const threadId = view.thread.id;
    const generation = selectionGenerationRef.current;
    let accepted = false;
    setSending(true);
    setError(null);
    const clientRequestId = request?.clientRequestId ?? crypto.randomUUID();
    try {
      const result = await trpc.chat.turn.send.mutate({
        organizationId: PILOT_ORGANIZATION,
        threadId,
        clientRequestId,
        message,
        surface: { kind: surfaceKind },
        ...(cloudGrantId ? { cloudGrantId } : {}),
        ...(request?.retryTurnId ? { retryTurnId: request.retryTurnId } : {}),
        ...(mentions && mentions.length > 0 ? { mentions } : {}),
      });
      accepted = true;
      if (canApplyChatResponse({
        generation,
        currentGeneration: selectionGenerationRef.current,
        threadId,
        activeThreadId: activeIdRef.current,
        desiredThreadId: desiredIdRef.current,
        selectsThread: false,
      })) {
        setView((current) => mergeChatThreadViews(current, result));
      }
      announce(threadId);
      // A turn may have built and installed a Module; the left nav re-reads
      // modules.list on this so the reply and the sidebar agree.
      window.dispatchEvent(new CustomEvent(MODULES_CHANGED_EVENT));
      await refreshThreads();
    } catch (cause) {
      setError(errorMessage(cause));
      await loadThread(threadId, undefined, "refresh").catch(() => undefined);
      announce(threadId);
    } finally {
      setSending(false);
      setCloudDisclosure(null);
      setPendingCloudRequest(null);
    }
    return accepted;
  }, [announce, loadThread, refreshThreads, surfaceKind, view]);

  const send = useCallback(async (message: string, mentions?: string[]) => {
    if (!view) return false;
    if (needsCloudGrant(view.thread)) {
      // Picking a Cloud Plane thread IS the user's consent to send this
      // message to that thread's model provider (user directive 2026-08-10)
      // — the per-message grant is still fetched and still does its real job
      // (single-use, pinned to this exact disclosed context via
      // `contextDigest`), it's just applied immediately instead of behind a
      // second confirmation click. `confirmCloud`/`cloudDisclosure` below
      // stay available for a caller that still wants to show the banner.
      const clientRequestId = crypto.randomUUID();
      setSending(true);
      setError(null);
      try {
        const threadId = view.thread.id;
        const disclosure = await trpc.chat.turn.prepareCloud.mutate({
          organizationId: PILOT_ORGANIZATION,
          threadId,
          message,
          surface: { kind: surfaceKind },
        });
        return await submit(message, disclosure.grantId, { clientRequestId }, mentions);
      } catch (cause) {
        setError(errorMessage(cause));
        setSending(false);
        return false;
      }
    }
    return submit(message, undefined, undefined, mentions);
  }, [submit, surfaceKind, view]);

  const confirmCloud = useCallback(async () => {
    if (!cloudDisclosure || !pendingCloudRequest) return false;
    return submit(
      pendingCloudRequest.message,
      cloudDisclosure.grantId,
      pendingCloudRequest,
    );
  }, [cloudDisclosure, pendingCloudRequest, submit]);

  const cancelCloud = useCallback(() => {
    setCloudDisclosure(null);
    setPendingCloudRequest(null);
  }, []);

  const decide = useCallback(async (
    turn: ChatTurn,
    decision: "approve" | "edit" | "veto",
    editedOutput?: unknown,
  ) => {
    if (!view || !turn.proposal) return;
    setError(null);
    try {
      await trpc.action.decide.mutate({
        proposalId: turn.proposal.id,
        decision,
        chatThreadId: view.thread.id,
        chatTurnId: turn.id,
        ...(editedOutput !== undefined ? { editedOutput } : {}),
      });
      await loadThread(
        view.thread.id,
        { sequence: turn.sequence + 1 },
        "refresh_page",
      );
      announce(view.thread.id);
      await refreshThreads();
    } catch (cause) {
      setError(errorMessage(cause));
      await loadThread(
        view.thread.id,
        { sequence: turn.sequence + 1 },
        "refresh_page",
      ).catch(() => undefined);
    }
  }, [announce, loadThread, refreshThreads, view]);

  const retry = useCallback(async (turn: ChatTurn) => {
    if (!view) return;
    const prior = turn.retryRequest;
    if (!prior) {
      setError("The original request for this failed turn is unavailable.");
      return;
    }
    if (needsCloudGrant(view.thread)) {
      setSending(true);
      setError(null);
      try {
        const disclosure = await trpc.chat.turn.prepareCloud.mutate({
          organizationId: PILOT_ORGANIZATION,
          threadId: view.thread.id,
          message: prior.content,
          surface: { kind: surfaceKind },
          retryTurnId: turn.id,
        });
        setCloudDisclosure(disclosure);
        setPendingCloudRequest({
          message: prior.content,
          clientRequestId: prior.clientRequestId,
          retryTurnId: turn.id,
        });
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setSending(false);
      }
      return;
    }
    await submit(prior.content, undefined, {
      clientRequestId: prior.clientRequestId,
      retryTurnId: turn.id,
    });
  }, [submit, surfaceKind, view]);

  const cancel = useCallback(async (turn: ChatTurn) => {
    if (!view) return;
    const threadId = view.thread.id;
    const generation = selectionGenerationRef.current;
    try {
      const result = await trpc.chat.turn.cancel.mutate({
        organizationId: PILOT_ORGANIZATION,
        threadId,
        turnId: turn.id,
      });
      if (canApplyChatResponse({
        generation,
        currentGeneration: selectionGenerationRef.current,
        threadId,
        activeThreadId: activeIdRef.current,
        desiredThreadId: desiredIdRef.current,
        selectsThread: false,
      })) {
        setView((current) => mergeChatThreadViews(current, result));
      }
      announce(threadId);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [announce, view]);

  const archive = useCallback(async () => {
    if (!view) return;
    await trpc.chat.thread.archive.mutate({
      organizationId: PILOT_ORGANIZATION,
      threadId: view.thread.id,
    });
    await newChat(view.thread.plane);
  }, [newChat, view]);

  const deleteChat = useCallback(async () => {
    if (!view) return;
    const plane = view.thread.plane;
    await trpc.chat.thread.delete.mutate({
      organizationId: PILOT_ORGANIZATION,
      threadId: view.thread.id,
    });
    await newChat(plane);
  }, [newChat, view]);

  const installModel = useCallback(async () => {
    setError(null);
    try {
      setModel((current) => current
        ? { ...current, local: { ...current.local, state: "downloading" } }
        : current);
      await trpc.chat.model.install.mutate({ organizationId: PILOT_ORGANIZATION });
      await refreshModel();
    } catch (cause) {
      setError(errorMessage(cause));
      await refreshModel().catch(() => undefined);
    }
  }, [refreshModel]);

  const cancelInstall = useCallback(async () => {
    await trpc.chat.model.cancelInstall.mutate({ organizationId: PILOT_ORGANIZATION });
    await refreshModel();
  }, [refreshModel]);

  const startModel = useCallback(async () => {
    await trpc.chat.model.start.mutate({ organizationId: PILOT_ORGANIZATION });
    await refreshModel();
  }, [refreshModel]);

  return {
    view,
    threads,
    model,
    loading,
    sending,
    error,
    cloudDisclosure,
    pendingCloudMessage: pendingCloudRequest?.message ?? null,
    selectThread,
    switchBackend,
    openModuleChat,
    attachModule,
    loadOlder,
    newChat,
    send,
    confirmCloud,
    cancelCloud,
    decide,
    retry,
    cancel,
    archive,
    deleteChat,
    installModel,
    cancelInstall,
    startModel,
  };
}
