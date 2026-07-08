/**
 * OverlayApp — frontend of the FLOATING desktop companion window (R-002).
 *
 * Rendered by the separate Vite entry `overlay.html` inside the Tauri
 * "overlay" window (apps/desktop src-tauri/src/overlay.rs): ~96×96,
 * transparent, undecorated, always-on-top, anchored bottom-right. Reuses the
 * exact same Creature + avatar-store as the in-page AvatarOverlay so the two
 * surfaces can never drift apart visually.
 *
 * State machine (adopted Invoko spec; v1 minimal-egg subset implemented):
 *   collapsed → hover → expanded_idle → working → result_ready → error
 *     → dismissing → collapsed
 * v1 ships collapsed / hover / expanded_idle / working (+ error passthrough
 * from avatar status). result_ready and dismissing are declared in the type
 * so the vocabulary is stable, but nothing drives them yet — honest gap, not
 * a fake animation.
 *
 * The WINDOW resizes with the state (Rust `overlay_resize` command keeps the
 * bottom-right corner pinned) — the panel is real OS chrome, not a div
 * overflowing a fixed window.
 */
import { useEffect, useRef, useState } from "react";
import { trpc, PILOT_WORKSPACE } from "../lib/trpc";
import { Creature } from "./AvatarOverlay";
import {
  CAPTURE_EVENT,
  STATUS_LABEL,
  loadAvatarPrefs,
  useAvatarStatus,
} from "./avatar-store";

/** Full Invoko-spec vocabulary; v1 drives the first four (+ error). */
export type CompanionState =
  | "collapsed"
  | "hover"
  | "expanded_idle"
  | "working"
  | "result_ready"
  | "error"
  | "dismissing";

/** Window sizes per companion state (logical px) — must match what the Rust
 * side created the window with (COLLAPSED_SIZE in overlay.rs). */
const WINDOW_SIZE: Record<"collapsed" | "hover" | "expanded", { w: number; h: number }> = {
  collapsed: { w: 96, h: 96 },
  hover: { w: 260, h: 96 },
  expanded: { w: 320, h: 400 },
};

function tauriInvoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  const internals = typeof window !== "undefined" ? window.__TAURI_INTERNALS__ : undefined;
  if (!internals?.invoke) return Promise.resolve(undefined);
  return internals.invoke(cmd, args).catch((err: unknown) => {
    // Never let a window-chrome failure break the avatar itself.
    console.error("[companion] invoke failed", cmd, err);
    return undefined;
  });
}

export function OverlayApp() {
  // localStorage is shared with the main window (same origin), so the
  // companion always shows the same hatched animal/name. `true`: by the time
  // the desktop shell exists, this install is an existing user.
  const [prefs] = useState(() => loadAvatarPrefs(true));
  const status = useAvatarStatus();
  const [expanded, setExpanded] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [blinking, setBlinking] = useState(false);
  const blinkTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [pendingError, setPendingError] = useState(false);

  // Derived companion state (the machine's read model).
  const working =
    status === "listening" || status === "reading_context" || status === "drafting";
  const state: CompanionState = expanded
    ? status === "error"
      ? "error"
      : working
        ? "working"
        : "expanded_idle"
    : hovering
      ? "hover"
      : "collapsed";

  // Blink tell — same window-event contract as the in-page overlay. Events
  // are per-webview, so this only fires for captures announced IN this
  // window; kernel-driven blink wiring across windows is a follow-up.
  useEffect(() => {
    function onCapture() {
      setBlinking(true);
      if (blinkTimeout.current) clearTimeout(blinkTimeout.current);
      blinkTimeout.current = setTimeout(() => setBlinking(false), 200);
    }
    window.addEventListener(CAPTURE_EVENT, onCapture);
    return () => {
      window.removeEventListener(CAPTURE_EVENT, onCapture);
      if (blinkTimeout.current) clearTimeout(blinkTimeout.current);
    };
  }, []);

  // Window chrome follows the state machine.
  useEffect(() => {
    const size = expanded
      ? WINDOW_SIZE.expanded
      : hovering
        ? WINDOW_SIZE.hover
        : WINDOW_SIZE.collapsed;
    void tauriInvoke("overlay_resize", { width: size.w, height: size.h });
  }, [expanded, hovering]);

  function toggleExpanded() {
    const next = !expanded;
    setExpanded(next);
    if (next) {
      // Same call the in-page overlay's wake() makes — one source of truth
      // for "how many actions await approval".
      setPendingError(false);
      trpc.action.listPending
        .query({ workspaceId: PILOT_WORKSPACE, limit: 1, offset: 0 })
        .then((res) => setPendingCount(res.total))
        .catch(() => {
          setPendingCount(null);
          setPendingError(true);
        });
    }
  }

  const name = prefs.avatarName || prefs.animal[0]!.toUpperCase() + prefs.animal.slice(1);
  const label = STATUS_LABEL[status];

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        alignItems: "flex-end",
        background: "transparent",
        overflow: "hidden",
      }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {expanded && (
        <div
          role="dialog"
          aria-label={`${name} — companion panel`}
          className="w-full mb-2 rounded-[var(--radius-card)] border border-border bg-background shadow-lg p-4 text-sm"
          style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}
        >
          <div className="flex items-center justify-between mb-2">
            <p className="font-medium text-[var(--color-navy)]">{name}</p>
            <button
              type="button"
              aria-label="Close"
              className="text-muted-foreground hover:text-[var(--color-steel)]"
              onClick={() => setExpanded(false)}
            >
              ×
            </button>
          </div>
          <div className="space-y-1.5 text-[var(--color-navy-mid)]">
            <p>
              <span className="text-muted-foreground">Status: </span>
              {label}
            </p>
            <p>
              <span className="text-muted-foreground">Pending approvals: </span>
              {pendingError
                ? "not reachable yet"
                : pendingCount === null
                  ? "checking…"
                  : pendingCount}
            </p>
            <button
              type="button"
              className="mt-3 w-full rounded-[var(--radius-button)] border border-border bg-[var(--color-navy)] text-[var(--color-background)] text-xs px-3 py-2 hover:opacity-90"
              onClick={() => void tauriInvoke("focus_main_window")}
            >
              Open Bridge
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-2" style={{ flex: "0 0 auto" }}>
        {state === "hover" && (
          <div className="whitespace-nowrap rounded-[var(--radius-button)] bg-[var(--color-navy)] text-[var(--color-background)] text-xs px-2 py-1">
            {label}
          </div>
        )}
        <button
          type="button"
          onClick={toggleExpanded}
          aria-label={`${name}, ${label}`}
          title={label}
          className="w-14 h-14 rounded-full bg-background border border-border shadow-md flex items-center justify-center focus:outline-none focus-visible:ring-2"
          style={{
            animation:
              status === "idle" ? "bridge-companion-breathe 3.2s ease-in-out infinite" : undefined,
          }}
        >
          <div className="w-11 h-11" role="img" aria-label={`Avatar state: ${label}`}>
            <Creature animal={prefs.animal} status={status} blinking={blinking} reducedMotion={false} />
          </div>
        </button>
      </div>

      <div className="sr-only" aria-live="polite">
        {name} is {label.toLowerCase()}.
      </div>

      <style>{`
        @keyframes bridge-companion-breathe {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.04); }
        }
        html, body, #overlay-root { background: transparent !important; }
      `}</style>
    </div>
  );
}
