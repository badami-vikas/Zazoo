# TASK-030 Track B — the `WhatsAppEngine` adapter, event channel, and the wa-js licence notice

Date: 2026-08-02 · Tier C · governed by AP-091 and ADR-158 · branch
`worktree-agent-a80759bcdf3a01df6` (based on `claude/whatsapp-module-contact-extractor-9cfff3`).

## What shipped

### B1 — `WhatsAppEngine`

New `platform/apps/web/src/app/pages/whatsapp/engine.ts` defines and exports one
`WhatsAppEngine` interface and the single `whatsAppEngine` instance every WhatsApp surface
consumes. `whatsapp-shell.ts` is now explicitly the transport layer beneath it and is no longer
imported by any component.

Surface:

- `isAvailable()`
- `getConnectionState()`, `listContacts()`, `listGroups()`, `groupParticipants(groupId)`,
  `listDirectChatIds()`, `pnLidMap()`
- `showSession(rect)`, `positionSession(rect)`, `hideSession()`
- `subscribe(listener) → Unsubscribe`

Two deliberate deviations from the sketch in the brief:

- **`listDirectChatIds(): Promise<string[]>` rather than `listChats(): Promise<Chat[]>`.** v1's
  allowlisted `list_direct_chats` script returns serialized chat ids only, not chat models. Typing
  it as `Chat[]` would promise a shape the engine cannot deliver.
- **No `listContacts`/`listGroups` merge into a single `Contact[]`.** The payload shapes returned by
  the allowlist (`RawContact`, `RawGroup`, `PnLidPair`) are re-exported unchanged from the transport
  layer, so no shape drifted during the refactor.

**The two-layer constraint holds.** The TypeScript layer only ever *names* an operation; the Rust
allowlist owns the script. No method accepts a script, selector, or expression. The one
caller-supplied value that reaches a script at all is `groupParticipants`'s group id, which
`whatsapp_webview.rs` shape-checks with `is_group_id` before interpolation — on the trusted side of
the boundary. `engine.ts` contains no `window.WPP`, no `eval`, no `new Function`, and no raw
invoke passthrough; a test asserts this at source level.

**Preserved behaviour** (all three verified by test):

- Start-then-poll job shape with the 300s timeout (BUGS 2026-07-30 — a command answering after ~60s
  aborts the whole app under WKWebView). Untouched in `whatsapp-shell.ts`; the engine delegates.
- Viewport-relative rect, no `screenX`/`screenY` (Retina WKWebView unit mismatch).
- No blur listener in `ChatsSurface` (showing the session moves focus; a blur-hide handler hid it
  instantly).

### B2 — `subscribe()` over the batched channel

`subscribe()` listens on `WHATSAPP_EVENT_CHANNEL = "whatsapp:events"` via the existing
`tauriListen` internals helper (naming follows `annotate:marks` / `sensor:capture`). It returns
synchronously so a React cleanup can unsubscribe without awaiting, resolves the real unlisten in the
background, and swallows the failure if the channel does not exist — returning an effective no-op
rather than throwing. Payloads are normalised into a flat list of inert
`{ type, at?, data? }` envelopes; unrecognised entries are dropped.

`ChatsSurface` subscribes and uses events only to refresh the connection state *sooner* than the
existing 3s poll would. The poll remains the sole guarantee, so a channel that never fires changes
nothing the user sees.

> **TODO recorded in code** (`engine.ts`): the Rust emitter for `whatsapp:events` — the injected
> coalescing wa-js listener, including "active chat changed" — is owned by the sibling agent on
> Track A. Until it lands, `subscribe()` is a live listener that never fires. **No `.rs` file was
> touched by this track.**

### B3 — the missing Apache-2.0 licence notice

`platform/apps/desktop/src-tauri/vendor/wppconnect-wa.js.LICENSE.txt` is now vendored (4,198 bytes,
124 lines, sha256 `7e6cab7784b48fd1133f75e4bfc57358ec9c85c329a72c3bb8dc919436078793`).

**Provenance and version verification — not asserted, checked.** `npm pack @wppconnect/wa-js@4.5.0`
produced a tarball whose `package/dist/wppconnect-wa.js` hashes to
`e11d8992e0d68a3283930785aa61e65e5ff6dd96be512a99ae0e68072c365dd9` — **byte-identical to the
vendored bundle and to the existing `.sha256` pin**. The companion file was copied unmodified from
that same `package/dist/`, so it is the exact notice file our bundle's header references, not a
same-version approximation. Nothing was hand-written.

The notice covers Compressor.js (MIT), the WPPConnect Team Apache-2.0 grant, and the other bundled
third-party notices webpack extracted.

## Verification

| Check | Command | Result |
| --- | --- | --- |
| Web typecheck | `pnpm turbo run typecheck --filter=@bridge/web` | **Pass**, clean |
| Web test suite | `pnpm turbo run test --filter=@bridge/web` | **Pass** — 115 tests, 0 fail (10 new) |
| Lint | `npx eslint apps/web/src/app/pages/whatsapp apps/web/test/whatsapp-engine.test.mjs` | **Pass**, no output |
| Bundle ↔ licence provenance | `shasum -a 256` against the npm tarball | **Pass**, byte-identical |

New tests live in `platform/apps/web/test/whatsapp-engine.test.mjs` (the web app runs
`node --test`, not vitest). They are source-level on purpose: the boundary's property is what the
code is *able* to express, which a runtime test over a stubbed shell cannot observe. They assert
allowlist parity between `engine.ts` and `whatsapp_webview.rs`, literal-only op names, absence of
code-supplying APIs, that surfaces import the engine rather than the transport, and each of the
three preserved WKWebView behaviours.

**Unverified** (stated plainly rather than implied):

- Nothing was run against a live WhatsApp session or the built desktop app. Session positioning,
  status polling, and extraction runs are unchanged code paths reached through a renamed adapter,
  but that reasoning is not a runtime observation.
- `subscribe()` has never received a real event — the producer does not exist yet.
- `platform/modules/whatsapp` was not touched, so its `node --test` over `dist/` was not re-run.
- No Rust build or `cargo test` was run; no `.rs` file changed.

## Notes for the other tracks

- The event channel name `whatsapp:events` and the `{ type, at?, data? }` envelope are this track's
  proposal. If Track A picks a different name or shape, `WHATSAPP_EVENT_CHANNEL` and `toEvents()` in
  `engine.ts` are the only two places to change.
- `whatsapp-engine.test.mjs` reads `whatsapp_webview.rs` to enforce allowlist parity. Adding a read
  op means adding it in both layers; the test will say so if only one moves.
- `docs/wiki/whatsapp.md` and `docs/raw/decisions-log.md` were deliberately **not** edited — both are
  shared with the sibling tracks, and this work records no new decision beyond ADR-158.
