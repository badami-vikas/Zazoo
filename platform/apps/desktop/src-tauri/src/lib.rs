//! Bridge desktop shell (Tauri v2).
//!
//! This shell HOSTS apps/web (the same web app the browser serves — Notion
//! model: one kernel, three thin clients) and adds the only things a native
//! shell can: the capture core (context providers), the managed API sidecar
//! (offline self-containment, R-001), and the floating companion window
//! (OS-level avatar, R-002).
//!
//! Non-negotiable contracts (docs/wiki/vision.md + docs/wiki/clients.md):
//!  - RAW CAPTURE IS LOCAL-PLANE ONLY. Frames, AX dumps, audio, full document
//!    text never leave this machine; only derived ContextObservations /
//!    Memory entries cross the gate. The kernel-side hub (@bridge/sensors)
//!    enforces this structurally; this shell must never open a side channel
//!    around it.
//!  - EVERY CAPTURE → AN INSPECTABLE MEMORY ENTRY (timeline_entries via the
//!    CaptureLedger). No silent sensing, ever.
//!  - THE AVATAR BLINK IS THE TELL: each ingested capture emits a
//!    "sensor.capture" event; the overlay avatar subscribes and blinks. If
//!    the avatar didn't blink, Bridge didn't capture.
//!  - Sensors are OPTIONAL capabilities. Deny the OS permissions and Bridge
//!    remains fully useful (graceful degradation) — the shell must never
//!    gate core workflows on capture permissions.
//!
//! Window creation is PROGRAMMATIC (not tauri.conf.json) because the main
//! window needs an initialization script carrying the sidecar API's resolved
//! port (`window.__BRIDGE_API_URL__`), which is only known at runtime.

mod annotate;
mod api_sidecar;
mod overlay;
mod providers;
mod sensor_bridge;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

// ---------------------------------------------------------------------------
// Main-window chrome commands (TASK-003) — cross-platform-safe.
// Called by the sidebar header window control buttons that appear when running
// under Tauri. These coexist with the native title bar controls on
// Windows/Linux. On macOS, the full "traffic lights in sidebar" experience
// (remove title bar, `data-tauri-drag-region` on the sidebar header, native
// NSWindowButton positions) requires removing `decorations(false)` from the
// main window builder AND adding platform-specific CSS — flagged as a local
// macOS session blocker in the TASK-003 output.
// ---------------------------------------------------------------------------

/// Close the main Bridge window (sidebar "×" button).
#[tauri::command]
fn close_main_window(app: AppHandle) -> Result<(), String> {
    let win = app
        .get_webview_window(overlay::MAIN_LABEL)
        .ok_or("main window not found")?;
    win.close().map_err(|e| e.to_string())
}

/// Minimize the main Bridge window (sidebar "–" button).
#[tauri::command]
fn minimize_main_window(app: AppHandle) -> Result<(), String> {
    let win = app
        .get_webview_window(overlay::MAIN_LABEL)
        .ok_or("main window not found")?;
    win.minimize().map_err(|e| e.to_string())
}

/// Toggle maximize / restore the main Bridge window (sidebar "⬜" button).
#[tauri::command]
fn toggle_zoom_main_window(app: AppHandle) -> Result<(), String> {
    let win = app
        .get_webview_window(overlay::MAIN_LABEL)
        .ok_or("main window not found")?;
    if win.is_maximized().unwrap_or(false) {
        win.unmaximize().map_err(|e| e.to_string())
    } else {
        win.maximize().map_err(|e| e.to_string())
    }
}

/// Init script injected into BOTH webviews before any app code runs, so the
/// tRPC client module can read it at import time. `__BRIDGE_DESKTOP__` is the
/// flag apps/web uses to suppress the in-page AvatarOverlay (the OS-level
/// overlay window replaces it in the desktop context).
fn build_init_script(api_url: Option<&str>) -> String {
    match api_url {
        Some(url) => format!(
            "window.__BRIDGE_DESKTOP__ = true; window.__BRIDGE_API_URL__ = {};",
            serde_json::to_string(url).unwrap_or_else(|_| "null".into())
        ),
        None => "window.__BRIDGE_DESKTOP__ = true;".to_string(),
    }
}

fn create_windows(app: &tauri::AppHandle, init_script: &str) {
    let main = WebviewWindowBuilder::new(app, overlay::MAIN_LABEL, WebviewUrl::default())
        .title("Bridge")
        .inner_size(1280.0, 800.0)
        .resizable(true)
        .initialization_script(init_script)
        .build();
    if let Err(err) = main {
        eprintln!("[bridge-desktop] failed to create main window: {err}");
        return;
    }
    if let Err(err) = overlay::create_overlay_windows(app, init_script) {
        // The companion is additive: never block the main app on it.
        eprintln!("[bridge-desktop] failed to create overlay window(s): {err}");
    }
    if let Err(err) = annotate::create_annotate_windows(app, init_script) {
        // Also additive — annotation is a help feature, never load-bearing.
        eprintln!("[bridge-desktop] failed to create annotate window(s): {err}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(sensor_bridge::SensorHubState::default())
        .manage(api_sidecar::ApiSidecarState::default())
        .invoke_handler(tauri::generate_handler![
            sensor_bridge::sensor_list,
            sensor_bridge::sensor_start,
            sensor_bridge::sensor_stop,
            sensor_bridge::sensor_drain,
            sensor_bridge::sensor_read_raw,
            sensor_bridge::capture_screenshot_on_demand,
            overlay::overlay_resize,
            overlay::overlay_hide,
            overlay::overlay_save_position,
            overlay::overlay_get_position,
            overlay::focus_main_window,
            annotate::annotate_show,
            annotate::annotate_clear,
            providers::accessibility::ax_permission_status,
            close_main_window,
            minimize_main_window,
            toggle_zoom_main_window,
        ])
        .setup(|app| {
            // Create at least the main window before setup returns. Returning
            // with zero windows lets Tauri's event loop exit before an
            // asynchronous bootstrap can schedule window creation.
            let api_url: Option<String> = if let Ok(url) = std::env::var("BRIDGE_API_URL") {
                // Explicit override — e.g. pointing the shell at a remote
                // or already-running local API. No sidecar spawned.
                Some(url)
            } else if cfg!(debug_assertions) {
                // Dev mode: external Vite + API. No sidecar.
                None
            } else {
                let resource_dir = app.path().resource_dir().ok();
                api_sidecar::start(resource_dir).map(|spawned| {
                    let url = format!("http://127.0.0.1:{}", spawned.port);
                    let state = app.state::<api_sidecar::ApiSidecarState>();
                    if let Ok(mut guard) = state.0.lock() {
                        *guard = Some(spawned.child);
                    }
                    url
                })
            };
            let init_script = build_init_script(api_url.as_deref());
            create_windows(app.handle(), &init_script);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Bridge desktop shell");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            // Kill the API child on quit — otherwise it would leak and hold
            // the port. (If the shell CRASHES this never runs; known gap,
            // acceptable for a localhost-bound, in-memory-by-default process.)
            api_sidecar::shutdown(&app_handle.state::<api_sidecar::ApiSidecarState>());
        }
    });
}
