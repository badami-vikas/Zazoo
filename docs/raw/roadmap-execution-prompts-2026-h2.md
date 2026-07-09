---
title: Roadmap Execution Prompts — 2026 H2 (one adaptive prompt per pointer)
type: raw
doc_kind: plan
status: draft
companions: [roadmap-6month-2026-h2.md]
related_wiki: roadmap.md
updated: 2026-07-08
tags: [roadmap, prompts, execution, agents]
---

# Roadmap Execution Prompts — 2026 H2

One ready-to-run agent prompt per pointer in [roadmap-6month-2026-h2.md](roadmap-6month-2026-h2.md).
Each is **adaptive by construction**: it opens with a `STATE CHECK` that inspects what's already
true, then branches (skip / continue-from / do-fresh) so the same prompt stays correct as work
lands — while still stating the **guiding direction** so the agent doesn't lose the intent.

## How to run these
- Paste one prompt into a fresh Bridge/Claude Code session (or dispatch as a subagent with
  `isolation:"worktree"` for write-capable parallel work).
- Every prompt inherits these **standing invariants** (don't repeat them per-run, but they always
  apply): ports-and-adapters; all mutation through the Universal Action Pipeline; agents draft →
  humans approve (except the user's auto-mode allowlist); local-first (private data never crosses
  the gate); build-the-governance-moat / adopt-behind-port everything else; kernel vocab discipline;
  no new dummy data; file bugs in `docs/BUGS.md` on sight; new/changed raw → update wiki + append
  `docs/log.md`; verify with real evidence before claiming done (`turbo run build`/`test`).
- The `STATE CHECK → BRANCH` pattern is the "dynamic/adaptive" mechanism: the agent adapts to
  reality instead of assuming a clean slate.

---

## MONTH 1 — Identity, gate integrity, build matrix

### SEC-1 — Enforce authentication
> **Direction:** every mutating tRPC procedure must require a verified identity; kill the silent
> pilot-user fallback in any persistent/prod deploy.
> **STATE CHECK:** read `apps/api/src/identity.ts`, `context.ts`, `router.ts`, `server.ts`. Determine
> today whether (a) a `protectedProcedure` exists, (b) `resolve()` still falls back to pilot when no
> JWT verifier is configured, (c) which procedures mutate.
> **BRANCH:** if `protectedProcedure` already enforces verified identity on all mutations → verify with
> a test that an unauthenticated `action.propose` is rejected, then STOP and report. If partial →
> extend to the uncovered procedures only. If absent → implement: add a `protectedProcedure` that
> throws `UNAUTHORIZED` when `identityResolver.verifying === false` AND (`NODE_ENV==='production'` OR
> `DATABASE_URL` set); apply it to every mutation; keep the pilot fallback ONLY for pure in-memory dev.
> **DONE WHEN:** an automated test proves unauthenticated mutation is rejected under a configured
> verifier; boot logs the verifier state. Cite the test. If the JWT verification design is ambiguous,
> propose 2 options and pick one, don't block.

### SEC-2 — Fail-closed CORS + rate limiting
> **Direction:** permissive CORS and unbounded request rates must not coincide with the pilot-fallback.
> **STATE CHECK:** read `server.ts` `corsOriginConfig()`; grep for `@fastify/rate-limit`/`helmet`.
> **BRANCH:** if rate-limit already registered → tighten per-route caps only. Otherwise install
> `@fastify/rate-limit` (global + tighter caps on `action.propose`, `onboarding.verifyPhoneOtp`, and
> any outbound-network procedure). Change `corsOriginConfig()` so permissive origin is gated on "is a
> real verifier configured", not just `NODE_ENV`.
> **DONE WHEN:** a burst test trips the limiter; CORS is restrictive whenever a verifier is configured.

### SEC-3 — Dependency bumps + CI audit gate
> **Direction:** remove the known-vulnerable `drizzle-orm`/`react-router` versions and make audit a
> permanent gate.
> **STATE CHECK:** run `pnpm audit --prod --audit-level=high` in `platform/`; read the current pinned
> versions in `packages/db/package.json` and `apps/web/package.json`.
> **BRANCH:** bump only what's still flagged (`drizzle-orm ≥0.45.2`, `react-router ≥7.15.0`); if already
> clean, just add the CI gate. Run the full build+test after bumping; fix any breaking API changes.
> **DONE WHEN:** audit is clean AND the gate is wired into CI; build+test green. Report the diff.

### SEC-4 — Tauri CSP
> **Direction:** replace `csp:null` with an explicit policy tuned to real dev/prod origins.
> **STATE CHECK:** read `apps/desktop/src-tauri/tauri.conf.json`; identify the actual connect/script
> origins the app uses (the injected `__BRIDGE_API_URL__`, 127.0.0.1 sidecar).
> **BRANCH:** if a real CSP is already set → validate it isn't overly permissive, else STOP. Otherwise
> set `default-src 'self'; connect-src 'self' http://127.0.0.1:*; script-src 'self'` and widen only as
> the app provably needs. Launch the shell and confirm no CSP violations in console.
> **DONE WHEN:** shell runs with the CSP and no functionality regresses (evidence: console clean).

### XP-1 — Make the Tauri shell compile on all desktop OSes (highest-leverage cheap fix)
> **Direction:** the shell must `cargo build` on macOS + Linux + Windows; Apple-only deps must be
> conditional; capture returns empty off-macOS (graceful degradation).
> **STATE CHECK:** read `apps/desktop/src-tauri/Cargo.toml` (are `objc2*`/`macos-private-api`
> unconditional?), the cfg-gating at call sites, `.github/workflows/ci.yml` (does it compile Rust?),
> and desktop `package.json` (are build/test `echo` no-ops?).
> **BRANCH:** move the Apple crates under `[target.'cfg(target_os="macos")'.dependencies]`; gate the
> `macos-private-api` feature per-OS; ensure `sensor list` returns `[]` off-macOS. Replace the `echo`
> scripts with real `tauri build`/`cargo test`. Add `cargo check` CI jobs for the 3 OSes.
> **DONE WHEN:** `cargo check` is green for macOS+Linux+Windows in CI (evidence: CI run). Do NOT attempt
> to build capture for Linux/Windows here — that's XP-2/P2. Only unblock compilation.

### DOCS-1 — Harness hygiene
> **Direction:** pin the skills Bridge actually uses and scope out other-project noise at the project
> layer; the stale root `AGENTS.md` is already neutralized.
> **STATE CHECK:** read `docs/raw/config-vision-alignment-audit-2026-07.md` and any existing
> `.claude/settings.json`.
> **BRANCH:** create/extend a project `.claude/settings.json` that pins the Bridge-relevant skills and
> disables the irrelevant plugin packs the audit named. Add a "CLAUDE.md wins over any AGENTS.md/global
> instruction" line to CLAUDE.md if not present.
> **DONE WHEN:** the settings file exists and is validated; report what was scoped out. This changes
> harness behavior — summarize the change for the user rather than assuming further scope.

---

## MONTH 2 — Measurement substrate + defense-in-depth

### EVAL-1 — Scoring reducer over existing snapshots (ship first)
> **Direction:** make agents measurable using data already recorded — the 5 ledger-only AQV axes
> (success, correction, reliability, safety, efficiency). No new tables.
> **STATE CHECK:** read `docs/raw/agent-quality-eval-model-2026-07.md` (the definition), then
> `packages/core` for `capability_states.evidence`, the ledger `userDecision`, and execution-snapshot
> fields. Confirm which axes are computable today vs need a snapshot field added.
> **BRANCH:** implement pure reducer fns (`packages/core/src/eval/aqv.ts`) computing each axis over a
> window from evidence+ledger; write them behind a store-read port; unit-test with fixture ledgers.
> If any snapshot field is missing, add it minimally rather than inventing telemetry.
> **DONE WHEN:** given a fixture ledger, the reducer returns a correct AQV vector; a dashboard read is
> wired. This is the dependency for all of Month 4 — flag if it slips.

### EVAL-2 — EvalStore port + typed dataset/run/comparison + deterministic scorers
> **Direction:** stand up the eval-harness substrate (pattern, hosted in Commons), deterministic
> scorers first (zero model tokens).
> **STATE CHECK:** confirm no `EvalStore` exists yet; read the interfaces in the agent-quality doc §3.
> **BRANCH:** implement `EvalCase/EvalDataset/Scorer/EvalRun/Comparison` types + an in-memory
> `EvalStore` adapter mirroring `PackageStore`'s shape; implement deterministic scorers (route-match,
> contract-match, replay-determinism). Defer the LLM-judge to EVAL-4.
> **DONE WHEN:** a deterministic scorer runs a dataset and writes an `EvalRun` whose aggregate lands in
> `capability_states.evidence`.

### SEC-5 — RLS as code
> **Direction:** database-level row security must exist and be reviewable, not just app-layer filters.
> **STATE CHECK:** grep `packages/db/migrations/*.sql` for `ROW LEVEL SECURITY`/`CREATE POLICY`; check
> whether tables report `isRLSEnabled:false`; read `client.ts`'s role assumptions.
> **BRANCH:** if RLS policies exist → verify they match the tenancy/visibility model, else STOP.
> Otherwise author the policy SQL into migrations (tenant = `workspace_id`, visibility =
> `private|team|workspace`) AND add a boot assertion that fails if the app role has `bypassrls`/superuser
> in prod. Test with two synthetic tenants.
> **DONE WHEN:** a cross-tenant read is denied at the DB layer in a test.

### SEC-6 — Membership checks
> **Direction:** every workspace-scoped procedure checks caller membership, not just pilot-workspace-id.
> **STATE CHECK:** read `router.ts` workspace procedures (`inviteMember`/`listMembers`/`create`/…) and
> `workspace-store.ts`.
> **BRANCH:** add `identity.id ∈ members(workspaceId)` to each; keep `assertPilotWorkspace` as a second
> layer. Test that a non-member is refused.
> **DONE WHEN:** non-member invite/list is rejected in a test (ahead of multi-tenancy).

### SEC-7 — SSRF denylist, log redaction, verification-method proof
> **Direction:** close the three medium findings (Recon SSRF, unredacted logs, client-asserted linkedin).
> **STATE CHECK:** read `Tools/recon/lib/{browser,recon}.ts` (outbound fetch on user-influenced hosts),
> `server.ts` logger config, `router.ts:1149-1181` (verification method).
> **BRANCH:** add an RFC1918/loopback/link-local/metadata denylist before any user-influenced outbound
> fetch; add Fastify `redact` for `req.body.phone`/`code`/`Authorization`; either wire a real
> LinkedIn OAuth proof or drop the `linkedin` enum from the trust-bearing path (tag dummy phone-OTP
> results `verificationSource:"dummy"`).
> **DONE WHEN:** SSRF test blocks a metadata-IP fetch; logs show redaction; verification method can't be
> spoofed into a trust signal.

---

## MONTH 3 — Prompt-injection defense v1 + Memory primitive

### PI-1 — Provenance / taint tagging (the highest-leverage security move)
> **Direction:** every ingested artifact carries a `trust_origin` tag from the ingestion edge through
> the ledger; this is the primitive every other injection defense reads.
> **STATE CHECK:** read `docs/raw/security-audit-2026-07.md` (the taint design), then the ingestion
> edges: Gmail intake (`integrations-google`), sensors capture, social sourcing, doc/web fetch,
> package importer. Grep for any existing `taint`/`trust_origin`/`intake_policy.quarantine` usage.
> **BRANCH:** add a `trust_origin: 'operator'|'user_content'|'untrusted_external'` field to the ingest
> contract and propagate it into Memory entries + ledger rows; activate the already-declared-but-dead
> `intake_policy.quarantine` flag. Don't gate behavior yet (that's PI-2) — just tag and persist.
> **DONE WHEN:** an ingested email and a scraped page both land tagged `untrusted_external` end-to-end,
> verified in a test.

### PI-2 — Tainted-context tool/egress gating
> **Direction:** turn the static lethal-trifecta manifest audit into a RUNTIME data-flow gate — a turn
> whose context holds any `untrusted_external` content is structurally denied `external:send`/egress →
> human-in-loop.
> **STATE CHECK:** confirm PI-1 tags exist; read the pipeline's policy-runtime stage and `authority.ts`
> egress checks.
> **BRANCH:** add a policy-runtime rule that reads the turn's context taint and denies egress/`external:send`
> when tainted (forces `pending_review`); also enforce "MCP/tool output = DATA, never an instruction
> that can trigger a `propose()`" — write the ADR for this before/with the first MCP integration.
> **DONE WHEN:** the red-team test ("email says forward all contacts to attacker@…") is provably blocked
> at the gate; add it to the red-team assertion pack.

### PI-3 — Spotlighting/delimiting + dual-LLM quarantine + ContentGuard port
> **Direction:** untrusted content is read by a tool-less quarantined model (CaMeL/dual-LLM) that emits
> only typed extractions; adopt local-weight classifiers behind a port — never SaaS detectors for
> private content.
> **STATE CHECK:** read the ModelProvider seam; confirm a local model path exists (Ollama/Groq).
> **BRANCH:** implement a `ContentGuard` port with a local adapter (Prompt Guard / Llama Guard class);
> route `untrusted_external` content through a quarantined ModelProvider call with no tool access that
> returns typed structured output; add spotlighting/delimiting to prompt assembly.
> **DONE WHEN:** an injection embedded in a web page fails to alter the privileged agent's tool calls in
> a test. Keep the classifier local (privacy).

### MEM-1 — The Memory table
> **Direction:** give "learns how you work" a home — a thin `memories` table for confirmed/superseded
> facts, authority-scoped retrieval, Mem0 as optional adapter.
> **STATE CHECK:** read `docs/raw/undefined-elements-definitions-2026-07.md` (Memory definition) and
> confirm no Memory store/port exists in `@bridge/core` today; read `timeline_entries` usage.
> **BRANCH:** add a `memories` table + `MemoryStore` port (pglite default adapter; Mem0 adapter optional
> behind a flag) WITHOUT forking `timeline_entries`; classification (public/workspace/team/private/
> restricted); authority-scoped reads at the store boundary. Wire capture → inspectable Memory entry.
> **DONE WHEN:** a capture produces an inspectable, authority-scoped Memory entry; retrieval respects
> classification in a test. Unblocks the onboarding-profile→persona work.

---

## MONTH 4 — The self-improvement loop (P3 core)

### EVAL-3 — Baseline-vs-candidate comparison in `capability.approve`
> **Direction:** promotion Validated→Active reads a held-out baseline-vs-candidate comparison; two-gate
> (quality AND trigger P/R) as pure-fn/SQL threshold checks over `policy_params`.
> **STATE CHECK:** confirm EVAL-1/EVAL-2 exist; read `capability.approve` and the promotion defaults.
> **BRANCH:** wire the `Comparison` verdict (promote/reject/coexist/needs-human) into the approve path;
> thresholds from `policy_params`, never hard-coded.
> **DONE WHEN:** a candidate that beats baseline on both gates auto-advances with a "why better" card; one
> that regresses is rejected — both shown in a test.

### EVAL-4 — LLM-judge scorer (calibrated, held-out, red-teamed)
> **Direction:** add the `quality` axis via a pinned/versioned judge model calibrated against approve/veto
> labels, with held-out enforcement and a red-team pack gating External band.
> **STATE CHECK:** confirm deterministic scorers exist; read the judge design in the agent-quality doc §2.4/§4.4.
> **BRANCH:** implement a `judge` Scorer (model pinned in the snapshot); enforce
> `authored_by_capability != candidate` on held-out selection; wire the red-team assertion pack.
> **DONE WHEN:** quality scores correlate with the human approve/veto subset (report the calibration).

### REG-1 — Component Registry + overlap detection
> **Direction:** ground truth for "does this already exist?" — reuse `capability_manifests` with a `kind`
> discriminator; two-tier similarity (pure-SQL structural → pgvector semantic only when inconclusive).
> **STATE CHECK:** read the Component Registry definition in the undefined-elements doc; confirm
> `capability_manifests` shape.
> **BRANCH:** add the `kind` discriminator + a structural-similarity SQL fn first; add a pgvector fallback
> only for inconclusive cases; expose a "find overlaps" query the Learning Agent uses before proposing
> a new capability.
> **DONE WHEN:** a near-duplicate capability is detected before creation in a test.

### VAR-1 — Variance Adjuster tuning algorithm
> **Direction:** "veto tunes params not code" becomes concrete — `policy_params` is the tunable space; a
> veto reason-chip → a bounded single-parameter nudge proposed as a governed diff; hard ceilings live
> outside the space.
> **STATE CHECK:** read the Variance Adjuster definition (undefined-elements #4) and current
> `policy_params` usage; confirm the tone example is the canonical instance.
> **BRANCH:** implement the update rule (`±δ` bounded to `[floor,ceil]`, off VETTED decisions only,
> proposed as a governed diff never silent); start with the tone parameter, generalize to a small param map.
> **DONE WHEN:** 3 "too casual" vetoes propose a governed `tone_threshold` nudge in a test; ceilings can't
> be crossed.

### GOV-1 — Governance Agent org-health rollup
> **Direction:** make "monitors org health" computable — autonomy-pressure, trust-debt, approval-load,
> violation-trend; map minor/moderate/major approval bands to risk×origin.
> **STATE CHECK:** read the org-health metrics in the agent-quality doc §7; confirm the evidence fields.
> **BRANCH:** implement the rollup as SQL/pure-fn views over evidence; define the minor/moderate/major
> mapping (minor = 2 lowest risk bands AND built-in/template origin) and wire Governance Agent
> auto-approve to `minor` only.
> **DONE WHEN:** the rollup renders for a workspace; Governance Agent auto-approves only `minor` in a test.

---

## MONTH 5 — Cross-platform reach + the 5 agents

### XP-2 — Installers + capture ports (Linux/Windows)
> **Direction:** per-OS installers + signing; port `apps`/`clipboard` capture to win32 + X11 (degrade on
> Wayland); QA the overlay across window systems.
> **STATE CHECK:** confirm XP-1 landed (compiles everywhere); read `tauri.conf.json` `bundle` (active?),
> the capture providers, overlay.rs.
> **BRANCH:** enable per-OS bundles (dmg / appimage+deb / nsis+msi); add signing/notarization; implement
> win32 UIAutomation + Linux AT-SPI `apps` capture, honest Wayland degradation; document webkit2gtk-4.1 +
> WebView2 prerequisites.
> **DONE WHEN:** signed installers build in CI for 3 OSes; capture works on win32+X11 with honest Wayland
> fallback (evidence per OS).

### XP-3 — Rebase mobile client to mainline
> **Direction:** bring the stranded Expo client onto mainline and make it build for iOS + Android in CI.
> **STATE CHECK:** locate the mobile app (branch `claude/heuristic-booth-f8f5da`); check for `.npmrc`,
> `eas.json`, Node pin, permissions config.
> **BRANCH:** rebase/merge the package to mainline; commit `.npmrc` (node-linker=hoisted) + Node≥20 pin;
> add `eas.json`, iOS plist + Android perms + min-OS floors; wire `expo export` as headless CI verify.
> **DONE WHEN:** `expo export` passes in CI for both platforms; `<DataViews>` + approval cards confirmed at
> 375px on device/simulator.

### AGENTS-1 — The 5 permanent agents as separate invocable agents
> **Direction:** CoS + Learning/Communications/Governance/Capability-Builder become real peers (star
> topology, `@name` addressing, one governed draft per turn, no independent write) — today
> `chief-of-staff.ts` is a single node. PromptAssembler lands as the layering seam.
> **STATE CHECK:** read `chief-of-staff.ts`, `agents.ts`, the foundational-agents doc; confirm the Groq
> provider exists and the current single-node shape.
> **BRANCH:** implement each of the 4 delegates as an invocable agent behind the same governance; CoS
> routes and assembles ONE governed draft per turn; enforce no-independent-write; build the
> PromptAssembler (layered system-prompt uplift).
> **DONE WHEN:** `@learning`/`@governance` route to real peers; a turn yields exactly one governed draft;
> star topology + chain-depth cap hold in tests.

### AGENTS-2 — Onboarding-profile schema → CoS persona
> **Direction:** the stored onboarding profile becomes CoS's system prompt via PromptAssembler + the
> Memory primitive; reconcile tone-to-animal (6 art vs 14 spec).
> **STATE CHECK:** read `onboarding-profile.ts`, `agents.ts` `ANIMAL_TONE`, the foundational-agents doc;
> confirm MEM-1 landed.
> **BRANCH:** define the profile schema (as a Memory/Knowledge-family object, not ad-hoc); wire
> profile → PromptAssembler → CoS persona; reconcile the animal/tone map.
> **DONE WHEN:** onboarding a real connected account yields a personalized CoS whose tone matches the
> chosen animal (evidence: two different profiles → two different personas).

---

## MONTH 6 — Packages, Commons safety, consolidation

### PKG-1 — Package runtime hardening (sandbox before executable logic)
> **Direction:** any executable capability runs in a sandboxed isolate (SandboxProvider port, E2B/Daytona
> adapter), never the API process; extend the lethal-trifecta union check to gate sandbox caps.
> **STATE CHECK:** read `packages/core/src/package/*`; confirm no executable-logic path exists yet and no
> sandbox port exists.
> **BRANCH:** define the `SandboxProvider` port + a first adapter; require sandboxing for any executable
> capability; extend the trifecta union to gate sandbox network/fs/env caps before Active. Remove the MCP
> "exempt from sandbox by protocol" carve-out.
> **DONE WHEN:** an executable capability can only run sandboxed with gated caps in a test.

### PKG-2 — Commons supply-chain trust
> **Direction:** sign manifests (publisher key), TLS-by-default, treat community/MCP-origin as untrusted
> as `user_code` — never auto-trust at a higher tier.
> **STATE CHECK:** read `services/commons` + `commons-client.ts` + the importer; confirm no signing exists.
> **BRANCH:** add manifest signing + verification; TLS default for `COMMONS_URL`; force community-origin
> risk tier ≥ user_code; verify on publish and on install.
> **DONE WHEN:** an unsigned/altered manifest is rejected on install in a test.

### BLUEPRINT-1 — Freeze the WorkspaceBlueprint manifest
> **Direction:** `WorkspaceBlueprint` becomes a versioned Commons-publishable manifest; `compileBlueprint`
> stays pure; the LLM emits only the declarative manifest, never runtime code.
> **STATE CHECK:** read `compileBlueprint()` and the `workspace_definitions` table; confirm the blueprint
> JSONB grammar is implicit-in-code today.
> **BRANCH:** define the typed `WorkspaceBlueprint` schema (vocabulary/node_types/views/capabilities);
> version it; make it Commons-publishable; keep the compiler pure.
> **DONE WHEN:** a blueprint round-trips (publish → install → compile) and the compiler rejects a
> non-declarative payload in a test.

### CONSOLIDATE — Testing debt
> **Direction:** raise coverage on the worst/riskiest files (integrations-google ~28% fn; apps/api
> router/wiring/identity = 0 test files); wire coverage into CI.
> **STATE CHECK:** read `docs/raw/testing-strategy.md` + `docs/wiki/testing.md`; run coverage to get
> current file-by-file numbers (don't trust package averages).
> **BRANCH:** add tests to the highest-risk untested files first (the ones that held this session's P0
> bugs); wire vitest/coverage into `turbo run test` + a CI threshold gate.
> **DONE WHEN:** the three worst files have meaningful behavioral tests and CI enforces a floor; report the
> before/after file-by-file numbers.

---

## Adaptive-prompt design notes (why these stay correct over time)
- **STATE CHECK first** = the prompt reads reality before acting, so a half-done or already-done pointer
  is handled, not clobbered.
- **BRANCH** = explicit skip/continue/do-fresh, so re-running is safe (idempotent intent).
- **Direction line** = the guiding intent survives even when the tactical steps change.
- **DONE WHEN + evidence** = closes the loop against Bridge's verify-before-completion rule.
- **"if ambiguous, pick and proceed"** = keeps autonomous runs unblocked while surfacing real decisions.
