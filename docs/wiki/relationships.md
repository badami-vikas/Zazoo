# Relationships module

full plan: [../raw/relationship-module-plan-2026-07.md](../raw/relationship-module-plan-2026-07.md) · designer brief: [../raw/relationship-design-requirements-2026-07.md](../raw/relationship-design-requirements-2026-07.md)

- Installable generated Workspace over shared Person/Community/edge/Memory/Touchpoint/Project. NOT CRM, address book, social feed, surveillance, or new graph.
- Existing: local/private plane + gate; people/communities/canonical/member/edge/touchpoint/timeline tables; list APIs; Gmail/Calendar intake; capture tools; KnowledgeBase shell; approvals/signals/calendar/Agent panel.
- Main contradiction: People/Communities UI says not wired although list endpoints now exist. No Person/Community detail/mutation/search; association map still static-export-driven; Memory/runtime lifecycle incomplete.
- Nav: Today · People · Communities · Map · Touchpoints · Introductions · Signals · Workflows · Sources. Person/Community use object tabs; no third sidebar.
- Person = Overview/Timeline/Context/Connections/Communities/Projects/Introductions/Commitments/Files/Permissions/Activity.
- Action-first: why now + evidence + safe action + dismiss/snooze/correct/tune. No naked scores.
- Introductions = mutual-value check + consent A + consent B + approved send + outcome. Private decline reasons never leak.
- Tech: shared typed edges, touchpoint participants, commitments, introduction cases, identity candidates, preferences/source state; 7 optional Agent archetypes, 30 Skills, 20 Automations.
- P0 wire existing surfaces; P1 Person/Community workspace; P2 timeline/intake/identity; P3 Memory+commitments; P4 graph/map; P5 consentful intros+Signals; P6 team/cross-module/evolution.
- Reuse research: Dex/Affinity/Monica patterns under clean-room protocol. Bridge edge = private/local default + governed actions + one cross-module graph + evidence/consent/corrections.
