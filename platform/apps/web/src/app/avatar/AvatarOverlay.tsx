/**
 * Persistent avatar overlay — bottom-right, mounted once in <Layout> inside
 * the authed shell so it renders across every route (docs/raw/spec-
 * consolidation-2026-07.md section 3: "Avatar Day-1 — Operational Status
 * Surface, Personality Secondary").
 *
 * Operational status is the PRIMARY surface (idle/listening/reading_context/
 * drafting/awaiting_approval/blocked_by_policy/error) — the spirit-animal
 * shape is just the vessel it's rendered in, not the point. No image assets;
 * every animal is a small geometric SVG built from Bridge palette tokens.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { trpc, PILOT_WORKSPACE } from "../lib/trpc";
import { ZazooAvatar } from "./zazoo/ZazooAvatar";
import { ZazooDirector, type ZazooEmotion } from "./zazoo/director";
import {
  CAPTURE_EVENT,
  STATUS_LABEL,
  setAvatarStatus,
  useAvatarStatus,
  type AvatarStatus,
  type GrowthStage,
  type SpiritAnimal,
} from "./avatar-store";

export interface AvatarOverlayProps {
  animal: SpiritAnimal;
  avatarName?: string;
  workspaceName?: string;
  /** Growth stage computed from memory entry count + installed capability count.
   *  Defaults to 'creature' when not provided (safe mid-state for existing users
   *  whose counts haven't been fetched yet). Layout should pass this once tRPC
   *  counts resolve; the overlay never fetches counts itself. */
  growthStage?: GrowthStage;
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
 * Minimal geometric creature per spirit animal — simple shapes only (no path
 * data lifted from icon libraries, so this can't collide with lucide exports
 * the way whole-word codemods have before). Eyes are the expressive part:
 * closed arcs for idle/meditating, open circles otherwise, wide for
 * listening, narrowed for drafting/reading.
 */
export function Creature({
  animal,
  status,
  blinking,
  reducedMotion,
}: {
  animal: SpiritAnimal;
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
  const gradientId = `bridge-avatar-body-${animal}`;
  const bodyFill = `url(#${gradientId})`;
  const strokeColor = "var(--color-navy)";
  const accent = STATUS_COLOR[status];

  // Per-animal head/ear silhouette (body circle shared across all).
  const earsByAnimal: Record<SpiritAnimal, React.ReactNode> = {
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

  const snoutByAnimal: Record<SpiritAnimal, React.ReactNode> = {
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
        {earsByAnimal[animal]}
        {/* head */}
        <circle cx="32" cy="30" r="18" fill={bodyFill} stroke={strokeColor} strokeWidth="1.5" />
        {snoutByAnimal[animal]}
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

/**
 * Small fixed-size avatar badge for chrome slots that need an identity icon but
 * not the full overlay (e.g. the AI chat panel header) — same live status/animal
 * as the overlay, just rendered compact with no popover/blink wiring.
 */
export function AvatarIcon({ animal, size = 24 }: { animal: SpiritAnimal; size?: number }) {
  const status = useAvatarStatus();
  const reducedMotion = usePrefersReducedMotion();
  return (
    <div style={{ width: size, height: size }} className="shrink-0 rounded-md overflow-hidden">
      <Creature animal={animal} status={status} blinking={false} reducedMotion={reducedMotion} />
    </div>
  );
}

export function AvatarOverlay({ animal, avatarName, workspaceName, growthStage = "creature" }: AvatarOverlayProps) {
  const status = useAvatarStatus();
  const reducedMotion = usePrefersReducedMotion();
  const director = useMemo(() => new ZazooDirector(), []);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [hovering, setHovering] = useState(false);
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
      if (!reducedMotion) director.triggerBlink();
    }
    window.addEventListener(CAPTURE_EVENT, onCapture);
    return () => {
      window.removeEventListener(CAPTURE_EVENT, onCapture);
      if (blinkTimeout.current) clearTimeout(blinkTimeout.current);
      if (wakeTimeout.current) clearTimeout(wakeTimeout.current);
    };
  }, [director, reducedMotion]);

  useEffect(() => {
    const emotionByStatus: Record<AvatarStatus, ZazooEmotion> = {
      idle: "calm",
      listening: "listening",
      reading_context: "curious",
      drafting: "thinking",
      awaiting_approval: "unsure",
      blocked_by_policy: "concerned",
      error: "concerned",
    };
    director.perform({ emotion: emotionByStatus[status], attention: "user", energy: status === "idle" ? 0.35 : 0.65 });
  }, [director, status]);

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
      void navigate("/signals");
    }, 300);
  }

  const label = STATUS_LABEL[status];
  const name = avatarName || animal[0]!.toUpperCase() + animal.slice(1);

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
        <div className="absolute bottom-[72px] right-0 whitespace-nowrap rounded-[var(--radius-button)] bg-[var(--color-navy)] text-[var(--color-background)] text-xs px-2 py-1">
          {label}
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
        {/* Growth stage visual:
            egg     → dormant egg SVG (creature hasn't hatched yet in the overlay sense)
            creature → normal Creature SVG (default)
            mature  → Creature at 10% larger scale (richer presence) */}
        {growthStage === "egg" ? (
          <div className="w-11 h-11" role="img" aria-label="Avatar: egg stage">
            <svg viewBox="0 0 64 64" width="100%" height="100%" role="presentation" aria-hidden="true">
              <ellipse cx="32" cy="38" rx="18" ry="24" fill="var(--color-background)" stroke="var(--color-amber-soft)" strokeWidth="2" />
              <ellipse cx="32" cy="38" rx="22" ry="28" fill="var(--color-amber-soft)" opacity="0.12" />
            </svg>
          </div>
        ) : (
          <div
            className="flex items-center justify-center"
            style={growthStage === "mature" ? { width: "2.875rem", height: "2.875rem", transform: "scale(1.1)" } : { width: "2.75rem", height: "2.75rem" }}
            role="img"
            aria-label={`${name}, ${label}`}
          >
            <ZazooAvatar director={director} width={48} />
          </div>
        )}
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
