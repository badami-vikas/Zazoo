# Decisions Log (ADR)

Append-only record of non-trivial engineering decisions: what was decided, why, what
was rejected, and when. One entry per decision. Newest first. This complements
`docs/wiki/decisions.md` (which holds the short *locked* strategic calls) by capturing
the **rationale and alternatives** so a future session — human or agent — can see not
just what we chose but why, and what we deliberately did not choose.

Format per entry:
- **Date — Title**
- **Context:** the situation forcing a choice.
- **Decision:** what we chose.
- **Rationale:** why this over the alternatives.
- **Alternatives rejected:** and why.
- **Consequences / follow-ups:** what this commits us to, what remains open.

---

## 2026-07-04 — Generic manifest intake seam (@bridge/tool-kit), DealPilot wired first

**Context:** Wiring DealPilot's live API surface hit a real gap: its manifest declares
`intakePolicy.quarantine: true` (forced structurally, mirrors agent-floor), but no seam existed
for a manifest-composed external tool to quarantine sourced data through the pipeline and commit
it only on human "Add" — the exact gap already logged for Recon (staging.jsonl bypasses
governance entirely).

**Decision:** Added `createToolSourceSkill`/`ToolIntakeMaterializer`/`ToolCaptureStore` to
`@bridge/tool-kit` (generic, not DealPilot-specific): a tool registers a `<toolId>.source` Skill
that fetches via its `SourceConnector` and quarantines every `CaptureEnvelope` (light manifest
only, full payload stays in the store) — the skill runs inside `pipeline.propose()` as an
`external:fetch` action, so authority/policy/ledger audit apply exactly as for
`google.sourceGmail`. A separate `materializer.add(captureId)` is the human commit step (capture ≠
commit, same UX as Camera/Card Scanner). Wired DealPilot to it in `apps/api/src/wiring.ts` +
`router.ts` (`dealpilot.source`/`commit`/`list`), using the existing `createGmailFetchMessages`
composition (no new OAuth).

**Rationale:** Generalizing in `@bridge/tool-kit` (rather than a DealPilot-only helper) means
Recon's future migration reuses the exact same seam instead of a second bespoke one — directly
addresses the "Tool registry desync: 3 unlinked systems" known issue's root cause (manifests,
registry, and intake previously had no programmatic binding).

**Alternatives rejected:** An ungoverned `dealpilot.source` endpoint that fetches+commits in one
step — rejected; violates the manifest's own `quarantine: true` contract and the platform's
draft-then-approve principle for expedience. Building this only inside `@bridge/dealpilot` —
rejected; would not fix Recon's identical gap and duplicates work when Recon migrates.

**Consequences / follow-ups:** `dealpilot.list` uses a fixed empty thesis (no thesis-management
UI yet) and 1 capture = 1 candidate (dedupe-on-commit not wired into the API path yet, though
`company-sourcing.matchCompany` is available). Recon itself is NOT migrated onto this seam yet —
only the reusable piece exists. Prototype `/dealpilot` page still renders `dummy_` data, not this
API. 41/41 monorepo `turbo run typecheck test` tasks green; 9/9 tool-kit tests (7 existing + 2 new).

---

## 2026-07-04 — DealPilot P0 connectors: BizBuySell via Gmail compose (real); BusinessBroker.net scrape rejected (robots.txt)

**Context:** Phase 3 (tool-standardization-plan.md) shipped `@bridge/dealpilot`'s two P0 connectors
as proof-of-shape factories (`createBizBuySellAlertConnector`/`createBusinessBrokerNetConnector`)
with injected transport but no real parse/fetch logic. Asked to "wire the real connectors."

**Decision:** BizBuySell — implemented a real `parseBizBuySellAlert` (regex field extraction:
name/industry/geo/askPrice/revenue/sde/url, HTML-tolerant) plus `createGmailFetchMessages`, which
composes the existing governed `@bridge/integrations-google` `GoogleGatewayFactory.fetchThreads`
rather than the connector owning any OAuth/HTTP client. BusinessBroker.net — checked
`businessbroker.net/robots.txt` (2026-07-04): it Disallows `/listings/` and every query-string URL
(`/*?`), which covers exactly the search/listing endpoints a live connector needs; no RSS/sitemap
feed exists as a compliant fallback. Implemented only the real *normalization*
(`normalizeBusinessBrokerRow`, alias-tolerant field mapping + confidence heuristic) and left
`fetcher` as an injected seam — no live scraper was built.

**Rationale:** The architecture doc (`Tools/Job/DealPilot-Architecture.md` N5/§6) already commits
to "robots/rate policies enforced per domain"; BizBuySell's own docs describe the P0 source as a
saved-search *alert email*, not a scrape target (bizbuysell.com itself 403s unauthenticated
fetches — Akamai-fronted, matches the doc's proxy-tier note). Composing the existing Google
integration is strictly more correct than a bespoke Gmail client and keeps the "no tool-owned
OAuth" rule intact. For BusinessBroker.net, robots.txt is a clear compliance line — violating it to
satisfy a task ships a legal/reputational liability disguised as progress.

**Alternatives rejected:** Building a live scraper for BusinessBroker.net against its disallowed
paths — rejected outright (ToS/robots violation, no defensible business justification to override
it in this session). Giving BizBuySell connector its own Gmail OAuth client — rejected; violates
the plan's explicit "no tool-owned OAuth" rule and would duplicate the governed integration's
token lifecycle/consent surface.

**Consequences / follow-ups:** BizBuySell is now live end-to-end once a Google integration is
connected for the tenant (pass a real `GoogleGatewayFactory` + `integrationId` into
`createGmailFetchMessages`). BusinessBroker.net stays proof-shape until a licensed/partner data
feed exists — tracked in `docs/wiki/known-issues.md`. 19/19 dealpilot tests, 40/40 monorepo tasks
green (`turbo run typecheck test`).

---

## 2026-06-24 — Calendar render v1 = in-house (date-fns + Bridge tokens), not react-big-calendar

**Context:** The committed plan picked react-big-calendar (MIT) as the render engine behind a
`CalendarView` boundary. On building P0–P2, two facts shifted the call: (1) the user's explicit
follow-up — "I'll be modifying and customising it a lot and prefer a free modifiable version that
aligns with platform architecture"; (2) the prototype worktree has no `node_modules` and adding
react-big-calendar would require a new dependency install plus restyling its non-Tailwind CSS to the
Bridge design tokens.

**Decision:** Ship v1 of the Calendar surface as a **fully in-house** month/week/day/agenda renderer
built on **date-fns** (already a prototype dependency) + the Bridge design tokens, kept behind a small
view boundary (`CalendarPage` + view components). react-big-calendar remains the **documented swap-in**
if the in-house renderer's customization ceiling is ever hit — the projection + governed-write layers
don't change either way.

**Rationale:** date-fns is already present, so this adds **zero new dependency** and no install/network
risk in worktrees. An in-house renderer is maximally modifiable and design-system-native — exactly the
"free + modify a lot + aligns with platform architecture" the user asked for. The architectural
commitment that mattered (rendering is a swappable layer over an owned projection + governance) is
preserved; only the first adapter changed from a library to in-house code.

**Alternatives rejected:** **react-big-calendar now** — a new dep + CSS restyle burden + a fragile
install in a `node_modules`-less worktree, for a renderer the user intends to heavily customize anyway.
**Schedule-X / FullCalendar** — premium-gated lane views (cost), already rejected. **A headless calendar
lib** (CalendarCN/CalendarKit) — newer/unproven; date-fns hand-rolling is lower-risk and we own every line.

**Consequences / follow-ups:** The `docs/raw/calendar-plan.md` library pick is amended (render = in-house
v1; react-big-calendar = swap-in). Week/day use a simple greedy lane-packing for overlaps (good enough;
revisit if dense days need smarter packing). Recurrence stays deferred — Google expands recurring events
server-side (`singleEvents:true`), so ical.js isn't needed for the GCal-only scope.

---

## 2026-06-24 — Calendar = a projection Tool Bridge owns, not a calendar product/server

**Context:** The user wants an in-app calendar that aggregates Google Calendar (live today),
future conference/event integrations, and — as the platform matures — Rituals, Initiatives, and
Touchpoints, plus team/shared calendars and scheduling once workspaces/teams land. The brief asked
to research open-source options and justify build vs. integrate-on-top-of-OSS vs. custom.

**Decision:** Build a thin **Calendar Tool** Bridge owns, structured as **three layers with three
owners**: (1) **rendering** — adopt OSS behind a `CalendarView` port; (2) **RFC-5545 math**
(recurrence, DST/timezone, ICS parse+generate) — adopt small permissive libs behind
`RecurrenceEngine` / `IcsCodec` ports; (3) **system-of-record + governance** — BUILD on the existing
platform. The calendar is a **time-axis projection over the Unified Graph**: a read-time UNION into a
typed `CalendarEvent` output_contract over GCal `external_records` (already synced on the local plane),
Touchpoints with times, `ritual_runs`, Initiative timelines, and future conference/ICS adapters.
Sync reuses the existing `integrations` + `integration_sync_state` + `external_records` tables;
write-back routes through the Universal Action Pipeline as egress (external writes = `external:send`
= agent-floor DENY = human approval ≥ L2); team/shared calendars are RLS visibility-scoped filters,
not a new ACL system. **Library picks** (all permissive, free, forkable — the user will heavily
customize and will not pay): **react-big-calendar** (MIT, v1.20.0, maintained, drag/resize + built-in
resource columns), **ical.js** (MPL-2.0, recurrence + ICS in one lib), **ical-generator** (MIT, .ics
feed), **Luxon** (timezone). Packaged as a pinnable native Tool at `/calendar` with the manifest in
[calendar-plan.md](calendar-plan.md).

**Rationale:** Bridge's architecture already declares "Calendar = a stateless projection over the one
Touchpoint tree" ([../wiki/initiatives.md], [../wiki/schema.md]) and "new surfaces are Tools that
reuse the pipeline/ledger/contracts/gate — zero new subsystem" ([../wiki/tools.md]). Adopting a
calendar *system* would create a **second source of truth** competing with the graph + pipeline +
RLS + Authority resolver Bridge already owns and proved — the exact thing the platform-first design
exists to prevent. Rendering and recurrence math are solved, undifferentiated, and (recurrence
especially) a notorious bug factory — so adopt there. The projection + governance + pluggable-source
model is the moat — so build there. Putting the render engine behind a port makes the one risky pick
(react-big-calendar's customization ceiling) reversible: swap to headless or another lib without
touching projection/governance. The "new source = new adapter, surface unchanged" property is the
future-proofing the brief asked for.

**Alternatives rejected:**
- **Cal.com** (AGPLv3) — copyleft, banned by the OSS embed policy, and a full scheduling *product*
  that duplicates Bridge's governance. (cal.diy fork is MIT — kept as study-only for *deferred*
  scheduling, license to be re-verified when needed; 2026 signals are conflicting.)
- **CalDAV servers** Radicale / Baïkal (GPL-3.0), Nextcloud (AGPLv3) — copyleft + wrong architecture
  (running a calendar host with its own ACL/storage competes with the graph).
- **FullCalendar / Schedule-X premium** — the resource-timeline "team lane" views are paid commercial
  keys (not copyleft, but cost-averse per the tldraw-SDK precedent, and premium gating fights the
  user's heavy-customization intent). Their MIT standard bundles remain fallback options behind the
  same `CalendarView` port.
- **Hand-rolling recurrence/timezone** — rejected; RFC-5545 + DST + EXDATE is the #1 calendar
  correctness swamp. Adopt ical.js.
- **rrule.js** — the de-facto RRULE lib but last released 2022 (stale); ical.js covers recurrence
  *and* ICS in one dependency, so it wins.

**Consequences / follow-ups:** Commits to building a `CalendarEvent` typed contract + a read-time
projection, and to internalizing react-big-calendar as a forked copy (Tool-model "internal modified
copy") restyled to design-system tokens. Sequences after the local-gate slice + Initiatives P1.
Open: resource-lane view (free react-big-calendar columns vs custom build) decided at P4; whether the
Calendar gets its own agent or reuses the existing egress/intake agents (lean reuse). No code written
yet — P0 (contract + projection skeleton) is build-ready on the user's go.

---

## 2026-06-22 — Agents may never approve a proposal (Approvals are human-only)

**Context:** The Universal Action Pipeline already forces agents to draft
(`requiresApproval` returns true for any agent actor) and floor-denies agent
`external:send`. But `pipeline.decide()` — the act of *resolving* a pending proposal —
ran no authority check on the decider at all. It only checked the proposal was still
pending. So nothing structurally stopped an agent (or an agent-driven request) from
being the approver. The user asked, by analogy to gitignore hiding files from git, for
the Approvals surface to be inaccessible to in-platform agents (the agents users
configure in the Agent tab — not Claude developer agents): draft permission, never send,
and never approve.

**Decision:** Added an `approve` action to the core `Action` type and added it to the
non-removable agent-floor (`AGENT_FLOOR_MUTATIONS`), which already protects the `ledger`
resource. `pipeline.decide()` now takes a `decider: Actor` (resolved server-side) and
calls `agentFloorDeny(decider, "approve", "ledger")` before appending the decision row —
an agent decider is rejected; a human passes. The decider authorizes the call but is NOT
written into the decision row (the row still records the original proposing actor), so
append-only audit semantics and existing ledger assertions are unchanged.

**Rationale:** The floor is the right layer because it is the one rule no grant can
override — exactly the property "agents can never approve" needs. Using the floor (rather
than full `resolveAuthority` with deny-default) keeps humans as approvers by default
without forcing a new `ledger:approve` grant onto every human today; per-human approval
RBAC can layer on later via full authority resolution without reworking this.

**Alternatives rejected:**
- *Full `resolveAuthority(approve, ledger)` for the decider now* — would impose
  deny-default on humans, breaking every existing approve path until approval grants are
  seeded for all approvers. Deferred to a later RBAC pass (layered human roles).
- *Gate only in the UI (hide the Approvals button for agents)* — cosmetic; the API
  remained open. Rejected: the gate must be server-side.

**Consequences / follow-ups:**
- The decider is currently the **server-pinned pilot user** (see next entry), not yet a
  verified per-request identity — tracked in `docs/wiki/known-issues.md`.
- Denied approval *attempts* are not yet written to the ledger (decide throws before the
  append). Logged as a known issue; add an audited-rejection row in the auth-binding pass.
- Verified: `packages/core` 40/40 tests (new invariant "an agent may NEVER resolve a
  proposal" + unit `agentFloorDeny(agent,"approve","ledger")`), `integrations-google`
  3/3.

## 2026-06-22 — Server-resolve the request identity; stop trusting the client's actor

**Context:** `apps/api` established no session. The actor (`user` vs `agent`, the id, the
plane) arrived in the request body, so the deny-default gate was logically sound but the
*identity claim* feeding it was unverified — a crafted request could assert
`actor.type: "user"`. The user chose to build the identity binding now rather than defer.

**Decision:** Added `identity: Actor` to the API context, resolved **server-side**, and
made the Approvals path (`action.decide`) authorize against `ctx.identity` rather than any
client-supplied actor. First slice: identity is pinned to the single pilot user
(`wiring.pilotUserId`, overridable via `BRIDGE_PILOT_USER_ID`). The Supabase-JWT
verification seam (read bearer token → derive the real user) is the remaining work.

**Rationale:** Even pinned, a server-*chosen* decider closes the immediate hole for
approvals: the client can no longer claim to be a human approver. It is a strict
improvement deliverable in one slice, with the cryptographic verification layered on next
without changing the call sites that already read `ctx.identity`.

**Alternatives rejected:**
- *Defer all identity work* — the user explicitly chose to start now.
- *Add Supabase JWT verification in the same slice* — needs Supabase URL/JWT-secret env
  wired into the local-plane API (which today runs without `DATABASE_URL` by design) plus
  a verify dependency; sequenced as the next step to keep this change verifiable.

**Consequences / follow-ups:**
- `propose` still accepts the client actor for non-decide paths (ritual/tool/intake run
  as configured agents). Binding the *human* actor on propose, and constraining
  client-chosen agent actors, is part of the same auth task. Tracked in known-issues.

## 2026-06-22 — Hard-purge all dummy data from the platform (tests require live creds)

**Context:** The platform carried `dummy_`-prefixed data in three buckets: test fixtures,
the `FakeGoogleGateway` runtime fallback (used when no Google creds), and structural seed
constants (pilot workspace/agent/user UUIDs). The user directed: remove ALL dummy data;
retain only real data — the most literal reading, accepting that tests then require live
creds and there is no zero-infra dev fallback.

**Decision (planned, not yet executed):** Remove `FakeGoogleGateway` and the dummy_
fixtures; require the real `GoogleApiGateway` (no fake fallback in `wiring`); rename the
`DEMO_USER` pilot identity to a real pilot identity; convert or gate the tests that
depended on dummy fixtures so they require live creds (skip when absent) instead of
shipping fabricated data.

**Rationale:** User decision is explicit and is the strongest guarantee that nothing
fabricated can ever be mistaken for real data or surface to the UI/DB.

**Alternatives rejected (the options offered):**
- *Runtime-only purge* (keep test fixtures, make the fake opt-in) — not chosen.
- *UI-surface-only purge* — not chosen.

**Consequences / follow-ups:**
- CI/local dev cannot run the Google flows without live Google creds. The conformance
  suite that exercised the gate via the fake gateway must be re-expressed against either a
  live account or a non-dummy test double, or marked live-only.
- Structural UUIDs must be replaced with real pilot identities, not deleted (the system
  cannot run without an identity/workspace).

## ADR-006 — Full monorepo convergence + internal/external tool taxonomy (2026-07-03)

**Context:** Repo held 5 separate frontend apps (prototype SPA, recon, hni, card-scanner,
recorder) + platform/. Recon stranded (manifest + intake button wired to nothing, parallel
staging.jsonl governance); 3 unlinked tool-registration systems; Helpdesk living as prototype
pages (predates tool model — no slot for UI-surface tools). Two new tools specced (JobPilot,
DealPilot — specs ingested to docs/raw as requirement docs) each proposing their OWN full stack,
which would create apps #6/#7 and re-implement sourcing/dedupe/enrichment/tables a 5th time.

**Decision (user-locked):** (a) Grow `platform/` into the SINGLE monorepo home — apps/web +
apps/api + packages (tool-kit, tables, sourcing, dedupe, facts, llm, extraction) + tools/*;
no new code outside it. (b) Tool taxonomy: **internal tools** = headless capabilities
(people-sourcing, company-sourcing, enrichment, recorder, …) vs **external tools** = UI surfaces
(Helpdesk, DealPilot, JobPilot, Conference…) that declare `composes:[internal ids]`.
(c) Recon splits into people-sourcing + company-sourcing internal tools; staging.jsonl retired
through the one intake seam. (d) Integrations are platform-level only — tools never own OAuth;
capability grants via the Authority resolver. (e) Build order: engine → internal tools →
**DealPilot first** → JobPilot + Helpdesk migration → absorb prototype.

**Rationale:** One unified engine that strengthens with use; every duplicated capability
(waterfall sourcing ×5, tables ×4, review queues ×3) becomes one package with one test surface;
governance stays single-spine (all tool approvals = pipeline proposals).

**Alternatives rejected:** shared-packages-but-keep-apps (duplication of app shells remains,
integration still per-app); unify-new-tools-only (recon/hni/helpdesk debt persists and taxonomy
stays split). Building JobPilot/DealPilot per their standalone architecture docs (FastAPI+SQLite;
Next.js+Supabase+Trigger.dev) rejected — deviations recorded in the plan: Hatchet/BullMQ over
Trigger.dev, local plane over SQLite, pipeline over bespoke review queues, Python only as
sidecars behind ports.

**Consequences:** migration phases 0–5 in raw/tool-standardization-plan.md; prototype folder
eventually retires; Tools/* standalone apps frozen then deleted post-extraction; short-term
overhead maintaining the prototype bridge inside apps/web during migration.
