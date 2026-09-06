/**
 * The agentic chat backend, end to end through the real router: a thread bound
 * to a ChatBackend routes its turns to that backend instead of a ModelProvider,
 * keeps the same governed turn lifecycle, and carries the backend's own session
 * handle forward so context survives.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SeededRng,
  SystemClock,
  UuidGen,
  type ChatBackend,
  type ChatBackendSendArgs,
  type ModelCompletionRequest,
  type ModelProvider,
  type ModelTier,
  type RunCtx,
} from "@bridge/core";
import { InMemorySourceCredentialVault } from "@bridge/dealpilot";

import { appRouter } from "../src/router.js";
import { MANIFEST_REPAIR_ROUNDS, MODULE_BUILD_PROCESS, MODULE_DISCOVERY_STEPS, MODULE_STRUCTURE_RULES, PLAIN_LANGUAGE_RULES } from "../src/builder/run.js";
import { buildWiring, PILOT_ORGANIZATION, PILOT_USER, type Wiring } from "../src/wiring.js";
import { makeCaller } from "./caller.js";
import { stableModuleInstallProposalId } from "../src/router-shared.js";

/** Stands in for Claude Code: records what it was asked, returns prose and a
 * session handle, and never sees Bridge's assistant envelope. */
class StubAgenticBackend implements ChatBackend {
  readonly id = "claude_code" as const;
  readonly label = "Claude Code";
  readonly plane = "cloud" as const;
  readonly agentic = true;
  readonly calls: ChatBackendSendArgs[] = [];
  #turn = 0;

  async readiness() {
    return { ready: true };
  }

  async send(args: ChatBackendSendArgs) {
    this.calls.push(args);
    this.#turn += 1;
    return {
      reply: `did the work (turn ${this.#turn})`,
      backendSessionId: "sdk-session-1",
      changedPaths: ["TaskManager/notes.md"],
    };
  }
}

/** A minimal local ModelProvider so the "bridge" half of a switch can answer. */
class ChatModel implements ModelProvider {
  readonly id: string;
  readonly plane: "local" | "cloud";
  readonly tiers = ["cheap", "default"] as const satisfies readonly ModelTier[];
  readonly models: Readonly<Partial<Record<ModelTier, string>>>;

  constructor(
    plane: "local" | "cloud",
    private readonly reply: (request: ModelCompletionRequest) => string,
  ) {
    this.id = `chat-test-${plane}`;
    this.plane = plane;
    this.models = { cheap: `${this.id}-v1`, default: `${this.id}-v1` };
  }

  routingHealth() {
    return "healthy" as const;
  }

  async complete(request: ModelCompletionRequest) {
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

async function withBackendWiring<T>(
  backends: readonly ChatBackend[],
  operation: (wiring: Wiring) => Promise<T>,
  modelProviders: readonly ModelProvider[] = [],
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "bridge-chat-backend-"));
  const wiring = await buildWiring({
    localDir: join(root, "local"),
    moduleFilesBridgeRoot: join(root, "files"),
    modelProviders,
    chatBackends: backends,
    dealPilotCredentialVault: new InMemorySourceCredentialVault(),
  });
  try {
    return await operation(wiring);
  } finally {
    await wiring.close();
    await rm(root, { recursive: true, force: true });
  }
}

test("a Claude Code thread answers through the backend, not a ModelProvider", async () => {
  const backend = new StubAgenticBackend();
  await withBackendWiring([backend], async (wiring) => {
    const caller = makeCaller(wiring);

    const status = await caller.chat.model.status({ organizationId: PILOT_ORGANIZATION });
    assert.deepEqual(
      status.backends.map((entry) => [entry.id, entry.agentic, entry.ready]),
      [["claude_code", true, true]],
    );

    const created = await caller.chat.thread.create({
      organizationId: PILOT_ORGANIZATION,
      backend: "claude_code",
      clientRequestId: "agentic-1",
    });
    assert.equal(created.thread.backend, "claude_code");
    // The backend declares cloud residency, so the thread follows it even
    // though no plane was requested — this is the assertion that stops cloud
    // egress being filed under a Local Plane thread.
    assert.equal(created.thread.plane, "cloud");
    assert.equal(created.thread.dataScope, "public");

    const sent = await caller.chat.turn.send({
      organizationId: PILOT_ORGANIZATION,
      threadId: created.thread.id,
      message: "add a column to the tasks table",
      clientRequestId: "turn-1",
    });

    const assistant = sent.turns.filter((turn: { role: string }) => turn.role === "assistant").at(-1);
    assert.equal(assistant?.state, "completed");
    assert.equal(assistant?.content, "did the work (turn 1)");
    // No cloud grant was required: there was no exact context for Bridge to
    // disclose, because the backend chose its own.
    assert.equal(backend.calls.length, 1);
    assert.equal(backend.calls[0]?.organizationId, PILOT_ORGANIZATION);
    assert.equal(backend.calls[0]?.backendSessionId, null);
    assert.ok(backend.calls[0]?.workingDirectory.length > 0);

    // The governed shape survives: the turn still carries a routing decision.
    assert.ok(assistant?.refs.some((ref: { kind: string }) => ref.kind === "routing_decision"));
    // …and the files the backend edited are a REF on the turn, not prose the
    // model happened to mention. A write with no receipt is not reviewable.
    const changedRef = assistant?.refs.find((ref: { kind: string }) => ref.kind === "result");
    assert.ok(changedRef, "the changed-files receipt is missing from the turn");
    const changedRow = await wiring.ledger.get(changedRef.refId);
    assert.deepEqual(
      (changedRow?.proposedOutput as { changedPaths?: string[] } | null)?.changedPaths,
      ["TaskManager/notes.md"],
    );

    // Second turn resumes the backend's own session.
    await caller.chat.turn.send({
      organizationId: PILOT_ORGANIZATION,
      threadId: created.thread.id,
      message: "now write the migration",
      clientRequestId: "turn-2",
    });
    assert.equal(backend.calls[1]?.backendSessionId, "sdk-session-1");
  });
});

test("selecting a backend this deployment did not wire fails loudly at create", async () => {
  await withBackendWiring([], async (wiring) => {
    const caller = makeCaller(wiring);
    const status = await caller.chat.model.status({ organizationId: PILOT_ORGANIZATION });
    assert.deepEqual(status.backends, []);
    await assert.rejects(
      caller.chat.thread.create({
        organizationId: PILOT_ORGANIZATION,
        backend: "claude_code",
        clientRequestId: "agentic-missing",
      }),
      /not available in this deployment/,
    );
  });
});

test("a bridge thread is unaffected and keeps its own backend value", async () => {
  await withBackendWiring([new StubAgenticBackend()], async (wiring) => {
    const caller = makeCaller(wiring);
    const created = await caller.chat.thread.create({
      organizationId: PILOT_ORGANIZATION,
      clientRequestId: "plain-1",
    });
    assert.equal(created.thread.backend, "bridge");
    assert.equal(created.thread.plane, "local");
  });
});

test("switching the model keeps the conversation and hands the new engine what was said", async () => {
  const backend = new StubAgenticBackend();
  const local = new ChatModel("local", () =>
    JSON.stringify({ kind: "answer", text: "the local model answered" }),
  );
  await withBackendWiring([backend], async (wiring) => {
    const caller = makeCaller(wiring);
    const created = await caller.chat.thread.create({
      organizationId: PILOT_ORGANIZATION,
      clientRequestId: "switch-1",
    });
    assert.equal(created.thread.backend, "bridge");

    await caller.chat.turn.send({
      organizationId: PILOT_ORGANIZATION,
      threadId: created.thread.id,
      message: "remember the number 41",
      clientRequestId: "switch-turn-1",
    });

    const switched = await caller.chat.thread.setBackend({
      organizationId: PILOT_ORGANIZATION,
      threadId: created.thread.id,
      backend: "claude_code",
    });

    // The whole point: same thread, same turns, new engine.
    assert.equal(switched.thread.id, created.thread.id);
    assert.equal(switched.thread.backend, "claude_code");
    assert.equal(switched.thread.plane, "cloud");
    assert.ok(switched.turns.length >= 2, "the conversation survived the switch");
    assert.ok(
      switched.turns.some((turn: { content: string }) =>
        turn.content.includes("remember the number 41"),
      ),
    );

    await caller.chat.turn.send({
      organizationId: PILOT_ORGANIZATION,
      threadId: created.thread.id,
      message: "what number?",
      clientRequestId: "switch-turn-2",
    });

    // Bridge carried the earlier turns to the engine that was not there for them.
    const carried = backend.calls[0]?.text ?? "";
    assert.match(carried, /Earlier in this conversation/);
    assert.match(carried, /remember the number 41/);
    assert.match(carried, /what number\?/);
  }, [local]);
});

test("a Module reopens its own conversation instead of a blank one", async () => {
  await withBackendWiring([new StubAgenticBackend()], async (wiring) => {
    const caller = makeCaller(wiring);
    const first = await caller.chat.thread.forModule({
      organizationId: PILOT_ORGANIZATION,
      moduleName: "task-manager",
    });
    assert.equal(first.thread.moduleName, "task-manager");

    const again = await caller.chat.thread.forModule({
      organizationId: PILOT_ORGANIZATION,
      moduleName: "task-manager",
    });
    assert.equal(again.thread.id, first.thread.id, "the Module resumed its live thread");

    const other = await caller.chat.thread.forModule({
      organizationId: PILOT_ORGANIZATION,
      moduleName: "dealpilot",
    });
    assert.notEqual(other.thread.id, first.thread.id, "a different Module gets its own thread");

    // One session, several Modules.
    const attached = await caller.chat.thread.attachModule({
      organizationId: PILOT_ORGANIZATION,
      threadId: first.thread.id,
      moduleName: "dealpilot",
    });
    assert.deepEqual(attached.thread.attachedModules, ["dealpilot"]);
    const idempotent = await caller.chat.thread.attachModule({
      organizationId: PILOT_ORGANIZATION,
      threadId: first.thread.id,
      moduleName: "dealpilot",
    });
    assert.deepEqual(idempotent.thread.attachedModules, ["dealpilot"]);
  });
});

/** The stub as a Builder: writes a module.yaml where Bridge told it the
 * Organization folder is, and reports the path the way Claude Code does. */
class ModuleWritingBackend extends StubAgenticBackend {
  override async send(args: ChatBackendSendArgs) {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const folder = join(args.workingDirectory, "academics-manager");
    await mkdir(folder, { recursive: true });
    const path = join(folder, "module.yaml");
    await writeFile(
      path,
      [
        "module:",
        "  name: academics-manager",
        "  version: 0.1.0",
        "  kind: organization_definition",
        "  summary: Courses, assignments, and grades",
        "  description: Built from the user's request in chat",
        "  dependencies: []",
        "  capabilities:",
        "    - id: academics-manager.assignments",
        "      capability_type: database",
        "      version: 0.1.0",
        "      permissions:",
        "        - { resource_type: record, action: read, data_scope: private, egress: false }",
        "        - { resource_type: record, action: write, data_scope: private, egress: false }",
        "      connectors: []",
        "  module:",
        "    displayName: Academics",
        "    route: /module/academics-manager",
        "    databases:",
        "      - id: assignments",
        "        name: Assignments",
        "        columns:",
        "          - { id: course, label: Course, kind: text, required: true }",
        "          - { id: due, label: Due, kind: date }",
        "    pages:",
        "      - { id: assignments, name: Assignments, route: /module/academics-manager/assignments, database_id: assignments, capability_id: academics-manager.assignments }",
        "    agents: []",
        "    automations: []",
        "",
      ].join("\n"),
    );
    this.calls.push(args);
    return { reply: "Created the Academics Module.", backendSessionId: "sdk-session-2", changedPaths: [path] };
  }
}

test("the agentic backend is briefed on what a Module is, and a module.yaml it writes is registered (TASK-098)", async () => {
  const backend = new ModuleWritingBackend();
  await withBackendWiring([backend], async (wiring) => {
    const caller = makeCaller(wiring);
    const created = await caller.chat.thread.create({
      organizationId: PILOT_ORGANIZATION,
      backend: "claude_code",
      plane: "cloud",
      clientRequestId: "briefed",
    });
    const view = await caller.chat.turn.send({
      organizationId: PILOT_ORGANIZATION,
      threadId: created.thread.id,
      clientRequestId: "briefed-turn",
      message: "Can you build me a new module for managing my academics",
      surface: { kind: "chat_panel" },
    });

    // The briefing rides in the backend's system prompt: the definition of a
    // Module, the standard build process, and the folder it may write in.
    const system = backend.calls[0]?.system ?? "";
    assert.match(system, /A Module is a folder/);
    assert.match(system, /module\.yaml/);
    assert.match(system, /do not ask what a Module is/);
    assert.ok(system.includes(backend.calls[0]!.workingDirectory), "the briefing names the Organization folder");
    // The Rulebook's mapping rules ride in the same briefing (TASK-100): the
    // structure a requirement maps onto, stated as the Rulebook states them.
    for (const rule of MODULE_STRUCTURE_RULES) {
      assert.ok(system.includes(rule), `the briefing carries the mapping rule: ${rule.slice(0, 60)}`);
    }
    assert.match(system, /shares the Module's primary Record/);
    assert.match(system, /its own toolbar, Lists and Files/);
    assert.match(system, /sub_modules/);
    assert.match(system, /sections/);
    assert.match(system, /never a Page/);
    // Discovery rides before any write (2026-09-05): the Commons Academics
    // Module is named as prior art even with no registry running (the built-in
    // catalogue answers), the Integrations Bridge can connect today are listed
    // by name, and the agent is told to ask about software before designing.
    for (const step of MODULE_DISCOVERY_STEPS) {
      assert.ok(system.includes(step), `the briefing carries the discovery step: ${step.slice(0, 60)}`);
    }
    assert.match(system, /academics@0\.2\.0 \(organization_definition\)/, "the Commons Academics Module is named as prior art");
    assert.match(system, /OFFER installing/);
    assert.match(system, /Integrations Bridge can connect today/);
    assert.match(system, /google-calendar/);
    assert.match(system, /github/);
    assert.match(system, /ASK which of them .* before designing/);
    assert.match(system, /Study Steward \(agent; read, write\)/, "prior-art Agents ride with their governance");
    assert.match(system, /in ONE message/);

    // What the agent wrote is a pending Module now, and the reply says so.
    const assistant = view.turns[view.turns.length - 1];
    assert.match(assistant?.content ?? "", /Built and installed "Academics" — it is in your sidebar now\./);
    assert.doesNotMatch(assistant?.content ?? "", /install it from Modules|Registered the Module/);
    const modules = await caller.modules.list({ organizationId: PILOT_ORGANIZATION, limit: 100, offset: 0 });
    const mine = modules.items.find((item) => item.moduleName === "academics-manager");
    assert.equal(mine?.status, "installed");
    assert.equal(mine?.manifest.module?.databases?.[0]?.id, "assignments");
    assert.equal(mine?.state, "available", "installed AND available, or the sidebar never shows it");

    // The next turn is briefed on what already exists, as data (ADR-247): the
    // Module the last turn registered, with its Database column ids, and a
    // plain folder of files the user keeps beside it, named as NOT a Module.
    const { mkdir, writeFile } = await import("node:fs/promises");
    const plain = join(backend.calls[0]!.workingDirectory, "JobManager");
    await mkdir(plain, { recursive: true });
    await writeFile(join(plain, "resume.pdf"), "not a Module");
    await caller.chat.turn.send({
      organizationId: PILOT_ORGANIZATION,
      threadId: created.thread.id,
      clientRequestId: "briefed-turn-2",
      message: "Now add a grades Page",
      surface: { kind: "chat_panel" },
    });
    const second = backend.calls[1]?.system ?? "";
    assert.match(second, /academics-manager \(Academics, installed\)/, "the registered Module is listed with status");
    assert.match(second, /Database assignments: columns course:text, due:date/, "its Database columns ride as data");
    assert.match(second, /JobManager: plain folder of files, no Module/, "the plain folder is named as not a Module");
    assert.match(second, /academics-manager: Module \(module\.yaml\)/, "the Module folder is named as a Module");
    assert.doesNotMatch(second, /resume\.pdf/, "file names inside a plain folder never ride along");
  });
});

test("discovery precedes every write step in the standard Module build process (2026-09-05)", () => {
  assert.ok(MODULE_DISCOVERY_STEPS.length >= 5, "restate, prior art, software, Skills/Automations, structure");
  const lastDiscovery = MODULE_BUILD_PROCESS.indexOf(MODULE_DISCOVERY_STEPS[MODULE_DISCOVERY_STEPS.length - 1]!);
  const firstWrite = MODULE_BUILD_PROCESS.indexOf("1. Read the Module folder");
  assert.ok(lastDiscovery >= 0, "the process carries the discovery steps");
  assert.ok(firstWrite >= 0, "the process carries the write steps");
  assert.ok(lastDiscovery < firstWrite, "discovery comes before writing");
  // The structure mapping is a discovery step too, and it sits AFTER the questions.
  const structure = MODULE_BUILD_PROCESS.indexOf(MODULE_STRUCTURE_RULES[0]!);
  assert.ok(lastDiscovery < structure && structure < firstWrite, "structure rules sit between discovery and writing");
});

/**
 * Writes a relation column the way the live Builder did on 2026-09-05
 * (`options: { database_id }`), which Bridge rejects ("options must be an
 * array of strings"); fixes it only when Bridge hands the rejection back.
 */
class RepairingBackend implements ChatBackend {
  readonly id = "claude_code" as const;
  readonly label = "Claude Code";
  readonly plane = "cloud" as const;
  readonly agentic = true;
  readonly calls: ChatBackendSendArgs[] = [];

  constructor(private readonly fixes: boolean) {}

  async readiness() {
    return { ready: true };
  }

  async send(args: ChatBackendSendArgs) {
    this.calls.push(args);
    const repair = /Bridge rejected academics-manager\/module\.yaml/.test(args.text);
    const folder = join(args.workingDirectory, "academics-manager");
    await mkdir(folder, { recursive: true });
    const path = join(folder, "module.yaml");
    const course =
      repair && this.fixes
        ? ["          - { id: course, label: Course, kind: relation, relation_target: courses }"]
        : ["          - id: course", "            label: Course", "            kind: relation", "            options:", "              database_id: courses"];
    await writeFile(
      path,
      [
        "module:",
        "  name: academics-manager",
        "  version: 0.1.0",
        "  kind: organization_definition",
        "  summary: Courses and assignments",
        "  description: Built from the user's request in chat",
        "  dependencies: []",
        "  capabilities:",
        "    - id: academics-manager.courses",
        "      capability_type: database",
        "      version: 0.1.0",
        "      permissions:",
        "        - { resource_type: record, action: read, data_scope: private, egress: false }",
        "        - { resource_type: record, action: write, data_scope: private, egress: false }",
        "      connectors: []",
        "    - id: academics-manager.assignments",
        "      capability_type: database",
        "      version: 0.1.0",
        "      permissions:",
        "        - { resource_type: record, action: read, data_scope: private, egress: false }",
        "        - { resource_type: record, action: write, data_scope: private, egress: false }",
        "      connectors: []",
        "  module:",
        "    displayName: Academics",
        "    route: /module/academics-manager",
        "    databases:",
        "      - id: courses",
        "        name: Courses",
        "        columns:",
        "          - { id: title, label: Title, kind: text, required: true }",
        "      - id: assignments",
        "        name: Assignments",
        "        columns:",
        "          - { id: title, label: Title, kind: text, required: true }",
        ...course,
        "    pages:",
        "      - { id: courses, name: Courses, route: /module/academics-manager/courses, database_id: courses, capability_id: academics-manager.courses }",
        "      - { id: assignments, name: Assignments, route: /module/academics-manager/assignments, database_id: assignments, capability_id: academics-manager.assignments }",
        "    agents: []",
        "    automations: []",
        "",
      ].join("\n"),
    );
    return {
      reply: repair ? "Fixed the Course column." : "Built the Academics Module.",
      backendSessionId: "sdk-session-3",
      changedPaths: [path],
    };
  }
}

test("a rejected module.yaml goes back to the agent to repair, and the accepted Module is INSTALLED — the user never opens Modules (2026-09-05)", async () => {
  const backend = new RepairingBackend(true);
  await withBackendWiring([backend], async (wiring) => {
    const caller = makeCaller(wiring);
    const created = await caller.chat.thread.create({
      organizationId: PILOT_ORGANIZATION,
      backend: "claude_code",
      plane: "cloud",
      clientRequestId: "repair",
    });
    const view = await caller.chat.turn.send({
      organizationId: PILOT_ORGANIZATION,
      threadId: created.thread.id,
      clientRequestId: "repair-turn",
      message: "Build me an academics module with courses and assignments",
      surface: { kind: "chat_panel" },
    });

    // The briefing tells the agent how to talk (plain language, executive
    // style), the exact column grammar the live build got wrong, and that
    // Bridge — not the user — installs what it writes.
    const system = backend.calls[0]?.system ?? "";
    for (const rule of PLAIN_LANGUAGE_RULES) {
      assert.ok(system.includes(rule), `the briefing carries the plain-language rule: ${rule.slice(0, 60)}`);
    }
    assert.match(system, /relation_target\? \(relation ONLY/);
    assert.match(system, /never objects/);
    assert.doesNotMatch(system, /the user installs it from Modules/);
    assert.match(system, /Bridge installs the Module for the user/);

    // One repair round: Bridge's rejection reached the same backend session,
    // verbatim, and the agent fixed the file in place.
    assert.equal(backend.calls.length, 2, "exactly one repair round was needed");
    assert.match(backend.calls[1]!.text, /Bridge rejected academics-manager\/module\.yaml: .*options must be an array of strings/);
    assert.equal(backend.calls[1]!.backendSessionId, "sdk-session-3", "the repair continues the agent's own session");

    // The result is an INSTALLED Module and a sentence a person understands.
    const assistant = view.turns[view.turns.length - 1];
    assert.match(assistant?.content ?? "", /Built and installed "Academics" — it is in your sidebar now\./);
    assert.doesNotMatch(assistant?.content ?? "", /Registered the Module|install it from Modules|Could not register/);
    const modules = await caller.modules.list({ organizationId: PILOT_ORGANIZATION, limit: 100, offset: 0 });
    const mine = modules.items.find((item) => item.moduleName === "academics-manager");
    assert.equal(mine?.status, "installed");
    assert.equal(mine?.manifest.module?.databases?.[1]?.columns?.[1]?.relationTarget, "courses");
    // "in your sidebar" must be TRUE: every surface lists only state "available"
    // (Layout, Home, ModulePage), so installed-but-promoted is invisible (BUGS 2026-09-05 "the chatbot claims academics is in my side bar when it isnt").
    assert.equal(mine?.state, "available");
    // The install ask (private-Record writes → user_pref) was answered by the
    // chatting USER as a recorded Human decision, not skipped.
    const decision = await wiring.ledger.decisionFor(stableModuleInstallProposalId(PILOT_ORGANIZATION, mine!.id));
    assert.equal(decision?.userDecision, "approve");
    assert.deepEqual([decision?.actorType, decision?.actorId], ["user", PILOT_USER]);
  });
});

test("when the agent never fixes its module.yaml, Bridge stops after the repair budget and says so in plain words", async () => {
  const backend = new RepairingBackend(false);
  await withBackendWiring([backend], async (wiring) => {
    const caller = makeCaller(wiring);
    const created = await caller.chat.thread.create({
      organizationId: PILOT_ORGANIZATION,
      backend: "claude_code",
      plane: "cloud",
      clientRequestId: "no-repair",
    });
    const view = await caller.chat.turn.send({
      organizationId: PILOT_ORGANIZATION,
      threadId: created.thread.id,
      clientRequestId: "no-repair-turn",
      message: "Build me an academics module",
      surface: { kind: "chat_panel" },
    });
    assert.equal(backend.calls.length, 1 + MANIFEST_REPAIR_ROUNDS, "the repair budget is bounded");
    const assistant = view.turns[view.turns.length - 1];
    assert.match(assistant?.content ?? "", /could not accept its definition after 2 repair attempts\. Say "fix it"/);
    assert.match(assistant?.content ?? "", /Details for support: .*options must be an array of strings/);
    const modules = await caller.modules.list({ organizationId: PILOT_ORGANIZATION, limit: 100, offset: 0 });
    assert.equal(modules.items.some((item) => item.moduleName === "academics-manager"), false, "nothing half-registered");
  });
});
