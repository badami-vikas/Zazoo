# 2026-07-14 — H2 roadmap Batch 6: Month-4, the self-improvement loop closes (P3 core)

## Task scope
Continued autopilot execution of the H2-2026 security/capability roadmap
(`docs/raw/roadmap-6month-2026-h2.md` §M4), on branch
`manishsbhoopalam8498-month-4-self-improve` (stacked on `…-security-p0-hardening` → PR #10). Month 4
is where the Capability Trust Model starts improving itself: promotion is decided by measured
baseline-vs-candidate comparison, quality gets an LLM judge, near-duplicate capabilities are caught
before creation, human vetoes tune bounded policy parameters, and the Governance Agent gets an
org-health picture plus a safe minor-only auto-approve lane.

## User requests addressed
- "continue the H2-2026 security/capability roadmap execution … pick up Month 4 (§M4), Batch 6."
- "build coupled core/db foundations yourself sequentially, then fan out genuinely-independent
  per-package edges to PARALLEL subagents."
- Governance honored: nothing marked DONE without a user-approved `docs/APPROVALS.md` row
  (AP-015 PROPOSED); PROGRESS boxes left UNTICKED.

## What was delivered (5 roadmap items)

### EVAL-3 — baseline-vs-candidate promotion gate (Validated→Active)
- **`@bridge/core/src/eval/comparison.ts`**: pure `compareRuns(baseline, candidate, gates: AqvGates)`
  (agent-quality-eval-model §4.2). A **two-gate** check — Gate A output quality AND Gate B routing
  precision/recall — with thresholds read from `policy_params`, never hard-coded. Verdict:
  `promote` (≥ baseline on BOTH gates + no safety regression + n ≥ minCases + a significant quality
  delta whose 95% CI excludes 0), `coexist` (better on one gate, worse on the other — scope to the
  clusters it wins), `needs-human` (thin/within-noise), `reject` (otherwise). `buildWhyBetterCard`
  renders the governed explanation.
- **Wired into `apps/api` `capability.approve`**: fires only when leaving `validated`, after the
  pending_review audit, before `advance()`; reads candidate + baseline-lineage latest runs from
  `evalStore`, gates from `policyParams`. `promote` → advance + card; `reject` → `BAD_REQUEST` (+card);
  `coexist`/`needs-human` → return without advancing (+card).
- **DONE-WHEN met**: a candidate beating baseline on both gates auto-advances with a why-better card;
  a regressor is rejected — `apps/api/test/capability-governance.test.ts`.

### EVAL-4 — LLM-judge quality Scorer
- **`core/src/eval/judge.ts`**: `JudgeScorer implements Scorer` (calls `ModelProvider.complete` with the
  pinned/versioned model recorded in the run snapshot; numeric-only parse clamped `[0,1]`);
  `selectHeldOut` excludes cases whose `authored_by_capability === candidate` (no self-grading);
  `calibrateJudge` correlates judge scores against the human approve/veto subset;
  `evaluateRedTeamPack`/`requireRedTeamForExternal` gate the External band on a passing red-team pack.
- **DONE-WHEN met**: quality scores correlate with the human approve/veto subset — calibration reported
  in `core/test/eval-judge.test.ts`.

### REG-1 — Component Registry + two-tier overlap detection
- **`core/src/capability/registry.ts`**: reuses `capability_manifests` + a new nullable `kind`
  (`ComponentKind`) discriminator rather than forking a second registry. `structuralSimilarity`
  (Tier-1, pure, weighted kind/name/permissions 0.4/0.4/0.2) → `findOverlaps` escalates to Tier-2
  semantic (`cosineSimilarity` over `ModelProvider.embed`) ONLY when Tier 1 is inconclusive
  (near-duplicate threshold 0.82); `embed()` is optional ⇒ degrades to the Tier-1 verdict when absent.
  The Learning Agent runs `findOverlaps` before proposing a new capability.
- **DONE-WHEN met**: a near-duplicate is detected before creation — `core/test/capability-registry.test.ts`.

### VAR-1 — Variance Adjuster (bounded, governed tuning)
- **`core/src/policy/variance-adjuster.ts`**: `proposeVarianceAdjustment` maps a veto reason-chip to ONE
  tunable via `CHIP_PARAM_MAP` (`too_casual → tone_threshold` up, `too_formal → tone_threshold` down),
  computes a bounded `±δ` clamped to the param's `[floor, ceil]`, counts only VETTED decisions, and
  returns a `VarianceProposal` **governed diff** (never a silent write). Hard ceilings live outside the
  `policy_params` tunable space (ADR-065), so they cannot be crossed.
- **DONE-WHEN met**: 3× "too casual" VETTED vetoes propose a governed `tone_threshold` nudge, and the
  nudge cannot cross the ceiling — `core/test/variance-adjuster.test.ts`.

### GOV-1 — Governance org-health rollup + minor-only auto-approve
- **`core/src/governance/org-health.ts`**: `rollupOrgHealth` (autonomy-pressure / trust-debt /
  approval-load / violation-trend, pure over evidence); `classifyApprovalBand({risk, origin,
  safetyTouch})` → `minor|moderate|major` (minor = the two lowest risk bands AND a built-in/template
  origin); `canGovernanceAutoApprove` = minor only.
- **Wired into `apps/api`**: `capability.orgHealth` (assembled from real `listManifests`+`getState`) and
  `capability.governanceAutoApprove` (minor → advances validated→approved; else refuses, returning the
  band + reason).
- **Design call (ADR-070)**: Governance auto-approve is enacted as a **SYSTEM/router gate**, NOT by
  implementing the documented "Governance Agent is the sole exception to the agent-floor approve-DENY."
  That exception is unimplemented in code (the agent-floor is a hard DENY); rather than punch a hole in
  a structural safety invariant, the minor-only lane is a system decision — the agent-floor stays as-is.
- **DONE-WHEN met**: the rollup renders for a workspace, and Governance auto-approves only `minor`
  (major + moderate refuse) — `apps/api/test/capability-governance.test.ts`.

### Foundations + integration
- **`core/src/policy/params.ts`** — the `policy_params` typed **tunable space**: `TunableParam
  {value, floor, ceil}`, `AqvGates`, `DEFAULT_POLICY_PARAMS`, `resolveGates`, `getTunable`,
  `clampToBounds`, `mergePolicyParams`, + a `PolicyParamStore` port + `InMemoryPolicyParamStore`. Hard
  ceilings (agent-floor, External human floor, lethal-trifecta) are **excluded by construction** — not
  representable here, so the adjuster physically cannot relax them (ADR-065).
- **`capability_manifests.kind`** discriminator + migration `0010` (hand-trimmed to the `kind` ALTER —
  the generator re-emitted historical DDL; BUGS.md snapshot-drift row).
- **`EvalStore` + `PolicyParamStore` wired into `apps/api`** (`buildWiring()`, in-memory both modes):
  the EVAL-1/EVAL-2 infra existed but had never reached the router; EVAL-3 is its first consumer.

## Execution & parallelism
Built the coupled core/db foundations sequentially (they share `@bridge/core`/schema files):
`params` → `kind` + migration `0010` → EVAL-3 `comparison`. Then fanned the 4 genuinely-independent
core surfaces — EVAL-4 `judge`, REG-1 `registry`, VAR-1 `variance-adjuster`, GOV-1 `org-health` — to
**4 parallel background subagents**, each with complete stateless context (env, the compiled-`dist`
`node --test` runner rule, exact files, done-when) and verifying via an isolated-tsc trick to avoid
racing on the shared core `dist`. I owned every `index.ts` export + all `router.ts`/`wiring.ts`
integration myself, so no two writers touched the same file.

## Verification
- Full `pnpm turbo run typecheck test build --force` → **59/59 tasks green**, all coverage floors pass.
- `@bridge/core` → 301 tests (93.08%), `@bridge/db` 57→61 (56.42%), `apps/api` 67→74 (60.73%).
- ESLint clean on every changed kernel file (`bridge/no-crm-vocab` respected — Bridge vocab only).
- The `@bridge/db` floor dip (57.87→54.30) was a **whole-module-graph measurement artifact**: db imports
  the `@bridge/core` barrel at runtime, so `export *` eagerly loads the 6 new (core-tested but
  db-unexercised) modules into db's measured graph. Recovered by adding **3 real store round-trip tests**
  (resources/jobpilot/helpdesk — genuinely untested Pi-extension CRUD, now 100% line coverage), NOT by
  lowering the floor or special-casing the measurement (ADR-071).

## Governance
- ADR-065–071 recorded in `docs/raw/decisions-log.md` (foundations; EVAL-3; EVAL-4; REG-1; VAR-1; GOV-1
  incl. the system-gate call; integration + the coverage-leak fix).
- **AP-015 filed PROPOSED** in `docs/APPROVALS.md` — PROGRESS §Batch 6 boxes left UNTICKED pending the
  user's approval.
- No dummy data: GOV-1's `violationSeries` is an honest empty state (no violation-history view yet);
  the in-memory stores are real stores.
- New `docs/BUGS.md` row: `DrizzleCanonicalIdentityStore.upsertPersonIdentity`'s bare
  `ON CONFLICT (dedup_key)` cannot match the partial unique index migration `0004` created (Postgres
  42P10) — spotted via a db-coverage probe, latent because existing tests use only the InMemory fake.
  Deferred (cloud dual-write surface, out of Month-4 scope) with the one-line fix noted.

## Artifacts (created/changed)
- Core (new): `packages/core/src/policy/params.ts`, `eval/comparison.ts`, `eval/judge.ts`,
  `capability/registry.ts`, `policy/variance-adjuster.ts`, `governance/org-health.ts` + 6 test files.
- Core (changed): `capability/types.ts` (+`ComponentKind`), `capability/ports.ts` (+`kind`),
  `index.ts` (Batch-6 exports).
- db (changed): `schema.ts` (+`kind`), `capability-store.ts` (round-trip), `capability-store.test.ts`,
  migration `0010_steep_tusk.sql` + `meta/0010_snapshot.json` + `_journal.json`; (new tests)
  `resources-store.test.ts`, `jobpilot-store.test.ts`, `helpdesk-store.test.ts`.
- apps/api (changed): `router.ts` (EVAL-3 gate + `orgHealth`/`governanceAutoApprove`), `wiring.ts`
  (EvalStore/PolicyParamStore); (new) `test/capability-governance.test.ts`.
- Docs: `docs/raw/decisions-log.md` (ADR-065–071), `docs/log.md`, `docs/PROGRESS.md` (§Batch 6),
  `docs/APPROVALS.md` (AP-015), `docs/BUGS.md` (canonical-store row), this file.

## Deferred by design (follow-ups)
- Drizzle bindings for `EvalStore` + `PolicyParamStore` (in-memory only this batch — no persistence
  consumer yet).
- Real pgvector persistence of manifest embeddings (REG-1 Tier-2 currently in-memory cosine).
- A violation-history view feeding GOV-1's `violationSeries`; an actual Governance-Agent caller.
- A pinned production judge-model binding (EVAL-4 uses the `ModelProvider` seam).
- The canonical-store `ON CONFLICT` partial-index fix (BUGS.md).
