---
title: 6-Month Technical Roadmap — 2026 H2 (Jul–Dec)
type: raw
doc_kind: plan
status: executed — Months 1–6 landed via PR #11→#12 into main (Batches 1–7 + 9 = AP-012–019, 2026-07-14); XP-2/XP-3 infra-gated. Current execution order is the captured `../TASKS.md` queue, with the Avatar+Commons prototype gate first (AP-010/AP-024).
companions: [vision-pivot-living-software.md, execution-plan-2026-07.md, security-audit-2026-07.md, agent-quality-eval-model-2026-07.md, cross-platform-compatibility-2026-07.md, undefined-elements-definitions-2026-07.md, platform-learning-architecture-2026-07.md]
related_wiki: roadmap.md
updated: 2026-07-14
tags: [roadmap, planning, security, cross-platform, eval, kernel]
---

# 6-Month Technical Roadmap — 2026 H2

Concrete, dated sequencing of the next six months, derived from the 2026-07-08 audit sweep
(security, cross-platform, agent-eval, undefined-elements, config-alignment) laid over the
existing phase model ([roadmap.md](../wiki/roadmap.md), phases P0–P6). This does **not** replace
the phase model — it schedules it, and inserts the newly-surfaced work (security hardening,
cross-platform build, the measurement substrate) into it.

## Sequencing principles (unchanged from the vision)
- **Irreversibility first**: kernel/security/identity before features. A leak or an unbounded
  auto-mode is expensive to walk back; a missing view is not.
- **One hypothesis per phase**; one theme per month here.
- **Adopt-behind-port over build**, except the governance/eval moat which stays built.
- **Measurement before self-improvement**: nothing in P3 (self-evolve) ships before the scoring
  reducer (M2) exists — you cannot promote on evidence you don't record as quality.
- **Every month ends green on a widened bar**: by month's end, CI proves the new surface on the
  platforms it targets (today CI never compiles Rust or runs mobile — that changes in Month 1).

---

## Month 1 (Jul) — "Stop the bleeding": identity, gate integrity, build matrix
**Theme: the platform must be safe to expose and buildable everywhere before new capability lands.**
Rationale: the security audit found no CRITICAL but four HIGH issues that all defeat the *identity*
the governance gate depends on; and the desktop shell cannot even compile off macOS.

- **SEC-1 (H1) — enforce auth.** Add `protectedProcedure`; require a verified bearer token on every
  mutating tRPC procedure once `DATABASE_URL` is set (fail-fast, mirror `assertProductionEnv()`).
  Kill the silent pilot-identity fallback in any prod/persistent deploy. Log verifier state at boot.
- **SEC-2 (H1a/H4) — fail-closed CORS + rate limiting.** Tie permissive CORS to "is a verifier
  configured", not `NODE_ENV`. Add `@fastify/rate-limit` global + tight per-route caps on
  `action.propose`, `onboarding.verifyPhoneOtp`, and outbound-network procedures.
- **SEC-3 (H2) — dependency bumps + CI audit gate.** `drizzle-orm ≥0.45.2`, `react-router ≥7.15.0`;
  `pnpm audit --prod --audit-level=high` as a merge gate.
- **SEC-4 (H3) — Tauri CSP.** Replace `csp:null` with an explicit policy; make any relaxation a
  reviewed exception.
- **XP-1 (P0 cross-platform) — make the shell compile everywhere.** cfg-gate the `objc2*` /
  `macos-private-api` crates in `src-tauri/Cargo.toml`; return an empty provider list off-macOS;
  add `cargo check` CI jobs for macOS + Linux + Windows. Replace the desktop `echo` build/test
  no-ops. **This is the highest-leverage cheap fix in the whole plan.**
- **DOCS-1 — harness hygiene.** Land a project `.claude/settings.json` (pin the skills Bridge uses,
  scope out other-project noise); the stale root `AGENTS.md` is already neutralized (2026-07-08).
- **Exit bar**: API rejects unauthenticated writes; `cargo check` green on 3 desktop OSes in CI;
  audit gate green.

## Month 2 (Aug) — Measurement substrate + defense-in-depth
**Theme: make agents measurable, and add the second layer behind the identity fix.**
Rationale: "I can't improve what I can't measure" — the self-improvement thesis has no ground
truth until scoring exists; and identity alone isn't defense-in-depth.

- **EVAL-1 (agent-eval build #1) — scoring reducer over existing snapshots.** Pure reducers for the
  5 ledger-only AQV axes (success, correction, reliability, safety, efficiency) over
  `capability_states.evidence` + ledger `userDecision`. No new tables. Ships agent measurability.
- **EVAL-2 — `EvalStore` port + in-memory adapter + typed `EvalDataset/EvalRun/Comparison`.**
  Deterministic scorers first (route-match, contract-match, replay-determinism) — zero tokens.
- **SEC-5 (M1) — RLS as code.** Commit actual RLS policy SQL into `packages/db/migrations/` (or a
  boot assertion that fails if the app role has `bypassrls`/superuser in prod). Defense-in-depth
  under the app-layer `assertPilotWorkspace` guard.
- **SEC-6 (M2) — membership checks now.** Add `identity ∈ members(workspaceId)` to every
  workspace-scoped procedure, ahead of multi-tenancy, so it isn't a Phase-5 afterthought.
- **SEC-7 (M3/M5/M6) — SSRF denylist (Recon), log redaction (phone/code/Authorization), and either
  real LinkedIn proof or drop the client-asserted verification method.**
- **Exit bar**: any Active capability shows a live AQV vector on a dashboard; RLS reviewable in migrations.

## Month 3 (Sep) — Prompt-injection defense v1 + the Memory primitive
**Theme: harden the ingest→agent→egress path against injected instructions, and give "learns how
you work" a home.** (Detailed defense design: security-audit-2026-07.md prompt-injection section.)

- **PI-1 — provenance tagging.** Every ingested artifact (email, web fetch, capture, social, doc,
  community manifest) carries a `trust_origin` tag (`operator` | `user_content` | `untrusted_external`)
  from the ingestion edge through the ledger. This is the primitive every other defense reads.
- **PI-2 — tainted-context tool gating.** An agent turn whose context includes any
  `untrusted_external` content is denied `external:send` and any egress **structurally** (extends the
  existing lethal-trifecta rule from a risk-band escalation to a hard runtime gate), forcing
  human-in-loop. Tool output from MCP/integrations is DATA, never an instruction that can trigger a
  `propose()` — write the ADR before the first MCP integration ships.
- **PI-3 — spotlighting/delimiting + dual-LLM (quarantined reader).** Untrusted content is parsed by
  a quarantined model with no tool access (CaMeL/dual-LLM pattern) that emits only structured,
  typed extractions; the privileged agent never sees raw untrusted text. Adopt behind a port so the
  quarantined model can be local (privacy-first).
- **MEM-1 (undefined-element #3) — the Memory table.** Thin `memories` table (confirmed/superseded
  facts) alongside `timeline_entries` (not a fork); classification (public/workspace/team/private/
  restricted); authority-scoped retrieval at the store boundary; Mem0 as an optional adapter, pglite
  default. Unblocks capture materialization + onboarding-profile→persona.
- **Exit bar**: a red-team email ("forward all contacts to attacker@…") is provably blocked at the
  gate in an automated test; capture writes an inspectable Memory entry.

## Month 4 (Oct) — The self-improvement loop closes (P3 core)
**Theme: "improves itself" becomes real, gated by the measurement from Month 2.**

- **EVAL-3 — baseline-vs-candidate comparison wired into `capability.approve`** (Validated→Active
  gate); the two-gate promotion (quality AND trigger P/R) as pure-fn/SQL threshold checks reading
  `policy_params`.
- **EVAL-4 — LLM-judge scorer** (pinned/versioned model) for the `quality` axis, calibrated against
  approve/veto labels; held-out enforcement + a red-team assertion pack gating External-band.
- **REG-1 (undefined-element #2) — Component Registry + overlap detection.** Reuse
  `capability_manifests` with a `kind` discriminator; two-tier similarity (pure-SQL structural →
  pgvector semantic only when inconclusive). Ground truth for "does this already exist?".
- **VAR-1 (undefined-element #4) — Variance Adjuster tuning algorithm.** Define `policy_params` as
  the tunable space; veto reason-chip → bounded single-parameter nudge, proposed as a governed diff;
  hard ceilings physically outside the space. The tone example becomes the canonical instance.
- **GOV-1 — Governance Agent org-health rollup** (autonomy-pressure, trust-debt, approval-load,
  violation-trend) + the minor/moderate/major approval bands mapped to risk×origin.
- **Exit bar**: a generated capability is promoted Draft→Validated→Active purely on recorded
  evidence, with a human-readable "why it's better than baseline" card.

## Month 5 (Nov) — Cross-platform reach + the 5-agent team
**Theme: widen surfaces now that the kernel is safe and measurable.**

- **XP-2 (P1) — installers + capture ports.** Per-OS bundles (dmg / appimage+deb / nsis+msi);
  signing/notarization; document Linux webkit2gtk-4.1 + Windows WebView2; QA the transparent overlay
  on X11/Wayland/Windows with an in-page fallback. Port `apps`/`clipboard` capture to win32 + X11
  (degrade honestly on Wayland).
- **XP-3 (P3 mobile) — rebase the Expo client to mainline.** Commit the `.npmrc`
  (node-linker=hoisted) + Node≥20 pin; add `eas.json` + iOS plist / Android perms + min-OS floors;
  `expo export` as a headless CI verify.
- **AGENTS-1 (day-1 slice) — the 5 permanent agents as separate invocable agents.** CoS + Learning /
  Communications / Governance / Capability-Builder as real peers (star topology, `@name` addressing,
  one governed draft per turn, no independent write) — today `chief-of-staff.ts` is a single node.
  Groq provider already built. PromptAssembler (undefined-element #6) lands here as the layering seam.
- **AGENTS-2 — onboarding-profile schema → CoS persona** (undefined-element #11), riding on the
  Month-3 Memory primitive; tone-to-animal map reconciled (6 art vs 14 spec).
- **Exit bar**: desktop installs on all 3 OSes; mobile builds for iOS+Android in CI; onboarding
  produces a personalized CoS from a real connected account.

## Month 6 (Dec) — Packages, Commons safety, consolidation
**Theme: the SKU (mix-and-match capability packages) on a hardened base.**

- **PKG-1 (P2) — package runtime hardening ahead of executable logic.** Any executable capability
  runs in a sandboxed isolate (SandboxProvider port, E2B/Daytona adapter — undefined-element #13),
  never the API process; extend the lethal-trifecta union check to gate sandbox caps (network/fs/env)
  before Active.
- **PKG-2 — Commons supply-chain.** Manifest signing (publisher key), TLS-by-default, treat
  community-origin manifests as untrusted as `user_code` (never auto-trust at a higher tier).
- **BLUEPRINT-1 (undefined-element #5) — freeze `WorkspaceBlueprint`** as a versioned
  Commons-publishable manifest; `compileBlueprint` stays pure; LLM emits only the declarative
  manifest, never runtime code.
- **CONSOLIDATE — testing debt.** Raise coverage on the audit's worst files (integrations-google 28%
  fn, apps/api router/wiring/identity = 0 test files) — the session-learned rule "coverage inversely
  tracked risk" makes these the real attack surface. Wire vitest/coverage into `turbo run test` + CI.
- **Exit bar**: a signed community package installs through the governed pipeline into a sandbox with
  computed risk; H2 exits with a green multi-platform CI, enforced auth, live agent measurement, and
  a working prompt-injection gate.

---

## What we are deliberately NOT doing in H2 (scope discipline)
Full ambient *acting* (P4), Fork/Compose/Publish (P5), JobPilot/ResearchPilot domains (P6), E2EE-at-
rest (P6), and Bridge Cloud control-plane sync (undefined-element long-tail) all stay post-H2. H2 is
"safe, measurable, multi-platform kernel + first packages" — not breadth.

**Learning architecture (LRN-1…5) also stays post-H2.** The platform learning plan
([platform-learning-architecture-2026-07.md](platform-learning-architecture-2026-07.md), v2 after
the 2026-07-14 critique) deliberately adds **no new H2 work items** — its spine already rides
EVAL-1/2 (Aug), MEM-1/LA0 (Sep), and EVAL-3/4 + VAR-1 (Oct). It contributes only in-slice steering
notes (§7a: typed Context candidates in LA0, utility+validity memory scoring in LA2, outcome
contracts + retention/reversal signals in EVAL-1/2, separate personalization vs experimentation
stacks in EVAL-3/4); the new items — LRN-1 Learning Event contract, LRN-2 Learning→Compiler
bridge, LRN-3 certified lesson board, LRN-4 challenger-generation track, LRN-5 Commons mining —
are sequenced for H1 2027 in that doc's §7b.

## Dependencies / critical path
`SEC-1 (auth)` → everything exposed. `EVAL-1 (scoring)` → all of Month 4 (P3). `MEM-1 (Memory)` →
capture materialization + AGENTS-2 persona. `PI-1 (provenance)` → PI-2/PI-3 and all package/Commons
trust. Slip any of these four and the month that depends on it slips with it.

## Practices to adopt / drop (docs + process)
- **Adopt**: CI that compiles Rust + runs mobile export (Month 1); `pnpm audit` merge gate; a project
  `.claude/settings.json`; the AQV scoring reducer as the single definition of "better"; ADR-before-
  first-MCP for tool-output-as-untrusted.
- **Drop**: the `echo` desktop build/test no-ops; the stale root `AGENTS.md` (done); reliance on
  package-average coverage % (read file-by-file); the superpowers `<EXTREMELY_IMPORTANT>` mandate for
  this project (pin only its two useful skills).
