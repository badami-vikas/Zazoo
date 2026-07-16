//! overlay — the floating desktop companion window(s) (R-002).
//!
//! The avatar is an OS-level window, not a div: one Tauri webview window PER
//! CONNECTED MONITOR (label `overlay` on the primary/first monitor,
//! `overlay-1`, `overlay-2`, … on the rest), each small (96×96 collapsed),
//! transparent, undecorated, always-on-top, skip-taskbar, anchored
//! bottom-right of ITS OWN screen. All instances share one frontend —
//! apps/web's `overlay.html` entry (OverlayApp.tsx) — which reuses the same
//! Creature + avatar-store as the in-page AvatarOverlay and drives the
//! Invoko-spec state machine (v1: collapsed → hover → expanded_idle →
//! working). Expanding/collapsing calls `overlay_resize` here so the WINDOW
//! grows, keeping its bottom-right corner pinned; the command takes the
//! CALLING window as a parameter (Tauri auto-injects it — see
//! `WebviewWindow`'s `CommandArg` impl), so the same command correctly
//! resizes whichever monitor's instance the user is interacting with,
//! without needing to know which one that is.
//!
//! **Drag + persistence (TASK-003)**
//! The overlay frontend adds a `data-tauri-drag-region` drag handle so the
//! user can reposition the companion freely. After any drag, the frontend
//! calls `overlay_save_position` to persist the window's physical position in
//! `{app_data_dir}/bridge/overlay_positions.json`. At next launch,
//! `create_overlay_windows` reads that file and calls
//! `reconcile_saved_position` to validate the saved position against current
//! monitor topology (guard against: monitor unplugged, resolution change,
//! rotated display). A position outside every monitor's bounds falls back to
//! the default bottom-right anchor.
//!
//! **macOS Spaces / fullscreen — NOT implemented here (TASK-003 blocker)**
//! The roadmap (egg-commons-feature-roadmap-2026-07.md §1.3) calls for
//! `tauri-nspanel` (NonActivatingPanel + FullScreenAuxiliary +
//! NSWindowCollectionBehaviorCanJoinAllSpaces) so the avatar persists across
//! macOS Spaces and floats over fullscreen apps without stealing focus. That
//! crate is macOS-only and has not been added (no new macOS dependencies per
//! this task's constraints). These three behaviours must be verified and
//! enabled in a local macOS session:
//!   1. Avatar visible when switching Spaces (NSWindowCollectionBehaviorCanJoinAllSpaces).
//!   2. Avatar visible over fullscreen apps (NSWindowCollectionBehaviorFullScreenAuxiliary).
//!   3. Avatar panel does not steal keyboard focus on expand (NSNonactivatingPanelMask).
//!
//! **Multi-monitor hot-plug** — still static-at-launch only. A monitor
//! plugged/unplugged after startup does not add/remove overlay instances.
//! Tauri doesn't emit a monitor-added event; a periodic topology check or
//! AppKit NSScreens-changed observer would be needed.

use std::collections::HashMap;
use tauri::{
    AppHandle, LogicalSize, Manager, Monitor, PhysicalPosition, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

pub const OVERLAY_LABEL: &str = "overlay";
pub const MAIN_LABEL: &str = "main";
pub const COLLAPSED_SIZE: f64 = 96.0;
/// Gap from the screen edges. Tao monitors don't expose the macOS "visible
/// frame" (work area minus Dock/menu bar), so the bottom margin is padded
/// enough to clear a default Dock.
const MARGIN_RIGHT: f64 = 24.0;
const MARGIN_BOTTOM: f64 = 96.0;

// ---------------------------------------------------------------------------
// Position persistence (TASK-003)
// ---------------------------------------------------------------------------

/// A saved window position in PHYSICAL pixels, keyed by overlay window label.
/// Physical pixels are used because that is what Tauri's set_position /
/// outer_position speak natively. On scale-factor or resolution change the
/// reconciler clamps the position to a valid monitor anyway, so storing
/// device pixels is safe.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct PersistedPosition {
    pub x: i32,
    pub y: i32,
}

type PositionMap = HashMap<String, PersistedPosition>;

/// Returns the path to `{app_data_dir}/bridge/overlay_positions.json`.
/// Returns `None` when `app_data_dir` is unavailable (rare; safe to ignore).
fn positions_file(app: &AppHandle) -> Option<std::path::PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    Some(dir.join("bridge").join("overlay_positions.json"))
}

/// Load the saved position map. Returns an empty map on any I/O or parse
/// error — degrading gracefully to default anchoring rather than panicking.
pub fn load_positions(app: &AppHandle) -> PositionMap {
    let Some(path) = positions_file(app) else { return HashMap::new() };
    let Ok(bytes) = std::fs::read(&path) else { return HashMap::new() };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

/// Persist the full position map atomically (write temp → rename).
/// Errors are logged but never propagated — position persistence is a
/// best-effort UX improvement, not a load-bearing invariant.
fn save_positions(app: &AppHandle, map: &PositionMap) {
    let Some(path) = positions_file(app) else { return };
    // Ensure parent directories exist.
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let Ok(json) = serde_json::to_vec_pretty(map) else { return };
    // Write to a sibling temp file then rename for atomicity.
    let tmp = path.with_extension("json.tmp");
    if std::fs::write(&tmp, &json).is_ok() {
        let _ = std::fs::rename(&tmp, &path);
    }
}

/// Check whether `pos` sits within the bounds of any known monitor (with at
/// least a `margin` pixels of the window visible, so a minimal drag handle
/// is always reachable even after display topology changes).
///
/// Returns `true` when the position is usable; `false` when the saved position
/// is entirely off-screen and the window should be re-anchored.
pub fn is_on_screen(
    pos: &PersistedPosition,
    monitors: &[Monitor],
    window_physical_w: u32,
    window_physical_h: u32,
    margin: i32,
) -> bool {
    if monitors.is_empty() {
        // No monitor info — accept any position rather than mis-anchoring.
        return true;
    }
    for m in monitors {
        let mx = m.position().x;
        let my = m.position().y;
        let mw = m.size().width as i32;
        let mh = m.size().height as i32;
        // The window corner must be at least `margin` pixels inside the monitor.
        let min_visible_x = mx - window_physical_w as i32 + margin;
        let max_visible_x = mx + mw - margin;
        let min_visible_y = my - window_physical_h as i32 + margin;
        let max_visible_y = my + mh - margin;
        if pos.x >= min_visible_x
            && pos.x <= max_visible_x
            && pos.y >= min_visible_y
            && pos.y <= max_visible_y
        {
            return true;
        }
    }
    false
}

/// Attempt to restore a previously-saved position for `label`. Returns the
/// saved `PersistedPosition` when it passes the on-screen check, or `None`
/// when the saved position is absent / off-screen (caller falls back to
/// `anchor_bottom_right`).
pub fn reconcile_saved_position(
    app: &AppHandle,
    label: &str,
    monitors: &[Monitor],
    window_physical_w: u32,
    window_physical_h: u32,
) -> Option<PersistedPosition> {
    let map = load_positions(app);
    let pos = map.get(label)?;
    // Minimum visible margin = 32 physical pixels (~24 logical at 1x).
    if is_on_screen(pos, monitors, window_physical_w, window_physical_h, 32) {
        Some(pos.clone())
    } else {
        None
    }
}

/// Window label for the Nth monitor (0-indexed) — the first monitor keeps
/// the original unlabeled-suffix name so single-monitor setups (still the
/// common case) are unaffected.
fn label_for_monitor(index: usize) -> String {
    if index == 0 {
        OVERLAY_LABEL.to_string()
    } else {
        format!("{OVERLAY_LABEL}-{index}")
    }
}

/// Position `win` bottom-right of `monitor`, sized at `COLLAPSED_SIZE`
/// (logical) scaled to that monitor's own scale factor.
fn anchor_bottom_right(win: &WebviewWindow, monitor: &Monitor) {
    let scale = monitor.scale_factor();
    let msize = monitor.size();
    let mpos = monitor.position();
    let wsize = win.outer_size().unwrap_or(tauri::PhysicalSize {
        width: (COLLAPSED_SIZE * scale) as u32,
        height: (COLLAPSED_SIZE * scale) as u32,
    });
    let x = mpos.x + msize.width as i32 - wsize.width as i32 - (MARGIN_RIGHT * scale) as i32;
    let y = mpos.y + msize.height as i32 - wsize.height as i32 - (MARGIN_BOTTOM * scale) as i32;
    let _ = win.set_position(PhysicalPosition::new(x, y));
}

/// Create one overlay window per connected monitor (falls back to a single
/// window with no monitor anchoring if enumeration fails or returns empty —
/// never leaves the user with zero companions just because monitor
/// enumeration hiccuped). `init_script` carries the same
/// `window.__BRIDGE_API_URL__` injection as the main window so every
/// instance's tRPC client talks to the sidecar API too.
pub fn create_overlay_windows(app: &AppHandle, init_script: &str) -> tauri::Result<()> {
    let monitors = app.available_monitors().unwrap_or_default();
    if monitors.is_empty() {
        return create_one_overlay_window(app, init_script, 0, None);
    }
    let mut first_err: Option<tauri::Error> = None;
    for (index, monitor) in monitors.iter().enumerate() {
        if let Err(err) = create_one_overlay_window(app, init_script, index, Some(monitor)) {
            eprintln!("[bridge-desktop] failed to create overlay window for monitor {index}: {err}");
            first_err.get_or_insert(err);
        }
    }
    // Only fail the caller if EVERY monitor failed — a partial multi-monitor
    // rollout (e.g. one weird virtual display) still leaves a usable
    // companion on the monitors that worked.
    let any_overlay_created = app.webview_windows().keys().any(|l| l.starts_with(OVERLAY_LABEL));
    if let Some(err) = first_err {
        if !any_overlay_created {
            return Err(err);
        }
    }
    Ok(())
}

fn create_one_overlay_window(
    app: &AppHandle,
    init_script: &str,
    index: usize,
    monitor: Option<&Monitor>,
) -> tauri::Result<()> {
    let label = label_for_monitor(index);
    let win = WebviewWindowBuilder::new(
        app,
        &label,
        // Separate Vite entry (apps/web/overlay.html) rather than an SPA
        // route: the Tauri asset protocol serves files, it does not do
        // history-API fallback, so a real file is the reliable target in
        // both dev (Vite serves /overlay.html) and prod (dist/overlay.html).
        WebviewUrl::App("overlay.html".into()),
    )
    .title("Bridge Companion")
    .inner_size(COLLAPSED_SIZE, COLLAPSED_SIZE)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .accept_first_mouse(true)
    .initialization_script(init_script)
    .build()?;

    // Try to restore a previously-saved drag position. Fall back to the
    // default bottom-right anchor when absent or off-screen.
    let restored = {
        let monitors: Vec<Monitor> = app.available_monitors().unwrap_or_default();
        let phys_size = win
            .outer_size()
            .unwrap_or(tauri::PhysicalSize {
                width: (COLLAPSED_SIZE * win.scale_factor().unwrap_or(1.0)) as u32,
                height: (COLLAPSED_SIZE * win.scale_factor().unwrap_or(1.0)) as u32,
            });
        reconcile_saved_position(app, &label, &monitors, phys_size.width, phys_size.height)
    };

    if let Some(saved) = restored {
        let _ = win.set_position(PhysicalPosition::new(saved.x, saved.y));
    } else {
        // Default anchor: bottom-right of the target monitor when known;
        // otherwise fall back to whatever monitor the window landed on.
        match monitor {
            Some(m) => anchor_bottom_right(&win, m),
            None => {
                if let Ok(Some(m)) = win.current_monitor() {
                    anchor_bottom_right(&win, &m);
                }
            }
        }
    }
    Ok(())
}

/// Resize the CALLING overlay window (whichever monitor's instance the user
/// is interacting with — Tauri injects it via the `WebviewWindow` param,
/// resolved from the IPC message's originating webview, never a fixed
/// label), keeping its BOTTOM-RIGHT corner fixed (the panel grows
/// up-and-left, like every OS notification tray). Called by the overlay
/// frontend on expand/collapse/hover transitions.
#[tauri::command]
pub fn overlay_resize(window: WebviewWindow, width: f64, height: f64) -> Result<(), String> {
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let old_pos = window.outer_position().map_err(|e| e.to_string())?;
    let old_size = window.outer_size().map_err(|e| e.to_string())?;
    let new_w = (width * scale).round() as i32;
    let new_h = (height * scale).round() as i32;
    let x = old_pos.x + old_size.width as i32 - new_w;
    let y = old_pos.y + old_size.height as i32 - new_h;
    window
        .set_size(LogicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Hide the calling overlay instance (right-click menu's "Hide"). Restoring
/// it is a known open gap — there is no UI affordance yet to re-show a
/// hidden overlay short of restarting the app; a "Show companion" toggle in
/// Settings is the natural follow-up, not built in this pass.
#[tauri::command]
pub fn overlay_hide(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

/// Persist the calling overlay window's current physical position so it can
/// be restored on next launch. Called by the frontend after the user
/// finishes a drag (pointerup on the drag handle). Safe to call frequently;
/// writes are atomic (temp→rename) so partial writes never corrupt the file.
#[tauri::command]
pub fn overlay_save_position(window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let label = window.label().to_string();
    let mut map = load_positions(&app);
    map.insert(label, PersistedPosition { x: pos.x, y: pos.y });
    save_positions(&app, &map);
    Ok(())
}

/// Return the persisted position for the calling overlay window, reconciled
/// against the current monitor topology. Returns `null` (JS `None`) when
/// there is no saved position or the saved position is off-screen — the
/// frontend falls back to its default bottom-right layout in that case.
///
/// The frontend calls this on mount so it can confirm the Rust-side restore
/// succeeded (and update any JS-side state that tracks the current position,
/// e.g., for the drag cursor).
#[tauri::command]
pub fn overlay_get_position(window: WebviewWindow, app: AppHandle) -> Option<PersistedPosition> {
    let label = window.label().to_string();
    let monitors: Vec<Monitor> = app.available_monitors().unwrap_or_default();
    let phys_size = window
        .outer_size()
        .unwrap_or(tauri::PhysicalSize { width: 96, height: 96 });
    reconcile_saved_position(&app, &label, &monitors, phys_size.width, phys_size.height)
}

/// Bring the main Bridge window forward (the expanded panel's "Open Bridge"
/// button). Un-minimizes + shows + focuses.
#[tauri::command]
pub fn focus_main_window(app: AppHandle) -> Result<(), String> {
    let win = app
        .get_webview_window(MAIN_LABEL)
        .ok_or_else(|| "main window not found".to_string())?;
    let _ = win.unminimize();
    let _ = win.show();
    win.set_focus().map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Unit tests — pure logic only (no Tauri handle required)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // The geometric check is extracted here so it can be tested without
    // a real Monitor handle (tauri::Monitor fields are private).
    fn is_on_screen_raw(
        px: i32, py: i32,
        monitors: &[(i32, i32, u32, u32)], // (mx, my, mw, mh)
        win_w: u32,
        win_h: u32,
        margin: i32,
    ) -> bool {
        if monitors.is_empty() {
            return true;
        }
        for &(mx, my, mw, mh) in monitors {
            let min_x = mx - win_w as i32 + margin;
            let max_x = mx + mw as i32 - margin;
            let min_y = my - win_h as i32 + margin;
            let max_y = my + mh as i32 - margin;
            if px >= min_x && px <= max_x && py >= min_y && py <= max_y {
                return true;
            }
        }
        false
    }

    #[test]
    fn position_on_screen_typical() {
        // Window 96×96 at (900, 800) on a 1920×1080 monitor at origin.
        assert!(is_on_screen_raw(900, 800, &[(0, 0, 1920, 1080)], 96, 96, 32));
    }

    #[test]
    fn position_off_screen_too_far_right() {
        // Window left-edge past the right margin — only 10px visible.
        assert!(!is_on_screen_raw(1900, 500, &[(0, 0, 1920, 1080)], 96, 96, 32));
    }

    #[test]
    fn position_off_screen_entirely_outside() {
        // Saved on a now-disconnected second monitor (x=2000..3920).
        assert!(!is_on_screen_raw(2500, 500, &[(0, 0, 1920, 1080)], 96, 96, 32));
    }

    #[test]
    fn position_on_second_monitor() {
        // Primary 1920×1080, secondary at x=1920, same y-origin.
        let monitors = [(0, 0, 1920, 1080), (1920, 0, 2560, 1440)];
        assert!(is_on_screen_raw(2200, 800, &monitors, 96, 96, 32));
    }

    #[test]
    fn position_empty_monitor_list_always_accepted() {
        // When monitor enumeration fails, we accept any position.
        assert!(is_on_screen_raw(-9999, -9999, &[], 96, 96, 32));
    }

    #[test]
    fn position_bottom_right_default_anchor_on_primary() {
        // Simulate the default anchor: bottom-right of a 1920×1080 monitor,
        // leaving MARGIN_RIGHT=24, MARGIN_BOTTOM=96, window 96×96.
        // Physical x = 1920 - 96 - 24 = 1800, y = 1080 - 96 - 96 = 888.
        let x = 1920 - 96 - 24;
        let y = 1080 - 96 - 96;
        assert!(is_on_screen_raw(x, y, &[(0, 0, 1920, 1080)], 96, 96, 32));
    }

    #[test]
    fn label_for_monitor_zero_is_bare_overlay() {
        assert_eq!(label_for_monitor(0), "overlay");
    }

    #[test]
    fn label_for_monitor_nonzero_appends_index() {
        assert_eq!(label_for_monitor(1), "overlay-1");
        assert_eq!(label_for_monitor(3), "overlay-3");
    }

    #[test]
    fn persisted_position_roundtrips_json() {
        let pos = PersistedPosition { x: 1234, y: -56 };
        let json = serde_json::to_string(&pos).unwrap();
        let back: PersistedPosition = serde_json::from_str(&json).unwrap();
        assert_eq!(back, pos);
    }

    #[test]
    fn position_map_roundtrips_json() {
        let mut map: PositionMap = HashMap::new();
        map.insert("overlay".into(), PersistedPosition { x: 10, y: 20 });
        map.insert("overlay-1".into(), PersistedPosition { x: 30, y: 40 });
        let json = serde_json::to_string(&map).unwrap();
        let back: PositionMap = serde_json::from_str(&json).unwrap();
        assert_eq!(back.get("overlay"), Some(&PersistedPosition { x: 10, y: 20 }));
        assert_eq!(back.get("overlay-1"), Some(&PersistedPosition { x: 30, y: 40 }));
    }
}
