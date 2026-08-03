# Relationships module

full plan: [../raw/relationship-module-plan-2026-07.md](../raw/relationship-module-plan-2026-07.md) · designer brief: [../raw/relationship-design-requirements-2026-07.md](../raw/relationship-design-requirements-2026-07.md)

- One installed Relationship Module. Shared Record/Relation/Event contracts. Primary Pages: Signals/People/Communities. Helpdesk nested.
- VOCAB5 done: manifest `0.2.2` owns Relations/Interactions/Introductions/Helpdesk/Sources + Agents/Automations/Integrations. Old `0.2.1` becomes legacy.
- Help Request API = `relationship.helpdesk`. Standalone package/top-level API/dead browser stores gone. No migration `0024`.
- RM0 done: nav → Signal → permitted Person/Community participants → source Event → governed Action. No global Knowledge route.
- RM1-2 built: owner-safe Person/Community CRUD/search/detail. One Timeline. Bounded Google/capture + identity review.
- RM3 built: Memory correct/forget. Commitment Event snapshots. Grounded meeting prep + follow-up.
- RM4 done: evidence-bearing owner Relations, durable effects, bounded paths, Community composition. Graph renderer stays TASK-014/TASK-009.
- RM5 intro built: private Event lifecycle. Snapshot + decline text sit on owner-filtered Relations. Two consents before complete. No send.
- Hardening: browser delegation self-only. Private Event content absent from workspace Event rows. Google/capture retries durable + owner-bound. Capture approval makes one Event. Snapshot pages load beyond 25.
- Trust: server-owned Outreach Agent. Authenticated Approvals. Append-only decisions. `ref_ledger_id` only. Rejected/audit rows never pending.
- Public Helpdesk: bounded + rate-limited. Token hash only. Retry-safe ticket/reply operation IDs. Selectable recovery key fallback.
- TASK-008 exact prototype done. Advanced Automations/delegation/export/evals stay future scope. Cross-Module Graph = TASK-014/TASK-009.
- IA: Signals landing + Signals/People/Communities toggles. Signal = surfaced Event tied to ≥1 Person/Community, reason, safe Action. Interactions/Introductions/Helpdesk/Sources/Automations sub-modules. Standard toolbar/context menu/Files everywhere.
- Person = Overview/Timeline/Context/Relations/Communities/Linked Records/Introductions/Commitments/Files/Permissions/Activity.
- Action-first: why now + evidence + safe action + dismiss/snooze/correct/tune. No naked scores.
- Introductions = mutual-value check + consent A + consent B + approved send + outcome. Private decline reasons never leak.
- Relation = one semantic type + attributes + evidence. Multiple meanings = multiple Relations; group Event = participant rows. Newer decision replaces canonical set. Skills nest under allowed Agents. Automations start Agent Runs.
- RM0 manifest/routes + Signals/People/Communities + Helpdesk fold-in; RM1 Person/Community pages; RM2 Event/Interaction timeline+intake+identity; RM3 Memory+commitments; RM4 Relations/map; RM5 intros+Automations; RM6 permissions + Second Brain consumers.
- Reuse research: Dex/Affinity/Monica patterns under clean-room protocol. Bridge edge = private/local default + governed actions + one cross-module graph + evidence/consent/corrections.
- WhatsApp link (ADR-159): Person Timeline shows a Local-Plane "WhatsApp activity" subsection via `relationship.whatsappTimeline` — counts/timestamps only, joined at render time, never written into cloud Events. Chat→Person = exact `dedupe_key` lookup; ambiguity = `possible_duplicate` Signal; LID≠phone always. Community side unsupported (no local Community store) and says so.
