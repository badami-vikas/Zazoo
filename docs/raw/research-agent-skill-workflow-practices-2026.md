---
title: Best-practice research — agents, skills, workflows, evals (2026-07 sweep)
type: raw
doc_kind: research
status: adopted
companions:
  - vision-pivot-living-software.md
  - client-architecture-context-providers.md
related_wiki: ../wiki/roadmap.md
updated: 2026-07-06
tags: [agents, skills, workflows, evals, durable-execution, competitors, research]
---

# Best-practice research sweep (2026-07-06)

User directive: research Hermes/OpenClaw-class agents, Claude/Pi skills, workflow/ritual/task engines; fold best practices into Bridge's roadmap. Executed via web-research sub-agents. This doc = condensed synthesis; each section ends with what Bridge adopts.

## 1. Agent frameworks (Claude Agent SDK, OpenAI Agents SDK, LangGraph, CrewAI, Agno, AutoGen, Hermes, OpenClaw, Vida/Invoko/AirJelly)

Key verified findings:
- **Claude Agent SDK**: agents = markdown + YAML frontmatter (name, description for auto-delegation matching, tools allowlist + disallowedTools denylist with deny-first precedence, model, memory scope w/ auto-curated 200-line/25KB MEMORY.md ceiling). **Star topology — subagents never talk peer-to-peer, only report to caller** → structurally eliminates handoff loops. Fresh isolated context per delegation.
- **OpenAI Agents SDK**: handoffs exposed to the model AS TOOLS; **approval = paused serializable state resumed later, not a re-run** (`needsApproval` → `interruptions` + state). Guardrails scoped by position (input = first agent only, output = last only). Tracing default-on as structured spans.
- **LangGraph**: `interrupt()` = modern HITL primitive; every node writes a checkpoint keyed by thread_id; anti-patterns: blobs in state (store refs), no checkpoint TTL, unbounded message growth.
- **CrewAI "2B workflows" postmortem**: architecture beats prompt engineering; **successful teams started at 100% human review and ramped autonomy DOWN over weeks** — direct validation of Bridge's trust model; runaway self-invocation loops = their top failure mode.
- **AutoGen**: `human_input_mode` NEVER/ALWAYS/TERMINATE — 3-tier oversight dial ≈ coarse risk bands.
- **Agno**: explicit split of Teams (ad-hoc collaboration) vs Workflows (deterministic pipeline) — matches Bridge's agent-collab vs Ritual split.
- **Ambient agents**: Hermes (Nous Research, OSS, self-authored skills, local-first); OpenClaw (SKILL.md dirs, **workspace > global > bundled precedence**); Vida (two products under one name — disambiguate when citing competitively); Invoko (macOS Fn-key voice); AirJelly (**captures on Enter-key press** — concrete comparator for the avatar-blink tell). None publish architecture/guardrail internals — marketing only.
- Industry-wide #1 documented failure: **infinite handoff loop** (A→B→C→A, directive misalignment). Mitigations: hard turn cap (~12), arbiter agent, return best-so-far + degraded-confidence flag.

**Bridge adopts**: star topology w/ Chief of Staff as sole router (no peer handoffs); approval-as-resumable-state in the pipeline (pending proposals already are persisted state — keep it that way through workflow layer); deny-first precedence in capability scope computation; hard chain-depth cap + best-so-far fallback for capability composition; per-agent memory file w/ size ceiling; autonomy ramps down from 100% review (already the trust-model design — now evidence-backed).

## 2. Skills (Claude Skills / agentskills.io spec; Pi verdict)

- **Pi skills: Inflection's Pi has NO public skill spec** (tool-calling is an undocumented beta label). `pi.dev` = unrelated OSS coding agent implementing the open **agentskills.io** spec — that spec is the real reference.
- **SKILL.md spec**: frontmatter `name` (≤64 chars, kebab, = dir name) + `description` (≤1024 chars, MUST state what + when) required; optional license/compatibility/metadata/allowed-tools. Claude Code extensions (not in spec): `when_to_use`, `disable-model-invocation`, `context: fork`.
- **Progressive disclosure, 3 levels**: L1 metadata always loaded (~100 tokens/skill); L2 body loaded on trigger (<500 lines / <5k tokens); L3 references/scripts/assets loaded on demand (zero cost until read; script code never enters context — only output).
- **Discovery = semantic matching over descriptions** (no embeddings API documented) — description quality is THE selection lever, "could Claude pick this among 100+ skills."
- Authoring: gerund names; third person; **build evals BEFORE docs** (3+ test scenarios, minimal instructions to pass, iterate); match instruction rigidity to task fragility (high freedom vs exact scripts); references one level deep only; no explicit skill→skill invocation — composition is implicit via model reasoning.

Second-pass additions (separate sweep, confirmed): skill STACKING (multiple skills loadable in one invocation, ~6 cap) but no nested skill→skill invocation — composition = stacking or skill-as-subagent; skill-listing context budget ≈1% of context window with least-used descriptions dropped first; storage precedence enterprise > personal > project (another instance of scope-precedence); **OpenAI GPT Actions `x-openai-isConsequential: true` = per-operation "requires user confirmation" flag on an OpenAPI op** — the closest any vendor gets to per-capability approval flags, still binary vs Bridge's computed bands; **MCP triad**: tools = model-controlled, prompts = user-controlled, resources = application-controlled (useful vocabulary for Bridge's capability taxonomy); MCP versioning = date-based (YYYY-MM-DD), bumped only on breaking change, negotiated at handshake, deprecated features live ≥12 months.

**Bridge adopts**: generated skills use the agentskills.io shape (name/description/when-to-use folded into description) + Bridge manifest extensions (permissions/connectors/risk — our capability manifest already covers this); Capability Builder must generate the EVAL SET before/with the skill body (promotion evidence = these evals); progressive disclosure maps to our L1 registry / L2 manifest / L3 impl split; workspace > global > bundled precedence for capability resolution (matches user-naming-wins rule).

## 3. Evals gating generated artifacts (promptfoo, Braintrust, Mastra evals)

- **promptfoo**: rich assertion taxonomy (deterministic + model-graded + trajectory/tool-call assertions incl. `trajectory:tool-sequence`, `is-valid-function-call`); CI gating = DIY exit-code pattern, **no first-class "promotion gate" object**. Red-team plugins (injection, BOLA/BFLA, excessive agency, PII leakage) — relevant to validating generated capabilities.
- **Braintrust**: autoevals scorer library; GitHub Action posts score deltas on PRs; threshold gating only via custom Reporter API, **not built-in**; "canary/promotion" = marketing-article concept, not shipped product.
- **Mastra**: current Scorers API (`answer-relevancy`, `faithfulness`, `hallucination`, `tool-call-accuracy`, `trajectory-accuracy`, rule-based `checks.*` incl. `checks.calledTool`/`toolOrder`/`maxToolCalls`); `runEvals()` in any ESM test runner; **live evals sample production traffic (sampling rate 0-1) async without blocking** — exactly the heartbeat shape; trace-based retro-scoring of historical runs. "Gates and verdicts" concept exists but API un-documented.
- **Competitive conclusion: nobody ships promotion gates as first-class objects.** Bridge's lifecycle states + promotion evidence thresholds as kernel tables = genuinely differentiated.

**Bridge adopts**: Mastra scorers behind the eval port for capability heartbeats (live sampling + trace retro-scoring); promptfoo-style trajectory assertions (`calledTool`/`toolOrder`/`maxToolCalls`) as the shape of workflow-eval checks; red-team assertion pack as a validation-stage gate for External-band capabilities; promotion gates stay first-class kernel objects (differentiator — do not outsource).

## 4. Durable workflow engines (Temporal, Hatchet, Inngest)

- **Temporal**: RetryPolicy (InitialInterval/BackoffCoefficient 2.0/MaximumInterval/MaximumAttempts/NonRetryableErrorTypes); idempotency = convention (RunID+ActivityID key); versioning via `patched()`/`deprecatePatch()` markers in event history; non-determinism detected by replay divergence; determinism constraints (no clock/random/IO in workflow code — Side Effects/Activities).
- **Hatchet**: `retries` + `backoff_factor`/`backoff_max_seconds`; durable tasks checkpoint to event log, replay from checkpoint; durable tasks may only WAIT (sleep/event) or SPAWN child tasks; DAGs = upfront `parents=[...]` declaration, per-task result persistence, auto-parallelism; `on_crons` + `on_events` (wildcards); explicit HITL use case.
- **Inngest**: step memoization (each `step.run()` result persisted, replays inject results by step-name hash); `retries` per-step not pooled; `NonRetriableError`/`RetryAfterError`; **`id` on send = 24h event dedup; `idempotency` = CEL expr per-function**; cron trigger w/ TZ + jitter; `step.waitForEvent()` for HITL.
- Cross-cutting: all three = checkpoint/replay + idempotency-as-caller-duty + explicit HITL wait primitives. None do cross-deploy versioning except Temporal's patch markers.

**Bridge adopts** (RitualExecutor seam requirements — whichever engine binds later must support): per-step checkpoint + resume (approval pause = durable wait, not poll); idempotency key convention = (ritual_run_id + step_id) on every mutating skill call, enforced at pipeline level; `NonRetryable` error class distinction in skill contracts; ritual versioning = patch-marker style (in-flight runs finish on old version; capability version pinning already gives us this for capabilities); Temporal-style determinism constraints documented for ritual step authors; Hatchet remains the preferred first binding (Postgres, HITL-native, wait-or-spawn model fits governed rituals).

## 5. Generated-workspace approval patterns (Notion AI, Fibery, Noloco)

- **Notion AI**: preview→Continue ONLY for new-database creation; Autofill writes directly (advisory "check accuracy" note); Agents = post-hoc model (undo + version history + audit logs, "every run logged, all changes reversible"), NO pre-apply approval.
- **Fibery**: AI builds whole workspace directly ("observe how Fibery creates"); fix-after-the-fact iteration; Smart Agent (early preview) = direct data manipulation, no documented gate; approval workflows exist only as user-built automation patterns.
- **Noloco/Nola**: generates tables/relations/pages directly, "working app in minutes"; only gate = generic "live mode" publish toggle, not AI-specific.
- **None documents a side-by-side diff of AI-proposed vs current state.**

**Bridge adopts/positions**: blueprint-as-governed-proposal (persisted draft object + diff + approval card) = the moat vs the entire generated-workspace category; marketing line writes itself ("they undo after; Bridge approves before"); post-hoc reversibility is still worth having (Notion's "all changes reversible" is a trust feature) → rollback field in capability manifests already covers this, extend to blueprint applications.

## 6. Tool/skill design anti-patterns (Anthropic, OpenAI, MCP, LangChain, Chroma)

- Anthropic: bloated/overlapping tool sets distract agents; thin API-wrapper tools = low leverage; outputs must be filtered/paginated (context is a public good); cryptic ids in outputs degrade reasoning; error messages must suggest fixes; "if a human engineer can't say which tool applies, the agent can't either"; simplest architecture that works.
- OpenAI: <20 functions active per turn (soft ceiling; use deferred tool search beyond); schema must make invalid states unrepresentable (enum not dual-bool); don't make the model fill known arguments; consolidate always-sequential functions.
- MCP: `readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint` annotations; **unannotated = assumed destructive/non-idempotent/open-world (pessimistic default)**; "a server can lie" — never trust self-declared annotations from untrusted sources; **lethal trifecta** (private data + untrusted content + external comms) = exfiltration pattern.
- Chroma "Context Rot": accuracy degrades non-uniformly with input length (primary research); 20-tool/95→71% figures = practitioner anecdote, unverified.

**Bridge adopts**: capability registry exposes ≤20 active tools per agent turn (deferred lookup beyond — registry already supports this shape); manifest annotations mirror MCP's four hints BUT risk stays COMPUTED, never trusted from the manifest author (we already had this — MCP's "server can lie" is the independent confirmation); lethal-trifecta check as an explicit policy rule: any capability combining private-data read + untrusted-content ingestion + egress is auto-escalated to External band regardless of computed risk; generated tools must return filtered/paginated, human-readable outputs (Capability Builder codegen rule); invalid-states-unrepresentable as a manifest schema lint.

## 7. Skill generation + workflow-builder lifecycles (final sweep)

### Skill generation
- **Anthropic skill-creator** (primary source, github.com/anthropics/skills): capture intent → interview edge cases → write SKILL.md → 2-3 realistic test prompts → **parallel with-skill vs baseline runs** → objective assertions → benchmark.json (pass_rate/timing/tokens) → human feedback loop until empty → **separate description-tuning subsystem**: 20 should/should-not-trigger queries, human-approved eval set, 60/40 train/test optimization loop (≤5 iterations, select on held-out test). **TWO INDEPENDENT GATES: output quality AND trigger precision/recall — promoted separately.** Evals also detect regression-on-model-update and obsolescence (base model absorbed the capability).
- **MUSE-Autoskill** (arXiv 2605.27366): skills from recurring execution patterns start as DRAFT, must clear a minimum success-rate threshold on originating tasks (draft→usable) + separate **generalization test on novel tasks** to filter overfit skills. Near-ready spec for our Draft→Validated evidence thresholds.
- **Hermes auto-skill-from-repetition** (~5 repeats → auto-draft SKILL.md; self-rewrite from own run logs): LOW CONFIDENCE — content-mill sources only, no primary spec. Corroborate before citing.
- **Gap = original Bridge design territory**: skill TEMPLATE LIBRARIES (parameterized scaffolds at generation time) — no public precedent found.

### Workflow builders (Zapier/Make/n8n)
- **Zapier version lifecycle** (best transferable model): Private → Promoted (only ONE at a time; requires all validation checks) → Available (prior promoted auto-demotes; existing users unaffected) → Legacy → Deprecating (grace period) → Deprecated. Draft edits never touch the live version; publish = new immutable version; **rollback = fork new draft from any historical version, never in-place revert** (immutable history = audit-friendly).
- **n8n**: autosave = draft; production always runs last PUBLISHED (pinned) version; unpublish/restore without disturbing prod. Per-node retry-on-fail / continue-on-fail / error-branches (richer than Zapier's blanket retry).
- **Gaps = Bridge original design territory**: full multi-step DRY-RUN with no side effects, and PER-STEP human-approval gates mid-workflow — NOT shipped as first-class features by any no-code builder found. (Engine-layer signal/wait primitives are the closest analog.) Bridge shipping both = differentiation, not catch-up.

### Durable-engine convergence (confirms §4)
All three converge on: zero-compute suspend until human signal (HITL); version markers/step memoization for in-flight runs surviving code changes; idempotency as declared config (Inngest CEL keys) not implicit assumption; deterministic-replay constraints as explicit authoring rules.

**Bridge adopts (top of the STEAL list)**:
1. Two-gate promotion for every generated capability: output-quality pass rate + trigger precision/recall, scored independently (skill-creator).
2. Draft→Validated = success-rate threshold on originating tasks + generalization test on novel tasks (MUSE-Autoskill) — plug straight into PROMOTION_DEFAULTS evidence.
3. Held-out eval selection — Capability Builder scores candidates on prompts never seen during generation (no overfitting to own evals).
4. Zapier-style single-live-version + auto-demote-prior-to-available; rollback = fork-from-history, never mutate (fits append-only ledger).
5. Baseline-vs-with-capability parallel comparison as the default eval method (catches false improvement claims).
6. Self-critique loop: post-run log inspection (retries/redundant calls/waste) feeds capability rewrite proposals — generation-time analog of "continuously evolved".
7. Per-step retry/continue-on-fail/error-branch config exposed in generated workflow specs (n8n).
8. Description-tuning as its own automatable subsystem with human-approved trigger eval set — most mis-triggering is a description bug, not logic.
9. Dry-run mode + per-step approval gates = SHIP THEM (nobody has them; engine wait primitives make them cheap).
