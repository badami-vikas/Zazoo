//! point — "point at the settings button": locate a named UI element on
//! screen and (a) spotlight it via the existing `annotate` overlay, (b) glide
//! the companion's own window there as its "pointing" gesture, triggered
//! from Chat (see `ChatView.tsx`).
//!
//! This is NOT a new locator — it's `companion.rs`'s existing two-stage grid
//! locator (coarse `ask_grid_number` + `refine_cell`, the same pipeline
//! `companion_ask` uses when an answer references something on screen) driven
//! directly from a target label instead of from a parsed `[CELL:..]` tag in a
//! Q&A answer. Same job-table start/poll shape as `companion_ask` for the
//! same reason (jobs.rs): a vision call can outlast WKWebView's ~60s IPC
//! deadline.
//!
//! Consent: sending a screenshot to Groq for this is covered by the same
//! standing Cloud Plane consent as chat (AP-142/AP-143, user directive
//! 2026-08-10) — no separate per-request prompt. The Privacy Guard
//! (`companion::guarded_frontmost_app`) still runs unconditionally: a
//! credential-looking frontmost window is never screenshotted, consent or not.

use serde::Serialize;
use tauri::{AppHandle, Emitter, LogicalPosition, Manager, WebviewWindow};

use crate::companion::{
    self, ask_grid_number, gridded_jpeg, guarded_frontmost_app, groq_api_key, refine_cell,
    schedule_marks_clear, vision_model, CellTarget, CompanionError, COARSE_COLS, COARSE_ROWS,
};
use crate::{annotate, notch, overlay, sensor_bridge};
use crate::overlay::OVERLAY_LABEL;

const MAX_TARGET_CHARS: usize = 200;

fn err(code: &'static str, message: impl Into<String>) -> CompanionError {
    CompanionError { code, message: message.into() }
}

pub const POINT_STARTED_EVENT: &str = "bridge:point-started";
pub const POINT_DONE_EVENT: &str = "bridge:point-done";

#[derive(Default)]
pub struct PointJobs {
    jobs: std::sync::Arc<crate::jobs::JobTable<Result<(), CompanionError>>>,
}

#[derive(Serialize)]
pub struct PointAtPoll {
    pub done: bool,
}

#[tauri::command]
pub fn point_at_start(
    app: AppHandle,
    window: WebviewWindow,
    jobs: tauri::State<'_, PointJobs>,
    target: String,
) -> Result<u64, CompanionError> {
    let target = target.trim().to_string();
    if target.is_empty() {
        return Err(err("POINT_EMPTY_TARGET", "point at what?"));
    }
    if target.chars().count() > MAX_TARGET_CHARS {
        return Err(err(
            "POINT_TARGET_TOO_LONG",
            format!("target is limited to {MAX_TARGET_CHARS} characters"),
        ));
    }
    let monitor_index = overlay::monitor_index_for_label(window.label());
    let job = jobs.jobs.start().map_err(|message| err("POINT_JOBS", message))?;
    let table = jobs.jobs.clone();
    let app_for_task = app.clone();
    let _ = app.emit(POINT_STARTED_EVENT, ());
    tauri::async_runtime::spawn_blocking(move || {
        let result = run_point(&app_for_task, monitor_index, &target);
        table.finish(job, result);
    });
    Ok(job)
}

#[tauri::command]
pub fn point_at_poll(
    jobs: tauri::State<'_, PointJobs>,
    app: AppHandle,
    job: u64,
) -> Result<PointAtPoll, CompanionError> {
    match jobs.jobs.take(job) {
        crate::jobs::JobPollState::Unknown => Err(err(
            "POINT_JOB_UNKNOWN",
            "No such point job — it may have expired unpolled or already been delivered",
        )),
        crate::jobs::JobPollState::Pending => Ok(PointAtPoll { done: false }),
        crate::jobs::JobPollState::Ready(result) => {
            let _ = app.emit(POINT_DONE_EVENT, ());
            result?;
            Ok(PointAtPoll { done: true })
        }
    }
}

/// Locate `target` on `monitor_index`, spotlight it, and glide the avatar
/// window to sit beside it. Runs off the main thread (the caller is
/// `spawn_blocking`); `companion::monitor_logical_size` hops back to the main
/// thread itself for the one call that needs it.
fn run_point(app: &AppHandle, monitor_index: usize, target: &str) -> Result<(), CompanionError> {
    if let Some(guarded) = guarded_frontmost_app() {
        return Err(err(
            "POINT_PRIVACY_GUARD",
            format!(
                "{guarded} looks like a password or credential window, so Bridge will not \
                 screenshot it to point at anything. Switch windows and try again."
            ),
        ));
    }
    let key = groq_api_key(app).ok_or_else(|| {
        err(
            "POINT_NO_PROVIDER",
            "no cloud vision provider is configured (set a Groq API key in Settings)",
        )
    })?;
    let model = vision_model(app);

    let capture = sensor_bridge::capture_display_jpeg(app, monitor_index).map_err(|error| {
        let code = if error.code == "SCREEN_PERMISSION_REQUIRED" {
            "POINT_NO_SCREEN_PERMISSION"
        } else {
            "POINT_CAPTURE_FAILED"
        };
        err(code, error.message)
    })?;
    let coarse_gridded = gridded_jpeg(&capture.jpeg_bytes, COARSE_COLS, COARSE_ROWS)
        .ok_or_else(|| err("POINT_IMAGE_DECODE_FAILED", "couldn't decode the screen capture"))?;
    let coarse_number = ask_grid_number(&key, &model, &coarse_gridded, target, COARSE_COLS, COARSE_ROWS)
        .ok_or_else(|| {
            err("POINT_NOT_FOUND", format!("couldn't find \"{target}\" on screen"))
        })?;
    let region = refine_cell(
        &key,
        &model,
        &capture.jpeg_bytes,
        capture.image_width as f64,
        capture.image_height as f64,
        &CellTarget { number: coarse_number, label: target.to_string() },
    );
    let (logical_w, logical_h) = companion::monitor_logical_size(app, monitor_index)
        .unwrap_or((capture.image_width as f64, capture.image_height as f64));
    let marks = companion::marks_for_box(
        region,
        target,
        capture.image_width as f64,
        capture.image_height as f64,
        logical_w,
        logical_h,
    );
    if marks.is_empty() {
        return Err(err("POINT_OFFSCREEN", "found it, but couldn't place it on screen"));
    }
    annotate::show_marks_on(app, monitor_index, marks.clone())
        .map_err(|error| err("POINT_ANNOTATE_FAILED", error))?;
    schedule_marks_clear(app);

    // The spotlight mark (first) is centered on the located region — glide
    // the avatar to sit just beside it, the same `set_position` primitive
    // `chase.rs` uses, just walking TO a point instead of fleeing one.
    let spotlight = &marks[0];
    let target_x = spotlight.x + spotlight.width / 2.0;
    let target_y = spotlight.y + spotlight.height;
    if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
        let geometry = notch::current_geometry(app);
        if overlay::is_docked(app) {
            if let Some(geometry) = &geometry {
                let start_x = geometry.visible_right - overlay::COLLAPSED_SIZE - 24.0;
                let start_y = geometry.visible_bottom - overlay::COLLAPSED_SIZE - 24.0;
                let _ = overlay::overlay_undock_free(
                    window.clone(),
                    start_x,
                    start_y,
                    overlay::COLLAPSED_SIZE,
                    overlay::COLLAPSED_SIZE,
                );
            }
        }
        let _ = window.show();
        let (min_x, min_y, max_x, max_y) = overlay::virtual_desktop_bounds(app);
        let size = overlay::COLLAPSED_SIZE;
        let landed = LogicalPosition::new(
            (target_x - size / 2.0).clamp(min_x, max_x - size),
            (target_y + 12.0).clamp(min_y, max_y - size),
        );
        let _ = window.set_position(landed);
    }
    Ok(())
}
