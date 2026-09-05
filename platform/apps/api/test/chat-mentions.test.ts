/**
 * `@` mentions in Chat (2026-09-05): Chief of Staff stays the one user-facing
 * Agent; typing `@` addresses another. The addressed Agent is recorded on the
 * assistant turn as a ref, the picker reads the Organization's ACTIVE Agents,
 * and an id that is not one of them is refused before anything is written.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelCompletionRequest, ModelProvider, ModelTier } from "@bridge/core";
import { InMemorySourceCredentialVault } from "@bridge/dealpilot";
import {
  CHIEF_OF_STAFF_AGENT_RUNTIME_ID,
  LEARNING_AGENT_RUNTIME_ID,
} from "@bridge/module-manifests";

import { buildWiring, PILOT_ORGANIZATION, type Wiring } from "../src/wiring.js";
import { makeCaller } from "./caller.js";

class AnswerModel implements ModelProvider {
  readonly id = "chat-mentions-local";
  readonly plane = "local" as const;
  readonly tiers = ["cheap", "default"] as const satisfies readonly ModelTier[];
  readonly models = { cheap: "v1", default: "v1" };
  routingHealth() {
    return "healthy" as const;
  }
  async complete(request: ModelCompletionRequest) {
    return {
      text: JSON.stringify({ kind: "answer", text: "answered" }),
      model: "v1",
      tier: request.tier,
      usage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, source: "provider" as const },
      ...(request.taintLabel ? { taintLabel: request.taintLabel } : {}),
    };
  }
}

async function withWiring<T>(operation: (wiring: Wiring) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "bridge-chat-mentions-"));
  const wiring = await buildWiring({
    localDir: join(root, "local"),
    moduleFilesBridgeRoot: join(root, "files"),
    modelProviders: [new AnswerModel()],
    dealPilotCredentialVault: new InMemorySourceCredentialVault(),
  });
  try {
    return await operation(wiring);
  } finally {
    await wiring.close();
    await rm(root, { recursive: true, force: true });
  }
}

test("the @ picker lists the Organization's active Agents, and never Chief of Staff", async () => {
  await withWiring(async (wiring) => {
    const caller = makeCaller(wiring);
    const agents = await caller.chat.agents.list({ organizationId: PILOT_ORGANIZATION });
    const learning = agents.find((agent: { id: string }) => agent.id === LEARNING_AGENT_RUNTIME_ID);
    assert.ok(learning, "the Learning Agent is addressable");
    assert.equal(learning.name, "Learning Agent");
    assert.ok(learning.role.length > 0, "each Agent carries a one-line role");
    assert.ok(
      !agents.some((agent: { id: string }) => agent.id === CHIEF_OF_STAFF_AGENT_RUNTIME_ID),
      "Chief of Staff is who you are already talking to",
    );
    // A read, not a registry: every row is an ACTIVE Agent of this Organization.
    for (const agent of agents) {
      assert.equal(await wiring.agents.organizationId(agent.id), PILOT_ORGANIZATION);
      assert.equal(await wiring.agents.isActive(agent.id), true);
    }
  });
});

test("turn.send records the addressed Agent on the turn and refuses a stranger", async () => {
  await withWiring(async (wiring) => {
    const caller = makeCaller(wiring);
    const created = await caller.chat.thread.create({
      organizationId: PILOT_ORGANIZATION,
      clientRequestId: "mention-thread",
    });

    const sent = await caller.chat.turn.send({
      organizationId: PILOT_ORGANIZATION,
      threadId: created.thread.id,
      message: "@Learning Agent what do we know about Acme?",
      clientRequestId: "mention-1",
      mentions: [LEARNING_AGENT_RUNTIME_ID],
    });
    const assistant = sent.turns.filter((turn: { role: string }) => turn.role === "assistant").at(-1);
    assert.equal(assistant?.state, "completed");
    const addressed = assistant?.refs.filter((ref: { kind: string }) => ref.kind === "addressed_agent");
    assert.deepEqual(
      addressed?.map((ref: { refId: string }) => ref.refId),
      [LEARNING_AGENT_RUNTIME_ID],
      "the turn says which Agent was addressed",
    );

    const before = (await caller.chat.thread.get({
      organizationId: PILOT_ORGANIZATION,
      threadId: created.thread.id,
    })).turns.length;
    await assert.rejects(
      caller.chat.turn.send({
        organizationId: PILOT_ORGANIZATION,
        threadId: created.thread.id,
        message: "@Nobody hello",
        clientRequestId: "mention-2",
        mentions: ["00000000-0000-4000-a000-000000000000"],
      }),
      /not an active Agent of this Organization/,
    );
    const after = (await caller.chat.thread.get({
      organizationId: PILOT_ORGANIZATION,
      threadId: created.thread.id,
    })).turns.length;
    assert.equal(after, before, "a refused mention writes no turn");
  });
});
