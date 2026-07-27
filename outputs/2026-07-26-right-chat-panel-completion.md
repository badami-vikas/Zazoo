# Right Chat Panel completion

Started: 2026-07-26
Completed: 2026-07-27

## Outcome

TASK-026 is complete. Right Chat Panel, full Chief of Staff Page, and desktop Avatar now share one
durable conversation. Private desktop Chat stays in Local Plane. Managed Qwen inference receives
bounded authorized context. Real eligible Agent-owned Skills enter existing
Proposal→Decision→Run→Result lifecycle. Hosted private turns fail closed; cloud use needs fresh exact
public-context consent.

PR #48 landed at `11725b0` under AP-079. TASK-026 will apply its
`database-migrations`, `eval-harness`, `react-testing`, `frontend-a11y`, and `verification-loop`
guidance selectively. The 39 other skills are not implicit requirements or policy.

## Delivered

- Durable owner/Organization-isolated `ChatStore`, migrations `0031`/`0032`, exact sequencing,
  idempotency, pagination, archive/delete, typed lifecycle refs, RLS, and Local/Cloud residency.
- Server-owned bounded conversation context, authorized surface/Memory resolution, typed Skill
  selection, eligible Agent resolution, and governed Task proposal dispatch.
- Single-use cloud grants bound to Human, Organization, thread, provider, exact public context digest,
  and expiry.
- Managed llama.cpp supervisor/provider with pinned runtime/model provenance, loopback capability auth,
  install/cancel/resume, integrity checks, sibling Local Plane storage, bounded recovery, and stale
  capability cleanup.
- Shared Chat UI across panel/Page/Avatar with setup/health, new/history, retry/cancel,
  archive/delete, inline proposal decisions, Run/Result links, keyboard/focus/live-region handling,
  and responsive layouts.

## Real certification

```yaml
model:
  id: qwen3-4b-instruct-2507-q4_k_m
  bytes: 2497280736
  sha256: 2fde00ce69dd4899c70d020845e2638353015bba0fdf161b3eb965f2bca4464e
llama_cpp:
  release: b9000
  revision: 1a03cf47f67be591699d1f0f7ca28e1ed6eb8c7e
  cold_ready_seconds: 25
prototype:
  qwen_multi_turn: pass
  shared_panel_page_avatar: pass
  task_proposal_to_terminal_result: pass
  api_restart: pass
  full_app_restart: pass
  model_crash_recovery: pass
  archive_delete_retry_cancel: pass
  responsive_layouts: [375, 768, 1440]
  accessibility_violations: 0
  console_errors: 0
  local_http_errors: 0
repository:
  full_test_tasks: 40/40
  rust: 59/59
  bundle: 8/8
  independent_re_review: no_significant_findings
rebuilt_app:
  deep_signature: pass
  packaged_keyring: pass
  inference: NATIVE_OK
  abrupt_exit_recovery: pass
  graceful_cleanup: pass
```

Native evidence: session artifact `files/native-chat-release-result.json`.

Final review also closed forged proposal provenance, cross-Plane default-thread collisions, direct
database provenance/lifecycle mutation, release-signing order, supervisor lease cleanup,
post-download cancellation, idle model-state refresh, composer draft loss, and the Task output
discriminator. Each has focused regression coverage.

## Boundaries retained

- No private Chat sync between devices or Planes.
- Windows installer certification remains TASK-018.
- Paid Anthropic live-cache proof remains TASK-022.
- Seven HIGH and one MODERATE production dependency advisories remain OPEN under TASK-018; TASK-026
  changed no `pnpm` dependency or lockfile and does not misreport this unrelated gate as green.

## Links

- Canonical task: [`docs/TASKS.md`](../docs/TASKS.md) — TASK-026
- Approved plan: [`docs/raw/governed-chat-panel-plan-2026-07.md`](../docs/raw/governed-chat-panel-plan-2026-07.md)
- Wiki: [`docs/wiki/chat-panel.md`](../docs/wiki/chat-panel.md)
- Decision: [`docs/raw/decisions-log.md`](../docs/raw/decisions-log.md) — ADR-147
- Approval: [`docs/APPROVALS.md`](../docs/APPROVALS.md) — AP-078/AP-080
