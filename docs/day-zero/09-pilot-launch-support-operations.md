# Pilot, launch, support, and operations

## Pilot charter template

### Objective

Name one measurable customer outcome. Example: reduce the time from a new acquisition thesis to a cited, reviewable target list while preserving source rights and Human approval.

### Included

- named users and Organization;
- named Modules and workflow;
- approved data sources and Integrations;
- supported clients and operating systems;
- working hours and support channel;
- agreed baseline and success measures;
- weekly review and decision owner.

### Excluded

- autonomous external sending;
- unapproved data sources;
- regulated advice;
- unknown Commons publishers;
- unsupported clients;
- custom work not added through written change control.

### Data and security

- data classes and residency;
- model providers and subprocessors;
- capture permissions;
- retention and deletion;
- incident notification;
- export and offboarding.

### Success

- first governed value within one business day;
- agreed weekly workflow completed in Bridge;
- source and Decision provenance available;
- correction and rollback exercised;
- target cycle-time or quality improvement;
- acceptable user trust and support burden.

## Launch environments

- Development: synthetic or approved test data only.
- Internal pilot: founder/team real work with production controls.
- Design partner: isolated customer Organization, approved sources, named users.
- Public-safe hosted surface: identity and explicitly public-scope behavior only.
- General availability: not declared until multi-user, support, legal, security, billing, and release gates pass.

## Release process

1. Define release outcome and affected customers.
2. Review authority, data flow, taint, and dependency blast radius.
3. Run build, type, lint, unit, integration, migration, security, and product-flow checks.
4. Test fresh install and upgrade.
5. Test desktop and exact 375px journey.
6. Verify backup and rollback.
7. Produce release notes in business language.
8. Obtain launch owner and security sign-off.
9. Deploy to internal pilot, then design partners.
10. Monitor and hold a short post-release review.

No release is “green” solely because code compiles.

## Operational ownership

| Area | Primary owner | Backup | Required runbook |
|---|---|---|---|
| Hosted API and web | Platform operations | Engineering lead | Deploy, rollback, health, secrets |
| Supabase identity/data | Data owner | Platform operations | Migration, RLS, backup, restore |
| Desktop release | Desktop owner | Engineering lead | Signing, update, crash recovery |
| Commons | Registry owner | Security | Key custody, publish, revoke, restore |
| Security incidents | Security owner | Founder | Triage, containment, evidence, notice |
| Customer support | Customer-success owner | Product | Intake, severity, workaround, closure |
| Model providers | AI platform owner | Platform operations | Budget, outage, fallback, disclosure |

Named people must replace role labels before an external pilot.

## Support model

### Intake

One customer-facing channel and one internal issue ledger. Capture:

- affected outcome;
- time and user;
- client/version;
- severity and business impact;
- whether data, authority, or external action is involved;
- screenshots or identifiers without secrets.

### Response targets for pilot

- P0 security/data/authority: immediate acknowledgement during covered hours; suspend affected capability.
- P1 blocked core workflow: acknowledgement within two business hours.
- P2 degraded behavior: same business day.
- P3 request or polish: reviewed in weekly pilot meeting.

These are pilot response targets, not an availability SLA.

### Resolution

Provide safe workaround, preserve evidence, identify root cause, verify neighborhood impact, update customer, and record what prevents recurrence.

## Incident response

1. Detect and classify.
2. Stop harmful execution or egress.
3. Preserve logs, Decisions, versions, and provenance.
4. Revoke compromised credentials or packages.
5. Assess affected Organizations and data.
6. Notify according to contracts and law.
7. Restore from known-good state.
8. Verify the exact failed path and adjacent paths.
9. Publish an internal after-action review.
10. Track remediation in the canonical work ledger.

## Backup and continuity

- Daily managed database backups where available.
- Export or snapshot Local Plane data before risky migrations.
- Separate Commons package data from signing keys.
- Test restore before the first external pilot and quarterly thereafter.
- Document recovery time and recovery point actually achieved.
- Maintain an offline list of emergency owners and provider contacts.
- Support an operational safe mode: read and export, with Agents and Automations suspended.

## Offboarding

- export permitted Organization Records, Relations, Files, Events, and settings;
- revoke Integrations and ephemeral grants;
- remove active sessions;
- provide deletion schedule and retained audit obligations;
- uninstall local components;
- end model and support access;
- retain only contractually and legally required evidence.

## Launch communications

Every release note should explain:

- user outcome;
- visible changes;
- permissions or data impact;
- limitations;
- rollback or support path.

Avoid claims of autonomy, surveillance, legal compliance, or guaranteed business outcomes.

