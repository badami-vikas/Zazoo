//! sensor_bridge — the Rust side of the Sensor SPI (@bridge/sensors).
//!
//! P0 slice: "apps" (NSOrganization frontmost-app polling) and "clipboard"
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
use tauri::{AppHandle, Emitter, State};

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
                // NSOrganization.frontmostApplication needs no special macOS
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
                // Real capture needs the Screen Recording permission grant,
                // which requires an interactive prompt (CGPreflightScreenCaptureAccess
                // / ScreenCaptureKit); no headless capture path exists yet.
                availability: "not_implemented",
                permission_note: Some(
                    "Screen Recording permission required (System Settings > Privacy \
                     & Security > Screen Recording); capture path not yet built \
                     (see capture_screenshot_on_demand stub)"
                        .to_string(),
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
        let _ = app.emit("sensor.started", ());
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
        let _ = app.emit("sensor.capture", &value);
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

/// One ON-DEMAND screenshot of the frontmost window — never a rolling
/// recorder. Still a stub in this P0 slice: real capture needs the Screen
/// Recording permission granted interactively (ScreenCaptureKit /
/// CGWindowListCreateImage), which has no meaningful headless path to build
/// and verify here. `sensor_list` reports this honestly via `availability:
/// "not_implemented"` above.
#[tauri::command]
pub fn capture_screenshot_on_demand() -> Result<String, SensorBridgeError> {
    Err(not_implemented(
        "capture_screenshot_on_demand",
        "CGWindowListCreateImage (or ScreenCaptureKit SCScreenshotManager on macOS 14+)",
    ))
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
