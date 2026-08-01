# WhatsApp Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `whatsapp` built-in Module whose nav entry opens the user's live WhatsApp Web session inside the Bridge desktop shell, with a sibling Tools Page whose first Tool, Contact Extractor, stages individual contacts as People proposals and selected groups as Community proposals with participant People and membership Relations.

**Architecture:** A contained Tauri child webview loads `web.whatsapp.com` and injects a vendored, hash-pinned `@wppconnect/wa-js` bundle at document start. The web app positions that window over the Module Page's content rect. Extraction runs through a fixed Rust-side read-op allowlist and returns via a cancelled `bridge-wa:` navigation. Raw payloads land in the Local Plane; mapping to People/Communities happens in a pure module package and reaches the graph only through the existing draft-then-approve Approvals path.

**Tech Stack:** Tauri v2 (Rust), `@wppconnect/wa-js` v4.5.x (Apache-2.0, vendored), TypeScript module package on `node:test`, React + react-router web surface, tRPC API, pglite Local Plane.

**Spec:** `docs/superpowers/specs/2026-08-01-whatsapp-module-design.md`

---

## File Structure

**New — pure module package (no Tauri, no network, no DOM):**
- `platform/modules/whatsapp/package.json`, `tsconfig.json`
- `platform/modules/whatsapp/src/types.ts` — extraction payload and proposal value types
- `platform/modules/whatsapp/src/normalize.ts` — E.164 phone, name precedence, dedupe keys
- `platform/modules/whatsapp/src/extract.ts` — payload → intake directives
- `platform/modules/whatsapp/src/tools.ts` — Tool registry rendered by the Tools Page
- `platform/modules/whatsapp/src/manifest.ts` — capability list for the module manifest
- `platform/modules/whatsapp/src/index.ts` — barrel
- `platform/modules/whatsapp/test/*.test.ts` — one test file per source file

**New — desktop shell:**
- `platform/apps/desktop/src-tauri/src/whatsapp_webview.rs`
- `platform/apps/desktop/src-tauri/vendor/wppconnect-wa.js` (vendored bundle)
- `platform/apps/desktop/src-tauri/vendor/wppconnect-wa.js.sha256`

**New — web surface:**
- `platform/apps/web/src/app/pages/WhatsAppPage.tsx` — Chats + Tools sibling Pages
- `platform/apps/web/src/app/pages/whatsapp/ChatsSurface.tsx` — rect tracking + unavailable state
- `platform/apps/web/src/app/pages/whatsapp/ToolsPanel.tsx` — Tool list
- `platform/apps/web/src/app/pages/whatsapp/ContactExtractorRun.tsx` — run panel
- `platform/apps/web/src/app/pages/whatsapp/whatsapp-shell.ts` — typed `tauriInvoke` wrappers

**Modified:**
- `platform/modules/manifests/src/index.ts` — `BUILT_IN_MODULES` entry, `BUILT_IN_SOURCE_REFS`
- `platform/apps/desktop/src-tauri/src/lib.rs` — `mod`, `.manage(...)`, `invoke_handler`
- `platform/apps/web/src/app/routes.tsx` — routes
- `platform/apps/api/src/router.ts` — `whatsapp` router
- `platform/pnpm-workspace.yaml` — already globs `modules/*`, no change needed

---

### Task 1: Spike — does WhatsApp Web run in Tauri's WKWebView?

Throwaway validation. Everything downstream rests on this. **Do not write Module code until this passes.**

**Files:**
- Create (temporary): `platform/apps/desktop/src-tauri/src/spike_whatsapp.rs`
- Modify: `platform/apps/desktop/src-tauri/src/lib.rs`

- [ ] **Step 1: Add a minimal spike command**

`spike_whatsapp.rs` — a stripped `research_webview::ensure_window` clone: build a webview
window labelled `whatsapp-spike` at `https://web.whatsapp.com`, decorations on, focused,
1280x800, no init script yet. Register `mod spike_whatsapp;` and the command in `lib.rs`.

- [ ] **Step 2: Run the desktop app and invoke the spike**

Run the desktop dev app, then from the main window devtools console:
`window.__TAURI_INTERNALS__.invoke("spike_whatsapp_open")`

Record honestly which of these happens:
1. The QR / link-device screen renders → **proceed**.
2. An "update your browser" / unsupported-browser page → try a Safari user-agent override
   via `.user_agent(...)` on the builder, retry once.
3. A blank page or a crash → **stop and report**; the design's fallback (Chromium sidecar)
   is now the live option and the plan's Tasks 7–8 must be rewritten before continuing.

- [ ] **Step 3: Verify session persistence**

Link the device by scanning the QR with the phone. Quit the app completely. Relaunch and
invoke the spike again. Expected: the chat list loads with no new QR scan. If a QR appears
every launch, WKWebView is not persisting the store — record it and stop.

- [ ] **Step 4: Verify wa-js injects and reads**

With the session live, paste the contents of the wa-js dist bundle into the spike window's
devtools console, then run:

```js
await WPP.contact.list({ onlyMyContacts: true }).then(c => c.length)
await WPP.group.getAllGroups().then(g => g.length)
```

Expected: two non-zero counts. If `WPP` is undefined or the calls throw, record the exact
error — that decides whether the bundle needs a different injection timing.

- [ ] **Step 5: Record findings and remove the spike**

Append a dated findings block to `docs/BUGS.md` **only if something failed**; otherwise
record the outcome in the TASK row created in Task 12. Delete `spike_whatsapp.rs` and its
`lib.rs` registration — the real implementation is Task 7, not this.

```bash
git add -A && git commit -m "chore: record WhatsApp WKWebView spike findings"
```

---

### Task 2: Vendor and pin the wa-js bundle

**Files:**
- Create: `platform/apps/desktop/src-tauri/vendor/wppconnect-wa.js`
- Create: `platform/apps/desktop/src-tauri/vendor/wppconnect-wa.js.sha256`
- Create: `platform/apps/desktop/src-tauri/vendor/README.md`

- [ ] **Step 1: Fetch the pinned release**

Download `wppconnect-wa.js` from the `@wppconnect/wa-js` release assets at a pinned
version tag (not `latest`). Record the exact version and release URL in `vendor/README.md`
along with the Apache-2.0 license notice and the upstream repository.

- [ ] **Step 2: Record the hash**

```bash
shasum -a 256 platform/apps/desktop/src-tauri/vendor/wppconnect-wa.js | cut -d' ' -f1 > platform/apps/desktop/src-tauri/vendor/wppconnect-wa.js.sha256
```

- [ ] **Step 3: Commit**

```bash
git add platform/apps/desktop/src-tauri/vendor && git commit -m "chore: vendor pinned wa-js bundle (Apache-2.0)"
```

---

### Task 3: Module package scaffold + normalization (TDD)

**Files:**
- Create: `platform/modules/whatsapp/package.json`, `tsconfig.json`
- Create: `platform/modules/whatsapp/src/types.ts`, `src/normalize.ts`
- Test: `platform/modules/whatsapp/test/normalize.test.ts`

- [ ] **Step 1: Scaffold the package**

`package.json` mirrors `modules/jobpilot` — name `@bridge/whatsapp`, `private: true`,
`type: module`, same `build`/`typecheck`/`test` scripts. Dependencies: `@bridge/core`,
`@bridge/module-manifests`. `tsconfig.json` mirrors `modules/jobpilot/tsconfig.json` with
references to `../../packages/core` and `../manifests`.

- [ ] **Step 2: Define the payload types**

`src/types.ts`:

```ts
/** One WhatsApp contact as returned by the read-op allowlist. */
export interface WhatsAppContact {
  /** WhatsApp id, e.g. "919876543210@c.us". */
  id: string;
  /** Saved address-book name, when the user has one. */
  name?: string;
  /** Profile display name the contact set themselves. */
  pushname?: string;
  /** Digits as WhatsApp reports them, no formatting. */
  phone?: string;
  isMyContact: boolean;
  isGroup: boolean;
}

export interface WhatsAppGroup {
  id: string;
  name: string;
  participants: WhatsAppContact[];
}

export type WhatsAppExtraction =
  | { kind: "contacts"; runId: string; capturedAt: string; contacts: WhatsAppContact[] }
  | { kind: "groups"; runId: string; capturedAt: string; groups: WhatsAppGroup[] };
```

- [ ] **Step 3: Write the failing normalization tests**

`test/normalize.test.ts` covers: `toE164` prefixes `+` and strips non-digits;
`toE164` returns `undefined` for an empty or non-numeric input; `displayNameFor` prefers
`name` over `pushname` and falls back to the E.164 number; `dedupeKeyFor` is stable across
formatting differences of the same number.

- [ ] **Step 4: Run the tests and confirm they fail**

Run: `pnpm --filter @bridge/whatsapp build && pnpm --filter @bridge/whatsapp test`
Expected: FAIL — `normalize.js` not found.

- [ ] **Step 5: Implement `src/normalize.ts`**

`toE164(raw)` strips everything but digits, returns `undefined` when no digits remain,
otherwise `"+" + digits`. `displayNameFor(contact)` returns the first non-empty of
`name`, `pushname`, `toE164(phone ?? id)`. `dedupeKeyFor(contact)` returns
`whatsapp:${toE164(...)}` so the same number in any format collapses to one key.

- [ ] **Step 6: Run the tests and confirm they pass, then commit**

```bash
git add platform/modules/whatsapp && git commit -m "feat(whatsapp): add module package with contact normalization"
```

---

### Task 4: Extraction mapping (TDD)

**Files:**
- Create: `platform/modules/whatsapp/src/extract.ts`
- Test: `platform/modules/whatsapp/test/extract.test.ts`

- [ ] **Step 1: Write the failing mapping tests**

Cover exactly these behaviors, each as its own test:
1. A contacts extraction with two contacts and no existing People yields two
   `person` proposals with local-only phone.
2. A contact whose dedupe key matches exactly one existing Person yields a link, not a
   new Person.
3. A contact whose dedupe key matches two or more existing People yields a
   `possible_duplicate` Signal and **no** link and **no** new Person.
4. A groups extraction yields one `community` proposal per group plus one `person`
   proposal per unmatched participant plus one membership `relation` per participant.
5. A participant appearing in two selected groups produces one Person proposal and two
   membership Relations.
6. Every proposal carries the `runId` so an approval can be traced to its capture.

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter @bridge/whatsapp build && pnpm --filter @bridge/whatsapp test`

- [ ] **Step 3: Implement `extract.ts`**

Export `mapExtraction(extraction: WhatsAppExtraction, existing: ExistingPersonIndex): ExtractionResult`
where `ExistingPersonIndex` is `{ byDedupeKey: Map<string, string[]> }` (key → Person ids,
so "two matches" is representable) and `ExtractionResult` is
`{ people: PersonProposal[]; communities: CommunityProposal[]; relations: RelationProposal[]; signals: DuplicateSignal[] }`.
The function is pure — no clock, no id generation beyond what the caller passes in.

- [ ] **Step 4: Run, confirm pass, commit**

```bash
git add platform/modules/whatsapp && git commit -m "feat(whatsapp): map extractions to People/Community proposals"
```

---

### Task 5: Tool registry (TDD)

**Files:**
- Create: `platform/modules/whatsapp/src/tools.ts`
- Test: `platform/modules/whatsapp/test/tools.test.ts`

- [ ] **Step 1: Write the failing test**

Assert `WHATSAPP_TOOLS` contains exactly one Tool in v1, with `id: "contact-extractor"`,
a non-empty `name`, `description`, and `modes: ["contacts", "groups"]`; and that
`requireTool("contact-extractor")` returns it while `requireTool("nope")` throws.

- [ ] **Step 2: Run, confirm failure**

- [ ] **Step 3: Implement the registry**

```ts
export interface WhatsAppTool {
  id: string;
  name: string;
  description: string;
  modes: readonly ("contacts" | "groups")[];
  /** Capability id in the Module manifest that gates this Tool. */
  capabilityId: string;
}

export const WHATSAPP_TOOLS: readonly WhatsAppTool[] = [
  {
    id: "contact-extractor",
    name: "Contact Extractor",
    description:
      "Read your WhatsApp contacts and selected groups, and stage them as People and Communities for approval.",
    modes: ["contacts", "groups"],
    capabilityId: "whatsapp.tool.contact-extractor",
  },
];
```

- [ ] **Step 4: Run, confirm pass, commit**

---

### Task 6: Manifest and registration (TDD)

**Files:**
- Create: `platform/modules/whatsapp/src/manifest.ts`, `src/index.ts`
- Test: `platform/modules/whatsapp/test/manifest.test.ts`
- Modify: `platform/modules/manifests/src/index.ts`

- [ ] **Step 1: Write the failing manifest test**

Mirror `modules/jobpilot/test/manifest.test.ts`. Assert: the manifest parses via
`parseModuleManifest`; it declares Pages `chats` and `tools`; every Tool's `capabilityId`
resolves to a declared capability; **no capability declares an egress permission** (v1 is
read-only); and the Module is absent from `COMMONS_BUILT_IN_MODULES`.

- [ ] **Step 2: Run, confirm failure**

- [ ] **Step 3: Write the capabilities and manifest**

Capabilities: `whatsapp.page.chats` (view), `whatsapp.page.tools` (view),
`whatsapp.tool.contact-extractor` (skill, `readPrivate("person")` +
`writePrivate("person")` + `writePrivate("community")`), and
`whatsapp.agent.contact-steward` (agent) depending on the Tool skill.
Module block: `displayName: "WhatsApp"`, `route: "/module/whatsapp/chats"`, Pages
`chats` → `/module/whatsapp/chats` and `tools` → `/module/whatsapp/tools`.

- [ ] **Step 4: Register in `BUILT_IN_MODULES`**

Append the entry with `computedRisk: "external"`, and add
`whatsapp: "platform/modules/whatsapp/src/manifest.ts"` to `BUILT_IN_SOURCE_REFS`.
Add `whatsapp` to the `COMMONS_BUILT_IN_MODULES` exclusion filter alongside `relationship`:

```ts
...BUILT_IN_MODULES.filter(
  (pkg) => pkg.manifest.name !== "relationship" && pkg.manifest.name !== "whatsapp",
).map(...)
```

- [ ] **Step 5: Run the manifests package tests, confirm pass, commit**

Run: `pnpm --filter @bridge/module-manifests build && pnpm --filter @bridge/module-manifests test`

---

### Task 7: Desktop webview — window lifecycle and navigation policy

**Files:**
- Create: `platform/apps/desktop/src-tauri/src/whatsapp_webview.rs`
- Modify: `platform/apps/desktop/src-tauri/src/lib.rs`

- [ ] **Step 1: Write the failing Rust unit tests**

In `whatsapp_webview.rs`'s `#[cfg(test)] mod tests`: `classify_navigation` allows
`https://web.whatsapp.com/...`, allows `about:blank`, **denies** `https://evil.example`,
denies `file:///etc/passwd`, and returns `Deliver` for a well-formed `bridge-wa://p/<b64>`
payload plus `DeliverInvalid` for a malformed one.

- [ ] **Step 2: Run, confirm failure**

Run: `cd platform/apps/desktop/src-tauri && cargo test whatsapp`

- [ ] **Step 3: Implement the module**

Copy `research_webview.rs`'s structure. Constants: `WHATSAPP_LABEL = "whatsapp-session"`,
`EXTRACT_SCHEME = "bridge-wa"`. Differences from the research reader, each deliberate:

- Origin allowlist is **not** "any http(s)" — only hosts ending in `whatsapp.com` and
  `whatsapp.net` are allowed, everything else denied.
- The window is decorations-off but **focusable and not always-on-bottom**: the user types
  into it.
- `initialization_script` is the vendored wa-js bundle (read via `include_str!`) followed
  by the Bridge extractor preamble.

- [ ] **Step 4: Verify the pinned hash at build time**

In `build.rs`, read `vendor/wppconnect-wa.js`, compute SHA-256, compare to
`vendor/wppconnect-wa.js.sha256`, and `panic!` on mismatch so a tampered or silently
updated bundle fails the build rather than shipping.

- [ ] **Step 5: Register in `lib.rs`**

Add `mod whatsapp_webview;`, `.manage(whatsapp_webview::WhatsAppState::default())`, and the
commands in `invoke_handler`.

- [ ] **Step 6: Run tests, confirm pass, commit**

```bash
cd platform/apps/desktop/src-tauri && cargo test whatsapp && cargo check
```

---

### Task 8: Desktop webview — positioning and the read-op allowlist

**Files:**
- Modify: `platform/apps/desktop/src-tauri/src/whatsapp_webview.rs`

- [ ] **Step 1: Write the failing allowlist test**

Assert `script_for_op` returns `Some(_)` for exactly `"list_contacts"`, `"list_groups"`,
and `"group_participants"`, and `None` for `"send_message"`, `"eval"`, and an arbitrary
JavaScript string. This test is the security boundary — it exists so a future edit that
adds a write op has to change a test that says v1 is read-only.

- [ ] **Step 2: Run, confirm failure**

- [ ] **Step 3: Implement the ops and commands**

`script_for_op(op: &str, arg: Option<&str>) -> Option<String>` maps each allowed name to a
fixed wa-js call wrapped in the outbound-navigation reporter. Arguments are never
interpolated raw — a group id is validated against `^[0-9]+-?[0-9]*@g\.us$` before use, and
rejected input yields `None`.

Commands: `whatsapp_open(rect)`, `whatsapp_position(rect)`, `whatsapp_hide()`,
`whatsapp_status()`, `whatsapp_extract_start(op, arg) -> job id`,
`whatsapp_extract_poll(job) -> { done, payload }`. All window mutation goes through
`run_on_main_thread`, as in `research_webview.rs`. Start/poll is mandatory here — a
contacts read on a large account will exceed the ~60s WKWebView abort threshold.

- [ ] **Step 4: Run tests, confirm pass, commit**

---

### Task 9: Web surface — Chats Page with rect tracking

**Files:**
- Create: `platform/apps/web/src/app/pages/whatsapp/whatsapp-shell.ts`
- Create: `platform/apps/web/src/app/pages/whatsapp/ChatsSurface.tsx`
- Create: `platform/apps/web/src/app/pages/WhatsAppPage.tsx`
- Modify: `platform/apps/web/src/app/routes.tsx`

- [ ] **Step 1: Write the typed shell wrappers**

`whatsapp-shell.ts` wraps `tauriInvoke` / `tauriInvokeJob` from
`../../avatar/tauri-internals` with `openSession(rect)`, `positionSession(rect)`,
`hideSession()`, `sessionStatus()`, and `runExtraction(op, arg)`. Every function
feature-detects `window.__BRIDGE_DESKTOP__` and returns an `unavailable` result in the
browser rather than throwing.

- [ ] **Step 2: Implement `ChatsSurface.tsx`**

Renders a `<div ref>` placeholder. On mount, if desktop: `openSession(rect)`. A
`ResizeObserver` on the placeholder plus `scroll` (capture) and `resize` listeners call
`positionSession(rect)`. On unmount, route change, and `window.blur`: `hideSession()`.
Outside the desktop shell it renders the honest unavailable state — "WhatsApp runs in the
Bridge desktop app" — with no fake chat UI.

- [ ] **Step 3: Implement `WhatsAppPage.tsx`**

Sibling Page toggles for Chats and Tools, matching the existing pattern in
`RelationshipSubmodulePage.tsx`, wrapped in `InstalledModuleBoundary moduleName="whatsapp"`.

- [ ] **Step 4: Add routes**

`/module/whatsapp/chats` and `/module/whatsapp/tools`, plus a redirect from
`/module/whatsapp` to `/chats`, following the DealPilot pattern.

- [ ] **Step 5: Verify in the running desktop app, then commit**

Launch the desktop app, click WhatsApp in the nav, confirm the session window aligns to the
content area, scroll and resize the window, then navigate away and confirm it hides.

---

### Task 10: Web surface — Tools Page and the Contact Extractor run panel

**Files:**
- Create: `platform/apps/web/src/app/pages/whatsapp/ToolsPanel.tsx`
- Create: `platform/apps/web/src/app/pages/whatsapp/ContactExtractorRun.tsx`

- [ ] **Step 1: Implement `ToolsPanel.tsx`**

Renders `WHATSAPP_TOOLS` from `@bridge/whatsapp` as a list. v1 has one row; the list is the
extension point, so no Tool is hardcoded in JSX.

- [ ] **Step 2: Implement `ContactExtractorRun.tsx`**

Mode selector (My contacts / Groups). In Groups mode, `runExtraction("list_groups")`
populates a checkbox list; the user selects which groups, then Run calls
`group_participants` once per selected group, sequentially — never in parallel. Results
render in a table with a count. "Stage N proposals" calls the API from Task 11.
Failures render the typed `{ code, message }` from the shell, not a generic error.

- [ ] **Step 3: Verify against the live session, then commit**

---

### Task 11: API — capture to Local Plane and stage proposals

**Files:**
- Modify: `platform/apps/api/src/router.ts`
- Modify: `platform/apps/api/src/wiring.ts`

- [ ] **Step 1: Add the `whatsapp` router**

`whatsapp: t.router({ stageExtraction: authenticatedProcedure.input(...).mutation(...) })`,
modelled on `google.syncGmail`. The mutation: writes the raw payload to the Local Plane
`BodyStore` under `whatsapp:capture:<runId>`; builds the `ExistingPersonIndex` from local
People; calls `mapExtraction`; stages the result as proposals through the same path Google
intake uses; returns `{ runId, staged: { people, communities, relations, signals } }`.

- [ ] **Step 2: Assert the residency boundary in a test**

A test asserting the raw payload is written only to the Local Plane store and that no
canonical write carries a phone number. This is the test that encodes the residency
decision — without it, "local-only" is a comment rather than a guarantee.

- [ ] **Step 3: Run the API tests, confirm pass, commit**

---

### Task 12: Governance artifacts

**Files:**
- Modify: `docs/raw/decisions-log.md`, `docs/wiki/decisions.md`
- Modify: `docs/TASKS.md`, `docs/APPROVALS.md`, `docs/log.md`
- Create: `docs/wiki/whatsapp-module.md`

- [ ] **Step 1: Append the ADR**

Rationale, rejected alternatives (whatsapp-web.js, Baileys, own DOM scrape, Tauri
`unstable`), and consequences — including the honest ToS statement and the fact that the
read-only guarantee lives in a Rust allowlist plus its test, not in convention.

- [ ] **Step 2: Add the TASK row with an independent exit test**

Exit test: from a cold app launch, the WhatsApp nav entry opens a linked session without a
new QR scan, the Contact Extractor stages at least one Person proposal from a real contact,
that proposal appears in Approvals, and approving it creates a Person whose phone number is
present in the Local Plane and absent from canonical storage.

- [ ] **Step 3: Add the APPROVALS row**

Record the user's 2026-08-01 approval of the new built-in Module as APPLIED.

- [ ] **Step 4: Write the caveman-terse wiki companion and the log entry, then commit**

---

### Task 13: Live verification

- [ ] **Step 1: Run the full exit test from Task 12 against a real WhatsApp account**

- [ ] **Step 2: Report the result honestly**

Record what passed, what did not, and anything skipped, with the actual output. If any part
fails, file it in `docs/BUGS.md` against the TASK rather than narrowing the exit test.
