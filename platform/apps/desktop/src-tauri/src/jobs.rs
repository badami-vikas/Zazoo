//! Start-then-poll job table (TASK-028 / BUGS 2026-07-30 residual).
//!
//! WKWebView stops an in-page IPC scheme task after ~60 seconds; a Tauri
//! command that answers later completes a task WebKit already tore down,
//! which raises an Objective-C exception Rust cannot catch — the process
//! ABORTS. Any command whose worst case can stack provider calls past that
//! deadline therefore must not answer inline. The structural fix is this
//! table: a `_start` command validates, spawns the blocking work, and
//! returns a job id immediately; a `_poll` command answers instantly with
//! pending/ready. No command ever holds an IPC reply open while a provider
//! call runs.
//!
//! Take-once semantics: a finished job is REMOVED by the poll that observes
//! it, so completion side effects (annotation marks, speech) run exactly
//! once, and the table never accumulates delivered results. Stale entries —
//! a webview that navigated away and never polled again — are purged on the
//! next `start`.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Entries older than this are abandoned work nobody will ever poll.
const JOB_MAX_AGE: Duration = Duration::from_secs(10 * 60);
/// Hard cap on live entries — a webview reload loop must not grow the table.
const JOB_MAX_ENTRIES: usize = 32;

struct JobEntry<T> {
    created: Instant,
    value: Option<T>,
}

/// What a poll observed.
pub enum JobPollState<T> {
    /// No such job — never started, already delivered, or purged as stale.
    Unknown,
    /// Still running.
    Pending,
    /// Finished; the value is handed over exactly once.
    Ready(T),
}

pub struct JobTable<T> {
    next: AtomicU64,
    jobs: Mutex<HashMap<u64, JobEntry<T>>>,
}

impl<T> Default for JobTable<T> {
    fn default() -> Self {
        Self {
            next: AtomicU64::new(1),
            jobs: Mutex::new(HashMap::new()),
        }
    }
}

impl<T> JobTable<T> {
    /// Allocate a job id. Purges stale entries first and refuses to grow past
    /// the cap — failing loud beats leaking abandoned work.
    pub fn start(&self) -> Result<u64, String> {
        let id = self.next.fetch_add(1, Ordering::SeqCst);
        let mut jobs = self.jobs.lock().map_err(|_| "job table poisoned")?;
        jobs.retain(|_, entry| entry.created.elapsed() < JOB_MAX_AGE);
        if jobs.len() >= JOB_MAX_ENTRIES {
            return Err(format!(
                "too many jobs in flight ({JOB_MAX_ENTRIES}); poll or abandon existing ones first"
            ));
        }
        jobs.insert(
            id,
            JobEntry {
                created: Instant::now(),
                value: None,
            },
        );
        Ok(id)
    }

    /// Record a job's result. A stale-purged or never-started id is dropped
    /// silently — the worker finished after everyone stopped caring.
    pub fn finish(&self, id: u64, value: T) {
        if let Ok(mut jobs) = self.jobs.lock() {
            if let Some(entry) = jobs.get_mut(&id) {
                entry.value = Some(value);
            }
        }
    }

    /// Observe a job. Ready values are removed as they are handed over.
    pub fn take(&self, id: u64) -> JobPollState<T> {
        let Ok(mut jobs) = self.jobs.lock() else {
            return JobPollState::Unknown;
        };
        match jobs.get(&id) {
            None => JobPollState::Unknown,
            Some(entry) if entry.value.is_none() => JobPollState::Pending,
            Some(_) => match jobs.remove(&id).and_then(|entry| entry.value) {
                Some(value) => JobPollState::Ready(value),
                None => JobPollState::Unknown,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lifecycle_pending_then_ready_exactly_once() {
        let table: JobTable<i32> = JobTable::default();
        let id = table.start().expect("start");
        assert!(matches!(table.take(id), JobPollState::Pending));
        table.finish(id, 42);
        match table.take(id) {
            JobPollState::Ready(value) => assert_eq!(value, 42),
            _ => panic!("expected ready"),
        }
        // Delivered exactly once; a second poll finds nothing.
        assert!(matches!(table.take(id), JobPollState::Unknown));
    }

    #[test]
    fn unknown_ids_are_unknown() {
        let table: JobTable<i32> = JobTable::default();
        assert!(matches!(table.take(999), JobPollState::Unknown));
        table.finish(999, 1); // dropped silently
        assert!(matches!(table.take(999), JobPollState::Unknown));
    }

    #[test]
    fn table_growth_is_capped() {
        let table: JobTable<i32> = JobTable::default();
        for _ in 0..JOB_MAX_ENTRIES {
            table.start().expect("under cap");
        }
        assert!(table.start().is_err(), "cap must refuse the 33rd live job");
    }

    #[test]
    fn ids_are_never_reused() {
        let table: JobTable<i32> = JobTable::default();
        let first = table.start().expect("start");
        table.finish(first, 1);
        let JobPollState::Ready(_) = table.take(first) else {
            panic!("expected ready");
        };
        let second = table.start().expect("start");
        assert_ne!(first, second);
    }
}
