# Ontology

canonical glossary: [../glossary.md](../glossary.md) · migration:
[../raw/vocabulary-code-migration-plan-2026-07-14.md](../raw/vocabulary-code-migration-plan-2026-07-14.md)

Keep kernel vocabulary small. Product terms and code identifiers converge; no display-only aliases.

## Canonical model

- Structure: Organization → installed Modules → Pages → Views/Lists/Sections → Databases → Records/Fields/Relations.
- Work: Request → Plan → Decision → Run → Actions → Events → Result. Result may produce Files.
- Actors: Human, Agent, Automation.
- Capabilities: Skill, Integration. Capability = umbrella. Engine = internal runtime machinery.
- Context: Memory + Knowledge.
- Interface: Avatar + Onboarding.
- Residency: Local Plane / Cloud Plane, joined only through Plane Gate.
- Domains: Relationship Domain + Work Domain. Domain is grouping, never residency.
- Services: Commons (generalized capability registry, no personal data) + Bridge Cloud (hosted control/sync services).

## Important boundaries

- Module ≠ user project. Module = installed functionality. Domain work is stored as Records named for that domain.
- Engine ≠ Skill ≠ Automation. Engine provides runtime mechanics; Skill performs bounded callable work; Automation triggers/schedules governed Runs and coordinates Skills through Engines.
- File = user-visible durable file. Non-file output = Result.
- Relation = one semantic relation plus typed attributes and evidence refs. Use multiple Relation rows for multiple meanings; participant Records for n-ary relationships.
- Avatar ≠ Local Plane. Commons ≠ Cloud Plane. UI identity, residency boundary, registry, and hosting are separate security concepts.
- Blink = short `sensor.capture` Event tell. Avatar may expose operational presence; no personality/lifecycle state model.

## Failure ownership

- Engine detects immediate runtime faults and performs bounded retry, timeout, idempotency, rollback/compensation, circuit-break, or safe-stop behavior.
- Governance monitors policy violations, unauthorized actions, approval errors, budget breaches, provenance/signature failures, and repeated control failures. Kernel decides; Governance explains and proposes remediation.
- Learning Agent analyzes corrections, outcomes, and repeated failure patterns. It suggests Memory, thresholds, Skills, or Automations; it never executes repairs.
- Capability Builder changes broken Skills, Automations, Integrations, or Modules through tested governed proposals.
- Human owns ambiguous, consequential, or policy-changing decisions.

No agent monitors “all failures.” One typed Failure Event routes by class and severity, preventing duplicated correction loops.

## Invariants

- Every mutation resolves authority → policy → immutable record.
- Runs bounded, attributable, replayable. No ungoverned peer handoff.
- Agent-floor deny non-removable. One distinguished governance authority per Organization.
- Local-to-network deny by default. Private data cannot egress.
- Taint/provenance propagate at runtime from source through prompt, model, Skill, Action, Event, Result, and File; policy evaluates the joined label at every sink.
- Promotion never changes category: Skill stays Skill; Automation stays Automation; Agent stays Agent.
