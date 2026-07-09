//! overlay — the floating desktop companion window (R-002).
//!
//! The avatar is an OS-level window, not a div: a second Tauri webview window
//! ("overlay") that is small (96×96 collapsed), transparent, undecorated,
//! always-on-top, skip-taskbar, anchored bottom-right of the screen. Its
//! frontend is apps/web's `overlay.html` entry (OverlayApp.tsx), which reuses
//! the same Creature + avatar-store as the in-page AvatarOverlay and drives
//! the Invoko-spec state machine (v1: collapsed → hover → expanded_idle →
//! working). Expanding/collapsing calls `overlay_resize` here so the WINDOW
//! grows, keeping its bottom-right corner pinned.

use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

pub const OVERLAY_LABEL: &str = "overlay";
pub const MAIN_LABEL: &str = "main";
pub const COLLAPSED_SIZE: f64 = 96.0;
/// Gap from the screen edges. Tao monitors don't expose the macOS "visible
/// frame" (work area minus Dock/menu bar), so the bottom margin is padded
/// enough to clear a default Dock.
const MARGIN_RIGHT: f64 = 24.0;
const MARGIN_BOTTOM: f64 = 96.0;

/// Create the overlay window. `init_script` carries the same
/// `window.__BRIDGE_API_URL__` injection as the main window so the overlay's
/// tRPC client talks to the sidecar API too.
pub fn create_overlay_window(app: &AppHandle, init_script: &str) -> tauri::Result<()> {
    let win = WebviewWindowBuilder::new(
        app,
        OVERLAY_LABEL,
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

    // Anchor bottom-right of the monitor the window landed on.
    if let Ok(Some(monitor)) = win.current_monitor() {
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
    Ok(())
}

/// Resize the overlay window keeping its BOTTOM-RIGHT corner fixed (the
/// panel grows up-and-left, like every OS notification tray). Called by the
/// overlay frontend on expand/collapse/hover transitions.
#[tauri::command]
pub fn overlay_resize(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    let win = app
        .get_webview_window(OVERLAY_LABEL)
        .ok_or_else(|| "overlay window not found".to_string())?;
    let scale = win.scale_factor().map_err(|e| e.to_string())?;
    let old_pos = win.outer_position().map_err(|e| e.to_string())?;
    let old_size = win.outer_size().map_err(|e| e.to_string())?;
    let new_w = (width * scale).round() as i32;
    let new_h = (height * scale).round() as i32;
    let x = old_pos.x + old_size.width as i32 - new_w;
    let y = old_pos.y + old_size.height as i32 - new_h;
    win.set_size(LogicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    win.set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    Ok(())
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
