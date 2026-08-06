# Taxonomy — what makes a thing a Toggle / Sub-module / Skill / Agent (wiki)

full: [../raw/capability-surface-taxonomy-2026-08.md](../raw/capability-surface-taxonomy-2026-08.md) · derived from [glossary](../glossary.md) + [ui-architecture](ui-architecture.md). Adds NO new canon.

**Meta-pattern: 3 axes, not 1 list.** Most "module or capability?" fights = two people answering different axes.
- **Surface** (where human sees): List · Section · **Database** (→ its Page, a toggle sibling) · Sub-module · Module
- **Capability** (what executes): Skill · Automation · Agent · Integration · **Database** · Engine
- **Trust** (earned autonomy): draft → validated → approved → active → trusted

**Page is DERIVED, not chosen** (corrected 2026-08-05, ADR-180): declaring a Database creates its Page. You never decide "Page vs Module" — you decide "another Database here, or another Module?". Page appeared as an axis value by mistake; it is the rendering of a Database, the way a row is the rendering of a Record.

**Resolver:** "Gmail = Sub-module or Integration?" → BOTH, different axes. Integration = the connection. Sub-module = where its data appears. Ask "where does a person click?" and "what runs?" separately. Module = container, not capability; "Module or Skill?" = category error.

**Module contains** (owner's model, 2026-08-05): Databases (each → a toggle Page) · Sub-modules (each → a sub-page, own manifest) · Agents (Skills are owned BY Agents, never standalone) · Automations · Integrations. "Tool" is not a primitive — tool access is the GRANT of an Integration to an Agent or an Automation.

**Documentation** is neither Surface nor Capability: it is a Module ASSET (`references/` in the module directory; `docs/raw` + `docs/wiki` for the repo itself). It is not callable, holds no permissions, and has no trust lifecycle.

**Axis 1 — data shape decides (first match wins):**
1. user never sees it → Engine (go Axis 2)
2. a subset of ONE Database — fewer rows, fewer columns, or both → **List** (dropdown, never a Page)
3. standard supporting content (Agents/Automations/Integrations/Files/Results/Intelligence) → **Section**
4. a DIFFERENT Database, Relation-connected to one already in this Module → **new Database** → its Page joins the toggle row
5. a different Database, related to the Module but NOT Relation-connected to its cluster → **Sub-module** (collapsible nav group, own manifest)
6. unrelated → **Module** (own top-level nav entry)

Hinge = **"is it a different Database, and is it Relation-connected?"** — not "different columns", which was the old wording and named the symptom instead of the cause (columns differ *because* the Database differs). Relations make it checkable rather than tasteful: People↔Communities via `community_members`; `ColumnSpec.relationTarget`/`relationParent` already encode the parent side. **Gap:** DealPilot's Deals/Sources/Theses uses denormalised text tags, not Relations, so it fails the rule today — recorded, not excused.

**Axis 2 — who invokes, what authority (first match wins):**
1. holds mandate, chooses between Skills → **Agent**
2. owns trigger/schedule → **Automation** (starts Agent Run)
3. one bounded typed job, invoked only by an Agent → **Skill**
4. governed connection to outside/local system → **Integration**
5. shared machinery, no authority → **Engine**

**4 load-bearing invariants** (structural, not style): only Agents invoke Skills · only Automations own time · Automations start Agent Runs, never call Skills directly · Engines are invisible (never in Intelligence).

**3 fastest disambiguators:** Human can click it? → not a Skill. Decides nothing? → not an Agent. Owns a clock? → only Automation.

**Axis 3:** generation only ever makes `draft`; promotion earned from measured evidence (AQV), never asserted; rollback = fork, never in-place revert. Trust changes autonomy, NEVER category — a promoted Skill stays a Skill.

**Worked (4 modules):** NetworkManager/TaskManager/DealManager/JobManager = Modules · People↔Communities = Toggle · Deals↔Sources↔Theses = Toggle (same rule twice = taxonomy is real) · WhatsApp/Gmail/LinkedIn = Sub-modules backed by Integrations · dedupe/matching = Engine.

**OPEN (canon vs code — do not silently patch):**
1. ~~"Capability" defined twice~~ **CLOSED 2026-08-05 (ADR-180)** — adopted the code's wider definition (capability = the governed ATOM, not a composite) and fixed the glossary. Also corrected the code: `view` → `database` (it always WAS the Database declaration — the built-ins call them "Deals database and views"), and dead `dashboard` removed. A View is a UI element, never a capability.
2. ~~Sub-module has NO implementation~~ **CLOSED 2026-08-05 (ADR-178)** — `parentModule` field + one-level collapsible rail shipped. Nav relation ONLY: no inherited permissions/credentials/plane. Residue: only WhatsApp nests; Gmail is an Integration not a Module, LinkedIn does not exist — not faked. Identifiers (`relationship`/`deal-pilot`/`job-pilot`) unchanged; display names only.
3. ~~"Scheduled Automation" defined; no scheduler exists~~ **CLOSED 2026-08-05 (ADR-179)** — typed `AutomationTrigger` (manual|schedule|event), the dead `trigger`/`cadence` columns given real meaning, and a generic scheduler replacing the one hardcoded timer. `event` triggers are modelled but NOT dispatched; the scheduler logs every one at boot rather than letting it silently never fire.
4. Capability Builder cannot build — emits text + regex; no unified builder, no Axis-2 classifier (`capabilityType` hand-declared everywhere).

4 = the same bug class: docs asserting behaviour code lacks. Corrective measures → [../raw/bug-pattern-corrective-measures-2026-08.md](../raw/bug-pattern-corrective-measures-2026-08.md).
