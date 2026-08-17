/**
 * Zazoo World — the Zazoo Module's view is a place, not a table: a 2.5D
 * isometric room you can look into, with the live ZazooAvatar rig standing
 * in it.
 *
 * No game engine, no tileset. Isometric is a projection, not a renderer:
 * `iso()` below maps grid units to screen, `Box` draws a cuboid as its three
 * visible faces, and every prop in both rooms is composed from that one
 * helper. Painter's order is document order, so there is no depth sort.
 *
 * The desk computer's screen is deliberately NOT drawn in the SVG — it is a
 * camera-facing rect in the scene and a plain positioned DOM layer on top,
 * so its four apps (browser / files / terminal / chat) stay real HTML.
 * They render honest empty states; nothing here fabricates content.
 */
import { useEffect, useMemo, useState } from "react";
import { ZazooAvatar, DEFAULT_APPEARANCE } from "./ZazooAvatar";
import { ZazooDirector } from "./director";
import { SPECIES, DEFAULT_SPECIES, type ZazooSpecies } from "./species";

/* ── projection ─────────────────────────────────────────────────────── */

const TW = 56; // half tile width in px
const TH = 28; // half tile height (2:1 iso)
const OX = 480;
const OY = 196;

/** Grid unit -> screen px. `h` lifts off the floor. */
function iso(x: number, y: number, h = 0) {
  return [OX + (x - y) * TW, OY + (x + y) * TH - h * TH * 2] as const;
}

const pts = (...p: readonly (readonly [number, number])[]) => p.map(([x, y]) => `${x},${y}`).join(" ");

/** Darken a hex by `f` (0..1) — the only shading model in the scene. */
function shade(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * (1 - f)));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** An isometric cuboid at grid (x,y), size (w,d,h), as its three lit faces. */
function Box({ x, y, w, d, h, color, z = 0 }: { x: number; y: number; w: number; d: number; h: number; color: string; z?: number }) {
  const t = (gx: number, gy: number) => iso(gx, gy, z + h);
  const b = (gx: number, gy: number) => iso(gx, gy, z);
  const A = t(x, y), B = t(x + w, y), C = t(x + w, y + d), D = t(x, y + d);
  const cb = b(x + w, y + d), db = b(x, y + d), bb = b(x + w, y);
  return (
    <g>
      <polygon points={pts(D, C, cb, db)} fill={shade(color, 0.16)} />
      <polygon points={pts(B, C, cb, bb)} fill={shade(color, 0.3)} />
      <polygon points={pts(A, B, C, D)} fill={color} />
    </g>
  );
}

/** Flat quad lying on the floor — rugs, mats, screen glow. */
function Tile({ x, y, w, d, color, opacity = 1 }: { x: number; y: number; w: number; d: number; color: string; opacity?: number }) {
  return <polygon points={pts(iso(x, y), iso(x + w, y), iso(x + w, y + d), iso(x, y + d))} fill={color} opacity={opacity} />;
}

/* ── the room shell ─────────────────────────────────────────────────── */

const ROOM = 7; // grid units square

function Shell({ floor, wall }: { floor: string; wall: string }) {
  const WALL_H = 3.4;
  const bl = [iso(0, 0, WALL_H), iso(0, ROOM, WALL_H), iso(0, ROOM), iso(0, 0)] as const;
  const br = [iso(0, 0, WALL_H), iso(ROOM, 0, WALL_H), iso(ROOM, 0), iso(0, 0)] as const;
  return (
    <g>
      <polygon points={pts(...bl)} fill={shade(wall, 0.14)} />
      <polygon points={pts(...br)} fill={wall} />
      <Tile x={0} y={0} w={ROOM} d={ROOM} color={floor} />
      {/* floorboard seams — the only texture in the room */}
      {Array.from({ length: ROOM - 1 }, (_, i) => (
        <line key={i} x1={iso(i + 1, 0)[0]} y1={iso(i + 1, 0)[1]} x2={iso(i + 1, ROOM)[0]} y2={iso(i + 1, ROOM)[1]} stroke={shade(floor, 0.08)} strokeWidth={1.5} />
      ))}
    </g>
  );
}

/** Soft contact shadow under a standing Zazoo. */
function Shadow({ x, y }: { x: number; y: number }) {
  const [cx, cy] = iso(x, y);
  return <ellipse cx={cx} cy={cy} rx={38} ry={19} fill="#000" opacity={0.13} />;
}

/* ── office props ───────────────────────────────────────────────────── */

const DESK = { x: 1.1, y: 0.5 };
/** Screen rect in stage px — the SVG bezel and the DOM app layer share it. */
const SCREEN = { w: 208, h: 132 };
function screenOrigin() {
  const [sx, sy] = iso(DESK.x + 1.35, DESK.y + 0.95, 1.14);
  return [sx - SCREEN.w / 2, sy - SCREEN.h] as const;
}

function Office() {
  const [mx, my] = screenOrigin();
  return (
    <g>
      <Shell floor="#C9A87C" wall="#EDE0CE" />
      <Tile x={0.6} y={0.2} w={3.2} d={2.4} color="#000" opacity={0.05} />
      {/* desk: top slab on two legs */}
      <Box x={DESK.x} y={DESK.y} w={0.28} d={1.9} h={1} color="#8E6A47" />
      <Box x={DESK.x + 1.9} y={DESK.y} w={0.28} d={1.9} h={1} color="#8E6A47" />
      <Box x={DESK.x - 0.15} y={DESK.y - 0.15} w={2.5} d={2.2} h={0.14} color="#B98A5E" z={1} />
      {/* computer: stand + bezel; the lit screen is DOM, drawn over this */}
      <Box x={DESK.x + 0.95} y={DESK.y + 0.45} w={0.3} d={0.3} h={0.18} color="#3A3F47" z={1.14} />
      <rect x={mx - 9} y={my - 9} width={SCREEN.w + 18} height={SCREEN.h + 18} rx={12} fill="#2E333B" />
      {/* chair: seat + back */}
      <Box x={DESK.x + 1.25} y={DESK.y + 2.3} w={0.95} d={0.95} h={0.55} color="#C25E4B" />
      <Box x={DESK.x + 1.25} y={DESK.y + 3.15} w={0.95} d={0.16} h={0.75} color="#A94B3B" z={0.55} />
      {/* plant in the corner */}
      <Box x={5.7} y={0.5} w={0.55} d={0.55} h={0.5} color="#B9704F" />
      <ellipse cx={iso(5.98, 0.78, 0.5)[0]} cy={iso(5.98, 0.78, 0.5)[1] - 26} rx={30} ry={34} fill="#6E9E63" />
    </g>
  );
}

/* ── home props ─────────────────────────────────────────────────────── */

function Home() {
  const [nx, ny] = iso(4.6, 3.5, 0.3);
  return (
    <g>
      <Shell floor="#D8B98E" wall="#F3E3E6" />
      {/* bed: frame, mattress, pillow */}
      <Box x={0.8} y={0.6} w={2.2} d={3} h={0.42} color="#9B7250" />
      <Box x={0.8} y={0.6} w={2.2} d={3} h={0.3} color="#F2ECE2" z={0.42} />
      <Box x={0.95} y={0.75} w={1.9} d={0.85} h={0.22} color="#E7B9C2" z={0.72} />
      <Box x={0.8} y={0.6} w={2.2} d={0.18} h={0.95} color="#8A6244" z={0.42} />
      {/* nest: woven basket + cushion */}
      <ellipse cx={nx} cy={ny + 14} rx={62} ry={31} fill="#000" opacity={0.1} />
      <ellipse cx={nx} cy={ny} rx={62} ry={31} fill="#C79A63" />
      <ellipse cx={nx} cy={ny - 6} rx={50} ry={24} fill="#E5C79A" />
      <ellipse cx={nx} cy={ny - 4} rx={40} ry={19} fill="#D9A6AE" />
      {/* rug + lamp */}
      <Tile x={4.1} y={0.6} w={2.1} d={1.8} color="#CFA9A2" opacity={0.75} />
      <Box x={5.8} y={0.6} w={0.22} d={0.22} h={1.6} color="#8A8F98" />
      <ellipse cx={iso(5.91, 0.71, 1.6)[0]} cy={iso(5.91, 0.71, 1.6)[1] - 12} rx={30} ry={20} fill="#F5D98E" />
    </g>
  );
}

/* ── the desk computer's four apps ──────────────────────────────────── */

const APPS = ["browser", "files", "terminal", "chat"] as const;
type App = (typeof APPS)[number];

const scr: Record<string, React.CSSProperties> = {
  chrome: { display: "flex", gap: 3, padding: "5px 6px", background: "#20242B", flexShrink: 0 },
  tab: { flex: 1, fontSize: 8, lineHeight: "13px", textAlign: "center", borderRadius: 4, cursor: "pointer", textTransform: "capitalize" },
  body: { flex: 1, display: "flex", fontSize: 8.5, color: "#8E97A6", overflow: "hidden" },
  empty: { margin: "auto", textAlign: "center", lineHeight: 1.6, opacity: 0.75, padding: 8 },
  bar: { height: 13, background: "#252A33", borderBottom: "1px solid #171A20", display: "flex", alignItems: "center", padding: "0 6px", fontSize: 7.5, color: "#6E7787", gap: 4 },
  side: { width: 62, background: "#20242B", borderRight: "1px solid #171A20", flexShrink: 0 },
};

/** Every app renders an honest empty state — this surface invents nothing. */
function Screen() {
  const [app, setApp] = useState<App>("browser");
  const [x, y] = screenOrigin();
  const empty: Record<App, string> = {
    browser: "No page open",
    files: "No files indexed",
    terminal: "No session",
    chat: "No messages yet",
  };
  return (
    <div style={{ position: "absolute", left: x, top: y, width: SCREEN.w, height: SCREEN.h, borderRadius: 5, overflow: "hidden", background: "#171A20", display: "flex", flexDirection: "column", fontFamily: "ui-monospace, SFMono-Regular, monospace", boxShadow: "0 0 26px rgba(150,200,255,0.16)" }}>
      <div style={scr.chrome}>
        {APPS.map((a) => (
          <div key={a} onClick={() => setApp(a)} style={{ ...scr.tab, background: a === app ? "#39414E" : "transparent", color: a === app ? "#DCE3ED" : "#69727F" }}>
            {a}
          </div>
        ))}
      </div>
      {app === "browser" && <div style={scr.bar}>◀ ▶ ⟳ <span style={{ flex: 1, background: "#171A20", borderRadius: 6, padding: "1px 5px" }}>about:blank</span></div>}
      {app === "terminal" && <div style={scr.bar}>zsh — zazoo</div>}
      <div style={scr.body}>
        {app === "files" && <div style={scr.side} />}
        <div style={scr.empty}>{empty[app]}</div>
      </div>
    </div>
  );
}

/* ── the view ───────────────────────────────────────────────────────── */

const STAGE = { w: 960, h: 660 };

/**
 * A pose is where the Zazoo stands, how big it reads, which way it faces and
 * what the director is performing — all four together, because they only
 * ever change together.
 */
export const POSES = {
  idle: { room: "office", label: "Idle", x: 5.4, y: 4.6, h: 0, w: 190, facing: "front", emotion: "curious" },
  working: { room: "office", label: "Working", x: 2.8, y: 3.35, h: 0.5, w: 165, facing: "back", emotion: "thinking" },
  home: { room: "home", label: "Idle", x: 3.8, y: 5.2, h: 0, w: 190, facing: "front", emotion: "calm" },
  sleeping: { room: "home", label: "Sleeping", x: 4.6, y: 3.5, h: 0.42, w: 150, facing: "front", emotion: "sleepy" },
} as const;
export type PoseKey = keyof typeof POSES;

export const ROOMS = {
  office: { label: "Office", poses: ["idle", "working"] as PoseKey[] },
  home: { label: "Home", poses: ["home", "sleeping"] as PoseKey[] },
};
export type Room = keyof typeof ROOMS;

/**
 * The room itself, at any size. The scene is authored once at STAGE and then
 * CSS-scaled as a whole, so the SVG props, the DOM screen layer and the DOM
 * avatar can never drift apart at a smaller size — there is only one set of
 * coordinates to be right about.
 */
export function ZazooRoom({
  pose,
  species = DEFAULT_SPECIES,
  scale = 1,
}: {
  pose: PoseKey;
  species?: ZazooSpecies;
  scale?: number;
}) {
  const p = POSES[pose];
  const director = useMemo(() => new ZazooDirector(), []);
  useEffect(() => {
    director.perform({ emotion: p.emotion, attention: p.facing === "back" ? "away" : "user" });
  }, [director, p.emotion, p.facing]);

  const [zx, zy] = iso(p.x, p.y, p.h);

  return (
    <div style={{ width: STAGE.w * scale, height: STAGE.h * scale, overflow: "hidden" }}>
      <div style={{ position: "relative", width: STAGE.w, height: STAGE.h, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        <svg width={STAGE.w} height={STAGE.h} viewBox={`0 0 ${STAGE.w} ${STAGE.h}`}>
          {p.room === "office" ? <Office /> : <Home />}
          {p.h === 0 && <Shadow x={p.x} y={p.y} />}
        </svg>
        {p.room === "office" && <Screen />}
        <div style={{ position: "absolute", left: zx - p.w / 2, top: zy - p.w, width: p.w, pointerEvents: "none" }}>
          {/* a species' own felt is its default swatch, not the panda's cream */}
          <ZazooAvatar director={director} width={p.w} appearance={{ ...DEFAULT_APPEARANCE, body: species.body }} species={species} facing={p.facing} />
        </div>
        {/* the nest's near rim, redrawn over the sleeper so she sits IN it */}
        {pose === "sleeping" && (
          <svg width={STAGE.w} height={STAGE.h} viewBox={`0 0 ${STAGE.w} ${STAGE.h}`} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            <path d={`M ${iso(4.6, 3.5, 0.3)[0] - 62},${iso(4.6, 3.5, 0.3)[1]} a 62 31 0 0 0 124 0 Z`} fill="#C79A63" />
          </svg>
        )}
      </div>
    </div>
  );
}

function pill(active: boolean): React.CSSProperties {
  return {
    padding: "8px 20px", borderRadius: 999, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
    border: "1px solid " + (active ? "#C25E4B" : "rgba(0,0,0,0.14)"),
    background: active ? "#C25E4B" : "#FFF", color: active ? "#FFF" : "#4A423A",
  };
}

export function ZazooWorld() {
  const [room, setRoom] = useState<Room>("office");
  const [pose, setPose] = useState<PoseKey>("idle");
  const [species, setSpecies] = useState<ZazooSpecies>(DEFAULT_SPECIES);
  const pickRoom = (r: Room) => { setRoom(r); setPose(ROOMS[r].poses[0]); };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, background: "#EFE7DA", fontFamily: "'Avenir Next', 'Segoe UI', system-ui, sans-serif" }}>
      <ZazooRoom pose={pose} species={species} />

      <div style={{ display: "flex", gap: 8 }}>
        {(Object.keys(ROOMS) as Room[]).map((r) => (
          <button key={r} onClick={() => pickRoom(r)} style={pill(r === room)}>{ROOMS[r].label}</button>
        ))}
        <span style={{ width: 1, background: "rgba(0,0,0,0.12)", margin: "0 6px" }} />
        {ROOMS[room].poses.map((k) => (
          <button key={k} onClick={() => setPose(k)} style={pill(k === pose)}>{POSES[k].label}</button>
        ))}
      </div>

      {/* every species rides the same painted baseline — swap and see */}
      <select
        value={species.id}
        onChange={(e) => setSpecies(SPECIES.find((s) => s.id === e.target.value)!)}
        style={{ padding: "8px 12px", borderRadius: 10, fontSize: 13, fontFamily: "inherit", border: "1px solid rgba(0,0,0,0.14)", background: "#FFF", color: "#4A423A" }}
      >
        {SPECIES.map((s) => (
          <option key={s.id} value={s.id}>{s.name} — {s.kind}</option>
        ))}
      </select>
    </div>
  );
}
