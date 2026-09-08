/**
 * "Chief of Staff, build me a Module" — end to end.
 *
 * The capability the Chat surface could not reach: its envelope had three
 * kinds, none of which could name a Module, and the only module-install route
 * needed a human to hand-register a manifest first. These tests pin the whole
 * path — the model names a Module, a governed proposal halts for review, the
 * owner approves, and what comes out the far side is an installed Module with
 * a Database that actually holds Records.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  SeededRng,
  SystemClock,
  UuidGen,
  type ModelCompletionRequest,
  type ModelProvider,
  type ModelTier,
  type RunCtx,
} from "@bridge/core";
import { InMemorySourceCredentialVault } from "@bridge/dealpilot";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_ORGANIZATION, PILOT_USER, type Wiring } from "../src/wiring.js";

function makeRun(seed = 41): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(seed);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

function makeCaller(wiring: Wiring, seed = 41) {
  return appRouter.createCaller({
    wiring,
    run: makeRun(seed),
    identity: { type: "user" as const, id: PILOT_USER },
    authenticated: true,
    verifying: false,
  });
}

class ScriptedModel implements ModelProvider {
  readonly id = "chat-test-local";
  readonly plane = "local" as const;
  readonly tiers = ["cheap", "default"] as const satisfies readonly ModelTier[];
  readonly models = { cheap: "chat-test-v1", default: "chat-test-v1" };
  readonly calls: ModelCompletionRequest[] = [];
  constructor(private readonly reply: (request: ModelCompletionRequest) => string) {}
  routingHealth() {
    return "healthy" as const;
  }
  async complete(request: ModelCompletionRequest) {
    this.calls.push(request);
    return {
      text: this.reply(request),
      model: "chat-test-v1",
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

async function withWiring<T>(
  provider: ModelProvider,
  operation: (wiring: Wiring) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "bridge-authored-module-"));
  const wiring = await buildWiring({
    localDir: join(root, "local"),
    moduleFilesBridgeRoot: join(root, "files"),
    modelProviders: [provider],
    dealPilotCredentialVault: new InMemorySourceCredentialVault(),
  });
  try {
    return await operation(wiring);
  } finally {
    await wiring.close();
    await rm(root, { recursive: true, force: true });
  }
}

const READING_LOG = {
  kind: "create_module",
  text: "A Reading Log with one Books Database. Waiting for your approval.",
  title: "",
  outcome: "",
  exitTest: "",
  module: {
    name: "reading-log",
    displayName: "Reading Log",
    summary: "Books and what I took from them.",
    description: "Tracks books, their status and the notes worth keeping.",
    databases: [
      {
        id: "books",
        label: "Books",
        columns: [
          { id: "title", label: "Title", kind: "text", options: [], required: true },
          { id: "status", label: "Status", kind: "select", options: ["reading", "finished"], required: false },
        ],
      },
    ],
  },
};

async function sendModuleTurn(caller: ReturnType<typeof makeCaller>, message = "Build me a reading log.") {
  const { thread } = await caller.chat.thread.create({
    organizationId: PILOT_ORGANIZATION,
    plane: "local",
    clientRequestId: "module-thread",
  });
  const sent = await caller.chat.turn.send({
    organizationId: PILOT_ORGANIZATION,
    threadId: thread.id,
    clientRequestId: "module-turn",
    message,
    surface: { kind: "chat_panel" as const },
  });
  return { thread, sent };
}

test("the module-authoring capability is disclosed to the model and constrains what it may say", async () => {
  const model = new ScriptedModel(() => JSON.stringify({ kind: "answer", text: "Hello." }));
  await withWiring(model, async (wiring) => {
    await sendModuleTurn(makeCaller(wiring), "What can you do?");
    const request = model.calls[0]!;
    const system = request.system ?? "";
    assert.match(system, /Build a Module/, "the capability must be disclosed by name");
    // The verb only exists in the schema when the capability is disclosed —
    // the model is never shown an action it may not take.
    const schema = JSON.stringify(request.responseFormat);
    assert.match(schema, /create_module/);
    // The refusals the format makes are stated to the model, not left implicit.
    assert.match(system, /cannot author a Skill, an Agent, an Automation/);
    assert.doesNotMatch(schema, /"relation"/, "unauthorable column kinds must not be offered");
    assert.doesNotMatch(schema, /"formula"/);
  });
});

test("a drafted Module halts for review and installs nothing until it is approved", async () => {
  const model = new ScriptedModel(() => JSON.stringify(READING_LOG));
  await withWiring(model, async (wiring) => {
    const caller = makeCaller(wiring);
    const { sent } = await sendModuleTurn(caller);
    const turn = sent.turns.at(-1)!;
    assert.equal(turn.state, "awaiting_decision", "the turn must stop for the owner");
    const proposalRef = turn.refs.find((ref) => ref.kind === "proposal");
    assert.ok(proposalRef, "the turn must carry its proposal");

    // Registered but NOT installed: nothing is on the nav yet.
    const beforeNav = await wiring.moduleStore.getAvailable(PILOT_ORGANIZATION, "reading-log");
    assert.equal(beforeNav, null, "an unapproved Module must not be available");
    const before = await wiring.authoredModules.listDatabases(PILOT_ORGANIZATION, "reading-log");
    assert.deepEqual(before, [], "no storage may exist before approval");

    // Attribution: Chief of Staff drafted it, on the owner's behalf.
    const proposal = await wiring.ledger.get(proposalRef!.refId);
    assert.equal(proposal?.actorType, "agent");
    assert.equal(proposal?.onBehalfOfType, "user");
    assert.equal(proposal?.resourceType, "module_installation");
  });
});

test("approving it produces an installed Module whose Database really holds Records", async () => {
  const model = new ScriptedModel(() => JSON.stringify(READING_LOG));
  await withWiring(model, async (wiring) => {
    const caller = makeCaller(wiring);
    const { sent } = await sendModuleTurn(caller);
    const proposalId = sent.turns.at(-1)!.refs.find((ref) => ref.kind === "proposal")!.refId;

    await caller.action.decide({ proposalId, decision: "approve" });

    const installed = await wiring.moduleStore.getAvailable(PILOT_ORGANIZATION, "reading-log");
    assert.ok(installed, "an approved Module must reach `available` or the nav cannot see it");
    assert.equal(installed!.status, "installed");
    assert.equal(installed!.manifest.module?.displayName, "Reading Log");

    // The Page the nav lands on, and the Database behind it.
    const databases = await caller.authoredModules.databases({
      organizationId: PILOT_ORGANIZATION,
      moduleName: "reading-log",
    });
    assert.equal(databases.databases.length, 1);
    assert.equal(databases.databases[0]!.databaseId, "books");
    assert.deepEqual(
      databases.databases[0]!.columns.map((column) => column.id),
      ["title", "status"],
    );

    // Empty on arrival — an honest empty state, never seeded rows.
    const empty = await caller.authoredModules.records({
      organizationId: PILOT_ORGANIZATION,
      moduleName: "reading-log",
      databaseId: "books",
    });
    assert.equal(empty.total, 0);

    const created = await caller.authoredModules.createRecord({
      organizationId: PILOT_ORGANIZATION,
      moduleName: "reading-log",
      databaseId: "books",
      properties: { title: "Piranesi", status: "finished" },
    });
    const listed = await caller.authoredModules.records({
      organizationId: PILOT_ORGANIZATION,
      moduleName: "reading-log",
      databaseId: "books",
    });
    assert.equal(listed.total, 1);
    assert.deepEqual(listed.items[0]!.properties, { title: "Piranesi", status: "finished" });

    // The declared shape is enforced on write — jsonb cannot enforce itself.
    await assert.rejects(
      caller.authoredModules.createRecord({
        organizationId: PILOT_ORGANIZATION,
        moduleName: "reading-log",
        databaseId: "books",
        properties: { title: "Piranesi", status: "abandoned" },
      }),
      /must be one of reading, finished/,
    );
    await assert.rejects(
      caller.authoredModules.createRecord({
        organizationId: PILOT_ORGANIZATION,
        moduleName: "reading-log",
        databaseId: "books",
        properties: { status: "reading" },
      }),
      /"Title" is required/,
    );

    await caller.authoredModules.archiveRecord({
      organizationId: PILOT_ORGANIZATION,
      moduleName: "reading-log",
      databaseId: "books",
      recordId: created.record.id,
    });
    const afterArchive = await caller.authoredModules.records({
      organizationId: PILOT_ORGANIZATION,
      moduleName: "reading-log",
      databaseId: "books",
    });
    assert.equal(afterArchive.total, 0, "archive is a soft delete and hides the Record");
  });
});

test("a Module cannot be written into before it is approved", async () => {
  const model = new ScriptedModel(() => JSON.stringify(READING_LOG));
  await withWiring(model, async (wiring) => {
    const caller = makeCaller(wiring);
    await sendModuleTurn(caller);
    await assert.rejects(
      caller.authoredModules.createRecord({
        organizationId: PILOT_ORGANIZATION,
        moduleName: "reading-log",
        databaseId: "books",
        properties: { title: "Too early" },
      }),
      /not found/,
    );
  });
});

test("a draft that names an installed Module is refused, not silently renamed", async () => {
  const model = new ScriptedModel(() =>
    JSON.stringify({
      ...READING_LOG,
      module: { ...READING_LOG.module, name: "relationship" },
    }),
  );
  await withWiring(model, async (wiring) => {
    const caller = makeCaller(wiring);
    await assert.rejects(sendModuleTurn(caller), /already taken by an installed Module/);
    assert.notEqual(
      (await wiring.moduleStore.getAvailable(PILOT_ORGANIZATION, "relationship"))?.manifest
        .module?.displayName,
      "Reading Log",
      "an installed Module must never be overwritten by a draft that borrowed its name",
    );
  });
});

test("a draft asking for a column kind the format refuses does not install a broken Module", async () => {
  const model = new ScriptedModel(() =>
    JSON.stringify({
      ...READING_LOG,
      module: {
        ...READING_LOG.module,
        databases: [
          {
            id: "books",
            label: "Books",
            columns: [{ id: "author", label: "Author", kind: "relation", options: [], required: false }],
          },
        ],
      },
    }),
  );
  await withWiring(model, async (wiring) => {
    const caller = makeCaller(wiring);
    await assert.rejects(sendModuleTurn(caller), /a relation needs a target Database/);
    assert.equal(
      await wiring.moduleStore.getAvailable(PILOT_ORGANIZATION, "reading-log"),
      null,
      "a refused draft must leave no Module behind",
    );
  });
});
