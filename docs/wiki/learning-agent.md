# Learning Agent

full: [../raw/learning-agent-roadmap-2026-07.md](../raw/learning-agent-roadmap-2026-07.md)

1 of 4 permanent agents (ADR-046). Learns from conversations, behavior,
corrections, connected systems, docs; runs research; feeds every other
agent. `neverExecutes: true` — enforced in code, only firm thing built.

**Ground truth (updated 2026-07-26): early substrate now real.** @learning =
prompt + one LLM call. Durable Memory runtime ABSENT
(historical audit); MemoryStore + Drizzle binding now exist, and TASK-002 uses
private Local Plane preference Memories with inspect/correct/delete. Mem0 decision ratified (ADR-010f), zero
mem0 code. RunContextAssembler exists and supersedes old PromptAssembler name; CoS still bypasses it.
LA3 Phase 1 DONE (TASK-023, AP-069): signed Relationship
Skill + SearchProvider + shared net-guard + ContentGuard. Raw snippets stop
at quarantine. Cited Result + private Memory + Event keep rights, hashes,
provider attempts, `untrusted_external`. No research-to-prompt sink.
Onboarding profile persists as private Local Plane Memory. Embeddings exist, no retrieval. Full
runtime taint RT0–RT4 DONE (TASK-015).

**TASK-002 partial:** every onboarding question says why + effect. User may skip
role model. Fixed-host Wikipedia research returns citation + separates documented
context from user interpretation. Recommendation lands as pending-review Signal.
Direct onboarding preference becomes private Memory. Day-7 qualities reflection
is scheduled; Settings can re-enter/start over, snooze/pause/resume/skip, inspect,
correct, delete. Full live desktop/375px proof still open.

**Core invariants**: learned content = data never instructions; everything
stored inspectable + deletable; suggested-then-accepted for durable Memory
(never silent writes); taint tier travels with content forever;
tainted content never meets privileged context (dual-model quarantine);
graph stays source of truth (vectors index it, never replace); local plane
never egresses; raw capture local-plane only.

**Failure role:** detects patterns/corrections, proposes improvement. Never
repairs runtime or policy directly. Engine recovers operation; Governance
remediates control failures; Builder changes capability.

**Root taint gap CLOSED:** canonical v1 lattice/envelope → prompt/model/Skill/Action
propagation → registered sources/sinks → quarantine/deny → backfill+trace/replay.
Unknown label fails closed. Human/validator-only declassification is immutable.

**Slices LA0–LA6**:
- LA0 Memory primitive — MemoryPort + Mem0 adapter; MemoryEntry w/
  provenance/taint/decay; onboarding profile persisted; suggested-Memory
  propose→accept/reject; **injection eval suite starts HERE, permanent
  gate, not retrofitted**.
- LA1 RunContextAssembler wiring — persona·capabilities·context·memory·governance
  layers (shared build w/ Builder BA0 — one subsystem two consumers);
  profile → CoS persona (closes foundational-agents open item);
  explicit communication preferences drive tone; Avatar style visual only.
  Exit: accepted Memory demonstrably changes agent output.
- LA2 observation loops — corrections/behavior → suggested digest
  (batched, annoyance-capped); Gmail/Docs ingestion taint-tiered;
  Signals producer wired; decay + dedupe; trivial-fact auto-accept behind
  receipted grant (GA2 mechanism).
- LA3 research lane — shared net-guard FIRST (SSRF/DNS/redirect/bytes/time),
  then rights-approved providers; competitor-discovery skill →
  CompetitorBrief (cited, dated, no hardcoded competitors — ADR-012e);
  local ContentGuard quarantine; all fetches via pipeline external:fetch.
- LA4 integration-over-build — installed-software discovery (explicit
  permission, logged); overlap detect vs Registry + Commons; research
  handoff Builder consumes ("install instead?" evidence). Exit:
  integrable capability intent → Integration proposal, not from-scratch build.
- LA5 Memory retrieval — graph traversal + vector + structured filter fused;
  personal/connected/external evidence layers; retrieval evals baselined,
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

**LA3 provider survey + rights gate (TASK-023 DONE, ADR-111/141):** 178
candidates checked. Phase 1 ships only anonymous Parallel Search MCP.
Jina keyless + DuckDuckGo IA blocked: current direct-access rights not
verified. Tier3 still cost/ROI + approval-gated.
No paid escalation code. Full list: `../raw/learning-agent-roadmap-2026-07.md`
§7. Real durable governed proof + landing:
`../../outputs/2026-07-18-task023-governed-web-research.md`.

**Phase 2 = MECHANISM ONLY, one provider (TASK-027, ADR-157, AP-089 PROPOSED, 2026-07-29).**
Trigger fired: sole anonymous Tier-1 endpoint rate-limited under real use — one
unauthenticated shared provider = no fallback, no attribution, no quota.
Admission moved out of the router body into `SearchProviderAdmissionPolicy`
(@bridge/core). `FREE_DIRECT_SEARCH_ADMISSION` stays **default** — unconfigured
deployments are byte-identical to Phase 1. `FREE_CREDENTIALED_SEARCH_ADMISSION`
is opt-in. Router **refuses at construction** any policy admitting `paid`/
`self_hosted` ⇒ widening can never become spend. `FreeDirectSearchProviderRouter`
→ `RightsVerifiedSearchProviderRouter` (no alias — old name asserted a policy
that is now a parameter). First adapter = **same vendor credentialed**
(`api.parallel.ai/v1beta/search`, tier 2), registered only when `PARALLEL_API_KEY`
is set — isolates the credentialed-path variable from the new-vendor variable.
Shared parsing extracted to `parallel-search-shared.ts` so the two adapters can't
drift on citation/URL/taint/truncation checks. Key never touches provenance,
citations, warnings, taint, or logs; pinning test asserts it.
**Still open — do not read as done:** (1) **rights = human gate** — technical
behaviour verified, terms/privacy URLs 200, but nobody has confirmed Parallel's
terms permit credentialed automated use at our volume; `verifiedAt` 2026-07-29
⇒ self-disables 2026-10-27. (2) **CredentialBroker still in-memory** — key comes
from env, not a governed store. (3) **breadth NOT built** — Exa/Tavily/Brave/
Linkup et al. each need their own rights verification.
