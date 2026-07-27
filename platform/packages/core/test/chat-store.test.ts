import assert from "node:assert/strict";
import test from "node:test";
import {
  ChatCloudGrantError,
  ChatStoreConflictError,
  ChatStoreNotFoundError,
  ChatStoreScopeError,
  InMemoryChatStore,
  createTaintLabel,
  type ChatOwnerScope,
} from "../src/index.js";

const owner: ChatOwnerScope = {
  organizationId: "10000000-0000-4000-8000-000000000026",
  ownerUserId: "20000000-0000-4000-8000-000000000026",
};
const otherOwner: ChatOwnerScope = {
  organizationId: owner.organizationId,
  ownerUserId: "20000000-0000-4000-8000-000000000027",
};
const privateLabel = createTaintLabel({
  trust: "authenticated_human",
  source: "human",
  sensitivity: "private",
  instructionRisk: "data",
  origin: {
    source: "human",
    ref: "chat-store-test-private",
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
    ref: "chat-store-test-public",
    hash: "public",
    transform: "captured",
  },
});

function clock(): () => string {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 6, 26, 0, 0, tick++)).toISOString();
}

test("ChatStore binds Plane to data scope and isolates every thread by owner", async () => {
  const store = new InMemoryChatStore(clock());
  await assert.rejects(
    store.createThread(owner, {
      id: "30000000-0000-4000-8000-000000000026",
      plane: "cloud",
      dataScope: "private",
    }),
    ChatStoreScopeError,
  );

  const thread = await store.createThread(owner, {
    id: "30000000-0000-4000-8000-000000000026",
    plane: "local",
    dataScope: "private",
    title: "Private work",
  });
  assert.equal((await store.getThread(owner, thread.id))?.id, thread.id);
  assert.equal(await store.getThread(otherOwner, thread.id), null);
  assert.deepEqual((await store.listThreads(otherOwner)).items, []);
  assert.equal(await store.deleteThread(otherOwner, thread.id), false);
});

test("ChatStore allocates stable sequence numbers and deduplicates exact turn retries", async () => {
  const store = new InMemoryChatStore(clock());
  const thread = await store.createThread(owner, {
    id: "30000000-0000-4000-8000-000000000028",
    plane: "local",
    dataScope: "private",
  });
  const write = {
    id: "40000000-0000-4000-8000-000000000028",
    threadId: thread.id,
    role: "user" as const,
    actorType: "human" as const,
    actorId: owner.ownerUserId,
    content: "Remember this locally",
    state: "completed" as const,
    clientRequestId: "request-1",
    taintLabel: privateLabel,
  };
  const first = await store.appendTurn(owner, write);
  const replay = await store.appendTurn(owner, write);
  assert.equal(first.sequence, 1);
  assert.deepEqual(replay, first);

  await assert.rejects(
    store.appendTurn(owner, { ...write, content: "Different content" }),
    ChatStoreConflictError,
  );
  const second = await store.appendTurn(owner, {
    ...write,
    id: "40000000-0000-4000-8000-000000000029",
    role: "assistant",
    actorType: "agent",
    actorId: "chief-of-staff",
    content: "",
    state: "processing",
    clientRequestId: "request-2",
  });
  assert.equal(second.sequence, 2);
  assert.deepEqual(
    (await store.listTurns(owner, thread.id, { limit: 1 })).nextCursor,
    { sequence: 2 },
  );
});

test("ChatStore rejects non-public data from hosted threads", async () => {
  const store = new InMemoryChatStore(clock());
  const thread = await store.createThread(owner, {
    id: "30000000-0000-4000-8000-000000000030",
    plane: "cloud",
    dataScope: "public",
  });
  await assert.rejects(
    store.appendTurn(owner, {
      id: "40000000-0000-4000-8000-000000000030",
      threadId: thread.id,
      role: "user",
      actorType: "human",
      actorId: owner.ownerUserId,
      content: "Private context",
      state: "completed",
      clientRequestId: "request-private",
      taintLabel: privateLabel,
    }),
    ChatStoreScopeError,
  );
  const turn = await store.appendTurn(owner, {
    id: "40000000-0000-4000-8000-000000000031",
    threadId: thread.id,
    role: "user",
    actorType: "human",
    actorId: owner.ownerUserId,
    content: "Public context",
    state: "completed",
    clientRequestId: "request-public",
    taintLabel: publicLabel,
  });
  assert.equal(turn.sequence, 1);
});

test("ChatStore enforces lifecycle CAS and removes private content with its thread", async () => {
  const store = new InMemoryChatStore(clock());
  const thread = await store.createThread(owner, {
    id: "30000000-0000-4000-8000-000000000032",
    plane: "local",
    dataScope: "private",
  });
  const assistantWrite = {
    id: "40000000-0000-4000-8000-000000000032",
    threadId: thread.id,
    role: "assistant",
    actorType: "agent",
    actorId: "chief-of-staff",
    content: "",
    state: "processing",
    clientRequestId: "request-processing",
    taintLabel: privateLabel,
  } as const;
  const turn = await store.appendTurn(owner, assistantWrite);
  const completed = await store.updateTurn(owner, {
    threadId: thread.id,
    turnId: turn.id,
    expectedState: "processing",
    state: "completed",
    content: "Done",
  });
  assert.equal(completed.content, "Done");
  assert.deepEqual(await store.appendTurn(owner, assistantWrite), completed);
  await assert.rejects(
    store.updateTurn(owner, {
      threadId: thread.id,
      turnId: turn.id,
      expectedState: "completed",
      state: "processing",
    }),
    ChatStoreConflictError,
  );

  const failed = await store.appendTurn(owner, {
    ...assistantWrite,
    id: "40000000-0000-4000-8000-000000000034",
    clientRequestId: "request-failed",
    state: "failed",
    content: "Failed",
  });
  const retried = await store.updateTurn(owner, {
    threadId: thread.id,
    turnId: failed.id,
    expectedState: "failed",
    state: "processing",
    content: "",
    errorCode: null,
  });
  assert.equal(retried.id, failed.id);
  assert.equal(retried.state, "processing");
  assert.equal(retried.content, "");

  const ref = await store.addTurnRef(owner, {
    id: "50000000-0000-4000-8000-000000000032",
    threadId: thread.id,
    turnId: turn.id,
    kind: "result",
    refId: "60000000-0000-4000-8000-000000000032",
  });
  assert.deepEqual(await store.addTurnRef(owner, {
    id: ref.id,
    threadId: thread.id,
    turnId: turn.id,
    kind: ref.kind,
    refId: ref.refId,
  }), ref);

  await store.archiveThread(owner, thread.id);
  assert.deepEqual(await store.appendTurn(owner, assistantWrite), completed);
  await assert.rejects(
    store.appendTurn(owner, {
      id: "40000000-0000-4000-8000-000000000033",
      threadId: thread.id,
      role: "user",
      actorType: "human",
      actorId: owner.ownerUserId,
      content: "Too late",
      state: "completed",
      clientRequestId: "request-archived",
      taintLabel: privateLabel,
    }),
    ChatStoreConflictError,
  );
  assert.equal(await store.deleteThread(owner, thread.id), true);
  assert.equal(await store.getTurn(owner, thread.id, turn.id), null);
  await assert.rejects(
    store.listTurnRefs(owner, thread.id, turn.id),
    ChatStoreNotFoundError,
  );
});

test("ChatStore cloud grants are owner-bound, exact-context, expiring, and single-use", async () => {
  let now = "2026-07-26T00:00:00.000Z";
  const store = new InMemoryChatStore(() => now);
  const thread = await store.createThread(owner, {
    id: "30000000-0000-4000-8000-000000000034",
    plane: "cloud",
    dataScope: "public",
  });
  const input = {
    id: "70000000-0000-4000-8000-000000000034",
    threadId: thread.id,
    contextDigest: "sha256:exact-context",
    providerId: "anthropic",
    modelTier: "cheap",
    expiresAt: "2026-07-26T00:05:00.000Z",
  };
  const grant = await store.createCloudGrant(owner, input);
  assert.equal(grant.consumedAt, null);
  await assert.rejects(
    store.consumeCloudGrant(otherOwner, input),
    ChatCloudGrantError,
  );
  await assert.rejects(
    store.consumeCloudGrant(owner, { ...input, contextDigest: "sha256:changed" }),
    ChatCloudGrantError,
  );
  const consumed = await store.consumeCloudGrant(owner, input);
  assert.ok(consumed.consumedAt);
  await assert.rejects(
    store.consumeCloudGrant(owner, input),
    /already consumed/,
  );

  const expired = {
    ...input,
    id: "70000000-0000-4000-8000-000000000035",
    expiresAt: "2026-07-26T00:10:00.000Z",
  };
  await store.createCloudGrant(owner, expired);
  now = "2026-07-26T00:11:00.000Z";
  await assert.rejects(
    store.consumeCloudGrant(owner, expired),
    /expired/,
  );
});
