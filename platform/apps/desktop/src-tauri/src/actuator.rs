//! actuator — the companion's hands: moves the REAL macOS pointer, clicks,
//! types, presses keys, and scrolls, through CoreGraphics `CGEvent`s posted
//! to the HID event tap (the same primitive the open-source clicky family's
//! native mode uses). Everything here is a bystander-free, one-shot input
//! injection; it holds no policy. Policy — consent, bounds, privacy guard,
//! per-run stop — lives in `act.rs`, the only caller.
//!
//! Why `CGEventPost` and not `CGWarpMouseCursorPosition`: warping moves the
//! cursor WITHOUT generating motion events, so hover states, tooltips, and
//! tracking areas never update and the OS suppresses local input for a
//! beat afterwards. Posting `mouseMoved` events produces real motion the
//! app underneath sees exactly as it would a human's.
//!
//! Permissions: posting input needs the macOS Accessibility grant
//! (`AXIsProcessTrusted`), which `providers/accessibility.rs` already checks
//! and prompts for. Without it every call here returns `NotTrusted` and
//! nothing is posted — fail closed, never a silent no-op the user cannot
//! explain.
//!
//! The glide is pure math (`flight_path`) so it is host-testable: a
//! quadratic Bézier bowed to one side, sampled on a smoothstep clock
//! (`3t²−2t³`) — the same ease-in/ease-out feel as the clicky overlay's
//! flight arc, re-derived rather than copied. Duration scales with distance
//! and is clamped so short hops still read as motion and long ones never
//! feel sluggish.
//!
//! Takeover: the user's hand always wins. Between glide ticks the real
//! cursor is read back; if it is not where the last tick put it, the user
//! moved it, and the glide aborts with `Takeover` so the caller halts the
//! whole run.

use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum MouseButton {
    Left,
    Right,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Key {
    Return,
    Tab,
    Escape,
    Space,
    Backspace,
    Up,
    Down,
    Left,
    Right,
    /// ⌘ + a lower-case letter from the allowlist in `Key::parse`.
    Command(char),
}

impl Key {
    /// Parse a planner-supplied key name. Anything outside this allowlist is
    /// refused: a model must never be able to send ⌘Q, ⌘W, ⌘⌫, or an
    /// arbitrary chord just by naming it.
    pub fn parse(name: &str) -> Option<Key> {
        let name = name.trim().to_lowercase();
        Some(match name.as_str() {
            "return" | "enter" => Key::Return,
            "tab" => Key::Tab,
            "escape" | "esc" => Key::Escape,
            "space" => Key::Space,
            "backspace" | "delete" => Key::Backspace,
            "up" => Key::Up,
            "down" => Key::Down,
            "left" => Key::Left,
            "right" => Key::Right,
            other => {
                let letter = other.strip_prefix("cmd+").or_else(|| other.strip_prefix("command+"))?;
                let mut chars = letter.chars();
                let (c, rest) = (chars.next()?, chars.next());
                if rest.is_some() || !"acvlftz".contains(c) {
                    return None;
                }
                Key::Command(c)
            }
        })
    }

    /// (virtual key code, modifier flags) for the macOS keyboard event.
    fn code_and_flags(self) -> (u16, u64) {
        const CMD: u64 = 1 << 20;
        match self {
            Key::Return => (36, 0),
            Key::Tab => (48, 0),
            Key::Escape => (53, 0),
            Key::Space => (49, 0),
            Key::Backspace => (51, 0),
            Key::Up => (126, 0),
            Key::Down => (125, 0),
            Key::Left => (123, 0),
            Key::Right => (124, 0),
            Key::Command(c) => (
                match c {
                    'a' => 0,
                    'c' => 8,
                    'v' => 9,
                    'l' => 37,
                    'f' => 3,
                    't' => 17,
                    'z' => 6,
                    _ => 0,
                },
                CMD,
            ),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActuatorError {
    /// Accessibility not granted — nothing was posted.
    NotTrusted,
    /// The user moved the real cursor during a glide.
    Takeover,
    /// Not macOS.
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    Unsupported,
}

/// Smoothstep clock: ease in, ease out, `t ∈ [0,1]`.
pub fn smoothstep(t: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// How long a glide over `distance` logical px should take.
pub fn glide_duration(distance: f64) -> Duration {
    Duration::from_secs_f64((distance / 900.0).clamp(0.35, 1.1))
}

/// Tick spacing of the glide — ~60 Hz, matching the overlay's paint rate.
pub const GLIDE_TICK: Duration = Duration::from_millis(16);

/// The real cursor drifting further than this from where the last tick put
/// it means the user grabbed the mouse.
pub const TAKEOVER_PX: f64 = 28.0;

/// Sample a bowed quadratic Bézier from `from` to `to` on a smoothstep
/// clock. `samples` ≥ 2; the first point is exactly `from`, the last exactly
/// `to`. The bow is perpendicular to the travel direction and capped so a
/// cross-screen flight arcs gently rather than swinging wide.
pub fn flight_path(from: (f64, f64), to: (f64, f64), samples: usize) -> Vec<(f64, f64)> {
    let samples = samples.max(2);
    let (dx, dy) = (to.0 - from.0, to.1 - from.1);
    let distance = (dx * dx + dy * dy).sqrt();
    let bow = (distance * 0.18).min(120.0);
    let (px, py) = if distance > f64::EPSILON {
        (-dy / distance * bow, dx / distance * bow)
    } else {
        (0.0, 0.0)
    };
    let control = ((from.0 + to.0) / 2.0 + px, (from.1 + to.1) / 2.0 + py);
    (0..samples)
        .map(|i| {
            let t = smoothstep(i as f64 / (samples - 1) as f64);
            let u = 1.0 - t;
            (
                u * u * from.0 + 2.0 * u * t * control.0 + t * t * to.0,
                u * u * from.1 + 2.0 * u * t * control.1 + t * t * to.1,
            )
        })
        .collect()
}

pub fn distance(a: (f64, f64), b: (f64, f64)) -> f64 {
    ((a.0 - b.0).powi(2) + (a.1 - b.1).powi(2)).sqrt()
}

#[cfg(target_os = "macos")]
mod cg {
    use std::ffi::c_void;

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct CGPoint {
        pub x: f64,
        pub y: f64,
    }
    pub type CGEventRef = *mut c_void;
    pub type CGEventSourceRef = *mut c_void;

    pub const HID_EVENT_TAP: u32 = 0;
    pub const LEFT_DOWN: u32 = 1;
    pub const LEFT_UP: u32 = 2;
    pub const RIGHT_DOWN: u32 = 3;
    pub const RIGHT_UP: u32 = 4;
    pub const MOUSE_MOVED: u32 = 5;
    pub const BUTTON_LEFT: u32 = 0;
    pub const BUTTON_RIGHT: u32 = 1;
    /// `kCGMouseEventClickState` — 2 marks a double-click.
    pub const FIELD_CLICK_STATE: u32 = 1;
    /// `kCGScrollEventUnitLine`.
    pub const SCROLL_UNIT_LINE: u32 = 1;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        pub fn CGEventCreate(source: CGEventSourceRef) -> CGEventRef;
        pub fn CGEventGetLocation(event: CGEventRef) -> CGPoint;
        pub fn CGEventCreateMouseEvent(
            source: CGEventSourceRef,
            mouse_type: u32,
            position: CGPoint,
            button: u32,
        ) -> CGEventRef;
        pub fn CGEventCreateKeyboardEvent(
            source: CGEventSourceRef,
            key: u16,
            key_down: bool,
        ) -> CGEventRef;
        pub fn CGEventKeyboardSetUnicodeString(
            event: CGEventRef,
            length: usize,
            string: *const u16,
        );
        pub fn CGEventCreateScrollWheelEvent(
            source: CGEventSourceRef,
            units: u32,
            wheel_count: u32,
            wheel1: i32,
            ...
        ) -> CGEventRef;
        pub fn CGEventSetIntegerValueField(event: CGEventRef, field: u32, value: i64);
        pub fn CGEventSetFlags(event: CGEventRef, flags: u64);
        pub fn CGEventPost(tap: u32, event: CGEventRef);
        /// Permission-free read of a hardware button's current state
        /// (`kCGEventSourceStateHIDSystemState` = 1) — how a walkthrough
        /// notices the USER's own click without an event tap.
        pub fn CGEventSourceButtonState(state_id: u32, button: u32) -> bool;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        pub fn CFRelease(cf: *const c_void);
    }

    /// Post one event and release it. A null event (creation failed) is
    /// skipped rather than dereferenced.
    pub unsafe fn post(event: CGEventRef) {
        if event.is_null() {
            return;
        }
        CGEventPost(HID_EVENT_TAP, event);
        CFRelease(event);
    }
}

fn trusted() -> Result<(), ActuatorError> {
    #[cfg(target_os = "macos")]
    {
        if crate::providers::accessibility::ax_permission_status() {
            Ok(())
        } else {
            Err(ActuatorError::NotTrusted)
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err(ActuatorError::Unsupported)
    }
}

/// Where the real cursor is, in global top-left-origin logical points —
/// the same space every `CGEvent` here is posted in.
pub fn cursor_location() -> Option<(f64, f64)> {
    #[cfg(target_os = "macos")]
    unsafe {
        let event = cg::CGEventCreate(std::ptr::null_mut());
        if event.is_null() {
            return None;
        }
        let point = cg::CGEventGetLocation(event);
        cg::CFRelease(event);
        Some((point.x, point.y))
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

/// Whether the primary mouse button is held right now (the user's real
/// hand — synthetic clicks here are down-and-up within 35 ms).
pub fn primary_button_down() -> bool {
    #[cfg(target_os = "macos")]
    unsafe {
        cg::CGEventSourceButtonState(1, cg::BUTTON_LEFT)
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

/// Post a single real `mouseMoved` to `to`.
pub fn move_to(to: (f64, f64)) -> Result<(), ActuatorError> {
    trusted()?;
    #[cfg(target_os = "macos")]
    unsafe {
        let point = cg::CGPoint { x: to.0, y: to.1 };
        cg::post(cg::CGEventCreateMouseEvent(
            std::ptr::null_mut(),
            cg::MOUSE_MOVED,
            point,
            cg::BUTTON_LEFT,
        ));
    }
    Ok(())
}

/// Glide the real cursor from wherever it is to `to`, one real motion event
/// per tick, calling `on_tick(position)` after each so the caller can mirror
/// the motion (the overlay glyph). Aborts with `Takeover` the moment the
/// user's hand moves the cursor off the path.
pub fn glide_to(
    to: (f64, f64),
    mut on_tick: impl FnMut((f64, f64)),
) -> Result<(), ActuatorError> {
    trusted()?;
    let from = cursor_location().unwrap_or(to);
    let dist = distance(from, to);
    let samples = (glide_duration(dist).as_secs_f64() / GLIDE_TICK.as_secs_f64()).ceil() as usize;
    let path = flight_path(from, to, samples.max(2));
    let mut last = from;
    for (i, point) in path.into_iter().enumerate() {
        // The first ticks are exempt: `CGEventPost` is asynchronous, so the
        // read-back can lag one tick behind the post.
        if i > 2 {
            if let Some(real) = cursor_location() {
                if distance(real, last) > TAKEOVER_PX {
                    return Err(ActuatorError::Takeover);
                }
            }
        }
        move_to(point)?;
        on_tick(point);
        last = point;
        std::thread::sleep(GLIDE_TICK);
    }
    Ok(())
}

/// Click at `at` (the cursor is expected to already be there — glide first).
/// `clicks` = 1 or 2; the down/up pair carries the click state so a 2 reads
/// as a double-click, not two singles.
pub fn click(at: (f64, f64), button: MouseButton, clicks: u32) -> Result<(), ActuatorError> {
    trusted()?;
    #[cfg(target_os = "macos")]
    unsafe {
        let point = cg::CGPoint { x: at.0, y: at.1 };
        let (down, up, btn) = match button {
            MouseButton::Left => (cg::LEFT_DOWN, cg::LEFT_UP, cg::BUTTON_LEFT),
            MouseButton::Right => (cg::RIGHT_DOWN, cg::RIGHT_UP, cg::BUTTON_RIGHT),
        };
        // A real `mouseMoved` right before the press so the target app has
        // seen the cursor arrive (hover state) before it sees the click.
        cg::post(cg::CGEventCreateMouseEvent(std::ptr::null_mut(), cg::MOUSE_MOVED, point, btn));
        std::thread::sleep(Duration::from_millis(40));
        for n in 1..=clicks.clamp(1, 2) as i64 {
            for kind in [down, up] {
                let event = cg::CGEventCreateMouseEvent(std::ptr::null_mut(), kind, point, btn);
                if !event.is_null() {
                    cg::CGEventSetIntegerValueField(event, cg::FIELD_CLICK_STATE, n);
                }
                cg::post(event);
                std::thread::sleep(Duration::from_millis(35));
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (at, button, clicks);
    }
    Ok(())
}

/// Type `text` into whatever has keyboard focus, one Unicode key event per
/// character. Newlines become Return presses (a Unicode "\n" is not a key).
pub fn type_text(text: &str) -> Result<(), ActuatorError> {
    trusted()?;
    #[cfg(target_os = "macos")]
    unsafe {
        for ch in text.chars() {
            if ch == '\n' {
                press(Key::Return)?;
                continue;
            }
            let mut buf = [0u16; 2];
            let units = ch.encode_utf16(&mut buf);
            for down in [true, false] {
                let event = cg::CGEventCreateKeyboardEvent(std::ptr::null_mut(), 0, down);
                if !event.is_null() {
                    cg::CGEventKeyboardSetUnicodeString(event, units.len(), units.as_ptr());
                }
                cg::post(event);
            }
            std::thread::sleep(Duration::from_millis(12));
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = text;
    }
    Ok(())
}

pub fn press(key: Key) -> Result<(), ActuatorError> {
    trusted()?;
    #[cfg(target_os = "macos")]
    unsafe {
        let (code, flags) = key.code_and_flags();
        for down in [true, false] {
            let event = cg::CGEventCreateKeyboardEvent(std::ptr::null_mut(), code, down);
            if !event.is_null() && flags != 0 {
                cg::CGEventSetFlags(event, flags);
            }
            cg::post(event);
            std::thread::sleep(Duration::from_millis(20));
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = key;
    }
    Ok(())
}

/// Scroll `lines` under the cursor; positive = content moves up (scroll
/// down), negative = scroll up. Sent as several small wheel events so apps
/// with momentum scrolling behave.
pub fn scroll(lines: i32) -> Result<(), ActuatorError> {
    trusted()?;
    #[cfg(target_os = "macos")]
    unsafe {
        let step = if lines < 0 { 3 } else { -3 };
        for _ in 0..(lines.unsigned_abs() / 3).max(1) {
            cg::post(cg::CGEventCreateScrollWheelEvent(
                std::ptr::null_mut(),
                cg::SCROLL_UNIT_LINE,
                1,
                step,
            ));
            std::thread::sleep(Duration::from_millis(30));
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = lines;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flight_path_starts_and_ends_exactly_and_bows() {
        let path = flight_path((0.0, 0.0), (300.0, 0.0), 40);
        assert_eq!(path.len(), 40);
        assert_eq!(path[0], (0.0, 0.0));
        assert_eq!(path[39], (300.0, 0.0));
        // Straight-line travel would keep y at 0; the bow lifts the midpoint.
        assert!(path[20].1.abs() > 10.0, "expected a visible arc, got {:?}", path[20]);
        // x is monotonic along the flight — it never doubles back.
        assert!(path.windows(2).all(|w| w[1].0 >= w[0].0));
    }

    #[test]
    fn flight_path_eases_in_and_out() {
        let path = flight_path((0.0, 0.0), (1000.0, 0.0), 101);
        let first = distance(path[0], path[1]);
        let mid = distance(path[50], path[51]);
        let last = distance(path[99], path[100]);
        assert!(mid > first * 5.0 && mid > last * 5.0);
    }

    #[test]
    fn zero_distance_and_tiny_sample_counts_are_safe() {
        assert_eq!(flight_path((5.0, 5.0), (5.0, 5.0), 1), vec![(5.0, 5.0), (5.0, 5.0)]);
    }

    #[test]
    fn glide_duration_is_clamped() {
        assert_eq!(glide_duration(0.0), Duration::from_secs_f64(0.35));
        assert_eq!(glide_duration(10_000.0), Duration::from_secs_f64(1.1));
        assert_eq!(glide_duration(450.0), Duration::from_secs_f64(0.5));
    }

    #[test]
    fn key_allowlist_refuses_dangerous_chords() {
        assert_eq!(Key::parse("Return"), Some(Key::Return));
        assert_eq!(Key::parse("cmd+a"), Some(Key::Command('a')));
        assert_eq!(Key::parse("command+v"), Some(Key::Command('v')));
        for refused in ["cmd+q", "cmd+w", "cmd+shift+q", "cmd+", "cmd+ab", "f12", "", "alt+f4"] {
            assert_eq!(Key::parse(refused), None, "{refused} must be refused");
        }
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn off_macos_everything_is_unsupported_and_posts_nothing() {
        assert_eq!(move_to((1.0, 1.0)), Err(ActuatorError::Unsupported));
        assert_eq!(type_text("hi"), Err(ActuatorError::Unsupported));
    }
}
