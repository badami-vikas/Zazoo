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

#[cfg(target_os = "macos")]
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
}

/// True when this process currently has the macOS Accessibility permission
/// grant (System Settings > Privacy & Security > Accessibility). Read-only —
/// does NOT prompt; a future `ax_request_permission` command (using
/// `AXIsProcessTrustedWithOptions` + the prompt option) is the interactive
/// counterpart, not built here since it needs a real permission-dialog
/// round-trip to verify.
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
