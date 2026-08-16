/**
 * NotchHome — Zazoo living in the MacBook camera notch (roadmap Z1).
 *
 * Poses, in order of the user's gesture:
 *   concealed → (cursor enters the notch hot zone) → the bed slides down out
 *   of the cutout carrying a SLEEPING Zazoo, he wakes and stands up, and the
 *   bed slides back up out of sight → (click) → chat: the panel grows a
 *   composer → (drag down) → drop: the window becomes a full-height column
 *   and Zazoo falls to the bottom of the screen with stretch, impact squash
 *   and an elastic settle, then hands off to the free-floating home.
 *
 * The load-bearing constraint (see `notch.rs`): the cutout has no display
 * behind it, so nothing here may be drawn inside it. The box is flush with the
 * screen top and its top `cutoutHeight` points are left pure black, which is
 * what makes the physical notch and this panel read as one growing shape.
 * Drawing Zazoo any higher would simply delete him.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CompanionComposer } from "./CompanionComposer";
import { ZazooAvatar } from "./zazoo/ZazooAvatar";
import type { ZazooDirector } from "./zazoo/director";
import { usePrefersReducedMotion } from "./zazoo/CompanionZazooFace";
import { tauriInvoke } from "./tauri-internals";
import {
  NOTCH_BOX_BED,
  NOTCH_BOX_CHAT,
  avatarDrawnHeight,
  avatarPeekCenterX,
  bounceOffsetY,
  dropColumnBox,
  fallProgress,
  glideCenterX,
  landedWindowRect,
  landingOffsetY,
  landingSquash,
  squashSettled,
  type NotchGeometry,
} from "./notch-home";

/** How long the fall itself takes, before the settle. */
const FALL_MS = 620;
/** Anticipation crouch before release — Pixar's rule that a body gathers
 * before it moves. Short enough not to feel like lag. */
const CROUCH_MS = 160;

/** Entrance choreography (user directive): the bed carries a sleeping Zazoo
 * out of the cutout, he stands, and the bed goes back where it came from. */
const BED_SLIDE_MS = 420;
/** A beat of visible sleep on the bed before he wakes — without it the stand
 * reads as a glitch rather than as waking up. */
const SLEEP_HOLD_MS = 300;
const STAND_MS = 380;

/**
 * Zazoo's size in the notch and where he sits under the cutout. Deliberately
 * tight — flush with the cutout's lower edge, in a panel only as tall as he
 * is: the previous layout parked him 4px lower inside a 168px panel, which
 * read to the user as "the hover appears too low".
 *
 * Narrower here (72) than free-floating (84) so the whole animal, whose drawn
 * height is ~1.29× his width, fits the notch panel without cropping.
 */
const AVATAR_SIZE = 72;
const AVATAR_DRAWN_HEIGHT = avatarDrawnHeight(AVATAR_SIZE);
const AVATAR_TOP_GAP = 0;
/** Bed slab, tucked under his feet (his rig draws them at the very bottom of
 * its box, so the slab overlaps slightly rather than floating below them). */
const BED_TOP_GAP = AVATAR_TOP_GAP + AVATAR_DRAWN_HEIGHT - 4;
const BED_HEIGHT = 10;

export type NotchPose = "bed" | "chat";

/**
 * Entrance phases. `tucked` is everything parked behind the cutout (also the
 * resting state while the window is concealed, so the performance replays on
 * every hover); `sleeping` is the bed out with Zazoo lying on it; `standing`
 * is him rising while the bed retracts; `awake` is the steady state.
 */
type Entrance = "tucked" | "sleeping" | "standing" | "awake";

export function NotchHome({
  director,
  geometry,
  pose,
  onPose,
  onSubmit,
  onLanded,
  onDomHoverChange,
  visible,
  name,
}: {
  director: ZazooDirector;
  geometry: NotchGeometry;
  pose: NotchPose;
  onPose: (pose: NotchPose) => void;
  onSubmit: (text: string) => void;
  /** Fired once the drop has settled; the parent switches home to "free". */
  onLanded: () => void;
  /** The Rust cursor poll only tests a fixed geometric rect around the
   * cutout — it has no idea the bed/composer it just woke actually extends
   * further down. Reporting this window's OWN pointer enter/leave lets the
   * parent keep the window visible for as long as the cursor is anywhere
   * over the real rendered content, not just the narrow wake zone. */
  onDomHoverChange: (inside: boolean) => void;
  /** Whether the OS window is currently presented. Drives the entrance
   * replay; the component stays mounted while concealed. */
  visible: boolean;
  name: string;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const [dropping, setDropping] = useState(false);
  const droppingRef = useRef(false);
  const avatarRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ y: number; pointerId: number } | null>(null);
  // Debounces the pose-toggle click against a double-click: without this, a
  // double-click's two leading `click` events would flip the composer open
  // then shut before `runDrop` ever fires, a flicker on the way out the door.
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (clickTimer.current) clearTimeout(clickTimer.current);
    };
  }, []);

  // Entrance beat. Scheduled via BOTH rAF and a timer: this component mounts
  // while the OS window is still HIDDEN, and a hidden WKWebView delivers no
  // animation frames at all, so an rAF-only trigger left the entrance
  // permanently un-fired — avatar, bed and composer all parked above the
  // window, rendered but invisible and unclickable (reproduced in the browser
  // lab, `overlay.html?lab=1`). Timers still fire in hidden webviews.
  const [entrance, setEntrance] = useState<Entrance>("tucked");
  useEffect(() => {
    if (!visible) {
      setEntrance("tucked");
      return;
    }
    if (reducedMotion) {
      setEntrance("awake");
      return;
    }
    let started = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const begin = () => {
      if (started) return;
      started = true;
      setEntrance("sleeping");
      timers.push(
        setTimeout(() => setEntrance("standing"), BED_SLIDE_MS + SLEEP_HOLD_MS),
        setTimeout(() => setEntrance("awake"), BED_SLIDE_MS + SLEEP_HOLD_MS + STAND_MS),
      );
    };
    const raf = requestAnimationFrame(begin);
    timers.push(setTimeout(begin, 120));
    return () => {
      started = true;
      cancelAnimationFrame(raf);
      for (const timer of timers) clearTimeout(timer);
    };
  }, [visible, reducedMotion]);

  const cutoutHeight = geometry.hasNotch ? geometry.height : 0;
  const box = dropping
    ? dropColumnBox(geometry)
    : pose === "chat"
      ? NOTCH_BOX_CHAT
      : NOTCH_BOX_BED;
  const avatarCenterX = avatarPeekCenterX(box.width, geometry);

  // The box the OS window is sized to. During the drop the drop effect below
  // owns the sizing (it must know when the resize has actually landed before
  // it starts animating), so this one stands down.
  useEffect(() => {
    if (dropping) return;
    void tauriInvoke("overlay_dock_notch", { width: box.width, height: box.height });
  }, [box.width, box.height, dropping]);

  // Asleep on the bed, then awake. Meditating is the resting pose once he is
  // on his feet; opening the eyes is what the composer buys you.
  useEffect(() => {
    if (dropping) return;
    if (entrance === "tucked" || entrance === "sleeping") {
      director.perform({ emotion: "sleepy", action: "idle", energy: 0.08, attention: "away" });
      return;
    }
    if (pose === "chat") {
      director.perform({ emotion: "listening", action: "idle", attention: "user", energy: 0.5 });
    } else {
      director.perform({ emotion: "calm", action: "meditating", energy: 0.15, warmth: 0.8 });
    }
  }, [pose, dropping, entrance, director]);

  const runDrop = useCallback(() => {
    if (droppingRef.current) return;
    droppingRef.current = true;
    // Anticipation: gather before the fall.
    director.perform({ emotion: "unsure", action: "idle", energy: 0.8, attention: "away" });
    setDropping(true);
  }, [director]);

  /**
   * The fall, animated by writing transforms straight onto the element.
   *
   * Deliberately NOT React state per frame: a `setState` per rAF re-rendered
   * this component (and the whole avatar rig inside it) 60 times a second on
   * top of the rig's own animation loop, which is what made the drop stutter.
   * The window also has to finish its native resize to a full-height column
   * BEFORE the first animated frame — resizing a window mid-animation drops
   * frames on its own — so the fall waits on that command and then on two
   * presented frames.
   */
  useEffect(() => {
    if (!dropping) return;
    let cancelled = false;
    let raf = 0;
    const column = dropColumnBox(geometry);
    const distance = landingOffsetY(geometry) - cutoutHeight - AVATAR_TOP_GAP;

    const land = () => {
      const rect = landedWindowRect(geometry);
      void tauriInvoke("overlay_undock_free", rect).then(() => {
        if (!cancelled) onLanded();
      });
    };

    if (reducedMotion) {
      land();
      return () => {
        cancelled = true;
      };
    }

    let begin = 0;
    const tick = (now: number) => {
      if (cancelled) return;
      if (now < begin) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const t = (now - begin) / FALL_MS;
      const el = avatarRef.current;
      if (el) {
        const y =
          cutoutHeight +
          AVATAR_TOP_GAP +
          distance * fallProgress(Math.min(t, 1)) -
          bounceOffsetY(t);
        const { scaleX, scaleY } = landingSquash(t);
        el.style.left = `${glideCenterX(t, geometry)}px`;
        el.style.transform = `translateY(${y}px) scale(${scaleX}, ${scaleY})`;
      }
      if (squashSettled(t)) {
        land();
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    void tauriInvoke("overlay_dock_notch", {
      width: column.width,
      height: column.height,
    }).then(() => {
      if (cancelled) return;
      // Two frames: the first is the one the resize composites on, the second
      // is the first frame we can trust to be presented at a steady cadence.
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame((now) => {
          begin = now + CROUCH_MS;
          raf = requestAnimationFrame(tick);
        });
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [dropping, geometry, cutoutHeight, onLanded, reducedMotion]);

  // Entrance transforms. Everything starts tucked behind the cutout; the bed
  // travels down with Zazoo, then back up on its own once he is standing.
  const tuckedY = -(cutoutHeight + AVATAR_DRAWN_HEIGHT + 60);
  const bedY = entrance === "sleeping" ? 0 : tuckedY;
  const avatarOut = entrance !== "tucked";
  // He is already lying down while tucked, so sliding out is a pure
  // translation and the only rotation the eye sees is him standing up.
  const lying = entrance === "tucked" || entrance === "sleeping";
  const slideTransition = reducedMotion
    ? undefined
    : `transform ${BED_SLIDE_MS}ms cubic-bezier(0.34, 1.4, 0.64, 1)`;
  const standTransition = reducedMotion
    ? undefined
    : `transform ${STAND_MS}ms cubic-bezier(0.34, 1.5, 0.64, 1)`;
  const composerReady = entrance === "standing" || entrance === "awake";

  // The docked avatar transform, rebuilt only when a phase changes (the drop
  // takes the element over imperatively and this is not applied then).
  const dockedAvatarStyle = useMemo(() => {
    // Lying on the bed: rotated onto his side, pivoting at his FEET so the
    // stand reads as rising rather than spinning in place. That pivot swings
    // his bounding box ~35px lower than it sits standing, so the lying pose
    // carries a matching upward offset — without it his legs are clipped off
    // the bottom of a panel sized for a standing avatar.
    const restY = cutoutHeight + AVATAR_TOP_GAP;
    const lieY = AVATAR_TOP_GAP;
    const y = (lying ? lieY : restY) + (avatarOut ? 0 : tuckedY);
    return {
      left: avatarCenterX,
      // Rotated CLOCKWISE, so his head lies toward the open middle of the
      // panel. Counter-clockwise put it past the panel's left edge — he
      // peeks out only ~60px from that edge, and his body is longer than
      // that, so lying leftward simply cropped his head off.
      transform: `translateY(${y}px)${lying ? " rotate(74deg)" : ""}`,
      transformOrigin: "50% 100%",
      transition: lying ? slideTransition : standTransition,
    } as const;
  }, [
    cutoutHeight,
    avatarOut,
    tuckedY,
    lying,
    avatarCenterX,
    slideTransition,
    standTransition,
  ]);

  function beginDrag(event: React.PointerEvent) {
    if (!event.isPrimary || event.button !== 0) return;
    dragStart.current = { y: event.clientY, pointerId: event.pointerId };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function continueDrag(event: React.PointerEvent) {
    const start = dragStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    // A deliberate downward pull is the "take Zazoo out of the notch" gesture.
    if (event.clientY - start.y > 26) {
      dragStart.current = null;
      const el = event.currentTarget as HTMLElement;
      if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
      runDrop();
    }
  }

  function endDrag(event: React.PointerEvent) {
    const el = event.currentTarget as HTMLElement;
    if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
    dragStart.current = null;
  }

  return (
    <div
      // The entrance is a timed multi-phase performance in a webview that
      // cannot be inspected from outside; surfacing the phase is what makes it
      // testable from the browser lab (`overlay.html?lab=1`).
      data-entrance={entrance}
      data-dropping={dropping ? "true" : "false"}
      style={{
        width: "100vw",
        height: "100vh",
        background: "transparent",
        overflow: "hidden",
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
      // See `onDomHoverChange` doc: this is the real, currently-rendered
      // panel, so its own hover state is the authority on "is the cursor
      // still over Zazoo's home" once the Rust wake zone did its one job of
      // presenting the window in the first place.
      onMouseEnter={() => onDomHoverChange(true)}
      onMouseLeave={() => onDomHoverChange(false)}
    >
      {/* The panel body. Black, top corners square (it continues the cutout),
       * bottom corners generously rounded — the shape that reads as the notch
       * having grown rather than a window having appeared under it. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: dropping ? "transparent" : "#000",
          borderBottomLeftRadius: dropping ? 0 : 22,
          borderBottomRightRadius: dropping ? 0 : 22,
          transition: "background 160ms linear",
          pointerEvents: dropping ? "none" : "auto",
        }}
      />

      {/* The bed: a rounded slab that carries Zazoo out of the cutout and then
       * withdraws once he is on his feet. Rendered BEFORE the avatar so he
       * always sits on top of it. */}
      {!dropping && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: cutoutHeight + BED_TOP_GAP,
            // Offset right of the standing position: the slab has to be under
            // the LYING body, which extends rightward from his feet.
            left: avatarCenterX + 44,
            marginLeft: -66,
            width: 132,
            height: BED_HEIGHT,
            borderRadius: 10,
            // Bright enough to actually read as a bed against the black
            // panel — the earlier 10% white washed out to invisible.
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.34), rgba(255,255,255,0.16))",
            boxShadow:
              "0 3px 12px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.25)",
            transform: `translateY(${bedY}px)`,
            transition: slideTransition,
          }}
        />
      )}

      {/* Zazoo. While docked he peeks out to the LEFT of the cutout (not
       * centred under it — the original roadmap framing, which user feedback
       * confirmed); during the drop the drop effect drives this same element
       * down the full-height column frame by frame. */}
      <div
        ref={avatarRef}
        style={{
          position: "absolute",
          top: 0,
          marginLeft: -AVATAR_SIZE / 2,
          width: AVATAR_SIZE,
          cursor: dropping ? "default" : "grab",
          touchAction: "none",
          willChange: "transform",
          ...(dropping
            ? {
                left: avatarCenterX,
                transform: `translateY(${cutoutHeight + AVATAR_TOP_GAP}px)`,
                transformOrigin: "50% 100%",
                transition: "none",
              }
            : dockedAvatarStyle),
        }}
        onPointerDown={dropping ? undefined : beginDrag}
        onPointerMove={dropping ? undefined : continueDrag}
        onPointerUp={dropping ? undefined : endDrag}
        onPointerCancel={dropping ? undefined : endDrag}
        onClick={() => {
          if (dropping || clickTimer.current) return;
          // Held briefly so a double-click's leading clicks never toggle the
          // composer open-then-shut on the way to `onDoubleClick` below.
          clickTimer.current = setTimeout(() => {
            clickTimer.current = null;
            onPose(pose === "chat" ? "bed" : "chat");
          }, 220);
        }}
        onDoubleClick={() => {
          if (dropping) return;
          if (clickTimer.current) {
            clearTimeout(clickTimer.current);
            clickTimer.current = null;
          }
          // Same undock the drag-down gesture triggers — a second, discoverable
          // way out of the notch for anyone who doesn't find the drag (user
          // directive).
          runDrop();
        }}
        role="button"
        tabIndex={0}
        aria-label={`${name} — click to ${pose === "chat" ? "close the composer" : "open the composer"}, double-click or drag down to move to the desktop`}
      >
        <ZazooAvatar director={director} width={AVATAR_SIZE} />
      </div>

      {/* The chat bar lives IN the notch panel, beside the avatar — always
       * visible while docked, not gated behind a click (user directive:
       * "I dont see a chatbox in notch next to avatar"). It arrives once
       * Zazoo is on his feet, so the entrance reads as one performance.
       *
       * The input itself is the SHARED CompanionComposer, the same one the
       * free-floating hover bar renders: one composer, one behaviour, one
       * chat thread behind it, in whichever home Zazoo happens to live. */}
      {!dropping && (
        <div
          style={{
            position: "absolute",
            left: avatarCenterX + AVATAR_SIZE / 2 + 8,
            right: 12,
            top: cutoutHeight + 6,
            display: "flex",
            gap: 6,
            opacity: composerReady ? 1 : 0,
            transform: `translateY(${composerReady ? 0 : tuckedY}px)`,
            transition: reducedMotion
              ? undefined
              : `${slideTransition}, opacity 200ms linear`,
          }}
        >
          <CompanionComposer
            name={name}
            variant="notch"
            focused={pose === "chat" && entrance === "awake"}
            onSubmit={onSubmit}
            onFocus={() => onPose("chat")}
            onDismiss={() => onPose("bed")}
          />
        </div>
      )}
    </div>
  );
}
