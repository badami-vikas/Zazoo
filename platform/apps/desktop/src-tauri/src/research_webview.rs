//! research_webview — the Research Run's rendering surface (TASK-028 BR1/BR2).
//!
//! The HTTP reader in `@bridge/research` handles static pages; this module is
//! the escalation path AP-089 chose over a bundled Chromium: pages that render
//! their content with client-side JavaScript are loaded into a REAL webview
//! (the engine Bridge already embeds), read after they settle, and — the part
//! no HTTP reader can do — screenshotted so the Set-of-Mark grid locator from
//! TASK-027 can resolve "the search box" to an on-page rectangle (BR2).
//!
//! Containment, because this webview renders ADVERSARIAL content by design:
//!  - The window label is deliberately absent from `capabilities/default.json`,
//!    so the page holds no Tauri permissions; and because it is an EXTERNAL
//!    origin, Tauri v2 never injects the IPC object into it at all. A hostile
//!    page has no channel to any command in this shell.
//!  - It gets its own minimal init script — never the main window's script,
//!    which carries the sidecar token.
//!  - `on_navigation` allows only http(s); `file:`, `data:`, custom schemes,
//!    and anything else a page redirects to are refused.
//!  - Extraction is OUTBOUND-only: the injected script serialises the page's
//!    visible text and navigates to a `bridge-extract:` URL; the navigation
//!    handler decodes the payload and CANCELS the navigation. The page can lie
//!    about its own text (it runs the extractor in its own context) — that is
//!    fine, because everything read here is quarantined `untrusted_external`
//!    the moment it crosses into the research engine.
//!  - The window is VISIBLE, pinned always-on-bottom and never focused: the
//!    user can watch what Bridge is reading at any time (no silent browsing —
//!    same principle as the avatar blink-tell), but it stays out of the way.
//!  - Screenshots capture THIS WINDOW's image only (`screencapture -l`), never
//!    the screen region around it — other windows cannot leak into a locator
//!    call even when they overlap it.
//!
//! Cloud egress note: `research_locate` sends a screenshot of the loaded PAGE
//! (public web content the Run itself navigated to, never the user's screen)
//! to the configured Groq vision model — the same model, key, and grid
//! pipeline TASK-027's companion uses.

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::companion;

pub const RESEARCH_LABEL: &str = "research-reader";

/// Scheme the injected extractor "navigates" to; the navigation handler is
/// the receiver. Never actually loaded.
const EXTRACT_SCHEME: &str = "bridge-extract";

/// How long a page gets to settle and deliver text before the read fails
/// honestly. Matches the HTTP reader's 15s order of magnitude.
const EXTRACT_TIMEOUT_MS: u64 = 20_000;

/// Hard cap on extracted characters, enforced in the script AND re-enforced
/// here (the script runs in hostile territory, so its cap is advisory).
const MAX_EXTRACT_CHARS: usize = 300_000;

/// Viewport chosen to match the companion locator's provider-image ceiling:
/// at 1280 logical the gridded screenshot needs no downscale before Groq.
const VIEWPORT_W: f64 = 1280.0;
const VIEWPORT_H: f64 = 800.0;

/// Injected at document start on every load. Waits for `load` plus a settle
/// delay (JS-rendered pages paint after `load`), then ships the visible text
/// out through a cancelled navigation. A page that never fires `load` still
/// reports at the hard deadline rather than hanging the Run.
const EXTRACT_SCRIPT: &str = r#"
(function () {
  if (window.top !== window) return;
  var SENT = false;
  function send() {
    if (SENT) return;
    SENT = true;
    var payload;
    try {
      payload = {
        url: String(location.href),
        title: String(document.title || ""),
        text: String((document.body && document.body.innerText) || "").slice(0, 300000),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight
      };
    } catch (e) {
      payload = { url: String(location.href), title: "", text: "", viewportWidth: 0, viewportHeight: 0 };
    }
    var b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))))
      .replace(/\+/g, "-").replace(/\//g, "_");
    location.href = "bridge-extract://p/" + b64;
  }
  if (document.readyState === "complete") {
    setTimeout(send, 1500);
  } else {
    window.addEventListener("load", function () { setTimeout(send, 1500); });
  }
  setTimeout(send, 8000);
})();
"#;

// ---------------------------------------------------------------------------
// State and typed errors
// ---------------------------------------------------------------------------

#[derive(Default)]
pub struct ResearchState {
    /// Delivery slot: the navigation interceptor sends the decoded payload to
    /// whichever read is currently waiting. Arc'd so the window's `'static`
    /// navigation closure and the command can share it.
    slot: Arc<Mutex<Option<mpsc::Sender<PageExtract>>>>,
    /// One navigation+extraction in flight at a time. The engine serialises
    /// steps anyway; a concurrent caller gets a typed error, not a queue.
    busy: Arc<AtomicBool>,
}

#[derive(Serialize)]
pub struct ResearchError {
    pub code: &'static str,
    pub message: String,
}

fn err(code: &'static str, message: impl Into<String>) -> ResearchError {
    ResearchError {
        code,
        message: message.into(),
    }
}

/// What the extractor script reports for one page load.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PageExtract {
    pub url: String,
    pub title: String,
    pub text: String,
    pub viewport_width: f64,
    pub viewport_height: f64,
}

/// A located on-page element, in LOGICAL viewport coordinates (the window is
/// undecorated, so the captured image and the page viewport coincide).
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ResearchLocated {
    #[serde(rename = "ref")]
    pub elem_ref: String,
    pub description: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

// ---------------------------------------------------------------------------
// Navigation policy — pure and unit-tested
// ---------------------------------------------------------------------------

#[derive(Debug, PartialEq)]
pub enum NavVerdict {
    /// A `bridge-extract:` payload — deliver it, cancel the navigation.
    Deliver(PageExtract),
    /// A `bridge-extract:` URL that failed to decode — cancel, deliver nothing.
    DeliverInvalid,
    Allow,
    Deny,
}

pub fn classify_navigation(url: &tauri::Url) -> NavVerdict {
    if url.scheme() == EXTRACT_SCHEME {
        return match decode_extract(url) {
            Some(payload) => NavVerdict::Deliver(payload),
            None => NavVerdict::DeliverInvalid,
        };
    }
    match url.scheme() {
        // `about:blank` is the window's parked initial page.
        "http" | "https" | "about" => NavVerdict::Allow,
        _ => NavVerdict::Deny,
    }
}

/// Decode `bridge-extract://p/<base64url(JSON)>`. URL-safe alphabet keeps
/// base64 out of the path-segment business entirely.
fn decode_extract(url: &tauri::Url) -> Option<PageExtract> {
    use base64::Engine as _;
    let b64 = url.path().strip_prefix('/')?;
    let bytes = base64::engine::general_purpose::URL_SAFE.decode(b64).ok()?;
    let mut payload: PageExtract = serde_json::from_slice(&bytes).ok()?;
    // The in-page cap is advisory (hostile territory); this one is not.
    if payload.text.len() > MAX_EXTRACT_CHARS {
        let mut cut = MAX_EXTRACT_CHARS;
        while !payload.text.is_char_boundary(cut) {
            cut -= 1;
        }
        payload.text.truncate(cut);
    }
    Some(payload)
}

fn parse_research_url(url: &str) -> Result<tauri::Url, ResearchError> {
    let parsed = tauri::Url::parse(url).map_err(|_| {
        err(
            "RESEARCH_URL_INVALID",
            format!("\"{url}\" is not a valid URL"),
        )
    })?;
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return Err(err(
            "RESEARCH_URL_INVALID",
            format!(
                "Refusing to open a {} URL in the research reader",
                parsed.scheme()
            ),
        ));
    }
    Ok(parsed)
}

// ---------------------------------------------------------------------------
// Window lifecycle
// ---------------------------------------------------------------------------

fn ensure_window(app: &AppHandle) -> Result<tauri::WebviewWindow, ResearchError> {
    if let Some(existing) = app.get_webview_window(RESEARCH_LABEL) {
        return Ok(existing);
    }
    let slot = app.state::<ResearchState>().slot.clone();
    let parked = tauri::Url::parse("about:blank").expect("about:blank is a valid URL");
    let window = WebviewWindowBuilder::new(app, RESEARCH_LABEL, WebviewUrl::External(parked))
        .title("Bridge Research")
        .inner_size(VIEWPORT_W, VIEWPORT_H)
        .resizable(false)
        .decorations(false)
        .focused(false)
        .always_on_bottom(true)
        .initialization_script(EXTRACT_SCRIPT)
        .on_navigation(move |url| match classify_navigation(url) {
            NavVerdict::Deliver(payload) => {
                let sender = slot.lock().ok().and_then(|guard| guard.clone());
                match sender {
                    Some(sender) => {
                        let _ = sender.send(payload);
                    }
                    None => eprintln!(
                        "[bridge-desktop] research extract arrived with no read waiting (dropped)"
                    ),
                }
                false
            }
            NavVerdict::DeliverInvalid => {
                eprintln!("[bridge-desktop] research extract payload failed to decode (dropped)");
                false
            }
            NavVerdict::Allow => true,
            NavVerdict::Deny => {
                eprintln!(
                    "[bridge-desktop] research reader refused navigation to {} URL",
                    url.scheme()
                );
                false
            }
        })
        .build()
        .map_err(|error| {
            err(
                "RESEARCH_WINDOW_FAILED",
                format!("Could not create the research reader window: {error}"),
            )
        })?;
    Ok(window)
}

/// Create/reuse the reader window and navigate it, ON THE MAIN THREAD.
/// AppKit window creation and mutation are main-thread-only; doing this from
/// a command's worker thread risks an Objective-C exception that Rust cannot
/// catch — the whole process aborts. One hop, result channelled back.
fn open_page_on_main_thread(app: &AppHandle, target: tauri::Url) -> Result<(), ResearchError> {
    let (sender, receiver) = mpsc::channel::<Result<(), ResearchError>>();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let outcome = ensure_window(&handle).and_then(|window| {
            window.navigate(target).map_err(|error| {
                err(
                    "RESEARCH_NAVIGATE_FAILED",
                    format!("Could not navigate the research reader: {error}"),
                )
            })
        });
        let _ = sender.send(outcome);
    })
    .map_err(|error| {
        err(
            "RESEARCH_STATE",
            format!("main-thread dispatch failed: {error}"),
        )
    })?;
    receiver
        .recv_timeout(Duration::from_secs(10))
        .map_err(|_| err("RESEARCH_STATE", "the reader window did not open in time"))?
}

/// Releases the busy flag on every exit path, including errors.
struct BusyGuard(Arc<AtomicBool>);

impl Drop for BusyGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Open `url` in the research reader and return the page's settled visible
/// text. The caller (the research engine's webview-backed reader) quarantines
/// everything returned here as `untrusted_external`.
#[tauri::command]
pub async fn research_read_page(
    app: AppHandle,
    state: tauri::State<'_, ResearchState>,
    url: String,
) -> Result<PageExtract, ResearchError> {
    let target = parse_research_url(&url)?;
    if state.busy.swap(true, Ordering::SeqCst) {
        return Err(err(
            "RESEARCH_BUSY",
            "Another research page read is already in flight",
        ));
    }
    let _busy = BusyGuard(state.busy.clone());

    let (sender, receiver) = mpsc::channel::<PageExtract>();
    {
        let mut guard = state
            .slot
            .lock()
            .map_err(|_| err("RESEARCH_STATE", "research state is unavailable"))?;
        *guard = Some(sender);
    }
    let slot = state.slot.clone();

    open_page_on_main_thread(&app, target)?;

    let received = tauri::async_runtime::spawn_blocking(move || {
        receiver.recv_timeout(Duration::from_millis(EXTRACT_TIMEOUT_MS))
    })
    .await
    .map_err(|error| err("RESEARCH_STATE", format!("read task failed: {error}")))?;

    if let Ok(mut guard) = slot.lock() {
        *guard = None;
    }
    received.map_err(|_| {
        err(
            "RESEARCH_TIMEOUT",
            "The page did not produce readable text in time — it may be very slow, \
             or blocking scripts",
        )
    })
}

/// Start-then-poll job state for the two research commands whose worst case
/// stacks provider calls — a locate is capture + two vision calls, a planner
/// chat is local + cloud fallback + spaced retry. Neither may hold an IPC
/// reply open that long (see jobs.rs's WKWebView ~60s abort rationale).
#[derive(Default)]
pub struct ResearchJobs {
    locate: Arc<crate::jobs::JobTable<Result<Option<ResearchLocated>, ResearchError>>>,
    chat: Arc<crate::jobs::JobTable<Result<String, ResearchError>>>,
}

/// Poll envelope: `done:false` = still running; `done:true` carries the value
/// (which is itself null for "locate finished, target not found" — a nested
/// Option would be JSON-ambiguous against pending).
#[derive(Serialize)]
pub struct ResearchJobPoll<T> {
    pub done: bool,
    pub value: Option<T>,
}

fn poll_envelope<T>(
    state: crate::jobs::JobPollState<Result<T, ResearchError>>,
) -> Result<ResearchJobPoll<T>, ResearchError> {
    match state {
        crate::jobs::JobPollState::Unknown => Err(err(
            "RESEARCH_JOB_UNKNOWN",
            "No such research job — it may have expired unpolled or already been delivered",
        )),
        crate::jobs::JobPollState::Pending => Ok(ResearchJobPoll {
            done: false,
            value: None,
        }),
        crate::jobs::JobPollState::Ready(Ok(value)) => Ok(ResearchJobPoll {
            done: true,
            value: Some(value),
        }),
        crate::jobs::JobPollState::Ready(Err(error)) => Err(error),
    }
}

/// Start locating a described element on the CURRENT research page via the
/// TASK-027 Set-of-Mark grid pipeline (drawn coarse grid → zoomed fine grid),
/// against a screenshot of the reader window only. Validation and window
/// lookups happen here; the capture + vision calls run detached, delivered
/// through `research_locate_poll`. The finished job yields `None` when the
/// model cannot see the target — never a guessed rectangle.
#[tauri::command]
pub fn research_locate_start(
    app: AppHandle,
    jobs: tauri::State<'_, ResearchJobs>,
    description: String,
) -> Result<u64, ResearchError> {
    let description = description.trim().to_string();
    if description.is_empty() {
        return Err(err("RESEARCH_LOCATE_INVALID", "Nothing to locate"));
    }
    let window = app
        .get_webview_window(RESEARCH_LABEL)
        .ok_or_else(|| err("RESEARCH_NO_PAGE", "No research page is open to locate on"))?;
    let key = companion::groq_api_key(&app).ok_or_else(|| {
        err(
            "RESEARCH_NO_VISION",
            "No Groq API key is configured, so the locator has no vision model",
        )
    })?;
    let model = companion::vision_model(&app);
    let scale = window.scale_factor().unwrap_or(1.0);
    let logical = window
        .inner_size()
        .map(|size| (size.width as f64 / scale, size.height as f64 / scale))
        .unwrap_or((VIEWPORT_W, VIEWPORT_H));
    let number = window_number_on_main_thread(&app, &window)?;

    let job = jobs
        .locate
        .start()
        .map_err(|message| err("RESEARCH_JOBS", message))?;
    let table = jobs.locate.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = locate_blocking(key, model, description, logical, number);
        table.finish(job, result);
    });
    Ok(job)
}

#[tauri::command]
pub fn research_locate_poll(
    jobs: tauri::State<'_, ResearchJobs>,
    job: u64,
) -> Result<ResearchJobPoll<Option<ResearchLocated>>, ResearchError> {
    poll_envelope(jobs.locate.take(job))
}

fn locate_blocking(
    key: String,
    model: String,
    description: String,
    logical: (f64, f64),
    number: i64,
) -> Result<Option<ResearchLocated>, ResearchError> {
    {
        let jpeg = capture_window_jpeg(number)?;
        let (image_w, image_h) = image::load_from_memory(&jpeg)
            .map(|decoded| {
                let rgb = decoded.to_rgb8();
                (rgb.width() as f64, rgb.height() as f64)
            })
            .map_err(|error| {
                err(
                    "RESEARCH_CAPTURE_FAILED",
                    format!("Captured page image is undecodable: {error}"),
                )
            })?;
        let Some(gridded) =
            companion::gridded_jpeg(&jpeg, companion::COARSE_COLS, companion::COARSE_ROWS)
        else {
            return Err(err(
                "RESEARCH_CAPTURE_FAILED",
                "Could not draw the locator grid on the captured page",
            ));
        };
        let Some(number) = companion::ask_grid_number(
            &key,
            &model,
            &gridded,
            &description,
            companion::COARSE_COLS,
            companion::COARSE_ROWS,
        ) else {
            return Ok(None);
        };
        let target = companion::CellTarget {
            number,
            label: description.clone(),
        };
        let region = companion::refine_cell(&key, &model, &jpeg, image_w, image_h, &target);
        let (x1, y1) = companion::map_image_point_to_logical(
            region.x, region.y, image_w, image_h, logical.0, logical.1,
        )
        .ok_or_else(|| err("RESEARCH_CAPTURE_FAILED", "Degenerate capture geometry"))?;
        let (x2, y2) = companion::map_image_point_to_logical(
            region.x + region.width,
            region.y + region.height,
            image_w,
            image_h,
            logical.0,
            logical.1,
        )
        .ok_or_else(|| err("RESEARCH_CAPTURE_FAILED", "Degenerate capture geometry"))?;
        Ok(Some(ResearchLocated {
            elem_ref: format!("cell:{number}"),
            description,
            x: x1,
            y: y1,
            width: (x2 - x1).max(1.0),
            height: (y2 - y1).max(1.0),
        }))
    }
}

/// One planner chat message. Only the shapes the planner sends are accepted.
#[derive(Deserialize)]
pub struct ResearchChatMessage {
    pub role: String,
    pub content: String,
}

/// Start a text-only chat completion for the Research Run's PLANNER, so the
/// Groq key never enters a webview. Deliberately narrow: no images (the
/// locator owns vision), a small output budget, and the same model knob the
/// companion uses. Callable only from Bridge's own capability-holding windows
/// — the research reader window has no IPC at all. The provider legs (local
/// 20s + cloud 15s + spaced 429 retry) run detached and are delivered through
/// `research_chat_poll`, so no IPC reply is ever held open near WKWebView's
/// ~60s deadline.
#[tauri::command]
pub fn research_chat_start(
    app: AppHandle,
    jobs: tauri::State<'_, ResearchJobs>,
    messages: Vec<ResearchChatMessage>,
) -> Result<u64, ResearchError> {
    if messages.is_empty() || messages.len() > 8 {
        return Err(err(
            "RESEARCH_CHAT_INVALID",
            "Planner chat needs between 1 and 8 messages",
        ));
    }
    for message in &messages {
        if message.role != "system" && message.role != "user" {
            return Err(err(
                "RESEARCH_CHAT_INVALID",
                format!("Unsupported chat role \"{}\"", message.role),
            ));
        }
    }
    // Local Plane first: the managed model has no rate limit and the
    // planner's context (which embeds fenced page text) never leaves the
    // machine. Groq is the fallback, with one respectful retry on a 429 —
    // its free tier's 8k tokens/minute is exactly what a multi-step Run
    // trips over at synthesis time.
    let local = companion::local_endpoint(&app);
    let cloud_key = companion::groq_api_key(&app);
    if local.is_none() && cloud_key.is_none() {
        return Err(err(
            "RESEARCH_NO_VISION",
            "Neither the managed local model nor a Groq API key is available for planning",
        ));
    }
    let model = companion::vision_model(&app);
    let job = jobs
        .chat
        .start()
        .map_err(|message| err("RESEARCH_JOBS", message))?;
    let table = jobs.chat.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = chat_blocking(local, cloud_key, model, messages);
        table.finish(job, result);
    });
    Ok(job)
}

#[tauri::command]
pub fn research_chat_poll(
    jobs: tauri::State<'_, ResearchJobs>,
    job: u64,
) -> Result<ResearchJobPoll<String>, ResearchError> {
    poll_envelope(jobs.chat.take(job))
}

fn chat_blocking(
    local: Option<companion::LocalEndpoint>,
    cloud_key: Option<String>,
    model: String,
    messages: Vec<ResearchChatMessage>,
) -> Result<String, ResearchError> {
    {
        let message_values = messages
            .iter()
            .map(|message| {
                serde_json::json!({
                    "role": message.role,
                    "content": message.content,
                })
            })
            .collect::<Vec<_>>();
        if let Some(endpoint) = local {
            let body = serde_json::json!({
                "model": endpoint.model,
                "max_tokens": 1200,
                "temperature": 0.2,
                "messages": message_values,
            });
            // Short deadline: a healthy 4B plans in seconds; a wedged server
            // must fail FAST so the whole command stays far inside WKWebView's
            // ~60s IPC deadline (see post_chat_with_timeout).
            match companion::post_chat_with_timeout(
                &format!("{}/chat/completions", endpoint.base_url.trim_end_matches('/')),
                &endpoint.api_key,
                body,
                std::time::Duration::from_secs(20),
            ) {
                Ok(reply) => return Ok(companion::strip_think_blocks(&reply)),
                Err(error) => eprintln!(
                    "[bridge-desktop] research planner local model failed ({}): {} —                      falling back to cloud",
                    error.code, error.message
                ),
            }
        }
        let key = cloud_key.ok_or_else(|| {
            err(
                "RESEARCH_CHAT_FAILED",
                "The managed local model failed and no Groq API key is configured",
            )
        })?;
        let body = serde_json::json!({
            "model": model,
            "max_tokens": 1200,
            "temperature": 0.2,
            "reasoning_effort": "none",
            "messages": message_values,
        });
        let url = format!("{}/chat/completions", companion::GROQ_BASE_URL);
        let groq_deadline = std::time::Duration::from_secs(15);
        match companion::post_chat_with_timeout(&url, &key, body.clone(), groq_deadline) {
            Ok(reply) => Ok(companion::strip_think_blocks(&reply)),
            Err(error) if error.message.contains("429") => {
                // The 429 body names its own retry window (~8s on the free
                // tier); wait it out once. Worst case whole-command budget:
                // 20s local + 15s cloud + 10s wait + 15s retry = 60s ceiling
                // never reached in practice, and each leg fails fast.
                std::thread::sleep(std::time::Duration::from_secs(10));
                companion::post_chat_with_timeout(&url, &key, body, groq_deadline)
                    .map(|reply| companion::strip_think_blocks(&reply))
                    .map_err(|error| err("RESEARCH_CHAT_FAILED", error.message))
            }
            Err(error) => Err(err("RESEARCH_CHAT_FAILED", error.message)),
        }
    }
}

/// Close the research reader window (Run finished or was stopped). Idempotent.
#[tauri::command]
pub fn research_close(app: AppHandle) -> Result<(), ResearchError> {
    let handle = app.clone();
    app.run_on_main_thread(move || {
        if let Some(window) = handle.get_webview_window(RESEARCH_LABEL) {
            if let Err(error) = window.close() {
                eprintln!("[bridge-desktop] research reader close failed: {error}");
            }
        }
    })
    .map_err(|error| {
        err(
            "RESEARCH_STATE",
            format!("main-thread dispatch failed: {error}"),
        )
    })
}

// ---------------------------------------------------------------------------
// Window capture (macOS)
// ---------------------------------------------------------------------------

/// Capture the reader window's OWN image — `screencapture -l` renders the
/// window's backing store, so overlapping windows never appear in the frame.
/// Takes a pre-resolved window number: the NSWindow lookup happens on the
/// main thread, never here.
#[cfg(target_os = "macos")]
fn capture_window_jpeg(number: i64) -> Result<Vec<u8>, ResearchError> {
    if !crate::sensor_bridge::screen_permission_granted() {
        return Err(err(
            "RESEARCH_NO_SCREEN_PERMISSION",
            "Screen Recording permission is required to capture the research page",
        ));
    }
    let path = std::env::temp_dir().join(format!(
        "bridge-research-capture-{}.jpg",
        std::process::id()
    ));
    let status = std::process::Command::new("screencapture")
        .args(["-x", "-o", "-t", "jpg", &format!("-l{number}")])
        .arg(&path)
        .status()
        .map_err(|error| {
            err(
                "RESEARCH_CAPTURE_FAILED",
                format!("screencapture could not run: {error}"),
            )
        })?;
    if !status.success() {
        return Err(err(
            "RESEARCH_CAPTURE_FAILED",
            format!("screencapture exited with {status}"),
        ));
    }
    let bytes = std::fs::read(&path).map_err(|error| {
        err(
            "RESEARCH_CAPTURE_FAILED",
            format!("Captured page image is unreadable: {error}"),
        )
    })?;
    let _ = std::fs::remove_file(&path);
    Ok(bytes)
}

/// NSWindow lookup on the MAIN thread (AppKit rule), result channelled back.
#[cfg(target_os = "macos")]
fn window_number_on_main_thread(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
) -> Result<i64, ResearchError> {
    let (sender, receiver) = mpsc::channel::<Result<i64, ResearchError>>();
    let window = window.clone();
    app.run_on_main_thread(move || {
        let outcome = (|| {
            let ns = window
                .ns_window()
                .map_err(|error| err("RESEARCH_CAPTURE_FAILED", format!("No NSWindow: {error}")))?
                as *mut objc2::runtime::AnyObject;
            if ns.is_null() {
                return Err(err("RESEARCH_CAPTURE_FAILED", "NSWindow is null"));
            }
            let number: isize = unsafe { objc2::msg_send![&*ns, windowNumber] };
            Ok(number as i64)
        })();
        let _ = sender.send(outcome);
    })
    .map_err(|error| {
        err(
            "RESEARCH_STATE",
            format!("main-thread dispatch failed: {error}"),
        )
    })?;
    receiver
        .recv_timeout(Duration::from_secs(5))
        .map_err(|_| err("RESEARCH_STATE", "NSWindow lookup did not answer in time"))?
}

#[cfg(not(target_os = "macos"))]
fn window_number_on_main_thread(
    _app: &AppHandle,
    _window: &tauri::WebviewWindow,
) -> Result<i64, ResearchError> {
    Err(err(
        "RESEARCH_UNSUPPORTED",
        "Research page capture is only implemented on macOS",
    ))
}

#[cfg(not(target_os = "macos"))]
fn capture_window_jpeg(_number: i64) -> Result<Vec<u8>, ResearchError> {
    Err(err(
        "RESEARCH_UNSUPPORTED",
        "Research page capture is only implemented on macOS",
    ))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine as _;

    fn extract_url(payload: &PageExtract) -> tauri::Url {
        let json = serde_json::to_vec(payload).expect("payload serialises");
        let b64 = base64::engine::general_purpose::URL_SAFE.encode(json);
        tauri::Url::parse(&format!("bridge-extract://p/{b64}")).expect("extract URL parses")
    }

    #[test]
    fn extract_payload_roundtrips_through_the_navigation_url() {
        let payload = PageExtract {
            url: "https://example.com/a?b=c".into(),
            title: "Ünïcode — title".into(),
            text: "Line one.\nLine two with émojis 🚀 and /slashes/ everywhere.".into(),
            viewport_width: 1280.0,
            viewport_height: 800.0,
        };
        match classify_navigation(&extract_url(&payload)) {
            NavVerdict::Deliver(decoded) => assert_eq!(decoded, payload),
            other => panic!("expected Deliver, got {other:?}"),
        }
    }

    #[test]
    fn oversized_extract_text_is_truncated_at_a_char_boundary() {
        let payload = PageExtract {
            url: "https://example.com".into(),
            title: String::new(),
            // Multi-byte chars across the cap: truncation must not split one.
            text: "é".repeat(MAX_EXTRACT_CHARS),
            viewport_width: 0.0,
            viewport_height: 0.0,
        };
        match classify_navigation(&extract_url(&payload)) {
            NavVerdict::Deliver(decoded) => {
                assert!(decoded.text.len() <= MAX_EXTRACT_CHARS);
                assert!(decoded.text.is_char_boundary(decoded.text.len()));
                assert!(!decoded.text.is_empty());
            }
            other => panic!("expected Deliver, got {other:?}"),
        }
    }

    #[test]
    fn malformed_extract_payloads_are_dropped_not_navigated() {
        let url = tauri::Url::parse("bridge-extract://p/not-base64!!!").unwrap();
        assert_eq!(classify_navigation(&url), NavVerdict::DeliverInvalid);
        let url = tauri::Url::parse("bridge-extract://p/").unwrap();
        assert_eq!(classify_navigation(&url), NavVerdict::DeliverInvalid);
    }

    #[test]
    fn only_web_and_parked_schemes_may_navigate() {
        for allowed in ["https://example.com", "http://example.com", "about:blank"] {
            let url = tauri::Url::parse(allowed).unwrap();
            assert_eq!(classify_navigation(&url), NavVerdict::Allow, "{allowed}");
        }
        for denied in [
            "file:///etc/passwd",
            "data:text/html,<h1>x</h1>",
            "javascript:alert(1)",
            "tauri://localhost",
            "ftp://example.com",
        ] {
            let url = tauri::Url::parse(denied).unwrap();
            assert_eq!(classify_navigation(&url), NavVerdict::Deny, "{denied}");
        }
    }

    #[test]
    fn research_urls_are_web_only() {
        assert!(parse_research_url("https://example.com/page").is_ok());
        assert!(parse_research_url("http://example.com").is_ok());
        assert!(parse_research_url("file:///etc/passwd").is_err());
        assert!(parse_research_url("javascript:alert(1)").is_err());
        assert!(parse_research_url("not a url").is_err());
    }
}
