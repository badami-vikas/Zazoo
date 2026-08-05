# Taxonomy — what makes a thing a Toggle / Sub-module / Skill / Agent (wiki)

full: [../raw/capability-surface-taxonomy-2026-08.md](../raw/capability-surface-taxonomy-2026-08.md) · derived from [glossary](../glossary.md) + [ui-architecture](ui-architecture.md). Adds NO new canon.

**Meta-pattern: 3 axes, not 1 list.** Most "module or capability?" fights = two people answering different axes.
- **Surface** (where human sees): List · Toggle · Section · Page · Sub-module · Module
- **Capability** (what executes): Skill · Automation · Agent · Integration · Engine
- **Trust** (earned autonomy): draft → validated → approved → active → trusted

**Resolver:** "Gmail = Sub-module or Integration?" → BOTH, different axes. Integration = the connection. Sub-module = where its data appears. Ask "where does a person click?" and "what runs?" separately. Module = container, not capability; "Module or Skill?" = category error.

**Axis 1 — data shape decides (first match wins):**
1. user never sees it → Engine (go Axis 2)
2. same DB, SAME columns, fewer rows → **List** (dropdown filter, never a Page)
3. same DB / strong sibling cluster, DIFFERENT columns → **Toggle** (buttons top of one Page, each routable)
4. standard supporting content (Agents/Automations/Integrations/Files/Results/Intelligence) → **Section**
5. new data, related to Module but not strongly to its primary DB → **Sub-module** (collapsible nav group)
6. new data, unrelated → **Module** (own top-level nav entry)

Hinge = "different columns". Same shape → filter suffices. Different projection of same subject → own view, not own home. Different subject → own home. Mechanical on purpose, so it never becomes taste.

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
1. "Capability" defined twice: glossary says Skill|Integration; code `CapabilityType` = skill|automation|agent|integration|view|dashboard. Recommend adopting code's wider def, fix glossary.
2. ~~Sub-module has NO implementation~~ **CLOSED 2026-08-05 (ADR-178)** — `parentModule` field + one-level collapsible rail shipped. Nav relation ONLY: no inherited permissions/credentials/plane. Residue: only WhatsApp nests; Gmail is an Integration not a Module, LinkedIn does not exist — not faked. Identifiers (`relationship`/`deal-pilot`/`job-pilot`) unchanged; display names only.
3. "Scheduled Automation" defined; no scheduler exists (one hardcoded 15-min timer).
4. Capability Builder cannot build — emits text + regex; no unified builder, no Axis-2 classifier (`capabilityType` hand-declared everywhere).

2–4 = one bug class: docs asserting behaviour code lacks. Corrective measures → [../raw/bug-pattern-corrective-measures-2026-08.md](../raw/bug-pattern-corrective-measures-2026-08.md).
