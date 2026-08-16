//! "input" provider — K11a (TASK-054, AP-157, ADR-239/240/241/242): the
//! keystroke producer behind the fail-closed input-capture boundary.
//!
//! The boundary itself lives in `@bridge/core`'s `input-capture.ts` and is
//! shared by the shell's JS side and the API. This module is deliberately the
//! DUMBEST part of the lane: it aggregates keystrokes into bursts and hands
//! them to the drain loop, which distils them through that one core module
//! before anything is sent. Rust cannot call the TypeScript boundary, so it
//! must not try to make boundary decisions of its own — with exactly one
//! exception, below, which only ever withholds MORE.
//!
//! THE ONE DECISION MADE HERE, AND WHY IT IS SAFE TO MAKE TWICE. A field that
//! is not positively identified as ordinary text never has its characters
//! accumulated at all — not buffered, not held, not passed on. The core gate
//! would suppress them a moment later anyway, so this is redundant; it is
//! worth having because redundancy in the *safe* direction costs nothing,
//! while the alternative means a password sits in this process's heap for the
//! length of a burst waiting to be thrown away. Structural absence beats
//! prompt deletion. (Same instinct as ADR-239's "the distilled event has no
//! field for raw" — the strongest guarantee is the one the types make
//! unsayable.)
//!
//! Consequently `key_count` is 0 for a suppressed burst. Not "withheld
//! later", not "bucketed" — zero, from the moment the key is seen. ADR-239's
//! lesson was that the COUNT of characters in a secure field is itself
//! sensitive (it is a password length); the cheapest way to honour that is to
//! never count.

use serde::Serialize;

/// Mirrors `FieldRole` in `packages/core/src/learning/input-capture.ts`. The
/// string values are the wire contract — `learning.capture.input.burst`
/// validates them with a zod enum, so a rename on either side fails loudly at
/// the boundary rather than silently downgrading a role.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FieldRole {
    ContentOk,
    Secure,
    Undeterminable,
}

impl FieldRole {
    pub fn as_wire(self) -> &'static str {
        match self {
            FieldRole::ContentOk => "content_ok",
            FieldRole::Secure => "secure",
            FieldRole::Undeterminable => "undeterminable",
        }
    }

    /// Only an explicitly recognised ordinary-text role may carry characters.
    fn allows_content(self) -> bool {
        matches!(self, FieldRole::ContentOk)
    }
}

/// AX roles that are ordinary editable text. This is an OPT-IN allowlist for
/// the same structural reason `CONTENT_ALLOWED_ROLES` is one in core: a role
/// macOS adds later, or one we simply have not seen, must fall through to
/// `Undeterminable` rather than be treated as safe. Unknown is sensitive.
const CONTENT_AX_ROLES: &[&str] = &["AXTextField", "AXTextArea"];

/// AX roles/subroles that are definitively a password box. Checked BEFORE the
/// allowlist: macOS reports a secure field as role `AXTextField` with subrole
/// `AXSecureTextField`, so testing the role first would classify a password
/// field as ordinary text. Order is load-bearing here — this is exactly the
/// bug the ordering exists to prevent.
const SECURE_AX_ROLES: &[&str] = &["AXSecureTextField"];

/// Map a focused element's AX role/subrole to a field role, failing closed.
///
/// Absent AX data (no Accessibility grant, no focused element, a non-AX app)
/// yields `Undeterminable`, which suppresses characters — the honest answer
/// when we cannot tell what the user is typing into.
pub fn field_role_from_ax(role: Option<&str>, subrole: Option<&str>) -> FieldRole {
    // Secure wins over everything, from EITHER slot.
    for value in [role, subrole].into_iter().flatten() {
        if SECURE_AX_ROLES.iter().any(|candidate| candidate.eq_ignore_ascii_case(value)) {
            return FieldRole::Secure;
        }
    }
    match role {
        Some(value)
            if CONTENT_AX_ROLES
                .iter()
                .any(|candidate| candidate.eq_ignore_ascii_case(value)) =>
        {
            FieldRole::ContentOk
        }
        _ => FieldRole::Undeterminable,
    }
}

/// The focus context a burst belongs to. A change in ANY field ends the
/// current burst: characters typed into one field must never be attributed
/// to, or concatenated with, another.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FocusContext {
    pub app_name: String,
    pub app_bundle_id: String,
    pub host: Option<String>,
    pub field_role: FieldRole,
}

/// One aggregated typing burst, ready for the shell to distil through
/// `@bridge/core` and post to `learning.capture.input.burst`.
#[derive(Debug, Clone, Serialize)]
pub struct InputBurst {
    pub app_name: String,
    pub app_bundle_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    pub field_role: &'static str,
    /// EMPTY unless the field role positively allows content.
    pub text: String,
    /// ZERO unless the field role positively allows content — never a
    /// suppressed field's length. See the module doc.
    pub key_count: u32,
    pub started_at_ms: u64,
}

/// Why the accumulator closed a burst. Kept for the observation payload so
/// the lane is inspectable, and so a test can assert WHICH rule fired rather
/// than merely that something flushed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FlushReason {
    Idle,
    ContextChanged,
    MaxLength,
}

/// Hard ceiling on a single burst, matching the `text` limit the tRPC schema
/// enforces (`z.string().max(10_000)`). Reaching it flushes rather than
/// truncates, so nothing typed is silently dropped on the floor.
pub const MAX_BURST_CHARS: usize = 10_000;

/// How long a pause ends a burst. Typing resumes as a NEW burst afterwards.
pub const IDLE_FLUSH_MS: u64 = 2_000;

/// Aggregates keystrokes into bursts. Pure — no OS calls, no clock of its
/// own (the caller passes `now_ms`), so the whole thing is unit-testable
/// without an event tap, a permission grant, or a running macOS session.
#[derive(Default)]
pub struct BurstAccumulator {
    context: Option<FocusContext>,
    text: String,
    key_count: u32,
    started_at_ms: u64,
    last_key_ms: u64,
}

impl BurstAccumulator {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record one typed character in the given focus context.
    ///
    /// Returns a burst when this key CLOSED the previous one (because focus
    /// changed, or the ceiling was hit). The returned burst never contains
    /// the key just pressed — that key opens the next burst.
    pub fn push_key(
        &mut self,
        ch: Option<char>,
        context: &FocusContext,
        now_ms: u64,
    ) -> Option<(InputBurst, FlushReason)> {
        let mut flushed = None;

        // A different app, host, or field role is a different burst.
        if self.context.as_ref().is_some_and(|current| current != context) {
            flushed = self.take_burst().map(|burst| (burst, FlushReason::ContextChanged));
        }

        if self.context.is_none() {
            self.context = Some(context.clone());
            self.started_at_ms = now_ms;
        }

        // THE fail-closed step: a field we have not positively identified as
        // ordinary text contributes no character and no count. The burst
        // still exists — "typing happened here" is the signal — but it is
        // structurally incapable of carrying what was typed.
        if context.field_role.allows_content() {
            if let Some(ch) = ch {
                self.text.push(ch);
            }
            self.key_count = self.key_count.saturating_add(1);
        }
        self.last_key_ms = now_ms;

        if self.text.chars().count() >= MAX_BURST_CHARS {
            let burst = self.take_burst().map(|burst| (burst, FlushReason::MaxLength));
            // A context-change flush and a max-length flush cannot both
            // happen on one key: the first emptied the buffer.
            return flushed.or(burst);
        }

        flushed
    }

    /// Close the burst if the user has stopped typing. Called by the drain
    /// loop's tick; returns `None` while a burst is still growing.
    pub fn flush_if_idle(&mut self, now_ms: u64) -> Option<(InputBurst, FlushReason)> {
        if self.context.is_none() {
            return None;
        }
        if now_ms.saturating_sub(self.last_key_ms) < IDLE_FLUSH_MS {
            return None;
        }
        self.take_burst().map(|burst| (burst, FlushReason::Idle))
    }

    /// Close the current burst unconditionally — used when capture is
    /// switched off or the app is quitting, so nothing lingers in memory.
    pub fn flush_now(&mut self) -> Option<InputBurst> {
        self.take_burst()
    }

    /// Drop everything held, emitting nothing. Used when consent is revoked
    /// or a denylisted app takes focus: a burst that must not be reported
    /// must also not be retained.
    pub fn discard(&mut self) {
        self.text.clear();
        self.key_count = 0;
        self.context = None;
    }

    fn take_burst(&mut self) -> Option<InputBurst> {
        let context = self.context.take()?;
        let text = std::mem::take(&mut self.text);
        let key_count = std::mem::take(&mut self.key_count);
        Some(InputBurst {
            app_name: context.app_name,
            app_bundle_id: context.app_bundle_id,
            host: context.host,
            field_role: context.field_role.as_wire(),
            text,
            key_count,
            started_at_ms: self.started_at_ms,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(role: FieldRole) -> FocusContext {
        FocusContext {
            app_name: "Editor".into(),
            app_bundle_id: "com.example.editor".into(),
            host: None,
            field_role: role,
        }
    }

    #[test]
    fn secure_ax_subrole_wins_over_an_ordinary_role() {
        // macOS reports a password box as role AXTextField + subrole
        // AXSecureTextField. Checking the role first would call it ordinary
        // text — this test is the ordering guard.
        assert_eq!(
            field_role_from_ax(Some("AXTextField"), Some("AXSecureTextField")),
            FieldRole::Secure
        );
    }

    #[test]
    fn unknown_and_absent_ax_data_fail_closed() {
        assert_eq!(field_role_from_ax(None, None), FieldRole::Undeterminable);
        assert_eq!(field_role_from_ax(Some("AXWebArea"), None), FieldRole::Undeterminable);
        // A role macOS adds in a future release is not silently trusted.
        assert_eq!(field_role_from_ax(Some("AXRichTextV2"), None), FieldRole::Undeterminable);
    }

    #[test]
    fn ordinary_text_roles_are_recognised() {
        assert_eq!(field_role_from_ax(Some("AXTextField"), None), FieldRole::ContentOk);
        assert_eq!(field_role_from_ax(Some("AXTextArea"), None), FieldRole::ContentOk);
        // Case tolerance, since AX strings come from other processes.
        assert_eq!(field_role_from_ax(Some("axtextfield"), None), FieldRole::ContentOk);
    }

    #[test]
    fn a_secure_field_accumulates_no_characters_and_no_count() {
        let mut acc = BurstAccumulator::new();
        for ch in "hunter22".chars() {
            acc.push_key(Some(ch), &ctx(FieldRole::Secure), 1_000);
        }
        let burst = acc.flush_now().expect("typing happened, so a burst exists");
        assert_eq!(burst.text, "", "a password never enters the buffer");
        assert_eq!(burst.key_count, 0, "and its LENGTH is never counted");
        assert_eq!(burst.field_role, "secure");
    }

    #[test]
    fn two_different_length_secrets_produce_identical_bursts() {
        // The ADR-239 property, enforced one layer earlier: indistinguishable
        // before distillation, not merely after it.
        let mut short = BurstAccumulator::new();
        for ch in "ab".chars() {
            short.push_key(Some(ch), &ctx(FieldRole::Secure), 1_000);
        }
        let mut long = BurstAccumulator::new();
        for ch in "a".repeat(64).chars() {
            long.push_key(Some(ch), &ctx(FieldRole::Secure), 1_000);
        }
        let a = short.flush_now().unwrap();
        let b = long.flush_now().unwrap();
        assert_eq!(a.text, b.text);
        assert_eq!(a.key_count, b.key_count);
    }

    #[test]
    fn an_undeterminable_field_is_treated_exactly_like_a_secure_one() {
        let mut acc = BurstAccumulator::new();
        for ch in "maybe-a-password".chars() {
            acc.push_key(Some(ch), &ctx(FieldRole::Undeterminable), 1_000);
        }
        let burst = acc.flush_now().unwrap();
        assert_eq!(burst.text, "");
        assert_eq!(burst.key_count, 0);
    }

    #[test]
    fn an_ordinary_field_accumulates_the_text() {
        let mut acc = BurstAccumulator::new();
        for (i, ch) in "hello".chars().enumerate() {
            acc.push_key(Some(ch), &ctx(FieldRole::ContentOk), 1_000 + i as u64);
        }
        let burst = acc.flush_now().unwrap();
        assert_eq!(burst.text, "hello");
        assert_eq!(burst.key_count, 5);
        assert_eq!(burst.field_role, "content_ok");
    }

    #[test]
    fn changing_field_role_closes_the_burst_so_text_never_crosses_fields() {
        // Typing a note, then tabbing into a password box, must not carry the
        // note's characters into the password burst — nor the reverse.
        let mut acc = BurstAccumulator::new();
        for ch in "note".chars() {
            acc.push_key(Some(ch), &ctx(FieldRole::ContentOk), 1_000);
        }
        let (flushed, reason) = acc
            .push_key(Some('x'), &ctx(FieldRole::Secure), 1_100)
            .expect("the role change closes the previous burst");
        assert_eq!(reason, FlushReason::ContextChanged);
        assert_eq!(flushed.text, "note");
        let secure = acc.flush_now().unwrap();
        assert_eq!(secure.text, "", "the secure burst carries nothing");
        assert_eq!(secure.key_count, 0);
    }

    #[test]
    fn changing_app_closes_the_burst() {
        let mut acc = BurstAccumulator::new();
        acc.push_key(Some('a'), &ctx(FieldRole::ContentOk), 1_000);
        let other = FocusContext {
            app_name: "Mail".into(),
            app_bundle_id: "com.apple.mail".into(),
            host: None,
            field_role: FieldRole::ContentOk,
        };
        let (flushed, reason) = acc.push_key(Some('b'), &other, 1_010).unwrap();
        assert_eq!(reason, FlushReason::ContextChanged);
        assert_eq!(flushed.app_bundle_id, "com.example.editor");
        assert_eq!(flushed.text, "a");
    }

    #[test]
    fn a_pause_closes_the_burst_and_typing_resumes_a_new_one() {
        let mut acc = BurstAccumulator::new();
        acc.push_key(Some('a'), &ctx(FieldRole::ContentOk), 1_000);
        assert!(acc.flush_if_idle(1_000 + IDLE_FLUSH_MS - 1).is_none());
        let (burst, reason) = acc.flush_if_idle(1_000 + IDLE_FLUSH_MS).unwrap();
        assert_eq!(reason, FlushReason::Idle);
        assert_eq!(burst.text, "a");
        // Nothing is left behind.
        assert!(acc.flush_if_idle(9_999_999).is_none());
    }

    #[test]
    fn discard_drops_everything_and_emits_nothing() {
        // Consent revoked mid-burst, or a denylisted app taking focus: what
        // must not be reported must also not be retained.
        let mut acc = BurstAccumulator::new();
        for ch in "secret".chars() {
            acc.push_key(Some(ch), &ctx(FieldRole::ContentOk), 1_000);
        }
        acc.discard();
        assert!(acc.flush_now().is_none());
    }

    #[test]
    fn a_burst_flushes_at_the_wire_schema_ceiling_rather_than_truncating() {
        let mut acc = BurstAccumulator::new();
        let mut flushed = None;
        for i in 0..MAX_BURST_CHARS {
            if let Some((burst, reason)) = acc.push_key(Some('x'), &ctx(FieldRole::ContentOk), i as u64) {
                flushed = Some((burst, reason));
            }
        }
        let (burst, reason) = flushed.expect("hitting the ceiling flushes");
        assert_eq!(reason, FlushReason::MaxLength);
        assert_eq!(burst.text.chars().count(), MAX_BURST_CHARS);
        assert!(burst.text.chars().count() <= 10_000, "never exceeds the tRPC max");
    }
}
