---
title: Relationship Module — Detailed Product, Business, and Technical Plan
type: raw
doc_kind: plan
status: proposed
companions: [relationship-design-requirements-2026-07.md, primitive-specifications.md, client-architecture-context-providers.md, clean-room-capability-research-protocol-2026-07.md]
related_wiki: ../wiki/relationships.md
updated: 2026-07-14
tags: [relationship, people, communities, interactions, helpdesk, memory, module, agents, skills, automations]
---

# 0. Decision

The former Bridge/Relationships surface becomes one installable **Relationship Module**. It contains People, Communities, Relations, Interactions, Introductions, Helpdesk, Sources, and Automations over shared Record/Relation/Event contracts. It is not a CRM, address book, lead pipeline, surveillance product, or second relationship database.

```yaml
canonical_objects_reused:
  - Person
  - Community
  - Record
  - Relation
  - Event
  - Memory
  - Knowledge
  - Request
  - Action
  - Result
  - File
  - Agent
  - Skill
  - Automation
  - Integration
```

Relationship itself is a governed typed Relation plus an evidence-backed projection. A Relation carries one semantic type with typed attributes and multiple evidence references; different meanings use separate Relation rows. Group interactions use an Interaction/Event Record plus participant Relations. People/Communities live in the Relationship Domain; work lives in the Work Domain. Either Domain can contain Local- or Cloud-Plane data under residency policy.

# 1. What exists today

## 1.1 Implemented foundations

```yaml
implemented:
  governance:
    - Universal Action Pipeline, deny-default authority, append-only ledger
    - local↔gate↔cloud plane gate
    - private data structurally blocked from egress
    - agent-floor deny for full-network reads and external send
    - approval-gated social read/write scopes
  data:
    - people and communities Organization-scoped tables
    - people_canonical and communities_canonical public identity tier
    - community_members
    - shared typed edges fabric
    - legacy initiative participant tables pending Record/Relation migration
    - hierarchical interaction records (legacy table name pending VOCAB4 migration)
    - timeline_entries and entity references
    - local pglite store and local media store
  api:
    - graph.listPeople
    - graph.listCommunities
    - graph legacy listInitiatives/listTouchpoints/listSignals endpoints (VOCAB3/VOCAB4 migration inventory)
    - paginated Organization-scoped GraphStore methods
  intake:
    - Gmail threads → proposed Person/Interaction/Memory
    - Calendar events → proposed Interaction
    - uncertain identity matches → possible_duplicate Event, not silent linking
    - card scanner → proposed Person + “Met” Interaction
    - camera and conversation capture → private local Files and proposed Memory/Interactions
  surfaces:
    - legacy KnowledgeBase shell pending Relationship Module route migration
    - reusable DataViews table/board/card/calendar/map/graph eligibility
    - AssociationsMap and PeopleMapView components
    - shared Approvals, Events, Calendar, Agent panel
```

## 1.2 Partial, prototype, or inconsistent

```yaml
partial:
  - KnowledgeBase People/Communities still display NotWiredYet although backend endpoints now exist
  - KnowledgeBase source comments are stale and claim those endpoints do not exist
  - listPeople/listCommunities expose only shallow rows; no get/detail/search/mutation surface
  - associations use a local generated network export/static fallback rather than one governed graph query
  - network.ts schema contains warmth/trust/reciprocity fields not aligned cleanly to durable kernel contracts
  - People UI has no full Person Page
  - Community UI has no full Community Page
  - Gmail/Calendar intake creates graph proposals, but end-user review/identity-resolution experience is incomplete
  - social-provider framework exists; runtime provider depth and UI vary
  - pins are localStorage, so module pinning does not sync across clients
  - Memory primitive and search experience remain designed more than implemented
```

## 1.3 Catalog concepts not proven as complete runtime capabilities

The current tool catalog describes Reconnect, Open Threads, Community Pulse, Memory Search, Milestones, Career Moves, Intro Round, and Monthly Check-in as Live/Template. Treat these as product concepts until their trigger, store, API, evaluation, governance and real-path browser evidence exist. Do not use catalog labels as implementation proof.

## 1.4 Missing foundations

- Person/Community get, search, create, update, archive, merge, split and history procedures;
- typed relationship-edge vocabulary and evidence/provenance contract;
- identity-resolution review queue;
- Interaction-to-Person/Community participant model beyond current legacy assignee shape;
- production MemoryEngine and relationship memory retrieval;
- team ownership/delegation/visibility UX;
- introductions, commitments and consent state models;
- explainable derived relationship indicators with confidence/age/inputs;
- unified interaction timeline across email, calendar, capture, manual and module activities;
- cross-client synced views/pins/preferences;
- import/export, deletion/forgetting and data-portability surfaces;
- evaluation datasets for matching, reminders, introductions and message drafting.

# 2. Product/design lens

## 2.1 Navigation

Relationships appears as one optional pinned module item, not permanent global chrome. KnowledgeBase remains the universal index; Relationships is the richer operating projection.

```yaml
navigation:
  global_or_pinned_module_entry: Relationship
  landing_page: Today
  primary_toggle_pages: [People, Communities, Relations]
  submodules:
    Interactions: [Timeline, Table, Calendar, Unreviewed]
    Introductions: [Requested, Suggested, Consent Pending, Active, Completed, Declined]
    Helpdesk: [Requests, Routing, Responses, Activity]
    Sources: [Accounts, Imports, Sync Health, Identity Review]
    Automations: [Installed, Suggested, Runs, Failures]
  object_tabs:
    Person: [Overview, Timeline, Context, Relations, Communities, Linked Records, Introductions, Commitments, Files, Permissions, Activity]
    Community: [Overview, Members, Map, Interactions, Linked Records, Events, Gatherings, Files, Permissions, Activity]
```

No third sidebar. Object tabs collapse into More on narrow screens. Every database-backed Page uses the canonical landing Section, standard Views/Lists/search/filter/Add/3-dots toolbar, shared column/toggle context menu, related Sections, and Files Section.

## 2.2 Today

Action-first daily relationship briefing:

- unanswered inbound messages;
- commitments due or overdue;
- recently changed roles/companies and important milestones;
- upcoming meetings requiring preparation;
- relationships with user-defined cadence slipping;
- introduction requests awaiting consent/action;
- community changes worth acknowledging;
- identity conflicts and new captures awaiting review;
- recent relationship Memories and corrections;
- Agent proposals awaiting approval.

Every item says why it surfaced and offers Dismiss, Snooze, Correct, Act, or Tune. No infinite engagement feed and no naked score leaderboard.

## 2.3 People list

Views: Table, Cards, Map, Graph, Recently Active, Needs Attention, Pinned, Muted, Archived.

Default columns:

- Person and verified aliases;
- current role/community;
- relationship types;
- ring/cadence when user-defined;
- last meaningful Interaction;
- next commitment/action;
- context freshness;
- source coverage;
- visible Communities and linked Records from other Modules;
- pending introduction/approval;
- owner/visibility for team Organizations.

Filters:

- Community, linked Module/Record, location, role, relationship type, owner, visibility;
- source/integration;
- recently changed;
- touchpoint date/kind;
- commitment state;
- context freshness;
- user-confirmed vs inferred;
- possible duplicate/conflict.

Bulk operations: tag/group through governed Community membership, assign steward, export permitted fields, request review, archive. Never bulk-message by default.

## 2.4 Person workspace

### Overview

- identity, role, organizations/communities and user-confirmed relationship context;
- “where we left off” grounded summary;
- upcoming meeting/important date/commitment;
- linked Records from other Modules and mutual Communities;
- recent Interactions;
- suggested next action with explanation;
- unresolved conflicts or stale context;
- privacy/visibility badge.

### Timeline

Unified chronological view: meetings, emails, messages, notes, introductions, captures, linked Module Records, commitments, Events and human corrections. Filter by channel/type/source. Each item shows origin, participants, permission scope and source.

### Context

Inspectable Memory grouped as:

- how you met;
- working preferences and communication style;
- goals/interests explicitly shared or user-recorded;
- important dates;
- family/personal context only when intentionally recorded and permitted;
- open loops and prior help exchanged;
- user corrections and superseded context.

Memory is context, not instruction. Sensitive information defaults private/local, supports correction/forgetting and never appears as voyeuristic profiling.

### Connections

- mutual People/Communities;
- direct and multi-hop paths;
- evidence behind each edge/path;
- relationship type, recency and confidence;
- strongest potential introducer only when visibility and consent permit;
- ask-for-introduction draft with both-party review workflow.

### Communities

Memberships, roles, confidence/source, history, related gatherings/resources and suggested corrections.

### Linked Records

Domain Records from installed Modules (for example Deal or Help Request), role, active commitments, linked Files and last activity. Relationship Module does not create a Project or Initiative primitive.

### Introductions

Requested, proposed, consent-pending, made, declined, completed and follow-up states. Show requester, reason, value for both sides, introducer, consent, messages and outcome.

### Commitments

Promises made by/to the user, owner, due date, evidence, status, sensitivity and follow-up. Separate commitments from generic reminders.

### Files

User-permitted notes, cards, photos, recordings and documents. Raw private media stays local. Derived summaries link to originals and access state.

### Permissions

Visibility, data sources, Agent access, team access, external-use restrictions, muted signals, cadence preferences, export/forget controls and audit summary.

### Activity

Immutable Human/Agent/Automation history, approvals, changes, merges, Memory used, Skills invoked and optimization receipts.

## 2.5 Communities list and workspace

Community kinds are user-defined/learned: company, team, cohort, event, geography, interest, family, professional group, customer/user group, or custom. Do not hardcode market segments.

Community Overview:

- purpose/description and source;
- member count and confirmation status;
- linked Module Records, recent Interactions and meaningful changes;
- user role/relationship to Community;
- open requests/commitments;
- suggested gathering/resource/action.

Community tabs:

- Members: roles, confidence, activity, membership history;
- Map: member network and adjacent Communities;
- Interactions: meetings/events/conversations involving Community;
- Linked Records: permitted Records from installed Modules;
- Events: changes and action proposals;
- Gatherings: candidate group, consent, invite drafts, calendar event, follow-up;
- Files: shared Files/Knowledge;
- Permissions: team visibility, source and Agent access;
- Activity: immutable history.

## 2.6 Map

Views:

- centered on self, Person, Community or linked Module Record;
- 1st/2nd/3rd+ degree;
- Community clusters;
- geographic map when explicit location exists;
- path finder between two permitted nodes;
- evidence/recency/confidence overlay.

Graph must not imply objective relationship strength. Explain edge source and uncertainty. Hide paths that would expose private third-party data.

## 2.7 Interactions

Cross-relationship Event journal/list of meetings, messages, calls, notes, captures, help, gifts, introductions and milestones.

Views: Timeline, Table, Calendar, By Person, By Community, Unreviewed Intake.

Each Interaction Event contains participants, kind, time, source, summary/context, linked Module Records, commitments, follow-ups, privacy scope, provenance and parent/child hierarchy.

## 2.8 Introductions

Pipeline is consent, not sales:

`Idea → Validate value → Ask side A → Ask side B → Draft → Approve/send → Connected → Follow-up → Outcome`

Lists: Requested of Me, I Requested, Suggested, Consent Pending, Active, Completed, Declined. Never expose one party’s private reason to the other without permission.

## 2.9 Events and recommendations

Categories:

- open loop/unanswered inbound;
- commitment due;
- user-defined cadence slip;
- career/company/milestone change;
- upcoming meeting prep;
- possible duplicate/conflicting identity;
- possible introduction/help opportunity;
- community change;
- stale/contradicted context;
- data-source failure or permission change.

Every surfaced Event/recommendation contains evidence, confidence, why now, affected Records and at least one safe Action. User feedback tunes thresholds/inputs, not opaque code.

## 2.10 Automations

Installable Automations and playbooks, not a fixed contact cadence system. Examples: meeting prep, after-meeting capture, monthly inner-ring review, introduction round, community gathering, new-role acknowledgement, commitment follow-up, and relationship review before a linked Module milestone.

## 2.11 Sources

Data source control center:

- Gmail, Calendar, Outlook, contacts, browser, social providers, card/camera/conversation capture, files/manual import;
- account/profile used and explicit allow/deny restrictions;
- data classes read, local/cloud plane, retention and last sync;
- proposed matches, unresolved conflicts and errors;
- pause, disconnect, reindex, export and forget;
- no “connect everything” dark pattern.

# 3. Business lens

## 3.1 Jobs/processes covered

```yaml
covered:
  capture_and_identity:
    - import/sync permitted people and interactions
    - normalize identities, review duplicates, preserve source history
    - capture business cards, conversations, notes and meetings
  relationship_continuity:
    - remember where interaction stopped
    - meeting preparation and follow-up
    - track commitments and open loops
    - user-defined check-in cadences and reminders
  network_navigation:
    - map People/Communities/linked Module Records
    - find permitted warm paths
    - understand mutual context and interaction evidence
  introductions:
    - request, qualify, collect consent, draft, track and follow up
  community_stewardship:
    - membership and role tracking
    - community activity/change detection
    - gatherings, shared resources and help routing
  cross_module_support:
    - relate People/Communities/Interactions to permitted Records in other Modules
    - surface relationship actions that unblock work
  knowledge_and_memory:
    - grounded relationship search
    - inspectable context, corrections, forgetting and source links
  team_coordination:
    - scoped ownership, shared context and delegated follow-up
    - permissions and audit for collective networks
  institutional_learning:
    - learn preferred cadence, writing tone, useful signals and failed suggestions
    - propose new Skills/Automations through capability lifecycle
```

## 3.2 Explicit exclusions

```yaml
not_covered:
  - sales lead scoring, quotas, funnels, sequences or revenue forecasting as kernel/module defaults
  - automated scraping of private profiles or bypassing platform terms/access controls
  - buying/selling relationship data or ad targeting
  - covert surveillance, employee monitoring or sentiment/psychological profiling
  - objective friendship/trust scores or social-credit rankings
  - inferring protected/sensitive traits
  - autonomous external messages, introductions or calendar invitations at launch
  - exposing one party’s private notes, graph, consent response or communications to another
  - claiming consent from silence
  - replacing email, calendar, chat or social networks
  - background checks, investigations or risk adjudication without a separate governed Module
  - full event-management, fundraising, membership billing or donor-management systems
  - hard-delete avoidance where law/user rights require deletion; privacy rights override append-only product history
```

## 3.3 Value and packaging

Primary users: founders, investors, operators, community builders, recruiters, advisors, creators and teams whose work depends on durable trust. Module vocabulary adapts to user domain; “contact,” “member,” “candidate,” “investor,” and “advisor” may appear as user/domain labels, never kernel canon.

Package slices:

- Core Relationships: People, Communities, Person workspace, Timeline, Sources;
- Continuity: Memories, commitments, meeting prep/follow-up, user cadences;
- Network Navigation: Map, path finder, introductions;
- Community Stewardship: gatherings, resources, help routing;
- Team Relationship Intelligence: scoped shared network and delegated stewardship.

North-star: useful relationship outcomes per trusted action—not number of contacts, messages sent, or time in app.

Metrics:

- identity-match precision and correction rate;
- percentage of surfaced Events/recommendations acted/dismissed/tuned;
- commitments closed on time;
- meeting-prep usefulness;
- introduction acceptance and beneficial-outcome rate;
- source/citation coverage;
- stale-context and unwanted-reminder rate;
- user trust: corrections, disconnects, permission narrowing, privacy complaints;
- quality-adjusted cost per useful action.

# 4. Technical lens

## 4.1 Data model additions/refinements

```yaml
required_records:
  relations:
    note: may remain typed rows in shared edges table; define schema/validators, do not add parallel graph
    fields: [relationship_type, direction, evidence_refs, confidence, observed_at, valid_from, valid_to, user_confirmed, visibility, source]
  interaction_participants:
    fields: [event_id, record_type, record_id, role, attendance_state]
  commitments:
    fields: [organization_id, person_id, event_id, direction, text, owner, due_at, status, sensitivity, source_ref]
  introduction_cases:
    fields: [requester, party_a, party_b, introducer, purpose, value_a, value_b, consent_a, consent_b, state, messages, outcome]
  identity_candidates:
    fields: [source_records, candidate_people, match_factors, confidence, state, reviewer, resolution]
  relationship_preferences:
    fields: [person_or_community, cadence, muted_signals, allowed_channels, quiet_hours, notes_visibility]
  source_sync_state:
    fields: [provider, account_identity, scopes, plane, cursor, last_sync, health, retention]
```

Derived indicators such as warmth/dormancy/reciprocity are versioned computations, never manually authoritative columns without explanation. Each output stores inputs, formula/version, timestamp, confidence and human override.

## 4.2 APIs/ports

- `person.list/get/search/proposeCreate/proposeUpdate/archive/merge/split/history`;
- `community.list/get/search/proposeCreate/proposeUpdate/members/history`;
- `relationship.neighbors/path/evidence/proposeEdge/correctEdge`;
- `interaction.list/get/propose/participants/tree`;
- `commitment.list/propose/update`;
- `introduction.list/get/propose/consent/advance`;
- `identity.candidates/review`;
- `relationshipMemory.search/propose/correct/forget` behind MemoryEngine;
- `relationshipSource.list/sync/pause/disconnect/export/forget`;
- saved views/pins/preferences synced through cloud control plane while private contents remain local.

All mutations route through Pipeline. Reads enforce tenancy, relationship visibility, plane and least-data scope. Whole-network read remains agent-floor denied except explicit bounded human query/run grants.

## 4.3 Agent archetypes

Four permanent Bridge Agents remain unchanged. Optional Module archetypes:

```yaml
agents:
  Relationship_Steward:
    job: synthesize context and propose continuity actions
  Identity_Curator:
    job: analyze match/merge/split candidates; never auto-merge uncertain people
  Meeting_Briefer:
    job: source-grounded preparation and follow-up drafts
  Introduction_Coordinator:
    job: qualify mutual value, collect consent and draft double-sided introductions
  Community_Steward:
    job: understand membership/activity and propose gatherings/resources/help
  Network_Navigator:
    job: answer bounded path/context queries with evidence and privacy filtering
  Context_Researcher:
    job: request public enrichment through cloud gate; never access private network directly
```

Communications Skill owns final tone adaptation and external drafts. Governance Agent explains deterministic permission/risk decisions. Chief of Staff is sole router; Module Agents do not hand off peer-to-peer.

## 4.4 Skills

```yaml
skills:
  - person-capture-and-normalization
  - identity-match-explanation
  - duplicate-merge-review
  - person-profile-synthesis
  - community-detection-proposal
  - community-membership-review
  - interaction-capture-and-linking
  - conversation-summary-and-next-steps
  - meeting-preparation
  - meeting-follow-up-drafting
  - commitment-extraction-and-tracking
  - open-loop-detection
  - relationship-timeline-synthesis
  - grounded-relationship-search
  - context-freshness-assessment
  - cadence-review
  - reconnect-opportunity-assessment
  - milestone-change-assessment
  - warm-path-finding
  - introduction-value-assessment
  - double-consent-introduction-drafting
  - introduction-outcome-capture
  - community-pulse-assessment
  - gathering-design-and-attendee-shortlist
  - help-request-capability-routing
  - relationship-memory-correction
  - privacy-scope-and-redaction-review
  - source-provenance-audit
  - relationship-export-and-forgetting
  - relationship-playbook-evaluation
```

## 4.5 Automations

```yaml
automations:
  - permitted-source-incremental-sync
  - source-health-and-scope-change-monitor
  - identity-candidate-generation
  - possible-duplicate-review-queue
  - inbound-interaction-intake
  - calendar-meeting-interaction-intake
  - pre-meeting-brief-proposal
  - post-meeting-summary-and-commitment-proposal
  - unanswered-inbound-detection
  - commitment-due-reminder
  - user-defined-cadence-review
  - context-staleness-review
  - public-milestone-change-review
  - introduction-request-consent-workflow
  - introduction-follow-up
  - community-change-digest
  - gathering-proposal-and-approved-invite
  - linked-record-milestone-relationship-review
  - privacy-retention-and-forgetting-run
  - correction-failure-to-eval-capture
```

Each Automation defines trigger, scope, Plane, budget, idempotency, retry/backoff, owner, stop condition, risk band and immutable Run evidence. No external send is automatic at launch.

## 4.6 Integrations

- Google Gmail/Calendar/Contacts;
- Microsoft Outlook/Microsoft Graph contacts/calendar/email;
- Apple Contacts/Calendar/iMessage only through local platform-specific adapters and explicit permission;
- mobile contacts, share sheet, voice/photo/card capture;
- browser extension for current profile/page capture, not prohibited scraping;
- permitted social APIs/exports;
- Slack/Teams/Discord/WhatsApp only where official APIs, user authorization and data rules permit;
- CSV/vCard/LinkedIn export import;
- scheduling/meeting/transcription providers behind ports;
- DealPilot, Helpdesk, JobPilot and generated Modules consume shared Relationship Records rather than copy them.

# 5. Reuse and competitive research

Apply clean-room protocol before adoption or alternative implementation.

```yaml
sources:
  Dex:
    learn: relationship consolidation, where-you-left-off, reminders/groups, role-change sync, personal context and mobile continuity
    mode: proprietary reference/benchmark only unless licensed integration exists
    url: https://getdex.com/
  Affinity:
    learn: firm network paths, activity capture, recency/frequency indicators, permissions and deal-context relationship intelligence
    mode: proprietary reference/benchmark and possible API integration; do not reproduce scoring claims/UI
    url: https://www.affinity.co/product/relationship-intelligence
  Monica:
    learn: simple contact context, reminders, journal, important dates, private notes and API portability
    mode: AGPL/source-license review required; do not embed into commercial Bridge core
    url: https://www.monicahq.com/features
  Bridge_existing:
    learn: preserve local/private plane, governed action, capture contracts, graph reuse, Helpdesk routing
    mode: extend rather than rebuild
```

Bridge differentiation:

- relationship data private/local by default;
- capability lifecycle proposes the module around user work;
- evidence-backed, inspectable relationship context;
- consent-aware introductions;
- user-defined purpose/cadence, not universal engagement maximization;
- one graph reused by every installed Module;
- actions governed through one Pipeline;
- relationship intelligence becomes usable Skills/Automations, not a static score dashboard.

# 6. Delivery sequence

```yaml
slices:
  RM0:
    scope: installable Relationship Module manifest/routes; People/Communities/Relations standard toggle pages; fold Helpdesk under the Module; wire real endpoints; honest empty/import states
  RM1:
    scope: Person/Community get/search/detail + Person Overview/Timeline/Sources + governed create/update/archive
  RM2:
    scope: Event/Interaction participants + unified Timeline + Gmail/Calendar/capture review + identity queue; migrate legacy interaction API/table names
  RM3:
    scope: MemoryEngine relationship retrieval/correction/forget + commitments + meeting prep/follow-up
  RM4:
    scope: typed Relations + governed Map/path finder + Communities Page
  RM5:
    scope: double-consent Introductions + surfaced Events/recommendations + user-defined Automations
  RM6:
    scope: team network permissions/delegation + cross-module consumers + eval-driven evolution
```

Dependencies: auth/security P0, RLS, runtime taint, MemoryEngine, source-account constraints, synced preferences, whole-network bounded-query authorization and deletion/forget semantics.

# 7. Exit criteria

- no duplicate relationship/contact store;
- People/Communities backed by real APIs and stores;
- every material context statement cites source or labels inference;
- uncertain identities never silently merge;
- private relationship data cannot cross gate;
- every introduction records both-party consent state;
- every surfaced Event/recommendation explains why and offers correction/tuning;
- no autonomous external send;
- user can export, correct, disconnect and forget permitted data;
- browser evidence for all changed surfaces at desktop and 375px;
- matching/path/reminder/introduction evals pass held-out thresholds;
- Module manifests declare scopes, Planes, sources, Agents, Skills, Automations and Integrations;
- runtime contains real connected data or honest empty state only.
