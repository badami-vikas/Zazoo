# Metrics and economics

## North-star measure

Governed useful outcomes completed per active Organization per week.

A governed useful outcome:

- maps to a declared user job;
- uses permitted evidence;
- produces an accepted Result, File, or external Action;
- retains provenance;
- does not create an unresolved policy or safety violation.

## Metrics tree

### Activation

- Time from account activation to first useful outcome.
- Percentage completing Onboarding.
- Percentage connecting one real permitted source.
- Percentage completing one approve/edit/veto loop.
- Percentage returning within seven days.

### User value

- Useful outcomes per Organization.
- Cycle-time change for the selected workflow.
- Manual steps removed.
- Evidence completeness and correction rate.
- Accepted recommendation rate.
- Reuse of prior Memory or capability.

### Trust and control

- Permission acceptance and refusal by type.
- Approval edit and veto rate.
- Reversal and correction success.
- Unexpected capture or egress reports.
- Policy denials and reasons.
- Capability suspension and rollback success.
- Security and privacy incidents.

High veto or correction is not automatically bad. Early in a new workflow it may show governance working. The important measure is whether quality improves without reducing control.

### Retention

- Weekly active Organizations.
- Active days per user.
- Four- and twelve-week Organization retention.
- Workflow recurrence.
- Number of Modules producing accepted outcomes.
- Paid pilot conversion and renewal.

### Platform leverage

- Time to launch the second customer workflow.
- Percentage of Module work using shared Engine and View components.
- Capabilities reused across Organizations without private data.
- Needs satisfied by Commons or installed Integrations.
- Module upgrade success.
- Platform defects caused by Module-specific exceptions.

### Reliability and quality

- Successful Runs.
- Correct terminal-state recording.
- Retry and duplicate external Action rate.
- P50/P95 user-visible latency.
- Recovery time.
- Migration and restore success.
- Accessibility journey success.

### Agent evaluation

- Task success on held-out cases.
- Evidence correctness.
- Citation validity.
- Instruction-following within policy.
- Trigger precision and recall.
- Unnecessary-action rate.
- Human correction carryover.
- Cost and latency per accepted outcome.

## Pilot scorecard

For every design partner, record a baseline and weekly result:

| Measure | Baseline | 30-day target | 90-day target |
|---|---:|---:|---:|
| Time to first useful outcome | N/A | < 1 business day | < 2 hours |
| Selected workflow cycle time | Customer baseline | 20% lower | 40% lower |
| Accepted outcomes with complete provenance | N/A | > 90% | > 95% |
| Consequential Actions with correct approval | N/A | 100% | 100% |
| Support hours per Organization/week | N/A | < 4 | < 2 |
| Weekly active users | N/A | > 60% | > 70% |
| Critical security/privacy incidents | N/A | 0 | 0 |

Targets are initial hypotheses and must be adjusted with evidence, not quietly lowered to create a success story.

## Cost model

Track by Organization and Run:

- model input, output, and cache tokens;
- local inference compute;
- hosted compute;
- database and object storage;
- network and search provider cost;
- support and implementation time;
- third-party licensing;
- refunds and incident cost.

## Economic targets

For a post-pilot team product:

- gross margin target above 70%;
- model and search variable cost below 10% of recurring revenue;
- infrastructure variable cost below 10%;
- routine support below two hours per Organization per week;
- onboarding payback inside six months;
- no uncapped external provider spend.

These are decision thresholds, not current claims.

## Instrumentation rules

- Prefer content-free Events and aggregates.
- Keep customer content out of analytics by default.
- Attribute metrics to Organization, Module, Agent, Skill, and version using opaque identifiers.
- Separate product telemetry from audit evidence.
- Let customers inspect and control telemetry policy.
- Do not optimize approval rate at the expense of safety or comprehension.

## Review cadence

- Daily during launch: incidents, failed Runs, spend, blockers.
- Weekly: pilot outcomes, support, trust, and retention.
- Monthly: platform leverage, economics, roadmap, and risk.
- Quarterly: segment, pricing, architecture, and compliance strategy.

