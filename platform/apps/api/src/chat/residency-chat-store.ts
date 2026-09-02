import {
  ChatCloudGrantError,
  ChatStoreConflictError,
  ChatStoreNotFoundError,
  ChatStoreScopeError,
  assertChatPlaneScope,
  type AddChatTurnRefInput,
  type AppendChatTurnInput,
  type ChatCloudGrant,
  type ChatOwnerScope,
  type ChatStore,
  type ChatThread,
  type ChatThreadPage,
  type ChatThreadQuery,
  type ChatTurn,
  type ChatTurnPage,
  type ChatTurnQuery,
  type ChatTurnRef,
  type CreateChatCloudGrantInput,
  type CreateChatThreadInput,
  type SetChatThreadBackendInput,
  type UpdateChatTurnInput,
} from "@bridge/core";

type StorePlane = "local" | "cloud";

function newestThreadFirst(left: ChatThread, right: ChatThread): number {
  return (
    right.updatedAt.localeCompare(left.updatedAt) ||
    right.id.localeCompare(left.id)
  );
}

/**
 * Routes private Chat exclusively to the file-backed Local Plane and public
 * Chat exclusively to Cloud Postgres. Thread identity is resolved from both
 * stores so a duplicated or wrong-plane row fails closed instead of silently
 * selecting one copy.
 */
export class ResidencyRoutingChatStore implements ChatStore {
  constructor(
    private readonly local: ChatStore | null,
    private readonly cloud: ChatStore,
  ) {}

  private storeForPlane(plane: StorePlane): ChatStore {
    if (plane === "local" && !this.local) {
      throw new ChatStoreScopeError(
        "chat-store: Local Plane Chat is unavailable in this deployment",
      );
    }
    return plane === "local" ? this.local! : this.cloud;
  }

  private assertStoredPlane(thread: ChatThread, plane: StorePlane): void {
    assertChatPlaneScope(thread.plane, thread.dataScope);
    if (thread.plane !== plane) {
      throw new ChatStoreScopeError(
        `chat-store: thread ${thread.id} is stored in ${plane} storage but declares ${thread.plane} residency`,
      );
    }
  }

  private async locate(
    scope: ChatOwnerScope,
    threadId: string,
  ): Promise<{ thread: ChatThread; store: ChatStore }> {
    const [localThread, cloudThread] = await Promise.all([
      this.local?.getThread(scope, threadId) ?? Promise.resolve(null),
      this.cloud.getThread(scope, threadId),
    ]);
    if (localThread) this.assertStoredPlane(localThread, "local");
    if (cloudThread) this.assertStoredPlane(cloudThread, "cloud");
    if (localThread && cloudThread) {
      throw new ChatStoreConflictError(
        `chat-store: thread ${threadId} exists in both Local and Cloud Plane stores`,
      );
    }
    if (localThread) return { thread: localThread, store: this.local! };
    if (cloudThread) return { thread: cloudThread, store: this.cloud };
    throw new ChatStoreNotFoundError(`chat-store: unknown thread ${threadId}`);
  }

  async createThread(
    scope: ChatOwnerScope,
    input: CreateChatThreadInput,
  ): Promise<ChatThread> {
    assertChatPlaneScope(input.plane, input.dataScope);
    const existing = await this.getThread(scope, input.id);
    if (existing && existing.plane !== input.plane) {
      throw new ChatStoreConflictError(
        `chat-store: thread id ${input.id} already exists in ${existing.plane} storage`,
      );
    }
    const thread = await this.storeForPlane(input.plane).createThread(scope, input);
    this.assertStoredPlane(thread, input.plane);
    return thread;
  }

  async getThread(
    scope: ChatOwnerScope,
    threadId: string,
  ): Promise<ChatThread | null> {
    try {
      return (await this.locate(scope, threadId)).thread;
    } catch (error) {
      if (error instanceof ChatStoreNotFoundError) return null;
      throw error;
    }
  }

  async listThreads(
    scope: ChatOwnerScope,
    query: ChatThreadQuery = {},
  ): Promise<ChatThreadPage> {
    const [localPage, cloudPage] = await Promise.all([
      this.local?.listThreads(scope, query) ??
        Promise.resolve<ChatThreadPage>({ items: [] }),
      this.cloud.listThreads(scope, query),
    ]);
    for (const thread of localPage.items) this.assertStoredPlane(thread, "local");
    for (const thread of cloudPage.items) this.assertStoredPlane(thread, "cloud");

    const seen = new Set<string>();
    const merged = [...localPage.items, ...cloudPage.items]
      .sort(newestThreadFirst)
      .filter((thread) => {
        if (seen.has(thread.id)) {
          throw new ChatStoreConflictError(
            `chat-store: thread ${thread.id} exists in both Local and Cloud Plane stores`,
          );
        }
        seen.add(thread.id);
        return true;
      });
    const limit = query.limit ?? 50;
    const items = merged.slice(0, limit);
    const hasNext =
      merged.length > limit ||
      localPage.nextCursor !== undefined ||
      cloudPage.nextCursor !== undefined;
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
    const located = await this.locate(scope, threadId);
    return located.store.archiveThread(scope, threadId);
  }

  async setThreadBackendSession(
    scope: ChatOwnerScope,
    threadId: string,
    backendSessionId: string,
  ): Promise<ChatThread> {
    const located = await this.locate(scope, threadId);
    return located.store.setThreadBackendSession(scope, threadId, backendSessionId);
  }

  /**
   * Switching engines keeps the conversation; switching PLANES would move its
   * rows between two physically separate stores, and this router does not move
   * rows. A same-plane switch passes through; a cross-plane one is refused
   * loudly rather than relabelling a thread whose turns would stay behind in
   * the other store. (The desktop deployment has one store, so a plane change
   * is an ordinary column update there and this path is never hit.)
   */
  async setThreadBackend(
    scope: ChatOwnerScope,
    input: SetChatThreadBackendInput,
  ): Promise<ChatThread> {
    const located = await this.locate(scope, input.threadId);
    if (located.thread.plane !== input.plane) {
      throw new ChatStoreScopeError(
        `chat-store: this deployment stores ${located.thread.plane} and ${input.plane} Chat separately, so a thread cannot move between them — start a new Chat on that model instead`,
      );
    }
    return located.store.setThreadBackend(scope, input);
  }

  async liveModuleThread(
    scope: ChatOwnerScope,
    moduleName: string,
  ): Promise<ChatThread | null> {
    const [local, cloud] = await Promise.all([
      this.local?.liveModuleThread(scope, moduleName) ?? Promise.resolve(null),
      this.cloud.liveModuleThread(scope, moduleName),
    ]);
    if (local && cloud) {
      // Both planes hold a live thread for this Module. Newest wins; the other
      // stays reachable in the thread list rather than being hidden or merged.
      return newestThreadFirst(local, cloud) <= 0 ? local : cloud;
    }
    return local ?? cloud;
  }

  async attachModule(
    scope: ChatOwnerScope,
    threadId: string,
    moduleName: string,
  ): Promise<ChatThread> {
    const located = await this.locate(scope, threadId);
    return located.store.attachModule(scope, threadId, moduleName);
  }

  async deleteThread(
    scope: ChatOwnerScope,
    threadId: string,
  ): Promise<boolean> {
    const located = await this.locate(scope, threadId);
    return located.store.deleteThread(scope, threadId);
  }

  async appendTurn(
    scope: ChatOwnerScope,
    input: AppendChatTurnInput,
  ): Promise<ChatTurn> {
    const located = await this.locate(scope, input.threadId);
    return located.store.appendTurn(scope, input);
  }

  async getTurn(
    scope: ChatOwnerScope,
    threadId: string,
    turnId: string,
  ): Promise<ChatTurn | null> {
    const located = await this.locate(scope, threadId);
    return located.store.getTurn(scope, threadId, turnId);
  }

  async listTurns(
    scope: ChatOwnerScope,
    threadId: string,
    query?: ChatTurnQuery,
  ): Promise<ChatTurnPage> {
    const located = await this.locate(scope, threadId);
    return located.store.listTurns(scope, threadId, query);
  }

  async listRecentTurns(
    scope: ChatOwnerScope,
    threadId: string,
    limit?: number,
  ): Promise<readonly ChatTurn[]> {
    const located = await this.locate(scope, threadId);
    return located.store.listRecentTurns(scope, threadId, limit);
  }

  async updateTurn(
    scope: ChatOwnerScope,
    input: UpdateChatTurnInput,
  ): Promise<ChatTurn> {
    const located = await this.locate(scope, input.threadId);
    return located.store.updateTurn(scope, input);
  }

  async addTurnRef(
    scope: ChatOwnerScope,
    input: AddChatTurnRefInput,
  ): Promise<ChatTurnRef> {
    const located = await this.locate(scope, input.threadId);
    return located.store.addTurnRef(scope, input);
  }

  async listTurnRefs(
    scope: ChatOwnerScope,
    threadId: string,
    turnId: string,
  ): Promise<readonly ChatTurnRef[]> {
    const located = await this.locate(scope, threadId);
    return located.store.listTurnRefs(scope, threadId, turnId);
  }

  async createCloudGrant(
    scope: ChatOwnerScope,
    input: CreateChatCloudGrantInput,
  ): Promise<ChatCloudGrant> {
    const located = await this.locate(scope, input.threadId);
    if (located.thread.plane !== "cloud" || located.store !== this.cloud) {
      throw new ChatCloudGrantError("requires a public Cloud Plane thread");
    }
    return this.cloud.createCloudGrant(scope, input);
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
    const located = await this.locate(scope, input.threadId);
    if (located.thread.plane !== "cloud" || located.store !== this.cloud) {
      throw new ChatCloudGrantError("requires a public Cloud Plane thread");
    }
    return this.cloud.consumeCloudGrant(scope, input);
  }
}
