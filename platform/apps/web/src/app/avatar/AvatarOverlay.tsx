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
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { trpc, PILOT_WORKSPACE } from "../lib/trpc";
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
  workspaceName?: string;
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
 * Minimal geometric Avatar figure — simple shapes only (no path
 * data lifted from icon libraries, so this can't collide with lucide exports
 * the way whole-word codemods have before). Eyes are the expressive part:
 * closed arcs for idle/meditating, open circles otherwise, wide for
 * listening, narrowed for drafting/reading.
 */
export function AvatarFigure({
  avatarStyle,
  status,
  blinking,
  reducedMotion,
}: {
  avatarStyle: AvatarStyle;
  status: AvatarStatus;
  blinking: boolean;
  reducedMotion: boolean;
}) {
  const eyesClosed = status === "idle" || blinking;
  const eyeRy = eyesClosed ? 0.4 : status === "listening" ? 3.4 : 2.6;
  // "3D" ask (R-030): no 3D-modeling toolchain is available in this
  // environment (no asset pipeline / renderer), so this stays true to the
  // existing "no image assets, geometric SVG only" architecture and adds a
  // glossy/extruded LOOK via a radial-gradient head fill + drop-shadow filter
  // — same shapes, genuinely more dimensional, not a fabricated 3D asset.
  const gradientId = `bridge-avatar-body-${avatarStyle}`;
  const bodyFill = `url(#${gradientId})`;
  const strokeColor = "var(--color-navy)";
  const accent = STATUS_COLOR[status];

  const earsByStyle: Record<AvatarStyle, React.ReactNode> = {
    owl: (
      <>
        <path d="M20 22 L26 8 L32 22 Z" fill={bodyFill} stroke={strokeColor} strokeWidth="1.5" />
        <path d="M44 22 L38 8 L32 22 Z" fill={bodyFill} stroke={strokeColor} strokeWidth="1.5" />
      </>
    ),
    fox: (
      <>
        <path d="M18 20 L24 4 L30 20 Z" fill={bodyFill} stroke={strokeColor} strokeWidth="1.5" />
        <path d="M46 20 L40 4 L34 20 Z" fill={bodyFill} stroke={strokeColor} strokeWidth="1.5" />
      </>
    ),
    turtle: (
      <path d="M14 30 Q32 14 50 30 L50 38 Q32 46 14 38 Z" fill="var(--color-sage)" stroke={strokeColor} strokeWidth="1.5" opacity="0.55" />
    ),
    crane: (
      <path d="M32 6 L32 22" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" />
    ),
    wolf: (
      <>
        <path d="M16 22 L23 6 L29 22 Z" fill={bodyFill} stroke={strokeColor} strokeWidth="1.5" />
        <path d="M48 22 L41 6 L35 22 Z" fill={bodyFill} stroke={strokeColor} strokeWidth="1.5" />
      </>
    ),
    cat: (
      <>
        <path d="M18 20 L22 6 L30 20 Z" fill={bodyFill} stroke={strokeColor} strokeWidth="1.5" />
        <path d="M46 20 L42 6 L34 20 Z" fill={bodyFill} stroke={strokeColor} strokeWidth="1.5" />
      </>
    ),
    lion: (
      <>
        <circle cx="15" cy="18" r="7" fill="var(--color-amber-soft)" opacity="0.5" />
        <circle cx="49" cy="18" r="7" fill="var(--color-amber-soft)" opacity="0.5" />
        <circle cx="16" cy="30" r="7" fill="var(--color-amber-soft)" opacity="0.5" />
        <circle cx="48" cy="30" r="7" fill="var(--color-amber-soft)" opacity="0.5" />
      </>
    ),
    dog: (
      <>
        <ellipse cx="17" cy="24" rx="6" ry="12" fill={bodyFill} stroke={strokeColor} strokeWidth="1.5" />
        <ellipse cx="47" cy="24" rx="6" ry="12" fill={bodyFill} stroke={strokeColor} strokeWidth="1.5" />
      </>
    ),
    panda: (
      <>
        <circle cx="18" cy="16" r="7" fill={strokeColor} />
        <circle cx="46" cy="16" r="7" fill={strokeColor} />
      </>
    ),
    butterfly: (
      <>
        <ellipse cx="14" cy="24" rx="10" ry="16" fill="var(--color-steel-light)" opacity="0.55" stroke={strokeColor} strokeWidth="1" />
        <ellipse cx="50" cy="24" rx="10" ry="16" fill="var(--color-steel-light)" opacity="0.55" stroke={strokeColor} strokeWidth="1" />
      </>
    ),
    dolphin: (
      <path d="M32 4 L36 20 L28 20 Z" fill={bodyFill} stroke={strokeColor} strokeWidth="1.5" />
    ),
    peacock: (
      <>
        <path d="M32 2 L32 20" stroke="var(--color-sage)" strokeWidth="2" strokeLinecap="round" />
        <circle cx="24" cy="6" r="4" fill="var(--color-steel)" opacity="0.6" />
        <circle cx="40" cy="6" r="4" fill="var(--color-amber-soft)" opacity="0.6" />
      </>
    ),
    elephant: (
      <>
        <ellipse cx="14" cy="26" rx="7" ry="13" fill={bodyFill} stroke={strokeColor} strokeWidth="1.5" />
        <ellipse cx="50" cy="26" rx="7" ry="13" fill={bodyFill} stroke={strokeColor} strokeWidth="1.5" />
      </>
    ),
    eagle: (
      <>
        <path d="M18 22 L26 6 L30 22 Z" fill="var(--color-amber-soft)" stroke={strokeColor} strokeWidth="1.5" />
        <path d="M46 22 L38 6 L34 22 Z" fill="var(--color-amber-soft)" stroke={strokeColor} strokeWidth="1.5" />
      </>
    ),
    horse: (
      <>
        <path d="M22 20 L26 4 L31 20 Z" fill={bodyFill} stroke={strokeColor} strokeWidth="1.5" />
        <path d="M42 20 L38 4 L33 20 Z" fill={bodyFill} stroke={strokeColor} strokeWidth="1.5" />
      </>
    ),
    beaver: (
      <>
        <circle cx="17" cy="20" r="6" fill={bodyFill} stroke={strokeColor} strokeWidth="1.5" />
        <circle cx="47" cy="20" r="6" fill={bodyFill} stroke={strokeColor} strokeWidth="1.5" />
      </>
    ),
  };

  const snoutByStyle: Record<AvatarStyle, React.ReactNode> = {
    owl: null,
    fox: <path d="M32 34 L28 40 L36 40 Z" fill="var(--color-amber-soft)" opacity="0.7" />,
    turtle: null,
    crane: <path d="M32 34 L44 38 L32 40 Z" fill="var(--color-amber-soft)" opacity="0.8" />,
    wolf: <path d="M32 34 L27 40 L37 40 Z" fill="var(--color-warm-gray)" opacity="0.7" />,
    cat: <path d="M29 36 L32 39 L35 36 Z" fill="var(--color-amber-soft)" opacity="0.6" />,
    lion: <path d="M28 36 L32 41 L36 36 Z" fill="var(--color-amber-soft)" opacity="0.8" />,
    dog: <ellipse cx="32" cy="38" rx="6" ry="4" fill="var(--color-warm-gray)" opacity="0.6" />,
    panda: <ellipse cx="32" cy="37" rx="5" ry="3.5" fill="var(--color-warm-gray)" opacity="0.5" />,
    butterfly: null,
    dolphin: <path d="M32 34 L24 38 L32 40 Z" fill="var(--color-steel-light)" opacity="0.7" />,
    peacock: <path d="M32 34 L29 39 L35 39 Z" fill="var(--color-amber-soft)" opacity="0.6" />,
    elephant: <path d="M32 34 L29 46 L35 46 Z" fill="var(--color-warm-gray)" opacity="0.6" />,
    eagle: <path d="M32 34 L28 39 L36 39 Z" fill="var(--color-amber-soft)" opacity="0.9" />,
    horse: <ellipse cx="32" cy="39" rx="6" ry="5" fill="var(--color-warm-gray)" opacity="0.5" />,
    beaver: <ellipse cx="32" cy="38" rx="5" ry="3.5" fill="var(--color-amber-soft)" opacity="0.6" />,
  };

  return (
    <svg viewBox="0 0 64 64" width="100%" height="100%" role="presentation" aria-hidden="true">
      <defs>
        <radialGradient id={gradientId} cx="38%" cy="32%" r="75%">
          <stop offset="0%" stopColor="var(--color-background)" />
          <stop offset="55%" stopColor="var(--color-surface)" />
          <stop offset="100%" stopColor="var(--color-steel-light)" stopOpacity="0.5" />
        </radialGradient>
        <filter id="bridge-avatar-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="1.4" floodColor={strokeColor} floodOpacity="0.25" />
        </filter>
      </defs>
      {/* soft status halo */}
      <circle cx="32" cy="32" r="30" fill={accent} opacity="0.12" />
      <g filter="url(#bridge-avatar-shadow)">
        {earsByStyle[avatarStyle]}
        {/* head */}
        <circle cx="32" cy="30" r="18" fill={bodyFill} stroke={strokeColor} strokeWidth="1.5" />
        {snoutByStyle[avatarStyle]}
      </g>
      {/* eyes */}
      <g>
        <ellipse
          cx="25"
          cy="29"
          rx="3.2"
          ry={eyeRy}
          fill={strokeColor}
          style={reducedMotion ? undefined : { transition: "ry 120ms ease-out" }}
        />
        <ellipse
          cx="39"
          cy="29"
          rx="3.2"
          ry={eyeRy}
          fill={strokeColor}
          style={reducedMotion ? undefined : { transition: "ry 120ms ease-out" }}
        />
      </g>
      {/* status ring */}
      <circle
        cx="32"
        cy="32"
        r="30"
        fill="none"
        stroke={accent}
        strokeWidth="2"
        opacity={status === "idle" ? 0.35 : 0.85}
      />
    </svg>
  );
}

/** Small style-aware Avatar badge used in chrome slots. */
export function AvatarIcon({ style, size = 24 }: { style: AvatarStyle; size?: number }) {
  return (
    <span className="inline-flex" style={{ width: size, height: size }}>
      <AvatarFigure avatarStyle={style} status="idle" blinking={false} reducedMotion />
    </span>
  );
}

export function AvatarOverlay({ style: avatarStyle, avatarName, workspaceName }: AvatarOverlayProps) {
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
    if (status !== "idle") {
      setOpen((v) => !v);
      // Still fetch pending count for the popover when opening.
      if (!open) {
        setPendingError(false);
        trpc.action.listPending
          .query({ workspaceId: PILOT_WORKSPACE, limit: 1, offset: 0 })
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
              {workspaceName || "Unnamed organization"}
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
          <span className="text-[11px] font-medium text-center" style={{ color: "var(--color-navy-mid)" }}>{label}</span>
        </div>
      )}

      <button
        type="button"
        onClick={wake}
        aria-label={`${name}, ${label}`}
        title={label}
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
