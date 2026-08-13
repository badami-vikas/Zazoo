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

test("ADR-240: threads scope by moduleId, and touchLastOpened resolves the default session", async () => {
  const store = new InMemoryChatStore(clock());
  const moduleA = "40000000-0000-4000-8000-000000000001";
  const moduleB = "40000000-0000-4000-8000-000000000002";

  const global = await store.createThread(owner, {
    id: "30000000-0000-4000-8000-000000000040",
    plane: "local",
    dataScope: "private",
  });
  assert.equal(global.moduleId, undefined);

  const aFirst = await store.createThread(owner, {
    id: "30000000-0000-4000-8000-000000000041",
    moduleId: moduleA,
    plane: "local",
    dataScope: "private",
    title: "Module A · first",
  });
  const aSecond = await store.createThread(owner, {
    id: "30000000-0000-4000-8000-000000000042",
    moduleId: moduleA,
    plane: "local",
    dataScope: "private",
    title: "Module A · second",
  });
  const bThread = await store.createThread(owner, {
    id: "30000000-0000-4000-8000-000000000043",
    moduleId: moduleB,
    plane: "local",
    dataScope: "private",
    title: "Module B",
  });

  // Listing a Module's own sessions never leaks the global thread or another
  // Module's sessions — the exact cross-Module isolation the attach picker
  // relies on to keep "this Module's list" and "the other Module's list" apart.
  const onlyModuleA = await store.listThreads(owner, { moduleId: moduleA });
  assert.deepEqual(onlyModuleA.items.map((t) => t.id).sort(), [aFirst.id, aSecond.id].sort());
  assert.ok(onlyModuleA.items.every((t) => t.moduleId === moduleA));

  const onlyGlobal = await store.listThreads(owner, { moduleId: null });
  assert.deepEqual(onlyGlobal.items.map((t) => t.id), [global.id]);

  const everything = await store.listThreads(owner);
  assert.equal(everything.items.length, 4);

  // Cross-Module attach: Module B's session is reachable from Module A's
  // owner-scoped store even though it belongs to a different moduleId.
  const attached = await store.getThread(owner, bThread.id);
  assert.equal(attached?.moduleId, moduleB);

  // "Default to last opened": lastOpenedAt starts at createdAt, so the most
  // recently created session is the initial default...
  assert.equal(aSecond.lastOpenedAt, aSecond.createdAt);
  const beforeTouch = await store.listThreads(owner, { moduleId: moduleA });
  const initialDefault = [...beforeTouch.items].sort((l, r) =>
    r.lastOpenedAt.localeCompare(l.lastOpenedAt)
  )[0];
  assert.equal(initialDefault?.id, aSecond.id);

  // ...but opening the OLDER session bumps its lastOpenedAt past the newer
  // one, so it becomes the resolved default on the next mount.
  const touched = await store.touchLastOpened(owner, aFirst.id);
  assert.ok(touched);
  assert.ok(touched!.lastOpenedAt > aSecond.lastOpenedAt);
  const afterTouch = await store.listThreads(owner, { moduleId: moduleA });
  const newDefault = [...afterTouch.items].sort((l, r) =>
    r.lastOpenedAt.localeCompare(l.lastOpenedAt)
  )[0];
  assert.equal(newDefault?.id, aFirst.id);

  assert.equal(await store.touchLastOpened(otherOwner, aFirst.id), null);
});
