/**
 * AI Harness K4 (TASK-048) — Layer B memory-slot budget at the one context door.
 *
 * Invariants under test:
 *  - the meter ALWAYS reports when memory was supplied (not only on violation);
 *  - over-budget input keeps the RANKED PREFIX whole and drops the rest;
 *  - a top snippet larger than the whole budget is hard-truncated, never lost;
 *  - the override can only TIGHTEN — widening clamps down to the ceiling;
 *  - no memory supplied → no report, empty slot;
 *  - the projection carries included text and none of the dropped text.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assembleRunContext,
  enforceMemoryBudget,
  FixedClock,
  MEMORY_SLOT_BUDGET_CHARS,
  projectToSystemPrompt,
  UuidGen,
  type AssembleRunContextInput,
  type RetrievedMemorySnippet,
  type RunCtx,
} from "../src/index.js";

function test_fixture_run_ctx(): RunCtx {
  return {
    clock: new FixedClock("2026-08-10T00:00:00.000Z"),
    rng: {
      next(): number {
        throw new Error("rng must not be used by assembly");
      },
    },
    ids: new UuidGen(new FixedClock("2026-08-10T00:00:00.000Z"), { next: () => 0.5 }),
  };
}

function test_fixture_input(overrides: Partial<AssembleRunContextInput> = {}): AssembleRunContextInput {
  return {
    persona: {
      id: "chief_of_staff",
      name: "Chief of Staff",
      role: "You triage requests.",
      actorType: "agent",
      actorId: "test_fixture_agent_1",
    },
    request: "What do you know about Priya?",
    governance: { approvalRequirement: "auto", trustGrants: [] },
    outputContract: { description: "A short reply." },
    ...overrides,
  };
}

function snippet(id: string, chars: number): RetrievedMemorySnippet {
  return { source: `memory:${id}`, text: id.padEnd(chars, "x").slice(0, chars) };
}

test("under budget: memory passes through untouched and the meter still reports", () => {
  const memory = [snippet("a", 100), snippet("b", 200)];
  const ctx = assembleRunContext(test_fixture_input({ memory }), test_fixture_run_ctx());
  assert.equal(ctx.memory.length, 2);
  assert.deepEqual(ctx.trace.memoryBudget, {
    budgetChars: MEMORY_SLOT_BUDGET_CHARS,
    suppliedSnippets: 2,
    includedSnippets: 2,
    droppedSnippets: 0,
    truncatedFinalSnippet: false,
  });
});

test("over budget: the ranked prefix is kept whole, the first overflow and everything after it drop", () => {
  const memory = [snippet("a", 5_000), snippet("b", 5_000), snippet("c", 5_000), snippet("d", 10)];
  const ctx = assembleRunContext(test_fixture_input({ memory }), test_fixture_run_ctx());
  assert.equal(ctx.memory.length, 2, "5k+5k fits inside 12k; the 5k that would overflow drops with its tail");
  assert.equal(ctx.memory[0]!.source, "memory:a");
  assert.equal(ctx.memory[1]!.source, "memory:b");
  assert.equal(ctx.trace.memoryBudget?.droppedSnippets, 2);
  assert.equal(ctx.trace.memoryBudget?.truncatedFinalSnippet, false);
});

test("a top snippet larger than the whole budget is truncated to fit, never dropped", () => {
  const { memory, report } = enforceMemoryBudget([snippet("giant", 30_000)], 1_000);
  assert.equal(memory.length, 1);
  assert.equal(memory[0]!.text.length, 1_000);
  assert.equal(report.truncatedFinalSnippet, true);
  assert.equal(report.droppedSnippets, 0);
});

test("the override tightens but never widens: values above the ceiling clamp down", () => {
  const memory = [snippet("a", 80), snippet("b", 80)];
  const tightened = assembleRunContext(
    test_fixture_input({ memory, memoryBudgetChars: 100 }),
    test_fixture_run_ctx(),
  );
  assert.equal(tightened.memory.length, 1, "100-char budget admits only the first 80-char snippet");
  assert.equal(tightened.trace.memoryBudget?.budgetChars, 100);

  const widened = enforceMemoryBudget([snippet("a", 10)], 5_000_000);
  assert.equal(widened.report.budgetChars, MEMORY_SLOT_BUDGET_CHARS, "widening clamps to the ceiling");
});

test("no memory supplied: empty slot, no meter on the trace", () => {
  const ctx = assembleRunContext(test_fixture_input(), test_fixture_run_ctx());
  assert.deepEqual(ctx.memory, []);
  assert.equal(ctx.trace.memoryBudget, undefined);
});

test("the projection carries included snippet text and none of the dropped text", () => {
  const kept = { source: "memory:kept", text: "PLUGH-the-kept-snippet" };
  const dropped = { source: "memory:dropped", text: "XYZZY-the-dropped-snippet".padEnd(200, "y") };
  const ctx = assembleRunContext(
    test_fixture_input({ memory: [kept, dropped], memoryBudgetChars: 30 }),
    test_fixture_run_ctx(),
  );
  const prompt = projectToSystemPrompt(ctx);
  assert.match(prompt, /PLUGH-the-kept-snippet/);
  assert.doesNotMatch(prompt, /XYZZY/);
});
