/**
 * The Builder Run, end to end through the real router: the loop decides, the
 * host executor performs, the ledger records — the three halves of BA0 that
 * existed separately and were reachable by nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

const MODULE = "task-manager";

/** Walks the Bridge files root looking for one file — the Organization folder
 * name is the user's, not this test's, to hard-code. */
async function findFile(root: string, name: string): Promise<string | null> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      const hit = await findFile(path, name);
      if (hit) return hit;
    } else if (entry.name === name) {
      return path;
    }
  }
  return null;
}

function makeCaller(wiring: Wiring, seed = 7) {
  const clock = new SystemClock();
  const rng = new SeededRng(seed);
  const run: RunCtx = { clock, rng, ids: new UuidGen(clock, rng) };
  return appRouter.createCaller({
    wiring,
    run,
    identity: { type: "user" as const, id: PILOT_USER },
    authenticated: true,
    verifying: false,
  });
}

/** Replays a fixed script of builder actions, one per model call. */
class ScriptedBuilderModel implements ModelProvider {
  readonly id = "builder-test-local";
  readonly plane = "local" as const;
  readonly tiers = ["cheap", "default"] as const satisfies readonly ModelTier[];
  readonly models = { cheap: "builder-test-v1", default: "builder-test-v1" };
  #index = 0;

  constructor(private readonly script: readonly unknown[]) {}

  routingHealth() {
    return "healthy" as const;
  }

  async complete(request: ModelCompletionRequest) {
    const action = this.script[this.#index] ?? { kind: "finish", summary: "out of script", why: "" };
    this.#index += 1;
    return {
      text: JSON.stringify(action),
      model: "builder-test-v1",
      tier: request.tier,
      usage: {
        inputTokens: 11,
        outputTokens: 5,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        source: "provider" as const,
      },
    };
  }
}

async function withBuilderWiring<T>(
  provider: ModelProvider,
  operation: (wiring: Wiring, filesRoot: string) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "bridge-builder-run-"));
  const filesRoot = join(root, "files");
  const wiring = await buildWiring({
    localDir: join(root, "local"),
    moduleFilesBridgeRoot: filesRoot,
    modelProviders: [provider],
    dealPilotCredentialVault: new InMemorySourceCredentialVault(),
  });
  try {
    return await operation(wiring, filesRoot);
  } finally {
    await wiring.close();
    await rm(root, { recursive: true, force: true });
  }
}

test("a Builder Run writes the file the model asked for and leaves a costed receipt", async () => {
  const provider = new ScriptedBuilderModel([
    { kind: "write", path: "notes.md", content: "# built by the Builder\n", why: "scaffold" },
    { kind: "finish", summary: "wrote notes.md", why: "done" },
  ]);
  await withBuilderWiring(provider, async (wiring, filesRoot) => {
    const caller = makeCaller(wiring);
    const receipt = await caller.builder.run({
      organizationId: PILOT_ORGANIZATION,
      moduleName: MODULE,
      task: "create a notes file",
    });

    assert.equal(receipt.stopReason, "finished");
    assert.equal(receipt.summary, "wrote notes.md");
    assert.deepEqual(
      receipt.actions.map((entry) => [entry.token, entry.decision, entry.status]),
      [["file:write", "execute", "ok"]],
    );
    // Two model calls: the write and the finish.
    assert.equal(receipt.usage.modelCalls, 2);
    assert.equal(receipt.usage.inputTokens, 22);
    assert.equal(receipt.usage.outputTokens, 10);

    // The file is really on disk, inside the Module's own folder.
    const found = await findFile(filesRoot, "notes.md");
    assert.ok(found, "notes.md was reported written but is not on disk");
    assert.equal(await readFile(found, "utf8"), "# built by the Builder\n");

    // The ledger carries both a per-primitive row and the Run receipt with cost.
    const history = await wiring.ledger.listHistory(PILOT_ORGANIZATION, {
      limit: 50,
      offset: 0,
      privateOwnerUserId: PILOT_USER,
    });
    const operations = history.items.map(
      (entry) => (entry.inputs as { operation?: string }).operation,
    );
    assert.ok(operations.includes("builder_primitive"));
    const runRow = history.items.find(
      (entry) => (entry.inputs as { operation?: string }).operation === "builder_run",
    );
    assert.ok(runRow, "the Run receipt row is missing");
    assert.equal((runRow.inputs as { modelCalls?: number }).modelCalls, 2);
    assert.equal((runRow.inputs as { model?: string }).model, "builder-test-v1");
  });
});

test("a command on the absolute deny list stops the Run and is still recorded", async () => {
  const provider = new ScriptedBuilderModel([
    { kind: "shell", command: "git push origin main", why: "ship it" },
    { kind: "finish", summary: "never reached", why: "" },
  ]);
  await withBuilderWiring(provider, async (wiring) => {
    const caller = makeCaller(wiring);
    const receipt = await caller.builder.run({
      organizationId: PILOT_ORGANIZATION,
      moduleName: MODULE,
      task: "push my work",
    });

    assert.equal(receipt.stopReason, "refused");
    assert.equal(receipt.actions.at(-1)?.decision, "refuse");
    // The decisive assertion: the model was NOT asked for another action after
    // the refusal, so the run cannot narrate work that never happened.
    assert.equal(receipt.usage.modelCalls, 1);

    const history = await wiring.ledger.listHistory(PILOT_ORGANIZATION, {
      limit: 50,
      offset: 0,
      privateOwnerUserId: PILOT_USER,
    });
    const refusal = history.items.find(
      (entry) =>
        (entry.inputs as { operation?: string }).operation === "builder_primitive" &&
        (entry.proposedOutput as { decision?: string } | null)?.decision === "refuse",
    );
    assert.ok(refusal, "a refused call must still be on the ledger");
  });
});

test("a Module whose policy denies builder.run refuses with the user's own reason", async () => {
  const provider = new ScriptedBuilderModel([{ kind: "finish", summary: "n/a", why: "" }]);
  await withBuilderWiring(provider, async (wiring) => {
    const caller = makeCaller(wiring);
    await caller.moduleGovernance.set({
      organizationId: PILOT_ORGANIZATION,
      moduleName: MODULE,
      allow: [],
      deny: [{ action: "builder.run", reason: "I review my own Tasks by hand" }],
    });
    await assert.rejects(
      caller.builder.run({
        organizationId: PILOT_ORGANIZATION,
        moduleName: MODULE,
        task: "do anything",
      }),
      /I review my own Tasks by hand/,
    );
  });
});
