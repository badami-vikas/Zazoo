/**
 * notch.rs — Zazoo's notch home (roadmap Z1, `zazoo-companion-avatar-roadmap-2026-07.md`).
 *
 * Two facts about the MacBook notch shape everything here:
 *
 * 1. **There is no display behind the cutout.** `NSScreen::frame` spans the
 *    full panel, but the notch rect is camera housing — nothing rendered at
 *    those coordinates is ever visible. So Zazoo can never be drawn "in" the
 *    notch. What reads as "the notch expanded" is a black, top-rounded panel
 *    flush with the screen top whose colour matches the physical cutout; the
 *    eye joins the two. Every geometry helper below therefore reports the
 *    cutout so the webview can draw AROUND and BELOW it, never inside it.
 *
 * 2. **Hover cannot be detected by a window that isn't there.** A docked
 *    companion is a few points tall, so waiting for `mouseenter` on it would
 *    make the peek nearly unreachable. Instead a background thread polls
 *    `NSEvent::mouseLocation` — which needs NO TCC permission, unlike a
 *    CGEventTap — and emits an edge-triggered event when the cursor crosses
 *    into or out of a hot zone that is deliberately larger than the cutout.
 *
 * Coordinate spaces are a live hazard: AppKit is bottom-left origin, Tauri and
 * the DOM are top-left. Everything this module hands out is **top-left origin
 * logical points**, converted once, at the boundary.
 */
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

/// Cursor poll cadence. 60ms reads as instant for a hover affordance while
/// leaving the poll far below the roadmap's "< 1% CPU hidden" exit criterion.
const HOVER_POLL_INTERVAL: Duration = Duration::from_millis(60);
/// The hot zone extends this far below the cutout's bottom edge...
const HOT_ZONE_PAD_BELOW: f64 = 14.0;
/// ...and this far past each side. Aiming at a 179pt target with no visible
/// affordance is fussy; widening the catch area is what makes the peek feel
/// responsive rather than finicky.
const HOT_ZONE_PAD_SIDE: f64 = 48.0;

pub const NOTCH_HOVER_EVENT: &str = "bridge:notch-hover";

/// The notch cutout in **top-left origin logical points**, plus the screen it
/// belongs to. `has_notch` false means this display has no cutout — the
/// roadmap's documented fallback is top-centre of the active display, which the
/// webview applies using `screen_width`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotchGeometry {
    pub has_notch: bool,
    /// Left edge of the cutout. Meaningless when `has_notch` is false.
    pub x: f64,
    /// Always 0 — the cutout is flush with the top of the display.
    pub y: f64,
    pub width: f64,
    /// Cutout height == `safeAreaInsets.top` == the tall menu bar's height.
    pub height: f64,
    pub screen_width: f64,
    pub screen_height: f64,
    pub scale_factor: f64,
    /// The Dock- and menu-bar-EXCLUDED area, in top-left origin logical
    /// points. `NSScreen::visibleFrame` already insets whichever edge the
    /// Dock currently occupies (bottom by default, but the user can move it
    /// left/right, and it can auto-hide) — so clamping the landed window to
    /// this rect, rather than the full screen, is what keeps a dropped
    /// companion from landing physically behind the Dock and reading as
    /// "vanished off the bottom of the screen".
    pub visible_left: f64,
    pub visible_top: f64,
    pub visible_right: f64,
    pub visible_bottom: f64,
}

impl NotchGeometry {
    /// The cursor catch area. Wider and taller than the cutout on purpose —
    /// see `HOT_ZONE_PAD_SIDE`. Returned as (left, top, right, bottom).
    pub fn hot_zone(&self) -> (f64, f64, f64, f64) {
        if self.has_notch {
            (
                self.x - HOT_ZONE_PAD_SIDE,
                0.0,
                self.x + self.width + HOT_ZONE_PAD_SIDE,
                self.height + HOT_ZONE_PAD_BELOW,
            )
        } else {
            // Non-notch fallback: a notch-sized target at top-centre, so the
            // gesture is identical on an external display.
            let half = 90.0 + HOT_ZONE_PAD_SIDE;
            let mid = self.screen_width / 2.0;
            (mid - half, 0.0, mid + half, 24.0 + HOT_ZONE_PAD_BELOW)
        }
    }

    pub fn contains_cursor(&self, x: f64, y: f64) -> bool {
        let (left, top, right, bottom) = self.hot_zone();
        x >= left && x <= right && y >= top && y <= bottom
    }
}

/// Shared so the hover watcher re-reads geometry after a display change
/// instead of holding a stale cutout for a monitor that is gone.
#[derive(Default)]
pub struct NotchState {
    pub geometry: Mutex<Option<NotchGeometry>>,
    watcher_running: AtomicBool,
    // Tracks the Fn key state so the hover-watcher loop can emit PTT events
    // without a CGEventTap (which would need Input Monitoring permission).
    fn_key_pressed: AtomicBool,
}

#[cfg(target_os = "macos")]
fn read_geometry_on_main_thread() -> Option<NotchGeometry> {
    use objc2_app_kit::NSScreen;
    use objc2_foundation::MainThreadMarker;

    let mtm = MainThreadMarker::new()?;
    let screen = NSScreen::mainScreen(mtm)?;

    let frame = screen.frame();
    let scale_factor = screen.backingScaleFactor();
    let screen_width = frame.size.width;
    let screen_height = frame.size.height;

    // `visibleFrame` is bottom-left origin like `frame`, and already excludes
    // whichever edge the Dock currently occupies (bottom by default, but the
    // user can move it, and it can auto-hide) plus the menu bar. Converting it
    // once here, rather than re-deriving it from Dock internals, is what lets
    // the drop landing spot avoid the Dock regardless of the user's setup.
    let visible = screen.visibleFrame();
    let visible_left = visible.origin.x;
    let visible_right = visible.origin.x + visible.size.width;
    let visible_top = screen_height - (visible.origin.y + visible.size.height);
    let visible_bottom = screen_height - visible.origin.y;

    // `safeAreaInsets.top` is the tall-menu-bar height on a notched panel and
    // 0 on a flat one — the cheapest reliable notch predicate.
    let inset_top = screen.safeAreaInsets().top;

    // In Swift these are `NSRect?`; the ObjC nil marshals to a zeroed rect, so
    // a zero-width auxiliary area means "no notch" rather than "notch of
    // width 0". Both must be non-degenerate for the arithmetic to mean
    // anything.
    let left = screen.auxiliaryTopLeftArea();
    let right = screen.auxiliaryTopRightArea();
    let has_aux = left.size.width > 0.0 && right.size.width > 0.0;

    let flat = NotchGeometry {
        has_notch: false,
        x: 0.0,
        y: 0.0,
        width: 0.0,
        height: 0.0,
        screen_width,
        screen_height,
        scale_factor,
        visible_left,
        visible_top,
        visible_right,
        visible_bottom,
    };

    if inset_top <= 0.0 || !has_aux {
        return Some(flat);
    }

    // The cutout is the gap between the two auxiliary areas. Both rects are
    // bottom-left origin, but we only take X here, which is orientation-free;
    // Y is pinned to 0 because the cutout is flush with the display top.
    let notch_x = left.origin.x + left.size.width;
    let notch_width = right.origin.x - notch_x;
    if notch_width <= 0.0 {
        return Some(flat);
    }

    Some(NotchGeometry {
        has_notch: true,
        x: notch_x,
        y: 0.0,
        width: notch_width,
        height: inset_top,
        ..flat
    })
}

#[cfg(not(target_os = "macos"))]
fn read_geometry_on_main_thread() -> Option<NotchGeometry> {
    None
}

/// `NSScreen` is main-thread-only, so the read is hopped onto the main thread
/// and awaited. Callers may be on any thread (commands, the watcher).
pub fn current_geometry(app: &AppHandle) -> Option<NotchGeometry> {
    let (tx, rx) = mpsc::channel();
    let hop = app.run_on_main_thread(move || {
        let _ = tx.send(read_geometry_on_main_thread());
    });
    if hop.is_err() {
        return None;
    }
    // Bounded: a wedged main thread must not hang a poll tick forever.
    rx.recv_timeout(Duration::from_millis(500)).ok().flatten()
}

/// Global cursor position in **top-left origin logical points**.
///
/// `NSEvent::mouseLocation` is a free function on any thread and needs no TCC
/// grant — the reason the peek works without prompting for Input Monitoring.
/// `pub(crate)`: also polled by `chase.rs`'s flee loop — same permission-free
/// read, just a second consumer.
#[cfg(target_os = "macos")]
pub(crate) fn cursor_position(screen_height: f64) -> (f64, f64) {
    use objc2_app_kit::NSEvent;
    let point = NSEvent::mouseLocation();
    (point.x, screen_height - point.y)
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn cursor_position(_screen_height: f64) -> (f64, f64) {
    (f64::NAN, f64::NAN)
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotchHoverPayload {
    pub inside: bool,
    pub cursor_x: f64,
    pub cursor_y: f64,
}

/// Edge-triggered hover watcher. Emits only on transition, so an idle cursor
/// costs one `mouseLocation` read per tick and no IPC at all.
pub fn start_hover_watcher(app: AppHandle) {
    let state = app.state::<NotchState>();
    if state.watcher_running.swap(true, Ordering::SeqCst) {
        return;
    }

    thread::spawn(move || {
        let mut inside = false;
        let mut ticks_since_geometry = u32::MAX;
        let mut geometry: Option<NotchGeometry> = None;

        loop {
            if !app.state::<NotchState>().watcher_running.load(Ordering::SeqCst) {
                return;
            }

            // Re-read geometry about once a second rather than every tick:
            // it only changes on display reconfiguration, and the main-thread
            // hop is far more expensive than the cursor read.
            ticks_since_geometry = ticks_since_geometry.saturating_add(1);
            if ticks_since_geometry >= 16 {
                ticks_since_geometry = 0;
                let previous = geometry;
                geometry = current_geometry(&app);
                if let Ok(mut slot) = app.state::<NotchState>().geometry.lock() {
                    *slot = geometry;
                }
                // Log only on change (including the first read): the cutout is
                // the one number every notch-home layout decision derives from,
                // so a wrong value must be visible in the log rather than
                // silently mislaying Zazoo off-screen.
                if previous != geometry {
                    match geometry {
                        Some(geo) if geo.has_notch => eprintln!(
                            "[bridge-desktop] notch home: cutout {}x{} at x={} on {}x{} @{}x",
                            geo.width,
                            geo.height,
                            geo.x,
                            geo.screen_width,
                            geo.screen_height,
                            geo.scale_factor
                        ),
                        Some(geo) => eprintln!(
                            "[bridge-desktop] notch home: no cutout on {}x{} — using top-centre fallback",
                            geo.screen_width, geo.screen_height
                        ),
                        None => eprintln!("[bridge-desktop] notch home: geometry unavailable"),
                    }
                }
            }

            if let Some(geo) = geometry {
                let (x, y) = cursor_position(geo.screen_height);
                if x.is_finite() && y.is_finite() {
                    let now_inside = geo.contains_cursor(x, y);
                    if now_inside != inside {
                        inside = now_inside;
                        let _ = app.emit(
                            NOTCH_HOVER_EVENT,
                            NotchHoverPayload {
                                inside,
                                cursor_x: x,
                                cursor_y: y,
                            },
                        );
                    }
                }
            }

            // Fn key PTT: poll NSEvent.modifierFlags (class method, no TCC
            // permission needed — same pattern as mouseLocation above).
            #[cfg(target_os = "macos")]
            {
                use objc2_app_kit::{NSEvent, NSEventModifierFlags};
                let flags = NSEvent::modifierFlags_class();
                let fn_now = flags.contains(NSEventModifierFlags::Function);
                let fn_state = app.state::<NotchState>();
                let fn_was = fn_state.fn_key_pressed.swap(fn_now, Ordering::Relaxed);
                if fn_now != fn_was {
                    let ptt_state = if fn_now { "pressed" } else { "released" };
                    let _ = app.emit(crate::companion::COMPANION_PTT_EVENT, ptt_state);
                }
            }

            thread::sleep(HOVER_POLL_INTERVAL);
        }
    });
}

pub fn stop_hover_watcher(app: &AppHandle) {
    app.state::<NotchState>()
        .watcher_running
        .store(false, Ordering::SeqCst);
}

#[tauri::command]
pub fn notch_geometry(app: AppHandle, state: State<'_, NotchState>) -> Option<NotchGeometry> {
    if let Some(geo) = current_geometry(&app) {
        if let Ok(mut slot) = state.geometry.lock() {
            *slot = Some(geo);
        }
        return Some(geo);
    }
    state.geometry.lock().ok().and_then(|slot| *slot)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notched() -> NotchGeometry {
        // The live probe on this MacBook Air (Mac14,2): 179x32 cutout at
        // x=646 on a 1470x956 logical panel.
        NotchGeometry {
            has_notch: true,
            x: 646.0,
            y: 0.0,
            width: 179.0,
            height: 32.0,
            screen_width: 1470.0,
            screen_height: 956.0,
            scale_factor: 2.0,
            // Matches the live probe: bottom-oriented Dock ~93pt, menu bar ~33pt.
            visible_left: 0.0,
            visible_top: 33.0,
            visible_right: 1470.0,
            visible_bottom: 863.0,
        }
    }

    #[test]
    fn hot_zone_is_wider_than_the_cutout_on_both_sides() {
        let (left, top, right, bottom) = notched().hot_zone();
        assert_eq!(top, 0.0);
        assert!(left < 646.0, "hot zone must start left of the cutout");
        assert!(right > 646.0 + 179.0, "hot zone must end right of the cutout");
        assert!(bottom > 32.0, "hot zone must extend below the cutout");
    }

    #[test]
    fn cursor_in_the_menu_bar_beside_the_notch_still_counts_as_hover() {
        // Aiming exactly at a 179pt target is fussy; the pad is the whole
        // point of the hot zone, so pin it.
        let geo = notched();
        assert!(geo.contains_cursor(646.0 + 179.0 / 2.0, 10.0), "dead centre");
        assert!(geo.contains_cursor(646.0 - 20.0, 10.0), "just left of cutout");
        assert!(geo.contains_cursor(646.0 + 179.0 + 20.0, 10.0), "just right");
    }

    #[test]
    fn cursor_below_or_far_from_the_notch_is_not_hover() {
        let geo = notched();
        assert!(!geo.contains_cursor(735.0, 200.0), "well below the strip");
        assert!(!geo.contains_cursor(100.0, 10.0), "far left in the menu bar");
        assert!(!geo.contains_cursor(1400.0, 10.0), "far right in the menu bar");
    }

    #[test]
    fn a_flat_panel_falls_back_to_a_top_centre_target() {
        let geo = NotchGeometry {
            has_notch: false,
            x: 0.0,
            y: 0.0,
            width: 0.0,
            height: 0.0,
            screen_width: 2560.0,
            screen_height: 1440.0,
            scale_factor: 1.0,
            visible_left: 0.0,
            visible_top: 25.0,
            visible_right: 2560.0,
            visible_bottom: 1440.0,
        };
        assert!(geo.contains_cursor(1280.0, 10.0), "top centre is the fallback home");
        assert!(!geo.contains_cursor(100.0, 10.0), "top left is not");
    }
}
