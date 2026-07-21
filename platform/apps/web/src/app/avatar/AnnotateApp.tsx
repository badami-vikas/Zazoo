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

const MARKS_EVENT = "annotate.marks";

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

const COLORS = {
  highlight: "var(--color-navy, #1e3a5f)",
  arrow: "var(--color-navy, #1e3a5f)",
  callout: "var(--color-navy, #1e3a5f)",
  spotlight: "var(--color-navy, #1e3a5f)",
} as const;

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
            stroke={COLORS.highlight}
            strokeWidth={3}
          />
          {mark.label && (
            <text x={mark.x} y={mark.y - 8} fontSize={13} fill={COLORS.highlight}>
              {mark.label}
            </text>
          )}
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
            fill={COLORS.callout}
            fillOpacity={0.12}
            stroke={COLORS.callout}
            strokeWidth={2}
          />
          {mark.label && (
            <text
              x={cx}
              y={cy}
              fontSize={13}
              fill={COLORS.callout}
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {mark.label}
            </text>
          )}
        </>
      );
    case "spotlight":
      return (
        <circle
          cx={cx}
          cy={cy}
          r={Math.max(mark.width, mark.height) / 2 + 8}
          fill="none"
          stroke={COLORS.spotlight}
          strokeWidth={3}
          strokeDasharray="6 4"
        />
      );
    case "arrow": {
      // Points from just above-left of the target toward its top-left
      // corner — a plain, unambiguous "here" indicator.
      const tipX = mark.x;
      const tipY = mark.y;
      const tailX = mark.x - 40;
      const tailY = mark.y - 40;
      return (
        <>
          <line x1={tailX} y1={tailY} x2={tipX} y2={tipY} stroke={COLORS.arrow} strokeWidth={3} markerEnd="url(#annotate-arrowhead)" />
          {mark.label && (
            <text x={tailX} y={tailY - 8} fontSize={13} fill={COLORS.arrow}>
              {mark.label}
            </text>
          )}
        </>
      );
    }
    default:
      return null;
  }
}

export function AnnotateApp() {
  const [marks, setMarks] = useState<AnnotationMark[]>([]);

  useEffect(() => {
    tauriListen<AnnotationMark[]>(MARKS_EVENT, (payload) => {
      setMarks(Array.isArray(payload) ? payload : []);
    });
  }, []);

  return (
    <svg
      width="100vw"
      height="100vh"
      style={{ width: "100vw", height: "100vh", display: "block", background: "transparent" }}
      aria-hidden="true"
    >
      <defs>
        <marker id="annotate-arrowhead" markerWidth={10} markerHeight={10} refX={8} refY={5} orient="auto">
          <path d="M0,0 L10,5 L0,10 Z" fill={COLORS.arrow} />
        </marker>
      </defs>
      {marks.map((mark, i) => (
        <MarkShape key={i} mark={mark} />
      ))}
    </svg>
  );
}
