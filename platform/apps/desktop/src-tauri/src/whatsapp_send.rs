//! whatsapp_send — the BINDING rate ceiling for outbound WhatsApp automation.
//!
//! ADR-158: "`decideSend` decides policy in TypeScript, and the rate ceiling is
//! enforced in **Rust**, because a renderer-side cap is bypassable and a cap
//! that does not bind is not protection."
//!
//! Track C shipped the policy as pure TypeScript (`@bridge/whatsapp`'s
//! `policy.ts`). That copy is ADVISORY: it exists so the UI can explain, defer,
//! and schedule honestly. This module is the copy that actually binds. It runs
//! on the trusted side of the IPC boundary, after the renderer has had its say,
//! and it refuses independently of anything the renderer claims.
//!
//! Three rules are enforced here, and only these three. They are the ones whose
//! failure mode is a permanent, unappealable ban on the owner's personal number:
//!
//!  1. a hard daily cap per account, warmed up from a freshly linked device,
//!  2. a per-recipient cooldown,
//!  3. the kill switch — once halted, everything is refused until a NAMED HUMAN
//!     re-arms it. There is no timeout, no decay, and no auto-resume anywhere in
//!     this file.
//!
//! The near-identical-body rule, the consent gate and recipient-local hours stay
//! in TypeScript. They need message bodies and thread history, which this layer
//! deliberately does not hold — see the ledger note below.
//!
//! **The state is DURABLE.** A daily cap held in memory does not bind: relaunching
//! the app would be the bypass, and a bypass that takes one restart is not a cap.
//! Counters, cooldowns and the halt flag live in a JSON file under `app_data_dir`,
//! written atomically (temp → rename), following `overlay.rs`'s persisted-position
//! precedent rather than inventing a new mechanism.
//!
//! **The ledger holds no message content and no phone numbers.** A send is
//! recorded as `(sha256(recipient key), timestamp)`. The cooldown needs to know
//! that two sends went to the SAME recipient, which a digest answers exactly;
//! it never needs to know who. Enabling write should not also create a
//! plaintext outbound-contact log on disk.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

const MS_PER_DAY: i64 = 86_400_000;

// ---------------------------------------------------------------------------
// Limits — the Rust half of a two-implementation contract
// ---------------------------------------------------------------------------

/// The subset of `SEND_POLICY_LIMITS` this layer enforces.
///
/// Every field here MUST equal its counterpart in
/// `platform/modules/whatsapp/src/policy.ts`. `limits_match_the_typescript_copy`
/// reads that file and asserts it, so the two cannot silently drift into
/// disagreeing about what the ceiling is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendLimits {
    /// Hard ceiling on automated sends per ROLLING 24 hours. Rolling rather than
    /// per calendar day: a midnight reset invites a burst, which is a worse
    /// behavioural signature than the steady rate the cap exists to produce.
    pub daily_cap: u32,
    /// At most one automated message to the same recipient per this many days.
    pub recipient_cooldown_days: i64,
    /// Sends allowed on the first day after linking, and the daily increment.
    /// A device that starts at the steady-state rate the hour it links is one of
    /// the clearest automation signatures there is.
    pub warm_up_first_day_cap: u32,
    pub warm_up_daily_increment: u32,
}

pub const SEND_LIMITS: SendLimits = SendLimits {
    daily_cap: 30,
    recipient_cooldown_days: 7,
    warm_up_first_day_cap: 5,
    warm_up_daily_increment: 5,
};

/// The cap in force right now, given when the account was linked.
///
/// Mirrors `effectiveDailyCap` in `policy.ts`, including its edge cases: a link
/// date in the FUTURE yields zero rather than an unbounded allowance, and the
/// ramp is clamped to `daily_cap`.
pub fn effective_daily_cap(now_ms: i64, linked_at_ms: i64, limits: &SendLimits) -> u32 {
    let days = (now_ms - linked_at_ms).div_euclid(MS_PER_DAY);
    if days < 0 {
        return 0;
    }
    let ramped = i64::from(limits.warm_up_first_day_cap)
        .saturating_add(days.saturating_mul(i64::from(limits.warm_up_daily_increment)));
    ramped.clamp(0, i64::from(limits.daily_cap)) as u32
}

// ---------------------------------------------------------------------------
// The durable ledger
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum KillStatus {
    #[default]
    Armed,
    Halted,
}

/// The halt flag. Sticky by construction — there is no expiry field, because
/// there is no expiry.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct KillSwitch {
    #[serde(default)]
    pub status: KillStatus,
    #[serde(default)]
    pub halted_at_ms: Option<i64>,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub rearmed_at_ms: Option<i64>,
    /// The human who re-armed. Never an Agent id.
    #[serde(default)]
    pub rearmed_by: Option<String>,
}

/// One automated send. `recipient` is a digest, never an identifier — see the
/// module header.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SendRecord {
    pub recipient: String,
    pub at_ms: i64,
}

pub const LEDGER_VERSION: u32 = 1;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SendLedger {
    #[serde(default)]
    pub version: u32,
    /// When this account was first seen by the ceiling, driving the warm-up ramp.
    pub linked_at_ms: i64,
    #[serde(default)]
    pub kill_switch: KillSwitch,
    #[serde(default)]
    pub sends: Vec<SendRecord>,
}

impl SendLedger {
    /// A brand-new ledger. Warm-up starts NOW, so a fresh install is treated as
    /// a freshly linked device and gets the first-day allowance, not the full cap.
    pub fn fresh(now_ms: i64) -> Self {
        Self {
            version: LEDGER_VERSION,
            linked_at_ms: now_ms,
            kill_switch: KillSwitch::default(),
            sends: Vec::new(),
        }
    }

    /// A ledger that refuses everything, used when the stored one is unreadable.
    ///
    /// Fail CLOSED, deliberately. Treating a corrupt ledger as an empty one
    /// would make "damage the file" a way to zero the day's counter, which is
    /// the same class of bypass as restarting the process. A halt needs a human
    /// to clear, which is exactly the right amount of friction for "the thing
    /// that counts your sends is broken".
    pub fn unreadable(now_ms: i64, detail: String) -> Self {
        Self {
            version: LEDGER_VERSION,
            linked_at_ms: now_ms,
            kill_switch: KillSwitch {
                status: KillStatus::Halted,
                halted_at_ms: Some(now_ms),
                reason: Some(format!(
                    "The send ledger could not be read ({detail}), so the daily count is unknown."
                )),
                rearmed_at_ms: None,
                rearmed_by: None,
            },
            sends: Vec::new(),
        }
    }

    /// Sends inside the rolling 24-hour window.
    ///
    /// Note the deliberately open UPPER bound: a record stamped in the future
    /// still counts. Otherwise moving the system clock backwards would push the
    /// day's sends out of the window and free the slots again.
    fn sends_in_window(&self, now_ms: i64) -> Vec<i64> {
        let start = now_ms - MS_PER_DAY;
        let mut times: Vec<i64> = self
            .sends
            .iter()
            .filter(|record| record.at_ms > start)
            .map(|record| record.at_ms)
            .collect();
        times.sort_unstable();
        times
    }

    fn last_send_to(&self, recipient: &str) -> Option<i64> {
        self.sends
            .iter()
            .filter(|record| record.recipient == recipient)
            .map(|record| record.at_ms)
            .max()
    }

    /// Append a send and drop records no rule can still refer to.
    pub fn record(&mut self, recipient: String, at_ms: i64, limits: &SendLimits) {
        self.sends.push(SendRecord {
            recipient,
            at_ms,
        });
        self.prune(at_ms, limits);
    }

    /// Keep only what the cap and cooldown windows can still see. Retention is
    /// a consequence of the rules, not a policy of its own.
    pub fn prune(&mut self, now_ms: i64, limits: &SendLimits) {
        let horizon = MS_PER_DAY.max(limits.recipient_cooldown_days * MS_PER_DAY);
        let cutoff = now_ms - horizon;
        self.sends.retain(|record| record.at_ms > cutoff);
    }
}

// ---------------------------------------------------------------------------
// The ceiling
// ---------------------------------------------------------------------------

/// A refusal the UI can actually render: a stable code, a sentence, and — when
/// waiting would fix it — when to try again.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CeilingRefusal {
    pub code: &'static str,
    pub message: String,
    pub earliest_at_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CeilingVerdict {
    Allowed,
    Refused(CeilingRefusal),
}

pub const HALTED_CODE: &str = "WHATSAPP_SEND_HALTED";
pub const COOLDOWN_CODE: &str = "WHATSAPP_SEND_COOLDOWN";
pub const DAILY_CAP_CODE: &str = "WHATSAPP_SEND_DAILY_CAP";

/// Decide whether one send may proceed. Pure: no clock, no I/O.
///
/// Order is kill switch → cooldown → daily cap. The kill switch is first because
/// while it is set nothing else is even a question.
pub fn check_ceiling(
    ledger: &SendLedger,
    recipient: &str,
    now_ms: i64,
    limits: &SendLimits,
) -> CeilingVerdict {
    if ledger.kill_switch.status == KillStatus::Halted {
        let reason = ledger
            .kill_switch
            .reason
            .clone()
            .unwrap_or_else(|| "an unexplained anomaly".to_string());
        return CeilingVerdict::Refused(CeilingRefusal {
            code: HALTED_CODE,
            message: format!(
                "Automated sending is halted ({reason}) and needs a person to re-arm it."
            ),
            // Deliberately None. There is no time at which this clears itself.
            earliest_at_ms: None,
        });
    }

    let cooldown_ms = limits.recipient_cooldown_days * MS_PER_DAY;
    if let Some(last) = ledger.last_send_to(recipient) {
        if now_ms - last < cooldown_ms {
            return CeilingVerdict::Refused(CeilingRefusal {
                code: COOLDOWN_CODE,
                message: format!(
                    "This recipient already had an automated message in the last {} days.",
                    limits.recipient_cooldown_days
                ),
                earliest_at_ms: Some(last + cooldown_ms),
            });
        }
    }

    let cap = effective_daily_cap(now_ms, ledger.linked_at_ms, limits);
    let window = ledger.sends_in_window(now_ms);
    if window.len() as u32 >= cap {
        // A slot frees when the oldest send still inside the window ages out.
        let earliest = if cap == 0 {
            now_ms + MS_PER_DAY
        } else {
            let index = window.len().saturating_sub(cap as usize);
            window
                .get(index)
                .or_else(|| window.first())
                .map(|at| at + MS_PER_DAY)
                .unwrap_or(now_ms + MS_PER_DAY)
        };
        return CeilingVerdict::Refused(CeilingRefusal {
            code: DAILY_CAP_CODE,
            message: format!(
                "{} automated messages were sent in the last 24 hours; the cap is {cap}.",
                window.len()
            ),
            earliest_at_ms: Some(earliest),
        });
    }

    CeilingVerdict::Allowed
}

/// Halt. Idempotent, and it KEEPS the original reason and time: the first
/// anomaly is the one worth reading, and later ones must not overwrite it.
pub fn halt(ledger: &mut SendLedger, reason: &str, at_ms: i64) {
    if ledger.kill_switch.status == KillStatus::Halted {
        return;
    }
    ledger.kill_switch = KillSwitch {
        status: KillStatus::Halted,
        halted_at_ms: Some(at_ms),
        reason: Some(reason.trim().to_string()),
        rearmed_at_ms: None,
        rearmed_by: None,
    };
}

/// The ONLY transition back to `armed`, and it takes a named human.
///
/// Automation that resumes on its own after a WhatsApp warning is automation
/// that walks straight back into the behaviour that produced the warning.
pub fn rearm(ledger: &mut SendLedger, rearmed_by: &str, at_ms: i64) -> Result<(), String> {
    let human = rearmed_by.trim();
    if human.is_empty() {
        return Err("Re-arming automated sending requires the human who authorised it".to_string());
    }
    ledger.kill_switch = KillSwitch {
        status: KillStatus::Armed,
        halted_at_ms: None,
        reason: None,
        rearmed_at_ms: Some(at_ms),
        rearmed_by: Some(human.to_string()),
    };
    Ok(())
}

// ---------------------------------------------------------------------------
// Identity digest
// ---------------------------------------------------------------------------

/// Stable digest of a recipient key. The cooldown needs sameness, not identity.
pub fn recipient_digest(recipient_key: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(recipient_key.trim().as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

// ---------------------------------------------------------------------------
// Durable storage
// ---------------------------------------------------------------------------

/// `{app_data_dir}/bridge/whatsapp-send-ledger.json`.
const LEDGER_FILE: &str = "whatsapp-send-ledger.json";

pub fn ledger_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    Some(dir.join("bridge").join(LEDGER_FILE))
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}

/// Read the ledger from a path. Missing → fresh. Present but unreadable →
/// HALTED, never empty (see `SendLedger::unreadable`).
pub fn load_from(path: &std::path::Path, now: i64) -> SendLedger {
    match std::fs::read(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => SendLedger::fresh(now),
        Err(error) => SendLedger::unreadable(now, error.to_string()),
        Ok(bytes) => match serde_json::from_slice::<SendLedger>(&bytes) {
            Ok(ledger) => ledger,
            Err(error) => SendLedger::unreadable(now, error.to_string()),
        },
    }
}

/// Write atomically: temp file, then rename. A half-written ledger would be an
/// unreadable one, which halts sending — correct, but avoidable.
pub fn save_to(path: &std::path::Path, ledger: &SendLedger) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let json = serde_json::to_vec_pretty(ledger).map_err(|error| error.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &json).map_err(|error| error.to_string())?;
    std::fs::rename(&tmp, path).map_err(|error| error.to_string())
}

/// Serialises ledger read-modify-write across concurrent sends. The file is the
/// durable authority; this only stops two in-flight sends racing the same slot.
#[derive(Default)]
pub struct SendCeilingState {
    pub gate: Mutex<()>,
}

/// What the UI needs to explain the ceiling without guessing at it.
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SendCeilingStatus {
    pub limits: SendLimits,
    pub kill_switch: KillSwitch,
    pub sent_last_24h: u32,
    pub effective_daily_cap: u32,
    pub linked_at_ms: i64,
}

pub fn status_of(ledger: &SendLedger, now: i64, limits: &SendLimits) -> SendCeilingStatus {
    SendCeilingStatus {
        limits: *limits,
        kill_switch: ledger.kill_switch.clone(),
        sent_last_24h: ledger.sends_in_window(now).len() as u32,
        effective_daily_cap: effective_daily_cap(now, ledger.linked_at_ms, limits),
        linked_at_ms: ledger.linked_at_ms,
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_785_000_000_000; // an arbitrary fixed instant
    const LONG_AGO: i64 = NOW - 400 * MS_PER_DAY; // warmed up past the ramp

    fn warm_ledger() -> SendLedger {
        SendLedger {
            version: LEDGER_VERSION,
            linked_at_ms: LONG_AGO,
            kill_switch: KillSwitch::default(),
            sends: Vec::new(),
        }
    }

    fn fill(ledger: &mut SendLedger, count: u32, now: i64) {
        for n in 0..count {
            ledger.sends.push(SendRecord {
                // Distinct recipients, so only the daily cap is in play.
                recipient: recipient_digest(&format!("recipient-{n}")),
                at_ms: now - i64::from(n) * 60_000,
            });
        }
    }

    // -- the limits contract --------------------------------------------------

    /// Rust is the binding authority and TypeScript is the advisory copy. Two
    /// implementations of one ceiling are only safe if they cannot drift, so
    /// this reads the actual `policy.ts` and compares the numbers.
    #[test]
    fn limits_match_the_typescript_copy() {
        const POLICY_TS: &str =
            include_str!("../../../../commons/whatsapp/src/policy.ts");

        // Read the shipped `SEND_POLICY_LIMITS` object literal, not the whole
        // file: `SendPolicyLimits`'s doc comments mention numbers too.
        let start = POLICY_TS
            .find("export const SEND_POLICY_LIMITS")
            .expect("policy.ts must export SEND_POLICY_LIMITS");
        let body = &POLICY_TS[start..];
        let end = body.find("};").expect("the limits literal must close") + 2;
        let body = &body[..end];

        fn field(body: &str, name: &str) -> i64 {
            let at = body
                .find(&format!("{name}:"))
                .unwrap_or_else(|| panic!("policy.ts no longer declares {name}"));
            let rest = &body[at + name.len() + 1..];
            let value: String = rest
                .chars()
                .skip_while(|c| c.is_whitespace())
                .take_while(|c| c.is_ascii_digit())
                .collect();
            value
                .parse()
                .unwrap_or_else(|_| panic!("{name} in policy.ts is not an integer"))
        }

        assert_eq!(
            field(body, "dailyCap"),
            i64::from(SEND_LIMITS.daily_cap),
            "the Rust daily cap and the TypeScript one have drifted"
        );
        assert_eq!(
            field(body, "recipientCooldownDays"),
            SEND_LIMITS.recipient_cooldown_days
        );
        assert_eq!(
            field(body, "warmUpFirstDayCap"),
            i64::from(SEND_LIMITS.warm_up_first_day_cap)
        );
        assert_eq!(
            field(body, "warmUpDailyIncrement"),
            i64::from(SEND_LIMITS.warm_up_daily_increment)
        );
    }

    #[test]
    fn the_warm_up_ramp_matches_the_typescript_shape() {
        // Day 0 gets the first-day allowance, not the full cap.
        assert_eq!(effective_daily_cap(NOW, NOW, &SEND_LIMITS), 5);
        assert_eq!(effective_daily_cap(NOW, NOW - MS_PER_DAY, &SEND_LIMITS), 10);
        assert_eq!(
            effective_daily_cap(NOW, NOW - 5 * MS_PER_DAY, &SEND_LIMITS),
            30
        );
        // Clamped at the hard cap, forever.
        assert_eq!(effective_daily_cap(NOW, LONG_AGO, &SEND_LIMITS), 30);
        // A link date in the FUTURE is not a warm account.
        assert_eq!(effective_daily_cap(NOW, NOW + MS_PER_DAY, &SEND_LIMITS), 0);
    }

    // -- the cap --------------------------------------------------------------

    #[test]
    fn the_daily_cap_binds_exactly_at_its_boundary() {
        let mut ledger = warm_ledger();
        fill(&mut ledger, SEND_LIMITS.daily_cap - 1, NOW);
        assert_eq!(
            check_ceiling(&ledger, &recipient_digest("fresh"), NOW, &SEND_LIMITS),
            CeilingVerdict::Allowed,
            "the 30th send of the day must be allowed"
        );

        fill(&mut ledger, 1, NOW - 30_000);
        match check_ceiling(&ledger, &recipient_digest("fresh"), NOW, &SEND_LIMITS) {
            CeilingVerdict::Refused(refusal) => {
                assert_eq!(refusal.code, DAILY_CAP_CODE);
                assert!(refusal.earliest_at_ms.is_some(), "the UI needs a retry time");
            }
            CeilingVerdict::Allowed => panic!("the 31st send must be refused"),
        }
    }

    #[test]
    fn sends_older_than_the_rolling_window_free_a_slot() {
        let mut ledger = warm_ledger();
        for n in 0..SEND_LIMITS.daily_cap {
            ledger.sends.push(SendRecord {
                recipient: recipient_digest(&format!("r{n}")),
                at_ms: NOW - MS_PER_DAY - 1, // just outside the window
            });
        }
        assert_eq!(
            check_ceiling(&ledger, &recipient_digest("fresh"), NOW, &SEND_LIMITS),
            CeilingVerdict::Allowed
        );
    }

    #[test]
    fn winding_the_clock_back_does_not_free_slots() {
        // A record stamped in the future still counts. Without the open upper
        // bound on the window, moving the system clock backwards would push the
        // day's sends outside it and hand the slots back.
        let mut ledger = warm_ledger();
        for n in 0..SEND_LIMITS.daily_cap {
            ledger.sends.push(SendRecord {
                recipient: recipient_digest(&format!("r{n}")),
                at_ms: NOW + i64::from(n) * 1_000, // "later" than now
            });
        }
        match check_ceiling(&ledger, &recipient_digest("fresh"), NOW, &SEND_LIMITS) {
            CeilingVerdict::Refused(refusal) => assert_eq!(refusal.code, DAILY_CAP_CODE),
            CeilingVerdict::Allowed => panic!("future-dated sends must still count"),
        }
    }

    // -- the cooldown ---------------------------------------------------------

    #[test]
    fn the_per_recipient_cooldown_binds_and_then_releases() {
        let recipient = recipient_digest("whatsapp:+919876543210");
        let mut ledger = warm_ledger();
        ledger.record(recipient.clone(), NOW - 6 * MS_PER_DAY, &SEND_LIMITS);

        match check_ceiling(&ledger, &recipient, NOW, &SEND_LIMITS) {
            CeilingVerdict::Refused(refusal) => {
                assert_eq!(refusal.code, COOLDOWN_CODE);
                assert_eq!(
                    refusal.earliest_at_ms,
                    Some(NOW - 6 * MS_PER_DAY + 7 * MS_PER_DAY)
                );
            }
            CeilingVerdict::Allowed => panic!("a 6-day-old send is inside a 7-day cooldown"),
        }

        // Someone else is unaffected.
        assert_eq!(
            check_ceiling(&ledger, &recipient_digest("someone-else"), NOW, &SEND_LIMITS),
            CeilingVerdict::Allowed
        );
        // And the same recipient becomes sendable once the window passes.
        assert_eq!(
            check_ceiling(&ledger, &recipient, NOW + 2 * MS_PER_DAY, &SEND_LIMITS),
            CeilingVerdict::Allowed
        );
    }

    // -- the kill switch ------------------------------------------------------

    #[test]
    fn a_halt_refuses_everything_and_never_lifts_itself() {
        let mut ledger = warm_ledger();
        halt(&mut ledger, "WhatsApp warned the account", NOW);

        for elapsed in [0, MS_PER_DAY, 365 * MS_PER_DAY] {
            match check_ceiling(&ledger, &recipient_digest("anyone"), NOW + elapsed, &SEND_LIMITS)
            {
                CeilingVerdict::Refused(refusal) => {
                    assert_eq!(refusal.code, HALTED_CODE);
                    // No retry time: there is no instant at which this clears.
                    assert_eq!(refusal.earliest_at_ms, None);
                }
                CeilingVerdict::Allowed => panic!("a halt must never time out"),
            }
        }

        // A second anomaly keeps the FIRST reason — that is the one worth reading.
        halt(&mut ledger, "something else", NOW + 60_000);
        assert_eq!(ledger.kill_switch.halted_at_ms, Some(NOW));
        assert_eq!(
            ledger.kill_switch.reason.as_deref(),
            Some("WhatsApp warned the account")
        );

        // Only a NAMED human clears it.
        assert!(rearm(&mut ledger, "   ", NOW).is_err());
        assert_eq!(ledger.kill_switch.status, KillStatus::Halted);
        rearm(&mut ledger, "Vikas", NOW).expect("a named human may re-arm");
        assert_eq!(ledger.kill_switch.status, KillStatus::Armed);
        assert_eq!(ledger.kill_switch.rearmed_by.as_deref(), Some("Vikas"));
        assert_eq!(
            check_ceiling(&ledger, &recipient_digest("anyone"), NOW, &SEND_LIMITS),
            CeilingVerdict::Allowed
        );
    }

    // -- durability -----------------------------------------------------------

    /// THE test this whole module exists for.
    ///
    /// A cap that lives in process memory does not bind, because relaunching the
    /// app would be the bypass. This spends the day's allowance, throws away
    /// every in-memory structure, re-reads the ledger from disk exactly as a
    /// fresh process would, and asserts the next send is still refused.
    #[test]
    fn the_cap_still_binds_after_a_restart() {
        let dir = std::env::temp_dir().join(format!(
            "bridge-wa-ledger-{}-{}",
            std::process::id(),
            NOW
        ));
        let path = dir.join("whatsapp-send-ledger.json");
        let _ = std::fs::remove_dir_all(&dir);

        // ── process 1 ────────────────────────────────────────────────────────
        {
            let mut ledger = load_from(&path, NOW);
            // A brand-new ledger starts the warm-up now, so lengthen the link
            // date to exercise the steady-state cap rather than day one.
            ledger.linked_at_ms = LONG_AGO;
            for n in 0..SEND_LIMITS.daily_cap {
                let recipient = recipient_digest(&format!("recipient-{n}"));
                assert_eq!(
                    check_ceiling(&ledger, &recipient, NOW, &SEND_LIMITS),
                    CeilingVerdict::Allowed,
                    "send {n} should be inside the cap"
                );
                ledger.record(recipient, NOW, &SEND_LIMITS);
            }
            save_to(&path, &ledger).expect("the ledger must be writable");
        }

        // ── process 2: nothing survives but the file ─────────────────────────
        {
            let reloaded = load_from(&path, NOW);
            assert_eq!(
                reloaded.sends.len() as u32,
                SEND_LIMITS.daily_cap,
                "the restart must not lose the day's counter"
            );
            match check_ceiling(&reloaded, &recipient_digest("someone-new"), NOW, &SEND_LIMITS) {
                CeilingVerdict::Refused(refusal) => assert_eq!(refusal.code, DAILY_CAP_CODE),
                CeilingVerdict::Allowed => {
                    panic!("restarting the app must not hand back the day's allowance")
                }
            }
        }

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_halt_survives_a_restart_too() {
        let dir = std::env::temp_dir().join(format!(
            "bridge-wa-halt-{}-{}",
            std::process::id(),
            NOW
        ));
        let path = dir.join("whatsapp-send-ledger.json");
        let _ = std::fs::remove_dir_all(&dir);

        let mut ledger = SendLedger::fresh(NOW);
        halt(&mut ledger, "delivery anomaly", NOW);
        save_to(&path, &ledger).expect("writable");

        let reloaded = load_from(&path, NOW + 30 * MS_PER_DAY);
        assert_eq!(reloaded.kill_switch.status, KillStatus::Halted);
        assert_eq!(reloaded.kill_switch.reason.as_deref(), Some("delivery anomaly"));
        match check_ceiling(
            &reloaded,
            &recipient_digest("anyone"),
            NOW + 30 * MS_PER_DAY,
            &SEND_LIMITS,
        ) {
            CeilingVerdict::Refused(refusal) => assert_eq!(refusal.code, HALTED_CODE),
            CeilingVerdict::Allowed => panic!("a halt must outlive the process"),
        }

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_unreadable_ledger_halts_rather_than_resetting_the_count() {
        let dir = std::env::temp_dir().join(format!(
            "bridge-wa-corrupt-{}-{}",
            std::process::id(),
            NOW
        ));
        let path = dir.join("whatsapp-send-ledger.json");
        std::fs::create_dir_all(&dir).expect("temp dir");
        std::fs::write(&path, b"{ this is not json").expect("writable");

        let ledger = load_from(&path, NOW);
        assert_eq!(
            ledger.kill_switch.status,
            KillStatus::Halted,
            "damaging the ledger must not be a way to zero the day's counter"
        );
        match check_ceiling(&ledger, &recipient_digest("anyone"), NOW, &SEND_LIMITS) {
            CeilingVerdict::Refused(refusal) => assert_eq!(refusal.code, HALTED_CODE),
            CeilingVerdict::Allowed => panic!("a corrupt ledger must fail closed"),
        }

        // A missing file, by contrast, is a first run: armed, but on day one of
        // the warm-up rather than at the full cap.
        let missing = dir.join("absent.json");
        let fresh = load_from(&missing, NOW);
        assert_eq!(fresh.kill_switch.status, KillStatus::Armed);
        assert_eq!(
            effective_daily_cap(NOW, fresh.linked_at_ms, &SEND_LIMITS),
            SEND_LIMITS.warm_up_first_day_cap
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_ledger_holds_no_recipient_identifiers_or_message_content() {
        let mut ledger = SendLedger::fresh(NOW);
        ledger.record(
            recipient_digest("whatsapp:+919876543210"),
            NOW,
            &SEND_LIMITS,
        );
        let json = serde_json::to_string(&ledger).expect("serialises");
        assert!(!json.contains("919876543210"), "a phone number reached the ledger");
        assert!(!json.contains("whatsapp:+"), "a recipient key reached the ledger");
        // The digest is stable, so the cooldown still knows sameness.
        assert_eq!(
            recipient_digest("whatsapp:+919876543210"),
            recipient_digest(" whatsapp:+919876543210 ")
        );
        assert_ne!(
            recipient_digest("whatsapp:+919876543210"),
            recipient_digest("whatsapp:+919876543211")
        );
    }

    #[test]
    fn pruning_keeps_everything_the_cooldown_can_still_see() {
        let mut ledger = warm_ledger();
        let recipient = recipient_digest("r");
        ledger.record(recipient.clone(), NOW - 6 * MS_PER_DAY, &SEND_LIMITS);
        // Six days old: outside the 24h cap window, INSIDE the 7-day cooldown.
        // Pruning to the cap window alone would silently forgive the cooldown.
        assert_eq!(ledger.sends.len(), 1);
        match check_ceiling(&ledger, &recipient, NOW, &SEND_LIMITS) {
            CeilingVerdict::Refused(refusal) => assert_eq!(refusal.code, COOLDOWN_CODE),
            CeilingVerdict::Allowed => panic!("pruning dropped a live cooldown"),
        }
        // Past every window, it goes.
        ledger.prune(NOW + 8 * MS_PER_DAY, &SEND_LIMITS);
        assert!(ledger.sends.is_empty());
    }
}
