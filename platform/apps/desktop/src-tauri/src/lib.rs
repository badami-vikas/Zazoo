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

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// Init script injected into BOTH webviews before any app code runs, so the
/// tRPC client module can read it at import time. `__BRIDGE_DESKTOP__` is the
/// flag apps/web uses to suppress the in-page AvatarOverlay (the OS-level
/// overlay window replaces it in the desktop context).
fn build_init_script(api_url: Option<&str>) -> String {
    let mut script = format!(
        "window.__BRIDGE_DESKTOP__ = true; window.__BRIDGE_DESKTOP_PLATFORM__ = {};",
        serde_json::to_string(std::env::consts::OS)
            .expect("serializing the static desktop OS name cannot fail")
    );
    if let Some(url) = api_url {
        script.push_str(&format!(
            " window.__BRIDGE_API_URL__ = {};",
            serde_json::to_string(url).expect("serializing the sidecar URL cannot fail")
        ));
    }
    script
}

fn create_windows(app: &tauri::AppHandle, init_script: &str) {
    let main_builder = WebviewWindowBuilder::new(app, overlay::MAIN_LABEL, WebviewUrl::default())
        .title("Bridge")
        .inner_size(1280.0, 800.0)
        .resizable(true)
        .initialization_script(init_script);
    #[cfg(target_os = "macos")]
    let main_builder = main_builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);
    let main = main_builder.build();
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
    overlay::start_display_topology_watcher(app.clone(), init_script.to_string());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(sensor_bridge::SensorHubState::default())
        .manage(api_sidecar::ApiSidecarState::default())
        .manage(overlay::DisplayTopologyState::default());
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());
    let app = builder
        .invoke_handler(tauri::generate_handler![
            sensor_bridge::sensor_list,
            sensor_bridge::sensor_start,
            sensor_bridge::sensor_stop,
            sensor_bridge::sensor_drain,
            sensor_bridge::sensor_read_raw,
            sensor_bridge::capture_screenshot_on_demand,
            overlay::overlay_start_dragging,
            overlay::overlay_resize,
            overlay::overlay_hide,
            overlay::overlay_save_position,
            overlay::overlay_get_position,
            overlay::focus_main_window,
            annotate::annotate_show,
            annotate::annotate_clear,
            providers::accessibility::ax_permission_status,
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
                // start() only resolves/spawns the child; its bounded health
                // probe runs on a named background thread. setup must return
                // promptly so the Tauri event loop can service this window.
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

    app.run(|app_handle, event| match event {
        tauri::RunEvent::ExitRequested { .. } => {
            if let Err(error) = overlay::flush_overlay_positions(app_handle) {
                eprintln!("[bridge-desktop] failed to flush overlay positions on exit: {error}");
            }
        }
        tauri::RunEvent::Exit => {
            overlay::stop_display_topology_watcher(app_handle);
            // Kill the API child on quit — otherwise it would leak and hold
            // the port. (If the shell CRASHES this never runs; known gap,
            // acceptable for a localhost-bound, in-memory-by-default process.)
            api_sidecar::shutdown(&app_handle.state::<api_sidecar::ApiSidecarState>());
        }
        _ => {}
    });
}
