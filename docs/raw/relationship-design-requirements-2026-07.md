---
title: Relationships Module — Designer-Ready Requirements
type: raw
doc_kind: design
status: proposed
companions: [relationship-module-plan-2026-07.md]
related_wiki: ../wiki/relationships.md
updated: 2026-07-11
tags: [relationships, product-design, ux, responsive, accessibility, privacy]
---

# Brief

Design a calm, trustworthy Relationship workspace that helps users remember context, honor commitments, navigate communities, make consentful introductions and act at useful moments. It must feel like living relational memory—not a sales CRM, contact spreadsheet, social feed or surveillance dashboard.

# Success questions

Within two minutes, user should answer:

1. Who needs attention, and why now?
2. Where did we leave off?
3. What did either of us commit to?
4. What context is verified, inferred, stale or private?
5. Who can help with this Project, and what introduction path is permissible?
6. What safe action can I take next?

# Navigation

```text
Bridge rail | Relationships module rail | Main canvas | Optional Agent/source inspector

Relationships
├── Today
├── People
├── Communities
├── Map
├── Touchpoints
├── Introductions
├── Signals
├── Workflows
└── Sources
```

Person tabs: Overview, Timeline, Context, Connections, Communities, Projects, Introductions, Commitments, Files, Permissions, Activity.

Community tabs: Overview, Members, Map, Touchpoints, Projects, Signals, Gatherings, Resources, Permissions, Activity.

Desktop module rail persists. Tablet collapses rail. Mobile uses labelled drawer/selector and shows highest-priority object tabs plus More. No third sidebar.

# Screen requirements

## Today

Sections ordered by accountability:

1. Decisions/consent required
2. Commitments due
3. Upcoming meetings
4. Unanswered/open loops
5. Useful moments/milestones
6. Community opportunities
7. Intake and identity review
8. Recent changes

Card fields: Person/Community, why now, source/evidence, confidence/freshness, related Project, suggested action, privacy scope. Actions: Act, Review, Snooze, Dismiss, Correct, Tune. Dismissal asks lightweight reason only when it improves future relevance.

## People

Views: Table, Cards, Map, Graph. Segments: Recently Active, Needs Attention, Pinned, Muted, Archived.

Table fields: Person, role/community, relationship types, last meaningful Touchpoint, next commitment/action, context freshness, mutual Communities/Projects, pending consent/approval, owner/visibility.

Required interactions: search, faceted filters, column chooser, saved views, compare, governed archive/merge review, export permitted fields. No bulk-send action.

Empty state choices: Connect source, Import CSV/vCard/export, Scan card, Add manually, Capture conversation. State explains privacy plane and approval flow before connection.

## Person Overview

Persistent header: identity, verified aliases, current role/community, relationship types, visibility, source freshness, owner, next action.

Content hierarchy:

- where we left off;
- upcoming meeting/important date/commitment;
- recent Touchpoints;
- shared Projects and Communities;
- open loops/help exchanged;
- useful next action and reason;
- stale/contradicted context;
- pending introduction/approval.

Each fact has source state: user-confirmed, source-backed, third-party public, Agent inference, contradicted, stale or unavailable.

## Timeline

Chronological stream with filters for meetings, email, message, call, note, capture, introduction, commitment, Project and Signal. Group same-thread events. Each event shows participants, source, privacy, linked objects and extracted commitments. Clicking source opens reversible inspector.

## Context

Memory cards grouped by how met, preferences, goals/interests, important dates, family/personal only when intentionally recorded, open loops, help exchanged, corrections. Card fields: statement, source, confidence, date, sensitivity, who can see, superseded state. Actions: Correct, Pin, Make private, Forget, Inspect source.

## Connections

Network centered on Person. Show mutual People/Communities, direct/multi-hop paths, evidence, recency and confidence. Path cards explain each hop and whether introduction is permitted. Hide inaccessible nodes; never show blurred private identities.

## Introductions

State visualization:

`Idea → Value check → Consent A → Consent B → Draft → Sent → Connected → Follow-up → Outcome`

Case view includes purpose, mutual value, requester, introducer, private notes per side, consent status, drafts, sent messages, outcome and follow-up. Decline UI offers no-pressure reason options and controls what is disclosed.

## Commitments

Sections: I Promised, They Promised, Mutual, Completed, Overdue. Commitment card includes exact text, source Touchpoint, owner, due date, sensitivity, related Project, status and follow-up. Agent-extracted commitments remain proposed until confirmed.

## Communities

List views: Table, Cards, Map. Card includes purpose, member count, user role, active Projects, latest Touchpoint, meaningful changes, open request and suggested action.

Community Members table shows Person, role, source/confidence, membership history, visible activity and Projects. Map shows internal and adjacent network without exposing private paths.

Gathering flow: goal → suggested group → inclusion rationale → consent/privacy review → draft invite → approval/send → calendar → follow-up. User can remove any invitee without explanation.

## Map

Controls: center, degree, edge type, Community, Project, recency and confidence. Modes: network, clusters, geographic, path finder. Always provide accessible list/table alternative. Edge inspection explains source and uncertainty. No default “strongest/weakest friends” ranking.

## Touchpoints

Views: Timeline, Table, Calendar, By Person, By Community, Unreviewed. Touchpoint editor supports participants, kind, time, source, summary/context, Project, commitments, follow-ups, privacy and parent/child structure.

## Signals

List/card view grouped into Decide, Follow up, Prepare, Celebrate, Correct, Review source. Each Signal includes evidence, why now, confidence, impact and safe action. Controls: Act, Dismiss, Snooze, Correct source, Tune this type, Mute for Person/Community.

## Workflows

Cards for installed Automations: purpose, trigger, People/Communities scope, channels, quiet hours, permissions, risk, last run, success/tuning. Example templates: Meeting Prep, After Meeting, Inner-Ring Review, Intro Round, Community Gathering, New Role, Commitment Follow-up.

## Sources

Source card fields: provider, account/profile, status, scopes, data classes, plane, retention, last/next sync, records/proposals/errors, cost. Actions: Review proposals, Sync now, Pause, Narrow scope, Reindex, Export, Disconnect, Forget. Account allow/deny visible before every Agent/browser run.

# Cross-cutting components

## Source inspector

Every material fact reaches source in ≤2 interactions. Inspector displays source/provider, exact record/anchor, observed date, permissions, original vs derived content, confidence and conflicts.

## Identity resolution

Side-by-side candidate comparison: names, emails, roles, communities, source records, match factors and conflicts. Actions: Same Person, Different People, Need More Evidence. Merge preview lists all field/edge/history consequences and supports rollback-as-fork/correction, not hidden overwrite.

## Relationship indicators

If showing warmth, recency, reciprocity or dormancy:

- pair label with plain-language explanation;
- show inputs and last computed time;
- label inference;
- allow correction/disable;
- never imply moral worth or objective trust;
- never use color alone.

## Agent state

Idle, gathering local context, requesting public context, analyzing, awaiting input, proposal ready, blocked by permission, failed. Agent plan exposes bounded data scope and account. Output is draft/proposal, never silent graph mutation or send.

## Permissions

Use plain language: “Only you,” “Workspace team,” “Specific people,” “Public source,” “Local device only.” Show why someone can see content. Private notes and one party’s consent response never leak through shared views.

# Responsive requirements

- 1440px: global rail + module rail + canvas + optional inspector;
- 1024px: inspector overlays; module rail collapsible;
- 768px: icon global rail; module drawer; scrollable tabs;
- 375px: bottom/global navigation, module selector, 4 priority tabs + More, cards instead of wide tables;
- approvals, consent, correction, source inspection and forgetting fully operable at 375px;
- graph/map provides list fallback on small screens.

# States

Design loading, honest empty, partially connected, populated, stale, degraded source, offline/local-only, restricted, unresolved identity, conflicting evidence, Agent running, awaiting approval/consent, recoverable error, archived, disconnected and forgetting-in-progress states.

# Accessibility and trust

- WCAG 2.2 AA;
- keyboard access and visible focus;
- 44px mobile targets;
- reduced motion;
- semantic tables/headings;
- maps/charts have table alternative;
- color never sole carrier;
- no essential hover-only content;
- exact dates/timezones and source freshness;
- professional and warm, never gamified social scoring;
- no fabricated people or activity in runtime.

# Required design deliverables

```yaml
deliverables:
  - sitemap and responsive navigation spec
  - Today, People, Person, Communities, Community, Map, Touchpoints, Introductions, Signals, Workflows, Sources
  - all Person and Community object tabs
  - source inspector and identity-resolution flow
  - consentful introduction flow
  - meeting-prep/follow-up flow
  - privacy/permission/forgetting flow
  - desktop/tablet/mobile variants
  - component inventory with every state
  - accessibility annotations
  - interactive prototype
  - design-token mapping and implementation handoff
```

# Prototype journey

1. User installs Relationships and sees honest empty Today.
2. Connects permitted Gmail/Calendar account with scoped explanation.
3. Intake proposes People/Touchpoints; identity conflict enters review.
4. User resolves duplicate and opens Person workspace.
5. Timeline and “where we left off” cite exact sources.
6. Upcoming meeting triggers grounded prep proposal.
7. Post-meeting capture proposes summary and two commitments; user corrects one.
8. Community view reveals a permitted warm path for a Project request.
9. Introduction Coordinator validates mutual value and collects both consents.
10. Communications Agent drafts; user approves send.
11. Follow-up records outcome and updates context.
12. User makes one Memory private, forgets another and verifies audit/result.

# Acceptance criteria

- one Relationships module entry, no nav explosion;
- People/Communities/Person/Community/Map/Touchpoint/Introduction workflows fully specified;
- every material fact source-inspectable in ≤2 interactions;
- source-backed vs inferred vs private vs stale always distinguishable;
- uncertain identities never silently merge;
- introductions expose both consent states without leaking private reasons;
- no automatic send or invite at launch;
- user can correct, tune, disconnect, export and forget;
- mobile retains consent/governance/source controls;
- no relationship value implied by opaque score;
- every surface maps to shared Bridge primitives and ports.
