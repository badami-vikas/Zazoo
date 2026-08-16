//! sensor_bridge — the Rust side of the Sensor SPI (@bridge/sensors).
//!
//! P0 slice: "apps" (NSWorkspace frontmost-app polling) and "clipboard"
//! (NSPasteboard changeCount polling) are REAL macOS providers. "screen" is
//! REAL on-demand capture only: it preflights Screen Recording permission and
//! refuses wallpaper-only output when the grant is absent. `sensor_list`
//! reports real availability + permission state for all three so the JS side
//! can render "granted / needs prompt / denied" instead of guessing.
//!
//! Lifecycle: `sensor_start`/`sensor_stop` actually start/stop a background
//! poller thread per provider (see providers/apps.rs, providers/clipboard.rs).
//! Emitted CaptureEmissions are NOT pushed anywhere automatically — they are
//! buffered (observation queue + raw ring buffer) and DRAINED by the caller
//! via `sensor_drain`. This "drain, don't push" design keeps this crate free
//! of HTTP egress: the JS side owns POSTing to the CaptureLedger, and the
//! Rust core owns nothing past collecting + buffering. A `sensor.capture`
//! Tauri event still fires per observation as the blink-tell hook — drain is
//! for bulk transfer, the event is for the live "something happened" signal.
//!
//! Remaining kinds (voice/filesystem/browser/documents/emails) land after
//! this slice; same SPI, no shell changes needed.

use crate::providers::{CaptureEmission, ObservationQueue, RawRingBuffer};
use serde::Serialize;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager as _, State};

#[cfg(target_os = "macos")]
use crate::providers::{
    apps::AppsProvider, clipboard::ClipboardProvider, input_tap::InputProvider,
};

/// Error shape every sensor command returns on failure. Typed (code +
/// message) so the TS side can branch on `code` instead of string-matching.
#[derive(Serialize)]
pub struct SensorBridgeError {
    pub code: &'static str,
    pub message: String,
}

fn not_implemented(what: &str, native_api: &str) -> SensorBridgeError {
    SensorBridgeError {
        code: "SENSOR_NOT_IMPLEMENTED",
        message: format!(
            "{what} is not yet implemented on this platform (will use {native_api}); \
             the Sensor SPI contract lives in @bridge/sensors"
        ),
    }
}

/// Used on the `#[cfg(not(target_os = "macos"))]` fallback arm of each
/// command below; on macOS builds those arms are dead by construction, which
/// would otherwise warn here as unused.
#[cfg_attr(target_os = "macos", allow(dead_code))]
fn unsupported_platform(what: &str) -> SensorBridgeError {
    SensorBridgeError {
        code: "SENSOR_UNSUPPORTED_PLATFORM",
        message: format!("{what} is only implemented on macOS in this P0 slice"),
    }
}

/// A provider the shell knows about, mirrored to @bridge/sensors'
/// `ContextProvider` (id + kind; plane is always "local" by construction).
#[derive(Serialize)]
pub struct SensorDescriptor {
    pub id: String,
    pub kind: String,
    /// Honest capability reporting: "available" (usable right now, no OS
    /// permission gate — apps/clipboard), "needs_permission" (usable but
    /// gated on a permission the user hasn't granted yet), or
    /// "not_implemented" (no capture path built yet — screen, for now).
    pub availability: &'static str,
    /// Free-text note on what permission (if any) gates this provider and
    /// its current state, for UI display. None when no permission applies.
    pub permission_note: Option<String>,
}

enum RunningProvider {
    #[cfg(target_os = "macos")]
    Apps(AppsProvider),
    #[cfg(target_os = "macos")]
    Clipboard(ClipboardProvider),
    /// K11 (TASK-054): the listen-only keystroke tap. Started only when the
    /// JS side has confirmed "input" capture consent — this hub does not
    /// know about consent, and must never be the only thing that does.
    #[cfg(target_os = "macos")]
    Input(InputProvider),
}

/// Shared sensor-hub state: which providers are running, the pending
/// observation queue, and the bounded raw ring buffer. One instance is
/// managed by Tauri and injected into every command via `State`.
pub struct SensorHubState {
    inner: Mutex<SensorHubInner>,
}

struct SensorHubInner {
    disabled: bool,
    running: std::collections::HashMap<String, RunningProvider>,
    receiver: Option<Receiver<CaptureEmission>>,
    sender: Sender<CaptureEmission>,
    queue: ObservationQueue,
    raw_ring: RawRingBuffer,
}

const RAW_RING_CAPACITY: usize = 256;

impl Default for SensorHubState {
    fn default() -> Self {
        let (sender, receiver) = channel();
        Self {
            inner: Mutex::new(SensorHubInner {
                disabled: false,
                running: std::collections::HashMap::new(),
                receiver: Some(receiver),
                sender,
                queue: ObservationQueue::new(),
                raw_ring: RawRingBuffer::new(RAW_RING_CAPACITY),
            }),
        }
    }
}

/// Stop every provider and discard all pending/raw capture material. Used when
/// the trusted desktop surface is lost so capture can never continue headless.
pub fn shutdown(state: &SensorHubState) -> Result<(), String> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "sensor hub mutex is poisoned".to_string())?;
    inner.disabled = true;
    #[cfg(target_os = "macos")]
    for (_, provider) in inner.running.drain() {
        match provider {
            RunningProvider::Apps(provider) => provider.stop(),
            RunningProvider::Clipboard(provider) => provider.stop(),
            RunningProvider::Input(provider) => provider.stop(),
        }
    }
    #[cfg(not(target_os = "macos"))]
    inner.running.clear();
    if let Some(receiver) = inner.receiver.as_ref() {
        while receiver.try_recv().is_ok() {}
    }
    inner.queue = ObservationQueue::new();
    inner.raw_ring = RawRingBuffer::new(RAW_RING_CAPACITY);
    Ok(())
}

/// Drains anything sitting in the mpsc channel into the queue/ring-buffer.
/// Called opportunistically from `sensor_drain` and `sensor_read_raw` so
/// emissions don't sit unclaimed in the channel between polls.
fn pump_channel(inner: &mut SensorHubInner) {
    // `receiver` is only briefly `None` during construction races that don't
    // occur in practice (state is built once via `Default`), so this is a
    // straightforward best-effort drain.
    // Collect first, then mutate: `raw_ring` and `queue` are separate fields
    // and the ring's assigned id has to reach the observation that owns it.
    let mut pending = Vec::new();
    if let Some(receiver) = inner.receiver.as_ref() {
        while let Ok(emission) = receiver.try_recv() {
            pending.push(emission);
        }
    }
    for emission in pending {
        let mut observation = emission.observation;
        if let Some(raw) = emission.raw {
            // K11: the raw id is how a consumer reaches the payload at all.
            // Without it a drained observation announcing a captured burst
            // would be unusable — the text sits in the ring with no handle,
            // so the lane would look alive and deliver nothing.
            let id = inner.raw_ring.push(&observation.kind, raw);
            observation
                .fields
                .insert("raw_id".to_string(), serde_json::Value::from(id));
        }
        inner.queue.push(observation);
    }
}

const KNOWN_SENSOR_IDS: &[&str] = &["apps", "clipboard", "screen", "input"];

/// List the context providers this shell can offer, each with honest
/// capability + permission-state reporting.
#[tauri::command]
pub fn sensor_list() -> Result<Vec<SensorDescriptor>, SensorBridgeError> {
    #[cfg(target_os = "macos")]
    {
        Ok(vec![
            SensorDescriptor {
                id: "apps".to_string(),
                kind: "apps".to_string(),
                // NSWorkspace.frontmostApplication needs no special macOS
                // permission entitlement; the K7 window-title half is
                // Accessibility-gated and fails closed (app names only)
                // until the user grants it — reported honestly here.
                availability: "available",
                permission_note: if crate::providers::accessibility::ax_permission_status() {
                    None
                } else {
                    Some(
                        "window titles require the Accessibility permission (System \
                         Settings > Privacy & Security > Accessibility); capturing app \
                         names only until granted"
                            .to_string(),
                    )
                },
            },
            SensorDescriptor {
                id: "clipboard".to_string(),
                kind: "clipboard".to_string(),
                // NSPasteboard read access needs no special permission
                // either (unlike iOS, macOS doesn't gate general-pasteboard
                // reads behind a user prompt).
                availability: "available",
                permission_note: None,
            },
            SensorDescriptor {
                id: "screen".to_string(),
                kind: "screen".to_string(),
                // ON-DEMAND capture is real now (capture_display_jpeg via the
                // companion/point actions, TASK-027). Streaming capture remains
                // unbuilt by design — no rolling recorder. Availability
                // reflects the live Screen Recording permission state.
                availability: if screen_permission_granted() {
                    "available"
                } else {
                    "needs_permission"
                },
                permission_note: if screen_permission_granted() {
                    Some("on-demand screenshots only; no rolling recorder".to_string())
                } else {
                    Some(
                        "Screen Recording permission required (System Settings > Privacy \
                         & Security > Screen Recording); until granted, screenshots may \
                         show only the desktop wallpaper"
                            .to_string(),
                    )
                },
            },
            SensorDescriptor {
                id: "input".to_string(),
                kind: "input".to_string(),
                // K11 (TASK-054). TWO grants gate this one, and the honest
                // answer differs by which is missing. Without Input
                // Monitoring macOS delivers no keystrokes at all, so the
                // provider refuses to start rather than run deaf. WITH it but
                // without Accessibility we receive keys and can identify no
                // field — which fails closed to "undeterminable", so every
                // burst is suppressed and nothing is stored. That is a
                // usable-but-useless state, and saying so plainly is the
                // point of this field.
                availability: if crate::providers::input_tap::input_permission_granted() {
                    "available"
                } else {
                    "needs_permission"
                },
                permission_note: Some(
                    match (
                        crate::providers::input_tap::input_permission_granted(),
                        crate::providers::accessibility::ax_permission_status(),
                    ) {
                        (false, _) => "Input Monitoring permission required (System Settings > \
                             Privacy & Security > Input Monitoring); typing capture cannot start \
                             without it"
                            .to_string(),
                        (true, false) => "Accessibility permission also required (System Settings \
                             > Privacy & Security > Accessibility): without it no field can be \
                             identified, so every keystroke is suppressed and nothing is stored"
                            .to_string(),
                        (true, true) => "typed text is captured ONLY in positively identified \
                             ordinary text fields — never password or unidentifiable fields, \
                             never denied apps"
                            .to_string(),
                    },
                ),
            },
        ])
    }
    #[cfg(not(target_os = "macos"))]
    {
        // Graceful degradation (XP-1): off-macOS the shell still compiles and
        // runs, it just offers ZERO capture providers. An empty list (not an
        // error) is the honest "no sensors on this platform" signal — the JS
        // side renders it as "capture unavailable here" rather than surfacing a
        // fault, and the rest of Bridge stays fully usable (sensors are an
        // optional capability, per the lib.rs contract). The other sensor
        // commands still return `unsupported_platform` since you can't
        // start/stop/drain a provider that doesn't exist.
        Ok(Vec::new())
    }
}

/// Start a provider by id: spins up its background poller thread. Returns
/// Ok(()) immediately if already running (idempotent start).
#[tauri::command]
pub fn sensor_start(
    sensor_id: String,
    state: State<'_, SensorHubState>,
    app: AppHandle,
) -> Result<(), SensorBridgeError> {
    if !KNOWN_SENSOR_IDS.contains(&sensor_id.as_str()) {
        return Err(SensorBridgeError {
            code: "SENSOR_UNKNOWN_ID",
            message: format!("no provider registered for id '{sensor_id}'"),
        });
    }

    #[cfg(target_os = "macos")]
    {
        let mut inner = state.inner.lock().expect("sensor hub mutex poisoned");
        if inner.disabled {
            return Err(SensorBridgeError {
                code: "SENSOR_DISABLED",
                message: "capture is disabled because the trusted Bridge surface is unavailable"
                    .to_string(),
            });
        }
        if inner.running.contains_key(&sensor_id) {
            return Ok(());
        }

        let tx = inner.sender.clone();
        let running = match sensor_id.as_str() {
            "apps" => RunningProvider::Apps(AppsProvider::start(tx)),
            "clipboard" => RunningProvider::Clipboard(ClipboardProvider::start(tx)),
            "input" => match InputProvider::start(tx) {
                Ok(provider) => RunningProvider::Input(provider),
                // Honest refusal rather than a tap that silently receives
                // nothing: without Input Monitoring macOS delivers no keys,
                // and a lane that looks running but is deaf is exactly the
                // dishonest state this workstream keeps refusing to ship.
                Err(message) => {
                    return Err(SensorBridgeError {
                        code: "SENSOR_PERMISSION_REQUIRED",
                        message,
                    })
                }
            },
            "screen" => {
                return Err(not_implemented(
                    "sensor_start(screen)",
                    "ScreenCaptureKit / CGWindowListCreateImage (on-demand only; use the \
                     companion ask or point action)",
                ))
            }
            _ => unreachable!("checked against KNOWN_SENSOR_IDS above"),
        };
        inner.running.insert(sensor_id, running);

        // Fire an initial blink-tell so the overlay avatar can confirm the
        // provider came up, even before its first observation lands.
        // Colon-separated: Tauri v2 rejects dotted event names at emit time.
        let _ = app.emit("sensor:started", ());
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (state, app);
        Err(unsupported_platform("sensor_start"))
    }
}

/// Stop a provider by id: tears down its poller thread. Ok(()) if it wasn't
/// running (idempotent stop).
#[tauri::command]
pub fn sensor_stop(
    sensor_id: String,
    state: State<'_, SensorHubState>,
) -> Result<(), SensorBridgeError> {
    #[cfg(target_os = "macos")]
    {
        let mut inner = state.inner.lock().expect("sensor hub mutex poisoned");
        if let Some(provider) = inner.running.remove(&sensor_id) {
            match provider {
                RunningProvider::Apps(p) => p.stop(),
                RunningProvider::Clipboard(p) => p.stop(),
                RunningProvider::Input(p) => p.stop(),
            }
        }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (sensor_id, state);
        Err(unsupported_platform("sensor_stop"))
    }
}

/// Drain all pending derived observations (JSON array). The JS side is
/// responsible for POSTing these to the CaptureLedger; this crate never
/// does HTTP egress itself. Also emits `sensor.capture` once per drained
/// observation (the blink-tell hook) so the overlay avatar reacts even if
/// the JS side drains in batches.
#[tauri::command]
pub fn sensor_drain(
    state: State<'_, SensorHubState>,
    app: AppHandle,
) -> Result<Vec<serde_json::Value>, SensorBridgeError> {
    let mut inner = state.inner.lock().expect("sensor hub mutex poisoned");
    pump_channel(&mut inner);
    let observations = inner.queue.drain();
    drop(inner);

    let mut out = Vec::with_capacity(observations.len());
    for obs in observations {
        let value = serde_json::to_value(&obs).unwrap_or(serde_json::Value::Null);
        // "sensor:capture", not the historical dotted name — Tauri v2
        // rejects '.' in event names, so the dotted emit never delivered.
        let _ = app.emit("sensor:capture", &value);
        out.push(value);
    }
    Ok(out)
}

/// Read one raw capture by id from the bounded ring buffer (local-only
/// command; never called as part of the derived-observation path). Returns
/// null if the id has aged out of the ring or never existed.
#[tauri::command]
pub fn sensor_read_raw(
    id: u64,
    state: State<'_, SensorHubState>,
) -> Result<Option<serde_json::Value>, SensorBridgeError> {
    let mut inner = state.inner.lock().expect("sensor hub mutex poisoned");
    pump_channel(&mut inner);
    Ok(inner
        .raw_ring
        .get(id)
        .map(|entry| serde_json::to_value(entry).unwrap_or(serde_json::Value::Null)))
}

// ---------------------------------------------------------------------------
// On-demand screen capture (TASK-027 — real implementation)
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

/// Non-prompting check of the Screen Recording permission. Off-macOS this is
/// `false` — no capture path exists there yet.
pub fn screen_permission_granted() -> bool {
    #[cfg(target_os = "macos")]
    unsafe {
        CGPreflightScreenCaptureAccess()
    }
    #[cfg(not(target_os = "macos"))]
    false
}

/// Trigger the one-time OS Screen Recording prompt when not yet granted.
/// The caller must preflight again after this returns; the request result does
/// not replace a refreshed permission check. Safe to call repeatedly — macOS
/// only actually prompts once; afterwards the user must flip it in Settings.
#[cfg(target_os = "macos")]
fn request_screen_permission() -> bool {
    unsafe {
        if CGPreflightScreenCaptureAccess() {
            return true;
        }
        CGRequestScreenCaptureAccess()
    }
}

#[derive(Debug)]
pub struct ScreenCaptureError {
    pub code: &'static str,
    pub message: String,
}

impl ScreenCaptureError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

fn screen_permission_gate(granted_after_request: bool) -> Result<(), ScreenCaptureError> {
    if granted_after_request {
        return Ok(());
    }
    Err(ScreenCaptureError::new(
        "SCREEN_PERMISSION_REQUIRED",
        "Screen Recording permission is required. Bridge refused a wallpaper-only capture because \
         it would not represent the visible screen. Enable Bridge Desktop in System Settings > \
         Privacy & Security > Screen Recording, then quit and reopen Bridge.",
    ))
}

/// One captured display frame plus honest metadata. The JPEG bytes are raw
/// capture material: LOCAL-PLANE ONLY unless the user explicitly consented,
/// for one specific ask, to cloud egress (companion.rs documents that gate).
pub struct CapturedScreen {
    pub jpeg_bytes: Vec<u8>,
    pub image_width: usize,
    pub image_height: usize,
}

/// Capture ONE JPEG frame of the given display (0-indexed, matching the
/// overlay/annotate monitor labels). Every capture:
///  - pushes an inspectable `screen` observation into the drain queue
///    (metadata only — never the image bytes, per the Observation contract),
///  - emits the `sensor.capture` blink-tell event.
///
/// The image bytes go only to the caller.
pub fn capture_display_jpeg(
    app: &AppHandle,
    monitor_index: usize,
) -> Result<CapturedScreen, ScreenCaptureError> {
    #[cfg(target_os = "macos")]
    {
        let disabled = with_hub(app, |inner| inner.disabled)
            .map_err(|message| ScreenCaptureError::new("SENSOR_HUB_UNAVAILABLE", message))?;
        if disabled {
            return Err(ScreenCaptureError::new(
                "SENSOR_DISABLED",
                "capture is disabled because the trusted Bridge surface is unavailable",
            ));
        }
        let granted_before_request = screen_permission_granted();
        if !granted_before_request {
            let _ = request_screen_permission();
        }
        let permission_granted = screen_permission_granted();
        screen_permission_gate(permission_granted)?;

        let file = std::env::temp_dir().join(format!(
            "bridge-companion-capture-{}-{}.jpg",
            std::process::id(),
            crate::providers::now_ts_ms()
        ));
        // `screencapture` displays are 1-indexed; `-x` mutes the shutter
        // sound. An out-of-range display makes the tool fail, which we
        // surface rather than silently capturing the wrong screen.
        let status = std::process::Command::new("/usr/sbin/screencapture")
            .arg("-x")
            .arg("-t")
            .arg("jpg")
            .arg("-D")
            .arg((monitor_index + 1).to_string())
            .arg(&file)
            .status()
            .map_err(|error| {
                ScreenCaptureError::new(
                    "SCREEN_CAPTURE_FAILED",
                    format!("screencapture failed to start: {error}"),
                )
            })?;
        if !status.success() {
            let _ = std::fs::remove_file(&file);
            return Err(ScreenCaptureError::new(
                "SCREEN_CAPTURE_FAILED",
                format!("screencapture exited with status {status}"),
            ));
        }
        let jpeg_bytes = std::fs::read(&file);
        // Remove capture material even when reading it fails.
        let _ = std::fs::remove_file(&file);
        let jpeg_bytes = jpeg_bytes.map_err(|error| {
            ScreenCaptureError::new(
                "SCREEN_CAPTURE_EMPTY",
                format!("captured file unreadable: {error}"),
            )
        })?;
        let size = imagesize::blob_size(&jpeg_bytes).map_err(|error| {
            ScreenCaptureError::new(
                "SCREEN_CAPTURE_EMPTY",
                format!("captured image undecodable: {error}"),
            )
        })?;

        // Every capture → an inspectable entry + the blink tell. Metadata
        // only; the raw frame never enters the queue or the event payload.
        let observation = crate::providers::Observation {
            kind: "screen".to_string(),
            ts: crate::providers::now_ts_ms(),
            fields: serde_json::json!({
                "trigger": "on_demand",
                "monitor": monitor_index,
                "permissionGranted": permission_granted,
                "imageWidth": size.width,
                "imageHeight": size.height,
            })
            .as_object()
            .cloned()
            .unwrap_or_default(),
        };
        with_hub(app, |inner| inner.queue.push(observation.clone()))
            .map_err(|message| ScreenCaptureError::new("SENSOR_HUB_UNAVAILABLE", message))?;
        let _ = app.emit(
            "sensor:capture",
            serde_json::to_value(&observation).unwrap_or(serde_json::Value::Null),
        );

        Ok(CapturedScreen {
            jpeg_bytes,
            image_width: size.width,
            image_height: size.height,
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, monitor_index);
        Err(ScreenCaptureError::new(
            "SENSOR_NOT_IMPLEMENTED",
            "screen capture is only implemented on macOS in this slice",
        ))
    }
}

#[cfg(target_os = "macos")]
fn with_hub<T>(app: &AppHandle, f: impl FnOnce(&mut SensorHubInner) -> T) -> Result<T, String> {
    let state = app.state::<SensorHubState>();
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "sensor hub mutex is poisoned".to_string())?;
    Ok(f(&mut inner))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::Observation;

    #[test]
    fn shutdown_discards_pending_and_raw_capture_material() {
        let state = SensorHubState::default();
        {
            let mut inner = state.inner.lock().expect("sensor hub should lock");
            inner.queue.push(Observation {
                kind: "clipboard".to_string(),
                ts: 1,
                fields: serde_json::Map::new(),
            });
            inner
                .raw_ring
                .push("clipboard", serde_json::json!({ "text": "private" }));
        }

        shutdown(&state).expect("sensor shutdown should succeed");

        let inner = state.inner.lock().expect("sensor hub should lock");
        assert!(inner.disabled);
        assert!(inner.running.is_empty());
        assert!(inner.queue.is_empty());
        assert!(inner.raw_ring.is_empty());
    }

    #[test]
    fn screen_permission_gate_refuses_wallpaper_only_capture() {
        assert!(screen_permission_gate(true).is_ok());

        let error = screen_permission_gate(false)
            .expect_err("an ungranted capture must fail closed");
        assert_eq!(error.code, "SCREEN_PERMISSION_REQUIRED");
        assert!(error.message.contains("wallpaper-only"));
        assert!(error.message.contains("quit and reopen Bridge"));
    }
}
