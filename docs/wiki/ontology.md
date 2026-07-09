# Ontology

full: [../raw/primitive-specifications.md](../raw/primitive-specifications.md)

Bridge primitives use one template: purpose, definition, responsibilities,
boundaries, inputs, outputs, identity, persona, behaviors, habits, governance,
dependencies, consumes, produces, lifecycle, runtime, persistence,
observability, and evolution.

Authority is part of Governance. It has a separate model because authority
resolution is a core mechanism.

Shared docs:

- [Authority Model](../raw/authority-model.md): governance sub-model for who may
  act.
- [Runtime Pipeline](../raw/runtime-pipeline.md): how governed work executes.
- [Capability Evolution](../raw/capability-evolution.md): promotion, downgrade,
  suspend, kill, trust, maturity, autonomy, and composition.

Canonical taxonomy:

- Execution actors/coordinators: Human, Agent, Automation.
- Capability primitives: Skill, Integration.
- Work primitives: Request, Action, Incident, Artifact.
- Surface/structure primitives: Workspace, Element, ElementType, View.
- Context primitives: Memory, Knowledge.

Important mappings:

- Intent = raw Human Request, not a separate primitive.
- Chief of Staff = Agent archetype, not a separate primitive.
- Signal = meaningful derived Incident, not a root primitive.
- Project = ElementType, not a separate primitive.
- Action = atomic work operation, usually implemented as a tool call. It does
  not execute itself.
- Current code `ritual` / "Workflow" = Automation.
- Current code `tool` / `ToolManifest` = implementation/package surface;
  user-facing primitive = Workspace.
- Connection = Integration.

Key rule: promotion never mutates primitive category. A Skill stays a Skill, an
Automation stays an Automation, and an Agent stays an Agent. Promotion creates a
new governed object that consumes the existing primitive.

