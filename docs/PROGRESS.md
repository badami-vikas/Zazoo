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

## INTERRUPT — 2026-07-14 onboarding + desktop shell + Intelligence consistency (user report)

Source requirements: `docs/raw/requirement-bugs-2026-07-14-onboarding-shell-intelligence.md` + `docs/raw/requirement-bugs-2026-07-14-actionable-shell-second-brain.md`. New direct shell/authority/Relationship work is ~24–42 days including Second Brain prototype. Adjacent pull-ins A/B/C/E from bug sweep are ~1.75–2.75 days, below 30% cap. Resume Avatar+Commons batch only after direct interrupt items clear.

**HARD NEXT-SESSION START GATE — DO NOT SKIP:** begin here, execute in the numbered order below, and do not resume the completed H2 security roadmap, repo cleanup, generic bug backlog, later Avatar work, or CM2+ while any item in this INTERRUPT or Avatar foundation/onboarding + CM0–CM1 remains open. The reported defects are acceptance criteria of the Avatar+Commons prototype, not a later polish batch. First runtime action next session = reproduce and test **INTELLIGENCE-SHELL**; first desktop action = failing drag/Space/display test matrix for **COMPANION-MOBILITY**. A session that only audits, plans, or works an unrelated roadmap item has not followed the cursor.

- [ ] **1A — REMOVE-TOOLS / INTELLIGENCE-SHELL** `[root-cause]` — remove visible Tools toggle/page/routes/copy; classify every legacy entry as Module, Agent-owned Skill, Integration, or internal Engine; Automations/Agents/Integrations routable Pages with standard toolbar; no compatibility display alias → UI rules §2/§4b/§8 + VOCAB2/VOCAB6 + BUGS report
- [ ] **1B — AUTOMATIONS-VOCAB** `[root-cause]` — **Automations** in UI, code, API, schema, Events, and tests; time-boxed compatibility reads only; remove stale identifiers/routes/toasts and compatibility writes → `docs/raw/vocabulary-code-migration-plan-2026-07-14.md` VOCAB2 + `docs/BUGS.md` R-020 tail
- [ ] **1C — STANDARD-CONTEXT-MENUS / UI-RULES-1** — shared column/toggle menu across all Modules: DB-backed Add page/Remove page eligibility + rename/edit/type/Smartfill/filter/sort/group/calculate/lock/hide/add/duplicate/delete; dependency preview, undo, permission-aware states, keyboard access; prove on DealPilot + two unrelated Modules → `docs/raw/ui-architecture-rules-2026-07.md` §5a
- [ ] **1D — AGENT-ONLY-SKILLS** `[root-cause]` — remove Skills toggle/direct-run UI; nest Skills under each Agent; require Agent actor + closed allowlist in API/authority/Run/Event; Humans/Automations request an Agent and Automation records selected Agent; migrate tests and reject non-Agent invocation → UI rules §4b + VOCAB2/VOCAB6 + BRDs
- [ ] **1E — SYMMETRIC-SHELL-PANELS** `[root-cause]` — one shared expand/collapse/extend component + state contract for left Sidebar/right Chat Panel; mirrored inner-edge resize, persistent width, keyboard/ARIA, responsive collision; desktop + 375px evidence → UI rules §5b
- [ ] **1F — CLICKABLE-MODULES / ACTIONABILITY** `[root-cause]` — every installed Module from manifest-backed registry appears in left nav and opens Module Detail with Pages, Agents+Skills, Automations, Integrations, Files, Runs, settings; remove hardcoded route maps; audit every interactive-looking item for real detail/edit/filter/explanation/governed Action → UI rules §3a/§4b/§5c
- [ ] **1G — RELATIONSHIP-SIGNALS / MEMORY-ONLY** `[root-cause]` — remove global Knowledge routes/copy; move People/Communities into Relationship; build Signals/People/Communities routed toggles; Signal = Event storage + ≥1 Person/Community participant Relation + reason + safe Action; deep-link migration → Relationship RM0 + VOCAB4–VOCAB6
- [ ] **1H — SECOND-BRAIN-GRAPH** `[root-cause]` — below Modules, real cross-Module graph over permitted Records/Relations/Events/Files/Agents; Module/type/time/Person/Community filters, provenance/evidence/backlinks, source navigation, governed Actions, permission pruning, virtualization + accessible list fallback; no static data → UI rules §5c + Relationship RM6
- [ ] **1I — SHELL-EASY-WINS** `[same-surface]` `[easy-win]` — wire existing People/Communities reads during route move; delete duplicate hardcoded route registries; capability-derived CoS greeting; remove orphan legacy routes/pin affordances after classification (~1.75–2.75d) → bug-sweep 2026-07-14
- [ ] **2 — ONBOARDING-CLARITY / AV1** `[root-cause]` — replace the blueprint-centric questionnaire with one trust-first Onboarding flow; every remaining question states why it is asked and its immediate consequence; no unexplained internal vocabulary; add public-role-model question → governed cited Learning Agent research → approval-gated Skill/Automation recommendations; live usability evidence → `docs/raw/egg-commons-feature-roadmap-2026-07.md` §1.2/AV1 + `docs/BUGS.md` 2026-07-14 onboarding report
- [ ] **2B — PROGRESSIVE-REFLECTION / EG3** — day-7 favorite-qualities question + configurable periodic behavioral-learning prompts; explain why, skip/snooze/pause, inspect/correct/delete learned Memories; every learning linked to visible value change; no diagnosis/covert profiling → `docs/raw/egg-commons-feature-roadmap-2026-07.md` §1.2/EG3
- [ ] **3A — COMPANION-MOBILITY / AV0** `[root-cause]` — draggable persistent Avatar overlay; active Space/fullscreen behavior; display/Space/topology reconciliation (attach/detach, extended displays); real-device matrix → `docs/raw/desktop-companion-agent-roadmap-2026-07.md`
- [ ] **3B — DESKTOP-CHROME / EG0** `[root-cause]` — move native close/minimize/zoom controls into the sidebar header in the supplied-reference pattern, preserving window drag/accessibility and non-desktop fallback → `docs/BUGS.md` 2026-07-14 desktop chrome report
- [ ] **ONBOARDING-REENTRY** `[same-surface]` `[easy-win]` — Settings → Organization re-run/reset entry while onboarding is open for changes → `docs/BUGS.md` 2026-07-07 manual re-entry
- [ ] **ONBOARDING-DIALOG-WARNING** `[same-surface]` `[easy-win]` — clear the Radix ref warning during the onboarding component pass → `docs/BUGS.md` 2026-07-07 Dialog warning
- [ ] **MODULE-GATED-SURFACES** `[same-surface]` — remove hardcoded DealPilot/JobPilot/Helpdesk shell presence; derive visible surfaces from available Module state and migrate former package identifiers in code and persisted data without display aliases → `docs/BUGS.md` 2026-07-07 hardcoded packages
- [ ] **ERROR-COPY-VOCAB** `[same-surface]` `[easy-win]` — scrub the server error-string tail to current user vocabulary, including Automation → `docs/BUGS.md` 2026-07-07 API error strings

## ⚠ REALIGNED 2026-07-13; vocabulary updated 2026-07-14 — Avatar+Commons prototype FIRST, then repo/code-vocabulary cleanup, then bugs, rest after
**Standing pre-flight for every run: `git fetch && git pull` (or merge origin/main) BEFORE planned implementation — the developer pushes work in parallel.** Security H2 is merged. Go-forward priority: Avatar+Commons prototype, then repo/code-vocabulary cleanup.

## NOW — Batch 1: Avatar + Commons PROTOTYPE → `docs/raw/egg-commons-feature-roadmap-2026-07.md` (legacy filename; Avatar foundation/onboarding + CM0–CM1) · UI rules: `docs/raw/ui-architecture-rules-2026-07.md`

- [ ] **UI-RULES-1 — FIRST TASK NEXT RUN (AP-011): align apps/web to the UI architecture rules** → `docs/raw/ui-architecture-rules-2026-07.md` §Alignment audit — toggle-pages, landing-section + sections layout, lists, sub-module nav, Form view, Control Panel → 3-dots, Files section + `~/Documents/Bridge/<Organization>/` tree
  - [x] 2026-07-14 — inventory + toggle/list/sub-module target map → `docs/raw/ui-architecture-alignment-audit-2026-07.md`
<<<<<<< HEAD
  - [x] 2026-07-14 — retire dead Control Panel toolbar slot; put Initiative Control Panel in page 3-dots; deep-link Initiative page/view query state
  - [x] 2026-07-15 — Form registered as a standard DataView with metadata-driven typed fields and an insert-hook contract
  - [ ] Remaining — bind Form direct-insert/process-parity handlers · route-backed seed toggles · sub-module nav · three-page section alignment · artifact tree/index/watcher/CoS grouping (macOS validation explicitly deferred)
- [ ] EG0 — Egg shell foundation: crates + hotkey + keychain/CSP posture → egg-commons roadmap §EG0
- [ ] EG1 — onboarding v2 (OnboardingProfile → CoS prompt, permission theater, governed live-demo beat) → §EG1
- [ ] CM0 — wire the Commons registry (commons.* tRPC exists, nothing consumes it — biggest gap) → §CM0
  - [x] 2026-07-15 — `CommonsRegistry` wired into API composition; `commons.list/get/getVersion/installPropose/publishBuiltins` tRPC + Registry browser surface
  - [ ] Remaining — browser evidence for install flow · Learning Agent similarity reads · slice-wide eval/provenance/cost gates
=======
  - [x] 2026-07-14 — retired the dead toolbar Control Panel slot; moved the legacy Initiative Control Panel to page 3-dots; added page/view query deep links
  - [ ] Remaining — route-backed seed toggles · Form registry/write parity · sub-module nav · three-page section alignment · File tree/index/watcher/CoS grouping (macOS validation explicitly deferred)
- [ ] AV0 — Avatar shell foundation: crates + hotkey + keychain/CSP posture; draggable/multi-Space overlay → roadmap legacy §EG0
- [ ] AV1 — Onboarding (not staged lifecycle ceremony): OnboardingProfile → CoS prompt, permission theater, governed live-demo beat, Avatar ready state → roadmap legacy §EG1
- [ ] CM0 — wire the Commons registry (`CommonsRegistry` port + HTTP client exist; `commons.*` tRPC/app consumption is absent — biggest gap) → §CM0
>>>>>>> origin/main
- [ ] CM1 — supply-chain trust (signing, content-hash pins, publisher verify, 8-point scan) — BEFORE any corpus ingest → §CM1
- [ ] **DP0–DP1 follow-on — Deal/Source/Thesis relational cluster**: three sibling DB-backed toggle pages; Deal↔Source, Deal↔Thesis, Source↔Thesis many-to-many; entity-owned fields + CredentialBroker refs; thesis changes trigger source discovery, source changes trigger deal discovery, link changes trigger explained fit rescoring → `docs/raw/dealpilot-module-plan-2026-07.md` §5–§6

### User-directed parallel domain foundations (2026-07-15; no batch reorder, no slice marked DONE)
- JobPilot JP1 partial — JSON Resume contract, deterministic multi-source master-profile compile/dedupe, NeedsHuman conflicts, human-approval guard. Real-document ingestion/eval + UI remain.
- DealPilot DP0 partial — canonical Deal shell/stages, deterministic transitions, Summary/Profile/Documents/Activity projections, table/board metadata. Persistent store/API + browser shell remain.

## Batch 2 — Repo cleanup: duplicates + deprecated data → `docs/raw/repo-restructure-egg-commons-2026-07.md`

- [ ] P1 — kill duplicate prototype/Tools copies (⚠ prototype-archive step needs its own APPROVALS row — PII + wrangler deploy source)
- [ ] Deprecated-data sweep: superseded docs marked in frontmatter, dead code paths, stale `dummy_` instances per `docs/dummy.md`
- [ ] P2 — `platform/capabilities/` split + manifest-driven built-ins (pull in only if cheap after P1)
- [ ] **VOCAB0–VOCAB5 — full code/schema/API vocabulary migration (not display aliases)** → `docs/raw/vocabulary-code-migration-plan-2026-07-14.md`: CI guard+inventory → Avatar/Onboarding → Automation/Engine → Organization/Module/Record/Relation → Event/Result/File → Relationship Module consolidation. Backfills, compatibility deletion, RLS/contracts/browser proof required.
- [ ] **RELATIONSHIP-RM0–RM6 alignment** — People/Communities/Relations toggles; Interactions/Introductions/Helpdesk/Sources/Automations sub-modules; standard toolbar/context menu/Files; shared Record/Relation/Event APIs → `docs/raw/relationship-module-plan-2026-07.md`
- [ ] **RUNTIME-TAINT RT0–RT4 (long-term root gap)** — runtime label+lattice → end-to-end propagation → source/sink instrumentation → quarantine/policy enforcement → backfill/trace/compat removal; high-autonomy research/MCP/ambient gated at RT3 → `docs/raw/learning-agent-roadmap-2026-07.md` §6 + `docs/wiki/roadmap.md`

## Batch 3 — Bug fixes → `docs/BUGS.md` (29 heading-level OPEN; INTERRUPT items above take precedence)

- [x] 2026-07-13 — Reconcile + merge `origin/manishsbhoopalam8498-security-p0-hardening` (AP-012) — SEC-1/2/3 + XP-1 verified on that branch and merged
- [x] 2026-07-13 — SEC-1 — auth enforced by default (kill pilot-user fallback, `apps/api/src/identity.ts:84-91`) → mutation-gated `requireAuthOnMutation` middleware, ADR-057
- [x] 2026-07-13 — SEC-2 — CORS allowlist + rate limiting on the API → verifier-tied fail-closed CORS + `@fastify/rate-limit`, ADR-057
- [x] 2026-07-13 — SEC-3 — dependency bumps (drizzle-orm, react-router HIGH advisories) + `pnpm audit` CI gate, ADR-058
- [x] 2026-07-10 — SEC-4 — Tauri shell CSP (was `csp: null`, now a real policy — see BUGS.md)
- [x] 2026-07-13 — XP-1 — cross-OS compile (cfg-gate Apple crates so Linux/Windows build), ADR-059 — ⚠ CI-green DONE-WHEN (all 3 OSes) still unverified; the new `desktop` 3-OS matrix job hasn't run yet, first CI run on this reconciled main is the remaining evidence
- [ ] Work remaining `docs/BUGS.md` OPEN P0s in severity order — SEC-5 (RLS-as-code) · SEC-6 (workspace membership) · SEC-7 (Recon SSRF) now DONE via the security-roadmap merge (AP-014; ADR-061/062/063); other OPEN P0s remain

## Batch 4 — Rest of implementation — DONE via the security-roadmap merge (PR #11→#12, 2026-07-14)

- [x] Testing P0 (pre-pilot gate) → `docs/raw/testing-strategy.md` §P0 — done as security-roadmap Batch 2 (AP-013): decide()/matchOne/hasExternal already-green + OAuth-refresh + router-decide tests + per-package `node --test` coverage floors (NOT vitest)
- [x] Measurement M2 → `docs/raw/roadmap-6month-2026-h2.md` §M2 — done as Batch 3 (AP-014): EVAL-1 Agent Quality scoring reducer + EVAL-2 EvalStore
- [x] Remaining sequencer months M3–M6 — done as Batches 4–9 (AP-015–019); see "DONE — security-first H2 roadmap" below

## DONE — security-first H2 roadmap Months 1–6 (built on the security branch; merged to main via PR #11→#12, 2026-07-14)
Full per-batch detail lives in the `AP-0xx` rows of `docs/APPROVALS.md`, the dated entries in `docs/log.md`, and the ADRs in `docs/raw/decisions-log.md`. IDs below are the canonical (post-merge) AP/ADR numbers.

- **Batch 1 — Security P0 (Month-1)** — AP-012; ADR-057/058/059. SEC-1 auth-on-mutation · SEC-2 fail-closed CORS + rate-limit · SEC-3 dep bumps + `pnpm audit` gate · XP-1 cross-OS compile. (XP-1's 3-OS CI-green DONE-WHEN awaits the first `desktop` matrix run.)
- **Batch 2 — Testing P0** — AP-013. decide() TOCTOU / matchOne tie-break / hasExternal (already-green pre-batch) + OAuth token-refresh persist + router propose/decide tests + per-package `node --test` coverage floors (NOT vitest).
- **Batch 3 — Measurement + security M2** — AP-014; ADR-060/061/062/063. EVAL-1 AQV reducer · EVAL-2 EvalStore · SEC-5 RLS-as-code (migration 0008 + prod boot guard) · SEC-6 workspace membership · SEC-7 Recon SSRF + pino redaction + dropped linkedin trust path.
- **Batch 4 — Month-3 PI-1 + MEM-1** — AP-015; ADR-064/065. Provenance/taint tagging (trustOrigin → Memory + ledger, migration 0009) · MemoryStore port + `memories` table + authority-scoped reads + capture→inspectable Memory.
- **Batch 5 — Month-3 PI-2 + PI-3** — AP-016; ADR-066/067. Structural tainted-context egress gate (`core/src/policy/taint-egress.ts`) · tool-less ContentGuard + spotlighting (local-plane adapter). Not wired into apps/api (no ingest consumer/MCP yet — by design).
- **Batch 6 — Month-4 self-improvement loop** — AP-017; ADR-068–074. EVAL-3 baseline-vs-candidate comparison · EVAL-4 LLM-judge scorer · REG-1 component registry + overlap detection · VAR-1 variance adjuster · GOV-1 governance org-health rollup.
- **Batch 7 — Month-5 AGENTS-1 + AGENTS-2** — AP-018; ADR-075–078. Foundational agents invocable as peers (information|draft, no executed variant) · onboarding-profile → CoS persona. VOCAB1 removes the legacy Avatar-style→tone coupling in code and persisted payloads.
- **Batch 8 — Month-5 XP-2 + XP-3 — INFRA-GATED (NOT done)** — ADR-084 (XP-2 honest partial: unsigned 3-OS bundle CI + a real local macOS `.dmg`; only signing/notarization is cert-gated) · ADR-085 (XP-3 confirmed blocked: no mobile/Expo app on any accessible ref). Also applied this session (Codex proposals): AP-007 (roadmap phase-mapping, ADR-083) + AP-008 (CLAUDE.md license-research rule).
- **Batch 9 — Month-6 packages / Commons / blueprint / consolidate** — AP-019; ADR-079–082. PKG-1 sandbox floor before executable logic · PKG-2 Commons supply-chain trust (ed25519 signing + verify-on-install + TLS-by-default + community-origin floor) · BLUEPRINT-1 versioned Commons-publishable manifest · CONSOLIDATE testing debt (`node --test` + coverage floors).

## Done batches (pre-realignment)
- DOCS-1 / token-efficient Month-1 (all 5 items ✔ 2026-07-09: INDEX.md, CODEMAPS/flows.md, CLAUDE.md token rules, skill scoping, this tracker) → `docs/raw/token-efficient-development-2026-07.md` §4. ⚠ open note: claude.ai-connector plugins can only be disabled in claude.ai settings.

## Resolved decisions (2026-07-09)
- **Consolidation trio → RECONCILED (ADR-044, AP-003).** Governing model: `BRIDGE_PLATFORM_RESET_HANDOFF.md` = stable brief; `docs/raw/execution-plan-2026-07.md` Tracks A–G supply the stronger lanes but execute **only behind discovery + safety gates**; `BRIDGE_PLAN_CRITIQUE_AND_EXTENDED_PLAN.md` = accepted resolution. Discovery gate re-run 2026-07-09 now **PASSES** (apps/web, capability/lifecycle.ts, PromptAssembler, workspace_definitions, package_installations, code:exec all exist — the critique's 07-07 "these don't exist" objection is stale). Remaining live gate = **safety** (sandboxing, package-import security, test strategy) before any Track executes. Tracks still not scheduled into batches until a Track is picked + its safety gate cleared via `docs/APPROVALS.md`.
- **Dummy data → SETTLED (AP-002).** No dummies unless unavoidable; unavoidable ones tracked in `docs/dummy.md`. Covers test fixtures too.

## Blocked / decisions needed (user)
- **R-028 ordering conflict → resolved by AP-010/AP-020**: Avatar+Commons prototype is Batch 1; historical multi-step naming collapses into one Onboarding flow under AV1.
- **Alternative-priority recommendation (2026-07-13, standing)**: keep AP-010 order BUT gate any prototype exposure beyond the sole user on the security branch merge (SEC-1 auth fallback) — merge `origin/manishsbhoopalam8498-security-p0-hardening` before Batch 1 work ships anywhere reachable.
- Skill-noise residue: claude.ai connector plugins can only be disabled in your claude.ai settings (see NOW batch note).

## Plan Registry — where every plan lives (nothing lost)
**Sequencer (authoritative order):** `docs/raw/roadmap-6month-2026-h2.md` (M1–M6) + mirror prompts `docs/raw/roadmap-execution-prompts-2026-h2.md`.
**Phase model:** `docs/wiki/roadmap.md` (P0–P6) · narrative `docs/raw/vision-pivot-living-software.md` §10 · `docs/raw/roadmap-v2-universal-commons.md` (5 agents/RAG/Commons). Pre-pivot `docs/raw/ROADMAP.md` = superseded (still holds open decisions §).
**Punch-lists:** schema v2 → `docs/wiki/decisions.md` · bugs → `docs/BUGS.md` (38 OPEN + 3 IN PROGRESS) ⟷ checkbox view `All fixes.md` · testing → `docs/raw/testing-strategy.md` · user requests → `docs/requests.md` (open: R-008, R-019, R-026, R-028, R-029, R-030).
**Consolidation trio (RECONCILED 2026-07-09, ADR-044):** `BRIDGE_PLATFORM_RESET_HANDOFF.md` = stable brief · `docs/raw/execution-plan-2026-07.md` = gated lanes (safety gate required) · `BRIDGE_PLAN_CRITIQUE_AND_EXTENDED_PLAN.md` = accepted resolution.
**UI architecture canon (AP-011, 2026-07-13):** `docs/raw/ui-architecture-rules-2026-07.md` (wiki `docs/wiki/ui-architecture.md`) — binds all page/nav/view work; UI-RULES-1 alignment audit = Batch 1 first task.
**Canon governance:** `docs/APPROVALS.md` (propose→approve ledger for locked-doc/plan-status/DONE changes) · `docs/dummy.md` (unavoidable-dummy ledger).
**Domain plans/BRDs (raw/):** `vocabulary-code-migration-plan-2026-07-14` (VOCAB0–VOCAB6) · `egg-commons-feature-roadmap-2026-07` (legacy filename; Avatar+Commons) · `relationship-module-plan-2026-07` · `brd-dealpilot-2026-07` + `dealpilot-module-plan-2026-07` · `brd-jobpilot-2026-07` + `jobpilot-module-plan-2026-07` · `learning-agent-roadmap-2026-07` (RT0–RT4 + LA0–LA6) · `governance-agent-roadmap-2026-07` · `builder-agent-roadmap-2026-07` · remaining plans in `docs/INDEX.md`.
**Avatar plan:** `zazoo-companion-avatar-roadmap-2026-07` (ADR-086; v0 shipped at `/zazoo.html`; overlay integration remains in the Avatar+Commons prototype gate; platform rename proposal AP-022 remains unapproved).
**Tools:** `Tools/recon/EXPANSION.md` (Phase 2–4 + estimators) · `Tools/Job/*` (DealPilot/JobPilot specs, feed P2/P6).
**Repo restructure:** `docs/raw/repo-restructure-egg-commons-2026-07.md` (legacy filename) — VOCAB0 guard/inventory → duplicate cleanup → Module boundary → tool convergence. Prototype archive still needs separate sign-off because PII/deploy source.
**Older checkbox plans:** `docs/superpowers/plans/2026-06-18-searcherinsights-profile-scraper.md` (open) · `2026-06-20-camera-tool.md` (⚠ predates no-dummy-data pivot — re-spec before executing).

## Last verified state
2026-07-09: docs-only session — no platform build/tests run (nothing runtime touched). `.claude/settings.json` validated with `jq`.
