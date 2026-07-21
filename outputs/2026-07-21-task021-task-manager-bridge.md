# TASK-021 — Bridge Task Manager implementation milestone

Bridge TM0–TM6 implementation is complete at source checkpoint `c708017`; TASK-021 remains `in_progress` only for the separately owned `badami-vikas/Corporate-training-sims` certification.

## Landed contract

- One `tasks` Database per Organization. UUID `id` is stable; `path` is recomputed. `is_goal` and `outcomes[]` are fields. Migration `0027` preserves legacy Goal/Task IDs and Agent assignment, then removes `goals`.
- Queue reads/writes use `taskManager.*` tRPC. A populated-queue create remains `candidate` until its pipeline-linked `impact_fit` proposal is approved.
- Promote, insert-ancestor-above, re-parent, and reorder are Human-decided pipeline proposals. Application locks/version-checks rows, recomputes paths atomically, preserves IDs/old ancestors, and appends a Task Event.
- Non-goal `in_progress` requires `exit_test`; `done` requires verification evidence. Outcome target changes on done/archived/parked work produce a governed reopen proposal.
- Required-Skill routing evaluates real Agent allowlists, authority, Plane, and data scope. One eligible Agent routes; zero/multiple require explicit Human assignment. No default exists.
- Minor unambiguous route/reschedule may auto-apply only after three Human approvals and zero vetoes; significant/ambiguous and all Agent decisions require approval.
- `emitTasksMarkdown` / parse / content hash / record versions / drift detection / approved reconciliation are deterministic. `docs/TASKS.md` maps stable `TASK-nnn` identity separately from root path.
- Installed `task-manager` manifest declares Queue, five existing Agent roles, Agent-owned Skills, guard Automations, Files, signed provenance, and Commons publication boundaries.

## Bridge evidence

- Real local tree: `Certify Bridge Task Manager` → `Exercise standard Task views` → `Capture browser evidence`, paths `2` / `2.1` / `2.1.1`.
- Desktop `1280×800`: Tree, Files, installed left-nav Module, and chat rendered; `scrollWidth=clientWidth=1280`.
- Exact mobile `375×812`: same real Tree and Files rendered; `scrollWidth=clientWidth=375`; no document overflow.
- Targeted checks: Core Task logic; DB store/legacy GoalTask/child Run; migration fresh+upgrade+replay+preservation; private Task RLS; API pipeline proposal flow and veto consistency; Graph; parser/projection; manifest; web type/build/lint/vocabulary/no-runtime-dummy.
- GitHub Actions are payment-blocked. No CI success is claimed.

## Corporate-training-sims certifier contract

The next strictly sequential session must use `badami-vikas/Corporate-training-sims` without creating another queue:

1. Install the signed `task-manager@1.0.0` manifest and verify provenance/source checkpoint plus no personal data in Commons.
2. Reconcile existing simulator work into one Task Database; retain source files/requests/bugs as evidence.
3. Link its `tasks.md` as a projection. Prove external edit → drift → proposal → Human approve → Database update → deterministic re-emit, with no silent overwrite.
4. Have its coding Agent orient from only the hot head, execute one real Task, attach Event/Result/File evidence, pass the exit test, mark done, and trigger completed-bay sweep behavior.
5. Prove required-Skill routing selects an actually eligible Agent and an ambiguous/no-match case requires Human assignment.
6. Return commit/PR, installed manifest/version/provenance, Task/Run/Event/File IDs, projection hashes before/after, approval IDs, and duplicate-queue scan.

Only that external evidence may move TASK-021 from `in_progress` to `done`.

## Recertification update — Bridge source `a0da415`

Corporate PR #102 correctly blocked on three Bridge defects. They are fixed; rerun certification against the landed merge containing `a0da415`.

1. Emit/link the canonical File with `taskManager.emitProjectionFile`.
2. Edit that exact `tasks.md`, then call `taskManager.proposeProjectionReconcile` with its SHA-256, a stable idempotency key, and ≤24h expiry. Assert a UUID proposal and attributable drift Run.
3. Exercise Human `veto`, `edit`, and `approve`. Approval must return Event/Result/File/Run IDs and before/external/final hashes. Replay must return the same proposal/Run/result. File change, DB version change, expiry, and race controls must leave Tasks untouched and never overwrite an unexpected File.
4. Complete a real verified Task. Call `taskManager.runCompletedBaySweep` with explicit cap/age/key/expiry; approve the Governance Agent proposal; prove status becomes `archived` while evidence remains. Retry the same key with different policy inputs and prove the original Run/proposal/result returns.
5. Fetch newly signed `task-manager@1.0.1` (source checkpoint `c32bc20`). Derive—not hardcode—the registry content hash, normalized manifest hash, and built-in normalized hash. Call `commons.installPropose` without Agent-need fields; prove the exact signed entry/provenance/key/scan/pins/publish time persist in `commonsSource`, built-in reconciliation is byte-equivalent after normalization, and a new signed version follows ordinary install approval/promotion.
6. Negative controls: tamper, untrusted key, failed scan, personal/Organization data, changed dependency pin, signed-source drift, and immutable same-version content conflict all fail closed. Re-run existing Skill attachment/need tests.

Return source/merge/PR, derived hashes, installation and commonsSource evidence, Task proposal/decision/Run/Event/Result/File IDs, projection hashes, sweep policy/result, restart/replay outcomes, and the duplicate-queue scan. TASK-021 remains `in_progress` until that evidence lands.

## Second recertification update — Bridge source `689fca0`

Corporate PR #103 proved same-process behavior and exposed four Local Plane defects. Bridge fixes them in signed `task-manager@1.0.2`. Run this exact external contract:

1. Start runtime A with a fresh file-backed `BRIDGE_LOCAL_DIR`, Files root, and trusted Commons registry. Assert its Automation registry/Run recorder and ModuleStore are durable adapters, not in-memory.
2. Emit and physically edit `tasks.md`. Create a drift proposal, capture UUID proposal/Run plus File/record hashes, close runtime A, start runtime B on the same directory, replay the same key, and assert identical IDs. Human veto once and Human edit/approve once must complete with durable decision/Event/Result/File/Run evidence. Conflicting terminal decision, stale DB version, stale File hash, unexpected writer, expiry, and concurrent replay fail closed.
3. Before the edit, retain one verified completed Task and capture exact version, `updatedAt`, status, evidence, parent, and path. Edit another Task/reorder roots. After reconcile, assert the untouched row is byte-for-byte unchanged; changed rows alone increment; moved-child parent follows the projected parent path; unknown create and omission never silently create/delete canonical Tasks.
4. Run completed-bay cap policy and age policy separately through Governance Automation proposals. Approve both, preserve evidence, then retry each key with different inputs and recover original Run/proposal/result.
5. Install/reconcile signed `task-manager@1.0.2`; stage, approve, and promote a separately signed `1.0.3`; close/reopen before reading state. Recover exact installation IDs/state plus both `commonsSource` envelopes without registry refetch. IDs and ledger resources must be UUID. Exercise one legacy `pkginst_*` compatibility proposal and prove deterministic UUID ledger mapping plus successful approval/promotion.
6. Derive registry content, normalized signed manifest, and normalized built-in hashes. Re-run tamper, untrusted key, failed scan, personal/Organization data, dependency-pin drift, Agent-need drift, signed-source drift, immutable same-version conflict, cross-Organization/RLS, and existing Skill attachment controls.

Return Corporate commit/PR, Bridge source/merge, derived hashes, proposal/decision/Run/Event/Result/File IDs, both runtime-instance evidence, exact before/after unchanged-Task fields, cap+age plans/results, installation/version/source rows, legacy mapping evidence, and duplicate-queue scan. Only an external PASS moves TASK-021 to done.
