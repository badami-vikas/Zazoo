import assert from "node:assert/strict";
import test from "node:test";
import {
  ChatStoreConflictError,
  ChatStoreScopeError,
  InMemoryChatStore,
  createTaintLabel,
  type ChatOwnerScope,
} from "@bridge/core";
import { ResidencyRoutingChatStore } from "../src/chat/residency-chat-store.js";

const scope: ChatOwnerScope = {
  organizationId: "10000000-0000-4000-8000-000000000026",
  ownerUserId: "20000000-0000-4000-8000-000000000026",
};

const privateLabel = createTaintLabel({
  trust: "authenticated_human",
  source: "human",
  sensitivity: "private",
  instructionRisk: "data",
  origin: {
    source: "human",
    ref: "residency-chat-private",
    hash: "private",
    transform: "captured",
  },
});

test("ResidencyRoutingChatStore keeps private and public Chat in their bound planes", async () => {
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString();
  const local = new InMemoryChatStore(now);
  const cloud = new InMemoryChatStore(now);
  const store = new ResidencyRoutingChatStore(local, cloud);
  const localId = "30000000-0000-4000-8000-000000000026";
  const cloudId = "30000000-0000-4000-8000-000000000027";

  await store.createThread(scope, {
    id: localId,
    plane: "local",
    dataScope: "private",
  });
  await store.createThread(scope, {
    id: cloudId,
    plane: "cloud",
    dataScope: "public",
  });
  assert.equal((await local.getThread(scope, localId))?.plane, "local");
  assert.equal(await cloud.getThread(scope, localId), null);
  assert.equal((await cloud.getThread(scope, cloudId))?.plane, "cloud");
  assert.equal(await local.getThread(scope, cloudId), null);

  await store.appendTurn(scope, {
    id: "40000000-0000-4000-8000-000000000026",
    threadId: localId,
    role: "user",
    actorType: "human",
    actorId: scope.ownerUserId,
    content: "Keep this local",
    state: "completed",
    clientRequestId: "local-turn",
    taintLabel: privateLabel,
  });
  assert.equal((await local.listTurns(scope, localId)).items.length, 1);
  assert.deepEqual(
    (await store.listThreads(scope)).items.map(({ id }) => id).sort(),
    [cloudId, localId].sort(),
  );
});

test("ResidencyRoutingChatStore rejects duplicated, misplaced, and unavailable Local rows", async () => {
  const local = new InMemoryChatStore();
  const cloud = new InMemoryChatStore();
  const store = new ResidencyRoutingChatStore(local, cloud);
  const duplicatedId = "30000000-0000-4000-8000-000000000036";
  await local.createThread(scope, {
    id: duplicatedId,
    plane: "local",
    dataScope: "private",
  });
  await cloud.createThread(scope, {
    id: duplicatedId,
    plane: "cloud",
    dataScope: "public",
  });
  await assert.rejects(
    store.getThread(scope, duplicatedId),
    ChatStoreConflictError,
  );

  const misplacedId = "30000000-0000-4000-8000-000000000037";
  await local.createThread(scope, {
    id: misplacedId,
    plane: "cloud",
    dataScope: "public",
  });
  await assert.rejects(store.getThread(scope, misplacedId), ChatStoreScopeError);

  const hosted = new ResidencyRoutingChatStore(null, new InMemoryChatStore());
  await assert.rejects(
    hosted.createThread(scope, {
      id: "30000000-0000-4000-8000-000000000038",
      plane: "local",
      dataScope: "private",
    }),
    /Local Plane Chat is unavailable/,
  );
});
