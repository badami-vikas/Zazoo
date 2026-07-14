---
title: Clean-Room Capability Research Protocol for License-Limited Sources
type: raw
doc_kind: plan
status: adopted — folded into CLAUDE.md Working rules as a standing rule 2026-07-14 (AP-008)
companions: [oss-commons-integration-plan-2026-07.md, dealpilot-module-plan-2026-07.md]
related_wiki: ../wiki/oss-commons.md
updated: 2026-07-11
tags: [license, clean-room, research, benchmarking, skills, agents, integrations]
---

# Purpose

When a useful Skill, Agent, feature, template, or repository cannot be incorporated because of license, contract, patent, trademark, data-right, or dependency constraints, Bridge performs lawful capability research instead of either copying it or ignoring it.

Goal: understand public functionality, workflows, inputs/outputs, quality bar, limitations, and architectural choices; create an independently authored requirements/benchmark pack; then design a better Bridge-native alternative without copying protected expression or restricted assets.

This is engineering governance, not legal advice. Ambiguous or commercially material cases require qualified counsel and, where useful, upstream permission/partnership.

# Core boundary

Publicly observable ideas, functionality, systems, processes, methods, and algorithms may be studied, but source code, prompts, prose, templates, distinctive UI expression, proprietary datasets, secrets, trademarks, and restricted methodologies may remain protected by copyright, contract, patent, trademark, trade-secret, database, or other law. License/contract terms can impose obligations beyond copyright.

No circumvention, leaked/private source, credential sharing, access-control bypass, ToS bypass, or deceptive acquisition.

# Research workflow

```yaml
steps:
  - identify_source_and_exact_version
  - preserve_license_terms_and_access_path
  - classify_allowed_use
  - inventory_observable_capabilities
  - map_workflows_inputs_outputs_states_and_failures
  - document_architectural_approach_at_functional_level
  - build_black_box_benchmark_and_test_cases
  - separate_research_record_from_implementation_spec
  - independently_author_Bridge_requirements
  - implement_without_source_expression_or_restricted_assets
  - compare_outputs_and_improve_against_benchmark
  - run_provenance_similarity_security_and_legal_review
```

# Required research dossier

For each source, record:

- canonical URL, owner, version/commit/date, access path;
- repository license and per-artifact licenses;
- dependencies and data/API licenses;
- commercial-use, derivative, redistribution, attribution, network-use, trademark and future-license terms;
- whether code inspection is allowed for research and who inspected it;
- product purpose and user types;
- complete feature and functionality inventory;
- Agent roster, responsibilities, routing and authority;
- Skill inventory: trigger, inputs, steps, tools, outputs, contraindications and quality checks;
- Automation inventory: trigger, schedule, state machine, retry, approvals and stop conditions;
- information architecture, screens, views, toggles and object model;
- workflows and sequence diagrams;
- data inputs/outputs, schemas and provenance behavior;
- external integrations and credential model;
- model/runtime approach, memory/context approach and orchestration pattern;
- security, privacy, governance and human-in-loop mechanisms;
- error/degraded/offline states;
- performance/cost claims and evidence quality;
- strengths, weaknesses, gaps, risks and known limitations;
- benchmark scenarios and expected observable results;
- explicit `may_reuse`, `may_interoperate`, `research_only`, and `do_not_use` decisions.

# Separation controls

High-risk restricted sources should use a two-role clean-room pattern:

1. Researcher inspects legally accessible source and produces a functional specification stripped of protected expression.
2. Implementer receives only the approved functional specification and public interface/black-box tests, not restricted code/prompts/templates.

Maintain:

- named research and implementation owners;
- immutable source/commit/license record;
- access log;
- independent design rationale;
- code-origin attestations;
- similarity scan against upstream where lawful;
- third-party notices and attribution where required;
- counsel approval checkpoint for ambiguous cases.

An Agent that has loaded restricted source into context must not author the alternative implementation in the same run when clean-room separation is required.

# Benchmarking

Compare common-good outcomes, not visual/code imitation:

```yaml
benchmark_dimensions:
  - task_success_and_completeness
  - evidence_and_citation_quality
  - correction_and_failure_recovery
  - human_control_and_explainability
  - latency_and_quality_adjusted_cost
  - security_privacy_and_permission_scope
  - accessibility_and_responsiveness
  - interoperability_and_portability
  - maintainability_and_testability
  - license_and_operational_sustainability
```

Bridge improvement report must state where it is equivalent, better, worse, intentionally different, and not comparable. Never claim parity from feature-name matching alone.

# Prohibited behavior

- copy/paste or lightly paraphrase restricted source, prompts, templates or documentation;
- translate restricted code to another language as a disguise;
- preserve distinctive structure/naming unnecessarily;
- train/fine-tune on restricted assets without rights;
- use proprietary datasets or credentials without rights;
- remove notices or misstate origin;
- rely on “public GitHub” as proof of open-source permission;
- treat absence of a license as permission;
- let a model recreate memorized source on request;
- bypass technical protection or contractual access restrictions;
- call the outcome “clean room” without documented separation and provenance.

# Output artifacts

Each research intake produces:

1. Source/license record
2. Functional capability inventory
3. Workflow and data-contract specification
4. Benchmark/test pack
5. Reuse/interoperation/prohibition decision
6. Independent Bridge design brief
7. Implementation provenance record
8. Post-build comparison report

# Authority

US Copyright Office guidance says copyright protects program expression, while ideas, program logic, algorithms, systems, methods and concepts are not protected by copyright. That boundary is not the whole legal analysis: license contracts, patents, trade secrets, trademarks, anti-circumvention, data rights and jurisdiction still matter. Sources: https://www.copyright.gov/register/tx-programs.html and https://www.copyright.gov/what-is-copyright/.

# Proposed standing CLAUDE.md rule (AP-008; not canonical until approved)

> **License-limited capability research:** Before custom-building any Skill, Agent, Automation,
> Integration, feature, template, or workflow that resembles an existing source, run reuse intake
> first. If reuse is permitted, prefer import/wrap/adapt/integrate over rebuilding. If license,
> contract, patent, trademark, data-right, dependency, or access constraints limit reuse, perform
> detailed lawful functional research under
> `docs/raw/clean-room-capability-research-protocol-2026-07.md`: record exact source/version/terms;
> inventory features, Agents, Skills, Automations, workflows, inputs/outputs, UI/IA, data contracts,
> integrations, orchestration, security, states, strengths, weaknesses and limitations; produce
> black-box benchmarks and an independently authored requirements spec. Use researcher/implementer
> separation when warranted. Never copy/lightly paraphrase protected code, prompts, prose,
> templates, distinctive UI expression, datasets or naming; never bypass access controls or terms.
> Preserve provenance and compare Bridge alternatives on outcomes. Ambiguous/material cases stop at
> counsel or upstream-permission gate.
