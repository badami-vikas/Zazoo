# PROGRESS — single work tracker

**This is the ONE place to look for "what's being worked on and what's next."** It is a cursor, not a plan: every task points at its source doc, which stays the single source of truth for full detail. Nothing here replaces or deletes a plan — see the Plan Registry at the bottom for where everything lives.

## Protocol (read before working)
- **Where tasks load from**: each task cites `→ source-doc §section`. Open the source doc for full spec/exit criteria before starting. Never work from this file's one-liner alone.
- **A task is DONE when ALL of**:
  1. The exit criteria in its source doc are met and **verified** (build + tests + typecheck pass; live check if it has a runtime surface — no "should work").
  2. Any matching `docs/BUGS.md` row is flipped to RESOLVED (+date).
  3. One line appended to `docs/log.md`; ADR appended to `docs/raw/decisions-log.md` if a non-trivial call was made.
  4. Its checkbox here is ticked with date.
- **Refilling batches**: when a batch empties, promote the next batch up and pull a new "Batch 3" from the sequencer — `docs/raw/roadmap-6month-2026-h2.md` (month order) cross-checked against `docs/BUGS.md` OPEN P0s and `docs/requests.md` open R-items. Update this file in the same commit.
- **Never delete a plan doc.** Superseded → mark `status: superseded` in its frontmatter + note here. All planned documentation is preserved in the registry below.

## BUG-INTAKE protocol (standing, user-directed 2026-07-10, AP-004) — user reports bugs ⇒ INTERRUPT
When the user shares new bug(s), this preempts the default batches. Steps, in order:
1. **Record**: save the user's verbatim report → `docs/raw/requirement-bugs-YYYY-MM-DD-<slug>.md` (`doc_kind: requirement` — frontmatter only, body never edited) and add row(s) to `docs/BUGS.md`.
2. **Sweep BEFORE executing** (delegate to an Explore subagent; keep main thread lean): scan the batches below, the Plan Registry, and `docs/BUGS.md` OPEN rows for items that are (a) **root causes** of the reported bugs, (b) **same-surface** — touch the same files/modules the fix will touch, or (c) **easy wins** — low-effort/high-ROI adjacent to the fix.
3. **Augment with a cap**: create an **`INTERRUPT` batch** above NOW listing the bug fixes + pulled-in items, each tagged `[root-cause]` / `[same-surface]` / `[easy-win]` with its `→ source` pointer. Cap pulled-in work at ~30% extra effort over the plain fixes — a bug report must not balloon into a refactor. Overflow candidates → note in BUGS.md, leave in their plan.
4. **Execute** the INTERRUPT batch under the normal done-criteria (verify → flip BUGS rows → log → tick).
5. **Resume**: when the INTERRUPT batch is empty, delete it; default batches resume where they paused. Requirement doc gets `status: executed` in frontmatter.
No per-instance APPROVALS row needed — this standing rule is the approval; reprioritization is automatic.

---

## NOW — roadmap Months 1–6 DONE + APPROVED: Batches 1–7 + 9 ticked (AP-010–017 APPLIED, user · 2026-07-14). Only **Batch 8** (XP-2/XP-3) remains — INFRA-GATED (signing certs + 3-OS CI + on-branch mobile app). H2 roadmap code-complete through §M6 on PR #11 (commit `40306ca`).

- [x] 2026-07-09 — `docs/INDEX.md` nav map (≤50 lines, where-does-X-live)
- [x] 2026-07-09 — `docs/CODEMAPS/flows.md`: 3 mermaid sequence diagrams (pipeline propose→decide, plane gate, ritual executor) + schema ER sketch
- [x] 2026-07-09 — standing token rules added to `CLAUDE.md`
- [x] 2026-07-09 — skill scoping: `skillOverrides: off` for 111 off-project skills in `.claude/settings.json` (from `docs/skills-diluting-project.csv`). ⚠ `.claude/` is gitignored — applied to BOTH the worktree and the main checkout's settings; it will not travel via git. ⚠ Verify next session that the noise is actually gone; claude.ai-connector plugins (brand-voice/legal/marketing/sales/finance…) may need disabling in claude.ai connector settings — a repo file can't unload those.
- [x] 2026-07-09 — this tracker (`docs/PROGRESS.md`) created; pointer added to CLAUDE.md

## Batch 1 — Security P0 (Month-1 of H2 roadmap) → `docs/raw/roadmap-6month-2026-h2.md` §M1 · runnable prompts: `docs/raw/roadmap-execution-prompts-2026-h2.md` · bug rows: `docs/BUGS.md` SEC H1–H4

- [x] 2026-07-14 — SEC-1 — auth enforced by default (kill pilot-user fallback, `apps/api/src/identity.ts:84-91`)
- [x] 2026-07-14 — SEC-2 — CORS allowlist + rate limiting on the API
- [x] 2026-07-14 — SEC-3 — dependency bumps (drizzle-orm, react-router HIGH advisories) + `pnpm audit` CI gate
- [x] 2026-07-10 — SEC-4 — Tauri shell CSP (was `csp: null`, now a real policy — see BUGS.md)
- [x] 2026-07-14 — XP-1 — cross-OS compile (cfg-gate Apple crates so Linux/Windows build) → `docs/raw/cross-platform-compatibility-2026-07.md` §2b

> 2026-07-13: SEC-1/2/3 + XP-1 all implemented + verified this session (api 53→58 tests green, @bridge/db 49 green, full `turbo run build test` green, macOS `cargo check --locked` clean; BUGS.md H1/H1a/H2/H4 → RESOLVED; ADR-054/055/056). **2026-07-14: AP-010 APPROVED by user → the four boxes above are ticked DONE.** XP-1's CI-green DONE-WHEN (all 3 OSes) still awaits the first run of the new `desktop` 3-OS matrix job.

## Batch 2 — Testing P0 (pre-pilot gate) → `docs/raw/testing-strategy.md` §P0 · `docs/BUGS.md` P0 batch

- [x] `decide()` double-approve concurrency test (proves the partial unique index holds)
- [x] `matchOne` tie-break determinism test
- [x] OAuth token-refresh persistence test
- [x] `router.ts` test file (procedure-level coverage)
- [x] `hasExternal` double-propose idempotency test
- [x] Wire vitest + coverage into CI (turbo cache poisoning noted in BUGS.md)

> 2026-07-14 (status — boxes ticked; **AP-011** APPLIED user · 2026-07-14): all 6 items now satisfied. Items 1/2/5 (decide() TOCTOU, matchOne tie-break, hasExternal double-propose) **already had passing tests** pre-batch (verified: core 219, dedupe 9, integrations-google intake-dedup green). Item 3 (OAuth token-refresh persist) + item 4 (`router-decide.test.ts` — propose→decide veto happy-path + agent-floor-denied→FORBIDDEN; `dealpilot.list` already in `single-tenant-guard.test.ts`) written this batch via 2 parallel subagents. Item 6 wired node's built-in `--experimental-test-coverage` + per-package line floors into all 19 test-bearing packages — **house runner stays `node --test`, NOT vitest** (that plan wording is superseded); CI's existing `turbo run … test` enforces it. Verified: `turbo run test --force` 36/36, 19 tasks `fail 0`, all floors pass (set at/below measured current so CI is green day one). Unrelated pre-existing CI reds remain: `@bridge/web` typecheck (BUGS.md OPEN) + `prototype` tsc (dangling PII-artifact imports).

## Batch 3 — Measurement + security M2 → `docs/raw/roadmap-6month-2026-h2.md` §M2

- [x] EVAL-1 — Agent Quality scoring reducer (ship first) → `docs/wiki/agent-eval.md`
- [x] EVAL-2 — EvalStore
- [x] SEC-5 — RLS-as-code (tables currently `isRLSEnabled: false`)
- [x] SEC-6 — membership checks on `workspace.*` procedures
- [x] SEC-7 — Recon SSRF fix + log redaction + LinkedIn verification proof

> **Status (2026-07-14)**: all 5 items code-complete + verified green (full `turbo run typecheck test build --force` 59/59; core 230 / db 53 / api 67 / recon 5). Boxes above ticked — **AP-012** APPLIED (user · 2026-07-14). Details: `docs/log.md` 2026-07-14 Batch 3 entry; ADR-057/058/059/060.

## Batch 4 — Month-3 PI-1 + MEM-1 (prompt-injection defense v1 + Memory primitive) → `docs/raw/roadmap-6month-2026-h2.md` §M3

- [x] PI-1 — provenance/taint tagging: `trustOrigin` from ingest edge → Memory + ledger; activate the dead `intake_policy.quarantine` flag (tag+persist only, no gating)
- [x] MEM-1 — the `memories` table + `MemoryStore` port; classification + authority-scoped reads at the store boundary; wire capture → inspectable Memory

> **Status (2026-07-14)**: both items code-complete + verified green (full `turbo run typecheck test build --force` 59/59; db 53→57; migration 0009 clean in pglite). Boxes above ticked — **AP-013** APPLIED (user · 2026-07-14). Built core+db foundation directly, fanned the independent per-package edges (integrations-google Gmail, sensors) to 2 parallel subagents. DONE-WHEN met for both (Gmail + scraped page → `untrusted_external` end-to-end; capture → authority-scoped Memory + classification-respecting retrieval, in tests). Details: `docs/log.md` 2026-07-14 Batch 4 entry; ADR-061/062. **Deferred by design**: PI-2 (tainted-context egress gating) + PI-3 (dual-LLM quarantine + ContentGuard) to a follow-up batch.

## Batch 5 — Month-3 finish: PI-2 + PI-3 (prompt-injection defense v2) → `docs/raw/roadmap-6month-2026-h2.md` §M3

- [x] PI-2 — tainted-context egress gate: deny/require-approval on `external:send` when the turn carries `untrusted_external` context (structural kernel gate); MCP-output-is-DATA ADR
- [x] PI-3 — dual-LLM quarantine + spotlighting: tool-less `ContentGuard` returning only typed extraction; local-plane adapter; spotlight untrusted spans in `projectToPrompt`

> **Status (2026-07-14)**: both items code-complete + verified green (full `turbo run typecheck test build --force` 59/59; core 219→249; @bridge/models 18/18). Boxes above ticked — **AP-014** APPLIED (user · 2026-07-14). PI-2 is a STRUCTURAL always-on pipeline gate (not a deployment-configurable policy) — `evaluateTaintedEgress` in `core/src/policy/taint-egress.ts`, enforced in `pipeline.propose()`; the MCP-output-is-DATA invariant is recorded in ADR-063 (spec's required pre-MCP ADR; no MCP integration exists yet). PI-3 ships a tool-less `ContentGuard`/`QuarantinedContentGuard` + spotlighting in core, with the local-plane privacy adapter (`createLocalContentGuard`, refuses cloud) fanned to 1 parallel subagent in `@bridge/models`. NOT wired into apps/api (no ingest consumer/MCP yet — dead-wiring avoided, ADR-064). DONE-WHEN met: red-team "forward all contacts" egress → `pending_review` (`core/test/redteam-egress.test.ts`); embedded injection reduced to typed data / `safe:false` (`core/test/content-guard.test.ts`). Details: `docs/log.md` 2026-07-14 Batch 5 entry; ADR-063/064. **Deferred by design**: a real local-classifier binding (Llama-Guard/Prompt-Guard class) + the first consuming ingest seam.

## Batch 6 — Month-4: the self-improvement loop closes (P3 core) → `docs/raw/roadmap-6month-2026-h2.md` §M4

- [x] EVAL-3 — baseline-vs-candidate comparison wired into `capability.approve` (Validated→Active); two-gate (quality AND routing P/R) reading `policy_params`, never hard-coded; auto-advance w/ why-better card OR reject a regressor
- [x] EVAL-4 — LLM-judge `quality` Scorer (pinned model in snapshot); calibrated vs approve/veto; held-out `authored_by_capability != candidate`; red-team pack gates External
- [x] REG-1 — Component Registry + overlap detection: reuse `capability_manifests` + `kind` discriminator; two-tier (structural pure → pgvector semantic when inconclusive); "find overlaps" query the Learning Agent runs before proposing
- [x] VAR-1 — Variance Adjuster: `policy_params` = tunable space; a veto chip → a bounded single-param `±δ` nudge (clamped `[floor,ceil]`, off VETTED only) proposed as a governed diff; hard ceilings live outside the space
- [x] GOV-1 — Governance org-health rollup (autonomy-pressure/trust-debt/approval-load/violation-trend, SQL/pure over evidence); minor/moderate/major = risk×origin (minor = 2 lowest bands AND built-in/template); Governance auto-approve → minor only

> **Status (2026-07-14)**: all 5 items code-complete + verified green (full `turbo run typecheck test build --force` **59/59**; `@bridge/core` → 301 @ 93.08%, `@bridge/db` 57→61 @ 56.42%, `apps/api` 67→74 @ 60.73%). Boxes above ticked — **AP-015** APPLIED (user · 2026-07-14). Built the coupled core/db foundations directly (`policy_params` tunable space → `capability_manifests.kind` + migration `0010` → EVAL-3 `comparison`), then fanned the 4 independent core surfaces (EVAL-4 judge, REG-1 registry, VAR-1 adjuster, GOV-1 org-health) to **4 parallel subagents**; owned all `index.ts`/`router.ts`/`wiring.ts` integration myself. GOV-1 auto-approve is enacted as a SYSTEM gate (the documented agent-floor exception is unimplemented — the hard DENY is preserved, ADR-070). DONE-WHEN met for all 5 (in `apps/api/test/capability-governance.test.ts` + the 5 core test files). Details: `docs/log.md` 2026-07-14 Batch 6 entry; ADR-065–071. **Deferred by design**: Drizzle `EvalStore`/`PolicyParamStore` bindings, real pgvector manifest embeddings, a violation-history view, a Governance-Agent caller, a pinned production judge model. New BUGS row: canonical-store `ON CONFLICT` vs the partial `dedup_key` index (out of Month-4 scope).

## Batch 7 — Month-5: AGENTS-1 + AGENTS-2 (the 5-agent team as invocable peers + persona) → `docs/raw/roadmap-6month-2026-h2.md` §M5

- [x] AGENTS-1 — the foundational agents invocable as first-class peers via a shared prompt-assembly seam (kernel-invariants + agent-identity layers over the ADR-027 RunContextAssembler); `invokeAgent` returns a governed union (information|draft) with NO executed variant (structural "no independent write")
- [x] AGENTS-2 — onboarding-profile → Chief-of-Staff persona: Memory-family `OnboardingProfile` view + `buildChiefOfStaffPersona`; spirit-animal tone + persona resolved SERVER-SIDE from the stored profile (stored animal wins over client `input.animal`)

> **Status (2026-07-14)**: both items code-complete + verified green (full `turbo run typecheck test build --force` **59/59**; `@bridge/core` → 317 @ 93.04%; apps/api converse tests 7→9). Boxes above ticked — **AP-016** APPLIED (user · 2026-07-14). Built sequentially by me (both edges live in `@bridge/core` — shared `dist`/`index.ts` — so parallel subagents would race on build state; the genuine parallel opportunity is Batch 8's independent surfaces). Key reconciliations: the "PromptAssembler" (undefined-elements #6) IS the shipped `RunContextAssembler` (ADR-027), extended with layers 1–2 (ADR-072), not a duplicate; roster stays ADR-046's **4 agents + Communications skill** (roadmap's "5 agents" wording superseded — Communications NOT re-promoted, ADR-074); `invokeAgent`'s "no independent write" is made structural via a union with no executed variant (ADR-073). DONE-WHEN met for both (`core/test/agents-invoke.test.ts`, `core/test/agents-persona.test.ts`, + 2 new `apps/api/test/chief-of-staff.test.ts` cases). Details: `docs/log.md` 2026-07-14 Batch 7 entry; ADR-072–075. **Deferred by design**: the richer four-axis SpiritAnimal tone card (Commons-authored), a model-backed CoS voice.

## Batch 8 — Month-5 remainder: XP-2 + XP-3 (INFRA-GATED — deferred) → `docs/raw/roadmap-6month-2026-h2.md` §M5

- [ ] XP-2 — native installers + desktop capture build, signed, running on macOS/Windows/Linux — **BLOCKED**: needs code-signing certificates + a 3-OS CI matrix (unavailable in this environment)
- [ ] XP-3 — mobile app rebased onto the shared kernel, running on device/simulator — **BLOCKED**: the mobile (Expo) app does not exist on this branch (`platform/apps` = api/desktop/web only; stranded on branch `claude/heuristic-booth-f8f5da`), and needs devices/simulators

> **Status (2026-07-14)**: split OUT of Batch 7 (ADR-075) because both DONE-WHENs require infrastructure that cannot be executed or verified here — a DONE-WHEN that can't be proven would either be falsely claimed or force fabricated evidence. Confirmed with the user before proceeding. **Unblock conditions**: (XP-2) signing certs + a macOS/Windows/Linux CI matrix; (XP-3) the mobile app present on the working branch + a device/simulator. Nothing in code or docs claims XP-2/XP-3 complete.

## Batch 9 — Month-6: packages, Commons safety, consolidation (PKG-1 / PKG-2 / BLUEPRINT-1 / CONSOLIDATE) → `docs/raw/roadmap-6month-2026-h2.md` §M6

- [x] PKG-1 — sandbox before executable logic: a pure `evaluateSandboxRequirement` gate (`core/src/capability/sandbox-policy.ts`) wired as a HARD REJECT in `packages.install`; an `execution` spec's PRESENCE marks a capability executable; `isolation:"none"` and network/fs-under-`process` are refused; declarative caps pass
- [x] PKG-2 — Commons supply-chain trust: manifest signing + verify-on-install + TLS-by-default + a community-origin trust floor. Pure policy in `@bridge/core` (canonicalize/verify/TLS, zero-dep, injected verifier); ed25519 bound at the seam (signer in `services/commons`, verifier in apps/api `HttpCommonsClient`); community pinned == user_code (untrusted → no auto-activation)
- [x] BLUEPRINT-1 — freeze `WorkspaceBlueprint` as a versioned, Commons-publishable manifest (`kind:"workspace_definition"`, `manifest.blueprint`, `schemaVersion`); `parseWorkspaceBlueprint` closed-key gate makes it declarative-by-construction; `workspaceBlueprintTo/FromPackageManifest` bridge; caps composed by reference
- [x] CONSOLIDATE — testing debt: codify the real setup (`node --test` + per-package coverage floors + turbo, NOT vitest); fix core-barrel coverage-dilution by recalibrating downstream floors

> **Status (2026-07-14)**: all 4 items code-complete + verified green (full `turbo run typecheck test build --force --concurrency=1` **59/59** — serial to avoid the documented pglite/db parallel-resource-pressure flake). Boxes above ticked — **AP-017** APPLIED (user · 2026-07-14). Built the coupled `@bridge/core` foundations directly (`signing.ts` → `blueprint.ts` parse+bridge → `approvals.ts` origin floor → `manifest.ts`/`types.ts` wiring → `index.ts`), then fanned two genuinely-independent edges to **parallel subagents** — `services/commons` ed25519 sign-seam (10/10) and `integrations-google` behavioral tests (CONSOLIDATE; 35/35, floor 50→53) — owning all apps/api wiring + tests myself (`router.ts` sandbox gate + community floor; `commons-client.ts` verify-on-install + TLS). Core → 347 (built); apps/api 75→90 (3 new test files: pkg1-sandbox-install, pkg2-commons-signing, blueprint-commons-roundtrip); commons 10; integrations-google 35. **Key calls**: ADR-076 (execution-presence = executable, MCP carve-out removed), ADR-077 (crypto at the seam, v1 registry-held signing key), ADR-078 (closed-allowlist parse = declarative enforcement), ADR-079 (no vitest; two floors recalibrated `sensors` 40→39 + `db` 55→54 for core-barrel dilution — no package's OWN coverage dropped). DONE-WHEN met for all 4. Details: `docs/log.md` 2026-07-14 Batch 9 entry; ADR-076–079. New BUGS row: `blueprintFieldSchema` enum omits `"location"` (store 10 kinds vs router/blueprint 11 — pre-existing, out of scope). **Deferred by design**: store-layer `resolvedTrustGrants` for the origin floor (defense-in-depth only today), per-publisher author-key signing (post-v1), a `docs/wiki/testing.md` rewrite.

## Resolved decisions (2026-07-09)
- **Consolidation trio → RECONCILED (ADR-044, AP-003).** Governing model: `BRIDGE_PLATFORM_RESET_HANDOFF.md` = stable brief; `docs/raw/execution-plan-2026-07.md` Tracks A–G supply the stronger lanes but execute **only behind discovery + safety gates**; `BRIDGE_PLAN_CRITIQUE_AND_EXTENDED_PLAN.md` = accepted resolution. Discovery gate re-run 2026-07-09 now **PASSES** (apps/web, capability/lifecycle.ts, PromptAssembler, workspace_definitions, package_installations, code:exec all exist — the critique's 07-07 "these don't exist" objection is stale). Remaining live gate = **safety** (sandboxing, package-import security, test strategy) before any Track executes. Tracks still not scheduled into batches until a Track is picked + its safety gate cleared via `docs/APPROVALS.md`.
- **Dummy data → SETTLED (AP-002).** No dummies unless unavoidable; unavoidable ones tracked in `docs/dummy.md`. Covers test fixtures too.

## Blocked / decisions needed (user)
- **Ordering conflict**: `docs/requests.md` R-028 (Groq-backed 5-agent Day-1 onboarding) is marked *top priority* by you, but the H2 roadmap puts Security M1 first. Batches above follow the roadmap; say the word and R-028 becomes Batch 1.
- Skill-noise residue: claude.ai connector plugins can only be disabled in your claude.ai settings (see NOW batch note).

## Plan Registry — where every plan lives (nothing lost)
**Sequencer (authoritative order):** `docs/raw/roadmap-6month-2026-h2.md` (M1–M6) + mirror prompts `docs/raw/roadmap-execution-prompts-2026-h2.md`.
**Phase model:** `docs/wiki/roadmap.md` (P0–P6) · narrative `docs/raw/vision-pivot-living-software.md` §10 · `docs/raw/roadmap-v2-universal-commons.md` (5 agents/RAG/Commons). Pre-pivot `docs/raw/ROADMAP.md` = superseded (still holds open decisions §).
**Punch-lists:** schema v2 → `docs/wiki/decisions.md` · bugs → `docs/BUGS.md` (38 OPEN + 3 IN PROGRESS) ⟷ checkbox view `All fixes.md` · testing → `docs/raw/testing-strategy.md` · user requests → `docs/requests.md` (open: R-008, R-019, R-026, R-028, R-029, R-030).
**Consolidation trio (RECONCILED 2026-07-09, ADR-044):** `BRIDGE_PLATFORM_RESET_HANDOFF.md` = stable brief · `docs/raw/execution-plan-2026-07.md` = gated lanes (safety gate required) · `BRIDGE_PLAN_CRITIQUE_AND_EXTENDED_PLAN.md` = accepted resolution.
**Canon governance:** `docs/APPROVALS.md` (propose→approve ledger for locked-doc/plan-status/DONE changes) · `docs/dummy.md` (unavoidable-dummy ledger).
**Domain plans (raw/):** token-efficient-development (M2: symbol index, `pnpm docs:codemaps`, per-doc token estimates; M3: manifest cheat-sheet, log rotation, wiki-size CI) · **optimizations-memory-vm-dealpilot-plan** (Optimizations add-on, Hermes comparison, isolated-computer policy; proposed, not sequenced) · **dealpilot-module-plan** + **dealpilot-design-requirements** (full IA/screen/component/state brief, business coverage/exclusions, Agents/Skills/Automations, reuse-first source map) · **relationship-module-plan** + **relationship-design-requirements** (current-state audit, full IA/object design, consent/privacy, Agents/Skills/Automations, RM0–RM6) · **builder-agent-roadmap** (Capability Builder BA0–BA6: toolbelt/sandbox → workspace+capability generation → validation lane → diff approvals → evolution loop → model economy/Commons; reuse map for bolt.diy/Dyad/Budibase/Appsmith/ToolJet; proposed, refines P0–P1 tracks, no sequencer reorder) · **calendar-module-plan** (CAL0–CAL6, three-lens: projection/grid → governed write-back → rituals-initiatives overlay → team/shared RLS → conference/ICS+MS-Graph/CalDAV adapters → scheduling; CAL0–CAL2 shipped for Google; expresses calendar-plan.md P3–P6 in module template, no sequencer reorder) · **jobpilot-module-plan** (JP0–JP6: onboarding/master-profile → Tier-1 legitimate sourcing → writer/evaluator loop → governed draft-then-approve apply → response/follow-up → interviews/learning; auto-apply reframed to governed, legitimate-source catalog + OSS leverage map from the requirement doc; JP0 anchor already shipped, roadmap P6, no sequencer reorder) · **egg-commons-feature-roadmap** (Egg EG0–EG5 shell/onboarding/companion/daily-rhythm + Commons CM0–CM5 wire-registry/supply-chain-trust/marketplace/ingestion/cloud; Clicky+Pluely code diligence + New Data corpus; proposed, no sequencer reorder) · **clean-room-capability-research-protocol** (license-limited source research/benchmark/independent implementation) · oss-commons-integration (supply-chain trust FIRST) · day1-integrations-free-apis · desktop-companion-agent-roadmap · cross-platform-compatibility · tool-standardization (Phases 0–5) · DESIGN-FIX (F1–F5) · helpdesk-plan (§6 P1–P4) · calendar-plan (P3–P6 future).
**Tools:** `Tools/recon/EXPANSION.md` (Phase 2–4 + estimators) · `Tools/Job/*` (DealPilot/JobPilot specs, feed P2/P6).
**Repo restructure (proposed 2026-07-11):** `docs/raw/repo-restructure-egg-commons-2026-07.md` — make egg/Commons boundary physical (P1 kill duplicate prototype/Tools copies · P2 `platform/capabilities/` split + manifest-driven built-ins · P3 fold tools in). P1 prototype-archive needs APPROVALS sign-off (PII + wrangler deploy source).
**Older checkbox plans:** `docs/superpowers/plans/2026-06-18-searcherinsights-profile-scraper.md` (open) · `2026-06-20-camera-tool.md` (⚠ predates no-dummy-data pivot — re-spec before executing).

## Last verified state
2026-07-09: docs-only session — no platform build/tests run (nothing runtime touched). `.claude/settings.json` validated with `jq`.
