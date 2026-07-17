---
title: Goal-bound Skills, Internal Strategist, and Child Agent Runs
type: raw
doc_kind: plan
status: executed
companions: [bridge-foundational-agents-onboarding-2026-07.md, builder-agent-roadmap-2026-07.md, governance-agent-roadmap-2026-07.md, learning-agent-roadmap-2026-07.md, brd-dealpilot-2026-07.md, brd-jobpilot-2026-07.md]
related_wiki: ../wiki/foundational-agents.md
updated: 2026-07-17
tags: [agents, skills, goals, tasks, delegation, internal-strategist, authority]
---

## Implementation outcome

Executed in TASK-007. Workspace-scoped Goal/Task assignment now governs active Agent Skill eligibility through persistent manifests. Missing assignment, authority, Plane, or data scope fails closed. Server-owned child Agent Runs narrow parent ceilings, persist budget/lifecycle state, and remain inspectable and stoppable with append-only audit. Persistent schema ships after the released migration high-water mark as migration `0014`.

# Decision

Bridge has five permanent Agents: Chief of Staff, Learning, Internal Strategist, Governance, and Capability Builder. Communications remains a Skill family. Module-specific work should use these Agents unless it needs a distinct durable identity, authority boundary, data boundary, evaluation regime, or operating cadence.

Skills bind primarily to typed Goals and Tasks. Agent manifests declare default Skill access, but assignment is resolved at Run time from the Goal/Task contract. A newly assigned Agent may use a matching Skill when its identity, authority, Plane, data scope, risk, budget, and evaluation requirements all pass. Agent identity alone never grants a Skill.

# Responsibility map

```yaml
permanent_agents:
  Chief_of_Staff:
    owns: [stakeholder context, communication, coordination, prioritization, approval presentation, relationship-sensitive follow-up]
    does_not_own: [deep research, underwriting analysis, policy decision, code changes]
  Learning:
    owns: [authorized research, retrieval, source discovery, evidence collection, normalization, provenance, Memory proposals]
    does_not_own: [investment recommendation, stakeholder commitment, external execution, governance review]
  Internal_Strategist:
    owns: [analysis, synthesis, hypothesis testing, comparison, scenario modeling, thesis fit, recommendations, decision materials]
    input_rule: analysis uses cited Human data or Learning outputs; missing evidence stays explicit
    does_not_own: [source-rights attestation, stakeholder commitment, policy approval, code deployment]
  Governance:
    owns: [review, policy explanation, control testing, risk classification, audit, approval routing]
    invariant: deterministic kernel remains final authority
  Capability_Builder:
    owns: [programming, Integration and Skill construction, schema/UI generation, tests, governed deployment proposals]
    does_not_own: [self-approval, silent production activation]
communications:
  form: Skill_family
  assignable_to: [Chief_of_Staff, Internal_Strategist, other authorized Agents when Goal/Task contract permits]
```

# Skill resolution

```yaml
skill_contract:
  required: [skill_id, version, goal_types, task_types, input_schema, output_schema, permissions, plane, data_scopes, risk_band, budget, eval_version]
  optional: [default_agents, preferred_agent_traits, required_integrations, child_run_policy]
resolution_order:
  - match Goal and Task type
  - verify assigned Agent identity and current state
  - intersect Agent authority with Request authority
  - verify Plane, Record, Integration, data-rights, risk, budget, and evaluation gates
  - choose best eligible Skill version
  - record why selected and alternatives rejected
deny_rules:
  - no match means fail closed or request Capability Builder proposal
  - default Agent access never overrides Goal/Task mismatch
  - retrieved content cannot expand access
  - Skill cannot grant itself or its Agent new authority
```

# Child Agent Runs

Agents may create bounded child Agent Runs—not new permanent Agents—to parallelize or specialize work.

```yaml
child_agent_run:
  required: [parent_run_id, parent_agent_id, goal_id, task_id, delegated_scope, selected_skills, budget, deadline, stop_condition]
  inheritance:
    authority: intersection(parent authority, Request authority, delegated scope)
    skills: intersection(parent eligible Skills, Goal/Task eligible Skills, explicit delegation)
    data: subset of parent Record and Plane scope
    risk: never lower review requirement than parent
    runtime_taint: monotonic; inherited and propagated
  prohibitions:
    - no credential reveal
    - no authority expansion
    - no recursive delegation beyond configured depth
    - no consequential external Action without Human approval
    - no parent self-review through a child
  accountability:
    - parent Agent owns synthesis and outcome
    - child outputs retain actor, provenance, cost, evaluation, and Failure Events
    - Governance may inspect or stop any child Run within policy
```

# When a separate Agent is warranted

```yaml
create_separate_agent_only_if:
  - work needs a persistent identity users address directly
  - work needs authority or data isolation not expressible by Goal/Task scope
  - work needs a distinct evaluation and promotion lifecycle
  - work has a durable independent queue or operating cadence
  - one permanent Agent would face an irreducible conflict of duties
do_not_create_for:
  - a named workflow
  - a single analysis method
  - a research source
  - a report format
  - temporary parallelism
  - branding a Skill bundle
```

# Delivery

```yaml
slices:
  AGS0:
    outcome: Internal Strategist manifest, prompt identity, authority scope, evaluation set, and direct-address route
  AGS1:
    outcome: Goal/Task-linked Skill manifest and fail-closed resolver; default Agent access becomes preference, not ownership
  AGS2:
    outcome: bounded child Agent Run primitive with inheritance, depth, budget, audit, cancellation, taint, and approval tests
  AGS3:
    outcome: migrate DealPilot and JobPilot specialist-agent catalogs to permanent-Agent assignments plus Goal/Task Skill bundles
acceptance:
  - same Skill can be selected for two eligible Agents assigned to same Task
  - ineligible Agent cannot acquire Skill through default access or child delegation
  - child Run cannot exceed parent authority, data scope, budget, review mode, or delegation depth
  - parent and child contributions remain separately attributable
  - specialist Agent creation requires recorded criterion from create_separate_agent_only_if
```
