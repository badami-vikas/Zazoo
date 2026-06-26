# Mobile Quick-Capture (App + Widget) — Design Spec

**Date:** 2026-06-26
**Status:** Approved (design) → implementation plan next
**Author:** engineering (Bridge AI)

## 1. Goal

A **mobile app + home-screen widget** (Android + iOS) for **recording a quick note the
moment you meet someone**. One tap on the widget opens the app straight into **live
voice capture**; the note is **transcribed on-device**, saved **instantly and offline** as
a **Touchpoint** in an **encrypted on-device local-plane store**, optionally **quick-tagged
to a Person**, and **synced up through the Universal Action Pipeline** when connectivity
returns. Unlinked captures raise a **"needs-linking" Signal**. The user may **opt in** to a
governed **Google Calendar write-back** (new event, or attach to an existing event) that
crosses the gate only with **human approval**.

NOT a CRM. NOT a notes app. Vocabulary is the brand: Person / Memory / Touchpoint / Signal /
Relationship / Community / Initiative. Never Lead / Deal / Contact.

## 2. Non-negotiable doctrine (carried from the platform)

- **The phone is a local-plane node.** Captured notes + audio are **private relationship
  data** (`dataScope: 'private'`). In the plane gate, `private ∩ egress = none` ⇒ the audio
  blob is **structurally unable to cross the gate**. Audio **never leaves the device**.
- **Sync goes UP through the gate, never around it.** The phone commits captures only via
  `action.propose` through the Universal Action Pipeline. Capture is **not** a second
  source-of-truth and does **not** write Supabase directly.
- **Egress is forced-review.** Calendar write-back is `external:send` → **agent-floor DENY** →
  **human approve ≥L2**. Local capture commit is non-egress → eligible for **auto-mode (L1,
  act+notify)** because it is the user's own first-party note (`userDecision='auto'` only if
  the user has put the capture action in their auto-mode allowlist; default-off ⇒ pending_review).
- **Mirror plane stays pure.** A capture writes an **Operational** Touchpoint and links to a
  **Mirror** Person only via the whitelisted **`PARTICIPATES_IN`** cross-plane edge. No
  Op-node pollution of the Mirror.
- **Dummy data is `dummy_`-prefixed.** All seeds/fixtures (sample people, demo captures) carry
  the prefix and are greppable.

## 3. Orientation findings (current state)

- **No mobile client exists.** Bridge is web-only today (React+Vite). This is the **first**
  non-web client surface; it joins the same governance spine, not a new backend.
- **Reused, not forked:**
  - **Pipeline** (`platform/packages/core/pipeline.ts`): `propose(ActionRequest) →
    Proposal → decide(approve|veto|edit) → append-only LedgerEntry`. `resourceType` enum already
    includes `person`, `touchpoint`, `signal`.
  - **Authority resolver + `planeGate`** (`packages/core`): local→egress DENY; cloud
    ceiling-clamped to public; `external:send` agent-floor DENY. Structural, conformance-tested.
  - **Local store seam** (`@bridge/db` `createLocalDb`, pglite): private content already binds
    the local plane via the **same Drizzle ports**. **`LocalMediaStore`** port
    (`put/get/getBlob/list/update/archive`, append-only, no hard delete) already houses private
    blobs with two adapters (pglite `bytea`, browser `idb`).
  - **Calendar Tool** (`@bridge/integrations-google`, shipped 2026-06-24): list + create/modify/
    delete Google Calendar events, **governed round-trip** via the Pipeline; normalized
    **`CalendarEvent`** contract; sync via `integrations` + `integration_sync_state` +
    `external_records` (GCal is local-plane, already synced). 5/5 calendar tests.
  - **tRPC API** (`apps/api`): `action.propose` / `action.decide`, zod validate chokepoint.
- **Gaps this slice fills:**
  - No **SQLite** local-plane adapter (mobile can't run pglite-WASM natively).
  - No **on-device speech** module, no **widget** extension, no **offline outbox/sync** engine.
  - No **People directory cache** for offline quick-tag.

## 4. Decisions (locked through brainstorming)

- **Calendar semantics:** **C always** (every capture is a Touchpoint on Bridge's time-axis) **+
  A/B on opt-in** (A = create a GCal event "Met <Person> — <time>", note in body; B = attach the
  note to an existing event by updating its description). C is local; A/B are governed egress.
- **Person linkage:** **note-first, optional inline quick-tag.** Capture is instant; tagging a
  Person (existing from cache, or a new **provisional** Person) is optional. Unlinked capture ⇒
  a **`needs_linking` Signal**. A provisional Person that later collides with a real one ⇒ a
  **`possible_duplicate` Signal** — **never an auto-merge**.
- **Input modality:** **voice-first**, **on-device transcription** (iOS Speech framework
  on-device; Android `SpeechRecognizer`; **Whisper-class on-device fallback** where the platform
  recognizer is unavailable/poor). Text edit always available as a backstop.
- **Connectivity / residency:** **offline-first; the phone is a real local-plane node.** Captures
  persist on-device in an **encrypted SQLite** store and an **outbox**; commit via Pipeline when
  online.
- **Build approach:** **Expo / React Native** in the `platform/` monorepo (reuse tRPC client,
  contracts, types, `@bridge/*` ports) + **three native slivers**: widget (WidgetKit / Android
  Glance), on-device speech, OS-backed encryption.
- **Widget:** **one-tap capture launcher** → deep-links `bridge://capture` → app opens with mic
  live. Widget displays only; records nothing (OS rule). Glance state = fast-follow.
- **Scope:** **Slice 1 (capture core) + Slice 2 (calendar write-back)** in this spec. Slice 3
  (full E2EE-at-rest, team visibility, richer widget glance) is a later spec.

## 5. Components

1. **Widget** (native — WidgetKit / Android Glance). One-tap affordance → `bridge://capture`.
   No audio, no logic; pure launcher. Two thin native targets.
2. **Capture screen** (`apps/mobile`, RN). Mic live on entry; on-device transcription streams to
   an editable text field; optional inline **person quick-tag** (search People cache / create
   provisional); Save writes to the local store + outbox **synchronously** (never blocks on
   network). Save can never fail for lack of signal.
3. **On-device speech module** (`bridge-speech`, native). Thin RN native module wrapping iOS
   Speech (on-device flag) / Android `SpeechRecognizer`, with a bundled **Whisper-class** fallback.
   Returns transcript text; audio bytes handed to `LocalMediaStore`. **No cloud STT** (would be
   egress of private audio).
4. **On-device local-plane store** (`@bridge/db` SQLite adapter). A **SQLite-backed Drizzle
   adapter implementing the existing local-plane ports** (the same seam pglite/in-memory satisfy).
   **Caveat:** SQLite has no pgvector ⇒ **no on-device semantic search**; embedding/vector work
   happens **after sync** at the main local store. Encrypted at rest via SQLCipher + OS key
   (Keychain / Keystore).
5. **Mobile `LocalMediaStore` adapter** (expo-file-system + SQLite metadata). Implements the
   existing `LocalMediaStore` port for audio blobs. Append-only; **audio never syncs** (stays
   on-device; retention policy in §8).
6. **Outbox + sync engine** (`@bridge/mobile-sync`). Every capture enqueues a durable outbox row
   instantly. When online, the engine replays each as **`action.propose`** through the Pipeline.
   **Idempotent via ULID** ⇒ a double-send is a no-op. Backoff + retry; survives app kill.
7. **People directory cache.** Identity/contact fields sync **down** for offline quick-tag
   (allowed: those fields are global+local per the data-residency rule — everything else stays
   local-only and is never pulled to the phone). Read-only cache; provisional people created
   offline are local until committed.
8. **Calendar write-back** (Slice 2). On opt-in, a capture emits a **`CalendarEvent` proposal** →
   Pipeline → `external:send` agent-floor DENY → **human approve ≥L2** (in-app approval queue, or
   back in web) → `@bridge/integrations-google` creates (A) or updates (B) the event; the
   `external_records` row is the source-of-truth link. Reuses the shipped calendar machinery
   end-to-end.

## 6. Data flow

### 6.1 Capture → Touchpoint (always; offline-first)
```
Widget tap (bridge://capture)
  → Capture screen: mic live → on-device STT → editable transcript (+ optional Person quick-tag)
  → Save: write {Touchpoint draft, optional Person link, audio→LocalMediaStore} to SQLite + Outbox  [synchronous, offline-OK]
  → (online) Sync engine: action.propose(Touchpoint, source='mobile_capture', plane=local, ULID)
      → Pipeline: Authority → Policy(pre) → [auto-mode L1 commit | pending_review]
      → Ledger(append) → Touchpoint committed on main local store
  → If no Person linked: emit Signal(needs_linking, action='link this capture to a Person')
  → If provisional Person collides with existing: emit Signal(possible_duplicate)  [no auto-merge]
```

### 6.2 Calendar write-back (opt-in; governed egress)
```
Capture screen "Add to calendar" toggle (A: new event | B: attach to existing)
  → on commit, emit CalendarEvent proposal (external:send)
  → Pipeline: planeGate → external:send agent-floor DENY → REVIEW GATE (≥L2)
  → Human approve (in-app approval queue / web)
  → integrations-google: create event (A) or update event description (B)
  → external_records row links Touchpoint ↔ GCal event
```

## 7. Data model (reuse-first)

- **Touchpoint** = the meeting note (time-axis). Fields used: `occurred_at`, `body`/content
  (transcript), `source='mobile_capture'`, `device_origin`, optional `person_id`, `plane=local`.
- **Memory** (if the schema separates note-content from interaction-event) carries the transcript;
  Touchpoint is the event. **Exact Touchpoint↔Memory mapping to be confirmed against `SCHEMA.sql`
  during planning** — do not invent fields; reuse what exists.
- **Signal** — `needs_linking` (unlinked capture) and `possible_duplicate` (provisional collision).
  Every Signal carries an action (doctrine).
- **Person (provisional)** — created offline, `dummy_`-free real data but flagged provisional until
  committed; resolved via the existing identity-resolution path on sync (Splink later; manual now).
- **`local_media`** row (existing `LocalMediaStore`) for the audio blob — local-only, never synced.
- **`external_records`** (existing) for the GCal event link.
- **New, mobile-only:** an **outbox** table (durable queue: `ulid`, `payload`, `status`,
  `attempts`, `next_attempt_at`) in the on-device SQLite store. No new cloud tables.

## 8. Error handling & edge cases

- **No signal at capture:** Save is local + synchronous; outbox holds it. Zero data loss.
- **Double-send / retry storm:** ULID idempotency ⇒ commit is a no-op on replay.
- **App killed mid-sync:** outbox is durable; engine resumes on next launch.
- **STT unavailable / poor (locale, device):** fall back to Whisper-class on-device model, then to
  manual text. Never block Save on transcription.
- **Provisional Person later matches a real Person:** `possible_duplicate` Signal for manual
  cleanup — **never auto-merge** (ambiguous-duplicates-as-signals rule).
- **Clock skew across devices:** rely on injected Clock / server-stamped commit; append-only, so
  ordering is non-critical.
- **Calendar approval declined / veto:** Touchpoint still exists (C already committed); only the
  egress event is dropped. No partial GCal state.
- **Audio retention (decision to confirm):** default = **keep audio on-device** (re-transcribe /
  evidence) vs **discard after transcription** (minimize private footprint). Recommend keep-local
  with a user setting; flagged as an open decision for the plan.
- **Permissions denied (mic):** degrade to text-only capture; prompt rationale.

## 9. Testing strategy

- **Local store adapter:** run the **existing local-plane port conformance suite** against the new
  SQLite adapter (strong reuse — same tests pglite/in-memory pass).
- **Outbox/sync engine:** unit tests for offline→online replay, idempotency (double-propose),
  durable resume after kill, backoff.
- **Capture→Touchpoint:** integration test through a real Pipeline (`action.propose` → ledger),
  asserting plane=local, `PARTICIPATES_IN` edge, `needs_linking` Signal on unlinked.
- **Calendar write-back:** reuse `@bridge/integrations-google` tests; add a proposal→approve→event
  (A) and proposal→approve→update (B) e2e; assert `external:send` DENY without approval.
- **Native slivers:** smoke tests — widget deep-link resolves to capture; speech module returns a
  transcript; encrypted store opens with OS key. Manual device matrix for mic + widget + offline.
- **Residency assertion:** a test proving audio bytes never appear in any egress/`action.propose`
  payload (private ∩ egress = none).

## 10. Risks & dependencies

- **E2EE-at-rest deferred (Phase 6).** v1 relies on **OS-backed encryption** (SQLCipher + Keychain
  / Keystore). Document the residency gap; full client-side E2EE is Slice 3. **Flagged.**
- **No on-device semantic search** (SQLite lacks pgvector). Acceptable — search runs post-sync at
  the main local store. **Flagged.**
- **On-device STT variance** (locale support, latency, accuracy, model size for Whisper fallback).
  Bundling a model adds app weight. **Flagged.**
- **Expo in a Fastify/Vite TS monorepo** — Metro vs Vite tooling integration, shared-package
  resolution, native build pipeline (EAS). **Flagged for the plan's setup step.**
- **App Store / Play review** for mic usage + widget; clear permission rationale strings.
- **Provisional-person dedup load** — many offline captures could generate duplicate-Signal noise;
  tune thresholds.

## 11. Blast radius (neighbourhood the change touches)

- **Shared contracts** (`CalendarEvent`, Touchpoint/Signal types) — additive only; mobile is a new
  consumer, not a mutator.
- **Pipeline** — a new proposal `source` (`mobile_capture`); no governance change.
- **`@bridge/db` ports** — a new SQLite adapter behind the **existing** ports; pglite/in-memory
  adapters untouched and must still pass conformance.
- **`@bridge/integrations-google`** — reused unchanged for write-back.
- **Mirror plane** — must remain pure; only `PARTICIPATES_IN` cross-plane edge added.

## 12. Out of scope (this spec)

- Full client-side E2EE-at-rest (Slice 3).
- Team/shared visibility of captures (Slice 3 / RLS overlay).
- Rich widget glance (counts, last person) — fast-follow.
- Non-Google calendars / ICS / conference adapters.
- On-device semantic search / retrieval.
