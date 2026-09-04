/**
 * ChatBackend — the swappable port behind every Bridge conversation surface
 * (Right Chat Panel, Chief of Staff, Avatar Chat).
 *
 * Bridge has had exactly one way to answer a Chat turn: assemble a prompt and
 * call a `ModelProvider.complete()`, which returns TEXT and nothing else. That
 * is one backend shape, not the only one. An *agentic* backend (Claude Code
 * through the Agent SDK, and later Codex/Cursor) does not answer by completing
 * a prompt — it runs a tool loop of its own in a subprocess, reads and edits
 * files, and returns a summary of what it did. Those two shapes cannot be
 * unified behind `complete()` without lying about one of them, so this file
 * introduces the wider port and lets `ModelProvider` keep its narrower job.
 *
 * Swappability is the point (user directive, 2026-09-02: "I hope capabilities
 * are designed as swappable elements"): a backend is chosen per THREAD, named
 * by a stable id, and resolved through a registry. Adding Codex or Cursor is a
 * new module implementing this interface plus a registry row — no change to
 * the router, the store, or the UI beyond the option itself.
 *
 * Residency: `plane` is declared by the backend, not inferred. An agentic
 * backend that ships file contents to a hosted model is `cloud` even though it
 * runs on the user's own machine — where the PROCESS runs and where the DATA
 * goes are different questions, and Bridge's residency boundary is the second
 * one. This module is pure types + a registry; it holds no Node import and no
 * network call, so it stays safe for the browser bundle's import graph.
 */
import type { Plane } from "./types.js";

/** Stable backend ids. "bridge" is the built-in ModelProvider path that every
 * existing thread uses; the rest are external coding agents. The union is
 * closed on purpose — a thread row stores one of these, and an unknown value
 * in the database should fail a parse rather than route somewhere unexpected. */
export const CHAT_BACKEND_IDS = ["bridge", "claude_code"] as const;

export type ChatBackendId = (typeof CHAT_BACKEND_IDS)[number];

export function isChatBackendId(value: string): value is ChatBackendId {
  return (CHAT_BACKEND_IDS as readonly string[]).includes(value);
}

/** What one backend turn produced. `backendSessionId` is the backend's OWN
 * conversation handle (the Agent SDK's session id, for instance) — Bridge
 * stores it on the thread and hands it back next turn so context survives a
 * server restart. Bridge never interprets it; it is an opaque token. */
export interface ChatBackendTurn {
  /** The assistant's reply text, already plain prose — an agentic backend has
   * no envelope to parse because it never saw Bridge's response schema. */
  reply: string;
  /** Resume handle for the next turn, or null when the backend is stateless. */
  backendSessionId: string | null;
  /** Files the backend reported changing, repository-relative, for the turn's
   * refs. Empty when the backend does not report them. */
  changedPaths?: readonly string[];
}

export interface ChatBackendSendArgs {
  text: string;
  /** The handle returned by this backend's previous turn on this thread. */
  backendSessionId: string | null;
  /** Working directory the backend operates in — the Organization's local
   * Module root, never the whole filesystem. */
  workingDirectory: string;
  organizationId: string;
  signal?: AbortSignal;
  /** Bridge's own briefing for an agentic backend — what Bridge is, what a
   * Module is and how one is built — appended to the backend's system prompt.
   * Without it the agent sees only a folder and the user's sentence. */
  system?: string;
}

/**
 * One conversational backend. Implementations live outside @bridge/core (the
 * Agent SDK adapter is Node-only and belongs in apps/api) so this package
 * keeps its zero-runtime-dependency discipline.
 */
export interface ChatBackend {
  readonly id: ChatBackendId;
  /** Human label for the model menu. */
  readonly label: string;
  /** Where this backend's data goes — see the residency note in the header. */
  readonly plane: Plane;
  /** True when the backend runs its own tool loop and can change files. The UI
   * uses this to warn before the first turn; governance uses it to require a
   * working directory that is inside the Local Plane. */
  readonly agentic: boolean;
  /** Whether this backend can accept a turn right now, and if not, why. A
   * backend that needs sign-in reports it here rather than throwing on send,
   * so the model menu can show the state before the user types. */
  readiness(organizationId: string): Promise<ChatBackendReadiness>;
  send(args: ChatBackendSendArgs): Promise<ChatBackendTurn>;
}

export interface ChatBackendReadiness {
  ready: boolean;
  /** Present when `ready` is false — a sentence the UI shows verbatim. */
  reason?: string;
  /** True when the blocker is authentication the user can clear themselves,
   * which is the one case the UI offers a sign-in button for. */
  needsSignIn?: boolean;
}

/** Registry of the backends this process actually wired. Absence is honest:
 * a backend missing from the registry is not offered in the menu at all,
 * rather than offered and failing on send. */
export interface ChatBackendRegistry {
  get(id: ChatBackendId): ChatBackend | null;
  list(): readonly ChatBackend[];
}

export function createChatBackendRegistry(
  backends: readonly ChatBackend[],
): ChatBackendRegistry {
  const byId = new Map<ChatBackendId, ChatBackend>();
  for (const backend of backends) {
    if (byId.has(backend.id)) {
      throw new Error(`createChatBackendRegistry: duplicate backend id ${backend.id}`);
    }
    byId.set(backend.id, backend);
  }
  return {
    get: (id) => byId.get(id) ?? null,
    list: () => [...byId.values()],
  };
}
