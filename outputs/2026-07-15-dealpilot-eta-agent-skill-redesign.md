# DealPilot ETA + platform Agent/Skill redesign

## Outcome

DealPilot plan now follows one strict surface model:

- default Pages: Deals, Sources, Theses only;
- every Database row opens dedicated Record Detail;
- Overview, Summary, Reports, Files, Results, Integrations, Relations, Tasks, and activity are Sections/Views, not automatic Pages;
- user may add a Page only from an eligible Database-backed source;
- capability inventory uses one platform structure; DealPilot customizes live contents only.

DealPilot is now explicitly ETA-focused. User personas were removed.

## Source credentials

Source schema now includes Link, credential reference, Last checked, Spend cap, spend-to-date, rights state, health, schedule, and yield. Sources table projects virtual User ID and Password columns like Chrome/Edge password managers. Raw secrets remain in Credential Broker/keychain/vault, not Source rows.

Reveal/copy requires explicit Human gesture plus recent re-authentication, is time-limited and audited, and never exposes values to Agents, Skills, Automations, crawlers, ordinary APIs, logs, prompts, exports, Files, Results, or persistent browser storage.

Source activation, scope growth, schedule change, and spend-cap increase show data-rights onus and approval. User owns commercial data rights, but this does not permit Bridge to bypass access controls, authentication, terms, rate limits, or law. Ambiguous commercial use stops for counsel/upstream permission.

## Agent evaluation

Proposed responsibility split aligns with intended architecture:

- Learning: authorized research, retrieval, evidence, provenance;
- Internal Strategist: analysis, hypothesis testing, fit, financial/scenario work, recommendations;
- Chief of Staff: stakeholder context, coordination, communication, approvals, commitments;
- Capability Builder: programming, connectors, Skills, Integrations, schemas, tests;
- Governance: review, policy/control explanation, risk, audit; deterministic kernel still decides.

Nine DealPilot specialist Agents were overfit. Their work is covered by permanent Agents plus Goal/Task-bound Skills. No separate DealPilot Agent is currently justified. Separate Agent remains allowed only for durable identity, authority/data isolation, independent evaluation lifecycle, independent queue/cadence, or irreducible conflict of duties.

Skills now bind primarily to Goal/Task contracts. Agent defaults are preferences, not ownership. A newly assigned eligible Agent may select a matching Skill only after identity, authority, Plane, data scope, data rights, risk, budget, and evaluation gates pass.

Agents may create bounded child Agent Runs. Children inherit only intersections/subsets of parent authority, Skills, data, budget, Review Mode, runtime taint, and delegation depth. Parent remains accountable; child cannot reveal credentials, self-review the parent, expand authority, or perform consequential external Actions without required Human approval.

## Platform feedback

Green/yellow feedback flags are retired. Red flag becomes one platform correction primitive: hover/focus any eligible cell or bullet → subtle uncolored flag; select → red; inspect/edit/clear remains reversible and audited. Absence of red flag is not positive feedback. Domain choices use explicit Pursue/Review/Dismiss/Approve/Reject Actions.

## JobPilot culture research

JobPilot gains JP3B. Learning researches permitted company pages, Google reviews, Reddit, blogs, and Glassdoor only when access and terms allow. Internal Strategist separates fact, attributed opinion, repeated theme, contradiction, recency, uncertainty, and inference before producing cover-letter/interview guidance. Restricted, paywalled, prohibited, or ambiguous Sources are skipped or stopped for permission; no bypass or invented insider claim.

## Updated plans

- `docs/raw/brd-dealpilot-2026-07.md`
- `docs/raw/dealpilot-module-plan-2026-07.md`
- `docs/raw/brd-jobpilot-2026-07.md`
- `docs/raw/jobpilot-module-plan-2026-07.md`
- `docs/raw/agent-goal-skill-orchestration-plan-2026-07.md`
- `docs/raw/ui-architecture-rules-2026-07.md`
- `docs/glossary.md`
