# Relationships module

full plan: [../raw/relationship-module-plan-2026-07.md](../raw/relationship-module-plan-2026-07.md) · designer brief: [../raw/relationship-design-requirements-2026-07.md](../raw/relationship-design-requirements-2026-07.md)

- One installable Relationship Module over shared Record/Relation/Event/Memory contracts. Contains People, Communities, Relations, Interactions, Introductions, Helpdesk, Sources, Automations. NOT CRM, address book, social feed, surveillance, or duplicate graph.
- Existing: local/private plane + gate; people/communities/canonical/member/edge/touchpoint/timeline tables; list APIs; Gmail/Calendar intake; capture tools; KnowledgeBase shell; approvals/signals/calendar/Agent panel.
- Main contradiction: People/Communities UI says not wired although list endpoints now exist. No Person/Community detail/mutation/search; association map still static-export-driven; Memory/runtime lifecycle incomplete.
- IA: Today landing; People/Communities/Relations toggles; Interactions/Introductions/Helpdesk/Sources/Automations sub-modules. Standard toolbar/context menu/Files Section everywhere. No third sidebar.
- Person = Overview/Timeline/Context/Relations/Communities/Linked Records/Introductions/Commitments/Files/Permissions/Activity.
- Action-first: why now + evidence + safe action + dismiss/snooze/correct/tune. No naked scores.
- Introductions = mutual-value check + consent A + consent B + approved send + outcome. Private decline reasons never leak.
- Relation = one semantic type + typed attributes + many evidence refs; multiple meanings = multiple Relations; group Event = participant rows. Tech adds commitments, introduction cases, identity candidates, preferences/source state; 7 optional Agent archetypes, 30 Skills, 20 Automations.
- RM0 manifest/routes + People/Communities/Relations + Helpdesk fold-in; RM1 Person/Community pages; RM2 Event/Interaction timeline+intake+identity; RM3 Memory+commitments; RM4 Relations/map; RM5 consentful intros+recommendations+Automations; RM6 team/cross-module/evolution.
- Reuse research: Dex/Affinity/Monica patterns under clean-room protocol. Bridge edge = private/local default + governed actions + one cross-module graph + evidence/consent/corrections.
