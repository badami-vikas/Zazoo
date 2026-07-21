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
    - count retired tokens in identifiers, strings, regex literals, interpolated template text, and JSX text across runtime and tests
    - hash each matched syntax value and fail on any new per-file/family/kind fingerprint
    - require a downward-only baseline refresh after removals; the writer refuses growth
  excluded:
    - migrations
    - generated files
    - explicit immutable migration fixtures
    - the signed Commons historical-verification boundary
    - historical documentation

classification:
  schema:
    representatives:
      - platform/packages/db/src/schema.ts
      - platform/packages/db/src/graph-store.ts
  api:
    representatives:
      - platform/apps/api/src/router.ts
      - platform/apps/api/src/wiring.ts
  runtime_symbol:
    representatives:
      - platform/packages/core/src/automation-executor.ts
      - platform/packages/core/src/module/
      - platform/packages/core/src/types.ts
  ui_copy_and_route:
    representatives:
      - platform/apps/web/src/app/Layout.tsx
      - platform/apps/web/src/app/pages/ModuleDetailPage.tsx
      - platform/apps/web/src/app/pages/SecondBrainPage.tsx
  persisted_payload:
    representatives:
      - organizationId and organization_id tenant keys
      - Automation and Module manifests
      - Record, Event, Result, File, and Helpdesk payload keys
  local_storage:
    canonical:
      key: bridge.avatar.v2
      fields: [style, avatarReady, avatarName]
    compatibility_read: removed
  tests:
    policy: scanned by default
    excluded: explicit immutable migration fixtures only
  historical_documentation:
    policy: excluded; requirement and ADR history remains immutable evidence

runtime_baseline:
  total: 0
  families:
    avatar_lifecycle: 0
    ritual: 0
    workflow: 0
    brain: 0
    workspace: 0
    package: 0
    project: 0
    initiative: 0
    element: 0
    touchpoint: 0
    incident: 0
    artifact: 0
    tool: 0
    knowledge: 0
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
    browser: removed
    api: removed
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

final_compatibility_deletion:
  migration: 0024_task012_compatibility_deletion
  technical_classification:
    element: DOM, React, and SVG identifiers only
    project: projection verbs, repository roots, and JSON Resume domain fields only
    package: inspected source paths under platform/packages only
    helpdesk: glossary-approved Relationship sub-module vocabulary
  signed_commons:
    parser: platform/packages/core/src/module/signed-legacy-entry.ts
    storage: one canonical modules root after byte-preserving filesystem migration
    writes: canonical_only
  result: zero forbidden runtime or test occurrences
```
