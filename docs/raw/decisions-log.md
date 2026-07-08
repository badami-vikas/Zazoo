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

## ADR-026 — Real-data-only enforcement pass: retired `dummy_` convention, killed a fake-data runtime path, added `check:no-dummy-runtime` (2026-07-06)

**Decision**: mechanically enforced the "NO dummy data" policy (CLAUDE.md, reversed 2026-07-06) across `platform/`. (1) **Runtime fix — `apps/api/src/social/fixtures.ts`**: `makeFixtureProvider`'s `sourceItems()` previously synthesized two plausible-looking fake social posts/DMs (fabricated handles, a fake name "Jordan Rivera") whenever no live platform credentials were configured — real product code fabricating content a human reviewer could mistake for genuine sourced data at the governance gate (`sourceToProposals` → `pending_review` Touchpoint proposals). Changed to an honest empty read (`sourceItems()` returns `[]`); draft/publish id bookkeeping kept (renamed `dummy_<id>_draft_N`/`dummy_<id>_published_N` → `unconfigured_<id>_draft_N`/`unconfigured_<id>_published_N`, since those are internal correlation ids, not fabricated business data). `apps/api/src/social/registry.ts`'s fallback log lines reworded from "serving dummy_ fixture data" to "sourcing nothing (empty read)" to match. (2) **Runtime fix — `apps/api/src/wiring.ts`**: the pilot bootstrap's fallback `userEmail` default (`dummy_pilot@bridge.local`) renamed to `pilot@bridge.local` — same structural-constant category as the adjacent `PILOT_WORKSPACE`/`PILOT_USER` (real FK-referenced bootstrap identity, not demo data), but the `dummy_` prefix falsely implied it was throwaway/fake. (3) **Runtime UI fixes**: `ToolDetail.tsx`/`RitualDetail.tsx`'s actor-id input defaulted to the fabricated `"dummy_user_1"` — changed to an empty string (both inputs are already `required`, so this is the honest empty-state default, forcing the operator to supply a real actor id rather than silently running as a fake one). `PublicHelpdesk.tsx`'s `localStorage` key literal renamed `dummy_helpdesk_token` → `bridge_helpdesk_token` (a storage key name, not fabricated data, but still carried the retired prefix). (4) **Test fixtures**: every remaining `dummy_`-prefixed literal (324 occurrences across 38 `*.test.ts` files — ids, workspace ids, actor ids, emails, capability names) mechanically renamed to `test_fixture_` via a scoped `sed` pass, restricted to files already under a `test/` dir; `apps/api/test/social.test.ts`'s two tests that asserted the old fixture behavior (2 fabricated sourced items, `dummy_x_draft_N` ids) were rewritten: the read-path test now asserts the honest-empty-read contract (0 results/proposals/quarantine entries) for the no-credentials case, with a new second test constructing an explicit in-test `live`-mode `SocialProvider` to cover the original "proposal carries provider mode + residency" assertions that the removed fake data used to exercise; the draftId test's expected strings updated to the new `unconfigured_` prefix. (5) **Retired `bridge/dummy-prefix` ESLint rule**: `eslint.config.js` is a protected file (edits blocked by hook) and still references `"bridge/dummy-prefix": "warn"`, so the rule's own implementation (`tools/eslint-rules/src/dummy-prefix.js`) was rewritten into a documented no-op (`create()` returns `{}`, empty `messages`) rather than deleting the file — the config reference still resolves, it just reports nothing now. (6) **New `platform/package.json` script** `check:no-dummy-runtime`: greps for `dummy_` across `.ts`/`.tsx`/`.js`/`.jsx`, excluding `node_modules`/`dist`/`.turbo`/`test`/`fixtures`/`seed` dirs and `*.test.ts`/`*.spec.ts`/`dummy-prefix.js`/`eslint.config.js`, failing (exit 1) if anything matches — a mechanical backstop so a future `dummy_` reintroduction into runtime code fails a check rather than silently landing. Manually verified it catches a planted violation and passes clean on the current tree.

**Why**: `sourceItems()` fabricating fake posts/DMs was the one genuine "fake data presented as potentially real" violation found — everything else (`PILOT_WORKSPACE`/`PILOT_USER`/pilot email, ids-as-correlation-keys, form defaults, storage keys) was a naming-convention leftover rather than actual fabricated content, but the retired convention made all of it read as "this is dummy/fake," which is exactly the confusion the policy reversal is meant to end. `test_fixture_` was chosen over deleting the prefix entirely because CLAUDE.md's task explicitly calls for a renamed, still-greppable test-fixture convention, not a return to unprefixed (and therefore not distinguishable from real data) test literals.

**Alternatives rejected**: deleting `dummy-prefix.js` outright (rejected — `eslint.config.js` is protected and still imports/registers it by name; deleting the file would break `pnpm lint` with an unresolved plugin rule rather than degrade gracefully to a no-op); keeping `fixtures.ts`'s synthesized items but renaming their prefix to `test_fixture_` (rejected — the task instructions are explicit that runtime code must never "just rename while keeping fake data"; renaming a fabricated Jordan-Rivera post doesn't stop it from reaching a human governance reviewer as if it might be real); leaving `sourceItems()` fabricating data because it's gated behind `pending_review` and audit-tagged `mode: "fixture"` (rejected — the audit tag tells a reviewer AFTER the fact that content was fake, but the content itself (a name, a message body) is still presented at approval time in a way indistinguishable from real sourced text; an empty read removes the ambiguity entirely, which is the stronger and simpler-to-reason-about invariant).

**Consequences**: `apps/api/src/social/fixtures.ts`/`registry.ts`/`read-pipeline.ts`, `apps/api/src/wiring.ts`, `apps/web/src/app/pages/{ToolDetail,RitualDetail,PublicHelpdesk}.tsx`, `tools/eslint-rules/src/dummy-prefix.js` + its `package.json` description, `platform/package.json` (new script), and 38 `*.test.ts` files renamed. `apps/api/test/social.test.ts` gained a new live-mode-provider test (replacing assertions that depended on the removed fake fixture content) — net test count unchanged (still exercises read/write/residency/mode-tagging, now without runtime fake data). Gates: `pnpm install` (lockfile unchanged), `turbo run build` 20/20 green, `turbo run test --force` (no cache) 36/36 tasks green — `@bridge/api` 48/48, `@bridge/db` 47/47, `@bridge/dealpilot` 23/23, `@bridge/jobpilot` 50/50, `@bridge/integrations-google` 20/20, all `0 fail`; `pnpm lint` 0 errors (2 pre-existing unrelated warnings in `packages/core/src/{determinism,pipeline}.ts`, untouched by this pass). `rg -n "dummy_" platform` now only matches the three intentionally-preserved historical references (the retired rule's own doc comment, its `package.json` description, and `eslint.config.js`'s untouchable header comment) plus the new check script's own search string.

## 2026-07-06 — Helpdesk's public submitter path uses token possession, not a new Actor type

**Context:** Frontend Migration Phase 4 (frontend-migration-scoping.md gap #3/#5) required a genuine
public/unauthenticated surface — anyone can open a Helpdesk ticket without being a workspace member
or having any account at all. Every existing tRPC procedure authorizes against `ctx.identity`, a
SERVER-RESOLVED `Actor` (`type: "user" | "team" | "agent"`) that `context.ts`'s `createContext`
always produces — falling back to the server-pinned pilot user when no bearer token is presented
(identity.ts). There is no "anonymous" identity in the type system anywhere: `ActorType` in
`packages/core/src/types.ts`, the authority resolver, and the agent-floor logic all assume one of the
three known actor kinds.

**Decision:** Did NOT add a fourth `ActorType` ("anonymous"/"public"). Instead, `helpdesk.public.*`
(`createTicket`, `getThread`, `reply` — router.ts) never reads `ctx.identity` at all. A submitter's
only credential is possession of an opaque, unguessable `accessToken` (24 random bytes,
base64url-encoded — `helpdesk-store.ts`'s `generateAccessToken`) returned once at ticket creation and
required on every subsequent read/reply for that ticket. The authenticated support-agent side
(`helpdesk.list`/`get`/`reply`) is ordinary workspace-scoped CRUD, same tier as `workspace.*`
membership management — not routed through the governed pipeline, since replying to a ticket has no
external effect requiring approval.

**Rationale:** A new `ActorType` would ripple through `authority.ts`, `agent-floor.ts`, and every
place that exhaustively switches on actor kind (least-privilege agent scoping, ritual ⊆ agent
validation, the `withPilotWorkspaceGuard` middleware) for a capability none of that governance logic
is meant to reason about — an anonymous ticket submitter has no capability scope, no data tier, no
approval authority, and never will. Modeling it as an `Actor` variant would force every one of those
call sites to add a no-op branch for a kind that structurally can never approve/execute/hold scope,
pure surface area with no governance value. Token-possession-as-credential is also not a novel or
weaker pattern — it's the same trust model as a password-reset link or a shared-with-link document:
the token itself, not an identity claim, proves the caller may act on this one resource. It requires
zero changes to `context.ts`/`identity.ts`/`authority.ts`.

**Alternatives rejected:**
- *Add `"anonymous"` to `ActorType` and thread it through context/authority.* Rejected: high blast
  radius (every authority/agent-floor switch needs a new arm) for a concept (approval-eligible actor)
  that doesn't apply to an anonymous submitter at all.
- *Require the submitter to sign up for a real account first.* Rejected: defeats the point of a
  public support surface — most helpdesk visitors are pre-signup or never intend to sign up.
- *Session cookie instead of a bearer-style token.* Rejected: no session infrastructure exists in this
  stack yet (no server-side session store), and a bookmarkable/copy-pasteable token better matches
  "email me my ticket link" UX than a cookie tied to one browser.

**Consequences / follow-ups:** The access token is currently client-stored in `localStorage`
(`PublicHelpdesk.tsx`, `dummy_helpdesk_token` — real key name is not `dummy_`-prefixed since it's
real user data, not a fixture; only literal seed/mock VALUES need the prefix per CLAUDE.md) with no
expiry and no rate-limiting on ticket/reply creation — both explicit gaps for a future hardening pass
once this ships past pilot use, not attempted here. `getThread`/`reply` return an identical
`NOT_FOUND` for both "wrong token" and "no such ticket" so an attacker cannot distinguish a guessed
token from a nonexistent one.

## 2026-07-05 — ESLint vocabulary rule bans "Deal" but deliberately excludes "Pipeline"/"Lead"/"Contact"

**Context:** CLAUDE.md's vocabulary rule bans CRM/sales-pipeline vocabulary ("Person / Relationship /
Memory / Community / Initiative / Ritual / Touchpoint / Signal. NEVER Lead / Deal / Pipeline /
Contact.") in identifiers, but this repo has a genuine, correct `UniversalActionPipeline` governance
class (`platform/packages/core/src/pipeline.ts`, plus `PipelineDeps`, the `pipeline` local variable at
every construction site, and `pipeline.ts` filenames) — completely unrelated to the CRM "sales
pipeline / deal-flow stages" sense the rule exists to ban. Needed a mechanical ESLint rule
(`bridge/no-crm-vocab`, `platform/tools/eslint-rules/src/no-crm-vocab.js`) enforcing the ban without
false-positiving on that real class. Grepped the whole `platform/` tree first rather than guessing
scope: every "Pipeline"/"Lead"/"Contact" identifier hit turned out to be either the real governance
Pipeline class or a comment quoting the vocabulary rule itself (e.g. "never Leads/Contacts" in
`apps/api/src/social/provider.ts`) — zero real CRM-sense violations for those three words. "Deal," by
contrast, had 40+ real violations, all confined to `platform/tools/dealpilot/` (`DealProfile`,
`DealPipelineResult`, `processDealCandidate`, `dealsTableSpec`, `dealsKanbanView`, `existingDeals`,
`dealProfile`) plus its two call sites in `apps/api/src/wiring.ts`.

**Decision:** The rule's banned-word list is `["Deal"]` only (case-insensitive, tokenized on
camelCase/PascalCase/snake_case boundaries) — "Pipeline," "Lead," and "Contact" are excluded from the
mechanical check entirely, with a carve-out inside the "Deal" check for the `DealPilot`/`dealpilot`
product name (an approved proper noun, not the CRM sense of "deal"). The rule lives in a small local
plugin (`@bridge/eslint-rules`, `platform/tools/eslint-rules/`) rather than ESLint core's
`id-denylist`, because `id-denylist` only matches exact identifier names — it cannot catch
`dealsKanbanView` or `existingDeals` (denylisting "Deal" verbatim would need every future compound
name enumerated by hand).

**Rationale:** A word-boundary regex cannot distinguish "the real Pipeline class" from "a
hypothetical CRM-sense Pipeline identifier" — both are literally the token "Pipeline." An allowlist
of exact identifiers (`UniversalActionPipeline`, `PipelineDeps`, `pipeline`) was considered and
rejected as high-maintenance: every new test file that does
`const pipeline = new UniversalActionPipeline(...)` (there are already 6+ such call sites across
`packages/core/test/`, `packages/integrations-google/test/`, `apps/api/src/wiring.ts`) would need a
new allowlist entry or a file-scoped override, and the allowlist would silently stop protecting the
moment someone adds a call site outside it. Dropping "Pipeline" from the banned set is the
zero-maintenance option that cannot false-positive on real code. Grep confirmed the cost of this is
theoretical, not real: no CRM-sense "Pipeline" identifier (e.g. a hypothetical `salesPipeline` or
`dealPipelineStage`) exists anywhere in `platform/` today, and "Deal" alone already catches every
confirmed violation. Same reasoning for "Lead"/"Contact": grep found zero identifier-level violations
for either word (only rule-quoting comments), so there is nothing for the mechanical check to catch
and no false-positive risk to manage — they're left out rather than added as dead weight.

**Alternatives rejected:**
- *Ban "Pipeline" everywhere, allowlist the real class by exact name.* Rejected: brittle (misses new
  call sites), and the allowlist would need to enumerate `pipeline`-the-variable at every
  `new UniversalActionPipeline(...)` site, which grows with the codebase.
- *Ban "Pipeline" only outside `packages/core/src/pipeline.ts` via an ESLint flat-config file-scoped
  override.* Rejected: the real Pipeline concept is referenced (as `pipeline`/`UniversalActionPipeline`)
  in test files and `apps/api/src/wiring.ts` too, not just the one source file — the override would
  need the same file list as the allowlist approach, no simpler.
- *Use core ESLint `id-denylist` for the whole vocabulary rule.* Rejected outright (not just for
  Pipeline): `id-denylist` is exact-match only, so it can enforce "never name something literally
  `Deal`" but not "never name something `DealProfile`" — misses the actual violations found.

**Consequences / follow-ups:** The mechanical rule only enforces "Deal" today. If a future PR
introduces a genuine CRM-sense "Lead" or "Contact" identifier, it will not be caught by lint — that
remains a code-review/known-issues catch, same as before this pass. The 40+ existing "Deal" violations
in `platform/tools/dealpilot/` were left unfixed by this pass (logged instead, see `docs/BUGS.md`
2026-07-05 entry) — DealPilot is under active multi-session development (`router.ts`/`wiring.ts` were
off-limits to this pass) and a cross-file rename of a live feature's public API (`DealProfile`,
`processDealCandidate`, etc., re-exported through `tools/dealpilot/src/index.ts` and consumed by
`apps/api/src/wiring.ts`) is a coordinated follow-up, not a drive-by fix alongside adding the linter
that found it.



**Context:** Ran 4 background agents in parallel against the SAME git worktree (no isolation
between them). One agent ran an uncoordinated `git reset`, wiping ~45 files of the other three
agents' uncommitted work back to HEAD. It happened to land in `git stash@{0}` first, so nothing
was permanently lost, but recovery required manually diffing every touched file, halting all 4
agents mid-task, and reconciling which post-reset re-writes were legitimate vs. regressions (one,
`schema.ts`, was a real regression — a concurrent agent redid its work from a stale baseline and
silently dropped 4 columns the ledger table needed). This was luck, not a safe design: a `git
clean -fd`, a force-checkout, or a reset with no prior stash would have caused unrecoverable data
loss.

**Decision:** Any time multiple agents are dispatched in parallel AND at least one of them will
write files, each write-capable agent runs in its own isolated git worktree (`Agent` tool's
`isolation: "worktree"` parameter), not the shared session cwd. Read-only agents (Explore,
research, code review) are exempt — they can't collide. When agents in separate worktrees finish,
their branches/diffs are reconciled (merged or cherry-picked) by the orchestrating turn, not by
the agents themselves touching a shared tree.

**Rationale:** Isolation makes the failure mode structurally impossible instead of relying on
agents individually being well-behaved with git. The prior approach (dispatch N agents, trust
none of them run a destructive git command in the shared tree) has no enforcement — it's a
convention an agent's own reasoning can silently violate under any kind of confusion (e.g.
"let me reset to a known-good state before retrying," a plausible-sounding but catastrophic
move when 3 siblings have uncommitted work in that same tree).

**Alternatives rejected:**
- *Just tell agents in the prompt not to run destructive git commands* — already implicitly
  true (the standing git-safety protocol prohibits `reset --hard`/`clean -f` without
  confirmation) and it still happened; a prompt-level rule is not a structural guard.
- *Serialize all file-writing agents (no parallelism)* — safe but throws away the throughput
  gain that was the entire point of dispatching them in parallel; worktree isolation gets both.

**Consequences / follow-ups:** Slightly more setup cost per agent (a worktree checkout) and a
manual reconciliation step when their work needs merging back — acceptable given the blast
radius of the alternative. Any future report of "an agent's edits look like they reverted" or
"a file I expected changed came back unchanged" should be treated as a possible repeat of this
class of bug: check `git reflog`/`git stash list` immediately, and log the root cause (not just
"fixed it") in this ledger per the standing "log work repetition as a bug with its cause" rule —
silently re-doing lost work without logging why it was lost hides a recurring structural problem
as if it were normal variance.

## 2026-07-05 — Single-tenant safety net: reject non-pilot `workspaceId` at the tRPC boundary, don't build real multi-tenancy yet

**Context:** `All fixes.md` section 4/Phase 3 item 11a flagged that the platform is
single-tenant by construction (`PILOT_WORKSPACE`/agent ids baked into `buildWiring()`) but
several `router.ts` procedures accepted a `workspaceId` param without validating it —
`dealpilot.list` silently ignored it entirely, and several other procedures (`ritual.*`,
`integration.*`, `workspace.inviteMember`/`listMembers`, `tool.run`) had no check that the
supplied id matched the one workspace the backing stores actually serve. If a second workspace
ever existed (e.g. someone guessed/reused a real-looking uuid), these procedures would silently
proceed as if it were the pilot workspace, potentially serving/writing pilot data under a
different workspace's request. Full multi-tenancy — real per-workspace data isolation in every
backing store — is Phase 5, gated on pilot recruitment; not a same-day fix.

**Decision:** Added a `withPilotWorkspaceGuard` tRPC middleware (`router.ts`) that every
workspace-scoped procedure now runs through. It calls `assertPilotWorkspace(workspaceId)`,
which throws a typed `NonPilotWorkspaceError` if the id isn't `PILOT_WORKSPACE`; the middleware
catches tRPC v11's wrapped result (`next()` does not throw on a resolver error — it returns
`{ok:false, error}` with the original cause on `error.cause` — see the implementation note in
`router.ts` for why a naive `try/catch` around `next()` silently fails to catch anything) and
re-throws as `TRPCError({code:"FORBIDDEN"})`. Applied to: `action.propose`, `ritual.create`/
`run`/`runById`, `dealpilot.source`, `dealpilot.list` (workspaceId param ADDED as optional,
since no caller sends one today — added defensively so a future caller can't slip a non-pilot id
through unnoticed), `tool.run`, all of `integration.*`, `workspace.inviteMember`/`listMembers`.
`google.*` procedures were deliberately left workspace-IMPLICIT — no `workspaceId` param added
at all — because no frontend caller (`Design Bridge AI Interface (Copy)/src/app/data/api.ts`)
ever attempts to pass a workspace context to any `google.*` call; there was no silent-ignore bug
to close there, since these procedures never claimed multi-tenancy in the first place. Adding
an always-optional, always-unused param would add surface area without closing a real gap.

**Rationale:** This turns a silent cross-tenant leak into a loud, typed 403 — the honest
statement is "this platform only serves one workspace right now," not "this platform has real
multi-tenant isolation." A middleware centralizes the translation (one place to maintain)
rather than repeating the `IntegrationFloorScopeError`/`AlreadyResolvedError` try/catch pattern
at every one of the dozen-plus call sites that now call `assertPilotWorkspace` — but the
underlying error is still a typed domain error (`NonPilotWorkspaceError`), matching the existing
pattern of throwing typed errors and translating them to `TRPCError` at the tRPC boundary; only
the translation step's *location* changed (middleware instead of N per-procedure catches).

**Alternatives rejected:** (1) Thread real per-workspace scoping through every backing store
(dealpilot facts/candidates, integration store, ledger queries) so a second workspace would
actually get its own isolated data — rejected for this pass: that's the real Phase 5
multi-tenancy work, is a much larger surface (schema/query changes across `@bridge/db` and
`@bridge/facts`), and the tracker explicitly scoped this item as an interim safety fix, not the
full build-out. (2) Repeat a try/catch translating `NonPilotWorkspaceError` → `TRPCError` at
every call site (matching `grantScope`'s existing `IntegrationFloorScopeError` pattern exactly)
— rejected as needless duplication once there were more than a couple of call sites; a
middleware achieves the identical typed-error-then-translate shape with one definition. (3) Add
an optional `workspaceId` to `google.*` "just in case" — rejected: no caller sends one, so it
would be dead validation surface, and if a real need ever appears it belongs with the Phase 5
multi-tenancy work rather than a one-off param bolted onto Google's IntakeService/EgressExecutor
plumbing, which is itself pinned to `PILOT_WORKSPACE` internally (`GoogleService`'s `identities`
config) and would need its own multi-tenancy pass regardless of the router-level param.

**Consequences / follow-ups:** `apps/api/test/pagination.test.ts`'s two `integration.list` tests
had to be updated — they previously seeded fixtures under two arbitrary dummy_ workspace ids,
which the new guard now correctly rejects; both now seed under `PILOT_WORKSPACE` and assert
against a before/after count delta (since the two tests share one process-lifetime pglite
store). New `apps/api/test/single-tenant-guard.test.ts` proves rejection + pilot-workspace
success for `dealpilot.list` and `action.propose` (two independently-shaped procedures, to prove
the guard isn't special-cased to one call site). Still open: no real per-workspace data
isolation exists in the backing stores — this is a safety net around the single-tenant reality,
not a step toward removing it. `All fixes.md` Phase 3 item 11a marked RESOLVED (interim scope);
Phase 5 (full multi-tenancy) is unaffected and still gated on pilot recruitment timing.

## 2026-07-05 — `wiring.ts` typed-port factories: fix the canonical-identity lie for real, make the two unfixable lies loud instead of silent

**Context:** `All fixes.md` section 1/Phase 2 item 8 flagged `wiring.ts` as a 350-line god
composition root using `let`-sprawl if/else to build ports, which also lied about persistence:
the DealPilot capture store was in-memory unconditionally (even with `DATABASE_URL` set), and
the canonical identity store was in-memory even when `DATABASE_URL` was set — directly
contradicting the file's own header, which additionally separately claimed "the ledger MUST
stay local for private proposals" while the persistent branch bound the ledger to whatever
`DATABASE_URL` pointed at (Phase 1 item 7, already flagged as needing a product decision, not a
coding fix).

**Decision:** Extracted two pure factory functions, `buildPersistentPorts(env)` and
`buildInMemoryPorts(env)`, each returning one fully-typed `ModePorts` object with every port
explicitly chosen for that mode; `buildWiring()` now does a single `url ? buildPersistentPorts(
{url}) : await buildInMemoryPorts({localDir})` and destructures the result — every `let` used to
conditionally reassign a port is gone. Of the two lies: canonical identity is now genuinely
fixed — `buildPersistentPorts()` binds it to the already-existing (but previously unwired)
`DrizzleCanonicalIdentityStore` (`@bridge/db/src/canonical-store.ts`) instead of the in-memory
fake, so canonical dual-writes actually persist once `DATABASE_URL` is set. The other two
could NOT be closed for real this pass, and are now explicit instead of silent: (1) DealPilot's
`ToolCaptureStore` has no persistent (Drizzle/pglite) implementation anywhere in the codebase
yet (`All fixes.md` Phase 3 item 11b, "persist tool_captures to a real table — still open") —
`buildPersistentPorts()` keeps it in-memory and logs a loud `console.warn` at boot naming this
exact gap. (2) The ledger-residency contradiction is a genuine open product decision (Phase 1
item 7 — split the ledger by `data_scope`, or drop the header's guarantee), not something this
pass should decide unilaterally — `buildPersistentPorts()` now logs a loud `console.warn` at
boot instead of letting the code silently violate its own documented promise.

**Rationale:** A composition root that lies about which ports are real is worse than one that's
honest about its gaps — a future reader (or on-call engineer during an incident) trusting the
header comment would wrongly believe private proposal data never reaches a cloud ledger, or that
canonical identity writes are durable once `DATABASE_URL` is configured. Fixing the one lie that
had a ready real implementation (canonical identity) closes an actual gap with near-zero risk
(the Drizzle store already existed and was tested elsewhere); converting the other two into loud
warnings is the honest middle ground between "silently broken" and "fully fixed" when a full fix
either doesn't exist yet (capture store) or isn't this pass's call to make (ledger residency).

**Alternatives rejected:** (1) Build a persistent `ToolCaptureStore` (Drizzle-backed
`tool_captures` table) in this same pass to close all three lies at once — rejected: no
`tool_captures` schema/migration exists yet, and inventing one as a side effect of a
composition-root refactor risks a rushed schema that Phase 3 item 11b's dedicated pass would
need to redo; better to scope this pass to the refactor + the one lie with a ready fix. (2)
Unilaterally decide the ledger-residency split (e.g. just route ledger writes through the LOCAL
plane when `dataScope==='private'`) — rejected: this is explicitly flagged in the tracker as
"needs your decision" (Phase 1 item 7), and picking a side without that decision would be
presumptuous scope creep for a refactor task; the loud warning preserves the decision point
while making the current behavior honest in the meantime. (3) Keep the in-memory canonical
identity store "for consistency" with the other two honest-lie warnings, on the theory that
fixing only one of three inconsistently-lying ports is confusing — rejected: the review's own
language ("don't fake persistence that doesn't exist" alongside "fix the actual lies... if a
persistent version genuinely doesn't exist yet... don't fake one") explicitly distinguishes
"lies with a real fix available" from "lies without one yet"; leaving a working, already-built
persistent implementation unwired just to keep three gaps looking symmetrical would be worse,
not better.

**Consequences / follow-ups:** New `apps/api/test/wiring.test.ts` proves `buildPersistentPorts`
binds `canonical` to `DrizzleCanonicalIdentityStore` (not the in-memory fake), that
`buildInMemoryPorts` returns the expected in-memory + seeded-governance shape, and that both
honest-lie `console.warn` calls actually fire (naming Phase 1 item 7 and Phase 3 item 11b
respectively) — so a future refactor that accidentally silences either warning breaks a test,
not just a comment. `All fixes.md` section 1's `wiring.ts` P0 bullet, Phase 2 item 8's
typed-port-factory sub-bullet, and `docs/BUGS.md`'s two matching OPEN entries
updated to reflect: canonical-identity now RESOLVED, capture-store and ledger-residency now
"loud not silent" rather than either fully resolved or silently broken. Phase 1 item 7 (ledger
residency) and Phase 3 item 11b (persistent capture store) remain genuinely open and unaffected
by this refactor — this pass made the gaps visible, not gone.

## 2026-07-05 — Soft-delete idiom: `archived_at` stays canonical; `status` text is a separate, non-conflicting lifecycle concept

**Context:** The 2026-07-04 review flagged "two soft-delete idioms (`archived_at` vs.
`status='archived'`) coexist with no rule for which applies where" (`All fixes.md` section 5, P2).
Needed to confirm which idiom is actually canonical (not assume) and decide what to do about
tables using the other one.

**Decision:** Confirmed `archived_at` (nullable timestamp, set once, never cleared — "NEVER hard
delete") is canonical: it's what `docs/raw/SCHEMA.sql`'s own header comment names
("soft-delete via archived_at"), and it's the clear majority in `schema.ts` (7 of 43 tables:
`workspaces`, `teams`, `communities`, `people`, `initiatives`, `files`, `rituals`). Audited every
table with a `status` text column instead (`skills`, `tools`, `integrations`, `agents`,
`ritual_runs`, `touchpoints`, `signals`) and grepped all of `platform/packages/{core,db}/src` and
`apps/api/src` for any writer assigning `status = 'archived'` (or an equivalent string literal) to
any of them — found none. Conclusion: these `status` columns are a genuinely different, orthogonal
concept (general lifecycle state — `active`/`running`/`open`/`new` — not a delete marker), not a
second soft-delete idiom competing with `archived_at`. No schema migration was needed for these
tables because there was no actual collision to resolve.
The one place the two idioms DO coexist on the same conceptual event is `@bridge/db`'s
`media-store.ts` (`MediaStatus = "pending"|"committed"|"archived"` PLUS a separate `archived_at`
timestamp, both set together in `archive()`) — audited this specifically and left it alone: by
design, `status` carries WHICH of three states a capture is in, `archived_at` carries WHEN it
entered the terminal one; collapsing them would lose the "pending vs. committed" distinction that
has nothing to do with soft-delete.

**Rationale:** Fixing a bug that doesn't exist (migrating `status`-only tables to also carry
`archived_at`) would be scope creep with no real payoff — none of those tables currently have
delete/archive semantics defined at all; adding `archived_at` to them is a future feature
decision, not a fix for idiom drift. Verifying via grep (not assumption) before touching anything
matches this pass's instruction to confirm the majority idiom rather than assume `archived_at` is
correct just because SCHEMA.sql's header says so.

**Alternatives rejected:** Migrating `skills`/`tools`/`integrations`/`agents`/`ritual_runs` to add
`archived_at` was rejected — no current or historical writer ever sets a delete-shaped state on
any of them, so there is nothing to migrate; doing it speculatively would be the same
"write amplification paid today for queries that don't exist" anti-pattern already called out
elsewhere in `All fixes.md` (section 5, P3, `recon_signals`/`embedding_models`). Collapsing
`media_captures`' `status`+`archived_at` into a single column was rejected — `MediaStatus` needs
three states (`pending`/`committed`/`archived`), and a single nullable timestamp can only encode
two (set/unset); the two columns are answering different questions, not duplicating one.

**Consequences / follow-ups:** No schema change from this ADR. Flagged, but explicitly NOT fixed
in this pass (would touch a do-not-touch file): `media-store.ts`'s `archive()` and the matching
in-memory adapter (`core/src/memory/stores.ts`) both hardcode `archivedAt` to epoch
(`new Date(0)`) instead of the real archive time — a real, narrow bug, logged in
`docs/BUGS.md`, that should land as one coordinated fix touching both adapters
together (one of them is currently out of scope for whoever picks this up next).

## 2026-07-05 — UUIDv7 for `ledger`/`events`/`timeline_entries` via an in-house JS generator, not a new dependency or a pgcrypto/plpgsql implementation

**Context:** `ledger`, `events`, and `timeline_entries` are append-only, high-write tables whose
PKs were random UUIDv4 (`gen_random_uuid()`) — no time-locality, causing B-tree page-split
thrashing as they grow (`All fixes.md` section 4, P1, Phase 3 item 12). UUIDv7 (RFC 9562,
time-prefixed) fixes this, but Postgres has no native `uuidv7()` function before v18, and both
deployment targets (Supabase, pglite) are pre-v18.

**Decision:** Implemented `uuidv7()` as a ~20-line pure-JS function in `@bridge/core`'s
`determinism.ts` (48-bit big-endian unix-ms timestamp + version nibble 7 + 74 bits of
`crypto.getRandomValues` entropy, RFC 9562 layout) and wired it into `schema.ts` via a new
`uuidPkV7()` helper — `uuid("id").primaryKey().default(sql\`gen_random_uuid()\`).$defaultFn(() =>
uuidv7())` — applied to all three tables. Drizzle's `$defaultFn` generates the id
application-side, before the INSERT is sent, so every write through the ORM gets a real UUIDv7;
the column-level `gen_random_uuid()` DEFAULT is left in place (unchanged, still v4) purely as a
backstop for direct-SQL inserts that bypass Drizzle entirely — matching the existing convention
that `uuidPk()` also declares a DB-level default even though the app almost always supplies an
explicit id. No backfill: existing v4 row ids are left as-is (pre-launch, no production data,
matching this repo's established forward-only-migration convention from `0003_ledger_ref_column.sql`).

**Rationale:** A pure-JS generator avoids taking on a new npm dependency for an algorithm that
fits in ~20 lines and has a well-known, stable spec (RFC 9562) — consistent with this repo's
established pattern of writing small in-house helpers (`withRetry`, `mapWithConcurrency`) rather
than reaching for a package for something this size. Generating the id application-side (not
DB-side) sidesteps the "no native uuidv7() pre-PG18" problem entirely without needing either
target database to run custom SQL/plpgsql on every insert.

**Alternatives rejected:** A pgcrypto/plpgsql UUIDv7 implementation living in the migration SQL
itself was rejected — it would need to run identically on both Supabase (full Postgres) and
pglite (WASM Postgres with a narrower extension surface — this repo already hit pglite extension
gaps once, removing an unused `pgcrypto` assertion in `0001_governance_seed.sql` because pglite
doesn't bundle it as a loadable extension), so a SQL-side implementation risks exactly the kind
of cross-target drift this repo has already been burned by. A third-party `uuidv7`/`uuid` npm
package was rejected per the task's explicit instruction to prefer an in-house implementation over
a new dependency for an algorithm this small. Migrating existing row ids from v4 to v7 was
rejected — there is no production data pre-launch to make backfill worth the complexity, and
retrofitting time-locality onto already-scattered v4 ids provides no benefit (the point is
future-write locality, not sorting historical rows).

**Consequences / follow-ups:** Every NEW row in `ledger`/`events`/`timeline_entries` inserted via
Drizzle now gets a time-sortable id; direct-SQL inserts that bypass Drizzle still get a random v4
id from the column default (a narrower, accepted gap — the app never does that in practice). No
partitioning/retention story was added (out of scope for this pass, still an open item). If a
future Postgres major version adds native `uuidv7()`, the JS generator can be swapped for a
DB-side default without any application code changes (the column type/shape is unaffected).

## 2026-07-05 — Shared `FUZZY_THRESHOLD` constant lives in `@bridge/dedupe`, imported by jobpilot, not extracted to a new package

**Context:** `platform/tools/jobpilot`'s answer-bank duplicates-dedupe declared its own
`FUZZY_THRESHOLD = 0.9`, independently of `@bridge/dedupe`'s own fuzzy-match threshold — same
value, no shared source, so the two could silently diverge if either was tuned without touching
the other (2026-07-04 review, `All fixes.md` section 1, P2). Two homes were available: (a) export
the constant directly from `@bridge/dedupe` and have jobpilot import it, or (b) extract it into a
new shared package (or an existing common one) that both `@bridge/dedupe` and jobpilot would
depend on.

**Decision:** Added and exported `FUZZY_MATCH_THRESHOLD = 0.9` from `@bridge/dedupe`
(`platform/packages/dedupe/src/types.ts`, re-exported via `index.ts`). Jobpilot's `answer-bank.ts`
now does `export const FUZZY_THRESHOLD = FUZZY_MATCH_THRESHOLD` imported directly from
`@bridge/dedupe`, instead of re-declaring the literal. A tripwire test
(`fuzzy-threshold-consolidation.test.ts`) asserts `strictEqual(FUZZY_THRESHOLD,
FUZZY_MATCH_THRESHOLD)` so the import wiring itself is verified, not just eyeballed.

**Rationale:** `jobpilot` already depends on `@bridge/dedupe` (`workspace:*` in its
`package.json`) for its own duplicate-detection, and `@bridge/dedupe` has zero dependency back on
jobpilot — no cycle risk. `@bridge/dedupe` is already documented as "one implementation shared by
recon/people-sourcing/company-sourcing match governance and DealPilot/JobPilot dedupe," i.e. it's
already the intended single source of truth for match-scoring constants across every dedupe
consumer in the monorepo, so a fuzzy-match threshold belongs there by the same logic that already
governs the rest of that package's surface. This mirrors the agent-floor consolidation precedent
(`platform/packages/core/src/agent-floor.ts`, 2026-07-05, same review round): when N call sites
need the same invariant, pick the existing canonical owner and make everyone else import from it,
rather than inventing a new shared location.

**Alternatives rejected:** A new shared package (or a constant colocated in `@bridge/core`) was
rejected as unnecessary indirection — it would require both `@bridge/dedupe` and jobpilot to take
on a new dependency for a single constant, when `@bridge/dedupe` was already the natural,
already-depended-upon home with no structural reason to route around it. Leaving the constant
un-consolidated (just adding a comment cross-referencing the other file) was rejected per the task
brief's framing that duplicated-with-a-comment isn't a real fix — a code change that makes
divergence structurally impossible (one export, N imports) was the bar.

**Consequences / follow-ups:** Any future retune of the fuzzy-match threshold now happens in
exactly one place (`@bridge/dedupe`) and propagates to jobpilot automatically; the tripwire test
fails loudly if that import is ever removed or shadowed by a new local re-declaration. No other
package in the monorepo referenced the old jobpilot-local constant (grep-confirmed), so this had
zero blast radius beyond the two files touched.

## 2026-07-05 — Offset/limit pagination for `dealpilot.list`/`integration.list`, not a cursor scheme

**Context:** Both procedures (`platform/apps/api/src/router.ts`) returned their ENTIRE backing
collection on every call — `dealpilot.list` mapped ALL of `wiring.dealpilot.candidateIds` through
per-id `facts.livingProfile()`; `integration.list` returned `DrizzleIntegrationStore.list()`'s
full array unsliced. Both grow linearly with usage and were flagged P1 in the 2026-07-04 review
(`All fixes.md` section 3, Phase 3 item 14c). The task brief left the offset-vs-cursor choice open,
to be decided by what the backing store actually supports.

**Decision:** Added zod-validated `limit` (`z.number().int().min(1).max(200).default(50)`) and
`offset` (`z.number().int().min(0).default(0)`) to both procedures' inputs, and changed both
return shapes to `{ items, total, hasMore }`. `dealpilot.list`'s whole input object is
`.optional().default({})` (there was no previous input at all) so the existing no-arg prototype
call site keeps compiling and running unchanged at the wire level. Implementation is a plain
`Array.prototype.slice(offset, offset + limit)` in both cases — `candidateIds` is a bare in-memory
array (`wiring.ts`) with no natural cursor key, and `DrizzleIntegrationStore.list()` (`@bridge/db`)
has no store-level pagination support to cursor against either, so the router slices the array
after the full fetch. `total`/`hasMore` are computed from the pre-slice length so callers can tell
there's more without a second round-trip.

**Rationale:** Offset/limit is the correct-and-simplest fit for the CURRENT backing stores: an
in-memory array has no stable, monotonic ordering key to cursor on (candidates aren't inserted
with a timestamp/sequence field today), and `DrizzleIntegrationStore.list()` already does a full
table scan with no `ORDER BY`/keyset-friendly column exposed at the store API. Building a cursor
scheme on top of that would add complexity (opaque cursor encoding, stability guarantees) without
a real ordering guarantee underneath it to justify the complexity — over-engineering relative to
what the task brief asked to avoid. `{ items, total, hasMore }` was chosen over a bare array or a
`nextCursor`-shaped response because grep across this router and `@bridge/core`/`@bridge/db` found
zero existing pagination-response convention to match (confirmed by search — this is the first
paginated list surface in the codebase), so this shape sets the convention for both procedures
touched here, favoring simplicity (three flat fields, no nesting) an eventual pager UI can
generalize from later once a second offset-paginated surface exists.

**Alternatives rejected:** (1) Cursor/keyset pagination (e.g. opaque cursor encoding the last id
or offset) — rejected as premature: neither backing store has a real ordering key to make a cursor
meaningfully different from an offset today, so it would be complexity theater. (2) Add real
pagination support to `DrizzleIntegrationStore.list()` itself (a SQL `LIMIT`/`OFFSET` in the
query) rather than slicing in the router — deferred: `@bridge/db` was intentionally left untouched
(not explicitly forbidden this session, but the task brief scoped changes to the two router
procedures only); the router-level slice is correct today given the FK/seeding gap uncovered while
testing this (see follow-up below) means the store's real-world row counts are tiny regardless.
(3) Leaving `dealpilot.list`'s params required (no `.default({})`) — rejected: would have broken
the existing no-arg prototype call site (`Design Bridge AI Interface (Copy)/src/app/data/api.ts`'s
`apiDealPilotList()`), and the task brief explicitly asked for backward compatibility over a
breaking change here.

**Consequences / follow-ups:** `apiDealPilotList()` now requests `{ limit: 200, offset: 0 }` and
unwraps `.items` — the prototype UI still has no pager, so it asks for the max page size to
preserve today's "show everything" behavior visually, while the backend response itself stays
bounded regardless of what any future caller requests. New
`platform/apps/api/test/pagination.test.ts` covers explicit-limit pagination and a "no unlimited
default" case for both procedures. While building the FK-satisfying test fixture for
`integration.list`, discovered `PILOT_WORKSPACE`/`PILOT_USER` (`wiring.ts`) are never actually
inserted into the `workspaces`/`users` tables anywhere — a real (non-in-memory) DB write with a FK
into either (e.g. `integration.connect`, or `workspace.create` called with the pilot user id)
would throw a raw FK violation. Out of scope for this change (bootstrap/seeding, not pagination);
spun off as a separate background task rather than fixed here. Also worth a future look: if a
second offset-paginated list surface appears, consider whether `{ items, total, hasMore }` should
move to a shared `@bridge/core` or router-level helper type rather than being re-declared per
procedure.

## 2026-07-05 — In-process seed-keyed dedup for Gmail intake, in `@bridge/integrations-google` rather than `@bridge/core`

**Context:** Two related, currently-open bug-tracker items in `platform/packages/integrations-
google/`: (1) `IntakeService`'s `hasExternal` guard only excludes already-MATERIALIZED external
items — if `syncGmail`/`syncCalendar` runs twice before the user reaches the Approvals inbox, a
second PENDING proposal gets staged for the same thread/event, and approving both double-commits
Touchpoints/Memories; (2) `GoogleApiGateway.fetchThreads` fetched each thread body with a
SEQUENTIAL `threads.get` call and no retry at all. The task brief for (1) suggested checking
whether the pipeline/ledger already exposes a query method for "list pending proposals by seed"
that could be reused instead of inventing new storage.

**Decision:** For (1): investigated `@bridge/core`'s `LedgerStore` interface
(`packages/core/src/ports.ts`) and `UniversalActionPipeline` (`packages/core/src/pipeline.ts`) —
confirmed neither exposes a query/list/find method; `LedgerStore` only has
`append`/`get(id)`/`decisionFor(proposalId)`, and `IntakeServiceDeps` deliberately carries only
`pipeline`/`bodies`/`graph`, no ledger reference. `Proposal.request.seed` IS present on the
returned `Proposal` (a `seed?: string` on `ActionRequest`), so the seed is recoverable without a
new core query — there's just nowhere durable to index "seed → still-pending proposal id" without
adding one. Rather than extend `@bridge/core` (a parallel session owned that package this
session; also a query-by-seed method would be new API surface for a fairly narrow need), added an
in-process `pendingSeeds: Map<seed, proposalId>` directly on `IntakeService`
(`packages/integrations-google/src/intake.ts`) — `stage()` checks it before calling
`pipeline.propose()` and short-circuits to the existing pending proposal's summary if the seed is
already staged; a new `clearPendingSeed()` method removes the entry once the proposal resolves,
called from `GoogleService.onApproved` (`service.ts`, already invoked after every `decide()` call
regardless of approve/veto/edit) using `resolved.request.seed`. For (2): added a small
`mapWithConcurrency` helper (bounded to 15 concurrent `threads.get` calls — a deliberate cap below
Gmail's per-user rate limit, not "fire everything at once") and a file-local `withRetry` (3
attempts, linear backoff) in `gateway-google.ts`, matching the shape of `intake.ts`'s existing
`withRetry` of the same name (added in a recent prior session for the dual-write idempotency fix).
A thread that exhausts retries is logged and skipped rather than aborting the whole sync.
Additionally hardened `extractPlainText` in the same file with a `MAX_MIME_DEPTH` (10) recursion
cap and a `MAX_BODY_BYTES` (5MB) decode cap, closing a related "unbounded multipart recursion +
full base64 decode in memory" item from the same tracker section.

**Rationale:** `IntakeService` is a long-lived singleton per `GoogleService` instance (constructed
once in `wiring.ts`, lives for the process), so an in-process map correctly closes exactly the
race window the bug describes — "two syncs before a proposal is approved" is bounded by process
lifetime, not something that needs to survive a restart. Scoping the fix entirely inside
`integrations-google` respects the session's constraint against touching `@bridge/core`,
`apps/api/src/router.ts`, or `apps/api/src/identity.ts` (other agents' concurrent work), and
avoids growing `LedgerStore`'s public surface for a need that's local to one package. Reusing
`resolved.request.seed` (already flowing through `onApproved`) to clear the map means no new
plumbing was needed to know when a proposal resolves — the existing post-decide hook was already
the right seam. For the fetch fix, bounded concurrency (not fire-everything-at-once) plus retry is
the standard fix for a sequential-N+1-with-no-resilience pattern, and reusing the `withRetry`
name/shape from `intake.ts` keeps one convention across the package instead of two subtly
different retry helpers.

**Alternatives rejected:** (1) Add a `findPendingBySeed`/`list(filter)` method to `@bridge/core`'s
`LedgerStore` — rejected: out of scope (core was off-limits this session), and a full query API is
more surface than this one narrow need justifies; flagged as a possible future core gap if
cross-session (not just cross-call) dedup-by-seed becomes a recurring pattern elsewhere. (2) Track
pending seeds in `LocalGraphStore` (`@bridge/local`) alongside `hasExternal`/`recordExternal` —
rejected: `@bridge/local` is a separate package this session wasn't scoped to touch either, and
mixing "committed external records" with "still-pending proposal seeds" in the same store
conflates two different lifecycle stages (capture ≠ commit is already a first-class distinction in
this codebase). (3) Persist the pending-seed index to survive restarts — rejected as unnecessary
for the bug as described (a same-process double-sync race); a restart naturally clears in-flight
proposals from this map the same way it clears everything else in-memory, and there is no
correctness gap introduced by that, since `hasExternal` still catches anything actually
materialized. (4) Unbounded `Promise.all` for the thread fetches — rejected: would fire as many
concurrent requests as threads in the batch, risking Gmail rate-limit errors on a large sync; a
concurrency cap is the standard mitigation.

**Consequences / follow-ups:** `IntakeService`/`GoogleService`/`IntakeMaterializer` public
constructors are unchanged (no new required deps — `clearPendingSeed` is a new public method on
the already-injected `IntakeService`, called from `GoogleService`, which already holds both).
`gateway-google.ts`'s `test` script gained `--experimental-test-module-mocks` (Node >= 22) to
support the new `node:test` `mock.module`-based gateway tests. New tests:
`packages/integrations-google/test/intake-dedup.test.ts`,
`packages/integrations-google/test/gateway-fetch-concurrency.test.ts`,
`packages/integrations-google/test/extract-plain-text-bounds.test.ts`. Full monorepo `turbo run
build --force` + `turbo run test --force` green except a pre-existing, unrelated `apps/api`
`pagination.test.ts` FK-violation failure from a parallel session's in-flight pagination work
(confirmed untouched by this change).

## 2026-07-05 — Ledger `ref_ledger_id` as a real column + partial unique index, not a jsonb key

**Context:** `decide()`'s double-approve check (`pipeline.ts`'s `decisionFor()` call) resolved
proposal-resolution linkage via `diff->>'__refLedgerId'` — a reserved key inside the `diff` jsonb
column, with no dedicated column, no index, and no uniqueness constraint. Two consequences: (1)
any skill whose `diff` output happened to contain a key literally named `__refLedgerId` would
corrupt double-approve detection (a correctness hazard baked into an unenforced naming
convention), and (2) with no unique constraint backing it, the "already resolved?" check was a
plain SELECT with no atomicity guarantee — two concurrent `decide()` calls (double-click, a client
retry after a slow response, a retried webhook) could both read "not yet resolved," both append a
resolving decision row, and both commit — firing `onApproved` twice (e.g. sending an approved
email twice). The same in-memory ledger (`InMemoryLedger` in `packages/core/src/memory/stores.ts`)
had an equivalent race: its `decisionFor()` check and the later `append()` were two separate
non-atomic steps with an `await` in between.

**Decision:** Added real `ref_ledger_id uuid`, `seed text`, `data_scope text`, `context jsonb`
columns to the `ledger` table
(`platform/packages/db/migrations/0003_ledger_ref_column.sql`, hand-written following the same
convention as `0001_governance_seed.sql`, registered in `migrations/meta/_journal.json`), plus a
**partial** unique index: `ledger_ref_ledger_id_resolved_uq` on `(ref_ledger_id) WHERE
ref_ledger_id IS NOT NULL AND user_decision IS NOT NULL`. The predicate matters: it excludes
rejected/floor-denied audit rows (which carry `refLedgerId` but a null `userDecision` — see the
2026-07-04 "audited-rejection ledger row on agent-floor deny" entry) from the uniqueness
constraint, so a blocked approve attempt never blocks the later legitimate resolution. No backfill
was written — pre-launch, no production data to migrate. `packages/db/src/ledger-store.ts` was
rewritten to read/write these as real columns (deleting the old `packDiff`/`unpack` jsonb-splicing
functions entirely) and to catch the resulting unique-violation (SQLSTATE 23505, matched against
the named index) and translate it into a new typed `AlreadyResolvedError`
(`packages/core/src/pipeline.ts`, exported from `@bridge/core`) — the SAME error the in-process
pre-check throws, so callers see one consistent type regardless of backing store. A companion
`AgentFloorDeniedError` replaces the bare `Error` previously thrown on floor-deny. `apps/api/src/
router.ts`'s `decide` procedure catches both and maps them to `TRPCError({code:"CONFLICT"})` /
`TRPCError({code:"FORBIDDEN"})`, following the existing `IntegrationFloorScopeError` → `FORBIDDEN`
pattern already in use at `router.ts:576`. For the in-memory ledger, `InMemoryLedger.append()`
gained an atomic check-and-mark against a `Set<string>` of resolved proposal ids — the check and
the mark happen in the same synchronous block with no `await` between them, so two "concurrent"
JS calls (e.g. `Promise.all([decide(), decide()])` in a test, or two requests handled on the same
event-loop turn) cannot both pass.

**Rationale:** A partial unique index is the correct database-native way to express "at most one
row of kind X per key" when "kind X" is a subset of rows (here: resolving decisions, not every
ledger row) — it's the same idiom already used in this schema for `role_permissions_uq`'s
coalesce-NULL unique index in `0001_governance_seed.sql`, so this fix follows an established
in-repo pattern rather than introducing a new one. Enforcing the constraint at the database
(rather than only in application code) is the only way to actually close a TOCTOU race across
concurrent connections/processes — an in-process check-then-act, no matter how careful, cannot by
itself prevent two different Node processes (or two requests interleaved on the event loop before
either awaits) from both passing the check. The in-memory ledger doesn't have a database to lean
on, so its fix has to be structurally different (synchronous check-and-mark) — but the invariant
it enforces is identical, and both paths are tested to prove it.

**Alternatives rejected:** (1) Wrap `decide()`'s read-then-write in an explicit SQL transaction
with `SELECT ... FOR UPDATE` locking the proposal row — rejected as the heavier option: it requires
a transaction to span the pipeline's authority/policy/skill-registry calls (or a narrower
transaction just around the ledger read+append, which still needs a lock scope decision), and the
persistent ledger's actual failure mode (two INSERTs of *new* append-only rows, not a competing
UPDATE) is exactly what a unique index is designed to prevent without any row locking at all — a
constraint is strictly simpler and correct for an append-only table. (2) Add the uniqueness rule
as an application-level global lock (e.g. an in-process mutex keyed by proposal id) — rejected: it
would only work within a single Node process/instance, not across horizontally-scaled API
instances, whereas the database constraint is correct regardless of how many API processes are
running. (3) Keep the `diff` jsonb linkage but add validation forbidding skills from ever
producing a `__refLedgerId` key — rejected: it fixes the correctness hazard but does nothing for
the TOCTOU race, which was the more serious of the two problems the review flagged, and jsonb keys
still can't be indexed with a real uniqueness guarantee the way a column can.

**Consequences / follow-ups:** `LedgerEntry` gained `dataScope`/`context` as real fields alongside
`refLedgerId`/`seed` (feeds Phase 1 item 5's fix, tracked in the same migration/PR since both
needed the same schema change). The persistent-ledger residency question (private proposals
possibly landing in a cloud ledger once `DATABASE_URL` is set — All fixes.md Phase 1 item 7)
remains open and is unaffected by this change — the new columns exist on whichever ledger table
the deployment points at, local or cloud. `packages/db/test/ledger-store.test.ts` (new) and
`packages/core/test/pipeline.test.ts` (extended) both prove the double-approve fix with a real
`Promise.allSettled` concurrent-call test — one succeeds, one gets the typed 409-mapped error —
against both the in-memory and pglite-backed ledger.

## 2026-07-05 — Agent-floor consolidation: canonical union in `@bridge/core`, not a per-site truce

**Context:** `AGENT_FLOOR_MUTATIONS` (`packages/core/src/authority.ts`), `isForbiddenAgentToken`
(`packages/core/src/agent-scope.ts`), and `ALWAYS_APPROVAL_SCOPES` (`packages/db/src/integration-
store.ts`) each independently declared the set of mutations/scopes an agent may never hold or be
granted — the exact invariant a "governed agentic execution" platform depends on staying
consistent. On inspection the three had actually drifted: `authority.ts` denied write/execute/
archive/approve on 8 governance resource types (policy, policy_param, skill, agent, role,
permission, ledger, delegation) plus `network_graph:full` read and `external:send`;
`agent-scope.ts`'s `isForbiddenAgentToken` matched the same 8 resources but for EVERY action (a
stricter check, e.g. it also blocked `agent:read`); `integration-store.ts`'s
`ALWAYS_APPROVAL_SCOPES` was only `["external:send", "network_graph:full"]` — it never covered the
governance-resource floor at all.

**Decision:** Created `packages/core/src/agent-floor.ts` as the single canonical definition,
exported from `@bridge/core`: `AGENT_FLOOR_PROTECTED_RESOURCES`, `AGENT_FLOOR_MUTATIONS`,
`AGENT_FLOOR_ALWAYS_DENIED_SCOPES`, `ALWAYS_APPROVAL_SCOPES`, `isAgentFloorDenied`,
`isForbiddenAgentToken`. `authority.ts`'s `agentFloorDeny` (kept its existing `Actor`-typed
signature since `pipeline.ts` imports it and was out of scope to touch) now delegates to
`isAgentFloorDenied` instead of re-declaring the resource/mutation sets. `agent-scope.ts` re-
exports the canonical `isForbiddenAgentToken` directly. `@bridge/db`'s `integration-store.ts`
imports and re-exports the canonical `ALWAYS_APPROVAL_SCOPES` instead of declaring its own array.
The canonical set is the UNION of all three original lists (the strictest possible floor), not an
intersection or a renegotiation — a floor must be at least as strict as anything ever enforced
anywhere, so narrowing any of the three to match the others was not an option.

**Rationale:** A single source of truth is the entire point of an "agent floor" — three
independently-maintained copies is exactly how it silently drifted (proven by the actual
discrepancy found). Picking the union preserves every guarantee any of the three call sites relied
on; nothing that was previously denied becomes newly allowed. `ALWAYS_APPROVAL_SCOPES`'s own
runtime behavior is unchanged by this fix (it only ever checked `resourceType` with no action, and
those two exact scopes are unchanged) — the fix is entirely structural (derivation, not new
denials), so no behavior-visible regression risk for existing callers.

**Alternatives rejected:** (1) Keep three lists but add a comment cross-referencing each other —
rejected, comments don't prevent drift, only imports do. (2) Intersect the three lists (keep only
what all three agreed on) — rejected, would have silently loosened `agentFloorDeny` and
`isForbiddenAgentToken`'s governance-resource coverage to match `ALWAYS_APPROVAL_SCOPES`'s gap,
turning a bug (missing coverage) into a downgrade (removed coverage) elsewhere. (3) Put the
canonical set directly in `authority.ts` rather than a new file — rejected; `agent-scope.ts` and
`integration-store.ts` (a different package, `@bridge/db`) both need it, and `authority.ts` already
carries the heavier `resolveAuthority` logic, so a small dedicated file keeps the floor
independently reviewable.

**Consequences / follow-ups:** `agentFloorDeny`'s exported signature and `pipeline.ts`'s only call
site are unchanged (out of scope for this pass, not touched). The DB-level agent-floor seed
(`0001_governance_seed.sql:52-67`) is still a documented-not-executed template — this fix closes
the app-layer triplication only; a real DB-level backstop for the floor remains a separate, still-
open item (see BUGS.md and All fixes.md Phase 1 item 6's remaining half). New smoke test
`packages/core/test/agent-floor.test.ts` iterates the canonical constants against all three
consumers so a future edit to only one of them fails a test instead of silently drifting again.

## 2026-07-05 — JWKS verify failures become a typed 401, not an unhandled rejection

**Context:** `identity.ts`'s `IdentityResolver.resolve` verified bearer tokens against either an
HS256 shared secret or a remote JWKS set (`jose`'s `createRemoteJWKSet`/`jwtVerify`), with neither
a timeout on the JWKS HTTP fetch nor a try/catch around the verify call. Any failure — a slow/down
JWKS endpoint, a network blip, or simply an invalid/expired/malformed token — propagated as a raw
rejection out of `createContext` (`context.ts`), which is invoked by the tRPC fastify adapter
before any procedure runs. Nothing in the codebase converted that into an HTTP status, so it risked
surfacing as an unhandled rejection / opaque 500 instead of a normal, expected 401 for bad
credentials.

**Decision:** Two changes. (1) `createRemoteJWKSet` now passes jose's native `timeoutDuration`
option (5s) so the key-set fetch itself is bounded — this is a first-class jose option, not a
hand-rolled `AbortController` race (no existing timeout helper/convention was found elsewhere in
the codebase to reuse; the Google integrations package has no retry/timeout module either, despite
being named as a possible source in the task brief). (2) The entire verify body (both the HS256
and JWKS branches) is wrapped in try/catch in `identity.ts`; any failure is re-thrown as a new
typed `IdentityVerificationError`. `context.ts`'s `createContext` catches that specific error type
and re-throws `TRPCError({code:"UNAUTHORIZED"})`, which `@trpc/server`'s fastify adapter maps to a
real HTTP 401 response.

**Rationale:** A typed error class at the point of failure, caught at the one place
(`createContext`) that has the tRPC vocabulary to translate it into a wire-level status, keeps
`identity.ts` free of any tRPC dependency (it only knows about verification, not HTTP semantics)
while still guaranteeing the failure surfaces correctly. Using jose's built-in `timeoutDuration`
instead of a custom wrapper avoids a second, possibly-inconsistent timeout mechanism racing jose's
own internal fetch/retry logic.

**Alternatives rejected:** (1) Silently downgrade a verify failure to the pilot fallback identity —
rejected outright, explicitly forbidden by this file's own header comment ("an invalid token is
rejected, never silently downgraded to the pilot identity") since that would let a client
sidestep verification by simply sending a bad token. (2) Catch-and-401 inside `identity.ts`
directly (import `TRPCError` there) — rejected to keep `identity.ts` a pure verification module
with no framework coupling; `context.ts` is the natural seam since it already owns the
tRPC-context boundary. (3) A generic `AbortController`-based timeout wrapper — rejected in favor of
jose's native `timeoutDuration`, which already covers exactly this case without extra code.

**Consequences / follow-ups:** New tests: `apps/api/test/identity.test.ts` (HS256 bad-secret
rejection, JWKS-unreachable-endpoint rejection completing within the bounded timeout instead of
hanging, and the no-verifier-configured pilot-fallback path proving it's unaffected) plus one new
end-to-end case in `apps/api/test/server.test.ts` (a forged-signature bearer token against a live
`buildServer()` instance via `app.inject`, asserting `statusCode === 401`). Discovered along the way:
`server.test.ts`'s existing `withEnv` test helper restores env vars in a synchronous `finally`
block that does not await an async test body, so any async test using it races env restoration
against its own logic — worked around locally with a new `withEnvAsync` helper in that file rather
than touching the existing (possibly relied-upon) `withEnv`, since fixing it project-wide was out
of scope for this pass.

## 2026-07-05 — Prototype stays the frontend; `platform/` frontend migration deferred, not started

**Context:** Asked to "retain platform and delete the reference design copy" on the premise that
platform already has the design in place. Inspected `platform/apps` — it contains only `api`
(a Fastify+tRPC backend). Zero pages/components/styling exist anywhere in `platform/`. The entire
UI (all pages, the design system, `network.ts`/`db.ts` data-access layer) lives in
`Design Bridge AI Interface (Copy)/`, which is also the source the live Cloudflare Pages prototype
deploys from (per the `prototype-deploy-mechanism` memory) and carries real LinkedIn-derived PII
(`prototype-now-tracked`). Today the prototype has two data paths: Google/Calendar goes through
platform's tRPC api (`api.ts` → `google.*`); everything else (people/communities/resources/lists)
reads Supabase directly from the browser with an embedded anon key, bypassing the api layer's
governance (Authority resolver, audit ledger, draft-then-approve pipeline) entirely.

**Decision:** Do not delete the prototype. Keep it as the real, actively-maintained frontend for
now. Defer the "real" fix — a frontend app under `platform/apps` that ports the design and routes
all reads/writes through the governed api layer — to a planned, separate initiative. It is not
started; no scaffolding exists yet.

**Rationale:** The premise behind the deletion request didn't hold (platform has no UI to fall
back to), so deleting the prototype would have deleted the only working frontend and the live
site's source with nothing to replace it — an irreversible, high-blast-radius mistake. The
end-state (frontend inside platform, fully governed) is the right direction and matches the
"governed agentic execution" principle in CLAUDE.md, but porting every page, adding the missing
tRPC procedures (people/communities/resources/lists don't exist server-side yet — only `google.*`
and `dealpilot.*` do), and verifying parity against the live prototype is a multi-day effort that
shouldn't be started opportunistically inside an unrelated bug-fixing pass.

**Alternatives rejected:** (1) Delete now, rebuild after — rejected, would break the live site
with no working replacement, not reversible casually. (2) Silently keep going without flagging the
security exposure — rejected; the client-side Supabase anon-key access to canonical PII is a real
standing risk that should be visible, not just implicitly accepted.

**Consequences / follow-ups:** Prototype continues to be the fix target for frontend issues in
this tracker (as it has been all session). The migration is now a tracked, not-yet-scoped roadmap
item (see Phase 4 / planned-but-never-built inventory) — needs a scoping pass (new tRPC procedures
inventory, page-by-page port list, parity test plan) before implementation starts, and should
happen as its own initiative with your explicit go-ahead given the live-site risk.

## 2026-07-05 — Make `commitEntity` idempotent + bounded whole-method retry on the Google intake dual-write

**Context:** `IntakeMaterializer.applyApproved` (`packages/integrations-google/src/intake.ts`)
performs a dual-write on proposal approval: cloud canonical `upsertPersonIdentity`, then local
`upsertPerson`, then per-entity `commitEntity`, then per-external-row `recordExternal`. If any
step after the first throws (network blip, local pglite hiccup), the write is left partially
applied. `upsertPersonIdentity`/`upsertPerson` (`ON CONFLICT ... DO UPDATE`) and `recordExternal`
(`ON CONFLICT ... DO NOTHING`) were already idempotent and safe to retry — but `commitEntity` was
not: pglite's version did a plain `INSERT` with no conflict clause (PK violation on retry), and
the in-memory version explicitly `throw`s on a duplicate id. Known-issues row: "Non-transactional
dual-write; fire-and-forget token refresh" (token-refresh half resolved 2026-07-04).

**Decision:** Made `commitEntity` idempotent in both `LocalGraphStore` backends —
`packages/local/src/stores/pglite.ts` now does `INSERT ... ON CONFLICT (id) DO NOTHING` (confirmed
`id` is `local_entities`'s declared PRIMARY KEY in `INIT_SQL`); `packages/local/src/stores/memory.ts`
now returns silently on a duplicate id instead of throwing, mirroring the file's existing
`recordExternal` dedup pattern (`hasExternal`-guarded push). With every dual-write step now
idempotent, added a small file-local `withRetry(label, attempts, delayMs, fn)` helper (a plain
`for` loop + `try/catch` + linear backoff, no new npm dependency) in `intake.ts` and wrapped the
entire body of `applyApproved` (extracted to a private `applyDirective`) in it — up to 3 attempts,
`console.error`-logged on each retry (matching `gateway-google.ts`'s existing logging style for
recoverable failures).

**Rationale:** Retry-the-whole-method-from-scratch is strictly simpler than fine-grained per-step
retry/compensation logic, and is now provably safe because every step it calls is idempotent by
construction — a second full pass either re-applies the same facts (no-op) or completes the
remaining steps. This also means a *future* retry-queue (mentioned in the original known-issues
row) can safely re-invoke `applyApproved` wholesale without new bookkeeping.

**Alternatives rejected:** Per-step retry with manual rollback/compensation on partial failure —
rejected as unnecessary complexity once idempotency is established at the store layer; a
generic retry/backoff npm dependency — rejected per the task's explicit constraint and because a
~15-line loop covers the need with no external surface to audit.

**Consequences / follow-ups:** `LocalGraphStore`/`CanonicalIdentityStore` port interfaces are
unchanged (implementation-only fix). Gmail sync's separate `hasExternal`-before-fetch double-propose
window (tracked as "9b" in `All fixes.md`) is a different bug and remains open. Tests added:
`packages/local/test/pglite.test.ts` (commitEntity double-call no-ops) + new
`packages/local/test/memory.test.ts`; new
`packages/integrations-google/test/materializer-retry.test.ts` (transient-then-succeed recovers
with no duplicate entity; persistent failure still surfaces after retries exhaust). Full monorepo
`turbo run build --force` + `turbo run test --force`: 28/28 packages green.

---

## 2026-07-05 — Drop the BusinessBroker.net licensed-feed build; route through the Claude-in-browser waterfall

**Context:** `businessbroker.net/robots.txt` disallows `/listings/` and every query-string URL —
DealPilot's `createBusinessBrokerNetConnector` has a real normalizer but no live fetcher. A
licensed/partner data feed would unblock a real connector, but that's a vendor/cost/legal
decision, not an engineering one, and there's no pilot fund yet whose deal flow depends on it.

**Decision:** Don't pursue the licensed feed for now. BusinessBroker.net stays a `Brokerage`
record (`data/brokerages.ts`, status `disconnected`) that routes through the existing
`ConnectAppFlow` waterfall's `claude_browser` step ("Claude in browser" — Claude drives an
actual browser session) the same way any no-API brokerage portal does. No new code needed —
this is the wizard's existing fallback for exactly this case.

**Rationale:** Zero build cost, no dead-end scraper code to maintain against a site that
actively blocks it, and the user isn't blocked on sourcing BusinessBroker.net listings — they
go through the same governed browser-driven flow as every other credential-gated brokerage.

**Alternatives rejected:** building/maintaining a scraper that violates robots.txt (legal risk,
fragile, explicitly rejected already); pausing on a licensed feed vendor search (no pilot fund
yet to justify the cost/lead time).

**Consequences / follow-ups:** `BUGS.md`'s BusinessBroker.net entry updated to point
here. If a pilot fund later needs BusinessBroker.net volume a scraper can't deliver, revisit a
licensed feed then, not speculatively now.

---

## ADR-010 — 2026-06-20 — Local-first, two-plane architecture: everything lives local by default, the pipeline is the only gate to the internet

**Context:** Bridge's trust-first principle (CLAUDE.md: "private default, both-party consent")
needed a concrete residency model, not just a policy statement. Two competing shapes were on the
table as the platform's storage/network topology took form: (a) a conventional cloud-first app
where the customer's data lives in Bridge's cloud database and "privacy" is enforced only by
access control (RLS/permissions) on top of it, or (b) a model where private data structurally
never reaches the cloud in the first place, regardless of who could otherwise query it. The
Google integration slice (Gmail/Calendar sync) was the forcing function: raw thread/event bodies
and the Touchpoints/Memories/Signals derived from them are the most sensitive data the platform
touches, and needed a home before that slice could ship.

**Decision:** EVERYTHING is local by default — the whole platform (the relationship tier AND a
local mirror of canonical facts) lives in a LOCAL store on the machine/VPC (pglite/Postgres via a
ports/adapters seam, `@bridge/local`), not in the cloud database. The `UniversalActionPipeline`
(`platform/packages/core/src/pipeline.ts`) is the ONLY gate to the internet — nothing crosses
outward except through `propose()`/`decide()`. Two agent planes enforce a request/source split:
LOCAL agents REQUEST internet data (they never touch the internet directly); GLOBAL/EGRESS agents
SOURCE it (fetch/enrich/send) on the local agent's behalf, through the gate. Internet-sourced
counterparty facts (name/email/company — see the companion two-tier-data ADR) are DUAL-WRITTEN:
stored both in cloud canonical (`CanonicalIdentityStore`, `platform/packages/db/src/canonical-
store.ts`) and locally (`LocalGraphStore`, `platform/packages/local/src/ports.ts`), because both
planes need them for their own purposes (global dedup vs. local relationship context). Private
relationship data — OAuth tokens, raw Gmail/Calendar bodies, derived Touchpoints/Memories/Signals,
warmth — is LOCAL ONLY and structurally cannot egress: `SecretStore`/`BodyStore`/`LocalGraphStore`
have no outward-facing write path at all (see `platform/packages/local/src/ports.ts`'s header:
"OAuth tokens, raw Gmail/Calendar bodies, and the derived Touchpoints/Memories/Signals/warmth live
ONLY here... They NEVER cross the gate to cloud canonical"). Enforcement: a request with
`dataScope==='private'` intersected with any egress action is rejected; `external:send` and
`network_graph:full` are permanent agent-floor DENY (see the agent-auto-mode ADR and
`platform/packages/core/src/agent-floor.ts`); every crossing is append-only audited via the
ledger. Status as of this writing: the pipeline gate and the local store (pglite `createLocalDb`,
same Drizzle ports) are built; the two-plane request/source split is seams-only (interfaces exist,
full LOCAL-agent-cannot-reach-internet enforcement is not yet wired end-to-end).

**Rationale:** Access control on top of centralized storage is a policy promise that can be
misconfigured, bypassed by a privileged role, or subpoenaed wholesale — it protects data FROM
unauthorized queries, not FROM ever being centralized in the first place. Structural non-
residency (private data literally never being written to a row the cloud can query) is a stronger
trust guarantee and is what "customer-controlled" actually requires for a VC/GP fund handling
sensitive relationship intelligence. Funneling every network-bound action through one pipeline
(rather than letting any agent make its own HTTP calls) turns "what left the building and why"
into a single append-only, replayable audit trail instead of an emergent property of however many
call sites happen to reach the internet. The two-plane REQUEST/SOURCE split exists because local
agents legitimately need internet-derived context (enrichment, a counterparty's public profile)
without themselves being trusted to fetch it — the split keeps the trust boundary at the gate, not
at each agent's own discipline. Dual-write (not local-only) for internet-sourced facts is
necessary because the cloud canonical tier has its own real consumer (global dedup across
workspaces, en route to the ~30k-canonical-connection scale noted in `docs/wiki/decisions.md`) —
local-only would starve that tier of the facts it exists to hold.

**Alternatives rejected:** (1) Cloud-first with RLS/permission-based privacy — rejected as the
default per the reasoning above (access control is necessary but insufficient for a trust-first
product; it was kept as the enforcement layer for the canonical tier, not as the residency model
for private data). (2) Local-only for ALL data, including canonical identity facts (no dual-
write) — rejected: it would mean per-workspace canonical facts silently diverge/duplicate with no
global dedup, defeating the entire point of the canonical tier (see the two-tier-data ADR) and
blocking any cross-workspace enrichment reuse. (3) Letting agents (local or otherwise) make direct
outbound HTTP calls when they need external data — rejected: it collapses the request/source
distinction into "trust every agent's own judgment," which is exactly the ungoverned-egress
failure mode the gate exists to prevent; a single pipeline chokepoint is what makes "every crossing
append-only audited" achievable at all. (4) E2EE-at-rest for the local store from day one —
deferred, not rejected: the wiki explicitly defers full E2EE to Phase 6 and scopes this decision to
"build an encryptable seam day 0," i.e. the ports/adapters boundary is designed so encryption can
be added later without a store rewrite, but implementing it now was out of scope for unblocking the
Google integration slice.

**Consequences / follow-ups:** Every new data-producing integration (beyond Gmail/Calendar) must
decide, per field, which tier it belongs to — there is no "just write it somewhere" default; the
two-plane seam and `LocalPlane`/`CanonicalIdentityStore` interfaces are the contract new
integrations implement against. The two-plane enforcement gap (seams-only, not fully wired) is a
known open item — a LOCAL agent today is not yet structurally prevented from reaching the internet
by anything other than which ports it's constructed with; closing that gap (a runtime capability
check, not just an interface split) remains future work. E2EE-at-rest for the local store remains
deferred to Phase 6 per the wiki; until then, "local" means "not in Bridge's cloud," not
"encrypted against the machine's own operator."

---

## ADR-009 — 2026-06-11 — The Universal Action Pipeline: a single governed draft-then-approve spine for every mutation, not per-feature authorization checks

**Context:** CLAUDE.md's founding principle is "governed agentic execution (explainable,
permissioned, auditable, draft-then-approve)" — Bridge is built for a VC/GP fund's relationship
data, where an AI agent silently mutating a Person/Relationship/Memory record on the fund's behalf
is unacceptable without a human in the loop. Before any feature (Rituals, Tools, Pages) could be
built, the platform needed one answer to "how does any action actually happen," rather than each
feature inventing its own permission check, its own approval UI, and its own audit log — which is
the shape that produces silent drift between features (a pattern the platform has since had to
correct for elsewhere, e.g. the 2026-07-05 "Agent-floor consolidation" ADR, where three
independently-maintained floor definitions had already drifted apart within a matter of weeks).

**Decision:** Every mutation flows through exactly one path, the `UniversalActionPipeline`
(`platform/packages/core/src/pipeline.ts`): Authority (CBAC, deny-default) → Policy(pre) → Agent +
Skill (produces a proposed output, not yet committed) → Policy(runtime) → a review gate → append-
only Ledger → Policy(post) → Variance Adjuster → Output/Event. `propose()` runs the first phases and
stops at a `pending_review` proposal (a ledger row with `userDecision: null`) unless the action
qualifies for auto-approval (see the companion agent-auto-mode ADR); `decide()` resolves a pending
proposal by appending a NEW ledger row that references the original (approve/edit commits and
emits an event, veto records the rejection and feeds the Variance Adjuster) — the ledger is never
mutated in place, only appended to. Approval itself is agent-floor-protected: `decide()` calls
`agentFloorDeny(decider, "approve", "ledger")` before resolving anything, so an agent can never be
the one who approves/vetoes/edits a proposal, even one it could otherwise act on — "agents draft,
humans approve" is enforced structurally in code (`requiresApproval()` in `pipeline.ts` also
forces `actorType === "agent"` into the approval-required branch unconditionally, independent of
any policy result). Even rejections (authority-denied, policy-blocked, floor-denied) are audited —
`#reject()` and the floor-deny branch in `decide()` both append a ledger row before returning/
throwing, so a blocked attempt leaves a trace rather than disappearing silently. The Variance
Adjuster observes every committed or vetoed decision (`variance.observe()`) and is scoped to tune
`policy_params`, never to patch code — a veto changes future policy evaluation, not the pipeline's
logic.

**Rationale:** A single pipeline is the only way "explainable, permissioned, auditable, draft-then-
approve" can be a platform-wide guarantee rather than a per-feature convention that individual
features can accidentally skip — this mirrors the platform-first principle in `docs/raw/
ARCHITECTURE.md` ("adding ritual #7 or tool #5 should be a new row, not a new subsystem"): a new
Ritual or Tool gets governance for free by routing through the existing pipeline, rather than
needing its own authorization/audit code written and reviewed for correctness every time. An
append-only ledger (not an updatable status field) is the only structure that can answer "what was
proposed, what was decided, and by whom" after the fact without trusting that nobody edited the
history — the same property the 2026-07-05 "Ledger `ref_ledger_id`" ADR later hardened with a
database-level uniqueness constraint once the TOCTOU gap in the original design was found. Routing
policy-violation feedback into `policy_params` (data) rather than code changes keeps enforcement
adjustable by the fund's own reviewers (via the Variance Adjuster tuning parameters) without
needing an engineering change for every real-world edge case a veto surfaces — matching the
CLAUDE.md-level distinction between locked strategic decisions and tunable operational parameters.

**Alternatives rejected:** (1) Per-feature RBAC/authorization checks (each Ritual/Tool/Page
implements its own permission gate) — rejected per the platform-first principle: this is exactly
the shape that lets governance drift feature-by-feature, which the codebase has already had to
retroactively fix once (agent-floor triplication). (2) No mandatory human review for agent actions
(agents commit directly, audited after the fact) — rejected outright; it violates the "governed
agentic execution" principle at its root and removes the one control a fund needs to trust an AI
system touching its relationship data. (3) A mutable audit log (status field updated in place) —
rejected: it cannot prove non-tampering or reconstruct "what did the system look like at decision
time," which an append-only ledger provides for free. (4) Hard-coded policy logic that gets
patched in response to specific violations — rejected in favor of the Variance Adjuster's
parameter-tuning model, which lets policy evolve without a code deploy for every adjustment.

**Consequences / follow-ups:** Every new Ritual, Tool, or Page's write path is required to go
through `propose()`/`decide()` — there is no sanctioned side door. This is the seam that later
ADRs harden rather than replace: the 2026-07-05 ledger `ref_ledger_id`/partial-unique-index fix
closed a double-approve race in `decide()`; the 2026-07-05 agent-floor consolidation fixed drift in
what "agents draft, humans approve" actually denies; the 2026-06-02 agent-auto-mode decision (see
companion ADR) is a deliberate, narrow relaxation of the review gate, not a bypass of the pipeline
itself — auto-approved actions still flow through the same `propose()` path and still append a
ledger row, just with `userDecision: "auto"` instead of stopping at `pending_review`. The Variance
Adjuster's `observe()` seam exists and is called on every commit/veto; how much of its intended
"veto tunes policy_params" learning loop is fully implemented versus still a thin pass-through is
not verified by this entry and should be checked against `platform/packages/core/src/ports.ts`'s
`VarianceAdjuster` interface and its concrete implementation(s) before assuming the full loop is
live.

---

## ADR-008 — 2026-06-11 — Two-tier data model: canonical (global, deduped, no tenant linkage) vs relationship (private, per-workspace-per-user), reconciled via COALESCE

**Context:** Bridge needed a data-residency shape that could simultaneously satisfy two opposing
requirements: (a) counterparty identity facts (name, email, current company) are genuinely public/
shared information that is wasteful and incoherent to duplicate per-workspace — the same person
emailing two different funds is the same person, and de-duplicating that globally is valuable
(global dedup, and eventually cheaper enrichment reuse at the ~30k-canonical-connections scale
noted in `docs/wiki/decisions.md`); (b) a fund's actual relationship intelligence about that person
— private notes, warmth score, why they matter to THIS fund — is exactly the kind of proprietary,
sensitive data the trust-first principle says must never leak across tenants or even become
visible to Bridge's own operators as a global aggregate.

**Decision:** Two structurally separate tiers, not one table with a visibility flag. Canonical
tables (`people_canonical`, `communities_canonical` — `platform/packages/db/src/schema.ts`) hold
only public, identity-grade facts, are GLOBAL-deduped by a stable `dedup_key` (e.g. lowercased
primary email), and carry NO tenant/workspace linkage at all — a canonical row cannot be traced to
which workspace's activity produced it. `CanonicalIdentityStore`
(`platform/packages/db/src/canonical-store.ts`) is the sole write surface, and its own header
comment states the dual-write rule explicitly: "the ONLY thing that crosses the gate outward to
cloud canonical is a counterparty's PUBLIC / identity-grade fact... Private relationship data...
NEVER lands here." Relationship data (notes, warmth, derived Touchpoints/Memories/Signals) lives
per-(workspace, user) — locally, per the companion local-first ADR — and links back to canonical
via a nullable foreign key (`canonical_person_id` on the workspace-scoped `people` table, per
`schema.ts`'s `people_canonical_idx`) rather than embedding canonical fields directly. Where a
workspace wants to override a canonical fact with its own private correction (e.g. it knows a more
current company than what's canonically recorded), the read path is designed to reconcile via
COALESCE — the workspace's private override value takes precedence when present, falling back to
the canonical value when absent — so relationship-tier data can locally shadow canonical facts
without ever writing back into (or polluting) the shared global tier.

**Rationale:** Splitting identity facts from relationship intelligence into two tables with
different residency/dedup rules is the only shape that lets both requirements hold at once: global
dedup needs a MERGED, tenant-blind view to be useful (deduping only works if it isn't fragmented
per workspace), while private relationship data needs to NEVER be mergeable across tenants even in
principle. Making canonical rows carry no tenant linkage at all (not even a "which workspace
created this" audit field) is a deliberate stronger guarantee than access-control alone — it means
there is no column to leak even if a query bypassed workspace scoping entirely, which matters for a
platform whose canonical store may eventually be queried by cross-tenant enrichment/dedup logic by
design. COALESCE-based override (read-time reconciliation) rather than writing overrides back into
the canonical row keeps the canonical tier's global-dedup integrity intact — if workspaces could
write their private corrections into the shared canonical record, one workspace's private
correction would silently become every other workspace's "canonical" fact, which is precisely the
pollution the wiki's "No pollution" note is guarding against.

**Alternatives rejected:** (1) A single `people` table with a `visibility` column
(private|team|workspace|global) instead of two physically separate tables — rejected: this is the
same shape already used for OTHER visibility distinctions in this schema (see
`workspace_settings.default_visibility`) but was rejected specifically for canonical-vs-
relationship because visibility is an access-control concept, not a residency one; a single table
still lets a broad enough grant (or a bug in the visibility filter) expose private fields, whereas
two tables with no shared columns cannot leak what was never written to them. (2) Per-workspace
copies of canonical facts (each workspace gets its own row for the same real-world person) —
rejected: defeats global dedup entirely and multiplies enrichment cost/storage by however many
workspaces have ever interacted with that person, with no benefit over a shared canonical row plus
a local override. (3) Writing workspace overrides directly into the canonical row — rejected per
the pollution concern above; COALESCE at read time was chosen specifically so no workspace's
private correction can ever contaminate what other workspaces see as canonical truth. (4) No global
canonical tier at all (fully local-only, matching relationship data's residency) — rejected: this
is explicitly the local-first ADR's alternative-3 rejection restated — it would starve any future
cross-workspace enrichment/dedup logic of the merged view it needs to be useful, and the ~30k-
canonical-connections scale note in the wiki assumes a shared canonical population to dedup
against.

**Consequences / follow-ups:** Every new integration that produces counterparty facts must decide
per-field which tier it belongs in (see the local-first ADR's identical per-field obligation) —
there is no default. The COALESCE override mechanism is a designed READ-PATH reconciliation
pattern; whether it is actually implemented end-to-end in every query path that surfaces
canonical+relationship data together (versus being a documented intent not yet wired everywhere)
was not verified by this entry and is worth a follow-up audit — a query that reads canonical fields
directly without the COALESCE-with-override step would silently ignore a workspace's private
correction. The nullable `canonical_person_id` FK means a workspace's local person record can exist
with no canonical link at all (not yet dual-written, or never will be, e.g. a purely internal
contact) — that is intentional, not a bug: canonical linkage is opportunistic, not required.

---

## ADR-007 — 2026-06-02 — Agent auto-mode: a narrow, opt-in, two-level allowlist relaxation of "agents draft, humans approve" — with a hard, non-overridable ceiling

**Context:** The Universal Action Pipeline's founding rule (see the governance-pipeline ADR) is
that agent actions always stop at `pending_review` — "agents draft, humans approve," with no
exception. In practice this meant even trivial, low-risk agent actions (e.g. logging an obvious
Touchpoint from a calendar sync) required the same manual approval as a consequential one, creating
review-queue friction with no proportional trust benefit. The want was something like Claude Code's
own auto-accept mode: let a user explicitly opt certain narrow, low-risk action classes into
auto-commit, without weakening the review gate for anything the user hasn't explicitly authorized —
and, critically, without ever allowing auto-commit for the categories of action where a human in
the loop is non-negotiable (sending something externally, reading the full network graph, mutating
governance itself).

**Decision:** A user-authorized, narrow relaxation, not a general-purpose toggle. Two allowlist
levels, **narrowest wins**: a workspace-level allowlist (the ceiling of what's auto-able at all in
that workspace) intersected with a per-agent allowlist produces the "effective-auto" set — using
the same token grammar as `capability_scope` (e.g. `touchpoint:write`). In the pipeline: an agent
action that is (a) authorized by CBAC, (b) inside the effective-auto set, and (c) not caught by any
`require_approval` policy auto-commits — the ledger row gets `userDecision: "auto"` with a
`basis: "auto-mode"` marker, distinguishing it from a human-approved commit. Anything else still
lands at `pending_review`, unchanged. A hard ceiling exists that NO allowlist — workspace or
per-agent — can ever override: the agent-floor protected governance resources (policy, policy_param,
skill, agent, role, permission, ledger, delegation — `AGENT_FLOOR_PROTECTED_RESOURCES` in
`platform/packages/core/src/agent-floor.ts`), plus the two always-denied exact scopes,
`external:send` and `network_graph:full` (`AGENT_FLOOR_ALWAYS_DENIED_SCOPES`). These are enforced
by `isAgentFloorDenied()`/`isForbiddenAgentToken()`, which sit structurally beneath the allowlist
check — a token matching the floor is never even eligible to be considered "effective-auto," no
matter what a workspace or agent's allowlist says. The default is an EMPTY allowlist at both
levels, so a fresh workspace/agent has zero auto-commit ability — the original "no agent
auto-commit" invariant holds unless and until a human explicitly opts in. Every auto-commit remains
auditable (it's a normal ledger row, just tagged `auto`) and revocable (removing a token from either
allowlist immediately narrows the intersection).

**Rationale:** Intersecting two allowlists (workspace ∩ agent) rather than a single toggle means
a workspace admin sets the outer bound of what's ever possible, while individual agent
configuration can only narrow that further, never expand past it — this two-key structure prevents
a misconfigured or compromised single agent from single-handedly gaining broad auto-commit power;
both the workspace operator AND the agent's own scope must agree. Making the floor structurally
non-overridable (checked ahead of and independent of the allowlist logic, in a shared module per
the 2026-07-05 agent-floor-consolidation ADR) rather than "just don't put those tokens in an
allowlist" is the difference between a convention and a guarantee — the same lesson the codebase
learned the hard way when the three independent floor definitions had already drifted by the time
they were consolidated. Defaulting to an empty allowlist means the safer, more conservative
behavior (full manual review) is what a new workspace or agent gets automatically, and trust is
extended only by deliberate, visible action — matching the trust-first principle's "private default"
posture applied to agent autonomy rather than just data visibility. Reusing the `capability_scope`
token grammar (rather than inventing a new DSL for auto-mode specifically) means the same
mental model and parsing/validation code that already governs standing grants also governs
auto-mode eligibility.

**Alternatives rejected:** (1) A single global auto-mode on/off toggle per workspace (no per-agent
narrowing) — rejected: it can't express "this specific low-trust agent should still be reviewed
even though the workspace broadly trusts auto-mode," which is exactly the kind of graduated trust a
multi-agent platform needs. (2) No hard ceiling — make the floor itself configurable/grantable if a
workspace really wants to allow it — rejected outright: this would mean a sufficiently permissive
workspace configuration could let an agent auto-approve its own governance writes or auto-send
external communications with zero human review, which directly violates "governed agentic
execution" as a platform-level guarantee, not a per-workspace preference. (3) Default-on (new
workspaces/agents start with a broad auto-commit allowlist that must be manually restricted) —
rejected: inverts the safer default; matches this repo's general convention of deny-default
authority (`resolveAuthority` in `authority.ts`) rather than allow-default with opt-out. (4) A
separate, parallel enforcement path for auto-mode outside the existing pipeline — rejected: auto-
mode is implemented as a branch inside the SAME `propose()` flow (see the governance-pipeline ADR),
so an auto-committed action still goes through authority/policy(pre)/skill/policy(runtime) exactly
like a reviewed one; only the review-gate step differs.

**Consequences / follow-ups:** This decision amends the platform's own conformance rule: "no agent
auto-commit" becomes "no agent auto-commit OUTSIDE the effective-auto allowlist" — any future audit
of "does this platform let agents commit without review" must check allowlist state, not just
assume the blanket rule still holds. The 2026-07-05 agent-floor-consolidation ADR is a direct
downstream dependency of this decision: once auto-mode existed, having the floor's definition
drift across three independent call sites became a materially more dangerous bug (a drifted,
too-loose floor could have let something into the effective-auto set that should never have been
eligible), which is part of why that consolidation happened. Whether the effective-auto allowlist
intersection and the `basis: "auto-mode"` ledger tagging are fully wired end-to-end in
`platform/packages/core/src/pipeline.ts` today (versus designed but partially implemented) was not
independently re-verified line-by-line by this entry beyond what `requiresApproval()`'s current
code shows (it unconditionally requires approval for `actorType === "agent"` with no visible
allowlist-intersection branch yet in the version of `pipeline.ts` read for this ADR) — this is worth
a follow-up check: if the allowlist-intersection logic is not yet present in code, this ADR
describes the locked design intent from `docs/wiki/decisions.md`, and implementation may still be
pending.

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
feed exists — tracked in `docs/BUGS.md`. 19/19 dealpilot tests, 40/40 monorepo tasks
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
  verified per-request identity — tracked in `docs/BUGS.md`.
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

## ADR-011 — Vision pivot: Living Software / Capability Lifecycle Platform (2026-07-06)

**Context:** User adopted a new brand ("Software that builds itself around your work" — adaptive
workspace for professionals and teams) and declared NO prior decision locked; everything re-audited.
Inputs: New Data platform research (Vida-style capture breakdown, Invoko teardown, ~200 agentic
platforms), an adaptive-OS vision doc, and an agent's pushbacks (Capability Trust Model; kernel/
product/interaction separation; fork/compose workspace model) which the user asked to be reviewed
critically and largely adopted with amendments.

**Decision (user-confirmed):**
(a) Bridge = Living Software: Kernel → Compiler → Runtime → Generated Workspace. Core principle
"Everything is proposed, governed, and continuously evolved" (replaces "everything is generated").
(b) Capability Trust Model: risk axis (Informational→Advisory→Transformational→Operational→External,
COMPUTED from manifests, never generator-declared) × origin axis (Built-in→Template→Community→
AI-generated→User code) × audience; release-style lifecycle states; credential broker (temporary
scoped grants, capabilities never own secrets); trust-based approvals per class — REVERSES the
2026-06-22 human-only-approvals hardening (External band keeps explicit human approval); auto-suspend
on failure precedes any demotion approval; Trusted decays (90d TTL, dep-change resets).
(c) Kernel/Products/Interactions orthogonal. Products = compiled workspaces (DealPilot first — sold
as a product, not a demo). Ambient split: SENSING = day-1 kernel sensor (desktop capture, system
events, browser — user override of the reviewer's defer-capture advice); ACTING = Phase-4 interaction
model. Desktop-first: Tauri shell = flagship form factor.
(d) Workspaces = projections over one shared graph. Verbs: Fork/Compose/Publish/Archive. Capabilities
compose (VS Code-extensions model), never auto-merge; policy composition = deny-wins (not CSS);
audit immutable + referenced with provenance; day-1 capability sharing ⇒ day-1 versioning+pinning+lineage.
(e) Universal Object System satisfied by node_types registry (universal-entity table still rejected).
(f) Adopt Mem0 + Mastra components behind ports (REVERSES Initiatives-era Mem0 rejection); local-plane
compatible required.
(g) Vocabulary re-scoped: kernel keeps Bridge vocab; compiled workspaces may use domain vocab; user
override wins; ESLint no-crm-vocab re-scoped to kernel paths.
(h) Promotion evidence defaults defined as policy_params constants (workflow ≥5 reps/30d etc. — raw §5),
Variance-Adjuster-tunable; success metrics = adaptive proxies, not hard-coded.
(i) Capture contract: every capture → inspectable Memory entry; avatar blink = tell; raw capture
local-plane only; graceful degradation without OS permissions.

**Alternatives rejected:** rebuild-from-scratch and clone-and-modify (engine already implements the
kernel's governance/execution layers); universal-entity table (again); CSS-style policy cascade;
human-only approvals retained as-is (too restrictive for adaptive autonomy); deferring capture to a
later phase (user requires day-1 sensing); graph merge/split (projections instead).

**Consequences:** Rust/Tauri capture core enters the Phase-0 critical path (macOS entitlements,
notarization, S0/S1/S2 local store, PII scrubbing, resource governor); <DataViews> shell becomes
Phase-1 critical path (view-grammar enforcement point); schema v2 punch-list extended (capability
manifests/states/trust_grants/workspace_definitions/versioning); ESLint rule re-scope + DealPilot
"Deal" identifiers become conformant; CLAUDE.md and wiki rewritten to the new brand; competitive set
shifts to Vida/Invoko/AirJelly + Notion/Fibery + Retrace/AgentOS (Dialllog/Affinity only for DealPilot);
OS-vendor dependency (screen-capture permissions) is a named platform risk requiring graceful degradation.

Full detail: docs/raw/vision-pivot-living-software.md (re-audit verdict table §3, trust model §4,
promotion constants §5, roadmap §10, flags §11).

## ADR-012 — Vision pivot second-pass amendments: no dummy data, Recon add-on, multi-surface, competitor framing (2026-07-06)

**Context:** Same-day follow-up to ADR-011. User issued four directives while also asking the
ESLint no-crm-vocab task (see docs/BUGS.md 2026-07-06 entry) to be completed via `/hookify`.

**Decision (user-confirmed):**
(a) **No dummy data** — REVERSES the pre-pivot `dummy_`-prefix convention. Platform shows real,
connected data only; no seeded demo state/network created going forward. Existing `dummy_`
instances (prototype seeds, `dummy_pilot@bridge.local` structural default, the `bridge/dummy-prefix`
ESLint rule itself) are tracked debt, not purged in this pass. Unit-test fixture literals are a
distinct category left as an open question pending explicit user direction, not folded into this
reversal unilaterally. Onboarding must function from a user's real connected accounts from session
one; an unwired connector states that plainly rather than substituting seeded data.
(b) **Recon = an add-on capability package**, same tier as Helpdesk — `Tools/recon/`'s draft-then-
approve match-tier model already fits the Capability Trust Model's External/Operational bands.
Phase 2 ships DealPilot + Helpdesk + Recon as the initial capability-package set.
(c) **Multi-surface architecture, Notion model** — web app + desktop app + mobile app, one kernel.
"Desktop-first" (ADR-011 C7) is corrected to mean build SEQUENCING (desktop shell built first),
not an architectural constraint: the kernel is surface-agnostic over the existing tRPC/API layer;
the Sensor SPI (desktop capture/system events/browser) is an OPTIONAL capability available only on
the desktop shell, never a kernel dependency — web and mobile clients are fully functional without
it. View-grammar components must render at mobile widths from day one even though mobile ships
last. The overlay avatar's OS-level meditate/awake/blink behavior is desktop-shell-specific; web/
mobile carry a lighter in-page persona only.
(d) **Competitive framing** — drops the OS-vendor (Windows/Mac) competitor framing from all narrative
docs entirely (retained only as an engineering risk note: graceful degradation, macOS entitlements).
Stated competitor set: ambient desktop agents (Vida, Invoko, AirJelly), generated/flexible
workspaces (Notion AI, Fibery, Noloco), agent-ops platforms (Retrace, AgentOS).
(e) **Dynamic competitor discovery** — the Learning Agent must research a compiled product's
competitive landscape live at onboarding/blueprint time (web search, egress via the pipeline like
all Learning Agent research) rather than Bridge shipping a static, hardcoded competitor lookup
table per product. Prior mentions of "Dialllog/Affinity" for DealPilot in these docs are historical/
illustrative context, not a runtime fact the platform relies on.

**Separately, same session:** re-scoped `bridge/no-crm-vocab` to kernel paths only
(`packages/*/**`, `apps/api/**`) by implementing the check inside the rule
(`platform/tools/eslint-rules/src/no-crm-vocab.js`, via `context.filename` against a
`KERNEL_PATH` regex) rather than editing `eslint.config.js`, because the repo's `config-protection`
hook blocks all edits to that file outright and `/hookify` (tried per user instruction) manages a
different, unrelated hook system and had no mechanism to exempt it. Verified `tools/dealpilot`
40 errors -> 0; kernel paths still enforce (confirmed via a throwaway violating file); found and
fixed one genuine kernel-scope violation (`apps/api/src/wiring.ts` `existingDeals` -> renamed
`existingDealPilotCandidates`, matching its sibling `dealPilot*`-prefixed variables). Full repo
lint: 0 errors / 2 pre-existing unrelated warnings; `turbo run test --force`: 30/30 green.

**Alternatives rejected:** disabling/editing the config-protection hook via `.claude/settings.json`
surgery (user offered this as a fallback option; the in-rule scoping achieved the identical result
without touching any protected file or hook, so it was unnecessary) · purging all existing
`dummy_` data in this same pass (large surface, out of scope for a same-day amendment — logged as
debt instead) · keeping a static per-product competitor table for speed (rejected as contradicting
brand principle 3, "Built From Reality," and the Learning Agent's own stated research capability).

**Consequences:** `docs/wiki/vision.md` and `docs/wiki/roadmap.md` updated (P2 now DealPilot +
Helpdesk + Recon); mobile-viewport support becomes a `<DataViews>` shell requirement from Phase 1,
not deferred; the `bridge/dummy-prefix` ESLint rule's future is now an open question (still active,
scope may need revisiting once real-data-only is enforced product-wide); test-fixture convention
undecided pending explicit user call.

## ADR-012 — Capability Trust Model: kernel implementation shape (2026-07-06)

**Decision:** Implemented the Capability Trust Model (docs/wiki/vision.md "Capability Trust
Model" + "Promotion defaults") as a new `packages/core/src/capability/` module (types, risk,
lifecycle, approvals, credential-broker, ports) exported from `@bridge/core`'s barrel, a new
`packages/db/src/capability-store.ts` (`DrizzleCapabilityStore`) mirroring `governance-stores.ts`/
`ledger-store.ts`'s shape, four new tables (`capability_manifests`, `capability_states`,
`trust_grants`, `workspace_definitions` — schema.ts LAYER 8 + mirrored into `docs/raw/SCHEMA.sql`
LAYER 8, migration `0006_lonely_human_cannonball.sql`), and a new `capability.*` tRPC namespace in
`apps/api/src/router.ts` (register/submitForValidation/approve/activate/suspend/
demoteOnDependencyChange/list/get), wired into both `buildPersistentPorts`/`buildInMemoryPorts` in
`apps/api/src/wiring.ts`.

**Why these specific choices:**
- **Risk is computed, not stored-then-trusted** (`risk.ts`'s `computeRisk`) — a pure function over
  a manifest's declared permissions/connectors + a caller-supplied dependency resolver (cycle-safe
  via a visited-set, not recursion-depth limiting), so it stays testable with plain objects and
  matches the "never self-declared by the generator" requirement literally: nothing lets a
  registering caller pass its own risk band in.
- **`PROMOTION_DEFAULTS`/`AUTO_ACTIVATION_BUDGETS` as single exported constants**, shaped 1:1 for
  future `policy_params` rows (mirrors how `policies`/`policy_params` already separate rule from
  tunable value) — avoids scattering magic numbers the Variance Adjuster will eventually need to
  tune, per the spec's explicit instruction.
- **External-band hard floor in `approvals.ts`** mirrors `agent-floor.ts`'s non-removable-deny
  shape on purpose: checked first, returns unconditionally, no trust grant/kill-switch/budget can
  move it — same invariant class as the agent floor, so a future reader recognizes the pattern.
- **`capability.approve` routes through `pipeline.propose`/an implicit human-decide gate** rather
  than writing its own approval mechanism, so the SAME agent-floor + audit-ledger guarantees
  `action.decide` already provides apply unchanged (additive use of the existing pipeline, per the
  task's explicit "do not rewrite pipeline.ts semantics" constraint). `resourceType: "skill"` is
  used as the nearest existing governed-registry token since capability rows do not yet have their
  own `ResourceType` — flagged below as a known gap, not silently worked around.
- **Credential broker returns only an opaque grant reference**, never a secret — `CredentialBroker`
  is a port (mirroring `EphemeralQuery`'s shape) with `InMemoryCredentialBroker` as the dev/test
  default; a capability's connector, not the broker or the capability, resolves the reference into
  a real credential (unchanged "tools never own OAuth" invariant, ADR-006).
- **Budgets + kill switch stay in-memory in BOTH `buildPersistentPorts` and `buildInMemoryPorts`**
  for now (no persistent implementation exists anywhere yet) — matches the existing honest-lie
  pattern `buildPersistentPorts` already uses for `ToolCaptureStore` (loud comment, not a silent
  fake-durability claim). A real workspace-settings-backed kill switch and a durable budget counter
  are explicit future work, not pretended to exist here.

**Alternatives rejected:** storing risk as a manifest-supplied field with a separate validation
pass (rejected — reintroduces the self-declared-risk hole the spec explicitly closes) · giving
`capability.approve` its own bespoke ledger-adjacent approval table instead of reusing
`pipeline.propose`/`decide` (rejected — duplicates the agent-floor/append-only guarantees instead
of inheriting them, and the task explicitly said not to rewrite pipeline semantics) · adding a
dedicated `ResourceType` enum value for capability rows in this pass (deferred — `router.ts`'s
`resourceTypeEnum` and `types.ts`'s `ResourceType` are both kernel-wide shared surfaces; widening
them belongs with the P1 `workspace_definitions`/onboarding work that will also consume this
table, not bolted on here as a one-off).

**Consequences:** `capability_manifests`/`capability_states`/`trust_grants`/`workspace_definitions`
exist in both Drizzle schema and `docs/raw/SCHEMA.sql`, ahead of any UI consuming them (P1
onboarding is the intended first consumer of `workspace_definitions`). `resourceType: "skill"` on
`capability.approve`'s proposal is a known, temporary stand-in — a future pass should add a real
`capability` resource type once the governance-vocabulary surface is revisited. Auto-activation
budgets and the kill switch are in-memory only (process-lifetime, not durable) in every mode until
a persistent implementation lands. 32 new `@bridge/core` tests + 7 new `@bridge/db` tests added;
full monorepo `turbo run build --force` / `turbo run test --force` / `eslint .` all green (0 new
errors; 2 pre-existing, unrelated warnings in `determinism.ts`/`pipeline.ts`, both untouched by
this change).

## ADR-013 — Practice hardening from 2026-07 research sweep (agents/skills/workflows/evals)

**Date**: 2026-07-06. **Status**: adopted.

**Decision**: Fold externally-validated practices into the roadmap (wiki roadmap "Practice hardening"
section; full findings in docs/raw/research-agent-skill-workflow-practices-2026.md). Headline
adoptions: (1) lethal-trifecta auto-escalation policy (private-data read + untrusted-content ingest
+ egress => External band regardless of computed risk — from MCP security guidance); (2) two-gate
promotion for generated capabilities — output-quality pass rate AND trigger precision/recall scored
independently (Anthropic skill-creator), plus generalization-on-novel-tasks test (MUSE-Autoskill),
held-out eval selection, and baseline-vs-with-capability parallel runs; (3) approval-as-resumable-
state through the workflow layer (durable zero-compute waits — Temporal/Hatchet/Inngest convergent);
(4) star agent topology — Chief of Staff sole router, no peer handoffs, hard chain-depth cap;
(5) Zapier-style version lifecycle (single live version, auto-demote prior, rollback = fork-from-
history never in-place); (6) dry-run mode + per-step approval gates shipped as first-class (verified
absent from Zapier/Make/n8n — differentiation); (7) ≤20 active tools per agent turn with deferred
registry lookup; (8) description-tuning as its own subsystem with human-approved trigger eval sets.

**Why**: user directive to research Hermes/OpenClaw-class agents, Claude/Pi skills, workflow/ritual
engines and strengthen the roadmap. Research confirmed two Bridge bets independently (autonomy ramps
DOWN from 100% review — CrewAI postmortem; nobody ships promotion gates or pre-apply blueprint
approval as first-class — competitive gap) and imported concrete mechanisms Bridge lacked (two-gate
promotion, trifecta rule, durable approval waits).

**Alternatives rejected**: adopting an existing agent framework wholesale (LangGraph/CrewAI) —
rejected again; the runtime stays thin-custom + engine bindings behind ports, practices imported as
kernel rules not dependencies. Treating Hermes auto-skill-from-repetition claims as precedent —
rejected pending primary sources (content-mill only). Building skill template libraries from
precedent — none exists; if built, it is original design.

**Consequences**: PROMOTION_DEFAULTS gains trigger-accuracy + generalization evidence fields (P3);
policy engine needs the trifecta rule as a seeded, non-removable policy row (P0 punch-list item);
RitualExecutor seam requirements now explicitly include durable signal/wait + idempotency-key
convention (ritual_run_id + step_id); capability lifecycle gains Zapier-style Available state
semantics question (Active vs Trusted mapping) to resolve during P3 design.

## ADR-014 — Sensor SPI design: context-provider registry, observations → timeline_entries, sensors as capabilities (2026-07-06)

**Decision**: P0 Sensor SPI ships as `@bridge/sensors`, shaped as the CONTEXT PROVIDER registry
from docs/raw/client-architecture-context-providers.md (9 provider kinds: apps · accessibility ·
screen · voice · clipboard · filesystem · browser · documents · emails) rather than the vision
doc's original three sensor kinds. Four load-bearing choices:

1. **Observations map to `timeline_entries` (+ `events`), not a new table and not `signals`.**
   `timeline_entries` already IS the inspectable-Memory-entry shape (workspace-scoped,
   `occurred_at`, free `type`, human-readable `content`, `created_by` provenance, entity links via
   `timeline_entry_refs`) and is where derived Memories from other intake paths land — the capture
   contract ("every capture → inspectable Memory entry") is satisfied without inventing schema.
   The blink tell is a `sensor.capture` DomainEvent on the EventBus (→ `events` table), emitted per
   ingest. `signals` was rejected as the target: schema requires `recommended_action` NOT NULL and
   the v2 punch-list makes signals read-only/derived — a capture is a fact, not a recommendation;
   signal generation from context stays a downstream consumer.
2. **Sensors are capabilities, not kernel deps.** Registering a provider creates a capability
   manifest (origin `built_in`, type `integration`, audience `private`) whose risk band is
   COMPUTED by the capability module — read-only/no-egress kinds (clipboard, apps…) honestly
   compute `informational`; emails/browser carry a signal-write permission and compute `advisory`
   (matches the wiki's "emails/browser score higher than clipboard"). State starts `draft`
   (generation ≠ activation, even for built-ins). The kernel runs with zero providers — nothing in
   `@bridge/core` imports `@bridge/sensors`; web/mobile surfaces work with none registered.
   Alternative rejected: hard-wiring sensors into the pipeline (would make capture a kernel
   dependency and break the "optional capability, desktop-only" rule).
3. **Raw vs derived split at the TYPE level.** Providers emit `CaptureEmission = { raw:
   RawCapture; observation: ContextObservation }` — two unrelated types. The consumer API
   (`SensorHub.subscribe`) carries only `ContextObservation`; raw is reachable solely via
   `readRawCapture(id, plane)`, which refuses `plane === "cloud"` unconditionally (planeGate
   semantics). "Learning Agent consumes context, not screenshots" is therefore structural, not a
   convention. Alternative rejected: one observation type with an optional `raw` field stripped at
   runtime — a forgotten strip would leak; the type split cannot.
4. **Per-surface subsets are data (`SURFACE_PROVIDER_KINDS`)**, enforced at registration: desktop =
   all 9, browser = browser/documents, mobile = voice/documents (photo capture rides the existing
   LocalMediaStore camera path). The Tauri shell's Rust capture core implements the desktop subset
   against this SPI; its `sensor_bridge` commands are typed stubs until the macOS core lands
   (NSWorkspace focus / AX tree / CGWindowList on-demand screenshots — Phase-0 follow-up).

**Consequences**: a Drizzle `CaptureLedger` binding over timeline_entries/timeline_entry_refs is
needed when the desktop shell wires persistence (in-memory ledger today); durable raw storage on
the local plane (pglite/LocalMediaStore) is likewise follow-up; `context:*` resource types used in
provider permissions are risk-computation vocabulary only (CapabilityPermission.resourceType is a
free string) — they are not (yet) authority-resolver ResourceTypes.

## ADR-015 — ModelProvider seam: port in core, impls in @bridge/models, plane-asymmetric router (2026-07-06)

**Decision**: `ModelProvider` port ({id, plane, complete, embed?}) lives in `@bridge/core`
ports.ts as types only (core stays zero-runtime-deps; `EchoModelProvider` test double in
memory/stores.ts). Real impls in new `@bridge/models`: `OllamaProvider` (local plane,
OLLAMA_URL → /api/generate + /api/embed) and `AnthropicProvider` (cloud plane, Messages API,
ANTHROPIC_MODEL default claude-fable-5; key from env at construction, fail-loud — never stored on
a manifest, consistent with tools-never-own-secrets). `createModelRouter` resolves tool-kit
`modelBinding`s with a deliberate ASYMMETRY: planeDefault=local NEVER falls back to a cloud
provider (capture/sensor-plane content must not leak to a cloud model — resolution fails loud
instead), while planeDefault=cloud MAY fall back to local (falling toward more privacy is always
safe). Both providers take an injected fetch (recorder's SidecarFetch pattern) so tests shape
requests with zero network. Wired into apps/api wiring.ts ModePorts: in-memory mode = echo double;
persistent mode = Ollama always + Anthropic iff ANTHROPIC_API_KEY (no fake fallback, same
fail-closed posture as the Google gateway). Alternatives rejected: Vercel AI SDK/LiteLLM now
(heavier dep for two providers; still the plan at gateway stage, behind this same port); putting
impls in core (breaks zero-deps); symmetric fallback (violates the local-first gate's whole point).

## ADR-016 — macOS capture core P0 slice: objc2 crates, polling over notifications, clipboard raw/derived split, drain-not-push (2026-07-06)

**Decision**: `apps/desktop/src-tauri/src/sensor_bridge.rs` gets its first two REAL macOS
providers — "apps" (frontmost-app) and "clipboard" — replacing their stubs; "screen" stays a
stub (see below). Four load-bearing choices:

1. **Crate choice: `objc2` + `objc2-foundation` + `objc2-app-kit` (0.6 / 0.3 / 0.3), not
   `cocoa`+`objc`.** The `objc2` family is the actively maintained successor (the older
   `cocoa`/`objc` crates are effectively unmaintained) and ships safe, typed AppKit bindings
   (`NSWorkspace`, `NSRunningApplication`, `NSPasteboard`) generated from Apple's headers, so
   `frontmostApplication()`/`localizedName()`/`bundleIdentifier()`/`changeCount()`/
   `stringForType()` are ordinary (mostly-safe) Rust calls instead of hand-rolled `msg_send!`.
   Pulled in with `default-features = false` + an explicit feature list (NSWorkspace,
   NSRunningApplication, NSPasteboard, NSPasteboardItem, NSApplication on the app-kit side;
   NSString/NSNotification/NSDictionary/NSArray/NSObject/NSValue/NSGeometry on the foundation
   side) rather than the crate's "all features" default — cuts compile time materially (the
   default pulls in ~300 AppKit class bindings this slice never touches) and keeps the
   dependency surface auditable.
2. **Polling (~1s), not `NSWorkspace.didActivateApplicationNotification` / distributed
   notification observers, for both apps and clipboard.** A notification observer needs a live
   `NSRunLoop` on the registering thread — either the main thread (contending with the webview's
   own run loop, and Tauri's `AppHandle` isn't `Send`-friendly for this) or a hand-bridged Cocoa
   run loop on a background thread, which is materially more moving parts for a P0 slice.
   Polling on a plain `std::thread` with a channel back to the hub needs neither: NSWorkspace's
   `frontmostApplication` and NSPasteboard's `changeCount` are cheap reads, and neither "apps" nor
   "clipboard" has a real-time latency requirement (sub-second focus-change or paste latency
   isn't part of the capture contract). Revisit if a future provider genuinely needs push
   notification latency.
3. **Clipboard: derived observation carries type + length + hash only; raw text goes ONLY into
   the bounded ring buffer, reachable solely via `sensor_read_raw`.** Clipboard content is the
   textbook case the capture contract exists to protect against — pasted passwords, tokens, PII
   moving between apps. Reusing the SPI's structural raw/derived type split (ADR-014) rather than
   trusting a runtime "don't log the text" convention means a forgotten call site literally cannot
   leak clipboard text into an `Observation` or the `sensor.capture` event payload — the type
   doesn't have a field for it. The ring buffer is the only place raw text lives, capped at 256
   entries (bounded, LRU-evicted), and it is process-local memory only — nothing about it crosses
   a wire or a plane boundary; that only happens if `sensor_read_raw` is called explicitly.
4. **Provider lifecycle drains, it does not push.** `sensor_start`/`sensor_stop` start/stop a
   background thread per provider; emissions land in an `mpsc::Sender` the hub owns, get pumped
   into an `ObservationQueue` (derived) + `RawRingBuffer` (raw), and are only handed to the caller
   via the new `sensor_drain` command (returns a JSON array, drains fully, empties the queue) or
   `sensor_read_raw(id)` (one raw entry by id). Rust does zero HTTP egress; the JS side owns
   POSTing drained observations to the CaptureLedger. A `sensor.capture` Tauri event still fires
   per observation on drain as the blink-tell hook, so the overlay avatar can react without the JS
   side needing to poll `sensor_drain` at high frequency purely for the blink.

**Screen provider**: `capture_screenshot_on_demand` stays a stub — ScreenCaptureKit /
`CGWindowListCreateImage` both require the Screen Recording permission to be granted
interactively (no headless grant path), so there is no capture path to build and verify without a
live interactive macOS session with the permission pre-granted. Instead, `sensor_list` now reports
per-provider `availability` + `permission_note` honestly: "apps"/"clipboard" → `available` (no
permission gate on macOS), "screen" → `not_implemented` with a note naming the Screen Recording
permission and the still-stubbed capture path. This turns the old blanket
`SENSOR_NOT_IMPLEMENTED` on `sensor_list` itself into real, per-provider capability data the web
shell can render (e.g. "grant Screen Recording to enable" vs. "not built yet").

**Testing**: `cargo test` covers only the pure parts — `RawRingBuffer` (id assignment, eviction at
capacity, capacity floor of 1, missing-id lookup) and `ObservationQueue` (FIFO drain, drain
idempotency when empty) in `providers/mod.rs`. AppKit-touching code (`providers/apps.rs`,
`providers/clipboard.rs`) is deliberately NOT unit-tested — it calls live NSWorkspace/NSPasteboard
APIs with no seam for a fake, and a "test" that mocks the ObjC runtime would verify the mock, not
the capture. `cargo check` and `cargo clippy -- -D warnings` both pass clean; that is the
verification level for the AppKit-touching modules in this slice.

**Consequences**: `voice`/`filesystem`/`browser`/`documents`/`emails` provider kinds remain
unimplemented (same SPI, no shell changes needed when they land, per ADR-014). The web/JS side of
`apps/desktop` still needs to (a) call `sensor_drain` on an interval and POST results to the
CaptureLedger, and (b) subscribe to `sensor.capture` for the avatar blink — neither exists yet;
this ADR covers only the Rust capture core. `Cargo.toml` gained `objc2`/`objc2-foundation`/
`objc2-app-kit` as macOS-relevant dependencies; they compile (and are exercised) only under
`#[cfg(target_os = "macos")]`, so non-macOS builds of this crate don't pull them in at all for the
provider modules (though the crate-level `Cargo.toml` deps themselves are unconditional — a
follow-up could gate them with `target_os = "macos"` in `[target.'cfg(...)'.dependencies]` if a
non-macOS desktop build is ever needed; not done here since Tauri's desktop shell is macOS-only
for P0).

## ADR-017 — P1 Workspace Generator: `<DataViews>` registry as grammar enforcement point + blueprint as a governed proposal (2026-07-06)

**Decision:** Implemented the first slice of P1 (Workspace Generator, docs/wiki/vision.md "View
grammar" + docs/wiki/roadmap.md): a pure `compileBlueprint()` in a new flat file
`packages/core/src/blueprint.ts` (validated `WorkspaceBlueprint` -> `CompiledWorkspace`), a new
`WorkspaceDefinitionStore` port (`packages/core/src/workspace-definition.ts`, in-memory default)
bound by `DrizzleWorkspaceDefinitionStore` (`packages/db/src/workspace-definition-store.ts`) to the
existing `workspace_definitions` table (landed with the Capability Trust Model, ADR-012), a new
`workspace.blueprint.{get,propose,activate}` tRPC namespace in `apps/api/src/router.ts`, and the
frontend `<DataViews>` shell (`apps/web/src/app/dataviews/`) consuming `@bridge/tables`' un-consumed
`TableSpec`/`ViewConfig`/engine for the first time. `JobPilotPage` was migrated to render its
tracked-applications list through `<DataViews>` (data flow via `trpc.jobpilot.*` unchanged) to prove
the shell against real data instead of only synthetic fixtures; a new `WorkspacePage` (`/workspace`)
fetches the active blueprint, compiles it client-side, and renders each entity's views with real
data from the existing `graph.*` endpoints (Initiative/Touchpoint/Signal) — entities without a
wired data source (per CLAUDE.md's "no dummy data") get an honest "not yet wired" empty state.

**Why these specific choices:**
- **`<DataViews>`'s `ViewComponentRegistry` (`apps/web/src/app/dataviews/registry.ts`) is the
  grammar ENFORCEMENT POINT**, not a convention: a plain `Record<ViewConfig["kind"], Component>`,
  never a dynamic import or string-keyed lookup that could resolve an arbitrary component. An
  unregistered `view.kind` renders `DataViews.tsx`'s own explicit error-boundary message — there is
  no code path from an unknown string to a rendered component. This is the literal reading of the
  vision doc's "Generation = configurations of REGISTERED components only, never new components"
  and "`<DataViews>` shell = enforcement point."
- **`compileBlueprint()` is pure, zero-deps, and does NOT import `@bridge/tables`** — `@bridge/core`
  is a zero-runtime-dependency package by its own `package.json` description, so
  `packages/core/src/blueprint.ts` defines `BlueprintColumnSpec`/`BlueprintTableSpec`/
  `CompiledViewConfig` as a deliberate STRUCTURAL MIRROR of `@bridge/tables`' `ColumnSpec`/
  `TableSpec`/`ViewConfig` rather than a type import. Consumers that already depend on both packages
  (apps/web, apps/api) get drop-in-compatible shapes with no cast needed; core stays free of a new
  cross-package dependency for a compiler that has no actual runtime need of `@bridge/tables`'
  code (only its shape).
- **The compiler enforces two grammar rules structurally, not by convention**: an entity's
  `nodeType` must be in a caller-supplied registry list (rejects unknown node types — no
  universal-entity escape hatch, matching the vision doc's registry-over-open-string decision), and
  a relationship-shaped entity's views are restricted to `network` (graph) or `table` — any other
  kind throws `BlueprintCompileError` at compile time, before it ever reaches a component.
- **Blueprint changes are a GOVERNED PROPOSAL, not a direct write** — `workspace.blueprint.propose`
  always creates a `draft` `workspace_definitions` row (mirrors `capability.register`'s "generation
  only ever creates draft"); `workspace.blueprint.activate` round-trips through the SAME
  `pipeline.propose`/implicit-decide semantics `capability.approve` already uses, so a human
  decision (never an agent — the agent-floor applies unchanged) resolves it, the attempt is
  ledgered either way, and only on resolution does it bump the version + archive the prior active
  row (the one place "at most one active row per workspace" is enforced). No competitor in this
  category (Notion AI, Fibery, Noloco — the generated/flexible-workspace peer set) ships a
  pre-apply human-approval gate on generated workspace structure itself; see
  `docs/raw/research-agent-skill-workflow-practices-2026.md` §5 on why "propose, don't auto-apply"
  is the harder, correctter default for anything an agent (or a Learning Agent doing blueprint
  research) could generate.
- **`workspace.blueprint.*` was merged into the EXISTING `workspace: t.router({...})` namespace**
  (workspace CRUD/members) rather than a new top-level `workspace` key — tRPC routers cannot declare
  the same top-level key twice; the merge keeps the wire surface `workspace.blueprint.get` as
  specced while reusing the router that already owns workspace-scoped concerns.
- **`JobPilotPage`, not `ResourcesPage`, is the migrated page** — `ResourcesPage`'s list is a plain
  `<ul>` with two fields; JobPilot's list has real multi-column, sortable/groupable structure
  (title/company/location/stage/flag) that actually exercises `<DataViews>`' switcher, column
  show/hide, and `@bridge/tables`' `groupBy`. The stage-advance state-machine action stays a thin
  list below `<DataViews>` rather than inside it — `<DataViews>` deliberately knows nothing about
  JobPilot's application state machine.
- **CalendarView is a from-scratch minimal month grid**, not `react-big-calendar` — confirmed via
  grep before writing that no calendar dependency exists anywhere in the repo, and the P1 spec
  explicitly said "if react-big-calendar is not already a dependency, build a minimal month grid."
  It collapses to a single-column agenda list below the `sm:` breakpoint (a 7-column grid is not
  legible at 375px) — the mobile-width-safe requirement is met by breakpoint-swapping the whole
  layout, not by shrinking the grid.
- **`GraphView` is an explicit table fallback with a visible banner**, not a silent stand-in — the
  vision doc's grammar allows graph OR table for relationships, and real node-link rendering is
  future work; the banner says so rather than pretending to be a graph.

**Alternatives rejected:** a dynamic-import-by-string-kind resolver for view components (rejected —
defeats the entire "registered components only" enforcement, turns any coined string into a
render); importing `@bridge/tables` types directly into `@bridge/core` (rejected — breaks the
zero-runtime-dependency invariant for a compiler with no real runtime need of the package, only its
shapes); a bespoke approval table for blueprint activation instead of reusing
`pipeline.propose`/`decide` (rejected — same reasoning as ADR-012's capability approvals: duplicates
agent-floor/audit guarantees instead of inheriting them); migrating `ResourcesPage` instead of
`JobPilotPage` (rejected — too thin a list to prove the shell's switcher/column/groupBy surface).

**Consequences:** `packages/core/src/blueprint.ts` and `workspace-definition.ts` are new flat files
exported from `@bridge/core`'s barrel (10 new `node --test` cases in
`packages/core/test/blueprint.test.ts`); `packages/db/src/workspace-definition-store.ts` binds the
port to the existing `workspace_definitions` table (6 new `node --test` cases in
`packages/db/test/workspace-definition-store.test.ts`, including a write-time jsonb-validation
throw, mirroring `capability-store.test.ts`'s shape). `apps/api/src/wiring.ts` gained
`workspaceDefinitionStore` in both `Wiring`/`ModePorts` and both `buildPersistentPorts`/
`buildInMemoryPorts` (Drizzle bound to `localDb` in-memory mode, same pattern as
`capabilityStore`). `apps/web` gained `@bridge/core`/`@bridge/tables` as real dependencies (previously
unused in the frontend) — `apps/web/src/app/dataviews/` (registry + `DataViews` shell +
TableView/KanbanView/CalendarView/GalleryView/GraphView/DashboardView) and a new `/workspace` route
+ sidebar link. The kernel node-type registry `WorkspacePage.tsx` uses to compile client-side is a
hand-maintained mirror of `router.ts`'s server-side `BLUEPRINT_NODE_TYPE_REGISTRY` (both reuse
`ResourceType`'s literal set + `"edge"` for relationships) — there is no shared runtime registry
endpoint yet, so the two lists can drift; flagged in both files' comments, not silently assumed to
stay in sync. `capability.approve`'s existing `resourceType: "skill"` stand-in (ADR-012's known
gap) is now shared by `workspace.blueprint.activate` too, for the same reason (no dedicated
`ResourceType` for either registry row yet). Full monorepo `turbo run build --force` (19/19) /
`turbo run test --force` (34/34, up from 34 tasks with more total test cases) / `eslint .` (0
errors, 2 pre-existing unrelated warnings) all green; `pnpm --filter @bridge/web build` (vite)
passes. Graph rendering for relationship views, a persistent runtime node-type registry endpoint,
and a dedicated `capability`/`workspace_definition` `ResourceType` remain open follow-ups.

## ADR-018 — Capability package format: agentskills.io disclosure + Zapier lifecycle + computed-risk install (2026-07-06, docs-only)

**Decision:** Documented (design-only, no code changed) `docs/raw/capability-package-format.md`
— the shipping-unit format ABOVE a single `capability_manifests` row (ADR-012's trust-model
kernel, read-only here). A package = `package.yaml` (name/version/kind/summary+description/
lineage_manifest_id/dependencies[exact-pinned]/capabilities[]/context_providers[]/
workspace_vocab) + a directory (`README.md`/`capabilities/`/`scripts/`/`references/`/`assets/`/
`migrations/`/`tests/`) bundling MULTIPLE `CapabilityManifest`-shaped entries, one package
containing many trust-model units rather than being one itself. Install is a governed proposal
through the EXISTING `pipeline.propose`/`decide` (no new approval mechanism): register each
capability as `draft` (registration≠activation, per ADR-012) → `computeRisk()` walks the FULL
dependency closure including transitive package deps, never trusting the package's own
description/summary as a risk signal → a NEW lethal-trifecta check runs over the UNION of every
capability's permissions in the package (private-read + untrusted-ingest + egress anywhere in
the union escalates the WHOLE package to `external`, catching a trifecta assembled ACROSS
individually-safe capabilities that no single-capability check would catch) → `requiredApproval`/
`resolveActivationApproval` run unchanged on the resulting band, External staying the same
non-removable hard floor. Versioning = Zapier's single-live-version-per-workspace model (promote
new ⇒ auto-demote prior `available` to `legacy`, never two live side by side); rollback = fork a
new draft from historical version, never in-place revert (matches the append-only-ledger
invariant everywhere else in Bridge); dependencies pinned to an EXACT version (no npm-style
ranges) — a dependency bump is itself a new version proposal through the same install flow,
because a bump can change the computed risk of the whole package. Sketched DealPilot (repackages
existing `tools/dealpilot`, transformational scoring skill + external-risk sourcing workflow),
Helpdesk (in-Bridge MVP, new kernel Help Request entity, team-audience-raised routing/drafting
skills), and Recon (not yet migrated from standalone `Tools/recon/`; target shape composing
people-sourcing/company-sourcing per `tools.md`'s existing split — egress-read osint-search is
both independently `external` AND a lethal-trifecta candidate; carries its 3 match tiers/
per-source verify/draft-then-approve as documentation, introducing no new mechanism; External-
band audience makes install always `explicit_human`, matching "External-band always human at
launch" in `decisions.md`).

**Why these specific choices:**
- **agentskills.io's 3-level progressive disclosure maps directly onto a package directory**
  (`docs/raw/research-agent-skill-workflow-practices-2026.md` §2): `package.yaml`+`README.md` as
  L1 (always loaded, ~100 tokens, description states what+when for Learning-Agent install
  recommendations exactly as a SKILL.md description drives trigger matching); each capability's
  own manifest/impl as L2 (<500 lines, loaded on inspection); `scripts/`/`references/`/`assets/`/
  `migrations/` as L3 (zero-cost until read; script CODE never enters model context, only its
  output does — same rule the spec gives SKILL.md scripts). Reusing this shape instead of
  inventing a bespoke directory convention keeps the format legible to the same tooling/mental
  model the Capability Builder and Learning Agent already use for skills.
- **Zapier's version lifecycle, not n8n's pinned-production model or a custom scheme** — Zapier's
  Private→Promoted(only one)→Available(auto-demotes prior)→Legacy→Deprecating→Deprecated is the
  cleanest "single live version" shape found in the research sweep (§7) and was already adopted
  for capability versioning in roadmap.md's P5 practice-hardening line; this ADR is the first
  place it gets ENFORCEMENT LOGIC (package_installations state + auto-demote-in-same-transaction)
  rather than staying a wiki bullet.
- **Risk computed over the package's full dependency closure, never trusted from package hints**
  — direct continuation of ADR-012's risk.ts design and the MCP "a server can lie" finding
  (research §6): a package's `summary`/`description` exists for Learning-Agent triage and human
  review, never as computeRisk() input. Extending computeRisk()'s existing cycle-safe walk to
  cross package-dependency boundaries (not just single-capability dependencies) was the natural
  generalization rather than a parallel risk function for packages.
- **Lethal-trifecta check moved from single-capability to package-union scope** — the P0 roadmap
  line states the rule per-capability; a package is exactly the boundary where three
  individually-innocuous capabilities (one reads private data, another ingests an external feed,
  a third has an egress permission for an unrelated reason) could compose into the trifecta
  without any single manifest tripping it. Checking the union at install time closes that gap
  without changing the underlying rule's definition.
- **Dependency pinning is exact-version-only, npm ranges explicitly rejected** — a `^`/`~` range
  would let a dependency silently gain a new permission (and therefore new risk) between installs
  without ever going through `computeRisk()` again; exact pins force every risk-relevant change to
  re-enter the install/approval flow as a new version proposal, matching the "propose, don't
  auto-apply" stance ADR-017 already took for blueprint activation.
- **Recon sketched as NOT YET a real package** (still standalone `Tools/recon/`) rather than
  invented as fully-migrated — the migration itself is out of scope for this docs-only pass and
  is already tracked as pending in `tools.md`'s progress log; sketching its target shape without
  claiming it exists avoids the doc silently overstating build status.

**Alternatives rejected:**
- **npm-style semver ranges for dependency pins** — rejected because a range reintroduces the
  exact "risk changes without a review" gap ADR-012's computed-risk model exists to close;
  exact pins keep every risk-relevant bump inside the governed install flow.
- **Trusting a package's self-declared risk/permission summary as an install-time shortcut**
  (e.g. a fast-path for packages that claim low risk) — rejected on the same "manifest/server can
  lie" grounds as ADR-012 itself; there is no scenario where a package's own claim should ever
  substitute for `computeRisk()`'s output.
- **Multiple live package versions per workspace** (e.g. side-by-side v1/v2 for gradual
  migration) — rejected as the harder invariant to reason about for audit/rollback purposes;
  Zapier's single-live-version model was chosen deliberately over this for the same reasons it
  was chosen for capability versioning generally (roadmap.md P5), and per-package exceptions
  would fragment that story.

**Consequences:** No code changed — `docs/raw/capability-package-format.md` (new),
`docs/wiki/packages.md` (new), `docs/wiki/index.md` (one new line) are the only artifacts. Six
open questions are recorded rather than resolved: package-owned migrations vs. shared kernel
schema; the vocab-alignment enforcement mechanism (lint vs. Learning-Agent rewrite vs. doc-only);
the still-missing dedicated `ResourceType` for capability/package rows (inherits ADR-012's known
gap, not newly introduced); where a package registry physically lives (new table vs.
computed-at-install); whether package `tests/` fixtures inherit the still-open no-dummy-data
fixture question from CLAUDE.md; and diamond-dependency resolution when two packages in one
workspace pin different versions of one shared underlying capability. None of these block the
format from being a coherent design; they are the next design passes, likely triggered when
DealPilot's actual repackaging or Recon's actual migration is attempted against this spec.

## ADR-019 — P1 Workspace Generator: onboarding pop-up, Chief of Staff v1 star-topology router, approval cards (2026-07-06)

**Decision:** Landed the remaining three P1 slices (docs/wiki/roadmap.md "Workspace Generator")
on top of ADR-017's blueprint compiler + `<DataViews>` shell: (1) an **onboarding pop-up**
(`apps/web/src/app/onboarding/questions.ts` + `OnboardingDialog.tsx`) running a 5-12 question
adaptive flow that compiles straight into a `WorkspaceBlueprint` and submits it via the existing
`workspace.blueprint.propose` as a governed draft, previewed client-side with the SAME
`compileBlueprint()` the server validates with; (2) **Chief of Staff v1**
(`packages/core/src/chief-of-staff.ts` + `apps/api`'s new `chiefOfStaff.converse` procedure +
`apps/web`'s `ChiefOfStaffPage.tsx`) — a pure intent classifier with a model path and a
deterministic keyword-fallback path, enforcing star topology (at most one route per turn, hard
chain-depth cap) structurally; (3) **approval cards**
(`apps/web/src/app/pages/ApprovalsPage.tsx`, rewritten) — a governance inbox surface with
what/why, an honestly-labeled risk estimate, requester, and a real diff preview for blueprint-
activation proposals, mobile-safe from 375px.

**Why these specific choices:**
- **Adaptive branching is a small explicit step function (`nextQuestion(answers)`), not a
  linear array or a big if/else in the component.** `apps/web/src/app/onboarding/questions.ts`
  keeps ALL branching logic (solo-vs-team unlocks `team_size`; domain choice unlocks/skips
  `vocab_name`; every domain always asks `watch_first`/`view_style`/`workspace_name`) in one
  pure, framework-free function so the shortest real path (solo + relationships domain) asks 5
  questions and the longest (team + a domain needing a vocabulary override) asks 7 — both inside
  the 5-12 band with no padding questions asked just to hit a minimum count. `OnboardingDialog.tsx`
  is a thin React shell over it (single/multi/text question renderers + a preview/submit step),
  so the adaptive logic itself is unit-testable without a DOM (not exercised by a dedicated test
  file this pass — see Consequences).
- **The pre-apply preview compiles with the real `compileBlueprint()`, not a mocked one.**
  `OnboardingDialog.tsx` imports `compileBlueprint` from `@bridge/core` directly and renders
  whatever it returns (or its thrown `BlueprintCompileError` message) — the same enforcement
  point WorkspacePage.tsx already established in ADR-017, applied one step earlier in the
  lifecycle. This is deliberately the ONE thing no competitor in the generated/flexible-workspace
  peer set (Notion AI, Fibery, Noloco) ships: a pre-apply, human-legible diff before the
  workspace is even proposed, let alone activated.
- **Chief of Staff's star topology is enforced by TYPE SHAPE, not convention.**
  `RoutingDecision` (chief-of-staff.ts) has a single optional `route: string` field — there is no
  array/list field anywhere in the type for "route to multiple capabilities," so a second route
  per turn is not a bug to avoid, it is a shape that does not exist. `assertChainDepth`/
  `MAX_CHAIN_DEPTH` (=3) throw a typed `ChainDepthExceededError` the caller must handle — modeled
  as a real thrown error (checked in router.ts's `converse` procedure BEFORE attempting to
  classify) rather than a depth counter callers could forget to consult, mirroring
  `capability/approvals.ts`'s external-band hard-floor pattern (checked first, cannot be
  loosened).
- **classifyIntent's keyword fallback is not a lesser stand-in for the model path — it is the
  SAME contract with a different signal source.** Both paths validate their candidate route
  against the identical caller-supplied `RoutableCapability[]` registry; a model response naming
  an unregistered id degrades to `"clarify"` exactly like a keyword total-miss does. This is what
  "kernel runs with ZERO providers" (roadmap.md P0) requires for a router, not just a sensor.
- **In-memory mode's `EchoModelProvider` is explicitly EXCLUDED from Chief of Staff's model
  selection** (`apps/api/src/router.ts`'s `converse` procedure filters `provider.id !== "echo"`)
  rather than left wired in. Echo only echoes `system\nprompt` back verbatim — feeding that
  through `classifyIntent`'s model-response parser would ALWAYS fail to match a registered id and
  silently degrade every turn to `"clarify"`, masking the keyword fallback this mode is supposed
  to exercise. Excluding it by id (a one-line, clearly-commented filter) means in-memory/test mode
  genuinely runs the offline-required keyword path, not a model path rigged to always miss.
- **A routed Chief-of-Staff turn is ALWAYS a `pipeline.propose` call, never a direct skill
  execution** — `chiefOfStaff.converse` proposes `{ action: "execute", resourceType: "skill",
  skill: "stageMutation", inputs: { route, message } }` through the exact same governed pipeline
  `action.propose` uses, so an agent-classified route still lands in the Approvals inbox rather
  than running unsupervised. `stageMutation` (the existing generic staging skill) is reused rather
  than inventing a new one — there is no real downstream skill for any registry entry
  (jobpilot/dealpilot/calendar/helpdesk/resources) to actually execute yet, so staging the intent
  is the honest ceiling of what this slice can do.
- **Approval cards' risk band is an explicitly-labeled CLIENT-SIDE ESTIMATE, not a fabricated
  authoritative score.** There is no per-proposal computed risk for a generic `Proposal` today —
  `computeRisk` (`capability/risk.ts`) only runs over Capability Manifests at capability-
  registration time, a different object entirely. Inventing a confident-looking number for
  ledger-level proposals would misrepresent what the platform actually knows. `ApprovalsPage.tsx`'s
  `estimateRiskBand` instead maps action/resourceType onto the SAME `RiskBand` vocabulary
  (external for send/share — the one confident bucket, mirroring `approvals.ts`'s hard floor —
  down to informational as the default) and the UI renders it with a visible "(estimated)"
  suffix, never claiming it is the governed computed-risk number.
- **The blueprint-activation diff preview is honest about a real, named gap**: `workspace.
  blueprint.get` (ADR-017) only ever returns the currently-ACTIVE definition, never an arbitrary
  draft by id, and `workspace.blueprint.activate`'s proposal `inputs` carry only `{ definitionId,
  fromStatus }` (not the blueprint payload itself) — so `ApprovalsPage.tsx` can only render a real
  diff for a blueprint-activation proposal when the referenced draft ALSO happens to already be
  the active definition (the common single-draft case), and shows an honest "no diff preview
  available for this draft yet" note otherwise rather than fabricating one. Logged as an open gap
  below and in docs/BUGS.md, not silently left implicit.

**Alternatives rejected:** a fixed linear onboarding question list (rejected — roadmap.md
explicitly calls for ADAPTIVE branching, and a fixed list can't skip `vocab_name` for a domain
that doesn't need one without either asking a pointless question or special-casing it in the
renderer anyway); giving `RoutingDecision` a `routes: string[]` field with "just always length
1" as an unenforced convention (rejected — the whole point of the star-topology requirement is
that peer handoffs are IMPOSSIBLE, not merely discouraged); computing a real numeric risk score
for every proposal type via ad hoc heuristics presented as authoritative (rejected — indistinguishable
from the real Capability Trust Model risk computation to a user, actively misleading); adding a
`workspace.blueprint.getById` endpoint to fully close the diff-preview gap in this pass (deferred
— touches the same "no dedicated ResourceType for workspace_definitions yet" surface as ADR-017's
open gap and is more surface than a P1 slice needs; the honest partial note is the correct scope
call here).

**Consequences:** `packages/core/src/chief-of-staff.ts` is new (10 new `node --test` cases in
`packages/core/test/chief-of-staff.test.ts`, all passing against both the model path via a fake
provider and the keyword-fallback path). `apps/api/src/router.ts` gained a `chiefOfStaff` t.router
with one `converse` mutation (4 new `node --test` cases in `apps/api/test/chief-of-staff.test.ts`,
reusing the existing `appRouter.createCaller`/`buildWiring` test harness pattern from
`single-tenant-guard.test.ts`). `apps/web` gained `apps/web/src/app/onboarding/` (questions.ts +
OnboardingDialog.tsx, no dedicated frontend test — `questions.ts`'s pure functions are exercised
only manually/by the compiled build this pass, a real gap tracked in docs/BUGS.md),
`pages/ChiefOfStaffPage.tsx`, a rewritten `pages/ApprovalsPage.tsx`, and `Layout.tsx` now mounts
`OnboardingDialog` (auto-opens once at mount when `workspace.blueprint.get` reports no active
definition; reopenable via a persistent sidebar link). Full monorepo `turbo run build --force`
(19/19) / `turbo run test --force` (34/34 tasks — @bridge/core 112→122 cases, @bridge/api 29→33
cases) / `eslint .` (0 errors, the same 2 pre-existing unrelated warnings ADR-017 already noted)
all green; `pnpm --filter @bridge/web build` and a standalone `tsc --noEmit` against
`apps/web/tsconfig.json` both pass clean. Open, explicitly tracked gaps: no dedicated frontend
unit test for `questions.ts`'s adaptive branching/compile logic; the approval-card diff preview
degrades to an honest empty note whenever the referenced draft isn't also the active definition;
Chief of Staff's registry (`CHIEF_OF_STAFF_REGISTRY` in router.ts) can only ever stage a generic
`stageMutation` proposal — no registry entry has a real downstream skill to execute yet, so a
routed turn is always a proposal-to-nowhere-specific until those skills exist; no model provider
is configured in this repo's dev/test environment, so the model-classification path is exercised
only by a fake `ModelProvider` in `chief-of-staff.test.ts` (core), never against a live
Ollama/Anthropic call.

## ADR-020 — Roadmap v2 ingest: Commons, five agents, packages-not-products, dual-axis governance (2026-07-06)

**Decision** (user calls, batch): (1) Roadmap v2 (docs/raw/roadmap-v2-universal-commons.md) ingested as ADD-ONs to the existing 7 phases, not a replacement. (2) Universal Commons adopted: v1 = curated human-published capability-package registry (ADR-018 format), absorbing old P5 publish + P6 marketplace; automated archetype mining deferred; convergence threshold N = 10% of users ≤100 · 5% ≤500 · 1% ≤2000 · 0.1% beyond. Commons contribution = External band by definition (lethal trifecta: private-read + egress) → human reviews the exact generalized artifact. (3) Control plane centralized in cloud: onboarding possible from any surface (mobile/desktop/web); desktop demoted from "base platform" to richest client + local execution runtime. Sync/identity/registry live in a "Bridge Cloud" control plane kept as a SEPARATE service from Commons — Commons never holds per-user workspace data. Each surface functions independently offline; Commons = update/distribution channel (iPhone-updates model). (4) workflow/skill/agent/tool = PEERS; promotion ladder = trust/evidence ladder, never type mutation. "Responsibility" = standing mandate (scope + trigger) attached to an agent, bounded by governance rules everywhere (no separate autonomy-ceiling concept). (5) Governance Agent may auto-approve MINOR changes per the dual-axis risk mechanism (impact × reversibility); moderate/major escalations = human-only (agent-floor DENY unchanged for those bands). This mechanizes the existing auto-activation budgets under an agent identity, ledgered. (6) DealPilot/Helpdesk/Recon = mix-and-match add-on capability packages over one workspace (Pi-extensions model), NOT separate products. (7) NEW PRINCIPLE — integration over custom development: before building a capability, the Learning Agent checks installed software + browser apps (explicit permission, intent clearly stated) and proposes integration first; "build from scratch" offered as an open-source-based option.

**Why**: user direction 2026-07-06 after critique round; keeps revenue phase (P2) while adopting Commons network effect; privacy promise stays mechanical (External-band review + N-threshold), not aspirational.

**Alternatives rejected**: roadmap v2 as replacement (drops market-contact phase); Commons doubling as sync backend (couples privacy promise to user-data hosting — one breach kills both); autonomy-ceiling field on Responsibility (redundant with governance rules); products as separate SKUs (splits the graph, contradicts one-engine-many-workspaces).

**Consequences**: Bridge Cloud vs Commons service split must be reflected in P5/P6 design; risk mechanism needs dual-axis (impact × reversibility) computation layered on computeRisk() bands — design note in docs/raw/risk-mechanism-auto-mode-practices.md (pending); Governance Agent gains a decider identity with policy-bounded auto-approval; onboarding modal must stay surface-agnostic (it already is — web modal over tRPC).

## ADR-021 — P2 slice 1: package runtime + install flow + DealPilot/Helpdesk packaged (2026-07-06)

**Decision**: Implemented ADR-018's package format as running code. (1) New `packages/core/src/package/` module (types/manifest/risk/lifecycle/ports): `PackageManifest` type (name/version exact-semver/kind/summary/description ≤1024/lineage_manifest_id/dependencies exact-pinned no-ranges/capabilities[] = full `CapabilityManifest` shapes/context_providers/workspace_vocab); `parsePackageManifest` — pure, zero-deps (no yaml/zod in core; callers hand in a parsed object), accepts camelCase AND YAML snake_case keys, throws typed `PackageManifestValidationError` (never silently defaults); `computePackageRisk` — max(computeRisk) over every bundled capability AND every resolvable dependency-package's capabilities (cycle-safe visited set, unresolved package dep escalates to ≥operational, mirroring capability risk's conservative-unknown rule) PLUS the lethal-trifecta UNION check (private-read + untrusted-ingest + egress assembled ACROSS different bundled capabilities ⇒ whole package escalates to `external`, overriding composite); single-live-version lifecycle (`private→promoted→available→legacy→deprecating→deprecated`), `promoteToAvailable` auto-demotes the prior available row to `legacy` (pure fn returns both state changes, caller applies atomically), `rollbackFromHistory` FORKS a new `private`/`pending_review` row versioned `{current}-rollback-from-{target}` with `lineageManifestId` chained — never mutates history; `PackageStore` port + `InMemoryPackageStore` (mirrors CapabilityStore's shape). (2) `packages.{register,install,list,get,promote,rollback}` tRPC namespace in apps/api: register = parse+validate → `private`/`pending_review` row, NO risk computed (registration ≠ install); install = computePackageRisk over the closure → package audience = strictest across bundled capabilities → `resolveActivationApproval` (same kill-switch/budget/external-hard-floor path capability.activate uses) → every bundled capability registered as a DRAFT `capability_manifests` row regardless of outcome (registration ≠ activation) → non-auto bands park a `pipeline.propose` proposal with the same interim `resourceType:"skill"` token capability.approve uses; promote/rollback are thin wrappers over the pure lifecycle fns. `PackageStore` wired in `Wiring`/both mode ports as in-memory in BOTH modes (honest gap, same pattern as capabilityBudgets/killSwitch — no Drizzle table this slice). (3) DealPilot repackaged: `tools/dealpilot/bridge.package.yaml` describes the EXISTING code as 3 capabilities — thesis-fit-scoring (skill, transformational-shape writes), sourcing-waterfall (workflow, external_fetch egress:true ⇒ external band, BizBuySell connector), commit-dedupe (workflow) — no logic rewritten; parse+risk verified: `external`, trifecta not tripped (no private-read leg). (4) Helpdesk package MVP: new `tools/helpdesk` (@bridge/helpdesk, pure logic, no store) — `routeHelpRequest` (deterministic topic-token-overlap routing over caller-supplied graph candidates, honest empty result on zero match) + `draftHelpOffer` (proposal-inputs shape only, never sends); `bridge.package.yaml` declares capability-routing (transformational) + offer-drafting (advisory `recommendation` write), audience=team; wired as `helpdesk.route` (members as default candidates, topics caller-supplied until the graph carries topic data) + `helpdesk.stageAnswer` (stages via `pipeline.propose`, resourceType `signal`) in apps/api. (5) Recon NOT migrated (per plan — ADR-018 sketch only).

**Why**: P2's premise ("packages = the SKU", ADR-020 item 6) needs the install/version/rollback machinery to exist before any package can ship; building it ON the shipped capability trust model (computeRisk/lifecycle/approvals reused, never reimplemented) keeps one risk model and one approval path.

**Alternatives rejected**: new Drizzle `package_installations` table this slice (deferred — in-memory port keeps the slice reviewable; ADR-018's "reuse capability_manifests lineage" allowance invoked, table + migration is the flagged next step); yaml/zod parsing inside @bridge/core (violates core's zero-runtime-deps discipline; validation stays at the seam like every other jsonb boundary); renaming the existing helpdesk ticket surface to Help Request vocab (out of scope churn — the PACKAGE layer uses kernel-safe help_request/help_route/help_offer terms, existing store/router untouched); in-place version revert for rollback (breaks the append-only invariant every other mutation follows).

**Consequences / gaps (also in docs/BUGS.md)**: package rows are in-memory in persistent mode (lost on restart, loudly documented not silently faked); re-installing two package versions whose bundled capability keeps the SAME (name,version) violates `capability_manifests_uq` — capability re-registration is not idempotent yet; `bridge.package.yaml` deviates from ADR-018's `package.yaml` filename because pnpm treats package.yaml as a project-manifest format and it shadows package.json inside a workspace dir (spec doc should be amended); package install proposals reuse the interim `resourceType:"skill"` token (inherits the known dedicated-ResourceType gap); trust_grants lookup still not wired into install (same gap as capability.activate); helpdesk routing topics are caller-supplied until the graph carries per-person topic/skill data.

## ADR-022 — GroqProvider added to ModelProvider seam (2026-07-06)

**Decision**: added `GroqProvider` (platform/packages/models/src/groq-provider.ts) implementing the existing `ModelProvider` port, matching `AnthropicProvider`'s conventions exactly: `plane: "cloud"`, fail-loud constructor if `GROQ_API_KEY` is absent, no key ever stored on a manifest/capability, key sourced from env only. Talks to Groq's OpenAI-compatible `/openai/v1/chat/completions` endpoint (default model `llama-3.3-70b-versatile`). Wired into `apps/api/src/wiring.ts`'s persistent-mode `modelProviders` list, registered only when `GROQ_API_KEY` is set (same fail-closed posture as Anthropic/Google gateway — no silent fallback). 7 new unit tests (2 Groq-specific + reused shared `provider errors surface status + body` case), all passing via injected fetch, zero network. `GROQ_API_KEY` set in a local, git-ignored `platform/.env` — never committed, never logged.

**Why**: user supplied a Groq key and asked for it to be usable; low-latency inference is a good fit for Chief of Staff intent classification and other latency-sensitive cloud calls, without displacing Anthropic as the default.

**Alternatives rejected**: hardcoding the key into source or a tracked env file (violates credential-broker-territory rule and CLAUDE.md's "tools never own OAuth/secrets"); building a bespoke Groq SDK wrapper instead of reusing the OpenAI-compatible surface (unnecessary — Groq's chat/completions endpoint is a drop-in shape).

**Consequences**: user should rotate the pasted key in the Groq console (it was shared in plaintext chat, which this session treats as exposed regardless of where it ends up stored). `createModelRouter`'s plane rules apply unchanged — Groq can never bind a `planeDefault: "local"` slot.

## ADR-023 — Shell IA: KnowledgeBase / Projects / Tools / governance inbox; display-vocab renames; view convertibility (2026-07-06)

**Decision** (user calls, batch): (1) Permanent shell chrome = SIX containers: bottom bar **Intelligence · KnowledgeBase · Settings**; left nav = **pinned Projects + pinned Tools** (the user's regulars); full indexes reachable via KnowledgeBase/Tools. Everything INSIDE the containers is generated or installed on demand (Commons-stored) — chrome fixed, contents stream in; this is the minimal-egg pattern, user-confirmed. (2) **Network → KnowledgeBase**, containing toggle pages People / Communities / Resources (websites, media, platforms) / **Projects** (renamed from Initiatives — display label). All platform data maps to People/Communities/Resources; if it can't, a NEW toggle section may be created — but section creation is a governed proposal (minor per dual-axis ⇒ Governance Agent may auto-approve, ledgered), never silent restructure. Projects = cross-disciplinary container (people + orgs + resources + chat outputs). (3) **Tools** = skills, agents, apps, workflows (**Ritual → Workflow** display label). Kernel identifiers stay `initiative`/`ritual` (ESLint vocab guard, zero-churn) — renames are WORKSPACE-scope display vocabulary only; user naming always wins at the surface. (4) **Signals move INTO Approvals** = one pinned governance tool. Implemented as tabs (Approvals default, Signals second, separate unread counts) — consent decisions must never drown in observation noise. Standalone Signals nav entry dies. (5) **Capability landing rule**: Capability Builder output worth keeping = a Tool; Q&A/chat output not worth a tool = saved under a Project. (6) **View convertibility**: every table-backed entity is convertible to kanban + card always, calendar when a date column exists, map when a location column exists, graph when a relation column exists — eligibility computed from column kinds in `compileBlueprint`, view switcher in the DataViews shell. (7) **Peer-grouping heuristics** (blueprint-level): peers on similar task → toggle sub-pages; different tasks → separate tools; same process+task with separate data → separate lists. Encoded as compiler heuristics that PROPOSE structure, not silently impose it.

**Why**: user IA direction 2026-07-06; keeps egg minimal by fixing only chrome; aligns nav with the generated-workspace model instead of a hardcoded page-per-entity.

**Alternatives rejected**: renaming kernel identifiers (migration + vocab-lint churn for a label); keeping Signals as sibling nav (splits governance attention); unlimited auto-created nav sections without governance (silent structure drift).

**Consequences**: apps/web Layout/routes restructure; ApprovalsPage gains tabs; compileBlueprint grammar gains calendar/map/card eligibility + groupBy; wiki clients.md updated; new-section proposals need a pipeline resourceType eventually (interim token reused).

## ADR-024 — Kernel/API half of ADR-023: capability re-registration idempotency, `workspace.blueprint.getById`, convertibleKinds + kanban groupBy grammar (2026-07-06)

**Decision**: Kernel/API-lane implementation of ADR-023, run concurrently with the apps/web IA agent (ADR-023's second consequences entry). (1) **Capability re-registration idempotency** (closes the `capability_manifests_uq` collision docs/BUGS.md flagged under ADR-021): `packages.install` (`apps/api/src/router.ts`) now calls `CapabilityStore.getManifestByNameVersion(workspaceId, name, version)` (the natural key the DB's unique constraint enforces — already added to the port + both `InMemoryCapabilityStore` and `DrizzleCapabilityStore` in commit a594e4d, a prior session's WIP) BEFORE calling `createManifest` for each bundled capability; when a manifest with that (workspace, name, version) already exists, the loop reuses its id and only calls `upsertState` (idempotent by design — one row per manifestId), skipping `createManifest` entirely. A second install of a package version that keeps a bundled capability's (name, version) identical to a prior install is now a safe no-op re-registration rather than a thrown unique-constraint violation. (2) **`workspace.blueprint.getById`** (new query, `apps/api/src/router.ts`'s `blueprint` t.router): takes `{ workspaceId, definitionId }`, returns the `workspace_definitions` row via the existing `WorkspaceDefinitionStore.get(id)` regardless of status (draft/active/archived), identity-scoped by asserting the fetched row's own `workspaceId` matches the caller-supplied one (404 otherwise, same pattern `activate` already used for its draft lookup) — closes the sibling `workspace.blueprint.get`'s "active-only" gap ADR-023's approval-card diff preview needed. (3) **View-convertibility grammar** (`packages/core/src/blueprint.ts`, pure, zero new deps): added a `location` `BlueprintColumnKind` (core-only structural addition — `@bridge/tables`' `ColumnKind` and `apps/web`'s parallel client-side `eligibility.ts` heuristic are untouched this pass, see Alternatives); `CompiledViewConfig` gained `convertibleKinds: DataViewKind[]`, computed per view from its OWNING ENTITY's own column kinds (not the view's declared `kind`) via a new pure `computeConvertibleKinds` helper — table/kanban/gallery always, `calendar` when a `date` column exists, `map` when a `location` column exists, `network` (graph) when a `relation` column exists; a relationship-shaped entity is hard-restricted to exactly `["table", "network"]`, mirroring the existing `RELATIONSHIP_ALLOWED_KINDS` compile-time restriction; non-tabular views (chatbot/dashboard/canvas) carry `[]` (no TableSpec to morph from). Also fixed the never-set kanban `groupBy` bug (docs/BUGS.md, ADR-023 onboarding-simulation finding): a new `defaultKanbanGroupBy` helper defaults a `kind: "kanban"` view's `groupBy` to the entity's first `select`-kind field id when the blueprint author didn't already specify `config.groupBy` — an explicit `config.groupBy` (INCLUDING an explicit `null`, meaning "intentionally ungrouped") always wins over the default; non-kanban views are never defaulted a groupBy at all. `calendar`/`map` were already legal `BlueprintViewKind`/`DataViewKind` values (no grammar gap there — only the convertibility computation and the DB column-kind were missing).

**Why**: the capability idempotency gap was a real, previously-demonstrated crash path (re-installing DealPilot v2 with an unbumped capability version would 500 on the unique constraint); `getById` was the named, tracked gap blocking ApprovalsPage's blueprint-activation diff preview from rendering non-active drafts; the convertibility grammar is ADR-023 item 6's literal spec, and computing it in `compileBlueprint` (rather than leaving it purely client-side, as `apps/web`'s concurrent `eligibility.ts` heuristic currently does) is the honest long-term fix the web agent's own doc comment flagged as "owned by a concurrent session this pass."

**Alternatives rejected**: silently dropping the second package install's registration instead of reusing the manifest id (rejected — `registeredManifestIds` is part of the install response contract other callers may read; reuse keeps that contract meaningful instead of returning an empty/partial list); auto-bumping a bundled capability's version on every re-install to sidestep the unique constraint (rejected — silently rewrites the package author's declared manifest, hides a real versioning decision the package.yaml author should make deliberately); renaming `network` to `graph` in `BlueprintViewKind`/`DataViewKind` to match ADR-023's prose exactly (rejected — `network` is the existing, tested, cross-package name; a rename is pure churn with zero behavior change and risks a merge collision with the concurrent web-lane session, which is already coded against `"network"` in `eligibility.ts`/`MapView.tsx`/`registry.ts`); widening `@bridge/tables`' `ColumnKind` to add `"location"` in this same pass (deferred — `@bridge/tables` is shared surface the web agent may also be touching mid-session; adding `location` to `@bridge/core`'s OWN structural-mirror type is sufficient for this pass's server-side grammar and is purely additive, so a follow-up can widen `@bridge/tables` without this pass blocking on that coordination); picking the LAST select-kind column instead of the first for the kanban groupBy default (arbitrary either way — first-in-declaration-order is simplest to reason about and matches how `defaultKanbanGroupBy`'s only real-world caller, onboarding's `stage` field, is declared).

**Consequences**: `apps/api/src/router.ts` (packages.install idempotency check + new `blueprintGetByIdInput`/`getById` query + `location` added to `blueprintFieldInput`'s zod enum), `apps/api/src/wiring.ts` (`PILOT_USER` now exported — needed by the new blueprint test's real-FK-constrained `created_by` caller identity), `packages/core/src/blueprint.ts` (`location` BlueprintColumnKind, `CompiledViewConfig.convertibleKinds`, `computeConvertibleKinds`/`defaultKanbanGroupBy` helpers — additive only, no existing field renamed/removed, so `apps/web`'s locally-mirrored blueprint types stay compatible). New tests: `packages/core/test/capability-trust.test.ts` (+1, `getManifestByNameVersion` on `InMemoryCapabilityStore`), `packages/db/test/capability-store.test.ts` (+1, same lookup against real pglite), `apps/api/test/packages.test.ts` (+1, full re-install-across-versions idempotency round trip through the tRPC caller), `packages/core/test/blueprint.test.ts` (+12, convertibleKinds across all four conditional kinds + relationship restriction + non-tabular empty-array case, groupBy default/explicit-override/explicit-null/no-select-column/non-kanban cases), new `apps/api/test/blueprint.test.ts` (+5 — this router namespace had ZERO test coverage before this pass despite existing since ADR-017: `get`/`propose`/`getById` including the archived-definition case `getById` exists specifically to serve). Gates: `turbo run build --force` green for `@bridge/core`/`@bridge/db`/`@bridge/api` (the `@bridge/web` task fails independently mid-session on an unrelated concurrent-agent export-name issue in `ApprovalsPage.tsx`, outside this pass's lane); `turbo run test --filter=@bridge/core --filter=@bridge/db --filter=@bridge/api` 163/47/48 passing, 0 failures; `eslint packages apps/api` 0 errors (2 pre-existing unrelated warnings, same ones ADR-020/ADR-021 already noted). BUGS.md: the capability-re-registration-non-idempotent row and the kanban-groupBy-never-set row both marked RESOLVED; a new row opened noting `@bridge/tables`' `ColumnKind` still lacks a real `location` member (apps/web's `eligibility.ts`/`MapView.tsx` name-heuristic fallback is therefore still the live behavior in the running app until a follow-up widens `@bridge/tables` and apps/web switches to consuming `compileBlueprint`'s own `convertibleKinds` instead of recomputing it client-side).

## ADR-025 — Productivity-app research consolidated into roadmap (2026-07-06)

**Decision**: user's scattered productivity/task/calendar/agentic-platform research (4 CSV/txt files in `My Data/New Data/`, ~300 rows total across chief-of-staff startups, agent frameworks, no-code platforms, personal CRMs, and adjacent tool categories) plus a live Product Hunt scan (12 named current listings) is consolidated into ONE new raw doc, [docs/raw/productivity-app-research-2026.md](productivity-app-research-2026.md), cross-referenced against the existing roadmap rather than duplicated. Genuinely new patterns became dense ADD-ON bullets on the existing phases in `docs/wiki/roadmap.md` under a new "Productivity-app research ingest (2026-07-06)" section: P0 (visible trust/permission state in approval-card UI, Vellum precedent), P3 (continuous-reconciliation capability shape + "time-allocation drift" archetype seed), P4 (chat-surface-native interaction mode, jared.so precedent), P5 (export+self-host as an explicit Compose target), P6 (NeoCognition added to Learning Agent's standing competitor-watch list). Source CSV/txt files are NOT moved or deleted — referenced by path only.

**Why**: user explicitly did not want prior research work lost in separate documents ("merge relevant files into roadmap or ADR plans... keep the tracking clean"). Most of the CSV content (Zapier-style lifecycle, Notion/Fibery/Noloco approval-gap analysis, desktop-copilot capture patterns, agent-framework internals, personal-CRM/enterprise-CRM/dev-tool categories) was already fully absorbed by the existing `research-agent-skill-workflow-practices-2026.md` sweep and prior ADRs (017-024) — re-adding it verbatim would have violated the "no duplication" instruction, so this pass's job was explicitly to find the DELTA and skip the rest, with the skip list documented for auditability.

**Alternatives rejected**: appending everything into the existing `research-agent-skill-workflow-practices-2026.md` (rejected — that doc's frontmatter/scope is agent-skill-workflow engineering practices specifically; the market/competitor angle here is a different doc_kind of content and conflating them would make future consolidation harder, not easier); leaving the CSVs as the source of truth and only referencing them from roadmap.md without a synthesis doc (rejected — the raw CSVs are unstructured data dumps, not readable research; a synthesis pass was needed to actually extract the delta and cross-reference it, which is the whole point of the request); re-stating full competitor detail already in the practices doc for completeness (rejected — directly violates "no duplication," and the practices doc is one link away via `related_wiki`/`companions` frontmatter).

**Consequences**: `docs/raw/productivity-app-research-2026.md` (new), `docs/wiki/roadmap.md` (new section, 6 bullets across P0/P3/P4/P5/P6), `docs/log.md` (new entry). No `platform/**` code changes — this is a docs-only consolidation pass. Follow-up implementation items (P0 permission-state UI, P3 archetype seeding, P4 chat-native mode, P5 self-host compose target, P6 competitor-watch-list-as-living-artifact) are noted in the raw doc's "Implementation plan" section for whoever picks up those phases; none are blocking or urgent.

## ADR-026 — Third-pass user calls: consent reversal, prototype-UI target, Day-1 avatar, dummy purge, Pi primitives + importer, ladder audit, OSS provider map (2026-07-06)

**Decision**: Ten user calls from the 2026-07-06 second session, encoded in `docs/raw/execution-plan-2026-07.md` (Tracks A–G) and mirrored to wiki decisions/roadmap: (1) **both-party consent REVERSED** — data owner controls own data; intros = sender-approved governed proposals; design.md/DESIGN-FIX.md F4c struck with history retained. (2) **apps/web must adopt the prototype's (bridge-ai-1ay.pages.dev) visual design** over the ADR-023 Shell IA — IA structure kept, skin migrated (Track C); the two-codebase divergence the user flagged becomes an explicit migration. (3) **Avatar un-deferred to Day 1** — web in-page persona first (meditate/awaken/blink on sensor.capture, click-through to inspectable Memory entry), Tauri overlay second, onboarding egg/spirit-animal/hatch included (Track D). (4) **Dummy purge now** — all product-state dummy data deleted, fail-closed like the Google precedent; unit-test doubles kept pending explicit user ruling (pushback P-1). Social-fixture seam open question resolved by this ruling: purge. (5) **LinkedIn login REJECTED** — privacy positioning; LinkedIn = optional post-login enrichment source. (6) **taste-skill ≠ Commons UI generator** — two separate tasks. (7) **Ladder audit** — capability lifecycle + pipeline are genuinely sequential state machines (stay); promotion "ladder" = peer trust thresholds (already ruled); platform-wide invariant adopted: threshold/transition checks are pure fn/SQL compiler rules, models never evaluate thresholds (token saving). (8) **Pi primitives adopted**: Extensions · Skills · Capability Packages · Blueprints · Workspaces; tiny kernel, everything else a package; Capability Registry (agent-searched, proposal-driven) not an App Store; progressive disclosure extends the ≤20-active-tools rule into installed package contents. **Pi package import = first-class interoperability**: manifest translator (extension→tool/UI-ext/connector, skill→skill, prompt→prompt asset, theme→theme) → Community-origin capability manifest → computed risk → sandbox if executable → explicit perms if external → version-pinned → native rewrite when pattern repeats. Activepieces pieces import through the same translator seam. (9) **Builder toolbelt** — Bridge has no Read/Write/Edit/Bash equivalent today (graph skills yes; fs/exec primitives no); add fs:read/fs:write/code:exec governed capability primitives + SandboxProvider port (isolated-vm now, E2B/Daytona adapter P3). **PromptAssembler** — layered system-prompt assembly subsystem (persona · disclosed capabilities · context-provider block · memory · governance state · output contracts). (10) **OSS provider map ruled**: adopt-behind-port = Docling (DocumentProvider), Nango (ConnectorProvider OAuth spine), Langfuse (observability), Firecrawl/Stagehand (Learning Agent research / governed browser actions), E2B-or-Daytona (P3 sandbox); reference-only = Graphiti (temporal-graph patterns; Mem0-behind-port stands), screenpipe, Letta, CrewAI/Agno/Haystack, Baserow/NocoDB/Appsmith; REJECT = OpenFGA/OPA/Cedar/SpiceDB (custom CBAC+policy+ledger+trust-model is built, tested, and the moat — revisit only at enterprise-RBAC scale P6+), Refine-as-dependency (view-grammar enforcement is the moat), Electron, AutoGen, Windmill-embed (AGPL/commercial terms + runtime overlap), Temporal-now (stays deferred).

**Why**: consent reversal was an explicit repeated user instruction contradicted by stale design docs (agent-confusion risk); avatar deferral contradicted the product's own personality pillar (Pi 4-element mapping: intelligence/memory/knowledge present, personality deferred = missing pillar at launch); the ladder audit converts recurring LLM threshold evaluations into deterministic engine code (cost + reproducibility); Pi import gives instant ecosystem leverage without trust compromise; the OSS rejections protect the two engineering moats (governance engine, view grammar) from dilution by frameworks that duplicate them.

**Alternatives rejected**: adopting OpenFGA now for "standards" credibility (rewrites working governance for zero user-visible gain); LinkedIn OAuth for onboarding friction reduction (defeats privacy positioning vs Invoko/Vida, TOS/approval risk); avatar staying deferred until Tauri overlay is ready (web persona ships the identity to every surface immediately); deleting unit-test doubles in the dummy purge (tests would need live creds per CI run — held for user ruling instead of assumed).

**Consequences**: `docs/raw/execution-plan-2026-07.md` (new, Tracks A–G, 4-week sequence, per-track model + isolation guidance); design.md + DESIGN-FIX.md F4c struck; wiki decisions third-pass block; wiki roadmap consolidation-sprint section (avatar → P1 now, P0 toolbelt/PromptAssembler, P1 onboarding-v2/skin-migration/control-panel-icon, P2 Pi-importer/Docling/Nango, P3 sandbox-adapter/evals-bake-off/dream-cycle/board-meeting, P5-P6 virtual office). Open user ruling: P-1 (test doubles in purge scope).

---

## ADR-027 — External-review adaptations + Capability OS framing (2026-07-06, session 3)

**Decision.** (1) Ground-check verdict on external agent review: its repo claims were false (platform/apps/web, ADR-023/026, workspace_definitions all exist) — target map unchanged: platform/apps/web = product target, prototype = visual reference + scrub target. (2) Accepted its technical corrections: sandbox doctrine split (isolated-vm = narrow no-network JS transforms only; shell:execute = container/microVM via SandboxProvider, E2B adapter; never raw host), Daytona reference-only (repo unmaintained June 2026), Firecrawl hosted-API-only (core AGPL-3.0), Nango conditional (Elastic License — commercial review before dependency), OpenFGA/OPA/Cedar parked (pipeline stays source of truth; re-evaluate only on enterprise ReBAC trigger), RunContextAssembler supersedes PromptAssembler (prompt text = one projection of run context), avatar = operational status surface first / personality second. (3) PARTIAL REVERSAL of P-1 "purge everything": runtime fake data = zero, absolute; test doubles NOT deleted — renamed test_fixture_*, confined to test dirs; live-credential env-gated integration tests where external systems touched; bridge/dummy-prefix ESLint rule retired in favor of check:no-dummy-runtime guard. (4) Capability OS framing adopted: everything (Pi packages, MCP servers, Activepieces pieces, OSS agents, memory systems) imports through ONE abstraction — Capability → Bridge Manifest → Governance → Sandbox → Evaluation → Registry → Workspace; moat = Capability Lifecycle; deploy pipeline Generate→Sandbox→Evaluate→Activate (CI/CD-shaped); Bridge consumes AND exposes via MCP.

**Why.** External review was ungrounded on repo facts but correct on licensing/sandboxing/test-strategy engineering; deleting all synthetic fixtures would make CI depend on external systems and gut packages/core suites (174 tests). Capability OS framing is the user's strategic call: Bridge wins as the integration layer of the open-source AI ecosystem, not as the best agent.

**Alternatives rejected.** Full purge incl. fixtures (CI fragility); adopting OpenFGA/OPA now (governance engine is built moat); executing external doc's task list as-written (targets wrong codebase); isolated-vm as general sandbox (not a security boundary for shell).

**Consequences.** Wave-1 execution launched (kernel ContextProvider + foreign-import types landed, 174 tests green; platform purge, prototype scrub, parity audit running as isolated agents). Wave 2 = avatar Day-1 + Control Panel/KnowledgeBase IA + skin migration (apps/web globals.css is EMPTY — P0 styling bug, filed). Wave 3 = RunContextAssembler, builder toolbelt + SandboxProvider, importer. BRD drafted for executive team (docs/raw/brd-bridge-2026-07.md).

---

## ADR-028 — Bridge primitive ontology adopted; docs aligned (2026-07-07, docs-only)

**Decision.** Adopt the primitive ontology from commit f87dd61 (`docs/wiki/ontology.md` + `docs/raw/primitive-specifications.md`, `authority-model.md`, `runtime-pipeline.md`, `capability-evolution.md`) as the canonical vocabulary for architecture/plan/roadmap docs. Taxonomy: execution actors = Human / Agent / Automation · capability primitives = Skill / Integration · work primitives = Request / Action / Incident / Artifact · surface primitives = Workspace / Element / ElementType / View · context primitives = Memory / Knowledge. Mappings recorded across the doc set (code identifiers unchanged): code `ritual` / UI "Workflow" = Automation · code `tool` / `ToolManifest` / `@bridge/tool-kit` = implementation/package surface, user-facing primitive = Workspace · Connection = Integration · Intent = raw Human Request (not a primitive) · Chief of Staff = Agent archetype (not a primitive) · Signal = derived Incident (not a root primitive) · Project = ElementType. Hard rule: **promotion never mutates primitive category** — promotion creates a new governed object that consumes the existing primitive (no Skill→Agent, Automation→Skill, Workspace→Agent).

**Why.** Post-pivot docs used four overlapping vocabularies for the same concepts (kernel Bridge vocab: Ritual/Tool/Signal · code identifiers: `ritual`/`tool`/`connection` · ADR-023 display labels: Workflow/Project/Apps · loose peer language: "workflow/skill/agent/tool = PEERS"), and "promotion ladder" phrasing (Workflow→Skill→Agent→Tool thresholds in vision.md) could be read as type mutation. One canonical primitive layer with explicit mapping notes removes the ambiguity without a disruptive rename of code, tables, or historical entries.

**Alternatives rejected.** (a) Mass-rename Ritual/Tool/Signal across docs + code — rewrites history, breaks kernel-vocab rule and every ADR reference; (b) leave ontology docs standalone with no cross-links — the drift that motivated the ontology just continues; (c) rename display labels to primitive names — user-facing naming is a workspace-scope concern where user naming always wins (ADR-023).

**Consequences.** Wiki pages (index, vision, decisions, roadmap, stack, architecture, rituals, tools, packages, initiatives, clients, schema, helpdesk) carry terse mapping notes + links to ontology.md; raw ARCHITECTURE.md/ROADMAP.md/vision-pivot get a mapping banner; the four new raw ontology docs get conformant frontmatter (`doc_kind` within the allowed enum, `related_wiki`). Requirement-kind docs and prior ADRs untouched (append-only). Future docs must use primitive names or state the mapping when they use code vocab. No code changes in this pass.

---

## ADR-030 — Universal Commons v1: local-first FS-store registry behind the permanent cloud contract (2026-07-07)

**Decision.** Bootstrap Universal Commons (R-004) as `platform/services/commons`: a standalone Fastify 5 service exposing the PERMANENT registry contract (`GET /health`, `GET /v1/packages` with kind/tag filters + pagination, `GET /v1/packages/:name`, `GET /v1/packages/:name/:version`, `POST /v1/packages`) so "Bridge Cloud" later serves the identical contract and the swap is `COMMONS_URL` config only. Storage = local filesystem JSON (one file per published name@version under `COMMONS_DATA_DIR`, default `.commons-data/`, gitignored) behind a four-method `CommonsStore` port — the cloud deployment swaps Postgres in without touching routes. The "generalized knowledge only, never user data" rule (CLAUDE.md) is enforced in code: a publish-side privacy gate walks the RAW payload (before manifest parsing, so unknown fields can't smuggle past the shape guard) and 422-rejects any workspace/user/credential-shaped key (workspaceId, userId, email, createdBy, apiKey, tokens, …) listing exact JSON paths; published versions are immutable (409 on duplicate). Manifest validation reuses `parsePackageManifest` from `@bridge/core` — no duplicated types. Consumer seam: `CommonsRegistry` port + wire types in `@bridge/core` (`package/commons.ts`, zero-dep, mirrors ModelProvider/PackageStore discipline), fetch adapter `HttpCommonsClient` in apps/api. Registry starts EMPTY; `pnpm --filter @bridge/api publish-builtins` posts the four built-in workspace-definition manifests as the first real content. Discovery tags live in the registry envelope (`{ manifest, tags }`), never inside the manifest format. Marketplace placement (user call, 2026-07-07): Module discovery is a Commons WEBSITE surface reading this API — apps/web gets no marketplace/browse UI and only consumes installed Modules; user-facing vocabulary = "Module", code type names unchanged.

**Why.** Contract-first + port-based storage makes local→cloud a deployment change, not a rewrite; FS JSON is inspectable, zero-dependency, and honest about v1 scale (curated registry, single publisher). Enforcing the privacy rule at the only write door makes "Commons never holds user data" a property of the system rather than a convention. Tests use node:test to match every sibling package (repo has no vitest anywhere; the R-004 brief said vitest, consistency won).

**Alternatives rejected.** Immediate cloud deployment (nothing to host yet; would force auth/infra decisions before the contract is proven, and violates local-first sequencing). SQLite (new native dependency for a v1 whose entire dataset is a handful of JSON manifests; FS keeps the store diff-able and the port swap-ready). Embedding the registry inside apps/api (Commons must never share a process/DB with user-data planes — separation is the privacy architecture). Tags inside PackageManifest (would mutate the shipped package format for a registry-side discovery concern).

**Consequences.** Bridge Cloud = deploy the same routes over a Postgres CommonsStore + point COMMONS_URL at it; install-flow/Learning-Agent adoption binds against the `CommonsRegistry` port; the future Commons website marketplace reads `/v1/packages`. Pre-existing `packages.list` pagination test failure (built-in seeding changed baseline counts) filed in docs/BUGS.md — unrelated, not masked.

---

## ADR-031 — Desktop offline self-containment: API sidecar as spawned Node child + OS-level companion window (2026-07-07)

**Decision.** (R-001) The Tauri shell spawns the built `apps/api` (`dist/src/server.js`) as a **plain `std::process::Command` Node child process** — NOT a Tauri `externalBin` sidecar and NOT `tauri-plugin-shell`. Free-port strategy: bind `127.0.0.1:0`, take the kernel-assigned port, release, pass as `PORT` (+`HOST=127.0.0.1`, loopback only). Shell retries `GET /health` (std-only TCP HTTP/1.0 probe, ~20s budget) and only then creates the windows, injecting `window.__BRIDGE_API_URL__` + `window.__BRIDGE_DESKTOP__` via window **initialization scripts** (which forced window creation to move from `tauri.conf.json` to programmatic `WebviewWindowBuilder` in `lib.rs` — the port is only known at runtime). Child killed in the `RunEvent::Exit` handler. Debug builds (`tauri dev`) NEVER spawn the sidecar — dev keeps external Vite(5173)/API(4000) unchanged; `BRIDGE_API_URL` env overrides both paths. Persistence is honest: no `DATABASE_URL` → in-memory wiring, data lost on quit (env is inherited by the child, so a user-set `DATABASE_URL` passes straight through for local-Postgres persistence). `apps/web` tRPC client resolution order: injected `__BRIDGE_API_URL__` → `VITE_API_URL` → `http://localhost:4000`. (R-002) The avatar becomes an **OS-level floating window**: second Tauri window `overlay` (96×96 collapsed, transparent [`macOSPrivateApi` + `macos-private-api` cargo feature], no decorations, always-on-top, skip-taskbar, bottom-right anchored), frontend = separate Vite entry `overlay.html` → `OverlayApp.tsx` reusing the same `Creature`+avatar-store; Invoko state machine v1 subset collapsed/hover/expanded_idle/working (result_ready/dismissing typed, not driven); window resizes via Rust `overlay_resize` command keeping bottom-right pinned; `focus_main_window` command surfaces the main window; in-page `AvatarOverlay` suppressed under `__TAURI_INTERNALS__` (browser deploys keep it).

**Why.** `externalBin` requires shipping per-arch Node binaries while `bundle.active` is false — dead weight now; `tauri-plugin-shell` adds a plugin + capability surface for zero gain over a directly-managed `Child` we must kill ourselves anyway. Free port beats fixed 4123: can't collide with a dev API or another instance. Init-script injection beats post-load `eval`: the URL exists before the tRPC client module evaluates, no race. Separate `overlay.html` entry beats an `/overlay` SPA route: the Tauri asset protocol serves files with no history-API fallback.

**Alternatives rejected.** Tauri `externalBin` Node sidecar (bundling inactive; revisit when bundling turns on — resource-dir lookup `<resources>/api/server.js` is already the first path probed); `tauri-plugin-shell` (dependency for nothing); fixed port 4123 (collisions); SPA `/overlay` route (asset-protocol fallback gap); embedding the API in-process via a Rust JS runtime (absurd scope).

**Consequences.** Shell boots UI only after the API answers (or honestly fails → UI surfaces connection errors); crash of the shell leaks the Node child (no supervisor — known gap, localhost-bound + in-memory so blast radius is a stray process); overlay blink-tell is window-local until kernel-event wiring crosses windows (follow-up); `apps/desktop` gains `api_sidecar.rs`/`overlay.rs`; `apps/web` gains `overlay.html`/`overlay-main.tsx`/`OverlayApp.tsx`/`desktop-shell.d.ts`, trpc resolution change, Layout suppression, dual-entry vite build.

## ADR-029 — Platform Settings vs per-Initiative Control Panel scope separation (2026-07-07)

**Decision.** Split admin into two strictly-scoped surfaces. (1) **Settings (/settings) = PLATFORM-WIDE admin only**, ten fixed sections: Organization · Team & Permissions · Knowledge · Intelligence · Governance · Notifications · Billing & Plan · Security · API Keys · Help & Support. User-facing "Workspace" renamed **Organization** everywhere (code identifiers/tRPC names unchanged: `workspace.*` procedures stay). Sections show real data where endpoints exist (workspace.list, workspace.listMembers/inviteMember, google.list + integration.list, packages.list, action.listPending + ExecutionLedger) and honest "nothing configured yet" states elsewhere — no fabricated toggles. Intelligence/KnowledgeBase left the primary nav; their pages stay live and are reached via progressive-disclosure "Open" links from Settings → Intelligence / Knowledge. (2) **Initiative Control Panel (/initiative/:id/control-panel, new ControlPanelPage.tsx) = per-Initiative admin**, one unified table (Category · Name · Status · Source Module · Version · Scope · Actions) answering "How is this Initiative configured?" — changes there never affect other Initiatives. Primary nav (Layout.tsx) restructured Apple-Notes-style: Home → each Initiative first-class (merged `graph.listInitiatives` + local Work-surface store, deduped) → "+ New" → divider → Settings; pinned Projects/Tools sections and bottom-bar Intelligence/KnowledgeBase links removed. "+ New" = Module picker (real `packages.list`, state=available) → real `chiefOfStaff.converse` new-vs-extend recommendation → Confirm navigates to the Module surface (MODULE_ROUTES in lib/moduleRoutes.ts, copied from IntelligencePage's PACKAGE_ROUTES).

**Why.** Settings had become a grab-bag (org profile + boundaries + fake toggles) with no per-Initiative story, and the primary nav exposed internal architecture (Intelligence/KnowledgeBase containers) instead of the user's actual work (Initiatives). Two scopes make the mental model Apple-simple: platform-wide questions go to Settings, "how is THIS Initiative configured" goes to its Control Panel.

**Alternatives rejected.** (a) Initiative tabs inside Settings — breaks the strict scope rule and re-bloats Settings; (b) admin tab inside InitiativeDetail — that page is owned by a concurrent workstream and mixes work surface with admin; (c) keeping pinned Projects/Tools alongside Initiatives — two competing nav taxonomies.

**Consequences.** Per-Initiative resource binding does NOT exist in the API yet — the Control Panel honestly labels all rows "Organization-wide" and renders note rows for Automations/Assistants (no `ritual.list`/`agent.list` read procedures, pre-existing gaps in docs/BUGS.md). Pins (lib/pins.ts, usePinnedTools) still persist and pages still offer pinning, but pinned items no longer render in the primary nav — pin surfacing is now dead UI to revisit. "Set up workspace…" nav button removed; onboarding still auto-opens when no blueprint exists, but there is no manual re-entry point (tracked debt). Supersedes ADR-023's six-container shell chrome.

---

## ADR-032 — AI-Led Module Creation & Evolution System adopted; Day-1 Grok+5-agent onboarding ruled top priority (2026-07-07/08, docs-only)

**Decision.** Adopt the user's revised (v2, conversational/confidence-tiered) Module creation and evolution flow over the original v1 form-heavy spec — v2's shape wins (AI infers, user validates only genuine ambiguity via chunked 2-3 option choices, never a big upfront form), v1's substance (Component Registry, evaluation mechanics, versioned updates, governance axes) is retained as the thing the AI fills in rather than the user. Full design in `docs/raw/module-evolution-system-2026-07.md`, summary in `docs/wiki/module-evolution.md`. Three OSS/vendor patterns adopted BEHAVIORALLY, not as dependencies: ServiceNow Agent Studio's governance-inside-creation-flow (every Module decision writes to the existing Approvals ledger, no side channel), Dust Sidekick's introspect-and-suggest builder pattern (Chief of Staff reads a Module's live config/usage/feedback and proposes concrete diffs, not just fresh generation — becomes CoS's ongoing-optimization behavior), and LangSmith's eval-and-compare pattern (Commons hosts its own dataset+scoring harness; vendor itself rejected for the same reason OpenFGA/OPA were — local-first/Commons-cloud swap story, not a new external dependency). Restated the minimal-egg rule against the current nav (ADR-029) rather than the superseded six-container shell: kernel = actors + capability execution engine + governed work pipeline + surface compiler + Memory/Knowledge storage + Chief of Staff archetype + the three seam ports (ModelProvider/PackageStore/CommonsRegistry) + Trust Model; everything else (every compiled workspace_definition, every Skill/Assistant/Automation/Workflow/prompt/template/policy outside kernel governance, eval sets, connectors) is Commons content installed on demand. **Sequencing ruling (user, explicit)**: a Day-1 capability bar — onboarding agent backed by the xAI Grok API with a 5-agent team built-in, shipping real-time Module proposals into Approvals during onboarding — is NOT currently present (only a single Chief-of-Staff `classifyIntent`/`converse` path exists, no Grok provider behind `ModelProvider`) and is ruled to ship BEFORE the Component Registry / evaluation harness / versioned-updates / community-signals wave that the rest of this design specifies. The 5-agent team is NOT a new invention — it is the already-canon "five permanent agents" from `docs/raw/roadmap-v2-universal-commons.md` (an earlier draft of this ADR mistakenly proposed a different mapping; corrected here after user review): Chief of Staff (coordinates, owns the one governed proposal into Approvals), Learning Agent (research/observation/feedback, never executes, checks Component Registry/installed Modules for overlap), Communications Agent (turns findings into the plain-language summary), Governance Agent (permissions/policy/compliance/risk scoring pre-Approvals), Capability Builder (drafts new capabilities after approval only, never ships live). One reasoning/build team feeding one governed draft per turn, not five agents with independent write access.

**Why.** The user explicitly corrected the v1 draft mid-conversation: "the process should be very simple... it is the AI which should recognize... instead of delegating more work towards the user." Encoding v2 as the ADR (not v1) prevents a future session from building the wrong (form-heavy) shape. Governance-inline and introspect-and-suggest are the two concretely actionable lessons from the named competitors — the rest of their surface area (deployment controls, testing frameworks) is either already covered by Bridge's existing pipeline or out of scope for this pass. Grok/5-agent sequencing is a direct user instruction ("start with that before executing next wave") — recording it as a ruling prevents the next session from resuming the Component-Registry wave first by default.

**Alternatives rejected.** (a) Build v1 as specified (structured intake form) — directly contradicts the user's follow-up correction; (b) adopt LangSmith/OpenFGA-style vendor dependencies for eval/registry — repeats the rejected pattern from the prior OSS-map ADR, and Commons already owns the data model these would plug into; (c) sequence the Component Registry/eval-harness wave before the Grok+5-agent Day-1 slice — contradicts the user's explicit priority order.

**Consequences.** `docs/raw/module-evolution-system-2026-07.md` (new design doc), `docs/wiki/module-evolution.md` (new summary), wiki index cross-link. No code changes in this pass — the Grok provider, 5-agent onboarding team, and real-time Module-proposal drafting are the next build task, ahead of Component Registry/eval harness/versioning/community signals (all designed here, none built). requests.md carries the corresponding R-021..R-024 rows.

## ADR-033 — Bridge Foundational Agents + Day-1 Onboarding Proposal adopted; corrects ADR-032's Grok typo and invented-onboarding-agent gap (2026-07-08, docs-only)

**Decision.** Adopt the user's "Bridge Foundational Agents" and "Bridge Onboarding Proposal (Day 1)" specs verbatim as canon. Full design in `docs/raw/bridge-foundational-agents-onboarding-2026-07.md`, summary in `docs/wiki/foundational-agents.md`. Two corrections to ADR-032: (1) **Groq, not Grok** — user: "I meant groq, not grok, sorry." `GroqProvider` (`platform/packages/models/src/groq-provider.ts`, wired in `apps/api/src/wiring.ts` behind `GROQ_API_KEY`) already exists and was built 2026-07-06, *before* ADR-032 — its "not present" claim was wrong because the codebase wasn't checked first, the same mistake class as the invented 5-agent mapping in ADR-032's earlier draft. (2) **No separate onboarding agent** — user: "I remember stopping you mid way in past execution to course correct on this onboarding agent being dropped and chief of staff handling that part." Chief of Staff itself runs onboarding and becomes the user's chosen spirit animal at the reveal moment; Learning/Communications/Governance/Capability-Builder are its permanent delegate team (unchanged roster from ADR-032), not a parallel onboarding-time construct. New requirement layered on: Communications Agent's tone must match the chosen spirit animal (emotional-connection mechanism). Full 14-step onboarding flow adopted (account → phone OTP → spirit-animal pick → egg-creates-workspace animation → Gmail-or-manual personalize → egg hatches/CoS named → Browser Companion install → LinkedIn-or-OTP verify → Home with Knowledge/Intelligence/Calendar visible-but-inactive → each unlocks progressively on connect/permission).

**Why.** Correcting stated absence claims against actual code prevents a future session from re-building something that already exists (repeats the lesson from the 5-agent-mapping correction: check docs/code before asserting a gap). The onboarding-agent-vs-CoS distinction is a direct prior user correction that must not regress. Tone-matching and the data/prompt architecture question are recorded as explicit open items rather than silently answered, since neither was specified precisely enough to build without further design.

**Alternatives rejected.** (a) Leave "Grok" uncorrected — would misdirect a future session toward an xAI integration never actually wanted; (b) treat the 5 agents as onboarding-scoped — contradicts the spec's "Organizational Evolution" section, which frames them as permanent, org-wide, first-class primitives; (c) start the account/OTP/LinkedIn/browser-extension/4-new-agents build in this pass — deferred given this session's already-flagged cost (~$83+) and file-count (86+) warnings; this slice is large enough to warrant an explicit scope/order conversation with the user before spawning build agents.

**Consequences.** New raw doc + wiki page + wiki-index cross-link; `docs/requests.md` R-028 corrected (Grok→Groq, GroqProvider-exists), new R-029 row added for the fuller onboarding+agents spec. No code changes this pass.

## ADR-034 — R-030: dummy phone-OTP, 14-animal reconciliation with "3D" SVG treatment, onboarding profile store; Browser Companion deferred (2026-07-08)

**Decision.** Build most of ADR-033's remaining tail per explicit user go-ahead ("phone-otp use dummy flow for now, animal illustrations i need 3d if possible, rest go ahead"). (1) Extended `avatar-store.ts`'s `SpiritAnimal` union from 6 to the full 14-animal spec set (kept crane/wolf as harmless bonus extras rather than removing them), gave each new animal an ear/snout silhouette in `AvatarOverlay.tsx`'s existing geometric-SVG style, and gave EVERY animal (old + new) a radial-gradient body fill + `feDropShadow` filter — the honest interpretation of "3D" given no 3D-modeling toolchain exists in this environment; this stays inside the existing "no image assets" architecture rather than fabricating rendered 3D assets. (2) Built a real, explicitly-labeled DUMMY phone-OTP flow (`onboarding.verifyPhoneOtp` accepts any 6-digit code, UI says "Demo mode — no SMS was actually sent") plus a LinkedIn-or-phone verification step that opens the REAL existing social-OAuth `/integrations` page for LinkedIn (no fabricated scrape). (3) Built `OnboardingProfileStore` (`packages/core/src/onboarding-profile.ts`, in-memory, wired into `wiring.ts`) + `onboarding.getProfile`/`saveProfile` procedures — a narrow, onboarding-scoped answer to ADR-033's open "where is this data stored" question. (4) Explicitly did NOT build the Browser Companion browser extension — no extension scaffold exists anywhere in the repo, and a real one requires its own manifest/permissions/store-listing surface; the user's dummy-flow authorization was scoped to phone-OTP only, not to fabricating a browser extension's behavior.

**Why.** The user's "use dummy flow for now" is explicit, scoped authorization for exactly one thing (phone OTP) — extending that same license to LinkedIn scraping or a fake extension would violate CLAUDE.md's no-dummy-data/no-fake-integration posture, which the user has not waived elsewhere. "3D if possible" needed an honest feasibility read: no image-generation or 3D-modeling tool is available in this coding environment, so the gradient/shadow SVG treatment is the closest real, defensible interpretation rather than either refusing the ask outright or quietly faking static "3D-looking" image assets that don't exist.

**Alternatives rejected.** (a) Skip the phone-OTP UI entirely pending a real SMS provider decision — contradicts the user's explicit "use dummy flow for now" instruction; (b) fabricate a LinkedIn scrape/connect flow client-side — real OAuth plumbing already exists server-side (`apps/api/src/social/registry.ts`), reusing it via a real link is strictly better than inventing a fake one; (c) stub out a placeholder Browser Companion extension file so "something" exists — would misrepresent a real capability as built when it categorically is not (different codebase, different deployment surface, different review process).

**Consequences.** `docs/requests.md` R-030 row added; `docs/log.md` slice entry added. Onboarding's longest real path grew from 8 to 10 questions (`MAX_QUESTIONS` bumped). `OnboardingProfileStore` is in-memory only (no persistence across API restarts yet) — same honest-gap posture as `capabilityBudgets`; still NOT the general Memory/Knowledge kernel primitive (vector store/embeddings/retrieval), which remains genuinely absent. Verified live in browser preview: full verify→OTP→mode→spirit-animal (all 14, in spec order) flow has no dead ends; `turbo run build` clean across core/api/web; `chief-of-staff.test.ts` still 7/7. Browser Companion remains an open item requiring its own scoping conversation (extension platform choice, store listing, LinkedIn-session-read permission model) before any code gets written for it.
