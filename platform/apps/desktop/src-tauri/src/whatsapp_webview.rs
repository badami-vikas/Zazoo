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
pub const SESSION_EVENTS_EVENT: &str = "whatsapp:session-events";

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
#[serde(rename_all = "camelCase")]
pub struct WhatsAppError {
    pub code: &'static str,
    pub message: String,
    /// When waiting would fix this, the instant to try again (epoch ms). Only
    /// the send ceiling sets it; a halt deliberately never does, because there
    /// is no time at which a halt clears itself.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub earliest_at_ms: Option<i64>,
}

fn err(code: &'static str, message: impl Into<String>) -> WhatsAppError {
    WhatsAppError {
        code,
        message: message.into(),
        earliest_at_ms: None,
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
    /// wa-js's own linkedness verdict (`WPP.conn.isAuthenticated()`).
    ///
    /// `None` means it could not be read — the UI must render that as
    /// unknown, never as linked. The socket state is NOT a substitute: an
    /// unlinked session showing the QR also holds a CONNECTED socket, which
    /// is exactly the confusion that once hid the Link button on the one
    /// screen that needed it.
    pub authenticated: Option<bool>,
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

/// Every read dependency the tripwire covers: the base ops here, plus the
/// message-capture ops in `whatsapp_message_ops`.
///
/// Merged rather than duplicated, and de-duplicated on the way through —
/// `WPP.whatsapp.ChatStore.getModelsArray` is genuinely needed by both lists and
/// must be checked once, not twice. Before this, `MESSAGE_WPP_DEPENDENCIES` was
/// declared and never read: the message path had no session-start coverage at
/// all, so wa-js drift on `WPP.chat.getMessages` surfaced at first sync instead
/// of at link time.
///
/// The WRITE dependency stays out, deliberately — see
/// `WPP_WRITE_DEPENDENCIES` and the test that asserts it never leaks in here.
fn health_dependencies() -> Vec<(&'static str, &'static str)> {
    let mut merged: Vec<(&'static str, &'static str)> = Vec::new();
    for entry in WPP_DEPENDENCIES
        .iter()
        .chain(crate::whatsapp_message_ops::MESSAGE_WPP_DEPENDENCIES.iter())
    {
        if !merged.iter().any(|(path, _)| *path == entry.0) {
            merged.push(*entry);
        }
    }
    merged
}

/// Build the health script from `health_dependencies`. Read-only: it resolves
/// paths, reads `typeof`, and calls only the probes named above.
fn health_script() -> String {
    let required = health_dependencies()
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
        // Message reads live in their own module; delegate rather than
        // widening this match. Both paths remain read-only.
        _ => crate::whatsapp_message_ops::script_for_message_op(op, arg),
    }
}

// ---------------------------------------------------------------------------
// The WRITE op — a separate, gated allowlist (TASK-030, ADR-158)
// ---------------------------------------------------------------------------
//
// `script_for_op` above is the READ allowlist and stays read-only: it has no
// write arm, and its test asserts that asking it for `send_message` yields
// nothing. The one write operation lives here instead, behind a function that
// the extract command never calls, so the only route to a send is
// `whatsapp_send_start` — which consults the durable Rust ceiling
// (`whatsapp_send.rs`) before it will build a script at all.
//
// Two things cross this boundary from the renderer and NOTHING else: a target
// id and a message body. Neither may be JavaScript.
//
//  - The target id is SHAPE-VALIDATED before interpolation, the way
//    `is_group_id` already validates the one read argument. A value that is not
//    a bare `digits@c.us` / `digits@lid` / `digits@g.us` never reaches a script.
//  - The body is arbitrary user text and cannot be shape-validated, so it is
//    ESCAPED. Quotes, backslashes, newlines, `</script>`, backticks and the
//    JavaScript-specific line terminators U+2028/U+2029 are all emitted as
//    `\uXXXX`, which cannot terminate the string literal it sits in.

/// The only write operation that exists. Named separately so no `match` arm can
/// grow a second one by accident.
pub const WRITE_OP_SEND_MESSAGE: &str = "send_message";

/// Mirrors `MAX_BODY_LENGTH` in `@bridge/whatsapp`'s `send.ts`.
pub const MAX_SEND_BODY_CHARS: usize = 4096;

/// `WPP` paths the write script depends on.
///
/// Deliberately NOT merged into `WPP_DEPENDENCIES`: that list feeds the health
/// script, and the health op's own test asserts it never so much as mentions a
/// send function. Keeping the write dependency in its own list preserves that
/// guarantee. The cost is honest — the session-start tripwire does not cover the
/// send path, so drift there surfaces on first send rather than at link time.
pub const WPP_WRITE_DEPENDENCIES: &[(&str, &str)] = &[("WPP.chat.sendTextMessage", "function")];

/// Escape arbitrary text for embedding in a double-quoted JavaScript string.
///
/// Escapes to `\uXXXX` rather than to `\"`-style sequences: a numeric escape
/// has no meaning to the HTML tokenizer, the JavaScript lexer, or a regex, so
/// there is no second layer where the character reappears. Every escaped
/// character is in the BMP, so one unit each is sufficient.
///
///  - `"` `\` `'` `` ` `` close string literals or open template ones.
///  - `<` `>` `&` prevent `</script>` (and any other markup) surviving into a
///    context that parses HTML.
///  - Everything below U+0020 and U+007F covers newlines, which terminate a
///    JavaScript string literal outright.
///  - U+2028 and U+2029 are line terminators to a JavaScript lexer specifically,
///    and are the classic way this kind of escaping is defeated.
pub fn escape_js_string(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len() + 16);
    for ch in raw.chars() {
        let code = ch as u32;
        let escape = matches!(ch, '"' | '\\' | '\'' | '`' | '<' | '>' | '&' | '/')
            || code < 0x20
            || code == 0x7f
            || ch == '\u{2028}'
            || ch == '\u{2029}';
        if escape {
            out.push_str(&format!("\\u{code:04x}"));
        } else {
            out.push(ch);
        }
    }
    out
}

/// A deliverable WhatsApp target: a bare numeric user on one of the three
/// servers a message can address. Validated BEFORE any interpolation.
///
/// Stricter than `send.ts`'s equivalent on purpose. This is the trusted side of
/// the boundary, so it accepts only what a real id looks like and refuses
/// anything it cannot vouch for, rather than trying to enumerate what an attack
/// would look like.
pub fn is_sendable_target_id(arg: &str) -> bool {
    let Some((user, suffix)) = arg.split_once('@') else {
        return false;
    };
    if user.is_empty() || user.len() > 64 {
        return false;
    }
    match suffix {
        // Groups may carry the creator-timestamp hyphen form.
        "g.us" => user.chars().all(|c| c.is_ascii_digit() || c == '-'),
        "c.us" | "lid" => user.chars().all(|c| c.is_ascii_digit()),
        _ => false,
    }
}

/// Build the send script, or refuse.
///
/// `None` means "this will not be sent" for every reason: an unknown op name, a
/// target id that is not a real id, an empty body, or an over-long one. The
/// caller turns that into a refusal; there is no arm that falls through to
/// running something.
pub fn script_for_write_op(op: &str, target_id: &str, body: &str) -> Option<String> {
    if op != WRITE_OP_SEND_MESSAGE {
        return None;
    }
    if !is_sendable_target_id(target_id) {
        return None;
    }
    let body = body.trim();
    if body.is_empty() || body.chars().count() > MAX_SEND_BODY_CHARS {
        return None;
    }
    Some(reported(
        op,
        &format!(
            // `createChat: false` is load-bearing, not a default: the consent
            // gate only permits sending into a thread the recipient already
            // wrote in, so the chat exists. Creating one would be the first
            // contact the whole discipline forbids.
            r#"{send}("{target}", "{text}", {{ createChat: false }})
                 .then(function (r) {{
                   return {{ id: String((r && r.id && (r.id._serialized || r.id)) || "") }};
                 }})"#,
            // Taken from the declared dependency rather than written out, so
            // the list the drift check reads IS the path actually called.
            send = WPP_WRITE_DEPENDENCIES[0].0,
            target = escape_js_string(target_id),
            text = escape_js_string(body),
        ),
    ))
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
    // Authentication is wa-js's own verdict, NOT the socket state: an
    // unlinked session showing the QR also holds a CONNECTED socket (that is
    // how it fetches the QR), so socket state cannot distinguish "linked"
    // from "please scan". null = could not tell, which the UI must treat as
    // unknown rather than as either answer.
    var authenticated = null;
    try { authenticated = !!wpp.conn.isAuthenticated(); } catch (e) {}
    var text = (document.body && document.body.innerText) || "";
    window.__bridgeReport({
      op: "status",
      json: JSON.stringify({
        ok: true,
        value: {
          socket: socket,
          chats: chats,
          authenticated: authenticated,
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
    var slot = kind + "\u0000" + key;
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
// Session recovery — reload and reset (TASK-030 shell fixes)
// ---------------------------------------------------------------------------
//
// Motivated by the 2026-08-02 incident: WhatsApp Web wedged on its own splash
// screen forever because the persisted data store held session state WhatsApp
// had invalidated (the device was unlinked elsewhere). The shell had no
// affordance for this at all — the only escape was quitting Bridge and moving
// `~/Library/WebKit/<container>/WebsiteDataStore/<uuid>` aside by hand.
//
// Two affordances, in escalation order:
//
//  - RELOAD: navigate the existing window to WhatsApp again. Same store, fresh
//    page. Cures a hung page; cures nothing about invalidated storage.
//  - RESET: close the window, MOVE the store directory aside to a timestamped
//    sibling, and delete the persisted store-id file, so the next
//    `ensure_window` mints a fresh store and shows a QR.
//
// The store is moved with `std::fs::rename` to a SIBLING path — same volume,
// atomic, and reversible by hand. It is NEVER deleted: the directory holds the
// only copy of an authenticated session's cookies and IndexedDB, and a
// recovery affordance that destroys evidence on a misdiagnosis is worse than
// the wedge it exists to fix. A failed rename is a typed error, not a
// fallback to deletion.

/// How many `-2`, `-3`… suffixes to try when the archive sibling already
/// exists (two resets in the same second) before refusing.
const MAX_ARCHIVE_ATTEMPTS: u32 = 100;

/// What one reset actually did, reported so the UI can say it honestly.
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionResetReport {
    /// The session window existed and was closed.
    pub window_closed: bool,
    /// Sibling paths the store directories were MOVED to. Never deleted.
    pub archived_to: Vec<String>,
    /// The persisted store-id file existed and was removed, so the next
    /// session start mints a fresh identity.
    pub id_file_removed: bool,
}

/// Find the WKWebView data-store directories that belong to `uuid_text`.
///
/// The on-disk layout is `<webkit_root>/<container>/WebsiteDataStore/<UUID>`.
/// The container segment is not ours to predict — a dev binary and a bundled
/// app get different names — so every container under the WebKit root is
/// scanned. The match is case-insensitive because WebKit writes the UUID
/// uppercase while the persisted id file is lowercase. Only directories whose
/// name IS our persisted UUID are returned; nothing else is ever touched.
pub fn find_data_store_dirs(webkit_root: &Path, uuid_text: &str) -> Vec<PathBuf> {
    let wanted = uuid_text.trim().to_ascii_lowercase();
    let mut found = Vec::new();
    let Ok(containers) = std::fs::read_dir(webkit_root) else {
        return found;
    };
    for container in containers.flatten() {
        let stores = container.path().join("WebsiteDataStore");
        let Ok(entries) = std::fs::read_dir(&stores) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            if name.to_ascii_lowercase() == wanted && entry.path().is_dir() {
                found.push(entry.path());
            }
        }
    }
    found
}

/// Move a store directory aside to a timestamped sibling. NEVER deletes.
///
/// `rename` to a sibling stays on the same volume, so it is atomic and cannot
/// half-copy. A rename failure is an error the caller must surface — falling
/// back to deletion is exactly what this function exists to rule out.
pub fn archive_store_dir(dir: &Path, timestamp: &str) -> Result<PathBuf, String> {
    let name = dir
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("{} has no usable directory name", dir.display()))?;
    let parent = dir
        .parent()
        .ok_or_else(|| format!("{} has no parent directory", dir.display()))?;
    let mut target = parent.join(format!("{name}-invalidated-{timestamp}"));
    let mut attempt = 1;
    while target.exists() {
        attempt += 1;
        if attempt > MAX_ARCHIVE_ATTEMPTS {
            return Err(format!(
                "could not find a free archive name for {}",
                dir.display()
            ));
        }
        target = parent.join(format!("{name}-invalidated-{timestamp}-{attempt}"));
    }
    std::fs::rename(dir, &target).map_err(|error| {
        format!(
            "could not move {} aside to {} ({error}) — the store was NOT deleted",
            dir.display(),
            target.display()
        )
    })?;
    Ok(target)
}

/// The filesystem half of a reset, over explicit paths so it is testable.
///
/// Reads the persisted UUID, moves every matching store directory aside, and
/// removes the id file. Every absence is a no-op success: a reset must be safe
/// to run when nothing exists yet, because "the session is wedged" and "the
/// session never existed" look identical to a frustrated user. An id file
/// holding garbage still gets removed — it could never name a store anyway,
/// and leaving it would keep poisoning `load_or_create_data_store_id`.
pub fn reset_session_storage(
    webkit_root: &Path,
    id_file: &Path,
    timestamp: &str,
) -> Result<(Vec<PathBuf>, bool), String> {
    let mut archived = Vec::new();
    if let Ok(text) = std::fs::read_to_string(id_file) {
        if parse_uuid(&text).is_some() {
            for dir in find_data_store_dirs(webkit_root, text.trim()) {
                archived.push(archive_store_dir(&dir, timestamp)?);
            }
        }
    }
    let id_file_removed = match std::fs::remove_file(id_file) {
        Ok(()) => true,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => {
            return Err(format!(
                "could not remove the persisted store id ({error}) — the next session \
                 would reopen the archived store's identity"
            ))
        }
    };
    Ok((archived, id_file_removed))
}

/// Seconds since the epoch, as the archive timestamp. Monotonic enough: a
/// same-second double reset is handled by the `-2` suffix above.
fn archive_timestamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs().to_string())
        .unwrap_or_else(|_| "clock-unavailable".to_string())
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
        // The session is an ENGINE, not an application. It spends its whole
        // life parked off-screen and is shown only for the QR scan, so it must
        // not advertise itself as a second app: without these two it took its
        // own Dock tile and window-list entry, which is the blank second
        // "Bridge" icon (user-hit, 2026-08-02). Bridge is one application.
        .skip_taskbar(true)
        // Created unfocused. Stealing focus at startup is wrong for a window
        // nobody can see; the linking path focuses it when it is actually shown.
        .focused(false)
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
            authenticated: None,
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
    // Absent or non-boolean stays None — "could not tell" must not collapse
    // into either answer.
    let authenticated = value.get("authenticated").and_then(|v| v.as_bool());
    Ok(WhatsAppStatus {
        open: true,
        // Measured the hard way: an authenticated session with an UNLAUNCHED
        // socket answers every read op with "sendIq called before startComms".
        live: socket == "CONNECTED" && chats > 0,
        socket,
        chats,
        syncing,
        authenticated,
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

// ---------------------------------------------------------------------------
// Send commands — the gated write path (TASK-030, ADR-158)
// ---------------------------------------------------------------------------

/// A send is fast compared with a contact read, but it is still start-then-poll:
/// WhatsApp's own ack can stall behind a reconnect, and a command that answers
/// after ~60s aborts the whole app under WKWebView (see `jobs.rs`).
const SEND_TIMEOUT_MS: u64 = 120_000;

use crate::whatsapp_send as ceiling;

fn ceiling_path(app: &AppHandle) -> Result<PathBuf, WhatsAppError> {
    ceiling::ledger_path(app).ok_or_else(|| {
        err(
            "WHATSAPP_SEND_STATE",
            "The app data directory is unavailable, so the send ceiling cannot be read. \
             Sending is refused rather than run uncounted.",
        )
    })
}

/// Start one outbound message.
///
/// The renderer supplies exactly three strings: the op name, a target id and a
/// body. It cannot supply JavaScript, and it cannot supply a count — the
/// recipient key it passes is only ever hashed, and every number the ceiling
/// uses comes from the durable ledger on this side of the boundary.
///
/// Ordering matters and is the point of ADR-158's "the ceiling is enforced in
/// Rust": whatever `decideAutomatedSend` concluded in the renderer, THIS is the
/// check that binds. A renderer that skipped its own policy entirely still hits
/// the cap, the cooldown and the kill switch here.
#[tauri::command]
pub fn whatsapp_send_start(
    app: AppHandle,
    jobs: tauri::State<'_, WhatsAppJobs>,
    gate: tauri::State<'_, ceiling::SendCeilingState>,
    target_id: String,
    recipient_key: String,
    body: String,
) -> Result<u64, WhatsAppError> {
    // 1. Shape. An invalid target or body never becomes a script at all.
    let Some(script) = script_for_write_op(WRITE_OP_SEND_MESSAGE, &target_id, &body) else {
        return Err(err(
            "WHATSAPP_SEND_REFUSED",
            "That is not a sendable WhatsApp target and message.",
        ));
    };
    if recipient_key.trim().is_empty() {
        return Err(err(
            "WHATSAPP_SEND_REFUSED",
            "The recipient has no identity key, so the per-recipient cooldown could not be applied.",
        ));
    }
    if app.get_webview_window(WHATSAPP_LABEL).is_none() {
        return Err(err(
            "WHATSAPP_NOT_OPEN",
            "The WhatsApp session is not open",
        ));
    }

    // 2. The ceiling. Held under a lock for the whole read-check-write, so two
    //    concurrent sends cannot both observe the same free slot.
    let path = ceiling_path(&app)?;
    let _held = gate
        .gate
        .lock()
        .map_err(|_| err("WHATSAPP_SEND_STATE", "the send ceiling state is unavailable"))?;

    let now = ceiling::now_ms();
    let digest = ceiling::recipient_digest(&recipient_key);
    let mut ledger = ceiling::load_from(&path, now);

    if let ceiling::CeilingVerdict::Refused(refusal) =
        ceiling::check_ceiling(&ledger, &digest, now, &ceiling::SEND_LIMITS)
    {
        // A corrupt ledger halts (see `SendLedger::unreadable`); persist that
        // halt so the next launch sees it too rather than re-deciding.
        if ledger.kill_switch.status == ceiling::KillStatus::Halted {
            let _ = ceiling::save_to(&path, &ledger);
        }
        return Err(WhatsAppError {
            code: refusal.code,
            message: refusal.message,
            earliest_at_ms: refusal.earliest_at_ms,
        });
    }

    // 3. Count the send BEFORE running it, and refuse if it cannot be counted.
    //    Recording afterwards would mean a crash mid-send silently returns the
    //    slot, and "crash the app between sends" is not a cap.
    ledger.record(digest, now, &ceiling::SEND_LIMITS);
    ceiling::save_to(&path, &ledger).map_err(|error| {
        err(
            "WHATSAPP_SEND_STATE",
            format!("The send could not be recorded against the daily cap ({error}), so it was not sent."),
        )
    })?;
    drop(_held);

    // 4. Only now does anything reach the page.
    let job = jobs
        .op
        .start()
        .map_err(|message| err("WHATSAPP_JOBS", message))?;
    let table = jobs.op.clone();
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = handle.state::<WhatsAppState>();
        let result = match handle.get_webview_window(WHATSAPP_LABEL) {
            Some(window) => run_script(&window, state, script, SEND_TIMEOUT_MS).await,
            None => Err(err(
                "WHATSAPP_NOT_OPEN",
                "The WhatsApp session closed before the message was sent",
            )),
        };
        table.finish(job, result);
    });
    Ok(job)
}

/// Poll a started send. Shares the read path's job table and take-once semantics.
#[tauri::command]
pub fn whatsapp_send_poll(
    jobs: tauri::State<'_, WhatsAppJobs>,
    job: u64,
) -> Result<WhatsAppJobPoll, WhatsAppError> {
    whatsapp_extract_poll(jobs, job)
}

/// What the ceiling currently allows, so the UI can explain rather than guess.
#[tauri::command]
pub fn whatsapp_send_status(
    app: AppHandle,
) -> Result<ceiling::SendCeilingStatus, WhatsAppError> {
    let path = ceiling_path(&app)?;
    let now = ceiling::now_ms();
    let ledger = ceiling::load_from(&path, now);
    Ok(ceiling::status_of(&ledger, now, &ceiling::SEND_LIMITS))
}

/// Halt automated sending. Any WhatsApp-side warning, unexpected disconnect or
/// delivery anomaly calls this, and nothing lifts it but `whatsapp_send_rearm`.
#[tauri::command]
pub fn whatsapp_send_halt(
    app: AppHandle,
    gate: tauri::State<'_, ceiling::SendCeilingState>,
    reason: String,
) -> Result<ceiling::SendCeilingStatus, WhatsAppError> {
    let path = ceiling_path(&app)?;
    let _held = gate
        .gate
        .lock()
        .map_err(|_| err("WHATSAPP_SEND_STATE", "the send ceiling state is unavailable"))?;
    let now = ceiling::now_ms();
    let mut ledger = ceiling::load_from(&path, now);
    let reason = if reason.trim().is_empty() {
        "halted by request".to_string()
    } else {
        reason
    };
    ceiling::halt(&mut ledger, &reason, now);
    ceiling::save_to(&path, &ledger)
        .map_err(|error| err("WHATSAPP_SEND_STATE", format!("the halt could not be persisted: {error}")))?;
    Ok(ceiling::status_of(&ledger, now, &ceiling::SEND_LIMITS))
}

/// Re-arm. Requires a NAMED HUMAN — there is no automatic path back.
#[tauri::command]
pub fn whatsapp_send_rearm(
    app: AppHandle,
    gate: tauri::State<'_, ceiling::SendCeilingState>,
    rearmed_by: String,
) -> Result<ceiling::SendCeilingStatus, WhatsAppError> {
    let path = ceiling_path(&app)?;
    let _held = gate
        .gate
        .lock()
        .map_err(|_| err("WHATSAPP_SEND_STATE", "the send ceiling state is unavailable"))?;
    let now = ceiling::now_ms();
    let mut ledger = ceiling::load_from(&path, now);
    ceiling::rearm(&mut ledger, &rearmed_by, now)
        .map_err(|message| err("WHATSAPP_SEND_REARM_REFUSED", message))?;
    ceiling::save_to(&path, &ledger)
        .map_err(|error| err("WHATSAPP_SEND_STATE", format!("the re-arm could not be persisted: {error}")))?;
    Ok(ceiling::status_of(&ledger, now, &ceiling::SEND_LIMITS))
}

// ---------------------------------------------------------------------------
// Recovery commands (TASK-030 shell fixes)
// ---------------------------------------------------------------------------

/// Reload the session page: same store, fresh load. The cheap first thing to
/// try when the page wedges. `false` means there was no window to reload —
/// not an error, because the caller's next step (open it) is the same fix.
#[tauri::command]
pub fn whatsapp_session_reload(app: AppHandle) -> Result<bool, WhatsAppError> {
    on_main(&app, |handle| {
        match handle.get_webview_window(WHATSAPP_LABEL) {
            None => Ok(false),
            Some(window) => {
                let target = tauri::Url::parse(WHATSAPP_URL).expect("WhatsApp URL is valid");
                window.navigate(target).map_err(|error| {
                    err(
                        "WHATSAPP_RELOAD_FAILED",
                        format!("Could not reload the WhatsApp session: {error}"),
                    )
                })?;
                Ok(true)
            }
        }
    })
}

/// The escape hatch for invalidated session storage (2026-08-02 incident).
///
/// Closes the session window if open, MOVES the WKWebView store directory
/// aside to a timestamped sibling — never deletes — and removes the persisted
/// store-id file, so the next `ensure_window` mints a fresh store and shows a
/// QR. Safe when no window exists and when the store directory is absent;
/// every step it took is in the report. Destroy-then-rename runs in one
/// main-thread hop: `destroy` tears the webview down synchronously (`close`
/// only requests it), so by the time the rename runs nothing is minting new
/// files under the old identity.
#[tauri::command]
pub fn whatsapp_session_reset(app: AppHandle) -> Result<SessionResetReport, WhatsAppError> {
    on_main(&app, |handle| {
        let window_closed = match handle.get_webview_window(WHATSAPP_LABEL) {
            None => false,
            Some(window) => {
                window.destroy().map_err(|error| {
                    err(
                        "WHATSAPP_RESET_FAILED",
                        format!("Could not close the session window: {error}"),
                    )
                })?;
                true
            }
        };

        let id_file = handle
            .path()
            .app_data_dir()
            .map(|dir| dir.join(DATA_STORE_ID_FILE))
            .map_err(|error| {
                err(
                    "WHATSAPP_RESET_FAILED",
                    format!("The app data directory is unavailable ({error}), so the persisted store id cannot be cleared."),
                )
            })?;
        let webkit_root = handle
            .path()
            .home_dir()
            .map(|home| home.join("Library").join("WebKit"))
            .unwrap_or_else(|_| PathBuf::from("/nonexistent"));

        let (archived, id_file_removed) =
            reset_session_storage(&webkit_root, &id_file, &archive_timestamp())
                .map_err(|message| err("WHATSAPP_RESET_FAILED", message))?;
        for path in &archived {
            eprintln!(
                "[bridge-desktop] whatsapp session store moved aside to {}",
                path.display()
            );
        }
        Ok(SessionResetReport {
            window_closed,
            archived_to: archived
                .iter()
                .map(|path| path.display().to_string())
                .collect(),
            id_file_removed,
        })
    })
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

    /// The read allowlist's exact membership, and the fact that it is CLOSED.
    ///
    /// This assertion used to also say `send_message` is refused everywhere,
    /// which ADR-158 and AP-091 have since reversed by approving write. The
    /// guarantee it was actually buying is preserved and split in two:
    ///
    ///  - here: `script_for_op` — the function `whatsapp_extract_start` calls —
    ///    still refuses `send_message` and everything else not listed, so the
    ///    read command cannot reach a write;
    ///  - `the_send_op_is_reachable_only_through_the_gated_path` below: the
    ///    write script exists ONLY behind `script_for_write_op`, which
    ///    `whatsapp_send_start` calls after the durable ceiling has passed.
    ///
    /// Enabling write moved where the send is refused. It did not remove the
    /// refusal from the read path.
    #[test]
    fn the_read_op_allowlist_is_closed_and_still_has_no_write() {
        // The exact membership. Changing this list is a governed decision, not
        // an implementation detail — which is what this assertion protects.
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
            // Still refused HERE. Write has its own gated entry point.
            "send_message",
            "sendTextMessage",
            "add_participants",
            "remove_participants",
            "delete_message",
            // Never an escape hatch for arbitrary code, at any tier.
            "eval",
            "Function",
            "WPP.chat.sendTextMessage('x','y')",
            "list_contacts; WPP.chat.sendTextMessage('a','b')",
            // Not a name at all.
            "",
            " ",
            "LIST_CONTACTS",
            "list_contacts ",
            // Reserved for the PUSH channel: the page volunteers it, nothing
            // may request it.
            "session_events",
        ] {
            assert!(
                script_for_op(refused, None).is_none(),
                "{refused:?} must be refused by the read allowlist"
            );
            // And an argument does not unlock it either.
            assert!(
                script_for_op(refused, Some("120363001@g.us")).is_none(),
                "{refused:?} must be refused even with a well-formed argument"
            );
        }
    }

    // -----------------------------------------------------------------------
    // TASK-030 — the write op
    // -----------------------------------------------------------------------

    #[test]
    fn the_send_op_is_reachable_only_through_the_gated_path() {
        // The one write op exists…
        assert!(
            script_for_write_op(WRITE_OP_SEND_MESSAGE, "919876543210@c.us", "hello").is_some()
        );
        // …and NOTHING else does. There is one write operation, not a family.
        for other in [
            "sendTextMessage",
            "add_participants",
            "delete_message",
            "eval",
            "list_contacts",
            "",
            "send_message ",
            "SEND_MESSAGE",
        ] {
            assert!(
                script_for_write_op(other, "919876543210@c.us", "hello").is_none(),
                "{other:?} must not be a write op"
            );
        }
        // The read command's allowlist cannot produce the send script, whatever
        // it is handed — this is the assertion that keeps `whatsapp_extract_start`
        // from becoming a write path.
        for arg in [None, Some("919876543210@c.us"), Some("hello")] {
            assert!(script_for_op(WRITE_OP_SEND_MESSAGE, arg).is_none());
        }
    }

    #[test]
    fn send_targets_are_validated_before_interpolation() {
        for good in [
            "919876543210@c.us",
            "120363001234567890@g.us",
            "1203-63001@g.us",
            "84512345678901@lid",
        ] {
            assert!(is_sendable_target_id(good), "{good} should be sendable");
            assert!(script_for_write_op(WRITE_OP_SEND_MESSAGE, good, "hi").is_some());
        }

        for bad in [
            // Injection attempts.
            r#"");WPP.chat.sendTextMessage("victim@c.us","spam");//@c.us"#,
            "1@c.us\",\"x",
            "1@c.us\n",
            "1@c.us evil",
            // Wrong or absent server.
            "919876543210@s.whatsapp.net",
            "919876543210",
            "@c.us",
            "",
            // Not a bare numeric user.
            "abc@c.us",
            "9198765+43210@c.us",
            "1@c.us@c.us",
            // Absurd length.
            &format!("{}@c.us", "9".repeat(65)),
        ] {
            assert!(!is_sendable_target_id(bad), "{bad:?} must not validate");
            assert!(
                script_for_write_op(WRITE_OP_SEND_MESSAGE, bad, "hi").is_none(),
                "{bad:?} must never reach a script"
            );
        }
    }

    #[test]
    fn a_hostile_message_body_cannot_break_out_of_its_string() {
        // The body is arbitrary user text — it cannot be shape-validated, so
        // escaping is the whole defence. Each of these is a real way out of a
        // double-quoted JavaScript string literal.
        let hostile = [
            r#"hi");WPP.chat.sendTextMessage("victim@c.us","spam");//"#,
            r#"trailing backslash \"#,
            "line one\nline two",
            "carriage\r\nreturn",
            "</script><script>alert(1)</script>",
            "</SCRIPT >",
            "`${process}`",
            "single ' and double \" quotes",
            "u2028\u{2028}separator",
            "u2029\u{2029}separator",
            "null\u{0}byte",
            "\u{7f}delete",
            "&lt;&amp;",
        ];
        for body in hostile {
            let script = script_for_write_op(WRITE_OP_SEND_MESSAGE, "919876543210@c.us", body)
                .unwrap_or_else(|| panic!("{body:?} is a legitimate message and must be sendable"));

            // Assert on the escaped form itself rather than trying to carve the
            // literal back out of the script: a hostile body contains the very
            // delimiters such parsing would key on, and a test that can be
            // confused by its own input proves nothing.
            let escaped = escape_js_string(body);
            assert!(
                script.contains(&escaped),
                "the escaped body is what gets interpolated"
            );

            // A double quote would close the literal; the rest are what a
            // JavaScript lexer treats as a line or template terminator.
            for forbidden in ['"', '\n', '\r', '`', '<', '>', '\u{2028}', '\u{2029}'] {
                assert!(
                    !escaped.chars().any(|c| c == forbidden),
                    "{forbidden:?} survived escaping in {body:?}"
                );
            }
            // Every backslash present is one WE emitted, and is a complete
            // `\uXXXX`. A `\"` or a trailing lone `\` would be an escape the
            // lexer resolves back into a metacharacter — which is exactly how a
            // naive escaper is defeated by a body ending in a backslash.
            let units: Vec<char> = escaped.chars().collect();
            let mut index = 0;
            while index < units.len() {
                if units[index] == '\\' {
                    assert!(
                        index + 6 <= units.len()
                            && units[index + 1] == 'u'
                            && units[index + 2..index + 6]
                                .iter()
                                .all(|c| c.is_ascii_hexdigit()),
                        "a non-\\uXXXX backslash escape appeared for {body:?}"
                    );
                    index += 6;
                } else {
                    index += 1;
                }
            }
            // Markup cannot survive at all: `<` and `>` are always escaped, so
            // there is no context in which the body re-enters an HTML parser.
            assert!(!script.to_lowercase().contains("</script"));
            //
            // Note what is deliberately NOT asserted: that the script does not
            // CONTAIN the text `WPP.chat.sendTextMessage`. A body quoting that
            // text keeps it verbatim, because letters and dots need no escaping
            // and mangling them would corrupt legitimate messages. The
            // guarantee is that it stays INSIDE the string literal, which the
            // quote and backslash checks above are what establish.
        }
    }

    #[test]
    fn escaping_preserves_ordinary_text_and_neutralises_the_rest() {
        // Escaping must not mangle the messages people actually send —
        // including non-Latin scripts and emoji, which an over-eager
        // ASCII-only escaper would destroy.
        for plain in ["Hello there", "नमस्ते", "こんにちは", "Ça va ?", "🎉 done"] {
            assert_eq!(escape_js_string(plain), plain, "{plain} should pass through");
        }
        // And the metacharacters become numeric escapes, which have no meaning
        // to an HTML tokenizer, a regex, or a second round of parsing.
        assert_eq!(escape_js_string("\""), "\\u0022");
        assert_eq!(escape_js_string("\\"), "\\u005c");
        assert_eq!(escape_js_string("\n"), "\\u000a");
        assert_eq!(escape_js_string("<"), "\\u003c");
        assert_eq!(escape_js_string("\u{2028}"), "\\u2028");
    }

    #[test]
    fn empty_and_oversized_bodies_are_refused_rather_than_truncated() {
        for empty in ["", " ", "\n", "\t\r\n "] {
            assert!(
                script_for_write_op(WRITE_OP_SEND_MESSAGE, "1@c.us", empty).is_none(),
                "{empty:?} is not a message"
            );
        }
        let at_limit = "a".repeat(MAX_SEND_BODY_CHARS);
        assert!(script_for_write_op(WRITE_OP_SEND_MESSAGE, "1@c.us", &at_limit).is_some());
        let over = "a".repeat(MAX_SEND_BODY_CHARS + 1);
        assert!(
            script_for_write_op(WRITE_OP_SEND_MESSAGE, "1@c.us", &over).is_none(),
            "an over-long body must be refused, never silently cut"
        );
        // The limit counts CHARACTERS, matching `send.ts`'s `body.length` on a
        // JS string closely enough that the two agree on ordinary text.
        assert_eq!(MAX_SEND_BODY_CHARS, 4096);
    }

    #[test]
    fn the_send_script_never_opens_a_new_conversation() {
        let script =
            script_for_write_op(WRITE_OP_SEND_MESSAGE, "919876543210@c.us", "hi").unwrap();
        // The consent gate only permits sending into a thread the recipient
        // already wrote in, so the chat exists. `createChat: true` would make
        // this capable of the first contact the discipline exists to prevent.
        assert!(script.contains("createChat: false"));
        assert!(!script.contains("createChat: true"));
        // Every WPP path the write script uses is declared, so a drifted wa-js
        // is a known failure rather than a mystery.
        for path in wpp_paths(&script) {
            assert!(
                WPP_WRITE_DEPENDENCIES
                    .iter()
                    .any(|(declared, _)| path.starts_with(declared)),
                "{path} is used by the write script but not declared"
            );
        }
        // And the write dependency stays OUT of the health list, so the health
        // op keeps its "mentions no send function" guarantee.
        for (path, _) in WPP_WRITE_DEPENDENCIES {
            assert!(
                !WPP_DEPENDENCIES.iter().any(|(read, _)| read == path),
                "{path} must not leak into the read health tripwire"
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
            // The message-capture ops reach the page through the SAME
            // allowlist, so they belong in the SAME tripwire. Omitting them is
            // how `WPP.chat.getMessages` went uncovered while
            // MESSAGE_WPP_DEPENDENCIES sat declared and unread.
            script_for_op("list_chats", None).unwrap(),
            script_for_op("list_messages", Some("919876543210@c.us|0|10")).unwrap(),
        ];
        scripts.push(event_listener_script());

        let declared = health_dependencies();
        for script in &scripts {
            for path in wpp_paths(script) {
                assert!(
                    declared.iter().any(|(name, _)| path.starts_with(name)),
                    "{path} is used but not declared, so health would not catch it drifting"
                );
            }
        }

        // And the tripwire itself names every declared dependency — from BOTH
        // lists, each exactly once.
        let health = script_for_op("health", None).unwrap();
        for (path, kind) in &declared {
            assert!(health.contains(path), "health does not check {path}");
            assert!(health.contains(kind));
            assert_eq!(
                health.matches(&format!(r#"path: "{path}""#)).count(),
                1,
                "{path} is checked more than once — the two lists were merged without dedup"
            );
        }

        // The message path is specifically covered now, not merely reachable.
        for (path, _) in crate::whatsapp_message_ops::MESSAGE_WPP_DEPENDENCIES {
            assert!(
                health.contains(path),
                "{path} is a message-op dependency the session-start tripwire must check"
            );
        }
    }

    #[test]
    fn the_expensive_message_read_is_declared_but_never_invoked_by_health() {
        // `WPP.chat.getMessages` must be existence-checked only. Calling it in
        // a tripwire would read a real conversation at session start — both
        // slow and a residency surprise.
        let health = script_for_op("health", None).unwrap();
        assert!(health.contains("WPP.chat.getMessages"));
        assert!(!health.contains("WPP.chat.getMessages("));
        assert!(!WPP_SHAPE_PROBES.contains(&"WPP.chat.getMessages"));
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

    // -----------------------------------------------------------------------
    // Session reset — the filesystem half (TASK-030 shell fixes)
    // -----------------------------------------------------------------------

    /// A unique scratch dir per test. `std::env::temp_dir()` following the
    /// pattern `whatsapp_send.rs` already uses.
    fn scratch(name: &str) -> PathBuf {
        let mut tag = [0u8; 8];
        let _ = getrandom::fill(&mut tag);
        let suffix: String = tag.iter().map(|b| format!("{b:02x}")).collect();
        let dir = std::env::temp_dir().join(format!("bridge-wa-reset-{name}-{suffix}"));
        std::fs::create_dir_all(&dir).expect("scratch dir");
        dir
    }

    #[test]
    fn reset_moves_the_store_aside_and_removes_the_id_file() {
        let root = scratch("archive");
        let webkit = root.join("WebKit");
        let uuid = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
        // WebKit writes the directory name UPPERCASE; the id file is lowercase.
        let store = webkit
            .join("bridge-desktop")
            .join("WebsiteDataStore")
            .join(uuid.to_uppercase());
        std::fs::create_dir_all(&store).expect("store dir");
        std::fs::write(store.join("Cookies.binarycookies"), b"session").expect("cookie file");
        // A NEIGHBOUR store belonging to a different identity must survive.
        let neighbour = webkit
            .join("bridge-desktop")
            .join("WebsiteDataStore")
            .join("FFFFFFFF-0000-4000-8000-000000000000");
        std::fs::create_dir_all(&neighbour).expect("neighbour dir");
        let id_file = root.join("bridge").join("whatsapp-data-store-id");
        std::fs::create_dir_all(id_file.parent().unwrap()).expect("id dir");
        std::fs::write(&id_file, uuid).expect("id file");

        let (archived, id_removed) =
            reset_session_storage(&webkit, &id_file, "1754000000").expect("reset succeeds");

        // Moved, not deleted: the original is gone, the sibling holds the data.
        assert_eq!(archived.len(), 1);
        assert!(!store.exists(), "the original store dir must be gone");
        let sibling = archived[0].clone();
        assert_eq!(sibling.parent(), store.parent(), "archive stays a sibling");
        assert!(sibling
            .file_name()
            .unwrap()
            .to_string_lossy()
            .contains("invalidated-1754000000"));
        assert!(sibling.join("Cookies.binarycookies").exists(), "contents survive the move");
        // The other identity's store was never touched.
        assert!(neighbour.exists());
        // The id file is gone, so the next session start mints a fresh store.
        assert!(id_removed);
        assert!(!id_file.exists());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn reset_with_no_store_dir_still_clears_the_id_file() {
        let root = scratch("no-store");
        let webkit = root.join("WebKit"); // never created
        let id_file = root.join("whatsapp-data-store-id");
        std::fs::write(&id_file, "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d").expect("id file");

        let (archived, id_removed) =
            reset_session_storage(&webkit, &id_file, "1").expect("absent store is a no-op");
        assert!(archived.is_empty());
        assert!(id_removed);
        assert!(!id_file.exists());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn reset_with_nothing_at_all_is_a_no_op_success() {
        let root = scratch("nothing");
        let (archived, id_removed) = reset_session_storage(
            &root.join("WebKit"),
            &root.join("whatsapp-data-store-id"),
            "1",
        )
        .expect("a reset over nothing must succeed");
        assert!(archived.is_empty());
        assert!(!id_removed);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn reset_removes_a_garbage_id_file_without_touching_any_store() {
        // A corrupt id file names no store, but leaving it would keep
        // poisoning `load_or_create_data_store_id` on every launch.
        let root = scratch("garbage");
        let webkit = root.join("WebKit");
        let stray = webkit.join("app").join("WebsiteDataStore").join("SOMETHING");
        std::fs::create_dir_all(&stray).expect("stray dir");
        let id_file = root.join("whatsapp-data-store-id");
        std::fs::write(&id_file, "not-a-uuid").expect("id file");

        let (archived, id_removed) =
            reset_session_storage(&webkit, &id_file, "1").expect("reset succeeds");
        assert!(archived.is_empty(), "garbage must never match a directory");
        assert!(stray.exists(), "no directory may be moved on a garbage id");
        assert!(id_removed);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn archive_disambiguates_when_the_sibling_already_exists() {
        // Two resets in the same second must not collide — and must not
        // overwrite the first archive.
        let root = scratch("collide");
        let store = root.join("STORE");
        std::fs::create_dir_all(&store).expect("store");
        std::fs::create_dir_all(root.join("STORE-invalidated-9")).expect("existing sibling");

        let target = archive_store_dir(&store, "9").expect("archive succeeds");
        assert_eq!(
            target.file_name().unwrap().to_string_lossy(),
            "STORE-invalidated-9-2"
        );
        assert!(target.exists());
        assert!(root.join("STORE-invalidated-9").exists(), "the first archive survives");
        assert!(!store.exists());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn find_data_store_dirs_matches_case_insensitively_across_containers() {
        let root = scratch("find");
        let uuid = "0a0b0c0d-0e0f-4a1b-8c2d-3e4f5a6b7c8d";
        // The container name differs between a dev binary and a bundled app,
        // so both are scanned.
        for container in ["bridge-desktop", "ai.bridge.desktop"] {
            std::fs::create_dir_all(
                root.join(container)
                    .join("WebsiteDataStore")
                    .join(uuid.to_uppercase()),
            )
            .expect("store dir");
        }
        // Decoys: wrong uuid, and a FILE with the right name.
        std::fs::create_dir_all(
            root.join("other")
                .join("WebsiteDataStore")
                .join("11111111-2222-4333-8444-555555555555"),
        )
        .expect("decoy dir");
        let file_container = root.join("filecase").join("WebsiteDataStore");
        std::fs::create_dir_all(&file_container).expect("file container");
        std::fs::write(file_container.join(uuid.to_uppercase()), b"not a dir").expect("decoy file");

        let mut found = find_data_store_dirs(&root, uuid);
        found.sort();
        assert_eq!(found.len(), 2, "both containers' stores are found: {found:?}");
        for path in &found {
            assert_eq!(
                path.file_name().unwrap().to_string_lossy(),
                uuid.to_uppercase()
            );
        }

        let _ = std::fs::remove_dir_all(&root);
    }
}
