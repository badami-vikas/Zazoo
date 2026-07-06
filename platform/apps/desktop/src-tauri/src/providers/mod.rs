//! Shared capture-core plumbing: the CaptureEmission shape, the bounded raw
//! ring buffer, and the pure (non-AppKit) parts that are unit-testable.
//!
//! Platform providers (apps.rs, clipboard.rs) live beside this module and are
//! macOS-only (`#[cfg(target_os = "macos")]`); this file itself has no OS
//! dependency so it compiles + tests on any host.

#[cfg(target_os = "macos")]
pub mod apps;
#[cfg(target_os = "macos")]
pub mod clipboard;

use serde::Serialize;
use std::collections::VecDeque;
use std::time::{SystemTime, UNIX_EPOCH};

/// One derived, safe-to-cross-the-gate observation. Never carries raw
/// capture content — only summary fields (per capture-contract, ADR-014).
#[derive(Serialize, Clone, Debug)]
pub struct Observation {
    pub kind: String,
    pub ts: u64,
    #[serde(flatten)]
    pub fields: serde_json::Map<String, serde_json::Value>,
}

/// Raw capture payload — LOCAL-PLANE ONLY. Kept solely in the bounded ring
/// buffer, retrievable only via the explicit `sensor_read_raw` local command.
/// Never included in anything emitted as an `Observation` or a Tauri event.
#[derive(Serialize, Clone, Debug)]
pub struct RawCapture {
    pub id: u64,
    pub kind: String,
    pub ts: u64,
    pub payload: serde_json::Value,
}

/// What a provider hands the drain loop for one capture: the derived
/// observation (always present) plus the optional raw payload (present only
/// when the provider captured something worth keeping raw, e.g. clipboard
/// text). Mirrors the TS-side CaptureEmission = { raw, observation } shape.
#[derive(Clone, Debug)]
pub struct CaptureEmission {
    pub observation: Observation,
    pub raw: Option<serde_json::Value>,
}

pub fn now_ts_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Bounded in-memory ring buffer for raw captures. Pure logic, no OS deps —
/// this is what the unit tests below exercise directly.
pub struct RawRingBuffer {
    capacity: usize,
    next_id: u64,
    entries: VecDeque<RawCapture>,
}

impl RawRingBuffer {
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity: capacity.max(1),
            next_id: 1,
            entries: VecDeque::with_capacity(capacity),
        }
    }

    /// Push a raw payload, evicting the oldest entry once at capacity.
    /// Returns the id assigned to this entry.
    pub fn push(&mut self, kind: &str, payload: serde_json::Value) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        if self.entries.len() >= self.capacity {
            self.entries.pop_front();
        }
        self.entries.push_back(RawCapture {
            id,
            kind: kind.to_string(),
            ts: now_ts_ms(),
            payload,
        });
        id
    }

    pub fn get(&self, id: u64) -> Option<&RawCapture> {
        self.entries.iter().find(|e| e.id == id)
    }

    /// Exposed for tests and future diagnostics commands (e.g. a
    /// `sensor_stats` command reporting ring-buffer occupancy); not yet
    /// wired to a Tauri command in this P0 slice.
    #[allow(dead_code)]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    #[allow(dead_code)]
    pub fn capacity(&self) -> usize {
        self.capacity
    }
}

/// Bounded FIFO queue of pending observations awaiting drain. Pure logic,
/// mirrors the same drain-not-push design as `RawRingBuffer` but without
/// eviction — callers are expected to drain frequently; if the queue grows
/// unbounded that's a signal the JS side stopped polling, which we'd rather
/// surface as memory growth (visible) than silently drop observations.
#[derive(Default)]
pub struct ObservationQueue {
    entries: VecDeque<Observation>,
}

impl ObservationQueue {
    pub fn new() -> Self {
        Self {
            entries: VecDeque::new(),
        }
    }

    pub fn push(&mut self, observation: Observation) {
        self.entries.push_back(observation);
    }

    /// Drain all pending observations, returning them in FIFO order and
    /// leaving the queue empty.
    pub fn drain(&mut self) -> Vec<Observation> {
        self.entries.drain(..).collect()
    }

    /// Exposed for tests and future diagnostics; not yet wired to a Tauri
    /// command in this P0 slice.
    #[allow(dead_code)]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn ring_buffer_assigns_increasing_ids() {
        let mut buf = RawRingBuffer::new(4);
        let a = buf.push("clipboard", json!({"text": "a"}));
        let b = buf.push("clipboard", json!({"text": "b"}));
        assert_eq!(a, 1);
        assert_eq!(b, 2);
    }

    #[test]
    fn ring_buffer_evicts_oldest_at_capacity() {
        let mut buf = RawRingBuffer::new(2);
        buf.push("clipboard", json!({"text": "a"}));
        buf.push("clipboard", json!({"text": "b"}));
        buf.push("clipboard", json!({"text": "c"}));
        assert_eq!(buf.len(), 2);
        // id 1 ("a") should have been evicted.
        assert!(buf.get(1).is_none());
        assert!(buf.get(2).is_some());
        assert!(buf.get(3).is_some());
    }

    #[test]
    fn ring_buffer_get_returns_none_for_missing_id() {
        let mut buf = RawRingBuffer::new(4);
        buf.push("clipboard", json!({"text": "a"}));
        assert!(buf.get(999).is_none());
    }

    #[test]
    fn ring_buffer_respects_minimum_capacity_of_one() {
        let mut buf = RawRingBuffer::new(0);
        assert_eq!(buf.capacity(), 1);
        buf.push("clipboard", json!({"text": "a"}));
        buf.push("clipboard", json!({"text": "b"}));
        assert_eq!(buf.len(), 1);
    }

    #[test]
    fn observation_queue_drains_in_fifo_order_and_empties() {
        let mut q = ObservationQueue::new();
        q.push(Observation {
            kind: "apps".into(),
            ts: 1,
            fields: Default::default(),
        });
        q.push(Observation {
            kind: "clipboard".into(),
            ts: 2,
            fields: Default::default(),
        });
        assert_eq!(q.len(), 2);
        let drained = q.drain();
        assert_eq!(drained.len(), 2);
        assert_eq!(drained[0].kind, "apps");
        assert_eq!(drained[1].kind, "clipboard");
        assert!(q.is_empty());
    }

    #[test]
    fn observation_queue_drain_is_idempotent_when_empty() {
        let mut q = ObservationQueue::new();
        assert!(q.drain().is_empty());
    }
}
