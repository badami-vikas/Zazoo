---
title: Harness Comparative Analysis — Bridge Engine against the field
type: raw
doc_kind: research
status: draft
companions: [primitives.md, learnings-and-next-steps.md]
related_wiki: harness.md
updated: 2026-07-29
tags: [harness, engine, competitive, architecture, orchestration, agents]
---

# Harness Comparative Analysis

Compares the **Bridge Engine** — Bridge's own agent runtime — against 20 external harnesses and
orchestrators. Bridge terms are used exactly as [`docs/glossary.md`](../glossary.md) defines them;
external terms are quoted in each platform's own vocabulary, because vocabulary collision is itself
a finding (§6).

Research date **2026-07-29**. Claims marked `UNVERIFIED` were not confirmed against a primary source
and must not be treated as canon. Evidence for the general claims lives in
[`learnings-and-next-steps.md`](learnings-and-next-steps.md).

## 1. What "harness" means, and which one this document compares

The word is overloaded. Three definitions are in live use:

- **Compositional** (LangChain, Böckeler, Wikipedia): "every piece of code, configuration, and
  execution logic that isn't the model itself." Formula: *Agent = Model + Harness*.
- **Attention-economic** (Freeman, *Scaling DataOps*): the layer running an Observe → Plan →
  Generate → Verify loop so a model can work untethered from a chat window, giving the operator "a
  mental buffer against the deluge of decisions."
- **Product-named** (Microsoft Agent Framework): `Harness` is a specific *shipped component* — "an
  opinionated agent with batteries-included capabilities for long, multi-step tasks."

Böckeler's **inner vs. outer harness** distinction resolves most cross-article confusion: the model
sits at the core; the *builder's* harness is the SDK/runtime internals; the *user's* harness is
instruction files, MCP servers, hooks, skills, and CI gates.

**Bridge occupies both rings and neither definition cleanly.** The Engine is the builder's harness
(pipeline, authority, taint, ports). Modules, Skills, Automations, and Blueprints are the user's
harness — except that in Bridge the user's harness is *itself governed data* rather than files a
user edits freely. That is the structural difference this document keeps returning to.

Scope note: this compares the **Bridge Engine as a product harness**. The repository's own
`.claude/` development harness is a separate artifact and is out of scope here.

## 2. The comparison frame

Twelve axes. The first six are Guo et al.'s survey decomposition of a harness's runtime
responsibilities (arXiv 2606.20683), which is the most complete published checklist; the last six
are axes Bridge's own canon forces us to care about and most of the field does not.

```yaml
axes:
  - id: A1-observation
    question: How does the harness perceive the world — tools, sensors, retrieval?
  - id: A2-context
    question: How is the model's context assembled, budgeted, and compacted?
  - id: A3-control
    question: Who owns control flow — model, graph, or orchestrator? Deterministic or inferred?
  - id: A4-action
    question: What is the unit of effect, and what gates it?
  - id: A5-state
    question: What survives a crash, a restart, a week? Where does it live?
  - id: A6-verification
    question: How does the system know the work is correct and complete?
  - id: A7-authority
    question: Is permission computed deterministically, or asserted in a prompt?
  - id: A8-residency
    question: Can data be pinned to a customer-controlled boundary, and is egress deny-default?
  - id: A9-provenance
    question: Are trust, sensitivity, and source labels carried through execution?
  - id: A10-humans
    question: How rich is the human-in-the-loop model — pause only, or assignee/SLA/escalation?
  - id: A11-evolution
    question: Can the harness safely change itself, and what gates promotion?
  - id: A12-durability
    question: Replay, resume, retry, idempotency, and their honest failure semantics.
```

## 3. Platform-by-platform

Each entry records what the platform actually does, then contrasts it with Bridge. `bridge_contrast`
is written from the Bridge side: what we have, what they have that we lack, what we deliberately
reject.

### 3.1 Coding-agent harnesses

```yaml
- platform: Claude Code / Claude Agent SDK
  vendor: Anthropic
  shape: single async-generator tool loop serving CLI, headless SDK, and subagents identically
  A3_control: >
    Model proposes, orchestrator disposes. Policy is injected as data and functions
    (canUseTool, maxTurns, fallbackModel, hooks, querySource) rather than branched on in the loop.
    4 of 7 loop states are error-recovery states.
  A2_context: >
    Auto-compaction near the limit; microcompact clears only old tool calls with no model call;
    reactive compaction on HTTP 413; CLAUDE.md hierarchy; skills expose name+description only until
    invoked; MCP tool definitions deferred by default.
  A4_action: canUseTool -> PreToolUse hook -> execute -> PostToolUse hook -> tool_result
  A5_state: JSONL transcripts, --resume, forks, /rewind restoring conversation AND code
  A6_verification: Stop hooks as convergence guard; no built-in eval
  A11_evolution: skills, subagents, hooks, plugins — all files, all diffable
  notable: >
    Hooks run in the application process, outside the model's context window. That is what makes
    them deterministic policy rather than more prompting.
  limits: compaction is lossy; cost opaque in long sessions; agent teams ~7x tokens
  bridge_contrast: >
    Bridge's Action Pipeline is the same "orchestrator disposes" shape, but its gate is an
    Authority Decision computed from role grants, capability scope, delegation, and denies — not a
    callback the embedder supplies. Claude Code has no authority model, no residency boundary, and
    no taint tracking; Bridge has no compaction, no microcompact, no /rewind, and no session
    transcript format. The hooks-outside-the-context insight is the single most directly
    transferable idea: Bridge's guard/ and policy/ layers already run outside the model, but nothing
    yet lets a Module author register a deterministic pre/post-Action hook.

- platform: OpenAI Codex CLI
  vendor: OpenAI
  version: v0.145.0 (2026-07-21), Rust, Apache-2.0
  shape: thread/turn model with layered config resolution
  A4_action: >
    Two orthogonal layers — sandbox_mode (what is technically possible) x approval_policy (when to
    ask). This is the cleanest statement of the capability/approval split in the field.
  A8_residency: >
    OS-kernel sandboxing chosen deliberately over containers — macOS Seatbelt, Linux bwrap+seccomp,
    Windows native. Network off by default. Cloud runs two-phase: setup phase has network and
    secrets; SECRETS ARE REMOVED and network disabled before the agent phase.
  A7_authority: >
    Enterprise requirements.toml can FORBID settings (e.g. disallow approval_policy = "never").
    approvals_reviewer = "auto_review" puts a second model in the approval path; it fails closed and
    its default policy is open source.
  A2_context: skills index hard-capped at 2% of context window or 8,000 chars; descriptions truncate first
  limits: linux sandbox breaks inside namespace-restricted containers; custom-agent format acknowledged immature
  bridge_contrast: >
    Codex's sandbox x approval matrix maps almost exactly onto Bridge's Data Scope x Review Mode,
    and its requirements.toml is the same idea as Bridge's Explicit Deny and Agent Floor Deny —
    arriving there from enterprise IT rather than from governance theory. Two things Bridge lacks
    outright: a sandbox of any kind (SandboxProvider is a named port with no interface, per
    undefined-elements) and the two-phase credential-stripping execution model, which is a strong
    and cheap answer to the Lethal Trifecta that Bridge currently addresses only with taint labels.
    Codex's 2%-of-context skills budget is the concrete form of a discipline Bridge has stated but
    never quantified.

- platform: Cursor
  vendor: Anysphere
  shape: client-side continuation loop; server-side prompt assembly; orchestrator + exec daemon
  A4_action: >
    Run Modes route Shell/MCP/Fetch through 4 branches: allowlisted -> run; sandboxable -> sandbox;
    otherwise -> classifier subagent decides allow / reroute / ask user.
  A7_authority: Team Rules can be ENFORCED so users cannot disable them; precedence Team > Project > User
  A5_state: checkpoints separate from git; server-side conversation state
  notable: ships a claude-code-mapper.js transforming Claude Code hook configs into Cursor format
  limits: >
    Cursor's own docs disclaim Auto-review as "not a security boundary". Workspace trust off by
    default. Cloud agents cannot use local MCP servers or user-level hooks.
  bridge_contrast: >
    Enforced Team Rules are the closest external analogue to Bridge's canon: policy an individual
    cannot opt out of. Bridge's version is stronger because it is computed, not merged text.
    Cursor's willingness to state plainly that its LLM classifier is not a security boundary is the
    posture Bridge should copy in its own docs for any inferential control. The claude-code-mapper
    is evidence that harness extension formats are converging into a portability surface.

- platform: Devin
  vendor: Cognition
  shape: cloud-only, VM per session, planner-wrapped per-step model calls
  A5_state: >
    Snapshots are the central primitive — a snapshot is the saved VM state; EVERY SESSION BOOTS A
    FRESH COPY and session changes never persist back. Blueprints are declarative YAML environment
    config. Golden Snapshots give an enterprise-wide baseline.
  A3_control: v3 added dynamic re-planning when tasks stall
  multi_agent: >
    Managed Devins (2026-03-19) — a coordinator decomposes and delegates to child sessions each in
    its OWN isolated VM, with structured output schemas and playbooks making handoffs systematic.
  limits: >
    Independent evaluations put fully-autonomous completion of complex real-world tasks around
    14-15%, against vendor figures above 50%. The spread is the finding: results depend
    overwhelmingly on task-description quality. ACU billing is opaque until after a run.
  bridge_contrast: >
    Managed Devins is Child Agent Run with VM isolation instead of authority intersection — they
    bound the blast radius physically, Bridge bounds it logically. Bridge's Child Agent Run contract
    (authority, Skills, data scope, budget, review requirement, taint, and depth all subset of
    parent) is stricter on paper and cheaper to run, but Bridge has no isolation primitive at all if
    a Skill misbehaves inside the process. Devin's Blueprint/Snapshot pipeline is a more mature
    version of Bridge's Blueprint, which today compiles configuration but does not pin an execution
    environment. The 14-15% autonomy figure is the strongest available argument for Bridge's
    draft-then-approve default.

- platform: opencode
  vendor: anomalyco (formerly sst), MIT
  shape: client/server — Hono+Bun server owns all state, tool execution, and model calls
  notable: >
    Publishes an OpenAPI 3.1 spec at /doc; clients (TUI, desktop, web, VS Code, Zed) are generated,
    not hand-written. Compaction is modelled as a hidden AGENT, not a subroutine. The
    experimental.session.compacting plugin hook lets a plugin inject context into the compaction
    prompt OR REPLACE IT ENTIRELY.
  A4_action: >
    Declarative allow/ask/deny per tool, per agent, with glob pattern maps
    ("git log*": allow, bash: {"*": ask}). Skill deny HIDES the skill from the agent entirely.
  bridge_contrast: >
    The client/server split with a generated-client contract is exactly Bridge's three-client model
    over a single tRPC API — independent convergence on the same conclusion, which is a good sign
    for the architecture. Two ideas worth stealing: compaction-as-an-Agent fits Bridge's ontology
    perfectly (an Engine's compression family invoked through a governed Agent Run rather than a
    hidden subroutine), and "deny hides the capability" is a stronger default than "deny refuses",
    because it removes the capability from the model's decision space rather than tempting it.

- platform: OpenClaw
  vendor: independent foundation (Steinberger -> OpenAI, Feb 2026); built ON Pi's agent runtime
  shape: resident personal agent — gateway daemon, Brain/Hands dual loop, heartbeat/cron wake-ups
  A8_residency: >
    Most granular sandbox model surveyed: mode (off | non-main | all) x scope (agent | session |
    shared) x backend (docker | ssh | openshell), plus workspaceAccess (none | ro | rw).
    Recommended posture: main session on host, all group/channel traffic containerized.
  notable: >
    Explicit trust-boundary statement — sandbox backends isolate TOOL EXECUTION ONLY; the gateway
    and native plugins share the gateway's trust boundary. Skills declare required env vars,
    binaries, and install specs in frontmatter, and ClawHub checks declarations against behaviour.
  limits: >
    Worst security record surveyed. CVE-2026-25253 (CVSS 8.8), two command-injection flaws,
    demonstrated credential leakage and RCE via prompt injection, and SecurityScorecard found
    40,214 internet-exposed instances with 35.4% flagged vulnerable (Feb 2026). Sandboxing is OFF
    BY DEFAULT.
  bridge_contrast: >
    OpenClaw is the cautionary case for everything Bridge is trying to be: a resident, ambient,
    multi-channel personal agent with real host access. Its failure was not the architecture but the
    DEFAULTS — sandbox off, users overriding loopback binding. Bridge's deny-default Plane Gate and
    Agent Floor Deny are the structural answer, and this is the evidence that they are load-bearing
    rather than ceremonial. ClawHub's declaration-vs-behaviour check is a concrete design for
    Commons' privacy gate and supply-chain verification. The heartbeat/cron scheduler that makes
    OpenClaw resident rather than request/response is what Bridge's Scheduled Automation is for.

- platform: Pi (pi.dev)
  vendor: Mario Zechner / Earendil Inc., MIT
  correction: >
    NOT Parallel Web Systems and NOT "pi Labs". Repo earendil-works/pi, npm
    @earendil-works/pi-coding-agent. OpenClaw's agent runtime is Pi in RPC mode.
  shape: four packages — pi-ai (providers), pi-agent-core (loop), pi-coding-agent (CLI), pi-tui
  notable: >
    Four default tools (read, write, edit, bash). System prompt + tool definitions under ~1,000
    tokens, published in source. TREE-STRUCTURED SESSIONS — /tree navigates to any prior point and
    continues, all branches in one JSONL file. Compaction fully replaceable via extension.
    SYSTEM.md can replace the default system prompt wholesale.
    Steering vs follow-up: Enter mid-turn sends a steering message delivered after the current tool.
  anti_features: >
    Explicitly did NOT build: MCP, sub-agents, permission popups, plan mode, built-in to-dos,
    background bash. Each has a documented "build it yourself or use a package" alternative.
  philosophy: "There are many agent harnesses but this one is yours"; "Primitives, not features"
  bridge_contrast: >
    Pi is the philosophical opposite of Bridge and therefore the most useful mirror. Pi maximises
    user ownership by removing governance; Bridge maximises trust by making governance
    non-removable. Pi's explicit anti-feature list is a discipline Bridge should adopt in form:
    stating what we deliberately do not build, and why, is cheaper than re-litigating it. Its
    tree-structured sessions are a genuinely better model than linear-plus-checkpoints for Bridge's
    Run history, where a rejected Plan and its approved successor are naturally siblings rather than
    a linear overwrite. Pi's sub-1,000-token prompt is the empirical counterweight to Bridge's
    Prompt Assembler ambitions.
```

### 3.2 Multi-agent frameworks

```yaml
- platform: CrewAI
  version: 1.15.8 (2026-07-28)
  primitives: Agent(role, goal, backstory) / Task / Crew / Process(sequential | hierarchical) / Flow
  shape: >
    Crew is "a frozen plan"; Flow is a decorator-driven event graph (@start, @listen, @router,
    and_(), or_()). The existence of Flows is an admission Crews could not express branching,
    retries, or human pauses.
  A6_verification: >
    Guardrails are the main correctness gate — function-based returning (bool, Any) or LLM-based
    natural-language criteria; failure feeds the error back and retries to guardrail_max_retries (3).
  A5_state: >
    Memory API unified in v1 — a single Memory class with hierarchical scopes and composite scoring
    replacing short-term/long-term/entity buckets. LanceDB default. Migration is live, so most
    tutorials describe an API that no longer exists.
  limits: >
    Documented token burn — hierarchical crews making 50-100+ model calls, delegation loops.
    GitHub #1579 shows @router loops needing manual counters; a July 2026 comment describes building
    an external circuit breaker because "CrewAI loop silently burning tokens/cost before you notice."
    No built-in per-user memory isolation. Four CVEs disclosed in 2026 (severity UNVERIFIED).
  bridge_contrast: >
    CrewAI's Agent(role, goal, backstory) is the most human-legible vocabulary in the field and the
    least precise. Bridge's Agent definition — mandate, capability scope, attributable activity,
    explicit Skill set — is doing real work that "backstory" is not. The lesson Bridge should take is
    negative and important: role-play framing produces delegation loops, because nothing in the
    ontology bounds them. Bridge's Automation-starts-an-Agent-Run boundary and Child Agent Run depth
    cap are the structural fix. CrewAI's guardrail-retry loop is, however, a real primitive Bridge
    lacks: Bridge has Review Mode and Output Contract but no typed retry-with-error-feedback.

- platform: AutoGen
  vendor: Microsoft — MAINTENANCE MODE
  status: >
    Last release python-v0.7.5 on 2025-09-30, ~10 months stale. README: "AutoGen is now in
    maintenance mode... community managed going forward." Read as archaeology.
  primitives: AgentId = (agent type, agent key); TopicId = (Topic Type, Topic Source); Subscription
  shape: v0.4 is an actor model — agents publish to a runtime that routes by topic subscription
  notable: >
    Standalone vs Distributed Agent Runtime with the SAME agent implementation — "developers can
    switch between the two runtime types with no change." Multi-tenancy expressed by making topic
    source data-dependent, spawning one agent instance per key.
  limits: >
    Documented infinite-loop trap in SelectorGroupChat. Migration churn is triple-barreled:
    0.2 -> 0.4 was a non-backwards-compatible rewrite, and 0.4 -> MAF is a SECOND forced migration.
    PyPI namespace confusion — pyautogen points at the AG2 fork's codebase.
  bridge_contrast: >
    The runtime-transparency property (same agent code, standalone or distributed) is precisely what
    Bridge's Ports and Adapters buys, and is the strongest argument for keeping the Engine
    surface-agnostic. Topic-source-as-tenancy is a weaker version of Bridge's Organization boundary
    plus RLS — a convention rather than an enforced boundary, which is exactly the failure Bridge's
    Governance Contract exists to prevent.

- platform: AG2
  version: v1.0.0 (2026-07-27), v1.0.1 (2026-07-29) — two days old at time of research
  status: ground-up replacement; old AutoGen-derived code moved to ag2ai/ag2-classic
  primitives: >
    Hub (one per network) holding "registry, audit log, channel table, write-ahead logs, expectation
    evaluators, sweepers". Agent -> AgentClient -> LinkClient -> Envelope. Passport (stable identity)
    and RESUME ("capability claims with observed track record"). Rule (per-agent access lists, rate
    limits, inbox caps, channel-type allowlists). HumanClient as a first-class network participant.
  channels: conversation (2, free-form) | consulting (2, strict 1Q1R) | discussion (2+, round-robin) | workflow (2+, declarative TransitionGraph)
  bridge_contrast: >
    AG2 v1.0 is the closest external analogue to Bridge's governance instincts, and it is worth
    reading closely. "Resume" — capability claims plus OBSERVED TRACK RECORD — is independently the
    same idea as Bridge's Trusted Status earned from evidence. Hub-enforced Rules (rate limits,
    inbox caps) are the only framework-level loop/cost containment in the field; every other
    framework leaves runaway prevention to developer-set caps, and every other framework has
    documented cases of that failing expensively. Bridge has Activation Budget and Kill Switch but
    no per-Agent inbox cap or rate limit. HumanClient-as-a-peer is a cleaner model than
    human-as-a-special-case and maps to Bridge's Human actor.
  caution: two days old; docs lag the code; the team has now asked users to migrate twice

- platform: Microsoft Agent Framework
  status: 1.0 GA 2026-04-02; python-1.12.1 and dotnet-1.15.0 as of 2026-07-22/23
  shape: Agents | Harness (a named product component) | Workflows (graph, type-safe routing)
  A12_durability: >
    Best-in-class. Execution proceeds in SUPERSTEPS (Pregel/BSP); checkpoints taken at superstep
    boundaries capture executor state, pending messages, pending requests/responses, and shared
    states. Three checkpoint stores behind one protocol (InMemory, File, Cosmos).
  A10_humans: >
    RequestInfoExecutor pauses the graph, emits a typed RequestInfoEvent, and resumes only on a
    matching RequestResponse. Critically: PENDING REQUESTS ARE SAVED IN THE CHECKPOINT and
    re-emitted on restore — the only framework where a human pause is durable across process death
    by construction. Tool approval via ApprovalRequiredAIFunction / ToolApprovalRequestContent.
  A8_residency: >
    Foundry Standard setup "stores agent state in customer-managed, single-tenant Azure resources in
    your own subscription". Hosted agents support BYO VNet with per-session VM-isolated sandboxes.
  caution: >
    FileCheckpointStorage and CosmosCheckpointStorage use Python pickle for non-JSON-native state,
    mitigated by a restricted unpickler. Docs are blunt: "Checkpoint storage is a trust boundary...
    Never load checkpoints from untrusted or potentially tampered sources."
  bridge_contrast: >
    MAF is the durability benchmark Bridge should measure itself against, and the gap is real.
    Bridge's Run is defined in the glossary as "deterministic, attributable, replayable" — MAF
    actually implements the replayable part with superstep checkpoints and durable pending
    approvals. Bridge's Review Mode approve/quorum states have no documented crash-survival
    contract. The checkpoint-as-trust-boundary warning is directly applicable: any Bridge
    checkpoint/snapshot format must be taint-labelled and signature-verified, not merely persisted.

- platform: OpenAI Agents SDK
  version: 0.19.0 (2026-07-27), still pre-1.0
  shape: conversation-driven Runner loop; handoffs are agent swaps WITHIN one loop, not sub-graphs
  primitives: >
    Agent / Runner / RunConfig / handoff() exposed to the model as transfer_to_<agent_name> /
    Guardrail with tripwire_triggered / Session (pluggable history store) / RunContextWrapper
    (local context, explicitly NOT sent to the model) / ToolContext
  notable: >
    JS RunState is serializable — state.toString() / RunState.fromString(), then approve/reject and
    re-run. That is the single durable-resume seam in the SDK.
    Input guardrails run only if the agent is FIRST; output guardrails only if LAST.
  limits: >
    No durability. Per Temporal: "no checkpointing, no state persistence, no failure recovery... if
    the process crashes during a multi-step agent run, all tool results, handoff context, and
    conversation state are lost." ZDR customers CANNOT USE TRACING — you cannot have both from the
    first-party stack.
  bridge_contrast: >
    The guardrail position rule (first/last agent only) is a real design trap Bridge avoids by
    construction: Bridge evaluates authority and policy on EVERY mutation via the Governance
    Contract, not at conversation boundaries. The ZDR-excludes-tracing tradeoff is instructive —
    Bridge's Event Partitioning is designed so that Local Plane retention and audit are not mutually
    exclusive, which is a genuine architectural advantage worth stating in competitive material.

- platform: AgentKit / Agent Builder
  vendor: OpenAI
  status: >
    DEPRECATED. Wind-down announced 2026-06-03. Evals read-only 2026-10-31; Agent Builder and Evals
    SHUT DOWN 2026-11-30. Migration path is the Agents SDK or Workspace Agents. ChatKit survives
    only in custom-server form.
  primitives: Workflow -> nodes -> typed edges; node types incl. Guardrails, If/else (CEL), While, Human approval, Transform, Set state
  bridge_contrast: >
    An entire visual-authoring and eval stack sunset ~13 months after launch. For Bridge this is
    evidence for two canon positions: Blueprints must be portable, versioned, exportable manifests
    rather than a proprietary canvas format, and Commons entries must be content-addressed and
    signed so a registry's disappearance does not strand an installation.

- platform: Google ADK / Gemini Enterprise Agent Platform
  version: ADK 2.0 (Mar 2026); python v2.5.0 (2026-07-16); platform GA 2026-04-22
  shape: three coexisting orchestration models — LLM-driven sub_agents, workflow agents (Sequential/Parallel/Loop), and Graph Workflows
  A5_state: >
    Four-layer separation and the best state vocabulary in the field: Session (thread with event
    log) / State (scoped k-v with app:, user:, temp: PREFIXES) / Memory (MemoryService, semantic) /
    Artifacts (named, versioned binary). All persistence flows through append_event().
  A12_durability: >
    Resumability is OPT-IN (ResumabilityConfig). State-based resumption per workflow node.
    Honest caveats: tools are AT-LEAST-ONCE ("if your agent uses Tools where duplicate runs would
    have a negative impact, such as purchases, you should modify the Tool to check for and prevent
    duplicate runs"); you CANNOT modify the workflow before resuming; Dev UI and CLI unsupported.
  limits: >
    Consistent criticism of conceptual load — three overlapping orchestration models. One built-in
    tool per agent forces wrapper agents. Naming instability: Agentspace -> Gemini Enterprise ->
    Gemini Enterprise Agent Platform; Vertex AI Agent Engine -> Agent Runtime; docs domains moved twice.
  bridge_contrast: >
    ADK's app:/user:/temp: state prefixes are a better-specified version of Bridge's Context Tier
    (working/episodic/semantic/procedural) — theirs is a persistence scope with enforced lifetime,
    ours is a retention class with no runtime enforcement yet. The event-sourced append_event()
    discipline is the same shape as Bridge's append-only Event log and Ledger. The at-least-once
    honesty is the standard Bridge should hold itself to: Bridge's glossary promises replayable
    Runs, and the docs must say plainly where that promise is not yet met.
```

### 3.3 Durable-execution and orchestration engines

```yaml
- platform: Temporal
  shape: durable execution via event-sourced replay; workflow code emits Commands, Service persists Events
  primitives: >
    Workflow Definition/Type/Execution, Activity, Worker, Task Queue, Namespace, Signal, Query,
    Update, Timer, Child Workflow, Continue-As-New, Event History, Replay, Schedule, Search
    Attributes, Nexus, Worker Versioning (GA 2026-03-30)
  determinism: >
    Workflows must make the same API calls in the same sequence given the same input. Banned in
    workflow code: API calls, DB queries, random(), wall-clock time, threads, unordered map
    iteration. SDKs enforce with sandboxes and raise non-determinism errors on divergent replay.
  A9_provenance: >
    Payload encryption via custom Data Converter + Payload Codec — "data exists unencrypted only on
    the Client and the Worker process, on hosts that you control." A self-hosted Codec Server lets
    the Web UI decode CLIENT-SIDE ONLY; payloads on the Service stay encrypted.
  limits: >
    History caps 51,200 events / 50 MB force Continue-As-New engineering in agent loops with large
    contexts. 2,000 in-flight Activities/Children/Signals. Idle worker-fleet cost is the top
    adoption objection. Streaming and durability are in direct tension.
  bridge_contrast: >
    Temporal is the reference implementation of what Bridge's glossary already promises: Run as
    "deterministic, attributable, replayable execution of an approved Plan". Bridge's determinism.ts
    and injected Clock/Rng/IdGen are the same idea at a much smaller scale. Two Temporal ideas are
    directly applicable to Bridge canon. First, the Codec Server pattern is an almost exact fit for
    the Plane Gate: ciphertext crosses the boundary, decode happens only on customer-controlled
    hosts, and the audit surface stays readable without the payload leaving the Local Plane.
    Second, Worker Versioning solves a problem Bridge has and has not named — what happens to
    in-flight Runs when a Module Version changes. Bridge's Rollback is defined as a governed forward
    change; it says nothing about Runs already executing.

- platform: Hatchet
  shape: Postgres-backed distributed task queue + durable workflow engine, MIT
  primitives: Task / Worker (with slots) / Workflow / DAG (via parents) / Durable Task / Durable Sleep / Durable Event Waits
  notable: >
    Durable tasks "only do one of two things: wait for something, or spawn child tasks."
    Concurrency keys are CEL expressions with LIMIT_STRATEGY of GROUP_ROUND_ROBIN,
    CANCEL_IN_PROGRESS, or CANCEL_NEWEST. Native token streaming with an honest documented
    footgun (subscribe before publish or events are lost).
  determinism: >
    NO determinism constraint on ordinary task code — the key difference from Temporal. Only calls
    through the durable context are recorded and replayed from cache. Consequence: arbitrary side
    effects between durable calls WILL re-run.
  honesty: >
    Claims "closer-to-exactly-once semantics" — explicitly a comparative, not a guarantee. Docs
    state the ceiling: not suitable for 10k+ tasks/sec. Self-published postmortems on Postgres
    partitioning and thundering-herd at ~25k transactions/sec.
  bridge_contrast: >
    Hatchet is already in Bridge's stack (with BullMQ) per docs/wiki/rituals.md, so this is an
    internal-capability read rather than a competitive one. Its durable-context model is a better
    fit for Bridge than full Temporal determinism, because Bridge's Actions are already the
    governed, recorded unit — the analogue of a durable call — while ordinary Skill code is not
    sandboxed. Its documented candour about ceilings and failure modes is the standard Bridge's own
    resilience docs should meet.

- platform: Mastra
  status: v1 Jan 2026 (broad breaking changes); Mastra Platform launched 2026-04-09 replacing Mastra Cloud
  shape: agent loop + graph workflows; a library, not a server cluster
  A5_state: >
    Snapshot-based, NOT event-sourced. A run is durable only at suspend() boundaries; a crash
    mid-step is not recoverable. Snapshot state must be JSON-serializable.
    Memory model is strong: resourceId (owner, immutable) + thread, with Observational Memory,
    Working Memory, Semantic Recall, and memory processors.
  limits: >
    No first-class retry-policy/backoff/timeout primitive; docs recommend delegating to Inngest for
    "step memoization, automatic retries" — an admission that Mastra's own engine is not the
    durability layer. No versioning story for suspended snapshots.
  security: >
    June 2026 — ~145 Mastra npm packages compromised via a hijacked maintainer account, deploying a
    cross-platform infostealer; attributed to Sapphire Sleet (DPRK).
  bridge_contrast: >
    Mastra is in Bridge's stated stack. Two live concerns follow. The supply-chain compromise is a
    dependency-pinning and provenance question for the Commons supply-chain work, not a hypothetical.
    And the snapshot-only-at-suspend model plus JSON-serializable constraint should be checked
    against any Bridge use of Mastra for Automation execution, because Bridge's Run durability
    promise is stronger than what Mastra delivers.
```

### 3.4 Workflow automation and prosumer agents

```yaml
- platform: n8n
  shape: graph/DAG over an item stream; nodes pass arrays of items
  primitives: >
    workflow / node / connection / trigger node / item / execution / credential / expression /
    project / CLUSTER NODE (root node + sub nodes) / data pinning / evaluation
  standout: >
    The cluster node / root node / sub node abstraction is the cleanest reconciliation of "graph"
    and "agent" in the field: the AI Agent node is a root node, and Chat Model, Memory, Tool, Vector
    Store, and Output Parser are sub nodes ATTACHED to it rather than nested inside it.
  A10_humans: >
    Three native mechanisms — Send-and-Wait operations on messaging nodes; the Wait node with four
    resume modes; and per-tool human review for AI tool calls across six channels, where the
    reviewer sees $tool.name and $tool.parameters. Works on free self-hosted Community edition.
  A12_durability: >
    The Wait node is the durability boundary — it offloads execution data to the DB, but ONLY for
    waits over 65 seconds. No retry-from-failed-node; whole-execution retry only. Queued executions
    cannot be retried at all.
  A6_verification: >
    Real eval vocabulary — dataset (Data table or Google Sheet), Evaluation Trigger, Evaluation node,
    metrics, test run, ground truth. Built-in metrics: Correctness (AI, 1-5), Helpfulness (AI, 1-5),
    String Similarity, Categorization, Tools Used. "In n8n, metrics are always numbers."
  licensing: >
    Sustainable Use License — "internal business purposes" only; not OSI open source. Excluded from
    Community: Projects, SSO, external secrets, multi-main mode, log streaming, sharing, git.
  limits: >
    Documented memory blowups (n8n ships a fix-memory-issues page). Database bloat from execution
    data is the most-cited production pathology. Historic code-node RCE CVEs.
  bridge_contrast: >
    n8n's cluster-node pattern deserves serious consideration for Bridge's View Grammar and Module
    manifests: it gives a governed way to say "this Agent's model, Memory, and Tools are declared
    attachments" without inventing a nested execution semantics. Its evals are ahead of Bridge's —
    Bridge has designed the Agent Quality Vector and eval harness (docs/wiki/agent-eval.md) but
    shipped none of it, while n8n has datasets, metrics, and a test-run loop in the product today.
    Bridge's advantage is that its metrics derive from an existing governed Ledger rather than a
    parallel eval store. The licensing history is a direct warning for Commons: "fair-code" ambiguity
    cost n8n years of trust disputes, so Commons entry licensing must be unambiguous from day one.

- platform: Relay.app
  status: >
    SHUTTING DOWN — 2026-08-15 for free users, 2026-09-14 for paying customers. Data export offered;
    unexported content permanently deleted at wind-down. Treat as a post-mortem.
  A10_humans: >
    The best HITL type system surveyed, and the reason to study it. Two typed step kinds (Request
    approval, Send input form) with: medium (Slack or email), assignee (workspace member, arbitrary
    email, or Slack channel), message with variables, DUE DATE, additional reminders, run-owner
    notifications, and ESCALATION BEHAVIOUR after the due date — skip, end, or reassign.
    Run states include a distinct "Action required" bucket.
  A12_durability: >
    Retry failed steps = genuine in-place partial re-execution of only the errored steps. Replay =
    start a new run using the same data. This is retry-from-failure, which n8n lacks.
    Waiting runs are exempt from retention deletion.
  limits: "Wait steps can take up to one hour to be registered" (own docs). Path merging fragile. Cloud-only.
  bridge_contrast: >
    Two lessons, one design and one strategic. Design: Bridge's Review Mode computes WHETHER
    approval is needed but carries no assignee, due date, reminder, or escalation semantics. Relay
    shows what a complete governed approval object looks like, and Bridge's approve/quorum modes are
    incomplete without it — an approval that no one is accountable for and that never escalates is a
    silent stall, which is exactly the failure Bridge's Failure Event model exists to route.
    Strategic: a cloud-only control plane with no self-host escape hatch is an existential risk to
    the customer, and it just materialised. That is the clearest external validation of Bridge's
    Local Plane and of Commons being content-addressed and signed rather than a hosted dependency.

- platform: Zapier Agents
  history: was Zapier Central; the "behavior" primitive was REMOVED 2025-05-22 and force-migrated
  shape: conversation/LLM-driven agent loop — instructions + trigger + tools + knowledge, no canvas
  bounds: activities-per-run ceiling of 10 (Free) / 40 (Pro, Enterprise); at the limit the agent requests user input
  A10_humans: >
    A "Needs action" queue plus PROMPT-INSTRUCTED approval ("you can request approval before
    executing critical actions") — not a typed step. No assignee, due date, reminder, or escalation.
  metering: >
    Every trigger fire, knowledge lookup, action, web fetch, and web search is one activity.
    Zapier's own example: one morning email run with two matching emails = SEVEN activities.
    At quota, triggers stop being received at all — silent automation failure.
  limits: >
    Agents are "personal automations tied to your account"; cannot be embedded or shared as a
    customer-facing experience. No documented error handling, retry, replay, or eval for the agent
    layer. Strength is the 9,000+ app connector library and Zapier MCP as a credential broker.
  bridge_contrast: >
    Zapier Agents is the clearest case of prompt-asserted governance: approval exists because the
    instructions ask for it. tau-bench's finding that a policy document in context yields under 50%
    success is the direct empirical rebuttal, and it is the sharpest available justification for
    Bridge's position that the kernel decides and the Agent explains. Zapier MCP is nonetheless the
    most mature external Credential Broker in production — "Zapier handles OAuth, credentials, and
    API complexity so you never touch a token" is exactly Bridge's Credential Broker contract, at
    9,000-app scale.

- platform: Lindy
  shape: trigger-rooted step graph on a canvas with LLM-autonomous agent steps embedded
  standout: >
    Durability via LISTENING CHANNELS rather than a wait node. An email-send action forks into
    "After email sent" and "After reply received" — the latter suspends and wakes with full thread
    context. Multiple channels per agent, each maintaining its own conversation thread, so one agent
    holds many concurrent suspended conversations.
  A5_state: >
    Richest cross-run memory of the prosumer set: Memories (durable text injected every execution,
    with a first-party "save memories" action so agents write their own), Learned Instructions
    (built from user behaviour over time), Knowledge Base, Meeting Library, Task Context.
    Memory depth is explicitly a credit-cost lever.
  A6_verification: >
    The only platform surveyed with a documented SIDE-EFFECT-FREE eval mode: "Eval runs consume
    credits but don't execute real actions." LLM-as-judge scorers at step and task level.
  limits: >
    No documented retry, backoff, error branch, or idempotency primitive. Credit burn is the
    dominant complaint; overage at 2x; credits do not roll over; teammate caps enforced only AFTER
    execution. Trustpilot 2.4/5 (secondary). Support quality reported as degraded (UNVERIFIED).
  bridge_contrast: >
    Lindy's listening channels are a better primitive than Bridge currently has for the same job:
    Bridge models a Signal as a surfaced Event, but has no first-class "this Run is suspended
    awaiting a specific future Event, and will resume with its thread context". Its
    agents-write-their-own-Memory action matches Bridge's Memory-is-correctable-and-inspectable
    canon, though Bridge requires the write to be a governed Action. The dry-run eval mode is
    directly adoptable and cheap: Bridge's Action Pipeline already separates propose from commit, so
    a no-commit eval Run is a smaller change for Bridge than it was for Lindy.
```

### 3.5 LangGraph / LangChain

Treated separately because it is the most widely deployed graph orchestrator and the closest
external match to what Bridge's Run and Review Mode are trying to be.

```yaml
- platform: LangGraph / LangChain
  naming: >
    Renamed Oct 2025 — LangGraph Platform -> LangSmith Deployment; LangGraph Studio -> LangSmith
    Studio; LangGraph Server -> Agent Server. Agent Server is now framework-agnostic and hosts
    LangGraph, LangChain, Google ADK, Claude Agent SDK, Strands, CrewAI, and AutoGen.
  A3_control: >
    Pregel/BSP. Nodes start inactive, activate on a message, execute, write updates, then vote to
    halt. All nodes active in a superstep run in parallel; the superstep is the transaction
    boundary. State is a set of channels; a node returns a partial update and the channel's REDUCER
    merges it. Parallel writes to a non-reducer channel raise InvalidUpdateError.
  primitives: >
    StateGraph / node / edge / conditional edge / START / END / Command(update, goto) /
    Send (map-reduce fan-out) / superstep / thread + thread_id / checkpoint + checkpoint_id +
    checkpoint_ns / StateSnapshot / Store (cross-thread, tuple namespace) / interrupt() /
    RetryPolicy / CachePolicy / durability("exit" | "async" | "sync") / recursion_limit
  A5_state: >
    Short-term = thread-scoped checkpointer (Postgres schema is four tables: checkpoints,
    checkpoint_blobs, checkpoint_writes, checkpoint_migrations). Long-term = Store with tuple
    namespaces and optional semantic search. This is the clearest short-term/long-term split in the
    field.
  A10_humans: >
    interrupt(payload) raises GraphInterrupt, checkpoints, and surfaces __interrupt__; resume with
    Command(resume=value). Static variants via interrupt_before/interrupt_after.
    HumanInTheLoopMiddleware supports per-tool allow_accept / allow_edit / allow_respond.
  the_critical_flaw: >
    LangGraph's own docs state it: "Because interrupts work by re-running the nodes they were called
    from, side effects called before interrupt should (ideally) be idempotent." A node re-runs FROM
    THE TOP on every resume, so an API call before the interrupt fires again — the documented
    failure is "create ticket + email customer" creating the ticket TWICE. Resume matching is
    strictly INDEX-BASED, not by tool-call id. Open issues: #6208 (multi-interrupt nodes re-run
    after one resume; maintainer's sanctioned workaround is "chain multiple nodes instead"),
    #6626 (parallel tools in one ToolNode get identical interrupt IDs), #4796 (subgraphs restart
    from entry). Design rule that follows: one side-effecting operation per node, never mix
    auto-exec and approval-required tools in one node.
  A12_durability: >
    Replay re-executes; it is not deterministic caching. Docs verbatim: "LLM calls, API requests,
    and interrupts fire again and may return different results." Checkpointing happens BETWEEN
    nodes, never INSIDE one — Temporal's public critique is that this is not durable execution, and
    LangChain published a rebuttal page, which confirms the critique landed.
  operational_costs: >
    Checkpointer write amplification is the most-reported production problem. Open issues report
    ~100 rows per graph trip (langgraphjs#1138, no maintainer response since 2025-04-29) and "85%
    storage bloat and 37.8% token overhead with no opt-out path" (langgraph#7714). One practitioner
    measured checkpoint_blobs growing to 56 MB across ~18,000 records in ONE WEEK of staging.
  licensing_trap: >
    langgraph and langchain-core are MIT, but langgraph-api — the server runtime providing HTTP,
    persistence, and streaming — is ELASTIC LICENSE 2.0. Running `langgraph dev` or `langgraph
    build` uses it. LangChain staff confirmed on the record that full self-hosting of production
    workloads requires an enterprise license.
  security: >
    CVE-2025-67644 (SQLi in langgraph-checkpoint-sqlite) chains with CVE-2026-28277 (unsafe msgpack
    deserialization) for RCE on self-hosted via get_state_history(). CVE-2025-68664 (CVSS 9.3,
    langchain-core deserialization leaking API keys). The checkpoint store is simultaneously the
    performance bottleneck and the attack surface.
  residency: EU / APAC / AWS-US endpoints at all plan tiers, no extra cost — better than most
  bridge_contrast: >
    This is the most instructive entry in the whole document, because LangGraph made a specific
    architectural choice Bridge has so far avoided by accident, and it went badly. LangGraph's
    interrupt is a checkpoint-and-replay pause, so the node's prior side effects re-run — which is
    exactly the hazard Bridge's propose/decide split structurally does not have: Bridge computes
    proposedOutput, holds it, and commits ONLY after the Decision, so approval never re-executes
    anything. That is a real and defensible architectural advantage and it should be stated in
    Bridge's own docs, because it is not obvious.
    What Bridge should take: the reducer-channel model is a better answer than Bridge's linear
    Automation step list for any future fan-out, and the short-term-checkpointer versus
    long-term-Store split is cleaner than Bridge's current single Memory umbrella. What Bridge
    should heed: checkpoint write amplification is the predictable cost of the durable-Run
    capability Bridge lacks and wants — any Bridge checkpoint design must specify retention,
    pruning, and a serializer up front, because LangGraph shipped none of those and its users are
    paying for it. And the Elastic-License-2.0 split between an MIT library and a
    commercially-licensed server runtime is exactly the trap Commons must not reproduce.
```

## 4. Convergence: the primitives everyone independently arrived at

Fifteen primitives recur across nearly every harness surveyed. This is the strongest available
evidence about what a harness *must* have, because these were arrived at independently.

```yaml
convergent_primitives:
  P1_tool_loop:
    statement: call model -> classify stop reason -> execute tools -> append -> repeat, bounded
    universal: true
    key_fact: the model never owns control flow anywhere; it emits intents, the orchestrator decides
    bridge: Action Pipeline (propose -> decide -> commit). PRESENT and stronger than most.
  P2_policy_injection:
    statement: policy injected as data/functions, not branched on inside the loop
    bridge: Authority resolver + policy layer. PRESENT.
  P3_instruction_file:
    statement: AGENTS.md as a cross-vendor standard (Linux Foundation); CLAUDE.md read as fallback by Cursor and opencode
    bridge: no equivalent — Bridge's instructions are Module manifests and Agent mandates, which is a deliberate difference
  P4_progressive_disclosure_skills:
    statement: SKILL.md, name+description in context, body loaded on invoke; agentskills.io standard
    bridge: Skill is a governed callable with typed I/O, permissions, risk, budget, tests — a STRICTER object than a SKILL.md, but with no progressive-disclosure loading model
  P5_compaction:
    statement: every harness compacts; the trend is compaction migrating from internal heuristic to USER-OWNED POLICY
    bridge: ABSENT. Compression is a planned Engine family, unbuilt.
  P6_subagents_for_context_isolation:
    statement: intermediate output stays in the child; only a distilled summary returns
    bridge: Child Agent Run. PRESENT, and the authority-intersection contract is stronger than any external equivalent.
  P7_lifecycle_hooks:
    statement: PreToolUse/PostToolUse/SessionStart/PreCompact/SubagentStop, running OUTSIDE the model context
    bridge: guard/ and policy/ layers run outside the model, but there is no registrable hook surface for Module authors
  P8_capability_x_approval:
    statement: two orthogonal layers — what is technically possible x when to ask
    bridge: Data Scope x Review Mode. PRESENT and the closest external match is Codex.
  P9_llm_as_approver:
    statement: Codex auto_review and Cursor Auto-review both shipped a second model adjudicating the first's tool calls within months of each other
    bridge: DELIBERATELY REJECTED — "kernel decides, agent explains" (ADR, governance-agent wiki). Safety properties of the external approach are unsettled and Cursor disclaims it as not a security boundary.
  P10_isolation_ladder:
    statement: process -> OS sandbox -> container -> git worktree -> full VM
    bridge: ABSENT at every rung. SandboxProvider is a named port with no interface.
  P11_two_phase_credential_stripping:
    statement: setup phase has network and secrets; secrets removed and network disabled before the agent phase
    bridge: Credential Broker resolves at the egress edge, which is adjacent but not the same; no phase separation exists
  P12_session_durability:
    statement: transcript + resume + fork + rewind, universally caveated as NOT version control
    bridge: Runs and Events are append-only and attributable, but there is no fork, rewind, or resume
  P13_client_server_split:
    statement: the TUI/UI is one client of a runtime, not the product
    bridge: PRESENT — three clients over one tRPC API. Independent convergence, a good sign.
  P14_observability:
    statement: least-converged layer; OpenTelemetry where it exists; per-skill/subagent cost attribution is rare
    bridge: Ledger and Decision Trace are richer in governance terms than any external trace, but there is no cost attribution or OTel export
  P15_nobody_ships_evals:
    statement: verification is delegated to the user almost everywhere; n8n and Lindy are the exceptions
    bridge: designed (Agent Quality Vector, two-gate promotion) but unbuilt
```

## 5. Where Bridge stands

### 5.1 Ahead of the field

These are not marketing claims; each is a primitive Bridge has defined that the surveyed field
mostly lacks.

- **Deterministic authority.** Bridge computes an Authority Decision from role grants, capability
  scope, delegation, temporary grants, minus explicit and hard denies. Every external harness either
  has no authority model, or asserts one in a prompt, or hands the decision to a second model.
  tau-bench's under-50% success with a policy document in context is the empirical case that
  Bridge's approach is the correct one.
- **Residency as an architectural boundary.** Local Plane, Cloud Plane, deny-default Plane Gate,
  and Event Partitioning. The field's best equivalents are Microsoft Foundry's customer-subscription
  state and Temporal's Codec Server — both narrower.
- **Runtime taint tracking.** A v1 label lattice with monotonic joins, fail-closed unknowns, and
  immutable declassification, carried through prompts, models, Skills, Actions, Events, Results,
  Files, Memory, Runs, queues, caches, and retries. Nothing surveyed has an equivalent. CaMeL is the
  only comparable idea in the literature and it is a research prototype.
- **Child Agent Run as a bounded authority intersection.** Devin bounds child work physically with
  VMs; Bridge bounds it logically across seven dimensions simultaneously. Both are valid; Bridge's
  is cheaper and more precise, and lacks the physical backstop.
- **Capability Trust Model with earned, decaying trust.** AG2's "Resume" is the only independent
  arrival at the same idea, and it is two days old.
- **An append-only Ledger with Decision Traces.** Governance-grade explainability that no external
  observability stack provides, because none of them are modelling authority.

### 5.2 Behind the field

Stated plainly, because the point of this document is to be useful rather than flattering.

- **No compaction, of any kind.** Every surveyed harness has it; the trend is toward user-owned
  compaction policy. Bridge's Compression Engine family is planned and unbuilt.
- **No sandbox at any rung of the isolation ladder.** `SandboxProvider` is a named port with no
  interface. This is the largest single safety gap relative to the field, and it interacts badly
  with the ambition to run community and AI-generated capabilities.
- **No durable Run resumption or checkpointing.** The glossary defines a Run as "replayable"; MAF,
  Temporal, Hatchet, and ADK all implement some version of that promise and Bridge does not yet.
  Approvals in particular have no documented crash-survival contract.
- **No shipped eval harness.** Designed in detail, built not at all. n8n and Lindy both ship
  working evaluation loops today.
- **No retry, backoff, or idempotency primitives** comparable to Temporal's Retry Policy or
  Hatchet's `retries`/`backoff_factor`. Bridge has a Failure Event type that routes ownership but
  no bounded-recovery mechanics behind it.
- **No cost attribution or OpenTelemetry export.** Claude Code's per-skill/subagent/plugin cost
  breakdown and Lindy's per-step credit attribution are both ahead of anything Bridge records.
- **No approval SLA semantics.** Review Mode says approval is required; it does not say by whom,
  by when, with what reminders, or what happens on expiry.

### 5.3 Different by design, and worth defending

- **No LLM-as-approver.** Two major vendors shipped it in 2026; one of them disclaims it as not a
  security boundary. Bridge's "kernel decides, agent explains" is the better position and should be
  stated as a deliberate rejection rather than an unbuilt feature.
- **No free-text instruction file.** The field standardised on `AGENTS.md`; the ETH SRI study found
  such files *reduced* success rates while raising cost over 20%. Bridge's manifest-and-mandate
  model avoids the failure mode, at the cost of being less approachable.
- **Automations never invoke Skills directly.** Every prosumer platform lets a trigger call a tool.
  Bridge's insistence that an Automation starts a governed Agent Run is what prevents hidden
  authority, and CrewAI's delegation loops plus Zapier's activity cliffs are the counter-examples.

## 6. Vocabulary collisions

Bridge's glossary governs Bridge. This table exists so that reading external documentation does not
silently corrupt Bridge's terms.

```yaml
collisions:
  Workflow:
    external: CrewAI Flows | MAF graph workflows | one of AG2 v1.0's four channel types | n8n's top-level object
    bridge: no such primitive. Closest are Plan (proposed steps) and Automation (trigger + coordination).
  Session:
    external: ADK = thread with an event log | OpenAI Agents SDK = a pluggable history store
    bridge: no such primitive. Run is the execution unit; Context is the assembled subset of Memory.
  State:
    external: ADK = scoped key-value with app:/user:/temp: prefixes | MAF = shared states in a checkpoint
    bridge: no such primitive. Memory is durable and inspectable; Context is temporary.
  Harness:
    external: MAF ships a component literally named Harness
    bridge: Engine is the nearest term, and Engine is explicitly NOT a persona, actor, or authority source.
  Handoff:
    external: appears in AutoGen, AG2, OpenAI Agents SDK, and MAF with four different mechanics
    bridge: Delegation (recorded authority chain) and Child Agent Run are the governed equivalents.
  Swarm:
    external: AutoGen 0.4 HandoffMessage teams AND AG2 Classic's ON_CONDITION/AFTER_WORK handoffs
    bridge: rejected as an execution model — "Planner proposes a DAG, governed deterministic DAG executes" (wiki/rituals.md)
  Skill:
    external: SKILL.md markdown file with progressive disclosure (agentskills.io)
    bridge: a governed, versioned, callable capability with typed I/O, permissions, Plane/data scope, risk, budget, and tests. STRICTER. Do not let the file format redefine the primitive.
  Memory:
    external: Lindy = injected text | Mastra = resource+thread | ADK = a semantic MemoryService | n8n = a chat-history sub node
    bridge: umbrella for retained, inspectable, Module-associated information — Records, Relations, Events, Facts, Results, Files, and approved learning, each keeping its own type.
  Agent:
    external: CrewAI = role+goal+backstory | ADK = "a self-contained execution unit" | Zapier = instructions+trigger+tools
    bridge: bounded reasoning actor with a mandate, capability scope, attributable activity, and an explicit Skill set. Only Agents consume Skills.
```

## 7. Health warnings on the field

Relevant to any build-versus-adopt decision, and to Commons.

```yaml
- vendor: OpenAI
  event: Agent Builder + Evals shut down 2026-11-30 (read-only 2026-10-31), ~13 months after launch
- vendor: Relay.app
  event: entire product shutting down 2026-08-15 / 2026-09-14
- vendor: Microsoft
  event: AutoGen in maintenance mode since 2025-09-30; users migrated 0.2 -> 0.4 -> MAF, plus Semantic Kernel -> MAF
- vendor: AG2
  event: v1.0 (2026-07-27) is "not a drop-in upgrade"; the whole prior framework relegated to ag2-classic — a second forced migration by a team that forked partly to promise stability
- vendor: Mastra
  event: ~145 npm packages compromised June 2026 via a hijacked maintainer account (attributed Sapphire Sleet, DPRK); v1 broke nearly every subsystem in Jan 2026; hosting product replaced Apr 2026
- vendor: OpenClaw
  event: CVE-2026-25253 (CVSS 8.8) plus two command-injection flaws; 40,214 exposed instances, 35.4% flagged vulnerable
- vendor: CrewAI
  event: memory API unified in v1, invalidating most existing documentation; four CVEs in 2026 (severity UNVERIFIED)
- vendor: n8n
  event: ongoing "fair-code" licensing disputes over what "internal business purposes" permits
- implication_for_bridge: >
    Adoption risk in this category is dominated by vendor churn, not by capability. Anything Bridge
    depends on must sit behind a port, and anything Bridge publishes to Commons must be
    content-addressed, signed, and exportable — because the two clearest failures of 2026 were a
    hosted control plane disappearing and a package registry being compromised.
```

## 8. Sources

Primary sources are cited inline per platform above. The consolidated source list, the academic
literature, and the empirical-versus-opinion tagging live in
[`learnings-and-next-steps.md`](learnings-and-next-steps.md). Bridge-side claims are cited to
[`primitives.md`](primitives.md), which carries the file-level evidence.
