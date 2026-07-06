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
