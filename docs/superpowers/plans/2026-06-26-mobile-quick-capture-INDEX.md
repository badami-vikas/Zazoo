# Mobile Quick-Capture — Plan Index (sequenced sub-plans)

> Spec: [`docs/superpowers/specs/2026-06-26-mobile-quick-capture-design.md`](../specs/2026-06-26-mobile-quick-capture-design.md)

The spec spans **six independent subsystems**. Per the writing-plans scope rule, each is its
own plan that produces **working, testable software on its own**, built in dependency order.
Plan 01 is fully detailed in [`2026-06-26-mobile-quick-capture-01-capture-outbox-core.md`](2026-06-26-mobile-quick-capture-01-capture-outbox-core.md).
Plans 02–06 are scoped here and written out when reached (each gets its own
`...-NN-<name>.md` file at full TDD granularity before execution).

## Dependency order

```
01 capture+outbox core (pure TS, @bridge/local)   ← foundation, zero infra, TDD now
        │
        ├──► 03 mobile SQLite local-plane adapter (reuses 01 conformance)
        │
        └──► 04 sync engine (replays outbox → Pipeline action.propose)
                     │
02 Expo app shell + monorepo wiring  ──────────────┤
        │                                          │
        ├──► 05 on-device speech + capture screen ─┤
        │                                          │
        └──► 06 widget native targets (deep-link) ─┘
                     │
                     └──► 07 calendar write-back (opt-in egress, reuses integrations-google)
```

`02` (Expo shell) and `01` are parallelizable. `05`/`06` need `02`. `04` needs `01`+`03`+`02`.
`07` is last (depends on a working capture→commit path).

---

## Plan 01 — Capture + Outbox core  *(DETAILED — see separate file)*

- **Package:** `@bridge/local` (extend; pure TS, zero infra).
- **Deliverable:** `CaptureDraft` + `OutboxRecord` types, `OutboxStore` port, `InMemoryOutboxStore`
  adapter, and an **exported conformance suite** (`runOutboxConformance`) that Plan 03's SQLite
  adapter re-runs unchanged.
- **Acceptance:** `node --test` green; idempotent enqueue (dup ULID = no-op), FIFO `listPending`
  with backoff, `markSynced`/`markFailed` transitions covered.

## Plan 02 — Expo app shell + monorepo wiring  *(DETAILED — see [`...-02-expo-shell.md`](2026-06-26-mobile-quick-capture-02-expo-shell.md))*

- **Create:** `platform/apps/mobile` (Expo, RN, TS) — auto-covered by the `apps/*` workspace glob (no `pnpm-workspace.yaml`/`turbo.json` edits needed).
- **Scope:** boots a blank app importing a shared `@bridge/*` package (proves cross-package
  resolution under Metro), `bridge://` deep-link scheme registered, EAS build config, CI typecheck.
- **Acceptance:** `expo start` boots on iOS sim + Android emulator; a smoke test imports
  `@bridge/local` types; deep-link `bridge://capture` opens a placeholder screen.
- **Risk/flag:** Metro vs Vite/tsc resolution of workspace packages; pin transpilation of `@bridge/*`.

## Plan 03 — Mobile SQLite local-plane adapter

- **Create:** `platform/apps/mobile/src/local/sqlite-*.ts` — SQLite (op-sqlite/expo-sqlite +
  SQLCipher) adapters implementing the **existing** `@bridge/local` ports (`SecretStore`,
  `BodyStore`, `LocalGraphStore`) **plus** the Plan 01 `OutboxStore`. Encrypted at rest via OS key.
- **Reuse:** runs the Plan 01 `runOutboxConformance` suite + a port-parity suite mirroring
  `packages/local/test/pglite.test.ts` against SQLite.
- **Acceptance:** conformance green on-device/simulator; **no pgvector** (documented); audio handled
  by a mobile `LocalMediaStore` adapter (existing port, expo-file-system blob).
- **Flag:** SQLCipher key sourced from Keychain/Keystore; no plaintext DB on disk.

## Plan 04 — Sync engine (`@bridge/mobile-sync`)

- **Create:** `platform/apps/mobile/src/sync/*` — drains `OutboxStore.listPending` → tRPC
  `action.propose` (Touchpoint, `source='mobile_capture'`, `plane=local`, ULID idempotency) →
  on success `markSynced`, on failure `markFailed` with exponential backoff.
- **Scope:** connectivity listener, durable resume after app kill, `needs_linking` Signal emission
  for unlinked captures, `possible_duplicate` Signal on provisional-person collision (no auto-merge).
- **Acceptance:** offline→online replay test; double-propose is a Pipeline no-op (ULID); residency
  test proving audio bytes never appear in any `action.propose` payload.

## Plan 05 — On-device speech + capture screen

- **Create:** `bridge-speech` native module (iOS Speech on-device / Android `SpeechRecognizer` +
  Whisper-class fallback) + `apps/mobile/src/screens/Capture.tsx`.
- **Scope:** mic live on entry, streaming transcript → editable field, inline person quick-tag
  (search People cache / create provisional), Save → write CaptureDraft to SQLite + Outbox
  **synchronously** (never blocks on network), calendar opt-in toggle (sets `draft.calendar`).
- **Acceptance:** Save succeeds airplane-mode; STT-unavailable falls back to text; mic-denied
  degrades to text-only. Manual device matrix.

## Plan 06 — Widget native targets

- **Create:** iOS WidgetKit extension + Android Glance widget → deep-link `bridge://capture`.
- **Scope:** one-tap launcher only; no audio, no logic. Display affordance + tap target.
- **Acceptance:** tapping the widget opens the app directly on the live-mic Capture screen, cold and
  warm start.

## Plan 07 — Calendar write-back (opt-in egress)

- **Reuse:** `@bridge/integrations-google` + `CalendarEvent` contract + `external_records` (shipped).
- **Scope:** committed capture with `draft.calendar` → `CalendarEvent` proposal → Pipeline →
  `external:send` agent-floor DENY → **human approve ≥L2** (in-app approval queue) → create event
  (mode `new`) or update event description (mode `attach`); link via `external_records`.
- **Acceptance:** proposal→approve→event (new) and →update (attach) e2e; `external:send` DENY without
  approval; Touchpoint persists even when the calendar proposal is vetoed (no partial GCal state).

---

## Cross-cutting (every plan)

- **Vocabulary:** Person / Memory / Touchpoint / Signal only.
- **Dummy data:** `dummy_`-prefixed fixtures, greppable.
- **Doctrine tests:** `private ∩ egress = none` for audio; Mirror purity (only `PARTICIPATES_IN`
  cross-plane edge); capture commit non-egress (auto-mode eligible), calendar egress (forced ≥L2).
- **Docs protocol:** new/changed surface → update matching `docs/wiki/` page (caveman) + append
  `docs/log.md`; non-trivial calls → ADR in `docs/raw/decisions-log.md`; bugs → `docs/wiki/known-issues.md`.
