/**
 * AgentPointer — the companion's on-screen hand, drawn by the click-through
 * annotate window: a proper arrow mouse pointer (not a ring), tinted in the
 * avatar's mark colour with a white outline so it reads as "Zazoo's cursor"
 * even when it sits on top of the user's real one.
 *
 * Motion is the clicky-family flight arc, re-derived: a quadratic Bézier
 * bowed to one side, run on a smoothstep clock (3t²−2t³), duration scaled
 * with distance and clamped, the glyph turning to face its travel direction
 * and puffing up slightly mid-flight. Two input modes:
 *  - a jump (`stream` absent): the pointer FLIES to the new target;
 *  - a stream (`stream: true`, the actuator gliding the real cursor ~60×/s):
 *    the glyph snaps to each sample, mirroring the real pointer exactly.
 * `pressed` flashes a click ring.
 *
 * The arrow polygon is authored here (tip at the origin, 7 vertices in the
 * proportions of a standard desktop pointer) — no cursor asset is shipped.
 */
import { useEffect, useRef, useState } from "react";

export interface PointerTarget {
  x: number;
  y: number;
  stream?: boolean;
  pressed?: boolean;
}

/** Tip at (0,0); ~24 px tall at scale 1. */
export const ARROW_PATH = "M0 0 L0 17.5 L4.6 13.6 L7.9 20.9 L11.3 19.4 L8.1 12.3 L14 12.3 Z";
const SCALE = 1.6;

export function smoothstep(t: number) {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

export function flightDurationMs(distance: number) {
  return Math.min(1100, Math.max(350, (distance / 900) * 1000));
}

/** Point and heading (radians) along the bowed Bézier at eased time `t`. */
export function flightSample(from: PointerTarget, to: PointerTarget, t: number) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const bow = Math.min(120, distance * 0.18);
  const px = distance > 0 ? (-dy / distance) * bow : 0;
  const py = distance > 0 ? (dx / distance) * bow : 0;
  const cx = (from.x + to.x) / 2 + px;
  const cy = (from.y + to.y) / 2 + py;
  const e = smoothstep(t);
  const u = 1 - e;
  const x = u * u * from.x + 2 * u * e * cx + e * e * to.x;
  const y = u * u * from.y + 2 * u * e * cy + e * e * to.y;
  // Tangent of the quadratic Bézier.
  const tx = 2 * u * (cx - from.x) + 2 * e * (to.x - cx);
  const ty = 2 * u * (cy - from.y) + 2 * e * (to.y - cy);
  return { x, y, heading: Math.atan2(ty, tx) };
}

export function AgentPointer({ target, color }: { target: PointerTarget | null; color: string }) {
  const [pose, setPose] = useState<{ x: number; y: number; angle: number; scale: number } | null>(null);
  const [clickRing, setClickRing] = useState(0);
  const poseRef = useRef(pose);
  poseRef.current = pose;
  const frameRef = useRef(0);

  useEffect(() => {
    window.clearInterval(frameRef.current);
    if (!target) {
      setPose(null);
      return;
    }
    if (target.pressed) setClickRing((n) => n + 1);
    const from = poseRef.current;
    const reduced =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!from || target.stream || reduced) {
      setPose({ x: target.x, y: target.y, angle: 0, scale: 1 });
      return;
    }
    const distance = Math.hypot(target.x - from.x, target.y - from.y);
    if (distance < 2) return;
    const duration = flightDurationMs(distance);
    const started = performance.now();
    const origin = { x: from.x, y: from.y };
    // A timer, not requestAnimationFrame: the annotate window is a
    // transparent, never-focused, click-through webview, and WebKit throttles
    // rAF there (the same trap that once kept marks invisible — BUGS
    // 2026-07-29). Whatever the tick rate ends up being, the last tick always
    // lands exactly on the target, so a throttled flight degrades to a late
    // arrival rather than a glyph stuck mid-air.
    const tick = () => {
      const t = Math.min(1, (performance.now() - started) / duration);
      const s = flightSample(origin, target, t);
      // Rest angle is 0 (upright). Mid-flight the arrow leans into its
      // travel direction and puffs up, settling back as it lands.
      const lean = Math.sin(t * Math.PI);
      const angle = lean * 14 * (Math.sign(target.x - origin.x) || 1);
      setPose({ x: s.x, y: s.y, angle, scale: 1 + 0.3 * lean });
      if (t >= 1) window.clearInterval(frameRef.current);
    };
    frameRef.current = window.setInterval(tick, 16);
    return () => window.clearInterval(frameRef.current);
  }, [target]);

  if (!pose) return null;
  return (
    <g transform={`translate(${pose.x} ${pose.y})`} data-testid="agent-pointer">
      {clickRing > 0 && (
        <circle key={clickRing} className="agent-pointer-click" cx={0} cy={0} r={18} fill="none" stroke={color} strokeWidth={4} />
      )}
      <g transform={`rotate(${pose.angle}) scale(${pose.scale * SCALE})`}>
        <path d={ARROW_PATH} fill={color} stroke="white" strokeWidth={1.6} strokeLinejoin="round" />
        <path d={ARROW_PATH} fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth={0.5} strokeLinejoin="round" />
      </g>
      <style>{`
        .agent-pointer-click { animation: agent-pointer-click 420ms ease-out forwards; transform-box: fill-box; transform-origin: center; }
        @keyframes agent-pointer-click { from { opacity: 0.9; transform: scale(0.4); } to { opacity: 0; transform: scale(1.4); } }
      `}</style>
    </g>
  );
}
