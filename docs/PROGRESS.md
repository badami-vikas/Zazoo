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

## NOW — current batch: DOCS-1 / token-efficient Month-1 → `docs/raw/token-efficient-development-2026-07.md` §4

- [x] 2026-07-09 — `docs/INDEX.md` nav map (≤50 lines, where-does-X-live)
- [x] 2026-07-09 — `docs/CODEMAPS/flows.md`: 3 mermaid sequence diagrams (pipeline propose→decide, plane gate, ritual executor) + schema ER sketch
- [x] 2026-07-09 — standing token rules added to `CLAUDE.md`
- [x] 2026-07-09 — skill scoping: `skillOverrides: off` for 111 off-project skills in `.claude/settings.json` (from `docs/skills-diluting-project.csv`). ⚠ `.claude/` is gitignored — applied to BOTH the worktree and the main checkout's settings; it will not travel via git. ⚠ Verify next session that the noise is actually gone; claude.ai-connector plugins (brand-voice/legal/marketing/sales/finance…) may need disabling in claude.ai connector settings — a repo file can't unload those.
- [x] 2026-07-09 — this tracker (`docs/PROGRESS.md`) created; pointer added to CLAUDE.md

## Batch 1 — Security P0 (Month-1 of H2 roadmap) → `docs/raw/roadmap-6month-2026-h2.md` §M1 · runnable prompts: `docs/raw/roadmap-execution-prompts-2026-h2.md` · bug rows: `docs/BUGS.md` SEC H1–H4

- [ ] SEC-1 — auth enforced by default (kill pilot-user fallback, `apps/api/src/identity.ts:84-91`)
- [ ] SEC-2 — CORS allowlist + rate limiting on the API
- [ ] SEC-3 — dependency bumps (drizzle-orm, react-router HIGH advisories) + `pnpm audit` CI gate
- [x] 2026-07-10 — SEC-4 — Tauri shell CSP (was `csp: null`, now a real policy — see BUGS.md)
- [ ] XP-1 — cross-OS compile (cfg-gate Apple crates so Linux/Windows build) → `docs/raw/cross-platform-compatibility-2026-07.md` §2b

## Batch 2 — Testing P0 (pre-pilot gate) → `docs/raw/testing-strategy.md` §P0 · `docs/BUGS.md` P0 batch

- [ ] `decide()` double-approve concurrency test (proves the partial unique index holds)
- [ ] `matchOne` tie-break determinism test
- [ ] OAuth token-refresh persistence test
- [ ] `router.ts` test file (procedure-level coverage)
- [ ] `hasExternal` double-propose idempotency test
- [ ] Wire vitest + coverage into CI (turbo cache poisoning noted in BUGS.md)

## Batch 3 — Measurement + security M2 → `docs/raw/roadmap-6month-2026-h2.md` §M2

- [ ] EVAL-1 — Agent Quality scoring reducer (ship first) → `docs/wiki/agent-eval.md`
- [ ] EVAL-2 — EvalStore
- [ ] SEC-5 — RLS-as-code (tables currently `isRLSEnabled: false`)
- [ ] SEC-6 — membership checks on `workspace.*` procedures
- [ ] SEC-7 — Recon SSRF fix + log redaction + LinkedIn verification proof

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
**Domain plans (raw/):** token-efficient-development (M2: symbol index, `pnpm docs:codemaps`, per-doc token estimates; M3: manifest cheat-sheet, log rotation, wiki-size CI) · **optimizations-memory-vm-dealpilot-plan** (Optimizations add-on, Hermes comparison, isolated-computer policy; proposed, not sequenced) · **dealpilot-module-plan** + **dealpilot-design-requirements** (full IA/screen/component/state brief, business coverage/exclusions, Agents/Skills/Automations, reuse-first source map) · **relationship-module-plan** + **relationship-design-requirements** (current-state audit, full IA/object design, consent/privacy, Agents/Skills/Automations, RM0–RM6) · **builder-agent-roadmap** (Capability Builder BA0–BA6: toolbelt/sandbox → workspace+capability generation → validation lane → diff approvals → evolution loop → model economy/Commons; reuse map for bolt.diy/Dyad/Budibase/Appsmith/ToolJet; proposed, refines P0–P1 tracks, no sequencer reorder) · **egg-commons-feature-roadmap** (Egg EG0–EG5 shell/onboarding/companion/daily-rhythm + Commons CM0–CM5 wire-registry/supply-chain-trust/marketplace/ingestion/cloud; Clicky+Pluely code diligence + New Data corpus; proposed, no sequencer reorder) · **clean-room-capability-research-protocol** (license-limited source research/benchmark/independent implementation) · oss-commons-integration (supply-chain trust FIRST) · day1-integrations-free-apis · desktop-companion-agent-roadmap · cross-platform-compatibility · tool-standardization (Phases 0–5) · DESIGN-FIX (F1–F5) · helpdesk-plan (§6 P1–P4) · calendar-plan (P3–P6 future).
**Tools:** `Tools/recon/EXPANSION.md` (Phase 2–4 + estimators) · `Tools/Job/*` (DealPilot/JobPilot specs, feed P2/P6).
**Repo restructure (proposed 2026-07-11):** `docs/raw/repo-restructure-egg-commons-2026-07.md` — make egg/Commons boundary physical (P1 kill duplicate prototype/Tools copies · P2 `platform/capabilities/` split + manifest-driven built-ins · P3 fold tools in). P1 prototype-archive needs APPROVALS sign-off (PII + wrangler deploy source).
**Older checkbox plans:** `docs/superpowers/plans/2026-06-18-searcherinsights-profile-scraper.md` (open) · `2026-06-20-camera-tool.md` (⚠ predates no-dummy-data pivot — re-spec before executing).

## Last verified state
2026-07-09: docs-only session — no platform build/tests run (nothing runtime touched). `.claude/settings.json` validated with `jq`.
