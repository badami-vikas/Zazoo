# TASK-021 Task Manager closure

**DONE — externally certified 2026-07-21 under AP-066.**

Bridge implementation: PR #41, source `689fca0ca742cfa01eae8e3785b00c50c5e3ca5b`, evidence `37d5854faa76d9bc6999104981dda5a89cd27ab5`, merge `0087f8923bcec92a1c09f6ac4ac0154e976d1843`.

External certification: `badami-vikas/Corporate-training-sims` PR #104, evidence `123e72b`, merge `f3443acc3ce34fdce29ed2147fe3d608b861a696`. Durable artifact: `docs/verification/task-manager-bridge-certification.md` in that repository.

## Decisive proof

- Signed `task-manager@1.0.2`: registry hash `sha256:27d9b38f74ce0e1e98a53989e965769f21ec0ea497d96715f7ec23afd18eae5a`; normalized signed and built-in hash `sha256:0c89e0136c4760154e66752782c56236afae737f4c532434c9a9ac091fe60701`.
- Signed `1.0.3` installation `cde90b5c-5bb2-44c7-b56a-88df2bb367ae` passed proposal/approval/promotion and recovered `available` after restart without Commons refetch. Legacy `pkginst_corporate_legacy` mapped to UUID ledger resource `0a6dbbba-66a4-52f8-946a-cd939727e964`.
- Physical runtime A→B retained projection proposal `620f9003-250a-5289-aef6-ac8821c76600` and Run `a6f7d47c-cfe3-5890-aada-82e49a281ac9`. Final deterministic projection `446ea197` and File `sha256:a16184ba71bab48592464991ecb13db3704cbfa9e4fc4e4939cae8c68e2925a8` repeated exactly.
- Unknown create, omission/delete, stale DB/File, unexpected writer, expiry, concurrent replay, and conflicting terminal decision failed closed. Root swap moved the child to the root occupying its projected parent path. Unrelated completed Task `5cf367bb-4e34-4dc8-95b7-1870160ae01e` retained version `4`, `updatedAt=2026-07-16T10:00:00.000Z`, status, path, and evidence.
- Cap `3`/age `365d` and cap `100`/age `7d` sweeps ran through attributable Governance Agent Runs, archived only eligible done Tasks, preserved evidence, and replayed original IDs/results.
- Corporate TASK-013 remained done as Task `37de8168-d770-446c-81a7-9ae67eca06fb` with Run `dfe4464a-ec32-40e6-a792-0b572f0cc808`, Result `1b968951-7aa2-46c6-888b-993a18cbf48e`, Event `2345e4d0-a178-42a4-87a9-d8b2e0f1ad10`, and File `187d17fc-3d4c-40ec-9684-ca079e35a2d7`.
- Required Skill `task-manager.ledger-projection` selected only Internal Strategist. Two eligible Agents and no match required explicit Human assignment. Capability Builder was never a default.

The external gate reports 148 exact Bridge tests and a zero-blocker physical certifier. GitHub Actions account billing remained unavailable; no CI success is claimed.

Files: [Task queue](../docs/TASKS.md) · [Task Manager wiki](../docs/wiki/taskmanager.md) · [Bug evidence](../docs/BUGS.md) · [Change log](../docs/log.md)
