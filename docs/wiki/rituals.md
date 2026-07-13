# Automations (wiki) — formerly "Rituals"

> **TERM CHANGE (2026-07-12):** "Ritual" term retired at all levels (code + UX).
> Term = **Automation** everywhere. Automations can be scheduled. No "ritual
> template" concept — Modules fill that role. Dream Cycle, CoS Board Meeting =
> examples of scheduled Automations, not primitives. DB table `ritual_runs` →
> `automation_runs` (migration pending). See [ontology](ontology.md).

full: [../raw/rituals-engine-research.md](../raw/rituals-engine-research.md) · **Automation** primitive ([ontology](ontology.md)).

**Call:** most of user's ritual/governance dump = Bridge ALREADY has it. Value = net-new bits + 3 conflicts to reshape. Took as opinion, researched, decided.

**Research (2026-06-03, 4 searches):**
- Swarm vs DAG: 2026 consensus = agents must be **bounded components inside deterministic workflow**, NOT ungoverned. 75% enterprise rank auditability #1. Swarm-only = sprawl, lost trace, runaway cost.
- Self-heal contracts: real but reliability = threshold + human-fallback; schema-first (OpenAPI/JSON-Schema) = reliable substrate.
- Code nodes: n8n RCE CVEs 2026 (9.9 + 8.5), vm2 dead → external-container isolated-vm. Arbitrary JS = #1 attack surface.
- Broker/policy/gates/quorum: industry converging on Bridge's exact model.

## HAVE (re-confirm)
Capability broker = Authority resolver + ResourceType (agent→Pipeline→tool, never direct) · Policy engine (add `confidence` + `contact_type` conditions) · approval gates (approve\|veto\|edit) · append-only ledger (event-sourcing) · explainability = `decision_traces` (signal/memory/policy/confidence) · policy-as-code · RLS multi-tenant · exec engine = Hatchet+BullMQ+`RitualExecutor` · React-Flow canvas.

## ADD (net-new, in plan)
- **Ritual = 4 tabs** Overview(side-scroll analytics row)/Canvas/Timeline/Boundaries — mirror Initiatives.
- **Approval LEVELS L0–L3**: L0 auto-mode · L1 act+notify · L2 propose→approve · **L3 dual/quorum (net-new)**. Egress/agent-floor force ≥L2.
- **Memory classification** public/workspace/team/private/restricted (on deferred Memory table; extends visibility +public +restricted; policy gates per-agent read — Relationship Agent reads notes NOT comp).
- **Execution snapshots**: ledger entry + goal/memory_used/prompt/tool in+out/policy_state/model_version → **replay** (determinism makes it real).
- **Versioning** agents+skills+rituals + diff + rollback + change-mgmt (treat agents like software).
- **Self-heal contracts** = mapping SUGGESTER over typed contracts; remap = governed proposal, never silent; plane-aware.
- **On-the-fly API gen**, **bimodal edit**, **compressed/expanded node + drag**, **plan\|execute toggle/node**, **flow global+local (global=optimization cache, exec local)**.
- **Data-masking** (PII redact before visible log) — matters BECAUSE private tier.
- DEFER tail: air-gap Docker/Helm · SIEM stream (Splunk/Datadog/JSON) · AES-256 cred vault+KMS.

## RECONCILE (NOT rubber-stamped)
1. **"Swarms not workflows" → reject as stated.** Pure swarm breaks determinism/replay/audit. **Planner (swarm) PROPOSES dag → governed deterministic DAG EXECUTES** thru Pipeline. Per-node **plan\|execute toggle IS this boundary**. Swarm plans, DAG runs.
2. **On-the-fly API gen**: generate ≠ execute. Ingest → capability *definition* → must **register in broker + permission** (+plane grant if egress) → only then run. Doc-fetch = cloud-plane sourcing req.
3. **Custom JS nodes → minimize.** Typed expr (JMESPath/Jexl) DEFAULT; code only external-container isolated-vm, no network (plane gate), brokered, masked I/O. (n8n CVE evidence.)

## Exec model (the one real decision)
`Goal → PLAN(agentic Planner, may be non-deterministic, proposes DAG) → REVIEW GATE(L0–L3) → EXECUTE(deterministic DAG thru Pipeline: Authority→Policy→Skill→Policy→Review→Ledger→Policy; injected Clock/Rng/IdGen=replayable; snapshot/node) → Output/Events → Variance Adjuster(off VETTED only)`. Egress/agent-floor nodes pinned to `execute` (no live re-plan of irreversible act).

## Schema deltas (v2 pass)
ledger/traces += snapshot fields · policy += `approval_level{L0-L3}`+quorum · Memory += `classification` (P3) · `versions` lineage (agent/skill/ritual/policy) · `capabilities` registry (+ingested) + per-node typed `contracts` · masking policy + SIEM sink (config).

## Sequencing
**Plan/architecture update, NOT immediate build** (user sends Initiatives biz-process next). Order: local-gate slice2 → Initiatives P1–P3 → Rituals engine proper (planner/executor lands w/ ritual runtime; prototype gets 4-tab shell + node modes opportunistically). Air-gap/SIEM/vault/L3 = enterprise tail, design-now build-on-demand.
