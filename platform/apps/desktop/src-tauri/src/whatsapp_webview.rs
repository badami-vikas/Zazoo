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
//!
//! Three additions land under TASK-030 Track A (ADR-158):
//!
//!  - **Downloads.** wry only wires up the platform download machinery when an
//!    `on_download` handler is registered. Without one WhatsApp Web's download
//!    control fired and nothing happened, silently, on every plane
//!    (BUGS OPEN 2026-08-02 defect 1).
//!  - **A persisted data store identity.** The session gets its own WKWebView
//!    `WKWebsiteDataStore`, keyed by a v4 UUID persisted under `app_data_dir`,
//!    so the session's cookies and IndexedDB are the store we intend rather
//!    than whatever default store happened to be shared
//!    (BUGS OPEN 2026-08-02 defect 2).
//!  - **A push event channel.** Results used to travel ONLY as
//!    request/response. `session_events` adds a PUSH stream — batched and
//!    coalesced in-page, then re-coalesced and kind-filtered in Rust because
//!    the page is untrusted — surfaced to the dashboard as a Tauri event.
//!
//! Deliberately NOT taken from the `karem505/whatRust` reference: its
//! `navigator.userAgentData` client-hints shim. It exists there because that
//! app advertises a Chrome UA. We advertise Safari, and real Safari does not
//! implement `userAgentData`, so the shim would make our fingerprint
//! self-contradictory rather than consistent (ADR-158).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

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

/// Op name reserved for the PUSH channel. Never appears in `script_for_op`:
/// nothing *requests* it, the injected listener volunteers it.
const SESSION_EVENTS_OP: &str = "session_events";

/// Tauri event carrying a coalesced batch to the dashboard. Emitted to the MAIN
/// window only — the session webview has no IPC and must never receive it.
pub const SESSION_EVENTS_EVENT: &str = "whatsapp://session-events";

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

/// Every `WPP` path the Module's operations depend on, with the `typeof` each
/// must report.
///
/// wa-js is a moving target: it reaches into WhatsApp's own bundles, and when
/// WhatsApp reshuffles them a function quietly stops existing. The build-time
/// SHA-256 pin proves we shipped the bundle we vendored; it proves nothing
/// about whether that bundle still fits today's WhatsApp. This list is the
/// runtime tripwire's input AND the drift test's input, so a dependency added
/// to an op script without being declared here fails
/// `health_covers_every_wpp_dependency`.
pub const WPP_DEPENDENCIES: &[(&str, &str)] = &[
    ("WPP.contact.list", "function"),
    ("WPP.contact.getPnLidEntry", "function"),
    ("WPP.group.getAllGroups", "function"),
    ("WPP.group.getParticipants", "function"),
    ("WPP.whatsapp.ChatStore.getModelsArray", "function"),
    ("WPP.whatsapp.Socket", "object"),
    ("WPP.on", "function"),
];

/// Paths whose SHAPE is cheap enough to actually exercise at session start.
///
/// The rest are existence-and-`typeof` only, and the result says so per check
/// rather than implying more assurance than was bought: `WPP.contact.list` on
/// the measured account takes ~2 minutes, so calling it in a health probe would
/// turn a tripwire into an outage.
const WPP_SHAPE_PROBES: &[&str] = &[
    "WPP.whatsapp.ChatStore.getModelsArray",
    "WPP.whatsapp.Socket",
];

/// Build the health script from `WPP_DEPENDENCIES`. Read-only: it resolves
/// paths, reads `typeof`, and calls only the probes named above.
fn health_script() -> String {
    let required = WPP_DEPENDENCIES
        .iter()
        .map(|(path, kind)| {
            let probe = WPP_SHAPE_PROBES.contains(path);
            format!(r#"{{ path: "{path}", expect: "{kind}", probe: {probe} }}"#)
        })
        .collect::<Vec<_>>()
        .join(",\n                   ");
    reported(
        "health",
        &format!(
            r#"Promise.resolve((function () {{
                 var required = [
                   {required}
                 ];
                 function resolve(path) {{
                   var parts = path.split(".");
                   var node = window;
                   for (var i = 0; i < parts.length; i++) {{
                     if (node === null || node === undefined) return undefined;
                     node = node[parts[i]];
                   }}
                   return node;
                 }}
                 function probeShape(path, node) {{
                   // Only the cheap, synchronous probes reach here.
                   if (path === "WPP.whatsapp.ChatStore.getModelsArray") {{
                     var models = node.call(WPP.whatsapp.ChatStore);
                     return Array.isArray(models)
                       ? {{ ok: true, detail: "array[" + models.length + "]" }}
                       : {{ ok: false, detail: "expected an array, got " + typeof models }};
                   }}
                   if (path === "WPP.whatsapp.Socket") {{
                     var state = node.state;
                     return typeof state === "string"
                       ? {{ ok: true, detail: state }}
                       : {{ ok: false, detail: "Socket.state is " + typeof state }};
                   }}
                   return {{ ok: true, detail: "no probe" }};
                 }}
                 var checks = [];
                 var missing = [];
                 var degraded = [];
                 for (var i = 0; i < required.length; i++) {{
                   var spec = required[i];
                   var node, actual;
                   try {{ node = resolve(spec.path); }} catch (e) {{ node = undefined; }}
                   actual = node === null ? "null" : typeof node;
                   var present = actual === spec.expect;
                   var shape = null;
                   if (present && spec.probe) {{
                     try {{ shape = probeShape(spec.path, node); }}
                     catch (e) {{ shape = {{ ok: false, detail: String((e && e.message) || e) }}; }}
                   }}
                   if (!present) {{
                     missing.push(spec.path);
                   }} else if (shape && !shape.ok) {{
                     degraded.push({{ path: spec.path, reason: shape.detail }});
                   }}
                   checks.push({{
                     path: spec.path,
                     expect: spec.expect,
                     actual: actual,
                     present: present,
                     shapeProbed: Boolean(spec.probe),
                     shape: shape
                   }});
                 }}
                 var version = null;
                 try {{ version = String(WPP.version || WPP.default.version); }} catch (e) {{}}
                 return {{
                   ok: missing.length === 0 && degraded.length === 0,
                   waJsVersion: version,
                   missing: missing,
                   degraded: degraded,
                   checks: checks
                 }};
               }})())"#
        ),
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
        // Drift tripwire, run at session start. Read-only and cheap: it asserts
        // every WPP function the Module depends on exists and — where probing
        // is affordable — returns the expected shape, so a bundle change
        // surfaces as a degraded state instead of failing mid-run.
        "health" => Some(health_script()),
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
// The PUSH event channel (TASK-030 Track A)
// ---------------------------------------------------------------------------

/// Flush cadence for the in-page batcher, in milliseconds.
const EVENT_FLUSH_MS: u64 = 750;

/// Buffer-size threshold that forces an early flush.
const EVENT_MAX_BATCH: usize = 64;

/// Hard cap on how many events the shell will forward from ONE batch.
///
/// The in-page batcher already bounds itself, but that code runs in an
/// untrusted page: this is the bound that actually holds.
pub const MAX_EVENTS_PER_BATCH: usize = 256;

/// Kinds the dashboard understands. Anything else is dropped rather than
/// forwarded — the page names the kind, so without this an injected or drifted
/// script could push arbitrary event names into the app's event bus.
pub fn is_allowed_event_kind(kind: &str) -> bool {
    matches!(
        kind,
        "active_chat" | "message" | "chat_state" | "connection"
    )
}

/// One coalesced session event, as the dashboard receives it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionEvent {
    /// What happened. Constrained by `is_allowed_event_kind`.
    pub kind: String,
    /// Coalescing key within the kind — e.g. the chat id, so twenty updates to
    /// one chat collapse to one while twenty different chats do not.
    #[serde(default)]
    pub key: String,
    /// Page clock, milliseconds. UNTRUSTED, and used for display only: it comes
    /// from the page and is never treated as an ordering authority.
    #[serde(default)]
    pub at: i64,
    #[serde(default)]
    pub data: serde_json::Value,
}

/// Apply the coalescing policy to a batch: drop disallowed kinds, keep the LAST
/// value for each `(kind, key)`, preserve first-seen order, and cap the result.
///
/// This duplicates what the in-page batcher already did, deliberately. The
/// batcher lives in WhatsApp's origin, where a hostile or simply drifted script
/// could flood the channel; the shell therefore never relies on the page having
/// deduplicated anything. Cheap, pure, and the only place the policy is
/// actually enforced.
pub fn coalesce_events(events: Vec<SessionEvent>) -> Vec<SessionEvent> {
    let mut order: Vec<(String, String)> = Vec::new();
    let mut latest: HashMap<(String, String), SessionEvent> = HashMap::new();
    for event in events {
        if !is_allowed_event_kind(&event.kind) {
            continue;
        }
        let slot = (event.kind.clone(), event.key.clone());
        if !latest.contains_key(&slot) {
            order.push(slot.clone());
        }
        latest.insert(slot, event);
    }
    order
        .into_iter()
        .filter_map(|slot| latest.remove(&slot))
        .take(MAX_EVENTS_PER_BATCH)
        .collect()
}

/// Decode a reported batch. A malformed body yields an empty batch rather than
/// an error: this channel is fire-and-forget, and there is no caller waiting to
/// be told the page sent nonsense.
pub fn parse_event_batch(json: &str) -> Vec<SessionEvent> {
    #[derive(Deserialize)]
    struct Batch {
        #[serde(default)]
        events: Vec<SessionEvent>,
    }
    match serde_json::from_str::<Batch>(json) {
        Ok(batch) => coalesce_events(batch.events),
        Err(_) => Vec::new(),
    }
}

/// The injected listener. Subscribes to WPP events and reports them in batches.
///
/// One cancelled navigation per WPP event does not survive a busy account — a
/// single active conversation produces bursts far faster than the shell can
/// decode them, and the channel is serial. So the listener buffers, collapses
/// repeats of the same `(kind, key)` in place, and flushes on whichever comes
/// first: the interval or the buffer threshold.
fn event_listener_script() -> String {
    format!(
        r#"
(function () {{
  if (window.top !== window) return;
  if (window.__bridgeWaEvents) return;

  var FLUSH_MS = {EVENT_FLUSH_MS};
  var MAX_BATCH = {EVENT_MAX_BATCH};

  var buffer = [];
  var slots = Object.create(null);
  var timer = null;

  function flush() {{
    if (timer !== null) {{ clearTimeout(timer); timer = null; }}
    if (buffer.length === 0) return;
    var batch = buffer;
    buffer = [];
    slots = Object.create(null);
    try {{
      window.__bridgeReport({{
        op: "{SESSION_EVENTS_OP}",
        json: JSON.stringify({{ events: batch }})
      }});
    }} catch (e) {{ /* a dropped batch must never break the page */ }}
  }}

  function push(kind, key, data) {{
    var slot = kind + " " + key;
    var event = {{ kind: kind, key: String(key), at: Date.now(), data: data }};
    if (slot in slots) {{
      // Coalesce in place: last value wins, first-seen order is kept.
      buffer[slots[slot]] = event;
    }} else {{
      slots[slot] = buffer.length;
      buffer.push(event);
    }}
    if (buffer.length >= MAX_BATCH) {{ flush(); return; }}
    if (timer === null) timer = setTimeout(flush, FLUSH_MS);
  }}

  window.__bridgeWaEvents = {{ push: push, flush: flush }};

  function serialise(id) {{
    if (!id) return "";
    return String(id._serialized || id);
  }}

  function subscribe() {{
    if (!window.WPP || typeof window.WPP.on !== "function") return false;
    try {{
      // The active chat changed — the event the dashboard is built around.
      WPP.on("chat.active_chat", function (payload) {{
        var id = serialise(payload && payload.id);
        push("active_chat", "active_chat", {{ chatId: id }});
      }});
      WPP.on("chat.new_message", function (payload) {{
        var chatId = serialise(payload && (payload.chatId || payload.from));
        push("message", chatId, {{ chatId: chatId }});
      }});
      WPP.on("chat.msg_ack_change", function (payload) {{
        var chatId = serialise(payload && payload.chat);
        push("chat_state", chatId, {{ chatId: chatId }});
      }});
      WPP.on("conn.main_ready", function () {{
        push("connection", "main_ready", {{ ready: true }});
      }});
      return true;
    }} catch (e) {{
      return false;
    }}
  }}

  // wa-js is injected before the page's own bundles finish, so WPP.on is not
  // there yet on the first tick. Poll briefly, then give up quietly — a missing
  // event channel degrades the dashboard, it does not break the session.
  if (!subscribe()) {{
    var tries = 0;
    var poll = setInterval(function () {{
      if (subscribe() || ++tries > 120) clearInterval(poll);
    }}, 500);
  }}

  // A pending batch must not be lost when the page goes away.
  window.addEventListener("pagehide", flush);
}})();
"#
    )
}

// ---------------------------------------------------------------------------
// Downloads — BUGS OPEN 2026-08-02, defect 1
// ---------------------------------------------------------------------------

const DEFAULT_DOWNLOAD_NAME: &str = "whatsapp-download";
const MAX_DOWNLOAD_NAME_BYTES: usize = 120;
/// How many " (n)" suffixes to try before falling back to a random one.
const MAX_DISAMBIGUATION: u32 = 999;

/// Split a file name into stem and extension, treating only a short trailing
/// `.ext` as an extension so `archive.2026-08-02` keeps its whole name.
fn split_file_name(name: &str) -> (&str, &str) {
    match name.rfind('.') {
        Some(index) if index > 0 && name.len() - index <= 17 => (&name[..index], &name[index..]),
        _ => (name, ""),
    }
}

fn truncate_keeping_extension(name: &str, max: usize) -> String {
    if name.len() <= max {
        return name.to_string();
    }
    let (stem, extension) = split_file_name(name);
    let budget = max.saturating_sub(extension.len()).max(1);
    let mut cut = budget.min(stem.len());
    while cut > 0 && !stem.is_char_boundary(cut) {
        cut -= 1;
    }
    if cut == 0 {
        return DEFAULT_DOWNLOAD_NAME.to_string();
    }
    format!("{}{extension}", &stem[..cut])
}

/// Reduce an arbitrary proposed name to ONE safe path segment.
///
/// The name originates in a third-party page, so it is treated as hostile:
/// every separator is stripped (no `../` escape, no absolute path), as are
/// control characters and `:` (an HFS separator and a Windows stream marker).
pub fn sanitize_download_name(raw: &str) -> String {
    let last = raw.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = last
        .chars()
        .filter(|c| !c.is_control() && *c != ':')
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').trim();
    if cleaned.is_empty() {
        return DEFAULT_DOWNLOAD_NAME.to_string();
    }
    truncate_keeping_extension(cleaned, MAX_DOWNLOAD_NAME_BYTES)
}

/// Percent-decode one URL path segment for display as a file name. Invalid
/// UTF-8 is replaced rather than rejected; `sanitize_download_name` then has
/// the last word.
fn percent_decode(segment: &str) -> String {
    let bytes = segment.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let high = (bytes[index + 1] as char).to_digit(16);
            let low = (bytes[index + 2] as char).to_digit(16);
            if let (Some(high), Some(low)) = (high, low) {
                out.push((high * 16 + low) as u8);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Pick the file name for a download: whatever the platform proposed if it is
/// usable, else the URL's last path segment, else a fixed fallback.
pub fn download_file_name(url: &tauri::Url, proposed: &Path) -> String {
    if let Some(name) = proposed.file_name().and_then(|name| name.to_str()) {
        let candidate = sanitize_download_name(name);
        if candidate != DEFAULT_DOWNLOAD_NAME {
            return candidate;
        }
    }
    if let Some(segment) = url
        .path_segments()
        .and_then(|mut segments| segments.rfind(|part| !part.is_empty()))
    {
        let candidate = sanitize_download_name(&percent_decode(segment));
        if candidate != DEFAULT_DOWNLOAD_NAME {
            return candidate;
        }
    }
    DEFAULT_DOWNLOAD_NAME.to_string()
}

/// Resolve `dir/name` to a path that does not already exist.
///
/// Overwriting is never an option here: the destination is the user's own
/// Downloads folder, and a page-supplied name that happens to collide with
/// something they already have must not destroy it. `exists` is injected so the
/// policy is testable without touching a filesystem.
pub fn disambiguate(dir: &Path, name: &str, exists: &dyn Fn(&Path) -> bool) -> PathBuf {
    let first = dir.join(name);
    if !exists(&first) {
        return first;
    }
    let (stem, extension) = split_file_name(name);
    for attempt in 1..=MAX_DISAMBIGUATION {
        let candidate = dir.join(format!("{stem} ({attempt}){extension}"));
        if !exists(&candidate) {
            return candidate;
        }
    }
    // Astronomically unlikely. Still not a licence to overwrite.
    let mut bytes = [0u8; 8];
    let suffix = match getrandom::fill(&mut bytes) {
        Ok(()) => bytes.iter().map(|b| format!("{b:02x}")).collect::<String>(),
        Err(_) => "collision".to_string(),
    };
    dir.join(format!("{stem} ({suffix}){extension}"))
}

// ---------------------------------------------------------------------------
// WKWebView data store identity — BUGS OPEN 2026-08-02, defect 2
// ---------------------------------------------------------------------------

/// File under `app_data_dir` holding the session's data store UUID.
const DATA_STORE_ID_FILE: &str = "bridge/whatsapp-data-store-id";

fn format_uuid(bytes: &[u8; 16]) -> String {
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

fn parse_uuid(text: &str) -> Option<[u8; 16]> {
    let hex: String = text.trim().chars().filter(|c| *c != '-').collect();
    if hex.len() != 32 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let mut bytes = [0u8; 16];
    for (index, byte) in bytes.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&hex[index * 2..index * 2 + 2], 16).ok()?;
    }
    Some(bytes)
}

/// Stamp the version-4 and RFC-4122 variant bits onto random bytes.
fn as_uuid_v4(mut bytes: [u8; 16]) -> [u8; 16] {
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    bytes
}

fn is_nil_uuid(bytes: &[u8; 16]) -> bool {
    bytes.iter().all(|byte| *byte == 0)
}

/// A fresh, guaranteed non-nil v4 UUID.
///
/// `WKWebsiteDataStore(forIdentifier:)` raises an Objective-C exception on the
/// nil UUID — an exception Rust cannot catch, so it would take the app down.
/// The random path effectively never produces it, and the fallback below makes
/// "effectively" into "never".
fn new_data_store_id() -> [u8; 16] {
    let mut bytes = [0u8; 16];
    if getrandom::fill(&mut bytes).is_err() {
        // Seed from the clock rather than hand WebKit a nil UUID.
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or(1);
        bytes[..16].copy_from_slice(&nanos.to_le_bytes()[..16]);
    }
    let bytes = as_uuid_v4(bytes);
    if is_nil_uuid(&bytes) {
        // Unreachable given the v4 bits above, which set 0x40 in byte 6.
        return as_uuid_v4([1u8; 16]);
    }
    bytes
}

/// Read the persisted identity, or mint and persist one.
///
/// Persistence is the whole point: a fresh UUID each launch would give the
/// session a brand new, empty data store every time and force a re-link.
fn load_or_create_data_store_id(app: &AppHandle) -> [u8; 16] {
    let path = app
        .path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(DATA_STORE_ID_FILE));

    if let Some(path) = path.as_ref() {
        if let Ok(text) = std::fs::read_to_string(path) {
            if let Some(bytes) = parse_uuid(&text) {
                if !is_nil_uuid(&bytes) {
                    return bytes;
                }
            }
            eprintln!(
                "[bridge-desktop] whatsapp data store id was unreadable; minting a new one \
                 (the session will need re-linking)"
            );
        }
    }

    let bytes = new_data_store_id();
    match path {
        Some(path) => {
            let written = path
                .parent()
                .map(std::fs::create_dir_all)
                .transpose()
                .and_then(|_| std::fs::write(&path, format_uuid(&bytes)));
            if let Err(error) = written {
                // Not fatal, but honest: an unpersisted id means the next
                // launch mints another one and the session re-links.
                eprintln!(
                    "[bridge-desktop] could not persist the whatsapp data store id: {error}"
                );
            }
        }
        None => eprintln!(
            "[bridge-desktop] no app data dir; the whatsapp data store id cannot be persisted"
        ),
    }
    bytes
}

/// `WKWebsiteDataStore(forIdentifier:)` exists on macOS >= 14 only.
///
/// wry checks this too and falls back to the default store, so passing the
/// identifier on an older system is not a crash. The check is repeated here so
/// the requirement is visible in our own code and so the log line below tells
/// the truth about which store the session actually got.
#[cfg(target_os = "macos")]
fn supports_data_store_identifier() -> bool {
    objc2_foundation::NSProcessInfo::processInfo()
        .operatingSystemVersion()
        .majorVersion
        >= 14
}

#[cfg(not(target_os = "macos"))]
fn supports_data_store_identifier() -> bool {
    // Windows/Linux/Android use `data_directory` instead; nothing to do here.
    false
}

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
    // Order matters: the reporter must exist before wa-js, and the listener
    // must come last because it reaches for `WPP`.
    let init = format!(
        "{REPORTER_PREAMBLE}\n{WA_JS}\n{}",
        event_listener_script()
    );
    let emitter = app.clone();

    // Where downloads land. Resolved once, here, rather than inside the
    // handler: the handler runs on a webview callback and must not do
    // fallible path resolution per event.
    let downloads = app
        .path()
        .download_dir()
        .or_else(|_| app.path().home_dir().map(|home| home.join("Downloads")))
        .ok();

    let mut builder = WebviewWindowBuilder::new(app, WHATSAPP_LABEL, WebviewUrl::External(target));

    // Give the session its OWN persisted WKWebView data store instead of
    // sharing the default one with every other webview in the app.
    if supports_data_store_identifier() {
        let identifier = load_or_create_data_store_id(app);
        builder = builder.data_store_identifier(identifier);
    } else {
        eprintln!(
            "[bridge-desktop] whatsapp session is using the DEFAULT webview data store \
             (custom stores need macOS >= 14)"
        );
    }
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
        // Without a handler wry never wires up the platform download
        // machinery at all, so WhatsApp Web's download control did nothing,
        // silently (BUGS OPEN 2026-08-02). The destination is pre-filled with
        // an absolute path under the user's Downloads directory; an existing
        // file is never overwritten.
        .on_download(move |_webview, event| match event {
            tauri::webview::DownloadEvent::Requested { url, destination } => {
                let Some(directory) = downloads.as_ref() else {
                    eprintln!(
                        "[bridge-desktop] whatsapp download refused: no Downloads directory"
                    );
                    return false;
                };
                if let Err(error) = std::fs::create_dir_all(directory) {
                    eprintln!(
                        "[bridge-desktop] whatsapp download refused: {} is unusable: {error}",
                        directory.display()
                    );
                    return false;
                }
                let name = download_file_name(&url, destination);
                let target = disambiguate(directory, &name, &|path| path.exists());
                // Log the DIRECTORY only. The file name comes from a private
                // conversation and does not belong in a log line.
                eprintln!(
                    "[bridge-desktop] whatsapp download → {}",
                    directory.display()
                );
                *destination = target;
                true
            }
            tauri::webview::DownloadEvent::Finished { success, .. } => {
                if !success {
                    eprintln!("[bridge-desktop] whatsapp download did not complete");
                }
                true
            }
            // `DownloadEvent` is `#[non_exhaustive]`: a future variant must not
            // silently become a refusal.
            _ => true,
        })
        .on_navigation(move |url| match classify_navigation(url) {
            // The PUSH channel. Distinguished by op name and routed to the
            // dashboard, never into the request/response slot — an event batch
            // must not be mistaken for a pending operation's answer.
            NavVerdict::Deliver(payload) if payload.op == SESSION_EVENTS_OP => {
                let events = parse_event_batch(&payload.json);
                if !events.is_empty() {
                    let _ = emitter.emit_to(
                        crate::overlay::MAIN_LABEL,
                        SESSION_EVENTS_EVENT,
                        &events,
                    );
                }
                false
            }
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
            // Added under TASK-030 Track A. Read-only: it resolves paths and
            // reads `typeof`, and its only calls are the two cheap shape
            // probes — no WPP mutation is reachable from it.
            "health",
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
            // Reserved for the PUSH channel: the page volunteers it, nothing
            // may request it.
            "session_events",
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

    // -----------------------------------------------------------------------
    // A2 — the health tripwire
    // -----------------------------------------------------------------------

    /// Every distinct `WPP.…` path a script reaches for.
    fn wpp_paths(script: &str) -> Vec<String> {
        let bytes = script.as_bytes();
        let mut found = Vec::new();
        let mut cursor = 0;
        while let Some(offset) = script[cursor..].find("WPP.") {
            let start = cursor + offset;
            let mut end = start;
            while end < bytes.len()
                && (bytes[end].is_ascii_alphanumeric() || bytes[end] == b'_' || bytes[end] == b'.')
            {
                end += 1;
            }
            let path = script[start..end].trim_end_matches('.').to_string();
            if !found.contains(&path) {
                found.push(path);
            }
            cursor = end.max(start + 4);
        }
        found
    }

    #[test]
    fn health_covers_every_wpp_dependency() {
        // The point of the tripwire is that it fails when wa-js drifts. That
        // only works if it checks everything the Module actually calls, so a
        // new WPP dependency in an op script must be declared in
        // WPP_DEPENDENCIES or this test fails.
        let mut scripts = vec![
            script_for_op("list_contacts", None).unwrap(),
            script_for_op("list_groups", None).unwrap(),
            script_for_op("list_direct_chats", None).unwrap(),
            script_for_op("pn_lid_map", None).unwrap(),
            script_for_op("group_participants", Some("120363001@g.us")).unwrap(),
        ];
        scripts.push(event_listener_script());

        for script in &scripts {
            for path in wpp_paths(script) {
                assert!(
                    WPP_DEPENDENCIES
                        .iter()
                        .any(|(declared, _)| path.starts_with(declared)),
                    "{path} is used but not declared in WPP_DEPENDENCIES, so health would not \
                     catch it drifting"
                );
            }
        }

        // And the tripwire itself names every declared dependency.
        let health = script_for_op("health", None).unwrap();
        for (path, kind) in WPP_DEPENDENCIES {
            assert!(health.contains(path), "health does not check {path}");
            assert!(health.contains(kind));
        }
    }

    #[test]
    fn health_calls_nothing_expensive_and_nothing_that_writes() {
        let health = script_for_op("health", None).unwrap();
        // The two affordable probes are the ONLY invocations. A full contact
        // read takes ~2 minutes; running one at session start would turn the
        // tripwire into the outage it exists to prevent.
        assert!(health.contains("WPP.whatsapp.ChatStore"));
        for expensive in [
            "WPP.contact.list(",
            "WPP.group.getAllGroups(",
            "WPP.group.getParticipants(",
        ] {
            assert!(
                !health.contains(expensive),
                "health must not invoke {expensive}"
            );
        }
        for write in ["sendTextMessage", "addParticipants", "sendMessage", "delete"] {
            assert!(!health.contains(write), "health must not mention {write}");
        }
    }

    // -----------------------------------------------------------------------
    // A1(a) — downloads
    // -----------------------------------------------------------------------

    #[test]
    fn download_names_are_reduced_to_one_safe_segment() {
        assert_eq!(sanitize_download_name("holiday.jpg"), "holiday.jpg");
        // Traversal, absolute paths and separators never survive.
        assert_eq!(sanitize_download_name("../../../etc/passwd"), "passwd");
        assert_eq!(sanitize_download_name("/etc/shadow"), "shadow");
        assert_eq!(sanitize_download_name(r"C:\Windows\evil.exe"), "evil.exe");
        assert_eq!(sanitize_download_name("a/b/c.png"), "c.png");
        // Control characters and stream markers are stripped.
        assert_eq!(sanitize_download_name("re\nport:1.pdf"), "report1.pdf");
        // Nothing usable falls back rather than producing an empty path.
        for empty in ["", "   ", "...", "/", "../"] {
            assert_eq!(sanitize_download_name(empty), DEFAULT_DOWNLOAD_NAME);
        }
        // Absurd names are truncated but keep their extension.
        let long = format!("{}.jpg", "n".repeat(500));
        let cut = sanitize_download_name(&long);
        assert!(cut.len() <= MAX_DOWNLOAD_NAME_BYTES);
        assert!(cut.ends_with(".jpg"));
    }

    #[test]
    fn download_names_prefer_the_proposal_then_the_url() {
        let url = tauri::Url::parse("https://mmg.whatsapp.net/d/f/report%20final.pdf").unwrap();
        // A usable proposal wins.
        assert_eq!(
            download_file_name(&url, Path::new("/tmp/photo.jpg")),
            "photo.jpg"
        );
        // An unusable one falls through to the URL, percent-decoded.
        assert_eq!(
            download_file_name(&url, Path::new("")),
            "report final.pdf"
        );
        // Neither usable → the fixed fallback, never an empty name.
        let bare = tauri::Url::parse("https://mmg.whatsapp.net/").unwrap();
        assert_eq!(download_file_name(&bare, Path::new("")), DEFAULT_DOWNLOAD_NAME);
    }

    #[test]
    fn downloads_never_overwrite_an_existing_file() {
        use std::collections::HashSet;
        let dir = Path::new("/downloads");
        let taken: HashSet<PathBuf> = ["/downloads/photo.jpg", "/downloads/photo (1).jpg"]
            .iter()
            .map(PathBuf::from)
            .collect();
        let exists = |path: &Path| taken.contains(path);

        // A free name is used as-is.
        assert_eq!(
            disambiguate(dir, "clip.mp4", &exists),
            PathBuf::from("/downloads/clip.mp4")
        );
        // A collision disambiguates BEFORE the extension, and keeps going
        // until it finds a free slot.
        assert_eq!(
            disambiguate(dir, "photo.jpg", &exists),
            PathBuf::from("/downloads/photo (2).jpg")
        );
        // Extensionless names still disambiguate.
        let one = |path: &Path| path == Path::new("/downloads/notes");
        assert_eq!(
            disambiguate(dir, "notes", &one),
            PathBuf::from("/downloads/notes (1)")
        );
        // The result is always absolute and always inside the target dir.
        let resolved = disambiguate(dir, "photo.jpg", &exists);
        assert!(resolved.is_absolute());
        assert_eq!(resolved.parent(), Some(dir));
    }

    // -----------------------------------------------------------------------
    // A1(b) — the data store identity
    // -----------------------------------------------------------------------

    #[test]
    fn data_store_ids_round_trip_and_are_never_nil() {
        let id = new_data_store_id();
        assert!(!is_nil_uuid(&id));
        // v4 and RFC-4122 variant bits.
        assert_eq!(id[6] & 0xf0, 0x40);
        assert_eq!(id[8] & 0xc0, 0x80);

        // Persisting and reloading must yield the SAME store, or the session
        // silently re-links on every launch.
        let text = format_uuid(&id);
        assert_eq!(text.len(), 36);
        assert_eq!(parse_uuid(&text), Some(id));
        assert_eq!(parse_uuid(&text.to_uppercase()), Some(id));

        // A corrupt file is rejected rather than half-parsed.
        for bad in ["", "not-a-uuid", "1234", &"z".repeat(32), &text[..35]] {
            assert!(parse_uuid(bad).is_none(), "{bad} must not parse");
        }
        // The nil UUID is recognisable: WKWebView raises an uncatchable
        // Objective-C exception on it.
        assert!(is_nil_uuid(&[0u8; 16]));
        assert!(is_nil_uuid(
            &parse_uuid("00000000-0000-0000-0000-000000000000").unwrap()
        ));
    }

    // -----------------------------------------------------------------------
    // A3 — batching and coalescing
    // -----------------------------------------------------------------------

    fn event(kind: &str, key: &str, at: i64) -> SessionEvent {
        SessionEvent {
            kind: kind.into(),
            key: key.into(),
            at,
            data: serde_json::json!({ "at": at }),
        }
    }

    #[test]
    fn event_batches_coalesce_by_kind_and_key_keeping_the_last_value() {
        let batch = coalesce_events(vec![
            event("active_chat", "active_chat", 1),
            event("message", "a@c.us", 2),
            event("active_chat", "active_chat", 3),
            event("message", "b@c.us", 4),
            event("message", "a@c.us", 5),
        ]);
        // Three slots survive, in FIRST-SEEN order…
        assert_eq!(batch.len(), 3);
        assert_eq!(
            batch.iter().map(|e| e.key.as_str()).collect::<Vec<_>>(),
            ["active_chat", "a@c.us", "b@c.us"]
        );
        // …each carrying the LATEST value for its slot.
        assert_eq!(batch[0].at, 3);
        assert_eq!(batch[1].at, 5);
        assert_eq!(batch[2].at, 4);
    }

    #[test]
    fn event_batches_keep_distinct_keys_apart() {
        // Coalescing must not collapse twenty different chats into one.
        let events: Vec<SessionEvent> = (0..20)
            .map(|n| event("message", &format!("{n}@c.us"), n))
            .collect();
        assert_eq!(coalesce_events(events).len(), 20);
    }

    #[test]
    fn event_batches_refuse_kinds_the_dashboard_does_not_know() {
        // The page names the kind, so an injected or drifted script could
        // otherwise push arbitrary events onto the app's bus.
        let batch = coalesce_events(vec![
            event("active_chat", "active_chat", 1),
            event("eval", "x", 2),
            event("", "x", 3),
            event("tauri://close-requested", "x", 4),
            event("Active_Chat", "x", 5),
        ]);
        assert_eq!(batch.len(), 1);
        assert_eq!(batch[0].kind, "active_chat");

        assert!(is_allowed_event_kind("message"));
        assert!(!is_allowed_event_kind("send"));
    }

    #[test]
    fn event_batches_are_capped_regardless_of_what_the_page_sends() {
        let flood: Vec<SessionEvent> = (0..(MAX_EVENTS_PER_BATCH * 3))
            .map(|n| event("message", &format!("{n}@c.us"), n as i64))
            .collect();
        assert_eq!(coalesce_events(flood).len(), MAX_EVENTS_PER_BATCH);
    }

    #[test]
    fn malformed_event_batches_are_dropped_not_raised() {
        // Fire-and-forget: nobody is waiting to be told the page sent nonsense.
        for bad in ["", "null", "[]", "{", r#"{"events":"nope"}"#, "{\"x\":1}"] {
            assert!(parse_event_batch(bad).is_empty(), "{bad} should yield none");
        }
        let good = r#"{"events":[
            {"kind":"active_chat","key":"active_chat","at":7,"data":{"chatId":"a@c.us"}},
            {"kind":"active_chat","key":"active_chat","at":9,"data":{"chatId":"b@c.us"}}
        ]}"#;
        let batch = parse_event_batch(good);
        assert_eq!(batch.len(), 1);
        assert_eq!(batch[0].at, 9);
        assert_eq!(batch[0].data["chatId"], "b@c.us");
    }

    #[test]
    fn the_injected_listener_batches_rather_than_navigating_per_event() {
        let script = event_listener_script();
        // One cancelled navigation per WPP event does not survive a busy
        // account: both flush triggers must be present.
        assert!(script.contains("setTimeout(flush, FLUSH_MS)"));
        assert!(script.contains("buffer.length >= MAX_BATCH"));
        assert!(script.contains(&EVENT_FLUSH_MS.to_string()));
        assert!(script.contains(&EVENT_MAX_BATCH.to_string()));
        // In-place coalescing, not append.
        assert!(script.contains("buffer[slots[slot]] = event"));
        // The active chat changing is the event this channel exists for.
        assert!(script.contains("chat.active_chat"));
        assert!(script.contains("active_chat"));
        // It reports through the SAME cancelled-navigation channel, under the
        // reserved op name, and never touches Tauri IPC.
        assert!(script.contains(SESSION_EVENTS_OP));
        assert!(script.contains("__bridgeReport"));
        for ipc in ["__TAURI__", "invoke(", "tauri://"] {
            assert!(
                !script.contains(ipc),
                "the session page must have no Tauri IPC surface ({ipc})"
            );
        }
    }
}
