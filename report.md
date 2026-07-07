# Bridge primitive architecture report

## Executive brief

The ontology has been revised around a smaller, cleaner primitive set.
Authority is now explicitly part of Governance, while retaining a dedicated
Authority Model document for the resolver. Intent is no longer a primitive; it
is a raw Human-originated Request. Chief of Staff is no longer a primitive; it
is an Agent archetype. Project is no longer a primitive; it is an ElementType
inside a Workspace. Signal is no longer a root primitive; it is a meaningful
derived Incident.

The key execution rule is now explicit:

> Humans, Agents, and Automations initiate or coordinate work. Skills and
> Actions execute only when invoked. Everything else is context, work state,
> structure, output, history, or surface.

## Added

### `docs/raw/primitive-specifications.md`

Replaced the earlier primitive list with the corrected taxonomy:

- Execution actors/coordinators: Human, Agent, Automation.
- Capability primitives: Skill, Integration.
- Work primitives: Request, Action, Incident, Artifact.
- Surface/structure primitives: Workspace, Element, ElementType, View.
- Context primitives: Memory, Knowledge.

The document now explicitly defines:

- Intent as `Request.state = raw_intent`.
- Chief of Staff as an Agent archetype.
- Project as an ElementType.
- Signal as a meaningful derived Incident.
- Action as an atomic work operation, usually implemented as a tool call,
  function call, API call, command, provider operation, or system operation.

It also adds Artifact examples:

- investment memo
- founder research brief
- diligence report
- valuation model
- financial model spreadsheet
- KPI dashboard export
- meeting prep brief
- call summary
- board update
- investor update
- draft email
- outreach sequence
- LOI draft
- contract summary
- risk register
- market map
- target company list
- candidate shortlist
- presentation deck
- CSV export
- PDF report
- decision log
- postmortem
- 100-day plan
- integration audit report

### `docs/raw/authority-model.md`

Reframed Authority as a Governance sub-model. The document still references the
existing resolver code because authority resolution remains a distinct mechanism
inside governance.

### `docs/raw/runtime-pipeline.md`

Updated runtime vocabulary:

- Human, Agent, and Automation initiate or coordinate work.
- Skill is an executable capability invoked by an actor/coordinator.
- Action is an atomic work operation.
- Incident records what happened.
- Signal is derived from Incidents.

### `docs/raw/capability-evolution.md`

Added explicit downgrade, suspend, and kill rules.

Downgrade triggers include low-confidence outputs, repeated Human edits,
evaluation regression, stale dependencies, degraded Integration reliability,
cost overruns, policy changes, and owner trust reduction.

Kill triggers include data leaks, external-send violations, credential
compromise, runaway cost, unsafe repeated behavior, privilege escalation,
governance self-modification attempts, malicious packages, and repeated policy
bypass.

Killed objects cannot be reactivated in place; recovery requires a new governed
version or replacement object.

### `docs/wiki/ontology.md`

Updated the wiki summary to reflect the corrected taxonomy and mappings.

## Modified

### `docs/wiki/index.md`

Updated the Ontology entry to call out the major mappings:

- Intent = Request state
- Chief of Staff = Agent archetype
- Project = ElementType
- Signal = derived Incident
- Workspace replaces user-facing Tool language

## Removed

No files were removed.

Conceptually removed:

- Intent as a separate primitive.
- Chief of Staff as a separate primitive.
- Project as a separate primitive.
- Signal as a root primitive.
- Action as an execution actor.
- Authority as a peer of Governance.
- Category-changing promotion.

## Per-primitive brief

### Human

Execution actor and owner of intent, judgment, approval, and accountability.

### Agent

Execution coordinator and responsible domain actor. Chief of Staff is an Agent
archetype.

### Automation

Execution coordinator for deterministic work over time.

### Skill

Executable capability invoked by Humans, Agents, or Automations. It does not
decide to run itself.

### Integration

Governed external-system capability. Replaces Connection.

### Request

Unit of wanted work or judgment. Raw Human intent is a Request in `raw_intent`
state.

### Action

Atomic work operation. Usually implemented as a tool call, function call, API
call, command, provider operation, or system operation. It is triggered by an
execution actor/coordinator.

### Incident

Append-only record of something that happened. It may be caused by an Action,
Human decision, Integration webhook, external observation, Automation
transition, or system event.

### Signal

Not a root primitive. A meaningful derived Incident or pattern over Incidents.

### Artifact

Produced deliverable with provenance, versioning, review state, and sharing
governance.

### Workspace

User-facing operating surface and container for Elements, Views, capabilities,
Requests, Artifacts, Memory, and Knowledge.

### Element

Typed object inside a Workspace: row, card, graph node, table record, or object.

### ElementType

Governed schema and behavior definition for Elements. Project, Person,
Community, Resource, Deal, Job, Meeting, Help Request, Memory, and Knowledge
Item can all be ElementTypes.

### View

Projection over Elements: table, board, calendar, graph, map, gallery,
dashboard, or detail page.

### Memory

Dynamic learned information with scope, provenance, confidence, and
supersession.

### Knowledge

Curated reference material. Person, Community, Resource, and Knowledge Item may
also appear as ElementTypes when they need workspace/table behavior.

