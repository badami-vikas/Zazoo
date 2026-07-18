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

use std::process::Command;
use std::sync::Mutex;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

const BOOTSTRAP_LABEL: &str = "bridge-bootstrap";
const UNAVAILABLE_LABEL: &str = "bridge-local-plane-unavailable";

#[derive(Default)]
struct BootstrapWindowState(Mutex<Option<tauri::WebviewWindow>>);

/// Init script injected into BOTH webviews before any app code runs, so the
/// tRPC client module can read it at import time. `__BRIDGE_DESKTOP__` is the
/// flag apps/web uses to suppress the in-page AvatarOverlay (the OS-level
/// overlay window replaces it in the desktop context).
fn build_init_script(api_url: Option<&str>, sidecar_token: Option<&str>) -> String {
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
    if let Some(token) = sidecar_token {
        script.push_str(&format!(
            " if ([\"tauri://localhost\", \"http://tauri.localhost\", \
             \"https://tauri.localhost\"].includes(window.location.origin)) {{ \
             Object.defineProperty(window, \"__BRIDGE_SIDECAR_TOKEN__\", \
             {{ value: {}, writable: false, configurable: false }}); }}",
            serde_json::to_string(token)
                .expect("serializing the sidecar launch capability cannot fail")
        ));
    }
    script
}

fn trusted_webview_navigation(url: &tauri::Url) -> bool {
    matches!(
        (url.scheme(), url.host_str()),
        ("tauri", Some("localhost"))
            | ("http", Some("tauri.localhost"))
            | ("https", Some("tauri.localhost"))
    ) || (cfg!(debug_assertions)
        && matches!(
            (url.scheme(), url.host_str()),
            ("http" | "https", Some("localhost") | Some("127.0.0.1"))
        ))
}

#[tauri::command]
fn open_google_oauth(url: String) -> Result<(), String> {
    let parsed = tauri::Url::parse(&url).map_err(|_| "Google OAuth URL is invalid")?;
    if parsed.scheme() != "https"
        || parsed.host_str() != Some("accounts.google.com")
        || !parsed.path().starts_with("/o/oauth2/")
    {
        return Err("Refusing to open a non-Google OAuth URL".to_string());
    }
    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(&url).status();
    #[cfg(target_os = "windows")]
    let status = Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", &url])
        .status();
    #[cfg(all(unix, not(target_os = "macos")))]
    let status = Command::new("xdg-open").arg(&url).status();
    match status {
        Ok(status) if status.success() => Ok(()),
        Ok(status) => Err(format!(
            "The system browser launcher exited with status {status}"
        )),
        Err(error) => Err(format!("Could not open the system browser: {error}")),
    }
}

fn create_windows(
    app: &tauri::AppHandle,
    main_init_script: &str,
    companion_init_script: &str,
) -> bool {
    let main_builder = WebviewWindowBuilder::new(app, overlay::MAIN_LABEL, WebviewUrl::default())
        .title("Bridge")
        .inner_size(1280.0, 800.0)
        .resizable(true)
        .on_navigation(trusted_webview_navigation)
        .initialization_script(main_init_script);
    #[cfg(target_os = "macos")]
    let main_builder = main_builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);
    let main = main_builder.build();
    if let Err(err) = main {
        eprintln!("[bridge-desktop] failed to create main window: {err}");
        return false;
    }
    if let Err(err) = overlay::create_overlay_windows(app, companion_init_script) {
        // The companion is additive: never block the main app on it.
        eprintln!("[bridge-desktop] failed to create overlay window(s): {err}");
    }
    if let Err(err) = annotate::create_annotate_windows(app, companion_init_script) {
        // Also additive — annotation is a help feature, never load-bearing.
        eprintln!("[bridge-desktop] failed to create annotate window(s): {err}");
    }
    overlay::start_display_topology_watcher(app.clone(), companion_init_script.to_string());
    true
}

fn create_bootstrap_window(app: &tauri::AppHandle) -> Result<(), String> {
    let url = tauri::Url::parse(
        "data:text/html,%3Ctitle%3EBridge%3C%2Ftitle%3E%3Cbody%3EStarting%20Bridge%20Local%20Plane%E2%80%A6%3C%2Fbody%3E",
    )
    .expect("the static bootstrap URL must be valid");
    let builder = WebviewWindowBuilder::new(app, BOOTSTRAP_LABEL, WebviewUrl::External(url))
        .title("Bridge - Starting Local Plane")
        .inner_size(1280.0, 800.0)
        .resizable(true)
        .on_navigation(|url| url.scheme() == "data");
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);
    let window = builder.build().map_err(|error| error.to_string())?;
    let state = app.state::<BootstrapWindowState>();
    let result = match state.0.lock() {
        Ok(mut guard) => {
            *guard = Some(window);
            Ok(())
        }
        Err(error) => {
            retire_window(&window, "untracked bootstrap window");
            Err(format!("bootstrap window state is unavailable: {error}"))
        }
    };
    result
}

fn retire_window(window: &tauri::WebviewWindow, label: &str) {
    if let Err(error) = window.hide() {
        eprintln!("[bridge-desktop] failed to hide {label}: {error}");
    }
    if let Err(error) = window.destroy() {
        eprintln!("[bridge-desktop] failed to destroy {label}: {error}");
    }
}

fn retire_app_window(app: &tauri::AppHandle, label: &str, window: &tauri::WebviewWindow) {
    if overlay::is_overlay_label(label) {
        if let Err(error) = window.hide() {
            eprintln!("[bridge-desktop] failed to hide {label} after sidecar loss: {error}");
        }
        if let Err(error) = overlay::close_overlay_window(app, label) {
            eprintln!("[bridge-desktop] failed to close {label} after sidecar loss: {error}");
        }
        return;
    }
    retire_window(window, &format!("{label} after sidecar loss"));
}

fn take_bootstrap_window(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    match app.state::<BootstrapWindowState>().0.lock() {
        Ok(mut guard) => {
            let from_state = guard.take();
            from_state.or_else(|| app.get_webview_window(BOOTSTRAP_LABEL))
        }
        Err(error) => {
            eprintln!("[bridge-desktop] bootstrap window state is unavailable: {error}");
            app.get_webview_window(BOOTSTRAP_LABEL)
        }
    }
}

fn show_sidecar_unavailable(app: &tauri::AppHandle) {
    overlay::stop_display_topology_watcher(app);
    if let Err(error) = sensor_bridge::shutdown(&app.state::<sensor_bridge::SensorHubState>()) {
        eprintln!("[bridge-desktop] failed to stop capture after sidecar loss: {error}");
    }
    if let Some(bootstrap) = take_bootstrap_window(app) {
        retire_window(&bootstrap, "bootstrap window after sidecar loss");
    }
    let mut unavailable_ready = app.get_webview_window(UNAVAILABLE_LABEL).is_some();
    if !unavailable_ready {
        let url = tauri::Url::parse(
            "data:text/html,%3Ctitle%3EBridge%20Local%20Plane%20Unavailable%3C%2Ftitle%3E%3Cbody%3EBridge%20Local%20Plane%20is%20unavailable.%20Restart%20Bridge%20to%20try%20again.%3C%2Fbody%3E",
        )
        .expect("the static unavailable URL must be valid");
        let builder = WebviewWindowBuilder::new(app, UNAVAILABLE_LABEL, WebviewUrl::External(url))
            .title("Bridge - Local Plane Unavailable")
            .inner_size(720.0, 360.0)
            .resizable(true)
            .on_navigation(|url| url.scheme() == "data");
        #[cfg(target_os = "macos")]
        let builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true);
        match builder.build() {
            Ok(_) => unavailable_ready = true,
            Err(error) => {
                eprintln!("[bridge-desktop] failed to create unavailable window: {error}");
            }
        }
    }
    for (label, window) in app.webview_windows() {
        if label != UNAVAILABLE_LABEL {
            retire_app_window(app, &label, &window);
        }
    }
    if !unavailable_ready {
        app.exit(1);
    }
}

fn monitor_sidecar(app: tauri::AppHandle, port: u16, token: String) {
    let fallback_app = app.clone();
    if let Err(error) = std::thread::Builder::new()
        .name("bridge-api-liveness".to_string())
        .spawn(move || {
            let mut consecutive_failures = 0_u8;
            loop {
                std::thread::sleep(std::time::Duration::from_secs(1));
                if api_sidecar::health_ok(port, &token, std::time::Duration::from_millis(750)) {
                    consecutive_failures = 0;
                    continue;
                }
                consecutive_failures += 1;
                if consecutive_failures < 3 {
                    continue;
                }
                if let Err(error) =
                    sensor_bridge::shutdown(&app.state::<sensor_bridge::SensorHubState>())
                {
                    eprintln!(
                        "[bridge-desktop] failed to stop capture after sidecar loss: {error}"
                    );
                }
                let main_thread_app = app.clone();
                if let Err(error) = app.run_on_main_thread(move || {
                    show_sidecar_unavailable(&main_thread_app);
                }) {
                    eprintln!(
                        "[bridge-desktop] could not invalidate transport after sidecar loss: \
                         {error}"
                    );
                }
                break;
            }
        })
    {
        eprintln!("[bridge-desktop] could not start sidecar liveness monitor: {error}");
        show_sidecar_unavailable(&fallback_app);
    }
}

fn stop_sidecar_in_background(app: &tauri::AppHandle) {
    let background_app = app.clone();
    if let Err(error) = std::thread::Builder::new()
        .name("bridge-api-stop".to_string())
        .spawn(move || {
            api_sidecar::shutdown(&background_app.state::<api_sidecar::ApiSidecarState>());
        })
    {
        eprintln!("[bridge-desktop] could not start sidecar shutdown worker: {error}");
        api_sidecar::shutdown(&app.state::<api_sidecar::ApiSidecarState>());
    }
}

fn finish_sidecar_bootstrap(app: &tauri::AppHandle, spawned: Option<api_sidecar::SpawnedApi>) {
    let connection = spawned.and_then(|spawned| {
        let api_url = format!("http://127.0.0.1:{}", spawned.port);
        let port = spawned.port;
        let token = spawned.token.clone();
        let state = app.state::<api_sidecar::ApiSidecarState>();
        let lock_result = state.0.lock();
        match lock_result {
            Ok(mut guard) => {
                *guard = Some(spawned);
                Some((api_url, port, token))
            }
            Err(error) => {
                eprintln!(
                    "[bridge-desktop] api sidecar: lifecycle state is unavailable: {error}. \
                     Refusing to expose the sidecar transport."
                );
                None
            }
        }
    });
    let Some((api_url, port, token)) = connection else {
        show_sidecar_unavailable(app);
        return;
    };
    if let Some(bootstrap) = take_bootstrap_window(app) {
        retire_window(&bootstrap, "bootstrap window");
    }
    let main_init_script = build_init_script(Some(&api_url), Some(&token));
    let companion_init_script = build_init_script(Some(&api_url), None);
    if !create_windows(app, &main_init_script, &companion_init_script) {
        show_sidecar_unavailable(app);
        stop_sidecar_in_background(app);
        return;
    }
    if app.get_webview_window(overlay::MAIN_LABEL).is_some() {
        monitor_sidecar(app.clone(), port, token);
    }
}

fn start_sidecar_in_background(
    app: &tauri::AppHandle,
    resource_dir: Option<std::path::PathBuf>,
    local_dir: std::path::PathBuf,
) {
    let background_app = app.clone();
    let spawn_result = std::thread::Builder::new()
        .name("bridge-api-bootstrap".to_string())
        .spawn(move || {
            let spawned = api_sidecar::start(resource_dir, local_dir);
            let main_thread_app = background_app.clone();
            if let Err(error) = background_app.run_on_main_thread(move || {
                finish_sidecar_bootstrap(&main_thread_app, spawned);
            }) {
                eprintln!(
                    "[bridge-desktop] api sidecar: could not schedule verified transport: {error}"
                );
            }
        });
    if let Err(error) = spawn_result {
        eprintln!(
            "[bridge-desktop] api sidecar: could not start bootstrap worker: {error}. \
             Continuing without an API transport."
        );
        finish_sidecar_bootstrap(app, None);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(sensor_bridge::SensorHubState::default())
        .manage(api_sidecar::ApiSidecarState::default())
        .manage(overlay::DisplayTopologyState::default())
        .manage(BootstrapWindowState::default());
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
            overlay::overlay_resize,
            overlay::overlay_hide,
            overlay::overlay_save_position,
            overlay::overlay_get_position,
            overlay::focus_main_window,
            annotate::annotate_show,
            annotate::annotate_clear,
            open_google_oauth,
            providers::accessibility::ax_permission_status,
        ])
        .setup(|app| {
            if let Ok(url) = std::env::var("BRIDGE_API_URL") {
                // Explicit override — e.g. pointing the shell at a remote or
                // already-running local API. No sidecar spawned.
                let init_script = build_init_script(Some(&url), None);
                if !create_windows(app.handle(), &init_script, &init_script) {
                    show_sidecar_unavailable(app.handle());
                }
                return Ok(());
            }
            if cfg!(debug_assertions) {
                // Dev mode: external Vite + API. No sidecar.
                let init_script = build_init_script(None, None);
                if !create_windows(app.handle(), &init_script, &init_script) {
                    show_sidecar_unavailable(app.handle());
                }
                return Ok(());
            }

            let resource_dir = app.path().resource_dir().ok();
            let local_dir = match app.path().app_data_dir() {
                Ok(dir) => dir.join("bridge").join("local-plane"),
                Err(error) => {
                    eprintln!(
                        "[bridge-desktop] api sidecar: app-data directory is unavailable: \
                             {error}. Refusing an ephemeral API."
                    );
                    show_sidecar_unavailable(app.handle());
                    return Ok(());
                }
            };

            // Keep the event loop responsive while the child reports its
            // kernel-assigned port and passes authenticated readiness. The
            // privileged main webview is created only after that verification.
            if let Err(error) = create_bootstrap_window(app.handle()) {
                eprintln!(
                    "[bridge-desktop] failed to create sidecar bootstrap window: {error}. \
                     Continuing without an API transport."
                );
                show_sidecar_unavailable(app.handle());
                return Ok(());
            }
            start_sidecar_in_background(app.handle(), resource_dir, local_dir);
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
            // Request a graceful API shutdown so PGlite releases its directory
            // before the bounded force-kill fallback. The child also watches
            // BRIDGE_PARENT_PID so a crashed shell cannot orphan the lock owner.
            api_sidecar::shutdown(&app_handle.state::<api_sidecar::ApiSidecarState>());
        }
        _ => {}
    });
}

#[cfg(test)]
mod security_tests {
    use super::*;

    #[test]
    fn privileged_webview_navigation_stays_on_trusted_origins() {
        assert!(trusted_webview_navigation(
            &tauri::Url::parse("tauri://localhost/dealpilot").unwrap()
        ));
        assert!(trusted_webview_navigation(
            &tauri::Url::parse("http://tauri.localhost/dealpilot").unwrap()
        ));
        assert!(!trusted_webview_navigation(
            &tauri::Url::parse("https://accounts.google.com/o/oauth2/v2/auth").unwrap()
        ));
        assert!(
            !trusted_webview_navigation(
                &tauri::Url::parse("http://127.0.0.1:4000/attacker").unwrap()
            ) || cfg!(debug_assertions)
        );
    }

    #[test]
    fn oauth_launcher_rejects_non_google_urls_before_spawn() {
        assert!(open_google_oauth("https://example.invalid/o/oauth2/v2/auth".into()).is_err());
        assert!(open_google_oauth("http://accounts.google.com/o/oauth2/v2/auth".into()).is_err());
    }

    #[test]
    fn launch_capability_is_origin_guarded_in_init_script() {
        let script = build_init_script(Some("http://127.0.0.1:4123"), Some("test-sidecar-token"));
        assert!(script.contains("window.location.origin"));
        assert!(script.contains("Object.defineProperty"));
        assert!(!build_init_script(None, None).contains("__BRIDGE_SIDECAR_TOKEN__"));
    }
}
