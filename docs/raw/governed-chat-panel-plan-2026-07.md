---
title: Governed Persistent Chat Panel
type: raw
doc_kind: plan
status: done
companions: [../../outputs/2026-07-26-right-chat-panel-completion.md]
related_wiki: ../wiki/chat-panel.md
updated: 2026-07-27
tags: [chat-panel, chief-of-staff, local-model, llama-cpp, qwen, governance]
---

# Governed Persistent Chat Panel

## Outcome

One durable Chief-of-Staff conversation spans the right Chat Panel, full Page, and desktop Avatar.
Desktop private content stays in the Local Plane. A managed lightweight local model receives bounded,
authorized Run context. Any action resolves to one real eligible Agent-owned Skill and stays in the
existing Proposal → Decision → Run → Result lifecycle.

## Completion evidence

```yaml
closed:
  task: TASK-026
  approval: AP-080
  date: 2026-07-27
runtime:
  llama_cpp:
    release: b9000
    revision: 1a03cf47f67be591699d1f0f7ca28e1ed6eb8c7e
  model:
    id: qwen3-4b-instruct-2507-q4_k_m
    bytes: 2497280736
    sha256: 2fde00ce69dd4899c70d020845e2638353015bba0fdf161b3eb965f2bca4464e
  cold_ready_seconds: 25
prototype:
  real_multi_turn_qwen: pass
  shared_panel_page_avatar: pass
  real_task_proposal_decision_run_result: pass
  api_and_full_app_restart: pass
  model_crash_recovery: pass
  archive_delete_retry_cancel: pass
  layouts: [375, 768, 1440]
  accessibility_violations: 0
  console_errors: 0
  local_http_errors: 0
verification:
  monorepo_test_tasks: 40/40
  rust: 59/59
  desktop_bundle: 8/8
  gates: [build, typecheck, lint, vocabulary, agent_context, no_dummy_runtime]
  rebuilt_app: [deep_signature, packaged_keyring, NATIVE_OK, abrupt_exit_recovery, graceful_cleanup]
final_review:
  resolved:
    - forged_proposal_provenance
    - cross_plane_default_thread_ids
    - database_provenance_and_lifecycle_mutation
    - release_signing_order
    - supervisor_lease_cleanup
    - post_download_cancellation
    - idle_model_state_refresh
    - draft_preservation
    - task_output_discriminator
  independent_re_review: no_significant_findings
known_unrelated_gate:
  production_dependency_audit: 7_high_1_moderate_advisories
  owner: TASK-018
```

## Settled boundaries

```yaml
task: TASK-026
priority: P0
approval: AP-078
desktop:
  conversation_plane: local
  default_inference: managed_local
  private_cloud_sync: false
hosted_web:
  allowed_scope: public_only
  private_turns: deny
cloud_inference:
  consent: exact_turn_single_use
local_runtime:
  engine: llama.cpp
  delivery: signed_external_binary
  model_candidate: Qwen/Qwen3-4B-Instruct-2507
  quantization: Q4_K_M
  download: human_triggered_first_use
```

Qwen's official checkpoint is Apache-2.0, 4B, non-thinking, and documents tool use. llama.cpp is
MIT. The release must pin exact upstream revisions, per-target binary hashes, model source,
conversion provenance, license, size, and SHA-256. An unverified community hash never becomes a
product default. If no reviewed GGUF is acceptable, produce a reproducible Bridge-owned conversion
from the official checkpoint.

## Baseline gaps (resolved by TASK-026)

1. `AgentPanel`, `ChiefOfStaffPage`, and `OverlayApp` own separate volatile arrays.
2. `chiefOfStaff.converse` accepts one message and client-owned chain depth.
3. CoS builds persona ad hoc and does not consume the existing RunContextAssembler.
4. Capability discovery is hardcoded; normal routing stages `stageMutation`.
5. Model health/setup is absent from Chat. Ollama is an external prerequisite, not self-contained.
6. Cloud egress trusts a Boolean declaration and has no exact-turn disclosure flow.
7. Chat shows only a pending badge, not Decision/Run/Result.

## Data and API

Add a `ChatStore` port and Drizzle implementation:

```yaml
chat_threads:
  identity: [id, organization_id, owner_user_id]
  boundary: [plane, data_scope]
  lifecycle: [status, title, created_at, updated_at]
chat_turns:
  ordering: [thread_id, sequence]
  attribution: [role, actor_type, actor_id]
  payload: [content, taint_label]
  delivery: [client_request_id, state, error_code]
chat_turn_refs:
  kinds: [routing_decision, model_receipt, proposal, run, result, event, file]
  value: [turn_id, kind, ref_id, state, metadata]
```

RLS and every store query require Organization plus owner. Local private records bind to file-backed
PGlite only. Hosted writes require public scope. There is no replication between the stores. Atomic
thread sequence and client request idempotency prevent duplicate turns/model calls/proposals.

Authenticated APIs create/list/get/archive/delete threads, page turns, send/retry a turn, and inspect
linked lifecycle. Server derives routing depth. Explicit delete removes private message text; the
prompt-free governance Ledger remains immutable.

## Managed model

`LlamaCppProvider` implements the existing ModelProvider contract against a loopback
OpenAI-compatible llama.cpp endpoint. It validates model identity, reports real health and usage,
propagates taint, and supports constrained JSON envelopes.

Tauri owns the `llama-server` child. It binds loopback, uses an ephemeral capability unknown to
webviews, writes endpoint metadata atomically with owner-only permissions for the API, starts lazily
after model verification, monitors/restarts with a bound, and terminates on exit. The API is the only
model caller.

The setup card starts a governed public artifact fetch. Download uses a temporary file, fixed HTTPS
source policy, redirect/byte/time limits, disk check, cancel/resume, SHA-256 verification, and atomic
install. No automatic download. Default context is 8,192 tokens with bounded output.

The Bridge evaluation requires zero unauthorized actions/cross-Plane leaks and schema-valid
constrained envelopes across routing, clarification, malformed input, prompt injection, and
unsupported capability cases. Gemma 4 E2B IT is the fallback candidate only if Qwen3 4B fails the
same harness.

## Context and dispatch

Extend ModelRunContext with bounded role-preserving conversation history and segment labels. Compose:

1. stored Onboarding persona;
2. current request plus bounded thread/rolling summary;
3. server-resolved Module/Page/Record/Task surface;
4. bounded visible accepted Memory;
5. relevant installed Agent-owned Skills;
6. approval/trust state and trace.

The client supplies identifiers, never labels/content/Agent/capability/chain depth. The server resolves
and authorizes every referenced object.

Only Skills with complete schemas, registered implementation, installed consuming Module, eligible
active Agent, and real effect path enter model disclosure. llama.cpp constrains the candidate
envelope; server schema validation is authoritative. One bounded repair is allowed, then clarify/fail.

Dispatch narrows Skills deterministically, asks for direct answer/clarify/one candidate, provisions or
reuses the bounded Goal/Task, calls `resolveSkillForTask`, and proposes through the Universal Action
Pipeline. Selection and rejected alternatives persist as prompt-free references. No match is honest;
Capability Builder may be proposed separately.

## Cloud turn

Preparing a cloud turn assembles public-only context and returns a disclosure plus short-lived grant.
The grant binds Human, Organization, thread, provider/tier, exact context digest, and expiry. Confirm
consumes it once. Server recomputes the digest immediately before egress. Private/restricted/unknown
or changed context fails closed; nothing is silently stripped.

Hosted web exposes this public flow only. No provider means honest unavailable state. TASK-022 retains
the separate paid Anthropic live-cache gate.

## UI

One shared Chat client/components back `AgentPanel`, `ChiefOfStaffPage`, and `OverlayApp`. Durable API
state is truth; BroadcastChannel plus bounded refetch only invalidates views.

The UI includes thread history/new/archive/delete, setup/download/health, multiline send, retry/cancel,
accessible live status, responsive 375px behavior, Agent/Skill selection reason, real proposal
diff/risk/scope/taint, Approve/Edit/Veto, Run state, and terminal Result/Event/File links. Approvals
and Chat render the same proposal id and call the same Decision API.

## Exit gates

```yaml
hard_invariants:
  unauthorized_actions: 0
  cross_plane_private_leaks: 0
  duplicate_effects_on_retry: 0
  cloud_grant_replay_success: 0
required_proof:
  - fresh_and_upgrade_migration
  - owner_and_organization_RLS
  - process_A_to_B_local_restart
  - real_Qwen_download_and_inference
  - real_Agent_Skill_proposal_and_Decision
  - terminal_Run_Result_in_same_thread
  - shared_panel_Page_Avatar_thread
  - desktop_and_375px_accessibility
```

Affected-neighbour scan covers ModelProvider routing/receipts, TASK-022 caching, Memory visibility,
Agent/Skill resolution, Approvals, child Runs, desktop bootstrap/liveness/CSP, Avatar, hosted public
guard, and bundle/signing verification. Rollback disables new sends but leaves threads readable and
exportable.
