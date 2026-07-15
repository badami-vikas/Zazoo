# Learning Agent

full: [../raw/learning-agent-roadmap-2026-07.md](../raw/learning-agent-roadmap-2026-07.md)

1 of 4 permanent agents (ADR-046). Learns from conversations, behavior,
corrections, connected systems, docs; runs research; feeds every other
agent. `neverExecutes: true` — enforced in code, only firm thing built.

**Ground truth (audited 2026-07-12): nearly all greenfield.** @learning =
prompt + one LLM call. Memory/Knowledge kernel primitive ABSENT
(onboarding-profile.ts admits it). Mem0 decision ratified (ADR-010f), zero
mem0 code. PromptAssembler unbuilt. competitor-discovery = "policy
decided, no mechanism". Onboarding profile in-memory only. Signals tables
exist, no producer. Embeddings tables exist, no retrieval. Security audit:
Learning = PRIMARY untrusted-input consumer, no taint marking, no SSRF
client, no quarantine — all HIGH, all unbuilt.

**Core invariants**: learned content = data never instructions; everything
stored inspectable + deletable; suggested-then-accepted for durable user
knowledge (never silent writes); taint tier travels with content forever;
tainted content never meets tool-bearing context (dual-LLM quarantine);
graph stays source of truth (vectors index it, never replace); local plane
never egresses; raw capture local-plane only.

**Failure role:** detects patterns/corrections, proposes improvement. Never
repairs runtime or policy directly. Engine recovers operation; Governance
remediates control failures; Builder changes capability.

**Root taint gap:** metadata+egress check already exist, full runtime flow does
not. RT0–RT4: label+lattice → prompt/model/Skill/Action propagation → source/sink
instrumentation → quarantine/deny → backfill+trace. Unknown label fails closed.

**Slices LA0–LA6**:
- LA0 Memory primitive — MemoryPort + Mem0 adapter; MemoryEntry w/
  provenance/taint/decay; onboarding profile persisted; suggested-Memory
  propose→accept/reject; **injection eval suite starts HERE, permanent
  gate, not retrofitted**.
- LA1 PromptAssembler — persona·capabilities·context·memory·governance
  layers (shared build w/ Builder BA0 — one subsystem two consumers);
  profile → CoS persona (closes foundational-agents open item);
  tone-to-animal mapping (6 vs 14 animals reconciled, tone eval-gated).
  Exit: accepted Memory demonstrably changes agent output.
- LA2 observation loops — corrections/behavior → suggested digest
  (batched, annoyance-capped); Gmail/Docs ingestion taint-tiered;
  Signals producer wired; decay + dedupe; trivial-fact auto-accept behind
  receipted grant (GA2 mechanism).
- LA3 research lane — SSRF-hardened client FIRST (RFC-1918/metadata
  block, rebinding guard), THEN crawlers; competitor-discovery skill →
  CompetitorBrief (cited, dated, no hardcoded competitors — ADR-012e);
  dual-LLM quarantine; all fetches via pipeline external:fetch.
- LA4 integration-over-build — installed-software discovery (explicit
  permission, logged); overlap detect vs Registry + Commons; research
  handoff Builder consumes ("install instead?" evidence). Exit:
  integrable tool intent → integration proposal not from-scratch build.
- LA5 RAG layer — graph traversal + vector + structured filter fused;
  personal/workspace/external layers; retrieval evals baselined,
  regressions block ship; cross-plane leak test hard invariant.
- LA6 ambient — sensor context stream, local models local plane; ambient
  Signals rate-capped, dismissals teach; capture contract (inspectable,
  blink tell); injection-via-screen suite closes audit HIGH gap.

**Metrics**: injection pass == 100%, unauthorized writes == 0, executed
actions == 0, cross-plane leaks == 0 (hard). Suggestion acceptance rate.
Retrieval precision/recall. Integrate-instead-of-build % (shared w/
Builder).

**Top risks**: prompt injection (biggest surface in platform — taint from
LA0) · memory poisoning (suggested-then-accepted + provenance visible) ·
privacy creepiness (accurate-but-unsettling kills trust — inspect/delete
everything, blink tell) · Firecrawl AGPL (behind port, service-use only) ·
vector store becomes second source of truth (refs not copies, rebuildable
from graph) · 3 external gates (LA4 Registry, LA5 EVAL-1/2, LA6 sensor
plane) — LA0–LA3 self-contained, deliver standalone.

No sequencer reorder. LA0/LA1 refine P0–P1 tracks (ADR-031/034).
