/**
 * LA5 retrieval fusion over the real `buildWiring()` composition root.
 *
 * Contract under test:
 *  - flight OFF (default): chat keeps the pre-fusion newest-5 recency slice —
 *    an older relevant Memory does NOT reach the prompt, and no indexer state
 *    is consulted;
 *  - flight ON: after one indexer pass, the vector lane recalls the older
 *    relevant Memory the recency slice misses, and its text reaches the chat
 *    system prompt (the fusion value proof);
 *  - the indexer embeds prose rows only (learning-machinery JSON is never
 *    indexed) and is idempotent;
 *  - a Cloud-Plane thread never receives Local-Plane memory (hard invariant,
 *    re-asserted with the fusion flight ON).
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  HASHING_EMBEDDER_ID,
  hashingEmbed,
  recordSignal,
  type MemoryWrite,
  type ModelCompletionRequest,
  type ModelProvider,
  type ModelTier,
  type RunCtx,
  SeededRng,
  SystemClock,
  UuidGen,
} from "@bridge/core";
import { appRouter } from "../src/router.js";
import { indexMemoryEmbeddings, MEMORY_VECTOR_ENTITY_TYPE } from "../src/retrieval-fusion.js";
import { buildWiring, PILOT_ORGANIZATION, PILOT_USER, type Wiring } from "../src/wiring.js";

function makeRun(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(31);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

function makeCaller(wiring: Wiring) {
  return appRouter.createCaller({
    wiring,
    run: makeRun(),
    identity: { type: "user" as const, id: PILOT_USER },
    authenticated: true,
    verifying: false,
  });
}

class FusionChatModel implements ModelProvider {
  readonly id: string;
  readonly plane: "local" | "cloud";
  readonly tiers = ["cheap", "default"] as const satisfies readonly ModelTier[];
  readonly models = { cheap: "fusion-chat-v1", default: "fusion-chat-v1" } as const;
  readonly calls: ModelCompletionRequest[] = [];

  constructor(plane: "local" | "cloud" = "local") {
    this.plane = plane;
    this.id = `fusion-chat-${plane}`;
  }

  routingHealth() {
    return "healthy" as const;
  }

  async complete(request: ModelCompletionRequest) {
    this.calls.push(request);
    return {
      text: JSON.stringify({ kind: "answer", text: "Understood." }),
      model: "fusion-chat-v1",
      tier: request.tier,
      usage: {
        inputTokens: 12,
        outputTokens: 4,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        source: "provider" as const,
      },
      ...(request.taintLabel ? { taintLabel: request.taintLabel } : {}),
    };
  }
}

const OLD_RELEVANT_ID = "aaaaaaaa-0000-4000-8000-000000001a05";
const OLD_RELEVANT_TEXT =
  "The buyer strongly prefers hvac service businesses located in the texas hill country";

function proseRow(id: string, content: string, createdAt: string): MemoryWrite {
  return {
    id,
    organizationId: PILOT_ORGANIZATION,
    type: "semantic",
    scope: "private",
    content,
    confidence: 0.8,
    trustOrigin: "user_content",
    plane: "local",
    createdBy: PILOT_USER,
    ownerUserId: PILOT_USER,
    createdAt,
  };
}

/** One old relevant row + six newer irrelevant rows: the newest-5 recency
 * slice can never contain the old row. */
async function seedRecencyShadowedCorpus(wiring: Wiring) {
  await wiring.memoryStore.write(
    proseRow(OLD_RELEVANT_ID, OLD_RELEVANT_TEXT, "2026-01-01T00:00:00.000Z"),
  );
  for (let i = 0; i < 6; i += 1) {
    await wiring.memoryStore.write(
      proseRow(
        `bbbbbbbb-0000-4000-8000-00000000000${i}`,
        `Reminder ${i}: quarterly paperwork filing checklist item`,
        `2026-02-0${i + 1}T00:00:00.000Z`,
      ),
    );
  }
}

async function sendHvacQuestion(wiring: Wiring): Promise<void> {
  const caller = makeCaller(wiring);
  const { thread } = await caller.chat.thread.create({
    organizationId: PILOT_ORGANIZATION,
    plane: "local",
    clientRequestId: "fusion-chat",
  });
  await caller.chat.turn.send({
    organizationId: PILOT_ORGANIZATION,
    threadId: thread.id,
    clientRequestId: "fusion-chat-turn",
    message: "what do I think about hvac businesses in texas",
  });
}

test("flight OFF: the recency slice misses the older relevant memory (pre-fusion behavior unchanged)", async () => {
  const local = new FusionChatModel();
  const wiring = await buildWiring({ modelProviders: [local] }); // flight off
  try {
    await seedRecencyShadowedCorpus(wiring);
    await sendHvacQuestion(wiring);
    assert.equal(local.calls.length, 1);
    const system = local.calls[0]!.system ?? "";
    // Newest-5 rows reach the prompt; the older relevant one cannot.
    assert.match(system, /quarterly paperwork/);
    assert.doesNotMatch(system, /texas hill country/);
  } finally {
    await wiring.close();
  }
});

test("flight ON: vector lane recalls what recency misses and it reaches the system prompt", async () => {
  const local = new FusionChatModel();
  const wiring = await buildWiring({ retrievalFusionEnabled: true, modelProviders: [local] });
  try {
    await seedRecencyShadowedCorpus(wiring);
    const pass = await indexMemoryEmbeddings({
      memoryStore: wiring.memoryStore,
      vectorIndex: wiring.vectorIndex,
      organizationId: PILOT_ORGANIZATION,
      ownerUserId: PILOT_USER,
    });
    assert.equal(pass.indexed, 7);
    // Idempotent: a second pass indexes nothing new.
    const second = await indexMemoryEmbeddings({
      memoryStore: wiring.memoryStore,
      vectorIndex: wiring.vectorIndex,
      organizationId: PILOT_ORGANIZATION,
      ownerUserId: PILOT_USER,
    });
    assert.equal(second.indexed, 0);

    await sendHvacQuestion(wiring);
    assert.equal(local.calls.length, 1);
    const system = local.calls[0]!.system ?? "";
    assert.match(system, /## Retrieved memory/);
    // The fusion value proof: the old row the recency slice can never carry.
    assert.match(system, /texas hill country/);
  } finally {
    await wiring.close();
  }
});

test("indexer embeds prose only — learning machinery is never indexed", async () => {
  const wiring = await buildWiring();
  try {
    await wiring.memoryStore.write(
      proseRow("cccccccc-0000-4000-8000-000000000001", "A plain prose note", "2026-03-01T00:00:00.000Z"),
    );
    for (let i = 0; i < 3; i += 1) {
      await recordSignal(wiring.memoryStore, {
        id: `dddddddd-0000-4000-8000-00000000000${i}`,
        organizationId: PILOT_ORGANIZATION,
        ownerUserId: PILOT_USER,
        moduleId: "dealpilot",
        recordKind: "deal",
        recordId: `deal-${i}`,
        action: "dismiss",
        attributes: { industry: "restaurants" },
      });
    }
    const pass = await indexMemoryEmbeddings({
      memoryStore: wiring.memoryStore,
      vectorIndex: wiring.vectorIndex,
      organizationId: PILOT_ORGANIZATION,
      ownerUserId: PILOT_USER,
    });
    assert.equal(pass.indexed, 1);
    const existing = await wiring.vectorIndex.existingIds(
      MEMORY_VECTOR_ENTITY_TYPE,
      HASHING_EMBEDDER_ID,
      [
        "cccccccc-0000-4000-8000-000000000001",
        "dddddddd-0000-4000-8000-000000000000",
        "dddddddd-0000-4000-8000-000000000001",
        "dddddddd-0000-4000-8000-000000000002",
      ],
    );
    assert.deepEqual(existing, new Set(["cccccccc-0000-4000-8000-000000000001"]));
  } finally {
    await wiring.close();
  }
});

test("HARD INVARIANT: a Cloud-Plane thread gets no Local-Plane memory even with fusion on", async () => {
  const localModel = new FusionChatModel();
  const cloudModel = new FusionChatModel("cloud");
  const wiring = await buildWiring({
    retrievalFusionEnabled: true,
    modelProviders: [localModel, cloudModel],
  });
  try {
    await seedRecencyShadowedCorpus(wiring);
    await indexMemoryEmbeddings({
      memoryStore: wiring.memoryStore,
      vectorIndex: wiring.vectorIndex,
      organizationId: PILOT_ORGANIZATION,
      ownerUserId: PILOT_USER,
    });
    const caller = makeCaller(wiring);
    const { thread } = await caller.chat.thread.create({
      organizationId: PILOT_ORGANIZATION,
      plane: "cloud",
      clientRequestId: "fusion-cloud",
    });
    const prepared = await caller.chat.turn.prepareCloud({
      organizationId: PILOT_ORGANIZATION,
      threadId: thread.id,
      message: "what do I think about hvac businesses in texas",
    });
    assert.equal(prepared.disclosure.memory.length, 0);
    assert.doesNotMatch(prepared.disclosure.system, /texas hill country/);
    assert.doesNotMatch(prepared.disclosure.system, /quarterly paperwork/);
  } finally {
    await wiring.close();
  }
});

test("a configured semantic embedder owns the space: indexer and chat query share it, hashing space stays empty", async () => {
  const local = new FusionChatModel();
  const embedCalls: string[][] = [];
  // A deterministic stand-in for a real embedding model: a different id (its
  // own space) and a different dimension than the hashing fallback.
  const fakeSemantic = {
    id: "fake-semantic-test-v1",
    embed: async (texts: string[]) => {
      embedCalls.push(texts);
      return texts.map((text) => hashingEmbed(text, 64));
    },
  };
  const wiring = await buildWiring({
    retrievalFusionEnabled: true,
    modelProviders: [local],
    semanticEmbedder: fakeSemantic,
  });
  try {
    await seedRecencyShadowedCorpus(wiring);
    const pass = await indexMemoryEmbeddings({
      memoryStore: wiring.memoryStore,
      vectorIndex: wiring.vectorIndex,
      organizationId: PILOT_ORGANIZATION,
      ownerUserId: PILOT_USER,
      embedder: wiring.semanticEmbedder!,
    });
    assert.equal(pass.embeddingModel, "fake-semantic-test-v1");
    assert.equal(pass.indexed, 7);
    // Vectors live in the semantic space, NOT the hashing fallback space.
    const inSemantic = await wiring.vectorIndex.existingIds("memory", "fake-semantic-test-v1", [OLD_RELEVANT_ID]);
    const inHashing = await wiring.vectorIndex.existingIds("memory", HASHING_EMBEDDER_ID, [OLD_RELEVANT_ID]);
    assert.deepEqual(inSemantic, new Set([OLD_RELEVANT_ID]));
    assert.deepEqual(inHashing, new Set());

    // Chat embeds the QUERY with the same embedder and recalls through the
    // semantic space.
    await sendHvacQuestion(wiring);
    const system = local.calls[0]!.system ?? "";
    assert.match(system, /texas hill country/);
    assert.ok(embedCalls.some((texts) => texts.some((text) => text.includes("hvac businesses in texas"))));
  } finally {
    await wiring.close();
  }
});

test("a failing semantic embedder degrades the vector lane; the chat turn still completes", async () => {
  const local = new FusionChatModel();
  const wiring = await buildWiring({
    retrievalFusionEnabled: true,
    modelProviders: [local],
    semanticEmbedder: {
      id: "broken-semantic-v1",
      embed: async () => {
        throw new Error("model server down");
      },
    },
  });
  try {
    await seedRecencyShadowedCorpus(wiring);
    await sendHvacQuestion(wiring);
    assert.equal(local.calls.length, 1);
    const system = local.calls[0]!.system ?? "";
    // Structured recency still fills the slot; the vector lane is empty, so
    // the recency-shadowed old row cannot appear — honest degradation.
    assert.match(system, /quarterly paperwork/);
    assert.doesNotMatch(system, /texas hill country/);
  } finally {
    await wiring.close();
  }
});
