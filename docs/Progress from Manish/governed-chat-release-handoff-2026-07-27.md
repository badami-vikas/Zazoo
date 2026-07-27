# Governed Chat release handoff - 2026-07-27

> Purpose: restart context for the durable right Chat Panel release. This file is not an execution
> queue. `docs/TASKS.md`, approvals, ADRs, and current production evidence remain authoritative.

## Resume state

- Repository: `manishsbhoopalam8498/relationship-os`
- Branch: `main`
- Final handoff commit before this note: `aa5b86f5a6ee4939000bf6c94974ff8b896ddb7d`
- TASK-026: `done`
- Production web: <https://bridge-pilot-web.onrender.com>
- Production API: <https://bridge-pilot-api.onrender.com>
- Render automatic deploys: disabled; deploy exact commits manually.

## Landed commits

| Commit | Outcome |
|---|---|
| `11725b0f5c14fca4e7fd36f055aa38818699bb8c` | Merged PR #48 project skills/config |
| `1c5340dd10bbbbbd32559ed10c388dceabd8c6d1` | Durable governed Chat implementation |
| `d88d81c72ab01b6afc625d2f7937f0e337af07d8` | Auth navigation contrast repair |
| `704284cd15e0a16c43faf445ff38808be6f4551c` | Dark-theme Auth submit contrast repair |
| `aa5b86f5a6ee4939000bf6c94974ff8b896ddb7d` | Final live certification evidence |

## Production state

```yaml
render:
  api:
    deploy: dep-d9jkpuf41pts73cs1m6g
    source_commit: 1c5340dd10bbbbbd32559ed10c388dceabd8c6d1
    status: live
  web:
    deploy: dep-d9jlog3rjlhs738nvq90
    source_commit: aa5b86f5a6ee4939000bf6c94974ff8b896ddb7d
    status: live
database:
  high_water: "0032"
  next_migration: "0033"
  migration_0031_sha256: 24c7ce9e81805ac294849a4ce73755873189443b5a2173b2c230881733a953f3
  migration_0032_sha256: 5de0db7d6ea4399f0bf86381e67d4f431149afa1edcc9b47306a0129e5474adf
```

The first signed-in production Chat load exposed that Supabase was still at migration `0030`.
The runtime `bridge_app` role correctly had no schema-creation authority. An owner-only guarded
transaction required the released `0030` high-water/hash, applied byte-identical migrations
`0031` and `0032`, and advanced production to `0032`. Do not reapply them or give the runtime role
DDL authority.

## What is complete

- Right Chat Panel, full Chief of Staff Page, and desktop Avatar use one durable owner/Organization
  isolated thread.
- Desktop private Chat remains Local Plane and uses managed llama.cpp `b9000` with pinned
  `qwen3-4b-instruct-2507-q4_k_m`.
- Bounded server-owned context, real attributable Agent-owned Skill routing, and inline
  Proposal -> Decision -> Run -> Result are implemented.
- Thread history, pagination, archive/delete, retry/cancel, restart recovery, exact cloud grants,
  immutable provenance/lifecycle rules, and cross-Plane ID separation are implemented.
- Signed-in production loaded the same thread in the panel, Chief of Staff Page, and 375px layout.
- Final configured Auth checks passed sign-in, sign-up, forgot-password, and reset-password in
  settled light and dark themes: 8/8 WCAG A/AA Axe runs, zero violations, zero unexpected
  console/page/network errors, and zero 375px overflow.

## Honest remaining boundary

No authorized hosted cloud `ModelProvider` is configured. The hosted composer is real and durable,
but public-cloud preparation currently returns the expected `412 PRECONDITION_FAILED` before
persistence. The UI preserves the draft and stores no unconsented message. This is not dummy Chat.

To enable hosted answers, configure an approved cloud provider through the existing `ModelProvider`
boundary and Render secrets, then retain fresh exact-context consent for every public turn. Never
send private desktop Chat to the hosted provider. Desktop local Qwen inference is already complete.

## Verification snapshot

```yaml
source:
  monorepo_test_tasks: 40/40
  build_typecheck_tasks: 44/44
  rust_tests: 59/59
  bundle_policy: 8/8
  independent_review: no_significant_findings
native:
  packaged_qwen_inference: NATIVE_OK
  crash_recovery: pass
  graceful_cleanup: pass
production:
  api_ready: pass
  persistent_boundary: public-cloud
  durable_panel_page_mobile_thread: pass
  chat_wcag_violations: 0
  auth_wcag_checks: 8/8
```

## Resume rules

1. Fetch `origin/main` and confirm `aa5b86f` plus this handoff commit are ancestors.
2. Read `docs/TASKS.md` before selecting work; do not reopen TASK-026.
3. Treat `0033` as the next migration number. Never reuse `0031` or `0032`.
4. Apply future production migrations with an owner connection before signed-in feature checks.
5. Do not interpret the current hosted-provider `412` as a persistence or Chat UI failure.
6. Because Render auto-deploy is off, deploy every runtime commit explicitly and match the live
   deploy SHA before verification.
7. Keep TASK-018 dependency/signing/mobile blockers and TASK-022 paid Anthropic cache proof separate
   from the completed Chat release.

## Key files and evidence

- [`docs/TASKS.md`](../TASKS.md) - TASK-026 canonical status and proof
- [`outputs/2026-07-26-right-chat-panel-completion.md`](../../outputs/2026-07-26-right-chat-panel-completion.md)
- [`docs/raw/governed-chat-panel-plan-2026-07.md`](../raw/governed-chat-panel-plan-2026-07.md)
- [`docs/wiki/chat-panel.md`](../wiki/chat-panel.md)
- `platform/apps/api/src/router.ts`
- `platform/packages/db/migrations/0031_task026_chat_store.sql`
- `platform/packages/db/migrations/0032_task026_chat_cloud_grants.sql`
- `platform/apps/web/src/app/chat/useChat.ts`
- `platform/apps/web/src/app/chat/ChatView.tsx`
- `platform/apps/desktop/src-tauri/src/model_supervisor.rs`
