//! act — "do it for me": the companion looks at the screen, decides ONE next
//! action, performs it with its own hands (`actuator.rs`: the real pointer
//! glides, clicks, types), looks again, and repeats until the task is done,
//! refused, stopped, or bounded. Hey Clicky's computer-use loop, on Bridge's
//! governed surfaces.
//!
//! Every step reuses what the ask pipeline already has: the consented
//! `capture_display_jpeg`, the drawn-grid locator (`gridded_jpeg` +
//! `refine_cell`) that brought pointing to ~12 px, the typed spotlight
//! marks, and the Groq vision model. What is new is only the planner prompt
//! (one JSON action per screenshot) and the hands.
//!
//! Govern before executing — the invariants this file owns:
//! - `allow_control` must be true on the request. It is set only from the
//!   panel's explicit "let {name} use my mouse and keyboard" control, and it
//!   defaults false everywhere. A run without it never posts an event.
//! - Accessibility must be granted (fail closed, `ACT_NO_ACCESSIBILITY`).
//! - The Privacy Guard runs before EVERY capture: a credential-looking
//!   frontmost window halts the run, whatever consent says.
//! - The planner's vocabulary is a closed enum. It can name a key only from
//!   `actuator::Key::parse`'s allowlist, type at most `MAX_TYPE_CHARS`, and
//!   cannot express "delete", "pay", or "quit" as an action at all.
//! - Bounded: `MAX_STEPS` steps and `MAX_WALL` seconds, then an honest
//!   `bounded` outcome.
//! - The user's hand wins: a moved mouse mid-glide (`Takeover`) or the
//!   panel's Stop halts the run within one tick.
//! - Every step is emitted as `bridge:act-step` so the panel narrates what
//!   the hands are doing while they do it. Nothing runs silently.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use crate::actuator::{self, ActuatorError, Key, MouseButton};
use crate::companion::{
    self, gridded_jpeg, guarded_frontmost_app, groq_api_key, post_chat,
    refine_cell, schedule_marks_clear, strip_think_blocks, vision_model, CellTarget,
    CompanionError, COARSE_COLS, COARSE_ROWS, GROQ_BASE_URL,
};
use crate::{annotate, overlay, sensor_bridge};

const MAX_TASK_CHARS: usize = 400;
const MAX_TYPE_CHARS: usize = 500;
const MAX_STEPS: usize = 15;
const MAX_WALL: Duration = Duration::from_secs(150);
/// Let the UI settle after an action before the next look.
const SETTLE: Duration = Duration::from_millis(700);

pub const ACT_STEP_EVENT: &str = "bridge:act-step";
pub const ACT_DONE_EVENT: &str = "bridge:act-done";
/// Same stream the annotate overlay already draws its pointer glyph from.
const POINTER_EVENT: &str = "bridge:chase-pointer";

fn err(code: &'static str, message: impl Into<String>) -> CompanionError {
    CompanionError { code, message: message.into() }
}

#[derive(Default)]
pub struct ActState {
    epoch: AtomicU64,
    jobs: Arc<crate::jobs::JobTable<Result<ActOutcome, CompanionError>>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActRequest {
    pub task: String,
    /// Explicit, per-request permission to move the mouse and type.
    #[serde(default)]
    pub allow_control: bool,
    #[serde(default)]
    pub speak: bool,
    /// `guide`: teach instead of do — the same planner, but every step is
    /// pointed at and narrated, and the loop waits for the USER's own click
    /// near the target before moving on. Needs no control consent: nothing
    /// is posted.
    #[serde(default)]
    pub guide: bool,
    /// Apps the hands may act in (substring match on the frontmost app's
    /// name, case-insensitive). Empty = any app — an empty policy is not a
    /// default-deny (ADR-263).
    #[serde(default)]
    pub allowed_apps: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeTextRequest {
    pub text: String,
    #[serde(default)]
    pub allow_control: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ActOutcome {
    /// `done` | `failed` | `stopped` | `bounded`
    pub status: &'static str,
    pub summary: String,
    pub steps: usize,
}

/// Is `frontmost` allowed by `allowed_apps`? Empty list = everything.
pub fn app_allowed(allowed_apps: &[String], frontmost: &str) -> bool {
    let wanted: Vec<String> = allowed_apps
        .iter()
        .map(|a| a.trim().to_lowercase())
        .filter(|a| !a.is_empty())
        .collect();
    wanted.is_empty() || wanted.iter().any(|a| frontmost.to_lowercase().contains(a))
}

#[derive(Serialize)]
pub struct ActPoll {
    pub done: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outcome: Option<ActOutcome>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StepEvent {
    index: usize,
    say: String,
    action: String,
    target: String,
    /// `planning` | `acting` | `ok` | `failed`
    status: &'static str,
}

// ---------------------------------------------------------------------------
// Planner vocabulary
// ---------------------------------------------------------------------------

/// The raw JSON the planner is asked for. Every field optional so a partial
/// reply degrades to a refusal rather than a parse error.
#[derive(Deserialize, Default, Debug)]
#[serde(default)]
struct PlannedAction {
    say: String,
    action: String,
    target: String,
    cell: Option<usize>,
    text: String,
    key: String,
    direction: String,
    app: String,
}

#[derive(Debug, PartialEq)]
pub enum Step {
    Click { cell: usize, label: String, button: MouseButton, clicks: u32 },
    Type(String),
    Press(Key),
    Scroll(i32),
    OpenApp(String),
    Done,
    Fail,
}

/// Extract the first `{…}` object from a reply that may carry prose or a
/// code fence around it.
pub fn extract_json(reply: &str) -> Option<&str> {
    let start = reply.find('{')?;
    let end = reply.rfind('}')?;
    (end > start).then(|| &reply[start..=end])
}

/// Parse and validate one planner reply into a `Step` plus what to say.
/// Anything outside the closed vocabulary becomes `Fail` — the model cannot
/// invent an action, and an unparseable reply never becomes a click.
pub fn parse_step(reply: &str, cols: usize, rows: usize) -> (String, Step) {
    let Some(json) = extract_json(reply) else {
        return ("I couldn't decide on a next step.".into(), Step::Fail);
    };
    let planned: PlannedAction = match serde_json::from_str(json) {
        Ok(p) => p,
        Err(_) => return ("I couldn't decide on a next step.".into(), Step::Fail),
    };
    let say = planned.say.trim().chars().take(240).collect::<String>();
    let label = planned.target.trim().chars().take(80).collect::<String>();
    let cell_ok = |c: Option<usize>| c.filter(|n| (1..=cols * rows).contains(n));
    let step = match planned.action.trim().to_lowercase().as_str() {
        "click" | "double_click" | "right_click" => match cell_ok(planned.cell) {
            Some(cell) => Step::Click {
                cell,
                label,
                button: if planned.action == "right_click" { MouseButton::Right } else { MouseButton::Left },
                clicks: if planned.action == "double_click" { 2 } else { 1 },
            },
            None => Step::Fail,
        },
        "type" => {
            let text: String = planned.text.chars().take(MAX_TYPE_CHARS).collect();
            if text.is_empty() { Step::Fail } else { Step::Type(text) }
        }
        "key" => Key::parse(&planned.key).map_or(Step::Fail, Step::Press),
        "scroll" => Step::Scroll(if planned.direction.trim().eq_ignore_ascii_case("up") { -9 } else { 9 }),
        "open_app" => {
            let app: String = planned
                .app
                .trim()
                .chars()
                .filter(|c| c.is_alphanumeric() || *c == ' ' || *c == '-' || *c == '.')
                .take(60)
                .collect();
            if app.is_empty() { Step::Fail } else { Step::OpenApp(app) }
        }
        "done" => Step::Done,
        _ => Step::Fail,
    };
    (say, step)
}

fn planner_prompt(task: &str, log: &[String], cols: usize, rows: usize, guide: bool) -> String {
    let voice = if guide {
        "You are TEACHING the user to do the task themselves: \"say\" must be the instruction for \
         this one step, in second person (\"Click the blue Compose button\"), and every action must \
         still name the on-screen control and its cell so it can be pointed at. "
    } else {
        ""
    };
    let history = if log.is_empty() {
        "none yet".to_string()
    } else {
        log.iter().enumerate().map(|(i, s)| format!("{}. {s}", i + 1)).collect::<Vec<_>>().join("\n")
    };
    format!(
        "{voice}You operate the user's Mac. You see a screenshot of the current screen overlaid with a \
         {cols}x{rows} grid; every cell has its number printed in it. Choose exactly ONE next action \
         toward the task, then the screen will be captured again.\n\
         Task: {task}\n\
         Steps already taken:\n{history}\n\
         Reply with ONLY a JSON object, no prose: {{\"say\": \"<one short sentence telling the user \
         what you are doing>\", \"action\": \"click\" | \"double_click\" | \"right_click\" | \"type\" | \
         \"key\" | \"scroll\" | \"open_app\" | \"done\" | \"fail\", \"target\": \"<short label of the \
         on-screen control, for click actions>\", \"cell\": <printed grid cell number containing the \
         target, for click actions>, \"text\": \"<text to type, for type>\", \"key\": \"return\" | \
         \"tab\" | \"escape\" | \"space\" | \"backspace\" | \"up\" | \"down\" | \"left\" | \"right\" | \
         \"cmd+a\" | \"cmd+c\" | \"cmd+v\" | \"cmd+l\" | \"cmd+t\" | \"cmd+f\" | \"cmd+z\", \
         \"direction\": \"up\" | \"down\", \"app\": \"<application name, for open_app>\"}}.\n\
         Rules: click a text field before typing into it; use open_app rather than the Dock to launch \
         an app; when the task is visibly complete answer with action \"done\" and say what you see; \
         if a step would need a password, a payment, deleting or sending something the user did not \
         ask for, or the task cannot be done, answer with action \"fail\" and say why."
    )
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn act_start(
    app: AppHandle,
    window: WebviewWindow,
    state: tauri::State<'_, ActState>,
    request: ActRequest,
) -> Result<u64, CompanionError> {
    let task = request.task.trim().to_string();
    if task.is_empty() {
        return Err(err("ACT_EMPTY_TASK", "do what?"));
    }
    if task.chars().count() > MAX_TASK_CHARS {
        return Err(err("ACT_TASK_TOO_LONG", format!("a task is limited to {MAX_TASK_CHARS} characters")));
    }
    if !request.guide && !request.allow_control {
        return Err(err(
            "ACT_CONTROL_NOT_ALLOWED",
            "turn on \"use my mouse and keyboard\" in the panel first — Bridge never moves your \
             cursor without that explicit permission",
        ));
    }
    if !cfg!(target_os = "macos") {
        return Err(err("ACT_UNSUPPORTED", "doing tasks with the mouse is macOS-only in this slice"));
    }
    if !request.guide && !crate::providers::accessibility::ax_permission_status() {
        // Opens the OS dialog once; the grant shows up on the next attempt.
        let _ = crate::providers::accessibility::ax_request_permission();
        return Err(err(
            "ACT_NO_ACCESSIBILITY",
            "macOS Accessibility permission is needed to move the mouse and type. Grant Bridge in \
             System Settings → Privacy & Security → Accessibility, then try again.",
        ));
    }
    let key = groq_api_key(&app).ok_or_else(|| {
        err("ACT_NO_PROVIDER", "doing tasks needs a Groq API key in Settings → API Keys (one screenshot per step is sent to Groq)")
    })?;
    let monitor_index = overlay::monitor_index_for_label(window.label());
    let job = state.jobs.start().map_err(|message| err("ACT_JOBS", message))?;
    let epoch = state.epoch.fetch_add(1, Ordering::SeqCst) + 1;
    let table = state.jobs.clone();
    let app_for_task = app.clone();
    let speak = request.speak;
    let guide = request.guide;
    let allowed_apps = request.allowed_apps;
    tauri::async_runtime::spawn_blocking(move || {
        let result = run(&app_for_task, epoch, monitor_index, &task, &key, speak, guide, &allowed_apps);
        let _ = app_for_task.emit(POINTER_EVENT, serde_json::json!({ "monitor": monitor_index, "x": 0.0, "y": 0.0, "active": false }));
        if let Ok(outcome) = &result {
            let _ = app_for_task.emit(ACT_DONE_EVENT, outcome.clone());
        }
        table.finish(job, result);
    });
    Ok(job)
}

#[tauri::command]
pub fn act_poll(state: tauri::State<'_, ActState>, job: u64) -> Result<ActPoll, CompanionError> {
    match state.jobs.take(job) {
        crate::jobs::JobPollState::Unknown => Err(err("ACT_JOB_UNKNOWN", "No such run — it may have expired unpolled or already been delivered")),
        crate::jobs::JobPollState::Pending => Ok(ActPoll { done: false, outcome: None }),
        crate::jobs::JobPollState::Ready(result) => Ok(ActPoll { done: true, outcome: Some(result?) }),
    }
}

/// Stop the current run; the loop notices within one tick.
#[tauri::command]
pub fn act_stop(state: tauri::State<'_, ActState>) {
    state.epoch.fetch_add(1, Ordering::SeqCst);
}

/// Dictation: type already-transcribed text into whatever has keyboard
/// focus. Same gates as a run — consent, Accessibility, privacy guard — and
/// the same cap as a planned `type` step. Returns the frontmost app name so
/// the panel can say where the words went.
#[tauri::command]
pub fn act_type_text(request: TypeTextRequest) -> Result<String, CompanionError> {
    let text: String = request.text.chars().take(MAX_TYPE_CHARS).collect();
    if text.trim().is_empty() {
        return Err(err("ACT_EMPTY_TEXT", "nothing to type"));
    }
    if !request.allow_control {
        return Err(err("ACT_CONTROL_NOT_ALLOWED", "turn on \"use my mouse and keyboard\" first"));
    }
    if let Some(guarded) = guarded_frontmost_app() {
        return Err(err("ACT_PRIVACY_GUARD", format!("{guarded} looks like a credential window; Bridge will not type into it")));
    }
    let frontmost = frontmost_app_name().unwrap_or_else(|| "the current app".into());
    match actuator::type_text(&text) {
        Ok(()) => Ok(frontmost),
        Err(ActuatorError::NotTrusted) => Err(err("ACT_NO_ACCESSIBILITY", "macOS Accessibility permission is needed to type")),
        Err(_) => Err(err("ACT_UNSUPPORTED", "typing is macOS-only in this slice")),
    }
}

fn frontmost_app_name() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        crate::providers::apps::frontmost_app_once().map(|(name, _)| name)
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

/// Wait for the user's own click. Returns `Ok(true)` when a press lands
/// within `target` (padded), `Ok(false)` on a press elsewhere, `Err(())` on
/// stop/timeout. Edge-triggered on the button so a held press counts once.
fn wait_for_user_click(
    app: &AppHandle,
    epoch: u64,
    target: Option<(f64, f64, f64, f64)>,
    timeout: Duration,
) -> Result<bool, ()> {
    let started = Instant::now();
    let mut was_down = actuator::primary_button_down();
    while started.elapsed() < timeout {
        if stopped(app, epoch) {
            return Err(());
        }
        let down = actuator::primary_button_down();
        if down && !was_down {
            let Some((x, y, w, h)) = target else { return Ok(true) };
            let hit = actuator::cursor_location().map_or(true, |(cx, cy)| {
                cx >= x - 40.0 && cx <= x + w + 40.0 && cy >= y - 40.0 && cy <= y + h + 40.0
            });
            return Ok(hit);
        }
        was_down = down;
        std::thread::sleep(Duration::from_millis(30));
    }
    Err(())
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

fn stopped(app: &AppHandle, epoch: u64) -> bool {
    app.state::<ActState>().epoch.load(Ordering::SeqCst) != epoch
}

fn emit_step(app: &AppHandle, index: usize, say: &str, action: &str, target: &str, status: &'static str) {
    let _ = app.emit(
        ACT_STEP_EVENT,
        StepEvent { index, say: say.into(), action: action.into(), target: target.into(), status },
    );
}

#[allow(clippy::too_many_arguments)]
fn run(
    app: &AppHandle,
    epoch: u64,
    monitor_index: usize,
    task: &str,
    key: &str,
    speak: bool,
    guide: bool,
    allowed_apps: &[String],
) -> Result<ActOutcome, CompanionError> {
    let model = vision_model(app);
    let started = Instant::now();
    let mut log: Vec<String> = Vec::new();
    let (ox, oy, logical_w, logical_h) = companion::monitor_logical_rect(app, monitor_index)
        .ok_or_else(|| err("ACT_NO_MONITOR", "monitor geometry unavailable"))?;
    let outcome = |status, summary: String, steps| Ok(ActOutcome { status, summary, steps });

    for index in 1..=MAX_STEPS {
        if stopped(app, epoch) {
            return outcome("stopped", "Stopped.".into(), index - 1);
        }
        if started.elapsed() > MAX_WALL {
            return outcome("bounded", format!("I stopped after {}s without finishing.", MAX_WALL.as_secs()), index - 1);
        }
        if let Some(guarded) = guarded_frontmost_app() {
            return outcome("failed", format!("{guarded} looks like a password or credential window, so I stopped."), index - 1);
        }
        emit_step(app, index, "Looking at the screen…", "look", "", "planning");
        let capture = sensor_bridge::capture_display_jpeg(app, monitor_index)
            .map_err(|e| err("ACT_CAPTURE_FAILED", e.message))?;
        let gridded = gridded_jpeg(&capture.jpeg_bytes, COARSE_COLS, COARSE_ROWS)
            .ok_or_else(|| err("ACT_IMAGE_DECODE_FAILED", "couldn't decode the screen capture"))?;
        let body = serde_json::json!({
            "model": model,
            "max_tokens": 220,
            "temperature": 0.0,
            "reasoning_effort": "none",
            "messages": [{
                "role": "user",
                "content": [
                    { "type": "text", "text": planner_prompt(task, &log, COARSE_COLS, COARSE_ROWS, guide) },
                    { "type": "image_url", "image_url": { "url": format!(
                        "data:image/jpeg;base64,{}",
                        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &gridded)
                    ) } },
                ],
            }],
        });
        let reply = strip_think_blocks(&post_chat(&format!("{GROQ_BASE_URL}/chat/completions"), key, body)?);
        eprintln!("[bridge-desktop] act step {index} reply={reply:?}");
        let (say, step) = parse_step(&reply, COARSE_COLS, COARSE_ROWS);
        if stopped(app, epoch) {
            return outcome("stopped", "Stopped.".into(), index - 1);
        }
        let (action_name, target_label) = describe(&step);
        emit_step(app, index, &say, action_name, &target_label, "acting");
        if speak && !say.is_empty() {
            companion::speak(app, &say);
        }

        if guide {
            // Teach: point, narrate, and wait for the user's own click.
            let target = match &step {
                Step::Done => return outcome("done", say, index - 1),
                Step::Fail => return outcome("failed", say, index - 1),
                Step::Click { cell, label, .. } => {
                    let region = refine_cell(key, &model, &capture.jpeg_bytes, capture.image_width as f64, capture.image_height as f64, &CellTarget { number: *cell, label: label.clone() });
                    let marks = companion::marks_for_box(region, label, capture.image_width as f64, capture.image_height as f64, logical_w, logical_h);
                    marks.first().map(|spot| {
                        let _ = annotate::show_marks_on(app, monitor_index, marks.clone());
                        let _ = app.emit(POINTER_EVENT, serde_json::json!({ "monitor": monitor_index, "x": spot.x + spot.width / 2.0, "y": spot.y + spot.height / 2.0, "active": true }));
                        (ox + spot.x, oy + spot.y, spot.width, spot.height)
                    })
                }
                _ => None,
            };
            let mut attempts = 0;
            loop {
                match wait_for_user_click(app, epoch, target, Duration::from_secs(90)) {
                    Ok(true) => break,
                    Ok(false) if attempts == 0 => {
                        attempts += 1;
                        emit_step(app, index, "Not quite — it's where the arrow is.", action_name, &target_label, "acting");
                        if speak { companion::speak(app, "Not quite — it's where the arrow is."); }
                    }
                    Ok(false) => break, // second try anywhere: let the user move on
                    Err(()) => {
                        let _ = annotate::annotate_clear(app.clone());
                        return outcome("stopped", "Stopped the walkthrough.".into(), index - 1);
                    }
                }
            }
            let _ = annotate::annotate_clear(app.clone());
            emit_step(app, index, &say, action_name, &target_label, "ok");
            log.push(format!("{action_name} {target_label} — {say} (user did it)").trim().to_string());
            std::thread::sleep(SETTLE);
            continue;
        }

        // The allowlist gates the HANDS, not the look: planning and
        // `open_app` are always allowed (the first step is usually switching
        // INTO the allowed app from wherever the user pressed Do), so the
        // check runs right before a click/type/key/scroll lands somewhere.
        if !guide && !matches!(step, Step::Done | Step::Fail | Step::OpenApp(_)) {
            if let Some(front) = frontmost_app_name() {
                if !app_allowed(allowed_apps, &front) {
                    return outcome(
                        "failed",
                        format!("{front} is in front and is not in your allowed apps, so I stopped before touching it."),
                        index - 1,
                    );
                }
            }
        }
        let result: Result<(), ActuatorError> = match &step {
            Step::Done => return outcome("done", say, index - 1),
            Step::Fail => return outcome("failed", say, index - 1),
            Step::OpenApp(name) => {
                #[cfg(target_os = "macos")]
                let _ = std::process::Command::new("open").args(["-a", name]).spawn();
                std::thread::sleep(Duration::from_millis(1500));
                Ok(())
            }
            Step::Click { cell, label, button, clicks } => {
                let region = refine_cell(
                    key,
                    &model,
                    &capture.jpeg_bytes,
                    capture.image_width as f64,
                    capture.image_height as f64,
                    &CellTarget { number: *cell, label: label.clone() },
                );
                let marks = companion::marks_for_box(
                    region,
                    label,
                    capture.image_width as f64,
                    capture.image_height as f64,
                    logical_w,
                    logical_h,
                );
                let Some(spot) = marks.first() else {
                    return outcome("failed", format!("I found \"{label}\" but couldn't place it on screen."), index - 1);
                };
                let local = (spot.x + spot.width / 2.0, spot.y + spot.height / 2.0);
                let _ = annotate::show_marks_on(app, monitor_index, marks.clone());
                schedule_marks_clear(app);
                let global = (ox + local.0, oy + local.1);
                actuator::glide_to(global, |p| {
                    let _ = app.emit(POINTER_EVENT, serde_json::json!({
                        "monitor": monitor_index, "x": p.0 - ox, "y": p.1 - oy, "active": true, "stream": true,
                    }));
                })
                .and_then(|_| {
                    let _ = app.emit(POINTER_EVENT, serde_json::json!({
                        "monitor": monitor_index, "x": local.0, "y": local.1, "active": true, "stream": true, "pressed": true,
                    }));
                    actuator::click(global, *button, *clicks)
                })
            }
            Step::Type(text) => actuator::type_text(text),
            Step::Press(k) => actuator::press(*k),
            Step::Scroll(lines) => actuator::scroll(*lines),
        };

        match result {
            Ok(()) => {
                emit_step(app, index, &say, action_name, &target_label, "ok");
                log.push(format!("{action_name} {target_label} — {say}").trim().to_string());
            }
            Err(ActuatorError::Takeover) => {
                emit_step(app, index, "You took the mouse — stopping.", action_name, &target_label, "failed");
                return outcome("stopped", "You moved the mouse, so I stopped.".into(), index - 1);
            }
            Err(ActuatorError::NotTrusted) => {
                return Err(err("ACT_NO_ACCESSIBILITY", "Accessibility permission was revoked mid-run."));
            }
            Err(ActuatorError::Unsupported) => {
                return Err(err("ACT_UNSUPPORTED", "doing tasks with the mouse is macOS-only in this slice"));
            }
        }
        std::thread::sleep(SETTLE);
    }
    outcome("bounded", format!("I stopped after {MAX_STEPS} steps without finishing."), MAX_STEPS)
}

fn describe(step: &Step) -> (&'static str, String) {
    match step {
        Step::Click { label, clicks: 2, .. } => ("double-click", label.clone()),
        Step::Click { label, button: MouseButton::Right, .. } => ("right-click", label.clone()),
        Step::Click { label, .. } => ("click", label.clone()),
        Step::Type(text) => ("type", text.chars().take(40).collect()),
        Step::Press(_) => ("press", String::new()),
        Step::Scroll(lines) => ("scroll", if *lines < 0 { "up".into() } else { "down".into() }),
        Step::OpenApp(name) => ("open", name.clone()),
        Step::Done => ("done", String::new()),
        Step::Fail => ("stop", String::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_click_with_cell_and_label() {
        let (say, step) = parse_step(
            "Sure. {\"say\":\"Clicking Send\",\"action\":\"click\",\"target\":\"Send button\",\"cell\":57}",
            12,
            8,
        );
        assert_eq!(say, "Clicking Send");
        assert_eq!(step, Step::Click { cell: 57, label: "Send button".into(), button: MouseButton::Left, clicks: 1 });
    }

    #[test]
    fn click_without_a_valid_cell_is_refused() {
        assert_eq!(parse_step("{\"action\":\"click\",\"target\":\"x\"}", 12, 8).1, Step::Fail);
        assert_eq!(parse_step("{\"action\":\"click\",\"cell\":97}", 12, 8).1, Step::Fail);
        assert_eq!(parse_step("{\"action\":\"click\",\"cell\":0}", 12, 8).1, Step::Fail);
    }

    #[test]
    fn unknown_actions_and_garbage_never_become_input() {
        assert_eq!(parse_step("{\"action\":\"delete_everything\"}", 12, 8).1, Step::Fail);
        assert_eq!(parse_step("no json here", 12, 8).1, Step::Fail);
        assert_eq!(parse_step("{\"action\":\"key\",\"key\":\"cmd+q\"}", 12, 8).1, Step::Fail);
        assert_eq!(parse_step("{\"action\":\"type\",\"text\":\"\"}", 12, 8).1, Step::Fail);
    }

    #[test]
    fn typed_text_is_capped_and_keys_come_from_the_allowlist() {
        let long = "x".repeat(MAX_TYPE_CHARS + 50);
        match parse_step(&format!("{{\"action\":\"type\",\"text\":\"{long}\"}}"), 12, 8).1 {
            Step::Type(t) => assert_eq!(t.len(), MAX_TYPE_CHARS),
            other => panic!("expected type, got {other:?}"),
        }
        assert_eq!(parse_step("{\"action\":\"key\",\"key\":\"Return\"}", 12, 8).1, Step::Press(Key::Return));
        assert_eq!(parse_step("{\"action\":\"scroll\",\"direction\":\"up\"}", 12, 8).1, Step::Scroll(-9));
        assert_eq!(parse_step("```json\n{\"action\":\"done\",\"say\":\"All set\"}\n```", 12, 8), ("All set".into(), Step::Done));
    }

    #[test]
    fn open_app_names_are_sanitised() {
        assert_eq!(parse_step("{\"action\":\"open_app\",\"app\":\"Safari; rm -rf /\"}", 12, 8).1, Step::OpenApp("Safari rm -rf ".into()));
        assert_eq!(parse_step("{\"action\":\"open_app\",\"app\":\"\"}", 12, 8).1, Step::Fail);
    }

    #[test]
    fn prompt_carries_task_and_history() {
        let p = planner_prompt("open Notes", &["open Notes — Opening Notes".into()], 12, 8, false);
        assert!(p.contains("Task: open Notes") && p.contains("1. open Notes") && p.contains("12x8 grid"));
        assert!(!p.contains("TEACHING"));
        assert!(planner_prompt("open Notes", &[], 12, 8, true).contains("TEACHING"));
    }

    #[test]
    fn app_allowlist_is_substring_case_insensitive_and_empty_means_any() {
        assert!(app_allowed(&[], "Safari"));
        assert!(app_allowed(&["".into(), "  ".into()], "Safari"));
        assert!(app_allowed(&["notes".into()], "Notes"));
        assert!(app_allowed(&["google chrome".into()], "Google Chrome"));
        assert!(!app_allowed(&["Notes".into()], "Safari"));
    }
}
