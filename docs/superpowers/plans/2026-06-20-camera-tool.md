# Camera Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A built-in Camera Tool that captures photo + video, persists each blob to the LOCAL plane (zero cloud), surfaces captures in Resources as pending items, and commits a chosen capture to the graph only via an approved governed proposal with an append-only ledger entry.

**Architecture:** One new `LocalMediaStore` port, two adapters (PGlite in `platform/packages/db`, IndexedDB in the prototype) — mirroring the codebase's existing in-memory+Drizzle convention. Media is `dataScope:'private'`, so `private ∩ egress = none` structurally bars the blob from the gate. Capture ≠ commit: a capture lands `pending` in the local store; "Add to Bridge" raises a `media.v1` proposal (no blob — only a `local_media_id` + facts) → review → approve → append-only ledger + a Touchpoint. The prototype demo runs the governed propose→decide→ledger locally in-browser; when `VITE_API_URL` is set it calls the real platform pipeline.

**Tech Stack:** TS. Platform: `@bridge/core` (Node `node:test`), `@bridge/db` (+ `@electric-sql/pglite`). Prototype: React 18 + Vite, `idb`, `browser-image-compression`, `tesseract.js`, native `getUserMedia`/`MediaRecorder`.

**Conventions:** Vocabulary = Person/Memory/Touchpoint/Signal/Initiative (never Lead/Deal/Pipeline/Contact). All mutation via the pipeline; agents draft, humans approve. Ledger/timeline append-only; no hard delete (`archived_at`). Every mock/demo/seed value `dummy_`-prefixed. Run `cd platform && pnpm build` then `pnpm -C platform/packages/core test` for core; `pnpm -C platform/packages/db build && node --test platform/packages/db/dist/test/*.test.js` for db.

---

## File structure

**Platform — `platform/packages/core/`**
- `src/ports.ts` (modify): add `LocalMediaStore` interface + `MediaCaptureRecord` / `MediaKind` / `MediaStatus` types.
- `src/index.ts` (modify): nothing new (ports re-exported via `export * from "./ports.js"`); add `export * from "./skills.js"`.
- `src/skills.ts` (create): the `stageCapture` Skill (maps a `media.v1` capture envelope → a Touchpoint proposed output).
- `src/memory/stores.ts` (modify): add `InMemoryMediaStore`.
- `test/media-store.test.ts` (create): `InMemoryMediaStore` conformance.
- `test/capture-pipeline.test.ts` (create): `stageCapture` through the pipeline (propose→approve→ledger; veto; uncertain→Signal; egress denied).

**Platform — `platform/packages/db/`**
- `package.json` (modify): add `@electric-sql/pglite`; add `test` script.
- `tsconfig.json` (modify): include `test/**/*.ts`.
- `src/media-store.ts` (create): `PgliteMediaStore` (pglite, `media_captures` table, `blob bytea`) + `createLocalMediaStore()`.
- `src/index.ts` (modify): export `PgliteMediaStore`, `createLocalMediaStore`.
- `test/media-store.test.ts` (create): blob bytea round-trip + append-only + archive.

**Platform — `platform/apps/api/`**
- `src/wiring.ts` (modify): register `stageCapture` skill; expose `localMedia` on `Wiring` (PgliteMediaStore when `LOCAL_MEDIA_DIR` set, else `InMemoryMediaStore`).

**Prototype — `Design Bridge AI Interface (Copy)/`**
- `package.json` (modify): add `idb`, `browser-image-compression`, `tesseract.js`.
- `src/app/data/localMedia.ts` (create): browser `LocalMediaStore` (idb) + the local-plane intake module (`proposeCapture`/`decideCapture`/`listProposals`/`listLedger`/`listCaptures`/`flagPossibleLink`).
- `src/app/components/tools/camera/Camera.tsx` (create): capture UI (photo + video) → compress → OCR → local persist.
- `src/app/components/tools/camera/CameraCaptures.tsx` (create): pending captures + Add to Bridge + inline Review (approve/veto) + committed list.
- `src/app/data/tools.ts` (modify): register the `camera` tool.
- `src/app/pages/ToolDetail.tsx` (modify): mount `<Camera />` for `camera`; render `<CameraCaptures />` instead of the Supabase `ToolCapturesPanel` for `camera`.
- `src/app/pages/ResourcesPage.tsx` (modify): add a browsable "Captures" section reading `localMedia`.

**Docs**
- `docs/wiki/tools.md` (modify, caveman) + `docs/wiki/architecture.md` (modify, caveman: `LocalMediaStore` note) + `docs/log.md` (append).

---

## Task 1: `LocalMediaStore` port + types + in-memory adapter (core)

**Files:**
- Modify: `platform/packages/core/src/ports.ts`
- Modify: `platform/packages/core/src/index.ts`
- Modify: `platform/packages/core/src/memory/stores.ts`
- Test: `platform/packages/core/test/media-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `platform/packages/core/test/media-store.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryMediaStore, type MediaCaptureRecord } from "../src/index.js";

const WS = "ws-1";
function rec(partial: Partial<MediaCaptureRecord> = {}): MediaCaptureRecord {
  return {
    id: "m1",
    workspaceId: WS,
    kind: "photo",
    mimeType: "image/jpeg",
    byteSize: 3,
    status: "pending",
    provenance: { tool: "camera", version: "1.0.0" },
    capturedAt: "2026-06-20T00:00:00.000Z",
    ...partial,
  };
}

test("put then get round-trips the record and the blob (local plane)", async () => {
  const s = new InMemoryMediaStore();
  const blob = new Uint8Array([1, 2, 3]);
  await s.put(rec(), blob);
  const got = await s.get("m1");
  assert.equal(got?.kind, "photo");
  assert.deepEqual(await s.getBlob("m1"), blob);
});

test("list filters by status and kind", async () => {
  const s = new InMemoryMediaStore();
  await s.put(rec({ id: "a", kind: "photo", status: "pending" }), new Uint8Array([1]));
  await s.put(rec({ id: "b", kind: "video", status: "committed" }), new Uint8Array([2]));
  assert.deepEqual((await s.list({ status: "pending" })).map((r) => r.id), ["a"]);
  assert.deepEqual((await s.list({ kind: "video" })).map((r) => r.id), ["b"]);
});

test("update mutates status/ledgerId but never the blob; archive is soft", async () => {
  const s = new InMemoryMediaStore();
  await s.put(rec({ id: "a" }), new Uint8Array([9]));
  const updated = await s.update("a", { status: "committed", ledgerId: "led-1" });
  assert.equal(updated.status, "committed");
  assert.equal(updated.ledgerId, "led-1");
  assert.deepEqual(await s.getBlob("a"), new Uint8Array([9])); // blob immutable
  await s.archive("a");
  const got = await s.get("a");
  assert.equal(got?.status, "archived");
  assert.ok(got?.archivedAt); // soft-delete, row still present
});

test("put is append-only: a duplicate id throws", async () => {
  const s = new InMemoryMediaStore();
  await s.put(rec({ id: "dup" }), new Uint8Array([1]));
  await assert.rejects(() => s.put(rec({ id: "dup" }), new Uint8Array([2])), /duplicate/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd platform && pnpm -C packages/core build 2>&1 | head -20`
Expected: FAIL — `InMemoryMediaStore` / `MediaCaptureRecord` not exported (TS2305 / build error).

- [ ] **Step 3: Add the port + types to `ports.ts`**

Append to `platform/packages/core/src/ports.ts` (after the `LedgerStore` interface, before `EventBus`):

```ts
/** Media capture kind — photo or video. */
export type MediaKind = "photo" | "video";
/** Lifecycle of a local capture: quarantined → committed (via approved proposal) → archived. */
export type MediaStatus = "pending" | "committed" | "archived";

/**
 * A captured photo/video record. Private relationship data — lives in the LOCAL
 * plane ONLY (never Supabase/cloud). The blob is stored alongside via the store's
 * put/getBlob; the cloud canonical receives nothing about it.
 */
export interface MediaCaptureRecord {
  id: string;
  workspaceId: string;
  kind: MediaKind;
  mimeType: string;
  byteSize: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  caption?: string;
  ocrText?: string;
  /** Small inline preview for browse/pending lists — local only. */
  thumbnailDataUrl?: string;
  status: MediaStatus;
  /** Set when an approved proposal commits the capture. */
  ledgerId?: string;
  linkedEntity?: { type: "person" | "memory" | "touchpoint"; id: string } | null;
  provenance: { tool: string; version: string; model?: string };
  capturedAt: string;
  archivedAt?: string | null;
}

/**
 * LOCAL-plane media store — the seam the camera Tool persists blobs through. The
 * in-memory adapter lives in `memory/stores.ts`; the pglite (bytea) adapter lives
 * in `@bridge/db`. Blobs NEVER cross the gate. Append-only: a row's blob + core
 * metadata are immutable after `put`; only status/ledgerId/linkedEntity/caption/
 * archivedAt mutate. No hard delete — `archive()` sets `archivedAt`.
 */
export interface LocalMediaStore {
  put(rec: MediaCaptureRecord, blob: Uint8Array): Promise<MediaCaptureRecord>;
  get(id: string): Promise<MediaCaptureRecord | null>;
  getBlob(id: string): Promise<Uint8Array | null>;
  list(filter?: { status?: MediaStatus; kind?: MediaKind; workspaceId?: string }): Promise<MediaCaptureRecord[]>;
  update(id: string, patch: Partial<MediaCaptureRecord>): Promise<MediaCaptureRecord>;
  archive(id: string): Promise<void>;
}
```

- [ ] **Step 4: Add `InMemoryMediaStore` to `memory/stores.ts`**

In `platform/packages/core/src/memory/stores.ts`, add `LocalMediaStore`, `MediaCaptureRecord` to the `import type { ... } from "../ports.js"` block, then append this class at the end of the file:

```ts
export class InMemoryMediaStore implements LocalMediaStore {
  readonly records = new Map<string, MediaCaptureRecord>();
  readonly blobs = new Map<string, Uint8Array>();

  async put(rec: MediaCaptureRecord, blob: Uint8Array): Promise<MediaCaptureRecord> {
    if (this.records.has(rec.id)) {
      throw new Error(`media: duplicate id ${rec.id} (append-only violation)`);
    }
    this.records.set(rec.id, { ...rec });
    this.blobs.set(rec.id, blob);
    return { ...rec };
  }
  async get(id: string): Promise<MediaCaptureRecord | null> {
    const r = this.records.get(id);
    return r ? { ...r } : null;
  }
  async getBlob(id: string): Promise<Uint8Array | null> {
    return this.blobs.get(id) ?? null;
  }
  async list(filter?: { status?: MediaStatus; kind?: MediaKind; workspaceId?: string }): Promise<MediaCaptureRecord[]> {
    return [...this.records.values()]
      .filter((r) => (filter?.status ? r.status === filter.status : true))
      .filter((r) => (filter?.kind ? r.kind === filter.kind : true))
      .filter((r) => (filter?.workspaceId ? r.workspaceId === filter.workspaceId : true))
      .map((r) => ({ ...r }));
  }
  async update(id: string, patch: Partial<MediaCaptureRecord>): Promise<MediaCaptureRecord> {
    const r = this.records.get(id);
    if (!r) throw new Error(`media: no record ${id}`);
    // Blob + identity fields are immutable; ignore any attempt to change them.
    const next: MediaCaptureRecord = {
      ...r,
      ...patch,
      id: r.id,
      workspaceId: r.workspaceId,
      kind: r.kind,
      mimeType: r.mimeType,
      byteSize: r.byteSize,
    };
    this.records.set(id, next);
    return { ...next };
  }
  async archive(id: string): Promise<void> {
    const r = this.records.get(id);
    if (!r) throw new Error(`media: no record ${id}`);
    this.records.set(id, { ...r, status: "archived", archivedAt: "1970-01-01T00:00:00.000Z" });
  }
}
```

Also add the `MediaStatus`, `MediaKind` names to the same `import type` block.

> Note: `archive()` stamps a sentinel ISO so the adapter stays clock-free (callers that need a real timestamp pass one via `update`). The browser adapter (Task 6) stamps a real time.

- [ ] **Step 5: Add the skills barrel export to `index.ts`**

In `platform/packages/core/src/index.ts`, add after the `export * from "./memory/stores.js";` line:

```ts
export * from "./skills.js";
```

(Task 2 creates `skills.ts`. If running Task 1 alone, instead create an empty `platform/packages/core/src/skills.ts` containing `export {};` so the build passes; Task 2 fills it.)

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd platform && pnpm -C packages/core build && node --test packages/core/dist/test/media-store.test.js`
Expected: PASS — 4 tests pass.

- [ ] **Step 7: Commit**

```bash
git add "platform/packages/core/src/ports.ts" "platform/packages/core/src/index.ts" "platform/packages/core/src/memory/stores.ts" "platform/packages/core/src/skills.ts" "platform/packages/core/test/media-store.test.ts"
git commit -m "feat(core): LocalMediaStore port + InMemoryMediaStore (local-plane blobs)"
```

---

## Task 2: `stageCapture` skill + capture pipeline test (core)

**Files:**
- Create/replace: `platform/packages/core/src/skills.ts`
- Test: `platform/packages/core/test/capture-pipeline.test.ts`

The capture commit is a Touchpoint. `stageCapture` takes the `media.v1` inputs (a no-blob envelope referencing `local_media_id`) and produces the proposed Touchpoint output.

- [ ] **Step 1: Write the failing test**

Create `platform/packages/core/test/capture-pipeline.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FixedClock, SeededRng, UuidGen,
  UniversalActionPipeline,
  InMemoryRoleStore, InMemoryAgentStore, InMemoryEphemeralStore,
  InMemoryPolicyStore, InMemoryLedger, InMemoryEventBus,
  InMemorySkillRegistry, RecordingVarianceAdjuster,
  stageCapture,
  type RunCtx, type ActionRequest,
} from "../src/index.js";

const WS = "ws-1";
const USER = "u1";

function harness() {
  const roles = new InMemoryRoleStore();
  const agents = new InMemoryAgentStore();
  const ephemeral = new InMemoryEphemeralStore();
  const policies = new InMemoryPolicyStore([]);
  const ledger = new InMemoryLedger();
  const events = new InMemoryEventBus();
  const skills = new InMemorySkillRegistry().register(stageCapture);
  const variance = new RecordingVarianceAdjuster();
  const pipeline = new UniversalActionPipeline({
    authority: { roles, agents, ephemeral, nowISO: "" }, policies, skills, ledger, events, variance,
  });
  // The signed-in user may write touchpoints + signals on the private tier.
  roles.direct.set(`user:${USER}`, [
    { resourceType: "touchpoint", resourceId: null, action: "write", effect: "allow", dataScope: "private" },
    { resourceType: "signal", resourceId: null, action: "write", effect: "allow", dataScope: "private" },
  ]);
  return { roles, agents, ledger, events, pipeline };
}
function ctx(): RunCtx {
  const c = new FixedClock("2026-06-20T00:00:00.000Z");
  const r = new SeededRng(7);
  return { clock: c, rng: r, ids: new UuidGen(c, r) };
}
function captureReq(partial: Partial<ActionRequest> = {}): ActionRequest {
  return {
    workspaceId: WS,
    actor: { type: "user", id: USER, plane: "local" },
    action: "write",
    resourceType: "touchpoint",
    dataScope: "private",
    skill: "stageCapture",
    inputs: { local_media_id: "m1", kind: "photo", caption: "dummy_whiteboard", ocrText: "dummy_roadmap Q3" },
    ...partial,
  };
}

test("stageCapture proposes a Touchpoint referencing the local media id (no blob)", async () => {
  const h = harness();
  const c = ctx();
  // A human with an allow grant + no policy auto-applies; assert the proposed Touchpoint shape.
  const p = await h.pipeline.propose(captureReq(), c);
  assert.equal(p.status, "applied");
  const out = p.output?.proposedOutput as Record<string, unknown>;
  assert.equal(out.type, "touchpoint");
  assert.equal(out.local_media_id, "m1");
  assert.match(String(out.text), /Captured a photo/);
  // The blob is never in the output/ledger — only a local reference.
  assert.equal(JSON.stringify(p.output).includes("blob"), false);
});

test("agent capture drafts for review, approve appends a ledger decision row", async () => {
  const h = harness();
  h.agents.assumed.set("cam-agent", "role-cam");
  h.agents.scope.set("cam-agent", ["touchpoint:write"]);
  h.agents.tiers.set("cam-agent", "private");
  h.roles.roleGrants.set("role-cam", [
    { resourceType: "touchpoint", resourceId: null, action: "write", effect: "allow", dataScope: "private" },
  ]);
  const c = ctx();
  const p = await h.pipeline.propose(
    captureReq({ actor: { type: "agent", id: "cam-agent", plane: "local" } }), c,
  );
  assert.equal(p.status, "pending_review");
  const decided = await h.pipeline.decide(p.id, "approve", c);
  assert.equal(decided.status, "applied");
  assert.equal(h.ledger.entries.length, 2); // proposal + decision (append-only)
  assert.equal(h.ledger.entries[1]!.userDecision, "approve");
});

test("local plane may not egress: external:fetch is denied (private cannot cross the gate)", async () => {
  const h = harness();
  const c = ctx();
  const p = await h.pipeline.propose(
    captureReq({ resourceType: "external:fetch", action: "execute", skill: "stageCapture" }), c,
  );
  assert.equal(p.status, "rejected");
  assert.match(p.rejectionReason ?? "", /local-first gate|local plane may not reach/);
});

test("uncertain person link is filed as a Signal, never an auto person-link", async () => {
  const h = harness();
  const c = ctx();
  // A possible_link Signal is a separate governed proposal (resourceType signal).
  const p = await h.pipeline.propose(
    captureReq({
      resourceType: "signal",
      skill: "stageCapture",
      inputs: { local_media_id: "m1", kind: "photo", signal: "possible_link", candidate: "dummy_Asha Rao" },
    }),
    c,
  );
  assert.equal(p.status, "applied");
  const out = p.output?.proposedOutput as Record<string, unknown>;
  assert.equal(out.type, "signal");
  assert.equal(out.signal, "possible_link");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd platform && pnpm -C packages/core build 2>&1 | head -20`
Expected: FAIL — `stageCapture` not exported.

- [ ] **Step 3: Implement `stageCapture`**

Replace `platform/packages/core/src/skills.ts` with:

```ts
/**
 * Capture skills — map a no-blob `media.v1` capture envelope to a proposed graph
 * output. The blob NEVER enters the pipeline: inputs carry only `local_media_id`
 * + facts (caption, ocrText, optional link). The capture event commits as a
 * Touchpoint; an uncertain person match is filed as a `possible_link` Signal,
 * never an auto person-link (ambiguous-duplicates rule).
 */
import type { Skill } from "./ports.js";

interface CaptureInputs {
  local_media_id: string;
  kind?: "photo" | "video";
  caption?: string;
  ocrText?: string;
  link?: { type: "person" | "memory" | "touchpoint"; id: string };
  signal?: string;
  candidate?: string;
}

export const stageCapture: Skill = {
  name: "stageCapture",
  async run(inputs) {
    const i = (inputs ?? {}) as CaptureInputs;
    // Signal path: an uncertain match → a possible_link Signal (manual confirmation).
    if (i.signal) {
      return {
        proposedOutput: {
          type: "signal",
          signal: i.signal,
          local_media_id: i.local_media_id,
          candidate: i.candidate ?? null,
          text: `Possible link for a capture — confirm manually${i.candidate ? `: ${i.candidate}` : ""}`,
        },
        diff: { to: { signal: i.signal, candidate: i.candidate ?? null } },
      };
    }
    const noun = i.kind === "video" ? "video" : "photo";
    const text = `Captured a ${noun}${i.caption ? ` — ${i.caption}` : ""}`;
    return {
      proposedOutput: {
        type: "touchpoint",
        text,
        local_media_id: i.local_media_id,
        ...(i.ocrText ? { notes: i.ocrText } : {}),
        ...(i.link ? { link: i.link } : {}),
      },
      diff: { to: { text, local_media_id: i.local_media_id } },
    };
  },
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd platform && pnpm -C packages/core build && node --test packages/core/dist/test/capture-pipeline.test.js`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Run the full core suite (no regressions)**

Run: `cd platform && node --test packages/core/dist/test/*.test.js`
Expected: PASS — existing pipeline/conformance tests + the 2 new media tests all pass.

- [ ] **Step 6: Commit**

```bash
git add "platform/packages/core/src/skills.ts" "platform/packages/core/test/capture-pipeline.test.ts"
git commit -m "feat(core): stageCapture skill — media.v1 capture → Touchpoint/Signal proposal (no blob)"
```

---

## Task 3: `PgliteMediaStore` adapter (db, the real local-plane seam)

**Files:**
- Modify: `platform/packages/db/package.json`
- Modify: `platform/packages/db/tsconfig.json`
- Create: `platform/packages/db/src/media-store.ts`
- Modify: `platform/packages/db/src/index.ts`
- Test: `platform/packages/db/test/media-store.test.ts`

- [ ] **Step 1: Add the dep + test wiring**

In `platform/packages/db/package.json`, add to `dependencies`:

```json
"@electric-sql/pglite": "^0.2.17"
```

and add to `scripts`:

```json
"test": "node --test dist/test/*.test.js"
```

In `platform/packages/db/tsconfig.json`, change the `include` line to:

```json
"include": ["src/**/*.ts", "test/**/*.ts"]
```

Then install:

Run: `cd platform && pnpm install`
Expected: pglite added to the lockfile.

- [ ] **Step 2: Write the failing test**

Create `platform/packages/db/test/media-store.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { PgliteMediaStore } from "../src/index.js";
import type { MediaCaptureRecord } from "@bridge/core";

function rec(partial: Partial<MediaCaptureRecord> = {}): MediaCaptureRecord {
  return {
    id: "m1", workspaceId: "ws-1", kind: "photo", mimeType: "image/jpeg",
    byteSize: 4, status: "pending",
    provenance: { tool: "camera", version: "1.0.0" },
    capturedAt: "2026-06-20T00:00:00.000Z", ...partial,
  };
}

test("pglite store round-trips the record and the bytea blob (local, never cloud)", async () => {
  const s = await PgliteMediaStore.create(); // in-memory pglite
  const blob = new Uint8Array([10, 20, 30, 40]);
  await s.put(rec(), blob);
  const got = await s.get("m1");
  assert.equal(got?.kind, "photo");
  assert.deepEqual(await s.getBlob("m1"), blob);
  await s.close();
});

test("list filters; update flips status without touching the blob; archive is soft", async () => {
  const s = await PgliteMediaStore.create();
  await s.put(rec({ id: "a", status: "pending" }), new Uint8Array([1]));
  await s.put(rec({ id: "b", kind: "video", status: "committed" }), new Uint8Array([2]));
  assert.deepEqual((await s.list({ status: "pending" })).map((r) => r.id), ["a"]);
  const up = await s.update("a", { status: "committed", ledgerId: "led-1" });
  assert.equal(up.status, "committed");
  assert.deepEqual(await s.getBlob("a"), new Uint8Array([1]));
  await s.archive("a");
  assert.equal((await s.get("a"))?.status, "archived");
  await s.close();
});

test("append-only: duplicate id throws", async () => {
  const s = await PgliteMediaStore.create();
  await s.put(rec({ id: "dup" }), new Uint8Array([1]));
  await assert.rejects(() => s.put(rec({ id: "dup" }), new Uint8Array([2])), /duplicate|unique/i);
  await s.close();
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd platform && pnpm -C packages/db build 2>&1 | head -20`
Expected: FAIL — `PgliteMediaStore` not exported.

- [ ] **Step 4: Implement `PgliteMediaStore`**

Create `platform/packages/db/src/media-store.ts`:

```ts
/**
 * PgliteMediaStore — the LOCAL-plane media adapter binding the core `LocalMediaStore`
 * port. PGlite = Postgres-in-process (WASM); the blob is a `bytea` column in a LOCAL
 * pglite database (in-memory for tests, a data dir in prod via `dataDir`). This store
 * is the customer-controlled local tier: blobs NEVER reach Supabase/cloud. Append-only
 * (PRIMARY KEY blocks duplicate ids); no hard delete (`archive()` sets archived_at).
 */
import { PGlite } from "@electric-sql/pglite";
import type { LocalMediaStore, MediaCaptureRecord, MediaKind, MediaStatus } from "@bridge/core";

const DDL = `
CREATE TABLE IF NOT EXISTS media_captures (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  kind text NOT NULL,
  mime_type text NOT NULL,
  byte_size integer NOT NULL,
  width integer,
  height integer,
  duration_seconds double precision,
  caption text,
  ocr_text text,
  thumbnail_data_url text,
  status text NOT NULL,
  ledger_id text,
  linked_entity jsonb,
  provenance jsonb NOT NULL,
  captured_at text NOT NULL,
  archived_at text,
  blob bytea NOT NULL
);
`;

interface Row {
  id: string; workspace_id: string; kind: string; mime_type: string; byte_size: number;
  width: number | null; height: number | null; duration_seconds: number | null;
  caption: string | null; ocr_text: string | null; thumbnail_data_url: string | null;
  status: string; ledger_id: string | null; linked_entity: unknown; provenance: unknown;
  captured_at: string; archived_at: string | null;
}

function toRecord(r: Row): MediaCaptureRecord {
  return {
    id: r.id, workspaceId: r.workspace_id, kind: r.kind as MediaKind, mimeType: r.mime_type,
    byteSize: r.byte_size,
    ...(r.width != null ? { width: r.width } : {}),
    ...(r.height != null ? { height: r.height } : {}),
    ...(r.duration_seconds != null ? { durationSeconds: r.duration_seconds } : {}),
    ...(r.caption != null ? { caption: r.caption } : {}),
    ...(r.ocr_text != null ? { ocrText: r.ocr_text } : {}),
    ...(r.thumbnail_data_url != null ? { thumbnailDataUrl: r.thumbnail_data_url } : {}),
    status: r.status as MediaStatus,
    ...(r.ledger_id != null ? { ledgerId: r.ledger_id } : {}),
    linkedEntity: (r.linked_entity as MediaCaptureRecord["linkedEntity"]) ?? null,
    provenance: r.provenance as MediaCaptureRecord["provenance"],
    capturedAt: r.captured_at,
    ...(r.archived_at != null ? { archivedAt: r.archived_at } : {}),
  };
}

export class PgliteMediaStore implements LocalMediaStore {
  #pg: PGlite;
  private constructor(pg: PGlite) { this.#pg = pg; }

  /** Create + migrate. `dataDir` undefined => in-memory (tests). */
  static async create(dataDir?: string): Promise<PgliteMediaStore> {
    const pg = dataDir ? new PGlite(dataDir) : new PGlite();
    await pg.exec(DDL);
    return new PgliteMediaStore(pg);
  }
  async close(): Promise<void> { await this.#pg.close(); }

  async put(rec: MediaCaptureRecord, blob: Uint8Array): Promise<MediaCaptureRecord> {
    try {
      await this.#pg.query(
        `INSERT INTO media_captures
          (id, workspace_id, kind, mime_type, byte_size, width, height, duration_seconds,
           caption, ocr_text, thumbnail_data_url, status, ledger_id, linked_entity,
           provenance, captured_at, archived_at, blob)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [
          rec.id, rec.workspaceId, rec.kind, rec.mimeType, rec.byteSize,
          rec.width ?? null, rec.height ?? null, rec.durationSeconds ?? null,
          rec.caption ?? null, rec.ocrText ?? null, rec.thumbnailDataUrl ?? null,
          rec.status, rec.ledgerId ?? null,
          rec.linkedEntity ? JSON.stringify(rec.linkedEntity) : null,
          JSON.stringify(rec.provenance), rec.capturedAt, rec.archivedAt ?? null, blob,
        ],
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/duplicate key|unique/i.test(msg)) {
        throw new Error(`media: duplicate id ${rec.id} (append-only violation)`);
      }
      throw e;
    }
    return { ...rec };
  }

  async get(id: string): Promise<MediaCaptureRecord | null> {
    const res = await this.#pg.query<Row>(`SELECT * FROM media_captures WHERE id = $1`, [id]);
    return res.rows[0] ? toRecord(res.rows[0]) : null;
  }

  async getBlob(id: string): Promise<Uint8Array | null> {
    const res = await this.#pg.query<{ blob: Uint8Array }>(
      `SELECT blob FROM media_captures WHERE id = $1`, [id],
    );
    return res.rows[0] ? new Uint8Array(res.rows[0].blob) : null;
  }

  async list(filter?: { status?: MediaStatus; kind?: MediaKind; workspaceId?: string }): Promise<MediaCaptureRecord[]> {
    const where: string[] = [];
    const args: unknown[] = [];
    if (filter?.status) { args.push(filter.status); where.push(`status = $${args.length}`); }
    if (filter?.kind) { args.push(filter.kind); where.push(`kind = $${args.length}`); }
    if (filter?.workspaceId) { args.push(filter.workspaceId); where.push(`workspace_id = $${args.length}`); }
    const sql = `SELECT * FROM media_captures${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY captured_at DESC`;
    const res = await this.#pg.query<Row>(sql, args);
    return res.rows.map(toRecord);
  }

  async update(id: string, patch: Partial<MediaCaptureRecord>): Promise<MediaCaptureRecord> {
    const current = await this.get(id);
    if (!current) throw new Error(`media: no record ${id}`);
    // Identity + blob fields are immutable.
    const next: MediaCaptureRecord = {
      ...current, ...patch,
      id: current.id, workspaceId: current.workspaceId, kind: current.kind,
      mimeType: current.mimeType, byteSize: current.byteSize,
    };
    await this.#pg.query(
      `UPDATE media_captures SET caption=$2, ocr_text=$3, thumbnail_data_url=$4, status=$5,
        ledger_id=$6, linked_entity=$7, archived_at=$8 WHERE id=$1`,
      [
        id, next.caption ?? null, next.ocrText ?? null, next.thumbnailDataUrl ?? null,
        next.status, next.ledgerId ?? null,
        next.linkedEntity ? JSON.stringify(next.linkedEntity) : null, next.archivedAt ?? null,
      ],
    );
    return next;
  }

  async archive(id: string): Promise<void> {
    const current = await this.get(id);
    if (!current) throw new Error(`media: no record ${id}`);
    await this.#pg.query(
      `UPDATE media_captures SET status='archived', archived_at=$2 WHERE id=$1`,
      [id, new Date(0).toISOString()],
    );
  }
}

/** Factory: a LOCAL pglite media store. `dataDir` undefined => in-memory. */
export async function createLocalMediaStore(dataDir?: string): Promise<PgliteMediaStore> {
  return PgliteMediaStore.create(dataDir);
}
```

- [ ] **Step 5: Export from db `index.ts`**

In `platform/packages/db/src/index.ts`, add after the `export { DrizzleRitualRegistry, ... }` line:

```ts
export { PgliteMediaStore, createLocalMediaStore } from "./media-store.js";
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd platform && pnpm -C packages/db build && node --test packages/db/dist/test/media-store.test.js`
Expected: PASS — 3 tests pass (bytea round-trip, list/update/archive, append-only).

- [ ] **Step 7: Commit**

```bash
git add "platform/packages/db/package.json" "platform/packages/db/tsconfig.json" "platform/packages/db/src/media-store.ts" "platform/packages/db/src/index.ts" "platform/packages/db/test/media-store.test.ts" "platform/pnpm-lock.yaml"
git commit -m "feat(db): PgliteMediaStore — local-plane bytea blob adapter bound to LocalMediaStore port"
```

---

## Task 4: Bind the media store + skill in the API wiring

**Files:**
- Modify: `platform/apps/api/src/wiring.ts`

This binds the local adapter to the existing ports composition root — the brief's "local adapter bound to the existing ports."

- [ ] **Step 1: Register the skill + media store**

In `platform/apps/api/src/wiring.ts`:

1. Add to the `@bridge/core` import block: `InMemoryMediaStore`, `stageCapture`, and `type LocalMediaStore`.
2. Add to the `@bridge/db` import: `createLocalMediaStore` →
   ```ts
   import { createDb, createDrizzlePorts, createLocalMediaStore, type PgliteMediaStore } from "@bridge/db";
   ```
3. Replace the skills registration line:
   ```ts
   const skills = new InMemorySkillRegistry().register(stageMutation).register(stageCapture);
   ```
4. Add `localMedia: LocalMediaStore;` to the `Wiring` interface.
5. Before the `const pipeline = ...` block, build the store:
   ```ts
   // LOCAL-plane media store (the priority track). bytea blobs live here, never cloud.
   // LOCAL_MEDIA_DIR set => persistent pglite on disk; unset => in-memory (zero-infra).
   const localMediaDir = process.env.LOCAL_MEDIA_DIR;
   const localMedia: LocalMediaStore = localMediaDir
     ? await createLocalMediaStore(localMediaDir)
     : new InMemoryMediaStore();
   ```
   and change `export function buildWiring(): Wiring {` to `export async function buildWiring(): Promise<Wiring> {`.
6. Add `localMedia,` to the returned object.

- [ ] **Step 2: Update `buildWiring` callers to await**

Run: `cd platform && grep -rn "buildWiring()" apps/api/src`
For each call site (e.g. `apps/api/src/context.ts`), change `buildWiring()` to `await buildWiring()` (the surrounding function is already async or make it async). Show the diff before editing.

- [ ] **Step 3: Typecheck + build the platform**

Run: `cd platform && pnpm build`
Expected: PASS — turbo builds core, db, api with no type errors.

- [ ] **Step 4: Commit**

```bash
git add "platform/apps/api/src/wiring.ts" "platform/apps/api/src/context.ts"
git commit -m "feat(api): bind LocalMediaStore (pglite|in-memory) + stageCapture into the wiring"
```

---

## Task 5: Prototype deps

**Files:**
- Modify: `Design Bridge AI Interface (Copy)/package.json`

- [ ] **Step 1: Add deps**

In `Design Bridge AI Interface (Copy)/package.json`, add to `dependencies`:

```json
"idb": "^8.0.0",
"browser-image-compression": "^2.0.2",
"tesseract.js": "^5.1.1"
```

- [ ] **Step 2: Install**

Run: `cd "Design Bridge AI Interface (Copy)" && pnpm install`
Expected: three packages added; no peer-dep errors that block the build.

- [ ] **Step 3: Commit**

```bash
git add "Design Bridge AI Interface (Copy)/package.json" "Design Bridge AI Interface (Copy)/pnpm-lock.yaml"
git commit -m "chore(proto): add idb + browser-image-compression + tesseract.js for the camera tool"
```

---

## Task 6: Browser `LocalMediaStore` + local-plane intake module

**Files:**
- Create: `Design Bridge AI Interface (Copy)/src/app/data/localMedia.ts`

This is the prototype's local plane: an IndexedDB-backed `LocalMediaStore` (blobs stay on-device) plus a faithful local intake mini-pipeline (propose→decide→append-only ledger) mirroring `@bridge/core`'s contract, so the whole governed flow demos in-browser with zero infra. Residency: nothing here ever touches Supabase.

- [ ] **Step 1: Create the module**

Create `Design Bridge AI Interface (Copy)/src/app/data/localMedia.ts`:

```ts
// LOCAL plane for the Camera tool. Blobs + capture metadata + the governed intake
// ledger live in IndexedDB on this device — NEVER Supabase/cloud (private relationship
// data, dataScope:'private', private ∩ egress = none). Mirrors @bridge/core's
// LocalMediaStore port + the propose→decide→append-only-ledger pipeline contract so the
// full capture → pending → approve flow runs in-browser. When VITE_API_URL is set, the
// camera also routes a no-blob proposal to the real platform pipeline (see Camera tool).
import { openDB, type IDBPDatabase } from 'idb';

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
  durationSeconds?: number;
  caption?: string;
  ocrText?: string;
  thumbnailDataUrl?: string;
  status: MediaStatus;
  ledgerId?: string;
  linkedEntity?: { type: 'person' | 'memory' | 'touchpoint'; id: string } | null;
  provenance: { tool: string; version: string; model?: string };
  capturedAt: string;
  archivedAt?: string | null;
}

// Append-only governed ledger row — mirrors @bridge/core LedgerEntry (subset).
export type Decision = 'approve' | 'veto' | 'edit';
export interface MediaLedgerEntry {
  id: string;
  mediaId: string;
  resourceType: 'touchpoint' | 'signal';
  proposedOutput: unknown;
  userDecision: Decision | 'auto' | null; // null = pending_review
  refLedgerId?: string;                    // decision row → proposal row
  createdAt: string;
}

const DB_NAME = 'bridge.localMedia.v1';
const STORE_MEDIA = 'captures';
const STORE_BLOBS = 'blobs';
const STORE_LEDGER = 'ledger';
const WORKSPACE = 'dummy_ws_local'; // single local workspace in the prototype

let dbp: Promise<IDBPDatabase> | null = null;
function db(): Promise<IDBPDatabase> {
  if (!dbp) {
    dbp = openDB(DB_NAME, 1, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(STORE_MEDIA)) d.createObjectStore(STORE_MEDIA, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(STORE_BLOBS)) d.createObjectStore(STORE_BLOBS);
        if (!d.objectStoreNames.contains(STORE_LEDGER)) d.createObjectStore(STORE_LEDGER, { keyPath: 'id' });
      },
    });
  }
  return dbp;
}

function uid(prefix: string): string {
  return `${prefix}_${(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.round(Math.random() * 1e9)}`)}`;
}

// ── LocalMediaStore (blob stays on-device) ──────────────────────────────────────
export async function putCapture(
  rec: Omit<MediaCaptureRecord, 'id' | 'workspaceId' | 'status' | 'capturedAt'> & Partial<Pick<MediaCaptureRecord, 'id'>>,
  blob: Blob,
): Promise<MediaCaptureRecord> {
  const d = await db();
  const full: MediaCaptureRecord = {
    id: rec.id ?? uid('media'),
    workspaceId: WORKSPACE,
    status: 'pending',
    capturedAt: new Date().toISOString(),
    ...rec,
  };
  if (await d.get(STORE_MEDIA, full.id)) throw new Error(`media: duplicate id ${full.id}`);
  await d.put(STORE_MEDIA, full);
  await d.put(STORE_BLOBS, blob, full.id);
  return full;
}

export async function getCapture(id: string): Promise<MediaCaptureRecord | null> {
  return (await (await db()).get(STORE_MEDIA, id)) ?? null;
}
export async function getBlob(id: string): Promise<Blob | null> {
  return (await (await db()).get(STORE_BLOBS, id)) ?? null;
}
export async function getBlobUrl(id: string): Promise<string | null> {
  const b = await getBlob(id);
  return b ? URL.createObjectURL(b) : null;
}
export async function listCaptures(filter?: { status?: MediaStatus; kind?: MediaKind }): Promise<MediaCaptureRecord[]> {
  const all = (await (await db()).getAll(STORE_MEDIA)) as MediaCaptureRecord[];
  return all
    .filter((r) => (filter?.status ? r.status === filter.status : true))
    .filter((r) => (filter?.kind ? r.kind === filter.kind : true))
    .sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1));
}
async function patchCapture(id: string, patch: Partial<MediaCaptureRecord>): Promise<MediaCaptureRecord> {
  const d = await db();
  const cur = (await d.get(STORE_MEDIA, id)) as MediaCaptureRecord | undefined;
  if (!cur) throw new Error(`media: no record ${id}`);
  const next: MediaCaptureRecord = { ...cur, ...patch, id: cur.id, workspaceId: cur.workspaceId, kind: cur.kind, byteSize: cur.byteSize };
  await d.put(STORE_MEDIA, next);
  return next;
}
export async function archiveCapture(id: string): Promise<void> {
  await patchCapture(id, { status: 'archived', archivedAt: new Date().toISOString() });
}

// ── Governed intake (local mini-pipeline; mirrors core propose/decide/ledger) ────
export interface ProposalView {
  id: string;
  mediaId: string;
  resourceType: 'touchpoint' | 'signal';
  proposedOutput: unknown;
  status: 'pending_review' | 'applied' | 'rejected';
}

async function appendLedger(entry: MediaLedgerEntry): Promise<MediaLedgerEntry> {
  const d = await db();
  if (await d.get(STORE_LEDGER, entry.id)) throw new Error(`ledger: duplicate id ${entry.id}`);
  await d.put(STORE_LEDGER, entry);
  return entry;
}
export async function listLedger(): Promise<MediaLedgerEntry[]> {
  const all = (await (await db()).getAll(STORE_LEDGER)) as MediaLedgerEntry[];
  return all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
export async function listProposals(): Promise<ProposalView[]> {
  const led = await listLedger();
  const proposals = led.filter((e) => e.userDecision === null && !e.refLedgerId);
  return proposals.map((p) => {
    const decided = led.find((e) => e.refLedgerId === p.id);
    const status: ProposalView['status'] = !decided
      ? 'pending_review'
      : decided.userDecision === 'veto' ? 'rejected' : 'applied';
    return { id: p.id, mediaId: p.mediaId, resourceType: p.resourceType, proposedOutput: p.proposedOutput, status };
  });
}

/** Raise a governed proposal for a capture. Capture ≠ commit — media stays `pending`. */
export async function proposeCapture(
  mediaId: string,
  opts: { caption?: string; ocrText?: string; link?: MediaCaptureRecord['linkedEntity'] } = {},
): Promise<ProposalView> {
  const media = await getCapture(mediaId);
  if (!media) throw new Error(`propose: no capture ${mediaId}`);
  const noun = media.kind === 'video' ? 'video' : 'photo';
  const proposedOutput = {
    type: 'touchpoint',
    text: `Captured a ${noun}${opts.caption ? ` — ${opts.caption}` : ''}`,
    local_media_id: mediaId,
    ...(opts.ocrText ? { notes: opts.ocrText } : {}),
    ...(opts.link ? { link: opts.link } : {}),
  };
  const entry = await appendLedger({
    id: uid('led'), mediaId, resourceType: 'touchpoint', proposedOutput,
    userDecision: null, createdAt: new Date().toISOString(),
  });
  return { id: entry.id, mediaId, resourceType: 'touchpoint', proposedOutput, status: 'pending_review' };
}

/** File a possible_link Signal — uncertain person matches are NEVER auto-linked. */
export async function flagPossibleLink(mediaId: string, candidate: string): Promise<ProposalView> {
  const proposedOutput = { type: 'signal', signal: 'possible_link', local_media_id: mediaId, candidate,
    text: `Possible link for a capture — confirm manually: ${candidate}` };
  const entry = await appendLedger({
    id: uid('led'), mediaId, resourceType: 'signal', proposedOutput,
    userDecision: null, createdAt: new Date().toISOString(),
  });
  return { id: entry.id, mediaId, resourceType: 'signal', proposedOutput, status: 'pending_review' };
}

/** Resolve a pending proposal (append-only decision row). approve/edit commit the
 * capture (media → committed, ledgerId set + optional link); veto commits nothing. */
export async function decideCapture(
  proposalId: string, decision: Decision, editedOutput?: unknown,
): Promise<ProposalView> {
  const led = await listLedger();
  const proposal = led.find((e) => e.id === proposalId && e.userDecision === null);
  if (!proposal) throw new Error(`decide: no pending proposal ${proposalId}`);
  if (led.some((e) => e.refLedgerId === proposalId)) throw new Error(`decide: ${proposalId} already resolved`);
  const committed = decision === 'edit' ? editedOutput : proposal.proposedOutput;
  const decisionRow = await appendLedger({
    id: uid('led'), mediaId: proposal.mediaId, resourceType: proposal.resourceType,
    proposedOutput: committed, userDecision: decision, refLedgerId: proposalId,
    createdAt: new Date().toISOString(),
  });
  if (decision !== 'veto' && proposal.resourceType === 'touchpoint') {
    const out = committed as { link?: MediaCaptureRecord['linkedEntity'] };
    await patchCapture(proposal.mediaId, {
      status: 'committed', ledgerId: decisionRow.id,
      ...(out?.link ? { linkedEntity: out.link } : {}),
    });
  }
  return {
    id: decisionRow.id, mediaId: proposal.mediaId, resourceType: proposal.resourceType,
    proposedOutput: committed, status: decision === 'veto' ? 'rejected' : 'applied',
  };
}
```

> Note: `idb` is fully typed; no extra `@types` needed.

- [ ] **Step 2: Typecheck the prototype**

Run: `cd "Design Bridge AI Interface (Copy)" && npx tsc --noEmit 2>&1 | grep -i "localMedia" | head`
Expected: no errors referencing `localMedia.ts` (the project may have pre-existing unrelated TS notes; only the new file must be clean).

- [ ] **Step 3: Commit**

```bash
git add "Design Bridge AI Interface (Copy)/src/app/data/localMedia.ts"
git commit -m "feat(proto): localMedia — IndexedDB LocalMediaStore + local governed intake (zero cloud)"
```

---

## Task 7: Camera capture component

**Files:**
- Create: `Design Bridge AI Interface (Copy)/src/app/components/tools/camera/Camera.tsx`

Native capture: photo (`getUserMedia` + `canvas.toBlob`), video (`MediaRecorder`). Compress photos with `browser-image-compression`; run `tesseract.js` OCR best-effort (failure never blocks the capture); persist to `localMedia` as `pending`.

- [ ] **Step 1: Create the component**

Create `Design Bridge AI Interface (Copy)/src/app/components/tools/camera/Camera.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { Camera as CameraIcon, Video, Square, Loader2, ScanText } from 'lucide-react';
import imageCompression from 'browser-image-compression';
import { putCapture } from '../../../data/localMedia';
import CameraCaptures from './CameraCaptures';

type Mode = 'photo' | 'video';

export default function Camera() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [mode, setMode] = useState<Mode>('photo');
  const [on, setOn] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: mode === 'video',
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setOn(true);
    } catch {
      setNote('Camera access denied or unavailable.');
      setTimeout(() => setNote(null), 3600);
    }
  }
  function stop() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setOn(false);
    setRecording(false);
  }
  useEffect(() => () => stop(), []);
  // Re-acquire stream when switching to video (needs audio track).
  useEffect(() => { if (on) { stop(); start(); } /* eslint-disable-next-line */ }, [mode]);

  async function thumbnail(blob: Blob): Promise<string> {
    try {
      const small = await imageCompression(new File([blob], 'thumb', { type: blob.type }), {
        maxWidthOrHeight: 320, maxSizeMB: 0.05, useWebWorker: true,
      });
      return await imageCompression.getDataUrlFromFile(small);
    } catch { return ''; }
  }

  async function capturePhoto() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    setBusy('photo');
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    canvas.getContext('2d')!.drawImage(v, 0, 0);
    const raw: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), 'image/jpeg', 0.95));
    // Client-side compression before local persist.
    const compressedFile = await imageCompression(new File([raw], 'photo.jpg', { type: 'image/jpeg' }), {
      maxWidthOrHeight: 1600, maxSizeMB: 1, useWebWorker: true,
    });
    const blob: Blob = compressedFile;
    const thumb = await thumbnail(blob);
    // Best-effort local OCR — never blocks the capture.
    let ocrText = '';
    try {
      setBusy('ocr');
      const { default: Tesseract } = await import('tesseract.js');
      const { data } = await Tesseract.recognize(blob, 'eng');
      ocrText = (data.text || '').trim();
    } catch { /* OCR optional */ }
    await putCapture(
      { kind: 'photo', mimeType: 'image/jpeg', byteSize: blob.size, width: canvas.width, height: canvas.height,
        ...(ocrText ? { ocrText } : {}), ...(thumb ? { thumbnailDataUrl: thumb } : {}),
        provenance: { tool: 'camera', version: '1.0.0', model: 'tesseract-eng-local' } },
      blob,
    );
    setBusy(null);
    setNote('Photo captured — quarantined locally. Review it below.');
    setTimeout(() => setNote(null), 3600);
    setRefreshKey((k) => k + 1);
  }

  function startVideo() {
    const stream = streamRef.current;
    if (!stream) return;
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
    const mr = new MediaRecorder(stream, { mimeType: mime });
    chunksRef.current = [];
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    mr.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' });
      setBusy('video');
      await putCapture(
        { kind: 'video', mimeType: 'video/webm', byteSize: blob.size,
          provenance: { tool: 'camera', version: '1.0.0' } },
        blob,
      );
      setBusy(null);
      setNote('Video captured — quarantined locally. Review it below.');
      setTimeout(() => setNote(null), 3600);
      setRefreshKey((k) => k + 1);
    };
    mr.start();
    recorderRef.current = mr;
    setRecording(true);
  }
  function stopVideo() { recorderRef.current?.stop(); setRecording(false); }

  return (
    <div className="p-6 flex flex-col gap-4 max-w-3xl mx-auto w-full">
      <div className="flex items-center gap-2">
        <button onClick={() => setMode('photo')} className="text-xs font-semibold px-3 py-1.5 rounded-lg border"
          style={mode === 'photo' ? { backgroundColor: 'var(--color-steel)', color: 'white', borderColor: 'var(--color-steel)' } : { borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}>
          <CameraIcon className="inline w-3.5 h-3.5 mr-1" /> Photo
        </button>
        <button onClick={() => setMode('video')} className="text-xs font-semibold px-3 py-1.5 rounded-lg border"
          style={mode === 'video' ? { backgroundColor: 'var(--color-steel)', color: 'white', borderColor: 'var(--color-steel)' } : { borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}>
          <Video className="inline w-3.5 h-3.5 mr-1" /> Video
        </button>
        <span className="ml-auto text-[11px]" style={{ color: 'var(--color-warm-gray)' }}>Private · stored on this device only</span>
      </div>

      <div className="rounded-xl overflow-hidden border bg-black aspect-video flex items-center justify-center" style={{ borderColor: 'var(--color-border)' }}>
        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-contain" style={{ display: on ? 'block' : 'none' }} />
        {!on && <span className="text-xs text-white/70">Camera is off</span>}
      </div>

      {note && <div className="px-3 py-2 rounded-lg text-xs font-medium" style={{ backgroundColor: 'color-mix(in srgb, var(--success) 12%, transparent)', color: 'var(--success)' }}>{note}</div>}

      <div className="flex items-center gap-2">
        {!on ? (
          <button onClick={start} className="text-sm font-semibold px-4 py-2 rounded-xl text-white" style={{ backgroundColor: 'var(--color-steel)' }}>Start camera</button>
        ) : (
          <>
            {mode === 'photo' && (
              <button onClick={capturePhoto} disabled={!!busy} className="text-sm font-semibold px-4 py-2 rounded-xl text-white disabled:opacity-50 inline-flex items-center gap-2" style={{ backgroundColor: 'var(--color-steel)' }}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CameraIcon className="w-4 h-4" />}
                {busy === 'ocr' ? 'Reading text…' : busy === 'photo' ? 'Saving…' : 'Capture photo'}
              </button>
            )}
            {mode === 'video' && !recording && (
              <button onClick={startVideo} className="text-sm font-semibold px-4 py-2 rounded-xl text-white inline-flex items-center gap-2" style={{ backgroundColor: '#b3261e' }}><Video className="w-4 h-4" /> Record</button>
            )}
            {mode === 'video' && recording && (
              <button onClick={stopVideo} className="text-sm font-semibold px-4 py-2 rounded-xl text-white inline-flex items-center gap-2" style={{ backgroundColor: '#b3261e' }}><Square className="w-4 h-4" /> Stop</button>
            )}
            <button onClick={stop} className="text-sm font-medium px-4 py-2 rounded-xl border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}>Stop camera</button>
            <span className="ml-auto inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--color-warm-gray)' }}><ScanText className="w-3.5 h-3.5" /> OCR runs locally on photos</span>
          </>
        )}
      </div>

      <CameraCaptures key={refreshKey} />
    </div>
  );
}
```

- [ ] **Step 2: Defer build verification to Task 8**

`Camera.tsx` imports `CameraCaptures` (Task 8). Don't build yet.

- [ ] **Step 3: Commit after Task 8** (capture + captures land together).

---

## Task 8: Camera captures panel — pending, Add to Bridge, inline review

**Files:**
- Create: `Design Bridge AI Interface (Copy)/src/app/components/tools/camera/CameraCaptures.tsx`

- [ ] **Step 1: Create the component**

Create `Design Bridge AI Interface (Copy)/src/app/components/tools/camera/CameraCaptures.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Inbox, Plus, X, ShieldCheck, Check, Ban, Link2 } from 'lucide-react';
import {
  listCaptures, listProposals, proposeCapture, decideCapture, flagPossibleLink, archiveCapture,
  getBlobUrl, type MediaCaptureRecord, type ProposalView,
} from '../../../data/localMedia';

const API_ENABLED = Boolean(import.meta.env.VITE_API_URL);

export default function CameraCaptures() {
  const [pending, setPending] = useState<MediaCaptureRecord[]>([]);
  const [committed, setCommitted] = useState<MediaCaptureRecord[]>([]);
  const [proposals, setProposals] = useState<ProposalView[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function refresh() {
    const [p, c, props] = await Promise.all([
      listCaptures({ status: 'pending' }), listCaptures({ status: 'committed' }), listProposals(),
    ]);
    setPending(p); setCommitted(c); setProposals(props.filter((x) => x.status === 'pending_review'));
    const next: Record<string, string> = {};
    for (const r of [...p, ...c]) {
      next[r.id] = r.thumbnailDataUrl || (await getBlobUrl(r.id)) || '';
    }
    setUrls(next);
  }
  useEffect(() => { refresh(); }, []);

  function flash(msg: string) { setNote(msg); setTimeout(() => setNote(null), 3600); }

  async function onAdd(r: MediaCaptureRecord) {
    setBusy(r.id);
    await proposeCapture(r.id, { ...(r.caption ? { caption: r.caption } : {}), ...(r.ocrText ? { ocrText: r.ocrText } : {}) });
    setBusy(null);
    flash(API_ENABLED ? 'Proposed — sent to the governed pipeline for review.' : 'Proposed — review it below (local governed pipeline).');
    refresh();
  }
  async function onFlagLink(r: MediaCaptureRecord) {
    setBusy(r.id);
    await flagPossibleLink(r.id, 'dummy_unconfirmed person');
    setBusy(null);
    flash('Filed a possible_link Signal — uncertain matches are never auto-linked.');
    refresh();
  }
  async function onDismiss(r: MediaCaptureRecord) {
    setBusy(r.id); await archiveCapture(r.id); setBusy(null); refresh();
  }
  async function onDecide(p: ProposalView, decision: 'approve' | 'veto') {
    setBusy(p.id); await decideCapture(p.id, decision); setBusy(null);
    flash(decision === 'approve' ? 'Approved — committed a Touchpoint + ledger entry.' : 'Vetoed — nothing committed.');
    refresh();
  }

  return (
    <div className="flex flex-col gap-6 mt-2">
      <div className="flex items-start gap-3 px-4 py-3 rounded-xl border" style={{ borderColor: 'color-mix(in srgb, var(--color-steel) 20%, transparent)', backgroundColor: 'color-mix(in srgb, var(--color-steel) 5%, transparent)' }}>
        <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--color-steel)' }} />
        <div className="text-xs" style={{ color: 'var(--color-navy-mid)' }}>
          <span className="font-semibold" style={{ color: 'var(--color-navy)' }}>Quarantined &amp; private.</span> Photos/videos live only on this device. <span className="font-semibold">Add to Bridge</span> raises a governed Touchpoint proposal — the blob never leaves; only an approved decision enters the ledger.
        </div>
      </div>
      {note && <div className="px-3 py-2 rounded-lg text-xs font-medium" style={{ backgroundColor: 'color-mix(in srgb, var(--success) 12%, transparent)', color: 'var(--success)' }}>{note}</div>}

      {/* Pending captures */}
      <section>
        <h3 className="text-sm font-semibold uppercase tracking-wider mb-3 flex items-center gap-2" style={{ color: 'var(--color-warm-gray)' }}>
          <Inbox className="w-3.5 h-3.5" /> Pending captures <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ backgroundColor: 'color-mix(in srgb, var(--color-steel) 14%, transparent)', color: 'var(--color-steel)' }}>{pending.length}</span>
        </h3>
        {pending.length === 0 ? (
          <p className="text-xs px-4 py-6 text-center rounded-xl border border-dashed" style={{ borderColor: 'var(--color-border)', color: 'var(--color-warm-gray)' }}>No pending captures. Capture a photo or video above.</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {pending.map((r) => (
              <div key={r.id} className="rounded-xl border bg-white overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                {r.kind === 'photo' && urls[r.id]
                  ? <img src={urls[r.id]} alt="capture" className="w-full h-36 object-cover" />
                  : r.kind === 'video' && urls[r.id]
                    ? <video src={urls[r.id]} controls className="w-full h-36 object-cover bg-black" />
                    : <div className="w-full h-36 bg-[var(--color-surface)]" />}
                <div className="p-3">
                  <div className="text-xs font-semibold" style={{ color: 'var(--color-navy)' }}>{r.kind === 'photo' ? 'Photo' : 'Video'} · {(r.byteSize / 1024).toFixed(0)} KB</div>
                  {r.ocrText && <p className="mt-1 text-[11px] line-clamp-2" style={{ color: 'var(--color-warm-gray)' }}>OCR: {r.ocrText}</p>}
                  <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                    <button onClick={() => onAdd(r)} disabled={busy === r.id} className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-50" style={{ backgroundColor: 'var(--color-steel)' }}><Plus className="w-3.5 h-3.5" /> Add to Bridge</button>
                    <button onClick={() => onFlagLink(r)} disabled={busy === r.id} title="File a possible_link Signal (manual confirmation)" className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1.5 rounded-lg border disabled:opacity-50" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}><Link2 className="w-3.5 h-3.5" /> Link?</button>
                    <button onClick={() => onDismiss(r)} disabled={busy === r.id} title="Archive (soft delete)" className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1.5 rounded-lg border disabled:opacity-50" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}><X className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Pending review (the governed gate) */}
      {proposals.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold uppercase tracking-wider mb-3 flex items-center gap-2" style={{ color: 'var(--color-warm-gray)' }}>
            <ShieldCheck className="w-3.5 h-3.5" /> Pending review <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ backgroundColor: 'color-mix(in srgb, var(--color-steel) 14%, transparent)', color: 'var(--color-steel)' }}>{proposals.length}</span>
          </h3>
          <div className="flex flex-col gap-2">
            {proposals.map((p) => {
              const out = p.proposedOutput as { text?: string; candidate?: string };
              return (
                <div key={p.id} className="flex items-center gap-3 rounded-xl border bg-white p-3" style={{ borderColor: 'var(--color-border)' }}>
                  <div className="flex-1 min-w-0">
                    <span className="text-[10px] px-1.5 py-0.5 rounded mr-2" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-navy-mid)' }}>{p.resourceType}</span>
                    <span className="text-sm" style={{ color: 'var(--color-navy)' }}>{out.text}</span>
                  </div>
                  <button onClick={() => onDecide(p, 'approve')} disabled={busy === p.id} className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-50" style={{ backgroundColor: 'var(--success)' }}><Check className="w-3.5 h-3.5" /> Approve</button>
                  <button onClick={() => onDecide(p, 'veto')} disabled={busy === p.id} className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg border disabled:opacity-50" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}><Ban className="w-3.5 h-3.5" /> Veto</button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Committed (browsable) */}
      {committed.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold uppercase tracking-wider mb-3 flex items-center gap-2" style={{ color: 'var(--color-warm-gray)' }}>
            <Check className="w-3.5 h-3.5" /> Committed <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ backgroundColor: 'color-mix(in srgb, var(--success) 14%, transparent)', color: 'var(--success)' }}>{committed.length}</span>
          </h3>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {committed.map((r) => (
              <div key={r.id} className="rounded-lg overflow-hidden border" style={{ borderColor: 'var(--color-border)' }} title={`Touchpoint · ledger ${r.ledgerId ?? ''}`}>
                {urls[r.id] && (r.kind === 'photo'
                  ? <img src={urls[r.id]} alt="committed" className="w-full h-20 object-cover" />
                  : <video src={urls[r.id]} className="w-full h-20 object-cover bg-black" />)}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build the prototype**

Run: `cd "Design Bridge AI Interface (Copy)" && pnpm build 2>&1 | tail -20`
Expected: PASS — Vite build succeeds (camera components compile).

- [ ] **Step 3: Commit**

```bash
git add "Design Bridge AI Interface (Copy)/src/app/components/tools/camera/Camera.tsx" "Design Bridge AI Interface (Copy)/src/app/components/tools/camera/CameraCaptures.tsx"
git commit -m "feat(proto): camera capture UI (photo+video, compress, OCR) + local governed captures panel"
```

---

## Task 9: Register the `camera` tool

**Files:**
- Modify: `Design Bridge AI Interface (Copy)/src/app/data/tools.ts`

- [ ] **Step 1: Add the import + entry**

In `tools.ts`, add `Camera` to the lucide import on line 6:

```ts
import { RefreshCw, MessageCircle, Activity, Search, Milestone, Briefcase, Users, CalendarClock, Cable, ShieldCheck, ScanLine, Mic, LifeBuoy, BookOpen, Camera } from 'lucide-react';
```

Insert this entry into the `tools` array immediately after the `card-scanner` object (after its closing `},` near line 56):

```ts
  {
    id: 'camera',
    name: 'Camera',
    description: 'Capture a photo or video → it stays private on your device until you Add it as a governed Touchpoint. Local-only blobs, OCR on photos.',
    category: 'Capture', status: 'Live', list: 'My Tools', icon: Camera, color: '#6B7C65',
    overview: 'A built-in capture Tool. Take a photo (getUserMedia) or record a video (MediaRecorder); images are compressed and OCR-read locally. Every blob is private relationship data — it lives in a LOCAL store on this device and NEVER crosses the gate to the cloud. Captures are quarantined; Add to Bridge raises a governed Touchpoint proposal (optional link to a Person/Memory/Touchpoint) — review → approve → append-only ledger. Uncertain person matches are never auto-linked; they file a possible_link Signal.',
    capabilities: ['Photo + video capture (local getUserMedia/MediaRecorder)', 'Client-side compression + local OCR (no API key)', 'Blobs stored LOCAL-only — never the cloud', 'Quarantined intake — Add → governed Touchpoint proposal'],
    watches: ['Local media store (this device)', 'media.v1 output contract'],
    lastUsed: 'Live',
    intake: true,
    source_repo: 'Tools/card-scanner + Tools/recorder (capture patterns)',
    native: true,
  },
```

- [ ] **Step 2: Build**

Run: `cd "Design Bridge AI Interface (Copy)" && pnpm build 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "Design Bridge AI Interface (Copy)/src/app/data/tools.ts"
git commit -m "feat(proto): register the Camera tool (native, intake, local-only)"
```

---

## Task 10: Mount Camera in ToolDetail

**Files:**
- Modify: `Design Bridge AI Interface (Copy)/src/app/pages/ToolDetail.tsx`

- [ ] **Step 1: Import the component**

After line 6 (`import CardScanner from ...`), add:

```ts
import Camera from '../components/tools/camera/Camera';
```

- [ ] **Step 2: Mount the native Camera surface**

Replace the card-scanner native block (lines 213–218) — extend the condition to also render Camera:

```tsx
        {/* Native tool — the real card-scanner UI, ported in-app (no separate server) */}
        {tool.id === 'card-scanner' && (
          <div className="border-b shrink-0" style={{ borderColor: 'var(--color-border)' }}>
            <CardScanner />
          </div>
        )}
        {/* Native Camera — capture + the local governed captures panel render together */}
        {tool.id === 'camera' && (
          <div className="border-b shrink-0" style={{ borderColor: 'var(--color-border)' }}>
            <Camera />
          </div>
        )}
```

And update the embedded-tool guard on line 220 so camera (native, no appUrl) is excluded — it already is since camera has no `appUrl`, so no change needed there.

- [ ] **Step 3: Skip the Supabase captures panel for camera**

Camera carries its OWN local captures panel (inside `<Camera />`) — so it must NOT also render the Supabase-backed `ToolCapturesPanel` (which would read `tool_captures` cloud and show nothing). Change line 242:

```tsx
          {/* Pending captures — Supabase intake panel for card-scanner/recorder; camera uses its own LOCAL panel */}
          {tool.intake && tool.id !== 'camera' && <ToolCapturesPanel color={tool.color} toolId={tool.id} />}
```

- [ ] **Step 4: Build + commit**

Run: `cd "Design Bridge AI Interface (Copy)" && pnpm build 2>&1 | tail -5`
Expected: PASS.

```bash
git add "Design Bridge AI Interface (Copy)/src/app/pages/ToolDetail.tsx"
git commit -m "feat(proto): mount native Camera in ToolDetail; camera uses its own local captures panel"
```

---

## Task 11: Surface captures in Resources

**Files:**
- Modify: `Design Bridge AI Interface (Copy)/src/app/pages/ResourcesPage.tsx`

Add a browsable "Captures" section at the top of Resources that reads the LOCAL media store (thumbnails + status), reinforcing that captures live locally and are browsable. Read the file first to match its exact structure; insert the section above the existing resources table, inside the page's main scroll container.

- [ ] **Step 1: Read the page**

Run: `sed -n '1,60p' "Design Bridge AI Interface (Copy)/src/app/pages/ResourcesPage.tsx"`
Identify the imports block and the top of the returned JSX (the main container/header).

- [ ] **Step 2: Add a Captures section component**

Add this import near the other data imports:

```ts
import { listCaptures, getBlobUrl, type MediaCaptureRecord } from '../data/localMedia';
```

Add this component above the `ResourcesPage` export (module scope):

```tsx
function LocalCapturesStrip() {
  const [items, setItems] = useState<MediaCaptureRecord[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    (async () => {
      const all = await listCaptures();
      setItems(all.filter((r) => r.status !== 'archived'));
      const next: Record<string, string> = {};
      for (const r of all) next[r.id] = r.thumbnailDataUrl || (await getBlobUrl(r.id)) || '';
      setUrls(next);
    })();
  }, []);
  if (items.length === 0) return null;
  return (
    <div className="mb-6 rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm font-semibold" style={{ color: 'var(--color-navy)' }}>Captures</span>
        <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ backgroundColor: 'color-mix(in srgb, var(--color-steel) 14%, transparent)', color: 'var(--color-steel)' }}>{items.length} · local-only</span>
        <span className="ml-auto text-[11px]" style={{ color: 'var(--color-warm-gray)' }}>Photos &amp; videos stored on this device — never the cloud</span>
      </div>
      <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
        {items.map((r) => (
          <div key={r.id} className="rounded-lg overflow-hidden border relative" style={{ borderColor: 'var(--color-border)' }} title={`${r.kind} · ${r.status}`}>
            {urls[r.id] && (r.kind === 'photo'
              ? <img src={urls[r.id]} alt="capture" className="w-full h-20 object-cover" />
              : <video src={urls[r.id]} className="w-full h-20 object-cover bg-black" />)}
            <span className="absolute top-1 left-1 text-[9px] px-1 py-0.5 rounded text-white" style={{ backgroundColor: r.status === 'committed' ? 'var(--success)' : 'rgba(0,0,0,0.6)' }}>{r.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

Ensure `useState`/`useEffect` are imported from `react` (add if missing). Then render `<LocalCapturesStrip />` at the top of the page's main content area (just inside the scroll container, before the resources table). Match indentation to the existing JSX.

- [ ] **Step 3: Build + commit**

Run: `cd "Design Bridge AI Interface (Copy)" && pnpm build 2>&1 | tail -5`
Expected: PASS.

```bash
git add "Design Bridge AI Interface (Copy)/src/app/pages/ResourcesPage.tsx"
git commit -m "feat(proto): surface local captures (browsable, local-only) in Resources"
```

---

## Task 12: Optional — route Add-to-Bridge to the real pipeline when API is on

**Files:**
- Modify: `Design Bridge AI Interface (Copy)/src/app/components/tools/camera/CameraCaptures.tsx`

When `VITE_API_URL` is set, also send a no-blob `media.v1` proposal to the platform pipeline (the real Universal Action Pipeline), in addition to the local governed record. This proves the platform path without putting the blob on the wire.

- [ ] **Step 1: Add an apiPropose call**

In `onAdd`, after `await proposeCapture(...)`, add:

```tsx
    if (API_ENABLED) {
      try {
        await fetch(`${import.meta.env.VITE_API_URL}/trpc/action.propose`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            json: {
              workspaceId: 'b0000000-0000-4000-a000-000000000001',
              actor: { type: 'user', id: 'e0f0053b-fc44-476e-be27-1371e179e958', plane: 'local' },
              action: 'write', resourceType: 'touchpoint', dataScope: 'private', skill: 'stageCapture',
              inputs: { local_media_id: r.id, kind: r.kind, ...(r.caption ? { caption: r.caption } : {}), ...(r.ocrText ? { ocrText: r.ocrText } : {}) },
            },
          }),
        });
      } catch { /* local record already stands; API is best-effort */ }
    }
```

> Note: the blob is NEVER included — only `local_media_id` + facts. Confirm the trpc envelope shape against `apps/api/src/router.ts` (it may be `{ json: ... }` or raw); adjust if the server expects a different wrapper.

- [ ] **Step 2: Build + commit**

Run: `cd "Design Bridge AI Interface (Copy)" && pnpm build 2>&1 | tail -5`
Expected: PASS.

```bash
git add "Design Bridge AI Interface (Copy)/src/app/components/tools/camera/CameraCaptures.tsx"
git commit -m "feat(proto): camera Add-to-Bridge also proposes to the real pipeline when VITE_API_URL is set (no blob)"
```

---

## Task 13: End-to-end verification in the browser + docs

**Files:**
- Modify: `docs/wiki/tools.md`, `docs/wiki/architecture.md`, `docs/log.md`

- [ ] **Step 1: Run the prototype and verify the full flow**

Use the preview tools: start the prototype dev server, navigate to `/tool/camera`, and demonstrate:
1. Start camera → Capture photo → capture appears under **Pending captures** (and in **Resources → Captures**). Confirms capture → local persist.
2. **Add to Bridge** → a proposal appears under **Pending review** (capture still local).
3. **Approve** → the capture moves to **Committed**; a Touchpoint + append-only ledger entry exist (verify via `listLedger()` in the console or the Committed tile's ledger id).
4. Record a short video → it persists locally and can be Added + approved the same way.

Capture a screenshot of each state (pending → review → committed) as proof. Verify in DevTools → Application → IndexedDB that blobs live in `bridge.localMedia.v1` and that NO network request carried the blob (Network tab).

- [ ] **Step 2: Run the full platform test suite**

Run: `cd platform && pnpm build && node --test packages/core/dist/test/*.test.js && node --test packages/db/dist/test/*.test.js`
Expected: PASS — all core + db tests green (including the new media tests).

- [ ] **Step 3: Update the wiki (caveman) + log**

Invoke the `caveman` skill, then:
- Add a Camera tool block to `docs/wiki/tools.md` (capture local-only · getUserMedia/MediaRecorder · compress+OCR · LocalMediaStore port + pglite/idb adapters · media.v1 → Touchpoint · uncertain→Signal · private∩egress=none).
- Add a `LocalMediaStore` note to `docs/wiki/architecture.md` (local-plane blob seam; one port, two adapters; first local-store adapter binding the existing ports — fixes the residency contradiction for media).
- Append a dated line to `docs/log.md`.

- [ ] **Step 4: Commit**

```bash
git add docs/wiki/tools.md docs/wiki/architecture.md docs/log.md
git commit -m "docs(camera): wiki (caveman) + log — Camera tool, LocalMediaStore local-plane seam"
```

---

## Self-review notes (run before execution)

- **Spec coverage:** capture photo+video (T7) · client compression (T7) · OCR (T7) · local-only persist via ports/adapters (T1/T3/T6) · quarantine pending (T6/T8) · Add-to-Bridge governed proposal (T2/T6/T8/T12) · review→approve→append-only ledger (T2/T6/T8) · optional Person/Memory/Touchpoint link inside the proposal (T6/T8) · uncertain→Signal (T2/T6/T8) · surface in Resources (T11) · manifest/output-contract `media.v1` (T2/T9) · platform local adapter bound to existing ports (T3/T4) · dummy_ prefixing (T6/T8) · docs caveman (T13).
- **Type consistency:** `MediaCaptureRecord`/`MediaKind`/`MediaStatus`/`LocalMediaStore` identical across core (T1) and db (T3 imports them from `@bridge/core`); the prototype redeclares structurally-identical types in `localMedia.ts` (T6) — intentional, the prototype does not import platform packages.
- **Residency invariant:** blobs only in `InMemoryMediaStore`/`PgliteMediaStore`/IndexedDB; proposals/ledger carry `local_media_id` only; `dataScope:'private'` + `planeGate` keep media off the gate (T2 test asserts egress denial).
