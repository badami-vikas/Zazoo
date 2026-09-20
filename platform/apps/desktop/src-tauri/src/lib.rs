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
//!    gate core execution paths on capture permissions.
//!
//! Window creation is PROGRAMMATIC (not tauri.conf.json) because the main
//! window needs an initialization script carrying the sidecar API's resolved
//! port (`window.__BRIDGE_API_URL__`), which is only known at runtime.

mod act;
mod actuator;
mod annotate;
mod api_sidecar;
mod chase;
mod companion;
mod fields;
mod jobs;
mod notch;
mod model_supervisor;
mod overlay;
mod point;
mod providers;
mod research_webview;
mod updater;
mod whatsapp_send;
mod whatsapp_message_ops;
mod whatsapp_webview;
mod sensor_bridge;
mod teaching;

use std::process::Command;
use std::sync::Mutex;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

const BOOTSTRAP_LABEL: &str = "bridge-bootstrap";
const UNAVAILABLE_LABEL: &str = "bridge-local-plane-unavailable";

pub fn run_model_guard_if_requested() -> bool {
    model_supervisor::run_guard_if_requested()
}

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
        let debug_origin_guard = if cfg!(debug_assertions) {
            let port = api_sidecar::dev_web_port();
            format!(
                " || [\"http://localhost:{port}\", \"http://127.0.0.1:{port}\"].includes(window.location.origin)"
            )
        } else {
            String::new()
        };
        script.push_str(&format!(
            " if ([\"tauri://localhost\", \"http://tauri.localhost\", \
             \"https://tauri.localhost\"].includes(window.location.origin){}) {{ \
             Object.defineProperty(window, \"__BRIDGE_SIDECAR_TOKEN__\", \
             {{ value: {}, writable: false, configurable: false }}); }}",
            debug_origin_guard,
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
        )
        && url.port_or_known_default() == Some(api_sidecar::dev_web_port()))
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
    overlay_init_script: &str,
    annotate_init_script: &str,
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
    let main = match main_builder.build() {
        Ok(main) => main,
        Err(err) => {
            eprintln!("[bridge-desktop] failed to create main window: {err}");
            return false;
        }
    };
    if let Err(err) = main.show() {
        eprintln!("[bridge-desktop] failed to present main window: {err}");
        return false;
    }
    if let Err(err) = main.set_focus() {
        eprintln!("[bridge-desktop] failed to focus main window: {err}");
    }
    if let Err(err) = overlay::create_overlay_windows(app, overlay_init_script) {
        // The companion is additive: never block the main app on it.
        eprintln!("[bridge-desktop] failed to create overlay window(s): {err}");
    }
    if let Err(err) = annotate::create_annotate_windows(app, annotate_init_script) {
        // Also additive — annotation is a help feature, never load-bearing.
        eprintln!("[bridge-desktop] failed to create annotate window(s): {err}");
    }
    overlay::start_display_topology_watcher(app.clone(), overlay_init_script.to_string());
    // Zazoo's notch home (Z1): permission-free cursor poll -> edge-triggered
    // hover events. Started alongside the topology watcher so a display change
    // and a notch change are observed by the same lifecycle.
    notch::start_hover_watcher(app.clone());
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
    window.show().map_err(|error| error.to_string())?;
    if let Err(error) = window.set_focus() {
        eprintln!("[bridge-desktop] failed to focus bootstrap window: {error}");
    }
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

/// Run a native teardown step that may raise an ObjC exception, and keep the
/// process alive if it does.
///
/// Tearing a window down calls into AppKit/WebKit, which report failure by
/// *raising* rather than returning an error. Such an exception unwinds through
/// tao's run-loop observer, whose `catch_unwind` can only abort on a foreign
/// exception — the `__rust_foreign_exception` crash class. Recovery paths in
/// particular must never die this way: the sidecar-loss handler exists to tell
/// the user the Local Plane is gone, so aborting inside it replaces an honest
/// message with a crash.
///
/// The exception is logged with its name and reason rather than swallowed, so
/// a teardown that raises stays visible instead of becoming a silent no-op.
fn guard_native_teardown(what: &str, step: impl FnOnce() + std::panic::UnwindSafe) {
    #[cfg(target_os = "macos")]
    {
        if let Err(exception) = objc2::exception::catch(step) {
            match exception {
                Some(raised) => eprintln!(
                    "[bridge-desktop] native teardown of {what} raised {raised:?} — \
                     continuing instead of aborting"
                ),
                None => eprintln!(
                    "[bridge-desktop] native teardown of {what} raised a nil exception — \
                     continuing instead of aborting"
                ),
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    step();
}

/// Turn a `tauri-nspanel` panel back into the plain window it was made from,
/// so it can be torn down without aborting the process.
///
/// `to_panel` swizzles the live `NSWindow`'s class. By then WebKit has already
/// KVO-registered `WKWindowVisibilityObserver` on that window for
/// `contentLayoutRect`, so the swizzle discards the KVO subclass the runtime
/// installed. Destroying the window in that state makes WebKit's matching
/// `removeObserver:` raise `NSRangeException` ("not registered as an
/// observer"). `to_window` restores the class captured at conversion time,
/// which repairs KVO dispatch so the removal resolves normally.
///
/// Every teardown path funnels through here rather than special-casing one
/// label: `close_overlay_window` has demoted the Avatar panel since
/// 2026-07-18, and the annotate panel — created on the same NSPanel treatment
/// — never got the same guard.
#[cfg(target_os = "macos")]
fn demote_panel_before_teardown(window: &tauri::WebviewWindow) {
    use tauri_nspanel::ManagerExt;
    let label = window.label();
    let Ok(panel) = window.app_handle().get_webview_panel(label) else {
        return;
    };
    if panel.to_window().is_none() {
        eprintln!("[bridge-desktop] could not demote panel {label} before teardown");
    }
}

#[cfg(not(target_os = "macos"))]
fn demote_panel_before_teardown(_window: &tauri::WebviewWindow) {}

fn retire_window(window: &tauri::WebviewWindow, label: &str) {
    guard_native_teardown(
        label,
        std::panic::AssertUnwindSafe(|| {
            if let Err(error) = window.hide() {
                eprintln!("[bridge-desktop] failed to hide {label}: {error}");
            }
            demote_panel_before_teardown(window);
            if let Err(error) = window.destroy() {
                eprintln!("[bridge-desktop] failed to destroy {label}: {error}");
            }
        }),
    );
}

fn retire_app_window(app: &tauri::AppHandle, label: &str, window: &tauri::WebviewWindow) {
    if overlay::is_overlay_label(label) {
        guard_native_teardown(
            label,
            std::panic::AssertUnwindSafe(|| {
                if let Err(error) = window.hide() {
                    eprintln!(
                        "[bridge-desktop] failed to hide {label} after sidecar loss: {error}"
                    );
                }
                if let Err(error) = overlay::close_overlay_window(app, label) {
                    eprintln!(
                        "[bridge-desktop] failed to close {label} after sidecar loss: {error}"
                    );
                }
            }),
        );
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
    guard_native_teardown(
        "the sidecar-loss handler",
        std::panic::AssertUnwindSafe(|| show_sidecar_unavailable_inner(app)),
    );
}

fn show_sidecar_unavailable_inner(app: &tauri::AppHandle) {
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

/// Liveness probe cadence. The timeout must exceed the sidecar's worst
/// *slow-but-alive* response, not its typical one: a debug build under load
/// answers `/health` in single-digit milliseconds but the whole process can
/// stall for seconds behind a main-thread hop or a model load, and a stalled
/// probe is not a dead sidecar.
const HEALTH_PROBE_INTERVAL: std::time::Duration = std::time::Duration::from_secs(1);
const HEALTH_PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);
/// Loss is declared on *continuous unreachability over time*, never on a raw
/// count of failed probes. A count silently shortens as the probe gets slower
/// or the interval shorter — the reason a ~2.3s hiccup used to brick the app
/// permanently while the sidecar was still answering 200 to every request.
///
/// Time alone was still not enough. A child that is merely STARVED — an
/// ordinary `cargo` build or test run on the same machine — stops answering
/// probes while being perfectly healthy, and 6s of that was indistinguishable
/// from a crash: the shell killed a working sidecar and, when the replacement
/// was itself slow to boot on the same loaded machine, declared the Local
/// Plane lost (BUGS 2026-08-16). So the question asked is now "has the child
/// EXITED", with unreachability as the fallback signal for a hung-but-alive
/// process on a much longer fuse.
const HEALTH_STALL_WARN_AFTER: std::time::Duration = std::time::Duration::from_secs(6);
/// How long an ALIVE child may stay unreachable before it is treated as hung.
/// Long on purpose: every second here is only ever spent on a machine already
/// too loaded to answer a loopback probe, and the cost of being wrong is
/// killing a sidecar that was about to answer.
const HEALTH_LOSS_AFTER_ALIVE: std::time::Duration = std::time::Duration::from_secs(45);

/// Recovery budget for a crashed sidecar. Bounded on purpose: a sidecar that
/// dies repeatedly is a real fault and must surface as one, not as an endless
/// respawn loop burning CPU behind a UI that looks fine.
const HEALTH_RESTART_BUDGET: u32 = 3;
/// Restarts only count against the budget while they stay close together. A
/// crash today and another next week are not the same failure, and treating
/// them as one is how a long-lived app ends up permanently unrecoverable.
const HEALTH_RESTART_BUDGET_WINDOW: std::time::Duration = std::time::Duration::from_secs(600);

/// What one liveness observation asks the supervisor to do. Split out from the
/// polling thread so the verdict is testable without a socket or a process.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
enum Liveness {
    /// Answering. Nothing to do.
    Healthy,
    /// Not answering yet, and not for long enough to act on.
    Stalling,
    /// Replace the child: it exited, or it has been unreachable so long while
    /// alive that "hung" is the better explanation than "busy".
    Recover { exited: bool },
}

/// `child_exited` is the shell's answer to "is the process still there";
/// `None` means the question could not be answered, which is treated as
/// ALIVE — never kill a working sidecar because a `try_wait` failed.
fn liveness_step(
    healthy: bool,
    child_exited: Option<bool>,
    now: std::time::Instant,
    unreachable_since: &mut Option<std::time::Instant>,
) -> Liveness {
    if healthy {
        *unreachable_since = None;
        return Liveness::Healthy;
    }
    // A gone child is not a slow child: recover at once rather than making the
    // user wait out a patience window for a process that cannot come back.
    if child_exited == Some(true) {
        *unreachable_since = None;
        return Liveness::Recover { exited: true };
    }
    let since = *unreachable_since.get_or_insert(now);
    if now.duration_since(since) >= HEALTH_LOSS_AFTER_ALIVE {
        *unreachable_since = None;
        return Liveness::Recover { exited: false };
    }
    Liveness::Stalling
}

/// Whether a recovery attempt is still owed, and the budget state that follows.
/// Pure so the "does it eventually give up, and does it eventually forgive"
/// question is answerable without spawning processes.
fn restart_budget_step(
    now: std::time::Instant,
    used: u32,
    first_restart_at: Option<std::time::Instant>,
) -> (bool, u32, Option<std::time::Instant>) {
    let window_open = first_restart_at
        .is_some_and(|first| now.duration_since(first) < HEALTH_RESTART_BUDGET_WINDOW);
    if !window_open {
        return (true, 1, Some(now));
    }
    if used >= HEALTH_RESTART_BUDGET {
        return (false, used, first_restart_at);
    }
    (true, used + 1, first_restart_at)
}

fn monitor_sidecar(app: tauri::AppHandle, port: u16, token: String) {
    let fallback_app = app.clone();
    if let Err(error) = std::thread::Builder::new()
        .name("bridge-api-liveness".to_string())
        .spawn(move || {
            let mut unreachable_since: Option<std::time::Instant> = None;
            let mut restarts_used: u32 = 0;
            let mut first_restart_at: Option<std::time::Instant> = None;
            loop {
                std::thread::sleep(HEALTH_PROBE_INTERVAL);
                let healthy = api_sidecar::health_ok(port, &token, HEALTH_PROBE_TIMEOUT);
                let was_unreachable = unreachable_since.is_some();
                let exited = api_sidecar::child_exited(&app.state::<api_sidecar::ApiSidecarState>());
                let verdict = liveness_step(
                    healthy,
                    exited,
                    std::time::Instant::now(),
                    &mut unreachable_since,
                );
                match verdict {
                    Liveness::Healthy => {
                        if was_unreachable {
                            eprintln!("[bridge-desktop] api sidecar reachable again");
                        }
                        continue;
                    }
                    Liveness::Stalling => {
                        // Keep a transient stall visible without acting on it —
                        // silently absorbing it is how the tolerance regressed.
                        if !was_unreachable {
                            eprintln!(
                                "[bridge-desktop] api sidecar not answering — the child is alive, \
                                 tolerating for up to {}s",
                                HEALTH_LOSS_AFTER_ALIVE.as_secs()
                            );
                        }
                        continue;
                    }
                    Liveness::Recover { exited } => {
                        let (may_restart, next_used, next_first) = restart_budget_step(
                            std::time::Instant::now(),
                            restarts_used,
                            first_restart_at,
                        );
                        if may_restart {
                            restarts_used = next_used;
                            first_restart_at = next_first;
                            eprintln!(
                                "[bridge-desktop] api sidecar {} — restarting it \
                                 (attempt {restarts_used}/{HEALTH_RESTART_BUDGET})",
                                if exited {
                                    "child exited".to_string()
                                } else {
                                    format!(
                                        "unreachable for {}s while alive",
                                        HEALTH_LOSS_AFTER_ALIVE.as_secs()
                                    )
                                }
                            );
                            if api_sidecar::restart(&app.state::<api_sidecar::ApiSidecarState>()) {
                                unreachable_since = None;
                                continue;
                            }
                            // A failed attempt is NOT the end of the road: the
                            // reservation and respawn plan survive it now, so the
                            // remaining budget is real and gets spent on the next
                            // ticks instead of the session ending here.
                            eprintln!(
                                "[bridge-desktop] api sidecar restart failed; {} attempt(s) left",
                                HEALTH_RESTART_BUDGET.saturating_sub(restarts_used)
                            );
                            if restarts_used < HEALTH_RESTART_BUDGET {
                                continue;
                            }
                        } else {
                            eprintln!(
                                "[bridge-desktop] api sidecar exhausted its restart budget \
                                 ({HEALTH_RESTART_BUDGET} in {}s)",
                                HEALTH_RESTART_BUDGET_WINDOW.as_secs()
                            );
                        }
                    }
                }
                eprintln!("[bridge-desktop] api sidecar unrecoverable — declaring Local Plane loss");
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
        let lock_result = state.inner.lock();
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
    // The overlay performs governed, user-initiated API actions (Research
    // Runs are mutations behind the SEC-1 gate), so it carries the sidecar
    // capability like the main window — the script itself still gates the
    // token to trusted origins. The click-through annotate surface never
    // calls the API and stays tokenless (least privilege).
    let overlay_init_script = main_init_script.clone();
    let annotate_init_script = build_init_script(Some(&api_url), None);
    if !create_windows(
        app,
        &main_init_script,
        &overlay_init_script,
        &annotate_init_script,
    ) {
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
        .manage(model_supervisor::ModelSupervisorState::default())
        .manage(overlay::DisplayTopologyState::default())
        .manage(overlay::OverlaySessionState::default())
        .manage(notch::NotchState::default())
        .manage(chase::ChaseState::default())
        .manage(point::PointJobs::default())
        .manage(act::ActState::default())
        .manage(companion::CompanionState::default())
        .manage(companion::CompanionAskJobs::default())
        .manage(whatsapp_webview::WhatsAppState::default())
        .manage(whatsapp_webview::WhatsAppJobs::default())
        // Serialises the durable send ceiling's read-check-write. The FILE is
        // the authority (a cap that dies with the process does not bind); this
        // only stops two in-flight sends racing the same slot.
        .manage(whatsapp_send::SendCeilingState::default())
        .manage(research_webview::ResearchState::default())
        .manage(research_webview::ResearchJobs::default())
        .manage(BootstrapWindowState::default());
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());
    // Mac installer auto-update (TASK-077). `process` supplies the
    // post-install relaunch the updater needs to apply what it downloaded.
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());
    // Companion push-to-talk summon (TASK-027). Registered Rust-side only:
    // the webview has no capability to (re)bind shortcuts, it merely receives
    // the pressed/released events. Failure to register (e.g. the combo is
    // taken) degrades gracefully — the overlay's click affordances remain.
    let builder = {
        use tauri::Emitter as _;
        use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};
        let push_to_talk = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::Space);
        builder.plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if shortcut == &push_to_talk {
                        let state = match event.state() {
                            ShortcutState::Pressed => "pressed",
                            ShortcutState::Released => "released",
                        };
                        if let Err(error) = app.emit(companion::COMPANION_PTT_EVENT, state) {
                            eprintln!(
                                "[bridge-desktop] companion push-to-talk emit failed: {error}"
                            );
                        }
                    }
                })
                .build(),
        )
    };
    let app = builder
        .invoke_handler(tauri::generate_handler![
            sensor_bridge::sensor_list,
            sensor_bridge::sensor_start,
            sensor_bridge::sensor_stop,
            sensor_bridge::sensor_drain,
            sensor_bridge::sensor_read_raw,
            overlay::overlay_start_dragging,
            overlay::overlay_resize,
            overlay::overlay_hide,
            overlay::overlay_set_session_ready,
            overlay::overlay_get_session_ready,
            overlay::overlay_present,
            overlay::overlay_conceal,
            overlay::overlay_save_position,
            overlay::overlay_get_position,
            notch::notch_geometry,
            chase::start_chase_game,
            chase::stop_chase_game,
            point::point_at_start,
            point::point_at_poll,
            act::act_start,
            act::act_poll,
            act::act_stop,
            act::act_type_text,
            act::act_paused,
            fields::fields_copy,
            fields::fields_recall,
            fields::fields_forget,
            fields::fields_read_target,
            fields::fields_fill,
            annotate::annotate_scribble_begin,
            annotate::annotate_scribble_cancel,
            annotate::annotate_scribble_done,
            overlay::overlay_dock_notch,
            overlay::overlay_undock_free,
            overlay::overlay_present_docked_panel,
            overlay::focus_main_window,
            annotate::annotate_show,
            annotate::annotate_clear,
            annotate::annotate_ready,
            companion::companion_capabilities,
            companion::companion_ask_start,
            companion::companion_ask_poll,
            companion::companion_speak,
            companion::companion_stop_speaking,
            companion::open_privacy_settings,
            companion::open_external_url,
            companion::companion_transcribe,
            companion::companion_move_pointer,
            companion::companion_demo_pointer,
            whatsapp_webview::whatsapp_open,
            whatsapp_webview::whatsapp_position,
            whatsapp_webview::whatsapp_hide,
            whatsapp_webview::whatsapp_status,
            whatsapp_webview::whatsapp_session_reload,
            whatsapp_webview::whatsapp_session_reset,
            whatsapp_webview::whatsapp_extract_start,
            whatsapp_webview::whatsapp_extract_poll,
            // The write path (TASK-030, ADR-158). Separate commands from the
            // read pair on purpose: sending goes through the durable Rust
            // ceiling, and the read commands can never reach it.
            whatsapp_webview::whatsapp_send_start,
            whatsapp_webview::whatsapp_send_poll,
            whatsapp_webview::whatsapp_send_status,
            whatsapp_webview::whatsapp_send_halt,
            whatsapp_webview::whatsapp_send_rearm,
            research_webview::research_read_page,
            research_webview::research_locate_start,
            research_webview::research_locate_poll,
            research_webview::research_chat_start,
            research_webview::research_chat_poll,
            research_webview::research_close,
            open_google_oauth,
            providers::accessibility::ax_permission_status,
            providers::accessibility::ax_request_permission,
            // K11 (TASK-054): the second grant typing capture needs. Status
            // is pollable; the request is user-action-only (see input_tap).
            #[cfg(target_os = "macos")]
            providers::input_tap::input_permission_status,
            #[cfg(target_os = "macos")]
            providers::input_tap::input_request_permission,
        ])
        .setup(|app| {
            // Mac installer auto-update (TASK-077). Release builds only —
            // see updater::spawn_background_check's own debug_assertions
            // guard for why.
            updater::spawn_background_check(app.handle().clone());
            // Register the companion push-to-talk shortcut (⌘⇧Space).
            // Additive: a taken combo must never block the shell.
            {
                use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
                let push_to_talk =
                    Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::Space);
                if let Err(error) = app.handle().global_shortcut().register(push_to_talk) {
                    eprintln!(
                        "[bridge-desktop] companion push-to-talk registration failed \
                         (continuing without the global shortcut): {error}"
                    );
                }
            }
            if let Ok(url) = std::env::var("BRIDGE_API_URL") {
                // Explicit override — e.g. pointing the shell at a remote or
                // already-running local API. No sidecar spawned.
                let init_script = build_init_script(Some(&url), None);
                if !create_windows(app.handle(), &init_script, &init_script, &init_script) {
                    show_sidecar_unavailable(app.handle());
                }
                return Ok(());
            }
            let resource_dir = app.path().resource_dir().ok();
            let local_dir = std::env::var_os("BRIDGE_LOCAL_DIR")
                .map(std::path::PathBuf::from)
                .or_else(|| {
                    app.path()
                        .app_data_dir()
                        .ok()
                        .map(|dir| dir.join("bridge").join("local-plane"))
                });
            let Some(local_dir) = local_dir else {
                eprintln!(
                    "[bridge-desktop] api sidecar: app-data directory is unavailable. \
                     Refusing an ephemeral API."
                );
                show_sidecar_unavailable(app.handle());
                return Ok(());
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
            model_supervisor::start(
                app.handle().clone(),
                app.path().resource_dir().ok(),
                std::env::var_os("BRIDGE_LOCAL_DIR")
                    .map(std::path::PathBuf::from)
                    .or_else(|| {
                        app.path()
                            .app_data_dir()
                            .ok()
                            .map(|dir| dir.join("bridge").join("local-plane"))
                    })
                    .expect("Local Plane directory was resolved above"),
            );
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
            companion::shutdown(&app_handle.state::<companion::CompanionState>());
            // Request a graceful API shutdown so PGlite releases its directory
            // before the bounded force-kill fallback. The child also watches
            // BRIDGE_PARENT_PID so a crashed shell cannot orphan the lock owner.
            api_sidecar::shutdown(&app_handle.state::<api_sidecar::ApiSidecarState>());
            model_supervisor::shutdown(
                &app_handle.state::<model_supervisor::ModelSupervisorState>(),
            );
        }
        _ => {}
    });
}

#[cfg(test)]
mod security_tests {
    use super::*;

    const ALIVE: Option<bool> = Some(false);
    const GONE: Option<bool> = Some(true);

    /// The regression this replaces: loss was a *count* of 3 failed probes, so
    /// a stall barely longer than 3 probe timeouts permanently bricked the app
    /// while the sidecar was still answering 200 to every request.
    #[test]
    fn transient_unreachability_is_not_local_plane_loss() {
        let start = std::time::Instant::now();
        let mut unreachable_since = None;

        // A stall well past the old 3-failure threshold must be tolerated.
        for seconds in [0, 1, 4] {
            assert_eq!(
                liveness_step(
                    false,
                    ALIVE,
                    start + std::time::Duration::from_secs(seconds),
                    &mut unreachable_since
                ),
                Liveness::Stalling
            );
        }

        // One success clears the streak, so a later failure starts over.
        assert_eq!(
            liveness_step(
                true,
                ALIVE,
                start + std::time::Duration::from_secs(5),
                &mut unreachable_since
            ),
            Liveness::Healthy
        );
        assert!(unreachable_since.is_none());
        assert_eq!(
            liveness_step(
                false,
                ALIVE,
                start + std::time::Duration::from_secs(6),
                &mut unreachable_since
            ),
            Liveness::Stalling
        );
    }

    /// The defect this pins (BUGS 2026-08-16): an ordinary local build or test
    /// run starves the sidecar past the old 6s window while the process is
    /// perfectly alive. Killing it there is what turned a stall into a declared
    /// Local Plane loss, so a LIVE child must survive well past that mark.
    #[test]
    fn a_starved_but_living_child_is_not_killed_at_the_old_threshold() {
        let start = std::time::Instant::now();
        let mut unreachable_since = None;

        assert_eq!(
            liveness_step(false, ALIVE, start, &mut unreachable_since),
            Liveness::Stalling
        );
        assert_eq!(
            liveness_step(
                false,
                ALIVE,
                start + HEALTH_STALL_WARN_AFTER + std::time::Duration::from_secs(1),
                &mut unreachable_since
            ),
            Liveness::Stalling,
            "a live child was recovered at the stall-warning mark, which is the reported bug"
        );
        // It recovers eventually — hung is still a real state.
        assert_eq!(
            liveness_step(
                false,
                ALIVE,
                start + HEALTH_LOSS_AFTER_ALIVE,
                &mut unreachable_since
            ),
            Liveness::Recover { exited: false }
        );
    }

    /// The other half: a child that actually exited must not wait out the
    /// patience window that exists for slow ones.
    #[test]
    fn an_exited_child_is_recovered_immediately() {
        let start = std::time::Instant::now();
        let mut unreachable_since = None;

        assert_eq!(
            liveness_step(false, GONE, start, &mut unreachable_since),
            Liveness::Recover { exited: true }
        );
        assert!(
            unreachable_since.is_none(),
            "the streak must reset so the next attempt gets its own full window"
        );
    }

    /// `try_wait` failing is not evidence of death. Unknown must behave like
    /// alive, or a failed question could kill a working sidecar.
    #[test]
    fn an_unanswerable_liveness_question_is_treated_as_alive() {
        let start = std::time::Instant::now();
        let mut unreachable_since = None;

        assert_eq!(
            liveness_step(false, None, start, &mut unreachable_since),
            Liveness::Stalling
        );
        assert_eq!(
            liveness_step(
                false,
                None,
                start + HEALTH_STALL_WARN_AFTER + std::time::Duration::from_secs(1),
                &mut unreachable_since
            ),
            Liveness::Stalling
        );
    }

    #[test]
    fn probe_timeout_fits_inside_the_loss_window() {
        // A single probe must never be able to consume the whole tolerance
        // window on its own, or loss would again hinge on one slow read.
        assert!(HEALTH_PROBE_TIMEOUT < HEALTH_STALL_WARN_AFTER);
        assert!(HEALTH_PROBE_INTERVAL < HEALTH_STALL_WARN_AFTER);
        // And the patience for a living child must be meaningfully longer than
        // the mark where we merely start warning, or the two collapse together.
        assert!(HEALTH_LOSS_AFTER_ALIVE > HEALTH_STALL_WARN_AFTER * 4);
    }

    #[test]
    fn a_crashed_sidecar_is_restarted_before_local_plane_loss_is_declared() {
        // The whole point of the recovery path: the first sustained outage must
        // spend a restart attempt, not the user's session.
        let (may_restart, used, first) = restart_budget_step(std::time::Instant::now(), 0, None);
        assert!(may_restart);
        assert_eq!(used, 1);
        assert!(first.is_some());
    }

    #[test]
    fn a_sidecar_that_keeps_dying_stops_being_restarted() {
        // Bounded recovery: a genuinely broken sidecar has to surface as broken
        // instead of being respawned forever behind a healthy-looking UI.
        let start = std::time::Instant::now();
        let mut used = 0;
        let mut first = None;
        for _ in 0..HEALTH_RESTART_BUDGET {
            let (may_restart, next_used, next_first) = restart_budget_step(start, used, first);
            assert!(may_restart);
            used = next_used;
            first = next_first;
        }
        let (may_restart, _, _) = restart_budget_step(start, used, first);
        assert!(!may_restart, "restart budget must be exhaustible");
    }

    #[test]
    fn the_restart_budget_is_forgiven_after_the_window() {
        // An outage now and another one much later are separate faults. Without
        // this the app becomes permanently unrecoverable after enough uptime.
        let start = std::time::Instant::now();
        let much_later = start + HEALTH_RESTART_BUDGET_WINDOW + std::time::Duration::from_secs(1);
        let (may_restart, used, _) =
            restart_budget_step(much_later, HEALTH_RESTART_BUDGET, Some(start));
        assert!(may_restart);
        assert_eq!(used, 1, "a fresh window restarts the count");
    }

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
        assert!(!trusted_webview_navigation(
            &tauri::Url::parse("http://127.0.0.1:4000/attacker").unwrap()
        ));
        if cfg!(debug_assertions) {
            assert!(trusted_webview_navigation(
                &tauri::Url::parse(&format!(
                    "http://127.0.0.1:{}/",
                    api_sidecar::dev_web_port()
                ))
                .unwrap()
            ));
        }
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
        if cfg!(debug_assertions) {
            assert!(script.contains(&format!("http://127.0.0.1:{}", api_sidecar::dev_web_port())));
        }
        assert!(!build_init_script(None, None).contains("__BRIDGE_SIDECAR_TOKEN__"));
    }
}
