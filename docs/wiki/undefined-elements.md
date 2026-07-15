# Undefined Elements — found + defined

full: [../raw/undefined-elements-definitions-2026-07.md](../raw/undefined-elements-definitions-2026-07.md) · 2026-07-08.
Companion: [agent-eval](agent-eval.md) (defines #1 in full).

Swept wiki/raw/BUGS for gap markers (TBD/open-Q/deferred/"no real"/"not yet") + structural
undefinedness (primitives named in ontology, never spec'd). ~21 found; top 13 defined in full
(what/why · repo state · 2-4 named competitors w/ pro-con-license · Bridge-native design · open
decisions). Cross-cutting: the **self-improvement/measurement layer is the least-defined and
most load-bearing** — nearly everything touching eval/quality/self-improve was prose-only.

**Ranked by leverage (top 13):**
1. **Eval harness + "what better means"** — the promotion gate; nothing evolves safely without it.
   → defined in [agent-eval](agent-eval.md). Verdict: `EvalHarness` port, two-gate promotion
   (quality AND trigger P/R), deterministic replayable runs writing to the ledger; private
   datasets never cross the gate.
2. **Component Registry + similarity/overlap detection** — ground truth for "does this already
   exist?" Verdict: reuse `capability_manifests` w/ `kind` discriminator; two-tier similarity —
   pure-SQL structural first, pgvector semantic only when inconclusive.
3. **Memory subsystem** (schema/classification/retrieval/Mem0 port) — the deferred P3 table the
   whole "learns how you work" promise sits on. Verdict: don't fork `timeline_entries`; thin
   `memories` table for confirmed/superseded facts; authority-scoped retrieval at store boundary;
   Mem0 optional adapter, pglite default.
4. **Variance Adjuster tuning algorithm** — "veto tunes params not code" had no param space / update
   rule. Verdict: `policy_params` = the tunable space; veto reason-chip → bounded single-param nudge
   proposed as a governed diff; hard ceilings physically outside the space.
5. **Blueprint format + compiler contract** — partly built, under-spec'd as a versioned publishable
   manifest. Verdict: freeze `WorkspaceBlueprint` as versioned Commons-publishable manifest;
   `compileBlueprint` stays pure; LLM emits only the declarative manifest, never runtime code.
6. **PromptAssembler** — named ADR-026, no layering model.
7. **Credential broker internals** — opaque-grant stated; rotation/scoping/revocation undefined.
8. **Competitor-discovery mechanism** — "live at blueprint time", no query grammar.
9. **Commons convergence + mining** — thresholds set, mining/generalization pipeline undefined.
10. **Capability Trust Model risk + trust-decay** — bands built, decay entirely undefined.
11. **Avatar + Onboarding profile** — visual style separated from explicit communication preferences; profile→prompt seam remains incomplete.
12. **Memory retrieval layer** — unlock gate exists, Engine does not.
13. **SandboxProvider + Builder toolbelt** — port named (E2B/Daytona later), no interface.

Long tail (8, listed in raw): node_types/plane write-enforcement · workspace_definitions blueprint
grammar · trust_grants budget/kill-switch tables · dream-cycle/reflection rituals · capture
materialization + CaptureLedger · RitualExecutor agentic Planner · Bridge Cloud control-plane sync ·
auto-mode allowlist token grammar.

Every definition honors the same invariants: ports-and-adapters · governed pipeline · two-plane
residency · no hardcoded external evidence · earned-and-decaying trust.
