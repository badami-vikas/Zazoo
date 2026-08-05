---
title: Capability and surface taxonomy — the decision rules
type: raw
doc_kind: reference
status: draft
companions: [../wiki/taxonomy.md]
related_wiki: taxonomy.md
updated: 2026-08-05
tags: [taxonomy, vocabulary, ui-architecture, engine, governance]
---

# What makes something a Toggle, a Sub-module, a Skill, or an Agent

Derived from [glossary](../glossary.md), [ui-architecture](../wiki/ui-architecture.md),
and the shipped code. This document **adds no new canon** — where the rules genuinely
do not exist yet, §5 says so instead of inventing one.

## 0. The meta-pattern: three axes, not one list

Nearly every "is this a module or a capability?" argument is two people answering on
different axes. There are three, and a thing usually has a coordinate on more than one.

| Axis | Question it answers | Values |
|---|---|---|
| **1. Surface** | Where does a person *see* it? | List · Toggle · Section · Page · Sub-module · Module |
| **2. Capability** | What *executes*? | Skill · Automation · Agent · Integration · Engine |
| **3. Trust** | How much autonomy has it *earned*? | draft → validated → approved → active → trusted |

**The resolver.** "Is Gmail a Sub-module or an Integration?" — both, on different axes.
The Integration is the governed *connection* (OAuth, sync contract, credential). The
Sub-module is the *place its data appears*. One backs the other. Ask "where does a
person click?" and "what runs?" as two separate questions and the argument dissolves.

A Module is a **container**, not a capability. It holds Databases, Pages, Views, and
capabilities. Asking "Module or Skill?" is a category error — a Skill lives *inside* a
Module.

## 1. Axis 1 — Surface: data shape decides

Ordered test. **First match wins.** From `ui-architecture.md` ("Data shape decide surface").

| # | Test | Answer |
|---|---|---|
| 1 | User never sees it; it is shared internal machinery | Not a surface — **Engine** (go to Axis 2) |
| 2 | Same Database, **same columns**, just fewer rows | **List** — a saved filter in a dropdown. *Never* a new Page. |
| 3 | Same Database or a strong sibling cluster, **different columns** | **Toggle** — buttons at the top of one Page. Each toggle is its own routable URL. |
| 4 | Standard supporting content every Page has (Agents, Automations, Integrations, Files, Results, Intelligence) | **Section** on the Page. Not a toggle, not a Page. |
| 5 | New data, related to this Module but **not strongly** to its primary Database | **Sub-module** — collapsible group under the Module in the left nav |
| 6 | New data, **unrelated** to this Module | **Module** — its own top-level left-nav entry |

Supporting invariants (all from `ui-architecture.md`):

- Every Module's nav entry lands on its **primary data Page**, never on the capability
  inventory.
- A Skill **never** gets a Page.
- Every Database row gets a routable **Record Detail**. A detail view is not a sibling Page.
- A table stays visible at zero rows (empty body + Add row). An empty state is
  metadata-generated and honest — never a dummy row.
- Anything that looks interactive must open, perform, or explain something.

### Why "different columns" is the hinge

Same columns means one shape, so a filter suffices — that is a List. Different columns
means a different projection of the same subject, which needs its own view but not its
own home — that is a Toggle. Different subject entirely means a different home — a
Sub-module or Module. The test is mechanical precisely so it does not become a taste
argument.

## 2. Axis 2 — Capability: who invokes it, and what authority does it hold

Ordered test. **First match wins.** From `glossary.md` and `engine.md`.

| # | Test | Answer |
|---|---|---|
| 1 | Holds a mandate; chooses *between* Skills; its activity is attributable to it | **Agent** |
| 2 | Owns a trigger or a schedule | **Automation** — it starts an Agent Run |
| 3 | One bounded job, typed input/output, versioned, invoked only *by an Agent* | **Skill** |
| 4 | A governed connection to an outside or local system (auth, sync, data contract) | **Integration** |
| 5 | Shared internal machinery with no authority of its own | **Engine** |

### The four load-bearing invariants

These are enforced structurally in code, not by convention. Breaking one is a governance
bug, not a style preference.

1. **Only an Agent invokes a Skill.** Not a Human, not an Automation. Enforced in
   `pipeline.ts` and in the manifest's relational validation.
2. **Only an Automation owns time.** A Skill never schedules itself.
3. **An Automation never calls a Skill directly.** It starts an Agent Run; the Agent
   calls the Skill. This is what keeps every execution attributable.
4. **An Engine is invisible.** It never appears in the Intelligence inventory and never
   holds authority. If users need to see it, it is not an Engine.

### The three fastest disambiguators

- *Can a Human click it directly?* → then it is **not** a Skill.
- *Does it decide anything?* → if no, it is **not** an Agent.
- *Does it own a clock?* → only an **Automation** does.

## 3. Axis 3 — Trust: evidence, not assertion

`draft → validated → approved → active → trusted → deprecated → archived`.

- Generation only ever produces `draft`.
- Promotion is earned from measured evidence (the Agent Quality Vector), never asserted.
- Rollback is a fork from history, never an in-place revert — the ledger is append-only.
- Trust changes autonomy. It **never** changes category: a promoted Skill is still a
  Skill, never "graduated" into an Agent.

## 4. Worked examples — the four modules

| Thing | Axis 1 (Surface) | Axis 2 (Capability) | Why |
|---|---|---|---|
| **NetworkManager** | Module | container | Its own subject: the people graph |
| People ↔ Communities | **Toggle** | — | Strong sibling cluster, different columns, same Page (rule 1.3) |
| WhatsApp / Gmail / LinkedIn | **Sub-module** | each backed by an Integration | Related to NetworkManager, not strongly to the People table (rule 1.5) |
| Gmail's OAuth connection | — | **Integration** | A governed connection with auth + sync contract |
| "Draft a reply" | — | **Skill** | One bounded job; an Agent calls it; draft-only, egress-gated |
| Nightly contact sync | — | **Automation** | Owns a schedule; starts an Agent Run |
| Learning Agent | — | **Agent** | Holds a mandate and a Skill set |
| Dedupe / matching | — | **Engine** | Shared machinery, no authority, invisible |
| **TaskManager** | Module | container | Unrelated subject (rule 1.6) |
| **DealManager** | Module | container | Deals/Sources/Theses are their own subject |
| Deals ↔ Sources ↔ Theses | **Toggle** | — | Same rule as People/Communities |
| **JobManager** | Module | container | Unrelated subject |

Note the symmetry: People/Communities and Deals/Sources/Theses are the *same rule*
firing twice. That is the sign the taxonomy is real rather than post-hoc.

## 5. OPEN — where canon and code disagree today

Recorded rather than resolved. Each needs a decision; none should be silently patched.

1. **"Capability" is defined twice, incompatibly.** `glossary.md` says a Capability is
   "primarily a Skill or Integration". The code's `CapabilityType`
   (`packages/core/src/capability/types.ts`) is
   `skill | automation | agent | integration | view | dashboard`. Under the glossary an
   Agent is not a Capability; under the code it is. **Recommendation:** adopt the code's
   wider definition and fix the glossary — the trust model already operates uniformly on
   all six.

2. ~~**Sub-module has no implementation.**~~ **CLOSED 2026-08-05 (ADR-178, AP-105).**
   `ModuleSurfaceManifest` now carries optional `parentModule`, and the left rail renders
   a one-level collapsible group (`buildModuleNavTree` +
   `apps/web/src/app/Layout.tsx`). The relation is navigation ONLY — a sub-module keeps
   its own manifest, version, and capability trust lifecycle, and declaring a parent
   grants no permission, credential, or plane relaxation.

   Two residues, recorded rather than closed:

   - **Only WhatsApp actually nests.** The owner's structure also names Gmail and
     LinkedIn as NetworkManager sub-modules. Gmail exists as an **Integration**
     (`/integrations/google`), not a Module; LinkedIn has no implementation at all.
     Neither was fabricated to make the picture match — they need real manifests first.
   - **Identifiers were not renamed.** `name`/`route` still read `relationship`,
     `deal-pilot`, `job-pilot`. Only the display names moved. The identifier migration
     belongs to the vocabulary plan, which already carries 139 open violations.

3. **"Scheduled Automation" has no scheduler.** The glossary defines it;
   `AutomationDefinition` has no trigger or schedule field, and the only time-driven path
   is one hardcoded 15-minute timer for one automation.

4. **The Capability Builder cannot build.** Its declared responsibility is creating
   Agents, Skills, Automations and Modules; it currently emits descriptive text and runs
   a regex over prose. There is no single unified builder, and no classifier that decides
   an Axis-2 shape — `capabilityType` is hand-declared in every manifest.

Items 2–4 are all one bug class: **documentation asserting behaviour the code does not
have.** That class is the subject of the corrective measures in
[bug-pattern-corrective-measures-2026-08.md](bug-pattern-corrective-measures-2026-08.md).
