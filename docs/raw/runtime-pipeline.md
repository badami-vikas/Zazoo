---
title: Runtime Pipeline
type: raw
doc_kind: architecture
status: draft
updated: 2026-07-07
companions:
  - primitive-specifications.md
  - authority-model.md
  - ARCHITECTURE.md
tags: [pipeline, runtime, execution, governance]
---

# Runtime Pipeline

The Runtime Pipeline is the shared execution path for governed mutation. It is
not part of the definition of Agent, Skill, Automation, Workspace, or any other
primitive.

## Baseline in code

The current implementation lives primarily in:

- `platform/packages/core/src/pipeline.ts`
- `platform/packages/core/src/ports.ts`
- `platform/packages/core/src/types.ts`
- `platform/packages/core/src/ritual-executor.ts`
- `platform/apps/api/src/router.ts`

The platform README and architecture docs summarize the runtime as:

```text
Request
  -> Authority
  -> Policy(pre)
  -> Agent + Skill
  -> Policy(runtime)
  -> Review
  -> Ledger
  -> Policy(post)
  -> Incident/Event
  -> Signal/Artifact/Element update
```

## Execution vocabulary

- Human, Agent, and Automation initiate or coordinate work.
- Skill is an executable capability invoked by an actor/coordinator.
- Action is an atomic work operation, usually implemented as a tool call,
  function call, API call, command, provider operation, or system operation.
- Incident records what happened.
- Signal is a meaningful derived Incident or pattern over Incidents.

## Pipeline stages

### 1. Request

A Request enters with actor, action, resource type, inputs, Skill name, optional
run context, data scope, and seed. Raw Human intent is a Request in
`raw_intent` state before normalization.

### 2. Authority

The Authority Model resolves whether the actor may attempt the action. Authority
is a Governance sub-model.

### 3. Policy(pre)

Pre-policy evaluates the requested action and inputs before any Skill runs.

### 4. Agent + Skill

The chosen Skill produces proposed output. If the actor is an Agent, allowed
skill constraints apply before invocation.

### 5. Policy(runtime)

Runtime policy evaluates the proposed output.

### 6. Review

Agent actions and policy-marked actions stop as pending proposals unless bounded
auto-mode explicitly permits commit. Humans approve, veto, or edit.

### 7. Ledger

The ledger is append-only. A decision is a new row referencing the proposal.

### 8. Policy(post)

Post-policy is advisory/observability-oriented because the action is already
committed.

### 9. Incident/Event

Committed actions and runtime transitions emit Incidents or Events. External
systems can also emit Incidents without a Bridge Action causing them.

### 10. Signal, Artifact, or Element update

Signals may derive from Incidents. Artifacts and Element updates become visible
through stores and Workspaces.

## How primitives use the pipeline

- Requests are normalized before or during pipeline entry.
- Agents draft and propose through the pipeline.
- Chief of Staff is an Agent archetype that routes Requests to registered
  capabilities.
- Skills run inside the pipeline and may call Actions.
- Automations execute mutating steps through the pipeline.
- Actions run under governed callers.
- Workspaces submit user commands into the pipeline.
- Integrations are consumed by Actions/Skills after authority and plane checks.

## Runtime invariants

1. Every mutation goes through governed runtime.
2. Agents draft; Humans approve where approval is required.
3. The ledger is append-only.
4. Policy runs before and after Skill execution.
5. Deterministic execution receives clock, random, and id generation from
   runtime context.
6. Review decisions are auditable.
7. External send/share and local-private egress are gated.

