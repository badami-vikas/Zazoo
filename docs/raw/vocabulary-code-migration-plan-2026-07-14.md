---
title: Canonical vocabulary and code migration plan
type: raw
doc_kind: plan
status: active
companions: [requirement-vocabulary-planes-relationship-taint-2026-07-14.md, ../glossary.md, relationship-module-plan-2026-07.md, ui-architecture-rules-2026-07.md, repo-restructure-egg-commons-2026-07.md]
related_wiki: ../wiki/ontology.md
updated: 2026-07-14
tags: [vocabulary, migration, code, schema, api, ui, cleanup, avatar, engines, modules]
---

# Vocabulary and code migration

`docs/glossary.md` is the only canonical glossary. This plan is the migration ledger, so historical names may appear here only to identify what must be removed.

## Decisions

```yaml
canonical:
  product_structure: [Organization, Module, Page, View, List, Section, Database, Record, Field, Relation, File]
  execution: [Request, Plan, Decision, Run, Action, Event, Result, Automation]
  actors_capability: [Human, Agent, Skill, Integration, Engine, Capability]
  context_interface: [Memory, Knowledge, Avatar, Onboarding]
  residency_services: [Local Plane, Cloud Plane, Plane Gate, Relationship Domain, Work Domain, Commons, Bridge Cloud]
retire_from_product_and_code:
  - Workspace where it means Organization or Module
  - Package
  - Project
  - Initiative
  - Element and ElementType
  - Touchpoint
  - Ritual
  - Workflow
  - Signal and Incident
  - Artifact
  - Tool as a product primitive
  - Mirror Plane
  - Operational Plane
  - Cross Plane
  - Infra Plane
  - Brain
  - Egg
  - Creature
  - Hatch and Hatching
  - Mature and Maturity when describing the Avatar
  - Spirit Animal
  - Avatar Personality State
  - 14-Step Day-1 Onboarding
```

## Semantic rules

- Files replace user-visible Artifacts. Non-file outputs are Results. Database Records remain Records.
- Project and Initiative do not become Modules. Module is installed functionality; project-like user data becomes a domain Record with the user’s chosen label.
- Relation stores exactly one semantic relation type plus any number of typed attributes and evidence references. Multiple meanings require multiple Relation rows. N-ary relationships use a case/interaction Record plus participant Relations.
- Avatar has operational presence states only. Blink is an Event tell emitted by capture and does not become a persistent state. No lifecycle/personality taxonomy.
- Local/Cloud are the only Planes. Relationship/Work are Domains. Commons and Bridge Cloud are services. Do not merge Avatar with Local Plane or Commons with Cloud Plane: interface identity, residency, registry, and hosted execution have different security invariants.

## Legacy plane interpretation

These names describe what earlier drafts were trying to separate; none remains a Plane:

| Legacy name | Earlier intent | Canonical replacement |
|---|---|---|
| Mirror Plane | People, Communities, and their relationship graph | Relationship Domain |
| Operational Plane | Work and execution objects | Work Domain |
| Cross Plane | Whitelisted links or movement between those groupings | Relation plus Plane Gate policy; not a storage boundary |
| Infra Plane | Engines, policy, sync, registry, and hosted control machinery | Engine/runtime, Commons, or Bridge Cloud according to responsibility |

Calling all four “planes” falsely implied four residency/security boundaries. Only Local and Cloud have that meaning.

## Migration batches

```yaml
migrations:
  VOCAB0_inventory_and_guard:
    tasks:
      - generate symbol/schema/route/copy inventory for every retired term
      - add lint/CI denylist for new retired identifiers outside migrations, compatibility adapters, tests, and historical requirement/ADR files
      - classify each occurrence as schema, API, runtime type, UI, persisted payload, localStorage, test, or historical documentation
    exit: inventory committed; new retired code identifiers fail CI
  VOCAB1_avatar_and_onboarding:
    code:
      - EggHatcher -> AvatarSetupProgress
      - EggStage -> AvatarSetupState
      - SpiritAnimal -> AvatarStyle
      - spirit_animal -> avatar_style
      - eggHatched -> avatarReady
      - onHatched -> onAvatarReady
      - remove animal-to-personality authority/tone coupling; Avatar style stays visual only
      - migrate localStorage + onboarding-profile payloads with one-version compatibility reads, then delete old writes
    ui:
      - use Onboarding only; remove lifecycle ceremony/stage copy
      - keep blink wired only to sensor.capture Event
    exit: no retired Avatar identifiers in runtime code, schema, payload writes, tests, or UI; existing users migrate without re-onboarding
  VOCAB2_automation_and_engine:
    code:
      - ritual* -> automation* across types, executor, routes, tables, migrations, events, tests
      - workflow copy/routes -> automation; no UI-only alias
      - brain directories/types/docs -> engine; preserve specific names such as RoutingEngine and MemoryEngine
      - tool product APIs -> skill/integration/module APIs according to actual behavior
    exit: new canonical routes/types/tables are source of truth; compatibility reads are time-boxed and removed after migration
  VOCAB3_organization_module_record:
    code:
      - workspace_id -> organization_id with RLS, foreign keys, indexes, APIs, clients, migration, and backfill
      - package* -> module* manifests/installations/routes/stores/files
      - initiative/project/element types and tables -> module-owned Database/Record/Relation contracts
      - preserve domain labels such as Deal or Help Request as Record types, not kernel primitives
    exit: production schema and runtime identifiers use Organization/Module/Database/Record/Relation; no dual-write remains
  VOCAB4_event_result_file:
    code:
      - touchpoint/signal/incident -> typed Event + participant/evidence Relations
      - artifact -> File when file-backed; otherwise Result
      - timeline entries -> read projection over Events
      - migrate local folders and APIs from Artifacts to Files without moving user content unexpectedly
    exit: Events are one occurrence ledger; Files section and storage paths are canonical; old tables/routes removed after verified backfill
  VOCAB5_relationship_module:
    code:
      - consolidate People, Communities, Relations, Interactions, Introductions, Helpdesk, Sources, and Automations under installed Relationship Module manifest/routes
      - use standard Page/View/List/Section/Files layout and shared toolbar/context menus
      - remove hardcoded standalone Helpdesk and legacy Bridge/KnowledgeBase navigation after data+route migration
    exit: real-path browser proof on desktop and 375px; no duplicate stores/routes/nav; cross-module consumers use shared Record/Relation APIs
```

Every batch requires database backup/restore rehearsal, forward and rollback migration tests, API contract tests, RLS checks, browser evidence, and a repository search proving the retired identifiers remain only in historical records or explicitly time-boxed compatibility code.
