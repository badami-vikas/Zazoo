---
title: Capability Evolution
type: raw
doc_kind: design
status: draft
related_wiki: ../wiki/ontology.md
updated: 2026-07-07
companions:
  - primitive-specifications.md
  - capability-package-format.md
  - tool-standardization-plan.md
tags: [capability, evolution, promotion, trust, maturity, autonomy, kill-switch]
---

# Capability Evolution

Evolution is a Governance model for trust, maturity, autonomy, downgrade,
suspension, kill, and composition. It must not mutate a primitive's category.

## Rule

```text
Primitive stays immutable
Promotion creates a new governed object
New object consumes the old one
```

There is no `Skill -> Agent`, `Automation -> Skill`, or `Workspace -> Agent`
promotion. Category drift breaks identity, contracts, version history, and
governance.

## Independent evolution axes

- Automation earns trust.
- Skill earns maturity.
- Agent earns autonomy.
- Workspace earns adoption and configuration depth.
- Integration earns scope confidence and reliability.
- Action earns operational reliability.
- ElementType earns schema stability.

These axes may influence approval defaults, visibility, installation
recommendations, and composition eligibility. They do not change primitive type.

## Baseline in code

The current implementation has a Capability Trust Model in:

- `platform/packages/core/src/capability/types.ts`
- `platform/packages/core/src/capability/risk.ts`
- `platform/packages/core/src/capability/lifecycle.ts`
- `platform/packages/core/src/capability/approvals.ts`
- `platform/packages/db/src/capability-store.ts`

Current `CapabilityType` includes historical `workflow` and `tool` values. In
ontology language:

- `workflow` maps to Automation.
- `tool` maps to a package/surface implementation consumed by a Workspace.

## Lifecycle states

- draft
- validated
- approved
- active
- trusted
- suspended
- deprecated
- archived
- killed

## Promote

Promotion may create:

- a new Agent that consumes a proven Skill
- a new Automation that schedules a proven Skill
- a new Workspace that surfaces a proven Skill or Agent
- a new ElementType/View package that structures proven work
- a new package version that bundles several capabilities
- a new Request asking a Human to approve broader autonomy

Promotion should not:

- rewrite primitive type
- hide the source primitive's contract
- overwrite version history
- silently expand authority
- skip the Runtime Pipeline

## Downgrade

Downgrade reduces trust or autonomy without deleting the object.

Downgrade triggers:

- repeated low-confidence outputs
- repeated Human edits or vetoes
- evaluation regression
- stale dependency or model behavior
- degraded Integration reliability
- cost overruns
- policy changes that raise risk
- owner reduces trust

Examples:

- Agent `trusted -> active`: autonomy reduced after repeated escalations.
- Skill `trusted -> active`: output contract still works but quality degraded.
- Automation `trusted -> approved`: now requires review at checkpoints.
- Integration `trusted -> active`: provider reliability degraded.

## Suspend

Suspend is a temporary safety hold.

Suspend triggers:

- suspected credential issue
- provider outage
- ambiguous policy violation
- high error rate
- pending owner review
- dependency unavailable

Suspended objects cannot be invoked except for diagnostics or migration.

## Kill

Kill is an immediate governed stop for severe risk.

Kill triggers:

- data leak
- external-send violation
- credential compromise
- runaway cost
- unsafe repeated behavior
- privilege escalation attempt
- governance self-modification attempt
- malicious package or dependency
- repeated policy bypass

Killed objects cannot be reactivated in place. Recovery requires a new governed
version or replacement object with explicit review.

## Composition examples

### Recon

Recon remains a Skill or internal capability package.

- Deal Analyst Agent consumes Recon.
- Daily Recon Automation invokes Recon on a trigger.
- DealPilot Workspace surfaces Recon through a View or command.

Recon can progress from draft to trusted without becoming an Agent,
Automation, or Workspace.

### Chief of Staff

Chief of Staff remains an Agent archetype.

- It may gain routing autonomy.
- It may be constrained by a closed registry and chain-depth cap.
- It may create Requests or proposals.

It is not a separate primitive.

### Project

Project is an ElementType.

- A Workspace may contain many Project Elements.
- A Project Element can have Requests, Artifacts, Incidents, Memory, and
  Knowledge linked to it.

Project does not need a separate primitive identity.

## Governance requirements

1. Every promoted object gets its own identity, manifest, owner, version, and
   lifecycle state.
2. Dependency links point back to consumed primitives.
3. Risk is computed over the full dependency closure.
4. Approval requirements derive from risk, audience, origin, permissions,
   egress, and data scope.
5. Rollback creates a new governed version or deactivates the composition; it
   does not rewrite history.
6. Downgrade, suspend, and kill events are Incidents and must be auditable.

