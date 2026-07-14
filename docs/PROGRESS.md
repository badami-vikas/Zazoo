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

## ⚠ REALIGNED 2026-07-13 (AP-010 + AP-011) — Egg+Commons prototype FIRST, then repo cleanup, then bugs, rest after
**Standing pre-flight for every run: `git fetch && git pull` (or merge origin/main) BEFORE planned implementation — the developer pushes work in parallel.** Known now: `origin/manishsbhoopalam8498-security-p0-hardening` (2 commits, unmerged) implements old Batch-1 Security P0 (SEC-1/2/3 + XP-1) — reconcile/merge that branch instead of redoing those items.

## NOW — Batch 1: Egg + Commons PROTOTYPE → `docs/raw/egg-commons-feature-roadmap-2026-07.md` (EG0–EG1, CM0–CM1) · UI rules: `docs/raw/ui-architecture-rules-2026-07.md`

- [ ] **UI-RULES-1 — FIRST TASK NEXT RUN (AP-011): align apps/web to the UI architecture rules** → `docs/raw/ui-architecture-rules-2026-07.md` §Alignment audit — toggle-pages, landing-section + sections layout, lists, sub-module nav, Form view, Control Panel → 3-dots, artifacts section + `~/Documents/Bridge Workspace/` tree
- [ ] EG0 — Egg shell foundation: crates + hotkey + keychain/CSP posture → egg-commons roadmap §EG0
- [ ] EG1 — onboarding v2 (OnboardingProfile → CoS prompt, permission theater, governed live-demo beat) → §EG1
- [ ] CM0 — wire the Commons registry (commons.* tRPC exists, nothing consumes it — biggest gap) → §CM0
- [ ] CM1 — supply-chain trust (signing, content-hash pins, publisher verify, 8-point scan) — BEFORE any corpus ingest → §CM1

## Batch 2 — Repo cleanup: duplicates + deprecated data → `docs/raw/repo-restructure-egg-commons-2026-07.md`

- [ ] P1 — kill duplicate prototype/Tools copies (⚠ prototype-archive step needs its own APPROVALS row — PII + wrangler deploy source)
- [ ] Deprecated-data sweep: superseded docs marked in frontmatter, dead code paths, stale `dummy_` instances per `docs/dummy.md`
- [ ] P2 — `platform/capabilities/` split + manifest-driven built-ins (pull in only if cheap after P1)

## Batch 3 — Bug fixes → `docs/BUGS.md` (38 OPEN + 3 IN PROGRESS)

- [x] 2026-07-13 — Reconcile + merge `origin/manishsbhoopalam8498-security-p0-hardening` (AP-012) — SEC-1/2/3 + XP-1 verified on that branch and merged
- [x] 2026-07-13 — SEC-1 — auth enforced by default (kill pilot-user fallback, `apps/api/src/identity.ts:84-91`) → mutation-gated `requireAuthOnMutation` middleware, ADR-057
- [x] 2026-07-13 — SEC-2 — CORS allowlist + rate limiting on the API → verifier-tied fail-closed CORS + `@fastify/rate-limit`, ADR-057
- [x] 2026-07-13 — SEC-3 — dependency bumps (drizzle-orm, react-router HIGH advisories) + `pnpm audit` CI gate, ADR-058
- [x] 2026-07-10 — SEC-4 — Tauri shell CSP (was `csp: null`, now a real policy — see BUGS.md)
- [x] 2026-07-13 — XP-1 — cross-OS compile (cfg-gate Apple crates so Linux/Windows build), ADR-059 — ⚠ CI-green DONE-WHEN (all 3 OSes) still unverified; the new `desktop` 3-OS matrix job hasn't run yet, first CI run on this reconciled main is the remaining evidence
- [ ] Work remaining `docs/BUGS.md` OPEN P0s in severity order (SEC-5 RLS-as-code · SEC-6 workspace membership checks · SEC-7 Recon SSRF among them)

## Batch 4 — Rest of implementation (previous plan resumes) → old Batch 2/3 content

- [ ] Testing P0 (pre-pilot gate) → `docs/raw/testing-strategy.md` §P0: `decide()` double-approve concurrency · `matchOne` tie-break · OAuth token-refresh persistence · `router.ts` coverage · `hasExternal` idempotency · vitest+coverage in CI
- [ ] Measurement M2 → `docs/raw/roadmap-6month-2026-h2.md` §M2: EVAL-1 Agent Quality scoring reducer → EVAL-2 EvalStore
- [ ] Remaining sequencer months M3–M6 follow

## Done batches (pre-realignment)
- DOCS-1 / token-efficient Month-1 (all 5 items ✔ 2026-07-09: INDEX.md, CODEMAPS/flows.md, CLAUDE.md token rules, skill scoping, this tracker) → `docs/raw/token-efficient-development-2026-07.md` §4. ⚠ open note: claude.ai-connector plugins can only be disabled in claude.ai settings.

## Resolved decisions (2026-07-09)
- **Consolidation trio → RECONCILED (ADR-044, AP-003).** Governing model: `BRIDGE_PLATFORM_RESET_HANDOFF.md` = stable brief; `docs/raw/execution-plan-2026-07.md` Tracks A–G supply the stronger lanes but execute **only behind discovery + safety gates**; `BRIDGE_PLAN_CRITIQUE_AND_EXTENDED_PLAN.md` = accepted resolution. Discovery gate re-run 2026-07-09 now **PASSES** (apps/web, capability/lifecycle.ts, PromptAssembler, workspace_definitions, package_installations, code:exec all exist — the critique's 07-07 "these don't exist" objection is stale). Remaining live gate = **safety** (sandboxing, package-import security, test strategy) before any Track executes. Tracks still not scheduled into batches until a Track is picked + its safety gate cleared via `docs/APPROVALS.md`.
- **Dummy data → SETTLED (AP-002).** No dummies unless unavoidable; unavoidable ones tracked in `docs/dummy.md`. Covers test fixtures too.

## Blocked / decisions needed (user)
- **R-028 ordering conflict → resolved by AP-010**: Egg+Commons prototype is now Batch 1; R-028 (Groq-backed 5-agent Day-1 onboarding) folds into EG1 onboarding v2.
- **Alternative-priority recommendation (2026-07-13, standing)**: keep AP-010 order BUT gate any prototype exposure beyond the sole user on the security branch merge (SEC-1 auth fallback) — merge `origin/manishsbhoopalam8498-security-p0-hardening` before Batch 1 work ships anywhere reachable.
- Skill-noise residue: claude.ai connector plugins can only be disabled in your claude.ai settings (see NOW batch note).

## Plan Registry — where every plan lives (nothing lost)
**Sequencer (authoritative order):** `docs/raw/roadmap-6month-2026-h2.md` (M1–M6) + mirror prompts `docs/raw/roadmap-execution-prompts-2026-h2.md`.
**Phase model:** `docs/wiki/roadmap.md` (P0–P6) · narrative `docs/raw/vision-pivot-living-software.md` §10 · `docs/raw/roadmap-v2-universal-commons.md` (5 agents/RAG/Commons). Pre-pivot `docs/raw/ROADMAP.md` = superseded (still holds open decisions §).
**Punch-lists:** schema v2 → `docs/wiki/decisions.md` · bugs → `docs/BUGS.md` (38 OPEN + 3 IN PROGRESS) ⟷ checkbox view `All fixes.md` · testing → `docs/raw/testing-strategy.md` · user requests → `docs/requests.md` (open: R-008, R-019, R-026, R-028, R-029, R-030).
**Consolidation trio (RECONCILED 2026-07-09, ADR-044):** `BRIDGE_PLATFORM_RESET_HANDOFF.md` = stable brief · `docs/raw/execution-plan-2026-07.md` = gated lanes (safety gate required) · `BRIDGE_PLAN_CRITIQUE_AND_EXTENDED_PLAN.md` = accepted resolution.
**UI architecture canon (AP-011, 2026-07-13):** `docs/raw/ui-architecture-rules-2026-07.md` (wiki `docs/wiki/ui-architecture.md`) — binds all page/nav/view work; UI-RULES-1 alignment audit = Batch 1 first task.
**Canon governance:** `docs/APPROVALS.md` (propose→approve ledger for locked-doc/plan-status/DONE changes) · `docs/dummy.md` (unavoidable-dummy ledger).
**Domain plans (raw/):** token-efficient-development (M2: symbol index, `pnpm docs:codemaps`, per-doc token estimates; M3: manifest cheat-sheet, log rotation, wiki-size CI) · **optimizations-memory-vm-dealpilot-plan** (Optimizations add-on, Hermes comparison, isolated-computer policy; proposed, not sequenced) · **dealpilot-module-plan** + **dealpilot-design-requirements** (full IA/screen/component/state brief, business coverage/exclusions, Agents/Skills/Automations, reuse-first source map) · **relationship-module-plan** + **relationship-design-requirements** (current-state audit, full IA/object design, consent/privacy, Agents/Skills/Automations, RM0–RM6) · **builder-agent-roadmap** (Capability Builder BA0–BA6: toolbelt/sandbox → workspace+capability generation → validation lane → diff approvals → evolution loop → model economy/Commons; reuse map for bolt.diy/Dyad/Budibase/Appsmith/ToolJet; STRENGTHENED 2026-07-12: per-slice exit criteria + metrics + risk register, ADR-054; proposed, refines P0–P1 tracks, no sequencer reorder) · **governance-agent-roadmap** (GA0–GA6, NEW 2026-07-12, ADR-054: kernel-decides/agent-explains; GA1 grounded identity → GA2 trust-grants+policy_params budgets → GA3 MINOR auto-approve decider identity → GA4 org-health [needs EVAL-1] → GA5 audit/provenance [must precede Commons] → GA6 schema-v2 team scale; proposed, no sequencer reorder) · **learning-agent-roadmap** (LA0–LA6, NEW 2026-07-12, ADR-054: taint-first; LA0 Memory/Mem0 primitive + injection suite → LA1 PromptAssembler [shared w/ BA0] → LA2 observation loops → LA3 research lane [SSRF first] → LA4 integration-over-build → LA5 RAG → LA6 ambient; proposed, no sequencer reorder) · **calendar-module-plan** (CAL0–CAL6, three-lens: projection/grid → governed write-back → rituals-initiatives overlay → team/shared RLS → conference/ICS+MS-Graph/CalDAV adapters → scheduling; CAL0–CAL2 shipped for Google; STRENGTHENED 2026-07-12: per-slice exits + metrics + risks, CAL4 hard-blocked on SEC-5/6, ADR-054; no sequencer reorder) · **jobpilot-module-plan** (JP0–JP6: onboarding/master-profile → Tier-1 legitimate sourcing → writer/evaluator loop → governed draft-then-approve apply → response/follow-up → interviews/learning; auto-apply reframed to governed, legitimate-source catalog + OSS leverage map from the requirement doc; JP0 anchor already shipped, roadmap P6; STRENGTHENED 2026-07-12: per-slice exits + metrics + risks, ADR-054; no sequencer reorder) · **egg-commons-feature-roadmap** (Egg EG0–EG5 shell/onboarding/companion/daily-rhythm + Commons CM0–CM5 wire-registry/supply-chain-trust/marketplace/ingestion/cloud; Clicky+Pluely code diligence + New Data corpus; proposed, no sequencer reorder) · **clean-room-capability-research-protocol** (license-limited source research/benchmark/independent implementation) · oss-commons-integration (supply-chain trust FIRST) · day1-integrations-free-apis · desktop-companion-agent-roadmap · cross-platform-compatibility · tool-standardization (Phases 0–5) · DESIGN-FIX (F1–F5) · helpdesk-plan (§6 P1–P4) · calendar-plan (P3–P6 future).
**Tools:** `Tools/recon/EXPANSION.md` (Phase 2–4 + estimators) · `Tools/Job/*` (DealPilot/JobPilot specs, feed P2/P6).
**Repo restructure (proposed 2026-07-11):** `docs/raw/repo-restructure-egg-commons-2026-07.md` — make egg/Commons boundary physical (P1 kill duplicate prototype/Tools copies · P2 `platform/capabilities/` split + manifest-driven built-ins · P3 fold tools in). P1 prototype-archive needs APPROVALS sign-off (PII + wrangler deploy source).
**Older checkbox plans:** `docs/superpowers/plans/2026-06-18-searcherinsights-profile-scraper.md` (open) · `2026-06-20-camera-tool.md` (⚠ predates no-dummy-data pivot — re-spec before executing).

## Last verified state
2026-07-09: docs-only session — no platform build/tests run (nothing runtime touched). `.claude/settings.json` validated with `jq`.
