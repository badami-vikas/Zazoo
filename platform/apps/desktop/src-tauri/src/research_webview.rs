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

    let window = ensure_window(&app)?;
    window.navigate(target).map_err(|error| {
        err(
            "RESEARCH_NAVIGATE_FAILED",
            format!("Could not navigate the research reader: {error}"),
        )
    })?;

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

/// Locate a described element on the CURRENT research page via the TASK-027
/// Set-of-Mark grid pipeline (drawn coarse grid → zoomed fine grid), against
/// a screenshot of the reader window only. Returns `None` when the model
/// cannot see the target — never a guessed rectangle.
#[tauri::command]
pub async fn research_locate(
    app: AppHandle,
    description: String,
) -> Result<Option<ResearchLocated>, ResearchError> {
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

    tauri::async_runtime::spawn_blocking(move || {
        let jpeg = capture_window_jpeg(&window)?;
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
    })
    .await
    .map_err(|error| err("RESEARCH_STATE", format!("locate task failed: {error}")))?
}

/// Close the research reader window (Run finished or was stopped). Idempotent.
#[tauri::command]
pub fn research_close(app: AppHandle) -> Result<(), ResearchError> {
    if let Some(window) = app.get_webview_window(RESEARCH_LABEL) {
        window.close().map_err(|error| {
            err(
                "RESEARCH_WINDOW_FAILED",
                format!("Could not close the research reader: {error}"),
            )
        })?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Window capture (macOS)
// ---------------------------------------------------------------------------

/// Capture the reader window's OWN image — `screencapture -l` renders the
/// window's backing store, so overlapping windows never appear in the frame.
#[cfg(target_os = "macos")]
fn capture_window_jpeg(window: &tauri::WebviewWindow) -> Result<Vec<u8>, ResearchError> {
    if !crate::sensor_bridge::screen_permission_granted() {
        return Err(err(
            "RESEARCH_NO_SCREEN_PERMISSION",
            "Screen Recording permission is required to capture the research page",
        ));
    }
    let number = window_number(window)?;
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

#[cfg(target_os = "macos")]
fn window_number(window: &tauri::WebviewWindow) -> Result<i64, ResearchError> {
    let ns = window
        .ns_window()
        .map_err(|error| err("RESEARCH_CAPTURE_FAILED", format!("No NSWindow: {error}")))?
        as *mut objc2::runtime::AnyObject;
    if ns.is_null() {
        return Err(err("RESEARCH_CAPTURE_FAILED", "NSWindow is null"));
    }
    let number: isize = unsafe { objc2::msg_send![&*ns, windowNumber] };
    Ok(number as i64)
}

#[cfg(not(target_os = "macos"))]
fn capture_window_jpeg(_window: &tauri::WebviewWindow) -> Result<Vec<u8>, ResearchError> {
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
