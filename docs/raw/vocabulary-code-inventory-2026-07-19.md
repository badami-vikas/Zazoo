---
title: Canonical vocabulary code inventory
type: raw
doc_kind: audit
status: active
companions: [vocabulary-code-migration-plan-2026-07-14.md, ../glossary.md]
related_wiki: ../wiki/ontology.md
updated: 2026-07-19
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
  total: 7515
  families:
    avatar_lifecycle: 0
    ritual: 347
    workflow: 68
    brain: 18
    workspace: 4447
    package: 889
    project: 56
    initiative: 337
    element: 184
    touchpoint: 234
    incident: 0
    artifact: 234
    tool: 463
    knowledge: 10
    helpdesk: 228
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

next_batches:
  - VOCAB2 automation and Engine
  - VOCAB3 Organization, Module, Database, Record, Relation
  - VOCAB4 Event, Result, File
  - VOCAB5 Relationship Module
  - VOCAB6 actionable Module shell and Second Brain graph
```
