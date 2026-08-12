/**
 * Persistent avatar overlay — bottom-right, mounted once in <Layout> inside
 * the authed shell so it renders across every route (docs/raw/spec-
 * consolidation-2026-07.md section 3: "Avatar Day-1 — Operational Status
 * Surface").
 *
 * Operational status is the PRIMARY surface (idle/listening/reading_context/
 * drafting/awaiting_approval/blocked_by_policy/error). Avatar style is visual
 * only and never changes authority, tone, or behavior.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { trpc, PILOT_ORGANIZATION } from "../lib/trpc";
import { ZazooAvatar } from "./zazoo/ZazooAvatar";
import { ZazooCompact } from "./zazoo/ZazooCompact";
import { ZazooDirector } from "./zazoo/director";
import { statusToPerformance } from "./zazoo/status-performance";
import { SPECIES, DEFAULT_SPECIES } from "./zazoo/species";
import {
  CAPTURE_EVENT,
  STATUS_LABEL,
  setAvatarStatus,
  useAvatarStatus,
  type AvatarStatus,
  type AvatarStyle,
} from "./avatar-store";

export interface AvatarOverlayProps {
  style: AvatarStyle;
  avatarName?: string;
  organizationName?: string;
  /** False once the shell knows onboarding has NOT happened. The companion is
   * present either way (user directive 2026-08-05), but AP-021 forbids
   * offering actions that cannot execute yet — so before setup the click
   * target drives onboarding instead of navigating into an empty organization,
   * and the popover says so plainly. Defaults to true so an unknown state
   * never invents a "not set up" claim. */
  setupComplete?: boolean;
  /** Opens the onboarding dialog — the one thing the companion CAN do before
   * an organization exists. */
  onStartSetup?: () => void;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

/** State → accent color, drawn from Bridge tokens (never an arbitrary hex). */
const STATUS_COLOR: Record<AvatarStatus, string> = {
  idle: "var(--color-sage)",
  listening: "var(--color-steel)",
  reading_context: "var(--color-steel-light)",
  drafting: "var(--color-amber-soft)",
  awaiting_approval: "var(--color-amber-soft)",
  blocked_by_policy: "var(--color-navy-mid)",
  error: "var(--color-danger)",
};

/**
 * The Avatar figure — the SHIPPED Zazoo renderer (`zazoo/ZazooAvatar`), not a
 * second hand-drawn one.
 *
 * This used to be ~190 lines of local SVG: per-style ears, snouts, a gradient
 * head and its own eye geometry. Zazoo shipped alongside it and `OverlayApp`
 * (the desktop companion) already drove it through the same director, so the
 * product had two avatars that could disagree about what "listening" looks
 * like. `avatar-prototype.test.mjs` pinned the intent — "the in-app browser
 * companion uses the shipped Zazoo renderer" — and had been failing since it
 * landed. One renderer is the point: the status→pose map is defined once, in
 * `zazoo/status-performance.ts`, so a new status cannot be expressive in one
 * surface and blank in the other.
 *
 * The props are unchanged so every existing call site keeps working.
 */
export function AvatarFigure({
  avatarStyle,
  status,
  blinking,
  reducedMotion,
  width = 44,
}: {
  avatarStyle: AvatarStyle;
  status: AvatarStatus;
  blinking: boolean;
  reducedMotion: boolean;
  /** Drawn width of the full-body rig. Callers that live in a fixed slot must
   * pass their slot's size: ZazooAvatar declares `overflow: visible`, so a rig
   * larger than its container spills over the neighbours instead of clipping. */
  width?: number;
}) {
  // Stable per instance: ZazooAvatar's rAF loop depends on the identity of
  // this object, and a fresh director each render would restart the animation
  // on every state change.
  const director = useMemo(() => new ZazooDirector(), []);
  const species = useMemo(
    // `AvatarStyle` names an animal ("fox"); a Zazoo species has a NAME
    // ("Freya") and a `kind` that is the animal. Match on `kind` and fall back
    // to the default rather than inventing a rig for a style Zazoo has no
    // character for — a missing match must degrade to Zazoo, never to nothing.
    () => SPECIES.find((candidate) => candidate.kind === avatarStyle) ?? DEFAULT_SPECIES,
    [avatarStyle],
  );

  // The rig is a pure rendering of AvatarStatus — the same mapping OverlayApp
  // uses. No emotion is stored anywhere.
  useEffect(() => {
    director.perform(statusToPerformance(status));
  }, [director, status]);

  // "Avatar blink is the tell" (CLAUDE.md): a capture closes both eyes once
  // without changing mood. `triggerBlink` is the API that commit added for
  // exactly this, and it was reaching nothing on this surface.
  useEffect(() => {
    if (blinking) director.triggerBlink();
  }, [director, blinking]);

  // Reduced motion gets the static head, never the spring/blink/breath loop.
  // The figure this replaced hardcoded its motion on, which is the
  // inconsistency `CompanionZazooFace` was written to stop copying.
  if (reducedMotion) return <ZazooCompact size={width} />;
  return <ZazooAvatar director={director} width={width} species={species} />;
}

/**
 * Small style-aware Avatar badge used in chrome slots (chat panel header,
 * collapsed rail). Previously hardcoded `reducedMotion` to true, which
 * silently swapped in `ZazooCompact` — a second, hand-drawn, non-species-
 * colored rig — instead of the shipped `ZazooAvatar` the desktop overlay
 * renders. That made the chat panel's avatar visibly a different character
 * from "the avatar on screen." Reading the real preference keeps both
 * surfaces on the one renderer, per the "one renderer is the point" note
 * above.
 */
/** Head-crop geometry, shared with `CompanionZazooFace`: body width and the
 * downward nudge that centres the crop window on the face, both as a ratio of
 * the square slot. */
const HEAD_CROP_WIDTH_RATIO = 64 / 44;
const HEAD_CROP_OFFSET_RATIO = -6 / 44;

export function AvatarIcon({ style, size = 24 }: { style: AvatarStyle; size?: number }) {
  const reducedMotion = usePrefersReducedMotion();
  // The badge's box used to be `size` square while the rig inside it was drawn
  // at a hardcoded 44px — and ZazooAvatar's <svg> is `overflow: visible`, so the
  // extra 20px of panda escaped the box in every direction and hung out of the
  // panel header over the text below it (2026-08-12 report).
  //
  // Fitting the WHOLE animal into a 32px square would leave a head a few pixels
  // across, so this is the same square head crop `CompanionZazooFace` uses:
  // draw the body oversized and let the box clip it, nudged down so the window
  // centres on the face rather than the ear tips.
  return (
    <span
      className="inline-flex justify-center shrink-0"
      style={{ width: size, height: size, overflow: "hidden", alignItems: "flex-start" }}
    >
      <span style={{ marginTop: size * HEAD_CROP_OFFSET_RATIO }}>
        <AvatarFigure
          avatarStyle={style}
          status="idle"
          blinking={false}
          reducedMotion={reducedMotion}
          width={size * HEAD_CROP_WIDTH_RATIO}
        />
      </span>
    </span>
  );
}

export function AvatarOverlay({
  style: avatarStyle,
  avatarName,
  organizationName,
  setupComplete = true,
  onStartSetup,
}: AvatarOverlayProps) {
  const status = useAvatarStatus();
  const reducedMotion = usePrefersReducedMotion();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [blinking, setBlinking] = useState(false);
  const [lastCapture, setLastCapture] = useState<{ at: string; detail?: Record<string, unknown> } | null>(null);
  const blinkTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The blink tell (spec section 3): every `bridge:capture` window event
  // triggers a brief eye-close, proving the capture happened without being
  // startling. No blink permission ⇒ this listener simply never fires.
  useEffect(() => {
    function onCapture(e: Event) {
      const detail = (e as CustomEvent).detail as Record<string, unknown> | undefined;
      setLastCapture({ at: new Date().toISOString(), ...(detail ? { detail } : {}) });
      if (reducedMotion) return; // Respect prefers-reduced-motion: no blink animation, tell still recorded.
      setBlinking(true);
      if (blinkTimeout.current) clearTimeout(blinkTimeout.current);
      blinkTimeout.current = setTimeout(() => setBlinking(false), 200);
    }
    window.addEventListener(CAPTURE_EVENT, onCapture);
    return () => {
      window.removeEventListener(CAPTURE_EVENT, onCapture);
      if (blinkTimeout.current) clearTimeout(blinkTimeout.current);
      if (wakeTimeout.current) clearTimeout(wakeTimeout.current);
    };
  }, [reducedMotion]);

  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [pendingError, setPendingError] = useState(false);

  /**
   * Click → awaken contract (spec "Click behaviour"):
   *  1. Set reading_context briefly (300ms) — the "eyes scan" cue.
   *  2. Navigate to /signals (the inspectable Memory/capture ledger).
   *     /signals is the closest existing route to "Memory entries"; a dedicated
   *     /memory route is a follow-up once the memory tRPC surface ships.
   *
   * If the overlay is already in a non-idle state (agent working), clicking
   * opens the context popover instead so the user can check pending approvals
   * without interrupting the active operation.
   */
  function wake() {
    // AP-021: before setup there is no Memory ledger to navigate to and no
    // pending-approval surface to read, so the only honest action is to open
    // onboarding. Nothing else is offered.
    if (!setupComplete) {
      onStartSetup?.();
      return;
    }
    if (status !== "idle") {
      setOpen((v) => !v);
      // Still fetch pending count for the popover when opening.
      if (!open) {
        setPendingError(false);
        trpc.action.listPending
          .query({ organizationId: PILOT_ORGANIZATION, limit: 1, offset: 0 })
          .then((res) => setPendingCount(res.total))
          .catch(() => {
            setPendingCount(null);
            setPendingError(true);
          });
      }
      return;
    }
    // Brief reading_context flash (the "eyes scan" animation), then navigate.
    setAvatarStatus("reading_context");
    if (wakeTimeout.current) clearTimeout(wakeTimeout.current);
    wakeTimeout.current = setTimeout(() => {
      setAvatarStatus("idle");
      void navigate("/module/relationship/signals");
    }, 300);
  }

  const label = STATUS_LABEL[status];
  const name = avatarName || "Bridge Avatar";
  // Honest affordance copy: before setup the companion greets and offers the
  // one action it can actually perform, rather than implying organization
  // powers it does not have yet (AP-021).
  const actionLabel = setupComplete ? label : "Ready when you are — let's set your organization up";

  return (
    <div
      style={{ position: "fixed", right: 20, bottom: 20, zIndex: 50 }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {open && (
        <div
          role="dialog"
          aria-label={`${name} context`}
          className="absolute bottom-[72px] right-0 w-72 rounded-[var(--radius-card)] border border-border bg-background shadow-lg p-4 text-sm"
        >
          <div className="flex items-center justify-between mb-2">
            <p className="font-medium text-[var(--color-navy)]">{name}</p>
            <button
              type="button"
              aria-label="Close"
              className="text-muted-foreground hover:text-[var(--color-steel)]"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>
          <div className="space-y-1.5 text-[var(--color-navy-mid)]">
            <p>
              <span className="text-muted-foreground">Organization: </span>
              {organizationName || "Unnamed organization"}
            </p>
            <p>
              <span className="text-muted-foreground">Route: </span>
              {typeof window !== "undefined" ? window.location.pathname : "/"}
            </p>
            <p>
              <span className="text-muted-foreground">Pending approvals: </span>
              {pendingError
                ? "no context providers connected yet"
                : pendingCount === null
                  ? "checking…"
                  : pendingCount}
            </p>
            {lastCapture && (
              <p className="text-xs text-muted-foreground pt-1 border-t border-border mt-2">
                Last capture blink: {new Date(lastCapture.at).toLocaleTimeString()}. Every capture becomes an
                inspectable Memory entry.
              </p>
            )}
            {!lastCapture && (
              <p className="text-xs text-muted-foreground pt-1 border-t border-border mt-2">
                No captures yet this session. When something is noticed, {name} blinks — every capture becomes an
                inspectable Memory entry.
              </p>
            )}
          </div>
        </div>
      )}

      {hovering && !open && (
        <div className="absolute bottom-[72px] right-0 rounded-[var(--radius-card)] border border-border bg-background shadow-lg p-3 flex flex-col items-center gap-1.5" style={{ minWidth: 80 }}>
          <span className="block h-12 w-12">
            <AvatarFigure avatarStyle={avatarStyle} status={status} blinking={blinking} reducedMotion={reducedMotion} />
          </span>
          <span className="text-[11px] font-medium text-center" style={{ color: "var(--color-navy-mid)" }}>{actionLabel}</span>
        </div>
      )}

      <button
        type="button"
        onClick={wake}
        aria-label={`${name}, ${actionLabel}`}
        title={actionLabel}
        className="w-14 h-14 rounded-full bg-background border border-border shadow-md flex items-center justify-center focus:outline-none focus-visible:ring-2"
        style={{
          animation: reducedMotion || status !== "idle" ? undefined : "bridge-avatar-breathe 3.2s ease-in-out infinite",
        }}
      >
        <div className="flex h-11 w-11 items-center justify-center" role="img" aria-label={`Avatar — ${label}`}>
          <AvatarFigure avatarStyle={avatarStyle} status={status} blinking={blinking} reducedMotion={reducedMotion} />
        </div>
      </button>

      {/* ARIA live region — announces state changes without visual noise. */}
      <div className="sr-only" aria-live="polite">
        {name} is {label.toLowerCase()}.
      </div>

      <style>{`
        @keyframes bridge-avatar-breathe {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.04); }
        }
      `}</style>
    </div>
  );
}
