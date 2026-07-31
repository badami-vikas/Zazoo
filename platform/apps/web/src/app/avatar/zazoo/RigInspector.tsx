/**
 * Rig Inspector — the measuring surface for the Zazoo rig.
 *
 * Every anchor in ZazooAvatar's RIG is expressed in viewBox units (240×310),
 * and every one of them was originally measured off the painted source art.
 * This wraps the live avatar in that same coordinate space so the two can be
 * compared directly instead of by eye:
 *
 *   GRID       the viewBox lattice itself — minor every 5 units, major and
 *              labelled every 20, so any feature can be read off in the units
 *              the rig is actually written in
 *   ZOOM/PAN   scroll or use the controls; pins and rules counter-scale so the
 *              overlay stays hairline-thin at 8× instead of turning into slabs
 *   REFERENCE  the source composite ghosted over the live rig at the exact
 *              registration the art was authored at — drift shows up as a
 *              double edge, which is far more honest than a side-by-side
 *   PINS       click anywhere to drop a numbered pin at those coordinates and
 *              type a note. "the mouth is 2 units low" beats "the mouth looks
 *              a bit low", and the notes copy out as plain text.
 *
 * Dev/design tool. Nothing here ships into a product surface.
 */
import { useRef, useState, type ReactNode } from "react";
import referenceUrl from "./assets/reference-front.webp";

/** viewBox coordinate space shared with ZazooAvatar. */
export const VB = { w: 240, h: 310 } as const;

/**
 * Where the source art's 3840² registration canvas lands in viewBox units.
 * Derived from the body silhouette's bbox in both spaces, so the overlay sits
 * exactly where the painted layers were registered — never nudged by hand.
 */
const REF_BOX = { x: 6.82, y: 59.56, w: 245.95, h: 246.06 } as const;

export interface RigPin {
  id: number;
  x: number;
  y: number;
  note: string;
}

interface Props {
  width: number;
  /** Inspect mode: drag pans, click drops a pin, petting is suspended. */
  active: boolean;
  zoom: number;
  onZoom: (z: number) => void;
  showGrid: boolean;
  /** 0 = hidden, 1 = fully opaque source art over the rig. */
  referenceOpacity: number;
  pins: RigPin[];
  onAddPin: (x: number, y: number) => void;
  /** Live cursor position in viewBox units, for the readout. */
  onProbe: (p: { x: number; y: number } | null) => void;
  children: ReactNode;
}

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 8;

export function RigInspector({
  width, active, zoom, onZoom, showGrid, referenceOpacity, pins, onAddPin, onProbe, children,
}: Props) {
  const height = (width * VB.h) / VB.w;
  const contentRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  /** Client pixels → viewBox units, read off the transformed content itself
   *  so it stays correct at any zoom or pan without re-deriving the matrix. */
  const toVB = (clientX: number, clientY: number) => {
    const el = contentRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * VB.w, y: ((clientY - r.top) / r.height) * VB.h };
  };

  const onPointerDown = (ev: React.PointerEvent) => {
    if (!active) return;
    drag.current = { x: ev.clientX, y: ev.clientY, moved: false };
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
  };

  const onPointerMove = (ev: React.PointerEvent) => {
    const p = toVB(ev.clientX, ev.clientY);
    if (active) onProbe(p);
    const d = drag.current;
    if (!d) return;
    const dx = ev.clientX - d.x, dy = ev.clientY - d.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true;
    // pan in unscaled units so dragging tracks the cursor 1:1 on screen
    setPan((q) => ({ x: q.x + dx / zoom, y: q.y + dy / zoom }));
    drag.current = { x: ev.clientX, y: ev.clientY, moved: d.moved };
  };

  const onPointerUp = (ev: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!active || !d || d.moved) return;
    const p = toVB(ev.clientX, ev.clientY);
    if (p) onAddPin(Number(p.x.toFixed(2)), Number(p.y.toFixed(2)));
  };

  const onWheel = (ev: React.WheelEvent) => {
    if (!active) return;
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * (ev.deltaY < 0 ? 1.12 : 1 / 1.12)));
    onZoom(Number(next.toFixed(3)));
  };

  // overlay strokes and pin glyphs are authored in viewBox units, so they must
  // be divided by the zoom to stay a constant thickness on screen
  const k = 1 / zoom;

  return (
    <div
      style={{ width, height, overflow: "hidden", position: "relative", touchAction: "none", cursor: active ? "crosshair" : "grab" }}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => { drag.current = null; onProbe(null); }}
    >
      <div
        ref={contentRef}
        style={{
          width, height, position: "absolute", top: 0, left: 0,
          transformOrigin: "center center",
          transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`,
        }}
      >
        {children}

        {(showGrid || referenceOpacity > 0 || pins.length > 0) && (
          <svg
            viewBox={`0 0 ${VB.w} ${VB.h}`} width={width} height={height}
            style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none", overflow: "visible" }}
          >
            {referenceOpacity > 0 && (
              <image
                href={referenceUrl} x={REF_BOX.x} y={REF_BOX.y} width={REF_BOX.w} height={REF_BOX.h}
                opacity={referenceOpacity}
              />
            )}

            {showGrid && (
              <g>
                {gridLines(5).map((v, i) => (
                  <line key={`n${i}`} {...v} stroke="#7FD4FF" strokeOpacity="0.16" strokeWidth={0.35 * k} />
                ))}
                {gridLines(20).map((v, i) => (
                  <line key={`m${i}`} {...v} stroke="#7FD4FF" strokeOpacity="0.42" strokeWidth={0.6 * k} />
                ))}
                {/* the vertical centreline — the mirror axis every paired
                    anchor in RIG is defined against */}
                <line x1={VB.w / 2} y1={0} x2={VB.w / 2} y2={VB.h} stroke="#FF9E6B" strokeOpacity="0.7" strokeWidth={0.6 * k} />
                {range(20, VB.w).map((x) => (
                  <text key={`lx${x}`} x={x + 1 * k} y={9 * k} fill="#7FD4FF" fillOpacity="0.7" fontSize={5 * k} fontFamily="ui-monospace, monospace">{x}</text>
                ))}
                {range(20, VB.h).map((y) => (
                  <text key={`ly${y}`} x={1 * k} y={y - 1 * k} fill="#7FD4FF" fillOpacity="0.7" fontSize={5 * k} fontFamily="ui-monospace, monospace">{y}</text>
                ))}
              </g>
            )}

            {pins.map((p, i) => (
              <g key={p.id}>
                <circle cx={p.x} cy={p.y} r={1.2 * k} fill="#FF5C5C" />
                <circle cx={p.x} cy={p.y} r={4 * k} fill="none" stroke="#FF5C5C" strokeWidth={0.6 * k} />
                <text
                  x={p.x + 5.5 * k} y={p.y + 2 * k} fill="#FF9E9E" fontSize={6 * k}
                  fontFamily="ui-monospace, monospace" style={{ paintOrder: "stroke" }}
                  stroke="#12100E" strokeWidth={1.6 * k}
                >
                  {i + 1}
                </text>
              </g>
            ))}
          </svg>
        )}
      </div>
    </div>
  );
}

function range(step: number, max: number): number[] {
  const out: number[] = [];
  for (let v = step; v < max; v += step) out.push(v);
  return out;
}

function gridLines(step: number) {
  const out: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let x = step; x < VB.w; x += step) out.push({ x1: x, y1: 0, x2: x, y2: VB.h });
  for (let y = step; y < VB.h; y += step) out.push({ x1: 0, y1: y, x2: VB.w, y2: y });
  return out;
}
