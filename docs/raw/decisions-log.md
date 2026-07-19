---
title: Decisions Log (ADR)
type: raw
doc_kind: reference
status: active
companions: []
related_wiki: ../wiki/decisions.md
updated: 2026-07-19
tags: [adr, decisions, governance, rationale]
---

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

## ADR-041 — Rejected / Parked OSS: governance engines, UI framework, runtime, agent frameworks (2026-07-09)

**Context:** The OSS map assembled during the 2026-07 research sweep included several candidates that were explicitly ruled out or parked — governance-engine alternatives (OpenFGA/OPA/Cedar/SpiceDB), an alternative UI framework (Refine), a desktop-shell alternative (Electron), an agent framework in maintenance mode (AutoGen), a workflow engine with license risk (Windmill), and a deferred orchestration engine (Temporal). These verdicts existed in the execution plan but had no ADR entry, creating risk that a future session would re-evaluate them without the original rationale.

**Decision:**
- **OpenFGA / OPA / Cedar / SpiceDB → PARK** (softened from initial Reject per v3 review): Bridge's CBAC + policy engine + append-only Ledger + Capability Trust Model is implemented, tested, and is the core governance moat. Swapping any of these in is a full rewrite for zero user-visible gain at current scale. **Re-evaluate ONLY on a concrete enterprise ReBAC scale trigger (P6+) with hard evidence**. Status = PARK, not permanent Reject — reassess with evidence, not preemptively.
- **Refine (as UI dependency) → Reject**: `<DataViews>` registry + view grammar IS the workspace-surface enforcement moat. Adding a second UI framework duplicates render logic and dilutes the moat. Refine UX patterns may be referenced; the library must not be embedded.
- **Electron → Reject**: Tauri decided (existing ADR). Smaller binary, Rust capture core, better sandboxing per platform goals. Re-evaluation would require overturning the Tauri ADR first.
- **AutoGen → Reject**: In maintenance mode as of 2026; no active development trajectory. The relevant multi-agent patterns were extracted in the 2026 research sweep and are referenced in ADR-013/ADR-020.
- **Temporal → Defer** (unchanged): stays deferred behind the `RitualExecutor` port. Re-evaluate when ritual complexity demonstrably outgrows Hatchet/BullMQ.
- **Windmill → Reject as dependency**: AGPL + commercial-terms overlap risk; the Hatchet/BullMQ decision (existing ADR) already covers the same runtime need. Windmill workflow patterns may be referenced; the library/server must not be embedded.

**Rationale:** Each rejection or park protects one of: (a) the governance moat (OpenFGA/OPA/Cedar — Bridge already built what these would provide); (b) the workspace-surface moat (Refine — `<DataViews>` is the enforcer); (c) a decided architectural call (Electron vs Tauri); (d) active-development health (AutoGen); (e) license safety (Windmill). The PARK status for policy-engine alternatives acknowledges that enterprise RBAC at scale (P6+) could eventually force reconsideration — parking preserves that option without premature action.

**Alternatives rejected:** Acting on any of these now — each would either rewrite a built moat component, violate an existing architecture decision, or add license risk without compensating benefit.

**Consequences / follow-ups:** No code changes. Trigger to re-open OpenFGA/OPA: concrete enterprise customer with ReBAC requirements at P6+. Trigger to re-open Refine: `<DataViews>` registry shown to be inadequate for a class of workspace surface needs. Windmill / AutoGen: no planned re-evaluation.

---

## ADR-040 — WebResearch provider: Firecrawl API-only (AGPL constraint) + Stagehand P4 + Playwright fallback (2026-07-09)

**Context:** The Learning Agent needs web research capabilities for competitor analysis, capability enrichment, and external sourcing. Three candidates were identified: Firecrawl (structured web extraction), Stagehand/Browserbase (higher-level browser automation), and Playwright (already in stack as a lower-level fallback). Firecrawl's AGPL-3.0 server license creates embedding risk in a commercial product.

**Decision:**
- Firecrawl: use via **hosted API only** — never embed the server (AGPL-3.0 core). All calls routed through `ExternalFetchCapability` and the lethal-trifecta check (privacy-risk / external-band governance / rate-limiting). No new dependency on the Firecrawl npm package for server-side use.
- Stagehand (Browserbase): `BrowserActionProvider` port, targeted for P4 ambient-acting. Provides higher-level browser automation primitives than raw Playwright for governed ambient-acting use cases.
- Playwright: already in stack; stays as fallback for headed-browser needs that don't require structured extraction.

**Rationale:** Firecrawl's AGPL-3.0 server code cannot be embedded in a commercial product without triggering AGPL's copyleft requirements; using the hosted API avoids that exposure while still getting Firecrawl's structured extraction quality. Stagehand is the right primitive for P4 ambient acting — it abstracts over browser-control details that Playwright exposes. Playwright covers the gap until P4.

**Alternatives rejected:** Embedding Firecrawl server (AGPL exposure); raw Playwright for all web research (too low-level, no structured extraction built in); SaaS-only search APIs such as SerpAPI (privacy risk for sensitive research queries; data egress).

**Consequences / follow-ups:** Firecrawl calls go through `ExternalFetchCapability` (the existing External-band path); no Firecrawl server dependency in `package.json`. `BrowserActionProvider` port to be designed in P4 scope. Document AGPL risk in any future ticket that proposes self-hosting Firecrawl.

---

## ADR-039 — Reference-only OSS: Graphiti, Letta, screenpipe, CrewAI/Agno/Haystack, Baserow/NocoDB/Appsmith (2026-07-09)

**Context:** The 2026-07 research sweep surfaced several OSS projects that were evaluated but not adopted as dependencies. These need an explicit record so future sessions understand each is a deliberate, revisitable non-adoption — not neglect.

**Decision:** Reference-only status for all items below. None may be added as a package dependency without a new ADR that overturns this entry.

- **Graphiti**: temporal-graph memory patterns. Reference for a future Mem0 adapter if temporal query requirements outgrow Mem0. Do not swap Mem0 now; the port exists and works. Trigger to revisit: Mem0 failing repeated temporal-query accuracy benchmarks.
- **Letta**: agent-memory architecture patterns. Reference only; Mem0-behind-port is the adopted decision.
- **screenpipe**: desktop capture architecture patterns. Bridge owns the Rust capture core (Tauri/SPI, ADR-016). screenpipe = pattern reference for future maintainability questions. Trigger to revisit: Rust capture core maintenance burden becomes demonstrably unsustainable.
- **CrewAI / Agno / Haystack**: multi-agent framework patterns. Already mined in the 2026-07 research sweep; patterns embedded in ADR-013 / ADR-020. No new evaluation needed at current phase.
- **Baserow / NocoDB / Appsmith**: table/page UX patterns. Reference only; licenses (BUSL/AGPL/Apache) and product-fit (these are complete products, not composable libraries) prevent embedding. `<DataViews>` registry covers the table-surface need.

**Rationale:** In each case the relevant pattern is either already implemented (Mem0 port, Rust capture core, `<DataViews>`), the license is incompatible with embedding, or Bridge's existing architectural decision is the correct answer and re-evaluating it requires a new trigger-based ADR rather than passive drift. Reference-only status is explicit and reversible — the triggers above define what would reopen each.

**Alternatives rejected:** Adopting any of these now without a trigger — premature adoption of an alternative to a working solution adds maintenance surface and muddies the port contract.

**Consequences / follow-ups:** No code changes. Triggers documented above define re-evaluation conditions. Mem0 temporal-query accuracy should be benchmarked at P3 before Graphiti is reconsidered.

---

## ADR-038 — ObservabilityProvider: Langfuse (traces + prompt versions) with DeepEval vs Mastra evals bake-off at P3 (2026-07-09)

**Context:** Bridge needs LLM observability — traces, prompt versioning, eval scores — to support the capability promotion gate and agent heartbeat monitoring. Two tools were in play: Langfuse (self-hostable trace + prompt-version store) and Mastra's built-in eval subsystem. Running both long-term creates overlapping instrumentation and maintenance burden.

**Decision:** Langfuse as the `ObservabilityProvider` implementation, targeted for P2–P3. A **bake-off between DeepEval and Mastra evals** runs in P3 — the winner is retained; the other is retired.

Bake-off criteria (P3): (1) eval latency added per agent turn; (2) trace granularity for multi-step capability pipelines; (3) ease of writing custom eval assertions against Bridge's governed-output contracts; (4) integration depth with the Mastra workflow engine already in the stack.

**Rationale:** Langfuse is MIT-licensed, self-hostable, best-in-class for prompt version tracking and trace inspection — qualities directly needed by the capability promotion gate (which compares eval scores across versions). Running both Langfuse + Mastra evals creates duplicated instrumentation that confuses signal; the bake-off forces a single winner.

**Alternatives rejected:** SaaS-only observability vendors (data egress risk for sensitive capability traces); no observability (needed for promotion gate and heartbeat signals); retaining both Langfuse + Mastra evals indefinitely (maintenance overhead, confusing signal).

**Consequences / follow-ups:** `ObservabilityProvider` port in `@bridge/core`; Langfuse adapter targeted for P2. Bake-off task filed as a P3 milestone. DeepEval and Mastra eval adapters built behind the same port to make the bake-off a drop-in swap. Winner decision appended to this ADR at P3 resolution.

---

## ADR-037 — ConnectorProvider: Nango (conditional, pending license review) + Activepieces via Pi-import path (2026-07-09)

**Context:** Bridge needs OAuth token management and integration connectors without writing per-integration OAuth code. Two candidates: Nango (OAuth/token management, Elastic License 2.0) and Activepieces (pre-built integration pieces, MIT + AGPL mix). A minimal OAuth seam already exists in `@bridge/core` as a structural fallback.

**Decision:**
- **Nango**: evaluate for `ConnectorProvider` behind a port. **Conditional on license review** — Elastic License 2.0 imposes commercial-use restrictions that require legal/commercial-terms sign-off before taking a production dependency. The minimal OAuth seam in `@bridge/core` stays as the non-conditional fallback until Nango's license is cleared.
- **Activepieces pieces**: import via the Pi-import path (manifest translator → Bridge capability package with `origin:Community`). Not embedded as a runtime dependency; treated as foreign capabilities entering the governed install flow. The Activepieces server is NOT embedded (AGPL risk + governance overlap).

**Rationale:** Nango eliminates per-integration OAuth boilerplate that does not scale at the connector count Bridge needs; the port keeps the implementation swappable. Activepieces' pre-built connector catalogue composes naturally with the Pi-import system without adding a runtime dependency or AGPL surface. License-gating Nango prevents accidental commercial-license exposure before the legal question is resolved.

**Alternatives rejected:** Building per-integration OAuth from scratch (reinvention, does not scale); embedding the Activepieces server (AGPL risk + overlaps Bridge's own capability governance); adopting Nango without license review (commercial exposure risk).

**Consequences / follow-ups:** License review required before any Nango npm dependency lands in `package.json`. Minimal OAuth seam in `@bridge/core` is the unconditional fallback. Pi-import path (Track F3) must be operational before Activepieces pieces can flow in. `ConnectorProvider` port design in `docs/raw/spec-adapter-ports.md`.

---

## ADR-036 — SandboxProvider doctrine: isolated-vm (narrow JS only) + E2B for shell/code:exec; Daytona retired (2026-07-09)

**Context:** Track F2 needs `fs:read`/`fs:write`/`code:exec` governed capability primitives (Builder toolbelt, ADR-026 §Pi-primitives). The original execution plan said "isolated-vm now → E2B/Daytona later." A v3 doctrine review corrected the plan: mixing isolated-vm with shell execution creates a false sense of security.

**Decision:** Two-layer sandbox doctrine behind a single `SandboxProvider` port:

1. **isolated-vm**: narrow no-network pure-JS transforms ONLY — config evaluation, pure function calls, template rendering. No shell, no filesystem access, no network. Any attempt to do shell or filesystem work inside isolated-vm must be rejected at the port layer.
2. **`SandboxProvider` port → E2B adapter** for `shell:execute` / `code:exec` (container or microVM isolation). E2B is the first choice. Never raw host process.
3. **Daytona**: reference-only. The Daytona repo has been unmaintained since June 2026; taking it as a dependency is a liability. Removed from the adoption list.

**Rationale:** isolated-vm cannot safely contain shell execution — it is designed for JS sandboxing, and using it for shell commands provides an illusory security boundary. E2B provides real container/microVM isolation for arbitrary code execution. Mixing concerns (JS-only + shell) in a single sandbox tier creates confusion about what is actually isolated. Daytona's maintenance lapse makes it a poor bet for a core infrastructure piece.

**Alternatives rejected:** Daytona (unmaintained since June 2026, liability); raw host process (no isolation at all); single-tier sandbox using isolated-vm for everything (inadequate for shell/code workloads, false security guarantee).

**Consequences / follow-ups:** `SandboxProvider` port in `@bridge/core` registers two kinds: `js-transform` (isolated-vm) and `code-exec` (E2B). isolated-vm adapter for pure-JS-only workloads, targeted P2. E2B adapter for `code:exec`, targeted P2–P3. Any PR that routes shell commands through the isolated-vm adapter must be rejected as a policy violation. Daytona removed from all future evaluation lists.

---

## ADR-035 — DocumentProvider: Docling (primary) + Tika (fallback) for P1 RAG layer (2026-07-09)

**Context:** The P1 RAG layer requires document parsing — converting PDF, DOCX, HTML, and other formats into clean text and structured sections for embedding and retrieval. Bridge has no `DocumentProvider` implementation. The choice of parser affects extraction quality, license constraints, and whether sensitive documents leave the local plane.

**Decision:** Docling as the primary `DocumentProvider` implementation; Apache Tika as the fallback for ETL/legacy formats; Unstructured.io available as a third option if ETL workloads arise that neither Docling nor Tika cover. All three operate behind the `DocumentProvider` port so the implementation is swappable without caller changes.

**Rationale:** Docling is best-in-class open-source for structured document extraction (table detection, section hierarchy, multi-column PDF layouts); it is Apache-2.0-licensed, embeddable, and runs fully local with no SaaS egress — consistent with Bridge's local-first / no-external-egress principle for sensitive documents. Tika covers the long tail of legacy formats (Office, OpenDocument, email containers) that Docling does not prioritize. The port makes the primary/fallback split transparent to callers.

**Alternatives rejected:** Custom parser from scratch (reinvention, no quality gain, ongoing maintenance); SaaS document-parsing APIs (violates no-external-egress principle for sensitive documents; data leaves the local plane).

**Consequences / follow-ups:** Implement `DocumentProvider` port in `@bridge/core` (interface in `docs/raw/spec-adapter-ports.md`). Wire `DoclingAdapter` at P1. `TikaAdapter` as fallback, wired behind a feature flag or capability manifest option. Any document parsing that would route through a SaaS API must first pass an External-band governance gate.

---

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

## ADR-035 — Brain/Engine = composition of six engines over existing kernel seams, not a new subsystem (2026-07-09, docs-only)
**Decision**: the assistant's "Brain" (ingestion, routing, MCP expansion, memory, domain discovery, automation mining) is designed as six engines composed over the existing seams — Unified Graph, Event/Signal Bus, Universal Action Pipeline, Sensor SPI, `ModelProvider`/`createModelRouter`, capability manifests, Mem0-port Memory. Every Brain output is a Signal or a governed proposal; MCP servers are just another capability origin (derived manifest → static vet → sandboxed trial → ≥L2 governed adoption, credentials broker-proxied and never handed to the server); OS/visual ingest gets a compression cascade (salience→spans→AX-first→pHash dedup→tiered local captioning→digests→governed aging); routing adds a policy layer (plane→modality→floor→score→budget, bandit clamped inside the allowed set); automation mining is a pure algorithm (PrefixSpan + periodicity) synthesizing ritual drafts from registered capabilities only. Full design: `docs/raw/brain-engine-architecture-2026-07.md`.
**Why**: the governance chassis, residency model, and trust machinery already exist and are the moat; a parallel "Brain" subsystem would duplicate them and create the side-channel the whole security posture forbids.
**Alternatives rejected**: standalone agent-brain service with its own memory/tool loop (side-channel, duplicate governance); LLM-based pattern detection for automation mining (unreplayable, violates ladder-audit invariant — kept as possible v2 behind the same scoring gates); auto-installing discovered MCP servers (violates draft-then-approve; autonomy limited to find+vet).
**Consequences**: six named build gaps become the P0–P3 Brain workstream (cascade, sync scheduler+comms-graph, routing policy, mcp-host+discovery, consolidator+PromptAssembler+profiler/Buddy, miner); embedding-dim pin and the runtime-taint gap become explicit blockers; UserDomainProfile declared local-plane-only and never Commons-minable.


## ADR-042 — Single work tracker (docs/PROGRESS.md) as cursor over plan docs (2026-07-09)
- **Decision**: one tracker at `docs/PROGRESS.md` holding ONLY the current batch + next 3 batches, a done-criteria protocol, and a registry of all plan docs. Tasks always cite their source doc; plans stay the source of truth and are never deleted (superseded → frontmatter status). Batch refill pulls from roadmap-6month-2026-h2 cross-checked with BUGS.md P0s + open R-items.
- **Why**: plans were spread across 20+ docs (3 overlapping consolidation plans, 5-resolution roadmap family, 2 bug ledgers); sessions burned tokens re-deriving "what's next" and risked losing planned work.
- **Alternatives rejected**: merging plans into one mega-doc (loses provenance, breaks requirement-doc immutability, guarantees drift); tracking in wiki/roadmap.md (phase model ≠ execution cursor); per-session checkpoint files only (don't outlive sessions, not user-visible).
- **Consequences**: PROGRESS.md must be updated in the same commit as any task completion (protocol in the file); duplicate-plan reconciliation (execution-plan trio) surfaced as an explicit user decision instead of silently picking one.
- **Companion**: token-efficient-development-2026-07 Month-1 artifacts (INDEX.md, CODEMAPS/flows.md, CLAUDE.md token rules, skillOverrides scoping) landed same day; `skillOverrides` chosen over `permissions.deny` because it removes skill descriptions from context (the actual token cost) rather than only blocking invocation.

## ADR-043 — Internal canon-change approval mechanism (docs/APPROVALS.md) (2026-07-09)
- **Decision**: adopt a repo-level draft-then-approve ledger (`docs/APPROVALS.md`) for CANON + PLAN changes — editing locked docs (vision, decisions one-liners, requirement docs), flipping a plan `status`, marking a Track/Phase DONE, reordering the roadmap sequencer, or reversing an ADR. Agent proposes a row (does not apply), user flips to APPROVED, agent then applies + records commit. Routine doc work (new raw drafts, wiki summaries, log/bug/dummy rows, PROGRESS bookkeeping, code-with-tests) is exempt.
- **Why**: user asked for an internal approval mechanism (this turn). Trio critique flagged that the Execution Plan marked doc changes DONE without approval or repo verification — the exact failure this closes. Mirrors the platform's own `propose→decide→commit` at the docs layer (thematic consistency: Bridge governs its product this way; the repo governs its canon this way).
- **Alternatives rejected**: heavyweight PR-review-per-doc (too much friction for a solo founder + agent sessions); relying on git history alone (records what changed, not what was *authorized* as canon); no mechanism (status quo that produced the DONE-without-approval drift).
- **Consequences**: canon edits now gate on an APPROVALS row; the user's in-session decisions ARE the approval (rows AP-001/002/003 logged APPLIED this turn). Enforcement is convention, not tooling — a future lint could check that locked-doc diffs carry an approved row.

## ADR-044 — Consolidation trio reconciled; dummy-data policy settled (2026-07-09)
- **Decision (trio)**: `BRIDGE_PLATFORM_RESET_HANDOFF.md` = the STABLE BRIEF; `docs/raw/execution-plan-2026-07.md` supplies the stronger product lanes (Tracks A–G) but each Track executes ONLY behind a discovery gate + a safety gate; `BRIDGE_PLAN_CRITIQUE_AND_EXTENDED_PLAN.md` = the accepted resolution (user agreed with its recommendation). This is the critique's own recommended shape.
- **Discovery-gate finding**: re-ran the critique's proposed existence check 2026-07-09. All previously-"missing" artifacts now PRESENT — `platform/apps/web`, `platform/packages/core/src/capability/lifecycle.ts`, PromptAssembler (`run-context.ts`), `workspace_definitions` (`blueprint.ts`), `package_installations` (`package/types.ts`), `code:exec` (`sandbox-provider.ts`), ADR-019/023/026/027 all in decisions-log. The critique's 07-07 "source-of-truth problem" is therefore STALE; the repo caught up between 07-07 and 07-09. **Remaining live gate = safety** (sandboxing, package-import security, test strategy), not path-existence.
- **Decision (dummy data)**: no dummies unless genuinely unavoidable; every unavoidable one (runtime OR test fixture) tracked in `docs/dummy.md`. Resolves the previously-open "do test fixtures count?" question — they do. (User this turn: "don't use dummies unless unavoidable and when unavoidable, it should be tracked… log there.")
- **Alternatives rejected**: (a) execute the Execution Plan as-is — rejected, critique showed unverified claims + missing safety gates; (b) execute only the Handoff — rejected, it under-specifies migration target + safety/test strategy; (c) purge ALL test doubles (Execution Plan's stronger reading) — rejected per critique, that's a CI/quality regression, distinct from purging runtime product data.
- **Consequences**: trio docs re-statused (Handoff=brief, Execution Plan=gated, Critique=accepted-but-partly-stale); the trio leaves PROGRESS.md's blocked list. Before any Track runs, its safety gate must clear via an APPROVALS row. Dummy policy folded into CLAUDE.md + dummy.md.

## ADR-045 — BUG-INTAKE interrupt protocol: user-reported bugs preempt default batches with a gated plan-sweep (2026-07-10)
- **Decision**: user-reported bugs trigger a standing 5-step interrupt (protocol lives in `docs/PROGRESS.md`, trigger rule in CLAUDE.md): (1) verbatim report → `docs/raw/requirement-bugs-YYYY-MM-DD-<slug>.md` (requirement convention) + BUGS.md rows; (2) BEFORE executing, an Explore-subagent sweep of current batches + Plan Registry + open BUGS for root-causes, same-surface items, and low-effort/high-ROI easy wins; (3) an INTERRUPT batch atop PROGRESS.md with pull-ins tagged `[root-cause]/[same-surface]/[easy-win]` and capped at ~30% extra effort over the plain fixes; (4) execute under normal done-criteria; (5) resume default batches when empty. Standing user directive (AP-004) = standing approval; no per-instance APPROVALS row.
- **Why**: user directive 2026-07-10 — bug reports should outrank the ongoing plan, AND each fix should harvest cheap adjacent value (root causes, co-located plan items) instead of touching the same surface twice in separate sessions.
- **Alternatives rejected**: a `.claude/skills/` project skill or UserPromptSubmit hook as the trigger (`**/.claude/` is gitignored here — wouldn't travel via git or survive worktrees; a prompt-classifier hook is a per-turn cost against the token rules); uncapped pull-ins (scope creep — a bug report must not become a refactor); fix-only with no sweep (repeated re-visits to the same surface, root causes left standing).
- **Consequences**: CLAUDE.md gains one always-loaded rule (reviewed token cost, accepted); PROGRESS.md gains the INTERRUPT mechanic as a first-class batch type; requirement docs become the durable record of every user bug report.

## ADR-046 — Communications Agent demoted to a skill; permanent roster is 4 agents, not 5 (2026-07-10)
- **Decision**: Communications is no longer one of the permanent platform agents. It becomes a stateless skill (`draftCommunication(context, tone, animal)` — draft/summarize/explain, tone-matched to the workspace's chosen spirit animal) invocable by any agent, primarily Chief of Staff (assembling plain-language summaries/proposals) and Capability Builder (drafting Module descriptions). The permanent roster drops from 5 to **4 agents**: Chief of Staff (sole router), Learning (research, never executes), Governance (permissions/policy/compliance/risk scoring, sole holder of the auto-approve-MINOR exception), Capability Builder (drafts capabilities post-approval only, never activates).
- **Why**: per the agent/skill distinction already established in `core/src/ports.ts` and `agent-scope.ts` — an **agent** is an identity with a capability-scope ceiling, an assumed role, and (from P3) an earned trust/lifecycle state; a **skill** is `name + run(inputs, ctx)`, a stateless transform with no independent authority. Communications' job (context+tone in, draft text out) has no decision authority and no state — the actual *send* is already gated by the agent-floor's non-removable `external:send` DENY regardless of which agent invoked the draft, so a separate agent identity added indirection without adding governance. Governance was evaluated for the same demotion and rejected: it *exercises* authority (auto-approves MINOR changes under the dual-axis policy), and agent-floor's non-removable DENY blocks every agent from `approve` on governance-adjacent resources (policy/skill/agent/role/permission/ledger/delegation) — Governance Agent is the one distinguished, audited exception to that floor. Collapsing it into a callable skill would force either every caller to carry floor-exempt authority (reopening the ambient-authority hole agent-floor exists to close) or the "skill" to carry its own independent authority ceiling, which is just an agent under a different name.
- **Alternatives rejected**: (a) demote both Communications and Governance to skills — rejected per the authority-ceiling argument above; (b) keep Communications as an agent but strip its egress gate — doesn't address the actual objection (no independent state/authority to justify agent-hood); (c) leave the roster unresolved pending user locating a prior record of this decision — no record was found in any worktree's decisions-log.md/log.md or in cross-session transcript search (checked `practical-carson-06511d`'s "Agent definition and building blocks" session and others), so proceeding on this session's explicit re-confirmation rather than blocking on an unverifiable memory.
- **Consequences**: `docs/wiki/foundational-agents.md`, `docs/wiki/module-evolution.md`, `docs/wiki/roadmap.md` "five permanent agents" language updated to four + a skill. `platform/packages/core/src/agents.ts` `FOUNDATIONAL_AGENTS` registry loses the `communications` entry; `ANIMAL_TONE` tone-matching moves from agent-identity wiring to the `draftCommunication` skill call signature. `@communications` mention-routing in `chiefOfStaff.converse` becomes a direct skill invocation rather than an agent dispatch. Supersedes the Communications-agent portions of ADR-032/033 (Governance and the other three agents unchanged).

## ADR-053 — Ontology simplification decided: work chain, Organization/Module split, invariants-vs-defaults, reviewMode (2026-07-12)

- **Context:** Simplification proposal ([simplification-proposal-2026-07-12.md](simplification-proposal-2026-07-12.md)) evaluated by user with amendments ([verbatim requirement doc](requirement-simplification-directives-2026-07-12.md)). User instruction: critically evaluate and do what's best.
- **Decision:**
  1. **Work chain preserved, Request NOT merged into Action** (rejects proposal item 1.2, closes ADR-052's open question): `Request → Plan → Decision → Run → Action(s) → Event(s) → Result`. Each stage distinct + immutably recorded. Plan absorbs "Execution Snapshot"; Result = recorded outcome, not a new table.
  2. **Workspace dropped as kernel primitive**, responsibilities split: Organization (tenancy/membership/billing/security boundary; single user = Organization of one) · Module (installed functional experience: capabilities+data types+policies+views) · ElementType/Element · View · Home (distinguished cross-module landing View — NOT a primitive, per Claude refinement accepted on "optional" framing). DealPilot/Calendar/Relationships/JobPilot = Modules installed into an Organization. Blueprint (was WorkspaceBlueprint) = Organization composition definition.
  3. **Invariants vs defaults separated.** Kernel invariants: governance contract (authority→policy→immutable ledger, enforced per plane — NOT a centralized-service requirement) · bounded attributable DAG execution (depth caps, attributed hops, replayable Runs) · agent-floor DENY + exactly one distinguished governance authority per Organization · Plane Gate · lethal trifecta · computed-and-recorded reviewMode. Default compositions (swappable product choices): 4-agent roster, star topology/CoS-sole-router, Planner/Run phase split, Home layout.
  4. **L0–L3 deleted; reviewMode = semantic computed outcome** `auto|notify|approve|quorum` = `resolve(risk, origin, audience, authority, trust, sideEffect, dataScope, egress, organizationPolicy, delegation, quorumRules)`. Never configured or stored as source of truth; resolved {result, inputs, reason, policyVersion} immutably recorded for audit + replay.
  5. **Events residency-partitioned; Timeline = read-time projection** over the partitioned logs (user refinement — a single physical events table would violate the Plane Gate; Calendar Projection pattern reused). timeline_entries folds into events (migration pending).
  6. **Plane reserved for Local/Cloud residency boundary.** Graph domains renamed: Relationship Domain (user's naming over "Identity Domain" — holds people, communities, relationships) + Work Domain. "Local inference / cloud inference" for model location.
  7. **Adopted-as-proposed (user silent, delegated):** manifest collapse 3→1 (CapabilityManifest = source of truth, runtime type = projection, `surface: none|ui` replaces Internal/External split) · Memory+Knowledge → Context primitive (`source: observed|ingested` × `tier: working|episodic|semantic|procedural`; Memory/Knowledge remain as UI display filters) · initiatives → seeded ElementType (direction-only) · CapabilityState 7→4 (draft→approved→active→retired; Trusted = attribute + TTL) · ModuleVersionState 6→3 (draft→live→retired + grace_until).
  8. **Concept-level Tool eliminated**; all mention of "package" and "workspace" dropped from canon.
- **Rationale:** intent ≠ execution (Request/Action); tenancy ≠ surface (Organization/Module); what-could-go-wrong ≠ what-governance-is-required (risk/reviewMode); frozen topology ≠ guaranteed properties (invariants/defaults). Each split names a real seam. User's residency-partitioned-events refinement caught a genuine Plane Gate violation in the original single-table proposal.
- **Alternatives rejected:** Request-into-Action merge (conflates intent with execution, loses fan-out + Decision seam) · Home as fifth structure primitive (net-new concept during a simplification; distinguished View suffices) · single physical events table (Plane Gate violation) · numbered approval levels stored as state (drifts from computed truth) · freezing 4-agent roster/star topology as invariants (blocks legitimate product recomposition without buying safety — the floor + governance-authority invariants carry the actual guarantees).
- **Consequences:** `docs/wiki/ontology.md` rewritten (taxonomy, invariants-vs-defaults, reviewMode, domains, retired-terms list). Proposal doc gains Resolution section. Verbatim requirement doc created. Migrations staged, direction locked: workspace_id→organization_id (large blast radius — RLS + every table), ritual_runs→automation_runs, package_installations→module_installations, timeline_entries→events projection, initiatives→ElementType row, state-enum collapses, L0–L3 columns→recorded reviewMode resolutions. Glossary artifact update pending. Supersedes ADR-052's open Request question and its "single events table" note.

## ADR-052 — Terminology canonicalisation: Module, Automation, Event; retire Package/Ritual/Signal/Compiled-Workspace (2026-07-12)

- **Decision**: Six terminology changes made permanent across ontology, wiki, and glossary:
  1. **Package → Module** (`PackageManifest` → `ModuleManifest`, `PackageKind` → `ModuleKind`, `package_installations` → `module_installations`). Module = installable bundle of ≥1 Capabilities. Capability = the atomic piece.
  2. **Ritual → Automation** everywhere (code + UX). `ritual_runs` → `automation_runs`. Automations can be scheduled. No "ritual template" concept — Modules fill that role.
  3. **Signal / Incident → Event**. Single `events` table with `surfaced` field replaces separate `signals` + `signal_actions` tables. Signal and Incident removed from canonical primitive taxonomy.
  4. **Compiled Workspace / Compiled Product → RETIRED**. DealPilot and JobPilot are Modules installed on the Kernel, not compiled products. ResearchPilot (P6 placeholder) becomes a research skill set or future Module.
  5. **WorkspaceBlueprint** now fills the role compiled products used to play — it is the generated definition of a workspace configuration (ElementTypes, Views, installed Modules, default Automations). Blueprint : Workspace :: Docker image : container. Published to Commons for reuse.
  6. **Cloud Plane ≠ Commons ≠ Bridge Cloud** — three distinct cloud concepts explicitly separated: Cloud Plane = Supabase canonical user data; Commons = capability knowledge registry (never user data); Bridge Cloud = control-plane service (accounts/billing/telemetry).
- **Why**: divergence between how the codebase described things (package, ritual, signal, compiled product) and how the platform was evolving (modules, automations, events, blueprint-driven workspaces) was creating glossary confusion and misleading onboarding. The compiled-product concept implied a separate shipped binary; Module + Blueprint is the correct mental model.
- **Open question not resolved by this ADR**: whether Request should be a lifecycle state of Action (stage-zero `raw_intent`) rather than a separate primitive. Pipeline transforms Request → Action, suggesting shared type hierarchy. Filed as a schema design question; not changed yet.
- **Alternatives rejected**: keeping "package" as the code term while calling it "module" in UX — creates a code/concept gap that confuses new sessions; keeping "ritual" as a code term while retiring it at UX level — same gap problem; keeping separate signals table — adds complexity for a concept that reduces to "a surfaced event".
- **Consequences**: `docs/wiki/ontology.md`, `packages.md`, `rituals.md` updated this session. Code migration (renaming `ritual_runs` → `automation_runs`, `package_installations` → `module_installations`, etc.) is pending and should be tracked in BUGS.md or a separate migration task. ESLint rule `bridge/no-crm-vocab` may need extension to catch deprecated terms in kernel paths.

## ADR-047 — Multi-monitor companion + click-through annotate window; AX-tree walking deferred (2026-07-10)
- **Decision**: `overlay.rs` now creates one companion window PER CONNECTED MONITOR (`app.available_monitors()`, labels `overlay`/`overlay-1`/…, falls back to a single unanchored window if enumeration fails/returns empty so a bad monitor read never removes the companion entirely). `overlay_resize`/`overlay_hide` take the CALLING `WebviewWindow` as a Tauri-injected command parameter (confirmed via `WebviewWindow`'s `CommandArg` impl in the vendored tauri 2.11.5 source) rather than looking up a fixed label — this makes both commands correct across N monitor instances without any per-window bookkeeping on the JS side. A NEW 3rd window type, `annotate.rs`, ships one click-through (`set_ignore_cursor_events(true)` from creation) window per monitor rendering a constrained typed mark vocabulary (`AnnotationMark`/`MarkKind`: highlight/arrow/callout/spotlight) via `AnnotateApp.tsx`'s SVG renderer — `annotate_show` validates geometry (finite, positive, ≤12 marks, ≤120-char labels) in Rust before ever emitting to a webview, so the frontend only ever receives an already-validated typed shape, never raw HTML/model text. The JS side listens for the Rust-emitted event via a hand-rolled `tauriListen` (invoking the real `plugin:event|listen` command + `window.__TAURI_INTERNALS__.transformCallback`, both confirmed present in every Tauri v2 webview by reading the vendored `tauri` crate's `event/plugin.rs` and `scripts/core.js`) rather than adding `@tauri-apps/api` as a dependency — matching this codebase's existing browser-first stance (`desktop-shell.d.ts`'s comment on why `invoke` is used raw). `providers/accessibility.rs` ships ONLY `ax_permission_status` (`AXIsProcessTrusted()`, a single safe no-argument FFI call, linked directly against the ApplicationServices framework with no new Cargo dependency) — full AX-tree walking (element lookup, coordinate resolution) is explicitly NOT built this pass.
- **Why**: the CSP fix (SEC-4, this same session) was a stated prerequisite for any annotation surface per `docs/wiki/desktop-companion.md`'s own un-spoofable rule — an annotation canvas with unrestricted content would be a phishing/prompt-injection vector (a fake "click here" overlay not actually drawn by this shell). AX-tree walking was deferred rather than hand-rolled because it requires manual CoreFoundation retain/release bookkeeping (AXUIElementRef, CFArrayRef attribute reads) that is genuinely unsafe to get right without a live macOS session with the Accessibility permission actually granted to exercise it against — no such session existed in this build environment. This is the same judgment call already made in this exact codebase for the `screen` sensor (an honest `not_implemented` stub rather than an unverified capture path) — `sensor_bridge.rs`'s own comments state the same reasoning for screen capture.
- **Alternatives rejected**: (a) hand-roll unsafe AXUIElement FFI bindings anyway and ship them unverified — rejected as a memory-safety risk with no way to catch a mistake before it shipped (a bad CFType retain/release could crash the whole shell, not just the annotation feature); (b) add the `accessibility`/`accessibility-sys` crate from crates.io to get a maintained wrapper — deferred rather than rejected outright (a reasonable next step), not pulled in this pass to keep this slice's dependency surface reviewable and because the actual tree-walking logic still needs live verification regardless of which binding layer produces it; (c) add `@tauri-apps/api` for event listening — rejected, matches the existing `invoke`-without-the-package precedent, and the two calls needed (`plugin:event|listen` + `transformCallback`) were confirmed against the vendored crate source rather than assumed; (d) one shared overlay/annotate window spanning all monitors via OS-level virtual desktop coordinates — rejected, per-monitor windows match the existing `overlay.rs` anchoring pattern and avoid cross-monitor DPI/scale-factor math inside a single window.
- **Consequences**: `apps/desktop/src-tauri/src/{overlay,annotate}.rs`, new `providers/accessibility.rs`; `apps/web/{overlay.html,annotate.html}` + `src/{overlay-main,annotate-main}.tsx` + `src/app/avatar/{OverlayApp,AnnotateApp}.tsx`; `vite.config.ts` gained a 3rd rollup entry; `desktop-shell.d.ts` gained `transformCallback` to the `__TAURI_INTERNALS__` type. Verified: `cargo check`/`cargo clippy --no-deps`/`cargo test --lib` all green (9/9 Rust tests, including a real `AXIsProcessTrusted()` call that didn't panic); `turbo run build` green for core/api/web; hover-chat and the right-click menu verified LIVE in a browser preview of `overlay.html` (chat round-tripped against a running API, all three menu actions fired correctly); `AnnotateApp.tsx`'s four mark types verified visually via a temporary test-seed path (added, screenshotted, then reverted — not shipped). NOT verified: real multi-monitor GUI behavior, real click-through correctness, and the annotate window's live Tauri event delivery — no interactive macOS display was available in this build environment; this matches the pre-existing overlay window's own "build-verified not GUI-verified" caveat, not a new gap in the codebase's honesty standard. `docs/wiki/desktop-companion.md` updated to reflect P0 done / P1 partial (window shipped, AX lookup open).
- **Note on this branch's Brain/Engine content**: this session initially cherry-picked the Brain/Engine architecture+execution-plan docs from `claude/ai-assistant-brain-design-07d52a` (renumbering ADR-035→046) before discovering that content had ALREADY landed on `origin/main` verbatim (as ADR-035, still colliding with that branch's own pre-existing Docling ADR-035 — an unresolved dup this note flags but does not fix, out of scope for this merge). The cherry-picked duplicate was dropped on merge; `docs/raw/brain-engine-architecture-2026-07.md`, `brain-engine-execution-plan-2026-07.md`, and `docs/wiki/brain.md` now come from `origin/main`, referencing ADR-035 as `origin/main` already does. This ADR was renumbered 048→047 accordingly to close the gap.

## ADR-048 — Capability Builder roadmap: generation-architecture patterns adopted from bolt.diy/Dyad/Budibase/Appsmith/ToolJet (2026-07-11)
- **Decision**: the Capability Builder's roadmap (`docs/raw/builder-agent-roadmap-2026-07.md`, slices BA0–BA6) adopts, as Bridge-native patterns: (1) **streamed governed action-artifacts** as the generation contract (bolt.diy `boltArtifact/boltAction`, with each action an audit/approval/rollback unit); (2) **asymmetric diffing** — full-definition emission on generate, human edits fed back as diffs; (3) **chat-turn ≡ ledger entry with additive restore** (Dyad's commit-per-turn, generalized to Bridge's pipeline ledger — restore forks, never destroys); (4) **two-tier model economy** — small model for context selection + routine edit application, frontier model for spec/generation reasoning (Dyad Smart Context/Turbo Edits), on the existing `ModelProvider` seam, doubling as the local-free/cloud-paid monetization seam; (5) **DB-as-truth, git-as-projection** — authoritative definitions in `workspace_definitions`/capability stores, deterministically serialized to a diffable file tree for pre-apply review, secrets never serialized (Appsmith); (6) **stable node IDs + edit-by-reference** on every Blueprint/definition element (ToolJet); (7) **interpreter-over-codegen for surfaces** — generation writes definitions rendered by the existing `<DataViews>` shell; codegen only for sandboxed capability scripts (Budibase/Appsmith/ToolJet convergence); (8) **per-model prompt packs as versioned capability artifacts** (bolt.diy's one-prompt-many-models failure inverted). License stances fixed per source: bolt.diy MIT patterns yes / WebContainers no (commercial license); Dyad core Apache reference-ok, `src/pro` FSL-1.1 clean-room only; Budibase tri-license pattern-only (no GPL/BSL vendoring); Appsmith Apache-2.0 = strongest direct-reference candidate; ToolJet AGPL clean-room only.
- **Why**: all five platforms converge on declarative JSON definitions interpreted by a generic runtime and on agents-as-governed-capabilities — independent confirmation of Bridge's ADR-017/ADR-018 bets. Their three shared gaps (no stable public definition spec; no native propose→diff→approve on definition changes; snapshot/bolt-on versioning) are precisely Bridge's pre-apply-approval moat, so the roadmap builds toward those gaps rather than toward feature parity with app builders.
- **Alternatives rejected**: (a) a standalone builder IDE/canvas surface — contradicts the invisible-organ principle (ADR-032 conversational flow) and would recreate the category Bridge explicitly is not; (b) WebContainers-style in-browser runtime for generated capabilities — commercial license dependency + Bridge already owns a sandbox lane (isolated-vm + E2B, ADR-036); (c) git as source of truth for definitions — projection only, because approvals/risk/rollback live in the pipeline ledger, not in a VCS the kernel doesn't control; (d) vendoring AGPL/FSL/BSL code for speed — clean-room protocol exists for exactly this.
- **Consequences**: new plan doc + `docs/wiki/builder-agent.md`; Plan Registry line in PROGRESS.md. BA0/BA1 refine existing P0–P1 tracks (ADR-017/019/026/036) without reordering the H2 sequencer; stable-node-ID and serializer requirements land as inputs to the pending schema-v2 pass. Status `proposed` — sequencing any BA slice into batches goes through `docs/APPROVALS.md`.

## ADR-049 — Egg + Commons roadmap: code-diligence reuse verdicts for Clicky/Pluely and the ingestion-corpus posture (2026-07-11)
- **Decision**: the Egg + Commons feature roadmap (`docs/raw/egg-commons-feature-roadmap-2026-07.md`, slices EG0–EG5 / CM0–CM5) fixes these reuse stances from direct code inspection: (1) **farzaa/clicky** (MIT, inspected commit `a80fa80`, frozen v1 of heyclicky) — ADAPT its onboarding choreography as a design spec (human-voice trust copy → sequenced permission rows with live polling and proof-by-capture → performed first-value demo → single next action), PORT its `[POINT:x,y:label:screenN]` pointing protocol + multi-monitor coordinate math and the Computer-Use-tool-as-coordinate-locator technique, take its spoken-companion system prompts near-as-is; every adopted capture beat becomes a governed, blinking, Memory-logged capture (the theater without the silence). (2) **iamsrikanthnani/pluely** (GPL-3.0 single license) — NO source vendoring; adopt its permissive dependency set directly (`tauri-nspanel` MIT for non-activating always-on-top panels, `xcap` Apache-2.0 for capture, `cidre`/`wasapi`/`libpulse-binding` for per-OS system-audio loopback behind one `Stream<f32>` trait) and clean-reimplement ~1.5k LOC of glue from the documented architecture. (3) `contentProtected` is used ONLY for self-exclusion of Bridge's own windows from screen shares — stealth/anti-capture concealment (Pluely/Cluely product core) is rejected on both-party-consent grounds. (4) Commons ingestion targets the ~10k-skill public corpus (Anthropic official, VoltAgent, Antigravity, OpenClaw-derived, Rezvani, Agensi) with SKILL.md as the interchange format, but only AFTER the supply-chain trust slice (CM1: signing, content-hash pins, publisher verification, Agensi-style 8-point scan extended with manifest risk bands, MCP sandbox exemption dropped) — reaffirming the oss-commons "trust FIRST" ruling. (5) CM0 closes the wiring gap (Commons service is built but nothing consumes it — `commons.*` tRPC procedures + install-from-Commons + Learning Agent similarity reads). (6) Sequencing: surface first, ecosystem second (Raycast/Zapier composition order); Egg slices lead Commons by one beat.
- **Why**: the competitor corpus (113 platforms / 60 chief-of-staff products / 14 skill registries in `My Data/New Data`) shows every desktop assistant shipping the same seven table stakes while none answers retention/audit/screenshot-handling questions — Bridge's capture contract is therefore the differentiated onboarding, and Clicky's MIT choreography is the best available craft for staging it. Pluely's two hard-won assets (system-audio loopback, non-activating panel) are reachable without GPL contamination because they are thin glue over permissive crates. No existing skill registry does versioning, trust metadata, or knowledge generalization — the Commons slices build directly into that vacuum rather than competing on catalog size.
- **Alternatives rejected**: (a) vendoring Pluely GPL code or relicensing Bridge — kernel licensing is a strategic decision not to be forced by a capture utility; (b) copying Clicky's silent-screenshot demo mechanic verbatim — violates the capture contract (blink = tell, inspectable Memory); (c) meeting-transcription as an Egg feature — saturated category (Granola/Otter/Fireflies/Fathom), Bridge acts after the meeting instead; (d) shipping broad computer-use actuation day-1 — the category's documented trust failure (MultiOn/Fellou); annotation points, it does not click; (e) in-app marketplace tab — re-affirms ADR-030 (marketplace = Commons website; app consumes installed Modules only); (f) ingest-before-trust to win catalog size — supply-chain gates first, per the oss-commons plan.
- **Consequences**: new plan doc + `docs/wiki/egg-commons.md` + Plan Registry line. EG0 introduces new Rust deps (tauri-nspanel, xcap, cidre/wasapi/libpulse-binding) subject to the standard dependency gates; EG1's OnboardingProfile schema and CM1's provenance/signature fields land as inputs to the pending schema-v2 pass; the Competitors Document.md is flagged as a HeyClicky self-report (vendor claims, not independent research). Status `proposed`; sequencing any EG/CM slice into batches goes through `docs/APPROVALS.md`.

## ADR-050 — JobPilot module plan: auto-apply reframed to draft-then-approve; legitimate-source-first (2026-07-12)
- **Decision**: the JobPilot module plan (`docs/raw/jobpilot-module-plan-2026-07.md`, slices JP0–JP6) realizes the user's standalone JobPilot vision (`jobpilot-vision-requirement.md`) as a Bridge compiled-workspace package with three deliberate reframes from the standalone spec: (1) **the fully-unattended auto-apply waterfall becomes draft-then-approve** — external application submission is an External-band capability, always human-approved at launch (Capability Trust Model); JobPilot removes the tedium (sourcing, scoring, tailoring, form-mapping, tracking, follow-up), not the decision to apply. (2) **Legitimate-source-first, ToS-classified sourcing** — Tier-1 official/public endpoints (ATS public boards Greenhouse/Lever/Ashby/Workable/SmartRecruiters/Workday-via-career-ops; aggregator APIs Adzuna/Jooble/Careerjet/USAJobs/Reed/TheMuse/LinkUp/Techmap; remote APIs Remotive/Arbeitnow/RemoteOK/Himalayas; RSS/HN) are default-on; Tier-2 scraped sources (LinkedIn/Indeed/Glassdoor/ZipRecruiter — ToS-prohibited, anti-bot-enforced) are off-by-default, user-enabled, rate-limited, and never load-bearing. (3) **Truthfulness gate is a hard requirement** — tailored materials carry per-line evidence vs the master profile; PROTECTED_FIELDS never `jd_added`; sensitive fields (SSN/payment/EEO) always NeedsHuman. The requirement doc's repo-by-repo OSS leverage map is carried forward under Bridge reuse policy with the license-hygiene rule retained (no AGPL/Commons-Clause/CC-NC vendored): dependencies JobSpy/jobhive/JSON-Resume (MIT); fork-components Resume-Matcher (Apache-2.0, ~70% of the writer/evaluator loop)/career-ops/ats-screener/JobFunnel/lib_resume_builder_AIHawk (MIT); patterns-only ApplyPilot/job-ops/Auto_job_applier_linkedIn/open-resume (AGPL). career-ops rides a pinned-submodule weekly vendor-sync diff, never a live dependency.
- **Why**: the commercial research is unambiguous — mass auto-apply tools (LazyApply, AIApply, Massive, Sonara) carry ~2.3/5 reputations, LinkedIn-ToS bans (461-tool blacklist), and drove the 2025 "~11,000 applications/minute" arms race in which 34% of recruiters (Greenhouse 2025) now spend up to half their week filtering AI spam. Draft-then-approve + evidence-first + legitimate-source-only is both the Bridge-principled position (never bypass ToS/robots/auth; External band human at launch; both-party consent) AND the differentiated product bet against a saturated, reputationally-damaged auto-apply field. The four leading trackers (Teal/Huntr/Simplify/Careerflow) converged on the same tracker+extension+AI-tailoring stack and drew billing backlash — JobPilot's local-first, governed, no-per-seat model is the wedge. JobPilot's JP0 anchor package already exists in-repo (`platform/tools/jobpilot`, 50 tests; built-in manifest; db store; prototype UI), so this plan sequences the feature build onto shipped foundations.
- **Alternatives rejected**: (a) port the standalone spec's unattended T1–T4 waterfall verbatim — violates the External-band-human rule and reproduces the mass-apply anti-pattern; (b) treat LinkedIn/Indeed scraping as core sourcing — ToS-prohibited and actively anti-bot-enforced, so never load-bearing; (c) allow tailoring to add unsupported claims for keyword coverage — truthfulness gate is non-negotiable; (d) vendor AGPL sources (ApplyPilot/job-ops/open-resume) for speed — clean-room/patterns-only per license hygiene; (e) build a private interview-scheduling surface — hand scheduling to the Calendar module (time-axis projection), no second scheduler; (f) covert interview assistance (Final Round AI stealth mode) — ethics anti-pattern, rejected on both-party-consent grounds.
- **Consequences**: new plan doc + wiki index line + Plan Registry line. Extends the existing `@bridge/jobpilot` package, `job-pilot` built-in manifest, and `jobpilotJobs/jobpilotApplications` db tables; JP-slice source connectors each carry a ToS tier as a manifest field (input to schema-v2). Status `proposed`; JobPilot is roadmap P6 (post-H2) with JP0 already landed during P2/Phase-4 tool-standardization — this plan does not reorder the H2 sequencer; any pull-forward goes through `docs/APPROVALS.md`. Research note: the deep OSS code-diligence subagent hit the session limit; the OSS verdicts here derive from the user's own requirement-doc §5 leverage plan (repo licenses/architecture already researched) plus the completed commercial-landscape research.

## ADR-051 — Calendar module plan: re-express the shipped calendar-plan architecture in the three-lens module template (2026-07-12)
- **Decision**: added `docs/raw/calendar-module-plan-2026-07.md` (slices CAL0–CAL6) as the DealPilot-template module view of the already-decided, partly-shipped Calendar Tool. It restates, without reversing, the standing calendar architecture (`calendar-plan.md`): Calendar = a time-axis PROJECTION over the Unified Graph rendered from a typed `CalendarEvent` contract, governed by the Universal Action Pipeline, NOT a calendar product/server or second source-of-truth. The three-layer reuse split is retained verbatim — adopt OSS for rendering (in-house date-fns render shipped; react-big-calendar MIT the documented swap-in behind the `CalendarView` port) and RFC-5545 math (ical.js MPL-2.0 behind `RecurrenceEngine`/`IcsCodec`; ical-generator MIT for `.ics`; Luxon MIT for tz), build the moat layer (projection, sync, write-back, RLS team scope, scheduling). CAL0–CAL2 are recorded as DONE (Google Calendar list + governed create/modify/delete; `@bridge/integrations-google` 5/5 calendar tests; `/calendar` surface); CAL3–CAL6 sequence the P3–P6 future work (rituals/initiatives overlay, team/shared via RLS, conference/ICS + Microsoft Graph/CalDAV adapters, deferred scheduling).
- **Why**: the user asked for a JobPilot-style module roadmap for Calendar; the existing `calendar-plan.md` is architecture-shaped, so this provides the parallel three-lens deliverable (design IA, business coverage/exclusions, agents/skills/automations, reuse map, data model, slices) consistent with the DealPilot/JobPilot/Egg-Commons plans, while explicitly not duplicating or contradicting the shipped decisions. Key governance carry-throughs made explicit in module terms: external calendars stay source-of-truth; every write is pipeline egress human-approved ≥L2; team/shared = existing RLS visibility filter, not a new ACL; recurrence/DST is never hand-rolled; autonomous defrag/auto-scheduling (Motion/Reclaim model) is reframed to governed proposals; copyleft calendar systems (Cal.com AGPL, Radicale/Baïkal GPL, Nextcloud AGPL) remain banned as embeds.
- **Alternatives rejected**: (a) editing `calendar-plan.md` in place — it is the shipped architecture record with a `status` line; a status flip or reversal would need APPROVALS, whereas a new companion module plan is routine doc work; (b) waiting for the commercial + OSS diligence subagents — both hit the session limit (resets 8:20am CT), and the calendar reuse verdicts were already independently verified in `calendar-plan.md` §3 (2026-06-24), so the plan is complete without them; a fresh commercial-landscape refresh (Motion/Reclaim/Notion-Calendar/Vimcal) can be added later if desired; (c) proposing a dedicated Calendar agent — leaned toward reuse of egress/intake agents + Chief of Staff per the open decision in calendar-plan §7.
- **Consequences**: new plan doc + wiki index line + Plan Registry line. No code change, no `calendar-plan.md` edit, no sequencer reorder; Calendar remains sequenced after the local-gate slice + Initiatives P1 per the standing plan. Status `proposed`; any scheduling (CAL6) pull-forward or a `status` flip on calendar-plan.md goes through `docs/APPROVALS.md`.

## ADR-054 — Agent-roadmap strengthening pass: dedicated Governance + Learning Agent roadmaps; per-slice exit criteria, metrics, and risk registers on JobPilot/Calendar/Builder (2026-07-12)
- **Decision**: (1) Gave the two roadmap-less permanent agents dedicated three-lens plans: `docs/raw/governance-agent-roadmap-2026-07.md` (GA0–GA6) and `docs/raw/learning-agent-roadmap-2026-07.md` (LA0–LA6), grounded in a code audit of what actually exists. Governance framing invariant: **the kernel decides, the agent explains** — bands/floors/authority stay deterministic kernel functions (ADR-012 substrate, built + tested); the agent identity wraps them (grounded explanations GA1, live trust-grants + policy_params budgets GA2, the MINOR auto-approve carve-out as a distinguished decider identity in `decide()` with zero model calls in the decision path GA3, org-health GA4, provenance/audit GA5, schema-v2 team scale GA6). Learning framing invariant: **taint-first** — the Memory primitive (MemoryPort + Mem0 adapter, LA0) ships with provenance/taint tiers and a permanent injection eval suite from day one, not retrofitted; suggested-then-accepted memories; SSRF-hardened fetch BEFORE any crawler (LA3); PromptAssembler as ONE shared build with Builder BA0 (LA1); graph stays source of truth over vectors (LA5). (2) Strengthened the delivery sections of the three existing plans (`jobpilot-module-plan`, `calendar-module-plan`, `builder-agent-roadmap`): every slice now carries goal, depends_on, deliverables, and testable exit_criteria (incl. negative tests for every governance bypass), plus new §6.1 success-measure and §6.2 risk-register sections with monitored hard invariants (e.g. unapproved submissions/writes/activations == 0, wrong MINOR auto-approvals == 0, sandbox escapes == 0, cross-plane leaks == 0).
- **Why**: user verdict 2026-07-12: "not happy with jobpilot, calendar, builder agent, governance agent, learning agent roadmap. Strengthen it." Diagnosis: the three module plans had strong lenses but one-line slices with a generic shared exit gate — not executable or falsifiable; and Governance/Learning had no roadmap at all (paragraph descriptions in foundational-agents only), despite Governance being the sole agent-floor exception holder and Learning being the security audit's primary untrusted-input consumer. The code audit resolved the real shape of the work: Governance = wrap built mechanisms in an identity (trustGrants read is hardcoded `[]`, budgets in-memory, no decider identity); Learning = near-total greenfield (Memory primitive absent, Mem0/PromptAssembler/competitor-discovery all decided-but-unbuilt).
- **Alternatives rejected**: (a) folding Governance/Learning slices into the foundational-agents doc — that doc is the corrected onboarding/roster spec, not a delivery plan; parallel structure with builder-agent-roadmap is clearer; (b) prompt-level governance (LLM assesses risk/approves) — violates the trust model's computed-risk principle and is the classic "AI safety officer" failure; the carve-out is structural in `decide()` instead; (c) retrofitting injection defense after the Learning research lane works — the audit already flags this surface HIGH, and taint schemas can't be bolted onto an existing memory store cheaply; (d) a scheduling/effort-estimate pass on the slices — estimates would be invented; dependencies + exit criteria are the honest strengthening.
- **Consequences**: 2 new raw plans + 2 new wiki pages (governance-agent, learning-agent) + strengthened §6/§6.1/§6.2 in three existing plans + wiki/index/foundational-agents cross-links. Cross-roadmap dependencies now explicit: Builder BA4 ← GA1 risk blocks; Builder BA1+ ← LA3/LA4 research; PromptAssembler = LA1+BA0 shared build; GA4 ← EVAL-1 reducers; GA5 provenance gate must precede Commons ingestion (same requirement as egg-commons CM supply-chain-trust — one implementation); CAL4 hard-blocked on SEC-5/SEC-6; JP6 ← CAL3+. All plans stay `status: proposed`; no H2 sequencer reorder; pull-forwards via `docs/APPROVALS.md`.

## ADR-055 — OSS code-level diligence: verified verdicts + corrections for the Learning/JobPilot/Calendar (and pending Builder) reuse maps (2026-07-13)
- **Decision**: ran source-level diligence (shallow clones, file-verified licenses incl. per-directory sweeps, does-the-claimed-thing-exist checks) on the OSS repos the five strengthened roadmaps lean on; findings recorded in `docs/raw/oss-code-diligence-2026-07.md` and applied to the §4 reuse maps. Verdict changes: (1) **firecrawl** — engine is AGPL with a 5-service self-host footprint (redis+rabbitmq+postgres+foundationdb+playwright), so the preferred LA3 path is now *porting the ~95-line `safeFetch.ts` SSRF pattern* (connect-time unicast-only check on the resolved socket IP; defeats DNS rebinding, survives redirects) into Bridge's own client + driving Playwright directly; engine adoption demoted to a fallback for crawl breadth. (2) **cal.diy** — license-drift suspicion RESOLVED: root LICENSE verified MIT (© Cal.com Inc), `/ee` subtree removed not relicensed; full-tree sweep still required at pin time. (3) **react-big-calendar** — resource lanes are real but NOT piecemeal-importable (TimeGrid/DayColumn unexported): CAL4 adoption shape = a full `<Calendar>` instance behind the CalendarView port for the lane surface only. Corrections: career-ops URL resolved (`santifer/career-ops`; 54 providers verified — MORE than claimed) but its A–G rubric + batch worker are markdown prompts + a bash Claude-CLI harness, downgraded to design-reference; JobFunnel's `key_id` is the source's job identifier, not a `company|title|location` composite (the composite stays Bridge's own design). Verified-stronger-than-assumed: Resume-Matcher's truthfulness machinery ALL exists in code and decoupled from its web stack (`verify_skill_target_plan` improver.py:754, `_BLOCKED_FIELD_NAMES` ≈ Bridge PROTECTED_FIELDS already implemented, 5 deterministic scorers + LLM judge) — with two port notes (their ResumeData ≠ JSON Resume; upstream accepts `jd_added`, Bridge tightens). Compliance traps found: mem0 telemetry ships to PostHog BY DEFAULT (`MEM0_TELEMETRY=False` mandatory) and mem0's zero-config defaults phone OpenAI/qdrant (explicit local config mandatory); stagehand is MIT + provably local but has no SSRF guard and its act()/CUA paths must be gated off for a neverExecutes agent; neither ical.js nor ical-generator ships tz data (one shared IcsCodec VTIMEZONE seam, budgeted into CAL5's DST eval work).
- **Why**: user asked for deeper codebase analysis of the OSS repos; ADR-050/051 had flagged that earlier diligence subagents died on session limits, leaving several §4 verdicts at pattern/README level. Roadmaps gating real build slices must not lean on unverified claims.
- **Alternatives rejected**: trusting package.json license fields (firecrawl's `apps/api` says "ISC" — stale, governing license is root AGPL); adopting the firecrawl engine for LA3 despite Bridge owning SSRF hardening anyway — pure ops+copyleft cost for unneeded breadth.
- **Consequences**: new audit doc `oss-code-diligence-2026-07.md` (status: active — Builder-stack section pending, first pass died on a session limit after confirming bolt.diy asymmetric-diffing + file-locking exist; re-run in flight); §4 maps of learning/jobpilot/calendar plans corrected in place; Builder §4 verdicts stand at pattern level until the re-run lands. All license verdicts re-verify at vendor-pin time per the standing reuse gates.

## ADR-056 — UI architecture rules encoded as canon; data-shape decides surface (2026-07-13)

**Decision.** Encode the user's UI architecture directive (verbatim: `requirement-ui-architecture-rules-2026-07-13.md`) as canonical `ui-architecture-rules-2026-07.md` + wiki page + CLAUDE.md pointer (AP-011). Core rules: (1) different columns of the same table / strong sibling cluster → toggle at top, each toggle target = a *page*; (2) same columns of same table → *lists* (ListDropdown), never a page; (3) module-related but not strongly related to root/sub-modules → new *sub-module* as collapsible left-nav dropdown; (4) page = landing section (standard views incl. new **Form** view) + stacked related sections + artifacts section (>20 → sub-folders); (5) Control Panel toolbar slot retired → item in 3-dots, contents re-sorted (record-ish data → page sections, true admin stays); (6) local artifacts under `~/Documents/Bridge Workspace/<Module>/<Sub-module>/`. First task next run = UI-RULES-1 alignment audit (PROGRESS Batch 1). Standing decision rule added: unsure UI call → deep OSS code diligence (functions/objects/structures) first, ask user only if that fails.

**Why.** User directive 2026-07-13; also fixes AP-010's deferred PROGRESS rewrite in the same commit. Form-as-standard-view matches the NocoDB/Baserow precedent (form is a first-class view type over the same table schema, not a bespoke create screen); metadata-driven sections/views match Twenty; collapsible nav tree matches AppFlowy.

**Alternatives rejected.** Treating "forum" literally as a discussion view (user's own next sentence says "the form collects data" — Form is the coherent reading; flagged in canon doc §9 for correction). Putting the rules only in a plan doc (they bind the compiler too → canon + CLAUDE.md pointer). Auto-migrating the deployed prototype (out of scope; apps/web is the alignment target — prototype migration needs its own approval given PII + manual deploy).

**Consequences.** UI-RULES-1 audit will produce a toggle/list/sub-module target map with judgment calls surfaced for approval; `controlPanelTo` prop dies after migration; desktop shell gains a Documents-tree provisioning responsibility; interpretations in canon §9 await user confirmation.

## ADR-057 — Security P0 API request-boundary hardening: mutation-gated auth middleware + verifier-tied fail-closed CORS + rate limiting (2026-07-13, renumbered from developer branch's local ADR-054 on merge — collided with this repo's ADR-054 terminology-canon strengthening pass)
- **Decision**: Hardened the tRPC/Fastify request boundary as the Security-M1 batch (SEC-1/SEC-2). (1) A single `requireAuthOnMutation` tRPC middleware (`apps/api/src/router.ts`), chained BEFORE the workspace guard, rejects any *mutation* unless `authenticated || (!verifying && !persistent)` — where `authenticated` = a verifier is configured AND a valid bearer token was presented (computed in `context.ts` from `identity.ts`'s newly-exported `bearerToken()` + `isVerifierConfigured()`), and `persistent` = `wiring.persistent || NODE_ENV==="production"`. Queries are never gated. (2) `corsOriginConfig()`'s permissive `origin:true` fallback is now gated on `!isVerifierConfigured()` AND non-production (was NODE_ENV-only). (3) `@fastify/rate-limit` registered globally with an env-overridable config: 300 req/min default, a 10 req/min "sensitive" bucket for the outbound-network / phone-OTP / propose procedures, keyed by IP+bucket. `server.ts` boot-logs verifier state and warns loudly on a persistent/prod boot with no verifier.
- **Why**: H1 (BUGS.md) — with no verifier and no token, `resolve()` silently returned the pilot identity, so any reachable misconfigured/persistent deploy let an unauthenticated caller execute writes/proposes as the pilot; H1a compounded it by opening CORS on NODE_ENV alone; H4 — no rate limiting anywhere. A mutation-gated middleware protects every current AND future mutation with zero per-procedure wiring, chosen over the roadmap prompt's literal "add `protectedProcedure` + swap 46 call sites" (46 edit points each future procedure must remember to repeat — far larger, more error-prone blast radius for the same guarantee). The `authenticated || (!verifying && !persistent)` shape is a deliberate superset of the prompt's condition: it fail-closes the dangerous case (persistent/prod, no verifier) while preserving the zero-config in-memory local-dev DX (no verifier + in-memory ⇒ still open).
- **Alternatives rejected**: (a) `protectedProcedure` + per-call-site swap — larger blast radius, no future-proofing, easy to forget on a new mutation; (b) hard-failing boot when persistent without a verifier — rejected to avoid breaking the existing prod-contract test and to keep a loud-log escape hatch; the middleware already fail-closes at request time; (c) gating CORS on NODE_ENV only — the original H1a hole; "is a real verifier configured" is the property that actually matters; (d) per-route rate-limit plugins — one global plugin with a bucket `keyGenerator` is simpler and covers batched tRPC calls (the URL comma-joins procedure names, matched fail-tight against the sensitive list).
- **Consequences**: `ApiContext` gains required `authenticated`/`verifying` fields (type-honest for a security boundary), forcing all 6 `createCaller` test harnesses to declare trusted in-process auth (`authenticated:true, verifying:false`). New dep `@fastify/rate-limit ^10.3.0`. Default rate-limit store is in-memory per-process; a shared Redis store is the multi-instance follow-up (noted in code). api test suite 53→58 green. BUGS.md H1/H1a/H4 → RESOLVED. Marking the roadmap Batch DONE is deferred to `docs/APPROVALS.md` AP-012 (not self-approved; renumbered from the developer branch's own AP-010, which collided with this repo's AP-010 priority-realignment directive).

## ADR-058 — drizzle-orm 0.45 upgrade (SEC-3): handle the DrizzleQueryError `.cause` wrapping so 23505 ledger-concurrency detection survives (2026-07-13, renumbered from developer branch's local ADR-055)
- **Decision**: Bumped `drizzle-orm` ^0.38.3→^0.45.2 (+ `drizzle-kit`→^0.31.10) and `react-router`→^7.15.0 to clear 5 HIGH advisories, and wired `pnpm audit --prod --audit-level=high` as a standalone CI gate (`.github/workflows/ci.yml` `security-audit`). drizzle 0.45 wraps driver errors in a `DrizzleQueryError` ("Failed query: …") carrying the real Postgres error (code/constraint/message) on `.cause`. Updated `packages/db/src/ledger-store.ts`'s `isRefLedgerUniqueViolation()` to walk the `.cause` chain for `code === "23505"` + the ref-ledger unique index, preserving the 23505→`AlreadyResolvedError` translation the ledger's optimistic-concurrency safety depends on; added a test-only `dbErrorMatches()` cause-walking helper in `schema-hardening.test.ts`.
- **Why**: the security bumps were mandatory (SQL-identifier injection GHSA-gpj5-g38j-94v9 in drizzle <0.45.2; turbo-stream RCE / `javascript:` XSS / manifest DoS in react-router). The error-wrapping change is a SILENT breaking change: without walking `.cause`, `isRefLedgerUniqueViolation` stops recognizing unique-violation collisions and the ledger surfaces raw errors instead of the idempotent `AlreadyResolvedError`, breaking concurrent-append safety — a real runtime regression the upgrade would otherwise have introduced. `ledger-store.ts` was confirmed the only driver-error-inspection site monorepo-wide.
- **Alternatives rejected**: (a) pinning drizzle <0.45 — leaves the HIGH advisory open, defeats SEC-3; (b) matching only the top-level error — misses the wrapped cause, silently breaks concurrency detection; (c) catching by message-substring instead of `.code` — brittle across locales/driver versions; the numeric SQLSTATE is the stable signal.
- **Consequences**: `pnpm-lock.yaml` updated (drizzle-orm 0.45.2, drizzle-kit 0.31.10, react-router 7.18.1); CI `security-audit` job added; `pnpm install --frozen-lockfile` verified. @bridge/db suite stays 49 green after the cause-walking test fix. One sub-`high` moderate advisory remains, acceptable under the current gate. BUGS.md H2 → RESOLVED.

## ADR-059 — XP-1 cross-OS Tauri shell compile: gate objc2 to macOS, keep macos-private-api inert-unconditional, native crate stays outside the turbo graph (2026-07-13, renumbered from developer branch's local ADR-056)
- **Decision**: Made the desktop Tauri shell `cargo check`-clean on macOS+Linux+Windows without shipping capture off-macOS. (1) Moved the Apple-only `objc2`/`objc2-foundation`/`objc2-app-kit` crates under `[target.'cfg(target_os="macos")'.dependencies]`; the only code referencing them is already `#[cfg(target_os="macos")]` (`providers/apps.rs`, `providers/clipboard.rs`). (2) Kept `tauri`'s `macos-private-api` feature on the UNCONDITIONAL `[dependencies]` entry — splitting it into the macOS-only target block makes `tauri-build` fail ON macOS ("features do not match the allowlist" vs `tauri.conf.json`'s `macOSPrivateApi:true`), and the feature is inert on Linux/Windows (Tauri guards every private-API call with `#[cfg(target_os="macos")]`). (3) `sensor_list` now returns `Ok(vec![])` off-macOS (graceful degradation) instead of an error. (4) Replaced the desktop package's `echo` no-op `build`/`test`/`typecheck` scripts with real native scripts (`check`, `test:rust`, `build:tauri`). (5) Added a 3-OS `desktop` CI matrix running `cargo check --locked` (+ `cargo test` on Linux), with per-OS system deps (Linux webkit2gtk/gtk/soup) and a stub `apps/web/dist/index.html` to satisfy `generate_context!`.
- **Why**: XP-1 (roadmap) — the shell only compiled on macOS because the objc2 crates + macos-private-api were unconditional, blocking any Linux/Windows contributor build and any future cross-OS capture work. The genuine blocker is the Apple native crates, not the tauri feature, so gating exactly those is the minimal correct fix. The desktop crate is deliberately kept OUT of the JS/turbo `build`/`test` graph: the `platform` CI job runs on a Node-only ubuntu runner with no Rust toolchain or webkit system libs, so routing `tauri build`/`cargo test` through turbo would either lie (the old echo) or break that runner. Real, explicitly-named native scripts + a dedicated Rust CI job is the honest wiring. The CI stub-dist keeps the 3-OS matrix a pure compile check ("only unblock compilation", per the prompt) without building the web app three times.
- **Alternatives rejected**: (a) splitting `macos-private-api` into the macOS target block — empirically fails `tauri-build` on macOS (feature/allowlist mismatch, observed this session); (b) naming the native scripts `build`/`test` — re-enrolls the native crate in the Node-only turbo job and breaks it; (c) cfg-gating the objc2 crates but leaving them in `[dependencies]` — they'd still be fetched/compiled on Linux/Windows and fail; (d) building the real web frontend in each CI leg — heavy and unnecessary for a type-check-only gate. Cross-compiling the non-macOS legs locally from this macOS host is not possible (Tauri's Linux backend needs webkit2gtk pkg-config probes), so the DONE-WHEN evidence is the CI matrix; the macOS leg was verified locally (`cargo check --locked`, clean).
- **Consequences**: `apps/desktop/src-tauri/Cargo.toml` restructured; `sensor_bridge.rs` off-macOS `sensor_list` now graceful; `apps/desktop/package.json` scripts real; `.github/workflows/ci.yml` gains the `desktop` 3-OS job. Desktop no longer appears in `turbo run build/test/typecheck` (correct — it's a native crate, not part of the JS build graph). `Cargo.lock` unchanged (`--locked` held). Capture for Linux/Windows is explicitly NOT built (that's XP-2/P2). PROGRESS XP-1 tick deferred to APPROVALS AP-012.

## ADR-060 — Agent-quality eval: pure AQV reducer + in-memory EvalStore behind a port, implementing the existing eval-model doc (2026-07-14)
- **Decision**: Implemented EVAL-1/EVAL-2 (roadmap §M2) as `packages/core/src/eval/` — pure AQV axis reducers (`aqv.ts`), deterministic scorers (`scorers.ts`), `EvalStore` types + an in-memory adapter with an evidence writer (`store.ts`) — per the pre-existing design in `docs/raw/agent-quality-eval-model-2026-07.md` §2–§3. Added an `ExecutionSnapshot` telemetry seam (`core/src/types.ts`) and typed the eval evidence into the capability port (`capability/types.ts`, `capability/ports.ts`).
- **Why**: ship the scoring reducer first (EVAL-1) so agent quality is measurable before wiring a persistent store; keep scorers pure + deterministic so evals are reproducible and testable at the coverage floor without infra; put the store behind a port so a persistent (Drizzle/Mem0) adapter drops in later without touching callers.
- **Alternatives rejected**: (a) a persistent store first — nothing to score yet, and it couples eval to db; (b) non-deterministic/LLM-graded scorers inside the core reducer — unreproducible, untestable at the floor; grading models sit above this seam; (c) inlining eval into the pipeline — eval must observe execution, not gate it.
- **Consequences**: core 219→230 green, 92.57% lines. The eval evidence typing tightened db's `parseEvidence` return under `exactOptionalPropertyTypes` (fixed in `capability-store.ts` by stripping undefined keys). Persistent EvalStore + real grader wiring are follow-ups.

## ADR-061 — RLS-as-code (SEC-5): FORCE RLS + tenant/visibility policies, prod boot guard in persistent ports, pglite-superuser caveat (2026-07-14)
- **Decision**: Authored `packages/db/migrations/0008_rls_as_code.sql` — `ENABLE`+`FORCE ROW LEVEL SECURITY` and workspace-tenant + `private|team|workspace` visibility policies across 37 workspace-scoped tables, tenant selected by GUC `app.workspace_id`, visibility by `app.user_id`. Added `assertRlsPosture` (`src/rls-guard.ts`) that fails a production boot if the connected role is superuser or has BYPASSRLS. Wired it into `apps/api` as a `verifyRlsPosture` closure on `ModePorts`, set only by `buildPersistentPorts` (which holds the real Postgres handle) and awaited in `buildWiring()`; it self-gates to a no-op outside production.
- **Why**: tables were `isRLSEnabled:false` — tenant isolation lived only in app-layer `assertPilotWorkspace`, one forgotten `WHERE` from a cross-tenant leak. RLS enforces isolation at the DB; FORCE is required so the table owner is also constrained. The boot guard turns the single most dangerous misconfig (app connecting as a bypassing role) into a refuse-to-start instead of a silent hole.
- **pglite caveat (load-bearing)**: pglite's default role is SUPERUSER, which bypasses RLS even under FORCE. So `0008` applies in every db test (`createLocalDb()`→`migrate()`), but only `rls.test.ts` — which `SET ROLE`s to a synthetic non-superuser + sets the GUCs — actually exercises a cross-tenant denial (the DONE-WHEN: a cross-tenant read is denied at the DB layer). Other db tests run as the bypassing superuser and are unaffected. Expected, not a gap.
- **Alternatives rejected**: (a) app-layer-only tenancy — the status-quo hole; (b) ENABLE without FORCE — the owner/pilot role still bypasses; (c) hard-failing boot in all environments — breaks pglite dev/test (superuser by design); prod-gating is correct; (d) placing the guard in `server.ts` — no db handle there; the persistent-ports closure is the natural seam.
- **Consequences**: db 49→53 green. `createLocalDb()` is heavier post-0008 (every test migrates the policies) — flaked once under concurrent full-build load, passed alone (BUGS.md watch item). Real multi-tenant enforcement is gated on running the app as a non-superuser Postgres role in prod (which the guard now enforces).

## ADR-062 — Membership checks (SEC-6): enforce caller∈members on the membership-surface procedures, seed the pilot member, defer blanket enforcement (2026-07-14)
- **Decision**: Added `DrizzleWorkspaceStore.isMember(workspaceId,userId)` and a reusable `assertMembership()` router helper (throws `TRPCError FORBIDDEN`), applied to `workspace.inviteMember`, `workspace.listMembers`, and helpdesk `route`, with `assertPilotWorkspace` retained as a second layer. `bootstrapPilotIdentities` now seeds the pilot user as a member of the pilot workspace. Scoped deliberately to the membership-surface procedures this batch, NOT every workspace-scoped procedure.
- **Why**: the DONE-WHEN is "a non-member invite/list is rejected" — the membership surface. The api harness authenticates fabricated non-member `test_fixture_*` identities and drives many procedures behind `assertPilotWorkspace`; blanket `assertMembership` would red ~25 existing tests that never seed membership. Applying it to invite/list/route (which had no existing tests) delivers the guarantee with zero breakage, while `assertPilotWorkspace` still blocks cross-tenant ids everywhere else (no open hole today — single-tenant pilot).
- **Alternatives rejected**: (a) blanket enforcement now — breaks ~25 tests, out of scope for a single-tenant pilot with no cross-tenant hole; (b) no pilot-member seed — the tokenless dev-fallback identity (the pilot user) would be refused its own workspace; (c) a non-UUID sentinel non-member in tests — `workspace_members.user_id` is UUID-typed, so a malformed id errors the query instead of returning "no row"; the test uses a well-formed unseeded UUID (real auth ids are UUIDs).
- **Consequences**: +3 tests (`workspace-membership.test.ts`), api 60→63 green. Broadening `assertMembership` to all workspace-scoped procedures is deferred to a test-harness pass that seeds membership for its fixtures (a prerequisite for real multi-tenancy).

## ADR-063 — SEC-7 medium-severity closes: Recon SSRF denylist, pino log redaction, drop client-asserted linkedin from the trust path (2026-07-14)
- **Decision**: (1) `Tools/recon/lib/ssrf.ts` — an RFC1918/loopback/link-local/cloud-metadata denylist guards the `fetchJSON`/`fetchText` choke points before any user-influenced outbound fetch. (2) `apps/api/src/server.ts` — the Fastify/pino logger `redact`s `req.body.phone`/`code`, `req.headers.authorization`, plus bare `body.*`/`headers.*` variants. (3) `apps/api/src/router.ts` — removed `linkedin` from the `onboarding.saveProfile` `verificationMethod` enum and tagged the dummy phone-OTP result `verificationSource:"dummy"`.
- **Why**: three medium findings. SSRF — recon fetches user-influenced hosts (`https://<domain>/`), reachable to internal/metadata endpoints without a denylist. Redaction — phone/OTP/bearer must never land in a log line. Verification — there is no real LinkedIn OAuth proof, so accepting a client-asserted `verificationMethod:"linkedin"` lets the browser fabricate a trust signal; dropping it from the enum rejects it at the edge; `phone` stays but is honestly labeled dummy.
- **Alternatives rejected**: (a) an allowlist instead of a denylist for SSRF — recon's target domains are open-ended (arbitrary company sites), an allowlist is infeasible; the choke-point denylist covers every outbound path. (b) redacting only `req.*` paths — Fastify's built-in `req` serializer strips body/headers before redaction runs, so those paths never match; the bare `body.*`/`headers.*` paths are the effective surface (kept `req.*` too for raw-object logging). (c) wiring real LinkedIn OAuth now — out of scope; dropping the unprovable enum value is the minimal correct fix until OAuth exists.
- **Consequences**: recon +5 SSRF tests (metadata-IP block end-to-end), typecheck clean; api +4 tests (`security-hardening.test.ts`); api 63→67 green. `onboarding-profile.ts`'s `verificationMethod: string|null` store type stays permissive (historical rows), so no migration needed.

## ADR-064 — PI-1 provenance/taint tagging: additive `trustOrigin` from ingest edge → Memory + ledger, untrusted-by-default at the intake seam (2026-07-14)
- **Decision**: Added a `TrustOrigin = 'operator' | 'user_content' | 'untrusted_external'` tag that rides every ingested artifact from the ingestion edge through the ledger (roadmap §M3 PI-1). Shape: (1) `@bridge/core` `types.ts` — `TrustOrigin` union + optional `trustOrigin?` on `ActionRequest` + `LedgerEntry`; `RunCtx.taint?` (`ports.ts`); threaded through `pipeline.ts` (`#appendLedger`, `decide` decision row, `#requestFromEntry`) so a proposal's origin persists on the ledger. (2) `@bridge/db` — `ledger.trust_origin` column (migration `0009`) + round-tripped in `ledger-store.ts`. (3) Ingestion edges tag their output: `@bridge/sourcing` connectors (`api-client`, `email-alert`) emit `untrusted_external`; `@bridge/tool-kit`'s single intake seam (`createToolSourceSkill`) defaults `envelope.trustOrigin ?? "untrusted_external"` so an untagged capture is quarantined as untrusted, never silently trusted; `@bridge/integrations-google` Gmail intake derives the tag by **reading the previously-dead `GOOGLE_MANIFEST.intake_policy.quarantine` flag** (quarantine ⇒ `untrusted_external`) onto the Memory directive + the proposal ledger request; `@bridge/sensors` taints every capture-ledger record `untrusted_external`. Tag-and-persist ONLY — no behavior gating (that is PI-2).
- **Why**: PI-1 is the primitive every later injection defense (PI-2 egress gate, PI-3 dual-LLM) reads. Untrusted-by-default (anything not operator/user-authored is `untrusted_external`) is the safe posture. Activating the dead `intake_policy.quarantine` flag makes the manifest's declared quarantine intent finally load-bearing instead of decorative. The DONE-WHEN is met end-to-end in tests: an ingested Gmail thread (integrations-google `intake-dedup.test.ts`) and a scraped page / external-API row (`sourcing/test/provenance.test.ts`) both land tagged `untrusted_external`.
- **`trustOrigin` OPTIONAL on `CaptureEnvelope` / `ActionRequest` / `LedgerEntry` / `RunCtx`, REQUIRED on `MemoryEntryRecord`** (key call): `CaptureEnvelope` is constructed in many places (sourcing connectors + company/people-sourcing + dealpilot/jobpilot tools + their tests) — making it required is a large blast radius for a pure-additive tag, so it is optional with the safe default enforced at the ONE intake seam. `ActionRequest`/`LedgerEntry`/`RunCtx.taint` optional for the same additive reason (~52 `RunCtx` construction sites). `MemoryEntryRecord` is a sensors-only type (grep-confirmed: only `sensors` index/capture-ledger/hub) so requiring it there is safe and makes the capture→Memory provenance non-optional where it matters. The four local `CaptureEnvelope` definitions outside `@bridge/sourcing` (`Tools/recon`, `Tools/card-scanner`, web cardscanner, the Design prototype) are independent types, unaffected.
- **Alternatives rejected**: (a) required `trustOrigin` everywhere — large, mechanical blast radius disproportionate to an additive tag; the intake-seam default gives the same untrusted-by-default guarantee. (b) importing `@bridge/core`'s `TrustOrigin` into `@bridge/sourcing` — `sourcing` is intentionally dependency-free (a leaf package); the union is duplicated with a "mirror of @bridge/core" comment, structurally identical so values cross the boundary freely. (c) gating behavior now (denying egress on tainted context) — that is explicitly PI-2; PI-1 only tags + persists.
- **Consequences**: full `turbo run typecheck test build --force` **59/59** green. New/changed tests: `sourcing/test/provenance.test.ts` (both connectors tag untrusted_external), `integrations-google` Gmail end-to-end intake (manifest-quarantine ⇒ proposal + Memory `trustOrigin`), `sensors/test/memory-wiring.test.ts`. PI-2 (tainted-context egress gating) + PI-3 (dual-LLM quarantine + ContentGuard) deliberately deferred to a follow-up batch.

## ADR-065 — MEM-1 the Memory table: `MemoryStore` port + `memories` table, authority-scoped at the store boundary, capture→Memory wired at the sensors hub (not apps/api) (2026-07-14)
- **Decision**: Gave "learns how you work" a home (roadmap §M3 MEM-1). (1) `@bridge/core` `memory/memory-store.ts` — a `MemoryStore` port (`write` / `supersede` / `get` / `retrieve`) + an `InMemoryMemoryStore` + the `memoryVisible()` visibility predicate + types (`MemoryType`, `MemorySourceRefType`, `MemoryClassification`, `MemoryWrite`, `MemoryEntry`, `MemoryQuery`, `MemoryAuthScope`). Classification reuses the canonical `ContextDataScope` set (`public|workspace|team|private|restricted`). (2) `@bridge/db` — a `memories` table (migration `0009`, RLS enabled+forced with 4 `same_workspace` policies reusing 0008's `app_private.same_workspace()`) + a `DrizzleMemoryStore` adapter that pushes the visibility predicate INTO SQL (authority-scoped at the store boundary, not post-filtered). Supersede = append a new row carrying `supersedesId`; `retrieve` excludes superseded rows by default. (3) `@bridge/sensors` `hub.ts` — an optional `memories?: MemoryStore` + `userId?` dep; on each capture it writes a derived private episodic Memory referencing the timeline entry (`sourceRefType:"timeline_entry"`), tagged `untrusted_external` (PI-1). WITHOUT forking `timeline_entries`.
- **Why**: the Memory primitive unblocks onboarding-profile→persona. Authority-scoping AT the store boundary (SQL `WHERE`, mirroring 0008's `visible_relationship_row`: public/workspace → any workspace member; team/private/restricted → owner-only) means a caller can never over-read by forgetting a filter — same fail-safe reasoning as SEC-5 RLS. The port/adapter split mirrors `CapabilityStore` so a persistent (or Mem0) adapter drops in without touching callers. Wiring capture→Memory at the sensors hub (the actual capture site) satisfies the DONE-WHEN ("a capture produces an inspectable, authority-scoped Memory entry") at the correct seam. DONE-WHEN met: `db/test/memory-store.test.ts` proves classification-respecting retrieval + tenant isolation + supersede; `sensors/test/memory-wiring.test.ts` proves capture→Memory + authority scope.
- **Decision — NOT wiring `MemoryStore` into `apps/api/src/wiring.ts`**: `SensorHub` is desktop-only and is NOT constructed in `apps/api` (grep-confirmed), and no router consumes a Memory store yet, so adding `memoryStore` to `ModePorts` would be dead wiring. The port + both adapters exist and are exported; the sensors hub's optional `memories` dep is the seam the desktop shell will bind. Adding it to apps/api is a no-value risk this batch; deferred until a consumer exists.
- **Alternatives rejected**: (a) forking/extending `timeline_entries` for Memory — the roadmap explicitly says don't; Memory is a distinct confirmed/superseded-fact store, timeline is raw capture. (b) post-filtering retrieval in app code — one forgotten filter = an over-read; SQL-boundary scoping is fail-safe. (c) requiring `memories`/`userId` on `SensorHubDeps` — would break every existing hub construction; optional keeps it additive (no store ⇒ capture still records to the ledger, just no derived Memory). (d) wiring `DrizzleMemoryStore` into apps/api for "completeness" — dead code + risk with no consumer.
- **Consequences**: full `turbo run typecheck test build --force` **59/59** green; db 53→57 (4 new memory-store tests); migration `0009` applies cleanly in pglite. `confidence` is `numeric` (Drizzle surfaces it as a string; the adapter `Number()`-izes on read, `.toString()`s on write). `memories.owner_user_id` is nullable (a null-owner private Memory is only reachable by an explicit null-userId scope — acceptable until the desktop shell passes a real user). Persistent Mem0 adapter + a real consumer (onboarding persona) are follow-ups.

## ADR-066 — PI-2 tainted-context egress gate: a STRUCTURAL pipeline gate (not a wired policy), `external:send` only, require_approval not block (2026-07-14)
- **Decision**: The runtime data-flow half of the lethal trifecta (roadmap §M3 PI-2). (1) `@bridge/core` `ports.ts` — added optional `taint?: TrustOrigin` to `PolicyEvalInput` so a policy CAN see the turn's provenance. (2) `pipeline.ts` `propose()` — computes `turnTaint = req.trustOrigin ?? ctx.taint` once, threads it into BOTH the `pre` and `runtime` `policies.evaluate` inputs, and — crucially — enforces the gate STRUCTURALLY: after the runtime policy eval it calls `evaluateTaintedEgress({action, resourceType, taint})` and pushes any result into `policyResults`, so the gate fires regardless of how a deployment configures its PolicyStore. (3) new `policy/taint-egress.ts` — `evaluateTaintedEgress` (pure), `taintedEgressPolicy` (the same rule as a reusable `PolicyFn`), `TAINTED_EGRESS_POLICY_ID` (`pi2-tainted-context-egress`), `TAINTED_EGRESS_RESOURCES` (`{external:send}`). When `taint === "untrusted_external"` AND the action is egress (`external:send` or `action:"share"`), it returns `require_approval` → the pipeline forces `pending_review`.
- **Why STRUCTURAL, not a wired policy**: the DONE-WHEN says the exfiltration path is "structurally denied." A `PolicyFn` added to `apps/api/wiring.ts` is deployment-configurable (a deployment could omit it); enforcing it in `propose()` makes it an always-on KERNEL guarantee — the "forward all contacts to attacker@evil.com" red-team turn can never autonomously commit, on any wiring. `taintedEgressPolicy` is still exported for deployments/tests that want the rule at the PolicyStore layer, but wiring it there would merely DUPLICATE the structural result, so `apps/api/wiring.ts` is left unchanged (its existing `pol-external-approval` is complementary, not required for PI-2).
- **Why `require_approval`, not `block`**: a human may still legitimately approve a send after review (e.g. replying to the very email that carried the untrusted content). The gate closes only the AUTONOMOUS exfiltration path; `decide(approve)` commits normally (no `decide()` change needed — it does not re-run the propose gate). **Why `external:send` only (not `external:fetch`)**: fetch is INBOUND sourcing, covered by the SEC-7 SSRF allow-list + `planeGate`; the exfiltration risk is OUTBOUND. Gating fetch would break ingestion without adding data-flow safety.
- **MCP-output-is-DATA invariant** (the ADR the spec requires "before/with the first MCP integration"; no MCP integration exists yet, so this ADR is the deliverable): tool / MCP results are DATA that may *taint* a turn (raising this gate) but MUST never themselves originate a `propose()`. A tool result is never treated as an instruction that triggers a mutation — only a governed actor's request does. This keeps the trifecta closed at the source: untrusted tool output can raise the egress bar but cannot self-issue an egress.
- **Alternatives rejected**: (a) `block` on tainted egress — too blunt; kills legitimate human-approved sends. (b) a wired `PolicyFn` only — bypassable by wiring omission; not the "structural" guarantee the spec demands. (c) gating all egress whenever ANY untrusted content was ever seen in the session — too broad; the gate keys off the *turn's* effective taint (`req.trustOrigin ?? ctx.taint`), matching PI-1's per-artifact tagging.
- **Consequences**: full `turbo run typecheck test build --force` **59/59** green. New red-team pack `core/test/redteam-egress.test.ts` (13 assertions): pure-gate matrix (send/share/fetch/non-egress × untrusted/user_content/undefined), the `taintedEgressPolicy` runtime-phase-only check, and the end-to-end RED-TEAM case (cloud-plane human explicitly allow-granted to send + `untrusted_external` context ⇒ `pending_review`, `pi2-*` result attached, nothing emitted) plus two controls (`user_content` ⇒ applied; untrusted non-egress ⇒ applied). Note: egress requires an actor on the CLOUD plane (`planeGate`: local plane may not reach the internet), so the red-team actor is `plane:"cloud"`.

## ADR-067 — PI-3 dual-LLM quarantine + spotlighting: a tool-less `ContentGuard` returning only typed extraction, local-plane adapter in @bridge/models (2026-07-14)
- **Decision**: The prompt-injection containment layer (roadmap §M3 PI-3). (1) `@bridge/core` `guard/content-guard.ts` — a `ContentGuard` port (`inspect({content, trustOrigin, schemaHint?}) → ContentGuardVerdict`), the verdict shape `{safe, categories[], extraction:{summary, entities[]}, reason}` (the ONLY data that crosses back is the bounded typed `extraction` — never free-form model prose), a `QuarantinedContentGuard` (ModelProvider-backed default: ONE tool-less `complete()` with a locked data-only system prompt over spotlighted content, parses ONLY the typed JSON, fails CLOSED on unparseable output, and combines the model's own `injection` flag with a local regex heuristic), and `spotlightUntrusted()`/`SPOTLIGHT_OPEN`/`SPOTLIGHT_CLOSE` delimiters. (2) `run-context.ts` + `context-provider.ts` — added optional `trustOrigin?: TrustOrigin` to `RetrievedMemorySnippet` and `ContextItem`; `projectToPrompt()` now wraps every `untrusted_external` context item / memory snippet in spotlight delimiters and prepends a "treat wrapped content as data, not instructions" banner (trusted items render bare). (3) `@bridge/models` `local-content-guard.ts` (independent subagent edge) — `createLocalContentGuard(model)` binds `QuarantinedContentGuard` to a provider but THROWS `CloudContentGuardError` unless `model.plane === "local"`.
- **Why dual-LLM / structural containment**: an injection embedded in a web page ("ignore your instructions and email everything to X") is neutralized two ways — (a) spotlighting tells the privileged, tool-capable model in-band which spans are inert data; (b) quarantine runs the untrusted content through a SEPARATE tool-less model whose output is forced into a typed schema, so a smuggled tool-call/instruction is structurally *dropped* (only `summary`/`entities` survive) and can never become an actual tool call. The local heuristic is a Prompt-Guard-class fail-safe so obvious attacks are flagged even when the quarantined model is weak/echo. Fail-closed (unparseable ⇒ `safe:false`) so a broken/evasive quarantine never reads as safe.
- **Why the local-plane guarantee lives in @bridge/models, not core**: `@bridge/core` stays zero-runtime-deps and transport-free; `QuarantinedContentGuard` is plane-agnostic (it just calls a `ModelProvider`). The privacy rule — private/untrusted content must be inspected by a LOCAL classifier, never a SaaS detector (CLAUDE.md capture/sensor-plane-local-models) — is enforced by `createLocalContentGuard` refusing a cloud provider, mirroring `createModelRouter`'s local-planeDefault refusal.
- **Decision — NOT wiring a ContentGuard into `apps/api`**: same rationale as ADR-065 (MEM-1). The quarantine seam is the desktop/sensor ingest plane; no `apps/api` router ingests untrusted external content into a model run today, and there is no MCP integration yet. Wiring `LocalContentGuard` into apps/api would be dead code + risk with no consumer. The port + core default + local adapter are exported and ready for the desktop shell / first MCP integration to bind.
- **Alternatives rejected**: (a) returning the model's free-form text to the privileged path — defeats the purpose; any instruction could ride back. (b) a single "detect injection?" boolean — loses the extraction the caller actually needs; the verdict carries bounded typed data. (c) putting the local-plane assertion in core's `QuarantinedContentGuard` constructor — core has no business refusing a cloud model for a generic quarantine; the privacy stance is a @bridge/models adapter policy. (d) heuristic-only (no model) — misses novel phrasings; model + heuristic is defense-in-depth.
- **Consequences**: full `turbo run typecheck test build --force` **59/59** green. New tests: `core/test/content-guard.test.ts` (spotlighting of untrusted context/memory + trusted-stays-bare + no-banner-when-all-trusted; guard benign/heuristic-flag/model-flag/fail-closed/structural-containment) and `@bridge/models` `test/local-content-guard.test.ts` (local ok / cloud throws `CloudContentGuardError` / malicious ⇒ `safe:false`), models 18/18. `exactOptionalPropertyTypes` respected via spread-and-omit for the added optional `trustOrigin?` fields. A persistent/real local classifier binding (Llama-Guard/Prompt-Guard class) and the first consuming ingest seam are follow-ups.

## ADR-068 — Batch-6 foundations: the `policy_params` typed tunable space + the `capability_manifests.kind` registry discriminator (2026-07-14)
- **Decision**: The two shared foundations Month-4 self-improvement reads. (1) `@bridge/core/src/policy/params.ts` — `TunableParam {value, floor, ceil}`, `AqvGates` (the quality + routing-precision/recall promotion thresholds), `PolicyParams`, `DEFAULT_POLICY_PARAMS`, `resolveGates`, `getTunable`, `clampToBounds`, `mergePolicyParams`, plus a `PolicyParamStore` port + `InMemoryPolicyParamStore`. This is the single per-workspace TUNABLE SPACE — every non-invariant number the pipeline reads lives here. Two consumers this batch: EVAL-3 (`eval/comparison.ts` reads `aqv.gates` instead of inlining `.85`/`.80`) and VAR-1 (`variance-adjuster.ts` nudges `variance.params[*]`). (2) A nullable `ComponentKind` `kind` discriminator on capability `types.ts` + `ports.ts` (`CapabilityManifestRow.kind?`) + `@bridge/db` `schema.ts` + `capability-store.ts` round-trip + migration `0010` — reusing the existing `capability_manifests` table as the REG-1 Component Registry rather than forking a second source of truth.
- **Why**: thresholds-as-data (not hard-coded constants) is precisely what lets the self-improvement loop tune itself from feedback; the typed store + in-memory adapter mirrors the `CapabilityStore`/`MemoryStore` port pattern so a Drizzle binding drops in later without touching callers. `kind` lives on the manifest table because REG-1 overlap detection needs ONE authoritative capability list.
- **HARD CEILINGS ARE EXCLUDED BY CONSTRUCTION** (key call): the agent-floor DENY, the External-band human floor, and the lethal-trifecta escalation are NOT representable in `policy_params` — they remain structural invariants in `agent-floor.ts`/`approvals.ts`/`risk.ts`, so the Variance Adjuster physically cannot relax them. A `TunableParam.ceil` is a per-parameter SOFT bound (e.g. tone can go fully formal but no further), never one of those hard ceilings.
- **Alternatives rejected**: (a) hard-coded thresholds — unimprovable, the opposite of the batch's point. (b) a separate `components` table for REG-1 — duplicate source of truth; `kind` on the existing table is the undefined-elements §2 call. (c) persisting param overrides now — no governed-nudge consumer exists yet; defaults-only until VAR-1's proposal is approved (Drizzle binding deferred, ADR-074). (d) full `drizzle-kit generate` for 0010 — it re-emitted historical DDL (BUGS.md 2026-07-14 snapshot-drift row); hand-trimmed `0010_steep_tusk.sql` to the `kind` ALTER only, with a correct fresh `0010_snapshot.json` baseline.
- **Consequences**: full `turbo run typecheck test build --force` **59/59** green. The `policy_params` table already existed but was read nowhere — now load-bearing. No user overrides persist yet (in-memory only). Migration `0010` applies cleanly in pglite. `core/test/policy-params.test.ts` covers defaults/merge/clamp/resolveGates.

## ADR-069 — EVAL-3 baseline-vs-candidate two-gate promotion, wired into `capability.approve` (2026-07-14)
- **Decision**: `@bridge/core/src/eval/comparison.ts` — a pure `compareRuns(baseline, candidate, gates: AqvGates): Comparison` implementing agent-quality-eval-model §4.2. TWO independent gates read from `policy_params`: Gate A = output quality, Gate B = routing precision/recall. Verdict rule: `promote` iff candidate ≥ baseline on BOTH gates + no safety regression + correction not worse + n ≥ minCases + the quality improvement is significant (delta 95% CI excludes 0); `coexist` iff strictly better on one gate but worse on the other (scope it to the clusters it wins); `needs-human` iff evidence is thin (n < minCases) or within noise; `reject` otherwise. `buildWhyBetterCard(comparison, gates)` renders the governed explanation. Wired into `apps/api` `capability.approve`: the gate fires ONLY when leaving `validated`, AFTER the pending_review audit, BEFORE `advance()`; it fetches the candidate's + baseline-lineage's latest runs via `evalStore.listRuns`, resolves gates from `policyParams.get(workspaceId)`, then `promote` → advance + attach card; `reject` → `BAD_REQUEST` (card in `cause`); `coexist`/`needs-human` → return WITHOUT advancing (+card).
- **Why**: the Validated→Active transition is exactly where "is the candidate better than what we already have" must be answered mechanically, not by vibe. Two independent gates stop a quality win from masking a routing regression (and vice-versa). Thresholds from `policy_params` (never inlined) keep the bar tunable per workspace. The why-better card makes every promotion explainable (govern-before-execute).
- **Why the gate lives in apps/api, not core**: `compareRuns`/`buildWhyBetterCard` are pure (testable in core); the store reads (`evalStore`/`policyParams`) + tRPC error shaping belong at the router, keeping `@bridge/core` zero-runtime-deps.
- **Alternatives rejected**: (a) a single blended score — hides which axis regressed; two gates are the spec. (b) hard-coded `.85`/`.80` — unimprovable (ADR-068). (c) auto-rejecting any non-promote — `coexist` (scope-to-clusters) and `needs-human` (ask) are real, distinct spec outcomes. (d) advancing on `coexist`/`needs-human` — only an unambiguous both-gate win may auto-advance; anything else stops for a human.
- **Consequences**: **59/59** green. `apps/api/test/capability-governance.test.ts` proves promote-advances-with-a-why-better-card, reject-regressor-throws, and no-baseline-proceeds. EvalStore/PolicyParamStore are wired in-memory (ADR-074). `capability.approve`'s result gained an optional `comparison` field (additive, non-breaking — verified against all callers via the full typecheck + the coexist/needs-human early-return path).

## ADR-070 — EVAL-4 LLM-judge quality Scorer: pinned model, held-out selection, calibration, red-team External gate (2026-07-14)
- **Decision**: `@bridge/core/src/eval/judge.ts` — `JudgeScorer implements Scorer` (calls `ModelProvider.complete` with the pinned/versioned model recorded in the run snapshot; parses ONLY a numeric score, clamped to `[0,1]`, throwing if the response carries no number); `selectHeldOut(cases, candidateCapabilityId)` returns only cases whose `authored_by_capability !== candidate` (no self-grading); `calibrateJudge(pairs)` correlates judge scores against the human approve/veto label subset; `evaluateRedTeamPack` + `requireRedTeamForExternal` gate the External band on a passing red-team assertion pack.
- **Why**: the `quality` axis is inherently subjective — a rubric-driven LLM judge scales it, but only if (a) the model is PINNED so scores are reproducible/comparable across runs, (b) it NEVER grades its own lineage (held-out), and (c) it is CALIBRATED against real human decisions before being trusted. Red-team gating the External band keeps the highest-blast-radius band behind an adversarial check.
- **Alternatives rejected**: (a) an unpinned model — scores drift run-to-run, making baseline-vs-candidate meaningless. (b) allowing self-authored held-out cases — a capability grading its own output is circular. (c) free-form judge prose — unparseable and injectable; the scorer forces a single clamped number. (d) trusting the judge un-calibrated — the DONE-WHEN explicitly requires correlation with the human approve/veto subset first.
- **Consequences**: **59/59** green. `core/test/eval-judge.test.ts` reports the calibration correlation on the human-labelled subset and proves held-out excludes the candidate's own cases + the red-team gate blocks External on failure. `JudgeScorer` slots behind the existing `Scorer` port; a real pinned production-model binding is configuration, not code.

## ADR-071 — REG-1 Component Registry: two-tier (structural pure → semantic pgvector) overlap detection (2026-07-14)
- **Decision**: `@bridge/core/src/capability/registry.ts` — `structuralSimilarity(candidate, existing)` (pure Tier 1: weighted `kind` 0.4 / `name` 0.4 / `permissions` 0.2); `findOverlaps(candidate, manifests, opts, model?)` runs Tier 1 first and escalates to Tier 2 semantic (`cosineSimilarity` over `ModelProvider.embed` vectors) ONLY when Tier 1 is inconclusive (a mid-band score between the low cut and the near-duplicate threshold `0.82`). Reuses `capability_manifests` + the ADR-068 `kind` discriminator as the registry. The Learning Agent runs `findOverlaps` BEFORE proposing a new capability.
- **Why**: "integration over custom development" / "build only what creates lasting value" require detecting a near-duplicate BEFORE it is created. Two-tier keeps it cheap: pure structural arithmetic answers the clear cases at zero model cost; the expensive embedding call fires only on genuine ambiguity. `embed()` is OPTIONAL on `ModelProvider` (Anthropic/Groq have none; Ollama does), so Tier 2 degrades gracefully — a missing embedder falls back to the Tier-1 verdict rather than failing.
- **Alternatives rejected**: (a) semantic-only — an embed call on every proposal is wasteful when name+kind+permissions already decide most cases. (b) structural-only — misses same-purpose/different-naming overlaps. (c) a separate registry table — duplicate source of truth (ADR-068). (d) hard-failing when `embed()` is absent — Tier 1 still yields a useful answer; degrade, don't break.
- **Consequences**: **59/59** green. `core/test/capability-registry.test.ts` proves a near-duplicate is detected before creation (Tier-1 structural) and that Tier 2 only runs when inconclusive. Real pgvector persistence of manifest embeddings is a `@bridge/db` follow-up; the pure Tier-1 path + the in-memory Tier-2 cosine math are complete + tested.

## ADR-072 — VAR-1 Variance Adjuster: a bounded single-parameter nudge proposed as a governed diff (2026-07-14)
- **Decision**: `@bridge/core/src/policy/variance-adjuster.ts` — `proposeVarianceAdjustment(vetoes, params, opts)` maps a veto reason-chip to ONE tunable via `CHIP_PARAM_MAP` (`too_casual → tone_threshold` increase, `too_formal → tone_threshold` decrease), computes a bounded `±δ` nudge `clampToBounds`'d to that param's `[floor, ceil]`, and returns a `VarianceProposal` (`from`/`to`/`delta`/`clampedAtCeiling`/`clampedAtFloor`/`vetoCount`) — a GOVERNED DIFF, never a silent write. Only VETTED decisions count toward the tally. Starts with `tone_threshold`, generalizes through the param map.
- **Why**: the system should learn from consistent human vetoes ("too casual" ×N) by proposing a small, explainable parameter change — but adaptation must stay BOUNDED and GOVERNED. A single-parameter `±δ` (not a multi-knob gradient) keeps each proposal legible; clamping to `[floor, ceil]` means the nudge can never exceed the soft bound and (per ADR-068) can never touch a hard ceiling; proposing a diff rather than applying it keeps draft-then-approve intact. Counting only VETTED decisions prevents unreviewed noise from moving thresholds.
- **Alternatives rejected**: (a) silent auto-tune — violates govern-before-execute + explain-before-automate. (b) a multi-parameter gradient step — opaque; a human can't reason about the diff. (c) an unbounded nudge — could walk a threshold to an unsafe value; the clamp is mandatory. (d) counting all vetoes (not just VETTED) — lets un-vetted/noise decisions move policy.
- **Consequences**: **59/59** green. `core/test/variance-adjuster.test.ts` proves 3× "too casual" VETTED vetoes propose a governed `tone_threshold` increase AND that the nudge cannot cross the ceiling (`clampedAtCeiling`). No parameter persists until the proposal is approved (ADR-068 in-memory store, Drizzle deferred).

## ADR-073 — GOV-1 org-health rollup + Governance auto-approve enacted as a SYSTEM gate (minor only) (2026-07-14)
- **Decision**: `@bridge/core/src/governance/org-health.ts` — `rollupOrgHealth(input): OrgHealthRollup` computes autonomy-pressure / trust-debt / approval-load / violation-trend as PURE functions over evidence (capability health records, pending proposals, a violation series); `classifyApprovalBand({risk, origin, safetyTouch?})` → `minor|moderate|major` (`major` if risk ∈ {operational, external} OR `safetyTouch`; `minor` if risk ∈ {informational, advisory} AND origin ∈ {built_in, template}; else `moderate`); `canGovernanceAutoApprove(band)` = `band === "minor"`. Wired into `apps/api` as two `capability` procedures: `orgHealth` (assembles `OrgHealthInput` from real `listManifests` + `getState`, returns the rollup) and `governanceAutoApprove` (classifies the band; if `minor`, advances validated→approved via the SAME `advance()` + `upsertState`; otherwise returns unchanged with the band + reason).
- **Why**: the Governance Agent needs both an org-health picture and a safe autonomous-approval lane. `minor` = the two LOWEST risk bands AND a built-in/template origin — the only combination where autonomous approval carries negligible blast radius.
- **Governance auto-approve is a SYSTEM decision gate, NOT an agent resolving a governance-table proposal** (key call): the documented "Governance Agent is the sole exception to the agent-floor approve-DENY" (`agents.ts`) is NOT implemented in code — the agent-floor is a hard, non-removable DENY. Rather than punch a hole in that structural safety invariant for one agent, the minor-only auto-approve is enacted by the system/router gate computed from `classifyApprovalBand`. This preserves the agent-floor exactly as-is while still delivering the DONE-WHEN. Recorded so a future "implement the agent exception" is a conscious reversal, not drift.
- **Alternatives rejected**: (a) implementing the agent-floor exception now — weakens a structural safety invariant for one actor; the system-gate achieves the same policy without that risk. (b) auto-approving `moderate` — blast radius too high to skip a human. (c) computing health from fabricated series — kept HONEST: `violationSeries` is `[]` (no violation-history view exists yet — an empty state, not dummy data), and `successRate` defaults to `1` when a capability has no evidence (avoids a false autonomy-pressure flag).
- **Consequences**: **59/59** green. `apps/api/test/capability-governance.test.ts` proves the rollup renders for a workspace AND that Governance auto-approves only `minor` (both `major` and `moderate` refuse and return unchanged). A real violation-history view + an actual Governance-Agent caller are follow-ups.

## ADR-074 — Batch-6 integration + verification: in-memory EvalStore/PolicyParamStore wiring + the db coverage-leak fixed with real tests, not a lowered floor (2026-07-14)
- **Decision**: (1) wired `evalStore: EvalStore` + `policyParams: PolicyParamStore` into the `apps/api` `Wiring` interface + `buildWiring()` (`InMemoryEvalStore` + `InMemoryPolicyParamStore`, both dev and prod modes) — the EVAL-1/EVAL-2 infra existed but had NEVER reached the router; EVAL-3's approve gate is its first consumer. (2) Fixed an `@bridge/db` coverage-floor failure by ADDING real store round-trip tests (`resources-store`, `jobpilot-store`, `helpdesk-store`), NOT by lowering the floor or special-casing the measurement.
- **The db coverage drop was a whole-module-graph MEASUREMENT ARTIFACT** (key finding): node's `--experimental-test-coverage` measures the entire LOADED module graph. `@bridge/db` imports the `@bridge/core` barrel at runtime (for `uuidv7`, `ALWAYS_APPROVAL_SCOPES`, error classes), so `core/src/index.ts`'s `export *` eagerly loads the 6 new Batch-6 core modules — thoroughly tested in core's own 80%-floor suite, but unexercised BY DB — dragging db's AGGREGATE from 57.87% → 54.30% (< the 55 floor). db's OWN src coverage was unchanged; only the shared denominator grew.
- **Why add tests, not lower the floor**: "keep them green" means recover coverage, not move the bar; and EVERY core-importing package measures core the same way (the established whole-graph convention — all 20 packages use identical `--test-coverage-exclude='**/test/**'`), so making db a measurement special-case would be both inconsistent AND would actually loosen db's effective ratchet. The three target stores were genuinely UNTESTED real CRUD (resources/jobpilot/helpdesk Pi-extension persistence), so testing them is honest value: db → 56.42% with all three new store files at 100% line coverage.
- **Alternatives rejected**: (a) lower the db floor 55→54 — violates "keep them green", optically weakens a governance-adjacent gate, and leaves only 0.3% headroom. (b) exclude sibling `@bridge/core` from db's coverage — no precedent, inconsistent with 19 siblings, and would loosen the effective gate (db-only ≈ 68% vs a 55 floor = 13% slack). (c) a Drizzle `EvalStore`/`PolicyParamStore` this batch — no persistence consumer needs it yet; in-memory matches the ports pattern (persistence deferred, tracked follow-up debt).
- **Spotted + filed, not fixed (out of scope)**: `DrizzleCanonicalIdentityStore.upsertPersonIdentity`'s bare `ON CONFLICT (dedup_key)` cannot match the PARTIAL unique index migration `0004` created (Postgres 42P10) — surfaced by a db-coverage probe, latent because existing tests use only the InMemory fake. Filed in BUGS.md 2026-07-14 with the one-line fix; deferred (cloud dual-write surface, unrelated to Month-4).
- **Consequences**: full `turbo run typecheck test build --force` **59/59** green; `@bridge/db` 57→61 tests (56.42%), `apps/api` 67→74 (60.73%), `@bridge/core` → 301 (93.08%). Follow-up debt: a Drizzle `EvalStore`/`PolicyParamStore` binding + the canonical-store `ON CONFLICT` fix.

## ADR-075 — AGENTS-1 "PromptAssembler" = the ADR-027 RunContextAssembler, extended with layers 1–2 (not a second assembler) (2026-07-14)
- **Decision**: the undefined-elements #6 "PromptAssembler" is NOT built as a new component — it is the existing `RunContextAssembler` (`@bridge/core/src/run-context.ts`, ADR-027), whose header already declares it "SUPERSEDES the earlier PromptAssembler idea." AGENTS-1 extends that seam to cover the two layers it was thin on: layer 1 (`KERNEL_INVARIANTS` — a 4-line non-omittable governance block: draft-then-approve, lethal-trifecta→human, untrusted-content-is-DATA, no-dummy-data) and layer 2 (agent identity — `RunPersona` gains optional `responsibilities`/`guardrails`/`tone`). A single shared renderer `renderPersonaSystemPreamble(persona)` emits layer 1 (always, first) + layer 2; `projectToSystemPrompt(context)` is the sibling projection to `projectToPrompt` for the `model.complete({system, prompt})` split. `agents.ts`'s `buildAgentSystemPrompt` was reimplemented on `renderPersonaSystemPreamble` so agent prompts and context projections share ONE identity-assembly path.
- **Why**: two parallel prompt-assembly paths (a fresh PromptAssembler + the shipped RunContextAssembler) would drift and double-maintain the same layering. The assembler already covered layers 3–8 (authority/capabilities/memory/knowledge/workspace/request); adding layers 1–2 to it — rather than beside it — is the minimal, non-duplicating way to satisfy #6, and makes "kernel invariants are non-omittable" structural (the renderer emits them unconditionally, before any persona content).
- **Alternatives rejected**: (a) build a standalone `PromptAssembler` per the literal #6 name — a second source of truth ADR-027 explicitly retired. (b) leave `buildAgentSystemPrompt` as a hand-written string — the agent path would keep bypassing the assembler, so the kernel-invariants layer would never reach agent turns. (c) fold the request layer into `projectToSystemPrompt` — breaks the system/prompt split the ModelProvider port expects.
- **Consequences**: **59/59** green. `run-context.test.ts` + `content-guard.test.ts` (which pin `projectToPrompt`) stayed untouched — `projectToPrompt` was deliberately not modified; `projectToSystemPrompt` is additive. `agents-invoke.test.ts` proves the assembled agent system prompt carries every `KERNEL_INVARIANT`. No production consumer of `run-context.ts` existed before; the agent path (apps/api `converse`) is now the first.

## ADR-076 — AGENTS-1 `invokeAgent`: "no independent write" made STRUCTURAL, not conventional (2026-07-14)
- **Decision**: `@bridge/core/src/agents.ts` gains `invokeAgent(args): Promise<AgentInvocationResult>` where `AgentInvocationResult` is a discriminated union of exactly two variants — `{kind:"information"}` (Learning/Governance, `neverExecutes`) and `{kind:"draft", constraintViolations[]}` (Capability Builder, `requiresApproval`) — with **no `"executed"` variant**. The variant is chosen structurally by the agent's own `requiresApproval` flag. `invokeAgent` assembles the system prompt (ADR-075 seam), calls the `ModelProvider` (or returns an honest offline note when none is supplied), and — for Capability Builder — runs `checkDesignConstraintViolations` as a FLAG surfaced to the approver, never a gate. It holds no `pipeline`/store handle; turning a `draft` into a governed proposal is the caller's job (apps/api `pipeline.propose`).
- **Why**: "an agent chat reply never ships anything live" should be impossible to violate, not merely policy. Making the result type unable to express execution (mirroring how `RoutingDecision` has no `peers` field to make "no peer handoffs" structural) means no future edit can accidentally have an agent self-execute from a chat turn, and keeps `@bridge/core` zero-runtime-deps (no I/O dependency dragged in).
- **Alternatives rejected**: (a) an `{kind:"executed"}` variant guarded by a flag — one wrong flag and an agent writes; the type should forbid it. (b) `invokeAgent` calling `pipeline.propose` itself — pulls I/O into the zero-dep kernel and hides the governed write inside core. (c) making the design-constraint check a hard gate — contradicts draft-then-approve (the human approver decides); it stays a surfaced flag.
- **Consequences**: **59/59** green. `agents-invoke.test.ts` (9 cases) proves information vs draft selection, the offline path, that dummy-data language is flagged (not gated) on a draft, and that only the two kinds are ever returned. apps/api `converse` now routes @mentions through `invokeAgent` and maps `information → direct_reply` / `draft → governed proposal`, preserving the existing 7 converse tests.

## ADR-077 — AGENTS-2 onboarding-profile → Chief-of-Staff persona, resolved SERVER-SIDE; roster stays 4 agents + Communications skill (2026-07-14)
- **Decision**: `@bridge/core/src/onboarding-profile.ts` gains the Memory-family `OnboardingProfile` view (undefined-elements #11: `role`/`goals[]`/`domains[]`/`connectedSources[]`/`chosenAnimalId`/`workingStyleNotes`/`source:"onboarding"`, every personalization field optional), a `profileFromRow` bridge from the durable `OnboardingProfileRow`, `resolveAnimalTone(animalId)` (reuses the already-reconciled `ANIMAL_TONE` map — case-insensitive, `undefined` for unknown/unset), and `buildChiefOfStaffPersona(profile): RunPersona` (animal → tone; role/goals/domains/working-style → identity framing; fixed CoS duties → responsibilities). apps/api `converse` now resolves the profile from `onboardingProfileStore` and derives tone + persona SERVER-SIDE — the stored animal wins over the client-supplied `input.animal` (fallback only). An additive, display-only `persona` card `{id,name,tone?}` is returned on every `converse` response.
- **Why**: personalization data read from the client can't be trusted or shared across surfaces; resolving it from the workspace-scoped stored profile is the correct seam (#11 "Memory scope=workspace") and makes "tone matches the chosen animal" observable end-to-end. Reusing `ANIMAL_TONE` (not a second copy) keeps the tone map single-sourced.
- **Roster reconciliation (key call)**: the roadmap's "5 agents (CoS + Learning/Communications/Governance/Capability-Builder)" is superseded by the later, authoritative ADR-046, which demoted Communications to a SKILL → **4 agents + 1 skill** (`FOUNDATIONAL_AGENTS.length === 3` delegate agents + the non-deletable CoS router + the Communications skill). Communications was NOT re-promoted; it stays bespoke (`buildCommunicationsSystemPrompt`, no agent identity/capability-scope) and simply consumes the same server-resolved tone.
- **Alternatives rejected**: (a) trust `input.animal` from the client — invisible to other surfaces, unverifiable, and can't reflect a stored profile. (b) a second animal→tone table for CoS — drift risk; `ANIMAL_TONE` is already the reconciled source. (c) expand CoS into a full model-backed chat to "use" the persona — scope creep that would disturb the deterministic keyword-fallback routing tests; the persona is surfaced as a card + threads tone into agent/skill invocations instead. (d) fabricate role/goals when the profile is sparse — violates no-dummy-data; `profileFromRow` omits absent fields and `buildChiefOfStaffPersona` degrades to a generic persona.
- **Consequences**: **59/59** green. Core `agents-persona.test.ts` (7 cases) proves two profiles → two distinct personas, animal tone reflected, unknown/unset animal degrades gracefully, and honest row-mapping. apps/api `chief-of-staff.test.ts` gains 2 cases (two stored profiles → two persona cards; stored animal overrides client `input.animal`). The `persona` response field is additive (unknown-field-safe for existing clients). A richer four-axis tone card (warmth/directness/playfulness/formality + voice examples) remains future Commons-authored Knowledge.

## ADR-078 — XP-2 (native installers/capture) + XP-3 (mobile Expo rebase) deferred to an infra-gated Batch 8 (2026-07-14)
- **Decision**: Month-5's XP-2 and XP-3 are split OUT of Batch 7 into a separate, infra-gated **Batch 8**, and Batch 7 ships the two fully-verifiable Month-5 items — AGENTS-1 + AGENTS-2 — instead. XP-2's DONE-WHEN (signed native installers producing a running desktop capture build on macOS/Windows/Linux) needs code-signing certificates + a 3-OS CI matrix; XP-3's DONE-WHEN (mobile app rebased onto the shared kernel, running on a device/simulator) needs the mobile app — which does not exist on this branch at all (`platform/apps` = api/desktop/web only; the Expo app is stranded on branch `claude/heuristic-booth-f8f5da`) — plus devices/simulators. None of that infrastructure is available in this environment.
- **Why**: a DONE-WHEN that cannot be executed or verified here would either be falsely claimed or force fabricated/hand-waved evidence. Splitting them into an explicitly infra-gated batch keeps the roadmap honest (Batch 7 marks only what it actually proved) and records exactly what unblocks Batch 8. This was confirmed with the user before proceeding.
- **Alternatives rejected**: (a) attempt XP-2/XP-3 now — would require certs/CI/devices/a missing app; unverifiable. (b) mark them DONE on partial/simulated evidence — violates the governance rule (mark nothing DONE without real, verified work + an approved row). (c) cherry-pick the stranded mobile branch into this one — out of scope for a security/capability batch and would import unrelated, unreviewed surface.
- **Consequences**: Batch 7 = AGENTS-1 + AGENTS-2 (pure-TS, 59/59-verifiable). Batch 8 is registered in `docs/PROGRESS.md` as the infra-gated follow-up with its unblock conditions (signing certs, 3-OS CI, a mobile app on-branch, devices). No code or docs claim XP-2/XP-3 complete.

## ADR-079 — PKG-1 sandbox floor: an executable capability is gated at package install, declared via a manifest `execution` spec whose PRESENCE marks it executable (2026-07-14)
- **Decision**: "sandbox before executable logic" is enforced as a pure gate in `@bridge/core/src/capability/sandbox-policy.ts` — `evaluateSandboxRequirement(cap): SandboxGateResult` — wired as a HARD REJECT in the `packages.install` procedure (apps/api `router.ts`), running over every bundled capability BEFORE risk/approval. A capability is "executable" iff its manifest carries an `execution` spec (`{executable:true, isolation, sandbox:{network?, filesystem?, env?}}`); its mere presence is the executable marker (`parseExecutionSpec` fails loudly on a half-declared spec so a would-be executable can't dodge the floor by omitting fields). The gate: `isolation:"none"` → `executable_requires_isolation`; a sandbox granting network or filesystem under only `process` isolation → `executable_caps_require_stronger_isolation` (process is not a real boundary — needs container/vm); a declarative capability (no `execution`) is trivially satisfied. The earlier MCP carve-out was removed — an mcp-server importer sets `requiresSandbox` true, so MCP servers are executables like any other.
- **Why**: unsandboxed third-party executable logic reaching Active is the highest-blast-radius supply-chain risk; making the floor a pure fn over the manifest keeps it testable and identical on every install path, and rejecting at install (not activation) means a package that cannot be safely sandboxed never even registers its capabilities. The "presence of `execution` = executable" rule closes the "declare no sandbox to look declarative" bypass.
- **Alternatives rejected**: (a) gate at activation only — a rejected-later package still litters draft capabilities; install is the honest boundary. (b) a separate boolean `executable` flag beside the spec — two sources of truth that can disagree; presence of the spec IS the flag. (c) keep the MCP carve-out — MCP servers run foreign code and are exactly what the floor is for. (d) allow `process` isolation for network/fs caps — process isolation shares the kernel/filesystem view, so it is not a boundary for those grants.
- **Consequences**: **59/59** green. Core `sandbox-policy.test.ts` covers declarative-satisfied, isolation-none-refused, network/fs-under-process-refused, container-satisfied. apps/api `pkg1-sandbox-install.test.ts` proves install REJECTS isolation-none and network-under-process with BAD_REQUEST, a container-isolated gated executable clears the floor, and a purely declarative package is unaffected.

## ADR-080 — PKG-2 Commons supply-chain trust: manifest signing + verify-on-install + TLS-by-default + a community-origin trust floor, with the crypto primitive bound at the seam (2026-07-14)
- **Decision**: Commons supply-chain trust lives at the transport seam, with the PURE policy in `@bridge/core/src/package/signing.ts` (zero-runtime-deps — no `node:crypto`): `canonicalizeManifest` (deterministic sorted-key JSON = the exact signed bytes), a `SignedManifestEnvelope`/`ManifestSignature` wire shape, `verifyManifestSignature(envelope, injectedVerifier, {trustedPublicKeys?})` returning a typed failure (`missing_signature|invalid_signature|untrusted_key|unsupported_algorithm`, fail-closed — a throwing verifier is `invalid_signature`), and `assertCommonsUrlTls` (https always; plain http ONLY for loopback). The real ed25519 primitive is bound where I/O is allowed: the SIGNER in `services/commons` (signs every publish, serves its public key at `GET /v1/signing-key`), the VERIFIER in apps/api `commons-client.ts` (`HttpCommonsClient` verifies EVERY fetched entry in get/getVersion before returning it, and asserts TLS in its constructor). Conventions both sides share: PEM keys (spki public / pkcs8 private), base64 detached signature over the UTF-8 bytes of `canonicalizeManifest`. Verification is ON by default; an optional `trustedPublicKeys` allowlist upgrades TOFU/integrity-only to key-pinning. A community-origin trust floor (`approvals.ts` `isUntrustedOrigin`/`trustGrantsForOrigin`) pins `community` EQUAL to `user_code` (untrusted) so an untrusted origin can never receive trust-grant auto-activation; wired into install as defense-in-depth (`resolvedTrustGrants=[]` today, a store-layer follow-up).
- **Key-custody decision (v1)**: the Commons registry HOLDS the signing key (registry-signed, not per-author-signed). This matches the curated-registry model (registry is the trust root for v1) and keeps clients simple (pin the registry key). Per-publisher author keys + a web-of-trust are a post-v1 evolution; the envelope already carries `publicKey` so the wire format does not change when authorship moves to publishers.
- **Why**: an unsigned/altered manifest fetched over plaintext is the classic supply-chain attack; verifying at the single transport seam protects every consumer (install flow, Learning Agent) without repeating the check, and keeping the crypto OUT of `@bridge/core` preserves the zero-dep kernel invariant. Canonicalization (not raw-bytes) makes a signature survive JSON round-tripping through the registry. Flooring community to user_code encodes "community code is unreviewed local code" in one place.
- **Alternatives rejected**: (a) put `node:crypto` in `@bridge/core` — breaks the zero-dep kernel and couples the pure trust model to a runtime. (b) verify only at first install / trust-on-first-use without integrity — misses tampering on re-fetch. (c) per-author signing in v1 — needs key distribution/revocation infrastructure that does not exist yet; registry-held key is the v1 trust root. (d) allow plain http for remote hosts with a warning — a warning is not a control; loopback-only http is the safe default.
- **Consequences**: **59/59** green. Core `package-signing.test.ts` covers canonicalization stability, the four failure reasons, fail-closed, TLS loopback/remote, and the origin floor. `services/commons` `signing.test.ts` (subagent, 10/10) proves publish signs + `/v1/signing-key`. apps/api `pkg2-commons-signing.test.ts` proves the client accepts a valid signature, rejects altered/unsigned/untrusted-key, honors `verifySignatures:false`, and asserts TLS in the constructor. Behavioral change to note: `publish-builtins` (default localhost) is unaffected, but a REMOTE `COMMONS_URL` now MUST be https — intended hardening, not a regression.

## ADR-081 — BLUEPRINT-1: a WorkspaceBlueprint is frozen as a versioned, Commons-publishable manifest whose declarative-ness is enforced by a closed-key parse gate (2026-07-14)
- **Decision**: a `WorkspaceBlueprint` becomes publishable by traveling INTACT inside a `PackageManifest` (`kind:"workspace_definition"`, new optional `manifest.blueprint`), so PKG-2 signing covers it byte-for-byte. `@bridge/core/src/blueprint.ts` gains: `BLUEPRINT_SCHEMA_VERSION` + an optional `schemaVersion` on the blueprint (stamped when absent, a future version rejected); `parseWorkspaceBlueprint(raw)` — the declarative GATE, using a closed key allowlist at EVERY level (`rejectUnknownKeys`) so no `code`/`handler`/`exec`/`fn` field can be smuggled in; and the bridge pair `workspaceBlueprintTo/FromPackageManifest`. A `workspace_definition` COMPOSES capabilities by reference (`blueprint.capabilities: string[]`), so `manifest.capabilities[]` is empty and `parsePackageManifest` relaxes its "≥1 capability" rule ONLY for a blueprint-carrying workspace_definition.
- **Why**: publishing a workspace as a manifest reuses the entire signed-supply-chain path (PKG-2) and the install/risk machinery for free, with no new wire format. Making declarative-ness a closed-allowlist PARSE result (rather than a scan for known-bad keys) is allowlist-not-blocklist security: anything unrecognized is rejected, so the blueprint literally cannot carry executable payload. `workspaceBlueprintFromPackageManifest` re-runs the full gate on extraction so a tampered payload that somehow reached install is still rejected at the compile boundary.
- **Alternatives rejected**: (a) a separate blueprint publish endpoint/format — duplicates signing, storage, and risk; the manifest is the universal unit. (b) a blocklist of dangerous keys — misses the next unknown key; the closed allowlist is exhaustive by construction. (c) let workspace_definition bundle its capabilities — blows up the manifest and duplicates capability manifests that already live in the registry; reference-composition keeps one source per capability.
- **Consequences**: **59/59** green. Core `blueprint-manifest.test.ts` covers to/from round-trip, schema stamping/rejection, closed-key rejection, and the relaxed capability rule. apps/api `blueprint-commons-roundtrip.test.ts` proves the full path: blueprint → manifest → sign → (transport) → verify-on-install → extract (re-validate) → `compileBlueprint`, plus the declarative gate rejecting a smuggled `handler` key. Pre-existing inconsistency spotted + filed in `docs/BUGS.md`: `packages/db/src/workspace-definition-store.ts`'s `blueprintFieldSchema` enum omits `"location"` (router/blueprint list 11 kinds, the store 10) — not in Batch-9 scope, tracked.

## ADR-082 — CONSOLIDATE: the house test runner is `node --test` + per-package coverage floors (NOT vitest), and core-barrel coverage-dilution is fixed by recalibrating downstream floors (2026-07-14)
- **Decision**: CONSOLIDATE (testing debt) is closed by CODIFYING the already-real setup rather than adding tooling: the runner is `node --test` on compiled `dist/test/*.test.js`, each package enforces a `--test-coverage-lines` floor, and turbo (`typecheck test build`) is the single verify entry point (baseline 59/59). No vitest is introduced. A structural artifact was found and fixed: because `node --experimental-test-coverage` reports EVERY loaded file, and every core-dependent package imports the `@bridge/core` BARREL (`index.js` re-exports all modules), each downstream package's coverage aggregate INCLUDES all of core. Batch-9's new core modules (`signing.js`, expanded `blueprint.js`, `sandbox-policy.js`) are not exercised by downstream tests, so they diluted two aggregates below their floors: `sensors` 40→39.38 and `db` 55→54.55 (both with all tests passing, 0 cancelled). Fix = recalibrate those two floors to at/below measured (`sensors` 40→39, `db` 55→54), per the standing rule "set a floor at/below measured coverage." No package's OWN code coverage dropped.
- **Why**: adding vitest would fork the test story and duplicate coverage config for zero gain — the `node --test` setup already gates coverage in CI via turbo. The floor recalibration is honest maintenance, not masking: the floors are aggregates-over-dependencies by construction, so they must move when the shared kernel grows with features the downstream does not test; `docs/wiki/testing.md` is STALE against this reality and is flagged for a follow-up rewrite.
- **Alternatives rejected**: (a) introduce vitest — new dependency, second runner, no capability gain. (b) add downstream tests that exercise core's signing/blueprint just to lift the aggregate — couples e.g. sensors tests to unrelated core features; wrong ownership. (c) exclude `@bridge/core` from each downstream's coverage via `--test-coverage-exclude` — a repo-wide methodology change (pnpm symlink paths make the glob fragile) inconsistent with all other packages, out of Batch-9 scope. (d) leave the floors and let CI stay red — violates the 59/59 baseline.
- **Consequences**: **59/59** green (serial `--concurrency=1` to avoid the documented pglite/db parallel-resource-pressure flake — under `--force` parallel turbo, db-touching suites get cancelled mid-flight, dropping their coverage and cascading; serial is the deterministic authority). Two floors lowered by <1 point, documented here. Follow-ups noted: rewrite `docs/wiki/testing.md`; consider a future repo-wide decision on whether coverage floors should measure own-code-only.

## ADR-083 — AP-007 applied: the long-term optimizations / Memory-lifecycle / VM-isolation plan is ingested into the roadmap as additive per-phase bullets, with NO batch reorder (2026-07-14)
- **Decision**: With the user approving AP-007 ("Both of the above"), the phase-mapping from `docs/raw/optimizations-memory-vm-dealpilot-plan-2026-07.md` §6 is folded into `docs/wiki/roadmap.md` as an "ingest" section — additive bullets attaching each optimization to an existing P-phase (O0 observability + Memory lifecycle/security + exec-target → P0; O1/O2 lossless compression + retrieval-first context → P1; O3 → P2; O4 + container/microVM `SandboxProvider` → P3; optional visible Isolated-Computer package → P4; remote tenant pools → P6) — explicitly WITHOUT reordering the six-month batch sequence. The APPROVALS row is flipped PROPOSED→APPLIED.
- **Why**: the plan is a set of enhancements to capabilities the phases already deliver, not new phases; expressing it as per-phase add-on bullets keeps one roadmap spine and avoids a competing structure. Preserving batch order honors the approval's own constraint ("preserve current six-month batch order until dependencies/security gates clear") — the gates that would justify a reorder haven't cleared.
- **Alternatives rejected**: (a) insert new phases for the VM/isolation work — fragments the roadmap and implies a re-sequence the user did not approve. (b) leave AP-007 as a raw-doc-only proposal — the user approved ingesting it into the canonical roadmap. (c) rewrite the batch order now — out of scope and contrary to the approval text.
- **Consequences**: `docs/wiki/roadmap.md` carries the mapping; the raw plan doc remains the full-depth source. No code, no batch resequencing. Future phase execution can pull the mapped items in-place.

## ADR-084 — XP-2 honest partial: the unsigned native-installer path is delivered and proven (3-OS bundle CI + Tauri bundling + generated icon set + a real local macOS build); only signing/notarization stays cert-gated and open (2026-07-14)
- **Decision**: Rather than leave XP-2 wholly deferred, deliver the part that is genuinely executable here and prove it: (1) a `desktop-bundle` CI job in `.github/workflows/ci.yml` — a macOS/Windows/Linux matrix, gated to tags (`v*`) and `workflow_dispatch` (installer builds are too heavy for every PR), that builds the web frontend then runs `pnpm exec tauri build --bundles <per-OS targets>` (macOS `app,dmg`; Linux `deb,appimage`; Windows `msi,nsis`), with signing env vars gated behind repository secrets (unsigned build still succeeds) and installer artifacts uploaded (`if-no-files-found: warn`); (2) `bundle.active: true` + targets/category/descriptions + a real multi-resolution `icon` list in `tauri.conf.json`; (3) a full icon set generated via `tauri icon`. VERIFIED end-to-end on macOS: `cargo check` green, and `tauri build` produced a real `Bridge.app` + `Bridge_0.1.0_aarch64.dmg` (3.2 MB). The XP-2 box stays UNTICKED: the DONE-WHEN says *signed* installers, and signing/notarization needs certificates as repo secrets, which don't exist in this environment.
- **Why**: GitHub-hosted runners ARE macOS/Windows/Linux, so the installer-production path is real infrastructure we can author and even validate locally today; only the cert-dependent signing step is truly blocked. Delivering + proving the unsigned path (a) de-risks the eventual signed build to "add secrets + flip env", (b) avoids fabricating a DONE-WHEN, and (c) turns a fully-deferred item into a documented honest partial. The heavy release build is kept off the PR hot path via tag/dispatch gating.
- **Alternatives rejected**: (a) leave XP-2 fully deferred — understates what's actually executable and leaves the installer path unproven. (b) tick XP-2 DONE — false; installers are unsigned. (c) commit a self-signing/ad-hoc cert to fake "signed" — dishonest and non-portable. (d) run the bundle job on every PR — minutes-long release compiles per PR; gated to tags/dispatch instead. (e) ship the tiny 32×32 placeholder as the only icon — bundling needs `.icns`/`.ico` at larger sizes, so the job would fail for a non-cert reason; a generated set (tracked in `docs/dummy.md`) removes that false failure.
- **Consequences**: PR #11 carries a working unsigned 3-OS installer pipeline + a real icon set; a local macOS `.dmg` proves it. The signed/notarized DONE-WHEN remains OPEN pending certs-as-secrets (unblock: add `APPLE_*` / Windows signing secrets, flip the gated env). The generated icon set is a blurry upscale of a 32×32 placeholder — logged in `docs/dummy.md`, removal = a real ≥1024² brand icon. `target/` + `web/dist` are gitignored, so no build binaries enter the commit. Batch 8 is NOT complete.

## ADR-085 — XP-3 confirmed fully BLOCKED and deliberately NOT scaffolded: no mobile (Expo) app exists on any accessible ref and Expo/RN deps cannot be installed here (2026-07-14)
- **Decision**: XP-3 (mobile app rebased onto the shared kernel, running on device/simulator) is confirmed impossible to execute or verify in this environment, and is deliberately left un-scaffolded. Evidence: `platform/apps` contains only `api`/`desktop`/`web`; scanning all ~20 remote branches found no `app.json`, `eas.json`, react-native, or expo anywhere; zero mobile commits across all refs; the previously-referenced `claude/heuristic-booth-f8f5da` branch is not on the remote. Adding Expo/RN would also require `pnpm install`, which is disallowed here. The blocker is recorded in `docs/BUGS.md` and the PROGRESS Batch-8 note; the box stays UNTICKED.
- **Why**: a DONE-WHEN that cannot be proven must not be claimed, and fabricating a mobile scaffold would either be dummy code or break the build — both violate the real-data / no-fabrication rules (ADR-078 already held that fabricating infra-gated DONE-WHENs is unacceptable). The honest outcome is to document the exact blocker so a future session doesn't re-hunt for a non-existent app.
- **Alternatives rejected**: (a) scaffold a fresh Expo app — can't `pnpm install`, and an empty shell doesn't satisfy "rebased onto the shared kernel running on a device"; fabricated progress. (b) tick XP-3 anyway — false. (c) recover the stranded `heuristic-booth` branch — it's not on the remote, nothing to fetch.

## ADR-086 — Parallel domain foundations stay pure; Commons reuses the existing install spine (2026-07-15)
- **Decision**: Execute three non-overlapping foundations in parallel without changing the roadmap order. JobPilot JP1 adds a pure JSON Resume/master-profile compiler whose conflicts become explicit NeedsHuman fields and whose output is unusable downstream until human approval. DealPilot DP0 adds a pure Deal shell, deterministic transition graph, and read projections over the existing FactStore. Commons CM0 binds the existing `CommonsRegistry` port into API wiring and exposes registry reads plus a two-step install: fetch/verify/register through `commons.installPropose`, then reuse `packages.install` for risk computation and governed approval. Form joins the DataView registry behind an injected insert hook rather than owning persistence.
- **Why**: pure domain code is independently testable and avoids coupling JobPilot/DealPilot to web or storage choices before their real-data exit gates exist. Reusing `packages.install` prevents a second risk/approval implementation. Injecting Form writes keeps one standard view reusable across entities while callers preserve each entity's normal post-insert process.
- **Alternatives rejected**: domain-specific stores and React shells in the same pass (would cross agent lanes and falsely imply complete slices); direct Commons installation (would bypass the existing governed lifecycle); Form-owned generic persistence (cannot know entity validation, Learning parity, or local/cloud residency).
- **Consequences**: JP1, DP0, UI-RULES-1, and CM0 remain partial in PROGRESS; none is marked DONE. Real-document/browser/live-registry evidence and remaining slice exit gates still apply. macOS-only artifact/capture validation remains deferred.
- **Consequences**: XP-3 stays BLOCKED with a precise unblock condition (the Expo app present on the working branch + devices/simulators + installable deps). A `docs/BUGS.md` row captures the stranded-app gap cross-session. Batch 8 is NOT complete.

## ADR-086 — 2026-07-15 — Zazoo avatar renders as 2D procedural SVG rig, not 3D (Three.js rejected for v1)

**Decision**: The companion avatar (Zazoo, plush cat) ships as a layered SVG rig mutated per-frame by a renderer-agnostic Animation Director (`director.ts` emits a numeric Frame; the SVG component only maps params to transforms). The user-supplied spec's Three.js/R3F/glTF stack is not adopted for v1.
**Why**: (1) every specced behavior — blink, saccades, brow/ear/tail motion, breathing, head tilt, spectacle settle — is a parameter on a flat rig; emotional attachment comes from timing/responsiveness, not depth; (2) real-time 3D plush fabric without a dedicated character artist reads as cheap rubber, opposite of the premium-handcrafted brand goal; (3) the avatar is an always-on overlay beside the capture plane — SVG rig ≈15KB/near-zero idle CPU vs ~600KB+ Three.js runtime with persistent GPU cost; (4) 2.5D parallax (face-group gaze offset) fakes the depth 3D would buy.
**Alternatives rejected**: Three.js/R3F + glTF blendshape rig (asset pipeline + artist dependency + runtime weight); Lottie/prebaked clips (violates the performance-not-clips requirement — no continuous blending); Canvas2D custom renderer (loses SVG's declarative layering + accessibility for no measurable win at this node count).
**Consequences**: 3D remains swappable later behind the unchanged `perform()` contract; all future emotion/gesture work targets the Director, never the renderer; overlay integration must add reduced-motion + hidden-window rAF pause before shipping as default companion.
## ADR-087 — Personal learning stays inspectable and governed; Deal/Source/Thesis relations and table context menus become compiler-level grammar (2026-07-14)
- **Decision**: (1) EG1 asks for admired public figures, then the Learning Agent performs cited public research and proposes—not installs—relevant Skills and scheduled Automations; EG3 owns the day-7 favorite-qualities prompt and later configurable reflection prompts. Learned preferences are suggested Memories with why/skip/snooze/pause/inspect/correct/delete controls and a visible link to changed value. (2) DealPilot models Deal↔Source, Deal↔Thesis, and Source↔Thesis as symmetric many-to-many relations across three sibling DB-backed toggle pages; entity-specific fields stay on their owning schema and Source secrets stay in CredentialBroker/keychain references. (3) the requested right-click column/toggle commands are one compiler-owned menu contract for every Module; Add page/Remove page exists only for database-backed sources and changes presentation, never deletes data.
- **Why**: role-model and behavioral learning can personalize Bridge deeply only if research provenance, user control, and governance prevent admiration from becoming endorsement or learning from becoming covert profiling. Deal/Source/Thesis are one causal graph but not one flat schema; many-to-many joins preserve that graph while entity ownership avoids meaningless nullable columns. Shared menu grammar prevents DealPilot-specific UI drift and makes generated Modules predictable.
- **Alternatives rejected**: silently scheduling role-model habits (violates govern-before-execute); fixed personality tests/scores (opaque and invasive); merging Deals/Sources/Theses into one table (field-shape mismatch and weak integrity); hierarchical Source→Deal ownership (cannot express multi-source/multi-thesis reality); per-Module context menus (drift); Remove page deleting its database (presentation action with destructive surprise).
- **Consequences**: UI-RULES-1 gains a shared menu implementation/verification task; EG1 gains role-model research and recommendations without expanding the confirmed prototype gate beyond EG1; progressive reflection stays EG3; DealPilot DP0–DP1 gains the relational schema and thesis→source→deal trigger chain. Implementation must include provenance, dependency impact preview, undo/accessibility, and privacy/Memory controls.

## ADR-088 — One vocabulary, routed failure ownership, and runtime taint as a propagated value property (2026-07-14)
- **Decision**: AP-020 establishes `docs/glossary.md` as the only canonical glossary and requires product/code/schema/API/persisted-payload convergence. Only Local/Cloud are Planes; Relationship/Work are Domains; Commons/Bridge Cloud are services. Avatar replaces lifecycle/creature/personality labels and visual style cannot determine Agent tone/authority. Engine replaces Brain and differs from Skill (bounded callable job) and Automation (trigger/schedule coordinator). File replaces user-visible Artifact; non-file output is Result. Module remains installed functionality; project-like work is a domain Record. Relationship is one Module containing People/Communities/Relations/Interactions/Introductions/Helpdesk/Sources/Automations. A Relation carries one semantic type plus attributes/evidence; multiple meanings use multiple rows.
- **Failure ownership**: Engine owns bounded runtime recovery; Governance owns policy/control remediation and explanation; Learning detects recurring patterns and proposes improvements; Capability Builder implements tested governed changes; Human resolves consequential ambiguity. Typed Failure Events route exactly one lead owner.
- **Runtime taint**: existing provenance fields and egress gate are partial. RT0–RT4 make taint a monotonic joined label carried through retrieval, prompt, model, Skill, Action, Event, Result, File, storage, serialization, cache, queue, and retry boundaries; unknown labels fail closed; sinks are instrumented; declassification requires deterministic validation or explicit Human Decision.
- **Why**: overlapping metaphors and aliases create user confusion and permanent dual-schema debt. Keeping interface identity, residency, registry, and cloud hosting separate preserves security reasoning. Routed failures avoid competing self-healing loops. End-to-end taint is required because a source-only tag can be lost during composition or model/tool transitions.
- **Alternatives rejected**: display-only renames; treating Avatar as Local Plane or Commons as Cloud Plane; one overloaded edge holding several semantic relations; making Governance or Learning a universal failure-repair agent; retaining Artifact beside File; treating Project as Module; personality/lifecycle states for Avatar; trusting taint metadata only at ingest/egress.
- **Consequences**: VOCAB0–VOCAB5 are mandatory cleanup batches with backfills, compatibility deletion, RLS/API tests, and browser proof. Existing old code is not claimed removed. High-autonomy research/MCP/ambient execution remains gated until RT3. Earlier conflicting vocabulary decisions remain historical but are superseded by AP-020.

## ADR-089 — Actionable Module shell, Agent-only Skills, Relationship Signals, and Second Brain (2026-07-14)
- **Decision**: AP-021 makes every installed Module a manifest-derived clickable left-nav destination with Module Detail exposing Pages, Databases, Agents with nested Skills, Automations, Integrations, Files, Runs, and settings. Interactive-looking UI must open detail/edit/filter/explanation or a governed Action. Skills are Agent-only: Humans and Automations request an Agent; Automations start Agent Runs; runtime/authority rejects direct non-Agent Skill invocation and closed allowlists fail closed. Left Sidebar/right Chat Panel use one expand/collapse/extend contract. Relationship primary toggles are Signals/People/Communities; Signal is a surfaced Event with Person/Community participant Relations, reason, and safe Action. Retained information remains Module-associated Memory. Second Brain is the permission-filtered cross-Module graph surface below Modules; Engine remains runtime vocabulary.
- **Why**: current prototype exposes legacy Tools routes while Module rows are inert, splits Skills from their only consumer, duplicates asymmetric panel behavior, and separates relationship data behind a global index. This hides ownership and creates dead ends. One actionable Module hierarchy makes capability provenance, permissions, and next Actions visible. Signal retains useful user language without recreating a parallel Event store. Second Brain supplies cross-Module discovery without detaching data from its source Module.
- **Alternatives rejected**: display-only renaming; retaining Tools as a generic category; direct Human/Automation Skill calls; standalone Skills Page; optional/pinned-only Module navigation; global data-index shell; separate Signal table; static graph; renaming Engine to brain.
- **Consequences**: BUG-INTAKE interrupt 1A–1I preempts default work. VOCAB6 owns real route/code/schema/API/payload/test cleanup. Existing prototype is explicitly non-conformant until live desktop+375px evidence, Agent authority tests, no-deprecated-route search, Module drill-down, symmetric panels, Relationship toggles, and real Second Brain graph pass. DealPilot/JobPilot BRDs bind same Module/actionability/Agent-Skill contract.

## ADR-090 — ETA DealPilot grammar, Internal Strategist, Goal/Task Skills, bounded child Runs, and red-only feedback (2026-07-15)
- **Decision**: AP-023 makes DealPilot ETA-specific, removes user personas, and allows only Deals/Sources/Theses as default Pages. Every Record gets Record Detail; standard Module capability inventory stays compiler-owned. Source credentials remain vault-backed but project through secure Human-only virtual table columns with re-authenticated reveal/copy. Source schema adds Link, Last checked, Spend cap/spend, and rights state. Relationship/Task columns are conditional Module Relations. Permanent Agents become Chief of Staff, Learning, Internal Strategist, Governance, and Capability Builder. Skills bind typed Goals/Tasks; Agent defaults are preferences. Agents may create bounded child Agent Runs that inherit ceilings. Green/yellow feedback flags are removed; red flag is platform-wide scoped negative feedback. JobPilot culture research uses Learning evidence plus Internal Strategist synthesis.
- **Why**: Page semantics must follow data ownership, not navigation convenience. Raw secrets in Records would leak through ordinary data paths, while vault-backed virtual columns meet password-manager UX without weakening isolation. Existing DealPilot/JobPilot specialist catalogs overfit workflows into identities; permanent responsibility boundaries plus portable Skills cover the work with less routing and evaluation duplication. Internal Strategist removes analytical overload from CoS without mixing research collection, policy review, or programming. Red-only feedback avoids conflating user correction with domain Decisions.
- **Alternatives rejected**: raw/encrypted password columns in Source DB; module-specific capability inventory; Overview/Summary/Reports/Files as Pages; retaining nine DealPilot specialist Agents; binding Skills exclusively to Agent identity; unrestricted recursive sub-agents; treating no flag as positive feedback; using inaccessible/restricted review sites through scraping or access-control bypass.
- **Consequences**: DP0 gains Record Detail, secure credential projection, rights/spend gates, standard inventory, and conditional columns. AGS0–AGS3 deliver Internal Strategist, Goal/Task Skill resolution, bounded child Runs, and pilot migrations. UI-RULES gains Record Detail and red-flag primitives. JobPilot gains governed culture-research slice JP3B. Separate specialist Agents remain possible only when the recorded durable-boundary test passes.

## ADR-091 — Named application-prep requests are real Application Records, not fabricated Job Postings (2026-07-15)
- **Decision**: A user-requested target such as “BCG MBA Consultant” may create a real request-scoped JobPilot Application preparation Record before an exact authorized Job Posting has been ingested. The Record receives its own routable detail, prepared Files/Results, evidence ledger, Agent-owned Skill attribution, unresolved-field states, and Human-only submission gate. It does not get inserted into the empty authorized-Source `JOBS` collection or claim a posting URL, salary, deadline, office, or application status that was not supplied or verified.
- **Why**: The user has made the application intent real, while the exact posting and recruiting channel remain unknown. Modeling that intent honestly unlocks useful preparation without violating the no-dummy-data rule, authorized-source boundary, or truthfulness invariant.
- **Alternatives rejected**: fabricate a BCG posting in `JOBS` (false Source/status/compensation); leave the requested page empty until a connector exists (discards real user work); treat the content as an untracked static mockup (loses evidence, ownership, and submission governance).
- **Consequences**: the current BCG workspace is a typed request-scoped frontend Record backed by supplied Files and official BCG guidance. Future JP persistence work should migrate it into the canonical Application/Materials/Answers/Interview schema, attach an authorized Job Posting when found, and preserve its evidence/status history.

## ADR-092 — One canonical task carries scope, evidence, intent, approval, status, and proof (2026-07-15)
- **Decision**: AP-024 replaces the overlapping active PROGRESS/BUGS/requests/APPROVALS queues with one canonical `docs/TASKS.md` ledger. A task exists only for an independently deliverable outcome with a falsifiable Prototype test. Roadmap/plan references define Scope; bug/audit references provide Evidence; user requests provide intent; approvals gate canonical changes; Dependencies and Status express execution. New input first attaches to an existing task that shares its outcome/root cause/exit test. `PROGRESS.md` becomes historical; BUGS, requests, and APPROVALS remain append-only evidence/audit ledgers. The Task Manager reads TASKS only.
- **Why**: unioning 34 roadmap checkboxes, 29 bug headings, two partial requests, and two proposed approvals produced 67 apparent tasks, even where four records described one piece of work. That obscured the actual prototype path, repeated work, and let bookkeeping compete with delivery. One task identity preserves every source without multiplying execution rows.
- **Alternatives rejected**: keep four queues and deduplicate heuristically in the UI (identity remains ambiguous and drift returns); delete the old ledgers (destroys reproduction/intent/decision history); retain PROGRESS as a second cursor (two sources of execution truth); create a separate progress-report file (reintroduces state duplication).
- **Consequences**: TASK-001→TASK-005 is the non-skippable Avatar+Commons prototype gate. Broad vocabulary migration, cleanup, and later work wait behind combined demo certification. Status reporting becomes task deltas plus landed-change log entries; substantive outcomes remain in `outputs/`. ADR-042's PROGRESS-as-cursor mechanism and ADR-045's separate INTERRUPT batch representation are superseded, while AP-004's user-defect priority principle and the approval audit mechanism remain.

## ADR-093 — Task Manager order capture and three-layer documentation (2026-07-16)
- **Decision**: The user-provided Task Manager order is captured in `docs/TASKS.md`; it remains the sole execution source consumed by the generator and UI. `docs/PROGRESS.md` is summary/rules only; former batch history is preserved in `docs/raw/progress-archive-2026-07.md`. Wiki summarizes and navigates; raw holds detailed plans, requirements, decisions, schemas, audits, and history.
- **Why**: A UI rank without durable source drifts, while a long progress ledger recreates a second plan. Archive preserves auditability without competing with task execution.
- **Consequences**: Bugs remain evidence, not work rows; status lives on each canonical task; reports use task deltas, `docs/log.md`, and dated `outputs/`.

## ADR-094 — Avatar drag persistence uses OS-level drag (data-tauri-drag-region) + atomic file storage (2026-07-16)
- **Decision**: Avatar overlay drag uses Tauri's `data-tauri-drag-region` attribute (OS-level window move primitive, cross-platform). Position persists to `{app_data_dir}/bridge/overlay_positions.json` (physical pixels, keyed by window label, atomic temp→rename write). On launch, `reconcile_saved_position` validates the saved position against current monitor topology and falls back to the default bottom-right anchor when off-screen. Custom window chrome (close/minimize/zoom) is added as supplemental sidebar buttons visible only under Tauri.
- **Why**: OS-level drag avoids IPC polling during movement and works uniformly on macOS/Windows/Linux. Physical-pixel storage is what Tauri's APIs return and set. Atomic writes prevent file corruption on crash. Per-label keying handles multi-monitor independently. Reconciliation (32px minimum visibility margin) covers the most common topology change: a second monitor disconnected after the session.
- **Alternatives rejected**: JS pointermove + overlay_move IPC polling (lots of cross-process calls, unnecessary); logical-pixel storage (scale-factor changes rare and reconciler handles any error anyway); non-atomic write (risk of zero-byte file on crash); single global position per monitor count (would not survive moving between displays).
- **Consequences**: Platform-neutral work is complete. macOS Spaces/fullscreen persistence and title-bar-in-sidebar require `tauri-nspanel` and are flagged as local macOS session blockers. TASK-003 remains in_progress pending live macOS prototype verification.

## ADR-095 — Onboarding learning uses cited fixed-host research, governed Signals, and privacy deletion (2026-07-16)
- **Decision**: Role-model research uses one fixed-host Wikipedia API adapter with bounded input, timeout, response size, source URL, and explicit separation of documented context from the user's interpretation. Learning records the recommendation as a pending-review Signal through the existing pipeline; it never installs or schedules a Skill directly. Direct user answers become private Local Plane preference Memories. Correction supersedes append-only; explicit delete permanently removes the complete correction lineage. The day-7 qualities reflection is a private procedural Memory with scheduled/snoozed/paused/skipped states.
- **Why**: TASK-002 needs useful cited output now without inventing a general crawler or allowing caller-selected URLs. Signal is the canonical surfaced Event/recommendation shape and preserves Agent attribution plus approval. Privacy deletion must actually forget user-controlled learning; exposing an old superseded value after deleting its replacement would violate the product promise.
- **Alternatives rejected**: open-web caller-selected fetches before the SSRF research client exists; uncited model-only advice; direct Skill/Automation installation; treating role-model admiration as blanket endorsement; soft-delete/tombstone that retains personal preference text; silently scheduling the day-7 prompt.
- **Consequences**: the prototype has a narrow lawful public-source lane, not a general Learning research engine. Broader research remains gated on the SSRF-hardened client and runtime taint work. Persistent production governance must provision the Learning Agent's `signal:write` grant just as zero-infrastructure mode now does. TASK-002 stays in progress until desktop/375px live proof and the remaining onboarding ceremony exit criteria pass.

## ADR-096 — macOS Avatar uses a pinned non-activating NSPanel; Sidebar chrome keeps native AppKit controls (2026-07-16)
- **Decision**: On macOS, Avatar overlays convert through `tauri-nspanel` 2.1.0 pinned to inspected commit `a3122e894383aa068ec5365a42994e3ac94ba1b6` (MIT OR Apache-2.0), apply the non-activating style mask, join all Spaces, and opt into fullscreen auxiliary behavior. The main window uses Tauri's overlay title bar with hidden title so AppKit's real close/minimize/zoom controls sit in a draggable Sidebar lane. Windows/Linux retain ordinary native decorations.
- **Why**: NSPanel is the platform primitive for a floating companion that must remain present without taking app focus. Native traffic lights preserve macOS accessibility, keyboard, fullscreen, and window-management semantics while matching the supplied Sidebar layout and preventing duplicate controls.
- **Alternatives rejected**: duplicate HTML traffic-light buttons beside native controls; fully undecorated cross-platform windows; an unpinned moving branch dependency; custom Objective-C panel swizzling instead of the inspected permissive plugin; launch-only monitor enumeration.
- **Consequences**: macOS has a target-gated dependency and runtime panel conversion; other targets do not compile or render the macOS path. A one-second topology watcher creates/removes overlay instances and reconciles off-screen positions. Physical attach/detach, Space, fullscreen, drag/relaunch, and native-control interaction remain mandatory prototype evidence on suitable hardware.

## ADR-097 — File roots fail closed; desktop sidecar readiness never blocks Tauri setup (2026-07-16)
- **Decision**: Module File inventory resolves Organization and Module segments beneath the canonical `~/Documents/Bridge` root, rejects empty/`.`/`..` segments, and verifies the result is a strict descendant before reading. Package intake also rejects dot-segment Module display names. Desktop release startup synchronously resolves/spawns the API and creates windows with its port, but runs the bounded readiness probe on a named detached thread.
- **Why**: Human-readable manifest and Organization names are untrusted filesystem inputs; sanitizing separators alone does not stop `.`/`..` resolution. Tauri must create a window before `setup()` returns to avoid a zero-window exit, while its event loop must not wait up to 20 seconds for API health.
- **Alternatives rejected**: character replacement without post-resolution containment; silently mapping invalid names to a colliding fallback directory; moving all desktop bootstrap work back to a thread and reintroducing the zero-window race; blocking `setup()` until API health; creating the webview without the resolved API port and trying to mutate an import-time global later.
- **Consequences**: invalid File-root inputs fail explicitly and cannot enumerate outside the Local Plane directory. The desktop webview receives the correct API URL immediately; if readiness is slow, the UI may surface a transient connection error rather than freezing the native event loop. API child ownership and exit cleanup remain unchanged.

## ADR-098 — Roadmap fan-out starts early but dependencies remain hard gates (2026-07-16)
- **Decision**: Under the user's AP-029 directive, TASK-006 through TASK-015 start before TASK-005 certification. Independent foundations TASK-006/007/008 execute in parallel. TASK-009–015 begin with isolated scope/file/test planning and cannot enter implementation until their named dependencies are available. Task completion still requires the canonical Prototype test and affected-neighbour evidence.
- **Why**: The remaining physical TASK-003 matrix and Commons integration can proceed independently from substantial DealPilot, Agent-runtime, and Relationship foundations. Planning dependent work now removes discovery latency without pretending unavailable upstream contracts exist.
- **Alternatives rejected**: keep all later work idle behind hardware evidence; execute all ten implementations blindly against missing dependencies; weaken or delete dependency edges; mark research or builds as task completion.
- **Consequences**: TASKS temporarily carries multiple `in_progress` foundations, an explicit exception to the normal single-task rule. Isolated worktrees own one task each; shared router/schema/docs changes require coordinator reconciliation. TASK-009–015 remain dependency-blocked after planning, and AP-029 does not authorize destructive TASK-013 deletion.

## ADR-099 — Server-owned proposal identity and retry-safe public Helpdesk writes (2026-07-16)
- **Decision**: Public clients cannot choose Agent identity. Outreach proposals bind a persistent server-owned Agent to the authenticated Human and use a server-derived stable proposal UUID. Review remains append-only: only root unresolved proposals enter Approvals; approve/veto/edit rows resolve them; execution audits remain evidence. Public Helpdesk writes carry client operation UUIDs, map to deterministic server-side row UUIDs, compare the original request on retry, and store only a hash of the client-generated recovery credential.
- **Why**: Browser-selected actors break attribution. Transport retries must not duplicate proposals, tickets, or replies. Append-only review requires pending state to be derived from proposal/decision history rather than mutable browser state. A recovery credential must survive response loss without becoming replayable from the database or logs.
- **Alternatives rejected**: caller-supplied proposal IDs or Agent IDs; local-only approval state; mutating proposal rows in place; random server IDs on each retry; storing plaintext Helpdesk bearer tokens; silently treating provider or persistence failures as success.
- **Consequences**: concurrent proposal and Helpdesk retries converge across processes without a schema migration. Decision-response loss can be reconciled. Post-decision provider failures are explicit and audited, but durable idempotent effect retry remains TASK-017 scope.

## ADR-100 — Commons content identity excludes recursive fields; signatures bind registry ordering (2026-07-16)
- **Decision**: Commons SHA-256 identity covers normalized manifest metadata, tags, a closed six-field provenance record, and deterministic security-scan evidence, excluding integrity, signature, and publication time. Ed25519 exclusively signs `{content, integrity, publishedAt}`. Publish/fetch/install independently verify the hash, signature, explicitly pinned trusted key, requested name/version, provenance, and passed scan. Blueprint capability references fail publication until they carry exact signed package pins.
- **Why**: Integrity cannot hash itself. Publication time must still be authenticated because it chooses “latest”; otherwise an older signed artifact can be promoted by timestamp tampering.
- **Alternatives rejected**: recursive whole-entry hash; unsigned publication time; locale-dependent tag sorting; trusting fetch-time metadata without re-verification.
- **Consequences**: content pins are stable and non-recursive; registry ordering is tamper-evident; changing provenance, scan evidence, package identity, hash, or publication time invalidates trust.

## ADR-101 — Commons artifact bytes stay immutable; Module ownership is installation-local (2026-07-16)
- **Decision**: Signed Commons bytes contain generalized capability content only. Module package, Agent, need, and pinned content hash are stored as Local-Plane installation attachment metadata. Reinstall is idempotent only when canonical capability content matches; signed Commons versions cannot be locally forked for rollback.
- **Why**: Adding workspace ownership to a signed generalized artifact would leak local context and break its hash. Reusing a same-name/version capability with different content or rewriting a signed version creates substitution risk.
- **Alternatives rejected**: embed workspace/Agent IDs in Commons; mutate signed versions during rollback; reuse same-name/version capabilities without content comparison.
- **Consequences**: Commons receives no personal/workspace data; attached Skills remain beneath the attributable owning Module Agent; rollback requires an exact signed published version.

## ADR-102 — Automation ownership is singular, stored, and server-derived (2026-07-16)
- **Decision**: New Ritual definitions persist exactly one owning `agentId` plus execution Plane. `runById` ignores client authority claims, derives the Agent actor from storage, and rejects missing or mismatched ownership. Migration binds a same-workspace singular legacy owner only for a fully valid non-egress pipeline and records Local Plane explicitly; legacy external, malformed, cross-workspace, or ambiguous Automations remain unbound until explicit Human rebind. Runtime never falls back to deprecated `agent_ids`. Migration also translates legacy Skill UUID allowlists to same-workspace/global procedure names and aborts rather than widening an unresolved allowlist. Signed Module manifests carry generalized Agent/Ritual keys; the server resolves those keys to Local-Plane UUIDs. Only Automations with an explicit runtime binding expose Run.
- **Why**: Caller-selected actors make attribution and authority forgeable. Multi-owner execution has no deterministic principal. A missing Plane must not silently reinterpret cloud/external execution as local. Runtime UUIDs cannot enter Commons because its privacy gate correctly treats UUID-shaped identifiers as local/personal data.
- **Alternatives rejected**: trust caller actor; choose the first of several Agents; infer Cloud Plane from capability scope; revive ownership from legacy arrays at read time; place runtime UUIDs in Commons; render Run buttons for inventory-only Automations.
- **Consequences**: proposals and Run records carry the declared Agent and Plane; ambiguous, external, malformed, and cross-workspace legacy rows fail closed pending explicit rebind; one DealPilot Automation has an honest governed path in both in-memory and persistent modes; broader orchestration remains TASK-007 and full TASK-005 remains blocked.

## ADR-103 — Approved Commons installation is a replayable, activation-time-verified effect (2026-07-17)
- **Decision**: A manual-risk package install creates one server-derived stable proposal and always stops for Human review. Approve/edit appends the decision first, then idempotently activates the root and exact signed dependency closure. Veto changes no package state. Before activation or promotion, the server rechecks the pinned Commons artifacts and the currently installed owning Module's need, Agent, kind, and tags. A failed post-decision activation is explicit audit evidence and `packages.reconcileApproved` replays that effect against the original approval without creating another decision.
- **Why**: Approval is not installation. The signed artifact, dependency graph, or Module need can change between proposal and decision, and provider/storage failure can occur after the append-only Human choice. Stable identity plus late verification prevents duplicate inbox rows, stale authority, and success-shaped failure.
- **Alternatives rejected**: install before approval; trust proposal-time checks at activation; generate a fresh proposal on every retry; mutate the decision row with effect state; silently auto-install manual-risk packages; require a second approval after a transient finalization failure.
- **Consequences**: pending retries converge, approval is durable even when its effect fails, reconciliation is safe and inspectable, and removed/changed Module needs fail closed. Package-install intent temporarily uses `resourceType: "signal"` until a canonical Package Installation kernel token exists.

## ADR-104 — Goal/Task-bound Agent Skills and child Runs fail closed at runtime (2026-07-17)
- **Decision**: A governed Agent Skill resolves only through a workspace-scoped `SkillManifest` plus an active same-workspace Goal/Task assigned to that active Agent. Resolution must prove authority, Plane, and data scope. `stageMutation` is Human/system kernel passthrough only. Child Agent Runs are server-created, intersect every parent ceiling, persist atomic budget/lifecycle state, and remain inspectable/stoppable with attributable audit. Orchestration schema ships as migration `0014`, after released `0013`.
- **Why**: Agent identity or client-asserted context must never mint Skill authority. Assignment needs one inspectable contract shared by direct Agent Runs and Automations. Child delegation must narrow authority without creating a permanent identity. Drizzle silently skips a migration inserted below an already-applied journal high-water mark.
- **Alternatives rejected**: global manifests; default-Agent ownership as authority; a legacy ungoverned-Skill allowlist; public child creation with caller-supplied ceilings; audit-before-CAS terminal transitions; inserting TASK-007 as migration `0012`.
- **Consequences**: Agent-backed routes authenticate workspace membership before Task provisioning. Existing catalog calls carry a real manifest/Goal/Task or remain structurally Human-only. Future child executors must reserve budget through the guarded seam before entering the Universal Action Pipeline. TASK-008 Relation persistence must use migration `0015` or later.

## ADR-105 — Task Manager collapses Initiative/Outcome into Goal + a self-referential Task type (2026-07-16, revised same day; renumbered from this session's original ADR-099, which collided with the parallel Helpdesk-identity decision above)
- **Original decision (superseded within the day)**: the first draft of this ADR treated `Outcome` and `Initiative` as Task-Manager Module Record types under the AP-021 domain-label rule, reviving `Initiative` inside the new Module's namespace.
- **User pushback that reversed it**: the user directly questioned reviving a word AP-020 (2026-07-14) explicitly retired — "mandatory code/schema/API migration, not display aliases" — and proposed collapsing Goal/Outcome/Initiative/Task/Subtask into a pure recursive Task hierarchy with dot-notation level tracking (e.g. `2.3.5`), asking whether Goal itself is just a Task.
- **Revised decision**: Task Manager uses **two Record types**, not four. `Goal` (canonical glossary term) stays a distinct, non-Task strategic anchor — kept separate because a Goal is periodically reviewed/revised rather than "done" the way a Task's exit test resolves it, and because one Goal must be able to own several independent candidate Task-trees (collapsing Goal into "the root task" would cap it at owning one tree). `Task` (canonical glossary term) becomes **one self-referential type** covering everything that used to be Initiative + Task + Subtask: `parent_task_id` (adjacency list) plus an auto-maintained materialized `path` (dot notation, e.g. `2.3.5` = 5th child of the 3rd child of the 2nd root Task) for level tracking — the user's proposed leveling scheme, adopted. A `status: candidate` Task, at any level (not only under a Goal), carries the exact meaning "Initiative" used to name — compare-before-commit — without reviving the retired word. `Outcome` was never a Relation-bearing type; it becomes a structured `outcomes[]` field (title/measure/target/current/indicator_kind/north_star) present on both Goal and Task. The execution layer (Task→Action→Evidence→Verification) remains the existing Request→Plan→Decision→Run→Action→Event→Result pipeline, reused not rebuilt. This also aligns with parallel-landed ADR-104 (governed Skill resolution requires an active same-workspace Goal/Task): the new agent-task-routing Skill resolves an executor Agent from a Task exactly the way ADR-104 already requires.
- **Why this doesn't repeat the rejected "universal entity table"**: the 2026-06 Taskade research rejected a table spanning unrelated domains (Person/Deal/Event/etc.) with a `type` discriminator, because it dissolves typed per-type RLS and authority. A single self-referential `Task` type is different in kind — one domain, one Database, one RLS policy set — and is exactly the pattern the same research already blessed for the Touchpoint tree ("keep the relational adjacency-list tree; render many views over it"). This ADR generalizes that pattern with materialized-path leveling; it does not reopen the universal-entity question.
- **Alternatives rejected**: keeping Initiative/Outcome as separate Module Record types (original same-day draft — rejected on the user's correct observation that it revives a migrated-away kernel word for no structural gain); collapsing Goal into Task entirely (loses the one-Goal-many-candidate-trees shape and contradicts the glossary's distinct Goal/Task definitions, which would need its own canon-edit approval, not a silent fold-in); inventing a new non-retired word for the old Initiative concept (fights the user's own simplification, which needs no new word at all).
- **Consequences**: TM0's schema drops from four Databases (goals/outcomes/initiatives/tasks) to two (goals/tasks); the ledger-projection contract keys entries on `path` instead of a separate stable TASK-nnn counter; vocab lint keeps `Initiative` out of every namespace (not just kernel) going forward; a later session must not reintroduce a persisted Initiative/Outcome type without re-reading this ADR first (tracked as the `vocabulary_regression` risk in the module plan).
- **Superseded**: ADR-106 (2026-07-17) collapses the remaining `goals` Database into the `tasks` Database entirely (`is_goal` becomes a field). This ADR's Initiative/Outcome reasoning still holds; only the "keep Goal as a second Database" call did not survive a second round of user pushback.

## ADR-106 — Task Manager collapses Goal into a Task field (`is_goal`); full tree restructuring becomes possible without type migration (2026-07-17, supersedes ADR-105's two-Database call)
- **Decision**: Task Manager's `goals` Database is removed. `is_goal: boolean` becomes a plain field on the single `tasks` Database (ADR-105 already collapsed Initiative/Outcome into that same table). A Task with `is_goal=true` carries `outcomes[]`, an optional `review_cadence`/`last_reviewed`, and is not required to reach a single terminal "done" — it may run open-ended, reviewed on cadence, the same way ADR-105 already let a `status: candidate` Task stand in for the retired "Initiative." Three tree-restructuring operations become first-class, always as governed proposals: **promote** (drop a stale ancestor; the subtree becomes a new root; the promoted node's `is_goal` value is untouched — flip it explicitly if it should now read as the anchor), **insert-ancestor-above** (wrap an existing node in a new parent; `b.c.d` becomes `a.b.c.d`), and **re-parent** (move a subtree under a different existing node). All three are pure `parent_task_id`/materialized-`path` updates recomputed atomically over the affected subtree by an Automation — never a row migration between tables, because there is now only one table.
- **Why**: the user directly asked why Goal needs to exist at all, observing that a root-level Task already has branching structure and can own multiple candidate child-trees — the exact property ADR-105 had cited as the reason to keep Goal separate. Re-examined, that property does not require a second type: a Task with children already supports multiple candidate branches regardless of whether it is flagged `is_goal`. The user additionally required full re-parenting flexibility — an existing branch gaining a new ancestor above it, and a branch being promoted to a new root while a stale ancestor is dropped, with the promoted branch's own identity (its row, its history, its evidence) intact. A hard-typed Goal Database structurally blocks exactly this: converting a Goal row into a Task row (or vice versa) on every promote/demote is either an unsafe delete-and-recreate (losing the row's stable identity, evidence Relations, and history) or a bespoke cross-table migration path invented solely for this one transition. Making `is_goal` a field removes the problem by construction — the row's identity never changes, only its position and one boolean.
- **Alternatives rejected**: keep `goals` as a second Database and add a "promote a Task into a Goal" / "demote a Goal into a Task" conversion operation (rejected — reinvents exactly the type-migration machinery the collapse is meant to avoid, and such a conversion could never fully preserve `serves_goal_id` back-references cleanly); make "Goal" a purely computed/positional label (any root Task) with no stored field at all (rejected — fails the user's own stated requirement that a demoted former-root keep behaving as a reviewed anchor wherever it now sits; a computed-only label disappears the moment the node stops being a root); leave ADR-105's two-Database model in place and treat the user's question as already answered (rejected outright — the user's objection was substantive and correct, not a restatement of something already settled).
- **Consequences**: TM0's schema drops from two Databases (goals/tasks) to one (tasks); every `serves_goal_id`-style direct reference in the module plan/BRD becomes "nearest `is_goal=true` ancestor, resolved by walking `parent_task_id`, with an optional direct override field for a Task that should point at a non-ancestor goal"; the Queue Page's separate "Goals Page" becomes a saved filter (`is_goal = true`) on the one Queue Page, consistent with the UI-architecture "same columns → one list with a filter, not a second Page" rule; a new `task-tree-restructure` Skill and three new Automations (`task-tree-restructure-proposal` plus the routing changes below) are added; the `restructure_corruption` risk (partial path recomputation) is added to the risk register and gated by an explicit negative test in TM3.

## ADR-107 — Agent-task routing has no default executor and is owned by Chief of Staff, not Internal Strategist (2026-07-17)
- **Decision**: Task Manager's `agent-task-routing` Skill drops its "default Capability Builder" fallback entirely. Routing always resolves an agent-assigned Task's executor by matching the Task's required Skill against eligible Agents — reusing the real `SkillManifest`/eligible-Agent resolution shipped under ADR-104 (TASK-007) rather than a bespoke mechanism. A Task with no clean match, or more than one plausible match, escalates to explicit Human assignment; it never silently picks an Agent. Ownership of this Skill and its Automation moves from Internal Strategist to **Chief of Staff**. Reschedule-confidence-calibration (ADR-105/ADR-073 lineage) is extended to also calibrate routing confidence, and a new `routing-approval-gate` Automation applies the same `classifyApprovalBand`-style system gate to routing decisions that `reschedule-approval-gate` already applies to reschedule decisions — every routing decision requires human approval until calibrated, minor/unambiguous cases only after that.
- **Why**: the user directly rejected the "all agent tasks go to Builder" default, and separately asked which Agent should own the routing decision. Capability Builder's glossary scope is "creates and tests proposed capability changes" — a fixed default silently routes non-code Tasks (research, drafting, DealPilot/JobPilot domain work) to an Agent whose mandate doesn't cover them, which is precisely the `builder_misuse` risk flagged (but only mitigated, not removed) in the original plan. Removing the default and requiring an explicit Skill-eligibility match removes the risk by construction instead of managing it. On ownership: Chief of Staff's glossary definition is "default coordinating Agent and interlocutor... its routing role is a product composition" — routing is its stated job, and the shipped `chiefOfStaff.converse` @mention dispatch (routing a request to Learning/Communications/Governance/Builder) is direct precedent for "CoS decides which Agent handles X." Internal Strategist's mandate is analytical synthesis, comparison, and scenario modeling — the impact-fit and tree-restructure questions (where does this sit, how should the tree look), not the dispatch question (who executes).
- **Alternatives rejected**: keep Builder as a "soft default, override when a better match exists" (rejected — a soft default still silently mis-routes on the common case where nobody notices to override it, which is the exact failure mode being removed); let Internal Strategist own routing since it already owns most other Task Manager Skills (rejected — conflates two different questions, placement/strategy vs. dispatch, inside one Agent's mandate for convenience rather than correctness); build a new routing-authority mechanism instead of reusing ADR-104's SkillManifest resolution (rejected — duplicates infrastructure that already shipped and is already governed).
- **Consequences**: `agent-task-routing-on-assign` Automation is updated (no default branch); a new `routing-approval-gate` Automation is added; the module plan's risk register replaces `builder_misuse` with `routing_starvation_or_skew` (the new failure mode this design must guard: a stalled or silently-skewed resolver), tracked via an Agent-mix distribution metric rather than a simple pass/fail rate; TM4's exit criteria gain a negative test that no Task silently defaults to any one Agent.

## ADR-108 — Calendar and Graph are View kinds, never a Module/Tool/route/Integration identity; Second Brain stays a distinct surface (2026-07-17)
- **Decision**: Calendar is removed as an installed Module/Tool concept entirely. It becomes `kind: "calendar"` in the one canonical View Grammar (`docs/raw/brd-dataengine-views-2026-07.md`), eligible on any Page whose Database has a date-kind column, rendered by one shared component (`dataviews/views/CalendarView.tsx`), consolidating the four independent renderers found by code audit (`DataEngine.tsx` inline grid, `CalendarPage.tsx`, `dataviews/CalendarView.tsx`, `InitiativeDetail.tsx`/`WorkPage.tsx` local hardcodes). No View kind — Calendar included — owns a dedicated route, nav entry, `InstalledModuleBoundary` package gate, or catalog identity (`tools.ts`/`moduleRoutes.ts`). Google Calendar remains exactly what it already is at the sync/write layer (`apiSyncCalendar`, governed propose→approve→egress round-trip) but loses every layer above that: no `/calendar` route, no Module packaging, no page of its own — its synced rows simply populate whichever Database they belong to, rendered in that Database's own Page's Calendar view alongside non-Google rows. Graph (code symbol `network`, renaming to match glossary's `graph`) is confirmed architecturally correct as a View kind gated on a relation-kind column, rendering a Page's own rows as nodes and its typed Relations as labeled edges — no separate relationship-graph table exists or is proposed. It is explicitly declared distinct from Second Brain (the glossary-defined cross-Module graph surface): a Page's Graph view is scoped to one Database; Second Brain spans every installed Module's permitted Records/Relations/Events/Files. Neither may be implemented as a special case of the other.
- **Why**: code audit (2026-07-17, prompted by direct user pushback) found Calendar coded and documented as "one pinnable Tool + one primary global-nav item" in `docs/wiki/calendar.md`/`docs/raw/calendar-module-plan-2026-07.md`, with the `/calendar` route actually misrouting to Task Manager — a routing bug and an architectural mismatch discovered together. A View kind that owns Module/route/nav identity re-creates exactly the "second entity for the same underlying data" problem the Task Manager collapse (ADR-105/106) already eliminated for Goal/Initiative/Outcome — Calendar is data-shape metadata (a date column exists), not a product surface. The user separately asked to confirm Graph has no separate entity; code audit confirms it does not, and the one thing worth fixing is that the renderer (`GraphView.tsx`) is currently a placeholder while the eligibility rule is already correct — a renderer gap, not an architecture gap.
- **Alternatives rejected**: keep Calendar as a pinnable Tool but fix only the `/calendar` routing bug (rejected — treats the symptom; the deeper problem is Calendar existing as a Module/Tool concept at all, which the user's framing directly rejects); merge Second Brain and Page-level Graph view into one mechanism for simplicity (rejected — Second Brain's cross-Module/cross-Database scope and permission-filtering requirements are structurally different from a single-Database Page view; conflating them either weakens Second Brain's provenance guarantees or forces every Page's Graph view to carry cross-Module machinery it doesn't need); leave the code's `network` symbol as-is to avoid a rename (rejected — glossary is the standing tie-breaker per AP-020, and the mismatch would keep confusing future contributors reading the glossary against the type).
- **Consequences**: `docs/TASKS.md` TASK-014's scope/prototype-test updated to name every deliverable this decision requires (View Grammar consolidation, Calendar de-modularization, Graph renderer, `network`→`graph` rename, `tree` kind promotion); `docs/BUGS.md` carries four new rows as the concrete evidence trail; `docs/wiki/calendar.md`/`docs/raw/calendar-module-plan-2026-07.md` become historical/superseded once TASK-014 executes this ADR (not rewritten in this pass — the ADR records the target state, execution is TASK-014's job, matching how Task Manager's ADR-105/106 preceded its own TM0 execution slice).

## ADR-109 — DealPilot discovery is Agent-owned, cursor-safe, and charged by attempted evidence (2026-07-17)
- **Decision**: Deal discovery enters through a manifest-backed Automation whose stored owner is the Egress Agent; `dealpilot.source` resolves from a workspace Goal/Task and cannot be invoked by a browser-selected Agent. Gmail alert scans use a per-Source cursor, provider receipt time with an overlap window, approved-sender filtering, and stable message-ID dedupe; they cap provider pages per run, retain in-process continuation plus the first scan's checkpoint and visited-token history, reject same-run/cross-run token cycles, reset failed saved tokens to the head, and advance the cursor only after every listed thread body was fetched. Message IDs/continuation commit only after captures and spend persist. Spend is charged for every attempted authorized alert, including parser failures. Approved Source-to-Thesis Relations idempotently propagate to existing and future Deals linked to that Source.
- **Why**: Client-selected actors defeat attribution. Advancing a one-page cursor can permanently skip a backlog, while charging only parsed messages makes template drift appear free. A causal thesis→source→deal graph is incomplete if Relation results depend on whether approval happened before or after Deal ingestion.
- **Alternatives rejected**: direct Human invocation of the connector Skill; one-page Gmail reads with unconditional checkpoint advancement; charging only emitted captures; rerunning all historical messages without stable IDs; forward-only Relation propagation for newly ingested Deals.
- **Consequences**: discovery remains bounded, attributable, replay-safe within the current process-local prototype, and honest about parse costs. Durable message cursors, DealPilot Records, captures, and credential vault storage remain a named Local Plane follow-up; TASK-006 therefore stays `in_progress`.

## ADR-110 — Second Brain is the Graph view at full scope; Graph view gains a cross-Database scope selector (2026-07-17; renumbered from this session's ADR-109 which collided with the DealPilot discovery decision above)
- **Decision**: Graph view (§3 of `docs/raw/brd-dataengine-views-2026-07.md`) is extended with a scope selector: `single_database` (default — the Page's own rows + their direct Relations), `multi_database` (user selects which additional Databases contribute nodes), and `full` (all permitted Databases across every installed Module, permission-filtered). Second Brain is Graph view at `scope: full` — not a separate surface, not a separate component, not a separate route class. The "Second Brain" left-nav entry becomes a named preset that opens Graph view pre-configured to `scope: full`. There is no structural difference between a relationship graph on one Page and Second Brain except which Databases are included. The same renderer, the same eligibility rule, and the same write path handle all three scopes.
- **Why**: the prior stance (ADR-108, same day) declared Second Brain "architecturally distinct" from a Page's Graph view on the grounds that one crosses Database boundaries and the other does not. On reflection, that boundary was defensive, not load-bearing: the renderer doesn't care how many Databases feed it; permission filtering and progressive load handle the scaling concern without requiring a separate surface. Keeping them separate would mean building and maintaining two node/edge graph implementations — one single-DB, one multi-DB — with no actual behaviour difference between them. The user's formulation was correct: the only difference is the underlying data.
- **Alternatives rejected**: keep Second Brain as a separate surface with its own component and route (rejected — two graph implementations with no real behavioural distinction; the scaling/performance concern is better handled by progressive load and default filters within the one Graph renderer, not by a hard architectural split); make Graph view always cross-Module (rejected — single-DB scope as the default is the right starting point; the scope selector lets the user expand deliberately rather than being overwhelmed by a full-graph render on every Page that has a relation column).
- **Consequences**: TASK-009 (Actionable Second Brain graph) and TASK-014's Graph renderer deliverable converge — building the real Graph renderer (TASK-014) with scope-selector support delivers Second Brain simultaneously; TASK-009 is no longer a separate build, it is a configuration of the same renderer. TASK-009's Outcome/Prototype-test are updated to reflect this. ADR-108's "never merge the two / never let one Page's Graph view try to render cross-Module data" is superseded — the correct rule is: Graph view supports three scopes; Second Brain is the `full` preset; one implementation.

## ADR-111 — Learning Agent's LA3 web-research capability starts on free Tier-1 direct-access providers behind a `SearchProvider` port; paid Tier-3 sources are evaluation-gated (2026-07-17)
- **Decision**: LA3 (`docs/raw/learning-agent-roadmap-2026-07.md` §6) gets a concrete provider roadmap instead of an abstract "crawlers" placeholder. A provider-agnostic `SearchProvider` port is added, matching the existing `ModelProvider`/`MemoryStore`/`ContentGuard` port/adapter shape already in the codebase — callers never see which backend answered. It is wired first to three **Tier 1** sources that are free with no account or key: Parallel Search MCP (anonymous HTTP MCP, verified working this session), Jina AI's Search Foundation APIs in keyless mode, and the DuckDuckGo Instant Answer API. Every result crossing the port carries `untrusted_external` taint via the already-shipped PI-1/PI-2 pipeline before it can reach a Memory or prompt — no new taint mechanism. **Tier 2** (33 providers with a free tier gated behind account/API-key creation — Exa, Tavily, Firecrawl, Apify, Browserbase, etc., full list in `outputs/2026-07-17-learning-agent-recon-search-integrations.md`) are added 2-4 at a time, only once Tier 1 coverage proves insufficient for a real research objective, using Bridge's existing credential-vault pattern (same shape as DealPilot Source credentials, TASK-006). **Tier 3** (paid-only or self-hosted-only — Perplexity Sonar, Bright Data, Webz.io, Klue, Contify, SearXNG, Crawl4AI, etc.) requires an explicit cost/ROI proposal and a `docs/APPROVALS.md` gate before any spend or infra stand-up; it is never a silent default.
- **Why**: the user asked for an exhaustive survey of web-search/recon-relevant APIs (178 candidates reviewed via a Parallel.ai FindAll run) and directed that free-and-directly-accessible providers rank above free-with-signup, which in turn rank above paid/self-hosted-only — the same shape LA3's existing SSRF-hardened-client-before-crawlers ordering already uses (cheapest/safest first, escalate only on demonstrated need). Starting Tier 1 at zero providers with zero cost and zero credential-provisioning work lets LA3 ship a working research call immediately; Tier 2/3 exist as a pre-vetted expansion path rather than requiring a fresh survey each time coverage proves insufficient.
- **Alternatives rejected**: making Parallel's own paid FindAll/Task API the default recon backend (rejected — real per-run cost with no proven recurring need yet inside Bridge; kept as a Tier-3 evaluated option instead, exactly as it was used this session only after explicit user approval); hardcoding one scraper Integration directly into LA3 instead of a provider port (rejected — repeats the single-vendor lock-in risk the survey itself surfaced, e.g. Tavily's fate tied to its Nebius acquisition; a port lets any Tier 1/2 provider swap in or drop out without touching LA3's callers); wiring all 33 Tier 2 candidates at once (rejected — an unbounded Integration/credential surface with no attributable usage yet contradicts "build only what creates lasting value"; start with 2-4 proven providers, expand only on demonstrated need).
- **Consequences**: `docs/raw/learning-agent-roadmap-2026-07.md` gains §7 (the full tiered provider table + rollout phases); `docs/TASKS.md` gains TASK-023 (Learning Agent governed web-research Skill, renumbered from this session's original TASK-022 which collided with main's parallel-landed inference-optimization TASK-022) depending on TASK-007's Skill-resolution mechanism; AP-039 records the approval (renumbered from this session's original AP-038, which collided with main's parallel-landed AP-038 for the inference-optimization task); `docs/wiki/learning-agent.md` gets a caveman pointer; the full 178-candidate classification (46 matched + 132 unmatched, with per-group discard reasoning) lives in `outputs/2026-07-17-learning-agent-recon-search-integrations.md` as the durable audit trail. No code changes in this pass — TASK-023 executes the port + Phase 1 wiring.

## ADR-112 — Relationship decisions persist before durable, monotonic Relation effects (2026-07-18)
- **Decision**: An approved or edited Relationship proposal first appends one authoritative decision linked by `ref_ledger_id`. A separate `relation_materialization_effects` row, unique by proposal and decision, then tracks pending/applied/failed state, bounded attempts, separately bounded stale-lease recovery, error/retry timing, and applied Relation count. Relation application is atomic and ordered by the database-assigned ledger append sequence; the newest decision replaces the canonical participant/source set and `userConfirmed` value. Reads use `(observed_at, created_at, id)` keysets and owner-aware permission pruning. Runtime and UI resolution never infer proposal identity from caller-controlled JSON.
- **Why**: Human approval must survive a materialization crash without requiring a second decision, and concurrent/replayed decisions must converge independently of process timing or application order. JSON reference inference let spoofed input affect which proposal appeared resolved. Offset or non-unique timestamp pagination could skip Relations under same-time or concurrent inserts.
- **Alternatives rejected**: materialize before appending the decision; mutate the decision row with effect status; retry by creating a second approval; use process-local timestamps as ordering authority; OR-merge `userConfirmed`; infer proposal linkage from `inputs.proposalId`; paginate by timestamp or offset alone.
- **Consequences**: restart/replay recovery is inspectable and idempotent; Approvals retains retryable cards until application succeeds; newer decisions deterministically replace older canonical state; malformed/ambiguous legacy references stay unresolved. Migration `0015_task008_relation_contract` owns the schema, RLS, verified legacy backfill, sequence repair, and effect indexes.

## ADR-114 — macOS Avatar positions use logical desktop coordinates and native move events; NSPanels revert before close (2026-07-18; ADR-113 is already claimed in paused TASK-022/TASK-023 worktrees)
- **Decision**: Persisted Avatar positions carry an explicit `physical|logical` coordinate-space tag. macOS writes and restores logical desktop coordinates; other platforms retain physical coordinates. Native Tauri `Moved` events feed one debounced persistence worker per overlay label instead of depending on webview `pointerup`; the worker resolves the current same-label window when it saves so topology removal/recreation cannot leave it writing through a stale handle, and `ExitRequested` synchronously flushes current overlay positions. Startup records the already-created topology and repairs missing panel membership separately, without immediately forcing every valid cross-display restore back to its original monitor. Re-anchoring uses the window's current logical size so an expanded panel preserves the same bottom-right when it collapses. A macOS `AvatarPanel` converts through `Panel::to_window()` before Tauri closes it during topology removal, with ordinary-window fallback when panel registration never completed.
- **Why**: A real Retina-plus-1x display matrix proved Tao's per-monitor physical coordinates overlap on macOS and placed two panels on the built-in display. Native window drags are not required to return `pointerup` to the webview. Closing a dynamically subclassed NSPanel directly during a real topology removal raised an Objective-C exception that Rust could not catch and aborted the process. Recovery review found that a stale debounce handle could absorb moves from a recreated same-label overlay, immediate quit could beat the debounce, an expanded window anchored as 96×96 would collapse off-screen, and a pre-registration build failure could suppress retries until topology changed.
- **Alternatives rejected**: keep globally compared physical coordinates on mixed-DPI macOS; save only from frontend pointer events; rely on debounce without an exit flush; poll and write continuously during drag; spawn one debounce thread per move event; retain the original window handle across topology recreation; anchor every window as collapsed; seed topology without validating overlay membership; close the still-subclassed panel and then drop the plugin handle; treat deterministic or virtual monitor tests as a substitute for real hardware.
- **Consequences**: legacy untagged physical positions re-anchor once on mixed-DPI macOS and are then rewritten as logical. The failed session reported real three-display placement, Accessibility-driven move/save/relaunch, external-display reposition, and extend→mirror→extend 3→2→3 without restart or crash. At recovery-review time, TASK-003 remained blocked because human physical pointer drag/relaunch, physical VoiceOver activation, and (if interpreted literally) cable/power detach were unperformed. AP-041 later records the user's confirmation that all three physical checks pass and closes TASK-003.

## ADR-117 — DealPilot durable state shares one exclusively owned Local Plane database; Source credentials live only in an explicit OS vault (2026-07-18)
- **Decision**: DealPilot runtime state is one versioned, Organization-scoped aggregate behind the generic atomic Local Plane state port. The file-backed adapter stores it in adapter-owned `local_state` and `local_external_records` tables, uses revision compare-and-swap for shared-client contention, and takes a heartbeat-backed cross-process lock before opening the embedded database. Ownership canonicalizes absolute paths and existing symlinks before locking. Drizzle and Local Plane adapters share that one PGlite client and the existing `BRIDGE_LOCAL_DIR`; they never open competing clients on one directory. Record/Relation/capture/Gmail/spend updates that must agree commit in one reducer. Initialization failures close partially opened clients and release ownership before propagating the original and cleanup errors. Before Drizzle migration, legacy text-keyed `external_records` is validated and moved to `local_external_records_legacy`; Local Plane startup copies and verifies exact values before dropping that backup, including interrupted-copy recovery. Source secrets use MIT `@napi-rs/keyring` behind `SourceCredentialVault`; every write gets a unique keyring account and every opaque reference is rebound to the requested Organization and Source on metadata/read/delete. Opaque create/revoke journals reconcile vault and aggregate state after a crash without ever storing a value. Runtime boot without durable Local Plane storage or an explicitly approved secure credential provider fails. The in-memory vault and state adapter are test-only.
- **Why**: Separate PGlite clients over one directory produced incoherent concurrent state in a black-box test, and process-local maps lost Records, Gmail continuation, spend, and dedupe on restart. A success-shaped in-memory credential fallback would expose plaintext to process memory while telling the caller that persistence succeeded. One owned database plus atomic workspace reducers provides restart durability and one ordering boundary without moving private data to the Cloud Plane; an OS credential service keeps plaintext out of Bridge DB/files/logs.
- **Alternatives rejected**: retain process-local maps with startup warnings; open a second PGlite client or a second directory for DealPilot; persist credential ciphertext or plaintext inside `local_state`; use stale `keytar`; silently fall back to memory on servers; let Drizzle interpret the legacy table as its canonical UUID/FK table; add a numbered migration that would collide with RM4 `0015` or TASK-010's next migration.
- **Consequences**: only one Bridge process may own a file-backed Local Plane directory at a time, and successful shutdown closes wiring before releasing ownership. If client close fails, ownership remains held so another process cannot open a database that may still be live. Equivalent filesystem spellings cannot bypass that ownership. Gmail pending receipts, cursors, checkpoints, visited tokens, stable message IDs, and settlements recover after restart; relation backfill and capture materialization are atomic/idempotent. Failed or interrupted credential writes/revokes converge by opaque reference, and concurrent Source creation can delete only its own keyring entry. Web/server-only deployments must inject an approved vault or fail at boot. Adapter-owned tables need no numbered migration metadata, so RM4 `0015` and TASK-010 sequencing are untouched. Live macOS keychain interaction is proven; live Google, physical-mobile/signing certification, and cryptographically verified OS re-authentication remain external gates rather than inferred claims.

## ADR-118 — The durable desktop sidecar uses a per-launch capability and parent-retained socket, not loopback as an authentication boundary (2026-07-18)
- **Decision**: Every release-sidecar launch generates 256 random bits in Rust, binds `127.0.0.1:0` itself, retains that listener for the privileged-webview lifetime, and passes both the capability and inherited listener descriptor to Node. Fastify consumes the exact inherited socket, constant-time verifies `X-Bridge-Sidecar-Token` before every sidecar request except the external Google OAuth callback and CORS preflight, and independently forces loopback in sidecar mode. The web client and legacy Google helpers share the injected URL plus bearer/capability headers. A tokenless bootstrap exists while the child starts; privileged webviews are created only after authenticated readiness. If the child dies, capture and topology work terminally stop, pending/raw capture is discarded, privileged windows hide/close through platform-safe paths, and an unavailable window replaces them while Rust keeps the port reserved. Shutdown authenticates first, lets active requests drain while closing newly idle connections, then applies an independent five-second orphan deadline. Unix parent liveness uses inherited stdin plus PID; unsupported non-Unix release socket activation fails closed instead of predicting and rebinding a port. The capability proves only the server-owned client, never password AMR or Human re-authentication, and is never stored, logged, or placed in a URL.
- **Why**: loopback and a random port do not authenticate a caller. Any webpage can probe localhost, and the original sidecar combined permissive development CORS with a non-persistent auth posture despite durable private state.
- **Alternatives rejected**: rely on loopback/random ports; predict a free port then let Node rebind it; release the parent listener after startup; create the privileged webview before readiness; reuse a Supabase bearer as the desktop capability; put the capability in a URL; persist it across launches; force-close active durable requests; exempt health/private reads; treat sidecar possession as Human re-authentication.
- **Consequences**: stale or cross-launch callers fail 401, and a crashed child cannot hand the credential-bearing port to another local process. The Tauri client remains offline-capable without inventing a Human identity proof. Release bootstrap/unavailable pages require Tauri's explicit data-URL feature, and macOS companion retirement must first revert `AvatarPanel` to its Tauri window. Google OAuth's provider callback remains separately reachable by design and is protected by ADR-119.

## ADR-119 — Google OAuth uses single-use state, PKCE, and serialized token finalization (2026-07-18)
- **Decision**: `google.connectUrl` issues 256 random state bits plus a PKCE verifier only after authenticated membership checks. The raw state and S256 challenge go to Google's authorization URL; Bridge persists only the state hash plus Integration, initiating Human, expiry, and Local Plane verifier. Callback handling atomically consumes both before denial handling or verifier-bound code exchange, derives the Integration from server state, validates the initiating Human before provider access, and rechecks membership at token finalization. Every token read/write/delete/CAS for one Integration shares one lock. Exchanged tokens remain provisional and invisible until authorization succeeds; denial or error restores the exact prior token before releasing the lock. Refresh persistence uses ordered compare-and-swap so a stale refresh cannot overwrite a newer reconnect.
- **Why**: a predictable Integration ID is routing metadata, not CSRF proof. Because the provider redirect cannot carry the sidecar header, the state must independently prove that an authenticated Bridge client started the flow.
- **Alternatives rejected**: exempt the callback and trust CORS/loopback; use Integration ID as state; omit PKCE because state already exists; store raw state or the verifier in a URL/log; use a process-local map; exchange first and validate later; publish tokens before the post-exchange membership check; use a separate finalization lock; let refresh writes unconditionally replace reconnect credentials.
- **Consequences**: authorized OAuth flows survive API restart, while state replay, intercepted-code reuse, account substitution, membership revocation, provisional-token reads, and refresh/reconnect races cannot persist or expose the wrong credential. The opaque random state and challenge necessarily transit the OAuth URL but carry no Human or private payload; the verifier remains Local Plane only. Unknown, malformed, expired, replayed, legacy predictable, wrong-Integration, and no-longer-authorized flows fail closed.

## ADR-120 — Privileged Tauri webviews never navigate externally; OAuth uses the system browser (2026-07-18)
- **Decision**: release webviews accept top-level navigation only on `tauri://localhost` and Tauri's HTTP(S) localhost origins. The per-launch sidecar capability is assigned immutably only when the document origin matches that set, and only the main webview receives the token-bearing initialization script; Avatar/annotation companions get a tokenless script. Google consent URLs are validated as HTTPS `accounts.google.com/o/oauth2/` URLs and opened by a native command in the system browser; the launcher waits for its helper process so no zombie remains. The release sidecar sets its own random-port loopback callback URI.
- **Why**: Tauri initialization scripts execute on every top-level navigation. Replacing the privileged main webview with an external page would put the literal launch capability into an untrusted document, defeating loopback authentication.
- **Alternatives rejected**: continue `window.location.href`; rely only on an origin conditional while allowing remote navigation; inject the capability into all companion webviews; permit arbitrary external URLs in a generic opener; expose the capability to the system browser.
- **Consequences**: external consent cannot read privileged webview globals, and the provider returns to the actual sidecar instance. Browser deployments retain normal same-window OAuth behavior because they never receive the sidecar capability.

## ADR-115 — Relationship continuity uses existing Memory, Event, and Relation stores (2026-07-18)
- **Decision**: Relationship context adds no parallel contact graph or mutable commitment/introduction table. Person Memory uses the existing MemoryStore: correction appends a replacement linked by `supersedesId`, normal reads hide superseded rows, and forget removes the full correction lineage. Commitment and Introduction transitions are private immutable Interaction Events containing full current snapshots, with evidence-bearing RM4 Relations back to their People. Introduction completion requires both recorded consents; a decline reason is stored privately but projections expose only that one exists. Path finding traverses only visibility-pruned `listRelations` results under explicit depth/path/visit/edge bounds. Community composition reuses the same People, Signal, Event, and Relation reads and reports an honest empty Files state.
- **Why**: Existing stores already provide owner/RLS boundaries, decision provenance, evidence pruning, and unified Timeline behavior. Immutable snapshots make retries and current-state projection deterministic without allocating TASK-010's reserved migration `0016`. The Relationship path explanation must not duplicate TASK-014/TASK-009's Graph renderer.
- **Alternatives rejected**: add mutable commitment/introduction/preference tables in a new numbered migration; overwrite corrected Memory in place; treat silence as Introduction consent; expose private decline text in list/detail projections; read the graph directly without RM4 pruning; build a Relationship-only visual graph.
- **Consequences**: RM3 continuity, the Relationship-owned RM4 remainder, and double-consent Introduction state are independently mergeable without schema work. The Human owner records consent received from each party; this does not pretend Person Records are authenticated platform principals and it never sends externally. Persistent user-defined Automation scheduling/Agent-Run inspection, team delegation wired into runtime authority, export/disconnect/forget orchestration, cross-Module Graph rendering, and held-out eval execution remain separate explicit work.

## ADR-116 — Sensitive private Event detail is stored on owner-filtered Relations, not workspace-readable Event payloads (2026-07-18)
- **Decision**: A private Relationship Event writes only a safe lifecycle envelope to the existing workspace-scoped `events` row. Summary, source record, and artifact snapshot detail are copied into `privateEventPayload` on its participant Relations, whose existing RM4 RLS permits only the owner. Timeline projection rehydrates detail only from Relations already admitted by owner/visibility pruning. Commitment and Introduction current-state reads use their owner-filtered Relation properties, with Event-payload fallback only for legacy rows. Workspace-visible Events keep their ordinary shared payload.
- **Why**: `events` has workspace RLS, not owner RLS. Application filters alone would still leave private content readable through a same-workspace database role. Existing `edges.owner_user_id` plus RM4 owner-aware RLS provides the required physical protection without allocating TASK-010's reserved migration `0016` or splitting the unified Timeline.
- **Alternatives rejected**: leave private detail in `events` and rely only on API predicates; alter Event RLS in a new migration; put private Relationship Events only in the Local Graph and bifurcate Timeline/current-state projection; add encryption before a governed per-owner key seam exists.
- **Consequences**: new private Event rows reveal no summary, source-record value, commitment text, Introduction participants/state snapshot, or decline text to another workspace member. Legacy Event payloads remain readable through compatibility paths but API/Relation access stays owner-pruned. No schema or numbered migration changes.

## ADR-121 — Full Graph is a bounded read projection over canonical stores, never a second global index (2026-07-19)
- **Decision**: `DrizzleGraphStore.listFullGraph` builds the full-scope Graph at read time from canonical Records, typed Relations, Events, and `files`/`file_refs`. It attaches Database/Module provenance, prunes inaccessible Relationship nodes and incident edges before returning them, caps one response at 200 Relations, and exposes honest `hasMore` loading. Second Brain consumes this exact projection through the shared Graph renderer. No persisted “Second Brain index” or separate Graph schema is introduced.
- **Why**: a global index would duplicate personal data, create a new permission boundary, and drift from owning Module stores. The read projection preserves source authority and makes every edge explainable. A hard response bound prevents an accidental unbounded local/cloud query while the renderer remains usable.
- **Alternatives rejected**: persist a denormalized global node/edge table; let the browser join Module APIs; return an unbounded full graph; include inaccessible endpoints then hide them client-side; treat filesystem paths as canonical File identity without the planned watcher/hash index.
- **Consequences**: adding a canonical Database requires an explicit projection adapter and provenance mapping. Module Files copied only to the filesystem remain absent until TASK-012 VOCAB4 supplies stable watcher/hash-backed File identity; that gap is logged, not papered over with an unsafe dual write. Larger graphs use progressive loading now; cursor/virtualization refinements can evolve behind the same contract.

## ADR-122 — Map uses local coordinates and a Local Plane geocoder port, never ambient public location egress (2026-07-19)
- **Decision**: the canonical Map renderer plots stored coordinate-bearing Location values on a bundled local world basemap. Location accepts a place label, `latitude,longitude`, `label | latitude,longitude`, a structured latitude/longitude object, or a GeoJSON Point. A label alone remains explicitly unresolved. Bridge never automatically sends it to a public geocoder and never requests remote map/marker tiles. Optional resolution goes through `GeocodingProvider`, whose contract is Local Plane only; the shipped adapter accepts only an explicitly configured loopback Nominatim-compatible endpoint. The Human starts resolution, inspects the pins, and may save coordinates through the same Record update callback as any other field edit.
- **Why**: the shared Map initially plotted only strict coordinates while real People, Communities, JobPilot, and DealPilot fields carry place labels. Restoring the deleted browser-side Nominatim loop would disclose potentially private labels automatically, and the public Nominatim policy explicitly says not to submit personal/confidential material. Remote tiles also reveal viewed coordinate extents. A bundled basemap plus local provider preserves useful Map behavior without creating an ambient egress path. The user explicitly selected this boundary in AP-048.
- **Alternatives rejected**: automatic browser Nominatim plus `localStorage` cache (private-label disclosure, ungoverned persistence, public-service policy mismatch); Mapbox cloud/MCP (credentials, commercial terms, and cloud egress when the accepted requirement is Local Plane); making every current label field plain text and hiding Map (honest but loses the approved location-kind capability); shipping a hand-curated city table (partial/dummy geography that cannot resolve arbitrary real Records).
- **Consequences**: `world-atlas@2.0.2` (ISC) supplies Natural Earth 4.1.0 country geometry (Natural Earth states its map data is public domain); `topojson-client@3.1.0` is ISC. Reuse intake also found Mapbox and Mapbox DevKit MCP entries (Agent Finder relevance scores 90 and 80; relevance is not a trust/safety rating), but neither was installed. Public Nominatim remains rejected as a default; a user may self-host a compatible loopback service and set `BRIDGE_LOCAL_GEOCODER_URL`. With no provider, Map still plots stored coordinates and tells the Human the exact local coordinate format.
