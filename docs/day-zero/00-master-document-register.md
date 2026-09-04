# Master document register

## Purpose

A strong day-zero package separates enduring truth, working hypotheses, operating rules, and evidence. Bridge accumulated many of these during development. The better starting point would have made ownership and approval explicit before code.

## Required document system

| Document | Why it is needed | Day-zero owner | Review rhythm | Location |
|---|---|---|---|---|
| Founder memo | Aligns purpose, problem, principles, and non-goals | Founder/CEO | Quarterly | [Draft](./01-founder-memo.md) |
| Product brief and PRD | Defines users, jobs, scope, requirements, and acceptance | Product | Monthly while pre-PMF | [Draft](./02-product-brief-and-requirements.md) |
| Vocabulary and ontology | Stops product, code, and governance language from drifting | Product + Architecture | With every canonical change | [Canonical](../glossary.md) |
| Experience principles | Defines Avatar, Onboarding, trust, accessibility, and states | Product Design | Each release | [Draft](./03-avatar-and-onboarding-experience.md) |
| Design system | Makes shared surfaces coherent | Design | Each release | [Existing](../raw/DESIGN-SYSTEM.md) |
| UI architecture rules | Prevents every Module becoming a bespoke app | Product + Frontend | Each surface change | [Canonical](../raw/ui-architecture-rules-2026-07.md) |
| Platform and Module model | Defines Engine versus Module responsibilities | Architecture + Product | Quarterly | [Draft](./04-platform-engine-and-modules.md) |
| Module BRD template | Gives every Module the same outcome, data, Agent, Skill, Automation, and evaluation contract | Product | Per Module | [Covered by draft](./04-platform-engine-and-modules.md) |
| Commons strategy | Defines what may be shared, signed, installed, and monetized | Product + Security | Quarterly | [Draft](./05-commons-and-distribution.md) |
| Governance and authority model | Defines who may decide and execute what | Security + Product | Each authority change | [Draft](./06-governance-data-privacy-security.md), [canonical depth](../raw/authority-model.md) |
| Privacy and data-residency policy | Defines Local Plane, Cloud Plane, egress, retention, correction, and deletion | Privacy + Architecture | Each data-flow change | [Draft](./06-governance-data-privacy-security.md) |
| Threat model and security plan | Makes abuse cases and release controls explicit | Security | Each major release | [Existing](../raw/security-audit-2026-07.md) |
| Technical architecture | Defines boundaries, contracts, deployment, and evolution rules | Engineering | Quarterly | [Draft](./07-technical-architecture.md) |
| Architecture decisions | Records non-trivial decisions and rejected alternatives | Architecture | Continuous | [Canonical](../raw/decisions-log.md) |
| API and event contracts | Prevents client and runtime drift | Engineering | With version changes | Existing source plus [codemaps](../CODEMAPS/flows.md) |
| Testing and evaluation strategy | Defines product, security, Agent, and release evidence | Quality + Engineering | Each release | [Existing](../raw/testing-strategy.md) |
| Business model | States buyer, packaging, pricing hypotheses, and economic constraints | Founder + Finance | Quarterly | [Draft](./08-business-model-and-go-to-market.md) |
| Go-to-market plan | Defines first wedge, customer acquisition, proof, and expansion | Founder + Growth | Monthly | [Draft](./08-business-model-and-go-to-market.md) |
| Pilot charter | Makes audience, boundaries, support, and success criteria explicit | Product + Customer Success | Per pilot | [Draft](./09-pilot-launch-support-operations.md) |
| Service operations manual | Defines incidents, support, release, rollback, backup, and continuity | Operations | Each release | [Draft](./09-pilot-launch-support-operations.md) |
| Metrics tree | Connects user value to quality, trust, growth, and cost | Product + Data | Monthly | [Draft](./10-metrics-and-economics.md) |
| Unit economics | Prevents model and support costs from hiding product weakness | Finance + Product | Monthly | [Draft](./10-metrics-and-economics.md) |
| Legal and compliance plan | Covers IP, licenses, AI disclosures, privacy, contracts, and sector limits | Legal + Founder | Quarterly | [Draft](./11-risk-legal-and-compliance.md) |
| Risk register | Gives each material risk an owner, trigger, treatment, and gate | Leadership | Monthly | [Draft](./11-risk-legal-and-compliance.md) |
| Roadmap and resourcing | Sequences hypotheses by dependency and names required capabilities | Leadership | Monthly | [Draft](./12-roadmap-and-resourcing.md) |
| Go-live proposal | Turns the above into a bounded launch decision | Founder + Launch owner | Until launch | [Draft](./13-go-live-proposal.md) |
| Open-decision register | Prevents assumptions from silently becoming policy | Founder + Product | Weekly pre-launch | [Draft](./14-open-decisions.md) |
| Work ledger | One ordered execution queue | Product + Engineering | Continuous | [Canonical](../TASKS.md) |
| Change and delivery evidence | Keeps claims auditable | Delivery owner | Continuous | [Log](../log.md), [outputs](../../outputs/README.md), [commit archive](../commit-history/README.md) |

## What would have improved the build most

The highest-leverage documents would have been:

1. A one-page founder memo declaring Living Software as the product and DealPilot/Relationship/JobPilot as Modules.
2. A canonical vocabulary before schemas and routes were named.
3. A trust and authority model before adding Agents, external actions, or capture.
4. A Local Plane/Cloud Plane data map before integrations.
5. A Module manifest and UI grammar before building separate product surfaces.
6. A formal Avatar state and permission contract before visual exploration.
7. A Commons package, signing, privacy, provenance, and compatibility contract before distribution.
8. A pilot charter with one buyer, one measurable job, and explicit non-goals.
9. An evaluation plan that measures useful completed work, correction, trust, and cost—not feature count.
10. A release gate that requires real-user evidence, rollback, support ownership, and legal review.

## Document-control rule

Every document must state whether it is canonical, a proposal, a working plan, or evidence. Only the glossary, approved decisions, and current task ledger may define current platform truth. Research and historical requirements remain valuable, but they do not silently override current decisions.

