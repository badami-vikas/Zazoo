//! chase — "catch me if you can": the companion itself stays put; a small
//! pointer glyph IT controls flees the user's REAL system cursor across the
//! screen, triggered from Chat by typing something like "let's play a game"
//! (see `ChatView.tsx`).
//!
//! The glyph is drawn by the existing click-through `annotate` overlay
//! (`annotate.rs`/`AnnotateApp.tsx` — already a transparent, always-on-top,
//! per-monitor surface built for exactly "draw something over the user's
//! screen without stealing input") via a plain `{x,y,active}` position
//! stream, NOT the avatar's own window — the avatar is never moved or
//! resized. Cursor tracking reuses the notch home's permission-free
//! `NSEvent::mouseLocation` poll (`notch::cursor_position` — no Input
//! Monitoring prompt, no CGEventTap). No new window, no new permission, no
//! new crate.
//!
//! ponytail: scoped to the PRIMARY monitor only (index 0, the screen
//! `NSScreen::mainScreen` reports — same one the notch lives on). Chasing
//! across multiple displays needs the pointer glyph to hop between annotate
//! windows as it crosses a monitor boundary; add that if multi-monitor play
//! is wanted.
//!
//! One game at a time: starting again supersedes whatever is already
//! running (bumps `epoch`), rather than stacking loops.

use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::annotate;
use crate::companion;
use crate::notch;

const TICK: Duration = Duration::from_millis(40);
/// Logical px/sec fled per tick.
const FLEE_SPEED: f64 = 420.0;
/// Perpendicular wiggle amplitude (logical px/sec) — reads as alive instead
/// of a robotic straight-line bolt. Driven by `sin(t)`, not an RNG: no new
/// dependency for a cosmetic wobble.
const WIGGLE_AMPLITUDE: f64 = 60.0;
/// "Touch" tolerance in logical px — the drawn glyph's own radius plus a
/// little slack, so contact reads as a touch rather than an exact pixel hit.
const CATCH_RADIUS: f64 = 24.0;
/// The only monitor this v1 plays on — see module doc.
const POINTER_MONITOR: usize = 0;

pub const CHASE_STARTED_EVENT: &str = "bridge:chase-started";
pub const CHASE_CAUGHT_EVENT: &str = "bridge:chase-caught";
/// Fired when the game ends WITHOUT a catch — an explicit `stop_chase_game`
/// call (chat's "stop the game") or a newer game superseding this one — so
/// the face reverts even though there is nothing to celebrate or startle at.
pub const CHASE_STOPPED_EVENT: &str = "bridge:chase-stopped";
const CHASE_POINTER_EVENT: &str = "bridge:chase-pointer";

#[derive(Default)]
pub struct ChaseState {
    epoch: AtomicU64,
}

#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
struct ChaseCaughtPayload {
    duration_secs: f64,
}

#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
struct ChasePointerPayload {
    monitor: usize,
    x: f64,
    y: f64,
    active: bool,
}

#[tauri::command]
pub fn start_chase_game(app: AppHandle) -> Result<(), String> {
    let screen_height = notch::current_geometry(&app)
        .map(|geometry| geometry.screen_height)
        .ok_or_else(|| "screen geometry unavailable".to_string())?;
    let (width, height) = companion::monitor_logical_size(&app, POINTER_MONITOR)
        .ok_or_else(|| "monitor geometry unavailable".to_string())?;

    // The annotate window is normally hidden until it has something to
    // draw; show it up front so the very first pointer frame is visible.
    if let Some(window) = app.get_webview_window(annotate::ANNOTATE_LABEL) {
        let _ = window.show();
    }

    // Bumping the epoch both hands this run a fresh id AND invalidates any
    // prior run's loop — it notices the mismatch and exits within one tick.
    let epoch = app.state::<ChaseState>().epoch.fetch_add(1, Ordering::SeqCst) + 1;
    eprintln!("[bridge-desktop] chase: game {epoch} starting on {width:.0}x{height:.0}");
    let _ = app.emit(CHASE_STARTED_EVENT, ());

    thread::spawn(move || {
        let start = Instant::now();
        let mut pos = (width / 2.0, height / 2.0);
        let mut caught = false;

        loop {
            if app.state::<ChaseState>().epoch.load(Ordering::SeqCst) != epoch {
                break; // superseded by a newer start, or stopped
            }
            let (cursor_x, cursor_y) = notch::cursor_position(screen_height);
            if !cursor_x.is_finite() || !cursor_y.is_finite() {
                thread::sleep(TICK);
                continue;
            }

            let dx = pos.0 - cursor_x;
            let dy = pos.1 - cursor_y;
            let dist = (dx * dx + dy * dy).sqrt();

            if dist < CATCH_RADIUS {
                caught = true;
                app.state::<ChaseState>().epoch.fetch_add(1, Ordering::SeqCst);
                break;
            }

            let (nx, ny) = if dist > 0.001 { (dx / dist, dy / dist) } else { (0.0, -1.0) };
            let dt = TICK.as_secs_f64();
            let wiggle = (start.elapsed().as_secs_f64() * 3.0).sin() * WIGGLE_AMPLITUDE * dt;
            // (-ny, nx) is the flee direction rotated 90° — the wiggle axis.
            pos.0 = (pos.0 + nx * FLEE_SPEED * dt - ny * wiggle).clamp(0.0, width);
            pos.1 = (pos.1 + ny * FLEE_SPEED * dt + nx * wiggle).clamp(0.0, height);
            let _ = app.emit(
                CHASE_POINTER_EVENT,
                ChasePointerPayload { monitor: POINTER_MONITOR, x: pos.0, y: pos.1, active: true },
            );

            thread::sleep(TICK);
        }

        let _ = app.emit(
            CHASE_POINTER_EVENT,
            ChasePointerPayload { monitor: POINTER_MONITOR, x: pos.0, y: pos.1, active: false },
        );
        eprintln!(
            "[bridge-desktop] chase: game {epoch} ended ({})",
            if caught { "caught" } else { "stopped" }
        );
        if caught {
            let _ = app.emit(
                CHASE_CAUGHT_EVENT,
                ChaseCaughtPayload { duration_secs: start.elapsed().as_secs_f64() },
            );
        } else {
            let _ = app.emit(CHASE_STOPPED_EVENT, ());
        }
    });

    Ok(())
}

#[tauri::command]
pub fn stop_chase_game(app: AppHandle) -> Result<(), String> {
    app.state::<ChaseState>().epoch.fetch_add(1, Ordering::SeqCst);
    Ok(())
}
