# Camera Tool — Design Spec

**Date:** 2026-06-20
**Status:** Approved (design) → implementation plan next
**Author:** engineering (Bridge AI)

## 1. Goal

A built-in **Camera Tool** that captures **photos and videos**, stores each blob in the
**LOCAL plane only**, surfaces captures in **Resources** as browsable + pending items, and
commits a chosen capture to the graph **only** through a governed, approved Universal Action
Pipeline proposal with an append-only ledger entry. Optional linking of a capture to a
**Person / Memory / Touchpoint** happens only inside the approved proposal.

NOT a CRM feature. Vocabulary is the brand: Person / Memory / Touchpoint / Signal / Initiative.

## 2. Non-negotiable data residency

- Captured photos/videos are **private relationship data**. Every tool capability is
  `dataScope: 'private'`. In the plane gate, `private ∩ egress = none` ⇒ the blob is
  **structurally unable to cross the gate**.
- Blobs + heavy metadata live **only** in a `LocalMediaStore` (local plane). **Never** Supabase
  Storage, never any cloud bucket, never the cloud `files.storage_ref`.
- The cloud canonical (Supabase) receives **nothing about the blob**. Only if an approved
  proposal yields a public/identity-grade fact does dual-write apply — the media itself stays
  local.
- A local-store adapter does **not** exist today (only Drizzle/Supabase + in-memory). This slice
  implements one against the **existing ports** seam.

## 3. Orientation findings (current state)

- **No local-store adapter.** `platform/packages/db` has only `createDrizzlePorts()`
  (Supabase/Postgres); `packages/core/memory/stores.ts` has in-memory adapters. The cloud `files`
  table stores a `storage_ref` text pointer + JSONB metadata — **no blob column**. The prototype
  quarantine (`tool_captures`) is in Supabase (cloud). So today there is nowhere compliant for a
  blob — the documented residency contradiction.
- **Reused, not forked:**
  - Pipeline (`platform/packages/core/pipeline.ts`): `propose(ActionRequest) →
    Proposal(pending_review) → decide(approve|veto|edit) → append-only LedgerEntry`.
    `resourceType` enum already includes `person`, `touchpoint`, `file`, `signal`.
  - Authority resolver + `planeGate` (local→egress DENY; cloud ceiling-clamp to public) are
    structural in core.
  - Ports/adapters seam: `packages/core/ports.ts` + `packages/db` + `wiring.ts`. New ports follow
    the identical "one port, two adapters" pattern (in-memory + Drizzle → now + PGlite + browser).
  - Prototype intake UX is built: `data/toolCaptures.ts`
    (`loadPendingCaptures`/`adoptCapture`→propose/`dismissCapture`/`materializeApprovedCapture`),
    `ToolCapturesPanel` in `ToolDetail.tsx`, `tools.ts` registry (`intake:true`, `native:true`),
    `ApprovalsPage` decide flow, `data/api.ts` (`apiPropose`/`apiDecide`, `VITE_API_URL` falls back
    to direct Supabase).
  - Capture patterns: card-scanner = `getUserMedia` + `canvas.toBlob` (photo); recorder =
    `getUserMedia` + `MediaRecorder` (webm). Both use a `CaptureEnvelope` + `addToBridge`
    quarantine pattern. All native — no capture libs in use today.

## 4. Decisions (locked)

- **Local store: Option A** — a real **PGlite/bytea adapter** in `platform/packages/db` bound to
  the existing ports (the brief's DONE seam, proven by tests), **+** a **browser** adapter
  (PGlite-WASM-over-IndexedDB; raw `idb` fallback) in the prototype so the full
  capture→persist→pending→approve flow demos in-browser with zero infra. One `LocalMediaStore`
  port, two adapters — mirrors the codebase's existing in-memory + Drizzle convention.
- **Scope:** photo **and** video in this slice.
- **OCR:** included now — `tesseract.js`, client-side, local, no API key.
- **Default commit shape:** the capture event commits as a **Touchpoint** ("Captured a
  photo/video — {caption}"); optional link to Person/Memory/Touchpoint is chosen in the proposal.
- **Demo governance:** when the platform API is off, the governed proposal→approve→ledger runs
  **local-in-browser** over the `LocalMediaStore`, mirroring the `Proposal`/`LedgerEntry` contract;
  when `VITE_API_URL` is set, Add-to-Bridge calls the real platform pipeline.

## 5. The `LocalMediaStore` port (the seam)

```ts
export type MediaKind = 'photo' | 'video';
export type MediaStatus = 'pending' | 'committed' | 'archived';

export interface MediaCaptureRecord {
  id: string;
  workspaceId: string;
  kind: MediaKind;
  mimeType: string;
  byteSize: number;
  width?: number;
  height?: number;
  durationSeconds?: number;       // video
  caption?: string;
  ocrText?: string;               // photo OCR, local only
  thumbnailDataUrl?: string;      // small, local; for browse/pending list
  status: MediaStatus;
  ledgerId?: string;              // set on commit
  linkedEntity?: { type: 'person' | 'memory' | 'touchpoint'; id: string } | null;
  provenance: { tool: string; version: string; model?: string };
  capturedAt: string;            // ISO
  archivedAt?: string | null;
}

export interface LocalMediaStore {
  put(rec: MediaCaptureRecord, blob: Uint8Array): Promise<MediaCaptureRecord>;
  get(id: string): Promise<MediaCaptureRecord | null>;
  getBlob(id: string): Promise<Uint8Array | null>;   // never leaves the local plane
  list(filter?: { status?: MediaStatus; kind?: MediaKind; workspaceId?: string }): Promise<MediaCaptureRecord[]>;
  update(id: string, patch: Partial<MediaCaptureRecord>): Promise<MediaCaptureRecord>;
  archive(id: string): Promise<void>;                // soft-delete (archived_at); no hard delete
}
```

Append-only discipline: blob + core metadata immutable after `put`; only `status`/`ledgerId`/
`linkedEntity`/`caption`/`archivedAt` mutate. No hard delete.

## 6. Surfaces & components

**`platform/packages/core`**
- `ports.ts`: add `LocalMediaStore` + types above.
- `memory/stores.ts`: `InMemoryMediaStore` (tests / zero-infra boot).
- A `mapCaptureToTouchpoint` skill + `media.v1` output contract: maps a **no-blob**
  `ActionRequest` (carrying `local_media_id`, caption, ocrText, optional chosen link) to a
  Touchpoint (+ optional Person/Memory link). Validates via zod at the propose chokepoint.

**`platform/packages/db`**
- `media-store.ts`: `PgliteMediaStore` (PGlite + `drizzle-orm/pglite`), local `media_captures`
  table with `blob bytea`. Local pglite db file/dir, never cloud.
- `schema.ts`: `media_captures` table (local-plane).
- Wire into `createDrizzlePorts()` / `wiring.ts` next to the ledger store.

**Prototype `Design Bridge AI Interface (Copy)/`**
- `data/localMedia.ts`: browser `LocalMediaStore` adapter (PGlite-WASM-over-IDB; `idb` fallback) +
  capture-record helpers, all `dummy_`-prefixed for any seed.
- `components/tools/camera/Camera.tsx`: native capture — photo (`getUserMedia` + `canvas.toBlob`),
  video (`MediaRecorder`); compress photos with `browser-image-compression`; OCR with
  `tesseract.js`; persist via `localMedia` → `pending`.
- `data/tools.ts`: register `camera` (`native:true`, `intake:true`).
- `ToolDetail.tsx`: mount `<Camera />`; show camera pending captures from the **local store** (not
  Supabase).
- `ResourcesPage.tsx`: add a browsable **Captures** section (local store) + a pending-captures row
  with per-item Add / Dismiss.
- Add-to-Bridge: build a `media.v1` proposal (no blob; `local_media_id` + facts). `VITE_API_URL`
  set → `apiPropose`; else local-in-browser intake ledger mirroring `Proposal`/`LedgerEntry`.
- `ApprovalsPage.tsx`: surface local camera proposals; approve → append-only ledger +
  Touchpoint materializes; media row `pending → committed` with `ledger_id`.

## 7. Governance flow (camera capture)

1. Capture → compress (photo) / record (video) → OCR (photo) → `LocalMediaStore.put` → `pending`
   (quarantine; capture ≠ commit).
2. Browsable in Resources + pending list (Camera panel + Resources pending row).
3. "Add to Bridge" → `media.v1` proposal (typed output contract). Blob stays local; proposal
   carries `local_media_id` + non-blob facts + optional chosen link.
4. Review in Approvals → approve / veto / edit.
5. Approve → `decide` → append-only **LedgerEntry** + commit Touchpoint (+ optional link); media
   row `pending → committed` with `ledger_id`. Blob still local.
6. **Uncertain person match → never auto-link**; file a `possible_link` manual-confirmation
   **Signal** (ambiguous-duplicates rule).
7. No hard delete — `archive()` sets `archived_at`.

## 8. Tool manifest (`camera`)

- `run_modes: ['account_bound']` (private capture; standalone shareable-link deferred).
- `model_bindings: [{ use: 'ocr', plane_default: 'local' }]` (tesseract local).
- `capabilities` (all `dataScope:'private', egress:false`): `file:write` (the **local-plane**
  media record — never a cloud File row), `touchpoint:write`, `person:write` (link only),
  `signal:write` (possible_link). The graph commit itself is a **Touchpoint**; the blob/File
  reference stays local.
- `output_contract`: capture event → **Touchpoint**; optional subject → **Person** (link only,
  never auto; uncertain → Signal); optional attach → **Memory**/existing Touchpoint; ocr text →
  Touchpoint notes.
- `intake_policy: { quarantine:true, commit_via:'pipeline_proposal', scope:'private',
  account_bound_only:true }`.

## 9. Trust-first consent

If a capture links to another Person (or a face is present), the proposal surfaces a
**both-party-consent** acknowledgment before commit. Private-by-default; local-only blob means
Bridge holds nothing about it in the cloud.

## 10. Testing & verification

- **Platform (vitest/node):** `PgliteMediaStore` put/get/getBlob/list/update/archive, bytea
  round-trip, append-only / no-hard-delete; pipeline test: no-blob `media.v1` propose →
  pending_review → decide approve → ledger appended; veto path; uncertain-person → Signal;
  `private ∩ egress = none` rejection if an egress is attempted.
- **Prototype (preview workflow):** click-through capture → compress/OCR → local persist → pending
  in Resources → Add to Bridge → Approvals → approve → ledger + Touchpoint, demonstrated via the
  preview tools (screenshot/snapshot proof).

## 11. Dependencies

- Prototype: `browser-image-compression`, `tesseract.js`, `@electric-sql/pglite` (or `idb`).
- Platform: `@electric-sql/pglite`.
- Capture stays native (`getUserMedia` + `MediaRecorder`); `react-webcam` / `react-media-recorder`
  noted as optional alternatives, not adopted (fewer deps, consistent with internalized tools).

## 12. Conventions

Vocabulary fixed (Person/Memory/Touchpoint/Signal/Initiative; never Lead/Deal/Pipeline/Contact).
All mutation via the Pipeline; agents draft, humans approve. Ledger/timeline append-only; no hard
delete (`archived_at`). Every mock/demo/seed value `dummy_`-prefixed.

## 13. Docs (after build)

Update `docs/wiki/tools.md` (camera entry) + a `LocalMediaStore` note in
`docs/wiki/architecture.md`, both **caveman style** (invoke `caveman` skill); append `docs/log.md`.

## 14. Out of scope (this slice)

Standalone shareable-link camera mode; cloud vision enrichment (egress); face detection/recognition
(consent prompt is manual); E2EE-at-rest (Phase 6); video transcription.
