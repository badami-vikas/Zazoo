# Agent Eval — "what better means"

full: [../raw/agent-quality-eval-model-2026-07.md](../raw/agent-quality-eval-model-2026-07.md) · 2026-07-08.

Closes the biggest Living-Software gap: **"better agent" was defined nowhere** (self-improve
thesis had eval *patterns*, no numbers). This = the buildable definition.

**Principles**: measurement = pure fn over ledger, never a model call · NO new telemetry —
all numbers derive from the execution snapshot + ledger `userDecision` + `capability_states.evidence` already spec'd · **two independent gates** (output-quality AND
trigger-precision/recall) · "better" = beats current baseline on a **held-out** set it didn't
author · **safety = veto axis** (one violation caps promotability, can't buy back with accuracy)
· all thresholds = `policy_params`, Variance-Adjuster-tunable.

**Unit matters** — "better" differs per primitive: Skill = correct output + right trigger ·
Automation = reliable/cheap/replayable DAG · **Agent = good routing/decomposition + earned
autonomy** · Workspace = adoption/low-correction cohort.

**Agent Quality Vector (7 axes, each 0–1, each computed from recorded data)**: success
(approve/veto/edit ledger) · correction-rate (edit freq + diff size — best utility predictor) ·
routing P/R (Gate B, held-out label set + `@name` overrides as recall-miss heartbeat) · output
quality (Gate A, LLM-judge calibrated vs approve/veto, held-out) · reliability (clean
completions) · **safety (VETO)** · cost/latency efficiency (tie-break + demotion pressure, never
a promotion blocker alone). Display composite exists for dashboards; **gates decide**, not the
scalar.

**Eval harness** = adopt PATTERN (LangSmith/Braintrust/Mastra-evals), host in Commons (moat, same
logic as OPA/OpenFGA reject). Typed + ports: `EvalCase/EvalDataset/Scorer/EvalRun/Comparison`,
in-memory adapter first. Manifest `evaluation` block (was untyped JSONB) now schema'd:
`datasets[]/gates/scorers/baseline/min_cases`. Harness results write back to
`capability_states.evidence` — the missing join.

**"Better" rule**: Draft→Validated = absolute gates on origin tasks + generalization on novel
(MUSE) · Validated→Active = baseline-vs-candidate held-out, promote iff ≥ on BOTH gates, no
safety/correction regression, non-overlapping 95% CI; else reject / coexist (scope to winning
clusters) / needs-human · Active→**Trusted** = sustained window (success ≥.95, 0 violations, ≥30
runs, ≥60d, correction <.10) — this is where "better agent" = "more autonomous", earned per
(class,workspace,user), decays on 90d TTL.

**Anti-gaming**: held-out (no grading own homework) · description-tuning = own subsystem w/
separate human-approved trigger set · red-team pack gates External band · self-critique = post-run
friction → *proposed* rewrites (governed).

**Governance "org health"** (other undefined phrase) now computable: autonomy-pressure · trust-debt
· approval-load/queue-health · violation-trend; minor/moderate/major approval bands mapped to risk
bands × origin.

**Build order** (P3, reuses P0/P1): #1 scoring reducer over existing snapshots (5 of 7 axes need
zero new tables — SHIP FIRST) → EvalStore port → deterministic scorers → baseline-compare in
`capability.approve` → LLM-judge → org-health rollup → description-tuning last. **Highest leverage
= #1**: Bridge already records everything; nothing reads it as quality yet.
