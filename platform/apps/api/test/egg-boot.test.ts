/**
 * A bare Egg boots (ADR 2026-09-04 "The Egg ships the kernel; Modules live in
 * Commons") and its primary Agents work: the five foundational Agents are
 * active, chat answers through the Chief of Staff's model, a Research Run
 * starts under the Learning Agent, and the Builder makes a NEW Module from a
 * user request — module.yaml written, registered, installed, and its Records
 * served to the standard Module Page. No Commons Module is anywhere in it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ModelCompletionRequest,
  type ModelProvider,
  type ModelTier,
} from "@bridge/core";
import {
  BUILDER_AGENT_RUNTIME_ID,
  CHIEF_OF_STAFF_AGENT_RUNTIME_ID,
  GOVERNANCE_AGENT_RUNTIME_ID,
  INTERNAL_STRATEGIST_AGENT_RUNTIME_ID,
  LEARNING_AGENT_RUNTIME_ID,
} from "@bridge/module-manifests";
import { InMemorySourceCredentialVault } from "@bridge/dealpilot";

import { buildWiring, PILOT_ORGANIZATION, type Wiring } from "../src/wiring.js";
import { makeCaller } from "./caller.js";
import { approveInstall } from "./module-records.test.js";

const NEW_MODULE = "invoice-tracker";

const MODULE_YAML = `module:
  name: ${NEW_MODULE}
  version: 0.1.0
  kind: organization_definition
  summary: Client invoices and their status
  description: Built by the Builder from a user request
  dependencies: []
  capabilities:
    - id: ${NEW_MODULE}.invoices
      capability_type: database
      version: 0.1.0
      permissions:
        - { resource_type: record, action: read, data_scope: private, egress: false }
        - { resource_type: record, action: write, data_scope: private, egress: false }
      connectors: []
  module:
    displayName: Invoice Tracker
    route: /module/${NEW_MODULE}
    databases:
      - id: invoices
        name: Invoices
        columns:
          - { id: client, label: Client, kind: text, required: true }
          - { id: amount, label: Amount, kind: number }
          - { id: status, label: Status, kind: select, options: [draft, sent, paid] }
    pages:
      - { id: invoices, name: Invoices, route: /module/${NEW_MODULE}/invoices, database_id: invoices, capability_id: ${NEW_MODULE}.invoices }
    agents: []
    automations: []
`;

/** One model for the whole Egg: chat answers with prose, the Builder gets a
 * scripted JSON action per call. Which one is asked for is decided by the
 * prompt, the way a real model would see it. */
class EggModel implements ModelProvider {
  readonly id = "egg-test-local";
  readonly plane = "local" as const;
  readonly tiers = ["cheap", "default", "reasoning"] as const satisfies readonly ModelTier[];
  readonly models = { cheap: "egg-test-v1", default: "egg-test-v1", reasoning: "egg-test-v1" };
  #builderStep = 0;
  readonly builderScript: readonly unknown[] = [
    { kind: "write", path: "module.yaml", content: MODULE_YAML, why: "step 1: the manifest" },
    { kind: "finish", summary: "wrote module.yaml with one Database and one Page", why: "done" },
  ];

  routingHealth() {
    return "healthy" as const;
  }

  async complete(request: ModelCompletionRequest) {
    const builder = request.system?.includes("Builder Agent") ?? false;
    const text = builder
      ? JSON.stringify(
          this.builderScript[this.#builderStep++] ?? { kind: "finish", summary: "out of script", why: "" },
        )
      : JSON.stringify({ kind: "answer", text: "A direct answer from the Egg." });
    return {
      text,
      model: "egg-test-v1",
      tier: request.tier,
      usage: {
        inputTokens: 7,
        outputTokens: 3,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        source: "provider" as const,
      },
    };
  }
}

async function withEgg<T>(operation: (wiring: Wiring) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "bridge-egg-boot-"));
  const wiring = await buildWiring({
    profile: "egg",
    localDir: join(root, "local"),
    moduleFilesBridgeRoot: join(root, "files"),
    modelProviders: [new EggModel()],
    dealPilotCredentialVault: new InMemorySourceCredentialVault(),
  });
  try {
    return await operation(wiring);
  } finally {
    await wiring.close();
    await rm(root, { recursive: true, force: true });
  }
}

test("the Egg boots with Task Manager alone and its five primary Agents active", async () => {
  await withEgg(async (wiring) => {
    assert.equal(wiring.profile, "egg");
    const caller = makeCaller(wiring);
    const modules = await caller.modules.list({ organizationId: PILOT_ORGANIZATION, limit: 100, offset: 0 });
    const installed = modules.items
      .filter((item) => item.state === "available" && item.status === "installed")
      .map((item) => item.moduleName);
    assert.deepEqual(installed, ["task-manager"]);

    for (const [name, id] of [
      ["Chief of Staff", CHIEF_OF_STAFF_AGENT_RUNTIME_ID],
      ["Internal Strategist", INTERNAL_STRATEGIST_AGENT_RUNTIME_ID],
      ["Learning Agent", LEARNING_AGENT_RUNTIME_ID],
      ["Governance Agent", GOVERNANCE_AGENT_RUNTIME_ID],
      ["Capability Builder", BUILDER_AGENT_RUNTIME_ID],
    ] as const) {
      assert.equal(await wiring.agents.isActive(id), true, `${name} must be active in the Egg`);
      assert.equal(await wiring.agents.organizationId(id), PILOT_ORGANIZATION, `${name} belongs to the pilot Organization`);
    }
  });
});

test("chat and a Research Run work in the Egg without any Commons Module", async () => {
  await withEgg(async (wiring) => {
    const caller = makeCaller(wiring);
    const { thread } = await caller.chat.thread.create({
      organizationId: PILOT_ORGANIZATION,
      plane: "local",
      clientRequestId: "egg-default",
    });
    const view = await caller.chat.turn.send({
      organizationId: PILOT_ORGANIZATION,
      threadId: thread.id,
      clientRequestId: "egg-turn",
      message: "What can you do?",
      surface: { kind: "chat_panel" },
    });
    const reply = view.turns[view.turns.length - 1];
    assert.equal(reply?.state, "completed");
    assert.equal(reply?.content, "A direct answer from the Egg.");

    const run = await caller.agentOrchestration.research.start({
      organizationId: PILOT_ORGANIZATION,
      objective: "What do small firms use to track invoices?",
    });
    assert.equal(run.status, "running");
    assert.ok(run.goalId && run.taskId, "a Research Run is a Task of the Learning Agent");

    // The Skill binding the Egg's Research Agent runs under — Task Manager's,
    // since no Relationship Module exists here. Web egress itself is not
    // exercised (no search provider in a test), only that the gate before it
    // accepts the Egg's owner.
    await assert.rejects(
      caller.agentOrchestration.skill.webResearch({
        organizationId: PILOT_ORGANIZATION,
        objective: "invoice software",
        scope: "public_web",
        searchQueries: ["invoice tracking software"],
        budget: { maxResults: 3, maxResponseBytes: 64 * 1024, maxProviderAttempts: 1, timeoutMs: 2_000 },
      }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.doesNotMatch(message, /does not bind web-research|No installed Module binds/);
        return true;
      },
    );
  });
});

test("asking the Builder for a Module in the Egg yields an installed Module whose Page has Records", async () => {
  await withEgg(async (wiring) => {
    const caller = makeCaller(wiring);
    const receipt = await caller.builder.run({
      organizationId: PILOT_ORGANIZATION,
      moduleName: NEW_MODULE,
      task: "Build a Module that tracks client invoices and whether they are paid",
    });
    assert.equal(receipt.stopReason, "finished");
    assert.deepEqual(
      receipt.actions.map((entry) => [entry.token, entry.decision, entry.status]),
      [["file:write", "execute", "ok"]],
    );
    assert.equal(receipt.registration.state, "registered");
    if (receipt.registration.state !== "registered") return;
    assert.equal(receipt.registration.status, "pending_review");

    // Install is the governed proposal; a private-only, no-egress Module is
    // informational and lands on the same path every Module takes.
    await approveInstall(caller, receipt.registration.installationId);

    const listed = await caller.modules.list({ organizationId: PILOT_ORGANIZATION, limit: 100, offset: 0 });
    const mine = listed.items.find((item) => item.moduleName === NEW_MODULE);
    assert.equal(mine?.manifest.module?.pages[0]?.id, "invoices");

    const target = { organizationId: PILOT_ORGANIZATION, moduleName: NEW_MODULE, databaseId: "invoices" };
    const definition = await caller.moduleRecords.definition({ ...target });
    assert.deepEqual(definition.spec.columns.map((column) => column.id), ["client", "amount", "status"]);
    const row = await caller.moduleRecords.insert({ ...target, fields: { client: "Acme", amount: 900, status: "sent" } });
    assert.equal((await caller.moduleRecords.list({ ...target })).items[0]?.id, row.id);

    // A second Run against the same Module is an edit, not a re-creation.
    const again = await caller.builder.run({
      organizationId: PILOT_ORGANIZATION,
      moduleName: NEW_MODULE,
      task: "Add a due date column",
    });
    assert.equal(again.registration.state, "existing");
  });
});
