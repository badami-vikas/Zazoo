# Rituals Engine — Research, Verdicts & Architecture (2026-06-03)

User dumped a large set of ritual + agent-platform inputs and asked: *take as opinion,
do your own research, decide if these are even necessary, and if yes update the plan so
the architecture is robust enough to support them.* This is the answer of record.

Method: 4 targeted web searches (swarm-vs-DAG governance; LLM semantic/self-healing data
contracts; n8n code-node sandbox CVEs; capability-broker/policy/approval-gate enterprise
patterns) + mapping every ask against Bridge's existing, already-built Universal Action
Pipeline / Authority resolver / append-only ledger / local-first two-plane gate. Most of
the governance asks Bridge **already implements** — the value here is (a) the net-new
additions and (b) three places the user's framing conflicts with Bridge's identity and
must be reconciled rather than copied.

---

## 1. Research findings (what changed / confirmed my priors)

**Swarm vs deterministic workflow.** 2025–26 consensus is decisive: agents should be
*"bounded components inside a deterministic workflow,"* not ungoverned autonomous actors.
Without a deterministic workflow governing which agents run, what authority they hold, and
where human review is required, "agent sprawl grows, handoffs become harder to trace, and
costs become harder to forecast." A 2026 KPMG survey: 75% of large-enterprise leaders rank
security/compliance/auditability as the most critical requirement for agent deployment.
Salesforce shipped an "Agent Broker for **deterministic** orchestration." → A pure-swarm
Ritual engine would violate Bridge's determinism, replay, and audit invariants. Reconcile,
don't adopt.
- IntuitionLabs, "AI Agents vs. AI Workflows: Why Pipelines Dominate in 2025"
- arXiv 2603.16586, "Runtime Governance for AI Agents: Policies on Paths"
- Salesforce, "Agent Fabric / Agent Broker" (Apr 2026)

**Self-healing / semantic data contracts.** Real research direction, but reliability is
threshold-based with human fallback; the *reliable substrate* is schema-first (OpenAPI /
JSON Schema). Tool misuse (malformed calls, missing fields, constraint violations) is a
recurring LLM failure mode; explicit contracts "produce deterministic validation behavior."
→ Semantic mapping belongs as a **suggester over typed contracts**, where a contract change
is a governed proposal — not a silent auto-remap in the data plane.
- arXiv 2603.13404, "Schema First Tool APIs for LLM Agents"
- ResearchGate, "A Self-Healing Framework for Reliable LLM-Based Autonomous Agents"

**Custom code nodes / sandbox.** Damning for the "let users write JS" pattern: n8n shipped
RCE CVEs in 2026 — CVE-2026-1470 (9.9, expression engine) and CVE-2026-0863 (8.5, Python
code node); `vm2` is discontinued and "should not be used for production"; the remediation
is external-container `isolated-vm` task runners. → Bridge should default to a **typed
expression engine** (JMESPath/Jexl, no arbitrary code) and treat code nodes as a
last-resort, sandboxed-with-no-network capability.
- JFrog, "Achieving RCE on n8n via Sandbox Escape"
- The Hacker News, "New n8n Vulnerability (9.9 CVSS)…"
- n8n Docs, "Hardening task runners"

**Capability broker / policy / approval gates.** Industry is converging on exactly Bridge's
model: capability sandboxing, a policy engine, approval workflows with **quorum logic**
(= dual approval), complete audit trails, and a "triple-gate" defense-in-depth. Microsoft's
Agent Governance Toolkit covers 10/10 OWASP Agentic risks this way. → Bridge is already on
the right side of this; formalize the vocabulary (broker, policy levels, quorum) so it maps
cleanly.
- Microsoft, "Agent Governance Toolkit" (github.com/microsoft/agent-governance-toolkit)
- Salesforce Agent Fabric; Integrate.io / MintMCP MCP-gateway roundups

---

## 2. Verdict table — every input

Legend: **HAVE** = already built/locked in Bridge · **ADD** = net-new, accepted into plan ·
**RECONCILE** = accepted only in a reshaped form · **DEFER** = accepted, enterprise tail.

| # | User input | Verdict | Bridge mapping / reshape |
|---|---|---|---|
| R1 | Ritual tabs: Overview (side-scroll analytics row) / Canvas / Timeline / Boundaries | ADD | Mirror Initiatives' tab set. Overview = a single horizontally-scrollable row of dashboard cards (runs, success rate, cost, last-run, pending approvals). Canvas = the node graph. Timeline + Boundaries = first-class, same components as Initiatives. |
| R2 | "Initiatives and Agents internally use **dynamic swarms, not workflows**" | RECONCILE | Two-phase: an **agentic Planner** (swarm-like, may be non-deterministic) **proposes** the graph; a **governed deterministic DAG executes** it through the Universal Action Pipeline (replayable, snapshotted, audited). Swarm plans, DAG runs. See §3. |
| R3 | Self-healing data contracts (semantic mapping, no manual re-map) | ADD (guard-railed) | A **mapping suggester** over typed JSON-Schema contracts at each node boundary. When an upstream key drifts (`user_id`→`customer_id`), the engine *proposes* a remap; the contract change goes through the Pipeline as a draft-then-approve proposal. Never silently mutates the data plane. Plane-aware (private-tier mapping runs local). |
| R4 | Bimodal editing (NL command edits a section ∥ click node for strict JS/API) | ADD (defer UI) | NL edit = an Agent+Skill step that emits a **proposed graph diff** → review → commit (never live mutation of a running ritual). Manual edit = direct node-config edit, validated by the typed-expression engine; raw JS only via the sandboxed code capability (R10). |
| R5 | On-the-fly API generation from raw API docs / OpenAPI URL | RECONCILE | **Ingest produces a capability *definition*, not an execution.** Parse OpenAPI/Swagger (or doc) → typed candidate capability → must be **registered in the broker + permissioned** (and, if it egresses, granted a plane crossing) before any run. Never auto-exec. The doc fetch itself is a **cloud-plane sourcing request** (local agents can't reach the internet). |
| R6 | Ritual flow stored global+local; ingested+executed local; global = optimization only | ADD | Matches the two-plane model. Authoritative ritual definition + execution state = **local store**. A **read-only global copy** exists solely for optimization (cross-tenant template stats, suggestion priors) — never the execution path of record. |
| R7 | Plan-and-execute ∥ execute toggle per node (on expansion) | ADD | This is R2's boundary surfaced in UI. `plan-and-execute` = run the Planner for this node (propose, then a human/auto gate runs it); `execute` = run the already-fixed deterministic step directly. Default for governed/egress nodes = execute (deterministic). |
| R8 | Compressed + expanded node views; drag nodes across whiteboard | ADD | React Flow canvas already in the prototype. Add a collapsed (title+status+cost) vs expanded (full config + the plan\|execute toggle) node mode; free drag/pan/zoom (React Flow native) with Zustand canvas state. |
| R9 | Capability-based security (agent → **capability broker** → tool, never direct) | HAVE | Bridge's Authority resolver + ResourceType set IS the broker. Agents never hold a tool; they request a `(resourceType, action)` capability through the Pipeline. Formalize the named capabilities (Read Contacts, Create Draft Email, Send Email, Delete Record, …) as the ResourceType×action grid. |
| R10 | Custom JS code nodes | RECONCILE (minimize) | Default = **typed expression engine** (JMESPath/Jexl) for data mapping — no arbitrary code, evaluated off the main thread. If a code node is unavoidable: **external-container `isolated-vm`, no network (plane gate), capability-brokered**, AES-masked I/O in logs. Backed by the n8n CVE evidence — this is the #1 RCE surface. |
| R11 | Policy engine (confidence>0.9 → allow draft, deny send) | HAVE | Policy(pre/runtime/post) already gates every action. Add `confidence` and `contact_type=="investor"` as policy *conditions*. Policies remain deployable, versioned artifacts (policy-as-code, R16). |
| R12 | Human approval gates — **4 levels** (L0 auto / L1 notify / L2 approve / L3 dual-approve) | ADD | Formalize a `approval_level` on policy/action outcome. L0 = auto-mode (already built). L1 = act + notify (append ledger, push notice, no block). L2 = propose→approve (current review path). **L3 = dual/quorum approve (net-new): proposer + manager + second approver, quorum logic on the ledger entry.** Egress/agent-floor force ≥L2 regardless. |
| R13 | Memory governance — classify Public/Workspace/Team/Private/Restricted; policy gates visibility | ADD | The classification dimension on the (deferred) Memory table: `classification ∈ {public, workspace, team, private, restricted}`. Extends today's relationship-tier `visibility(private\|team\|workspace)` with `public` + `restricted`. An agent's memory read is authority-scoped: e.g. Relationship Agent may read meeting notes, may NOT read compensation (restricted). Enforced in the same resolver + RLS. |
| R14 | Explainability engine ("why?" → signal/memory/policy/confidence) | HAVE | `decision_traces` already stores signals + context + reasoning + policy state. Formalize a **"why" assembler** that renders {Signal, Memory used, Policy fired, Confidence} for any ledger entry (the Approvals why-panel already shows this in the prototype). |
| R15 | Immutable audit ledger (append-only, event-sourcing) | HAVE | `ledger` is append-only; UPDATE/DELETE revoked at RLS; proven live. Every action → an event with execution_id/agent/action/policy/memory_used/tool/timestamp/cost. |
| R16 | Execution snapshots (goal/memory/prompt/tool in+out/policy state/model version → replay) | ADD | Extend the ledger/trace entry with a **snapshot**: goal, memory_used[], prompt, tool_inputs, tool_outputs, policy_state, model_version. Determinism (injected Clock/Rng/IdGen) makes any decision **replayable months later** — critical for regulated funds. |
| R17 | Policy-as-code (compliance/legal/security author deployable policy objects) | HAVE→ADD | Policy engine exists; ADD: policies as **versioned, deployable artifacts** with their own review/approve/rollback (folds into R18). |
| R18 | Agent change management — version + review + approve + rollback; diff vN vs vN-1; version skills+agents+rituals | ADD | Net-new versioning dimension. Skills are already "atomic/versioned" in the meta-model; extend to **agents and rituals**: every change is a new immutable version, diffable against the prior, deployed through review, rollbackable. Treat agents like software. |
| R19 | True air-gapped capability (offline compile/deploy; deps baked into Docker/Helm; no public npm/CDN at runtime) | DEFER (design-now) | Aligns with local-first. Make it a deployment target: vendored deps, no runtime CDN, sandbox + docs baked into the image. Not a near-term build, but no architecture decision may preclude it. |
| R20 | Total observability — immutable logs + SIEM streaming (Splunk/Datadog/Elastic/CloudWatch, structured JSON) | DEFER | Ledger → a forward-only **export stream** (structured JSON) to corporate SIEM. Out-of-the-box, no UI-login required. Enterprise tail. |
| R21 | Data-masking engine (auto-redact/hash PII before saving execution history to visible logs) | ADD | A redaction pass at the **ledger-write + log boundary**: PII (and private-tier strings) scrubbed/hashed before the *visible* execution history is stored. Important precisely because Bridge holds a private relationship tier. |
| R22 | Execution engine: orchestrator (DAG) + message broker/queue + stateless workers + Postgres | HAVE | Hatchet (Postgres-backed ritual engine candidate) + BullMQ (Redis) + `RitualExecutor` seam + stateless workers, all already in the stack/roadmap. The DAG blueprint = the committed graph from R2. |
| R23 | Visual canvas: React Flow + Zustand/Redux state | HAVE | Prototype canvas is React-Flow-shaped; standardize on React Flow + Zustand for canvas state, JSON graph as source of truth. |
| R24 | Data transformation: Jexl/JMESPath expressions; sandbox code via isolated-vm | ADD | See R10. Expression parser for `{{$node["Webhook"].json.email}}`-style injection, strictly parsed off-thread; code sandboxed. |
| R25 | Credential storage: AES-256 at rest, master key in KMS/Vault separate from Postgres | DEFER | Needed once egress connectors exist (OAuth tokens, API keys). Encrypt at rest; master key in a vault separate from the DB. Until then, no third-party creds are stored. |
| R26 | Row-Level Security multi-tenancy | HAVE | RLS v1 applied + isolation proven live (workspace_id tenant key + visibility layer). |

---

## 3. The execution model (the one real architectural decision: R2 + R7)

Bridge's invariants (determinism, replay, append-only audit, draft-then-approve, deny-default)
forbid a pure swarm. The robust shape is a **planner/executor split**:

```
Goal / Trigger
   │
   ▼
[ PLAN PHASE ]  agentic Planner (swarm-like; may be non-deterministic)
   • proposes a DAG: nodes = governed steps, edges = data/control flow
   • output is a PROPOSAL, not an action
   │
   ▼
[ REVIEW GATE ]  approval level L0–L3  (auto for trivial; human for the rest)
   │
   ▼
[ EXECUTE PHASE ]  governed deterministic DAG through the Universal Action Pipeline
   • each node: Authority → Policy(pre) → Skill → Policy(runtime) → (Review) → Ledger → Policy(post)
   • injected Clock/Rng/IdGen → replayable
   • each node emits an execution snapshot (R16)
   │
   ▼
Output / Events  →  Variance Adjuster (tunes policy params off VETTED outcomes only)
```

- **Per-node `plan-and-execute` vs `execute` toggle (R7)** is exactly the boundary between
  the two phases, surfaced per node. `plan-and-execute` re-runs the Planner for that node
  (re-propose, then gate); `execute` runs the fixed step deterministically. Egress and
  agent-floor nodes are pinned to `execute` (no live re-planning of an irreversible action).
- **Why this is robust:** the swarm gets to be creative where it's cheap and reversible (the
  plan); everything that touches the world is deterministic, permissioned, replayable, and
  audited. This is the 2025–26 enterprise consensus, not a compromise.

## 4. Self-healing contracts without losing governance (R3)

- Every node boundary has a **typed contract** (JSON Schema) for its input/output shape.
- A **semantic mapper** watches for drift (key renamed, shape changed) and, on mismatch,
  *proposes* a remap (`{old_path → new_path}`) with a confidence.
- The remap is a **governed proposal**: high-confidence + in the auto-mode allowlist → auto;
  else → review. The data plane never silently reshapes — the *contract* is what changes,
  versioned (R18), auditable (R15).
- Plane-aware: a contract over private-tier data is mapped **locally**; only public-scoped
  contracts may involve a cloud sourcing step.

## 5. On-the-fly tools without breaking the broker or the air-gap (R5)

1. **Ingest** an OpenAPI/Swagger URL or doc → parse to a typed candidate capability
   (endpoints, auth type, request/response schemas). The fetch is a *cloud-plane sourcing
   request* — a local agent cannot perform it.
2. **Register** the candidate in the capability broker. It is inert until a human (or an
   allow-listed policy) grants it a capability scope.
3. **Permission**: if the capability egresses, it needs a plane crossing + (for sending)
   ≥L2 approval. `private ∩ egress = none` still holds.
4. **Execute** only then — through the Universal HTTP capability, creds from the vault (R25),
   I/O masked in logs (R21). Air-gapped deploys vendor the parser + sandbox; no runtime CDN.

---

## 6. Net-new schema deltas (for the v2 pass)

- `rituals`: keep global+local split; add `definition_version` (R18) + a read-only global
  optimization mirror (R6).
- `ledger`/`decision_traces`: add the **execution snapshot** fields — goal, memory_used[],
  prompt, tool_inputs, tool_outputs, policy_state, model_version (R16).
- policies/actions: add `approval_level ∈ {L0,L1,L2,L3}` + quorum fields for L3 (R12);
  `confidence` as a condition (R11).
- **Memory** table (still deferred to P3): `classification ∈ {public,workspace,team,private,
  restricted}` (R13).
- **Versions**: a `versions` lineage for agents/skills/rituals/policies — immutable, diffable,
  rollbackable (R17/R18).
- **Capabilities/contracts**: a `capabilities` registry (broker entries, incl. ingested ones,
  R5/R9) + per-node typed `contracts` (R3).
- **Masking + SIEM**: a redaction policy at log-write (R21) + an export-stream sink (R20).
  Mostly config, not tables.

## 7. Sequencing

These are **architecture/plan updates, not an immediate build** — the user is about to send
the Initiatives business process and wants the plan robust first. Build order stays:
local-first gate slice 2 (local store) → Initiatives P1–P3 → Rituals engine proper (the
planner/executor split lands when the ritual runtime is built; the prototype gets the 4-tab
Ritual shell + canvas node modes opportunistically). Air-gap / SIEM / vault / dual-approve =
enterprise tail, designed-now, built when a design partner needs them.
