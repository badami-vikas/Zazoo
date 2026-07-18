---
title: "TASK-003 Real macOS Avatar Certification Recovery"
date: 2026-07-18
task: TASK-003
status: blocked
---

# Outcome

TASK-003 remains blocked. Reviewed fixes from the failed certification session are recovered on current `origin/main`, with additional lifecycle hardening and no physical-input overclaim.

## Evidence provenance

The real macOS/display/VoiceOver observations below were produced by the failed TASK-003 run and preserved as reported evidence. This recovery did not repeat those physical-host observations; it independently reviewed the code and documentation and reran the software gates.

## Defects fixed

- **Direct Avatar drag target:** the first human physical check found the Avatar button itself inert because only a 10px handle carried Tauri's drag-region hook. Pointer movement on the Avatar now crosses a threshold before invoking native dragging, while ordinary click and keyboard activation still open the panel. Live retest is pending.
- **Mixed-DPI placement:** Tao's per-monitor physical coordinates overlap on macOS. macOS persistence and placement now use tagged logical desktop coordinates; other platforms retain physical coordinates.
- **Drag persistence:** a native window drag need not return `pointerup` to the webview. Native `Moved` events now feed one debounced save worker per overlay label.
- **Topology removal crash:** directly closing a converted `AvatarPanel` aborted with `Rust cannot catch foreign exceptions`. The panel now converts back to its Tauri window before close.

## Recovery review findings

- The debounce worker now resolves the current window by label when saving. A removed and quickly recreated overlay cannot have its move events coalesced into a worker holding the destroyed window.
- `ExitRequested` flushes current overlay positions synchronously, so quitting inside the 300 ms debounce cannot lose the last move.
- Startup retries missing overlay membership without re-anchoring valid restored windows; unchanged topology no longer suppresses a pre-registration build failure.
- Topology reconciliation anchors an expanded panel with its current logical size, preserving the expected bottom-right after collapse.
- macOS close falls back to the ordinary Tauri window when panel registration never completed; registered NSPanels still always revert through `Panel::to_window()` first.
- Evidence wording distinguishes extend→mirror→extend topology removal/re-add and Accessibility-driven movement from literal cable detach and physical pointer drag.
- AP-040 and ADR-114 are collision-free against current main; ADR-113 remains claimed by paused TASK-022/TASK-023 worktrees.

## Reported live evidence

- Real Tauri app on macOS 26.5.1 with one Retina display and two physically connected 1x external displays. Three live `AvatarPanel` windows appeared, one per display, with non-activating, all-Spaces, fullscreen-auxiliary policy.
- Mixed-DPI anchors matched each screen. Accessibility-driven movement across displays wrote tagged logical state and restored after quit/relaunch. This exercises native move-event/save/relaunch but is **not** a physical pointer drag.
- Repositioning an external display changed AppKit/CoreGraphics geometry; its panel reconciled to the new bottom-right anchor and returned when the arrangement was restored.
- Switching one connected external display extend→mirror→extend changed real AppKit screen and Avatar counts `3→2→3`. The same desktop PID survived; the removed NSPanel closed cleanly and the re-added panel was recreated.
- Actual VoiceOver Item Chooser navigated to native minimize, close, and fullscreen controls and announced each action. Synthetic `Control-Option-Space` was ignored, so human physical VoiceOver activation is not claimed.
- Fullscreen retained all three Avatar panels at floating layer 3. Prior cross-Space and pointer/keyboard/Accessibility control evidence remains in `outputs/2026-07-16-task-003-macos-avatar.md`.

## Exact blocker

1. A human must physically drag an Avatar, quit the app, relaunch it, and confirm restoration.
2. A human VoiceOver operator must activate close/minimize/zoom with physical input.
3. If "attach/detach" requires literal cable or power removal rather than the passing real-hardware extend→mirror→extend topology removal/re-add, perform that cable/power cycle too.

No simulated topology or agent-generated input is counted as physical evidence.

## Recovery verification

- Desktop Rust library: 31 passed.
- Desktop Clippy with warnings denied: passed.
- Desktop Cargo check: passed.
- Web tests: 49 passed.
- Web dependency/web production build: passed.
- Web typecheck and targeted Avatar ESLint: passed.
- Runtime dummy-data gate: passed.

## Links

- [Canonical task](../docs/TASKS.md)
- [Bug evidence](../docs/BUGS.md)
- [ADR-114](../docs/raw/decisions-log.md)
- [Prior macOS evidence](./2026-07-16-task-003-macos-avatar.md)
