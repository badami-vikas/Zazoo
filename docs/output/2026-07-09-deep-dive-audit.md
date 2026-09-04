# 2026-07-09 — Deep-dive audit: codebase vs docs, roadmap missing pieces

Two parallel audits: (A) code-level verification of every roadmap "done" claim, (B) roadmap
completeness/ownership audit. Verdict up front: **the kernel is more real than the docs claim in
places, and the roadmap's phases are solid — but ownership gaps and one ordering contradiction
need fixing before implementation starts.**

## A. Code vs docs — claims verified

**Confirmed real (18-point check, highlights):** Pipeline propose/decide (`pipeline.ts:130,246`,
tested) · authority formula + agent-floor DENY (`authority.ts:4,32-53`) · plane gate with
local→egress deny (`authority.ts:72,391-396`) · pglite local store · Tauri capture core is real
Rust (~300 LOC: frontmost-app + clipboard providers + overlay.rs), not stubbed · package runtime
(manifest/risk-with-trifecta/lifecycle, tested) · compileBlueprint + DataViews · chief-of-staff
chain-depth cap · 14 spirit animals · dummy purge COMPLETE (0 `dummy_` matches in platform/, CI
PII-guard job exists) · Builder toolbelt + SandboxProvider port · Pi package importer · DealPilot +
Helpdesk `bridge.package.yaml` both exist.

**Docs are STALE-PESSIMISTIC (code is ahead of docs):**
1. "In-memory package store" gap claim is FALSE — `DrizzlePackageStore` (`packages/db/src/package-store.ts`)
   is fully Postgres-backed. roadmap.md corrected this session.
2. `packages.test.ts` pagination "failure" — test at `apps/api/test/packages.test.ts:271-282` looks
   aligned with `router.ts:182` by inspection; the failure claim appears stale (verify by running once).
3. PromptAssembler "missing" reading is wrong — deliberately SUPERSEDED by `run-context.ts` (ADR-027).
4. A generic memory port DOES exist (`packages/core/src/memory/stores.ts`, 396 lines) — the
   2026-07-08 "confirmed absent" note is out of date; `onboarding-profile.ts` is the narrow slice on top.

**Docs are STALE-OPTIMISTIC (docs claim more than code has):**
5. Docling + Nango providers — ADR-026 P2 deliverables, ZERO matches anywhere in platform/. Filed in BUGS.md.
6. Desktop Rust + mobile entirely outside CI (`ci.yml` = pnpm turbo typecheck/test/build, JS-only) —
   the real capture core ships unverified. Already tracked under cross-platform bug rows.
7. FOUNDATIONAL_AGENTS registry holds 4 agents (not 5) — BY DESIGN, not a bug: CoS routes separately
   and isn't registry-resident; docs phrasing "5 permanent agents" counts CoS.
8. Recon still standalone at `Tools/recon` — confirmed, matches roadmap's honest claim.
9. Manifest license/provenance/content_hash/signature fields — confirmed MISSING (`package/types.ts:51-68`),
   and `requiresSandbox()` still exempts mcp-server (`importer.ts:88-98`). Both block OSS-Commons §0.

## B. Roadmap ownership — orphans and contradictions

**Owned somewhere:** security HIGHs (6-month plan Month 1) · Memory primitive (Month 3) · eval
harness (Months 2/4) · prompt-injection defense (Month 3) · cross-platform (Months 1/5) · Commons
service exists (`platform/services/commons/`).

**ORPHANED (no phase/month/plan doc owns them) — the real missing pieces:**
1. **Schema v2 punch-list remainder** (governance roles/delegation/ephemeral grants, touchpoint
   hierarchy, node_types+plane, versioning enforcement) — decisions.md tracks it, no month schedules it.
2. **Prototype→kernel data migration** — real user data (canonical people, ETA/WashU lists) lives in
   the old prototype+Supabase; Track C migrates the UI skin only. Risk: permanent two-system split.
3. **Commercialization** — "Packages = the SKU" has zero pricing/launch/GTM plan. (The old BRD's
   invented pricing model was removed this session; the gap is now flagged honestly in the new BRD §8.)
4. **RAG knowledge layer** — roadmap says "P1–P2", both of which are (partially) done, with no RAG built
   and no month owning it. Phase label stale.
5. **Bridge Cloud control plane** — deliberately post-H2, but P1 onboarding "on ANY surface" implies
   it earlier than owned. Unspec'd.

**Contradictions found (and resolution applied):**
- PROGRESS.md queued OSS-Commons §0 first; the 6-month plan says Month 1 = security HIGHs + XP-1
  first — and the security HIGHs were in NOBODY's next-queue. **Resolved this session: PROGRESS.md
  reordered to security-first, matching the 6-month plan.**
- ADR-033 Day-1 onboarding requires the Browser Companion extension; roadmap defers browser
  extension to P4. Day-1 bar unachievable as sequenced — logged to QUESTIONS.md territory, needs a
  user call (descope the onboarding step or pull the extension forward).
- module-evolution.md says Day-1 Module-proposal slice ships BEFORE Component Registry; 6-month plan
  puts Registry Month 4, agent team Month 5 — inverted. Needs a user call.

## Net verdict
No fabricated "done" claims found — everything marked DONE in the roadmap is real in code, and in
four places the code is ahead of the docs. The missing pieces are ownership gaps (schema v2 slot,
data migration, commercialization, RAG) and two sequencing contradictions requiring user decisions,
not engineering surprises.
