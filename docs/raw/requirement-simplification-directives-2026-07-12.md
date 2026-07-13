---
title: User Directive — Simplification Proposal Amendments (verbatim)
type: raw
doc_kind: requirement
status: active
companions: [simplification-proposal-2026-07-12.md]
related_wiki: ../wiki/ontology.md
updated: 2026-07-12
tags: [requirement, simplification, ontology, verbatim]
---

Critically evaluate my following proposal and do what you deem best:
Unify Events and Timeline conceptually; Timeline becomes a projection over residency-partitioned event logs.
Do not merge Request into Action. Preserve:
Request → Plan → Decision → Run → Actions → Events → Result
Also, do not freeze these as architectural invariants:
Four permanent agents—they should be a default product composition.
Star topology—the invariant should be bounded, attributable DAG execution.
One centralized pipeline service—the governance contract matters, not a network bottleneck.
Planner (plans) / Run (executes). Kills Swarm term.


Compute approval requirements from risk and context, but immutably record every resolved decision.
Eliminate concept-level Tool.

drop Workspace as a kernel primitive.
Its responsibilities split naturally:
Organization/Account: tenancy, membership, billing, security boundary
Module: installed functional experience combining capabilities, data types, policies, and views
Element: durable domain data
View: screen, projection, or layout
Home: optional cross-module landing experience
So DealPilot, Calendar, Relationships, and JobPilot are Modules installed into an Organization. They expose Views and operate on Elements through Capabilities.

Drop any mention of package or workspace

All three should be adopted, with two refinements.

1. Plane terminology: approve
Reserve Plane for the Local/Cloud trust, residency, and egress boundary.
Use:

* Local Plane / Cloud Plane
* Relationship Graph Domain / Work Graph Domain
* Local inference / cloud inference
I prefer Relationship Domain over Identity Domain because it includes people, communities, and relationships—not merely identity records.

2. Approval levels: approve, but broaden the function
Delete L0–L3 as standalone vocabulary. Replace the numbered labels with semantic computed outcomes:

* `auto`
* `notify`
* `approve`
* `quorum`
However, the calculation must be broader than risk × origin × audience:

```
reviewMode = resolve(
  risk,
  origin,
  audience,
  authority,
  trust,
  sideEffect,
  dataScope,
  egress,
  organizationPolicy,
  delegation,
  quorumRules
)
```

Risk describes what could go wrong. Review mode describes what governance this particular operation requires.
The review mode should never be independently configured or treated as source-of-truth state—but the resolved result, inputs, reason, and policy version must be recorded for audit and replay.
