//! sensor_bridge — the Rust side of the Sensor SPI (@bridge/sensors).
//!
//! P0 slice: "apps" (NSWorkspace frontmost-app polling) and "clipboard"
//! (NSPasteboard changeCount polling) are REAL macOS providers now. "screen"
//! stays an honest on-demand-only stub (ScreenCaptureKit / CGWindowList
//! headless capture needs the Screen Recording permission granted
//! interactively; there's no meaningful headless capture to build against
//! here) but `sensor_list` now reports real availability + permission state
//! for all three so the JS side can render "granted / needs prompt / denied"
//! per provider instead of guessing.
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
use crate::providers::{apps::AppsProvider, clipboard::ClipboardProvider};

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
    if let Some(receiver) = inner.receiver.as_ref() {
        while let Ok(emission) = receiver.try_recv() {
            if let Some(raw) = emission.raw {
                inner.raw_ring.push(&emission.observation.kind, raw);
            }
            inner.queue.push(emission.observation);
        }
    }
}

const KNOWN_SENSOR_IDS: &[&str] = &["apps", "clipboard", "screen"];

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
                // permission entitlement.
                availability: "available",
                permission_note: None,
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
                // ON-DEMAND capture is real now (capture_screenshot_on_demand /
                // capture_display_jpeg, TASK-027). Streaming capture remains
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
            "screen" => {
                return Err(not_implemented(
                    "sensor_start(screen)",
                    "ScreenCaptureKit / CGWindowListCreateImage (on-demand only; use \
                     capture_screenshot_on_demand)",
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
/// Returns the (possibly refreshed) grant state. Safe to call repeatedly —
/// macOS only actually prompts once; afterwards the user must flip it in
/// System Settings.
#[cfg(target_os = "macos")]
fn request_screen_permission() -> bool {
    unsafe {
        if CGPreflightScreenCaptureAccess() {
            return true;
        }
        CGRequestScreenCaptureAccess()
    }
}

/// One captured display frame plus honest metadata. The JPEG bytes are raw
/// capture material: LOCAL-PLANE ONLY unless the user explicitly consented,
/// for one specific ask, to cloud egress (companion.rs documents that gate).
pub struct CapturedScreen {
    pub jpeg_bytes: Vec<u8>,
    pub image_width: usize,
    pub image_height: usize,
    pub permission_granted: bool,
}

/// Capture ONE JPEG frame of the given display (0-indexed, matching the
/// overlay/annotate monitor labels). Every capture:
///  - pushes an inspectable `screen` observation into the drain queue
///    (metadata only — never the image bytes, per the Observation contract),
///  - emits the `sensor.capture` blink-tell event.
/// The image bytes go only to the caller.
pub fn capture_display_jpeg(
    app: &AppHandle,
    monitor_index: usize,
) -> Result<CapturedScreen, String> {
    #[cfg(target_os = "macos")]
    {
        let disabled = with_hub(app, |inner| inner.disabled)?;
        if disabled {
            return Err(
                "capture is disabled because the trusted Bridge surface is unavailable".to_string(),
            );
        }
        let permission_granted = request_screen_permission();
        let file = std::env::temp_dir().join(format!(
            "bridge-companion-capture-{}-{}.jpg",
            std::process::id(),
            crate::providers::now_ts_ms()
        ));
        // `screencapture` displays are 1-indexed; `-x` mutes the shutter
        // sound. An out-of-range display makes the tool fail, which we
        // surface rather than silently capturing the wrong screen.
        let status = std::process::Command::new("screencapture")
            .arg("-x")
            .arg("-t")
            .arg("jpg")
            .arg("-D")
            .arg((monitor_index + 1).to_string())
            .arg(&file)
            .status()
            .map_err(|error| format!("screencapture failed to start: {error}"))?;
        if !status.success() {
            let _ = std::fs::remove_file(&file);
            return Err(format!("screencapture exited with status {status}"));
        }
        let jpeg_bytes =
            std::fs::read(&file).map_err(|error| format!("captured file unreadable: {error}"))?;
        let _ = std::fs::remove_file(&file);
        let size = imagesize::blob_size(&jpeg_bytes)
            .map_err(|error| format!("captured image undecodable: {error}"))?;

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
        with_hub(app, |inner| inner.queue.push(observation.clone()))?;
        let _ = app.emit(
            "sensor:capture",
            serde_json::to_value(&observation).unwrap_or(serde_json::Value::Null),
        );

        Ok(CapturedScreen {
            jpeg_bytes,
            image_width: size.width,
            image_height: size.height,
            permission_granted,
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, monitor_index);
        Err("screen capture is only implemented on macOS in this slice".to_string())
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

/// Screenshot metadata returned to the webview. The image itself is base64
/// JPEG — requested explicitly by the user (Observe / companion ask), never
/// streamed.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotPayload {
    pub base64_jpeg: String,
    pub image_width: usize,
    pub image_height: usize,
    pub permission_granted: bool,
}

/// One ON-DEMAND screenshot of the calling window's display — never a
/// rolling recorder. Captures the display the calling overlay lives on
/// (its label encodes the monitor index; the main window maps to display 0).
#[tauri::command]
pub fn capture_screenshot_on_demand(
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<ScreenshotPayload, SensorBridgeError> {
    #[cfg(target_os = "macos")]
    {
        use base64::Engine;
        let monitor_index = crate::overlay::monitor_index_for_label(window.label());
        let captured =
            capture_display_jpeg(&app, monitor_index).map_err(|message| SensorBridgeError {
                code: "SENSOR_CAPTURE_FAILED",
                message,
            })?;
        Ok(ScreenshotPayload {
            base64_jpeg: base64::engine::general_purpose::STANDARD.encode(&captured.jpeg_bytes),
            image_width: captured.image_width,
            image_height: captured.image_height,
            permission_granted: captured.permission_granted,
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, window);
        Err(not_implemented(
            "capture_screenshot_on_demand",
            "a Windows/Linux capture path (GDI / xdg-desktop-portal)",
        ))
    }
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
}
