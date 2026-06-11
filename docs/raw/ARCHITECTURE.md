# Bridge AI — Platform Architecture (v1)

> Status: governance-authority narrative synced to **Schema v2** (roles/delegation/ephemeral/agent-floor DENY, node_types `plane`).
> Audience: founding engineering + product.
> Companion docs: [SCHEMA.sql](./SCHEMA.sql), [ROADMAP.md](./ROADMAP.md).

---

## 0. The organizing shift: platform-first, not feature-first

Bridge is **not** organized around any ritual, tool, or page. Those are *instances*.
The platform is three things:

1. a **Substrate** — the shared state every page reads and writes,
2. a **Governance Spine** — the one execution path every action flows through,
3. a set of **Capability Registries** — the meta-model that makes Rituals and Tools *configuration*, not new code.

> **Design test:** adding ritual #7 or tool #5 should be a new *row*, not a new *subsystem*.
> If it requires new architecture, the platform is incomplete — not the feature.

Pages, Rituals, and Tools interconnect through three shared mechanisms, never by direct point-to-point wiring:

| Mechanism | Role | Analogy |
|---|---|---|
| **Unified Graph** | shared state / source of truth | the world model |
| **Event / Signal Bus** | propagation of change | the nervous system |
| **Universal Action Pipeline** | governed execution of every mutation | the spinal cord |

---

## 1. Two planes (resolves the "product pollution" worry)

Your docs contradict themselves on whether Tools/Agents/Initiatives are "graph nodes." The resolution:

### The Mirror plane — *reflects relationships that already exist*
- **Nodes:** `Person`, `Community`
- **Edges:** `KNOWS`, `MEMBER_OF`, `INTRODUCED`, `CONNECTED_TO`
- Organic, external, private. The system does **not** own it — it mirrors it.
- The Mirror is **never** polluted with internal operational objects (no Teams, no Tools, no Touchpoints live here).

### The Operational plane — *the workspace's work and machinery*
- **Objects:** `Initiative`, `Touchpoint`, `Ritual`, `Tool`, `Agent`, `Skill`, `Integration`, `File`, `Signal`, `LedgerEntry`
- Workspace-owned. These **reference into** the Mirror (e.g. a Touchpoint points at a Person) but are not part of it.

### Cross-plane edges (the union is the "Unified Graph")
One `edges` fabric spans both planes (Obsidian-style traversal + AI-readiness); each `node_type` carries a **`plane` tag** (`mirror` | `operational`). Cross-plane edges are **whitelisted only** — the write path **refuses** any Mirror↔Operational edge not on the list:
`PARTICIPATES_IN` (Person → Initiative) · `ASSIGNED_TO` (Touchpoint → Person/Agent) · `GENERATED_BY` (File → Agent) · `DERIVED_FROM` (Signal/Timeline → Person/event) · `REFERENCES` (File/Timeline → any) · `SUPPORTS` (Ritual → Initiative) · `ALIGNS_TO` (Touchpoint → Initiative goal) · `ATTENDED` (Person → Community event)

> **Why this matters:** the Mirror can be exported, shared, or reasoned over as a clean relationship graph, while all the operational noise stays on its own plane. The `plane` tag + whitelist is what stops "everything is a node" from collapsing the two planes into mush. It's also the security boundary — see the Digital Card projection (§7).

---

## 2. The Substrate

### 2.1 Unified Graph
- Hybrid storage (Postgres): **typed tables** for high-query entities (`persons`, `communities`, `relationships`, `timeline_entries`) + a **generic `edges` table** for the long-tail and cross-plane links.
- `relationships` is a **first-class entity** carrying *derived* signals (warmth, reciprocity, dormancy, context-freshness) — computed from events, never hand-entered. These drive **sorting and surfacing**, never shown as a naked score (Principle: *Context over Scores*).
- Semantic recall via `pgvector` on `files` + `timeline_entries`.

### 2.2 Tenancy (infrastructure layer — kept OUT of the Mirror)
`Workspace` (tenant boundary) → `Team` (internal access group) → `User`.
- Every operational and Mirror row is scoped by `workspace_id`.
- **Row-Level Security (RLS) is the enforcement primitive** — deny-by-default at the database. This is most of your CBAC permission system for near-free.
- `Team` enables group assignment of Touchpoints/Initiatives and policy templates (e.g. *"the Deal Team cannot view healthcare-network notes"*).
- `Community` ≠ `Team`. Communities hold **People** (Mirror); Teams hold **Users** (infra). They never mix.

### 2.3 Event / Signal Bus
- Every meaningful state change appends an immutable **`event`**.
- **`signals`** are *derived* from events (a role-change event → a dormant-reconnection signal).
- **Invariant:** every `signal` carries a non-null `recommended_action`. No passive signals — the Network Actions contract (Signal → Context → Insight → **Action**) is enforced at the data layer.

---

## 3. The Governance Spine — the Universal Action Pipeline

**Every** mutation — a ritual firing, a tool action, an agent decision, a manual edit — flows through one path. This is what makes governance uniform instead of per-feature.

```
Request
  → Authority Check          # role ∩ capability-ceiling ∪ ephemeral − deny; ∩ principal if on-behalf-of (RLS + permissions)
  → Policy Check (PRE)       # policies scoped to the resource
  → Agent + Skill Execution  # generation of the proposed change
  → Policy Check (RUNTIME)
  → User Review Surface      # approve | veto | edit   (required for outbound/sensitive)
  → Ledger append            # immutable: inputs, proposed output, decision, diff, policy results
  → Policy Check (POST)
  → Variance Adjuster        # async: veto/edit nudges policy_params (e.g. tone threshold → formal)
  → Output / Event emit
```

Pseudocode (one function, called by everything):

```ts
async function execute(req: ActionRequest): Promise<Result> {
  // Authority = (role ∩ capability_scope) ∪ active ephemeral − deny; ∩ principal if on-behalf-of
  requireAuthority(req.actor, req.resource, req.action, {
    onBehalfOf: req.onBehalfOf,        // delegation: intersect with the principal's authority
    runId:      req.runId,             // pull active ephemeral_grants minted for this ritual/initiative run
  });                                  // throws if not allowed (explicit deny always wins)

  const policies = resolvePolicies(req.resource, req.action);
  assertPolicies(policies, "PRE", req);

  const proposed = await agentRuntime.run(req.agent, req.skills, req.context);
  assertPolicies(policies, "RUNTIME", proposed);

  const decision = policies.requiresReview ? await userReview(proposed) : APPROVE;
  const entry = ledger.append({ ...req, proposed, decision, diff: diff(req, proposed),
                                policyResults:  policies.results,
                                onBehalfOfType: req.onBehalfOf?.type,        // answers "on whose behalf"
                                onBehalfOfId:   req.onBehalfOf?.id,
                                delegationId:   req.onBehalfOf?.delegationId });
  assertPolicies(policies, "POST", decision);

  varianceAdjuster.observe(entry);                                // async, non-blocking
  if (decision !== VETO) bus.emit(eventFrom(entry));
  return outputFrom(entry);
}
```

- **Authority** = *may this actor touch this resource?* — resolved through the four-layer model in §3.1 (role ∩ capability ceiling ∪ ephemeral − deny; ∩ principal for on-behalf-of). Deny-by-default.
- **Policy** = *should this action occur?* (guardrail; pre/runtime/post)
- **Ledger** = append-only, immutable; `UPDATE`/`DELETE` revoked at the DB. Records `on_behalf_of` + `delegation_id`.
- **Decision Trace** = the *why* (signals, context, reasoning, outcome) linked to the ledger entry.
- **Variance Adjuster** = closed-loop learning; adjusts `policy_params`, never the codebase. Three consecutive "too casual" vetoes → `tone_threshold` increments toward formal.

### 3.1 Authority model — how "who may act" is computed

Authority is **not** a flat capability list. It resolves through four layers, deny-by-default at each:

1. **Role grants** — every principal (user *or* agent) holds a `role`; `role_permissions` enumerate what the role may do. An agent `assumes_role_id` and **inherits** that role's grants — agents are not a separate permission universe.
2. **Capability ceiling** — an agent's `capability_scope` is a **ceiling, not a grant**. Effective base = `role_grants ∩ capability_scope`. An agent can never exceed its role; a permissive role can never widen a deliberately narrow agent.
3. **Ephemeral grants** — context-scoped, expiring permissions minted per ritual/initiative **run** (`ephemeral_grants.expires_at`). They add capability for the life of a run, then lapse — no standing privilege accrues from doing work.
4. **Explicit deny** — `permissions.effect` defaults to `DENY`; an explicit deny always wins. A seeded, **non-removable agent-floor DENY** blocks every agent from editing `policy/skill/agent/role/ledger`, reading the full graph, or sending externally — this closes the self-modification escape hatch.

**Effective authority** =
`(role_grants ∩ capability_scope) ∪ active_ephemeral_grants − explicit_deny`

**Delegation (on-behalf-of).** When an actor acts *for* a principal, authority is additionally **intersected with the principal's** authority — you cannot gain power by acting through someone, only borrow what they already hold. A `delegations` row authorizes it; the ledger records `on_behalf_of_type` / `on_behalf_of_id` / `delegation_id` so every action answers *"on whose behalf."*

> RLS enforces **tenancy** (workspace) and **visibility** (private/team/workspace) at the database; the resolver above enforces **capability** *within* a tenant. The two compose — neither replaces the other.

---

## 4. The enablement meta-model (how the platform enables Rituals & Tools)

Rituals and Tools are **declarative compositions** over the registries. This is the heart of "platform enables them."

### Skill — atomic, stateless, versioned capability
`{ name, version, input_schema, output_schema, impl_ref }`
e.g. `summarize`, `research`, `signal.detect`, `relationship.discover`, `intro.draft`

### Agent — goal-driven executor with an identity
```json
{ "agent_id": "...", "identity_type": "service_principal", "owner": "user/team",
  "goal": "...", "allowed_skills": ["..."], "allowed_tools": ["..."],
  "assumes_role_id": "role_...",        // agent INHERITS this role's grants (§3.1)
  "capability_scope": { "resources": ["person:read","initiative:write"] } }
//  effective base = role_grants ∩ capability_scope   — scope is a CEILING, not a grant
```

### Ritual — *scheduled / event-driven* workflow (first-class; NOT nested under Initiatives)
```json
{ "trigger": { "kind": "cron", "expr": "0 9 * * MON" },
  "agents": ["agent_..."],
  "pipeline": ["signal.detect", "relationship.discover", "intro.draft"],
  "policy_scope": "policy_...",
  "output_surface": "network_action_card",
  "supports_initiative": "initiative_..."   // optional — a ritual MAY support an initiative
}
```

### Tool — *human-initiated* surface (execution surface, not a Mirror node)
```json
{ "surface": "digital_card | conference_assistant | helpdesk",
  "reads": { "projection_snapshot": "..." },   // Digital Card reads a SANITIZED snapshot, not the live graph
  "agents": ["..."], "skills": ["..."], "policies": ["..."],
  "actions": ["Connect","Contribute","Engage","Update","Explore"]  // Network Action primitives
}
```

> Rituals (when) and Tools (how-the-user-acts) are two faces of the same primitives.
> Both compile down to the **same Universal Action Pipeline** (§3) and read/write the **same Graph** (§2).

---

## 5. The Pages — views over the substrate

| Page | Question it answers | Reads/writes | Primarily |
|---|---|---|---|
| **Network** | "Who exists in my world?" | Persons, Communities, Relationships, Timeline | Mirror plane |
| **Work** | "What am I trying to accomplish?" | Initiatives, Touchpoints, Rituals, Tools | Operational plane |
| **Intelligence** | "How should Bridge think and act?" | Agents, Skills, Integrations, Signals | Operational + registries |
| **Settings** | governance & tenancy | Workspace, Teams, Roles, Policies, Permissions, Delegations, Ledger | Infra + spine |

Pages are **thin** — they are queries + action-dispatchers over the substrate. They hold no private state. That is why they interconnect for free.

---

## 6. Inter-page interaction model (the explicit ask)

Pages never call each other directly. They interact through the **Graph**, the **Bus**, and the **Pipeline**.

| From → To | Mechanism | Example |
|---|---|---|
| Network → Intelligence | event → signal | Person role-change emits event → `dormant_reconnect` signal |
| Intelligence → Work | `signal.recommended_action` | a signal spawns a Touchpoint on an Initiative |
| Work → Network | execution writes timeline | completing a Touchpoint appends a TimelineEntry on the Person |
| Work → Intelligence | ritual triggers agent | Weekly Review ritual invokes Agent + Skills |
| any → Settings (Gov) | every action → ledger | an agent draft is recorded with decision + diff |
| Integrations → Network/Work | ingestion | Gmail thread → Person + TimelineEntry + inferred Community |
| Files → all | retrieval | agent reasoning pulls File context via `references` edges |
| Settings → all | policy/permission | a policy scoped to a Community gates every action on its People |

### One end-to-end flow (illustrative — *one of many*, not the thing we build around)

```
[Network]  Gmail ingestion updates Sarah (Person); her title change emits an event
   ↓ (bus)
[Intelligence] signal.detect → "dormant LP, relevant to active Initiative 'Raise Fund II'"
   ↓ (signal.recommended_action)
[Work]   proposes a Touchpoint on the Initiative; assigns to an Agent
   ↓ (Universal Action Pipeline)
   Permission ✓ → Policy ✓ (outbound requires approval) → intro.draft → User review
   ↓
[Settings] Ledger records input/proposed/decision/diff; Variance Adjuster observes
   ↓
[Intelligence] surfaces a Network Action card (Signal→Context→Insight→Action: "Reconnect")
   ↓
[Network]  on approval, TimelineEntry appended to Sarah; relationship warmth recomputed
```

Every page participated; none was coupled to another. Swap the ritual, the skill, or the tool — the wiring is unchanged.

---

## 7. Cross-cutting layers

- **Files = the knowledge layer.** Every File has `references` edges to People/Communities/Initiatives and feeds agent retrieval (pgvector). Source-tagged (Gmail, voice note, PDF, transcript).
- **Timeline = continuity.** Append-only, immutable. The Person's timeline *is* the primary historical record. Interactions are never edited or hard-deleted.
- **Signals = intelligence.** Derived from events; each mandates an action. Rendered as Network Action cards.
- **Projections = security boundary.** Some Tools (e.g. **Digital Card**) read a **flat, sanitized snapshot** of a profile, fully decoupled from the live Graph. External resharing ("Updates Only" via email/RSS) reads the projection, never the Mirror.

---

## 8. Platform invariants (the rules nothing may break)

1. **Deny by default**, grant explicitly (RLS + permissions).
2. **Every mutation flows through the Universal Action Pipeline** — no side doors.
3. **Ledger is append-only & immutable**; Timeline & Events too.
4. **No hard delete** — soft-delete via `archived_at`.
5. **Every Signal carries a recommended action** — no passive insights.
6. **The Mirror plane is never polluted** by operational/infra objects.
7. **AI sees filtered context, not the full network** — agents operate within `capability_scope`.
8. **No naked relationship scores** surfaced to users — signals drive actions, not verdicts.
9. **Vetoes adjust policy params, never code** (closed-loop governance).
10. **Vocabulary is the brand** — Person/Relationship/Memory/Community/Initiative/Ritual/Touchpoint. Never Lead/Deal/Pipeline/Contact.
11. **Authority is layered, deny-by-default** — `(role ∩ capability_scope) ∪ ephemeral − deny`; `capability_scope` is a *ceiling*, never a grant.
12. **On-behalf-of is recorded and bounded** — delegated actions intersect the principal's authority and write `on_behalf_of`/`delegation_id` to the ledger.
13. **Agent-floor DENY is seeded and non-removable** — no agent edits policy/skill/agent/role/ledger, reads the full graph, or sends externally.
