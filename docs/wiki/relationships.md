# Relationships module

full plan: [../raw/relationship-module-plan-2026-07.md](../raw/relationship-module-plan-2026-07.md) · designer brief: [../raw/relationship-design-requirements-2026-07.md](../raw/relationship-design-requirements-2026-07.md)

- One installable Relationship Module over shared Record/Relation/Event/Memory contracts. Primary toggles: Signals/People/Communities. Also Relations, Interactions, Introductions, Helpdesk, Sources, Files, Agents, Skills, Automations.
- Existing debt: legacy global-index/generic-capability routes, old occurrence tables, static map fallback, shallow list APIs. Migration inventory only; not accepted aliases.
- Main contradiction: People/Communities UI says not wired although list endpoints now exist. No Person/Community detail/mutation/search; association map still static-export-driven; Memory/runtime lifecycle incomplete.
- IA: Signals landing + Signals/People/Communities toggles. Signal = surfaced Event tied to ≥1 Person/Community, reason, safe Action. Interactions/Introductions/Helpdesk/Sources/Automations sub-modules. Standard toolbar/context menu/Files everywhere.
- Person = Overview/Timeline/Context/Relations/Communities/Linked Records/Introductions/Commitments/Files/Permissions/Activity.
- Action-first: why now + evidence + safe action + dismiss/snooze/correct/tune. No naked scores.
- Introductions = mutual-value check + consent A + consent B + approved send + outcome. Private decline reasons never leak.
- Relation = one semantic type + attributes + evidence. Multiple meanings = multiple Relations; group Event = participant rows. Skills nest under allowed Agents. Automations start Agent Runs.
- RM0 manifest/routes + Signals/People/Communities + Helpdesk fold-in; RM1 Person/Community pages; RM2 Event/Interaction timeline+intake+identity; RM3 Memory+commitments; RM4 Relations/map; RM5 intros+Automations; RM6 permissions + Second Brain consumers.
- Reuse research: Dex/Affinity/Monica patterns under clean-room protocol. Bridge edge = private/local default + governed actions + one cross-module graph + evidence/consent/corrections.
