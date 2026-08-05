/**
 * notch-home.ts — geometry, hover, and the drop trajectory for Zazoo's notch
 * home (roadmap Z1).
 *
 * The Rust side (`src-tauri/src/notch.rs`) owns the two things a webview
 * cannot know: where the physical cutout is, and where the cursor is when the
 * pointer is nowhere near this window. Everything here is the pure geometry
 * and easing that turns those two facts into a performance, kept out of the
 * component so it can be unit-tested without a Tauri host.
 *
 * The cutout itself is NOT drawable — there is no display behind it. Every box
 * below is sized and placed so its content lives BESIDE or BELOW the cutout,
 * with the top strip left black so the eye reads panel and cutout as one shape.
 */

/** Mirrors `notch::NotchGeometry` (top-left origin logical points). */
export interface NotchGeometry {
  hasNotch: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  screenWidth: number;
  screenHeight: number;
  scaleFactor: number;
  /** The Dock- and menu-bar-excluded area (top-left origin). Landing must stay
   * inside this, not just inside the full screen — a window positioned within
   * the full screen but behind the Dock's own (opaque, topmost) bar reads to
   * the user as "vanished off the bottom of the screen". */
  visibleLeft: number;
  visibleTop: number;
  visibleRight: number;
  visibleBottom: number;
}

/** Window box in logical points, centred on the notch by the Rust command. */
export interface NotchBox {
  width: number;
  height: number;
}

/** Resting: the window is concealed entirely, so the desktop is untouched.
 * The cursor poll — not a hover target — is what wakes it. */
export const NOTCH_BOX_BED: NotchBox = { width: 300, height: 136 };
export const NOTCH_BOX_CHAT: NotchBox = { width: 400, height: 152 };

/**
 * Zazoo's rig draws on a 240×310 viewBox, so a requested WIDTH becomes a
 * ~1.29× taller drawn box. Every vertical layout below is computed from the
 * drawn height rather than the requested width; using the width as if it were
 * the height cropped his legs off the bottom of the notch panel.
 */
export const AVATAR_ASPECT = 310 / 240;
export function avatarDrawnHeight(width: number): number {
  return Math.round(width * AVATAR_ASPECT);
}

/**
 * Size of the free-floating avatar window after it lands.
 *
 * MUST equal `WINDOW_SIZE.collapsed` in `OverlayApp.tsx` (96x96) — not a
 * design choice, a correctness requirement. `onLanded()` flips `home` to
 * "free", which re-arms `OverlayApp`'s own resize effect; that effect
 * unconditionally resizes to `WINDOW_SIZE.collapsed` via the pre-existing
 * `overlay_resize` command, which repositions using a bottom-right-pin
 * formula that knows nothing about the Dock. If this landing size differs
 * from that target, the resize call that fires immediately after landing
 * silently overwrites this module's Dock-aware placement with an
 * uncoordinated one — verified live: a 300x190 landing box drifted to a
 * position with ~80% of its height behind the Dock. Matching the size makes
 * that follow-up resize a no-op (same size in, same position out).
 */
export const FREE_BOX = { width: 96, height: 96 };
/** Landed avatar's own drawn WIDTH, and its margin from the screen bottom. */
export const LANDED_AVATAR_SIZE = 84;
export const LANDED_MARGIN_BOTTOM = 28;

/**
 * The drop plays inside ONE full-height window rather than by stepping the
 * window origin — no compositor animates a window's position smoothly enough
 * for a physical-feeling fall, and a moving window also drags its shadow and
 * fights the display server. So: grow the window to a full-height column,
 * animate Zazoo down it in CSS, then swap to a small window at the landing
 * site on the last frame.
 */
export function dropColumnBox(geometry: NotchGeometry): NotchBox {
  // Full-width, not a narrow column: the fall happens under the notch but the
  // rest position is the bottom-right corner (user directive), so after the
  // bounce the avatar glides horizontally to its landing spot INSIDE the same
  // window. A notch-width column would clip that glide at its left edge.
  return { width: geometry.screenWidth, height: geometry.screenHeight };
}

/**
 * Where Zazoo's centre sits horizontally, in WINDOW-local px, so he peeks out
 * to the left of the cutout rather than dead-centre under it — the original
 * roadmap framing ("peek HEAD-ONLY to the LEFT of the notch"), which user
 * feedback confirmed over centring.
 *
 * The window itself stays centred on the notch (simplest for the Rust dock
 * command, and it leaves generous margin on both sides); only the avatar's
 * drawn position within that window shifts left, to hug the cutout's left
 * edge. On a flat panel (no cutout) there is no edge to hug, so he stays
 * centred in the fallback box instead.
 */
export function avatarPeekCenterX(boxWidth: number, geometry: NotchGeometry): number {
  if (!geometry.hasNotch) return boxWidth / 2;
  // The window is centred on the notch, so the notch's own left edge, in
  // window-local coordinates, is this expression — independent of screen
  // position, which is why the window's absolute x never enters the formula.
  const notchLocalLeft = boxWidth / 2 - geometry.width / 2;
  return notchLocalLeft;
}

/** Clear space kept between the landed avatar/window and the Dock or screen edge. */
const LANDING_MARGIN = 16;

/**
 * Where Zazoo comes to rest inside the drop column, in column-local px.
 *
 * Measured against `visibleBottom` (the Dock-excluded area), not raw
 * `screenHeight` — landing inside the full screen but behind the Dock's own
 * opaque, topmost bar is exactly the bug this replaces: the avatar was
 * technically on screen, at coordinates 93pt of Dock height below its actual
 * visible floor, so it read to the user as having vanished.
 */
export function landingOffsetY(geometry: NotchGeometry): number {
  // Against the DRAWN height, not the requested width — otherwise the last
  // frame of the fall puts his feet ~25px inside the Dock strip.
  return (
    geometry.visibleBottom - LANDING_MARGIN - avatarDrawnHeight(LANDED_AVATAR_SIZE)
  );
}

/**
 * Final window rect once the drop finishes, in screen logical points.
 *
 * Clamped to `visibleLeft/Top/Right/Bottom` rather than the raw screen
 * bounds. `NSScreen.visibleFrame` already insets whichever edge the user's
 * Dock currently occupies — bottom by default (verified live: 93pt tall on
 * this machine), but also correct if it has been moved to a side — so the
 * same clamp keeps the landing clear of the Dock however it is configured,
 * which is the general form of "land to the right of the Dock".
 */
export function landedWindowRect(geometry: NotchGeometry): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  // Bottom-RIGHT corner of the visible area (user directive, confirmed with a
  // reference screenshot: the avatar rests just past the Dock's right end).
  // `visibleRight/visibleBottom` already exclude the Dock wherever it sits.
  const minX = geometry.visibleLeft + LANDING_MARGIN;
  const x = Math.max(geometry.visibleRight - FREE_BOX.width - LANDING_MARGIN, minX);
  const y = Math.max(
    geometry.visibleBottom - FREE_BOX.height - LANDING_MARGIN,
    geometry.visibleTop,
  );
  return { x, y, width: FREE_BOX.width, height: FREE_BOX.height };
}

/**
 * Upward rebound after impact, in px (subtract from the resting y). The fall
 * itself is `fallProgress`; this is the visible BOUNCE the user asked for —
 * two decaying hops, zero before impact and converged by the time
 * `squashSettled` says the performance is over.
 */
export function bounceOffsetY(t: number): number {
  if (t <= 1) return 0;
  const since = t - 1;
  return 52 * Math.exp(-6 * since) * Math.abs(Math.sin(7 * since));
}

/**
 * Horizontal glide from the fall line (under the notch) to the landing spot
 * (bottom-right), as the avatar's centre-x in window coordinates. Starts only
 * after impact so the fall reads as a straight vertical drop, and eases out
 * over the bounce.
 */
export function glideCenterX(t: number, geometry: NotchGeometry): number {
  const fallCentre = geometry.hasNotch
    ? geometry.x + geometry.width / 2
    : geometry.screenWidth / 2;
  const rect = landedWindowRect(geometry);
  const landCentre = rect.x + rect.width / 2;
  if (t <= 1) return fallCentre;
  const progress = Math.min((t - 1) / 0.55, 1);
  const eased = 1 - (1 - progress) * (1 - progress);
  return fallCentre + (landCentre - fallCentre) * eased;
}

/**
 * Vertical position of the falling avatar at normalized time `t`, as a
 * fraction of the fall distance.
 *
 * Gravity, not a symmetric ease: the fall accelerates (t²) so it reads as
 * weight rather than a slide. `landingSquash` supplies the impact; together
 * they are the roadmap's "compress and expand and land realistically".
 */
export function fallProgress(t: number): number {
  const clamped = Math.min(Math.max(t, 0), 1);
  return clamped * clamped;
}

/**
 * Squash-and-stretch through the drop, as {scaleX, scaleY} multipliers.
 *
 * Anticipation is handled by the caller (a crouch before release). Here:
 * stretch along the fall axis while airborne (volume conserved, so X narrows),
 * a hard squash at impact, then a decaying elastic settle back to 1. Volume
 * preservation is what stops it looking like a scale animation.
 */
export function landingSquash(t: number): { scaleX: number; scaleY: number } {
  if (t < 1) {
    // Airborne: stretch grows with speed, which under t² peaks at impact.
    const stretch = 1 + 0.28 * fallProgress(t);
    return { scaleX: 1 / Math.sqrt(stretch), scaleY: stretch };
  }
  // Post-impact elastic settle. `overshoot` crosses zero repeatedly and decays,
  // so the body squashes, rebounds past rest, and converges.
  const since = t - 1;
  const decay = Math.exp(-6 * since);
  const overshoot = Math.cos(18 * since) * decay;
  // At impact (since = 0) this is 1 - 0.34 = a deep squash.
  const scaleY = 1 - 0.34 * overshoot;
  return { scaleX: 1 / Math.sqrt(scaleY), scaleY };
}

/** True once the elastic settle has converged closely enough to stop the rAF. */
export function squashSettled(t: number): boolean {
  return t >= 1 && Math.exp(-6 * (t - 1)) < 0.02;
}
