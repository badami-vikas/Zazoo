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
            // K7: the change key is (bundle id, window title) — switching
            // documents/tabs inside one app is a focus change worth one
            // emission, same grain as switching apps. The title is None
            // whenever Accessibility is not granted or the AX read failed
            // (fail-closed; the absence itself is the suppression marker).
            let mut last_focus: Option<(String, Option<String>)> = None;
            while !stop_flag_thread.load(Ordering::Relaxed) {
                if let Some((app_name, bundle_id, pid)) = frontmost_app() {
                    let title = crate::providers::accessibility::focused_window_title(pid);
                    let key = (bundle_id.clone(), title.clone());
                    if last_focus.as_ref() != Some(&key) {
                        last_focus = Some(key);
                        let emission = build_emission(&app_name, &bundle_id, title.as_deref());
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
    frontmost_app().map(|(name, bundle_id, _pid)| (name, bundle_id))
}

/// Reads NSWorkspace.shared.frontmostApplication, returning (localizedName,
/// bundleIdentifier, pid). Wrapped in an autorelease pool since this runs off
/// the main thread on a fresh Cocoa call each poll tick. The pid feeds the
/// K7 window-title read (accessibility::focused_window_title).
fn frontmost_app() -> Option<(String, String, i32)> {
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
        let pid = app.processIdentifier();
        Some((name, bundle_id, pid))
    })
}

fn build_emission(app_name: &str, bundle_id: &str, window_title: Option<&str>) -> CaptureEmission {
    let mut fields = serde_json::Map::new();
    fields.insert("app_name".to_string(), app_name.into());
    fields.insert("bundle_id".to_string(), bundle_id.into());
    // Fail-closed contract: the key is ABSENT when the title was suppressed
    // (no Accessibility grant / AX read failed) — absence is the marker the
    // drain loop forwards as null; an empty title is a real value.
    if let Some(title) = window_title {
        fields.insert("window_title".to_string(), title.into());
    }

    CaptureEmission {
        observation: Observation {
            kind: "apps".to_string(),
            ts: now_ts_ms(),
            fields,
        },
        // Focus events carry no raw payload beyond the observation itself —
        // app name + bundle id + title ARE the whole capture, nothing more
        // to keep in the ring buffer.
        raw: None,
    }
}

#[cfg(test)]
mod tests {
    use super::build_emission;

    #[test]
    fn emission_includes_title_only_when_read() {
        let with_title = build_emission("Xcode", "com.apple.dt.Xcode", Some("bridge — build"));
        assert_eq!(with_title.observation.kind, "apps");
        assert_eq!(
            with_title.observation.fields.get("window_title"),
            Some(&serde_json::Value::from("bridge — build")),
        );

        // Suppressed (no grant): the key is absent, not null/empty.
        let suppressed = build_emission("Mail", "com.apple.mail", None);
        assert!(!suppressed.observation.fields.contains_key("window_title"));

        // An app that titled its window "" still carries the field.
        let empty = build_emission("Mail", "com.apple.mail", Some(""));
        assert_eq!(
            empty.observation.fields.get("window_title"),
            Some(&serde_json::Value::from("")),
        );
    }
}
