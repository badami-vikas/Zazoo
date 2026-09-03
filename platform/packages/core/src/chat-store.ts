import type { ChatBackendId } from "./chat-backend.js";
import type { Plane } from "./types.js";
import {
  assertTaintLabel,
  hashTaintValue,
  type TaintLabel,
} from "./taint.js";

export type ChatDataScope = "private" | "public";
export type ChatThreadStatus = "active" | "archived";
export type ChatTurnRole = "system" | "user" | "assistant" | "skill";
export type ChatTurnActorType = "human" | "agent" | "system" | "skill";
export type ChatTurnState =
  | "queued"
  | "processing"
  | "awaiting_consent"
  | "awaiting_decision"
  | "completed"
  | "failed"
  | "cancelled";
export type ChatTurnRefKind =
  | "routing_decision"
  | "model_receipt"
  | "proposal"
  | "agent_run"
  | "automation_run"
  | "result"
  | "event"
  | "file"
  | "error";

export interface ChatOwnerScope {
  organizationId: string;
  ownerUserId: string;
}

export interface ChatThread {
  id: string;
  organizationId: string;
  ownerUserId: string;
  plane: Plane;
  dataScope: ChatDataScope;
  status: ChatThreadStatus;
  title?: string;
  /** Which ChatBackend answers this thread (chat-backend.ts). Threads created
   * before backends existed read as "bridge", the built-in ModelProvider path. */
  backend: ChatBackendId;
  /** The backend's own opaque resume handle, set after its first turn. */
  backendSessionId?: string;
  /** The Module whose live thread this is; absent for a standalone Chat. */
  moduleName?: string;
  /** Other Modules attached to this same conversation. */
  attachedModules: readonly string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateChatThreadInput {
  id: string;
  plane: Plane;
  dataScope: ChatDataScope;
  title?: string;
  /** Defaults to "bridge" — an omitted backend is the built-in path, never an
   * agentic one, so no caller acquires file-touching behaviour by accident. */
  backend?: ChatBackendId;
  /** Binds the thread to a Module so that Module reopens it next time. */
  moduleName?: string;
  attachedModules?: readonly string[];
}

/**
 * Switching a live thread's engine WITHOUT clearing it. The conversation is
 * Bridge's; which model answers it is a setting on that conversation, not a
 * reason to start over (user directive, 2026-09-02).
 *
 * `plane`/`dataScope` travel with the backend, because an agentic backend
 * declares its own residency. Moving a private Local thread onto a cloud
 * backend therefore RELABELS its stored turns, which is a declassification —
 * `ChatStore` implementations must refuse it when the two planes are different
 * physical stores, since a relabel there would silently strand the rows.
 */
export interface SetChatThreadBackendInput {
  threadId: string;
  backend: ChatBackendId;
  plane: Plane;
  dataScope: ChatDataScope;
}

export interface ChatThreadCursor {
  updatedAt: string;
  id: string;
}

export interface ChatThreadQuery {
  status?: ChatThreadStatus;
  cursor?: ChatThreadCursor;
  limit?: number;
}

export interface ChatThreadPage {
  items: readonly ChatThread[];
  nextCursor?: ChatThreadCursor;
}

export interface ChatTurn {
  id: string;
  organizationId: string;
  ownerUserId: string;
  threadId: string;
  sequence: number;
  role: ChatTurnRole;
  actorType: ChatTurnActorType;
  actorId?: string;
  content: string;
  state: ChatTurnState;
  clientRequestId: string;
  requestFingerprint: string;
  taintLabel: TaintLabel;
  errorCode?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppendChatTurnInput {
  id: string;
  threadId: string;
  role: ChatTurnRole;
  actorType: ChatTurnActorType;
  actorId?: string;
  content: string;
  state: ChatTurnState;
  clientRequestId: string;
  taintLabel: TaintLabel;
}

export interface ChatTurnCursor {
  sequence: number;
}

export interface ChatTurnQuery {
  cursor?: ChatTurnCursor;
  limit?: number;
}

export interface ChatTurnPage {
  items: readonly ChatTurn[];
  nextCursor?: ChatTurnCursor;
}

export interface UpdateChatTurnInput {
  threadId: string;
  turnId: string;
  expectedState: ChatTurnState;
  state: ChatTurnState;
  content?: string;
  errorCode?: string | null;
}

export interface ChatTurnRef {
  id: string;
  organizationId: string;
  ownerUserId: string;
  threadId: string;
  turnId: string;
  kind: ChatTurnRefKind;
  refId: string;
  createdAt: string;
}

export interface ChatCloudGrant {
  id: string;
  organizationId: string;
  ownerUserId: string;
  threadId: string;
  contextDigest: string;
  providerId: string;
  modelTier: string;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
}

export interface AddChatTurnRefInput {
  id: string;
  threadId: string;
  turnId: string;
  kind: ChatTurnRefKind;
  refId: string;
}

export interface CreateChatCloudGrantInput {
  id: string;
  threadId: string;
  contextDigest: string;
  providerId: string;
  modelTier: string;
  expiresAt: string;
}

export interface ChatStore {
  createThread(scope: ChatOwnerScope, input: CreateChatThreadInput): Promise<ChatThread>;
  getThread(scope: ChatOwnerScope, threadId: string): Promise<ChatThread | null>;
  listThreads(scope: ChatOwnerScope, query?: ChatThreadQuery): Promise<ChatThreadPage>;
  archiveThread(scope: ChatOwnerScope, threadId: string): Promise<ChatThread | null>;
  /** Persist the backend's resume handle after a turn. Refused on a "bridge"
   * thread — that backend has no session of its own to resume. */
  setThreadBackendSession(
    scope: ChatOwnerScope,
    threadId: string,
    backendSessionId: string,
  ): Promise<ChatThread>;
  /** Repoint a live thread at a different backend, keeping every turn. Clears
   * the old backend's session handle — it belongs to an engine that is no
   * longer answering. */
  setThreadBackend(
    scope: ChatOwnerScope,
    input: SetChatThreadBackendInput,
  ): Promise<ChatThread>;
  /** The Module's live thread — most recently updated active thread bound to
   * `moduleName` — or null when that Module has never been talked to. */
  liveModuleThread(
    scope: ChatOwnerScope,
    moduleName: string,
  ): Promise<ChatThread | null>;
  /** Pull another Module into an existing conversation. Idempotent. */
  attachModule(
    scope: ChatOwnerScope,
    threadId: string,
    moduleName: string,
  ): Promise<ChatThread>;
  deleteThread(scope: ChatOwnerScope, threadId: string): Promise<boolean>;
  appendTurn(scope: ChatOwnerScope, input: AppendChatTurnInput): Promise<ChatTurn>;
  getTurn(scope: ChatOwnerScope, threadId: string, turnId: string): Promise<ChatTurn | null>;
  listTurns(
    scope: ChatOwnerScope,
    threadId: string,
    query?: ChatTurnQuery,
  ): Promise<ChatTurnPage>;
  listRecentTurns(
    scope: ChatOwnerScope,
    threadId: string,
    limit?: number,
  ): Promise<readonly ChatTurn[]>;
  updateTurn(scope: ChatOwnerScope, input: UpdateChatTurnInput): Promise<ChatTurn>;
  addTurnRef(scope: ChatOwnerScope, input: AddChatTurnRefInput): Promise<ChatTurnRef>;
  listTurnRefs(
    scope: ChatOwnerScope,
    threadId: string,
    turnId: string,
  ): Promise<readonly ChatTurnRef[]>;
  createCloudGrant(
    scope: ChatOwnerScope,
    input: CreateChatCloudGrantInput,
  ): Promise<ChatCloudGrant>;
  consumeCloudGrant(
    scope: ChatOwnerScope,
    input: {
      id: string;
      threadId: string;
      contextDigest: string;
      providerId: string;
      modelTier: string;
    },
  ): Promise<ChatCloudGrant>;
}

export class ChatStoreConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatStoreConflictError";
  }
}

export class ChatStoreNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatStoreNotFoundError";
  }
}

export class ChatStoreScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatStoreScopeError";
  }
}

export class ChatCloudGrantError extends Error {
  constructor(message: string) {
    super(`chat-store: cloud grant ${message}`);
    this.name = "ChatCloudGrantError";
  }
}

const TERMINAL_TURN_STATES = new Set<ChatTurnState>(["completed", "failed", "cancelled"]);
const TURN_TRANSITIONS: Readonly<Record<ChatTurnState, readonly ChatTurnState[]>> = {
  queued: ["processing", "completed", "failed", "cancelled"],
  processing: ["awaiting_consent", "awaiting_decision", "completed", "failed", "cancelled"],
  awaiting_consent: ["processing", "failed", "cancelled"],
  awaiting_decision: ["processing", "completed", "failed", "cancelled"],
  completed: [],
  failed: ["processing"],
  cancelled: [],
};

function requireText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`chat-store: ${field} is required`);
  return normalized;
}

function normalizedOptionalText(value: string | undefined, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requireText(value, field);
}

/** A resume handle only means something for a backend that has its own
 * session. Storing one against "bridge" would be a lie the database also
 * refuses (chat_threads_backend_session_check), so both layers agree. */
export function assertBackendSessionAllowed(
  backend: ChatBackendId,
  backendSessionId: string,
): void {
  if (backend === "bridge") {
    throw new ChatStoreScopeError(
      "chat-store: the built-in backend has no session to resume",
    );
  }
  if (backendSessionId.trim().length === 0) {
    throw new ChatStoreScopeError("chat-store: backend session id must be non-empty");
  }
}

export function assertChatPlaneScope(plane: Plane, dataScope: ChatDataScope): void {
  if (
    (plane === "local" && dataScope !== "private") ||
    (plane === "cloud" && dataScope !== "public")
  ) {
    throw new ChatStoreScopeError(
      `chat-store: ${plane} threads require ${plane === "local" ? "private" : "public"} data scope`,
    );
  }
}

export function assertChatTurnTransition(from: ChatTurnState, to: ChatTurnState): void {
  if (from === to) return;
  if (!TURN_TRANSITIONS[from].includes(to)) {
    throw new ChatStoreConflictError(`chat-store: invalid turn transition ${from} -> ${to}`);
  }
}

export function chatTurnIsTerminal(state: ChatTurnState): boolean {
  return TERMINAL_TURN_STATES.has(state);
}

function isFailedRetry(
  current: ChatTurnState,
  next: ChatTurnState,
): boolean {
  return current === "failed" && next === "processing";
}

export function assertChatTurnForThread(
  thread: ChatThread,
  input: AppendChatTurnInput,
): void {
  requireText(input.id, "turn id");
  requireText(input.threadId, "thread id");
  requireText(input.clientRequestId, "client request id");
  if (input.role === "user" && !input.content.trim()) {
    throw new Error("chat-store: user turn content is required");
  }
  if (input.role === "user" && input.actorType !== "human") {
    throw new ChatStoreScopeError("chat-store: user turns require a human actor");
  }
  if (input.actorType === "human" && input.actorId !== thread.ownerUserId) {
    throw new ChatStoreScopeError(
      `chat-store: human turns must be attributed to thread owner ${thread.ownerUserId}`,
    );
  }
  if (
    (input.actorType === "agent" || input.actorType === "skill") &&
    !input.actorId?.trim()
  ) {
    throw new Error(`chat-store: ${input.actorType} actor id is required`);
  }
  if (input.role === "system" && input.actorType !== "system") {
    throw new ChatStoreScopeError("chat-store: system turns require a system actor");
  }
  if (input.role === "skill" && input.actorType !== "skill") {
    throw new ChatStoreScopeError("chat-store: Skill turns require a Skill actor");
  }
  if (input.role === "assistant" && input.actorType === "human") {
    throw new ChatStoreScopeError("chat-store: assistant turns cannot use a human actor");
  }
  if (thread.status !== "active") {
    throw new ChatStoreConflictError(`chat-store: thread ${thread.id} is archived`);
  }
  assertTaintLabel(input.taintLabel);
  if (thread.dataScope === "public" && input.taintLabel.sensitivity !== "public") {
    throw new ChatStoreScopeError(
      `chat-store: public thread ${thread.id} rejects ${input.taintLabel.sensitivity} turn data`,
    );
  }
}

export function chatPageLimit(limit: number | undefined): number {
  if (limit === undefined) return 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("chat-store: page limit must be an integer from 1 to 100");
  }
  return limit;
}

export function chatTurnRequestFingerprint(input: AppendChatTurnInput): string {
  assertTaintLabel(input.taintLabel);
  return hashTaintValue({
    version: 1,
    id: input.id,
    threadId: input.threadId,
    role: input.role,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    content: input.content,
    state: input.state,
    clientRequestId: input.clientRequestId,
    taintLabel: input.taintLabel,
  });
}

export function assertChatTurnIdempotentReplay(
  existing: ChatTurn,
  input: AppendChatTurnInput,
): void {
  if (existing.requestFingerprint !== chatTurnRequestFingerprint(input)) {
    throw new ChatStoreConflictError(
      `chat-store: client request ${input.clientRequestId} was reused with different turn data`,
    );
  }
}

export function assertChatRefIdempotentReplay(
  existing: ChatTurnRef,
  input: AddChatTurnRefInput,
): void {
  if (
    existing.id !== input.id ||
    existing.threadId !== input.threadId ||
    existing.turnId !== input.turnId ||
    existing.kind !== input.kind ||
    existing.refId !== input.refId
  ) {
    throw new ChatStoreConflictError(
      `chat-store: reference ${input.kind}:${input.refId} was reused with different data`,
    );
  }
}

function cloneThread(thread: ChatThread): ChatThread {
  return { ...thread };
}

function cloneTurn(turn: ChatTurn): ChatTurn {
  return {
    ...turn,
    taintLabel: {
      ...turn.taintLabel,
      originChain: turn.taintLabel.originChain.map((origin) => ({ ...origin })),
    },
  };
}

function cloneRef(ref: ChatTurnRef): ChatTurnRef {
  return { ...ref };
}

function cloneCloudGrant(grant: ChatCloudGrant): ChatCloudGrant {
  return { ...grant };
}

function sameOwner(scope: ChatOwnerScope, value: ChatOwnerScope): boolean {
  return (
    scope.organizationId === value.organizationId &&
    scope.ownerUserId === value.ownerUserId
  );
}

export class InMemoryChatStore implements ChatStore {
  private readonly threads = new Map<string, ChatThread>();
  private readonly turns = new Map<string, ChatTurn>();
  private readonly refs = new Map<string, ChatTurnRef>();
  private readonly cloudGrants = new Map<string, ChatCloudGrant>();

  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  async createThread(
    scope: ChatOwnerScope,
    input: CreateChatThreadInput,
  ): Promise<ChatThread> {
    requireText(scope.organizationId, "organization id");
    requireText(scope.ownerUserId, "owner user id");
    requireText(input.id, "thread id");
    assertChatPlaneScope(input.plane, input.dataScope);
    const title = normalizedOptionalText(input.title, "title");
    const existing = this.threads.get(input.id);
    if (existing) {
      if (
        sameOwner(scope, existing) &&
        existing.plane === input.plane &&
        existing.dataScope === input.dataScope &&
        existing.title === title &&
        existing.backend === (input.backend ?? "bridge")
      ) {
        return cloneThread(existing);
      }
      throw new ChatStoreConflictError(`chat-store: thread id ${input.id} already exists`);
    }
    const createdAt = this.now();
    const thread: ChatThread = {
      id: input.id,
      organizationId: scope.organizationId,
      ownerUserId: scope.ownerUserId,
      plane: input.plane,
      dataScope: input.dataScope,
      status: "active",
      ...(title ? { title } : {}),
      backend: input.backend ?? "bridge",
      ...(input.moduleName ? { moduleName: input.moduleName } : {}),
      attachedModules: [...(input.attachedModules ?? [])],
      createdAt,
      updatedAt: createdAt,
    };
    this.threads.set(thread.id, thread);
    return cloneThread(thread);
  }

  async getThread(scope: ChatOwnerScope, threadId: string): Promise<ChatThread | null> {
    const thread = this.threads.get(threadId);
    return thread && sameOwner(scope, thread) ? cloneThread(thread) : null;
  }

  async listThreads(
    scope: ChatOwnerScope,
    query: ChatThreadQuery = {},
  ): Promise<ChatThreadPage> {
    const limit = chatPageLimit(query.limit);
    const matching = [...this.threads.values()]
      .filter((thread) => sameOwner(scope, thread))
      .filter((thread) => query.status === undefined || thread.status === query.status)
      .filter((thread) => {
        if (!query.cursor) return true;
        return (
          thread.updatedAt < query.cursor.updatedAt ||
          (thread.updatedAt === query.cursor.updatedAt && thread.id < query.cursor.id)
        );
      })
      .sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id)
      );
    const page = matching.slice(0, limit + 1);
    const hasNext = page.length > limit;
    const items = page.slice(0, limit).map(cloneThread);
    const last = items.at(-1);
    return {
      items,
      ...(hasNext && last
        ? { nextCursor: { updatedAt: last.updatedAt, id: last.id } }
        : {}),
    };
  }

  async archiveThread(
    scope: ChatOwnerScope,
    threadId: string,
  ): Promise<ChatThread | null> {
    const thread = this.threads.get(threadId);
    if (!thread || !sameOwner(scope, thread)) return null;
    if (thread.status === "archived") return cloneThread(thread);
    const archived = { ...thread, status: "archived" as const, updatedAt: this.now() };
    this.threads.set(threadId, archived);
    return cloneThread(archived);
  }

  async setThreadBackendSession(
    scope: ChatOwnerScope,
    threadId: string,
    backendSessionId: string,
  ): Promise<ChatThread> {
    const thread = this.threads.get(threadId);
    if (!thread || !sameOwner(scope, thread)) {
      throw new ChatStoreNotFoundError(`chat-store: thread ${threadId} not found`);
    }
    assertBackendSessionAllowed(thread.backend, backendSessionId);
    const updated = { ...thread, backendSessionId, updatedAt: this.now() };
    this.threads.set(threadId, updated);
    return cloneThread(updated);
  }

  async setThreadBackend(
    scope: ChatOwnerScope,
    input: SetChatThreadBackendInput,
  ): Promise<ChatThread> {
    const thread = this.threads.get(input.threadId);
    if (!thread || !sameOwner(scope, thread)) {
      throw new ChatStoreNotFoundError(`chat-store: thread ${input.threadId} not found`);
    }
    assertChatPlaneScope(input.plane, input.dataScope);
    const updated: ChatThread = {
      ...thread,
      backend: input.backend,
      plane: input.plane,
      dataScope: input.dataScope,
      updatedAt: this.now(),
    };
    delete updated.backendSessionId;
    this.threads.set(input.threadId, updated);
    return cloneThread(updated);
  }

  async liveModuleThread(
    scope: ChatOwnerScope,
    moduleName: string,
  ): Promise<ChatThread | null> {
    const candidates = [...this.threads.values()]
      .filter((thread) => sameOwner(scope, thread))
      .filter((thread) => thread.status === "active" && thread.moduleName === moduleName)
      .sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id),
      );
    return candidates[0] ? cloneThread(candidates[0]) : null;
  }

  async attachModule(
    scope: ChatOwnerScope,
    threadId: string,
    moduleName: string,
  ): Promise<ChatThread> {
    const thread = this.threads.get(threadId);
    if (!thread || !sameOwner(scope, thread)) {
      throw new ChatStoreNotFoundError(`chat-store: thread ${threadId} not found`);
    }
    const name = moduleName.trim();
    if (!name) throw new ChatStoreScopeError("chat-store: module name must be non-empty");
    if (thread.moduleName === name || thread.attachedModules.includes(name)) {
      return cloneThread(thread);
    }
    const updated: ChatThread = {
      ...thread,
      attachedModules: [...thread.attachedModules, name],
      updatedAt: this.now(),
    };
    this.threads.set(threadId, updated);
    return cloneThread(updated);
  }

  async deleteThread(scope: ChatOwnerScope, threadId: string): Promise<boolean> {
    const thread = this.threads.get(threadId);
    if (!thread || !sameOwner(scope, thread)) return false;
    this.threads.delete(threadId);
    for (const [id, turn] of this.turns) {
      if (turn.threadId === threadId) this.turns.delete(id);
    }
    for (const [id, ref] of this.refs) {
      if (ref.threadId === threadId) this.refs.delete(id);
    }
    for (const [id, grant] of this.cloudGrants) {
      if (grant.threadId === threadId) this.cloudGrants.delete(id);
    }
    return true;
  }

  async appendTurn(scope: ChatOwnerScope, input: AppendChatTurnInput): Promise<ChatTurn> {
    const thread = this.threads.get(input.threadId);
    if (!thread || !sameOwner(scope, thread)) {
      throw new ChatStoreNotFoundError(`chat-store: unknown thread ${input.threadId}`);
    }
    const existingByRequest = [...this.turns.values()].find(
      (turn) =>
        turn.threadId === input.threadId &&
        turn.clientRequestId === input.clientRequestId,
    );
    if (existingByRequest) {
      assertChatTurnIdempotentReplay(existingByRequest, input);
      return cloneTurn(existingByRequest);
    }
    assertChatTurnForThread(thread, input);
    if (this.turns.has(input.id)) {
      throw new ChatStoreConflictError(`chat-store: turn id ${input.id} already exists`);
    }
    const sequence = [...this.turns.values()]
      .filter((turn) => turn.threadId === input.threadId)
      .reduce((maximum, turn) => Math.max(maximum, turn.sequence), 0) + 1;
    const createdAt = this.now();
    const turn: ChatTurn = {
      ...input,
      organizationId: scope.organizationId,
      ownerUserId: scope.ownerUserId,
      sequence,
      requestFingerprint: chatTurnRequestFingerprint(input),
      createdAt,
      updatedAt: createdAt,
    };
    this.turns.set(turn.id, turn);
    this.threads.set(thread.id, { ...thread, updatedAt: createdAt });
    return cloneTurn(turn);
  }

  async getTurn(
    scope: ChatOwnerScope,
    threadId: string,
    turnId: string,
  ): Promise<ChatTurn | null> {
    const turn = this.turns.get(turnId);
    return turn &&
      turn.threadId === threadId &&
      sameOwner(scope, turn)
      ? cloneTurn(turn)
      : null;
  }

  async listTurns(
    scope: ChatOwnerScope,
    threadId: string,
    query: ChatTurnQuery = {},
  ): Promise<ChatTurnPage> {
    const thread = this.threads.get(threadId);
    if (!thread || !sameOwner(scope, thread)) {
      throw new ChatStoreNotFoundError(`chat-store: unknown thread ${threadId}`);
    }
    const limit = chatPageLimit(query.limit);
    const page = [...this.turns.values()]
      .filter((turn) => turn.threadId === threadId && sameOwner(scope, turn))
      .filter((turn) => query.cursor === undefined || turn.sequence < query.cursor.sequence)
      .sort((left, right) => right.sequence - left.sequence)
      .slice(0, limit + 1);
    const hasNext = page.length > limit;
    const items = page.slice(0, limit).reverse().map(cloneTurn);
    const first = items[0];
    return {
      items,
      ...(hasNext && first ? { nextCursor: { sequence: first.sequence } } : {}),
    };
  }

  async listRecentTurns(
    scope: ChatOwnerScope,
    threadId: string,
    limit = 24,
  ): Promise<readonly ChatTurn[]> {
    const thread = this.threads.get(threadId);
    if (!thread || !sameOwner(scope, thread)) {
      throw new ChatStoreNotFoundError(`chat-store: unknown thread ${threadId}`);
    }
    const bounded = chatPageLimit(limit);
    return [...this.turns.values()]
      .filter((turn) => turn.threadId === threadId && sameOwner(scope, turn))
      .sort((left, right) => right.sequence - left.sequence)
      .slice(0, bounded)
      .reverse()
      .map(cloneTurn);
  }

  async updateTurn(scope: ChatOwnerScope, input: UpdateChatTurnInput): Promise<ChatTurn> {
    const turn = this.turns.get(input.turnId);
    if (
      !turn ||
      turn.threadId !== input.threadId ||
      !sameOwner(scope, turn)
    ) {
      throw new ChatStoreNotFoundError(`chat-store: unknown turn ${input.turnId}`);
    }
    if (turn.state !== input.expectedState) {
      throw new ChatStoreConflictError(
        `chat-store: turn ${input.turnId} is ${turn.state}, expected ${input.expectedState}`,
      );
    }
    assertChatTurnTransition(turn.state, input.state);
    if (
      input.content !== undefined &&
      chatTurnIsTerminal(turn.state) &&
      !isFailedRetry(turn.state, input.state) &&
      input.content !== turn.content
    ) {
      throw new ChatStoreConflictError(
        `chat-store: terminal turn ${input.turnId} content is immutable`,
      );
    }
    const updatedAt = this.now();
    const updated: ChatTurn = {
      ...turn,
      state: input.state,
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.errorCode !== undefined && input.errorCode !== null
        ? { errorCode: requireText(input.errorCode, "error code") }
        : {}),
      updatedAt,
    };
    if (input.errorCode === null) delete updated.errorCode;
    this.turns.set(turn.id, updated);
    const thread = this.threads.get(turn.threadId);
    if (thread) this.threads.set(thread.id, { ...thread, updatedAt });
    return cloneTurn(updated);
  }

  async addTurnRef(
    scope: ChatOwnerScope,
    input: AddChatTurnRefInput,
  ): Promise<ChatTurnRef> {
    requireText(input.id, "reference id");
    requireText(input.refId, "referenced id");
    const turn = this.turns.get(input.turnId);
    if (
      !turn ||
      turn.threadId !== input.threadId ||
      !sameOwner(scope, turn)
    ) {
      throw new ChatStoreNotFoundError(`chat-store: unknown turn ${input.turnId}`);
    }
    const existing = [...this.refs.values()].find(
      (ref) =>
        ref.turnId === input.turnId &&
        ref.kind === input.kind &&
        ref.refId === input.refId,
    );
    if (existing) {
      assertChatRefIdempotentReplay(existing, input);
      return cloneRef(existing);
    }
    if (this.refs.has(input.id)) {
      throw new ChatStoreConflictError(`chat-store: reference id ${input.id} already exists`);
    }
    const ref: ChatTurnRef = {
      ...input,
      organizationId: scope.organizationId,
      ownerUserId: scope.ownerUserId,
      createdAt: this.now(),
    };
    this.refs.set(ref.id, ref);
    const thread = this.threads.get(input.threadId);
    if (thread) this.threads.set(thread.id, { ...thread, updatedAt: ref.createdAt });
    return cloneRef(ref);
  }

  async listTurnRefs(
    scope: ChatOwnerScope,
    threadId: string,
    turnId: string,
  ): Promise<readonly ChatTurnRef[]> {
    const turn = this.turns.get(turnId);
    if (!turn || turn.threadId !== threadId || !sameOwner(scope, turn)) {
      throw new ChatStoreNotFoundError(`chat-store: unknown turn ${turnId}`);
    }
    return [...this.refs.values()]
      .filter((ref) => ref.turnId === turnId && sameOwner(scope, ref))
      .sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
      )
      .map(cloneRef);
  }

  async createCloudGrant(
    scope: ChatOwnerScope,
    input: CreateChatCloudGrantInput,
  ): Promise<ChatCloudGrant> {
    requireText(input.id, "cloud grant id");
    requireText(input.contextDigest, "cloud grant context digest");
    requireText(input.providerId, "cloud grant provider id");
    requireText(input.modelTier, "cloud grant model tier");
    const thread = this.threads.get(input.threadId);
    if (!thread || !sameOwner(scope, thread)) {
      throw new ChatStoreNotFoundError(`chat-store: unknown thread ${input.threadId}`);
    }
    if (thread.plane !== "cloud" || thread.dataScope !== "public") {
      throw new ChatCloudGrantError("requires a public Cloud Plane thread");
    }
    const createdAt = this.now();
    if (input.expiresAt <= createdAt) {
      throw new ChatCloudGrantError("must expire in the future");
    }
    const grant: ChatCloudGrant = {
      ...input,
      organizationId: scope.organizationId,
      ownerUserId: scope.ownerUserId,
      consumedAt: null,
      createdAt,
    };
    const existing = this.cloudGrants.get(input.id);
    if (existing) {
      if (
        !sameOwner(scope, existing) ||
        existing.threadId !== grant.threadId ||
        existing.contextDigest !== grant.contextDigest ||
        existing.providerId !== grant.providerId ||
        existing.modelTier !== grant.modelTier ||
        existing.expiresAt !== grant.expiresAt
      ) {
        throw new ChatStoreConflictError(
          `chat-store: cloud grant id ${input.id} already exists`,
        );
      }
      return cloneCloudGrant(existing);
    }
    this.cloudGrants.set(grant.id, grant);
    return cloneCloudGrant(grant);
  }

  async consumeCloudGrant(
    scope: ChatOwnerScope,
    input: {
      id: string;
      threadId: string;
      contextDigest: string;
      providerId: string;
      modelTier: string;
    },
  ): Promise<ChatCloudGrant> {
    const thread = this.threads.get(input.threadId);
    if (!thread || !sameOwner(scope, thread)) {
      throw new ChatCloudGrantError("was not found");
    }
    const grant = this.cloudGrants.get(input.id);
    if (
      !grant ||
      !sameOwner(scope, grant) ||
      grant.threadId !== input.threadId
    ) {
      throw new ChatCloudGrantError("was not found");
    }
    if (grant.consumedAt) throw new ChatCloudGrantError("was already consumed");
    const now = this.now();
    if (grant.expiresAt <= now) throw new ChatCloudGrantError("has expired");
    if (
      grant.contextDigest !== input.contextDigest ||
      grant.providerId !== input.providerId ||
      grant.modelTier !== input.modelTier
    ) {
      throw new ChatCloudGrantError("does not match the exact prepared context");
    }
    const consumed = { ...grant, consumedAt: now };
    this.cloudGrants.set(grant.id, consumed);
    return cloneCloudGrant(consumed);
  }
}
