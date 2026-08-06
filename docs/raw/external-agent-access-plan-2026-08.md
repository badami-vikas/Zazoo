---
title: External agent access — plan, revised against the Avilo Advisory implementation
type: raw
doc_kind: plan
status: draft
companions: []
related_wiki: ../wiki/external-agents.md
updated: 2026-08-06
tags: [external-agents, mcp, gateway, governance, builder-agent, avilo, roadmap]
---

# External agent access

How an agent outside Bridge — Claude Code, or any MCP client — could build Modules, Databases,
Skills, Agents and Automations for a Bridge installation: what it may do, what it structurally
cannot, and in what order to build the door.

**Status: PLAN ONLY. Nothing here is built.** Roadmap rows EA0–EA5 are scoped below and folded
into [../wiki/roadmap.md](../wiki/roadmap.md); no TASK rows exist yet and none should be created
until a slice is pulled forward through APPROVALS.

**This document's most valuable content is not its own plan.** It is §4: a working
implementation of substantially this design already exists in a sibling codebase, **Avilo
Advisory**, and it corrected four things Bridge had wrong. Read §4 before building any of §3.

---

## 1. The two modes, which are different problems

**Dev-time** — Claude Code editing this monorepo. Already works; governance is git + PR + CI +
`pnpm verify`. Covered by EA5 only.

**Runtime** — an external agent authoring capabilities inside a live Bridge installation. This is
the subject of the plan. Everything below means runtime unless it says otherwise.

---

## 2. The governing principles

Three sentences carry the design. The first two are adopted verbatim from Avilo (§4); the third
is Bridge's own and is where Bridge must diverge from Avilo.

> **Structurally absent, not policy-denied.** There is no `activate` tool to deny. An agent
> cannot reach a state a person could not reach because the tool does not exist, not because a
> rule refuses it.

> **Introducing a new state is a human decision. Returning to an old one is not.** Propose
> requires approval; restore does not. Restore is strictly weaker — it cannot introduce
> anything new, it appends rather than truncates, and an undo is itself undoable.

> **Restore restores the document, not the world.** Bridge's qualifier on the above. See §4.3 —
> this is where Bridge cannot simply copy Avilo.

---

## 3. The plan (EA0–EA5)

### EA0 — Local stdio gateway

An MCP server over **stdio**, launched by the user on their own machine, exposing Bridge's
governed capability pipeline as tools. Nothing bound, nothing listened on, no network boundary
crossed, therefore **no auth work is a prerequisite** (see §4.1 — this is the single biggest
correction to the earlier draft of this plan, which treated the H1 auth fix as an
unconditional blocker for all external access).

Tool shape, mirroring Avilo's six:

| Tool | Reads | Writes |
|---|---|---|
| `bridge.describe_surface` | registry: every legal capability id, Database id, View kind, component grammar, permission vocabulary, and the rules | — |
| `bridge.get_configuration` | the live Module/Database/View/Automation definition set | — |
| `bridge.list_versions` | configuration history, newest first | — |
| `bridge.get_version` | one recorded state | — |
| `bridge.propose_change` | — | a governed proposal, validated + diffed, **not applied** |
| `bridge.restore_version` | — | live state, subject to the §4.3 guard |

**Non-negotiable properties:**

- No `activate`, no `approve`, no `send`, no egress tool — structurally absent.
- The gateway is a **client of Bridge's own governed pipeline**, never a second reader of the
  store. It calls the same `propose`/`decide` path the in-app assistant calls, so every guard
  governs an external agent because it is literally the same code. (Avilo opened the SQLite
  file directly and recorded that as an honest limit — §4.4. Bridge has an API and an authority
  plane; taking the cheap path would be a regression, not a shortcut.)
- Validation feedback returns to the agent: exact errors with paths, so it self-corrects
  without a human relaying failures.
- A distinct principal (`mcp:external-agent`) recorded on everything written, visible in
  history and in the Approvals UI.
- Refusal is whole-document: an unknown id writes nothing, not partially and not with a warning.

**Depends on:** a configuration version ledger (§4.3) — Bridge has append-only
rollback-as-fork *canon* (roadmap P5, builder-agent invariants) but whether a single
`configuration_versions`-equivalent exists today is **unverified and must be checked before
this slice is scoped**.

### EA1 — Isolation proved by the import graph

A test that walks the **transitive import graph** from the gateway entrypoint and fails if any
reachable first-party file names a personal-data table, with a second assertion excluding known
data-path modules outright and a third failing if the walker resolves implausibly few files
(the vacuity guard). Adopted wholesale from Avilo §3.2 — see §4.2 for why this is better than
what this plan originally proposed.

Cheap, immediate, and independent of EA0 shipping. Belongs with the security track.

### EA2 — Restore, with Bridge's qualifier

`restore_version` applies without human approval **only when** the restored document's
references still resolve identically and no referenced capability's trust band or credential
grant has changed since that version was live. Otherwise it degrades to a proposal. Restores by
an external principal are notified and rate-limited. Rationale in §4.3.

### EA3 — Networked gateway

Only if a non-stdio transport is ever wanted. At that point the H1 auth fix (token enforcement,
`protectedProcedure`, no silent pilot-user fallback), scoped expiring tokens, and
`untrusted_external` taint labeling on everything the agent emits all become required **before**
the transport ships, not after. Bridge keeps its taint lattice where Avilo correctly deferred
one — see §4.5.

### EA4 — Shrink the code-bearing surface

Not "add a sandbox everywhere." The correct move, per §4.6: make the view/Database/Page/layout
schema **structurally incapable of holding code or markup** — a component names bindings, the
application looks the value up — so that surface needs no sandbox at all. Keep the BA0 sandbox
strictly for capability bodies that genuinely execute. Folds into BA0/BA1 rather than adding a
slice.

Standing rule adopted with it: **a sandbox must never become the justification for a looser
schema.** "It's sandboxed, so a raw value field is fine now" is the corrosion this guards against.

### EA5 — Agent-legible surface, and dev-time

`AGENTS.md` shipped **inside the installed build** (not pointing at a repo the user may not
have), with `bridge.describe_surface` as the primary contract and any published document
explicitly secondary — an agent works from the live registry of the installation it is actually
connected to, never from a doc that has drifted.

Dev-time hardening: the earlier draft proposed CODEOWNERS. With one human on this repository
that is ceremony; the mechanism that actually protects governance code is **tests that always
run** — the isolation guard, an assertion that fails if an `activate`-shaped tool ever appears
in the tool list, and forward-only history tests. Adopted from §4.7.

**Explicitly deferred:** publishing an installable authoring skill and treating the capability
grammar as an ecosystem/moat play. Bridge has one user. The machinery makes it possible later;
the distribution push is premature.

---

## 4. What the Avilo Advisory implementation taught us

**Refer to Avilo Advisory before building EA0.** It is a single-user, offline-first desktop app
whose external-agent door was built against an earlier draft of this plan and shipped. Its
`docs/wiki/mcp.md`, `AGENTS.md`, and ADR-041/042/043/044 are the reference implementation. Its
review of this plan is more useful than the plan was, and this section records the corrections
rather than quietly folding them in.

Its own summary of the earlier draft: roughly two of five phases transferred; the security
scaffolding answered a threat model it did not have; **one idea was taken verbatim** —
"structurally absent, not policy-denied."

### 4.1 Transport determines the security requirement (correction)

The earlier draft made the H1 auth fix an unconditional blocker on all external agent access.
Avilo rejected it as written: no accounts, no sessions, loopback only, stdio transport — a token
would be a secret stored on the same machine as the thing it protects.

**This applies to Bridge more than expected.** Bridge is desktop-first and local-first (Tauri).
A stdio gateway on the user's own machine crosses no network boundary, so EA0 can precede the
auth work entirely. H1 remains a hard blocker for EA3 and for the product generally — it is not
cancelled, it is *un-coupled* from this feature.

Caveat Bridge must not lose: stdio removes the **auth** requirement, and simultaneously raises
the **data-isolation** requirement, because Bridge's local plane holds real personal data where
Avilo's store held only configuration. EA1 is the answer, not optional.

### 4.2 Isolation is a property of the import graph, not a helper call (adopt)

Avilo's reasoning, which the earlier draft did not anticipate: an `assertNoClientData()` helper
guards the tools that exist today, not the one someone adds in six months, and the realistic
failure is exactly that — a convenient import added to a service the gateway already depends on,
three files away, long after anyone remembers why it mattered.

So the guard is a test over the transitive import graph. Three details worth copying exactly:

1. It names **tables**, so a new query on an old table is caught.
2. It excludes known data-path modules by name as belt-and-braces, for the day the code happens
   not to name a table.
3. **It fails if the walker resolves fewer than N files** — otherwise a silently broken resolver
   makes the suite pass vacuously, and the test goes green precisely when it stops testing
   anything. This mechanizes the standing rule that a test proves nothing until seen failing.

And it was **verified by breaking it**: a data-bearing import was added, the test failed naming
three tables three files deep, then it was removed and the suite went green. A guard nobody has
watched fail is not yet a guard.

Making it pass required a real refactor — a formula loader had to move out of the reporting
module because importing it dragged every fact and override query into the graph. Expect the
same in Bridge, and expect it to be the useful part.

### 4.3 Restore/propose asymmetry — adopt, with a Bridge-specific qualifier

The asymmetry is genuinely new and the earlier draft lacked it. Restore is defensible where an
`activate` tool would not be because the target state was already approved by a person, it
introduces nothing new, it appends rather than destroys, and it is itself undoable.

Bridge already has the substrate — append-only history, rollback-as-fork-never-in-place — and
was missing only the permission conclusion.

**Where Bridge cannot copy it directly:** the claim "restore cannot introduce something new"
holds only while the *interpretation* of a stored document is stable. Avilo is close to that
(closed ids, formulas compiling against accounts) though not perfectly — restoring a formula set
from before a mapping change yields a report that was never actually live. Bridge's gap is much
wider: a restored Automation points at Integrations whose scopes, credentials and remote schemas
have moved; a configuration predating a security fix can re-enable a capability at an older
trust band. Restore restores the document, not the world.

Hence EA2's guard. And a second concern Avilo's threat model does not reach: restore is a
**selection** capability — an agent cannot author a bad state but can choose the worst
previously-approved one at the worst moment. Logged-and-reversible is adequate at single-user
desktop; Bridge adds notification and rate-limiting.

The four history properties are adopted unchanged: **single writer** (one activation path
appends, so no actor changes configuration silently), **forward-only** (restoring seq 3 appends
at the head, never deletes 4 and 5), **normalized not delta** (an absent key means "leave
alone", so a state captured before a View existed could otherwise never remove one added
later), **baselined** (the first activation on an upgraded install records the pre-change state
first, or the user loses the ability to undo precisely the change they are making).

### 4.4 The honest limit, and why Bridge must not inherit it

Avilo's gateway opens the same store file the application does, so its isolation guarantee is
at the level of code verified by a test, not enforced by the OS. It states this plainly rather
than claiming more — the right call, and the alternative it names ("route through the running
app's loopback API") is the one Bridge should take, because Bridge already has the API and the
authority plane. For Bridge the cheap path is the wrong path; see EA0's second property.

### 4.5 Taint lattice — correctly deferred there, correctly kept here

Avilo deferred the lattice: one trust boundary, not a lattice, enforced by validation rather
than by propagating labels. The criterion it gave is the useful part — **a lattice earns its
complexity when several sources of differently-trusted data flow into each other.** Avilo has
one door. Bridge has email, desktop capture, scraped pages, Commons packages, MCP tool output
and external agents, so the lattice (TASK-015, already DONE) stays, and now has a crisp
justification rather than an assumed one.

### 4.6 The sandbox recommendation was overbuilt (correction)

The earlier draft recommended importing an iframe jail for generated views. Avilo rejected it as
its most substantive disagreement: sandboxing is what you need when a model emits **code**, and
its ADR-041 made that unnecessary by construction — a view component has no field that can hold
code, markup, or even a number. It names an id; the application looks the figure up. Text is
rendered as text, never as HTML. There is no path from model output to markup on the page.

Its second argument is the sharper one: a sandbox around generated views would be *quietly
corrosive*, inviting someone later to relax the schema on the grounds that it is contained.

**How much transfers:** for Bridge's View/Database/Page/layout surface, all of it — the earlier
draft was wrong and EA4 replaces it. Where Bridge genuinely differs is that Bridge capability
packages contain executable Skill bodies (BA0 ships `code:exec` and a SandboxProvider by
design), and there the sandbox is not redundant. The synthesis is to shrink the sandboxed
surface to exactly what bears code, rather than to sandbox everything generated or to conclude
no sandbox is needed.

Revisit trigger, adopted verbatim: **if the component registry ever admits a type carrying
executable or markup content, the sandbox stops being redundant and becomes mandatory.**

### 4.7 Dev-time: tests beat CODEOWNERS at this size

CODEOWNERS presumes multiple humans and a shared review gate. What it actually protects — that
governance code should not change without deliberate attention — is served by tests that run on
every commit and do not depend on anyone remembering to look. True for Avilo, and true for this
repository today.

"Never move the approval gate itself" was adopted on both sides without qualification.

### 4.8 Two operational notes worth stealing

- **Live introspection beats a published spec.** `describe_surface` returns the registry of the
  installation the agent is connected to, so the agent never works from a stale document, and
  the shipped `AGENTS.md` tells agents to prefer the call over its own examples. EA5 adopts this
  ordering.
- **A Drizzle migration trap, directly applicable.** `drizzle-kit generate` re-emitted
  `CREATE TABLE` for three already-existing tables whose migrations had been hand-written and
  never snapshotted; shipping it would have failed on the first statement for every existing
  install. Bridge writes hand-authored migrations and is at 0038. Worth a standing check when
  generating, not a one-time note.

---

## 5. Vendo, and why it dropped in weight

[runvendo/vendo](https://github.com/runvendo/vendo) (Apache-2.0) is an embedded agent for a SaaS
product's **end customers** — extracts the host API into tools the agent runs as the signed-in
user, generates views into an iframe jail with `connect-src 'none'`, funnels every tool call
through one guard (policy/approvals/grants/breakers/audit), and ships an opt-in MCP door.

Genuine convergence with Bridge's design — single choke point, constrained generation format,
approval-gated tools, MCP door as an explicit host decision — which is useful independent
validation. But its trust model is session-scoped grants acting *as the user*, with no taint,
no residency planes, and no versioned capability lifecycle. It is a retrofit of adaptability
onto static products; Bridge's whole thesis is that the Engine adapts natively.

**Reduced verdict after §4:** the earlier draft over-weighted Vendo, proposing imports of its
MCP door and its sandbox adapters. Avilo showed the gateway is the official
`@modelcontextprotocol/sdk` plus a thin layer calling services that already exist, and EA4
removes the sandbox rationale for the view surface. Vendo therefore drops to **pattern source
only** — a sixth entry alongside bolt.diy / Dyad / Budibase / Appsmith / ToolJet in the
builder-agent research set, and the one purpose-built for the embedded-agent shape. No reuse
intake is required unless a specific import is later proposed.

Never adopt its guard as a second governance plane alongside Bridge's authority plane; the drift
between two overlapping policy systems would become the largest vulnerability. One choke point,
Bridge's.

---

## 6. What would change these answers

- **A non-stdio transport** → EA3's auth and token work becomes required before that transport
  ships, not after.
- **A component type carrying code or markup** → EA4's sandbox becomes mandatory for that
  surface.
- **More than one human on this repository** → CODEOWNERS becomes worth its cost.
- **Unattended operation, or a second reader of the store** → the §4.4 limit stops being
  acceptable; the loopback-API route becomes mandatory rather than merely preferred.
- **No configuration version ledger found** → EA0's restore/history tools are blocked until one
  exists; propose-only is still shippable without it.
