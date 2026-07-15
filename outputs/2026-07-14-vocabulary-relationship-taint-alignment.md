# Vocabulary, Relationship Module, failure ownership, and runtime taint alignment

## Decisions

- Governance does not monitor or repair every failure. Engine handles bounded operational recovery; Governance handles policy/control remediation; Learning finds recurring patterns; Capability Builder implements tested changes; Human resolves consequential ambiguity.
- Local Plane and Cloud Plane are the only Planes. Relationship Domain and Work Domain organize data. Commons and Bridge Cloud are separate services.
- A Relation may hold many typed attributes and evidence references, but exactly one semantic relation. Multiple meanings use multiple Relation rows; group relationships use participant records.
- One maintained canonical glossary now lives at `docs/glossary.md`. Retired terms are excluded from it and enumerated only in the code migration plan.
- File replaces user-visible Artifact; non-file output is Result. Module means installed functionality. Project and Initiative are not retained as primitives; domain work becomes Records named by the Module/user.
- Engine is runtime machinery; Skill is a bounded callable job; Automation owns trigger/schedule and coordinates governed Runs.
- Avatar is the sole companion term. No lifecycle/creature/personality taxonomy; visual style does not set Agent tone or authority. Blink is the capture Event tell. One Onboarding flow replaces staged naming.
- Avatar is not Local Plane and Commons is not Cloud Plane. Combining them is rejected because interface identity, residency, registry, and hosted execution have different security boundaries.

## Simplification map

| Replace | With | Reason |
|---|---|---|
| Mirror / Operational planes | Relationship / Work Domains | They classify graph content, not residency. |
| Cross Plane | Relation + Plane Gate rule | A link or governed crossing is not another place data lives. |
| Infra Plane | Engine/runtime, Commons, or Bridge Cloud | The responsibility must be named instead of creating a catch-all boundary. |
| Brain | Engine | Runtime machinery has no implied personality or authority. |
| Workspace | Organization, Module, or View | The old word mixed security boundary, installed functionality, and screen. |
| Package | Module | One installed-functionality term. |
| Project / Initiative / Element | Module-owned Record | User work is data, not a new platform primitive. |
| Touchpoint / Signal / Incident | typed Event | One append-only occurrence model. |
| Ritual / Workflow | Automation | One trigger/schedule-driven execution term. |
| Artifact | File when file-backed; otherwise Result | Avoid two names for stored files and distinguish non-file outcomes. |
| Tool | Skill, Integration, Module, or Engine | Classify by actual behavior rather than a catch-all. |
| Egg / creature / hatch / maturity / spirit animal / personality states | Avatar | One companion concept; visual style cannot control behavior or authority. |
| staged Day-1 ceremony wording | Onboarding | One progressive trust-and-first-value flow. |

## Implementation reality

This change intentionally does not claim old identifiers are gone. Current code still contains hundreds of legacy schema/API/type/UI names, including concrete Avatar payloads/components. `VOCAB0–VOCAB5` requires inventory+CI guard, schema/API/type/file renames, data backfills, compatibility reads where necessary, and deletion of aliases. UI-only copy cannot satisfy any batch.

## Relationship Module

Relationship is one installed Module: People/Communities/Relations toggle Pages; Interactions, Introductions, Helpdesk, Sources, and Automations sub-modules; Today landing; standard toolbar/context menus/Files Section; shared Record/Relation/Event APIs. Helpdesk is no longer planned as unrelated permanent chrome.

## Runtime taint

RT0–RT4 closes the root gap: label+lattice and required runtime envelope; prompt/model/Skill/Action propagation; complete source/sink instrumentation; quarantine/joined-label policy; backfill/trace/metrics/replay and compatibility removal. High-autonomy research/MCP/ambient execution is gated until RT3.
