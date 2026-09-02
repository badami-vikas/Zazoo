import {
  and,
  asc,
  desc,
  eq,
  gt,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  ChatStoreConflictError,
  ChatStoreNotFoundError,
  ChatCloudGrantError,
  assertBackendSessionAllowed,
  assertChatPlaneScope,
  ChatStoreScopeError,
  assertChatRefIdempotentReplay,
  assertChatTurnForThread,
  assertChatTurnIdempotentReplay,
  assertChatTurnTransition,
  chatPageLimit,
  chatTurnRequestFingerprint,
  chatTurnIsTerminal,
  storedTaintLabelOrUnknown,
  type AddChatTurnRefInput,
  type AppendChatTurnInput,
  type ChatOwnerScope,
  type ChatCloudGrant,
  type ChatStore,
  type ChatThread,
  type ChatThreadPage,
  type ChatThreadQuery,
  type ChatThreadStatus,
  type ChatTurn,
  type ChatTurnPage,
  type ChatTurnQuery,
  type ChatTurnRef,
  type CreateChatThreadInput,
  type SetChatThreadBackendInput,
  type CreateChatCloudGrantInput,
  type UpdateChatTurnInput,
} from "@bridge/core";
import type { Database } from "./client.js";
import { withOrganizationContext } from "./organization-context.js";
import { chatCloudGrants, chatThreads, chatTurnRefs, chatTurns } from "./schema.js";
import { parseDatabaseUuid } from "./uuid.js";

type ChatThreadRow = typeof chatThreads.$inferSelect;
type ChatTurnRow = typeof chatTurns.$inferSelect;
type ChatTurnRefRow = typeof chatTurnRefs.$inferSelect;
type ChatCloudGrantRow = typeof chatCloudGrants.$inferSelect;

function unpackThread(row: ChatThreadRow): ChatThread {
  return {
    id: row.id,
    organizationId: row.organizationId,
    ownerUserId: row.ownerUserId,
    plane: row.plane as ChatThread["plane"],
    dataScope: row.dataScope as ChatThread["dataScope"],
    status: row.status as ChatThreadStatus,
    ...(row.title !== null ? { title: row.title } : {}),
    backend: row.backend as ChatThread["backend"],
    ...(row.backendSessionId !== null ? { backendSessionId: row.backendSessionId } : {}),
    ...(row.moduleName !== null ? { moduleName: row.moduleName } : {}),
    attachedModules: row.attachedModules ?? [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function unpackTurn(row: ChatTurnRow): ChatTurn {
  return {
    id: row.id,
    organizationId: row.organizationId,
    ownerUserId: row.ownerUserId,
    threadId: row.threadId,
    sequence: row.sequence,
    role: row.role as ChatTurn["role"],
    actorType: row.actorType as ChatTurn["actorType"],
    ...(row.actorId !== null ? { actorId: row.actorId } : {}),
    content: row.content,
    state: row.state as ChatTurn["state"],
    clientRequestId: row.clientRequestId,
    requestFingerprint: row.requestFingerprint,
    taintLabel: storedTaintLabelOrUnknown(row.taintLabel).label,
    ...(row.errorCode !== null ? { errorCode: row.errorCode } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function unpackRef(row: ChatTurnRefRow): ChatTurnRef {
  return {
    id: row.id,
    organizationId: row.organizationId,
    ownerUserId: row.ownerUserId,
    threadId: row.threadId,
    turnId: row.turnId,
    kind: row.kind as ChatTurnRef["kind"],
    refId: row.refId,
    createdAt: row.createdAt.toISOString(),
  };
}

function unpackCloudGrant(row: ChatCloudGrantRow): ChatCloudGrant {
  return {
    id: row.id,
    organizationId: row.organizationId,
    ownerUserId: row.ownerUserId,
    threadId: row.threadId,
    contextDigest: row.contextDigest,
    providerId: row.providerId,
    modelTier: row.modelTier,
    expiresAt: row.expiresAt.toISOString(),
    consumedAt: row.consumedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function normalizeOptionalText(value: string | undefined, field: string): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) throw new Error(`chat-store: ${field} is required`);
  return normalized;
}

function requireText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`chat-store: ${field} is required`);
  return normalized;
}

function parseCursorDate(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`chat-store: invalid thread cursor timestamp ${value}`);
  }
  return parsed;
}

function ownerThreadWhere(scope: ChatOwnerScope, threadId: string): SQL {
  return and(
    eq(chatThreads.organizationId, scope.organizationId),
    eq(chatThreads.ownerUserId, scope.ownerUserId),
    eq(chatThreads.id, threadId),
  ) as SQL;
}

function ownerTurnWhere(
  scope: ChatOwnerScope,
  threadId: string,
  turnId: string,
): SQL {
  return and(
    eq(chatTurns.organizationId, scope.organizationId),
    eq(chatTurns.ownerUserId, scope.ownerUserId),
    eq(chatTurns.threadId, threadId),
    eq(chatTurns.id, turnId),
  ) as SQL;
}

async function lockChatThread(tx: Database, threadId: string): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext((${threadId}::uuid)::text))`,
  );
}

function sameThreadCreate(existing: ChatThread, input: CreateChatThreadInput): boolean {
  return (
    existing.plane === input.plane &&
    existing.dataScope === input.dataScope &&
    existing.title === normalizeOptionalText(input.title, "title") &&
    existing.backend === (input.backend ?? "bridge") &&
    existing.moduleName === input.moduleName
  );
}

export class DrizzleChatStore implements ChatStore {
  constructor(private readonly db: Database) {}

  private scoped<T>(
    scope: ChatOwnerScope,
    operation: (tx: Database) => Promise<T>,
  ): Promise<T> {
    return withOrganizationContext(
      this.db,
      {
        organizationId: scope.organizationId,
        userId: scope.ownerUserId,
      },
      operation,
    );
  }

  async createThread(
    scope: ChatOwnerScope,
    input: CreateChatThreadInput,
  ): Promise<ChatThread> {
    const id = parseDatabaseUuid(input.id, "threadId");
    assertChatPlaneScope(input.plane, input.dataScope);
    const title = normalizeOptionalText(input.title, "title");
    return this.scoped(scope, async (tx) => {
      const inserted = await tx
        .insert(chatThreads)
        .values({
          id,
          organizationId: scope.organizationId,
          ownerUserId: scope.ownerUserId,
          plane: input.plane,
          dataScope: input.dataScope,
          title,
          backend: input.backend ?? "bridge",
          moduleName: input.moduleName ?? null,
          attachedModules: [...(input.attachedModules ?? [])],
        })
        .onConflictDoNothing()
        .returning();
      if (inserted[0]) return unpackThread(inserted[0]);

      const [row] = await tx
        .select()
        .from(chatThreads)
        .where(ownerThreadWhere(scope, id))
        .limit(1);
      if (row) {
        const existing = unpackThread(row);
        if (sameThreadCreate(existing, { ...input, id })) return existing;
      }
      throw new ChatStoreConflictError(`chat-store: thread id ${id} already exists`);
    });
  }

  async getThread(
    scope: ChatOwnerScope,
    threadId: string,
  ): Promise<ChatThread | null> {
    const id = parseDatabaseUuid(threadId, "threadId");
    return this.scoped(scope, async (tx) => {
      const [row] = await tx
        .select()
        .from(chatThreads)
        .where(ownerThreadWhere(scope, id))
        .limit(1);
      return row ? unpackThread(row) : null;
    });
  }

  async listThreads(
    scope: ChatOwnerScope,
    query: ChatThreadQuery = {},
  ): Promise<ChatThreadPage> {
    const limit = chatPageLimit(query.limit);
    return this.scoped(scope, async (tx) => {
      const filters: SQL[] = [
        eq(chatThreads.organizationId, scope.organizationId),
        eq(chatThreads.ownerUserId, scope.ownerUserId),
      ];
      if (query.status) filters.push(eq(chatThreads.status, query.status));
      if (query.cursor) {
        const updatedAt = parseCursorDate(query.cursor.updatedAt);
        const id = parseDatabaseUuid(query.cursor.id, "threadCursor.id");
        filters.push(
          or(
            lt(chatThreads.updatedAt, updatedAt),
            and(eq(chatThreads.updatedAt, updatedAt), lt(chatThreads.id, id)),
          ) as SQL,
        );
      }
      const rows = await tx
        .select()
        .from(chatThreads)
        .where(and(...filters))
        .orderBy(desc(chatThreads.updatedAt), desc(chatThreads.id))
        .limit(limit + 1);
      const hasNext = rows.length > limit;
      const items = rows.slice(0, limit).map(unpackThread);
      const last = items.at(-1);
      return {
        items,
        ...(hasNext && last
          ? { nextCursor: { updatedAt: last.updatedAt, id: last.id } }
          : {}),
      };
    });
  }

  async setThreadBackendSession(
    scope: ChatOwnerScope,
    threadId: string,
    backendSessionId: string,
  ): Promise<ChatThread> {
    const id = parseDatabaseUuid(threadId, "threadId");
    return this.scoped(scope, async (tx) => {
      await lockChatThread(tx, id);
      const [current] = await tx
        .select()
        .from(chatThreads)
        .where(ownerThreadWhere(scope, id))
        .limit(1);
      if (!current) {
        throw new ChatStoreNotFoundError(`chat-store: thread ${id} not found`);
      }
      assertBackendSessionAllowed(
        current.backend as ChatThread["backend"],
        backendSessionId,
      );
      const [saved] = await tx
        .update(chatThreads)
        .set({
          backendSessionId,
          updatedAt: sql`GREATEST(${chatThreads.updatedAt}, CURRENT_TIMESTAMP)`,
        })
        .where(ownerThreadWhere(scope, id))
        .returning();
      if (!saved) throw new ChatStoreNotFoundError(`chat-store: thread ${id} not found`);
      return unpackThread(saved);
    });
  }

  async setThreadBackend(
    scope: ChatOwnerScope,
    input: SetChatThreadBackendInput,
  ): Promise<ChatThread> {
    const id = parseDatabaseUuid(input.threadId, "threadId");
    assertChatPlaneScope(input.plane, input.dataScope);
    return this.scoped(scope, async (tx) => {
      await lockChatThread(tx, id);
      const [saved] = await tx
        .update(chatThreads)
        .set({
          backend: input.backend,
          plane: input.plane,
          dataScope: input.dataScope,
          // The handle belonged to the engine that just stopped answering.
          backendSessionId: null,
          updatedAt: sql`GREATEST(${chatThreads.updatedAt}, CURRENT_TIMESTAMP)`,
        })
        .where(ownerThreadWhere(scope, id))
        .returning();
      if (!saved) throw new ChatStoreNotFoundError(`chat-store: thread ${id} not found`);
      return unpackThread(saved);
    });
  }

  async liveModuleThread(
    scope: ChatOwnerScope,
    moduleName: string,
  ): Promise<ChatThread | null> {
    const name = moduleName.trim();
    if (!name) throw new ChatStoreScopeError("chat-store: module name must be non-empty");
    return this.scoped(scope, async (tx) => {
      const [row] = await tx
        .select()
        .from(chatThreads)
        .where(
          and(
            eq(chatThreads.organizationId, scope.organizationId),
            eq(chatThreads.ownerUserId, scope.ownerUserId),
            eq(chatThreads.moduleName, name),
            eq(chatThreads.status, "active"),
          ),
        )
        .orderBy(desc(chatThreads.updatedAt), desc(chatThreads.id))
        .limit(1);
      return row ? unpackThread(row) : null;
    });
  }

  async attachModule(
    scope: ChatOwnerScope,
    threadId: string,
    moduleName: string,
  ): Promise<ChatThread> {
    const id = parseDatabaseUuid(threadId, "threadId");
    const name = moduleName.trim();
    if (!name) throw new ChatStoreScopeError("chat-store: module name must be non-empty");
    return this.scoped(scope, async (tx) => {
      await lockChatThread(tx, id);
      const [current] = await tx
        .select()
        .from(chatThreads)
        .where(ownerThreadWhere(scope, id))
        .limit(1);
      if (!current) throw new ChatStoreNotFoundError(`chat-store: thread ${id} not found`);
      const attached = current.attachedModules ?? [];
      if (current.moduleName === name || attached.includes(name)) {
        return unpackThread(current);
      }
      const [saved] = await tx
        .update(chatThreads)
        .set({
          attachedModules: [...attached, name],
          updatedAt: sql`GREATEST(${chatThreads.updatedAt}, CURRENT_TIMESTAMP)`,
        })
        .where(ownerThreadWhere(scope, id))
        .returning();
      if (!saved) throw new ChatStoreNotFoundError(`chat-store: thread ${id} not found`);
      return unpackThread(saved);
    });
  }

  async archiveThread(
    scope: ChatOwnerScope,
    threadId: string,
  ): Promise<ChatThread | null> {
    const id = parseDatabaseUuid(threadId, "threadId");
    return this.scoped(scope, async (tx) => {
      await lockChatThread(tx, id);
      const [current] = await tx
        .select()
        .from(chatThreads)
        .where(ownerThreadWhere(scope, id))
        .limit(1);
      if (!current) return null;
      if (current.status === "archived") return unpackThread(current);
      const [saved] = await tx
        .update(chatThreads)
        .set({
          status: "archived",
          updatedAt: sql`GREATEST(${chatThreads.updatedAt}, CURRENT_TIMESTAMP)`,
        })
        .where(ownerThreadWhere(scope, id))
        .returning();
      return saved ? unpackThread(saved) : null;
    });
  }

  async deleteThread(scope: ChatOwnerScope, threadId: string): Promise<boolean> {
    const id = parseDatabaseUuid(threadId, "threadId");
    return this.scoped(scope, async (tx) => {
      await lockChatThread(tx, id);
      const deleted = await tx
        .delete(chatThreads)
        .where(ownerThreadWhere(scope, id))
        .returning();
      return deleted.length === 1;
    });
  }

  async appendTurn(
    scope: ChatOwnerScope,
    input: AppendChatTurnInput,
  ): Promise<ChatTurn> {
    const threadId = parseDatabaseUuid(input.threadId, "threadId");
    const turnId = parseDatabaseUuid(input.id, "turnId");
    return this.scoped(scope, async (tx) => {
      await lockChatThread(tx, threadId);
      const [threadRow] = await tx
        .select()
        .from(chatThreads)
        .where(ownerThreadWhere(scope, threadId))
        .limit(1);
      if (!threadRow) {
        throw new ChatStoreNotFoundError(`chat-store: unknown thread ${threadId}`);
      }
      const thread = unpackThread(threadRow);
      const normalizedInput = { ...input, id: turnId, threadId };

      const [requestRow] = await tx
        .select()
        .from(chatTurns)
        .where(
          and(
            eq(chatTurns.organizationId, scope.organizationId),
            eq(chatTurns.ownerUserId, scope.ownerUserId),
            eq(chatTurns.threadId, threadId),
            eq(chatTurns.clientRequestId, input.clientRequestId),
          ),
        )
        .limit(1);
      if (requestRow) {
        const existing = unpackTurn(requestRow);
        assertChatTurnIdempotentReplay(existing, normalizedInput);
        return existing;
      }
      assertChatTurnForThread(thread, normalizedInput);

      const [idRow] = await tx
        .select({ id: chatTurns.id })
        .from(chatTurns)
        .where(ownerTurnWhere(scope, threadId, turnId))
        .limit(1);
      if (idRow) {
        throw new ChatStoreConflictError(`chat-store: turn id ${turnId} already exists`);
      }

      const [latest] = await tx
        .select({ sequence: chatTurns.sequence })
        .from(chatTurns)
        .where(
          and(
            eq(chatTurns.organizationId, scope.organizationId),
            eq(chatTurns.ownerUserId, scope.ownerUserId),
            eq(chatTurns.threadId, threadId),
          ),
        )
        .orderBy(desc(chatTurns.sequence))
        .limit(1);
      const sequence = (latest?.sequence ?? 0) + 1;
      const inserted = await tx
        .insert(chatTurns)
        .values({
          id: turnId,
          organizationId: scope.organizationId,
          ownerUserId: scope.ownerUserId,
          threadId,
          sequence,
          role: input.role,
          actorType: input.actorType,
          actorId: input.actorId,
          content: input.content,
          state: input.state,
          clientRequestId: input.clientRequestId,
          requestFingerprint: chatTurnRequestFingerprint(normalizedInput),
          taintLabel: input.taintLabel,
        })
        .onConflictDoNothing()
        .returning();
      if (!inserted[0]) {
        throw new ChatStoreConflictError(
          `chat-store: turn ${turnId} conflicts with an existing write`,
        );
      }
      await tx
        .update(chatThreads)
        .set({
          updatedAt: sql`GREATEST(${chatThreads.updatedAt}, CURRENT_TIMESTAMP)`,
        })
        .where(ownerThreadWhere(scope, threadId));
      return unpackTurn(inserted[0]);
    });
  }

  async getTurn(
    scope: ChatOwnerScope,
    threadId: string,
    turnId: string,
  ): Promise<ChatTurn | null> {
    const parsedThreadId = parseDatabaseUuid(threadId, "threadId");
    const parsedTurnId = parseDatabaseUuid(turnId, "turnId");
    return this.scoped(scope, async (tx) => {
      const [row] = await tx
        .select()
        .from(chatTurns)
        .where(ownerTurnWhere(scope, parsedThreadId, parsedTurnId))
        .limit(1);
      return row ? unpackTurn(row) : null;
    });
  }

  async listTurns(
    scope: ChatOwnerScope,
    threadId: string,
    query: ChatTurnQuery = {},
  ): Promise<ChatTurnPage> {
    const id = parseDatabaseUuid(threadId, "threadId");
    const limit = chatPageLimit(query.limit);
    if (
      query.cursor &&
      (!Number.isSafeInteger(query.cursor.sequence) || query.cursor.sequence < 0)
    ) {
      throw new Error("chat-store: turn cursor sequence must be a non-negative integer");
    }
    return this.scoped(scope, async (tx) => {
      const [thread] = await tx
        .select({ id: chatThreads.id })
        .from(chatThreads)
        .where(ownerThreadWhere(scope, id))
        .limit(1);
      if (!thread) throw new ChatStoreNotFoundError(`chat-store: unknown thread ${id}`);

      const filters: SQL[] = [
        eq(chatTurns.organizationId, scope.organizationId),
        eq(chatTurns.ownerUserId, scope.ownerUserId),
        eq(chatTurns.threadId, id),
      ];
      if (query.cursor) filters.push(lt(chatTurns.sequence, query.cursor.sequence));
      const rows = await tx
        .select()
        .from(chatTurns)
        .where(and(...filters))
        .orderBy(desc(chatTurns.sequence))
        .limit(limit + 1);
      const hasNext = rows.length > limit;
      const items = rows.slice(0, limit).reverse().map(unpackTurn);
      const first = items[0];
      return {
        items,
        ...(hasNext && first ? { nextCursor: { sequence: first.sequence } } : {}),
      };
    });
  }

  async listRecentTurns(
    scope: ChatOwnerScope,
    threadId: string,
    limit = 24,
  ): Promise<readonly ChatTurn[]> {
    const id = parseDatabaseUuid(threadId, "threadId");
    const bounded = chatPageLimit(limit);
    return this.scoped(scope, async (tx) => {
      const [thread] = await tx
        .select({ id: chatThreads.id })
        .from(chatThreads)
        .where(ownerThreadWhere(scope, id))
        .limit(1);
      if (!thread) throw new ChatStoreNotFoundError(`chat-store: unknown thread ${id}`);
      const rows = await tx
        .select()
        .from(chatTurns)
        .where(
          and(
            eq(chatTurns.organizationId, scope.organizationId),
            eq(chatTurns.ownerUserId, scope.ownerUserId),
            eq(chatTurns.threadId, id),
          ),
        )
        .orderBy(desc(chatTurns.sequence))
        .limit(bounded);
      return rows.reverse().map(unpackTurn);
    });
  }

  async updateTurn(
    scope: ChatOwnerScope,
    input: UpdateChatTurnInput,
  ): Promise<ChatTurn> {
    const threadId = parseDatabaseUuid(input.threadId, "threadId");
    const turnId = parseDatabaseUuid(input.turnId, "turnId");
    return this.scoped(scope, async (tx) => {
      await lockChatThread(tx, threadId);
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext((${turnId}::uuid)::text))`,
      );
      const [row] = await tx
        .select()
        .from(chatTurns)
        .where(ownerTurnWhere(scope, threadId, turnId))
        .limit(1);
      if (!row) throw new ChatStoreNotFoundError(`chat-store: unknown turn ${turnId}`);
      const current = unpackTurn(row);
      if (current.state !== input.expectedState) {
        throw new ChatStoreConflictError(
          `chat-store: turn ${turnId} is ${current.state}, expected ${input.expectedState}`,
        );
      }
      assertChatTurnTransition(current.state, input.state);
      if (
        chatTurnIsTerminal(current.state) &&
        !(current.state === "failed" && input.state === "processing") &&
        input.content !== undefined &&
        input.content !== current.content
      ) {
        throw new ChatStoreConflictError(
          `chat-store: terminal turn ${turnId} content is immutable`,
        );
      }
      if (
        chatTurnIsTerminal(current.state) &&
        !(current.state === "failed" && input.state === "processing") &&
        input.errorCode !== undefined &&
        input.errorCode !== (current.errorCode ?? null)
      ) {
        throw new ChatStoreConflictError(
          `chat-store: terminal turn ${turnId} error code is immutable`,
        );
      }

      const patch: {
        state: string;
        updatedAt: SQL;
        content?: string;
        errorCode?: string | null;
      } = {
        state: input.state,
        updatedAt: sql`GREATEST(${chatTurns.updatedAt}, CURRENT_TIMESTAMP)`,
      };
      if (input.content !== undefined) patch.content = input.content;
      if (input.errorCode !== undefined) {
        patch.errorCode =
          input.errorCode === null ? null : requireText(input.errorCode, "error code");
      }
      const [saved] = await tx
        .update(chatTurns)
        .set(patch)
        .where(
          and(
            ownerTurnWhere(scope, threadId, turnId),
            eq(chatTurns.state, input.expectedState),
          ),
        )
        .returning();
      if (!saved) {
        throw new ChatStoreConflictError(
          `chat-store: turn ${turnId} changed during update`,
        );
      }
      await tx
        .update(chatThreads)
        .set({
          updatedAt: sql`GREATEST(${chatThreads.updatedAt}, CURRENT_TIMESTAMP)`,
        })
        .where(ownerThreadWhere(scope, threadId));
      return unpackTurn(saved);
    });
  }

  async addTurnRef(
    scope: ChatOwnerScope,
    input: AddChatTurnRefInput,
  ): Promise<ChatTurnRef> {
    const id = parseDatabaseUuid(input.id, "turnRefId");
    const threadId = parseDatabaseUuid(input.threadId, "threadId");
    const turnId = parseDatabaseUuid(input.turnId, "turnId");
    const refId = requireText(input.refId, "referenced id");
    return this.scoped(scope, async (tx) => {
      await lockChatThread(tx, threadId);
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext((${turnId}::uuid)::text))`,
      );
      const [turn] = await tx
        .select({ id: chatTurns.id })
        .from(chatTurns)
        .where(ownerTurnWhere(scope, threadId, turnId))
        .limit(1);
      if (!turn) throw new ChatStoreNotFoundError(`chat-store: unknown turn ${turnId}`);

      const normalizedInput = { ...input, id, threadId, turnId, refId };
      const [targetRow] = await tx
        .select()
        .from(chatTurnRefs)
        .where(
          and(
            eq(chatTurnRefs.organizationId, scope.organizationId),
            eq(chatTurnRefs.ownerUserId, scope.ownerUserId),
            eq(chatTurnRefs.threadId, threadId),
            eq(chatTurnRefs.turnId, turnId),
            eq(chatTurnRefs.kind, input.kind),
            eq(chatTurnRefs.refId, refId),
          ),
        )
        .limit(1);
      if (targetRow) {
        const existing = unpackRef(targetRow);
        assertChatRefIdempotentReplay(existing, normalizedInput);
        return existing;
      }

      const [idRow] = await tx
        .select()
        .from(chatTurnRefs)
        .where(
          and(
            eq(chatTurnRefs.organizationId, scope.organizationId),
            eq(chatTurnRefs.ownerUserId, scope.ownerUserId),
            eq(chatTurnRefs.id, id),
          ),
        )
        .limit(1);
      if (idRow) {
        const existing = unpackRef(idRow);
        assertChatRefIdempotentReplay(existing, normalizedInput);
        return existing;
      }

      const inserted = await tx
        .insert(chatTurnRefs)
        .values({
          id,
          organizationId: scope.organizationId,
          ownerUserId: scope.ownerUserId,
          threadId,
          turnId,
          kind: input.kind,
          refId,
        })
        .onConflictDoNothing()
        .returning();
      if (!inserted[0]) {
        throw new ChatStoreConflictError(
          `chat-store: reference ${input.kind}:${refId} conflicts with an existing write`,
        );
      }
      await tx
        .update(chatThreads)
        .set({
          updatedAt: sql`GREATEST(${chatThreads.updatedAt}, CURRENT_TIMESTAMP)`,
        })
        .where(ownerThreadWhere(scope, threadId));
      return unpackRef(inserted[0]);
    });
  }

  async listTurnRefs(
    scope: ChatOwnerScope,
    threadId: string,
    turnId: string,
  ): Promise<readonly ChatTurnRef[]> {
    const parsedThreadId = parseDatabaseUuid(threadId, "threadId");
    const parsedTurnId = parseDatabaseUuid(turnId, "turnId");
    return this.scoped(scope, async (tx) => {
      const [turn] = await tx
        .select({ id: chatTurns.id })
        .from(chatTurns)
        .where(ownerTurnWhere(scope, parsedThreadId, parsedTurnId))
        .limit(1);
      if (!turn) {
        throw new ChatStoreNotFoundError(`chat-store: unknown turn ${parsedTurnId}`);
      }
      const rows = await tx
        .select()
        .from(chatTurnRefs)
        .where(
          and(
            eq(chatTurnRefs.organizationId, scope.organizationId),
            eq(chatTurnRefs.ownerUserId, scope.ownerUserId),
            eq(chatTurnRefs.threadId, parsedThreadId),
            eq(chatTurnRefs.turnId, parsedTurnId),
          ),
        )
        .orderBy(asc(chatTurnRefs.createdAt), asc(chatTurnRefs.id));
      return rows.map(unpackRef);
    });
  }

  async createCloudGrant(
    scope: ChatOwnerScope,
    input: CreateChatCloudGrantInput,
  ): Promise<ChatCloudGrant> {
    const id = parseDatabaseUuid(input.id, "cloudGrantId");
    const threadId = parseDatabaseUuid(input.threadId, "threadId");
    const contextDigest = requireText(input.contextDigest, "context digest");
    const providerId = requireText(input.providerId, "provider id");
    const modelTier = requireText(input.modelTier, "model tier");
    const expiresAt = parseCursorDate(input.expiresAt);
    return this.scoped(scope, async (tx) => {
      const [thread] = await tx
        .select({ id: chatThreads.id, plane: chatThreads.plane, dataScope: chatThreads.dataScope })
        .from(chatThreads)
        .where(ownerThreadWhere(scope, threadId))
        .limit(1);
      if (!thread) {
        throw new ChatStoreNotFoundError(`chat-store: unknown thread ${threadId}`);
      }
      if (thread.plane !== "cloud" || thread.dataScope !== "public") {
        throw new ChatCloudGrantError("requires a public Cloud Plane thread");
      }
      const inserted = await tx
        .insert(chatCloudGrants)
        .values({
          id,
          organizationId: scope.organizationId,
          ownerUserId: scope.ownerUserId,
          threadId,
          contextDigest,
          providerId,
          modelTier,
          expiresAt,
        })
        .onConflictDoNothing()
        .returning();
      if (inserted[0]) return unpackCloudGrant(inserted[0]);
      const [existing] = await tx
        .select()
        .from(chatCloudGrants)
        .where(
          and(
            eq(chatCloudGrants.organizationId, scope.organizationId),
            eq(chatCloudGrants.ownerUserId, scope.ownerUserId),
            eq(chatCloudGrants.threadId, threadId),
            eq(chatCloudGrants.id, id),
          ),
        )
        .limit(1);
      if (
        existing &&
        existing.contextDigest === contextDigest &&
        existing.providerId === providerId &&
        existing.modelTier === modelTier &&
        existing.expiresAt.getTime() === expiresAt.getTime()
      ) {
        return unpackCloudGrant(existing);
      }
      throw new ChatStoreConflictError(
        `chat-store: cloud grant id ${id} already exists`,
      );
    });
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
    const id = parseDatabaseUuid(input.id, "cloudGrantId");
    const threadId = parseDatabaseUuid(input.threadId, "threadId");
    return this.scoped(scope, async (tx) => {
      const consumed = await tx
        .update(chatCloudGrants)
        .set({ consumedAt: sql`CURRENT_TIMESTAMP` })
        .where(
          and(
            eq(chatCloudGrants.organizationId, scope.organizationId),
            eq(chatCloudGrants.ownerUserId, scope.ownerUserId),
            eq(chatCloudGrants.threadId, threadId),
            eq(chatCloudGrants.id, id),
            eq(chatCloudGrants.contextDigest, input.contextDigest),
            eq(chatCloudGrants.providerId, input.providerId),
            eq(chatCloudGrants.modelTier, input.modelTier),
            isNull(chatCloudGrants.consumedAt),
            gt(chatCloudGrants.expiresAt, sql`CURRENT_TIMESTAMP`),
          ),
        )
        .returning();
      if (!consumed[0]) {
        throw new ChatCloudGrantError(
          "is missing, expired, consumed, or does not match the exact prepared context",
        );
      }
      return unpackCloudGrant(consumed[0]);
    });
  }
}
