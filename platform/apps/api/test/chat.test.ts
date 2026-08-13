import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  EchoModelProvider,
  InMemoryChatStore,
  SeededRng,
  SystemClock,
  UuidGen,
  createTaintLabel,
  type ChatStore,
  type ChatTurn,
  type ModelCompletionRequest,
  type ModelProvider,
  type ModelTier,
  type RunCtx,
} from "@bridge/core";
import {
  LlamaCppProvider,
  MANAGED_LLAMA_MODEL_ID,
} from "@bridge/models";
import { InMemorySourceCredentialVault } from "@bridge/dealpilot";
import { appRouter } from "../src/router.js";
import {
  buildWiring,
  PILOT_ORGANIZATION,
  PILOT_USER,
  type Wiring,
} from "../src/wiring.js";

function makeRun(seed = 26): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(seed);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

function makeCaller(wiring: Wiring, seed = 26) {
  return appRouter.createCaller({
    wiring,
    run: makeRun(seed),
    identity: { type: "user" as const, id: PILOT_USER },
    authenticated: true,
    verifying: false,
  });
}

class ChatModel implements ModelProvider {
  readonly id: string;
  readonly plane: "local" | "cloud";
  readonly tiers = ["cheap", "default"] as const satisfies readonly ModelTier[];
  readonly models: Readonly<Partial<Record<ModelTier, string>>>;
  readonly calls: ModelCompletionRequest[] = [];

  constructor(
    plane: "local" | "cloud",
    private readonly reply: (request: ModelCompletionRequest) => string,
  ) {
    this.id = `chat-test-${plane}`;
    this.plane = plane;
    this.models = {
      cheap: `${this.id}-v1`,
      default: `${this.id}-v1`,
    };
  }

  routingHealth() {
    return "healthy" as const;
  }

  async complete(request: ModelCompletionRequest) {
    this.calls.push(request);
    return {
      text: this.reply(request),
      model: `${this.id}-v1`,
      tier: request.tier,
      usage: {
        inputTokens: 20,
        outputTokens: 8,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        source: "provider" as const,
      },
      ...(request.taintLabel ? { taintLabel: request.taintLabel } : {}),
    };
  }
}

async function withChatWiring<T>(
  providers: readonly ModelProvider[],
  operation: (wiring: Wiring) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "bridge-chat-api-"));
  const wiring = await buildWiring({
    localDir: join(root, "local"),
    moduleFilesBridgeRoot: join(root, "files"),
    modelProviders: providers,
    // Avoid touching the real OS keyring for these deterministic tests;
    // the model-provider-key status test below writes to this directly.
    dealPilotCredentialVault: new InMemorySourceCredentialVault(),
  });
  try {
    return await operation(wiring);
  } finally {
    await wiring.close();
    await rm(root, { recursive: true, force: true });
  }
}

test("Chat threads are deterministic and exact send retries do not rerun the model", async () => {
  const local = new ChatModel(
    "local",
    () => JSON.stringify({ kind: "answer", text: "A durable answer." }),
  );
  await withChatWiring([local], async (wiring) => {
    const caller = makeCaller(wiring);
    const createInput = {
      organizationId: PILOT_ORGANIZATION,
      plane: "local" as const,
      clientRequestId: "default",
    };
    const firstView = await caller.chat.thread.create(createInput);
    const first = firstView.thread;
    const duplicate = await caller.chat.thread.create(createInput);
    assert.equal(duplicate.thread.id, first.id);
    const cloud = await caller.chat.thread.create({
      ...createInput,
      plane: "cloud",
    });
    assert.notEqual(
      cloud.thread.id,
      first.id,
      "Local and Cloud Plane default threads must not share an id",
    );

    const sendInput = {
      organizationId: PILOT_ORGANIZATION,
      threadId: first.id,
      clientRequestId: "send-once",
      message: "Give me a direct answer.",
      surface: { kind: "chat_panel" as const },
    };
    const sent = await caller.chat.turn.send(sendInput);
    const replay = await caller.chat.turn.send(sendInput);

    assert.equal(local.calls.length, 1);
    assert.equal(replay.turns.length, 2);
    assert.equal(replay.turns[1]?.state, "completed");
    assert.equal(replay.turns[1]?.content, "A durable answer.");
    assert.ok(replay.turns[1]?.refs.some((ref) => ref.kind === "model_receipt"));
    assert.ok(replay.turns[1]?.refs.some((ref) => ref.kind === "routing_decision"));
    assert.deepEqual(replay, sent);
  });
});

test("ADR-240: Module-scoped Chat sessions isolate by moduleId and default to the last opened one", async () => {
  const local = new ChatModel(
    "local",
    () => JSON.stringify({ kind: "answer", text: "A durable answer." }),
  );
  await withChatWiring([local], async (wiring) => {
    const caller = makeCaller(wiring);
    const relationship = await wiring.moduleStore.getAvailable(PILOT_ORGANIZATION, "relationship");
    assert.ok(relationship, "the built-in Relationship Module is installed by buildWiring");
    const otherModule = await wiring.moduleStore.getAvailable(PILOT_ORGANIZATION, "task-manager");
    assert.ok(otherModule);

    await assert.rejects(
      caller.chat.thread.create({
        organizationId: PILOT_ORGANIZATION,
        moduleId: "00000000-0000-4000-8000-000000000000",
        clientRequestId: "unknown-module",
      }),
      /not found/,
    );

    const first = await caller.chat.thread.create({
      organizationId: PILOT_ORGANIZATION,
      moduleId: relationship.id,
      title: "Relationship · first",
      clientRequestId: "relationship-first",
    });
    assert.equal(first.thread.moduleId, relationship.id);
    // Guarantees `second` is strictly newer than `first` at millisecond
    // precision, so the "most recently created is the initial default"
    // assertion below cannot flake on a same-tick collision.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await caller.chat.thread.create({
      organizationId: PILOT_ORGANIZATION,
      moduleId: relationship.id,
      title: "Relationship · second",
      clientRequestId: "relationship-second",
    });
    const globalThread = await caller.chat.thread.create({
      organizationId: PILOT_ORGANIZATION,
      clientRequestId: "global",
    });
    assert.equal(globalThread.thread.moduleId, undefined);
    const otherModuleThread = await caller.chat.thread.create({
      organizationId: PILOT_ORGANIZATION,
      moduleId: otherModule.id,
      clientRequestId: "task-manager-thread",
    });

    // Cross-Module isolation: listing one Module's sessions never surfaces
    // the global thread or another Module's session — the same isolation
    // the "attach from another Module" picker relies on.
    const scoped = await caller.chat.thread.list({
      organizationId: PILOT_ORGANIZATION,
      moduleId: relationship.id,
    });
    assert.deepEqual(
      scoped.items.map((item) => item.id).sort(),
      [first.thread.id, second.thread.id].sort(),
    );
    assert.ok(!scoped.items.some((item) => item.id === globalThread.thread.id));
    assert.ok(!scoped.items.some((item) => item.id === otherModuleThread.thread.id));

    // "Default to last opened": the most recently created session (`second`)
    // is the default until an OLDER session (`first`) is explicitly opened,
    // at which point it becomes the resolved default.
    const initialByLastOpened = [...scoped.items].sort((left, right) =>
      right.lastOpenedAt.localeCompare(left.lastOpenedAt)
    );
    assert.equal(initialByLastOpened[0]?.id, second.thread.id);

    await new Promise((resolve) => setTimeout(resolve, 5));
    const touched = await caller.chat.thread.touchLastOpened({
      organizationId: PILOT_ORGANIZATION,
      threadId: first.thread.id,
    });
    assert.equal(touched.id, first.thread.id);

    const rescoped = await caller.chat.thread.list({
      organizationId: PILOT_ORGANIZATION,
      moduleId: relationship.id,
    });
    const afterTouch = [...rescoped.items].sort((left, right) =>
      right.lastOpenedAt.localeCompare(left.lastOpenedAt)
    );
    assert.equal(afterTouch[0]?.id, first.thread.id);
  });
});

test("Chat fails visibly when no eligible local model is configured", async () => {
  await withChatWiring([new EchoModelProvider()], async (wiring) => {
    const caller = makeCaller(wiring, 33);
    const { thread } = await caller.chat.thread.create({
      organizationId: PILOT_ORGANIZATION,
      plane: "local",
      clientRequestId: "model-unavailable",
    });

    await assert.rejects(
      caller.chat.turn.send({
        organizationId: PILOT_ORGANIZATION,
        threadId: thread.id,
        clientRequestId: "model-unavailable-turn",
        message: "Do not fake an answer.",
      }),
      /No local model provider is configured/,
    );
    const failed = await caller.chat.thread.get({
      organizationId: PILOT_ORGANIZATION,
      threadId: thread.id,
    });
    assert.equal(failed.turns.at(-1)?.state, "failed");
    assert.equal(failed.turns.at(-1)?.errorCode, "chat_turn_failed");
  });
});

test("chat.model.status reports Cloud availability, honoring the ADR-181 restart-required boundary", async () => {
  const local = new ChatModel(
    "local",
    () => JSON.stringify({ kind: "answer", text: "local reply" }),
  );

  // No Groq key saved at all: Cloud is neither available nor configured.
  await withChatWiring([local], async (wiring) => {
    const caller = makeCaller(wiring, 41);
    const status = await caller.chat.model.status({ organizationId: PILOT_ORGANIZATION });
    assert.deepEqual(status.cloud, {
      available: false,
      providerId: null,
      modelTier: "default" as const,
      configured: false,
      restartRequired: false,
    });
  });

  // A key is saved in the SAME governed vault Settings -> API Keys uses
  // (ADR-181), but this process's model router was constructed before the
  // save, so the provider is not registered yet. Status must say "saved,
  // needs a restart" rather than either "connected" (fabricated, AP-021) or
  // "not configured" (loses the user's own saved state).
  await withChatWiring([local], async (wiring) => {
    await wiring.modelProviderKeys.save(PILOT_ORGANIZATION, "groq", "sk-test-not-yet-active");
    const caller = makeCaller(wiring, 42);
    const status = await caller.chat.model.status({ organizationId: PILOT_ORGANIZATION });
    assert.deepEqual(status.cloud, {
      available: false,
      providerId: null,
      modelTier: "default" as const,
      configured: true,
      restartRequired: true,
    });
  });

  // Once a Cloud-plane provider IS registered (post-restart, in practice),
  // status reports it as available and configured with no restart pending.
  const cloud = new ChatModel("cloud", () => JSON.stringify({ kind: "answer", text: "cloud reply" }));
  await withChatWiring([local, cloud], async (wiring) => {
    const caller = makeCaller(wiring, 43);
    const status = await caller.chat.model.status({ organizationId: PILOT_ORGANIZATION });
    assert.deepEqual(status.cloud, {
      available: true,
      providerId: cloud.id,
      modelTier: "default" as const,
      configured: true,
      restartRequired: false,
    });
  });
});

test("managed llama readiness is enforced before local model egress", async () => {
  let requested = false;
  const managed = new LlamaCppProvider({
    readCapability: () => ({
      version: 1,
      baseUrl: "http://127.0.0.1:49152",
      apiKey: "a".repeat(64),
      model: MANAGED_LLAMA_MODEL_ID,
      runtimeRevision: "b9000",
      pid: 123,
    }),
    fetchImpl: async () => {
      requested = true;
      throw new Error("managed model request must not run before installation");
    },
  });
  await withChatWiring([managed], async (wiring) => {
    const caller = makeCaller(wiring, 36);
    const { thread } = await caller.chat.thread.create({
      organizationId: PILOT_ORGANIZATION,
      plane: "local",
      clientRequestId: "managed-model-readiness",
    });
    await assert.rejects(
      caller.chat.turn.send({
        organizationId: PILOT_ORGANIZATION,
        threadId: thread.id,
        clientRequestId: "managed-model-not-installed",
        message: "Do not leave the API.",
      }),
      /not_installed|not ready/,
    );
    assert.equal(requested, false);
  });
});

test("Chat history survives API wiring restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "bridge-chat-restart-"));
  const local = new ChatModel(
    "local",
    () => JSON.stringify({ kind: "answer", text: "Persist this answer." }),
  );
  let wiring: Wiring | undefined;
  try {
    wiring = await buildWiring({
      localDir: join(root, "local"),
      moduleFilesBridgeRoot: join(root, "files"),
      modelProviders: [local],
    });
    const firstCaller = makeCaller(wiring, 30);
    const { thread } = await firstCaller.chat.thread.create({
      organizationId: PILOT_ORGANIZATION,
      plane: "local",
      clientRequestId: "restart",
    });
    await firstCaller.chat.turn.send({
      organizationId: PILOT_ORGANIZATION,
      threadId: thread.id,
      clientRequestId: "restart-turn",
      message: "Remember this across restart.",
    });
    await wiring.close();
    wiring = undefined;

    wiring = await buildWiring({
      localDir: join(root, "local"),
      moduleFilesBridgeRoot: join(root, "files"),
      modelProviders: [local],
    });
    const restored = await makeCaller(wiring, 31).chat.thread.get({
      organizationId: PILOT_ORGANIZATION,
      threadId: thread.id,
    });
    assert.deepEqual(
      restored.turns.map(({ role, content, state }) => ({ role, content, state })),
      [
        {
          role: "user",
          content: "Remember this across restart.",
          state: "completed",
        },
        {
          role: "assistant",
          content: "Persist this answer.",
          state: "completed",
        },
      ],
    );
  } finally {
    await wiring?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Chat reconciles a stale in-flight turn after an interrupted API process", async () => {
  const local = new ChatModel(
    "local",
    () => JSON.stringify({ kind: "answer", text: "Unused." }),
  );
  await withChatWiring([local], async (wiring) => {
    const staleStore = new InMemoryChatStore(() => "2020-01-01T00:00:00.000Z");
    (wiring as { chatStore: ChatStore }).chatStore = staleStore;
    const scope = {
      organizationId: PILOT_ORGANIZATION,
      ownerUserId: PILOT_USER,
    };
    const thread = await staleStore.createThread(scope, {
      id: "30000000-0000-4000-8000-000000000226",
      plane: "local",
      dataScope: "private",
    });
    const taintLabel = createTaintLabel({
      trust: "authenticated_human",
      source: "human",
      sensitivity: "private",
      instructionRisk: "instruction_like",
      origin: {
        source: "human",
        ref: "chat-interrupted-test",
        hash: `sha256:${"a".repeat(64)}`,
        transform: "captured",
      },
    });
    await staleStore.appendTurn(scope, {
      id: "40000000-0000-4000-8000-000000000226",
      threadId: thread.id,
      role: "assistant",
      actorType: "agent",
      actorId: "b0000000-0000-4000-a000-000000000001",
      content: "",
      state: "processing",
      clientRequestId: "stale-assistant",
      taintLabel,
    });

    const restored = await makeCaller(wiring, 32).chat.thread.get({
      organizationId: PILOT_ORGANIZATION,
      threadId: thread.id,
    });
    assert.equal(restored.turns[0]?.state, "failed");
    assert.equal(restored.turns[0]?.errorCode, "interrupted");
  });
});

test("Cloud Chat requires fresh exact-context consent and cannot replay a grant", async () => {
  const local = new ChatModel(
    "local",
    () => JSON.stringify({ kind: "answer", text: "Local support." }),
  );
  const cloud = new ChatModel(
    "cloud",
    () => JSON.stringify({ kind: "answer", text: "Public answer." }),
  );
  await withChatWiring([local, cloud], async (wiring) => {
    const caller = makeCaller(wiring, 27);
    const { thread } = await caller.chat.thread.create({
      organizationId: PILOT_ORGANIZATION,
      plane: "cloud",
      clientRequestId: "public",
    });
    await assert.rejects(
      caller.chat.turn.send({
        organizationId: PILOT_ORGANIZATION,
        threadId: thread.id,
        clientRequestId: "missing-consent",
        message: "Do not send without consent.",
      }),
      /fresh exact-context consent/,
    );
    assert.equal(cloud.calls.length, 0);
    const prepared = await caller.chat.turn.prepareCloud({
      organizationId: PILOT_ORGANIZATION,
      threadId: thread.id,
      message: "This information is public.",
      surface: { kind: "chief_of_staff_page" },
    });
    assert.equal(prepared.disclosure.memory.length, 0);
    assert.equal(prepared.disclosure.currentMessage, "This information is public.");
    assert.equal(prepared.disclosure.providerId, cloud.id);
    assert.ok(prepared.disclosure.system.includes("Output contract"));
    assert.ok(
      prepared.disclosure.history.some(
        (entry) => entry.content === "Do not send without consent.",
      ),
    );

    await assert.rejects(
      caller.chat.turn.send({
        organizationId: PILOT_ORGANIZATION,
        threadId: thread.id,
        clientRequestId: "wrong-context",
        message: "Different public information.",
        cloudGrantId: prepared.grantId,
      }),
      /exact prepared context/,
    );
    assert.equal(cloud.calls.length, 0);

    const refreshed = await caller.chat.turn.prepareCloud({
      organizationId: PILOT_ORGANIZATION,
      threadId: thread.id,
      message: "This information is public.",
    });
    const sent = await caller.chat.turn.send({
      organizationId: PILOT_ORGANIZATION,
      threadId: thread.id,
      clientRequestId: "authorized-context",
      message: "This information is public.",
      cloudGrantId: refreshed.grantId,
    });
    assert.equal(sent.turns.at(-1)?.content, "Public answer.");
    assert.equal(cloud.calls.length, 1);
    const publicSchema = cloud.calls[0]?.responseFormat?.schema as
      | Record<string, unknown>
      | undefined;
    assert.equal(publicSchema?.["type"], "object");
    assert.equal("oneOf" in (publicSchema ?? {}), false);
    assert.equal(
      (publicSchema?.["properties"] as { text?: { maxLength?: number } } | undefined)
        ?.text?.maxLength,
      2_000,
    );

    await assert.rejects(
      caller.chat.turn.send({
        organizationId: PILOT_ORGANIZATION,
        threadId: thread.id,
        clientRequestId: "grant-replay",
        message: "This information is public.",
        cloudGrantId: refreshed.grantId,
      }),
      /consumed/,
    );
    assert.equal(cloud.calls.length, 1);
  });
});

test("cloud context drops oldest complete exchanges before the RunContext character cap", async () => {
  const cloud = new ChatModel(
    "cloud",
    () => JSON.stringify({ kind: "answer", text: "Bounded answer." }),
  );
  await withChatWiring([new EchoModelProvider(), cloud], async (wiring) => {
    const store = new InMemoryChatStore();
    (wiring as { chatStore: ChatStore }).chatStore = store;
    const scope = {
      organizationId: PILOT_ORGANIZATION,
      ownerUserId: PILOT_USER,
    };
    const thread = await store.createThread(scope, {
      id: "30000000-0000-4000-8000-000000000242",
      plane: "cloud",
      dataScope: "public",
    });
    const taintLabel = createTaintLabel({
      trust: "authenticated_human",
      source: "human",
      sensitivity: "public",
      instructionRisk: "data",
      origin: {
        source: "human",
        ref: "chat-cloud-character-budget",
        hash: "cloud-character-budget",
        transform: "captured",
      },
    });
    for (let index = 1; index <= 24; index += 1) {
      await store.appendTurn(scope, {
        id: `40000000-0000-4000-8000-${String(index + 300).padStart(12, "0")}`,
        threadId: thread.id,
        role: index % 2 === 0 ? "assistant" : "user",
        actorType: index % 2 === 0 ? "agent" : "human",
        actorId: index % 2 === 0 ? "chief-of-staff" : PILOT_USER,
        content: `${String(index).padStart(2, "0")}:${"x".repeat(9_997)}`,
        state: "completed",
        clientRequestId: `cloud-character-budget-${index}`,
        taintLabel,
      });
    }

    const caller = makeCaller(wiring, 38);
    const prepared = await caller.chat.turn.prepareCloud({
      organizationId: PILOT_ORGANIZATION,
      threadId: thread.id,
      message: "Use only the newest complete bounded exchanges.",
    });
    assert.equal(prepared.disclosure.history.length, 6);
    assert.match(prepared.disclosure.history[0]!.content, /^19:/u);
    const sent = await caller.chat.turn.send({
      organizationId: PILOT_ORGANIZATION,
      threadId: thread.id,
      clientRequestId: "bounded-cloud-context",
      message: "Use only the newest complete bounded exchanges.",
      cloudGrantId: prepared.grantId,
    });
    assert.equal(sent.turns.at(-1)?.content, "Bounded answer.");
  });
});

test("cloud grants retain the exact bounded context after a long thread", async () => {
  const cloud = new ChatModel(
    "cloud",
    () => JSON.stringify({ kind: "answer", text: "Long-context answer." }),
  );
  await withChatWiring([new EchoModelProvider(), cloud], async (wiring) => {
    const store = new InMemoryChatStore();
    (wiring as { chatStore: ChatStore }).chatStore = store;
    const scope = {
      organizationId: PILOT_ORGANIZATION,
      ownerUserId: PILOT_USER,
    };
    const thread = await store.createThread(scope, {
      id: "30000000-0000-4000-8000-000000000241",
      plane: "cloud",
      dataScope: "public",
    });
    const taintLabel = createTaintLabel({
      trust: "authenticated_human",
      source: "human",
      sensitivity: "public",
      instructionRisk: "data",
      origin: {
        source: "human",
        ref: "chat-cloud-context-test",
        hash: "cloud-context",
        transform: "captured",
      },
    });
    for (let index = 1; index <= 30; index += 1) {
      await store.appendTurn(scope, {
        id: `40000000-0000-4000-8000-${String(index + 200).padStart(12, "0")}`,
        threadId: thread.id,
        role: index % 2 === 0 ? "assistant" : "user",
        actorType: index % 2 === 0 ? "agent" : "human",
        actorId: index % 2 === 0 ? "chief-of-staff" : PILOT_USER,
        content: `Public history ${index}`,
        state: "completed",
        clientRequestId: `cloud-context-${index}`,
        taintLabel,
      });
    }

    const caller = makeCaller(wiring, 37);
    const prepared = await caller.chat.turn.prepareCloud({
      organizationId: PILOT_ORGANIZATION,
      threadId: thread.id,
      message: "Use the exact bounded public history.",
    });
    assert.equal(prepared.disclosure.history.length, 24);
    assert.equal(prepared.disclosure.history[0]?.content, "Public history 7");
    const sent = await caller.chat.turn.send({
      organizationId: PILOT_ORGANIZATION,
      threadId: thread.id,
      clientRequestId: "long-cloud-context",
      message: "Use the exact bounded public history.",
      cloudGrantId: prepared.grantId,
    });
    assert.equal(sent.turns.at(-1)?.content, "Long-context answer.");
    assert.equal(cloud.calls.length, 1);
  });
});

test("Chat Task proposals approve, edit, and veto through governed lifecycle", async () => {
  const local = new ChatModel(
    "local",
    (request) => JSON.stringify({
      kind: "create_task",
      text: "I drafted this Task for your review.",
      title: `Task: ${request.prompt}`,
      outcome: "The requested work is complete.",
      exitTest: "The result is verified.",
    }),
  );
  await withChatWiring([local], async (wiring) => {
    const caller = makeCaller(wiring, 28);
    // One Task node per thread (ADR-183): a second create in the SAME thread
    // appends to the node already there, so each lifecycle branch below gets
    // its own thread.
    async function newThread(clientRequestId: string) {
      const created = await caller.chat.thread.create({
        organizationId: PILOT_ORGANIZATION,
        plane: "local",
        clientRequestId,
      });
      return created.thread;
    }
    const thread = await newThread("task-lifecycle");

    async function propose(message: string, clientRequestId: string, threadId = thread.id) {
      const view = await caller.chat.turn.send({
        organizationId: PILOT_ORGANIZATION,
        threadId,
        clientRequestId,
        message,
      });
      const turn = view.turns.at(-1);
      assert.equal(turn?.state, "awaiting_decision");
      assert.ok(turn?.proposal);
      const output = turn.proposal.proposedOutput as {
        kind: "task_create";
        mode: "create" | "append";
        taskId: string;
        title: string;
        outcome: string;
        exitTest: string;
        parentTaskId: string | null;
        parentRationale: string | null;
        parentCandidates: { taskId: string; title: string; reason: string; score: number }[];
        status: "proposed";
      };
      assert.equal(output.status, "proposed");
      return { turn: turn!, proposal: turn!.proposal!, output };
    }

    const approved = await propose("Create approved work", "approve");
    assert.equal(approved.output.mode, "create");
    const createTaskManifest = wiring.skillManifests
      .forSkill(PILOT_ORGANIZATION, "task-manager.create-task")
      .at(0);
    assert.deepEqual(
      (createTaskManifest?.outputSchema as { required?: string[] })?.required,
      [
        "kind",
        "mode",
        "taskId",
        "title",
        "outcome",
        "exitTest",
        "parentTaskId",
        "parentRationale",
        "parentCandidates",
        "status",
      ],
    );
    const localSchema = local.calls[0]?.responseFormat?.schema as
      | { required?: string[] }
      | undefined;
    assert.deepEqual(localSchema?.required, [
      "kind",
      "title",
      "outcome",
      "exitTest",
      "text",
    ]);
    await caller.action.decide({
      proposalId: approved.proposal.id,
      decision: "approve",
      chatThreadId: thread.id,
      chatTurnId: approved.turn.id,
    });
    const approvedTask = await wiring.taskManager.get(
      PILOT_ORGANIZATION,
      approved.output.taskId,
    );
    assert.ok(approvedTask);
    assert.ok(["candidate", "committed"].includes(approvedTask.status));
    assert.equal(approvedTask.visibility, "private");
    const approvedRunId = approved.turn.refs.find(
      (ref) => ref.kind === "automation_run",
    )?.refId;
    assert.ok(approvedRunId);
    const runBeforeTaskChange = await wiring.automationRunRecorder.get(
      PILOT_ORGANIZATION,
      approvedRunId,
    );
    await caller.taskManager.transition({
      organizationId: PILOT_ORGANIZATION,
      taskId: approvedTask.id,
      status: approvedTask.status === "candidate" ? "committed" : "in_progress",
    });
    await caller.chat.thread.get({
      organizationId: PILOT_ORGANIZATION,
      threadId: thread.id,
    });
    const runAfterTaskChange = await wiring.automationRunRecorder.get(
      PILOT_ORGANIZATION,
      approvedRunId,
    );
    assert.deepEqual(runAfterTaskChange?.output, runBeforeTaskChange?.output);

    const editThread = await newThread("task-lifecycle-edit");
    const edited = await propose("Create editable work", "edit", editThread.id);
    await caller.action.decide({
      proposalId: edited.proposal.id,
      decision: "edit",
      chatThreadId: editThread.id,
      chatTurnId: edited.turn.id,
      editedOutput: { ...edited.output, title: "Human-edited Task" },
    });
    assert.equal(
      (await wiring.taskManager.get(PILOT_ORGANIZATION, edited.output.taskId))?.title,
      "Human-edited Task",
    );

    const vetoThread = await newThread("task-lifecycle-veto");
    const vetoed = await propose("Create vetoed work", "veto", vetoThread.id);
    await caller.action.decide({
      proposalId: vetoed.proposal.id,
      decision: "veto",
      chatThreadId: vetoThread.id,
      chatTurnId: vetoed.turn.id,
    });
    assert.equal(
      await wiring.taskManager.get(PILOT_ORGANIZATION, vetoed.output.taskId),
      null,
    );

    const finals = await Promise.all(
      [thread.id, editThread.id, vetoThread.id].map((threadId) =>
        caller.chat.thread.get({ organizationId: PILOT_ORGANIZATION, threadId }),
      ),
    );
    const finalTurns = finals.flatMap((view) => view.turns);
    for (const turn of finalTurns.filter((candidate) => candidate.role === "assistant")) {
      assert.equal(turn.state, "completed");
      assert.ok(turn.refs.some((ref) => ref.kind === "automation_run"));
      assert.ok(turn.refs.some((ref) => ref.kind === "result"));
      assert.ok(turn.decision);
      assert.ok(turn.automationRun);
      assert.notEqual(turn.automationRun.status, "running");
      assert.ok(turn.result);
    }
    const editedReloaded = finalTurns.find((turn) => turn.id === edited.turn.id);
    assert.equal(
      (editedReloaded?.decision?.proposedOutput as { title?: string } | undefined)?.title,
      "Human-edited Task",
    );
    assert.equal(editedReloaded?.result?.task?.title, "Human-edited Task");
  });
});

test("a Chat follow-up continues the thread's Task node instead of minting a sibling", async () => {
  let turn = 0;
  const local = new ChatModel("local", () => {
    turn += 1;
    return JSON.stringify({
      kind: "create_task",
      text: "Review this Task.",
      title: turn === 1 ? "Ship the pricing page" : "Ship the pricing page copy",
      outcome:
        turn === 1
          ? "The pricing page is live."
          : "The pricing page copy is reviewed.",
      exitTest: "The page renders for a signed-out visitor.",
    });
  });
  await withChatWiring([local], async (wiring) => {
    const caller = makeCaller(wiring, 44);
    const { thread } = await caller.chat.thread.create({
      organizationId: PILOT_ORGANIZATION,
      plane: "local",
      clientRequestId: "follow-up-thread",
    });
    async function send(clientRequestId: string, message: string) {
      const view = await caller.chat.turn.send({
        organizationId: PILOT_ORGANIZATION,
        threadId: thread.id,
        clientRequestId,
        message,
      });
      const assistant = view.turns.at(-1)!;
      return {
        assistant,
        output: assistant.proposal!.proposedOutput as {
          mode: "create" | "append";
          taskId: string;
          parentTaskId: string | null;
          parentRationale: string | null;
          parentCandidates: { taskId: string }[];
        },
      };
    }

    const first = await send("follow-up-1", "Get the pricing page shipped.");
    assert.equal(first.output.mode, "create");
    assert.equal(first.output.parentTaskId, null);
    await caller.action.decide({
      proposalId: first.assistant.proposal!.id,
      decision: "approve",
      chatThreadId: thread.id,
      chatTurnId: first.assistant.id,
    });
    const node = await wiring.taskManager.get(
      PILOT_ORGANIZATION,
      first.output.taskId,
    );
    assert.ok(node);

    const followUp = await send("follow-up-2", "Also review the copy on it.");
    assert.equal(followUp.output.mode, "append");
    assert.equal(followUp.output.taskId, first.output.taskId);
    assert.equal(followUp.output.parentTaskId, null);
    await caller.action.decide({
      proposalId: followUp.assistant.proposal!.id,
      decision: "approve",
      chatThreadId: thread.id,
      chatTurnId: followUp.assistant.id,
    });

    // Same node, one more Outcome — no sibling Task was created.
    const tasks = await wiring.taskManager.list(PILOT_ORGANIZATION);
    const chatTasks = tasks.filter(
      (task) => task.requiredSkillId === "task-manager.create-task",
    );
    assert.deepEqual(chatTasks.map((task) => task.id), [first.output.taskId]);
    const continued = await wiring.taskManager.get(
      PILOT_ORGANIZATION,
      first.output.taskId,
    );
    assert.equal(continued?.outcomes.length, 2);
    assert.equal(continued?.outcomes[1]?.title, "Ship the pricing page copy");
    assert.equal(continued?.outcomes[1]?.northStar, false);

    // A NEW thread that repeats the same subject gets an explained parent
    // suggestion rather than a silent re-parent.
    const { thread: second } = await caller.chat.thread.create({
      organizationId: PILOT_ORGANIZATION,
      plane: "local",
      clientRequestId: "follow-up-sibling-thread",
    });
    const sibling = await caller.chat.turn.send({
      organizationId: PILOT_ORGANIZATION,
      threadId: second.id,
      clientRequestId: "follow-up-3",
      message: "Ship the pricing page copy too.",
    });
    const siblingOutput = sibling.turns.at(-1)!.proposal!.proposedOutput as {
      mode: string;
      parentTaskId: string | null;
      parentRationale: string | null;
      parentCandidates: { taskId: string; reason: string }[];
    };
    assert.equal(siblingOutput.mode, "create");
    assert.equal(siblingOutput.parentTaskId, first.output.taskId);
    assert.match(siblingOutput.parentRationale ?? "", /^Shares .*"pricing"/);
    assert.ok(siblingOutput.parentCandidates.length >= 1);
  });
});

test("a decided processing turn reconciles to its terminal Task result", async () => {
  const local = new ChatModel(
    "local",
    () => JSON.stringify({
      kind: "create_task",
      text: "Review this crash-recovery Task.",
      title: "Recover a decided turn",
      outcome: "The decided turn is terminal.",
      exitTest: "Reload shows a completed turn and Task result.",
    }),
  );
  await withChatWiring([local], async (wiring) => {
    const store = new InMemoryChatStore();
    (wiring as { chatStore: ChatStore }).chatStore = store;
    const caller = makeCaller(wiring, 39);
    const { thread } = await caller.chat.thread.create({
      organizationId: PILOT_ORGANIZATION,
      plane: "local",
      clientRequestId: "decided-processing-thread",
    });
    const proposed = await caller.chat.turn.send({
      organizationId: PILOT_ORGANIZATION,
      threadId: thread.id,
      clientRequestId: "decided-processing-turn",
      message: "Create a Task that survives the decision crash window.",
    });
    const assistant = proposed.turns.at(-1)!;
    assert.equal(assistant.state, "awaiting_decision");
    const turnMap = (
      store as unknown as { turns: Map<string, ChatTurn> }
    ).turns;
    turnMap.set(assistant.id, {
      ...turnMap.get(assistant.id)!,
      state: "processing",
      updatedAt: "2000-01-01T00:00:00.000Z",
    });

    await caller.action.decide({
      proposalId: assistant.proposal!.id,
      decision: "approve",
      chatThreadId: thread.id,
      chatTurnId: assistant.id,
    });
    const restored = await caller.chat.thread.get({
      organizationId: PILOT_ORGANIZATION,
      threadId: thread.id,
    });
    const terminal = restored.turns.find((turn) => turn.id === assistant.id);
    assert.equal(terminal?.state, "completed");
    assert.ok(terminal?.result?.task);
    assert.equal(terminal?.automationRun?.status, "completed");
  });
});

test("concurrent Chat decision reconciliation materializes one deterministic Task", async () => {
  const local = new ChatModel(
    "local",
    () => JSON.stringify({
      kind: "create_task",
      text: "Review this concurrent Task.",
      title: "Converge concurrent reconciliation",
      outcome: "One deterministic Task exists.",
      exitTest: "Decision and reload both succeed with one Task.",
    }),
  );
  await withChatWiring([local], async (wiring) => {
    const caller = makeCaller(wiring, 40);
    const { thread } = await caller.chat.thread.create({
      organizationId: PILOT_ORGANIZATION,
      plane: "local",
      clientRequestId: "concurrent-decision-thread",
    });
    const proposed = await caller.chat.turn.send({
      organizationId: PILOT_ORGANIZATION,
      threadId: thread.id,
      clientRequestId: "concurrent-decision-turn",
      message: "Create one Task under concurrent reconciliation.",
    });
    const assistant = proposed.turns.at(-1)!;
    const output = assistant.proposal!.proposedOutput as { taskId: string };
    const originalCreate = wiring.taskManager.create.bind(wiring.taskManager);
    let blockedCreates = 0;
    let signalFirst!: () => void;
    let signalBoth!: () => void;
    let releaseCreates!: () => void;
    const firstCreateEntered = new Promise<void>((resolve) => {
      signalFirst = resolve;
    });
    const bothCreatesEntered = new Promise<void>((resolve) => {
      signalBoth = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseCreates = resolve;
    });
    wiring.taskManager.create = async (...args) => {
      if (args[0].id === output.taskId) {
        blockedCreates += 1;
        if (blockedCreates === 1) signalFirst();
        if (blockedCreates === 2) signalBoth();
        await released;
      }
      return originalCreate(...args);
    };

    const deciding = caller.action.decide({
      proposalId: assistant.proposal!.id,
      decision: "approve",
      chatThreadId: thread.id,
      chatTurnId: assistant.id,
    });
    await firstCreateEntered;
    const reloading = caller.chat.thread.get({
      organizationId: PILOT_ORGANIZATION,
      threadId: thread.id,
    });
    await bothCreatesEntered;
    releaseCreates();
    await Promise.all([deciding, reloading]);
    const tasks = await wiring.taskManager.list(PILOT_ORGANIZATION);
    assert.equal(tasks.filter((task) => task.id === output.taskId).length, 1);
  });
});

test("a deleted Chat thread cannot authorize its retained Task proposal", async () => {
  const local = new ChatModel(
    "local",
    () => JSON.stringify({
      kind: "create_task",
      text: "Review this independently durable Task.",
      title: "Preserve a deleted-thread decision",
      outcome: "The governed Task survives Chat deletion.",
      exitTest: "Approval succeeds without a Chat projection.",
    }),
  );
  await withChatWiring([local], async (wiring) => {
    const caller = makeCaller(wiring, 41);
    const { thread } = await caller.chat.thread.create({
      organizationId: PILOT_ORGANIZATION,
      plane: "local",
      clientRequestId: "deleted-decision-thread",
    });
    const proposed = await caller.chat.turn.send({
      organizationId: PILOT_ORGANIZATION,
      threadId: thread.id,
      clientRequestId: "deleted-decision-turn",
      message: "Create a Task whose proposal outlives this Chat.",
    });
    const assistant = proposed.turns.at(-1)!;
    const output = assistant.proposal!.proposedOutput as { taskId: string };
    await caller.chat.thread.delete({
      organizationId: PILOT_ORGANIZATION,
      threadId: thread.id,
    });

    await assert.rejects(
      caller.action.decide({
        proposalId: assistant.proposal!.id,
        decision: "approve",
        chatThreadId: thread.id,
        chatTurnId: assistant.id,
      }),
      /not bound to a genuine Chat turn/,
    );
    assert.equal(
      await wiring.taskManager.get(PILOT_ORGANIZATION, output.taskId),
      null,
    );
  });
});

test("a Human-authored task_create proposal cannot materialize a Chat Task", async () => {
  const local = new ChatModel(
    "local",
    () => JSON.stringify({ kind: "answer", text: "No Task needed." }),
  );
  await withChatWiring([local], async (wiring) => {
    const caller = makeCaller(wiring, 42);
    const { thread } = await caller.chat.thread.create({
      organizationId: PILOT_ORGANIZATION,
      plane: "local",
      clientRequestId: "forged-task-thread",
    });
    const sent = await caller.chat.turn.send({
      organizationId: PILOT_ORGANIZATION,
      threadId: thread.id,
      clientRequestId: "forged-task-turn",
      message: "Just answer.",
    });
    const assistant = sent.turns.at(-1)!;
    const taskId = "50000000-0000-4000-8000-000000000026";
    const forged = await caller.action.propose({
      organizationId: PILOT_ORGANIZATION,
      actor: { type: "user", id: PILOT_USER },
      onBehalfOf: { type: "user", id: PILOT_USER },
      action: "write",
      resourceType: "record",
      resourceId: taskId,
      dataScope: "private",
      inputs: {
        kind: "task_create",
        taskId,
        title: "Forged Chat Task",
        outcome: "A Human proposal impersonates Chat.",
        exitTest: "The Task must not exist.",
        visibility: "private",
        chatThreadId: thread.id,
        chatTurnId: assistant.id,
      },
      skill: "stageMutation",
    });
    await assert.rejects(
      caller.action.decide({
        proposalId: forged.id,
        decision: "approve",
        chatThreadId: thread.id,
        chatTurnId: assistant.id,
      }),
      /Chat Task proposal provenance is invalid/,
    );
    assert.equal(await wiring.taskManager.get(PILOT_ORGANIZATION, taskId), null);
  });
});

test("Chat retries the same failed assistant turn without duplicating the user request", async () => {
  let attempt = 0;
  const local = new ChatModel("local", () => {
    attempt += 1;
    if (attempt === 1) throw new Error("transient model failure");
    return JSON.stringify({ kind: "answer", text: "Recovered answer." });
  });
  await withChatWiring([local], async (wiring) => {
    const caller = makeCaller(wiring, 34);
    const { thread } = await caller.chat.thread.create({
      organizationId: PILOT_ORGANIZATION,
      plane: "local",
      clientRequestId: "retry-thread",
    });
    const request = {
      organizationId: PILOT_ORGANIZATION,
      threadId: thread.id,
      clientRequestId: "retry-request",
      message: "Retry this exact request.",
    };
    await assert.rejects(caller.chat.turn.send(request), /transient model failure/);
    const failed = await caller.chat.thread.get({
      organizationId: PILOT_ORGANIZATION,
      threadId: thread.id,
    });
    const failedAssistant = failed.turns.find((turn) => turn.role === "assistant");
    assert.equal(failedAssistant?.state, "failed");

    const retried = await caller.chat.turn.send({
      ...request,
      retryTurnId: failedAssistant!.id,
    });
    assert.equal(retried.turns.length, 2);
    assert.equal(
      retried.turns.filter((turn) => turn.role === "user").length,
      1,
    );
    assert.equal(retried.turns.at(-1)?.id, failedAssistant?.id);
    assert.equal(retried.turns.at(-1)?.content, "Recovered answer.");
    assert.equal(local.calls.length, 2);
  });
});

test("Chat retry resolves its deterministic user request beyond pagination and interleaving", async () => {
  let attempt = 0;
  const local = new ChatModel("local", () => {
    attempt += 1;
    if (attempt === 1) throw new Error("first attempt fails");
    return JSON.stringify({ kind: "answer", text: "Old retry recovered." });
  });
  await withChatWiring([local], async (wiring) => {
    const caller = makeCaller(wiring, 42);
    const { thread } = await caller.chat.thread.create({
      organizationId: PILOT_ORGANIZATION,
      plane: "local",
      clientRequestId: "old-retry-thread",
    });
    const request = {
      organizationId: PILOT_ORGANIZATION,
      threadId: thread.id,
      clientRequestId: "old-retry-request",
      message: "Recover this exact old request.",
    };
    await assert.rejects(caller.chat.turn.send(request), /first attempt fails/);
    const failed = await caller.chat.thread.get({
      organizationId: PILOT_ORGANIZATION,
      threadId: thread.id,
    });
    const failedAssistant = failed.turns.find((turn) => turn.role === "assistant")!;
    assert.equal(failedAssistant.retryRequest?.content, request.message);
    const scope = {
      organizationId: PILOT_ORGANIZATION,
      ownerUserId: PILOT_USER,
    };
    const taintLabel = failed.turns.find((turn) => turn.role === "user")!.taintLabel;
    for (let index = 1; index <= 101; index += 1) {
      await wiring.chatStore.appendTurn(scope, {
        id: `40000000-0000-4000-8000-${String(index + 500).padStart(12, "0")}`,
        threadId: thread.id,
        role: index === 1 ? "user" : "assistant",
        actorType: index === 1 ? "human" : "agent",
        actorId: index === 1 ? PILOT_USER : "chief-of-staff",
        content: `Interleaved turn ${index}`,
        state: "completed",
        clientRequestId: `interleaved-${index}`,
        taintLabel,
      });
    }

    const retried = await caller.chat.turn.send({
      ...request,
      retryTurnId: failedAssistant.id,
    });
    assert.equal(retried.turns.at(-1)?.id, failedAssistant.id);
    assert.equal(retried.turns.at(-1)?.content, "Old retry recovered.");
  });
});

test("Chat thread reads return the latest turns and page backward without gaps", async () => {
  await withChatWiring([new EchoModelProvider()], async (wiring) => {
    const store = new InMemoryChatStore();
    (wiring as { chatStore: ChatStore }).chatStore = store;
    const scope = {
      organizationId: PILOT_ORGANIZATION,
      ownerUserId: PILOT_USER,
    };
    const thread = await store.createThread(scope, {
      id: "30000000-0000-4000-8000-000000000240",
      plane: "local",
      dataScope: "private",
    });
    const taintLabel = createTaintLabel({
      trust: "authenticated_human",
      source: "human",
      sensitivity: "private",
      instructionRisk: "data",
      origin: {
        source: "human",
        ref: "chat-pagination-test",
        hash: "pagination",
        transform: "captured",
      },
    });
    for (let index = 1; index <= 105; index += 1) {
      await store.appendTurn(scope, {
        id: `40000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        threadId: thread.id,
        role: "assistant",
        actorType: "agent",
        actorId: "chief-of-staff",
        content: `Turn ${index}`,
        state: "completed",
        clientRequestId: `pagination-${index}`,
        taintLabel,
      });
    }
    const caller = makeCaller(wiring, 35);
    const latest = await caller.chat.thread.get({
      organizationId: PILOT_ORGANIZATION,
      threadId: thread.id,
    });
    assert.equal(latest.turns.length, 100);
    assert.equal(latest.turns[0]?.content, "Turn 6");
    assert.equal(latest.turns.at(-1)?.content, "Turn 105");
    assert.deepEqual(latest.nextCursor, { sequence: 6 });

    const older = await caller.chat.thread.get({
      organizationId: PILOT_ORGANIZATION,
      threadId: thread.id,
      cursor: latest.nextCursor!,
    });
    assert.deepEqual(
      older.turns.map((turn) => turn.content),
      ["Turn 1", "Turn 2", "Turn 3", "Turn 4", "Turn 5"],
    );
    assert.equal(older.nextCursor, null);
  });
});

test("Chat cancellation aborts inference and persists a cancelled terminal turn", async () => {
  let started!: () => void;
  const inferenceStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const local = new ChatModel("local", () => {
    throw new Error("unreachable");
  });
  local.complete = async (request: ModelCompletionRequest) => {
    local.calls.push(request);
    started();
    await new Promise<never>((_resolve, reject) => {
      request.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("cancelled", "AbortError")),
        { once: true },
      );
    });
    throw new Error("unreachable");
  };

  await withChatWiring([local], async (wiring) => {
    const caller = makeCaller(wiring, 29);
    const { thread } = await caller.chat.thread.create({
      organizationId: PILOT_ORGANIZATION,
      plane: "local",
      clientRequestId: "cancel",
    });
    const sending = caller.chat.turn.send({
      organizationId: PILOT_ORGANIZATION,
      threadId: thread.id,
      clientRequestId: "cancel-turn",
      message: "Stop this work.",
    });
    await inferenceStarted;
    const processing = await caller.chat.thread.get({
      organizationId: PILOT_ORGANIZATION,
      threadId: thread.id,
    });
    const assistant = processing.turns.find((turn) => turn.role === "assistant");
    assert.equal(assistant?.state, "processing");

    const cancelled = await caller.chat.turn.cancel({
      organizationId: PILOT_ORGANIZATION,
      threadId: thread.id,
      turnId: assistant!.id,
    });
    assert.equal(cancelled.turns.at(-1)?.state, "cancelled");
    assert.equal((await sending).turns.at(-1)?.state, "cancelled");
  });
});
