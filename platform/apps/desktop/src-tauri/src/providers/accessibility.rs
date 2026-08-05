//! accessibility — permission-check ONLY in this slice (desktop-companion
//! roadmap P1: "build the accessibility provider FIRST" — this is the
//! smallest safe first step, not the full provider).
//!
//! `AXIsProcessTrusted` is a single no-argument, no-CFType-ownership C
//! function — the one part of the macOS Accessibility API safe to hand-bind
//! without a maintained wrapper crate. Full AX-tree walking (AXUIElementRef
//! creation, CFArray attribute reads, coordinate conversion across
//! monitors/DPI) involves manual CoreFoundation retain/release bookkeeping
//! that is genuinely unsafe to hand-roll without a real macOS session to
//! exercise it against — NOT built in this slice. `ax_find_element` (or
//! equivalent) is the concrete next step; see docs/wiki/desktop-companion.md.
//!
//! No new Cargo dependency: linked directly against the ApplicationServices
//! framework (already present on every macOS system, unlike a features-gated
//! objc2 sub-crate) via a manual `extern "C"` binding — the framework-linking
//! pattern Rust uses for a single well-known stable C symbol.
//!
//! `ax_request_permission` (2026-08-05, onboarding accessibility prompt) is
//! the interactive counterpart flagged as "not built here" above — now built.
//! It calls `AXIsProcessTrustedWithOptions` with the `kAXTrustedCheckOptionPrompt`
//! key set true, which is the ONLY supported way to make macOS show its own
//! System Settings > Privacy & Security > Accessibility dialog and add this
//! process to that list; there is no in-app grant. That one call needs a
//! single-entry CFDictionary, so unlike `AXIsProcessTrusted` this DOES touch
//! CoreFoundation ownership — kept to the narrowest safe shape: the dictionary
//! is built with the CF-owned `kCFTypeDictionaryKeyCallBacks`/
//! `kCFTypeDictionaryValueCallBacks` (so CF, not us, manages the boxed
//! CFBoolean value's retain count), used for exactly one synchronous call,
//! and released immediately after — no CFType is ever held past this
//! function's scope.

#[cfg(target_os = "macos")]
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
    fn AXIsProcessTrustedWithOptions(options: CoreFoundation::CFDictionaryRef) -> bool;
    /// CFStringRef key for the "prompt on check" option, exported by
    /// ApplicationServices itself (not CoreFoundation).
    static kAXTrustedCheckOptionPrompt: CoreFoundation::CFStringRef;
}

/// Minimal hand-bound CoreFoundation surface — only what
/// `AXIsProcessTrustedWithOptions` needs (build one dictionary, release it).
/// Not a general CF wrapper; deliberately doesn't grow beyond this use.
#[cfg(target_os = "macos")]
#[allow(non_snake_case)]
mod CoreFoundation {
    use std::ffi::c_void;

    pub type CFTypeRef = *const c_void;
    pub type CFStringRef = CFTypeRef;
    pub type CFDictionaryRef = *const c_void;
    pub type CFAllocatorRef = *const c_void;
    pub type CFIndex = isize;

    /// Opaque — Rust never reads these fields, only forwards CoreFoundation's
    /// own static addresses for it to interpret.
    #[repr(C)]
    pub struct CFDictionaryKeyCallBacks(#[allow(dead_code)] u8);
    #[repr(C)]
    pub struct CFDictionaryValueCallBacks(#[allow(dead_code)] u8);

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        pub static kCFBooleanTrue: CFTypeRef;
        pub static kCFTypeDictionaryKeyCallBacks: CFDictionaryKeyCallBacks;
        pub static kCFTypeDictionaryValueCallBacks: CFDictionaryValueCallBacks;

        pub fn CFDictionaryCreate(
            allocator: CFAllocatorRef,
            keys: *const CFTypeRef,
            values: *const CFTypeRef,
            num_values: CFIndex,
            key_callbacks: *const CFDictionaryKeyCallBacks,
            value_callbacks: *const CFDictionaryValueCallBacks,
        ) -> CFDictionaryRef;

        pub fn CFRelease(cf: CFTypeRef);
    }
}

/// True when this process currently has the macOS Accessibility permission
/// grant (System Settings > Privacy & Security > Accessibility). Read-only,
/// side-effect-free, safe to poll repeatedly — does NOT prompt. Pairs with
/// `ax_request_permission` below for the interactive path.
#[tauri::command]
pub fn ax_permission_status() -> bool {
    #[cfg(target_os = "macos")]
    {
        unsafe { AXIsProcessTrusted() }
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

/// Triggers the OS's own Accessibility permission dialog (or, if already
/// denied once, silently does nothing — that is macOS's behavior, not a bug
/// here: after the first denial the OS requires the user to flip the toggle
/// in System Settings themselves, and no API can force a second dialog).
/// MUST be called only from an explicit user action (a button), never on
/// mount — an unsolicited permission prompt is bad UX regardless of platform
/// review rules. Returns the CURRENT trust state at the moment of the call,
/// same as `ax_permission_status`; the grant itself (if the user flips the
/// toggle) is only visible on a later poll, since the OS dialog is
/// non-blocking from this process's perspective.
#[tauri::command]
pub fn ax_request_permission() -> bool {
    #[cfg(target_os = "macos")]
    {
        use std::ptr;
        unsafe {
            let keys = [kAXTrustedCheckOptionPrompt];
            let values = [CoreFoundation::kCFBooleanTrue];
            let options = CoreFoundation::CFDictionaryCreate(
                ptr::null(),
                keys.as_ptr(),
                values.as_ptr(),
                1,
                &CoreFoundation::kCFTypeDictionaryKeyCallBacks,
                &CoreFoundation::kCFTypeDictionaryValueCallBacks,
            );
            let trusted = AXIsProcessTrustedWithOptions(options);
            if !options.is_null() {
                CoreFoundation::CFRelease(options);
            }
            trusted
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    #[test]
    fn ax_permission_status_returns_without_panicking() {
        // Can't assert true/false (depends on the CI/dev machine's actual
        // grant state) — the test is that the FFI call itself is sound and
        // returns, not what it returns.
        let _ = ax_permission_status();
    }
}
