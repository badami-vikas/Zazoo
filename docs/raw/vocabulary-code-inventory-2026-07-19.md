---
title: Canonical vocabulary code inventory
type: raw
doc_kind: audit
status: active
companions: [vocabulary-code-migration-plan-2026-07-14.md, ../glossary.md]
related_wiki: ../wiki/ontology.md
updated: 2026-07-20
tags: [vocabulary, migration, inventory, ci, compatibility]
---

# Canonical vocabulary code inventory

```yaml
source_of_truth:
  scanner: platform/scripts/check-retired-vocabulary.mjs
  baseline: platform/scripts/retired-vocabulary-baseline.json
  command: cd platform && pnpm check:vocabulary
  ratchet_command: cd platform && node scripts/check-retired-vocabulary.mjs --write-baseline
  method:
    - parse runtime TypeScript and JavaScript with the TypeScript AST
    - lex Rust and non-migration SQL identifiers and strings while excluding comments
    - fold static string/template/JSX compositions that would otherwise split a retired term
    - count retired tokens in public/private identifiers, strings, interpolated template text, and JSX text
    - hash each matched syntax value and fail on any new per-file/family/kind fingerprint
    - require a downward-only baseline refresh after removals; the writer refuses growth
  excluded:
    - migrations
    - tests and fixtures
    - generated files
    - explicit one-version compatibility adapters
    - historical documentation

classification:
  schema:
    representatives:
      - platform/packages/db/src/schema.ts
      - platform/packages/db/src/ritual-stores.ts
      - platform/packages/db/src/package-store.ts
  api:
    representatives:
      - platform/apps/api/src/router.ts
      - platform/apps/api/src/wiring.ts
  runtime_symbol:
    representatives:
      - platform/packages/core/src/ritual-executor.ts
      - platform/packages/core/src/package/
      - platform/packages/core/src/types.ts
  ui_copy_and_route:
    representatives:
      - platform/apps/web/src/app/Layout.tsx
      - platform/apps/web/src/app/pages/RitualDetail.tsx
      - platform/apps/web/src/app/pages/ToolDetail.tsx
      - platform/apps/web/src/app/pages/InitiativeDetail.tsx
  persisted_payload:
    representatives:
      - workspaceId and workspace_id tenant keys
      - ritual and package manifests
      - initiative, touchpoint, artifact, and helpdesk payload keys
  local_storage:
    canonical:
      key: bridge.avatar.v2
      fields: [style, avatarReady, avatarName]
    compatibility_read:
      file: platform/apps/web/src/app/avatar/avatar-v1-compat.ts
      removal: delete after the one-version VOCAB1 compatibility window
  tests:
    policy: excluded from the ratchet so migrations and legacy reads can be proven
    requirement: no production writer may emit a retired payload
  historical_documentation:
    policy: excluded; requirement and ADR history remains immutable evidence

runtime_baseline:
  total: 360
  families:
    avatar_lifecycle: 0
    ritual: 0
    workflow: 0
    brain: 0
    workspace: 0
    package: 1
    project: 36
    initiative: 0
    element: 99
    touchpoint: 0
    incident: 0
    artifact: 0
    tool: 5
    knowledge: 8
    helpdesk: 211
    legacy_plane: 0

vocab1:
  canonical_runtime:
    component: AvatarSetupProgress
    state: AvatarSetupState
    visual_type: AvatarStyle
    answer_key: avatar_style
    preference_fields: [style, avatarReady, avatarName]
    completion_callback: onAvatarReady
  compatibility:
    browser: platform/apps/web/src/app/avatar/avatar-v1-compat.ts
    api: platform/apps/api/src/avatar-profile-v1-compat.ts
    writes: canonical_only
  invariants:
    - Avatar style is visual only
    - Avatar style never changes Agent tone, behavior, or authority
    - blink is emitted only by the capture Event contract
    - no Avatar lifecycle or maturity state remains in runtime source
    - desktop Avatar stays native-hidden and click-through until this launch confirms an active Organization and ready preferences

vocab4:
  storage:
    occurrence_ledger: events
    signal: security-invoker read projection over participant-linked Events
    timeline: read projection over Events
    non_file_outcome: Result
    durable_user_content: files plus file_refs
  migration: 0023_vocab4_event_result_file
  removed_tables: [signal_actions, timeline_entries, timeline_entry_refs, touchpoints]
  replaced_table:
    signals: read_projection
  compatibility:
    signed_commons: original pre-VOCAB4 provenance bytes remain hash/signature authority
    runtime_writes: canonical_only
  verification:
    - fresh, upgrade, replay/no-drift, and data-preservation migration coverage
    - append-only Event and Organization-isolated Event/File RLS
    - Relationship Signal/Timeline and safe Action API coverage
    - Module File write plus inventory reconciliation converges to one File
    - Result-backed JobPilot culture/application contracts
    - zero Artifact, Touchpoint, and Incident runtime ratchet occurrences

next_batches:
  - VOCAB5 Relationship Module
  - VOCAB6 actionable Module shell and Second Brain graph
```
