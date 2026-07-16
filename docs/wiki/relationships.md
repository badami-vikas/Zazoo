# Relationships module

full plan: [../raw/relationship-module-plan-2026-07.md](../raw/relationship-module-plan-2026-07.md) · designer brief: [../raw/relationship-design-requirements-2026-07.md](../raw/relationship-design-requirements-2026-07.md)

- One installed Relationship Module. Shared Record/Relation/Event contracts. Primary Pages: Signals/People/Communities. Helpdesk nested.
- RM0 prototype done: nav → Signal → permitted Person/Community participants → source Event → governed Action. No global Knowledge route.
- Trust: server-owned Outreach Agent. Authenticated Approvals. Append-only decisions. Rejected/audit rows never pending.
- Public Helpdesk: bounded + rate-limited. Token hash only. Retry-safe ticket/reply operation IDs. Selectable recovery key fallback.
- Remaining debt: Person/Community mutation/search, Memory lifecycle, static map replacement, introductions, deeper Automations. Cross-Module graph = TASK-009.
- IA: Signals landing + Signals/People/Communities toggles. Signal = surfaced Event tied to ≥1 Person/Community, reason, safe Action. Interactions/Introductions/Helpdesk/Sources/Automations sub-modules. Standard toolbar/context menu/Files everywhere.
- Person = Overview/Timeline/Context/Relations/Communities/Linked Records/Introductions/Commitments/Files/Permissions/Activity.
- Action-first: why now + evidence + safe action + dismiss/snooze/correct/tune. No naked scores.
- Introductions = mutual-value check + consent A + consent B + approved send + outcome. Private decline reasons never leak.
- Relation = one semantic type + attributes + evidence. Multiple meanings = multiple Relations; group Event = participant rows. Skills nest under allowed Agents. Automations start Agent Runs.
- RM0 manifest/routes + Signals/People/Communities + Helpdesk fold-in; RM1 Person/Community pages; RM2 Event/Interaction timeline+intake+identity; RM3 Memory+commitments; RM4 Relations/map; RM5 intros+Automations; RM6 permissions + Second Brain consumers.
- Reuse research: Dex/Affinity/Monica patterns under clean-room protocol. Bridge edge = private/local default + governed actions + one cross-module graph + evidence/consent/corrections.
