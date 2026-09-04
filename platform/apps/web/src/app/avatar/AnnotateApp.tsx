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
import { AgentPointer, type PointerTarget } from "./AgentPointer";

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
const SCRIBBLE_EVENT = "annotate:scribble";

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

const DEFAULT_MARK_COLOR = "#FFD400";
const HALO_COLOR = "rgba(0,0,0,0.85)";
const STROKE = 4;
const HALO_STROKE = 9;

/** localStorage keys written by SettingsPage and read here. */
export const AVATAR_COLOR_KEY = "bridge:avatar:mark_color";
export const AVATAR_CURSOR_VISIBLE_KEY = "bridge:avatar:cursor_visible";

function readMarkColor() {
  try { return localStorage.getItem(AVATAR_COLOR_KEY) ?? DEFAULT_MARK_COLOR; } catch { return DEFAULT_MARK_COLOR; }
}
function readCursorVisible() {
  try { return localStorage.getItem(AVATAR_CURSOR_VISIBLE_KEY) !== "false"; } catch { return true; }
}

/** Label text with its own halo, so it reads over any window beneath it. */
function MarkLabel({ x, y, text, anchor, color }: { x: number; y: number; text: string; anchor?: "middle"; color: string }) {
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
      <text {...common} fill={color}>
        {text}
      </text>
    </>
  );
}

function MarkShape({ mark, color }: { mark: AnnotationMark; color: string }) {
  const cx = mark.x + mark.width / 2;
  const cy = mark.y + mark.height / 2;

  switch (mark.kind) {
    case "highlight":
      return (
        <>
          <rect x={mark.x} y={mark.y} width={mark.width} height={mark.height} rx={6} fill="none" stroke={HALO_COLOR} strokeWidth={HALO_STROKE} />
          <rect x={mark.x} y={mark.y} width={mark.width} height={mark.height} rx={6} fill={color} fillOpacity={0.12} stroke={color} strokeWidth={STROKE} />
          {mark.label && <MarkLabel x={mark.x} y={mark.y - 10} text={mark.label} color={color} />}
        </>
      );
    case "callout":
      return (
        <>
          <rect x={mark.x} y={mark.y} width={mark.width} height={mark.height} rx={8} fill={HALO_COLOR} fillOpacity={0.82} stroke={HALO_COLOR} strokeWidth={HALO_STROKE} />
          <rect x={mark.x} y={mark.y} width={mark.width} height={mark.height} rx={8} fill="none" stroke={color} strokeWidth={STROKE} />
          {mark.label && <MarkLabel x={cx} y={cy} text={mark.label} anchor="middle" color={color} />}
        </>
      );
    case "spotlight": {
      const r = Math.max(mark.width, mark.height) / 2 + 10;
      return (
        <>
          <circle cx={cx} cy={cy} r={r} fill={color} fillOpacity={0.18} />
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={HALO_COLOR} strokeWidth={HALO_STROKE} />
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={STROKE} strokeDasharray="10 6" />
        </>
      );
    }
    case "arrow": {
      const tipX = mark.x;
      const tipY = mark.y;
      const tailX = mark.x - 40;
      const tailY = mark.y - 40;
      return (
        <>
          <line x1={tailX} y1={tailY} x2={tipX} y2={tipY} stroke={HALO_COLOR} strokeWidth={HALO_STROKE} />
          <line x1={tailX} y1={tailY} x2={tipX} y2={tipY} stroke={color} strokeWidth={STROKE} markerEnd="url(#annotate-arrowhead)" />
          {mark.label && <MarkLabel x={tailX} y={tailY - 10} text={mark.label} color={color} />}
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

/** Live position of the chase game's fleeing pointer glyph (`chase.rs`) —
 * a plain, narrowly-typed number stream, not a mark: it updates ~25×/sec,
 * far faster than the typed-mark list is meant to churn, so it stays a
 * separate event rather than stretching `AnnotationMark` to cover motion. */
const POINTER_EVENT = "bridge:chase-pointer";

interface PointerPayload {
  monitor: number;
  x: number;
  y: number;
  active: boolean;
  /** One sample of a real-cursor glide (`act.rs`) — snap, don't fly. */
  stream?: boolean;
  /** A click just happened here — flash the click ring. */
  pressed?: boolean;
}

export function AnnotateApp() {
  const [marks, setMarks] = useState<AnnotationMark[]>([]);
  const [pointer, setPointer] = useState<PointerTarget | null>(null);
  /** Scribble mode: the window is interactive for one drag; the rectangle the
   * user draws is reported to Rust, which restores click-through. */
  const [scribble, setScribble] = useState(false);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [markColor, setMarkColor] = useState(readMarkColor);
  const [cursorVisible, setCursorVisible] = useState(readCursorVisible);

  useEffect(() => {
    // Pick up color/visibility changes written by SettingsPage in real-time.
    function onStorage(e: StorageEvent) {
      if (e.key === AVATAR_COLOR_KEY) setMarkColor(e.newValue ?? DEFAULT_MARK_COLOR);
      if (e.key === AVATAR_CURSOR_VISIBLE_KEY) setCursorVisible(e.newValue !== "false");
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

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
      setMarks(applied);
      // Auto-show pointer at first mark's centre so the cursor is always visible
      // when the companion places an annotation (not just during the chase game).
      if (applied.length > 0) {
        const m = applied[0];
        setPointer({ x: m.x + m.width / 2, y: m.y + m.height / 2 });
      } else {
        setPointer(null);
      }
      void internals?.invoke("annotate_ready").catch(() => undefined);
      void internals?.invoke("annotate_ready", { rendered: applied.length }).catch(() => undefined);
    });
    tauriListen<{ monitor: number; active: boolean }>(SCRIBBLE_EVENT, (payload) => {
      if (payload && payload.monitor === myMonitor) {
        setScribble(Boolean(payload.active));
        if (!payload.active) setDrag(null);
      }
    });
    tauriListen<PointerPayload>(POINTER_EVENT, (payload) => {
      setPointer(
        payload && payload.active && payload.monitor === myMonitor
          ? { x: payload.x, y: payload.y, stream: payload.stream, pressed: payload.pressed }
          : null,
      );
    });
    void internals?.invoke("annotate_ready").catch(() => undefined);
  }, []);

  const rect = drag && {
    x: Math.min(drag.x0, drag.x1),
    y: Math.min(drag.y0, drag.y1),
    width: Math.abs(drag.x1 - drag.x0),
    height: Math.abs(drag.y1 - drag.y0),
  };
  const internals = typeof window !== "undefined" ? window.__TAURI_INTERNALS__ : undefined;

  return (
    <div
      aria-hidden={!scribble}
      role={scribble ? "application" : undefined}
      aria-label={scribble ? "Draw a rectangle around the area to focus on" : undefined}
      onPointerDown={scribble ? (e) => setDrag({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY }) : undefined}
      onPointerMove={scribble && drag ? (e) => setDrag({ ...drag, x1: e.clientX, y1: e.clientY }) : undefined}
      onPointerUp={
        scribble && rect
          ? () => {
              setDrag(null);
              void internals?.invoke("annotate_scribble_done", { region: { monitor: 0, ...rect } }).catch(() => undefined);
            }
          : undefined
      }
      style={{
        position: "fixed",
        inset: 0,
        background: scribble ? "rgba(0,0,0,0.12)" : "transparent",
        border: cursorVisible && (marks.length > 0 || scribble) ? `6px solid ${markColor}` : "none",
        borderRadius: 10,
        boxSizing: "border-box",
        pointerEvents: scribble ? "auto" : "none",
        cursor: scribble ? "crosshair" : undefined,
        touchAction: "none",
      }}
    >
    <svg
      width="100%"
      height="100%"
      style={{ width: "100%", height: "100%", display: "block", background: "transparent" }}
    >
      <defs>
        <marker id="annotate-arrowhead" markerWidth={10} markerHeight={10} refX={8} refY={5} orient="auto">
          <path d="M0,0 L10,5 L0,10 Z" fill={markColor} />
        </marker>
      </defs>
      <style>{`
        .annotate-mark { transform-box: fill-box; transform-origin: center; }
        .annotate-mark--spotlight { animation: annotate-pulse 2.4s ease-in-out infinite; }
        @keyframes annotate-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }
        @media (prefers-reduced-motion: reduce) { .annotate-mark--spotlight { animation: none; } }
      `}</style>
      {cursorVisible && marks.map((mark, i) => (
        <g key={i} className={mark.kind === "spotlight" ? "annotate-mark annotate-mark--spotlight" : "annotate-mark"}>
          <MarkShape mark={mark} color={markColor} />
        </g>
      ))}
      {rect && (
        <>
          <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx={6} fill="none" stroke={HALO_COLOR} strokeWidth={HALO_STROKE} />
          <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx={6} fill={markColor} fillOpacity={0.1} stroke={markColor} strokeWidth={STROKE} strokeDasharray="10 6" />
        </>
      )}
      {scribble && !rect && (
        <MarkLabel x={24} y={40} text="Drag to circle the area you mean — Esc to cancel" color={markColor} />
      )}
      {cursorVisible && <AgentPointer target={pointer} color={markColor} />}
    </svg>
    </div>
  );
}
