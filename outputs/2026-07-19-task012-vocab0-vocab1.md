# TASK-012 VOCAB0–VOCAB1

TASK-012 is in progress. The first migration slice adds a deterministic CI vocabulary
ratchet and completes the Avatar/Onboarding identifier migration.

- Runtime TypeScript/JavaScript, Rust, and non-migration SQL identifiers and strings are inventoried in
  [`platform/scripts/retired-vocabulary-baseline.json`](../platform/scripts/retired-vocabulary-baseline.json).
  [`check-retired-vocabulary.mjs`](../platform/scripts/check-retired-vocabulary.mjs) folds
  static compositions and fails CI on any new matched fingerprint outside migrations, tests,
  generated files, or explicit compatibility adapters. Removals require a downward-only
  baseline refresh; the writer refuses growth and one-for-one replacement.
- Avatar preferences now write `bridge.avatar.v2` with `style`, `avatarReady`, and
  `avatarName`. Existing browser state is read once, rewritten canonically, and removed.
- Onboarding now uses `AvatarSetupProgress`, `AvatarSetupState`, `AvatarStyle`,
  `avatar_style`, and `onAvatarReady`. Progress follows real setup state without a lifecycle
  ceremony or timer.
- Avatar style is visual only. Chief of Staff and Communications no longer derive tone,
  behavior, or authority from it.
- Desktop Avatar windows start hidden and click-through. The current shell launch must confirm
  both an active Organization and ready preferences before each window can present itself.
- The retired dummy-prefix ESLint wiring and stale guidance were removed. Unavoidable
  fixtures remain governed by [`docs/dummy.md`](../docs/dummy.md).

Inventory and remaining counts:
[`docs/raw/vocabulary-code-inventory-2026-07-19.md`](../docs/raw/vocabulary-code-inventory-2026-07-19.md).
