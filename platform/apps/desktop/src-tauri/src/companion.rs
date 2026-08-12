//! companion — the clicky-parity "screen-aware ask" loop (TASK-027).
//!
//! Capability set adapted from the open-source clicky family
//! (farzaa/clicky, emreyilmaz46/clicky_windows, Bitshank-2338/clicky-windows,
//! CONFUZ3/ClickyWindows) via reuse intake: the *behaviors* (push-to-talk
//! summon, screenshot+question → model, `[POINT:x,y:label]` pointing, spoken
//! answers, bounded conversation memory) are re-implemented natively on
//! Bridge's existing governed surfaces — none of their code is copied.
//!
//! Bridge invariants preserved:
//!  - RAW CAPTURE IS LOCAL-PLANE ONLY unless the user explicitly consents,
//!    per ask, to sending ONE screenshot (or one push-to-talk audio clip) to
//!    the configured cloud provider. Consent is a request field the frontend
//!    only sets from an explicit user control; without it the ask routes to
//!    the managed LOCAL model and no image leaves the machine.
//!  - THE BLINK IS THE TELL: every capture taken here goes through
//!    `sensor_bridge::capture_display_jpeg`, which pushes an inspectable
//!    observation and emits `sensor.capture`.
//!  - Pointing is UN-SPOOFABLE: model output is parsed into the typed
//!    `AnnotationMark` vocabulary (annotate.rs) — the model can place a
//!    finite number of typed marks with bounded plain-text labels, never
//!    arbitrary content on the annotation surface.
//!  - Graceful degradation: no cloud key → local text-only answers that say
//!    honestly they cannot see the screen; no local model → typed error.
//!
//! TTS is macOS `say` (built-in, fully local). STT is Groq Whisper and only
//! runs when the user pressed-and-held the push-to-talk control with cloud
//! voice enabled — audio is recorded in the overlay webview, transcribed
//! here, and never persisted.

use crate::{annotate, model_supervisor, sensor_bridge};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::{
    io::Write as _,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

pub const COMPANION_PTT_EVENT: &str = "bridge:companion-ptt";

pub(crate) const GROQ_BASE_URL: &str = "https://api.groq.com/openai/v1";
/// Vision-capable Groq model for the screen-aware path. Overridable so a
/// deprecated model id never requires a rebuild.
const DEFAULT_VISION_MODEL: &str = "meta-llama/llama-4-scout-17b-16e-instruct";
/// Model ids Groq has retired. An override — a shell env var, or the
/// `companion.json` this app wrote itself — outranks the default, so once one
/// of these is pinned anywhere the screen-aware path 400s on every ask and
/// shipping a new default fixes nothing. Overrides naming a retired model are
/// ignored rather than obeyed, and the reason is logged once per resolve, so
/// the next retirement is one line here instead of another bug report.
const RETIRED_VISION_MODELS: &[&str] = &[
    "llama-3.2-11b-vision-preview",
    "llama-3.2-90b-vision-preview",
    "llava-v1.5-7b-4096-preview",
];
/// Text-only Groq model for the local-model-absent fallback path. Uses a
/// widely available model so a standard free-tier key always works.
const DEFAULT_TEXT_MODEL: &str = "llama-3.3-70b-versatile";
const DEFAULT_STT_MODEL: &str = "whisper-large-v3-turbo";
/// Retained for the legacy `[POINT:x,y:label]` vocabulary, which the pipeline
/// no longer drives (raw coordinates proved unreliable — see the locator) but
/// still parses and strips defensively so an older prompt or a model that
/// volunteers point tags can never leak them into prose or marks.
#[allow(dead_code)]
const MAX_POINTS: usize = 5;
const MAX_HISTORY_TURNS: usize = 10;
const MAX_QUESTION_CHARS: usize = 4_000;
const MARKS_AUTO_CLEAR: Duration = Duration::from_secs(12);
// Must stay well under WKWebView's ~60s in-page resource deadline: a Tauri
// command that answers later completes a scheme task WebKit already stopped,
// raising an ObjC exception that aborts the process (2026-07-30 crashes).
const HTTP_TIMEOUT: Duration = Duration::from_secs(40);

#[derive(Default)]
pub struct CompanionState {
    speech_child: Mutex<Option<Child>>,
    /// Monotonic generation for annotate auto-clear: a newer ask's marks are
    /// never wiped by an older ask's expiry timer.
    marks_generation: Mutex<u64>,
}

#[derive(Serialize)]
pub struct CompanionError {
    pub code: &'static str,
    pub message: String,
}

fn err(code: &'static str, message: impl Into<String>) -> CompanionError {
    CompanionError {
        code,
        message: message.into(),
    }
}

// ---------------------------------------------------------------------------
// Configuration / capability reporting
// ---------------------------------------------------------------------------

/// Optional local config file `{app_data_dir}/bridge/companion.json` so a
/// packaged app launched from Finder (no shell env) can still hold the key.
/// Never bundled, never synced — Local Plane residency.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct CompanionConfig {
    groq_api_key: Option<String>,
    vision_model: Option<String>,
}

fn load_config(app: &AppHandle) -> CompanionConfig {
    let Some(path) = app
        .path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join("bridge").join("companion.json"))
    else {
        return CompanionConfig::default();
    };
    let Ok(bytes) = std::fs::read(&path) else {
        return CompanionConfig::default();
    };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

pub(crate) fn groq_api_key(app: &AppHandle) -> Option<String> {
    std::env::var("GROQ_API_KEY")
        .ok()
        .filter(|key| !key.trim().is_empty())
        .or_else(|| {
            load_config(app)
                .groq_api_key
                .filter(|k| !k.trim().is_empty())
        })
}

pub(crate) fn vision_model(app: &AppHandle) -> String {
    let override_id = std::env::var("BRIDGE_COMPANION_VISION_MODEL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| load_config(app).vision_model);
    match override_id {
        Some(id) if !is_retired_vision_model(&id) => id,
        Some(id) => {
            eprintln!(
                "[bridge-desktop] companion: vision model override {id:?} is decommissioned — using {DEFAULT_VISION_MODEL}"
            );
            DEFAULT_VISION_MODEL.to_string()
        }
        None => DEFAULT_VISION_MODEL.to_string(),
    }
}

fn is_retired_vision_model(id: &str) -> bool {
    let id = id.trim();
    RETIRED_VISION_MODELS.iter().any(|retired| *retired == id)
}

#[cfg(test)]
mod vision_model_tests {
    use super::{is_retired_vision_model, DEFAULT_VISION_MODEL, RETIRED_VISION_MODELS};

    #[test]
    fn the_shipped_default_is_not_a_retired_model() {
        // The 2026-08-12 report: every screen-aware ask 400'd with
        // `model_decommissioned` because the default was still a retired id.
        assert!(
            !is_retired_vision_model(DEFAULT_VISION_MODEL),
            "DEFAULT_VISION_MODEL {DEFAULT_VISION_MODEL} is on the retired list"
        );
    }

    #[test]
    fn retired_ids_are_recognised_whatever_the_whitespace() {
        for retired in RETIRED_VISION_MODELS {
            assert!(is_retired_vision_model(retired));
            assert!(is_retired_vision_model(&format!("  {retired} ")));
        }
        assert!(!is_retired_vision_model("meta-llama/llama-4-scout-17b-16e-instruct"));
    }
}

/// Resolve the managed local model endpoint published by model_supervisor
/// (`{runtime_dir}/endpoint.json`). Same Local Plane directory resolution as
/// lib.rs — env override first, then app-data default.
pub(crate) fn local_endpoint(app: &AppHandle) -> Option<LocalEndpoint> {
    let local_dir = std::env::var_os("BRIDGE_LOCAL_DIR")
        .map(PathBuf::from)
        .or_else(|| {
            app.path()
                .app_data_dir()
                .ok()
                .map(|dir| dir.join("bridge").join("local-plane"))
        })?;
    let endpoint_path =
        model_supervisor::runtime_dir_for_local_plane(&local_dir).join("endpoint.json");
    let bytes = std::fs::read(&endpoint_path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalEndpoint {
    pub(crate) base_url: String,
    pub(crate) api_key: String,
    pub(crate) model: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionCapabilities {
    /// A cloud vision provider key is configured (Groq). Without it the
    /// screen-aware path is honestly unavailable — asks stay local/text.
    pub cloud_vision: bool,
    pub vision_model: String,
    /// The managed local model endpoint file exists right now.
    pub local_model: bool,
    /// Cloud speech-to-text availability (same Groq key).
    pub cloud_stt: bool,
    /// macOS `say` — local TTS.
    pub tts: bool,
    pub screen_permission: bool,
}

#[tauri::command]
pub fn companion_capabilities(app: AppHandle) -> CompanionCapabilities {
    let has_key = groq_api_key(&app).is_some();
    CompanionCapabilities {
        cloud_vision: has_key,
        vision_model: vision_model(&app),
        local_model: local_endpoint(&app).is_some(),
        cloud_stt: has_key,
        tts: cfg!(target_os = "macos"),
        screen_permission: sensor_bridge::screen_permission_granted(),
    }
}

// ---------------------------------------------------------------------------
// [POINT:x,y:label] parsing + coordinate mapping
// ---------------------------------------------------------------------------

#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq)]
pub struct ParsedPoint {
    /// Coordinates in the SCREENSHOT IMAGE's pixel space.
    pub x: f64,
    pub y: f64,
    pub label: String,
}

/// Parse `[POINT:x,y:label]` tags out of a model reply. Malformed tags are
/// skipped (the text keeps them, harmless); labels are bounded plain text.
/// No regex crate: a small scanner keeps the dependency surface flat.
#[allow(dead_code)]
pub fn parse_point_tags(text: &str) -> Vec<ParsedPoint> {
    const OPEN: &str = "[POINT:";
    let mut points = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find(OPEN) {
        let after = &rest[start + OPEN.len()..];
        let Some(end) = after.find(']') else {
            break;
        };
        let body = &after[..end];
        rest = &after[end + 1..];
        if points.len() >= MAX_POINTS {
            continue;
        }
        let mut parts = body.splitn(3, [',', ':']);
        let (Some(raw_x), Some(raw_y)) = (parts.next(), parts.next()) else {
            continue;
        };
        let label = parts.next().unwrap_or("").trim();
        let (Ok(x), Ok(y)) = (raw_x.trim().parse::<f64>(), raw_y.trim().parse::<f64>()) else {
            continue;
        };
        if !x.is_finite() || !y.is_finite() || x < 0.0 || y < 0.0 {
            continue;
        }
        points.push(ParsedPoint {
            x,
            y,
            label: sanitize_label(label),
        });
    }
    points
}

/// Remove reasoning-model `<think>…</think>` blocks (e.g. Qwen3.x on Groq).
/// Reasoning is suppressed server-side too (`reasoning_format: "hidden"`),
/// but this client-side strip guarantees the panel/speech never show raw
/// thinking even when a provider ignores that parameter. An unclosed
/// `<think>` drops the remainder — reasoning must never leak as answer text.
pub fn strip_think_blocks(text: &str) -> String {
    const OPEN: &str = "<think>";
    const CLOSE: &str = "</think>";
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find(OPEN) {
        out.push_str(&rest[..start]);
        let after = &rest[start + OPEN.len()..];
        match after.find(CLOSE) {
            Some(end) => rest = &after[end + CLOSE.len()..],
            None => {
                rest = "";
                break;
            }
        }
    }
    out.push_str(rest);
    out.trim().to_string()
}

/// A `[CELL:C3:Ask button]` tag: locator stage 1 carried inside the answer.
#[derive(Debug, Clone, PartialEq)]
pub struct CellTarget {
    /// Printed cell number on the drawn coarse grid (1-based, row-major).
    pub number: usize,
    pub label: String,
}

/// Parse the single `[CELL:<number>:<label>]` tag from a reply, where the
/// number is a printed cell on the drawn coarse grid. Returns `None` when
/// absent or malformed — the companion then answers without pointing rather
/// than marking a guessed location.
pub fn parse_cell_tag(text: &str) -> Option<CellTarget> {
    const OPEN: &str = "[CELL:";
    let start = text.find(OPEN)?;
    let after = &text[start + OPEN.len()..];
    let end = after.find(']')?;
    let body = &after[..end];
    let mut parts = body.splitn(2, ':');
    let number = parse_cell_number(parts.next()?.trim(), COARSE_COLS, COARSE_ROWS)?;
    let label = sanitize_label(parts.next().unwrap_or("").trim());
    Some(CellTarget { number, label })
}

/// Remove `[CELL:...]` tags from the prose shown and spoken to the user.
pub fn strip_cell_tags(text: &str) -> String {
    const OPEN: &str = "[CELL:";
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find(OPEN) {
        out.push_str(&rest[..start]);
        let after = &rest[start + OPEN.len()..];
        match after.find(']') {
            Some(end) => rest = &after[end + 1..],
            None => {
                rest = "";
                break;
            }
        }
    }
    out.push_str(rest);
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Strip the tags for display/speech — the user hears/reads clean prose while
/// the typed marks do the pointing.
pub fn strip_point_tags(text: &str) -> String {
    const OPEN: &str = "[POINT:";
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find(OPEN) {
        out.push_str(&rest[..start]);
        let after = &rest[start + OPEN.len()..];
        match after.find(']') {
            Some(end) => rest = &after[end + 1..],
            None => {
                rest = "";
                break;
            }
        }
    }
    out.push_str(rest);
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn sanitize_label(label: &str) -> String {
    let cleaned: String = label.chars().filter(|c| !c.is_control()).take(60).collect();
    cleaned.trim().to_string()
}

// ---------------------------------------------------------------------------
// Two-stage grid locator
// ---------------------------------------------------------------------------
//
// Adapted from the clicky-windows (Bitshank) "two-stage grid locator for
// pixel-perfect pointing on any LLM" behavior. Reason it exists: the vision
// models available here describe a screen accurately in words but ground raw
// pixel coordinates badly (measured: a target at 750,450 in a 1000x600 image
// came back as 136,808). Asking "which cell?" twice — the second time on a
// CROP, where the target fills far more of the frame — replaces one
// unreliable coordinate guess with two coarse spatial judgements, and the
// resulting box is honest about its own precision (the mark is drawn the
// size of the located cell, not a false pinpoint).

/// A located region in screenshot-image pixel space.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LocatedBox {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Coarse grid drawn on the full screenshot, and fine grid drawn on the
/// zoomed crop. Sizes follow clicky-windows' locator (12x8 then 6x6): fine
/// enough that one cell is a UI control rather than a region, coarse enough
/// that a two-digit label stays legible when drawn on the image.
pub(crate) const COARSE_COLS: usize = 12;
pub(crate) const COARSE_ROWS: usize = 8;
const FINE_COLS: usize = 6;
const FINE_ROWS: usize = 6;

// ---------------------------------------------------------------------------
// Set-of-Mark grid rendering
// ---------------------------------------------------------------------------
//
// The marks are DRAWN ONTO the screenshot rather than described in words.
// Asking a model to imagine a grid leaves it estimating positions, which is
// exactly the thing these models are bad at; drawing numbered cells turns
// "where is it" into "read the number printed next to it", which they are
// good at. This is Set-of-Mark / Mark-Grid Scaffold prompting
// (arXiv:2310.11441, arXiv:2509.11548) and the technique clicky-windows uses
// for its "pixel-perfect pointing on any LLM".

/// 5x7 bitmap digits — a hand-rolled font avoids pulling a font crate and a
/// glyph rasteriser in just to draw at most two digits per cell.
const DIGITS: [[u8; 7]; 10] = [
    [0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E], // 0
    [0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E], // 1
    [0x0E, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1F], // 2
    [0x1F, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0E], // 3
    [0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02], // 4
    [0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E], // 5
    [0x06, 0x08, 0x10, 0x1E, 0x11, 0x11, 0x0E], // 6
    [0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08], // 7
    [0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E], // 8
    [0x0E, 0x11, 0x11, 0x0F, 0x01, 0x02, 0x0C], // 9
];

const GRID_LINE: [u8; 3] = [255, 0, 220]; // magenta — rare in real UI chrome
const LABEL_BG: [u8; 3] = [255, 0, 220];
const LABEL_FG: [u8; 3] = [255, 255, 255];

fn fill_rect(image: &mut image::RgbImage, x: i64, y: i64, w: i64, h: i64, color: [u8; 3]) {
    let (width, height) = (image.width() as i64, image.height() as i64);
    for py in y.max(0)..(y + h).min(height) {
        for px in x.max(0)..(x + w).min(width) {
            image.put_pixel(px as u32, py as u32, image::Rgb(color));
        }
    }
}

fn draw_digit(image: &mut image::RgbImage, x: i64, y: i64, digit: usize, scale: i64) {
    let glyph = DIGITS[digit.min(9)];
    for (row, bits) in glyph.iter().enumerate() {
        for column in 0..5_i64 {
            if bits & (1 << (4 - column)) != 0 {
                fill_rect(
                    image,
                    x + column * scale,
                    y + row as i64 * scale,
                    scale,
                    scale,
                    LABEL_FG,
                );
            }
        }
    }
}

/// Draw `number` with a solid background plate so it stays readable over any
/// screen content. Returns the plate's width.
fn draw_number(image: &mut image::RgbImage, x: i64, y: i64, number: usize, scale: i64) -> i64 {
    let text = number.to_string();
    let pad = scale;
    let glyph_w = 5 * scale + scale; // glyph + inter-glyph gap
    let plate_w = text.len() as i64 * glyph_w + pad;
    let plate_h = 7 * scale + pad * 2;
    fill_rect(image, x, y, plate_w, plate_h, LABEL_BG);
    for (index, character) in text.chars().enumerate() {
        if let Some(digit) = character.to_digit(10) {
            draw_digit(
                image,
                x + pad + index as i64 * glyph_w,
                y + pad,
                digit as usize,
                scale,
            );
        }
    }
    plate_w
}

/// Overlay a numbered `cols x rows` grid. Cells are numbered row-major from
/// 1, with the number drawn inside the cell's top-left corner.
fn draw_numbered_grid(image: &mut image::RgbImage, cols: usize, rows: usize) {
    let (width, height) = (image.width() as i64, image.height() as i64);
    let line = (width.min(height) / 600).clamp(1, 3);
    let scale = (width.min(height) / 260).clamp(2, 6);
    let cell_w = width as f64 / cols as f64;
    let cell_h = height as f64 / rows as f64;

    for column in 1..cols {
        let x = (column as f64 * cell_w).round() as i64;
        fill_rect(image, x, 0, line, height, GRID_LINE);
    }
    for row in 1..rows {
        let y = (row as f64 * cell_h).round() as i64;
        fill_rect(image, 0, y, width, line, GRID_LINE);
    }
    for row in 0..rows {
        for column in 0..cols {
            let number = row * cols + column + 1;
            draw_number(
                image,
                (column as f64 * cell_w).round() as i64 + line,
                (row as f64 * cell_h).round() as i64 + line,
                number,
                scale,
            );
        }
    }
}

/// Longest edge sent to the provider. A retina screenshot is ~3420px wide;
/// 1280px keeps UI text and the drawn grid numbers legible while cutting the
/// payload several-fold. Safe for the locator by construction: stages return
/// grid CELL numbers (scale-invariant), never pixel coordinates, so they map
/// back to the full-size image exactly.
const MAX_PROVIDER_EDGE: u32 = 1280;

fn downscale_jpeg(bytes: &[u8], max_edge: u32) -> Option<Vec<u8>> {
    let image = image::load_from_memory_with_format(bytes, image::ImageFormat::Jpeg).ok()?;
    let (width, height) = image::GenericImageView::dimensions(&image);
    if width.max(height) <= max_edge {
        return None; // already small enough — keep the original bytes
    }
    let resized = image.resize(max_edge, max_edge, image::imageops::FilterType::Triangle);
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 82)
        .encode_image(&resized.to_rgb8())
        .ok()?;
    Some(out)
}

/// Bytes to send a provider: downscaled when oversized, original otherwise.
fn provider_jpeg(bytes: &[u8]) -> std::borrow::Cow<'_, [u8]> {
    match downscale_jpeg(bytes, MAX_PROVIDER_EDGE) {
        Some(smaller) => {
            eprintln!(
                "[bridge-desktop] companion image downscaled {} KiB -> {} KiB",
                bytes.len() / 1024,
                smaller.len() / 1024
            );
            std::borrow::Cow::Owned(smaller)
        }
        None => std::borrow::Cow::Borrowed(bytes),
    }
}

/// Decode, downscale for the provider, draw the numbered grid, re-encode.
pub(crate) fn gridded_jpeg(bytes: &[u8], cols: usize, rows: usize) -> Option<Vec<u8>> {
    let image = image::load_from_memory_with_format(bytes, image::ImageFormat::Jpeg).ok()?;
    let (width, height) = image::GenericImageView::dimensions(&image);
    let image = if width.max(height) > MAX_PROVIDER_EDGE {
        image.resize(
            MAX_PROVIDER_EDGE,
            MAX_PROVIDER_EDGE,
            image::imageops::FilterType::Triangle,
        )
    } else {
        image
    };
    let mut rgb = image.to_rgb8();
    draw_numbered_grid(&mut rgb, cols, rows);
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 85)
        .encode_image(&rgb)
        .ok()?;
    Some(out)
}

/// Row-major 1-based cell number → its rectangle inside `outer`.
pub fn numbered_cell_box(
    outer: LocatedBox,
    cols: usize,
    rows: usize,
    number: usize,
) -> Option<LocatedBox> {
    if number == 0 || number > cols * rows || cols == 0 || rows == 0 {
        return None;
    }
    let index = number - 1;
    let column = index % cols;
    let row = index / cols;
    let width = outer.width / cols as f64;
    let height = outer.height / rows as f64;
    Some(LocatedBox {
        x: outer.x + column as f64 * width,
        y: outer.y + row as f64 * height,
        width,
        height,
    })
}

/// First integer in a reply that is a valid cell number for the grid.
pub fn parse_cell_number(reply: &str, cols: usize, rows: usize) -> Option<usize> {
    let mut digits = String::new();
    for character in reply.chars().chain(std::iter::once(' ')) {
        if character.is_ascii_digit() {
            digits.push(character);
            continue;
        }
        if !digits.is_empty() {
            if let Ok(value) = digits.parse::<usize>() {
                if value >= 1 && value <= cols * rows {
                    return Some(value);
                }
            }
            digits.clear();
        }
    }
    None
}

/// Expand a box by `ratio` of its own size, clamped to the image — context
/// around the cell keeps a target that straddles a grid line findable.
pub fn padded_box(inner: LocatedBox, image_w: f64, image_h: f64, ratio: f64) -> LocatedBox {
    let pad_x = inner.width * ratio;
    let pad_y = inner.height * ratio;
    let x = (inner.x - pad_x).max(0.0);
    let y = (inner.y - pad_y).max(0.0);
    LocatedBox {
        x,
        y,
        width: (inner.width + pad_x * 2.0).min(image_w - x).max(1.0),
        height: (inner.height + pad_y * 2.0).min(image_h - y).max(1.0),
    }
}

fn grid_number_prompt(target: &str, cols: usize, rows: usize) -> String {
    let cells = cols * rows;
    format!(
        "A magenta grid is drawn over this zoomed-in region of the user's screen, dividing it \
         into {cols} columns and {rows} rows. Each cell has its number printed in its top-left \
         corner, from 1 to {cells}. Which cell contains: {target}? Read the printed number off \
         the grid rather than estimating. Reply with only that number. If it is not visible in \
         this region, reply NONE."
    )
}

/// Ask which numbered cell of a DRAWN grid contains the target.
pub(crate) fn ask_grid_number(
    key: &str,
    model: &str,
    gridded_jpeg: &[u8],
    target: &str,
    cols: usize,
    rows: usize,
) -> Option<usize> {
    let body = serde_json::json!({
        "model": model,
        "max_tokens": 12,
        "temperature": 0.0,
        "reasoning_effort": "none",
        "messages": [{
            "role": "user",
            "content": [
                { "type": "text", "text": grid_number_prompt(target, cols, rows) },
                { "type": "image_url", "image_url": { "url": format!(
                    "data:image/jpeg;base64,{}",
                    base64::engine::general_purpose::STANDARD.encode(gridded_jpeg)
                ) } },
            ],
        }],
    });
    match post_chat(&format!("{GROQ_BASE_URL}/chat/completions"), key, body) {
        Ok(reply) => {
            let reply = strip_think_blocks(&reply);
            eprintln!("[bridge-desktop] companion fine-grid reply={reply:?}");
            parse_cell_number(&reply, cols, rows)
        }
        Err(error) => {
            eprintln!(
                "[bridge-desktop] companion locator stage failed ({}): {}",
                error.code, error.message
            );
            None
        }
    }
}

/// Crop `region` out of a JPEG and re-encode it.
fn crop_jpeg(bytes: &[u8], region: LocatedBox) -> Option<Vec<u8>> {
    let image = image::load_from_memory_with_format(bytes, image::ImageFormat::Jpeg).ok()?;
    let cropped = image::GenericImageView::view(
        &image,
        region.x.max(0.0) as u32,
        region.y.max(0.0) as u32,
        region.width.max(1.0) as u32,
        region.height.max(1.0) as u32,
    )
    .to_image();
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 85)
        .encode_image(&image::DynamicImage::ImageRgba8(cropped).to_rgb8())
        .ok()?;
    Some(out)
}

/// Stage 2: refine a cell the answer call already reported. One extra
/// provider call, on a CROP where the target fills far more of the frame.
/// Falls back to the coarse region whenever the refinement is unavailable
/// (rate limit, undecodable crop, target not visible in the zoom) — a loose
/// ring that contains the target beats no ring at all.
pub(crate) fn refine_cell(
    key: &str,
    model: &str,
    jpeg: &[u8],
    image_w: f64,
    image_h: f64,
    target: &CellTarget,
) -> LocatedBox {
    let full = LocatedBox {
        x: 0.0,
        y: 0.0,
        width: image_w,
        height: image_h,
    };
    let Some(cell) = numbered_cell_box(full, COARSE_COLS, COARSE_ROWS, target.number) else {
        return full;
    };
    // Pad generously: the answer call reads the number of the cell a control
    // sits in, but a control straddling a grid line can be labelled either
    // side, so the crop must contain its neighbours.
    let coarse = padded_box(cell, image_w, image_h, 0.6);
    if target.label.is_empty() {
        return coarse;
    }
    let Some(crop) = crop_jpeg(jpeg, coarse) else {
        return coarse;
    };
    let Some(gridded) = gridded_jpeg(&crop, FINE_COLS, FINE_ROWS) else {
        return coarse;
    };
    match ask_grid_number(key, model, &gridded, &target.label, FINE_COLS, FINE_ROWS) {
        Some(number) => numbered_cell_box(coarse, FINE_COLS, FINE_ROWS, number).unwrap_or(coarse),
        None => coarse,
    }
}

/// Map a point from screenshot-image pixel space to the monitor's logical
/// coordinate space (what AnnotateApp renders in — its window covers the
/// monitor at logical size).
pub fn map_image_point_to_logical(
    x: f64,
    y: f64,
    image_w: f64,
    image_h: f64,
    logical_w: f64,
    logical_h: f64,
) -> Option<(f64, f64)> {
    if image_w <= 0.0 || image_h <= 0.0 || logical_w <= 0.0 || logical_h <= 0.0 {
        return None;
    }
    let lx = (x * logical_w / image_w).clamp(0.0, logical_w);
    let ly = (y * logical_h / image_h).clamp(0.0, logical_h);
    Some((lx, ly))
}

/// Typed marks for a LOCATED region: a spotlight sized to the region itself
/// (so the ring communicates how precisely the target was found — a coarse
/// stage-1-only result draws a big ring, a refined one draws a small ring)
/// plus a labeled callout beneath it.
pub fn marks_for_box(
    region: LocatedBox,
    label: &str,
    image_w: f64,
    image_h: f64,
    logical_w: f64,
    logical_h: f64,
) -> Vec<annotate::AnnotationMark> {
    let center_x = region.x + region.width / 2.0;
    let center_y = region.y + region.height / 2.0;
    let Some((cx, cy)) =
        map_image_point_to_logical(center_x, center_y, image_w, image_h, logical_w, logical_h)
    else {
        return Vec::new();
    };
    // Region size in logical units, bounded so a ring is always a readable
    // "look here" and never a full-screen circle.
    let scale_x = logical_w / image_w;
    let scale_y = logical_h / image_h;
    let width = (region.width * scale_x).clamp(48.0, logical_w * 0.6);
    let height = (region.height * scale_y).clamp(48.0, logical_h * 0.6);

    let mut marks = vec![annotate::AnnotationMark {
        kind: annotate::MarkKind::Spotlight,
        x: cx - width / 2.0,
        y: cy - height / 2.0,
        width,
        height,
        label: None,
    }];
    if !label.is_empty() {
        let callout_w = (label.len() as f64 * 9.0 + 24.0).clamp(80.0, 360.0);
        let below = cy + height / 2.0 + 16.0;
        let callout_y = if below + 30.0 <= logical_h {
            below
        } else {
            (cy - height / 2.0 - 46.0).max(0.0)
        };
        marks.push(annotate::AnnotationMark {
            kind: annotate::MarkKind::Callout,
            x: (cx - callout_w / 2.0).clamp(0.0, (logical_w - callout_w).max(0.0)),
            y: callout_y,
            width: callout_w,
            height: 30.0,
            label: Some(label.to_string()),
        });
    }
    marks
}

// ---------------------------------------------------------------------------
// Ask pipeline
// ---------------------------------------------------------------------------

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HistoryTurn {
    pub role: String,
    pub content: String,
    /// True when this turn's text was derived from a consented screen capture
    /// (an answer produced while `share_screen_with_cloud` was on). The tag
    /// travels with the turn so egress policy can reason about it — the
    /// consent copy in the ask panel discloses that prior conversation turns,
    /// including screen-derived ones, ride along on later consented asks.
    #[serde(default)]
    pub screen_derived: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionAskRequest {
    pub question: String,
    /// The user explicitly consented — for THIS ask — to sending one
    /// screenshot of the current display to the configured cloud provider.
    /// Set only from an explicit UI control; defaults false everywhere.
    #[serde(default)]
    pub share_screen_with_cloud: bool,
    /// Speak the answer aloud via local TTS when it arrives.
    #[serde(default)]
    pub speak: bool,
    /// Bounded, ephemeral conversation memory (last N turns), managed by the
    /// overlay panel. Never persisted here.
    #[serde(default)]
    pub history: Vec<HistoryTurn>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionAnswer {
    pub text: String,
    pub provider: &'static str,
    pub screen_shared: bool,
    pub points: usize,
    pub spoke: bool,
    /// Honest capture-quality note (e.g. Screen Recording permission not
    /// granted, so the screenshot may show only the wallpaper).
    pub capture_note: Option<String>,
    /// Emotion the model tagged its response with (one of the ZazooEmotion
    /// names, lower-case), or None when no tag was present.
    pub emotion: Option<String>,
}

/// Strip a leading `[EMOTION:X]` line from the model's reply (whitelist-only;
/// any unrecognised tag is left in the prose and treated as absent).
fn strip_emotion_tag(text: &str) -> (Option<String>, &str) {
    let t = text.trim_start();
    if !t.starts_with("[EMOTION:") { return (None, text); }
    if let Some(end) = t.find(']') {
        let emotion = t[9..end].trim().to_lowercase();
        if matches!(emotion.as_str(), "calm"|"curious"|"thinking"|"listening"|"happy"|"proud"|"unsure"|"concerned"|"comforting"|"celebrating"|"sleepy") {
            return (Some(emotion), t[end + 1..].trim_start());
        }
    }
    (None, text)
}

/// Per-path history budgets. The vision path shares its request with a
/// ~2,500-token screenshot against a free tier metering 8,000 tokens/minute,
/// so its history must stay far tighter than the local path's.
struct HistoryBudget {
    per_turn_chars: usize,
    total_chars: usize,
}

const VISION_HISTORY_BUDGET: HistoryBudget = HistoryBudget {
    per_turn_chars: 800,
    total_chars: 4_800,
};
const LOCAL_HISTORY_BUDGET: HistoryBudget = HistoryBudget {
    per_turn_chars: 2_000,
    total_chars: 8_000,
};

/// Newest-first selection under three bounds: role allowlist, a turn count,
/// and a total-character budget (dropping OLDEST first once exceeded).
///
/// The role filter runs BEFORE the take — a rejected turn (e.g. an injected
/// `system` role from a compromised webview) must not be able to shrink the
/// usable window, only be ignored.
fn bounded_history(history: &[HistoryTurn], budget: &HistoryBudget) -> Vec<serde_json::Value> {
    let mut spent = 0usize;
    let mut selected: Vec<serde_json::Value> = history
        .iter()
        .rev()
        .filter(|turn| matches!(turn.role.as_str(), "user" | "assistant"))
        .take(MAX_HISTORY_TURNS)
        .take_while(|turn| {
            let cost = turn.content.chars().count().min(budget.per_turn_chars);
            if spent + cost > budget.total_chars {
                return false;
            }
            spent += cost;
            true
        })
        .map(|turn| {
            serde_json::json!({
                "role": turn.role,
                "content": turn
                    .content
                    .chars()
                    .take(budget.per_turn_chars)
                    .collect::<String>(),
            })
        })
        .collect();
    selected.reverse();
    selected
}

/// The answer prompt also carries locator stage 1: the model returns the
/// grid CELL of the one thing it is pointing at, in the same reply as the
/// answer. Folding the two together halves the provider calls per ask —
/// which matters concretely, since a free tier meters ~2,500 tokens per
/// image and three image calls per ask exceed 8,000 tokens/minute.
///
/// Cells, not pixel coordinates: these models describe a screen accurately
/// but ground raw pixels badly (measured: a target at 750,450 in a 1000x600
/// image came back as 136,808), while a coarse "which ninth of the screen"
/// judgement is reliable enough to be refined by a second pass on a crop.
fn vision_system_prompt(image_w: usize, image_h: usize) -> String {
    let cells = COARSE_COLS * COARSE_ROWS;
    format!(
        "You are Bridge's on-screen companion. The user shared ONE screenshot of their current \
         display ({image_w}x{image_h} pixels) with their question. Answer briefly and concretely \
         (2-5 sentences), in plain prose suitable for being read aloud. \
         A magenta grid has been drawn over the screenshot, dividing it into {COARSE_COLS} \
         columns and {COARSE_ROWS} rows; each cell has its number printed in its top-left corner, \
         from 1 to {cells}. The grid is an aid for you only — it is not part of the user's screen, \
         so never mention it, the numbers, or the magenta lines in your prose. \
         If your answer refers to one specific thing on screen, end your reply with a single tag \
         of the exact form [CELL:<number>:<short label>] giving the printed number of the cell \
         that thing sits in, e.g. [CELL:57:Ask button]. Read the number off the grid rather than \
         estimating it. Use the tag only for something you can actually see, never more than one. \
         Start your reply with exactly one emotion tag on its own line, chosen to match the tone \
         of your answer: [EMOTION:happy], [EMOTION:curious], [EMOTION:concerned], \
         [EMOTION:comforting], [EMOTION:thinking], [EMOTION:celebrating], or [EMOTION:calm]."
    )
}

fn local_system_prompt(frontmost: Option<&str>) -> String {
    let context = frontmost
        .map(|name| format!("The user's frontmost application right now is \"{name}\". "))
        .unwrap_or_default();
    format!(
        "You are Bridge's on-screen companion, answering fully locally. {context}You CANNOT see \
         the user's screen in this mode — say so plainly if the question needs visual context, \
         and answer what you can from the question itself. Keep answers brief (2-5 sentences), \
         plain prose suitable for being read aloud. Do not emit [POINT:...] tags. \
         Start your reply with exactly one emotion tag on its own line: [EMOTION:happy], \
         [EMOTION:curious], [EMOTION:concerned], [EMOTION:comforting], [EMOTION:thinking], \
         [EMOTION:celebrating], or [EMOTION:calm]."
    )
}

pub(crate) fn post_chat(
    url: &str,
    api_key: &str,
    body: serde_json::Value,
) -> Result<String, CompanionError> {
    post_chat_with_timeout(url, api_key, body, HTTP_TIMEOUT)
}

/// Variant with a caller-chosen deadline. The research planner NEEDS short
/// timeouts: a Tauri command that outlives WKWebView's ~60s resource-load
/// deadline answers into a scheme task WebKit has already stopped, which
/// raises an Objective-C exception Rust cannot catch — the process aborts.
pub(crate) fn post_chat_with_timeout(
    url: &str,
    api_key: &str,
    body: serde_json::Value,
    timeout: Duration,
) -> Result<String, CompanionError> {
    let agent = ureq::AgentBuilder::new().timeout(timeout).build();
    let response = agent
        .post(url)
        .set("Authorization", &format!("Bearer {api_key}"))
        .set("Content-Type", "application/json")
        .send_json(body)
        .map_err(|error| match error {
            ureq::Error::Status(status, response) => err(
                "COMPANION_PROVIDER_STATUS",
                format!(
                    "model endpoint returned HTTP {status}: {}",
                    response
                        .into_string()
                        .unwrap_or_default()
                        .chars()
                        .take(400)
                        .collect::<String>()
                ),
            ),
            ureq::Error::Transport(transport) => err(
                "COMPANION_PROVIDER_UNREACHABLE",
                format!("model endpoint unreachable: {transport}"),
            ),
        })?;
    let json: serde_json::Value = response
        .into_json()
        .map_err(|error| err("COMPANION_PROVIDER_SHAPE", error.to_string()))?;
    json.pointer("/choices/0/message/content")
        .and_then(|value| value.as_str())
        .map(|text| text.to_string())
        .ok_or_else(|| {
            err(
                "COMPANION_PROVIDER_SHAPE",
                "model reply had no choices[0].message.content",
            )
        })
}

/// Start-then-poll job state for the screen-aware ask, whose worst case
/// stacks a vision call over capture/TTS work — it must never hold an IPC
/// reply open near WKWebView's ~60s abort deadline (jobs.rs).
#[derive(Default)]
pub struct CompanionAskJobs {
    asks: std::sync::Arc<crate::jobs::JobTable<Result<(usize, AskOutcome), CompanionError>>>,
}

/// Poll envelope for an in-flight ask.
#[derive(Serialize)]
pub struct CompanionAskPoll {
    pub done: bool,
    pub answer: Option<CompanionAnswer>,
}

/// The screen-aware companion ask, start half: validates, then runs the
/// blocking work (capture + HTTP) detached. The answer — and its completion
/// side effects (annotation marks, speech) — are delivered exactly once
/// through `companion_ask_poll`.
#[tauri::command]
pub fn companion_ask_start(
    app: AppHandle,
    window: WebviewWindow,
    jobs: tauri::State<'_, CompanionAskJobs>,
    request: CompanionAskRequest,
) -> Result<u64, CompanionError> {
    let question = request.question.trim().to_string();
    if question.is_empty() {
        return Err(err("COMPANION_EMPTY_QUESTION", "ask a question first"));
    }
    if question.chars().count() > MAX_QUESTION_CHARS {
        return Err(err(
            "COMPANION_QUESTION_TOO_LONG",
            format!("questions are limited to {MAX_QUESTION_CHARS} characters"),
        ));
    }

    // The overlay window's label encodes which monitor it lives on — a
    // thread-safe lookup (commands don't run on the main thread, and
    // monitor enumeration is main-thread territory on macOS).
    let monitor_index = crate::overlay::monitor_index_for_label(window.label());
    let job = jobs
        .asks
        .start()
        .map_err(|message| err("COMPANION_JOBS", message))?;
    let table = jobs.asks.clone();
    let app_for_task = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = run_ask(&app_for_task, monitor_index, request, question)
            .map(|outcome| (monitor_index, outcome));
        table.finish(job, result);
    });
    Ok(job)
}

#[tauri::command]
pub fn companion_ask_poll(
    app: AppHandle,
    jobs: tauri::State<'_, CompanionAskJobs>,
    job: u64,
) -> Result<CompanionAskPoll, CompanionError> {
    match jobs.asks.take(job) {
        crate::jobs::JobPollState::Unknown => Err(err(
            "COMPANION_JOB_UNKNOWN",
            "No such ask job — it may have expired unpolled or already been delivered",
        )),
        crate::jobs::JobPollState::Pending => Ok(CompanionAskPoll {
            done: false,
            answer: None,
        }),
        crate::jobs::JobPollState::Ready(Err(error)) => Err(error),
        crate::jobs::JobPollState::Ready(Ok((monitor_index, outcome))) => {
            // Completion side effects run HERE, on the poll that first observes
            // the finished job — take-once semantics guarantee exactly once.
            if !outcome.marks.is_empty() {
                annotate::show_marks_on(&app, monitor_index, outcome.marks.clone())
                    .map_err(|error| err("COMPANION_ANNOTATE_FAILED", error))?;
                schedule_marks_clear(&app);
            }
            if outcome.answer.spoke {
                speak(&app, &outcome.answer.text);
            }
            Ok(CompanionAskPoll {
                done: true,
                answer: Some(outcome.answer),
            })
        }
    }
}

struct AskOutcome {
    answer: CompanionAnswer,
    marks: Vec<annotate::AnnotationMark>,
}

/// Matches "open <app>" questions and runs the app via macOS `open -a`.
/// Returns Some(AskOutcome) if the question was handled, None otherwise.
const ANNOTATE_LABEL: &str = "annotate";

fn annotate_windows_show(app: &AppHandle) {
    for (_, win) in app.webview_windows() {
        if win.label().starts_with(ANNOTATE_LABEL) {
            let _ = win.show();
        }
    }
}

fn annotate_windows_hide(app: &AppHandle) {
    for (_, win) in app.webview_windows() {
        if win.label().starts_with(ANNOTATE_LABEL) {
            let _ = win.hide();
        }
    }
}

/// Emit a `bridge:chase-pointer` event to show/hide the annotation dot at the given position.
/// Also shows/hides the annotate window (which is hidden by default when no marks are active).
#[tauri::command]
pub fn companion_move_pointer(app: AppHandle, x: f64, y: f64, active: bool, monitor: usize) -> Result<(), CompanionError> {
    if active { annotate_windows_show(&app); }
    app.emit("bridge:chase-pointer", serde_json::json!({ "monitor": monitor, "x": x, "y": y, "active": active }))
        .map_err(|e| err("POINTER_EMIT_FAILED", e.to_string()))?;
    if !active { annotate_windows_hide(&app); }
    Ok(())
}

/// Smoothly move the pointer dot to (x, y) on the given monitor, then hide it after `hide_after_ms`.
/// Shows the annotate window so the dot is actually visible.
fn show_pointer_then_hide(app: &AppHandle, x: f64, y: f64, monitor: usize, hide_after_ms: u64) {
    annotate_windows_show(app);
    let _ = app.emit("bridge:chase-pointer", serde_json::json!({ "monitor": monitor, "x": x, "y": y, "active": true }));
    let app2 = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(hide_after_ms));
        let _ = app2.emit("bridge:chase-pointer", serde_json::json!({ "monitor": 0, "x": 0.0, "y": 0.0, "active": false }));
        annotate_windows_hide(&app2);
    });
}

/// Animate the pointer dot randomly across the screen for `duration_secs` so the user can
/// confirm it is working. Lissajous path (two incommensurate sines) avoids a mechanical oval.
fn start_pointer_demo(app: AppHandle, duration_secs: f64) {
    let (w, h) = monitor_logical_size(&app, 0).unwrap_or((1280.0, 800.0));
    annotate_windows_show(&app);
    std::thread::spawn(move || {
        let deadline = std::time::Instant::now() + Duration::from_secs_f64(duration_secs);
        let mut px = 0.0_f64;
        let mut py = 0.0_f64;
        while std::time::Instant::now() < deadline {
            px += 0.065;
            py += 0.041;
            let x = w * 0.15 + w * 0.70 * (px.sin() * 0.5 + 0.5);
            let y = h * 0.15 + h * 0.60 * (py.sin() * 0.5 + 0.5);
            let _ = app.emit("bridge:chase-pointer", serde_json::json!({ "monitor": 0, "x": x, "y": y, "active": true }));
            std::thread::sleep(Duration::from_millis(40));
        }
        let _ = app.emit("bridge:chase-pointer", serde_json::json!({ "monitor": 0, "x": 0.0, "y": 0.0, "active": false }));
        annotate_windows_hide(&app);
    });
}

/// Animate the pointer across the screen for `duration_secs` (default 15, max 30).
/// Call this to verify the annotation overlay is working — the dot will sweep the screen visibly.
#[tauri::command]
pub fn companion_demo_pointer(app: AppHandle, duration_secs: Option<f64>) -> Result<(), CompanionError> {
    start_pointer_demo(app, duration_secs.unwrap_or(15.0).min(30.0));
    Ok(())
}

fn try_open_app_shortcut(app: &AppHandle, question: &str, speak: bool) -> Option<AskOutcome> {
    let q = question.trim().to_lowercase();

    // "show my pointer" / "demo pointer" / "move your cursor" — visual demo for 15 seconds.
    if q.contains("your pointer") || q.contains("demo pointer") || q.contains("move your cursor")
        || q == "show pointer" || q == "show your pointer" || q == "move pointer"
        || (q.contains("pointer") && q.contains("visible"))
    {
        start_pointer_demo(app.clone(), 15.0);
        return Some(AskOutcome {
            answer: CompanionAnswer {
                text: "Moving my pointer across your screen for 15 seconds!".into(),
                provider: "groq-text",
                screen_shared: false,
                points: 0,
                spoke: speak,
                capture_note: None,
                emotion: Some("celebrating".into()),
            },
            marks: Vec::new(),
        });
    }

    // WhatsApp — show the pointer animating to the dock area, then open the app.
    if q == "open whatsapp" || q == "click whatsapp" || q == "open whatsapp in bridge"
        || (q.contains("whatsapp") && (q.starts_with("open ") || q.starts_with("click ")))
    {
        if let Some((w, h)) = monitor_logical_size(app, 0) {
            // Approximate dock position: centre-bottom of screen, ~80px from edge.
            show_pointer_then_hide(app, w / 2.0, h - 80.0, 0, 2500);
        }
        #[cfg(target_os = "macos")]
        { let _ = Command::new("open").args(["-a", "WhatsApp"]).spawn(); }
        return Some(AskOutcome {
            answer: CompanionAnswer {
                text: "Opening WhatsApp…".into(),
                provider: "groq-text",
                screen_shared: false,
                points: 0,
                spoke: speak,
                capture_note: None,
                emotion: Some("happy".into()),
            },
            marks: Vec::new(),
        });
    }

    let app_name = if q == "open edge" || q == "open microsoft edge" || q.starts_with("open edge ") {
        Some("Microsoft Edge")
    } else if q == "open safari" || q.starts_with("open safari ") {
        Some("Safari")
    } else if q == "open chrome" || q == "open google chrome" || q.starts_with("open chrome ") {
        Some("Google Chrome")
    } else if q == "open firefox" || q.starts_with("open firefox ") {
        Some("Firefox")
    } else {
        None
    }?;
    #[cfg(target_os = "macos")]
    {
        if let Some((w, h)) = monitor_logical_size(app, 0) {
            show_pointer_then_hide(app, w / 2.0, h - 80.0, 0, 2000);
        }
        let _ = Command::new("open").args(["-a", app_name]).spawn();
    }
    Some(AskOutcome {
        answer: CompanionAnswer {
            text: format!("Opening {}…", app_name),
            provider: "groq-text",
            screen_shared: false,
            points: 0,
            spoke: speak,
            capture_note: None,
            emotion: Some("happy".into()),
        },
        marks: Vec::new(),
    })
}

fn run_ask(
    app: &AppHandle,
    monitor_index: usize,
    request: CompanionAskRequest,
    question: String,
) -> Result<AskOutcome, CompanionError> {
    // Fast-path: "open <app>" commands execute locally without a model call.
    if let Some(outcome) = try_open_app_shortcut(app, &question, request.speak) {
        return Ok(outcome);
    }

    let cloud_key = groq_api_key(app);
    let use_cloud_vision = request.share_screen_with_cloud && cloud_key.is_some();

    if use_cloud_vision {
        // Privacy Guard runs BEFORE the capture: a credential surface is
        // never photographed for cloud egress, whatever the consent state.
        if let Some(guarded) = guarded_frontmost_app() {
            return Err(err(
                "COMPANION_PRIVACY_GUARD",
                format!(
                    "{guarded} looks like a password or credential window, so Bridge will not \
                     send a screenshot of it. Switch to another window, or uncheck screen \
                     sharing to ask locally."
                ),
            ));
        }
        let key = cloud_key.expect("checked above");
        let capture = match sensor_bridge::capture_display_jpeg(app, monitor_index) {
            Ok(c) => c,
            Err(error) => {
                if error.code == "SCREEN_PERMISSION_REQUIRED" {
                    // Open System Settings at the Screen Recording page so the
                    // user can grant permission without hunting through menus.
                    let _ = std::process::Command::new("open")
                        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
                        .spawn();
                    return Err(err("COMPANION_NO_SCREEN_PERMISSION", error.message));
                }
                return Err(err("COMPANION_CAPTURE_FAILED", error.message));
            }
        };
        // The answer image carries the drawn coarse grid: the model answers
        // AND reads off a cell number in one call, which keeps a pointing
        // ask at two provider calls (a free tier meters ~2,500 tokens per
        // image against 8,000/minute). `unwrap_or_else`, not `unwrap_or` —
        // the fallback re-decodes and re-encodes the full screenshot, so an
        // eager argument would do that work on every ask for nothing.
        let sent_image = gridded_jpeg(&capture.jpeg_bytes, COARSE_COLS, COARSE_ROWS)
            .unwrap_or_else(|| provider_jpeg(&capture.jpeg_bytes).into_owned());
        eprintln!(
            "[bridge-desktop] companion answer image: {} KiB with {COARSE_COLS}x{COARSE_ROWS} grid",
            sent_image.len() / 1024
        );
        let data_uri = format!(
            "data:image/jpeg;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(&sent_image)
        );
        let mut messages = vec![serde_json::json!({
            "role": "system",
            "content": vision_system_prompt(capture.image_width, capture.image_height),
        })];
        messages.extend(bounded_history(&request.history, &VISION_HISTORY_BUDGET));
        messages.push(serde_json::json!({
            "role": "user",
            "content": [
                { "type": "text", "text": question },
                { "type": "image_url", "image_url": { "url": data_uri } },
            ],
        }));
        // Reasoning models (Qwen3.x) must not spend the token budget on
        // thinking: `reasoning_format: "hidden"` was verified to return
        // EMPTY content (finish=length, all tokens consumed by hidden
        // reasoning). `reasoning_effort: "none"` disables reasoning outright
        // and was verified to answer directly. If a future model rejects the
        // parameter, retry once without it (the client-side think-strip
        // below still guarantees clean output either way).
        let mut body = serde_json::json!({
            "model": vision_model(app),
            "messages": messages,
            "temperature": 0.4,
            "max_tokens": 1024,
            "reasoning_effort": "none",
        });
        let url = format!("{GROQ_BASE_URL}/chat/completions");
        let raw = match post_chat(&url, &key, body.clone()) {
            Ok(raw) => raw,
            Err(error)
                if error.code == "COMPANION_PROVIDER_STATUS"
                    && error.message.contains("reasoning_effort") =>
            {
                body.as_object_mut()
                    .expect("body built as an object above")
                    .remove("reasoning_effort");
                post_chat(&url, &key, body)?
            }
            Err(error) => return Err(error),
        };
        let raw = strip_think_blocks(&raw);
        if raw.trim().is_empty() {
            // Never present an empty answer as success (a reasoning model
            // that burned its budget thinking produces exactly this shape).
            return Err(err(
                "COMPANION_EMPTY_ANSWER",
                "the model returned no visible answer (its token budget was likely consumed \
                 by internal reasoning) — ask again",
            ));
        }
        // Locator stage 1 arrived WITH the answer as a [CELL:..] tag (one
        // provider call instead of two). Stage 2 then refines it on a crop.
        let cell = parse_cell_tag(&raw);
        // Logical size of the captured monitor (main-thread roundtrip).
        // Fallback to image dimensions keeps marks roughly placed on a 1x
        // display even if enumeration hiccups.
        let (logical_w, logical_h) = monitor_logical_size(app, monitor_index)
            .unwrap_or((capture.image_width as f64, capture.image_height as f64));
        let image_w = capture.image_width as f64;
        let image_h = capture.image_height as f64;
        let model_id = vision_model(app);
        let located = cell.as_ref().map(|target| {
            (
                refine_cell(
                    &key,
                    &model_id,
                    &capture.jpeg_bytes,
                    image_w,
                    image_h,
                    target,
                ),
                target.label.clone(),
            )
        });
        let marks = match &located {
            Some((region, label)) => {
                marks_for_box(*region, label, image_w, image_h, logical_w, logical_h)
            }
            // No usable target — draw nothing rather than a confident guess.
            None => Vec::new(),
        };
        // Dev-visible pipeline trace (local stdout only): enough to tell
        // "model emitted no tags" apart from "marks failed to render".
        eprintln!(
            "[bridge-desktop] companion ask: image={image_w}x{image_h} \
             logical={logical_w}x{logical_h} monitor={monitor_index} cell={:?} located={:?} \
             marks={} reply_head={:?}",
            cell.as_ref()
                .map(|target| (target.number, target.label.as_str())),
            located.as_ref().map(|(region, label)| (
                region.x.round(),
                region.y.round(),
                region.width.round(),
                region.height.round(),
                label.as_str()
            )),
            marks.len(),
            raw.chars().take(120).collect::<String>(),
        );
        let (emotion, clean) = strip_emotion_tag(&raw);
        let clean = strip_point_tags(&strip_cell_tags(clean));
        return Ok(AskOutcome {
            answer: CompanionAnswer {
                text: clean,
                provider: "groq-vision",
                screen_shared: true,
                points: usize::from(!marks.is_empty()),
                spoke: request.speak,
                capture_note: None,
                emotion,
            },
            marks,
        });
    }

    // Local path: managed Qwen via the model_supervisor's published endpoint.
    // Text-only, no capture leaves the machine, honest about not seeing the
    // screen. Frontmost-app name is the one lightweight context signal.
    let frontmost = frontmost_app_name();
    let mut messages = vec![serde_json::json!({
        "role": "system",
        "content": local_system_prompt(frontmost.as_deref()),
    })];
    messages.extend(bounded_history(&request.history, &LOCAL_HISTORY_BUDGET));
    messages.push(serde_json::json!({ "role": "user", "content": question }));

    if let Some(endpoint) = local_endpoint(app) {
        let body = serde_json::json!({
            "model": endpoint.model,
            "messages": messages,
            "temperature": 0.4,
            "max_tokens": 700,
        });
        let raw = strip_think_blocks(&post_chat(
            &format!("{}/v1/chat/completions", endpoint.base_url),
            &endpoint.api_key,
            body,
        )?);
        let (emotion, clean) = strip_emotion_tag(&raw);
        return Ok(AskOutcome {
            answer: CompanionAnswer {
                text: strip_point_tags(clean).into(),
                provider: "local-qwen",
                screen_shared: false,
                points: 0,
                spoke: request.speak,
                capture_note: None,
                emotion,
            },
            marks: Vec::new(),
        });
    }

    // GROQ text fallback when the local model is not yet running.
    if let Some(key) = cloud_key {
        let body = serde_json::json!({
            "model": DEFAULT_TEXT_MODEL,
            "messages": messages,
            "temperature": 0.4,
            "max_tokens": 700,
        });
        let url = format!("{GROQ_BASE_URL}/chat/completions");
        let raw = match post_chat(&url, &key, body) {
            Ok(raw) => raw,
            Err(e) => return Err(e),
        };
        let raw = strip_think_blocks(&raw);
        let (emotion, clean) = strip_emotion_tag(&raw);
        return Ok(AskOutcome {
            answer: CompanionAnswer {
                text: strip_point_tags(clean).into(),
                provider: "groq-text",
                screen_shared: false,
                points: 0,
                spoke: request.speak,
                capture_note: None,
                emotion,
            },
            marks: Vec::new(),
        });
    }

    Err(err(
        "COMPANION_NO_MODEL",
        if request.share_screen_with_cloud {
            "no cloud vision key is configured (GROQ_API_KEY) and the managed local model \
             is not running"
        } else {
            "the managed local model is not running yet — install it in Chat, or configure \
             GROQ_API_KEY for cloud answers"
        },
    ))
}

/// Logical (scale-adjusted) size of the monitor at `index`, fetched on the
/// main thread — Tao's monitor enumeration is not safe from worker threads
/// on macOS. Bounded wait; `None` on any failure (callers degrade).
pub(crate) fn monitor_logical_size(app: &AppHandle, index: usize) -> Option<(f64, f64)> {
    let (sender, receiver) = std::sync::mpsc::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let monitors = handle.available_monitors().unwrap_or_default();
        let geometry = monitors.get(index).or_else(|| monitors.first()).map(|m| {
            let scale = m.scale_factor().max(f64::EPSILON);
            (
                m.size().width as f64 / scale,
                m.size().height as f64 / scale,
            )
        });
        let _ = sender.send(geometry);
    })
    .ok()?;
    receiver.recv_timeout(Duration::from_secs(3)).ok().flatten()
}

// ---------------------------------------------------------------------------
// Privacy Guard
// ---------------------------------------------------------------------------
//
// Adapted from clicky-windows' Privacy Guard: never capture a password
// manager or a banking window. Bridge applies it at the EGRESS boundary
// rather than the capture boundary — the local path may still answer, but a
// screenshot of a credential surface never leaves the machine, consent
// checkbox or not. "Govern before executing": a consent tick is permission
// to share the screen, not permission to share a vault.

/// Bundle identifiers whose windows must never be sent to a cloud provider.
const GUARDED_BUNDLE_IDS: &[&str] = &[
    "com.1password.1password",
    "com.1password.7",
    "com.agilebits.onepassword",
    "com.agilebits.onepassword7",
    "com.bitwarden.desktop",
    "org.keepassxc.keepassxc",
    "com.lastpass.lastpassmacdesktop",
    "com.apple.keychainaccess",
    "in.sinew.Enpass-Desktop",
    "com.dashlane.dashlanephonefinal",
    "com.apple.Passwords",
];

/// Substrings in an app's visible name that indicate a credential surface.
const GUARDED_NAME_FRAGMENTS: &[&str] = &[
    "1password",
    "bitwarden",
    "keepass",
    "lastpass",
    "dashlane",
    "enpass",
    "keychain access",
    "passwords",
    "authenticator",
];

/// True when the frontmost application is a credential surface.
pub fn is_guarded_app(name: &str, bundle_id: &str) -> bool {
    let bundle = bundle_id.to_ascii_lowercase();
    if GUARDED_BUNDLE_IDS
        .iter()
        .any(|guarded| bundle == guarded.to_ascii_lowercase())
    {
        return true;
    }
    let name = name.to_ascii_lowercase();
    GUARDED_NAME_FRAGMENTS
        .iter()
        .any(|fragment| name.contains(fragment))
}

pub(crate) fn guarded_frontmost_app() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        let (name, bundle_id) = crate::providers::apps::frontmost_app_once()?;
        is_guarded_app(&name, &bundle_id).then_some(name)
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

fn frontmost_app_name() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        crate::providers::apps::frontmost_app_once().map(|(name, _bundle)| name)
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

pub(crate) fn schedule_marks_clear(app: &AppHandle) {
    let state = app.state::<CompanionState>();
    let generation = {
        let Ok(mut guard) = state.marks_generation.lock() else {
            return;
        };
        *guard = guard.saturating_add(1);
        *guard
    };
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(MARKS_AUTO_CLEAR);
        let still_current = app
            .state::<CompanionState>()
            .marks_generation
            .lock()
            .map(|current| *current == generation)
            .unwrap_or(false);
        if !still_current {
            return;
        }
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Err(error) = annotate::annotate_clear(handle.clone()) {
                eprintln!(
                    "[bridge-desktop] companion auto-clear failed: {}",
                    error.message
                );
            }
        });
    });
}

// ---------------------------------------------------------------------------
// Local TTS (macOS `say`)
// ---------------------------------------------------------------------------

fn speak(app: &AppHandle, text: &str) {
    #[cfg(target_os = "macos")]
    {
        let state = app.state::<CompanionState>();
        let Ok(mut guard) = state.speech_child.lock() else {
            return;
        };
        if let Some(mut previous) = guard.take() {
            let _ = previous.kill();
            let _ = previous.wait();
        }
        // Text goes over stdin — never argv — so answer content can't be
        // interpreted as `say` flags.
        match Command::new("/usr/bin/say")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(mut child) => {
                if let Some(stdin) = child.stdin.take() {
                    let mut stdin = stdin;
                    let _ = stdin.write_all(text.as_bytes());
                }
                *guard = Some(child);
            }
            Err(error) => {
                eprintln!("[bridge-desktop] companion TTS failed to start: {error}");
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, text);
    }
}

#[tauri::command]
pub fn companion_speak(app: AppHandle, text: String) -> Result<(), CompanionError> {
    if text.trim().is_empty() {
        return Err(err("COMPANION_EMPTY_SPEECH", "nothing to speak"));
    }
    if !cfg!(target_os = "macos") {
        return Err(err(
            "COMPANION_TTS_UNSUPPORTED",
            "local text-to-speech is only implemented on macOS in this slice",
        ));
    }
    speak(&app, &text);
    Ok(())
}

#[tauri::command]
pub fn companion_stop_speaking(state: State<'_, CompanionState>) -> Result<(), CompanionError> {
    let Ok(mut guard) = state.speech_child.lock() else {
        return Err(err("COMPANION_STATE", "speech state unavailable"));
    };
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

/// Open a macOS System Settings privacy panel (e.g. `Privacy_ScreenCapture`,
/// `Privacy_Microphone`). No-op on non-macOS.
#[tauri::command]
pub fn open_privacy_settings(section: String) -> Result<(), CompanionError> {
    #[cfg(target_os = "macos")]
    {
        let url = format!(
            "x-apple.systempreferences:com.apple.preference.security?{}",
            section
        );
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| err("OPEN_SETTINGS_FAILED", e.to_string()))?;
    }
    #[cfg(not(target_os = "macos"))]
    let _ = section;
    Ok(())
}

pub fn shutdown(state: &CompanionState) {
    if let Ok(mut guard) = state.speech_child.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

// ---------------------------------------------------------------------------
// Cloud STT (push-to-talk transcription)
// ---------------------------------------------------------------------------

/// Build a multipart/form-data body for the transcription request. Split out
/// for testability.
pub fn build_transcribe_multipart(
    boundary: &str,
    model: &str,
    filename: &str,
    content_type: &str,
    audio: &[u8],
) -> Vec<u8> {
    let mut body = Vec::with_capacity(audio.len() + 512);
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(b"Content-Disposition: form-data; name=\"model\"\r\n\r\n");
    body.extend_from_slice(format!("{model}\r\n").as_bytes());
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        format!("Content-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n")
            .as_bytes(),
    );
    body.extend_from_slice(format!("Content-Type: {content_type}\r\n\r\n").as_bytes());
    body.extend_from_slice(audio);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    body
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionTranscribeRequest {
    /// Base64 audio recorded in the overlay webview WHILE the push-to-talk
    /// control was held. Sent to the cloud STT provider only because the user
    /// chose the voice path with cloud voice enabled.
    pub audio_base64: String,
    pub mime: String,
}

#[tauri::command]
pub async fn companion_transcribe(
    app: AppHandle,
    request: CompanionTranscribeRequest,
) -> Result<String, CompanionError> {
    let key = groq_api_key(&app).ok_or_else(|| {
        err(
            "COMPANION_NO_STT",
            "voice transcription needs GROQ_API_KEY; type your question instead",
        )
    })?;
    let audio = base64::engine::general_purpose::STANDARD
        .decode(request.audio_base64.as_bytes())
        .map_err(|error| err("COMPANION_BAD_AUDIO", error.to_string()))?;
    if audio.is_empty() {
        return Err(err("COMPANION_BAD_AUDIO", "empty recording"));
    }
    if audio.len() > 24 * 1024 * 1024 {
        return Err(err("COMPANION_BAD_AUDIO", "recording too large"));
    }
    let extension = match request.mime.as_str() {
        "audio/mp4" | "audio/x-m4a" | "audio/aac" => "m4a",
        "audio/webm" => "webm",
        "audio/ogg" => "ogg",
        "audio/wav" | "audio/x-wav" => "wav",
        other => {
            return Err(err(
                "COMPANION_BAD_AUDIO",
                format!("unsupported recording format {other}"),
            ))
        }
    };
    let mime = request.mime.clone();
    let text = tauri::async_runtime::spawn_blocking(move || {
        let mut boundary_bytes = [0_u8; 16];
        getrandom::fill(&mut boundary_bytes)
            .map_err(|error| err("COMPANION_STT_FAILED", error.to_string()))?;
        let boundary: String = boundary_bytes
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        let boundary = format!("bridge-companion-{boundary}");
        let body = build_transcribe_multipart(
            &boundary,
            DEFAULT_STT_MODEL,
            &format!("audio.{extension}"),
            &mime,
            &audio,
        );
        let agent = ureq::AgentBuilder::new().timeout(HTTP_TIMEOUT).build();
        let response = agent
            .post(&format!("{GROQ_BASE_URL}/audio/transcriptions"))
            .set("Authorization", &format!("Bearer {key}"))
            .set(
                "Content-Type",
                &format!("multipart/form-data; boundary={boundary}"),
            )
            .send_bytes(&body)
            .map_err(|error| err("COMPANION_STT_FAILED", error.to_string()))?;
        let json: serde_json::Value = response
            .into_json()
            .map_err(|error| err("COMPANION_STT_FAILED", error.to_string()))?;
        json.get("text")
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .ok_or_else(|| err("COMPANION_STT_FAILED", "transcription reply had no text"))
    })
    .await
    .map_err(|error| err("COMPANION_TASK_FAILED", error.to_string()))??;
    Ok(text)
}

// ---------------------------------------------------------------------------
// Tests — pure logic only
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_well_formed_point_tags() {
        let points =
            parse_point_tags("Click there [POINT:512,300:Save button] then [POINT:10,20:Menu].");
        assert_eq!(points.len(), 2);
        assert_eq!(points[0].x, 512.0);
        assert_eq!(points[0].y, 300.0);
        assert_eq!(points[0].label, "Save button");
        assert_eq!(points[1].label, "Menu");
    }

    #[test]
    fn skips_malformed_tags_and_bounds_count() {
        assert!(parse_point_tags("[POINT:abc,def:bad]").is_empty());
        assert!(parse_point_tags("[POINT:-5,10:negative]").is_empty());
        let many: String = (0..9).map(|i| format!("[POINT:{i},{i}:p{i}]")).collect();
        assert_eq!(parse_point_tags(&many).len(), MAX_POINTS);
    }

    #[test]
    fn label_is_bounded_plain_text() {
        let long = "x".repeat(200);
        let points = parse_point_tags(&format!("[POINT:1,2:{long}]"));
        assert_eq!(points[0].label.len(), 60);
        let sneaky = parse_point_tags("[POINT:1,2:line\nbreak\ttab]");
        assert_eq!(sneaky[0].label, "linebreaktab");
    }

    #[test]
    fn strips_reasoning_think_blocks() {
        assert_eq!(
            strip_think_blocks("<think>secret reasoning</think>The answer is 4."),
            "The answer is 4."
        );
        assert_eq!(
            strip_think_blocks("a <think>x</think>b<think>y</think> c"),
            "a b c"
        );
        // Unclosed think never leaks reasoning into the visible answer.
        assert_eq!(strip_think_blocks("visible <think>never closed"), "visible");
        assert_eq!(strip_think_blocks("no tags"), "no tags");
        // Point tags inside think are discarded with the reasoning — only
        // final-answer points may become marks.
        let cleaned = strip_think_blocks("<think>[POINT:1,2:hidden]</think>Done [POINT:3,4:real]");
        assert_eq!(parse_point_tags(&cleaned).len(), 1);
        assert_eq!(parse_point_tags(&cleaned)[0].label, "real");
    }

    #[test]
    fn strip_removes_tags_and_collapses_whitespace() {
        assert_eq!(
            strip_point_tags("Click the  [POINT:512,300:Save button] icon."),
            "Click the icon."
        );
        assert_eq!(strip_point_tags("no tags here"), "no tags here");
        // Unclosed tag: everything from the tag on is dropped rather than
        // leaking a half-tag into speech.
        assert_eq!(strip_point_tags("before [POINT:1,2:oops"), "before");
    }

    #[test]
    fn maps_retina_image_coordinates_to_logical_space() {
        // 2x display: 2880x1800 image, 1440x900 logical.
        let (lx, ly) =
            map_image_point_to_logical(1440.0, 900.0, 2880.0, 1800.0, 1440.0, 900.0).unwrap();
        assert_eq!((lx, ly), (720.0, 450.0));
        // Out-of-range input clamps instead of leaving the monitor.
        let (cx, _) =
            map_image_point_to_logical(99_999.0, 0.0, 2880.0, 1800.0, 1440.0, 900.0).unwrap();
        assert_eq!(cx, 1440.0);
        assert!(map_image_point_to_logical(1.0, 1.0, 0.0, 1800.0, 1440.0, 900.0).is_none());
    }

    #[test]
    fn located_box_marks_stay_within_annotate_bounds() {
        // A stage-2 cell of a 2880x1800 capture, on a 1440x900 logical screen.
        let region = LocatedBox {
            x: 1920.0,
            y: 1200.0,
            width: 320.0,
            height: 200.0,
        };
        let marks = marks_for_box(region, "Save button", 2880.0, 1800.0, 1440.0, 900.0);
        assert_eq!(marks.len(), 2); // spotlight + callout, well under MAX_MARKS
        for mark in &marks {
            assert!(mark.x >= 0.0 && mark.y >= 0.0);
            assert!(mark.x + mark.width <= 1440.0 + 1.0);
            assert!(mark.width > 0.0 && mark.height > 0.0);
            if let Some(label) = &mark.label {
                assert!(label.len() <= 120);
            }
        }
        // Spotlight is centred on the region's centre (2080,1300 image →
        // 1040,650 logical).
        let spotlight = &marks[0];
        assert!((spotlight.x + spotlight.width / 2.0 - 1040.0).abs() < 0.5);
        assert!((spotlight.y + spotlight.height / 2.0 - 650.0).abs() < 0.5);
    }

    #[test]
    fn a_coarse_region_draws_a_bigger_ring_than_a_refined_one() {
        let coarse = marks_for_box(
            LocatedBox {
                x: 0.0,
                y: 0.0,
                width: 960.0,
                height: 600.0,
            },
            "x",
            2880.0,
            1800.0,
            1440.0,
            900.0,
        );
        let refined = marks_for_box(
            LocatedBox {
                x: 0.0,
                y: 0.0,
                width: 320.0,
                height: 200.0,
            },
            "x",
            2880.0,
            1800.0,
            1440.0,
            900.0,
        );
        assert!(coarse[0].width > refined[0].width);
    }

    #[test]
    fn numbered_cells_tile_the_image_and_padding_stays_in_bounds() {
        let full = LocatedBox {
            x: 0.0,
            y: 0.0,
            width: 1200.0,
            height: 800.0,
        };
        // 12x8 grid: cell 1 is top-left, 96 is bottom-right, 13 starts row 2.
        assert_eq!(
            numbered_cell_box(full, 12, 8, 1),
            Some(LocatedBox {
                x: 0.0,
                y: 0.0,
                width: 100.0,
                height: 100.0
            })
        );
        assert_eq!(
            numbered_cell_box(full, 12, 8, 13),
            Some(LocatedBox {
                x: 0.0,
                y: 100.0,
                width: 100.0,
                height: 100.0
            })
        );
        assert_eq!(
            numbered_cell_box(full, 12, 8, 96),
            Some(LocatedBox {
                x: 1100.0,
                y: 700.0,
                width: 100.0,
                height: 100.0
            })
        );
        assert_eq!(numbered_cell_box(full, 12, 8, 0), None);
        assert_eq!(numbered_cell_box(full, 12, 8, 97), None);

        // Padding never escapes the image on any edge.
        let padded = padded_box(
            numbered_cell_box(full, 12, 8, 1).unwrap(),
            1200.0,
            800.0,
            0.6,
        );
        assert!(padded.x >= 0.0 && padded.y >= 0.0);
        let far = padded_box(
            numbered_cell_box(full, 12, 8, 96).unwrap(),
            1200.0,
            800.0,
            0.6,
        );
        assert!(far.x + far.width <= 1200.0);
        assert!(far.y + far.height <= 800.0);
    }

    #[test]
    fn cell_numbers_parse_from_real_replies_and_reject_out_of_range() {
        assert_eq!(parse_cell_number("57", 12, 8), Some(57));
        assert_eq!(parse_cell_number("Cell **57**.", 12, 8), Some(57));
        assert_eq!(parse_cell_number("NONE", 12, 8), None);
        assert_eq!(parse_cell_number("0", 12, 8), None);
        assert_eq!(parse_cell_number("97", 12, 8), None);
        // Out-of-range leading number is skipped, a valid one still found.
        assert_eq!(parse_cell_number("not 400 but 12", 12, 8), Some(12));
        assert_eq!(parse_cell_number("36", 6, 6), Some(36));
        assert_eq!(parse_cell_number("37", 6, 6), None);
    }

    #[test]
    fn cell_tag_carries_the_printed_number_and_label() {
        let target = parse_cell_tag("Click there. [CELL:57:Ask button]").unwrap();
        assert_eq!(target.number, 57);
        assert_eq!(target.label, "Ask button");
        assert!(parse_cell_tag("no tag here").is_none());
        assert!(parse_cell_tag("[CELL:999:out of range]").is_none());
        assert_eq!(
            strip_cell_tags("Click there. [CELL:57:Ask button]"),
            "Click there."
        );
    }

    #[test]
    fn privacy_guard_matches_credential_surfaces_only() {
        assert!(is_guarded_app("1Password", "com.1password.1password"));
        assert!(is_guarded_app("Bitwarden", "com.bitwarden.desktop"));
        assert!(is_guarded_app(
            "Keychain Access",
            "com.apple.keychainaccess"
        ));
        // Name match alone is enough — a browser-hosted vault has no vault bundle id.
        assert!(is_guarded_app("Bitwarden - Chrome", "com.google.Chrome"));
        assert!(is_guarded_app("Authenticator", "com.example.unknown"));
        // Ordinary apps are not guarded.
        assert!(!is_guarded_app("Safari", "com.apple.Safari"));
        assert!(!is_guarded_app("Finder", "com.apple.finder"));
        assert!(!is_guarded_app("Bridge", "ai.bridge.desktop"));
    }

    #[test]
    fn drawn_grid_labels_stay_inside_the_image() {
        // A tiny image must not panic or write out of bounds when labelled.
        let mut image = image::RgbImage::new(64, 48);
        draw_numbered_grid(&mut image, 12, 8);
        assert_eq!(image.dimensions(), (64, 48));
        // Some grid pixels were actually painted.
        assert!(image.pixels().any(|pixel| pixel.0 == GRID_LINE));
    }

    #[test]
    fn history_is_bounded_and_role_filtered() {
        let mut history: Vec<HistoryTurn> = (0..30)
            .map(|i| HistoryTurn {
                role: if i % 2 == 0 { "user" } else { "assistant" }.to_string(),
                content: format!("turn {i}"),
                screen_derived: false,
            })
            .collect();
        history.push(HistoryTurn {
            role: "system".to_string(),
            content: "injected".to_string(),
            screen_derived: false,
        });
        let bounded = bounded_history(&history, &LOCAL_HISTORY_BUDGET);
        assert!(bounded.len() <= MAX_HISTORY_TURNS);
        assert!(bounded
            .iter()
            .all(|turn| turn["role"] == "user" || turn["role"] == "assistant"));
        // The role filter runs BEFORE the take: the injected `system` turn is
        // ignored, not allowed to shrink the usable window. With 30 valid
        // turns available, the window must be FULL.
        assert_eq!(bounded.len(), MAX_HISTORY_TURNS);
        // Newest-first selection, oldest dropped: the last valid turn survives.
        assert_eq!(bounded.last().unwrap()["content"], "turn 29");
    }

    #[test]
    fn history_total_char_budget_drops_oldest_first() {
        let history: Vec<HistoryTurn> = (0..6)
            .map(|i| HistoryTurn {
                role: if i % 2 == 0 { "user" } else { "assistant" }.to_string(),
                // 2,000 chars each: under the vision per-turn cap of 800 they
                // truncate to 800, so the 4,800 total budget fits exactly 6 —
                // but at full length the LOCAL budget (8,000) fits only 4.
                content: "x".repeat(2_000),
                screen_derived: i % 2 == 1,
            })
            .collect();
        let local = bounded_history(&history, &LOCAL_HISTORY_BUDGET);
        assert_eq!(local.len(), 4, "8,000-char budget holds four 2,000-char turns");
        let vision = bounded_history(&history, &VISION_HISTORY_BUDGET);
        assert_eq!(vision.len(), 6, "800-char truncation lets all six fit in 4,800");
        assert!(vision
            .iter()
            .all(|turn| turn["content"].as_str().unwrap().chars().count() <= 800));
    }

    #[test]
    fn history_turn_screen_derived_defaults_false_on_deserialize() {
        let turn: HistoryTurn =
            serde_json::from_str(r#"{"role":"assistant","content":"hi"}"#).unwrap();
        assert!(!turn.screen_derived);
        let tagged: HistoryTurn = serde_json::from_str(
            r#"{"role":"assistant","content":"hi","screenDerived":true}"#,
        )
        .unwrap();
        assert!(tagged.screen_derived);
    }

    #[test]
    fn transcribe_multipart_is_well_formed() {
        let body = build_transcribe_multipart("BOUND", "whisper", "a.m4a", "audio/mp4", b"AUDIO");
        let text = String::from_utf8_lossy(&body);
        assert!(text.starts_with("--BOUND\r\n"));
        assert!(text.contains("name=\"model\"\r\n\r\nwhisper\r\n"));
        assert!(text.contains("filename=\"a.m4a\""));
        assert!(text.contains("Content-Type: audio/mp4\r\n\r\nAUDIO"));
        assert!(text.ends_with("\r\n--BOUND--\r\n"));
    }
}

#[cfg(test)]
mod grid_preview {
    use super::*;

    /// Writes a gridded sample next to the source image so the overlay can be
    /// eyeballed. Ignored by default: needs BRIDGE_GRID_PREVIEW_IN/OUT.
    #[test]
    #[ignore]
    fn render_grid_preview() {
        let (Ok(input), Ok(output)) = (
            std::env::var("BRIDGE_GRID_PREVIEW_IN"),
            std::env::var("BRIDGE_GRID_PREVIEW_OUT"),
        ) else {
            return;
        };
        let bytes = std::fs::read(input).expect("preview input readable");
        let gridded = gridded_jpeg(&bytes, COARSE_COLS, COARSE_ROWS).expect("grid renders");
        std::fs::write(output, gridded).expect("preview output writable");
    }
}
