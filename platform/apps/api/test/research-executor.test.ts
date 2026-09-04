/**
 * The server-side Research Run executor (TASK-028 kernel-executor bridge).
 *
 * Every port is a fake here on purpose: what needs proving is that the
 * executor ALWAYS freezes an outcome — including when the loop itself throws —
 * that it records each step durably, that the cross-surface stop is honored,
 * and that a bound is a completed Run rather than a failure.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { EvidenceEntry, PageRead } from "@bridge/research";
import type { ResearchRunOutcomeUpdate } from "@bridge/core";
import {
  executeResearchRun,
  statusForStopReason,
  type ResearchExecutorHooks,
} from "../src/research-executor.js";

function page(url: string, text: string): PageRead {
  return {
    url,
    title: "A page",
    text,
    retrievedAt: "2026-09-03T00:00:00.000Z",
    contentHash: "deadbeef",
    bytes: text.length,
  };
}

interface Harness {
  hooks: ResearchExecutorHooks;
  steps: EvidenceEntry[];
  finished: ResearchRunOutcomeUpdate[];
  warnings: string[];
}

function harness(overrides: Partial<ResearchExecutorHooks> = {}): Harness {
  const steps: EvidenceEntry[] = [];
  const finished: ResearchRunOutcomeUpdate[] = [];
  const warnings: string[] = [];
  const hooks: ResearchExecutorHooks = {
    search: async () => [
      {
        url: "https://example.com/a",
        title: null,
        excerpt: "an excerpt",
        providerId: "parallel",
        retrievedAt: "2026-09-03T00:00:00.000Z",
      },
    ],
    chat: async () => '{"done":true}',
    reader: { read: async (url) => page(url, "page text") },
    appendStep: async (entry) => {
      steps.push(entry);
    },
    loadSteps: async () => steps,
    stopRequested: async () => false,
    finish: async (outcome) => {
      finished.push(outcome);
    },
    onWarning: (message) => warnings.push(message),
    ...overrides,
  };
  return { hooks, steps, finished, warnings };
}

test("executor: plans, searches, reads, and freezes a completed outcome with citations", async () => {
  const replies = [
    '{"tool":"search","argument":"local-first sync","rationale":"start broad"}',
    '{"tool":"read","argument":"https://example.com/a","rationale":"read the top hit"}',
    "the brief, with a citation (https://example.com/a)",
  ];
  let call = 0;
  const bench = harness({
    chat: async () => replies[Math.min(call++, replies.length - 1)]!,
  });

  const outcome = await executeResearchRun(
    { runId: "run-1", objective: "map local-first sync engines", bounds: { maxSteps: 2 } },
    bench.hooks,
  );

  assert.equal(outcome.status, "completed");
  assert.equal(outcome.stopReason, "bound_steps");
  assert.equal(outcome.stepsTaken, 2);
  assert.deepEqual(
    bench.steps.map((step) => step.tool),
    ["search", "read"],
  );
  // The read step carries its untrusted page text so BR4 resume replays it.
  assert.equal(bench.steps[1]?.quarantined?.trustOrigin, "untrusted_external");
  assert.ok(outcome.citations.includes("https://example.com/a"));
  assert.equal(bench.finished.length, 1);
  assert.deepEqual(bench.finished[0], outcome);
});

test("executor: a throwing planner still freezes the Run, never leaves it running", async () => {
  const bench = harness({
    chat: async () => {
      throw new Error("no model reachable");
    },
  });

  const outcome = await executeResearchRun({ runId: "run-2", objective: "anything" }, bench.hooks);

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.stopReason, "planner_failed");
  assert.equal(bench.finished.length, 1);
});

test("executor: a hook that throws outright is reported as executor_error, not silence", async () => {
  const bench = harness({
    loadSteps: async () => {
      throw new Error("the step ledger is unreachable");
    },
  });

  const outcome = await executeResearchRun(
    { runId: "run-3", objective: "anything", resume: true },
    bench.hooks,
  );

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.stopReason, "executor_error");
  assert.equal(bench.finished.length, 1);
  assert.ok(bench.warnings.some((line) => line.includes("executor failed")));
});

test("executor: the cross-surface stop flag cancels the Run at a step edge", async () => {
  const bench = harness({
    // Never finishes on its own: only the stop flag can end this Run.
    chat: async () => '{"tool":"search","argument":"again","rationale":"keep going"}',
    stopRequested: async () => true,
  });

  const outcome = await executeResearchRun(
    { runId: "run-4", objective: "unbounded curiosity" },
    bench.hooks,
  );

  assert.equal(outcome.status, "cancelled");
  assert.equal(outcome.stopReason, "cancelled");
  // Exactly one step edge of latency: the step that was already in flight.
  assert.equal(outcome.stepsTaken, 1);
});

test("executor: a lost step record warns but does not kill the Run", async () => {
  const bench = harness({
    chat: async () => '{"tool":"search","argument":"one query","rationale":"once"}',
    appendStep: async () => {
      throw new Error("database unavailable");
    },
  });

  const outcome = await executeResearchRun(
    { runId: "run-5", objective: "keep going", bounds: { maxSteps: 1 } },
    bench.hooks,
  );

  assert.equal(outcome.status, "completed");
  assert.ok(bench.warnings.some((line) => line.includes("step record failed")));
});

test("executor: bounds are honest completions; only failures are failures", () => {
  assert.equal(statusForStopReason("bound_steps"), "completed");
  assert.equal(statusForStopReason("bound_wall_clock"), "completed");
  assert.equal(statusForStopReason("injection_detected"), "completed");
  assert.equal(statusForStopReason("cancelled"), "cancelled");
  assert.equal(statusForStopReason("planner_failed"), "failed");
  assert.equal(statusForStopReason("executor_error"), "failed");
});
