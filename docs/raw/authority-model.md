---
title: Authority Model
type: raw
doc_kind: governance
status: draft
updated: 2026-07-07
companions:
  - primitive-specifications.md
  - runtime-pipeline.md
  - ARCHITECTURE.md
tags: [authority, governance, agents, policy, local-first]
---

# Authority Model

Authority is part of Governance. It is documented separately because authority
resolution is the core mechanism that answers:

> Who may do what, to which resource, under which scope, right now?

Governance is broader. It includes authority, policy, review, approval,
audit/ledger, risk, lifecycle, rollback, kill switches, data residency,
observability, and change management.

## Baseline in code

The current implementation lives primarily in:

- `platform/packages/core/src/authority.ts`
- `platform/packages/core/src/agent-scope.ts`
- `platform/packages/core/src/agent-floor.ts`
- `platform/packages/core/src/types.ts`
- `platform/packages/core/src/data-scope.ts`

The current resolver model remains:

```text
(role grants intersect capability_scope) plus active ephemeral grants minus deny
```

For on-behalf-of actions, the agent's authority is also intersected with the
principal's authority. RLS handles tenancy and visibility. The resolver handles
in-tenant capability.

## Layers

### Layer 0: tenancy and visibility

Database RLS and store-level filtering establish workspace membership and record
visibility.

### Layer 0.5: plane gate

- Local actors can read private/local data but may not directly reach internet
  egress resources.
- Cloud/egress actors can source public internet data but are clamped away from
  private/local data.

The code baseline models this with `Actor.plane`, `planeGate()`, and egress
resource types such as `external:fetch` and `external:send`.

### Layer 1: role grants and capability scope

Humans and teams receive role/direct grants. Agents assume a role but are also
bounded by `capability_scope`. For agents, scope is a ceiling.

### Layer 2: ephemeral grants

Runs can mint expiring grants for a specific Element, Automation, or run
context. These grants are narrow, time-bounded, and auditable.

### Layer 3: explicit deny

Explicit deny wins over every allow path.

### Layer 4: agent floor

Agents have non-removable structural denies:

- no governance self-modification
- no role/permission/policy/skill/agent/ledger mutation
- no full network graph read
- no external send/share
- no approval resolution

## Authority by primitive

- Human: may hold approval authority through roles and grants.
- Agent: acts within role, scope, allowed skills, data tier, plane, and floor.
- Automation: must remain within assigned actors and grants.
- Skill: holds no independent authority; runs under the invoking actor/request.
- Integration: exposes external capability but never grants it by itself.
- Request: carries source and assignee but does not create authority.
- Action: executes only through a governed caller.
- Incident: visibility inherits source data scope.
- Artifact: read/edit/share/export follow authority and egress policy.
- Workspace/View: reflect effective authority and hide unavailable actions/data.
- Element/ElementType: access and mutation follow workspace, role, data scope,
  policy, and schema rules.
- Memory/Knowledge: read/write according to scope, provenance, residency, and
  policy.

## Design rules

1. Primitive specs declare authority needs under Governance; they do not resolve
   authority.
2. Capability manifests are risk inputs, not authority grants.
3. UI availability must be derived from effective authority or marked as
   proposal-only.
4. Agent authority is always narrower than or equal to the Human/team context
   that configured it.
5. External send/share requires Human-governed approval paths.
6. Local-private data must not cross the plane gate.
7. Every denial should produce an auditable reason.

