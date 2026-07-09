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
    if let Err(err) = overlay::create_overlay_window(app, init_script) {
        // The companion is additive: never block the main app on it.
        eprintln!("[bridge-desktop] failed to create overlay window: {err}");
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
            overlay::focus_main_window
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            // Boot sequence off the main thread: (release only) spawn the API
            // sidecar on a free port, wait for /health, THEN create the
            // windows with the resolved URL injected — the UI never shows
            // before the API it depends on is answering (or has honestly
            // failed, in which case the UI surfaces connection errors).
            std::thread::spawn(move || {
                let api_url: Option<String> = if let Ok(url) = std::env::var("BRIDGE_API_URL") {
                    // Explicit override — e.g. pointing the shell at a remote
                    // or already-running local API. No sidecar spawned.
                    Some(url)
                } else if cfg!(debug_assertions) {
                    // Dev mode unchanged: external Vite (5173) + external API
                    // (4000, via VITE_API_URL fallback). No sidecar.
                    None
                } else {
                    let resource_dir = handle.path().resource_dir().ok();
                    api_sidecar::start(resource_dir).map(|spawned| {
                        let url = format!("http://127.0.0.1:{}", spawned.port);
                        let state = handle.state::<api_sidecar::ApiSidecarState>();
                        if let Ok(mut guard) = state.0.lock() {
                            *guard = Some(spawned.child);
                        }
                        url
                    })
                };
                let init_script = build_init_script(api_url.as_deref());
                let h = handle.clone();
                let _ = handle.run_on_main_thread(move || create_windows(&h, &init_script));
            });
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
