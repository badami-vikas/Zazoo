import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ChatCloudGrantError,
  ChatStoreConflictError,
  ChatStoreNotFoundError,
  ChatStoreScopeError,
  createTaintLabel,
  type ChatOwnerScope,
} from "@bridge/core";
import {
  createLocalDb,
  DrizzleChatStore,
  schema,
} from "../src/index.js";

const organizationId = "10000000-0000-4000-8000-000000000126";
const otherOrganizationId = "10000000-0000-4000-8000-000000000127";
const ownerUserId = "20000000-0000-4000-8000-000000000126";
const otherUserId = "20000000-0000-4000-8000-000000000127";
const owner: ChatOwnerScope = { organizationId, ownerUserId };
const otherOwner: ChatOwnerScope = { organizationId, ownerUserId: otherUserId };
const privateLabel = createTaintLabel({
  trust: "authenticated_human",
  source: "human",
  sensitivity: "private",
  instructionRisk: "data",
  origin: {
    source: "human",
    ref: "chat-store-db-private",
    hash: "private",
    transform: "captured",
  },
});
const publicLabel = createTaintLabel({
  trust: "authenticated_human",
  source: "human",
  sensitivity: "public",
  instructionRisk: "data",
  origin: {
    source: "human",
    ref: "chat-store-db-public",
    hash: "public",
    transform: "captured",
  },
});

async function seedIdentity(
  db: Awaited<ReturnType<typeof createLocalDb>>["db"],
): Promise<void> {
  await db.insert(schema.users).values([
    { id: ownerUserId, email: "chat-store-owner@example.test" },
    { id: otherUserId, email: "chat-store-other@example.test" },
  ]);
  await db.insert(schema.organizations).values([
    { id: organizationId, name: "Chat store organization" },
    { id: otherOrganizationId, name: "Other chat store organization" },
  ]);
}

test("DrizzleChatStore persists an owner-only thread and its lifecycle across restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "bridge-chat-store-"));
  const threadId = "30000000-0000-4000-8000-000000000126";
  const turnId = "40000000-0000-4000-8000-000000000126";
  const refId = "50000000-0000-4000-8000-000000000126";
  let local: Awaited<ReturnType<typeof createLocalDb>> | undefined;
  try {
    local = await createLocalDb({ dataDir: root });
    await seedIdentity(local.db);
    const store = new DrizzleChatStore(local.db);
    const thread = await store.createThread(owner, {
      id: threadId,
      plane: "local",
      dataScope: "private",
      title: "Persistent private work",
    });
    assert.equal(thread.ownerUserId, ownerUserId);
    assert.equal(await store.getThread(otherOwner, threadId), null);
    assert.equal(
      await store.getThread(
        { organizationId: otherOrganizationId, ownerUserId },
        threadId,
      ),
      null,
    );
    await assert.rejects(
      store.appendTurn(otherOwner, {
        id: turnId,
        threadId,
        role: "user",
        actorType: "human",
        actorId: otherUserId,
        content: "Cannot cross the owner boundary",
        state: "completed",
        clientRequestId: "other-owner-request",
        taintLabel: privateLabel,
      }),
      ChatStoreNotFoundError,
    );

    const assistantWrite = {
      id: turnId,
      threadId,
      role: "assistant",
      actorType: "agent",
      actorId: "chief-of-staff",
      content: "",
      state: "processing",
      clientRequestId: "assistant-request",
      taintLabel: privateLabel,
    } as const;
    const turn = await store.appendTurn(owner, assistantWrite);
    await store.addTurnRef(owner, {
      id: refId,
      threadId,
      turnId,
      kind: "agent_run",
      refId: "run:durable",
    });
    const completed = await store.updateTurn(owner, {
      threadId,
      turnId,
      expectedState: "processing",
      state: "completed",
      content: "Durable answer",
    });
    assert.equal(completed.content, "Durable answer");
    await local.close();
    local = undefined;

    local = await createLocalDb({ dataDir: root });
    const reopened = new DrizzleChatStore(local.db);
    assert.equal((await reopened.getThread(owner, threadId))?.title, thread.title);
    assert.deepEqual(
      (await reopened.listTurns(owner, threadId)).items.map((item) => ({
        id: item.id,
        sequence: item.sequence,
        state: item.state,
        content: item.content,
      })),
      [{
        id: turn.id,
        sequence: 1,
        state: "completed",
        content: "Durable answer",
      }],
    );
    assert.equal((await reopened.listTurnRefs(owner, threadId, turnId))[0]?.id, refId);
    assert.equal((await reopened.appendTurn(owner, assistantWrite)).state, "completed");

    assert.equal(await reopened.deleteThread(owner, threadId), true);
    assert.equal(await reopened.getThread(owner, threadId), null);
    assert.equal(await reopened.getTurn(owner, threadId, turnId), null);
    const counts = await local.client.query<{ turns: string; refs: string }>(`
      SELECT
        (SELECT count(*)::text FROM chat_turns WHERE thread_id = '${threadId}') AS turns,
        (SELECT count(*)::text FROM chat_turn_refs WHERE thread_id = '${threadId}') AS refs
    `);
    assert.deepEqual(counts.rows, [{ turns: "0", refs: "0" }]);
  } finally {
    await local?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("DrizzleChatStore serializes concurrent sends and returns one row for exact retries", async () => {
  const { db, close } = await createLocalDb();
  const threadId = "30000000-0000-4000-8000-000000000128";
  try {
    await seedIdentity(db);
    const store = new DrizzleChatStore(db);
    await store.createThread(owner, {
      id: threadId,
      plane: "local",
      dataScope: "private",
    });
    const duplicateWrite = {
      id: "40000000-0000-4000-8000-000000000128",
      threadId,
      role: "user" as const,
      actorType: "human" as const,
      actorId: ownerUserId,
      content: "Exactly once",
      state: "completed" as const,
      clientRequestId: "duplicate-request",
      taintLabel: privateLabel,
    };
    const duplicates = await Promise.all(
      Array.from({ length: 8 }, () => store.appendTurn(owner, duplicateWrite)),
    );
    assert.ok(duplicates.every((turn) => turn.id === duplicateWrite.id));
    assert.ok(duplicates.every((turn) => turn.sequence === 1));

    const concurrent = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        store.appendTurn(owner, {
          ...duplicateWrite,
          id: `40000000-0000-4000-8000-${String(129 + index).padStart(12, "0")}`,
          content: `Concurrent ${index}`,
          clientRequestId: `concurrent-${index}`,
        }),
      ),
    );
    assert.deepEqual(
      concurrent.map((turn) => turn.sequence).sort((left, right) => left - right),
      [2, 3, 4, 5, 6, 7],
    );
    assert.equal((await store.listTurns(owner, threadId)).items.length, 7);
    await assert.rejects(
      store.appendTurn(owner, { ...duplicateWrite, content: "Changed retry" }),
      ChatStoreConflictError,
    );
  } finally {
    await close();
  }
});

test("DrizzleChatStore enforces hosted public-only data and archived thread finality", async () => {
  const { db, client, close } = await createLocalDb();
  const threadId = "30000000-0000-4000-8000-000000000136";
  try {
    await seedIdentity(db);
    const store = new DrizzleChatStore(db);
    await assert.rejects(
      store.createThread(owner, {
        id: threadId,
        plane: "cloud",
        dataScope: "private",
      }),
      ChatStoreScopeError,
    );
    await store.createThread(owner, {
      id: threadId,
      plane: "cloud",
      dataScope: "public",
    });
    await client.exec(`
      UPDATE chat_threads
      SET created_at = CURRENT_TIMESTAMP + INTERVAL '5 seconds',
          updated_at = CURRENT_TIMESTAMP + INTERVAL '5 seconds'
      WHERE id = '${threadId}'
    `);
    const input = {
      id: "40000000-0000-4000-8000-000000000136",
      threadId,
      role: "user" as const,
      actorType: "human" as const,
      actorId: ownerUserId,
      content: "Public-safe turn",
      state: "completed" as const,
      clientRequestId: "public-turn",
      taintLabel: publicLabel,
    };
    await assert.rejects(
      store.appendTurn(owner, {
        ...input,
        content: "Private turn",
        taintLabel: privateLabel,
      }),
      ChatStoreScopeError,
    );
    const publicTurn = await store.appendTurn(owner, input);
    const archived = await store.archiveThread(owner, threadId);
    assert.equal(archived?.status, "archived");
    assert.ok(
      archived && new Date(archived.updatedAt).getTime() >= new Date(archived.createdAt).getTime(),
      "DB-owned timestamps remain monotonic even when the stored timestamp is ahead",
    );
    assert.deepEqual(await store.appendTurn(owner, input), publicTurn);
    await assert.rejects(
      store.appendTurn(owner, {
        ...input,
        id: "40000000-0000-4000-8000-000000000137",
        clientRequestId: "after-archive",
      }),
      ChatStoreConflictError,
    );
  } finally {
    await close();
  }
});

test("DrizzleChatStore thread cursor does not lose same-millisecond updates", async () => {
  const { db, client, close } = await createLocalDb();
  const lowerId = "30000000-0000-4000-8000-000000000141";
  const higherId = "30000000-0000-4000-8000-000000000142";
  try {
    await seedIdentity(db);
    const store = new DrizzleChatStore(db);
    await store.createThread(owner, {
      id: lowerId,
      plane: "local",
      dataScope: "private",
    });
    await store.createThread(owner, {
      id: higherId,
      plane: "local",
      dataScope: "private",
    });
    await client.exec(`
      UPDATE chat_threads
      SET created_at = '2026-01-01T00:00:00.000Z',
          updated_at = CASE id
            WHEN '${higherId}' THEN '2026-01-01T00:00:00.1234Z'::timestamptz
            ELSE '2026-01-01T00:00:00.1231Z'::timestamptz
          END
      WHERE id IN ('${lowerId}', '${higherId}')
    `);
    assert.equal(
      (await store.getThread(owner, lowerId))?.updatedAt,
      (await store.getThread(owner, higherId))?.updatedAt,
      "storage precision must match the millisecond cursor representation",
    );

    const first = await store.listThreads(owner, { limit: 1 });
    assert.deepEqual(first.items.map(({ id }) => id), [higherId]);
    assert.ok(first.nextCursor);
    const second = await store.listThreads(owner, {
      limit: 1,
      cursor: first.nextCursor,
    });
    assert.deepEqual(second.items.map(({ id }) => id), [lowerId]);
    assert.equal(second.nextCursor, undefined);
  } finally {
    await close();
  }
});

test("DrizzleChatStore atomically consumes exact-context cloud grants once", async () => {
  const { db, client, close } = await createLocalDb();
  const threadId = "30000000-0000-4000-8000-000000000151";
  try {
    await seedIdentity(db);
    const store = new DrizzleChatStore(db);
    await store.createThread(owner, {
      id: threadId,
      plane: "cloud",
      dataScope: "public",
    });
    const input = {
      id: "70000000-0000-4000-8000-000000000151",
      threadId,
      contextDigest: `sha256:${"a".repeat(64)}`,
      providerId: "anthropic",
      modelTier: "cheap",
      expiresAt: "2099-01-01T00:00:00.000Z",
    };
    await store.createCloudGrant(owner, input);
    await assert.rejects(
      client.exec(`
        UPDATE chat_cloud_grants
        SET context_digest = 'sha256:${"b".repeat(64)}'
        WHERE id = '${input.id}'
      `),
      /binding fields are immutable/,
    );
    await assert.rejects(
      store.consumeCloudGrant(otherOwner, input),
      ChatCloudGrantError,
    );
    await assert.rejects(
      store.consumeCloudGrant(owner, { ...input, providerId: "groq" }),
      ChatCloudGrantError,
    );

    const attempts = await Promise.allSettled([
      store.consumeCloudGrant(owner, input),
      store.consumeCloudGrant(owner, input),
    ]);
    assert.equal(attempts.filter(({ status }) => status === "fulfilled").length, 1);
    assert.equal(attempts.filter(({ status }) => status === "rejected").length, 1);
    await assert.rejects(
      client.exec(`
        UPDATE chat_cloud_grants
        SET consumed_at = NULL
        WHERE id = '${input.id}'
      `),
      /only transition from unconsumed to consumed/,
    );

    const expired = {
      ...input,
      id: "70000000-0000-4000-8000-000000000152",
      expiresAt: "2020-01-02T00:00:00.000Z",
    };
    await client.exec(`
      INSERT INTO chat_cloud_grants (
        id,
        organization_id,
        owner_user_id,
        thread_id,
        context_digest,
        provider_id,
        model_tier,
        created_at,
        expires_at
      ) VALUES (
        '${expired.id}',
        '${organizationId}',
        '${ownerUserId}',
        '${threadId}',
        '${expired.contextDigest}',
        '${expired.providerId}',
        '${expired.modelTier}',
        '2020-01-01T00:00:00.000Z',
        '${expired.expiresAt}'
      )
    `);
    await assert.rejects(
      store.consumeCloudGrant(owner, expired),
      /expired/,
    );
  } finally {
    await close();
  }
});
