//! "apps" context provider — frontmost-application observation via
//! `NSWorkspace.shared.frontmostApplication`.
//!
//! Polling, not the `didActivateApplicationNotification` observer: a
//! notification-based observer needs a running `NSRunLoop` on the thread
//! that registers it, which means either driving this from the main thread
//! (contending with the webview event loop) or bridging a Cocoa run loop
//! into a background thread by hand. Polling a plain background thread at
//! ~1s is simpler, has no run-loop coupling, and the "apps" kind only cares
//! about which app is frontmost right now — sub-second latency isn't a
//! requirement. Recorded in ADR-016; revisit if focus-change latency proves
//! too coarse.

use super::{now_ts_ms, CaptureEmission, Observation};
use objc2::rc::autoreleasepool;
use objc2_app_kit::NSWorkspace;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

const POLL_INTERVAL: Duration = Duration::from_millis(1000);

pub struct AppsProvider {
    stop_flag: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl AppsProvider {
    pub fn start(tx: Sender<CaptureEmission>) -> Self {
        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_flag_thread = stop_flag.clone();

        let handle = std::thread::spawn(move || {
            let mut last_bundle_id: Option<String> = None;
            while !stop_flag_thread.load(Ordering::Relaxed) {
                if let Some((app_name, bundle_id)) = frontmost_app() {
                    if last_bundle_id.as_deref() != Some(bundle_id.as_str()) {
                        last_bundle_id = Some(bundle_id.clone());
                        let emission = build_emission(&app_name, &bundle_id);
                        // Receiver dropped (sensor_stop torn down the channel)
                        // just means: stop quietly, no panic.
                        if tx.send(emission).is_err() {
                            break;
                        }
                    }
                }
                std::thread::sleep(POLL_INTERVAL);
            }
        });

        Self {
            stop_flag,
            handle: Some(handle),
        }
    }

    pub fn stop(mut self) {
        self.stop_flag.store(true, Ordering::Relaxed);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

/// One-shot frontmost-app read for callers outside the polling provider
/// (companion.rs uses it as the single lightweight context signal on the
/// local ask path). Same derived-metadata-only contract as the provider.
pub(crate) fn frontmost_app_once() -> Option<(String, String)> {
    frontmost_app()
}

/// Reads NSWorkspace.shared.frontmostApplication, returning (localizedName,
/// bundleIdentifier). Wrapped in an autorelease pool since this runs off the
/// main thread on a fresh Cocoa call each poll tick.
fn frontmost_app() -> Option<(String, String)> {
    autoreleasepool(|_| {
        let app_manager = NSWorkspace::sharedWorkspace();
        let app = app_manager.frontmostApplication()?;
        let name = app
            .localizedName()
            .map(|s| s.to_string())
            .unwrap_or_else(|| "unknown".to_string());
        let bundle_id = app
            .bundleIdentifier()
            .map(|s| s.to_string())
            .unwrap_or_else(|| "unknown".to_string());
        Some((name, bundle_id))
    })
}

fn build_emission(app_name: &str, bundle_id: &str) -> CaptureEmission {
    let mut fields = serde_json::Map::new();
    fields.insert("app_name".to_string(), app_name.into());
    fields.insert("bundle_id".to_string(), bundle_id.into());

    CaptureEmission {
        observation: Observation {
            kind: "apps".to_string(),
            ts: now_ts_ms(),
            fields,
        },
        // Focus events carry no raw payload beyond the observation itself —
        // app name + bundle id ARE the whole capture, nothing more to keep
        // in the ring buffer.
        raw: None,
    }
}
