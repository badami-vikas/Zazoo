//! "clipboard" context provider — `NSPasteboard.general` `changeCount`
//! polling (~1s), per the Sensor SPI raw/derived split.
//!
//! Policy (ADR-016): the DERIVED observation crossing into `Observation` /
//! the `sensor.capture` event carries only a content-type tag, a length, and
//! a hash of the clipboard text — never the text itself. Raw text is kept
//! ONLY in the bounded in-memory ring buffer and is retrievable solely via
//! the explicit local `sensor_read_raw` command (never pushed anywhere).
//! This mirrors the SPI's structural raw/derived type split: clipboard
//! content is exactly the kind of incidentally-sensitive data (passwords,
//! tokens, PII pasted between apps) the capture contract is designed to keep
//! off the wire by default.

use super::{now_ts_ms, CaptureEmission, Observation};
use objc2::rc::autoreleasepool;
use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

const POLL_INTERVAL: Duration = Duration::from_millis(1000);

pub struct ClipboardProvider {
    stop_flag: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl ClipboardProvider {
    pub fn start(tx: Sender<CaptureEmission>) -> Self {
        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_flag_thread = stop_flag.clone();

        let handle = std::thread::spawn(move || {
            let mut last_change_count: isize = read_change_count();
            while !stop_flag_thread.load(Ordering::Relaxed) {
                let current = read_change_count();
                if current != last_change_count {
                    last_change_count = current;
                    if let Some(emission) = build_emission() {
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

fn read_change_count() -> isize {
    autoreleasepool(|_| NSPasteboard::generalPasteboard().changeCount())
}

/// Reads the current clipboard text (if any) and builds a CaptureEmission:
/// the observation carries only type/length/hash; the raw text goes in
/// `emission.raw` for the ring buffer only.
fn build_emission() -> Option<CaptureEmission> {
    let text = autoreleasepool(|_| unsafe {
        let pasteboard = NSPasteboard::generalPasteboard();
        pasteboard
            .stringForType(NSPasteboardTypeString)
            .map(|s| s.to_string())
    })?;

    if text.is_empty() {
        return None;
    }

    let mut hasher = DefaultHasher::new();
    text.hash(&mut hasher);
    let hash = hasher.finish();

    let mut fields = serde_json::Map::new();
    fields.insert("content_type".to_string(), "text/plain".into());
    fields.insert("length".to_string(), text.chars().count().into());
    fields.insert("hash".to_string(), format!("{hash:016x}").into());

    Some(CaptureEmission {
        observation: Observation {
            kind: "clipboard".to_string(),
            ts: now_ts_ms(),
            fields,
        },
        raw: Some(serde_json::json!({ "text": text })),
    })
}
