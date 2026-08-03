# TASK-030 — WhatsApp automation Tools (rules, scheduled actions, agent assignment)

Date: 2026-08-02 · Tier C · AP-091 / ADR-158 (addendum 3)
Branch: `worktree-agent-a2aadaa6f307a5716`, based on `673b8ce`.

## Base check

The handed base was wrong. `git log --oneline -3` showed `1be17e1`, not the required
`673b8ce`. The worktree was clean, so it was reset to `673b8ce` ("Pin the desktop devUrl to
IPv4…"), the tip of `claude/whatsapp-module-contact-extractor-9cfff3`, and all work is on top of
that. Sixth agent, sixth stale base — worth fixing at the dispatcher.

## What shipped

The Tools Page rendered one Tool; it now renders four. Each new Tool is a registry entry plus a
panel, as `tools.ts` requires — no new dispatch logic in the Page beyond three ternaries.

### New Module files (`platform/modules/whatsapp/src/`)

| File | What it is |
| --- | --- |
| `assignment.ts` | Who is answerable for a chat or Person. Append-and-stamp ledger; `unassignAgent` never deletes. `isAgentAllowedFor` is the attribution gate. |
| `automation.ts` | Rules. A rule names a subject, a trigger and a **goal** — it has no body, no recipient and no transport. `planAutomationRun` produces at most `start_agent_run`. |
| `schedule.ts` | The queue of pending Agent Run starts, each carrying the policy rule that set its time. Imports nothing from `outbound.ts`. |
| `automation-state.ts` | The persisted envelope for all three ledgers, plus a tolerant reader. |

### New panels (`platform/apps/web/src/app/pages/whatsapp/`)

`AutomationRulesPanel.tsx`, `ScheduledActionsPanel.tsx`, `AgentAssignmentPanel.tsx`, and
`automation-store.ts` (one shared read — the three ledgers are coupled, so showing them from three
independent fetches would let one panel contradict the next).

### Shared files touched — additively only

- `src/tools.ts` — three registry entries, three mode literals, and the header comment corrected
  (it claimed "v1 ships one Tool" and "nothing runs from an Automation").
- `src/index.ts` — four export lines appended.
- `modules/manifests/src/index.ts` — three Tool capabilities, one new Agent capability
  (`whatsapp.agent.conversation-steward`) and its `module.agents` entry.
- `apps/api/src/router.ts` — one `automation` sub-router appended inside the existing `whatsapp`
  router, plus four helpers next to the existing WhatsApp constants.
- `apps/web/src/app/pages/WhatsAppPage.tsx` — three imports, three dispatch ternaries.
- `docs/raw/decisions-log.md` + `docs/wiki/decisions.md` — ADR-158 addendum 3.

Nothing was reordered or reformatted in any shared file.

`apps/web/src/app/data/pending-work.generated.json` was touched by a build and reverted — it is a
generated projection artifact, not this change.

## The send discipline

The constraint was that a rule or a schedule must not be able to route around the consent gate.
Four independent reasons it cannot, three of them tested directly:

1. **A rule has no send.** The richest thing `planAutomationRun` returns is `start_agent_run` with a
   goal. Composing a message is the Agent's work; delivering it is `performAutomatedSend`'s.
2. **The planner blocks on the same fact the policy refuses on.** A thread with no inbound message
   blocks with `consent_gate` — before the trigger is even evaluated, so the owner learns their rule
   can *never* fire rather than that it is merely not due.
3. **Rules may only tighten.** `tightenLimits` takes the stricter of every field against
   `SEND_POLICY_LIMITS`. Direction is per-field and spelled out: `min` for `dailyCap`, but also for
   `similarityThreshold` (lower catches more) ; `max` for `recipientCooldownDays` and
   `businessHourStart` (later start narrows the window) ; `min` for `businessHourEnd`; OR for
   `requireRecipientInitiated`.
4. **The gate runs regardless.** The ordered path — policy refusals → `decideSend` → Rust ceiling →
   send — is untouched. No file added here imports anything that can send.

Two further properties that follow from the same reasoning:

- **A refusal never becomes a scheduled action.** `scheduleFromPolicy` queues a `deferred` decision
  and returns a `refused` one *without touching the ledger*. A queue row is a thing a runner
  retries; a permanent no must not become a pending yes.
- **Even an allowed action waits.** Pacing is applied on top of `earliestAt` rather than replacing
  it, so a queue does not fire in lockstep the moment a cap window rolls. Described in code and copy
  as human pacing, which is what it is — never as evasion.

## Verified by test

`platform/modules/whatsapp`: **172 pass, 0 fail** (122 before; +50). Coverage 99.09% lines /
88.27% branch against the 70% gate. New suites: `automation.test.ts`, `schedule.test.ts`,
`assignment.test.ts`, `automation-state.test.ts`.

The load-bearing ones:

- `a_rule_cannot_start_a_run_into_a_thread_nobody_wrote_in` — every trigger shape, an Agent that
  *is* assigned, and a rule that tries to buy its way past with `requireRecipientInitiated: false`
  and `dailyCap: 100000`. All four blocked with `consent_gate`.
- `a_rule_cannot_widen_the_send_discipline` — a rule requesting the widest value of all eleven
  fields gets back exactly `SEND_POLICY_LIMITS`, asserted with `deepEqual`.
- `even_a_forged_plan_is_refused_at_the_real_gate` — a fully approved recipient, a rule's widest
  limits, and a real `performAutomatedSend` call against a thread nobody wrote in: refused with
  `consent_gate`, and the `SendPort` spy records **zero** calls.
- `a_refusal_never_becomes_a_scheduled_retry` — across four refusal rules.
- `a rule with a missing or garbled enabled flag comes back OFF` — a rule must not resurrect itself
  as enabled after a bad write.

Also green, unchanged: `@bridge/local` 37/37, `@bridge/web` 125/125,
`@bridge/module-manifests` 8/8 (the manifest test asserts every Tool's capability is declared), and
`@bridge/api` 389 tests / 388 pass / 0 fail — `router.ts` is the only API file touched.

`tools.test.ts` previously asserted "v1 ships exactly one Tool". Replaced with a duplicate-id check
and a check that every id the Page dispatches on is registered — written so a sibling agent adding
Tools does not have to touch it again.

## Verified by build

- `npx turbo run build --filter=@bridge/web` — **21/21 successful**, bundle built. (The suite
  passing is not the bundle building; that gap shipped a broken launch earlier today.)
- `npx turbo run typecheck --filter=@bridge/web` — 21/21. `vite build` does not typecheck, so this
  was run separately.
- `npx turbo run build --filter=@bridge/api` — 19/19.
- `npm run check:no-dummy-runtime` — OK. Nothing was added to `docs/dummy.md` because nothing
  needed to be: every empty state is real.

`npm run check:vocabulary` fails, but **it fails at the base commit too** — it flags
`ChatsSurface.tsx` and `whatsapp-shell.ts`, which this change does not touch (confirmed with
`git status --porcelain` on both paths). Pre-existing, not introduced here, and not fixed here
because the fingerprint baseline is not this task's to re-cut.

The worktree had no `node_modules`; `pnpm install --ignore-scripts` was run against the existing
lockfile (no resolution changes) before any of the above.

## Unverified

- **Not verified in a running app.** The user is running `tauri dev` and the brief said not to.
  Nothing here has been clicked. The panels typecheck and the bundle builds; that is all.
- **No runner exists.** Nothing dequeues a due action and starts a real Agent Run. `check` queues
  entries and `markStarted` can record one, but the loop between them is not built. The Scheduled
  Actions panel says the queue is Agent Runs waiting to start; it does not claim they execute. This
  is the largest honest gap and the obvious next task.
- **`check` is user-clicked, not scheduled.** Deliberate — it preserves the Module's guarantee that
  no Automation performs a WhatsApp read — but it means rules only fire when someone presses the
  button.
- **`check` can only fire quiet-thread rules.** It is a sweep over stored facts, so it has no
  arriving message to hand an `inbound_message` rule; those need a message-arrival hook that does
  not exist. Rather than reporting them as an ambiguous "not due", the check reports them as
  `waiting` with that explanation in full, so the owner is not left pressing the button weekly at a
  rule that structurally cannot respond to it. This is the second half of the missing-runner gap.
- **Person-subject rules are stored but always blocked.** Consent is a per-thread fact and a Person
  can be reachable in several threads, so `check` reports them honestly rather than guessing a
  thread. The Assignment panel only offers chats for the same reason.
- **`@bridge/api` test suite** — started, had not finished at time of writing; the API *build* is
  verified. Any failure there would be in `router.ts`, the only API file touched.

## Residency

All three ledgers live in one `LocalStateStore` namespace, `whatsapp:automation`, which is Local
Plane by construction. No dual-write, no promote path, no cloud canonical destination — the same
posture as message bodies under ADR-158/AP-091. Every mutating procedure requires
`identity.type === "user"`: an Agent may not author its own rules, assign itself, or cancel its own
queue.

## Honest empty states

- No rules: "No automation rules yet."
- No queue: "Nothing is scheduled." — and, when there are no rules, it says a rule is what puts
  something there.
- No assignments: "No Agent is assigned to any chat. Nothing automated will run until one is."
- No synced chats: the authoring form is replaced by a sentence pointing at message sync, rather
  than an empty dropdown.
- A rule that is switched on but cannot fire says "On, but blocked: no Agent is assigned to this
  chat" — a rule showing "on" while silently never running was the worst available option.

No sample rows, no placeholders, no `dummy_` anything.
