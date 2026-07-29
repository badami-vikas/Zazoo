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
use tauri::{AppHandle, Manager, State, WebviewWindow};

pub const COMPANION_PTT_EVENT: &str = "bridge:companion-ptt";

const GROQ_BASE_URL: &str = "https://api.groq.com/openai/v1";
/// Vision-capable Groq model for the screen-aware path. Overridable so a
/// deprecated model id never requires a rebuild.
const DEFAULT_VISION_MODEL: &str = "meta-llama/llama-4-scout-17b-16e-instruct";
const DEFAULT_STT_MODEL: &str = "whisper-large-v3-turbo";
const MAX_POINTS: usize = 5;
const MAX_HISTORY_TURNS: usize = 10;
const MAX_QUESTION_CHARS: usize = 4_000;
const MARKS_AUTO_CLEAR: Duration = Duration::from_secs(12);
const HTTP_TIMEOUT: Duration = Duration::from_secs(90);

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

fn groq_api_key(app: &AppHandle) -> Option<String> {
    std::env::var("GROQ_API_KEY")
        .ok()
        .filter(|key| !key.trim().is_empty())
        .or_else(|| load_config(app).groq_api_key.filter(|k| !k.trim().is_empty()))
}

fn vision_model(app: &AppHandle) -> String {
    std::env::var("BRIDGE_COMPANION_VISION_MODEL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| load_config(app).vision_model)
        .unwrap_or_else(|| DEFAULT_VISION_MODEL.to_string())
}

/// Resolve the managed local model endpoint published by model_supervisor
/// (`{runtime_dir}/endpoint.json`). Same Local Plane directory resolution as
/// lib.rs — env override first, then app-data default.
fn local_endpoint(app: &AppHandle) -> Option<LocalEndpoint> {
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
struct LocalEndpoint {
    base_url: String,
    api_key: String,
    model: String,
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
        let (Ok(x), Ok(y)) = (
            raw_x.trim().parse::<f64>(),
            raw_y.trim().parse::<f64>(),
        ) else {
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
    let cleaned: String = label
        .chars()
        .filter(|c| !c.is_control())
        .take(60)
        .collect();
    cleaned.trim().to_string()
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

/// Build the typed marks for a set of parsed points: a spotlight ring on the
/// target plus a callout with the model's (bounded, plain-text) label. Stays
/// within annotate.rs's MAX_MARKS (5 points × 2 marks ≤ 12).
pub fn marks_for_points(
    points: &[ParsedPoint],
    image_w: f64,
    image_h: f64,
    logical_w: f64,
    logical_h: f64,
) -> Vec<annotate::AnnotationMark> {
    let mut marks = Vec::new();
    for point in points.iter().take(MAX_POINTS) {
        let Some((lx, ly)) =
            map_image_point_to_logical(point.x, point.y, image_w, image_h, logical_w, logical_h)
        else {
            continue;
        };
        marks.push(annotate::AnnotationMark {
            kind: annotate::MarkKind::Spotlight,
            x: lx - 26.0,
            y: ly - 26.0,
            width: 52.0,
            height: 52.0,
            label: None,
        });
        if !point.label.is_empty() {
            let width = (point.label.len() as f64 * 7.5 + 20.0).clamp(60.0, 320.0);
            // Keep the callout on-screen: below the point when room, above
            // otherwise; clamped horizontally.
            let cy = if ly + 44.0 + 28.0 <= logical_h {
                ly + 44.0
            } else {
                (ly - 44.0 - 28.0).max(0.0)
            };
            let cx = (lx - width / 2.0).clamp(0.0, (logical_w - width).max(0.0));
            marks.push(annotate::AnnotationMark {
                kind: annotate::MarkKind::Callout,
                x: cx,
                y: cy,
                width,
                height: 28.0,
                label: Some(point.label.clone()),
            });
        }
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
}

fn bounded_history(history: &[HistoryTurn]) -> Vec<serde_json::Value> {
    history
        .iter()
        .rev()
        .take(MAX_HISTORY_TURNS)
        .rev()
        .filter(|turn| matches!(turn.role.as_str(), "user" | "assistant"))
        .map(|turn| {
            serde_json::json!({
                "role": turn.role,
                "content": turn.content.chars().take(2_000).collect::<String>(),
            })
        })
        .collect()
}

fn vision_system_prompt(image_w: usize, image_h: usize) -> String {
    format!(
        "You are Bridge's on-screen companion. The user shared ONE screenshot of their current \
         display ({image_w}x{image_h} pixels) with their question. Answer briefly and concretely \
         (2-5 sentences), in plain prose suitable for being read aloud. When you refer to a \
         specific place on the screen, append a tag of the exact form [POINT:x,y:label] where x,y \
         are pixel coordinates in the screenshot and label is a short name for what is there \
         (e.g. [POINT:512,300:Save button]). Use at most {MAX_POINTS} point tags, only for \
         locations you can actually see. Never invent coordinates."
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
         plain prose suitable for being read aloud. Do not emit [POINT:...] tags."
    )
}

fn post_chat(
    url: &str,
    api_key: &str,
    body: serde_json::Value,
) -> Result<String, CompanionError> {
    let agent = ureq::AgentBuilder::new().timeout(HTTP_TIMEOUT).build();
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

/// The screen-aware companion ask. Runs blocking work (capture + HTTP) off
/// the main thread via the async command runtime.
#[tauri::command]
pub async fn companion_ask(
    app: AppHandle,
    window: WebviewWindow,
    request: CompanionAskRequest,
) -> Result<CompanionAnswer, CompanionError> {
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
    // thread-safe lookup (async commands don't run on the main thread, and
    // monitor enumeration is main-thread territory on macOS).
    let monitor_index = crate::overlay::monitor_index_for_label(window.label());
    let app_for_task = app.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        run_ask(&app_for_task, monitor_index, request, question)
    })
    .await
    .map_err(|error| err("COMPANION_TASK_FAILED", error.to_string()))??;

    // Show marks + schedule auto-clear from the command context (main-thread
    // friendly Tauri handle operations).
    if !outcome.marks.is_empty() {
        annotate::show_marks_on(&app, monitor_index, outcome.marks.clone())
            .map_err(|error| err("COMPANION_ANNOTATE_FAILED", error))?;
        schedule_marks_clear(&app);
    }
    if outcome.answer.spoke {
        speak(&app, &outcome.answer.text);
    }
    Ok(outcome.answer)
}

struct AskOutcome {
    answer: CompanionAnswer,
    marks: Vec<annotate::AnnotationMark>,
}

fn run_ask(
    app: &AppHandle,
    monitor_index: usize,
    request: CompanionAskRequest,
    question: String,
) -> Result<AskOutcome, CompanionError> {
    let cloud_key = groq_api_key(app);
    let use_cloud_vision = request.share_screen_with_cloud && cloud_key.is_some();

    if use_cloud_vision {
        let key = cloud_key.expect("checked above");
        let capture = sensor_bridge::capture_display_jpeg(app, monitor_index)
            .map_err(|error| err("COMPANION_CAPTURE_FAILED", error))?;
        let capture_note = (!capture.permission_granted).then(|| {
            "Screen Recording permission is not granted, so the screenshot may not include \
             window contents (System Settings > Privacy & Security > Screen Recording)."
                .to_string()
        });
        let data_uri = format!(
            "data:image/jpeg;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(&capture.jpeg_bytes)
        );
        let mut messages = vec![serde_json::json!({
            "role": "system",
            "content": vision_system_prompt(capture.image_width, capture.image_height),
        })];
        messages.extend(bounded_history(&request.history));
        messages.push(serde_json::json!({
            "role": "user",
            "content": [
                { "type": "text", "text": question },
                { "type": "image_url", "image_url": { "url": data_uri } },
            ],
        }));
        let body = serde_json::json!({
            "model": vision_model(app),
            "messages": messages,
            "temperature": 0.4,
            "max_tokens": 700,
        });
        let raw = post_chat(&format!("{GROQ_BASE_URL}/chat/completions"), &key, body)?;
        let points = parse_point_tags(&raw);
        // Logical size of the captured monitor (main-thread roundtrip).
        // Fallback to image dimensions keeps marks roughly placed on a 1x
        // display even if enumeration hiccups.
        let (logical_w, logical_h) = monitor_logical_size(app, monitor_index)
            .unwrap_or((capture.image_width as f64, capture.image_height as f64));
        let marks = marks_for_points(
            &points,
            capture.image_width as f64,
            capture.image_height as f64,
            logical_w,
            logical_h,
        );
        return Ok(AskOutcome {
            answer: CompanionAnswer {
                text: strip_point_tags(&raw),
                provider: "groq-vision",
                screen_shared: true,
                points: points.len(),
                spoke: request.speak,
                capture_note,
            },
            marks,
        });
    }

    // Local path: managed Qwen via the model_supervisor's published endpoint.
    // Text-only, no capture leaves the machine, honest about not seeing the
    // screen. Frontmost-app name is the one lightweight context signal.
    let endpoint = local_endpoint(app).ok_or_else(|| {
        err(
            "COMPANION_NO_MODEL",
            if request.share_screen_with_cloud {
                "no cloud vision key is configured (GROQ_API_KEY) and the managed local model \
                 is not running"
            } else {
                "the managed local model is not running yet — wait for Bridge's model runtime \
                 to finish starting, or configure GROQ_API_KEY for cloud answers"
            },
        )
    })?;
    let frontmost = frontmost_app_name();
    let mut messages = vec![serde_json::json!({
        "role": "system",
        "content": local_system_prompt(frontmost.as_deref()),
    })];
    messages.extend(bounded_history(&request.history));
    messages.push(serde_json::json!({ "role": "user", "content": question }));
    let body = serde_json::json!({
        "model": endpoint.model,
        "messages": messages,
        "temperature": 0.4,
        "max_tokens": 700,
    });
    let raw = post_chat(
        &format!("{}/v1/chat/completions", endpoint.base_url),
        &endpoint.api_key,
        body,
    )?;
    Ok(AskOutcome {
        answer: CompanionAnswer {
            text: strip_point_tags(&raw),
            provider: "local-qwen",
            screen_shared: false,
            points: 0,
            spoke: request.speak,
            capture_note: None,
        },
        marks: Vec::new(),
    })
}

/// Logical (scale-adjusted) size of the monitor at `index`, fetched on the
/// main thread — Tao's monitor enumeration is not safe from worker threads
/// on macOS. Bounded wait; `None` on any failure (callers degrade).
fn monitor_logical_size(app: &AppHandle, index: usize) -> Option<(f64, f64)> {
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

fn schedule_marks_clear(app: &AppHandle) {
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
        match Command::new("say")
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
        let many: String = (0..9)
            .map(|i| format!("[POINT:{i},{i}:p{i}]"))
            .collect();
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
    fn marks_stay_within_annotate_bounds() {
        let points: Vec<ParsedPoint> = (0..MAX_POINTS)
            .map(|i| ParsedPoint {
                x: 100.0 * i as f64,
                y: 100.0,
                label: format!("target {i}"),
            })
            .collect();
        let marks = marks_for_points(&points, 2880.0, 1800.0, 1440.0, 900.0);
        // 5 spotlights + 5 callouts = 10 ≤ annotate MAX_MARKS (12).
        assert_eq!(marks.len(), 10);
        for mark in &marks {
            assert!(mark.x >= -30.0 && mark.y >= -30.0);
            assert!(mark.width > 0.0 && mark.height > 0.0);
        }
    }

    #[test]
    fn history_is_bounded_and_role_filtered() {
        let mut history: Vec<HistoryTurn> = (0..30)
            .map(|i| HistoryTurn {
                role: if i % 2 == 0 { "user" } else { "assistant" }.to_string(),
                content: format!("turn {i}"),
            })
            .collect();
        history.push(HistoryTurn {
            role: "system".to_string(),
            content: "injected".to_string(),
        });
        let bounded = bounded_history(&history);
        assert!(bounded.len() <= MAX_HISTORY_TURNS);
        assert!(bounded
            .iter()
            .all(|turn| turn["role"] == "user" || turn["role"] == "assistant"));
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
