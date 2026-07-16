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
//! On macOS each overlay is converted to a `tauri-nspanel` non-activating
//! panel that joins all Spaces and remains visible beside fullscreen windows.
//! Other targets keep the ordinary undecorated Tauri window.
//!
//! Display topology is reconciled at runtime. A lightweight watcher snapshots
//! monitor geometry once per second and, on change, creates/removes overlay
//! instances and re-anchors any now-off-screen position.

use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{
    AppHandle, LogicalSize, Manager, Monitor, PhysicalPosition, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

#[cfg(target_os = "macos")]
use tauri_nspanel::{tauri_panel, CollectionBehavior, PanelLevel, StyleMask, WebviewWindowExt};

#[cfg(target_os = "macos")]
tauri_panel! {
    panel!(AvatarPanel {
        config: {
            can_become_key_window: true,
            can_become_main_window: false,
            is_floating_panel: true
        }
    })
}

pub const OVERLAY_LABEL: &str = "overlay";
pub const MAIN_LABEL: &str = "main";
pub const COLLAPSED_SIZE: f64 = 96.0;
/// Gap from the screen edges. Tao monitors don't expose the macOS "visible
/// frame" (work area minus Dock/menu bar), so the bottom margin is padded
/// enough to clear a default Dock.
const MARGIN_RIGHT: f64 = 24.0;
const MARGIN_BOTTOM: f64 = 96.0;
const TOPOLOGY_POLL_INTERVAL: Duration = Duration::from_secs(1);

#[derive(Debug, Clone, PartialEq)]
struct DisplayGeometry {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale_bits: u64,
}

type DisplayTopology = Vec<DisplayGeometry>;

pub struct DisplayTopologyState {
    last: Mutex<Option<DisplayTopology>>,
    failed_labels: Mutex<HashSet<String>>,
    running: AtomicBool,
}

impl Default for DisplayTopologyState {
    fn default() -> Self {
        Self {
            last: Mutex::new(None),
            failed_labels: Mutex::new(HashSet::new()),
            running: AtomicBool::new(false),
        }
    }
}

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
    let Some(path) = positions_file(app) else {
        return HashMap::new();
    };
    let Ok(bytes) = std::fs::read(&path) else {
        return HashMap::new();
    };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

/// Persist the full position map atomically (write temp → rename).
/// Errors are logged but never propagated — position persistence is a
/// best-effort UX improvement, not a load-bearing invariant.
fn save_positions(app: &AppHandle, map: &PositionMap) {
    let Some(path) = positions_file(app) else {
        return;
    };
    // Ensure parent directories exist.
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let Ok(json) = serde_json::to_vec_pretty(map) else {
        return;
    };
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

fn is_overlay_label(label: &str) -> bool {
    label == OVERLAY_LABEL
        || label
            .strip_prefix(&format!("{OVERLAY_LABEL}-"))
            .is_some_and(|suffix| {
                !suffix.is_empty() && suffix.bytes().all(|byte| byte.is_ascii_digit())
            })
}

fn desired_overlay_labels(monitor_count: usize) -> Vec<String> {
    (0..monitor_count.max(1)).map(label_for_monitor).collect()
}

#[derive(Debug, PartialEq)]
struct TopologyPlan {
    create: Vec<(usize, String)>,
    remove: Vec<String>,
}

fn plan_overlay_topology(existing_labels: &[String], monitor_count: usize) -> TopologyPlan {
    let desired_labels = desired_overlay_labels(monitor_count);
    let desired: HashSet<String> = desired_labels.iter().cloned().collect();
    let existing: HashSet<String> = existing_labels.iter().cloned().collect();
    TopologyPlan {
        create: desired_labels
            .into_iter()
            .enumerate()
            .filter(|(_, label)| !existing.contains(label.as_str()))
            .collect(),
        remove: existing_labels
            .iter()
            .filter(|label| !desired.contains(label.as_str()))
            .cloned()
            .collect(),
    }
}

fn topology_monitors(app: &AppHandle) -> Vec<Monitor> {
    app.available_monitors().unwrap_or_default()
}

fn display_topology(monitors: &[Monitor]) -> DisplayTopology {
    monitors
        .iter()
        .map(|monitor| DisplayGeometry {
            x: monitor.position().x,
            y: monitor.position().y,
            width: monitor.size().width,
            height: monitor.size().height,
            scale_bits: monitor.scale_factor().to_bits(),
        })
        .collect()
}

fn topology_changed(previous: Option<&DisplayTopology>, next: &DisplayTopology) -> bool {
    previous != Some(next)
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
    let monitors = topology_monitors(app);
    if monitors.is_empty() {
        return create_one_overlay_window(app, init_script, 0, None);
    }
    let mut first_err: Option<tauri::Error> = None;
    for (index, monitor) in monitors.iter().enumerate() {
        if let Err(err) = create_one_overlay_window(app, init_script, index, Some(monitor)) {
            eprintln!(
                "[bridge-desktop] failed to create overlay window for monitor {index}: {err}"
            );
            first_err.get_or_insert(err);
        }
    }
    // Only fail the caller if EVERY monitor failed — a partial multi-monitor
    // rollout (e.g. one weird virtual display) still leaves a usable
    // companion on the monitors that worked.
    let any_overlay_created = app
        .webview_windows()
        .keys()
        .any(|l| l.starts_with(OVERLAY_LABEL));
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
    .focused(false)
    .initialization_script(init_script)
    .build()?;

    #[cfg(target_os = "macos")]
    if let Err(error) = configure_macos_panel(&win) {
        if let Ok(mut failed) = app.state::<DisplayTopologyState>().failed_labels.lock() {
            failed.insert(label.clone());
        }
        let _ = win.destroy();
        use tauri_nspanel::ManagerExt;
        let _ = app.remove_webview_panel(&label);
        return Err(error);
    }
    if let Ok(mut failed) = app.state::<DisplayTopologyState>().failed_labels.lock() {
        failed.remove(&label);
    }

    // Try to restore a previously-saved drag position. Fall back to the
    // default bottom-right anchor when absent or off-screen.
    let restored = {
        let monitors: Vec<Monitor> = app.available_monitors().unwrap_or_default();
        let phys_size = win.outer_size().unwrap_or(tauri::PhysicalSize {
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

#[cfg(target_os = "macos")]
fn configure_macos_panel(window: &WebviewWindow) -> tauri::Result<()> {
    let panel = window.to_panel::<AvatarPanel>()?;
    panel.set_level(PanelLevel::Floating.value());
    panel.set_floating_panel(true);
    panel.set_hides_on_deactivate(false);
    panel.set_becomes_key_only_if_needed(true);
    panel.set_style_mask(StyleMask::empty().nonactivating_panel().into());
    panel.set_collection_behavior(
        CollectionBehavior::new()
            .full_screen_auxiliary()
            .can_join_all_spaces()
            .into(),
    );
    #[cfg(debug_assertions)]
    eprintln!(
        "[bridge-desktop] macOS panel ready label={} class={:?} floating={} can_become_key={} policy=nonactivating+all-spaces+fullscreen-auxiliary",
        window.label(),
        panel.as_panel().class().name(),
        panel.is_floating_panel(),
        panel.can_become_key_window(),
    );
    Ok(())
}

fn collapsed_top_left(
    position: PhysicalPosition<i32>,
    size: tauri::PhysicalSize<u32>,
    collapsed_size: u32,
) -> PersistedPosition {
    PersistedPosition {
        x: position.x + size.width as i32 - collapsed_size as i32,
        y: position.y + size.height as i32 - collapsed_size as i32,
    }
}

fn collapsed_window_position(window: &WebviewWindow) -> Result<PersistedPosition, String> {
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let collapsed_size = (COLLAPSED_SIZE * scale).round() as u32;
    Ok(collapsed_top_left(position, size, collapsed_size))
}

fn persist_collapsed_window_position(app: &AppHandle, window: &WebviewWindow) {
    let Ok(position) = collapsed_window_position(window) else {
        return;
    };
    let mut positions = load_positions(app);
    positions.insert(window.label().to_string(), position);
    save_positions(app, &positions);
}

fn reconcile_overlay_topology(
    app: &AppHandle,
    init_script: &str,
    monitors: &[Monitor],
) -> tauri::Result<()> {
    let desired_labels = desired_overlay_labels(monitors.len());
    let failed_labels = app
        .state::<DisplayTopologyState>()
        .failed_labels
        .lock()
        .map(|failed| failed.clone())
        .unwrap_or_default();
    let existing_labels: Vec<String> = app
        .webview_windows()
        .keys()
        .filter(|label| is_overlay_label(label) && !failed_labels.contains(*label))
        .cloned()
        .collect();
    let plan = plan_overlay_topology(&existing_labels, monitors.len());

    for label in plan.remove {
        if let Some(window) = app.get_webview_window(&label) {
            window.close()?;
        }
        #[cfg(target_os = "macos")]
        {
            use tauri_nspanel::ManagerExt;
            let _ = app.remove_webview_panel(&label);
        }
    }

    let mut first_error = None;
    for (index, _) in plan.create {
        if let Err(error) = create_one_overlay_window(app, init_script, index, monitors.get(index))
        {
            eprintln!(
                "[bridge-desktop] failed to create hot-plug overlay for monitor {index}: {error}"
            );
            first_error.get_or_insert(error);
        }
    }

    for (index, label) in desired_labels.iter().enumerate() {
        let Some(window) = app.get_webview_window(label) else {
            continue;
        };
        let reconcile_result = (|| -> tauri::Result<()> {
            let position = window.outer_position()?;
            let size = window.outer_size()?;
            let collapsed_size = (COLLAPSED_SIZE * window.scale_factor()?).round() as u32;
            let current = collapsed_top_left(position, size, collapsed_size);
            if let Some(target) = monitors.get(index).or_else(|| monitors.first()) {
                if !is_on_screen(
                    &current,
                    std::slice::from_ref(target),
                    collapsed_size,
                    collapsed_size,
                    32,
                ) {
                    anchor_bottom_right(&window, target);
                    persist_collapsed_window_position(app, &window);
                }
            }
            Ok(())
        })();
        if let Err(error) = reconcile_result {
            eprintln!(
                "[bridge-desktop] failed to reconcile overlay {label} for monitor {index}: {error}"
            );
            first_error.get_or_insert(error);
        }
    }
    first_error.map_or(Ok(()), Err)
}

fn reconcile_display_topology(app: &AppHandle, init_script: &str) -> Result<(), String> {
    let monitors = topology_monitors(app);
    let next = display_topology(&monitors);
    let state = app.state::<DisplayTopologyState>();
    {
        let last = state
            .last
            .lock()
            .map_err(|_| "display topology state poisoned".to_string())?;
        if !topology_changed(last.as_ref(), &next) {
            return Ok(());
        }
    }

    reconcile_overlay_topology(app, init_script, &monitors).map_err(|error| error.to_string())?;
    let mut last = state
        .last
        .lock()
        .map_err(|_| "display topology state poisoned".to_string())?;
    *last = Some(next);
    Ok(())
}

pub fn start_display_topology_watcher(app: AppHandle, init_script: String) {
    let state = app.state::<DisplayTopologyState>();
    if state.running.swap(true, Ordering::SeqCst) {
        return;
    }

    if let Err(error) = reconcile_display_topology(&app, &init_script) {
        eprintln!("[bridge-desktop] initial display topology reconciliation failed: {error}");
    }

    let init_script = Arc::new(init_script);
    std::thread::spawn(move || loop {
        std::thread::sleep(TOPOLOGY_POLL_INTERVAL);
        if !app
            .state::<DisplayTopologyState>()
            .running
            .load(Ordering::SeqCst)
        {
            break;
        }
        let handle = app.clone();
        let init_script = Arc::clone(&init_script);
        if let Err(error) = app.run_on_main_thread(move || {
            if let Err(error) = reconcile_display_topology(&handle, init_script.as_str()) {
                eprintln!("[bridge-desktop] display topology reconciliation failed: {error}");
            }
        }) {
            eprintln!(
                "[bridge-desktop] failed to schedule display topology reconciliation: {error}"
            );
            break;
        }
    });
}

pub fn stop_display_topology_watcher(app: &AppHandle) {
    app.state::<DisplayTopologyState>()
        .running
        .store(false, Ordering::SeqCst);
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
    let pos = collapsed_window_position(&window)?;
    let label = window.label().to_string();
    let mut map = load_positions(&app);
    map.insert(label, pos);
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
    let phys_size = window.outer_size().unwrap_or(tauri::PhysicalSize {
        width: 96,
        height: 96,
    });
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
        px: i32,
        py: i32,
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
        assert!(is_on_screen_raw(
            900,
            800,
            &[(0, 0, 1920, 1080)],
            96,
            96,
            32
        ));
    }

    #[test]
    fn position_off_screen_too_far_right() {
        // Window left-edge past the right margin — only 10px visible.
        assert!(!is_on_screen_raw(
            1900,
            500,
            &[(0, 0, 1920, 1080)],
            96,
            96,
            32
        ));
    }

    #[test]
    fn position_off_screen_entirely_outside() {
        // Saved on a now-disconnected second monitor (x=2000..3920).
        assert!(!is_on_screen_raw(
            2500,
            500,
            &[(0, 0, 1920, 1080)],
            96,
            96,
            32
        ));
    }

    #[test]
    fn position_on_second_monitor() {
        // Primary 1920×1080, secondary at x=1920, same y-origin.
        let monitors = [(0, 0, 1920, 1080), (1920, 0, 2560, 1440)];
        assert!(is_on_screen_raw(2200, 800, &monitors, 96, 96, 32));
    }

    #[test]
    fn position_on_other_monitor_is_invalid_for_assigned_monitor() {
        assert!(!is_on_screen_raw(
            2200,
            800,
            &[(0, 0, 1920, 1080)],
            96,
            96,
            32,
        ));
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
        assert_eq!(
            back.get("overlay"),
            Some(&PersistedPosition { x: 10, y: 20 })
        );
        assert_eq!(
            back.get("overlay-1"),
            Some(&PersistedPosition { x: 30, y: 40 })
        );
    }

    #[test]
    fn desired_labels_follow_runtime_monitor_count() {
        assert_eq!(desired_overlay_labels(0), vec!["overlay"]);
        assert_eq!(desired_overlay_labels(1), vec!["overlay"]);
        assert_eq!(
            desired_overlay_labels(3),
            vec!["overlay", "overlay-1", "overlay-2"]
        );
    }

    #[test]
    fn topology_plan_adds_and_removes_hot_plug_windows() {
        assert_eq!(
            plan_overlay_topology(&["overlay".into()], 3),
            TopologyPlan {
                create: vec![(1, "overlay-1".into()), (2, "overlay-2".into()),],
                remove: vec![],
            }
        );
        assert_eq!(
            plan_overlay_topology(
                &["overlay".into(), "overlay-1".into(), "overlay-2".into(),],
                1,
            ),
            TopologyPlan {
                create: vec![],
                remove: vec!["overlay-1".into(), "overlay-2".into()],
            }
        );
    }

    #[test]
    fn expanded_window_normalizes_to_collapsed_top_left() {
        assert_eq!(
            collapsed_top_left(
                PhysicalPosition::new(100, 200),
                tauri::PhysicalSize::new(384, 480),
                96,
            ),
            PersistedPosition { x: 388, y: 584 },
        );
    }

    #[test]
    fn hover_window_normalizes_horizontal_drag_position() {
        assert_eq!(
            collapsed_top_left(
                PhysicalPosition::new(100, 200),
                tauri::PhysicalSize::new(260, 96),
                96,
            ),
            PersistedPosition { x: 264, y: 200 },
        );
    }

    #[test]
    fn expanded_overlap_does_not_mask_collapsed_off_monitor_position() {
        let expanded_position = PhysicalPosition::new(1776, 300);
        let expanded_size = tauri::PhysicalSize::new(320, 480);
        let collapsed = collapsed_top_left(expanded_position, expanded_size, 96);

        assert!(is_on_screen_raw(
            expanded_position.x,
            expanded_position.y,
            &[(0, 0, 1920, 1080)],
            expanded_size.width,
            expanded_size.height,
            32,
        ));
        assert!(!is_on_screen_raw(
            collapsed.x,
            collapsed.y,
            &[(0, 0, 1920, 1080)],
            96,
            96,
            32,
        ));
    }

    #[test]
    fn overlay_label_filter_rejects_unrelated_prefixes() {
        assert!(is_overlay_label("overlay"));
        assert!(is_overlay_label("overlay-12"));
        assert!(!is_overlay_label("overlay-menu"));
        assert!(!is_overlay_label("overlay-"));
        assert!(!is_overlay_label("annotate"));
    }

    #[test]
    fn topology_change_detects_hot_plug_and_reposition() {
        let primary = DisplayGeometry {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
            scale_bits: 2.0_f64.to_bits(),
        };
        let secondary = DisplayGeometry {
            x: 1920,
            y: 0,
            width: 2560,
            height: 1440,
            scale_bits: 2.0_f64.to_bits(),
        };
        let initial = vec![primary.clone()];
        let attached = vec![primary.clone(), secondary.clone()];
        let repositioned = vec![
            DisplayGeometry {
                x: -2560,
                ..secondary
            },
            primary,
        ];

        assert!(topology_changed(None, &initial));
        assert!(!topology_changed(Some(&initial), &initial));
        assert!(topology_changed(Some(&initial), &attached));
        assert!(topology_changed(Some(&attached), &repositioned));
        assert!(topology_changed(Some(&repositioned), &initial));
    }
}
