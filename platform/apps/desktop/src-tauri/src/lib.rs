//! Bridge desktop shell (Tauri v2).
//!
//! This shell HOSTS apps/web (the same web app the browser serves — Notion
//! model: one kernel, three thin clients) and adds the only things a native
//! shell can: the capture core (context providers) and the overlay avatar.
//!
//! Non-negotiable contracts (docs/wiki/vision.md + docs/wiki/clients.md):
//!  - RAW CAPTURE IS LOCAL-PLANE ONLY. Frames, AX dumps, audio, full document
//!    text never leave this machine; only derived ContextObservations /
//!    Memory entries cross the gate. The kernel-side hub (@bridge/sensors)
//!    enforces this structurally; this shell must never open a side channel
//!    around it.
//!  - EVERY CAPTURE → AN INSPECTABLE MEMORY ENTRY (timeline_entries via the
//!    CaptureLedger). No silent sensing, ever.
//!  - THE AVATAR BLINK IS THE TELL: each ingested capture emits a
//!    "sensor.capture" event; the overlay avatar subscribes and blinks. If
//!    the avatar didn't blink, Bridge didn't capture.
//!  - Sensors are OPTIONAL capabilities. Deny the OS permissions and Bridge
//!    remains fully useful (graceful degradation) — the shell must never
//!    gate core workflows on capture permissions.

mod providers;
mod sensor_bridge;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(sensor_bridge::SensorHubState::default())
        .invoke_handler(tauri::generate_handler![
            sensor_bridge::sensor_list,
            sensor_bridge::sensor_start,
            sensor_bridge::sensor_stop,
            sensor_bridge::sensor_drain,
            sensor_bridge::sensor_read_raw,
            sensor_bridge::capture_screenshot_on_demand
        ])
        .run(tauri::generate_context!())
        .expect("error while running Bridge desktop shell");
}
