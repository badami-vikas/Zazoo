/**
 * AnnotateApp — frontend of the click-through annotation window
 * (apps/desktop src-tauri/src/annotate.rs). Renders a Rust-validated,
 * typed mark list (highlight/arrow/callout/spotlight) as SVG over the
 * whole monitor — the "assist users when they don't know where to click"
 * surface (docs/wiki/desktop-companion.md P1).
 *
 * Deliberately the SIMPLEST possible component: it has no state of its own
 * beyond "what marks did Rust last send," no buttons, no interactivity —
 * the window itself is `set_ignore_cursor_events(true)` at creation, so
 * nothing here could receive a click even if it tried. Content is limited
 * to `AnnotationMark.label`, rendered as SVG `<text>` (never
 * `dangerouslySetInnerHTML`, never interpolated into markup) — text
 * content, not markup, stays true even if a future caller's label string
 * contained HTML-looking characters.
 */
import { useEffect, useState } from "react";

type MarkKind = "highlight" | "arrow" | "callout" | "spotlight";

interface AnnotationMark {
  kind: MarkKind;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string | null;
}

const MARKS_EVENT = "annotate:marks";

/**
 * Minimal Tauri v2 event listener — reimplements the ONE call
 * @tauri-apps/api's `listen()` makes (`invoke('plugin:event|listen', ...)`
 * with a `transformCallback`-registered handler) rather than adding the
 * module, matching this codebase's existing browser-first / raw-internals
 * approach (see OverlayApp.tsx's `tauriInvoke` and desktop-shell.d.ts).
 * No-ops outside Tauri (internals absent) — the component just never
 * receives marks, an honest empty state, same graceful-degrade pattern as
 * every other Tauri-only feature in this codebase.
 */
function tauriListen<T>(event: string, callback: (payload: T) => void): void {
  const internals = typeof window !== "undefined" ? window.__TAURI_INTERNALS__ : undefined;
  if (!internals?.invoke || !internals?.transformCallback) return;
  const handler = internals.transformCallback((data: unknown) => {
    const eventData = data as { payload?: T };
    if (eventData && "payload" in eventData) callback(eventData.payload as T);
  });
  internals.invoke("plugin:event|listen", { event, target: { kind: "Any" }, handler }).catch((err: unknown) => {
    console.error("[annotate] listen failed", event, err);
  });
}

/**
 * High-visibility yellow. The annotation surface floats over ARBITRARY
 * application windows — light, dark, photographic — so a theme colour is the
 * wrong tool: every mark is drawn twice, a wide near-black halo beneath a
 * bright yellow stroke, which stays legible on any background.
 */
const MARK_COLOR = "#FFD400";
const HALO_COLOR = "rgba(0,0,0,0.85)";
const STROKE = 4;
const HALO_STROKE = 9;

const COLORS = {
  highlight: MARK_COLOR,
  arrow: MARK_COLOR,
  callout: MARK_COLOR,
  spotlight: MARK_COLOR,
} as const;

/** Label text with its own halo, so it reads over any window beneath it. */
function MarkLabel({ x, y, text, anchor }: { x: number; y: number; text: string; anchor?: "middle" }) {
  const common = {
    x,
    y,
    fontSize: 16,
    fontWeight: 700,
    textAnchor: anchor,
    dominantBaseline: anchor ? ("middle" as const) : undefined,
  };
  return (
    <>
      <text {...common} stroke={HALO_COLOR} strokeWidth={5} strokeLinejoin="round" fill="none">
        {text}
      </text>
      <text {...common} fill={MARK_COLOR}>
        {text}
      </text>
    </>
  );
}

function MarkShape({ mark }: { mark: AnnotationMark }) {
  const cx = mark.x + mark.width / 2;
  const cy = mark.y + mark.height / 2;

  switch (mark.kind) {
    case "highlight":
      return (
        <>
          <rect
            x={mark.x}
            y={mark.y}
            width={mark.width}
            height={mark.height}
            rx={6}
            fill="none"
            stroke={HALO_COLOR}
            strokeWidth={HALO_STROKE}
          />
          <rect
            x={mark.x}
            y={mark.y}
            width={mark.width}
            height={mark.height}
            rx={6}
            fill={MARK_COLOR}
            fillOpacity={0.12}
            stroke={COLORS.highlight}
            strokeWidth={STROKE}
          />
          {mark.label && <MarkLabel x={mark.x} y={mark.y - 10} text={mark.label} />}
        </>
      );
    case "callout":
      return (
        <>
          <rect
            x={mark.x}
            y={mark.y}
            width={mark.width}
            height={mark.height}
            rx={8}
            fill={HALO_COLOR}
            fillOpacity={0.82}
            stroke={HALO_COLOR}
            strokeWidth={HALO_STROKE}
          />
          <rect
            x={mark.x}
            y={mark.y}
            width={mark.width}
            height={mark.height}
            rx={8}
            fill="none"
            stroke={COLORS.callout}
            strokeWidth={STROKE}
          />
          {mark.label && <MarkLabel x={cx} y={cy} text={mark.label} anchor="middle" />}
        </>
      );
    case "spotlight": {
      const r = Math.max(mark.width, mark.height) / 2 + 10;
      return (
        <>
          {/* Soft yellow wash so the target area itself lifts off the
            * background, then halo + bright ring. */}
          <circle cx={cx} cy={cy} r={r} fill={MARK_COLOR} fillOpacity={0.18} />
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={HALO_COLOR} strokeWidth={HALO_STROKE} />
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={COLORS.spotlight}
            strokeWidth={STROKE}
            strokeDasharray="10 6"
          />
        </>
      );
    }
    case "arrow": {
      // Points from just above-left of the target toward its top-left
      // corner — a plain, unambiguous "here" indicator.
      const tipX = mark.x;
      const tipY = mark.y;
      const tailX = mark.x - 40;
      const tailY = mark.y - 40;
      return (
        <>
          <line x1={tailX} y1={tailY} x2={tipX} y2={tipY} stroke={HALO_COLOR} strokeWidth={HALO_STROKE} />
          <line
            x1={tailX}
            y1={tailY}
            x2={tipX}
            y2={tipY}
            stroke={COLORS.arrow}
            strokeWidth={STROKE}
            markerEnd="url(#annotate-arrowhead)"
          />
          {mark.label && <MarkLabel x={tailX} y={tailY - 10} text={mark.label} />}
        </>
      );
    }
    default:
      return null;
  }
}

interface MarksPayload {
  /** null = every annotate window draws these marks. */
  monitor: number | null;
  marks: AnnotationMark[];
}

export function AnnotateApp() {
  const [marks, setMarks] = useState<AnnotationMark[]>([]);

  useEffect(() => {
    // Which monitor this window covers — injected by the Rust shell at
    // window creation, so it cannot be spoofed from page script.
    const myMonitor =
      typeof window !== "undefined" && typeof window.__BRIDGE_ANNOTATE_MONITOR__ === "number"
        ? window.__BRIDGE_ANNOTATE_MONITOR__
        : 0;
    const internals = typeof window !== "undefined" ? window.__TAURI_INTERNALS__ : undefined;
    tauriListen<MarksPayload>(MARKS_EVENT, (payload) => {
      const applied =
        payload && Array.isArray(payload.marks) &&
        (payload.monitor === null || payload.monitor === myMonitor)
          ? payload.marks
          : [];
      // A non-matching broadcast clears this window, so marks from an
      // earlier ask never linger on another display.
      setMarks(applied);
      // Two pings on purpose: the no-arg call uses the exact shape proven to
      // work at mount, so if only the counted one is missing the fault is
      // argument deserialization, not event delivery.
      void internals?.invoke("annotate_ready").catch(() => undefined);
      void internals?.invoke("annotate_ready", { rendered: applied.length }).catch(() => undefined);
    });
    // Readiness ping: proves this surface mounted (the window is fully
    // transparent when it has no marks, so there is no other visual tell).
    void internals?.invoke("annotate_ready").catch(() => undefined);
  }, []);

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "transparent",
        // The frame is a plain CSS border, not an SVG rect: SVG geometry
        // attributes do not reliably accept calc() in WebKit, so a
        // `width="calc(100% - 8px)"` rect silently computes to zero.
        border: marks.length > 0 ? `6px solid ${MARK_COLOR}` : "none",
        borderRadius: 10,
        boxSizing: "border-box",
        pointerEvents: "none",
      }}
    >
    <svg
      width="100%"
      height="100%"
      style={{ width: "100%", height: "100%", display: "block", background: "transparent" }}
    >
      <defs>
        <marker id="annotate-arrowhead" markerWidth={10} markerHeight={10} refX={8} refY={5} orient="auto">
          <path d="M0,0 L10,5 L0,10 Z" fill={COLORS.arrow} />
        </marker>
      </defs>
      {/* Entrance animation only (companion "pointing" feel): a short
        * fade-and-settle per mark, slightly staggered. Pure CSS on the typed
        * mark shapes — content and geometry stay entirely Rust-validated. */}
      {/* Marks must be visible with NO animation running. An entrance
        * animation with `backwards` fill holds opacity:0 during its delay,
        * so a webview that throttles animations (transparent, never-focused,
        * click-through window) leaves every mark permanently invisible.
        * Base state is therefore fully opaque; the pulse only ever touches
        * `transform`, so if it never runs the mark still reads correctly. */}
      <style>{`
        .annotate-mark {
          transform-box: fill-box;
          transform-origin: center;
        }
        .annotate-mark--spotlight {
          animation: annotate-pulse 2.4s ease-in-out infinite;
        }
        @keyframes annotate-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.06); }
        }
        @media (prefers-reduced-motion: reduce) {
          .annotate-mark--spotlight { animation: none; }
        }
      `}</style>
      {/* Screen-edge frame while any mark is showing: an unmistakable "the
        * companion is pointing at something" tell that does not depend on
        * the mark landing where you happen to be looking. */}
      {marks.map((mark, i) => (
        <g
          key={i}
          className={
            mark.kind === "spotlight"
              ? "annotate-mark annotate-mark--spotlight"
              : "annotate-mark"
          }
        >
          <MarkShape mark={mark} />
        </g>
      ))}
    </svg>
    </div>
  );
}
