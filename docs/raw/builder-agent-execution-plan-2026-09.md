---
title: Builder Agent execution plan — BA0–BA6 sequenced against the code that now exists
type: raw
doc_kind: plan
status: active
companions: [docs/wiki/builder-agent.md]
related_wiki: docs/wiki/builder-agent.md
updated: 2026-09-02
tags: [builder-agent, ba0, agentic-backend, execution-first, myzazoo]
---

# 0. Why this document exists

`builder-agent-roadmap-2026-07.md` is the three-lens roadmap: what the Builder
should be, which patterns it adopts, what each slice must prove. It has been
`status: proposed` since July with zero code and no TASK rows.

This plan is the other half — what to build, in what order, against the
repository as it stands on 2026-09-02, with the user's two amendments folded in:

1. **Execution-first governance** (user directive, 2026-09-02, verbatim): "I want
   governance but not at cost of execution. Seek approval only if high risk task,
   else lets have exectuion first approach." The roadmap's implicit posture was
   propose-everything. It is now: execute by default, approve on real risk,
   refuse only what destroys reviewability.
2. **myzazoo as the working reference** (user directive, 2026-09-02). The sibling
   project at `Workspace/myzazoo` runs a builder agent in ~600 LOC: a loop, four
   tools, one allow/deny hook, append-only JSONL sessions, branch-and-merge as
   the review boundary. It proves the shape works before Bridge spends BA1–BA6
   on the governed version. Where this plan and the roadmap disagree on
   complexity, myzazoo's working version wins.

# 1. What shipped on 2026-09-02 (BA0, first half)

```yaml
shipped:
  tool_policy:
    file: platform/packages/core/src/capability/primitive-policy.ts
    what: >
      The execution-first gate. decideBuilderPrimitive returns execute | approve |
      refuse against a Module's allow/deny (ADR-263 governance block).
      ABSOLUTE_DENY (push/merge/rebase/reset --hard/main checkout/rm -rf/sudo)
      cannot be unlocked by any policy or any human. ALWAYS_APPROVE (curl,
      wget, publish, credential and system-state commands) escalates even when
      the Module allows it. Everything else runs.
    tests: platform/packages/core/test/primitive-policy.test.ts (13)
  primitive_executor:
    file: platform/apps/api/src/builder/primitive-executor.ts
    what: >
      HostPrimitiveExecutor — the first code in Bridge that EXECUTES a builder
      primitive. file:read/write/edit + shell:execute against one working
      directory, double path containment (string gate then resolved-path
      gate), minimal spawn env so a build cannot read the API process's
      secrets, output truncation, per-call audit of executed/escalated/refused
      alike. Explicitly NOT a SandboxProvider (see §4).
    tests: platform/apps/api/test/builder-primitive-executor.test.ts (10)
  builder_loop:
    file: platform/packages/core/src/capability/builder-loop.ts
    what: >
      The Bridge-native agent loop. One governed action per step over the
      existing ModelProvider port's constrained-JSON output (no new port, works
      on local llama.cpp and on Groq). Named stop reasons only: finished,
      needs_approval, refused, max_steps, unparseable_action. A call that needs
      approval halts the loop rather than letting the model narrate work that
      never happened.
    tests: platform/packages/core/test/builder-loop.test.ts (8)
  agentic_chat_backend:
    files:
      - platform/packages/core/src/chat-backend.ts
      - platform/apps/api/src/chat/claude-code-backend.ts
      - platform/apps/api/src/chat/claude-oauth.ts
      - platform/packages/db/migrations/0044_task_chat_backend.sql
    what: >
      ChatBackend — the swappable port behind every conversation surface, with
      Claude Code (Agent SDK, headless subprocess) as the first agentic
      implementation. Browser OAuth PKCE sign-in ported from myzazoo's
      src/oauth.ts into Bridge's Local Plane credential vault. Selectable in
      the Chat model menu and, through the same ChatView, in the Avatar
      composer. Codex and Cursor are registry rows away.
    tests: platform/apps/api/test/chat-agentic-backend.test.ts (3)
```

# 2. Sequence

Each slice keeps the roadmap's own exit criteria; this adds the ordering, the
dependency on what now exists, and the smallest honest deliverable.

```yaml
sequence:
  BA0_remaining:
    goal: finish the containment half of BA0
    done_2026_09_02:
      - the Builder Run seam: `builder.run` -> apps/api/src/builder/run.ts. Module
        governance answers `builder.run` first; one HostPrimitiveExecutor per Run with
        its audit hook on the immutable ledger (executed/escalated/refused alike); one
        closing receipt row with stop reason, model, model calls and token counts.
        runBuilderLoop now accumulates usage per step and per run (ADR-268).
    deliverables:
      - PromptAssembler v1 — ONE implementation shared with Learning LA1, not two
      - containment suite as permanent CI: seeded escape attempts (path traversal,
        env exfiltration, chained deny) all blocked and recorded
      - E2B/container SandboxProvider adapter for UNTRUSTED bodies (Commons,
        imports, generated capability code) — the host executor never covers these
    exit: seeded escape suite green in CI; every action has a ledger row with cost
  BA1:
    goal: conversation -> workspace draft -> targeted edit, no regeneration
    depends_on: [BA0_remaining, compileBlueprint + workspace_definitions (shipped)]
    note: >
      Stable node IDs are the precondition for BA5 evolution. Build the stability
      test first and let it fail; a node-ID scheme retrofitted after BA2 ships is
      a migration, not a feature.
  BA2:
    goal: the Builder emits capabilities with manifests and their own evals
    depends_on: [BA0_remaining, capability-package-format]
  BA3:
    goal: the validation lane — nothing unvalidated reaches an approver
    depends_on: [BA1, BA2, Component Registry]
    note: >
      Under execution-first this lane matters MORE, not less: it is what keeps
      "execute by default" from meaning "unchecked by default".
  BA4:
    goal: the approval card as the Builder's real UI (diff, why, risk, rollback)
    depends_on: [BA3, Governance Agent GA1 risk blocks]
  BA5:
    goal: the evolution loop — improve artifacts without trampling customizations
    depends_on: [BA4, runtime signals, Trust Model SUSPEND]
  BA6:
    goal: two-tier model economy + Commons publication
    depends_on: [BA5, ModelProvider seam (shipped)]
```

# 3. The execution-first amendment, precisely

The roadmap's invariant "generation ≠ activation" is unchanged: a generated
capability is a Draft and activation is a human decision. What changed is the
*work* the Builder does on the way there.

```yaml
execute_without_asking:
  - reads anywhere inside the Module's working directory
  - writes and edits inside the Module's declared writePaths (absent = the whole
    working directory)
  - commands matching the Module's allow list, or any command when it declares none
approve_first:
  - anything that leaves the machine (curl, wget, publish, release)
  - anything touching credentials or system state (security, defaults, launchctl, crontab)
  - writes outside the declared writePaths
  - commands outside a declared allow list
refuse_always:
  - git push / merge / rebase / reset --hard / checkout main / branch -D
  - rm -rf / and ~, sudo, shutdown, diskutil, mkfs, fork bombs
```

An empty Module policy is not a default-deny (ADR-263) and not a
default-approve: it gets the ordinary execution path.

# 4. Where the sandbox doctrine lands

ADR-027: "isolated-vm = narrow no-network JS transforms ONLY; shell:execute /
code:exec = container/microVM via SandboxProvider, E2B adapter for cloud; NEVER
isolated-vm for shell, never raw host."

That rule stands for what it was written about — **untrusted capability
bodies**: code from Commons, from a foreign import, or freshly generated by the
Builder itself. Those still require a container/microVM adapter, which BA0's
remaining work must deliver before BA2 emits executable capability code.

`HostPrimitiveExecutor` is a different case the roadmap never separated: the Builder
Agent working, at the user's explicit request, inside the user's own Bridge
folder on the user's own machine. There the trust boundary is the allow/deny
gate plus branch-and-merge, exactly as in myzazoo. It declares
`isolation: "host-process"`, is not assignable to `SandboxProvider`, and cannot
be selected by code shopping for one. Recorded as ADR-266.

# 5. What myzazoo already proved, and what Bridge must not re-litigate

```yaml
carried_over:
  - four tools are enough (read/write/edit/bash); a fifth is a request, not a default
  - the deny list is short and absolute; everything else is allow-list or ask
  - append-only JSONL per run is both the audit log and the debugging surface
  - the merge is the user's click; the agent never leaves its branch
  - one process is the whole runtime — UI server, automation runner, agent host
deliberately_different:
  - Bridge's gate returns three outcomes, not two: myzazoo refuses what is not
    allowed, Bridge escalates it, because Bridge has an Approvals surface
  - the vault, not a bare keychain call, holds the OAuth token
  - the ledger, not only a JSONL file, records each action (JSONL stays for the
    transcript)
```

# 6. Open, and honest about it

- **PromptAssembler ownership.** Learning LA1 and Builder BA0 both specify one.
  It must be a single implementation; whichever slice lands first builds it and
  the other consumes it. Unassigned as of this document.
- ~~**Cost receipts.**~~ CLOSED 2026-09-02 (ADR-268): the loop reports
  `BuilderStepUsage` per step and `BuilderRunUsage` per run, and `runModuleBuilder`
  writes the receipt row. BA0's third exit criterion is met.
- **Container adapter.** No E2B or container SandboxProvider exists.
  `NotImplementedContainerSandboxProvider` still throws. This is BA0's largest
  remaining piece and BA2's hard dependency.
