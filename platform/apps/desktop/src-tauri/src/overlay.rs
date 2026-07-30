//! overlay — the floating desktop companion window(s) (R-002).
//!
//! The avatar is an OS-level window, not a div: one Tauri webview window PER
//! CONNECTED MONITOR (label `overlay` on the primary/first monitor,
//! `overlay-1`, `overlay-2`, … on the rest), each small (96×96 collapsed),
//! transparent, undecorated, always-on-top, skip-taskbar, anchored
//! bottom-right of ITS OWN screen. All instances share one frontend —
//! apps/web's `overlay.html` entry (OverlayApp.tsx) — which reuses the same
//! AvatarFigure + avatar-store as the in-page AvatarOverlay and drives the
//! Invoko-spec state machine (v1: collapsed → hover → expanded_idle →
//! working). Expanding/collapsing calls `overlay_resize` here so the WINDOW
//! grows, keeping its bottom-right corner pinned; the command takes the
//! CALLING window as a parameter (Tauri auto-injects it — see
//! `WebviewWindow`'s `CommandArg` impl), so the same command correctly
//! resizes whichever monitor's instance the user is interacting with,
//! without needing to know which one that is.
//!
//! **Drag + persistence (TASK-003)**
//! The overlay frontend uses Tauri's native drag-region hook. Native window
//! move events debounce the subsequent save, so persistence does not depend
//! on the webview receiving a `pointerup`. Positions are stored in
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
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Monitor, PhysicalPosition, State,
    WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
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
const POSITION_SAVE_DEBOUNCE: Duration = Duration::from_millis(300);
const AVATAR_SESSION_READY_EVENT: &str = "bridge:avatar-session-ready";

#[derive(Default)]
pub struct OverlaySessionState {
    ready: AtomicBool,
}

#[derive(Debug, Clone, PartialEq)]
struct DisplayGeometry {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale_bits: u64,
}

type DisplayTopology = Vec<DisplayGeometry>;

#[derive(Debug, Clone, Copy, PartialEq)]
struct LogicalBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

pub struct DisplayTopologyState {
    last: Mutex<Option<DisplayTopology>>,
    failed_labels: Mutex<HashSet<String>>,
    position_save_generations: Mutex<HashMap<String, u64>>,
    position_save_workers: Mutex<HashSet<String>>,
    running: AtomicBool,
}

impl Default for DisplayTopologyState {
    fn default() -> Self {
        Self {
            last: Mutex::new(None),
            failed_labels: Mutex::new(HashSet::new()),
            position_save_generations: Mutex::new(HashMap::new()),
            position_save_workers: Mutex::new(HashSet::new()),
            running: AtomicBool::new(false),
        }
    }
}

// ---------------------------------------------------------------------------
// Position persistence (TASK-003)
// ---------------------------------------------------------------------------

/// Coordinate system used by a persisted position. Existing files predate
/// this field and therefore deserialize as `Physical`.
#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum PositionSpace {
    #[default]
    Physical,
    Logical,
}

/// A saved window position keyed by overlay window label.
///
/// macOS uses logical desktop coordinates because Tao's per-monitor physical
/// coordinates overlap on mixed-DPI topologies. Other platforms retain the
/// prior physical-coordinate behavior.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct PersistedPosition {
    pub x: i32,
    pub y: i32,
    #[serde(default)]
    pub space: PositionSpace,
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
fn save_positions(app: &AppHandle, map: &PositionMap) -> Result<(), String> {
    let path =
        positions_file(app).ok_or_else(|| "desktop app-data directory unavailable".to_string())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let json = serde_json::to_vec_pretty(map).map_err(|error| error.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &json).map_err(|error| error.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|error| error.to_string())
}

/// Check whether `pos` sits within the bounds of any known monitor (with at
/// least a `margin` pixels of the window visible, so a minimal drag handle
/// is always reachable even after display topology changes).
///
/// Returns `true` when the position is usable; `false` when the saved position
/// is entirely off-screen and the window should be re-anchored.
fn logical_bounds_from_physical(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale: f64,
) -> LogicalBounds {
    let scale = scale.max(f64::EPSILON);
    LogicalBounds {
        x: x as f64 / scale,
        y: y as f64 / scale,
        width: width as f64 / scale,
        height: height as f64 / scale,
    }
}

fn logical_monitor_bounds(monitor: &Monitor) -> LogicalBounds {
    logical_bounds_from_physical(
        monitor.position().x,
        monitor.position().y,
        monitor.size().width,
        monitor.size().height,
        monitor.scale_factor(),
    )
}

fn logical_anchor_position(
    bounds: LogicalBounds,
    window_width: f64,
    window_height: f64,
) -> PersistedPosition {
    PersistedPosition {
        x: (bounds.x + bounds.width - window_width - MARGIN_RIGHT).round() as i32,
        y: (bounds.y + bounds.height - window_height - MARGIN_BOTTOM).round() as i32,
        space: PositionSpace::Logical,
    }
}

#[cfg(target_os = "macos")]
fn has_mixed_scale_factors(monitors: &[Monitor]) -> bool {
    let Some(first) = monitors.first() else {
        return false;
    };
    monitors
        .iter()
        .skip(1)
        .any(|monitor| monitor.scale_factor().to_bits() != first.scale_factor().to_bits())
}

fn is_on_screen(
    pos: &PersistedPosition,
    monitors: &[Monitor],
    window_physical_w: u32,
    window_physical_h: u32,
    window_scale: f64,
    margin: i32,
) -> bool {
    if monitors.is_empty() {
        // No monitor info — accept any position rather than mis-anchoring.
        return true;
    }
    match pos.space {
        PositionSpace::Physical => {
            for m in monitors {
                let mx = m.position().x;
                let my = m.position().y;
                let mw = m.size().width as i32;
                let mh = m.size().height as i32;
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
        }
        PositionSpace::Logical => {
            let scale = window_scale.max(f64::EPSILON);
            let window_w = window_physical_w as f64 / scale;
            let window_h = window_physical_h as f64 / scale;
            let margin = margin as f64;
            for monitor in monitors {
                let bounds = logical_monitor_bounds(monitor);
                let min_visible_x = bounds.x - window_w + margin;
                let max_visible_x = bounds.x + bounds.width - margin;
                let min_visible_y = bounds.y - window_h + margin;
                let max_visible_y = bounds.y + bounds.height - margin;
                if pos.x as f64 >= min_visible_x
                    && pos.x as f64 <= max_visible_x
                    && pos.y as f64 >= min_visible_y
                    && pos.y as f64 <= max_visible_y
                {
                    return true;
                }
            }
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
    window_scale: f64,
) -> Option<PersistedPosition> {
    let map = load_positions(app);
    let pos = map.get(label)?;
    #[cfg(target_os = "macos")]
    if pos.space == PositionSpace::Physical && has_mixed_scale_factors(monitors) {
        // Legacy physical coordinates are ambiguous when each display has a
        // different scale. Re-anchor once, then persist logical coordinates.
        return None;
    }
    // Minimum visible margin = 32 physical pixels (~24 logical at 1x).
    if is_on_screen(
        pos,
        monitors,
        window_physical_w,
        window_physical_h,
        window_scale,
        32,
    ) {
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

/// Monitor index encoded in an overlay/annotate-style window label
/// ("overlay" → 0, "overlay-2" → 2). Non-overlay labels (e.g. "main") map to
/// the primary display, 0 — the honest default for a window that isn't
/// monitor-bound.
pub(crate) fn monitor_index_for_label(label: &str) -> usize {
    if !is_overlay_label(label) {
        return 0;
    }
    label
        .strip_prefix(&format!("{OVERLAY_LABEL}-"))
        .and_then(|suffix| suffix.parse::<usize>().ok())
        .unwrap_or(0)
}

pub(crate) fn is_overlay_label(label: &str) -> bool {
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

fn overlay_membership_needs_repair(app: &AppHandle, monitor_count: usize) -> bool {
    let has_failed_overlay = app
        .state::<DisplayTopologyState>()
        .failed_labels
        .lock()
        .map(|failed| !failed.is_empty())
        .unwrap_or(true);
    if has_failed_overlay {
        return true;
    }

    let existing_labels: Vec<String> = app
        .webview_windows()
        .keys()
        .filter(|label| is_overlay_label(label))
        .cloned()
        .collect();
    let plan = plan_overlay_topology(&existing_labels, monitor_count);
    !plan.create.is_empty() || !plan.remove.is_empty()
}

/// Position `win` bottom-right of `monitor` using its current logical size.
fn anchor_bottom_right(win: &WebviewWindow, monitor: &Monitor) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    {
        let scale = win
            .scale_factor()
            .unwrap_or_else(|_| monitor.scale_factor())
            .max(f64::EPSILON);
        let size = win.outer_size().unwrap_or(tauri::PhysicalSize {
            width: (COLLAPSED_SIZE * scale).round() as u32,
            height: (COLLAPSED_SIZE * scale).round() as u32,
        });
        let position = logical_anchor_position(
            logical_monitor_bounds(monitor),
            size.width as f64 / scale,
            size.height as f64 / scale,
        );
        win.set_position(LogicalPosition::new(position.x as f64, position.y as f64))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let scale = monitor.scale_factor();
        let msize = monitor.size();
        let mpos = monitor.position();
        let wsize = win.outer_size().unwrap_or(tauri::PhysicalSize {
            width: (COLLAPSED_SIZE * scale) as u32,
            height: (COLLAPSED_SIZE * scale) as u32,
        });
        let x = mpos.x + msize.width as i32 - wsize.width as i32 - (MARGIN_RIGHT * scale) as i32;
        let y = mpos.y + msize.height as i32 - wsize.height as i32 - (MARGIN_BOTTOM * scale) as i32;
        win.set_position(PhysicalPosition::new(x, y))
    }
}

fn set_persisted_position(win: &WebviewWindow, position: &PersistedPosition) -> tauri::Result<()> {
    match position.space {
        PositionSpace::Physical => win.set_position(PhysicalPosition::new(position.x, position.y)),
        PositionSpace::Logical => {
            win.set_position(LogicalPosition::new(position.x as f64, position.y as f64))
        }
    }
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
    .visible(false)
    .initialization_script(init_script)
    .build()?;

    if let Err(error) = win.set_ignore_cursor_events(true) {
        if let Err(close_error) = close_overlay_window(app, &label) {
            eprintln!(
                "[bridge-desktop] failed to close overlay {label} after input-gate setup error: {close_error}"
            );
        }
        return Err(error);
    }

    let moved_app = app.clone();
    let moved_window = win.clone();
    win.on_window_event(move |event| {
        if matches!(event, WindowEvent::Moved(_)) {
            schedule_position_persist(&moved_app, &moved_window);
        }
    });

    #[cfg(target_os = "macos")]
    if let Err(error) = configure_macos_panel(&win) {
        if let Ok(mut failed) = app.state::<DisplayTopologyState>().failed_labels.lock() {
            failed.insert(label.clone());
        }
        if let Err(close_error) = close_overlay_window(app, &label) {
            eprintln!(
                "[bridge-desktop] failed to close overlay {label} after panel setup error: {close_error}"
            );
        }
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
        reconcile_saved_position(
            app,
            &label,
            &monitors,
            phys_size.width,
            phys_size.height,
            win.scale_factor().unwrap_or(1.0),
        )
    };

    if let Some(saved) = restored {
        set_persisted_position(&win, &saved)?;
    } else {
        // Default anchor: bottom-right of the target monitor when known;
        // otherwise fall back to whatever monitor the window landed on.
        match monitor {
            Some(m) => anchor_bottom_right(&win, m)?,
            None => {
                if let Ok(Some(m)) = win.current_monitor() {
                    anchor_bottom_right(&win, &m)?;
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
        space: PositionSpace::Physical,
    }
}

fn collapsed_window_position(window: &WebviewWindow) -> Result<PersistedPosition, String> {
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let collapsed_size = (COLLAPSED_SIZE * scale).round() as u32;
    let collapsed = collapsed_top_left(position, size, collapsed_size);
    #[cfg(target_os = "macos")]
    {
        let scale = scale.max(f64::EPSILON);
        Ok(PersistedPosition {
            x: (collapsed.x as f64 / scale).round() as i32,
            y: (collapsed.y as f64 / scale).round() as i32,
            space: PositionSpace::Logical,
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(collapsed)
    }
}

fn persist_collapsed_window_position(
    app: &AppHandle,
    window: &WebviewWindow,
) -> Result<(), String> {
    let position = collapsed_window_position(window)?;
    let mut positions = load_positions(app);
    let label = window.label().to_string();
    if positions.get(&label) == Some(&position) {
        return Ok(());
    }
    positions.insert(label, position);
    save_positions(app, &positions)
}

pub fn flush_overlay_positions(app: &AppHandle) -> Result<(), String> {
    let mut positions = load_positions(app);
    let mut changed = false;
    let mut first_error = None;

    for (label, window) in app.webview_windows() {
        if !is_overlay_label(&label) {
            continue;
        }
        match collapsed_window_position(&window) {
            Ok(position) if positions.get(&label) != Some(&position) => {
                positions.insert(label, position);
                changed = true;
            }
            Ok(_) => {}
            Err(error) => {
                first_error.get_or_insert_with(|| {
                    format!("failed to read overlay {label} during exit flush: {error}")
                });
            }
        }
    }

    if changed {
        if let Err(error) = save_positions(app, &positions) {
            first_error.get_or_insert(error);
        }
    }
    first_error.map_or(Ok(()), Err)
}

pub(crate) fn close_overlay_window(app: &AppHandle, label: &str) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    {
        use tauri_nspanel::ManagerExt;
        if let Ok(panel) = app.get_webview_panel(label) {
            let window = panel.to_window().ok_or(tauri::Error::WindowNotFound)?;
            return window.close();
        }
        app.get_webview_window(label)
            .ok_or(tauri::Error::WindowNotFound)?
            .close()
    }
    #[cfg(not(target_os = "macos"))]
    {
        app.get_webview_window(label)
            .ok_or(tauri::Error::WindowNotFound)?
            .close()
    }
}

fn schedule_position_persist(app: &AppHandle, window: &WebviewWindow) {
    let label = window.label().to_string();
    let should_spawn = {
        let state = app.state::<DisplayTopologyState>();
        let Ok(mut generations) = state.position_save_generations.lock() else {
            eprintln!("[bridge-desktop] position-save state poisoned for overlay {label}");
            return;
        };
        let generation = generations.entry(label.clone()).or_default();
        *generation = generation.saturating_add(1);
        let Ok(mut workers) = state.position_save_workers.lock() else {
            eprintln!("[bridge-desktop] position-save worker state poisoned for overlay {label}");
            return;
        };
        workers.insert(label.clone())
    };
    if !should_spawn {
        return;
    }

    let app = app.clone();
    std::thread::spawn(move || loop {
        let observed = app
            .state::<DisplayTopologyState>()
            .position_save_generations
            .lock()
            .ok()
            .and_then(|generations| generations.get(&label).copied());
        let Some(observed) = observed else {
            eprintln!("[bridge-desktop] position-save state unavailable for overlay {label}");
            break;
        };

        std::thread::sleep(POSITION_SAVE_DEBOUNCE);
        let is_stable = app
            .state::<DisplayTopologyState>()
            .position_save_generations
            .lock()
            .map(|generations| generations.get(&label).copied() == Some(observed))
            .unwrap_or(false);
        if !is_stable {
            continue;
        }

        let handle = app.clone();
        let save_label = label.clone();
        if let Err(error) = app.run_on_main_thread(move || {
            let Some(save_window) = handle.get_webview_window(&save_label) else {
                eprintln!(
                    "[bridge-desktop] overlay {save_label} closed before its position could persist"
                );
                return;
            };
            if let Err(error) = persist_collapsed_window_position(&handle, &save_window) {
                eprintln!(
                    "[bridge-desktop] failed to persist position for overlay {save_label}: {error}"
                );
            }
        }) {
            eprintln!(
                "[bridge-desktop] failed to schedule position save for overlay {label}: {error}"
            );
        }

        let state = app.state::<DisplayTopologyState>();
        let should_finish = match state.position_save_generations.lock() {
            Ok(generations) if generations.get(&label).copied() == Some(observed) => {
                match state.position_save_workers.lock() {
                    Ok(mut workers) => {
                        workers.remove(&label);
                        true
                    }
                    Err(_) => {
                        eprintln!(
                            "[bridge-desktop] position-save worker state unavailable for overlay {label}"
                        );
                        true
                    }
                }
            }
            Ok(_) => false,
            Err(_) => {
                eprintln!("[bridge-desktop] position-save state unavailable for overlay {label}");
                true
            }
        };
        if should_finish {
            break;
        }
    });
}

fn reconcile_overlay_topology(
    app: &AppHandle,
    init_script: &str,
    monitors: &[Monitor],
    reconcile_positions: bool,
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
        close_overlay_window(app, &label)?;
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

    if reconcile_positions {
        for (index, label) in desired_labels.iter().enumerate() {
            let Some(window) = app.get_webview_window(label) else {
                continue;
            };
            let reconcile_result = (|| -> tauri::Result<()> {
                let position = window.outer_position()?;
                let size = window.outer_size()?;
                let scale = window.scale_factor()?;
                let collapsed_size = (COLLAPSED_SIZE * scale).round() as u32;
                let collapsed = collapsed_top_left(position, size, collapsed_size);
                #[cfg(target_os = "macos")]
                let current = PersistedPosition {
                    x: (collapsed.x as f64 / scale.max(f64::EPSILON)).round() as i32,
                    y: (collapsed.y as f64 / scale.max(f64::EPSILON)).round() as i32,
                    space: PositionSpace::Logical,
                };
                #[cfg(not(target_os = "macos"))]
                let current = collapsed;
                if let Some(target) = monitors.get(index).or_else(|| monitors.first()) {
                    if !is_on_screen(
                        &current,
                        std::slice::from_ref(target),
                        collapsed_size,
                        collapsed_size,
                        scale,
                        32,
                    ) {
                        anchor_bottom_right(&window, target)?;
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
    }
    first_error.map_or(Ok(()), Err)
}

fn reconcile_display_topology(app: &AppHandle, init_script: &str) -> Result<(), String> {
    let monitors = topology_monitors(app);
    let next = display_topology(&monitors);
    let state = app.state::<DisplayTopologyState>();
    let topology_has_changed = {
        let last = state
            .last
            .lock()
            .map_err(|_| "display topology state poisoned".to_string())?;
        topology_changed(last.as_ref(), &next)
    };
    let membership_needs_repair = overlay_membership_needs_repair(app, monitors.len());
    if !topology_has_changed && !membership_needs_repair {
        return Ok(());
    }

    reconcile_overlay_topology(app, init_script, &monitors, topology_has_changed)
        .map_err(|error| error.to_string())?;
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

    let monitors = topology_monitors(&app);
    let initial = display_topology(&monitors);
    match app.state::<DisplayTopologyState>().last.lock() {
        Ok(mut last) => *last = Some(initial),
        Err(_) => {
            eprintln!("[bridge-desktop] initial display topology state poisoned");
        }
    }
    if overlay_membership_needs_repair(&app, monitors.len()) {
        if let Err(error) = reconcile_display_topology(&app, &init_script) {
            eprintln!("[bridge-desktop] initial overlay membership repair failed: {error}");
        }
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
            if !handle
                .state::<DisplayTopologyState>()
                .running
                .load(Ordering::SeqCst)
            {
                return;
            }
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

/// Start a native drag for the calling overlay after the frontend observes
/// intentional pointer movement on the Avatar surface.
#[tauri::command]
pub fn overlay_start_dragging(window: WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|error| error.to_string())
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
    conceal_overlay(&window)
}

fn conceal_overlay(window: &WebviewWindow) -> Result<(), String> {
    window
        .set_ignore_cursor_events(true)
        .map_err(|error| error.to_string())?;
    window.hide().map_err(|error| error.to_string())
}

fn present_overlay(window: &WebviewWindow) -> Result<(), String> {
    window
        .set_ignore_cursor_events(false)
        .map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    println!(
        "[bridge-desktop] avatar overlay visible label={}",
        window.label()
    );
    Ok(())
}

fn assert_readiness_controller(label: &str) -> Result<(), String> {
    if label == MAIN_LABEL {
        Ok(())
    } else {
        Err("only the main shell may set Avatar session readiness".to_string())
    }
}

/// Session-scoped readiness is separate from persisted visual preferences.
/// The main shell calls this only after it has confirmed an active
/// Organization. False hides every overlay immediately; true notifies each
/// webview, which presents itself only after it has loaded ready preferences.
#[tauri::command]
pub fn overlay_set_session_ready(
    app: AppHandle,
    caller: WebviewWindow,
    state: State<'_, OverlaySessionState>,
    ready: bool,
) -> Result<(), String> {
    assert_readiness_controller(caller.label())?;
    state.ready.store(ready, Ordering::SeqCst);
    let mut failures = Vec::new();
    for (label, window) in app.webview_windows() {
        if !is_overlay_label(&label) {
            continue;
        }
        if !ready {
            if let Err(error) = conceal_overlay(&window) {
                failures.push(format!("{label}: conceal failed: {error}"));
            }
        }
        if let Err(error) = window.emit(AVATAR_SESSION_READY_EVENT, ready) {
            failures.push(format!("{label}: readiness event failed: {error}"));
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}

#[tauri::command]
pub fn overlay_get_session_ready(state: State<'_, OverlaySessionState>) -> bool {
    state.ready.load(Ordering::SeqCst)
}

/// Called by an overlay webview after both native session readiness and
/// canonical Avatar preferences are ready. A stale caller can never override
/// the server-owned session gate.
#[tauri::command]
pub fn overlay_present(
    window: WebviewWindow,
    state: State<'_, OverlaySessionState>,
) -> Result<bool, String> {
    if !state.ready.load(Ordering::SeqCst) {
        conceal_overlay(&window)?;
        return Ok(false);
    }
    present_overlay(&window)?;
    Ok(true)
}

#[tauri::command]
pub fn overlay_conceal(window: WebviewWindow) -> Result<(), String> {
    conceal_overlay(&window)
}

/// Persist the calling overlay's reconciled collapsed position immediately.
/// Native move events normally trigger the debounced path; this command stays
/// available for explicit flushes and compatibility with older frontends.
#[tauri::command]
pub fn overlay_save_position(window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    let pos = collapsed_window_position(&window)?;
    let label = window.label().to_string();
    let mut map = load_positions(&app);
    map.insert(label, pos);
    save_positions(&app, &map)
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
    reconcile_saved_position(
        &app,
        &label,
        &monitors,
        phys_size.width,
        phys_size.height,
        window.scale_factor().unwrap_or(1.0),
    )
}

fn is_allowed_main_route(route: &str) -> bool {
    let Some(task_id) = route.strip_prefix("/task-manager/") else {
        return false;
    };
    task_id.len() == 36
        && task_id.chars().enumerate().all(|(index, character)| {
            if [8, 13, 18, 23].contains(&index) {
                character == '-'
            } else {
                character.is_ascii_hexdigit()
            }
        })
}

/// Bring the main Bridge window forward and optionally navigate it to a
/// validated in-app Task route.
#[tauri::command]
pub fn focus_main_window(app: AppHandle, route: Option<String>) -> Result<(), String> {
    let win = app
        .get_webview_window(MAIN_LABEL)
        .ok_or_else(|| "main window not found".to_string())?;
    if let Some(route) = route {
        if !is_allowed_main_route(&route) {
            return Err("main-window route is not allowed".to_string());
        }
        win.emit("bridge:navigate", route)
            .map_err(|error| error.to_string())?;
    }
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

    #[test]
    fn overlay_session_readiness_defaults_closed_and_changes_explicitly() {
        let state = OverlaySessionState::default();
        assert!(!state.ready.load(Ordering::SeqCst));
        state.ready.store(true, Ordering::SeqCst);
        assert!(state.ready.load(Ordering::SeqCst));
    }

    #[test]
    fn only_main_shell_can_control_overlay_session_readiness() {
        assert!(assert_readiness_controller(MAIN_LABEL).is_ok());
        assert!(assert_readiness_controller(OVERLAY_LABEL).is_err());
        assert!(assert_readiness_controller("overlay-1").is_err());
    }

    #[test]
    fn main_window_navigation_accepts_only_task_detail_routes() {
        assert!(is_allowed_main_route(
            "/task-manager/123e4567-e89b-42d3-a456-426614174000"
        ));
        assert!(!is_allowed_main_route("/task-manager"));
        assert!(!is_allowed_main_route("/approvals"));
        assert!(!is_allowed_main_route(
            "/task-manager/123e4567-e89b-42d3-a456-426614174000?redirect=https://example.com"
        ));
    }

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
        let pos = PersistedPosition {
            x: 1234,
            y: -56,
            space: PositionSpace::Logical,
        };
        let json = serde_json::to_string(&pos).unwrap();
        let back: PersistedPosition = serde_json::from_str(&json).unwrap();
        assert_eq!(back, pos);
    }

    #[test]
    fn position_map_roundtrips_json() {
        let mut map: PositionMap = HashMap::new();
        map.insert(
            "overlay".into(),
            PersistedPosition {
                x: 10,
                y: 20,
                space: PositionSpace::Logical,
            },
        );
        map.insert(
            "overlay-1".into(),
            PersistedPosition {
                x: 30,
                y: 40,
                space: PositionSpace::Logical,
            },
        );
        let json = serde_json::to_string(&map).unwrap();
        let back: PositionMap = serde_json::from_str(&json).unwrap();
        assert_eq!(
            back.get("overlay"),
            Some(&PersistedPosition {
                x: 10,
                y: 20,
                space: PositionSpace::Logical,
            })
        );
        assert_eq!(
            back.get("overlay-1"),
            Some(&PersistedPosition {
                x: 30,
                y: 40,
                space: PositionSpace::Logical,
            })
        );
    }

    #[test]
    fn legacy_position_defaults_to_physical_coordinates() {
        let position: PersistedPosition = serde_json::from_str(r#"{"x":3180,"y":1830}"#).unwrap();
        assert_eq!(position.space, PositionSpace::Physical);
    }

    #[test]
    fn mixed_dpi_logical_anchors_cover_each_real_display() {
        let primary = logical_bounds_from_physical(0, 0, 3420, 2214, 2.0);
        let right_external = logical_bounds_from_physical(1710, 126, 1600, 900, 1.0);
        let lower_external = logical_bounds_from_physical(0, -1080, 1920, 1080, 1.0);

        assert_eq!(
            logical_anchor_position(primary, COLLAPSED_SIZE, COLLAPSED_SIZE),
            PersistedPosition {
                x: 1590,
                y: 915,
                space: PositionSpace::Logical,
            }
        );
        assert_eq!(
            logical_anchor_position(right_external, COLLAPSED_SIZE, COLLAPSED_SIZE),
            PersistedPosition {
                x: 3190,
                y: 834,
                space: PositionSpace::Logical,
            }
        );
        assert_eq!(
            logical_anchor_position(lower_external, COLLAPSED_SIZE, COLLAPSED_SIZE),
            PersistedPosition {
                x: 1800,
                y: -192,
                space: PositionSpace::Logical,
            }
        );
    }

    #[test]
    fn expanded_logical_anchor_preserves_collapsed_bottom_right() {
        let display = logical_bounds_from_physical(0, 0, 3420, 2214, 2.0);
        let expanded = logical_anchor_position(display, 320.0, 480.0);
        let collapsed_x = expanded.x + 320 - COLLAPSED_SIZE as i32;
        let collapsed_y = expanded.y + 480 - COLLAPSED_SIZE as i32;

        assert_eq!(
            expanded,
            PersistedPosition {
                x: 1366,
                y: 531,
                space: PositionSpace::Logical,
            }
        );
        assert_eq!((collapsed_x, collapsed_y), (1590, 915));
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
            PersistedPosition {
                x: 388,
                y: 584,
                space: PositionSpace::Physical,
            },
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
            PersistedPosition {
                x: 264,
                y: 200,
                space: PositionSpace::Physical,
            },
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
    fn monitor_index_decodes_from_window_label() {
        assert_eq!(monitor_index_for_label("overlay"), 0);
        assert_eq!(monitor_index_for_label("overlay-1"), 1);
        assert_eq!(monitor_index_for_label("overlay-12"), 12);
        assert_eq!(monitor_index_for_label("main"), 0);
        assert_eq!(monitor_index_for_label("overlay-menu"), 0);
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
