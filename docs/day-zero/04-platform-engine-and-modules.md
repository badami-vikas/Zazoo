# Platform, Engine, and Modules

## One platform

Bridge must be built as one governed Engine with installable Modules. This decision prevents three recurring failure modes: each vertical becoming a separate codebase, each Module inventing its own data and navigation, and AI behavior bypassing shared authority.

## Responsibility model

### Engine owns

- identity, authority, policy, and approval;
- Request, Plan, Decision, Run, Action, Event, Result, and File contracts;
- Record and Relation graph mechanics;
- Memory retrieval and retention controls;
- credential resolution;
- Agent and Skill invocation;
- Automation scheduling and recovery;
- audit, provenance, taint, evaluation, and cost receipts;
- Module installation, compatibility, and lifecycle;
- shared View grammar and client contracts.

### Module owns

- a bounded user outcome;
- domain Record and Relation types;
- Databases, Pages, Views, and default navigation;
- declared Agents and their Skills;
- Integrations and data needs;
- Automations and trigger rules;
- domain policy defaults that cannot weaken platform floors;
- evaluation cases and success measures;
- Files, templates, and user-facing terminology;
- upgrade and uninstall behavior.

### Client owns

- presentation and interaction appropriate to desktop, web, or mobile;
- device-specific capability discovery;
- accessibility and responsive behavior;
- no independent business authority.

## Standard Module specification

Every new Module should have one approved BRD containing:

1. User and buyer.
2. Problem and outcome.
3. In-scope and out-of-scope work.
4. Default Databases, Pages, Views, Record types, and Relations.
5. Agents, Skills, Integrations, and Automations.
6. Data classification and residency.
7. Authority and approval requirements.
8. Empty, loading, blocked, failure, and recovery states.
9. Evaluation dataset and release threshold.
10. Metrics and cost budget.
11. Install, upgrade, rollback, export, and uninstall behavior.
12. Commons publication boundary.
13. Dependencies and compatibility range.
14. Real prototype test.

## Module acceptance rules

A Module is not complete because its page renders. It must:

- be installed from a versioned manifest;
- appear in navigation;
- open a coherent Module Detail;
- use shared View and toolbar behavior;
- use real connected data or an honest empty state;
- attribute every Skill to an Agent;
- start recurring work as an Agent Run;
- record provenance and outcomes;
- enforce permissions at the API and storage layers;
- survive restart and version change;
- support correction and safe rollback;
- pass desktop and 375px product tests.

## Initial Module portfolio

### Relationship

Purpose: maintain useful continuity across People, Communities, Signals, interactions, introductions, and help requests.

Primary proof: Bridge surfaces a relevant Signal with evidence and a safe action, and the user can trace it to people, sources, and history.

### DealPilot

Purpose: support ETA sourcing, thesis-driven discovery, evaluation, diligence, and decision records.

Primary proof: a Thesis leads to a governed Source and a real Deal with evidence, rights, credential, and spend controls.

### JobPilot

Purpose: support truthful job discovery, fit evaluation, application preparation, and follow-up.

Primary proof: permitted public evidence improves a tailored application or interview plan without fabricated claims.

### Task Manager

Purpose: manage one recursive work database with governed planning, prioritization, and restructuring.

Primary proof: a user or Agent can propose and safely apply a task-tree change while preserving source and audit.

## Evolution model

Bridge observes friction and outcomes, then:

1. identifies a repeated need;
2. researches installed or permitted reusable capability first;
3. proposes a bounded change;
4. shows evidence, permissions, risk, cost, and rollback;
5. validates on held-out cases;
6. activates only after required governance;
7. monitors quality and trigger accuracy;
8. promotes, demotes, suspends, or retires based on evidence.

Capabilities never change category through “promotion.” A Skill remains a Skill; promotion changes trust and lifecycle state.

## Build-versus-integrate rule

Before building:

- inspect installed software and permitted providers;
- search Commons and approved open-source sources;
- record license and data rights;
- compare integration, adaptation, and new development;
- prefer the smallest durable solution;
- use clean-room functional research when protected sources cannot be reused.

## Platform proof strategy

One vertical does not prove a platform. The Engine claim becomes credible when:

- two materially different Modules use the same authority and execution contracts;
- shared improvements benefit both without Module-specific forks;
- a capability can be safely installed from Commons;
- users can compose Modules without merging their domain semantics;
- the cost of the second Module is meaningfully lower than the first.

