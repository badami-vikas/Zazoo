# Harness Gaps — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four highest-leverage, immediately-implementable harness gaps: wire the live `trust_grants` DB table into capability activation, replace the context-overflow throw with governed compaction, fix wrong canon claims in docs, and add TASK rows for the remaining Tier C items.

**Architecture:** trustGrants wiring extends the existing `CapabilityStore` port with a `listTrustGrants` method backed by the `trust_grants` table that already exists in schema. Compaction replaces the throw in `boundedConversationHistory` with a drop-oldest strategy. Doc fixes correct provably-wrong canon claims. TASK rows fence off the Tier C work (schema changes for durable budget/kill-switch, eval pipeline feeding, sandbox wiring).

**Tech Stack:** TypeScript, Drizzle ORM, Node built-in test runner (`node:test`), Turborepo (`pnpm test`)

**Worktree branch:** `claude/bridge-app-build-vs-buy-e28ced`

---

## Task 1: Add `listTrustGrants` to the `CapabilityStore` port

**Files:**
- Modify: `platform/packages/core/src/capability/ports.ts:43-110`

- [ ] **Step 1: Add method to the interface and InMemory implementation**

Replace the closing `}` of the `CapabilityStore` interface (after `getState`) and the `InMemoryCapabilityStore` class with:

In `ports.ts`, add to the `CapabilityStore` interface (after line 57 `getState`):

```typescript
  /** Load all trust grants for an organization — passed to `resolveActivationApproval`
   * so the activation path can honour `trust_grants` rows instead of hardcoding [].
   * Returns active AND revoked rows; `approvals.ts` filters revoked via `!g.revokedAt`. */
  listTrustGrants(organizationId: string): Promise<TrustGrantView[]>;
```

And add `TrustGrantView` to the import at the top of `ports.ts`:

```typescript
import type { Audience, CapabilityEvidence, CapabilityOrigin, CapabilityState, CapabilityType, ComponentKind, RiskBand, TrustGrantView } from "./types.js";
```

Wait — `TrustGrantView` is defined in `approvals.ts`, not `types.ts`. Import it from there:

```typescript
import type { TrustGrantView } from "./approvals.js";
```

Add this import to the top of `ports.ts`.

Then add the InMemory implementation inside `InMemoryCapabilityStore` (after `getState`):

```typescript
  async listTrustGrants(_organizationId: string): Promise<TrustGrantView[]> {
    return []; // in-memory store: no trust grants (dev/test default; activate path
               // in tests supplies grants directly to resolveActivationApproval)
  }
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/vikasbadami/Documents/Workspace/Relationship\ OS/.claude/worktrees/silly-visvesvaraya-e0fb54/platform && pnpm --filter @bridge/core run typecheck 2>&1 | tail -20
```

Expected: no errors (or only pre-existing errors unrelated to this change).

- [ ] **Step 3: Commit**

```bash
cd /Users/vikasbadami/Documents/Workspace/Relationship\ OS/.claude/worktrees/silly-visvesvaraya-e0fb54 && git add platform/packages/core/src/capability/ports.ts && git commit -m "feat(core): add listTrustGrants to CapabilityStore port"
```

---

## Task 2: Implement `listTrustGrants` in `DrizzleCapabilityStore`

**Files:**
- Modify: `platform/packages/db/src/capability-store.ts`

- [ ] **Step 1: Add import and implementation**

In `capability-store.ts`, add to the existing imports at the top:

```typescript
import type { TrustGrantView } from "@bridge/core";
import { trustGrants } from "./schema.js";
```

Then add the method to `DrizzleCapabilityStore` (after the last existing method `listManifests` or `getManifestByNameVersion`):

```typescript
  async listTrustGrants(organizationId: string): Promise<TrustGrantView[]> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
      const rows = await tx
        .select({
          capabilityClass: trustGrants.capabilityClass,
          riskBand: trustGrants.riskBand,
          autoActivate: trustGrants.autoActivate,
          revokedAt: trustGrants.revokedAt,
        })
        .from(trustGrants)
        .where(eq(trustGrants.organizationId, organizationId));
      return rows.map((r) => ({
        capabilityClass: r.capabilityClass,
        riskBand: r.riskBand as TrustGrantView["riskBand"],
        autoActivate: r.autoActivate,
        revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
      }));
    });
  }
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/vikasbadami/Documents/Workspace/Relationship\ OS/.claude/worktrees/silly-visvesvaraya-e0fb54/platform && pnpm --filter @bridge/db run typecheck 2>&1 | tail -20
```

Expected: no errors from capability-store.ts.

- [ ] **Step 3: Commit**

```bash
cd /Users/vikasbadami/Documents/Workspace/Relationship\ OS/.claude/worktrees/silly-visvesvaraya-e0fb54 && git add platform/packages/db/src/capability-store.ts && git commit -m "feat(db): implement DrizzleCapabilityStore.listTrustGrants from trust_grants table"
```

---

## Task 3: Wire `listTrustGrants` in `router.ts` at the two hardcoded `[]` spots

**Files:**
- Modify: `platform/apps/api/src/router.ts` (lines 15373 and ~15845)

There are exactly two capability-activation spots that hardcode `trustGrants: []`. The chat-panel governance object at line 4522 is intentionally `[]` (chat doesn't activate capabilities via trust grants — that's a separate flow) and must NOT be changed.

- [ ] **Step 1: Fix `capability.activate` (router.ts:~15369-15377)**

Replace:
```typescript
        trustGrants: [], // trust_grants lookup is a store-layer follow-up; none in force yet
```

With:
```typescript
        trustGrants: await ctx.wiring.capabilityStore.listTrustGrants(input.organizationId),
```

- [ ] **Step 2: Fix `module.install` resolvedTrustGrants (router.ts:~15845)**

Replace:
```typescript
      const resolvedTrustGrants: TrustGrantView[] = []; // store-layer follow-up (same gap capability.activate has)
```

With:
```typescript
      const resolvedTrustGrants = await ctx.wiring.capabilityStore.listTrustGrants(input.organizationId);
```

(The `TrustGrantView[]` annotation can be dropped — TypeScript infers it from the return type.)

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/vikasbadami/Documents/Workspace/Relationship\ OS/.claude/worktrees/silly-visvesvaraya-e0fb54/platform && pnpm --filter @bridge/api run typecheck 2>&1 | tail -20
```

Expected: no new errors.

- [ ] **Step 4: Run affected tests**

```bash
cd /Users/vikasbadami/Documents/Workspace/Relationship\ OS/.claude/worktrees/silly-visvesvaraya-e0fb54/platform && pnpm --filter @bridge/api run test 2>&1 | tail -30
```

Expected: pass (existing tests use InMemoryCapabilityStore which returns `[]` — same as before, so no test should change behaviour).

- [ ] **Step 5: Commit**

```bash
cd /Users/vikasbadami/Documents/Workspace/Relationship\ OS/.claude/worktrees/silly-visvesvaraya-e0fb54 && git add platform/apps/api/src/router.ts && git commit -m "fix(api): wire trust_grants DB read into capability.activate and module.install — closes EPHEMERAL gap flagged in harness primitives"
```

---

## Task 4: Replace context-overflow throw with governed compaction

**Files:**
- Modify: `platform/packages/core/src/run-context.ts:174-210`
- Test: `platform/packages/core/test/run-context.test.ts` (add cases)

Current behaviour: `boundedConversationHistory` THROWS when `history.length > 24` or total chars `> 64_000`. This kills long conversations. New behaviour: drop oldest segments silently until within both limits. Still throw if a single segment is oversized (> 16k chars) because that's a caller bug, not a long-conversation case.

- [ ] **Step 1: Write the failing tests first**

In `platform/packages/core/test/run-context.test.ts`, find an existing test that uses `assembleRunContext` and add after it:

```typescript
function test_fixture_history_segment(content: string): import("../src/run-context.js").ModelConversationSegment {
  return {
    role: "user" as const,
    dataScope: "private" as const,
    content,
    taintLabel: {
      trust: "trusted" as const,
      originChain: [],
    },
  };
}

test("boundedConversationHistory: compacts > 24 segments instead of throwing", () => {
  // 30 small segments — should keep the LAST 24 (most recent), not throw
  const history = Array.from({ length: 30 }, (_, i) => test_fixture_history_segment(`msg_${i}`));
  // assembleRunContext calls boundedConversationHistory internally.
  // We exercise it by reading the returned context's conversationHistory length.
  // To access the bounded result directly we need to call the exported helper,
  // but it's not exported. Instead verify via assembleRunContext with a minimal input.
  // The key assertion: no throw, and the result keeps only the last 24 segments.
  const ctx = test_fixture_run_ctx();
  const input: AssembleRunContextInput = {
    agent: {
      id: "a1",
      name: "Test Agent",
      systemPromptTemplate: "You are a test agent.",
      goalTaskId: null,
    },
    disclosedCapabilities: [],
    governance: { approvalRequirement: "explicit_human", trustGrants: [] },
    memory: [],
    conversationHistory: history,
    outputContract: { description: "respond", schema: null },
  };
  const result = assembleRunContext(input, ctx);
  assert.equal(result.conversationHistory.length, 24);
  // Kept the LAST 24 (indices 6-29, content msg_6 through msg_29)
  assert.equal(result.conversationHistory[0]!.content, "msg_6");
  assert.equal(result.conversationHistory[23]!.content, "msg_29");
});

test("boundedConversationHistory: single oversized segment still throws", () => {
  const tooBig = test_fixture_history_segment("x".repeat(17_000)); // > 16k limit
  const ctx = test_fixture_run_ctx();
  const input: AssembleRunContextInput = {
    agent: { id: "a1", name: "Test Agent", systemPromptTemplate: "You are a test agent.", goalTaskId: null },
    disclosedCapabilities: [],
    governance: { approvalRequirement: "explicit_human", trustGrants: [] },
    memory: [],
    conversationHistory: [tooBig],
    outputContract: { description: "respond", schema: null },
  };
  assert.throws(() => assembleRunContext(input, ctx), /invalid conversation-history segment/);
});
```

- [ ] **Step 2: Run the tests to confirm they FAIL (red)**

```bash
cd /Users/vikasbadami/Documents/Workspace/Relationship\ OS/.claude/worktrees/silly-visvesvaraya-e0fb54/platform && pnpm --filter @bridge/core run test 2>&1 | grep -A3 "compacts\|oversized"
```

Expected: both tests fail — first because 30 segments currently throws.

- [ ] **Step 3: Implement the compaction**

In `platform/packages/core/src/run-context.ts`, replace `boundedConversationHistory` (lines ~178-210) with:

```typescript
function boundedConversationHistory(
  history: readonly ModelConversationSegment[] | undefined,
): ModelConversationSegment[] {
  if (!history) return [];

  // Single-segment size guard (caller bug — a segment this large is never valid).
  for (const seg of history) {
    if (
      !["user", "assistant", "skill"].includes(seg.role) ||
      !["private", "public"].includes(seg.dataScope) ||
      typeof seg.content !== "string" ||
      seg.content.length > MAX_CONVERSATION_SEGMENT_CHARS
    ) {
      throw new Error("run context: invalid conversation-history segment");
    }
  }

  // Compact: drop oldest segments until within both limits. Never modifies taint
  // on kept segments — each segment carries its own taintLabel and governance
  // constraints propagate forward through the pipeline, so dropping old context
  // does not weaken taint on remaining segments.
  let working = history.slice(); // mutable copy, oldest first
  while (working.length > MAX_CONVERSATION_SEGMENTS) {
    working = working.slice(1);
  }
  let total = working.reduce((sum, seg) => sum + seg.content.length, 0);
  while (total > MAX_CONVERSATION_HISTORY_CHARS && working.length > 1) {
    total -= working[0]!.content.length;
    working = working.slice(1);
  }

  return working.map((segment) => ({
    ...segment,
    taintLabel: {
      ...segment.taintLabel,
      originChain: segment.taintLabel.originChain.map((origin) => ({ ...origin })),
    },
  }));
}
```

- [ ] **Step 4: Run the tests to confirm they PASS (green)**

```bash
cd /Users/vikasbadami/Documents/Workspace/Relationship\ OS/.claude/worktrees/silly-visvesvaraya-e0fb54/platform && pnpm --filter @bridge/core run test 2>&1 | grep -E "compacts|oversized|passed|failed"
```

Expected: both new tests pass; all existing tests still pass.

- [ ] **Step 5: Typecheck**

```bash
cd /Users/vikasbadami/Documents/Workspace/Relationship\ OS/.claude/worktrees/silly-visvesvaraya-e0fb54/platform && pnpm --filter @bridge/core run typecheck 2>&1 | tail -10
```

- [ ] **Step 6: Commit**

```bash
cd /Users/vikasbadami/Documents/Workspace/Relationship\ OS/.claude/worktrees/silly-visvesvaraya-e0fb54 && git add platform/packages/core/src/run-context.ts platform/packages/core/test/run-context.test.ts && git commit -m "fix(core): compact conversation history instead of throwing — drops oldest segments when exceeding 24-segment or 64k-char limit"
```

---

## Task 5: Correct canon-vs-code doc claims

**Files:**
- Modify: `docs/wiki/harness.md`

Three provably-wrong claims need correction. These are doc-only changes — no code or schema touch.

- [ ] **Step 1: Fix the Mastra claim**

In `docs/wiki/harness.md`, the FIELD HEALTH section contains:

> **Mastra ~145 npm packages compromised** Jun 2026 (DPRK Sapphire Sleet) — we ship Mastra

This is FALSE. `grep -r "@mastra" platform/` returns no results. Mastra is NOT in the codebase. Replace the bullet with:

```
**Mastra ~145 npm packages compromised** Jun 2026 (DPRK Sapphire Sleet) — we do NOT ship Mastra (confirmed by grep; claim was pre-emptive from the comparative research phase, never implemented) ·
```

- [ ] **Step 2: Fix the Hatchet+BullMQ scheduler claim in CANON vs CODE**

In `docs/wiki/harness.md`, the CANON vs CODE section contains:

> **Scheduled Automation** → **no scheduler anywhere** in `platform/`. `rituals.md:20` claims Hatchet+BullMQ; neither dependency exists.

AP-106 (APPLIED 2026-08-05) added a scheduler — `InProcessRitualExecutor` with real wiring and 6 tests. Update to:

```
~~**Scheduled Automation** → **no scheduler anywhere** in `platform/`. `rituals.md:20` claims Hatchet+BullMQ; neither dependency exists.~~ **RESOLVED by AP-106 (2026-08-05)**: `InProcessRitualExecutor` ships; Hatchet/Temporal remain deferred behind the same interface. The `Hatchet+BullMQ` claim in older wiki text was stale; `flows.md` now correctly names `InProcessRitualExecutor`.
```

- [ ] **Step 3: Update the CANON vs CODE — NEXT section**

In `docs/wiki/harness.md`, the NEXT (tier 1) section lists 5 items. Item 3 is:

> 3. **Make Trust Model inputs real** — read `trust_grants`, persist budgets/kill-switch.

Trust grants are now wired (Tasks 1-3 above). Update item 3 to:

```
3. **Make Trust Model inputs real** — `trust_grants` wired ✓ (Tasks 1-3, 2026-08-07); budgets/kill-switch still in-memory (needs schema migration, separate TASK).
```

- [ ] **Step 4: Commit the doc fix**

```bash
cd /Users/vikasbadami/Documents/Workspace/Relationship\ OS/.claude/worktrees/silly-visvesvaraya-e0fb54 && git add docs/wiki/harness.md && git commit -m "docs: correct three wrong canon claims in harness.md — Mastra not shipped, scheduler landed AP-106, trust_grants now wired"
```

---

## Task 6: Add TASK rows for Tier C items

**Files:**
- Modify: `docs/TASKS.md`

The remaining three items from the original recommendations require schema migrations or architectural decisions and cannot be done in a Tier B session. Add TASK rows to fence them properly.

- [ ] **Step 1: Add TASK-039 for durable budget/kill-switch**

In `docs/TASKS.md`, add after the last active task (TASK-043), before any `done` tasks:

```markdown
## TASK-044 — Durable auto-activation budgets and kill switch

**Status:** ready
**Priority:** P2
**Outcome:** `capabilityBudgets` and `capabilityKillSwitch` are backed by Postgres tables, not lost on API restart. A kill switch pulled in one session stays pulled across deploys.
**Prototype test:** Pull the kill switch via the governance UI, restart the API process, and confirm the kill switch is still active.
**Scope:** Create `auto_activation_budgets` (organizationId, riskBand, day, count) and `kill_switch` (organizationId, killedAt, killedBy) tables in schema.ts + migration. Implement `DrizzleAutoActivationBudgetStore` and `DrizzleKillSwitch` in @bridge/db. Wire in wiring.ts for both deployment modes.
**Dependencies:** none
**Requests:** R-052 (build vs buy session 2026-08-07)
**Approval:** none
```

- [ ] **Step 2: Add TASK-045 for eval pipeline feeding**

```markdown
## TASK-045 — Feed the eval harness with execution snapshots

**Status:** ready
**Priority:** P2
**Outcome:** Every pipeline execution that produces a Decision writes an `executionSnapshot` to `DrizzleEvalStore`. The eval dashboard shows real run data, not only seed/retrieval-eval runs.
**Prototype test:** Invoke a Skill via Chat Panel, then open the Intelligence > Agents eval surface and verify a new eval record appears with the correct capability_id and pass/fail score.
**Scope:** Add an `executionSnapshot` column to `capability_states.evidence` or a dedicated `eval_snapshots` table (design decision required). Wire a `writeExecutionSnapshot` call at the pipeline commit phase. Add `routeMatchScorer` call for Agent routing decisions.
**Dependencies:** TASK-036 (green CI)
**Requests:** R-052 (build vs buy session 2026-08-07)
**Approval:** none
```

- [ ] **Step 3: Add TASK-046 for sandbox wiring**

```markdown
## TASK-046 — Wire InProcessJsSandboxProvider into the capability execution path

**Status:** ready
**Priority:** P2
**Outcome:** Capabilities with `isolation: "in-process-js"` execute inside `InProcessJsSandboxProvider` (node:vm) rather than directly. The PKG-1 sandbox gate at `module.install` is backed by an actual sandbox, not just a declarative check.
**Prototype test:** Install a capability that declares `isolation: "in-process-js"` and verify it runs inside the vm context (confirmed by a deliberate `process.exit()` call failing to terminate the host).
**Scope:** Add `SandboxProvider` to `PipelineDeps` (pipeline.ts). Instantiate `InProcessJsSandboxProvider` (server.ts) in wiring.ts for both modes. Route skill execution through the sandbox when the manifest declares a non-`none` isolation tier.
**Dependencies:** none
**Requests:** R-052 (build vs buy session 2026-08-07)
**Approval:** none
```

- [ ] **Step 4: Commit the new tasks**

```bash
cd /Users/vikasbadami/Documents/Workspace/Relationship\ OS/.claude/worktrees/silly-visvesvaraya-e0fb54 && git add docs/TASKS.md && git commit -m "feat(tasks): add TASK-044/045/046 for durable budgets, eval pipeline feeding, sandbox wiring"
```

---

## Self-review

**Spec coverage check:**
- trustGrants wiring → Tasks 1-3 ✓
- Compaction → Task 4 ✓
- Mastra correction → Task 5 ✓
- Scheduler correction → Task 5 ✓
- Budget/kill-switch durability → Task 6 (TASK row, Tier C) ✓
- Eval pipeline feeding → Task 6 (TASK row, Tier C) ✓
- Sandbox wiring → Task 6 (TASK row, Tier C) ✓
- Hermes sidecar spike → Out of scope (R&D, not yet a TASK — no outcome defined)

**Placeholder scan:** No TBDs. Every step has actual code.

**Type consistency:**
- `TrustGrantView` imported from `approvals.js` in ports.ts — consistent with its definition location.
- `listTrustGrants` return type `Promise<TrustGrantView[]>` matches across interface, InMemory, and Drizzle implementations.
- `boundedConversationHistory` signature unchanged — callers unaffected.

**Note on line 4522 (chat-panel governance):** `trustGrants: []` there is intentionally kept. That governance object shapes the AI's behaviour in Chat Panel — chat doesn't activate capabilities via trust grants (that's a separate activation flow). Changing it would have no effect and would be misleading.
