//! annotate — the 3rd companion window: a display-sized, transparent,
//! CLICK-THROUGH overlay that draws a constrained, typed mark vocabulary
//! (highlight/arrow/callout/spotlight) to point at a screen location — the
//! "assist users when they don't know where to click" capability
//! (docs/wiki/desktop-companion.md P1).
//!
//! Un-spoofable by construction: marks are a Rust enum
//! (`AnnotationMark`/`MarkKind`), never raw HTML or model-generated text
//! rendered into the webview. The frontend (AnnotateApp.tsx) only ever
//! receives this typed, serde-validated shape over a Tauri event — it cannot
//! render arbitrary content because the shape has no field for it. This is
//! the same rule the CSP fix (SEC-4) was a prerequisite for: an annotation
//! surface with unrestricted content would be a perfect phishing/prompt-
//! injection canvas (a fake "click here" overlay drawn by anything other
//! than this shell). One window per monitor, same pattern as overlay.rs.
//!
//! Input half NOT built in this slice: the accessibility-tree lookup that
//! would resolve "the Send button" to a rect (providers/accessibility.rs
//! only ships the permission check so far — see its header for why AX-tree
//! walking is deferred). `annotate_show` takes already-resolved rects; a
//! caller (future AX provider, or a manual `annotate_show` call for testing)
//! supplies them. This is real, usable infrastructure on its own — any
//! future input source (AX tree, a user-drawn "point here" during a
//! screen-share-style walkthrough) can drive it unchanged.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Monitor, WebviewUrl, WebviewWindowBuilder};

pub const ANNOTATE_LABEL: &str = "annotate";
const MARKS_EVENT: &str = "annotate.marks";

/// Constrained mark vocabulary (desktop-companion.md's stated set) — adding a
/// new kind means adding an enum variant + a render case in AnnotateApp.tsx,
/// never a free-text/HTML escape hatch.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MarkKind {
    Highlight,
    Arrow,
    Callout,
    Spotlight,
}

/// One mark, in LOGICAL pixels relative to the monitor it targets (matches
/// how `overlay.rs` already reasons about window geometry). `label` is
/// short, plain text only (rendered as text content, never HTML) — used by
/// callout/arrow marks.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AnnotationMark {
    pub kind: MarkKind,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub label: Option<String>,
}

/// Reasonable bound so a bad caller can't paint hundreds of marks (also
/// keeps a compromised/misbehaving upstream agent from turning this into a
/// full-screen defacement tool — a handful of point-at-this marks is the
/// entire legitimate use case).
const MAX_MARKS: usize = 12;

#[derive(Serialize)]
pub struct AnnotateError {
    pub code: &'static str,
    pub message: String,
}

/// Create one click-through annotate window per connected monitor — same
/// enumeration + fallback pattern as `overlay::create_overlay_windows`.
/// Additive: a failure here never blocks the rest of the shell (matches
/// `create_windows`' treatment of the overlay).
pub fn create_annotate_windows(app: &AppHandle, init_script: &str) -> tauri::Result<()> {
    let monitors = app.available_monitors().unwrap_or_default();
    if monitors.is_empty() {
        return create_one_annotate_window(app, init_script, 0, None);
    }
    let mut first_err: Option<tauri::Error> = None;
    for (index, monitor) in monitors.iter().enumerate() {
        if let Err(err) = create_one_annotate_window(app, init_script, index, Some(monitor)) {
            eprintln!(
                "[bridge-desktop] failed to create annotate window for monitor {index}: {err}"
            );
            first_err.get_or_insert(err);
        }
    }
    let any_created = app
        .webview_windows()
        .keys()
        .any(|l| l.starts_with(ANNOTATE_LABEL));
    if let Some(err) = first_err {
        if !any_created {
            return Err(err);
        }
    }
    Ok(())
}

fn label_for_monitor(index: usize) -> String {
    if index == 0 {
        ANNOTATE_LABEL.to_string()
    } else {
        format!("{ANNOTATE_LABEL}-{index}")
    }
}

fn create_one_annotate_window(
    app: &AppHandle,
    init_script: &str,
    index: usize,
    monitor: Option<&Monitor>,
) -> tauri::Result<()> {
    let builder = WebviewWindowBuilder::new(
        app,
        label_for_monitor(index),
        WebviewUrl::App("annotate.html".into()),
    )
    .title("Bridge Annotate")
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false) // hidden until annotate_show has something to draw
    .initialization_script(init_script);

    let win = if let Some(m) = monitor {
        let scale = m.scale_factor();
        let msize = m.size();
        let mpos = m.position();
        builder
            .inner_size(msize.width as f64 / scale, msize.height as f64 / scale)
            .position(mpos.x as f64 / scale, mpos.y as f64 / scale)
            .build()?
    } else {
        builder.inner_size(1280.0, 800.0).build()?
    };

    // Click-through from creation — this window must NEVER intercept a real
    // click meant for whatever app is underneath it.
    let _ = win.set_ignore_cursor_events(true);
    Ok(())
}

/// Broadcast a validated mark list to every annotate window and show them.
/// Validation happens HERE, in Rust, before anything reaches a webview —
/// the frontend trusts what it's given because only this command can send
/// it, and this command only sends what passes these checks.
#[tauri::command]
pub fn annotate_show(app: AppHandle, marks: Vec<AnnotationMark>) -> Result<(), AnnotateError> {
    if marks.is_empty() {
        return Err(AnnotateError {
            code: "ANNOTATE_EMPTY",
            message: "annotate_show called with zero marks — call annotate_clear instead".into(),
        });
    }
    if marks.len() > MAX_MARKS {
        return Err(AnnotateError {
            code: "ANNOTATE_TOO_MANY",
            message: format!(
                "annotate_show given {} marks, max is {MAX_MARKS}",
                marks.len()
            ),
        });
    }
    for m in &marks {
        if !m.x.is_finite() || !m.y.is_finite() || !m.width.is_finite() || !m.height.is_finite() {
            return Err(AnnotateError {
                code: "ANNOTATE_INVALID_GEOMETRY",
                message: "mark geometry must be finite numbers".into(),
            });
        }
        if m.width <= 0.0 || m.height <= 0.0 {
            return Err(AnnotateError {
                code: "ANNOTATE_INVALID_GEOMETRY",
                message: "mark width/height must be positive".into(),
            });
        }
        if let Some(label) = &m.label {
            if label.len() > 120 {
                return Err(AnnotateError {
                    code: "ANNOTATE_LABEL_TOO_LONG",
                    message: "mark label must be 120 chars or fewer".into(),
                });
            }
        }
    }

    for (_, win) in app.webview_windows() {
        if win.label().starts_with(ANNOTATE_LABEL) {
            let _ = win.show();
        }
    }
    app.emit(MARKS_EVENT, &marks).map_err(|e| AnnotateError {
        code: "ANNOTATE_EMIT_FAILED",
        message: e.to_string(),
    })
}

/// Clear all marks and hide every annotate window (never leaves a stale
/// click-through window sitting fully transparent but "visible" — hidden is
/// the honest resting state).
#[tauri::command]
pub fn annotate_clear(app: AppHandle) -> Result<(), AnnotateError> {
    for (_, win) in app.webview_windows() {
        if win.label().starts_with(ANNOTATE_LABEL) {
            let _ = win.hide();
        }
    }
    app.emit(MARKS_EVENT, Vec::<AnnotationMark>::new())
        .map_err(|e| AnnotateError {
            code: "ANNOTATE_EMIT_FAILED",
            message: e.to_string(),
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mark_kind_serializes_snake_case() {
        assert_eq!(
            serde_json::to_string(&MarkKind::Highlight).unwrap(),
            "\"highlight\""
        );
        assert_eq!(
            serde_json::to_string(&MarkKind::Spotlight).unwrap(),
            "\"spotlight\""
        );
    }

    #[test]
    fn annotation_mark_roundtrips_without_label() {
        let mark = AnnotationMark {
            kind: MarkKind::Arrow,
            x: 1.0,
            y: 2.0,
            width: 3.0,
            height: 4.0,
            label: None,
        };
        let json = serde_json::to_string(&mark).unwrap();
        let back: AnnotationMark = serde_json::from_str(&json).unwrap();
        assert_eq!(back.kind, MarkKind::Arrow);
        assert_eq!(back.label, None);
    }
}
