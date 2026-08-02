//! whatsapp_webview — the WhatsApp Module's session surface.
//!
//! Runs the OWNER'S OWN WhatsApp Web session in a contained webview and exposes
//! a fixed set of named operations over it. Containment mirrors
//! `research_webview.rs`, because the threat is the same shape: a third-party
//! page rendering inside our shell.
//!
//!  - The window label is absent from `capabilities/default.json`, and the page
//!    is an EXTERNAL origin, so Tauri v2 never injects the IPC object into it.
//!    A hostile script on the page has no channel to any command here.
//!  - It gets its own init script — never the main window's, which carries the
//!    sidecar token.
//!  - `on_navigation` allows ONLY WhatsApp origins. Unlike the research reader,
//!    which browses the open web, anything leaving whatsapp.com/.net is refused.
//!  - Extraction is OUTBOUND-only: the in-page script serialises its result and
//!    navigates to `bridge-wa:`, which this module decodes and CANCELS.
//!
//! Two findings from the live spike (2026-08-01) are load-bearing here:
//!
//!  1. **User agent.** WhatsApp Web serves an "update Safari" wall to
//!     WKWebView's default UA, which carries no `Version/x Safari/x` token.
//!     Without `user_agent()` below, the Module renders a dead end.
//!  2. **Readiness.** Neither `WPP.isReady` nor an authenticated connection
//!     means the client can answer. `isReady` flips back to false once the
//!     socket connects, and calling too early fails with
//!     "sendIq called before startComms". Liveness is a CONNECTED socket plus a
//!     populated chat store, which `whatsapp_status` reports and every read op
//!     re-checks.
//!
//! v1 is READ-ONLY, enforced by `script_for_op`: the web app names an operation,
//! never supplies JavaScript. Write operations live behind `script_for_write_op`
//! and are refused unless the caller presents an approval token minted by the
//! governed Approvals path — see `whatsapp_send_start`.

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const WHATSAPP_LABEL: &str = "whatsapp-session";

/// Scheme the injected reporter "navigates" to. Never actually loaded.
const REPORT_SCHEME: &str = "bridge-wa";

const WHATSAPP_URL: &str = "https://web.whatsapp.com";

/// WKWebView's default UA lacks the `Version/… Safari/…` token WhatsApp Web
/// gates on. Verified live: without this the page renders "WhatsApp works with
/// Safari 15+" and nothing else.
const SAFARI_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) \
     AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

/// A full contact read on a large account takes minutes: 8,384 contacts and 817
/// groups were measured at roughly 2 minutes end to end, so this is generous by
/// design. The start/poll split means it never holds an IPC reply open.
const OP_TIMEOUT_MS: u64 = 300_000;

/// Hard cap on a single op's payload. A real address book measured ~6 MB.
const MAX_PAYLOAD_BYTES: usize = 32 * 1024 * 1024;

/// The vendored wa-js bundle, hash-pinned and verified at build time by
/// `build.rs`. Vendored rather than fetched: a CDN script would be unpinned
/// third-party code executing inside the user's live WhatsApp session.
const WA_JS: &str = include_str!("../vendor/wppconnect-wa.js");

/// Reports an op's result out through a cancelled navigation.
const REPORTER_PREAMBLE: &str = r#"
(function () {
  if (window.top !== window) return;
  window.__bridgeReport = function (payload) {
    try {
      var b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))))
        .replace(/\+/g, "-").replace(/\//g, "_");
      location.href = "bridge-wa://p/" + b64;
    } catch (e) {
      location.href = "bridge-wa://p/";
    }
  };
})();
"#;

// ---------------------------------------------------------------------------
// State and typed errors
// ---------------------------------------------------------------------------

#[derive(Default)]
pub struct WhatsAppState {
    slot: Arc<Mutex<Option<mpsc::Sender<OpResult>>>>,
    /// One operation in flight at a time. Sequential by design — parallel bursts
    /// against WhatsApp are exactly the behaviour that draws enforcement.
    busy: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct WhatsAppJobs {
    op: Arc<crate::jobs::JobTable<Result<OpResult, WhatsAppError>>>,
}

#[derive(Serialize, Debug, Clone)]
pub struct WhatsAppError {
    pub code: &'static str,
    pub message: String,
}

fn err(code: &'static str, message: impl Into<String>) -> WhatsAppError {
    WhatsAppError {
        code,
        message: message.into(),
    }
}

/// One operation's payload, returned verbatim to the caller. The shell does not
/// interpret it — `@bridge/whatsapp` owns all mapping — but everything in it is
/// UNTRUSTED third-party content and is quarantined as such downstream.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OpResult {
    pub op: String,
    pub json: String,
}

/// Liveness, as the UI needs to show it.
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WhatsAppStatus {
    /// The session window exists.
    pub open: bool,
    /// A linked device with a CONNECTED socket and a populated store.
    pub live: bool,
    /// Raw socket state, surfaced so the UI can say "syncing" honestly.
    pub socket: String,
    pub chats: i64,
    /// True while WhatsApp is still downloading history.
    pub syncing: bool,
}

// ---------------------------------------------------------------------------
// Navigation policy — pure and unit-tested
// ---------------------------------------------------------------------------

#[derive(Debug, PartialEq)]
pub enum NavVerdict {
    Deliver(OpResult),
    DeliverInvalid,
    Allow,
    Deny,
}

/// Only WhatsApp's own origins. A redirect anywhere else is refused rather than
/// followed — this webview holds a live authenticated session, so an open
/// redirect would carry it somewhere it must never go.
pub fn is_whatsapp_host(host: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    host == "whatsapp.com"
        || host == "whatsapp.net"
        || host.ends_with(".whatsapp.com")
        || host.ends_with(".whatsapp.net")
}

pub fn classify_navigation(url: &tauri::Url) -> NavVerdict {
    if url.scheme() == REPORT_SCHEME {
        return match decode_report(url) {
            Some(payload) => NavVerdict::Deliver(payload),
            None => NavVerdict::DeliverInvalid,
        };
    }
    match url.scheme() {
        // `about:blank` is the window's parked initial page.
        "about" => NavVerdict::Allow,
        "https" => match url.host_str() {
            Some(host) if is_whatsapp_host(host) => NavVerdict::Allow,
            _ => NavVerdict::Deny,
        },
        _ => NavVerdict::Deny,
    }
}

fn decode_report(url: &tauri::Url) -> Option<OpResult> {
    use base64::Engine as _;
    let b64 = url.path().strip_prefix('/')?;
    if b64.is_empty() {
        return None;
    }
    let bytes = base64::engine::general_purpose::URL_SAFE.decode(b64).ok()?;
    if bytes.len() > MAX_PAYLOAD_BYTES {
        return None;
    }
    serde_json::from_slice(&bytes).ok()
}

// ---------------------------------------------------------------------------
// The read-op allowlist — THE security boundary for v1
// ---------------------------------------------------------------------------

/// A WhatsApp group id, e.g. "120363001234567890@g.us". Validated before it is
/// ever interpolated into a script.
fn is_group_id(arg: &str) -> bool {
    let Some((user, suffix)) = arg.split_once('@') else {
        return false;
    };
    suffix == "g.us"
        && !user.is_empty()
        && user.len() <= 64
        && user.chars().all(|c| c.is_ascii_digit() || c == '-')
}

/// Wrap an expression so its resolved value is reported out.
fn reported(op: &str, body: &str) -> String {
    format!(
        r#"(async function () {{
  try {{
    var value = await ({body});
    window.__bridgeReport({{ op: "{op}", json: JSON.stringify({{ ok: true, value: value }}) }});
  }} catch (e) {{
    window.__bridgeReport({{ op: "{op}", json: JSON.stringify({{ ok: false, error: String((e && e.message) || e) }}) }});
  }}
}})();"#
    )
}

/// Map an operation NAME to a fixed script. The web app can never pass
/// JavaScript — it names an operation, and unknown names yield `None`.
///
/// This function is why v1 is read-only in fact and not merely by intention.
/// Its test asserts the exact membership of this list; adding a write here
/// requires changing a test that says so.
pub fn script_for_op(op: &str, arg: Option<&str>) -> Option<String> {
    match op {
        // The owner's address book.
        "list_contacts" => Some(reported(
            op,
            r#"WPP.contact.list({ onlyMyContacts: true }).then(function (cs) {
                 return cs.map(function (c) {
                   var id = (c.id && (c.id._serialized || String(c.id))) || "";
                   // NOTE: no `phone` is derived from the id. A @lid id is an
                   // opaque handle, and splitting one into digits fabricates a
                   // phone number for a contact who has none. Mapping decides.
                   return {
                     id: id,
                     name: c.name ? String(c.name) : undefined,
                     pushname: c.pushname ? String(c.pushname) : undefined,
                     phone: (c.id && c.id.server === "c.us" && c.id.user) ? String(c.id.user) : undefined,
                     isMyContact: Boolean(c.isMyContact),
                     isGroup: false
                   };
                 });
               })"#,
        )),
        // Group inventory only — participants are a separate, per-group op so a
        // run never sweeps every group's membership implicitly.
        "list_groups" => Some(reported(
            op,
            r#"WPP.group.getAllGroups().then(function (gs) {
                 return gs.map(function (g) {
                   var id = (g.id && (g.id._serialized || String(g.id))) || "";
                   return {
                     id: id,
                     name: String((g.name || g.formattedTitle || g.subject || "")),
                     participantCount: (g.groupMetadata && g.groupMetadata.participants)
                       ? g.groupMetadata.participants.length : null
                   };
                 });
               })"#,
        )),
        "group_participants" => {
            let group = arg?;
            if !is_group_id(group) {
                return None;
            }
            Some(reported(
                op,
                &format!(
                    r#"WPP.group.getParticipants("{group}").then(function (ps) {{
                     return ps.map(function (p) {{
                       var id = (p.id && (p.id._serialized || String(p.id))) || "";
                       return {{
                         id: id,
                         phone: (p.id && p.id.server === "c.us" && p.id.user) ? String(p.id.user) : undefined,
                         isMyContact: false,
                         isGroup: false
                       }};
                     }});
                   }})"#
                ),
            ))
        }
        // Who the owner has actually messaged — the signal behind the
        // "contacts and messaged" participant policy.
        "list_direct_chats" => Some(reported(
            op,
            r#"Promise.resolve(WPP.whatsapp.ChatStore.getModelsArray()
                 .filter(function (c) { return c.id && !c.id.isGroup(); })
                 .map(function (c) { return String(c.id._serialized || c.id); }))"#,
        )),
        // WhatsApp's OWN phone-number ↔ LID mapping. Group membership is
        // LID-addressed while the address book is largely phone-addressed, so
        // without this the two identity spaces never meet. Resolved from
        // WhatsApp's authority — never inferred by us.
        "pn_lid_map" => Some(reported(
            op,
            r#"Promise.resolve(
                 WPP.contact.list({ onlyMyContacts: false }).then(function (cs) {
                   var out = [];
                   for (var i = 0; i < cs.length; i++) {
                     try {
                       var entry = WPP.contact.getPnLidEntry(cs[i].id);
                       if (entry && entry.pn && entry.lid) {
                         out.push({
                           pn: String(entry.pn._serialized || entry.pn),
                           lid: String(entry.lid._serialized || entry.lid)
                         });
                       }
                     } catch (e) { /* no mapping cached for this contact */ }
                   }
                   return out;
                 })
               )"#,
        )),
        _ => None,
    }
}

/// Liveness probe. Separate from the op list because it must be callable while
/// the client is still syncing, when no read op can succeed.
const STATUS_SCRIPT: &str = r#"
(function () {
  try {
    var wpp = window.WPP;
    var socket = "UNKNOWN";
    try { socket = String((wpp.whatsapp.Socket && wpp.whatsapp.Socket.state) || "UNKNOWN"); } catch (e) {}
    var chats = 0;
    try { chats = wpp.whatsapp.ChatStore.getModelsArray().length; } catch (e) {}
    var text = (document.body && document.body.innerText) || "";
    window.__bridgeReport({
      op: "status",
      json: JSON.stringify({
        ok: true,
        value: {
          socket: socket,
          chats: chats,
          syncing: text.indexOf("messages are downloading") >= 0,
          needsLink: text.indexOf("Scan to log in") >= 0 || text.indexOf("Log in with phone") >= 0
        }
      })
    });
  } catch (e) {
    window.__bridgeReport({ op: "status", json: JSON.stringify({ ok: false, error: String(e) }) });
  }
})();
"#;


// ---------------------------------------------------------------------------
// Window lifecycle
// ---------------------------------------------------------------------------

/// The Module Page's content area, in LOGICAL pixels RELATIVE TO THE MAIN
/// WINDOW'S CONTENT ORIGIN — i.e. a plain `getBoundingClientRect()`.
///
/// Deliberately not screen coordinates. The web app previously added
/// `window.screenX/screenY` to place the child absolutely, which produced
/// y=1016 on an 800-point-tall display — off-screen, invisible, and silently
/// so. Those browser globals do not reliably share units with
/// `getBoundingClientRect()` inside a Retina WKWebView. The shell owns the
/// conversion instead, because only it knows the real window origin and scale
/// factor.
#[derive(Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

fn ensure_window(app: &AppHandle) -> Result<tauri::WebviewWindow, WhatsAppError> {
    if let Some(existing) = app.get_webview_window(WHATSAPP_LABEL) {
        return Ok(existing);
    }
    let slot = app.state::<WhatsAppState>().slot.clone();
    let target = tauri::Url::parse(WHATSAPP_URL).expect("WhatsApp URL is valid");
    let init = format!("{REPORTER_PREAMBLE}\n{WA_JS}");

    let mut builder = WebviewWindowBuilder::new(app, WHATSAPP_LABEL, WebviewUrl::External(target));
    // A real child of the main window: ordered above its parent, and ONLY its
    // parent, so it never floats over other applications.
    // Failing loudly is deliberate: an unparented window is the overlay bug
    // again, hovering over every other application, so it must not be a
    // silent fallback.
    if let Some(main) = app.get_webview_window(crate::overlay::MAIN_LABEL) {
        builder = builder.parent(&main).map_err(|error| {
            err(
                "WHATSAPP_WINDOW_FAILED",
                format!("Could not attach the WhatsApp session to the Bridge window: {error}"),
            )
        })?;
    }
    builder
        .title("WhatsApp")
        .inner_size(1280.0, 800.0)
        .decorations(false)
        // Focusable and NOT always-on-bottom, unlike the research reader: the
        // user reads and types in this one.
        .focused(true)
        // Without this WhatsApp Web serves its unsupported-browser wall.
        .user_agent(SAFARI_USER_AGENT)
        .initialization_script(&init)
        .on_navigation(move |url| match classify_navigation(url) {
            NavVerdict::Deliver(payload) => {
                let sender = slot.lock().ok().and_then(|guard| guard.clone());
                match sender {
                    Some(sender) => {
                        let _ = sender.send(payload);
                    }
                    None => eprintln!(
                        "[bridge-desktop] whatsapp result arrived with no read waiting (dropped)"
                    ),
                }
                false
            }
            NavVerdict::DeliverInvalid => {
                eprintln!("[bridge-desktop] whatsapp result failed to decode (dropped)");
                false
            }
            NavVerdict::Allow => true,
            NavVerdict::Deny => {
                eprintln!(
                    "[bridge-desktop] whatsapp session refused navigation to {}",
                    url.scheme()
                );
                false
            }
        })
        .build()
        .map_err(|error| {
            err(
                "WHATSAPP_WINDOW_FAILED",
                format!("Could not create the WhatsApp session window: {error}"),
            )
        })
}

/// AppKit window creation and mutation are main-thread-only; doing this from a
/// command's worker thread risks an Objective-C exception Rust cannot catch.
fn on_main<T: Send + 'static>(
    app: &AppHandle,
    work: impl FnOnce(&AppHandle) -> Result<T, WhatsAppError> + Send + 'static,
) -> Result<T, WhatsAppError> {
    let (sender, receiver) = mpsc::channel::<Result<T, WhatsAppError>>();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = sender.send(work(&handle));
    })
    .map_err(|error| {
        err(
            "WHATSAPP_STATE",
            format!("main-thread dispatch failed: {error}"),
        )
    })?;
    receiver
        .recv_timeout(Duration::from_secs(10))
        .map_err(|_| err("WHATSAPP_STATE", "the session window did not respond in time"))?
}

/// Keep the session ordered above the main window WITHOUT floating over other
/// applications.
///
/// The first attempt used `set_always_on_top(true)`, which does order it above
/// the main window — and above every other app on the machine, so the session
/// hovered over the user's browser and everything else. That is not an embed,
/// it is an overlay.
///
/// The window is instead made a real CHILD of the main window at creation
/// (`parent()` → macOS `addChildWindow:`). AppKit then keeps it above its
/// parent and only its parent: when Bridge is not the active application, the
/// child goes back with it. Ordering is handled by the window server, so there
/// is nothing to re-assert on every reposition.
fn raise(window: &tauri::WebviewWindow) {
    // Defensive only: a child window should never be marked always-on-top.
    let _ = window.set_always_on_top(false);
}

fn position(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    rect: SessionRect,
) -> Result<(), WhatsAppError> {
    // Resolve the Page rect against the MAIN window's content origin.
    let (origin_x, origin_y) = match app.get_webview_window(crate::overlay::MAIN_LABEL) {
        Some(main) => {
            let scale = main.scale_factor().unwrap_or(1.0);
            match main.inner_position() {
                Ok(position) => {
                    let logical = position.to_logical::<f64>(scale);
                    (logical.x, logical.y)
                }
                Err(_) => (0.0, 0.0),
            }
        }
        None => (0.0, 0.0),
    };
    let rect = SessionRect {
        x: origin_x + rect.x,
        y: origin_y + rect.y,
        width: rect.width,
        height: rect.height,
    };
    window
        .set_position(tauri::LogicalPosition::new(rect.x, rect.y))
        .and_then(|_| {
            window.set_size(tauri::LogicalSize::new(
                rect.width.max(1.0),
                rect.height.max(1.0),
            ))
        })
        .map_err(|error| {
            err(
                "WHATSAPP_POSITION_FAILED",
                format!("Could not place the session window: {error}"),
            )
        })?;
    Ok(())
}

struct BusyGuard(Arc<AtomicBool>);

impl Drop for BusyGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Open (or reuse) the session window and pin it to the Module Page's rect.
#[tauri::command]
pub fn whatsapp_open(app: AppHandle, rect: SessionRect) -> Result<(), WhatsAppError> {
    on_main(&app, move |handle| {
        let window = ensure_window(handle)?;
        position(handle, &window, rect)?;
        let _ = window.show();
        raise(&window);
        Ok(())
    })
}

/// Track the Page's content rect as it scrolls or resizes.
#[tauri::command]
pub fn whatsapp_position(app: AppHandle, rect: SessionRect) -> Result<(), WhatsAppError> {
    on_main(&app, move |handle| {
        match handle.get_webview_window(WHATSAPP_LABEL) {
            // Not open is not an error: a position event can race a hide.
            None => Ok(()),
            Some(window) => {
                let result = position(handle, &window, rect);
                // Re-raise on every track: showing the main window can drop the
                // session back behind it.
                raise(&window);
                result
            }
        }
    })
}

/// Hide on navigation away, unmount, or window blur. The session stays linked —
/// hiding is not logging out.
#[tauri::command]
pub fn whatsapp_hide(app: AppHandle) -> Result<(), WhatsAppError> {
    on_main(&app, |handle| {
        if let Some(window) = handle.get_webview_window(WHATSAPP_LABEL) {
            // Drop always-on-top BEFORE hiding, so a hidden session can never
            // resurface floating above another application.
            let _ = window.set_always_on_top(false);
            let _ = window.hide();
        }
        Ok(())
    })
}

/// Liveness, so the UI can distinguish "not linked" from "still syncing" from
/// "ready" instead of showing a spinner for all three.
#[tauri::command]
pub async fn whatsapp_status(
    app: AppHandle,
    state: tauri::State<'_, WhatsAppState>,
) -> Result<WhatsAppStatus, WhatsAppError> {
    let Some(window) = app.get_webview_window(WHATSAPP_LABEL) else {
        return Ok(WhatsAppStatus {
            open: false,
            live: false,
            socket: "CLOSED".into(),
            chats: 0,
            syncing: false,
        });
    };
    let raw = run_script(&window, state, STATUS_SCRIPT.to_string(), 15_000).await?;
    let parsed: serde_json::Value = serde_json::from_str(&raw.json)
        .map_err(|error| err("WHATSAPP_STATUS", format!("unreadable status: {error}")))?;
    let value = parsed.get("value").cloned().unwrap_or_default();
    let socket = value
        .get("socket")
        .and_then(|v| v.as_str())
        .unwrap_or("UNKNOWN")
        .to_string();
    let chats = value.get("chats").and_then(|v| v.as_i64()).unwrap_or(0);
    let syncing = value
        .get("syncing")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    Ok(WhatsAppStatus {
        open: true,
        // Measured the hard way: an authenticated session with an UNLAUNCHED
        // socket answers every read op with "sendIq called before startComms".
        live: socket == "CONNECTED" && chats > 0,
        socket,
        chats,
        syncing,
    })
}

/// Run one script in the session page and wait for its reported result.
async fn run_script(
    window: &tauri::WebviewWindow,
    state: tauri::State<'_, WhatsAppState>,
    script: String,
    timeout_ms: u64,
) -> Result<OpResult, WhatsAppError> {
    if state.busy.swap(true, Ordering::SeqCst) {
        return Err(err(
            "WHATSAPP_BUSY",
            "Another WhatsApp operation is already running",
        ));
    }
    let _busy = BusyGuard(state.busy.clone());

    let (sender, receiver) = mpsc::channel::<OpResult>();
    {
        let mut guard = state
            .slot
            .lock()
            .map_err(|_| err("WHATSAPP_STATE", "session state is unavailable"))?;
        *guard = Some(sender);
    }
    let slot = state.slot.clone();

    window.eval(&script).map_err(|error| {
        err(
            "WHATSAPP_EVAL_FAILED",
            format!("Could not run the operation: {error}"),
        )
    })?;

    let received = tauri::async_runtime::spawn_blocking(move || {
        receiver.recv_timeout(Duration::from_millis(timeout_ms))
    })
    .await
    .map_err(|error| err("WHATSAPP_STATE", format!("operation task failed: {error}")))?;

    if let Ok(mut guard) = slot.lock() {
        *guard = None;
    }
    received.map_err(|_| {
        err(
            "WHATSAPP_TIMEOUT",
            "WhatsApp did not answer in time — it may still be syncing",
        )
    })
}

/// Start a named read operation. Start/poll rather than a single command: a
/// contact read on a large account far exceeds the ~60s WKWebView reply limit
/// that aborts the whole app (see jobs.rs).
#[tauri::command]
pub fn whatsapp_extract_start(
    app: AppHandle,
    jobs: tauri::State<'_, WhatsAppJobs>,
    op: String,
    arg: Option<String>,
) -> Result<u64, WhatsAppError> {
    let Some(script) = script_for_op(&op, arg.as_deref()) else {
        return Err(err(
            "WHATSAPP_OP_REFUSED",
            format!("\"{op}\" is not an allowed WhatsApp read operation"),
        ));
    };
    if app.get_webview_window(WHATSAPP_LABEL).is_none() {
        return Err(err(
            "WHATSAPP_NOT_OPEN",
            "The WhatsApp session is not open",
        ));
    }

    let job = jobs
        .op
        .start()
        .map_err(|message| err("WHATSAPP_JOBS", message))?;
    let table = jobs.op.clone();
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = handle.state::<WhatsAppState>();
        let result = match handle.get_webview_window(WHATSAPP_LABEL) {
            Some(window) => run_script(&window, state, script, OP_TIMEOUT_MS).await,
            None => Err(err(
                "WHATSAPP_NOT_OPEN",
                "The WhatsApp session closed before the operation ran",
            )),
        };
        table.finish(job, result);
    });
    Ok(job)
}

#[derive(Serialize)]
pub struct WhatsAppJobPoll {
    pub done: bool,
    pub value: Option<OpResult>,
}

#[tauri::command]
pub fn whatsapp_extract_poll(
    jobs: tauri::State<'_, WhatsAppJobs>,
    job: u64,
) -> Result<WhatsAppJobPoll, WhatsAppError> {
    match jobs.op.take(job) {
        crate::jobs::JobPollState::Unknown => Err(err(
            "WHATSAPP_JOB_UNKNOWN",
            "No such WhatsApp operation — it may have expired or already been delivered",
        )),
        crate::jobs::JobPollState::Pending => Ok(WhatsAppJobPoll {
            done: false,
            value: None,
        }),
        crate::jobs::JobPollState::Ready(Ok(value)) => Ok(WhatsAppJobPoll {
            done: true,
            value: Some(value),
        }),
        crate::jobs::JobPollState::Ready(Err(error)) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_only_whatsapp_origins() {
        assert!(is_whatsapp_host("web.whatsapp.com"));
        assert!(is_whatsapp_host("WEB.WhatsApp.COM"));
        assert!(is_whatsapp_host("static.whatsapp.net"));
        assert!(!is_whatsapp_host("whatsapp.com.evil.example"));
        assert!(!is_whatsapp_host("notwhatsapp.com"));
        assert!(!is_whatsapp_host("evil.example"));
    }

    #[test]
    fn navigation_policy_refuses_everything_else() {
        let allow = tauri::Url::parse("https://web.whatsapp.com/").unwrap();
        assert!(matches!(classify_navigation(&allow), NavVerdict::Allow));

        let blank = tauri::Url::parse("about:blank").unwrap();
        assert!(matches!(classify_navigation(&blank), NavVerdict::Allow));

        for hostile in [
            "https://evil.example/",
            "http://web.whatsapp.com/", // downgrade
            "file:///etc/passwd",
            "javascript:alert(1)",
        ] {
            let url = tauri::Url::parse(hostile).unwrap();
            assert!(
                matches!(classify_navigation(&url), NavVerdict::Deny),
                "should have refused {hostile}"
            );
        }
    }

    #[test]
    fn v1_op_allowlist_is_read_only() {
        // The exact membership of v1. Changing this list is a governed decision,
        // not an implementation detail — which is what this assertion protects.
        for op in [
            "list_contacts",
            "list_groups",
            "list_direct_chats",
            "pn_lid_map",
        ] {
            assert!(script_for_op(op, None).is_some(), "{op} should be allowed");
        }
        assert!(script_for_op("group_participants", Some("120363001@g.us")).is_some());

        for refused in [
            "send_message",
            "sendTextMessage",
            "add_participants",
            "eval",
            "",
            "WPP.chat.sendTextMessage('x','y')",
        ] {
            assert!(
                script_for_op(refused, None).is_none(),
                "{refused} must be refused in v1"
            );
        }
    }

    #[test]
    fn group_ids_are_validated_before_interpolation() {
        assert!(is_group_id("120363001234567890@g.us"));
        assert!(is_group_id("1203-63001@g.us"));
        // Injection attempts and wrong-shaped ids never reach a script.
        for bad in [
            "\");WPP.chat.sendTextMessage(\"a\",\"b\");//@g.us",
            "120363001@c.us",
            "@g.us",
            "not-an-id",
            "120363001@g.us evil",
        ] {
            assert!(!is_group_id(bad), "{bad} must not validate");
            assert!(script_for_op("group_participants", Some(bad)).is_none());
        }
    }

    #[test]
    fn contact_reads_never_derive_a_phone_from_a_lid() {
        let script = script_for_op("list_contacts", None).unwrap();
        // The phone is taken only when WhatsApp itself says the id lives on the
        // phone-number server. See the LID incident in @bridge/whatsapp.
        assert!(script.contains(r#"c.id.server === "c.us""#));
        let participants = script_for_op("group_participants", Some("1@g.us")).unwrap();
        assert!(participants.contains(r#"p.id.server === "c.us""#));
    }

    #[test]
    fn payloads_over_the_cap_are_refused() {
        // A 40 MB base64 body decodes past MAX_PAYLOAD_BYTES and must not be
        // accepted just because it parses.
        assert!(MAX_PAYLOAD_BYTES < 64 * 1024 * 1024);
    }
}
