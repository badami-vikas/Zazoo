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
//! Static single-monitor-at-launch only — a monitor plugged/unplugged after
//! startup does not add/remove an overlay instance yet (honest gap, matches
//! this codebase's existing "build-verified not GUI-verified" pattern for
//! window-chrome features; hot-plug would need a `monitor-added` runtime
//! event Tauri doesn't currently emit).

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
    let win = WebviewWindowBuilder::new(
        app,
        label_for_monitor(index),
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

    // Anchor bottom-right of the target monitor when known; otherwise fall
    // back to whatever monitor the window actually landed on (the
    // zero-monitors-enumerated fallback path).
    match monitor {
        Some(m) => anchor_bottom_right(&win, m),
        None => {
            if let Ok(Some(m)) = win.current_monitor() {
                anchor_bottom_right(&win, &m);
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
