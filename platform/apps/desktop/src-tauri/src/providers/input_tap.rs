//! "input" provider — the macOS half of K11 (TASK-054, AP-157, ADR-244):
//! a LISTEN-ONLY `CGEventTap` on key-down plus a per-keystroke Accessibility
//! read of the focused element's role.
//!
//! The pure half (burst aggregation, AX role → FieldRole) lives in
//! `providers/input.rs` and is tested on any host. This file is the thin,
//! unavoidably-unsafe layer that feeds it, and it holds no policy of its own:
//! it never decides what may be stored, only what the field IS.
//!
//! THREE PROPERTIES THIS FILE IS RESPONSIBLE FOR.
//!
//! 1. **The tap is listen-only and never mutates the event stream.** Created
//!    with `kCGEventTapOptionListenOnly`, the callback returns the event
//!    untouched, and nothing here consumes, rewrites, or delays a keystroke.
//!    A capture sensor that could swallow the user's typing would be a
//!    keylogger with a bug budget; this one is structurally a bystander.
//!
//! 2. **macOS secure input forces `Secure`, whatever AX says.** When any app
//!    has called `EnableSecureEventInput` (the standard password-field
//!    behaviour), the window server stops delivering keys to taps at all —
//!    so in the common case we see nothing, which is the OS protecting the
//!    user rather than us. We ALSO check the flag explicitly and classify the
//!    field as secure, because "we saw no keys" and "we saw keys we must not
//!    read" should not be distinguished by accident, and because the flag can
//!    be set by an app that is not the frontmost one.
//!
//! 3. **Every AX failure is `Undeterminable`, which suppresses.** No grant,
//!    no focused element, an unresponsive app, a role we do not recognise —
//!    all read as "we cannot tell", and `input.rs` refuses to accumulate
//!    characters for anything but a positively-identified text field.
//!
//! COST NOTE. The role is read fresh on EVERY key-down rather than cached.
//! A cache would be faster and would also mean that tabbing from a note into
//! a password box could, for the length of the cache window, attribute
//! password characters to the previous field's role. The AX messaging
//! timeout is pinned low (25ms) so an unresponsive app degrades to
//! `Undeterminable` instead of stalling the tap, and a tap that macOS
//! disables for slowness is re-enabled by the callback.

#![cfg(target_os = "macos")]

use super::input::{field_role_from_ax, BurstAccumulator, FieldRole, FocusContext, InputBurst};
use super::{now_ts_ms, CaptureEmission, Observation};
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

// ---------------------------------------------------------------------------
// Hand-bound C surface. Same discipline as providers/accessibility.rs: only
// the symbols actually used, every +1 CFType released on every path.
// ---------------------------------------------------------------------------

type CFTypeRef = *const c_void;
type CFStringRef = CFTypeRef;
type CFMachPortRef = *const c_void;
type CFRunLoopSourceRef = *const c_void;
type CFRunLoopRef = *const c_void;
type CFAllocatorRef = *const c_void;
type CFIndex = isize;
type CGEventRef = *const c_void;
type CGEventTapProxy = *const c_void;

type CGEventTapCallBack = unsafe extern "C" fn(
    proxy: CGEventTapProxy,
    event_type: u32,
    event: CGEventRef,
    user_info: *mut c_void,
) -> CGEventRef;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventTapCreate(
        tap: u32,
        place: u32,
        options: u32,
        events_of_interest: u64,
        callback: CGEventTapCallBack,
        user_info: *mut c_void,
    ) -> CFMachPortRef;
    fn CGEventTapEnable(tap: CFMachPortRef, enable: bool);
    fn CGEventKeyboardGetUnicodeString(
        event: CGEventRef,
        max_string_length: CFIndex,
        actual_string_length: *mut CFIndex,
        unicode_string: *mut u16,
    );
    /// Input Monitoring (TCC kTCCServiceListenEvent). Preflight does not
    /// prompt; Request prompts once and thereafter is a no-op.
    fn CGPreflightListenEventAccess() -> bool;
    fn CGRequestListenEventAccess() -> bool;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFMachPortCreateRunLoopSource(
        allocator: CFAllocatorRef,
        port: CFMachPortRef,
        order: CFIndex,
    ) -> CFRunLoopSourceRef;
    fn CFRunLoopGetCurrent() -> CFRunLoopRef;
    fn CFRunLoopAddSource(rl: CFRunLoopRef, source: CFRunLoopSourceRef, mode: CFStringRef);
    fn CFRunLoopRun();
    fn CFRunLoopStop(rl: CFRunLoopRef);
    fn CFRelease(cf: CFTypeRef);
    fn CFRetain(cf: CFTypeRef) -> CFTypeRef;
    static kCFRunLoopCommonModes: CFStringRef;
}

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
    fn AXUIElementCreateSystemWide() -> CFTypeRef;
    fn AXUIElementCopyAttributeValue(
        node: CFTypeRef,
        attribute: CFStringRef,
        value: *mut CFTypeRef,
    ) -> i32;
    fn AXUIElementSetMessagingTimeout(node: CFTypeRef, timeout_seconds: f32) -> i32;
}

// `IsSecureEventInputEnabled` lives in Carbon's HIToolbox. It is the flag an
// app sets around a password field to stop the window server delivering keys
// to taps — the real first line of defence here (ADR-239 recorded it as
// such), with our field-role gate as the second.
#[link(name = "Carbon", kind = "framework")]
extern "C" {
    fn IsSecureEventInputEnabled() -> bool;
}

const K_CG_SESSION_EVENT_TAP: u32 = 1;
const K_CG_HEAD_INSERT_EVENT_TAP: u32 = 0;
/// LISTEN ONLY. The whole safety posture of this file depends on this value:
/// a listen-only tap cannot alter or drop what the user typed.
const K_CG_EVENT_TAP_OPTION_LISTEN_ONLY: u32 = 1;
const K_CG_EVENT_KEY_DOWN: u32 = 10;
const K_CG_EVENT_TAP_DISABLED_BY_TIMEOUT: u32 = 0xFFFF_FFFE;
const K_CG_EVENT_TAP_DISABLED_BY_USER_INPUT: u32 = 0xFFFF_FFFF;
const AX_MESSAGING_TIMEOUT_SECONDS: f32 = 0.025;

// Reuse the CFString helpers' shape from accessibility.rs rather than
// re-export them: that module keeps its CF surface private on purpose.
#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFStringCreateWithBytes(
        allocator: CFAllocatorRef,
        bytes: *const u8,
        num_bytes: CFIndex,
        encoding: u32,
        is_external_representation: bool,
    ) -> CFStringRef;
    fn CFStringGetLength(string: CFStringRef) -> CFIndex;
    fn CFStringGetMaximumSizeForEncoding(length: CFIndex, encoding: u32) -> CFIndex;
    fn CFStringGetCString(
        string: CFStringRef,
        buffer: *mut u8,
        buffer_size: CFIndex,
        encoding: u32,
    ) -> bool;
    fn CFGetTypeID(cf: CFTypeRef) -> usize;
    fn CFStringGetTypeID() -> usize;
}

const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;

unsafe fn cf_string(value: &str) -> Option<CFStringRef> {
    let created = CFStringCreateWithBytes(
        std::ptr::null(),
        value.as_ptr(),
        value.len() as CFIndex,
        K_CF_STRING_ENCODING_UTF8,
        false,
    );
    if created.is_null() {
        None
    } else {
        Some(created)
    }
}

unsafe fn cf_string_to_string(value: CFStringRef) -> Option<String> {
    let length = CFStringGetLength(value);
    let capacity = CFStringGetMaximumSizeForEncoding(length, K_CF_STRING_ENCODING_UTF8) + 1;
    let mut buffer = vec![0u8; capacity.max(1) as usize];
    if !CFStringGetCString(
        value,
        buffer.as_mut_ptr(),
        capacity,
        K_CF_STRING_ENCODING_UTF8,
    ) {
        return None;
    }
    let end = buffer.iter().position(|b| *b == 0).unwrap_or(0);
    String::from_utf8(buffer[..end].to_vec()).ok()
}

/// Read one string attribute off an AX element. `None` on any failure,
/// including a non-string value — never a guess.
unsafe fn ax_string_attribute(node: CFTypeRef, attribute: &str) -> Option<String> {
    let key = cf_string(attribute)?;
    let mut value: CFTypeRef = std::ptr::null();
    let err = AXUIElementCopyAttributeValue(node, key, &mut value);
    CFRelease(key);
    let mut out = None;
    if err == 0 && !value.is_null() {
        if CFGetTypeID(value) == CFStringGetTypeID() {
            out = cf_string_to_string(value);
        }
        CFRelease(value);
    }
    out
}

/// The focused element's role/subrole, mapped through the pure classifier.
///
/// FAIL-CLOSED at every branch. Secure-event-input short-circuits to
/// `Secure` before any AX call — if the OS says a password is being typed,
/// no amount of AX detail should be able to talk us out of it.
fn focused_field_role() -> FieldRole {
    unsafe {
        if IsSecureEventInputEnabled() {
            return FieldRole::Secure;
        }
        if !AXIsProcessTrusted() {
            // Without Accessibility we cannot identify ANY field, so nothing
            // is capturable. The lane stays alive and honest rather than
            // guessing that unlabelled text is safe.
            return FieldRole::Undeterminable;
        }
        let system_wide = AXUIElementCreateSystemWide();
        if system_wide.is_null() {
            return FieldRole::Undeterminable;
        }
        // Bound the IPC: an unresponsive app degrades to Undeterminable
        // instead of stalling the event tap into a macOS timeout-disable.
        AXUIElementSetMessagingTimeout(system_wide, AX_MESSAGING_TIMEOUT_SECONDS);

        let mut role = FieldRole::Undeterminable;
        if let Some(focused_key) = cf_string("AXFocusedUIElement") {
            let mut focused: CFTypeRef = std::ptr::null();
            let err = AXUIElementCopyAttributeValue(system_wide, focused_key, &mut focused);
            CFRelease(focused_key);
            if err == 0 && !focused.is_null() {
                let role_string = ax_string_attribute(focused, "AXRole");
                let subrole_string = ax_string_attribute(focused, "AXSubrole");
                role = field_role_from_ax(role_string.as_deref(), subrole_string.as_deref());
                CFRelease(focused);
            }
        }
        CFRelease(system_wide);
        role
    }
}

/// The unicode character this key-down produced, if any. Modifier presses,
/// arrows and function keys yield `None` — they are keystrokes for counting
/// purposes but contribute no text.
unsafe fn event_character(event: CGEventRef) -> Option<char> {
    let mut buffer = [0u16; 4];
    let mut length: CFIndex = 0;
    CGEventKeyboardGetUnicodeString(event, buffer.len() as CFIndex, &mut length, buffer.as_mut_ptr());
    if length <= 0 {
        return None;
    }
    let slice = &buffer[..(length as usize).min(buffer.len())];
    String::from_utf16(slice).ok()?.chars().next()
}

/// One observed key, handed from the tap callback to the aggregating thread.
struct KeyEvent {
    ch: Option<char>,
    role: FieldRole,
    app_name: String,
    bundle_id: String,
    at_ms: u64,
}

/// Lives for the tap's lifetime behind a raw pointer in `user_info`.
struct TapContext {
    keys: Sender<KeyEvent>,
}

unsafe extern "C" fn tap_callback(
    proxy: CGEventTapProxy,
    event_type: u32,
    event: CGEventRef,
    user_info: *mut c_void,
) -> CGEventRef {
    // macOS disables a tap whose callback is too slow, or across some user
    // input transitions. Re-arm rather than dying silently — a capture lane
    // that stopped without saying so is exactly the dishonest failure the
    // rest of this workstream is built to avoid.
    if event_type == K_CG_EVENT_TAP_DISABLED_BY_TIMEOUT
        || event_type == K_CG_EVENT_TAP_DISABLED_BY_USER_INPUT
    {
        if !user_info.is_null() {
            let context = &*(user_info as *const TapContext);
            let _ = &context.keys;
        }
        CGEventTapEnable(proxy as CFMachPortRef, true);
        return event;
    }

    if event_type == K_CG_EVENT_KEY_DOWN && !user_info.is_null() {
        let context = &*(user_info as *const TapContext);
        let role = focused_field_role();
        // A character is only READ for a field that could carry one. For a
        // secure or undeterminable field we do not even decode the keystroke
        // — the pure accumulator would discard it, and not decoding means the
        // password's characters never exist as Rust values at all.
        let ch = if matches!(role, FieldRole::ContentOk) {
            event_character(event)
        } else {
            None
        };
        let (app_name, bundle_id) = super::apps::frontmost_app_once()
            .unwrap_or_else(|| ("unknown".to_string(), "unknown".to_string()));
        let _ = context.keys.send(KeyEvent {
            ch,
            role,
            app_name,
            bundle_id,
            at_ms: now_ts_ms(),
        });
    }

    // ALWAYS the untouched event. Listen-only makes this advisory, but an
    // accidental future switch to a mutating tap should still be a no-op.
    event
}

/// CFRunLoopRef is a thread-shared CoreFoundation object; `CFRunLoopStop` is
/// documented as safe to call from another thread, which is the only use made
/// of the pointer here.
struct RunLoopHandle(CFRunLoopRef);
unsafe impl Send for RunLoopHandle {}

pub struct InputProvider {
    stop_flag: Arc<AtomicBool>,
    run_loop: Arc<std::sync::Mutex<Option<RunLoopHandle>>>,
    tap_thread: Option<JoinHandle<()>>,
    aggregator_thread: Option<JoinHandle<()>>,
}

/// Whether the OS will actually deliver keystrokes to a tap right now.
/// Read-only and non-prompting, so it is safe to poll from the Settings card.
pub fn input_permission_granted() -> bool {
    unsafe { CGPreflightListenEventAccess() }
}

/// Non-prompting Input Monitoring status, for the Settings card. Mirrors
/// `ax_permission_status` so the two grants this lane needs are queried the
/// same way.
#[tauri::command]
pub fn input_permission_status() -> bool {
    input_permission_granted()
}

/// Trigger the one-time Input Monitoring prompt. Like the Accessibility
/// prompt, macOS shows it once; afterwards the user must flip the toggle in
/// System Settings themselves — no API can force a second dialog.
///
/// MUST be called only from an explicit user action, never on mount: an
/// unsolicited "let me watch your keystrokes" prompt is the single worst
/// first impression this product could make.
#[tauri::command]
pub fn input_request_permission() -> bool {
    unsafe {
        if CGPreflightListenEventAccess() {
            return true;
        }
        CGRequestListenEventAccess()
    }
}

impl InputProvider {
    /// Start the tap. `Err` when Input Monitoring has not been granted — the
    /// caller surfaces that honestly rather than running a tap that silently
    /// receives nothing.
    pub fn start(tx: Sender<CaptureEmission>) -> Result<Self, String> {
        if !input_permission_granted() {
            return Err(
                "Input Monitoring permission is required (System Settings > Privacy & \
                 Security > Input Monitoring)"
                    .to_string(),
            );
        }

        let stop_flag = Arc::new(AtomicBool::new(false));
        let run_loop = Arc::new(std::sync::Mutex::new(None::<RunLoopHandle>));
        let (key_tx, key_rx) = channel::<KeyEvent>();

        // Aggregator: owns the BurstAccumulator, turns keys into bursts, and
        // ticks so a burst closes on a pause rather than waiting for the next
        // keystroke that may never come.
        let stop_for_aggregator = stop_flag.clone();
        let aggregator_thread = std::thread::spawn(move || {
            let mut accumulator = BurstAccumulator::new();
            while !stop_for_aggregator.load(Ordering::Relaxed) {
                match key_rx.recv_timeout(Duration::from_millis(250)) {
                    Ok(key) => {
                        let context = FocusContext {
                            app_name: key.app_name,
                            app_bundle_id: key.bundle_id,
                            // Browser host is not read here: the AX URL read
                            // is a separate capability, and core's denylist
                            // treats a missing host as "no host matched"
                            // rather than as an allow.
                            host: None,
                            field_role: key.role,
                        };
                        if let Some((burst, _reason)) =
                            accumulator.push_key(key.ch, &context, key.at_ms)
                        {
                            if tx.send(build_emission(&burst)).is_err() {
                                break;
                            }
                        }
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                        if let Some((burst, _reason)) = accumulator.flush_if_idle(now_ts_ms()) {
                            if tx.send(build_emission(&burst)).is_err() {
                                break;
                            }
                        }
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
            // Whatever is still held when capture stops is DROPPED, not
            // flushed: consent may have just been revoked, and a burst that
            // must not be reported must also not be retained.
            accumulator.discard();
        });

        let run_loop_for_tap = run_loop.clone();
        let tap_thread = std::thread::spawn(move || {
            // Leaked deliberately: the tap callback dereferences this for as
            // long as the run loop lives, and the thread ends only when the
            // run loop stops. One small allocation per capture session.
            let context = Box::into_raw(Box::new(TapContext { keys: key_tx }));
            unsafe {
                let tap = CGEventTapCreate(
                    K_CG_SESSION_EVENT_TAP,
                    K_CG_HEAD_INSERT_EVENT_TAP,
                    K_CG_EVENT_TAP_OPTION_LISTEN_ONLY,
                    1u64 << K_CG_EVENT_KEY_DOWN,
                    tap_callback,
                    context as *mut c_void,
                );
                if tap.is_null() {
                    // Permission was revoked between the preflight and here.
                    drop(Box::from_raw(context));
                    return;
                }
                let source = CFMachPortCreateRunLoopSource(std::ptr::null(), tap, 0);
                if source.is_null() {
                    CFRelease(tap);
                    drop(Box::from_raw(context));
                    return;
                }
                let current = CFRunLoopGetCurrent();
                CFRunLoopAddSource(current, source, kCFRunLoopCommonModes);
                CGEventTapEnable(tap, true);
                if let Ok(mut slot) = run_loop_for_tap.lock() {
                    *slot = Some(RunLoopHandle(CFRetain(current)));
                }
                CFRunLoopRun();
                // Reached only after CFRunLoopStop.
                CGEventTapEnable(tap, false);
                CFRelease(source);
                CFRelease(tap);
                drop(Box::from_raw(context));
            }
        });

        Ok(Self {
            stop_flag,
            run_loop,
            tap_thread: Some(tap_thread),
            aggregator_thread: Some(aggregator_thread),
        })
    }

    pub fn stop(mut self) {
        self.stop_flag.store(true, Ordering::Relaxed);
        if let Ok(mut slot) = self.run_loop.lock() {
            if let Some(handle) = slot.take() {
                unsafe {
                    CFRunLoopStop(handle.0);
                    CFRelease(handle.0);
                }
            }
        }
        if let Some(handle) = self.tap_thread.take() {
            let _ = handle.join();
        }
        if let Some(handle) = self.aggregator_thread.take() {
            let _ = handle.join();
        }
    }
}

/// Split a burst into the derived observation and the raw payload.
///
/// The typed text goes in `raw` — NEVER in the observation. `Observation` is
/// documented as carrying no raw capture content, it is what fires the
/// `sensor:capture` blink event, and it is what a future consumer is most
/// likely to log wholesale. The text therefore lands only in the bounded
/// local ring buffer, which the JS side reads deliberately by id before
/// distilling it through `@bridge/core`.
pub fn build_emission(burst: &InputBurst) -> CaptureEmission {
    let mut fields = serde_json::Map::new();
    fields.insert("app_name".to_string(), burst.app_name.as_str().into());
    fields.insert("bundle_id".to_string(), burst.app_bundle_id.as_str().into());
    fields.insert("field_role".to_string(), burst.field_role.into());
    fields.insert("key_count".to_string(), burst.key_count.into());
    fields.insert("started_at_ms".to_string(), burst.started_at_ms.into());
    if let Some(host) = burst.host.as_deref() {
        fields.insert("host".to_string(), host.into());
    }

    CaptureEmission {
        observation: Observation {
            kind: "input".to_string(),
            ts: now_ts_ms(),
            fields,
        },
        // Present only when the field positively allowed content; the pure
        // accumulator guarantees `text` is empty otherwise, and an empty
        // burst carries no raw payload at all.
        raw: if burst.text.is_empty() {
            None
        } else {
            Some(serde_json::json!({ "text": burst.text }))
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::input::FieldRole;

    fn burst(field_role: &'static str, text: &str, key_count: u32) -> InputBurst {
        InputBurst {
            app_name: "Editor".into(),
            app_bundle_id: "com.example.editor".into(),
            host: None,
            field_role,
            text: text.to_string(),
            key_count,
            started_at_ms: 1_000,
        }
    }

    #[test]
    fn the_observation_never_carries_typed_text() {
        // Removal-fails: the observation is what fires the blink event and
        // what a consumer is most likely to log wholesale. Text belongs in
        // the bounded local ring buffer, reached deliberately by id.
        let emission = build_emission(&burst("content_ok", "buy milk", 8));
        let serialized = serde_json::to_string(&emission.observation).unwrap();
        assert!(!serialized.contains("buy milk"));
        assert!(emission.observation.fields.get("text").is_none());
        // …and it IS available as raw, so the lane still works.
        assert_eq!(
            emission.raw.unwrap()["text"],
            serde_json::Value::from("buy milk")
        );
    }

    #[test]
    fn a_suppressed_burst_has_no_raw_payload_and_a_zero_count() {
        let emission = build_emission(&burst("secure", "", 0));
        assert!(emission.raw.is_none(), "nothing to keep for a secure field");
        assert_eq!(
            emission.observation.fields.get("key_count"),
            Some(&serde_json::Value::from(0)),
        );
        assert_eq!(
            emission.observation.fields.get("field_role"),
            Some(&serde_json::Value::from("secure")),
        );
    }

    #[test]
    fn secure_event_input_is_consulted_before_accessibility() {
        // Cannot assert the OS state on an arbitrary machine — the property
        // under test is that the call is sound and that a secure-input
        // machine can never be classified as ordinary text.
        let role = focused_field_role();
        if unsafe { IsSecureEventInputEnabled() } {
            assert_eq!(role, FieldRole::Secure);
        }
        // Whatever the machine's state, the classifier never invents a role.
        assert!(matches!(
            role,
            FieldRole::Secure | FieldRole::Undeterminable | FieldRole::ContentOk
        ));
    }

    #[test]
    fn permission_preflight_is_side_effect_free_and_returns() {
        // Must not prompt; the interactive path is request_input_permission.
        let _ = input_permission_granted();
    }
}
