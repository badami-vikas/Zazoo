# Bridge AI — Deal Copilot: Requirements for Agentic System Design (Freelancer Brief)

**Date:** 2026-08-01
**Audience:** External agentic-systems expert (freelance engagement)
**Deliverable requested from you:** An engineering design document (architecture + learning-system design) for the Deal Copilot, built on a generic, reusable "learn-from-zero" baseline that later powers Job Pilot and other modules.
**Confidentiality:** This document and the concepts in it are proprietary to Bridge AI. Do not reuse or share outside this engagement.

---

## 1. What Bridge AI is (context you must design within)

Bridge is **Living Software**: one governed engine that adapts installed Modules around the user's work across web, desktop, and mobile. It is not a static app. The product principles:

> Adapt before asking · Learn before acting · Explain before automating · Govern before executing · Build only lasting value · Simple surface, powerful core · Trust first · Action over analytics.

Key platform concepts (use these terms in your design):

| Term | Meaning |
|---|---|
| **Module** | Installed user functionality (Deal Copilot, Job Pilot). Contains Databases, Pages, Views, Records, Relations, Skills, Integrations, Agents, Automations. |
| **Agent** | An attributable actor. A small fixed set of permanent platform Agents exists (see §4). Modules define **no** default specialist Agents. |
| **Skill** | Bounded unit of work, bound to Goals/Tasks, invoked only by an allowed Agent. |
| **Automation** | Recurring/triggered execution that starts a governed Agent Run. Never invokes a Skill directly. |
| **Memory** | Retained, Module-associated context. Every capture creates inspectable Memory — always inspectable, correctable, and deletable by the user. |
| **Egg / Avatar** | The user-facing companion shell. It hatches empty ("Egg") and grows with the user. Avatar is interface identity only — never a security boundary. |
| **Commons** | A signed, generalized-capability registry (Modules, Blueprints, Skills, Integrations, templates). **Never stores personal data.** |
| **Local / Cloud Plane** | The only two data-residency boundaries. Raw capture stays local; only derived, approved memories cross a deny-default gate. |
| **Events / Results / Files** | Append-only activity ledger; non-file outputs; durable user-visible files. |

Stack context (high level): TypeScript monorepo, thin web/desktop/mobile clients over one surface-agnostic kernel, model-provider abstraction, job orchestration, and a memory layer behind a stable port. Your design must slot behind these abstractions, not replace them.

---

## 2. The core design requirement: start at zero, learn with the user

This is the heart of the engagement. The Deal Copilot must follow the **pi.dev model**: it ships knowing nothing about the user, and becomes an expert deal partner purely by learning from the user's interactions, movements, corrections, and outcomes.

Concretely, the system you design must:

1. **Start empty and honest.** No seeded demo data, no prebuilt "typical searcher" profile, no hardcoded market lookup tables. Every surface shows real connected data or an honest empty state explaining what will populate it.
2. **Generate, don't configure.** Onboarding is a four-step pipeline, not a form: (a) understand the user — goals, profession, work style, collaborators, current tools, desired autonomy; (b) infer the domain; (c) **research the domain** — terminology, workflows, lifecycle stages, common practices and tools, gathered live from permitted public sources with citations; (d) **generate the starting workspace** — objects, relations, tables, pages, views, and governance defaults. The generated workspace is a starting point the system keeps evolving, never a fixed template. For Deal Copilot the domain is pre-specced (§5), but the baseline must implement this pipeline generically — it is what lets a future pilot spin up for a domain we have *not* pre-specced.
3. **Learn from interaction, not interrogation.** Onboarding questions each state *why they are asked* and *what they affect*, and all are skippable. After that, the system learns from:
   - explicit signals: accepted/rejected suggestions, Pursue/Review/Dismiss decisions, red-flag feedback, corrections to extracted values, thesis edits;
   - implicit signals: which deals the user opens, dwells on, compares, revisits; which columns they sort by; which sources they trust; navigation patterns and rhythms;
   - outcomes: what happened to deals the user pursued vs. passed.
4. **Suggested-then-accepted, never silent.** Durable memory writes are proposed and confirmed (trivial facts may auto-accept only behind an explicit user grant). Every learned item is inspectable, correctable, deletable. Learned content is **data, never instructions** (prompt-injection defense — see §6).
5. **Visible growth.** The Egg/Avatar is the personality layer of this learning. Its capability observably grows: early on it asks and observes; over time it drafts, then proposes automations, then — with earned trust (§6) — runs approved routines. The user can always open the Avatar and see *what it has learned, from what evidence, and how that changes its behavior*.
6. **Improve measurably.** Define learning metrics from day one: suggestion acceptance rate, correction rate over time, retrieval quality, fit-ranking quality vs. user decisions, and "time to good deal" trends. Regressions on evaluation baselines block shipment.

### What "learning" is architecturally

Your design must make this loop concrete for deals:

- **Capture** → every interaction creates an inspectable memory entry; raw capture never leaves the local plane.
- **Observe** → a learning process batches corrections and behavior into suggested memory digests (rate-capped so it never nags).
- **Promote** → repeated patterns become governed capabilities via explicit, tunable thresholds: repeated similar behavior proposes an Automation draft; a draft activates only after several approved runs with a low correction rate; a Skill generalizes only after proving out across multiple contexts; "trusted" status requires a sustained clean run history. (Exact thresholds are policy parameters — your design defines the mechanism and how thresholds are evaluated and tuned.)
- **Evolve** → the Module itself evolves: evidence → candidate → small evaluation → comparison → governed proposal → activate/stage/pin/retire/rollback. Generation and activation are always separate steps.
- **Generalize** → capabilities that prove out are stripped of all personal data and published to Commons as signed generalized patterns, so other users' modules (and other modules like Job Pilot) can install them instead of re-learning from scratch.

Your design doc must specify the data model, event flow, storage, retrieval, and promotion machinery for this loop — that is the "engineering design behind the Egg and Commons" we are asking for.

---

## 3. Genericity requirement: one baseline, many pilots

Deal Copilot is the **first consumer** of the baseline, not the baseline itself. Design a generic learning-module substrate such that Job Pilot (candidate profile, job postings, applications, sources, materials, interviews) and future pilots are thin configurations over it.

Required separation:

| Generic baseline (module-agnostic) | Module-specific (Deal Copilot config) |
|---|---|
| Memory primitive (provenance, trust labeling, decay, dedupe) | Deal/Source/Thesis schemas and relations |
| Agent run-context assembly (persona · capabilities · context · memory · governance) | ETA-domain skills (thesis fit, dedupe, financial review, decision memo…) |
| Observation loops (corrections/behavior → suggested digests) | Deal-specific signals (stage moves, pass reasons, red flags) |
| Promotion thresholds and capability lifecycle | Deal automation candidates (source scans, fit refresh…) |
| Retrieval (graph + vector + structured filters, fused) over three knowledge layers: **Personal** (private — emails, meetings, notes, memories), **Workspace** (shared — documents, workflows, decisions), **External** (fetched on demand — docs, standards, research) | Deal evidence layers (deal books, financials, broker emails) mapped onto the three knowledge layers |
| Onboarding framework (why/effect per question, skippable, periodic reflection) | ETA onboarding content (segment, thesis seed, sources) |
| Commons publish/install pipeline with privacy scan | Published sourcing/diligence capability patterns |
| Trust model and safety propagation | Deal-specific risk bands (external outreach = highest) |

**The light-egg constraint (hard requirement):** keep the Egg minimal. The baseline holds only the learning, memory, governance, and generation *machinery*. Everything generalizable — domain blueprints, workflow archetypes, skills, connectors, onboarding content, parser and governance heuristics — lives in Commons and is installed into the Egg, never baked into it. When deciding where a component belongs, default to Commons; put it in the Egg only if it is domain-agnostic machinery the platform cannot function without.

Acceptance test for genericity: **your design must include a short worked example showing Job Pilot instantiated on the same baseline with zero changes to baseline code** — only schemas, skills, and onboarding content differ.

The knowledge graph is the source of truth; vector indexes reference it and are rebuildable from it — never a second source of truth. Domain labels (e.g., "Deal") never become kernel primitives.

---

## 4. Agent architecture you must design against

Five permanent platform Agents; the Deal Copilot assigns goals and tasks to them, and Skills bind to goals/tasks (an Agent's listed access is a default preference, not exclusive ownership):

- **Learning** — observes, researches, remembers. Owns source discovery, retrieval, normalization, evidence collection, provenance, research memory. It suggests; it **never executes** actions or repairs (enforced in code).
- **Internal Strategist** — analysis: thesis and fit reasoning, business quality, diligence synthesis, valuation, scenarios, recommendations, decision materials.
- **Chief of Staff** — the default interlocutor: stakeholder context, coordination, communications, meetings, approvals, commitments, next-action orchestration.
- **Capability Builder** — programs connectors, integrations, skills, schemas, and workflows — as tested, governed **drafts only**.
- **Governance** — data-rights gates, policy review, evidence sufficiency, risk classification, approval routing, audit.

Failure handling is typed and routed — no agent "monitors everything": the runtime handles faults; Governance handles policy violations; Learning analyzes patterns and proposes; Builder changes capabilities; the human owns ambiguous or consequential decisions.

Every Automation declares its trigger/schedule, owner, idempotency key, budget, retry/backoff, stop condition, risk band, invoked Agents, and an immutable run record.

---

## 5. Deal Copilot: the end-to-end flow (what the user experiences)

Domain: **Entrepreneurship Through Acquisition (ETA)** — an individual searcher or small team sourcing, evaluating, diligencing, and acquiring an operating business. The human owns all data rights and every investment decision; the copilot supports judgment, never replaces it.

### Where it starts — Day 0 (the Egg)

1. User installs the Deal Copilot Module. Clicking it opens a standard shell with exactly three default pages: **Deals / Sources / Theses** — all empty, each explaining what will populate it.
2. Onboarding (Egg hatching): a short governed conversation — who they are, what kind of business they want to buy (seed thesis), which sources they already use, optionally a public role model (which triggers cited research whose recommendations land approval-gated). Every answer becomes private local memory the user can inspect, correct, or delete.
3. The user connects their first **Source** (e.g., a listings marketplace account, broker email alerts, a feed). Enabling any account-backed source requires explicit attestation of data rights, scope, and a spend cap. Credentials live in the OS keychain behind a credential broker — never visible to any agent, crawler, log, or export.

### How it flows — the working loop

4. **Sourcing:** governed automations scan authorized sources on schedule and budget → new listings are normalized and deduplicated (high-confidence merges under policy, ambiguous ones to human review, all reversible) and land as **Deals** with full source provenance.
5. **Fit & triage:** each deal gets a transparent thesis-fit evaluation — every factor, evidence item, uncertainty, and score change is explained. The user acts: Pursue / Review / Dismiss (with reasons). **This is the primary learning signal.** Learned ranking may *propose* thesis criteria changes, never silently apply them.
6. **Engagement:** approval-gated outreach, NDA/CIM requests, meeting prep. Draft vs. sent are visually and semantically distinct; every external action shows exact recipient, content, account, cost, and risk before approval. No autonomous external sending at launch.
7. **Diligence:** deal books, financials, and transcripts are imported as versioned files; extraction is reviewable, and corrected values feed learning. Hypothesis trees, evidence matrix, contradictions, gaps, and request-list tracking. Any material claim reaches its source within two clicks. Classified risks each force an explicit deal action (stop, pause, reprice, condition, protection, specialist review, post-close item).
8. **Underwriting:** financial normalization, quality-of-earnings review, add-backs, valuation, scenarios, and return sensitivities — with formula and source-cell lineage preserved, and reported vs. adjusted vs. accepted values kept separate.
9. **Decision:** a cited decision memo with recommendation, assumptions, open questions, dissent, and conditions. The human decides; the decision, rationale, and evidence snapshot are recorded immutably.
10. **Execution readiness:** offer-letter drafting support, financing comparison, closing checklist, first-100-days handoff.

Throughout, the module answers five questions in under two minutes: *What changed? What decision is needed now? What evidence supports the position? What's unknown, stale, or contradicted? What happens next, who owns it, and when?*

### The end result — where learning compounds

11. **Outcome capture:** every pass, pursuit, retrade, and close feeds correction-and-failure memory and evaluation cases. Source quality (unique qualified deals per dollar), extraction accuracy, and fit-ranking quality are attributed and tracked.
12. Over weeks, the copilot demonstrably gets better at *this user's* deal-making: sharper triage, personalized red flags, proposed automations for their repeated behaviors, and eventually trusted routines running within budgets. The end state is a copilot that surfaces good-fit deals earlier, kills bad ones faster with evidence, and compresses the path from listing to confident decision — while the user retains full control and full visibility into why.
13. **Generalization:** capability patterns that prove out are privacy-scanned, signed, and published to Commons — the flywheel that makes the next user's (and the next module's) Egg hatch smarter, without ever sharing anyone's personal data.

---

## 6. Non-negotiable constraints (governance, trust, security)

Your design will be reviewed against these; treat them as hard requirements.

- **Capability trust model.** Risk is *computed* from a capability manifest (informational → advisory → transformational → operational → external), composed as the maximum over the dependency closure. Capabilities move through explicit lifecycle states (draft → validated → approved → active → trusted → retired). Trust decays over time and resets when dependencies change. Auto-activation is budgeted and has a kill switch. Failure → immediate auto-suspend; safety never queues.
- **Provenance and trust labels propagate at runtime** from source through prompt, model, skill, action, event, result, and file; policy evaluates the joined label at every sink. Unknown labels fail closed. Untrusted external content is quarantined until deterministically validated or explicitly declassified by the human.
- **A prompt-injection evaluation suite is a permanent gate from the first memory milestone** — not retrofitted. Hard metrics: injection pass rate 100%, unauthorized memory writes 0, learning-side executed actions 0, cross-plane leaks 0.
- **Residency:** raw capture stays local; private data cannot egress; local-to-network is deny by default. All external fetches go through a shared network guard and rights-approved providers only.
- **Credentials:** capability code never owns OAuth or secrets; a credential broker grants temporary scoped access. Reveal/copy requires human re-authentication and is audited.
- **Human accountability:** no autonomous investment or rejection decisions, no fund movement, no signature authority, no bypassing terms, rate limits, or access controls. External actions always show exact scope before approval.
- **Commons privacy gate:** payloads are scanned before publishing; personal identifiers, secrets, field values, raw captures, and org-specific content are rejected. Entries are immutable, cryptographically signed, and provenance-pinned; installs re-verify signature, dependencies, risk, and approval.
- **UX honesty:** interactive-looking UI must perform, open, or explain a governed action; permission-denied actions look unavailable, not enabled; restricted info is an explicit access state, never a blur. Accessibility target WCAG 2.2 AA; core actions operable at mobile width.

---

## 7. What we need from you (deliverables)

Produce an **engineering design document** (not code) covering:

1. **Learning substrate architecture** — the generic Egg baseline: memory data model (entries with provenance, trust tier, confidence, decay, correction history), an event/signal taxonomy for explicit and implicit interaction signals, the observation → suggestion → acceptance pipeline, and the retrieval design (graph + vector + structured filter fusion, with an evaluation methodology).
2. **Zero-to-expert progression design** — the staged capability curve (observe → suggest → draft → automate → trusted), the promotion mechanism and how thresholds are evaluated and tuned, and the UX contract for showing the user what has been learned and why behavior changed.
3. **Deal Copilot instantiation** — how the baseline is configured for the flow in §5: which signals map to which learning outcomes; which skills/automations are promotion candidates; the thesis-fit learning loop in detail (features, feedback incorporation, drift/regression protection, explanation surface).
4. **Commons integration design** — the generalization pipeline from a personal learned capability to a privacy-scrubbed signed Commons entry, and the install path back into a fresh module; versioning, pinning, lineage. This must include the **cross-workspace archetype-mining design**: how Commons recognizes that many independent workspaces have developed similar patterns (e.g., similar document-intake workflows) and mints a reusable capability archetype from the commonality — *without ever seeing any workspace's personal data*. Specify what abstracted signals workspaces may contribute, how similarity is computed over them, the privacy proof, and how minted archetypes flow back so every new workspace starts smarter than the last.
5. **Genericity proof** — the Job Pilot worked example (§3): the same baseline instantiated for job searching with configuration-only changes.
6. **Safety architecture** — how your design satisfies every constraint in §6, including the injection evaluation harness and trust-label propagation through the learning loop specifically (learned memory is the platform's biggest injection surface).
7. **Evaluation plan** — offline evaluation cases, online metrics, baselines, and regression gates for learning quality; a cost model per learning loop (batch where possible; small models for observation, large models only for synthesis).
8. **Phasing** — an incremental delivery sequence where each slice is independently shippable with real data and honest empty states, and the earliest slices already exercise the memory + injection-evaluation foundation.

**Format:** Markdown design doc with diagrams (Mermaid preferred). Cite trade-offs and rejected alternatives for every major decision — our governance process records rationale and consequences.

Parts of the platform substrate (module shells, base memory storage, governed web research, the Commons registry service, and onboarding flow) already exist; your design should build on such foundations rather than redesign them. Detailed integration points will be shared after engagement start.

## 8. Success criteria for your design

- A new user reaches their first real, provenance-backed deal in the pipeline within one session, starting from a completely empty module.
- Within 30 days of normal use, measurable personalization: rising suggestion-acceptance rate, falling correction rate, and at least one user-approved automation promoted from observed behavior.
- The same baseline demonstrably instantiates Job Pilot with configuration only.
- Zero violations of the §6 hard safety metrics in the evaluation harness.
- Every learned behavior is explainable to the user in one click: what was learned, from which evidence, and how to correct or delete it.
- The user never feels like they are training an AI or being monitored — learning is a natural consequence of normal work, and value arrives without ceremony.
- Every new workspace starts smarter than the last: archetypes mined by Commons measurably improve the generated starting point for fresh installs, with zero personal data shared.
