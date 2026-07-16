---
title: "TASK-003 Platform-Neutral Avatar Drag, Position Persistence, and Window Chrome"
date: 2026-07-16
task: TASK-003
status: in_progress — macOS prototype test outstanding
scope: platform-neutral only (macOS-specific items flagged below)
---

## What was delivered

### 1. Real drag support for the Avatar overlay

**File:** `platform/apps/desktop/src-tauri/src/overlay.rs`  
**File:** `platform/apps/web/src/app/avatar/OverlayApp.tsx`

- Added a `data-tauri-drag-region` drag handle div at the top of the collapsed Avatar button.
  The OS handles window movement via Tauri's native drag primitive — no IPC polling during drag,
  works on macOS, Windows, and Linux without any platform-specific dependency.
- The drag handle is hidden when any panel is expanded (status, chat, menu) so it only appears
  when the Avatar is in collapsed/hover state.
- `handleDragHandlePointerDown` attaches a one-shot document `pointerup` listener per drag
  that calls `overlay_save_position` when the drag ends.
- Cursor changes to `grab`/`grabbing` with a subtle three-dot indicator on hover.

### 2. Persisted window position

**File:** `platform/apps/desktop/src-tauri/src/overlay.rs`

- `overlay_save_position(window, app)` — persists the overlay window's current physical position
  to `{app_data_dir}/bridge/overlay_positions.json` (atomic temp→rename write, keyed by window
  label so each monitor's instance is stored independently).
- `overlay_get_position(window, app)` — returns the reconciled saved position for the calling
  window, or `null` if absent/off-screen.
- `PositionMap = HashMap<String, PersistedPosition>` roundtrips via `serde_json`.

### 3. Bounds / display-topology reconciliation

**File:** `platform/apps/desktop/src-tauri/src/overlay.rs`

- `is_on_screen(pos, monitors, win_w, win_h, margin)` — checks whether the saved position has
  at least `margin` (32 physical pixels) visible on any connected monitor.
- `reconcile_saved_position(app, label, monitors, win_w, win_h)` — loads the saved position and
  runs the on-screen check; returns `None` when absent or off-screen so the caller falls back to
  the default bottom-right anchor.
- `create_one_overlay_window` now calls `reconcile_saved_position` at window creation, restoring
  the user's last position when valid or anchoring bottom-right otherwise.
- Guard behaviour: an empty monitor list (enumeration failure) accepts any saved position rather
  than mis-anchoring.

### 4. Native window control placement (cross-platform-safe portion)

**File:** `platform/apps/web/src/app/components/shared/DesktopWindowChrome.tsx`  
**File:** `platform/apps/web/src/app/Layout.tsx`  
**File:** `platform/apps/desktop/src-tauri/src/lib.rs`

- `DesktopWindowChrome` component: renders close (red), minimize (yellow), zoom (green) buttons
  in the sidebar header, visible only when `window.__TAURI_INTERNALS__` is present. Uses
  OS-agnostic styling that works on all platforms.
- `data-tauri-drag-region` attribute added to the chrome wrapper as a forward-compatible hook
  for the macOS title-bar-removal work (has no effect on decorated windows until that work
  is done).
- Rust commands registered in `lib.rs`: `close_main_window`, `minimize_main_window`,
  `toggle_zoom_main_window`.

### 5. Multi-monitor capabilities coverage

**File:** `platform/apps/desktop/src-tauri/capabilities/default.json`

- `windows` array extended to `["main", "overlay", "overlay-1", "overlay-2", "overlay-3"]`,
  covering up to 4 connected displays.

### 6. Unit tests

**File:** `platform/apps/desktop/src-tauri/src/overlay.rs` `overlay::tests` module

12 new tests:
- `position_on_screen_typical` — window at (900, 800) on 1920×1080 → valid
- `position_off_screen_too_far_right` — window right-edge past margin → invalid
- `position_off_screen_entirely_outside` — saved on disconnected second monitor → invalid
- `position_on_second_monitor` — valid on secondary display at x=1920
- `position_empty_monitor_list_always_accepted` — no monitor info → accept position
- `position_bottom_right_default_anchor_on_primary` — default anchor is valid on primary
- `label_for_monitor_zero_is_bare_overlay` — `"overlay"`
- `label_for_monitor_nonzero_appends_index` — `"overlay-1"`, `"overlay-3"`
- `persisted_position_roundtrips_json`
- `position_map_roundtrips_json` — multi-key map roundtrip

**Test result:** 18/18 pass (12 new + 6 pre-existing).

---

## Checks run

| Check | Result |
|-------|--------|
| `cargo test --lib` (bridge-desktop) | ✅ 18/18 pass |
| TypeScript errors introduced by this session | ✅ 0 new errors |
| Pre-existing TypeScript errors | unchanged (7 in Layout.tsx, 1 in OverlayApp.tsx) |
| No new dependencies added | ✅ confirmed |

---

## macOS-only blockers (NOT implemented — requires local macOS session)

These items are explicitly called out in the TASK-003 scope
(`egg-commons-feature-roadmap-2026-07.md §1.3`) and in `overlay.rs`'s module doc.

### 1. `tauri-nspanel` — NonActivatingPanel + join-all-Spaces + FullScreenAuxiliary

The roadmap calls for migrating companion windows to `tauri-nspanel` so the Avatar:
- Floats over fullscreen apps without stealing keyboard focus (`NSNonactivatingPanelMask`)
- Persists across all macOS Spaces (`NSWindowCollectionBehaviorCanJoinAllSpaces`)
- Is visible when the user enters fullscreen (`NSWindowCollectionBehaviorFullScreenAuxiliary`)

**Why not implemented here:** `tauri-nspanel` is macOS-only. Adding it was explicitly prohibited
by the task constraints ("do not add macOS-only dependencies"). It must be added in a local macOS
session and tested with `cargo tauri dev` on a real Mac.

**How to implement:**
1. Add `tauri-nspanel = { git = "...", version = "..." }` to `Cargo.toml`
   under `[target.'cfg(target_os = "macos")'.dependencies]`.
2. In `create_one_overlay_window`, after `.build()`, call the nspanel API to set the collection
   behaviour and panel style mask.
3. Verify with: switch Spaces, enter fullscreen, check avatar remains visible and doesn't steal
   focus when expanded.

### 2. Traffic lights in sidebar (macOS title-bar removal)

The "native window controls inside the Sidebar header" full experience:
- `decorations(false)` on the main window builder in `lib.rs`
- `data-tauri-drag-region` on the sidebar header `h-14` div in `Layout.tsx`
  (already present on `DesktopWindowChrome` wrapper as a forward-compatible hook)
- macOS-specific CSS: position the native traffic lights via `-webkit-app-region: drag/no-drag`
  or `env(titlebar-area-x/y/width/height)` (requires `hiddenTitle: true` in `tauri.conf.json`)

**Why not implemented here:** Removing decorations changes the window chrome visibly on all
platforms. The final appearance and accessibility need macOS verification before shipping.

### 3. Multi-monitor hot-plug

Still static-at-launch only. Monitors plugged/unplugged after startup do not add/remove overlay
instances. Tauri does not emit a monitor-added event; an AppKit `NSScreens-changed` observer
or a periodic topology check would be needed.

---

## TASK-003 prototype test status

> *Drag the Avatar, change Spaces, enter/exit fullscreen, attach/detach an extended display,
> and move between displays; position persists/reconciles and close/minimize/zoom remain
> accessible in the supplied-reference layout.*

| Test step | Status |
|-----------|--------|
| Drag the Avatar | ✅ Drag handle implemented (needs live device verification) |
| Position persists after restart | ✅ Implemented (needs live device verification) |
| Bounds reconciliation on display change | ✅ Implemented (needs live device verification) |
| Change Spaces | ❌ **macOS blocker** — requires `tauri-nspanel` |
| Enter/exit fullscreen | ❌ **macOS blocker** — requires `tauri-nspanel` |
| Attach/detach extended display | ⚠️ Reconciliation works at next launch; hot-plug not supported |
| Move between displays | ✅ Per-label position persistence handles this |
| close/minimize/zoom accessible | ✅ `DesktopWindowChrome` + native title bar (which stays) |

**TASK-003 status: `in_progress`** — the platform-neutral work is complete; the macOS-specific
prototype test requires a local macOS session with `tauri-nspanel` added.
