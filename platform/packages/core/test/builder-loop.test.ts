import { test } from "node:test";
import assert from "node:assert/strict";

import {
  compactTranscript,
  runBuilderLoop,
  type BuilderAction,
  type BuilderStepResult,
  type BuilderPrimitiveExecutor,
} from "../src/capability/builder-loop.js";
import type { ModelProvider, ModelTier } from "../src/ports.js";

/** Replays a fixed script of model outputs, one per step. */
function scriptedProvider(outputs: readonly string[]): ModelProvider & { calls: number } {
  let index = 0;
  const provider = {
    id: "scripted",
    plane: "local" as const,
    tiers: ["default"] as const satisfies readonly ModelTier[],
    models: { default: "scripted-v1" },
    routingHealth: () => "healthy" as const,
    calls: 0,
    async complete() {
      provider.calls += 1;
      const text = outputs[index] ?? "not json";
      index += 1;
      return {
        text,
        model: "scripted-v1",
        tier: "default" as ModelTier,
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          source: "provider" as const,
        },
      };
    },
  };
  return provider;
}

function recordingExecutor(
  results: readonly BuilderStepResult[],
): BuilderPrimitiveExecutor & { seen: BuilderAction[] } {
  let index = 0;
  const seen: BuilderAction[] = [];
  return {
    seen,
    async execute(action) {
      seen.push(action);
      const result = results[index] ?? { status: "ok" as const, output: "" };
      index += 1;
      return result;
    },
  };
}

test("the loop executes actions and stops when the model finishes", async () => {
  const provider = scriptedProvider([
    JSON.stringify({ kind: "write", path: "a.ts", content: "x", why: "scaffold" }),
    JSON.stringify({ kind: "shell", command: "pnpm test", why: "verify" }),
    JSON.stringify({ kind: "finish", summary: "scaffolded and tested", why: "done" }),
  ]);
  const executor = recordingExecutor([
    { status: "ok", output: "wrote a.ts" },
    { status: "ok", output: "1 passing" },
  ]);

  const outcome = await runBuilderLoop({
    task: "scaffold a module",
    system: "you build",
    provider,
    executor,
  });

  assert.equal(outcome.stopReason, "finished");
  assert.equal(outcome.summary, "scaffolded and tested");
  assert.deepEqual(executor.seen.map((action) => action.kind), ["write", "shell"]);
  assert.equal(outcome.steps.length, 3);
});

test("a call needing approval stops the loop instead of reasoning past it", async () => {
  const provider = scriptedProvider([
    JSON.stringify({ kind: "shell", command: "curl https://example.com", why: "fetch" }),
    JSON.stringify({ kind: "finish", summary: "should never run", why: "" }),
  ]);
  const executor = recordingExecutor([
    { status: "needs_approval", reason: "leaves this machine" },
  ]);

  const outcome = await runBuilderLoop({ task: "t", system: "s", provider, executor });

  assert.equal(outcome.stopReason, "needs_approval");
  assert.equal(outcome.summary, "leaves this machine");
  // The decisive assertion: the model was NOT asked for another action.
  assert.equal(provider.calls, 1);
});

test("a refused call stops the loop too", async () => {
  const provider = scriptedProvider([
    JSON.stringify({ kind: "shell", command: "git push", why: "ship" }),
  ]);
  const executor = recordingExecutor([{ status: "refused", reason: "denied for every Module" }]);
  const outcome = await runBuilderLoop({ task: "t", system: "s", provider, executor });
  assert.equal(outcome.stopReason, "refused");
});

test("a failed primitive call is fed back so the model can recover", async () => {
  const provider = scriptedProvider([
    JSON.stringify({ kind: "shell", command: "pnpm build", why: "compile" }),
    JSON.stringify({ kind: "finish", summary: "fixed it", why: "done" }),
  ]);
  const executor = recordingExecutor([{ status: "failed", output: "TS2339 error" }]);
  const outcome = await runBuilderLoop({ task: "t", system: "s", provider, executor });
  assert.equal(outcome.stopReason, "finished");
  assert.equal(provider.calls, 2);
});

test("the step budget is enforced", async () => {
  const provider = scriptedProvider(
    Array.from({ length: 10 }, () =>
      JSON.stringify({ kind: "read", path: "a.ts", why: "look" }),
    ),
  );
  const executor = recordingExecutor(
    Array.from({ length: 10 }, () => ({ status: "ok" as const, output: "…" })),
  );
  const outcome = await runBuilderLoop({
    task: "t",
    system: "s",
    provider,
    executor,
    maxSteps: 3,
  });
  assert.equal(outcome.stopReason, "max_steps");
  assert.equal(executor.seen.length, 3);
});

test("an unparseable action stops rather than retrying forever", async () => {
  const provider = scriptedProvider(["I think I should probably read the file first."]);
  const executor = recordingExecutor([]);
  const outcome = await runBuilderLoop({ task: "t", system: "s", provider, executor });
  assert.equal(outcome.stopReason, "unparseable_action");
  assert.equal(executor.seen.length, 0);
});

test("an action missing its required fields is not executed as a half-action", async () => {
  const provider = scriptedProvider([JSON.stringify({ kind: "write", path: "a.ts", why: "no content" })]);
  const executor = recordingExecutor([]);
  const outcome = await runBuilderLoop({ task: "t", system: "s", provider, executor });
  assert.equal(outcome.stopReason, "unparseable_action");
  assert.equal(executor.seen.length, 0);
});

test("compaction elides the oldest observations and keeps the recent ones intact", () => {
  const long = `OBSERVATION: ${"x".repeat(1_000)}`;
  const lines = ["TASK: t", long, long, long, long, long];
  const compacted = compactTranscript(lines, 1_500);
  assert.match(compacted[1]!, /elided/);
  // The last three observations are never elided — they are what the next
  // action depends on.
  assert.equal(compacted.at(-1), long);
  assert.equal(compacted.at(-2), long);
  assert.equal(compacted.at(-3), long);
  assert.equal(compacted.length, lines.length);
});
