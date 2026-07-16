---
title: "TASK-003 macOS Avatar Panel, Display Reconciliation, and Native Sidebar Chrome"
date: 2026-07-16
task: TASK-003
status: blocked — implementation complete; physical extended-display/full interaction matrix unavailable
---

# Outcome

The outstanding macOS slice is implemented. The landed platform-neutral drag and atomic position persistence remain intact.

## Delivered

- `platform/apps/desktop/src-tauri/Cargo.toml` / `Cargo.lock`
  - Added macOS-only `tauri-nspanel` 2.1.0 pinned to inspected commit `a3122e894383aa068ec5365a42994e3ac94ba1b6`.
  - Upstream license at that revision: MIT OR Apache-2.0.
- `platform/apps/desktop/src-tauri/src/overlay.rs`
  - Converts each macOS overlay to `AvatarPanel`.
  - Applies non-activating style, floating level, join-all-Spaces, and fullscreen-auxiliary behavior.
  - Polls monitor geometry/scale every second.
  - Creates overlays on attach, removes stale windows/panels on detach, detects reposition/scale changes, and re-anchors off-screen positions.
  - Adds deterministic attach/detach and topology-change tests.
- `platform/apps/desktop/src-tauri/src/lib.rs`
  - Registers the NSPanel plugin only for macOS.
  - Starts/stops topology reconciliation with the app.
  - Uses a hidden overlay title bar on macOS.
- `platform/apps/web/src/app/Layout.tsx`
- `platform/apps/web/src/app/components/shared/DesktopWindowChrome.tsx`
- `platform/apps/web/src/desktop-shell.d.ts`
  - Reserves a draggable Sidebar titlebar lane for AppKit's real traffic lights.
  - Removes duplicate HTML controls.
  - Browser/Windows/Linux degrade safely to their native decorations.

# Verification evidence

- Rust library tests: 27 passed.
- Rust Clippy: clean with `-D warnings`.
- Web tests: 24 passed.
- Targeted web ESLint: clean.
- Dependency tree resolves exact `tauri-nspanel` revision `a3122e8`.
- Real `pnpm --filter @bridge/desktop tauri dev --no-watch` on macOS 26.5.1:
  - app launched and remained running;
  - runtime logged `class="AvatarPanel" floating=true`;
  - runtime logged `policy=nonactivating+all-spaces+fullscreen-auxiliary`;
  - CoreGraphics observed the 96×96 floating Avatar window.
- Resumed single-display live pass:
  - CoreGraphics observed the Avatar at floating layer 3 while the main Bridge window occupied another Space;
  - the Avatar remained on-screen through enter and exit fullscreen;
  - macOS Accessibility exposed `Drag to move Owl` and accepted interaction without making Bridge frontmost;
  - the standard Bridge window exposed enabled `close button`, `full screen button`, and `minimize button` elements;
  - minimization left the Avatar present.
- Certification retry after macOS permissions changed:
  - `AXIsProcessTrusted=true`, `CGPreflightScreenCaptureAccess=true`, and System Events UI scripting enabled;
  - CoreGraphics reported one active, online, built-in display and AppKit reported one screen at scale 2.0;
  - launches were isolated by worktree PID (`84703`, then `87969` after relaunch), leaving the other running Bridge build untouched;
  - when GitHub Copilot's Space was active, only the task Avatar remained on-screen; activating the task PID showed both Bridge and the Avatar; switching back again left only the Avatar;
  - menu, Command-Control-F, and pointer activation each exercised fullscreen; the Avatar remained at floating layer 3 through enter and exit;
  - Accessibility exposed enabled native close/fullscreen/minimize buttons in the Sidebar lane;
  - trusted pointer actions operated minimize, fullscreen, and close; `AXPress` operated close; the Avatar remained visible after each main-window transition;
  - the saved physical position `{x: 3180, y: 1830}` restored as the 96×96 logical window at `{x: 1590, y: 915}` after relaunch, but no physical drag to a new position was available, so this is not counted as drag-persistence proof.
- Full web typecheck is blocked only by the pre-existing missing `Link` import in `platform/apps/web/src/app/pages/IntelligencePage.tsx`; changed files add no lint/type errors.

# Exact remaining physical check

This Mac reports exactly one online built-in Liquid Retina display; no attachable extended display is available. Accessibility and screen-recording permissions now pass, and Space/fullscreen plus pointer/keyboard/AX control paths were reverified. Synthesized movement is not a substitute for a physical drag, and an actual VoiceOver operator pass was not performed. Therefore TASK-003's exact prototype test cannot honestly be marked passed here.

On suitable hardware, physically:

1. Drag the Avatar, quit/relaunch, and confirm position restoration.
2. Switch macOS Spaces and confirm the Avatar remains visible without focus theft.
3. Enter/exit a fullscreen app and confirm auxiliary presence.
4. Attach, detach, and reposition an extended display; confirm overlays add/remove and off-screen positions reconcile.
5. Move the Avatar between displays and repeat relaunch/topology transitions.
6. Confirm AppKit close/minimize/zoom are visible in the Sidebar lane and operate via mouse, keyboard, and VoiceOver.

# Linked evidence

- [Canonical task](../docs/TASKS.md)
- [Bug evidence](../docs/BUGS.md)
- [ADR-096](../docs/raw/decisions-log.md)
- [Platform-neutral predecessor](./2026-07-16-task-003-avatar-drag-persistence.md)
