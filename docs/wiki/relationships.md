# Relationships module

full plan: [../raw/relationship-module-plan-2026-07.md](../raw/relationship-module-plan-2026-07.md) · designer brief: [../raw/relationship-design-requirements-2026-07.md](../raw/relationship-design-requirements-2026-07.md)

- One installed Relationship Module. Shared Record/Relation/Event contracts. Primary Pages: Signals/People/Communities. Helpdesk nested.
- RM0 done: nav → Signal → permitted Person/Community participants → source Event → governed Action. No global Knowledge route.
- RM1-2 built: owner-safe Person/Community CRUD/search/detail. One Timeline. Bounded Google/capture + identity review.
- RM3 built: Memory correct/forget. Commitment Event snapshots. Grounded meeting prep + follow-up.
- RM4 done: evidence-bearing owner Relations, durable effects, bounded paths, Community composition. Graph renderer stays TASK-014/TASK-009.
- RM5 intro built: private Event snapshots. Two recorded consents before complete. Decline text hidden. No send.
- Trust: server-owned Outreach Agent. Authenticated Approvals. Append-only decisions. `ref_ledger_id` only. Rejected/audit rows never pending.
- Public Helpdesk: bounded + rate-limited. Token hash only. Retry-safe ticket/reply operation IDs. Selectable recovery key fallback.
- TASK-008 stays in progress: user Automations, team delegation, export/disconnect/forget, evals. Cross-Module Graph = TASK-014/TASK-009.
- IA: Signals landing + Signals/People/Communities toggles. Signal = surfaced Event tied to ≥1 Person/Community, reason, safe Action. Interactions/Introductions/Helpdesk/Sources/Automations sub-modules. Standard toolbar/context menu/Files everywhere.
- Person = Overview/Timeline/Context/Relations/Communities/Linked Records/Introductions/Commitments/Files/Permissions/Activity.
- Action-first: why now + evidence + safe action + dismiss/snooze/correct/tune. No naked scores.
- Introductions = mutual-value check + consent A + consent B + approved send + outcome. Private decline reasons never leak.
- Relation = one semantic type + attributes + evidence. Multiple meanings = multiple Relations; group Event = participant rows. Newer decision replaces canonical set. Skills nest under allowed Agents. Automations start Agent Runs.
- RM0 manifest/routes + Signals/People/Communities + Helpdesk fold-in; RM1 Person/Community pages; RM2 Event/Interaction timeline+intake+identity; RM3 Memory+commitments; RM4 Relations/map; RM5 intros+Automations; RM6 permissions + Second Brain consumers.
- Reuse research: Dex/Affinity/Monica patterns under clean-room protocol. Bridge edge = private/local default + governed actions + one cross-module graph + evidence/consent/corrections.
