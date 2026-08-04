/**
 * Zazoo Lab — standalone performance-testing surface for the companion.
 * Drives the ZazooDirector through the same Performance contract the agent
 * plane will use, plus: poses (meditate/sneak/hide), the MacBook-notch peek
 * demo, and wardrobe (dress-up + cat color). Dev/design tool, not a product
 * surface.
 */
import { useMemo, useRef, useState } from "react";
import { ZazooAvatar, DEFAULT_APPEARANCE, type ZazooAppearance } from "./ZazooAvatar";
import { ZazooDirector, ZAZOO_EMOTIONS, ZAZOO_ACTIONS, type ZazooEmotion, type ZazooAction } from "./director";
import { RigInspector, ZOOM_MAX, ZOOM_MIN } from "./RigInspector";
import { SPECIES, DEFAULT_SPECIES, type ZazooSpecies } from "./species";

/** Named rig layers the inspector can outline (via data-layer attributes). */
const LAYERS = ["body", "ears", "eyes", "brows", "nose", "mouth", "cheeks", "whiskers", "suit", "tie", "paws", "tail", "shadow"];

const BODY_COLORS = ["#FAF1E7", "#F0DFC2", "#D8DCE4", "#CFE0D2", "#F2C9B0", "#D6CBEB"];
// Tints are screened over the painted charcoal fabric, so a swatch is the
// colour the cloth reads as; the near-black one is the source art untinted.
const SUIT_COLORS = ["#7E2732", "#15151A", "#3E5A7E", "#4A4E5A", "#7E937E", "#2F4A44"];
const TIE_COLORS = ["#E8B93C", "#B8323C", "#2E5E8C", "#D9D5CC", "#4F7F5A"];
const ACCESSORIES = ["tie", "bowtie", "scarf", "none"] as const;

const S: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh", display: "flex", alignItems: "stretch",
    background: "radial-gradient(1200px 700px at 50% 20%, #2A2620 0%, #1C1915 60%, #14120F 100%)",
    color: "#EFE6D6", fontFamily: "'Avenir Next', 'Segoe UI', system-ui, sans-serif",
  },
  stage: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, position: "relative" },
  panel: {
    width: 330, padding: "24px 22px", background: "rgba(255,250,240,0.04)",
    borderLeft: "1px solid rgba(255,250,240,0.08)", display: "flex", flexDirection: "column", gap: 16, overflowY: "auto", maxHeight: "100vh",
  },
  h1: { fontSize: 21, fontWeight: 600, margin: 0, letterSpacing: 0.3 },
  sub: { fontSize: 12, opacity: 0.55, lineHeight: 1.5, margin: 0 },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 },
  label: { fontSize: 10.5, textTransform: "uppercase", letterSpacing: 1.2, opacity: 0.5 },
  hint: { fontSize: 12, opacity: 0.45, textAlign: "center" },
  swatchRow: { display: "flex", gap: 8, flexWrap: "wrap" },
  select: {
    width: "100%", padding: "9px 10px", borderRadius: 10, fontSize: 13, cursor: "pointer",
    border: "1px solid rgba(255,250,240,0.18)", background: "#2A2620", color: "#EFE6D6",
    fontFamily: "inherit",
  },
};

function btnStyle(active: boolean): React.CSSProperties {
  return {
    padding: "8px 4px", borderRadius: 10, fontSize: 12.5, cursor: "pointer",
    border: `1px solid ${active ? "#D98356" : "rgba(255,250,240,0.14)"}`,
    background: active ? "rgba(217,131,86,0.18)" : "rgba(255,250,240,0.05)",
    color: active ? "#F2B08B" : "#EFE6D6", transition: "all .15s", textTransform: "capitalize",
  };
}

function swatchStyle(color: string, active: boolean): React.CSSProperties {
  return {
    width: 26, height: 26, borderRadius: "50%", background: color, cursor: "pointer",
    border: active ? "2.5px solid #D98356" : "2.5px solid rgba(255,250,240,0.15)",
  };
}

/**
 * MacBook-notch peek demo: Zazoo's home is the on-screen rectangular camera
 * notch (M2 Air class). It peeks HEAD-ONLY to the LEFT of the notch on
 * hover — never centered under it, never full-body.
 */
function NotchPeek({ appearance, species, peek }: { appearance: ZazooAppearance; species: ZazooSpecies; peek: boolean }) {
  const director = useMemo(() => {
    const d = new ZazooDirector();
    d.perform({ emotion: "curious", attention: "user" });
    return d;
  }, []);

  // stage is 340px wide; the notch rect is 120px centered → spans x:[110,230].
  // The peek window sits just to its LEFT, clipped short so only the head
  // (not the suit/body) is ever revealed.
  return (
    <div
      style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: 340, height: 150, cursor: "pointer" }}
      title="Zazoo lives in the notch — hover just left of it to make it peek"
    >
      {/* head-only peek window, clipped to the LEFT of the notch */}
      <div style={{ position: "absolute", top: 0, left: 34, width: 76, height: 84, overflow: "hidden", zIndex: 1 }}>
        <div
          style={{
            position: "absolute", left: "50%",
            transform: peek ? "translate(-50%, 8px)" : "translate(-50%, -150px)",
            transition: "transform 0.9s cubic-bezier(0.34, 1.45, 0.5, 1)",
          }}
        >
          <ZazooAvatar director={director} width={110} appearance={appearance} species={species} />
        </div>
      </div>
      {/* menu bar + camera notch, above the peek window so the head emerges from behind it */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 26, background: "#0B0B0D", zIndex: 2, borderBottom: "1px solid rgba(255,255,255,0.07)" }} />
      <div style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: 120, height: 34, background: "#0B0B0D", zIndex: 2, borderRadius: "0 0 12px 12px", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#1E2B22", boxShadow: "0 0 3px #2E4636" }} />
      </div>
      <div style={{ position: "absolute", top: 32, width: "100%", textAlign: "center", fontSize: 11, opacity: 0.4, zIndex: 0 }}>
        {peek ? "" : "hover just left of the notch — Zazoo's home"}
      </div>
    </div>
  );
}

export function ZazooLab() {
  const director = useMemo(() => new ZazooDirector(), []);
  // Emotion (how Zazoo FEELS) and action (what Zazoo is DOING) are
  // independent channels that compose — never conflated into one state.
  const [emotion, setEmotionState] = useState<ZazooEmotion>("calm");
  const [action, setActionState] = useState<ZazooAction>("idle");
  const [warmth, setWarmth] = useState(0.7);
  const [confidence, setConfidence] = useState(0.7);
  const [energy, setEnergy] = useState(0.5);
  const [talking, setTalking] = useState(false);
  const [attention, setAttention] = useState<"user" | "cursor" | "away">("cursor");
  const [copied, setCopied] = useState(false);
  const [appearance, setAppearance] = useState<ZazooAppearance>(DEFAULT_APPEARANCE);
  const [species, setSpecies] = useState<ZazooSpecies>(DEFAULT_SPECIES);
  const [peek, setPeek] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const rigRef = useRef<HTMLDivElement>(null);

  // switching species keeps the wardrobe, adopts the species' default felt
  const pickSpecies = (s: ZazooSpecies) => {
    setSpecies(s);
    setAppearance((a) => ({ ...a, body: s.body }));
    setLayerRects([]);
    setSelectedLayer(null);
  };

  // layer outline overlay — snapshot of the tagged groups' screen bounds
  const [selectedLayer, setSelectedLayer] = useState<string | null>(null);
  const [layerRects, setLayerRects] = useState<{ x: number; y: number; w: number; h: number }[]>([]);
  const pickLayer = (name: string) => {
    if (selectedLayer === name) {
      setSelectedLayer(null);
      setLayerRects([]);
      return;
    }
    const host = rigRef.current;
    if (!host) return;
    const origin = host.getBoundingClientRect();
    const rects = [...host.querySelectorAll(`[data-layer="${name}"]`)].map((el) => {
      const b = el.getBoundingClientRect();
      return { x: b.left - origin.left, y: b.top - origin.top, w: b.width, h: b.height };
    }).filter((r) => r.w > 0.5 && r.h > 0.5);
    setSelectedLayer(name);
    setLayerRects(rects);
  };

  // Rig inspection — measuring the live rig against the source art. Off by
  // default so the lab still opens as a performance surface, not a ruler.
  const [inspect, setInspect] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(true);
  const [refOpacity, setRefOpacity] = useState(0);
  const [probe, setProbe] = useState<{ x: number; y: number } | null>(null);

  const sendEmotion = (e: ZazooEmotion) => {
    setEmotionState(e);
    director.perform({ emotion: e, warmth, confidence, energy, attention });
  };
  const sendAction = (a: ZazooAction) => {
    setActionState(a);
    director.perform({ action: a, warmth, confidence, energy, attention });
  };
  const sendAttention = (att: "user" | "cursor" | "away") => {
    setAttention(att);
    director.perform({ attention: att });
  };
  const toggleTalking = () => {
    setTalking((t) => {
      director.setTalking(!t);
      return !t;
    });
  };
  // the same call an agent would make to reproduce what is on stage right now
  const apiSnippet = `perform({ emotion: '${emotion}', action: '${action}', warmth: ${warmth.toFixed(2)}, confidence: ${confidence.toFixed(2)}, energy: ${energy.toFixed(2)} })`;

  const onMove = (ev: React.PointerEvent) => {
    const el = stageRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    director.setCursor({
      x: Math.max(-1, Math.min(1, (ev.clientX - cx) / (r.width / 2))),
      y: Math.max(-1, Math.min(1, (ev.clientY - cy) / (r.height / 2))),
    });
    // notch home: peek while the pointer is near the notch strip up top
    setPeek(ev.clientY - r.top < 140 && Math.abs(ev.clientX - cx) < 170);
  };

  return (
    <div style={S.page} onPointerMove={onMove} onPointerLeave={() => { director.setCursor(null); setPeek(false); }}>
      <div style={S.stage} ref={stageRef}>
        <NotchPeek appearance={appearance} species={species} peek={peek} />
        <div
          onPointerDown={() => !inspect && director.setPetting(true)}
          onPointerUp={() => director.setPetting(false)}
          onPointerCancel={() => director.setPetting(false)}
          onPointerLeave={() => director.setPetting(false)}
          style={{ touchAction: "none", marginTop: 90, position: "relative" }}
          ref={rigRef}
          title={inspect ? "Inspect mode — scroll to zoom, drag to pan" : "Press and hold to pet Zazoo"}
        >
          <RigInspector
            width={330}
            active={inspect}
            zoom={zoom}
            onZoom={setZoom}
            showGrid={inspect && showGrid}
            referenceOpacity={inspect ? refOpacity : 0}
            onProbe={setProbe}
          >
            <ZazooAvatar director={director} width={330} appearance={appearance} species={species} />
          </RigInspector>
          {inspect && layerRects.map((b, i) => (
            <div
              key={i}
              style={{
                position: "absolute", left: b.x, top: b.y, width: b.w, height: b.h,
                border: "1.5px solid #D98356", borderRadius: 3, pointerEvents: "none",
                boxShadow: "0 0 0 1px rgba(0,0,0,0.4)",
              }}
            />
          ))}
        </div>
        <div style={S.hint}>
          {inspect
            ? "inspect — scroll to zoom · drag to pan"
            : "move cursor — Zazoo watches · press & hold to pet · hover the notch up top"}
        </div>
        {inspect && (
          <div style={{ ...S.hint, fontFamily: "ui-monospace, monospace", opacity: 0.75 }}>
            {probe ? `x ${probe.x.toFixed(1)}  y ${probe.y.toFixed(1)}` : "— · —"} · {zoom.toFixed(2)}×
          </div>
        )}
      </div>

      <div style={S.panel}>
        <div>
          <h1 style={S.h1}>Zazoo Lab</h1>
          <p style={S.sub}>
            Emotional performance engine — same <code>perform(&#123;emotion, warmth, confidence, energy&#125;)</code> contract the agent plane uses.
          </p>
        </div>

        <div>
          <div style={{ ...S.label, marginBottom: 7 }}>Character — a small delta on the same rig</div>
          <select
            style={S.select}
            value={species.id}
            onChange={(ev) => {
              const s = SPECIES.find((x) => x.id === ev.target.value);
              if (s) pickSpecies(s);
            }}
          >
            {SPECIES.map((s) => (
              <option key={s.id} value={s.id}>{s.name} — {s.kind}</option>
            ))}
          </select>
        </div>

        <div>
          <div style={{ ...S.label, marginBottom: 7 }}>Emotion — how Zazoo feels</div>
          <select
            style={S.select}
            value={emotion}
            onChange={(ev) => sendEmotion(ev.target.value as ZazooEmotion)}
          >
            {ZAZOO_EMOTIONS.map((e) => (
              <option key={e} value={e}>{e[0].toUpperCase() + e.slice(1)}</option>
            ))}
          </select>
        </div>

        <div>
          <div style={{ ...S.label, marginBottom: 7 }}>Action — what Zazoo is doing (composes with emotion)</div>
          <div style={S.grid}>
            {ZAZOO_ACTIONS.map((a) => (
              <button key={a} style={btnStyle(a === action)} onClick={() => sendAction(a)}>{a}</button>
            ))}
            <button style={btnStyle(talking)} onClick={toggleTalking}>{talking ? "talking…" : "talk"}</button>
            <button style={btnStyle(false)} onClick={() => director.waveHello()}>👋 wave</button>
          </div>
        </div>

        <div>
          <div style={{ ...S.label, marginBottom: 7 }}>Attention — where Zazoo looks</div>
          <div style={{ ...S.grid, gridTemplateColumns: "1fr 1fr 1fr" }}>
            {(["user", "cursor", "away"] as const).map((att) => (
              <button key={att} style={btnStyle(att === attention)} onClick={() => sendAttention(att)}>{att}</button>
            ))}
          </div>
        </div>

        {(
          [
            ["warmth", warmth, setWarmth],
            ["confidence", confidence, setConfidence],
            ["energy", energy, setEnergy],
          ] as const
        ).map(([name, val, set]) => (
          <div key={name}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={S.label}>{name}</span>
              <span style={{ ...S.label, opacity: 0.8 }}>{val.toFixed(2)}</span>
            </div>
            <input
              type="range" min={0} max={1} step={0.01} value={val} style={{ width: "100%", accentColor: "#D98356" }}
              onChange={(ev) => {
                const v = Number(ev.target.value);
                set(v);
                director.perform({
                  emotion,
                  warmth: name === "warmth" ? v : warmth,
                  confidence: name === "confidence" ? v : confidence,
                  energy: name === "energy" ? v : energy,
                  attention: "cursor",
                });
              }}
            />
          </div>
        ))}

        <div>
          <div style={{ ...S.label, marginBottom: 7 }}>Agent call — reproduces the stage</div>
          <div style={{ display: "flex", gap: 7, alignItems: "stretch" }}>
            <code style={{ flex: 1, fontSize: 10, lineHeight: 1.5, opacity: 0.65, background: "rgba(0,0,0,0.25)", borderRadius: 8, padding: "7px 9px", wordBreak: "break-all" }}>
              {apiSnippet}
            </code>
            <button
              style={{ ...btnStyle(copied), padding: "4px 10px", alignSelf: "center" }}
              onClick={async () => {
                await navigator.clipboard?.writeText(apiSnippet);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
            >
              {copied ? "✓" : "copy"}
            </button>
          </div>
        </div>

        <div>
          <div style={{ ...S.label, marginBottom: 7 }}>Fur color</div>
          <div style={S.swatchRow}>
            {BODY_COLORS.map((c) => (
              <div key={c} style={swatchStyle(c, appearance.body === c)} onClick={() => setAppearance({ ...appearance, body: c })} />
            ))}
          </div>
        </div>

        <div>
          <div style={{ ...S.label, marginBottom: 7 }}>Suit</div>
          <div style={S.swatchRow}>
            {SUIT_COLORS.map((c) => (
              <div key={c} style={swatchStyle(c, appearance.suit === c)} onClick={() => setAppearance({ ...appearance, suit: c })} />
            ))}
          </div>
        </div>

        <div>
          <div style={{ ...S.label, marginBottom: 7 }}>Tie</div>
          <div style={S.swatchRow}>
            {TIE_COLORS.map((c) => (
              <div key={c} style={swatchStyle(c, appearance.tie === c)} onClick={() => setAppearance({ ...appearance, tie: c })} />
            ))}
          </div>
        </div>

        <div>
          <div style={{ ...S.label, marginBottom: 7 }}>Accessory</div>
          <div style={S.grid}>
            {ACCESSORIES.map((a) => (
              <button key={a} style={btnStyle(appearance.accessory === a)} onClick={() => setAppearance({ ...appearance, accessory: a })}>{a}</button>
            ))}
          </div>
        </div>

        <div>
          <div style={{ ...S.label, marginBottom: 7 }}>Spectacles — an accessory, not anatomy</div>
          <div style={S.grid}>
            <button style={btnStyle(appearance.glasses)} onClick={() => setAppearance({ ...appearance, glasses: true })}>on</button>
            <button style={btnStyle(!appearance.glasses)} onClick={() => setAppearance({ ...appearance, glasses: false })}>off</button>
          </div>
        </div>

        {/* Rig inspection — measure the live rig in the same viewBox units the
            RIG constant is written in, and ghost the source art over it. */}
        <div>
          <div style={{ ...S.label, marginBottom: 7 }}>Rig inspector</div>
          <div style={S.grid}>
            <button style={btnStyle(inspect)} onClick={() => setInspect(true)}>inspect</button>
            <button style={btnStyle(!inspect)} onClick={() => { setInspect(false); setZoom(1); }}>perform</button>
          </div>

          {inspect && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={S.label}>zoom</span>
                  <span style={{ ...S.label, opacity: 0.8 }}>{zoom.toFixed(2)}×</span>
                </div>
                <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
                  <button style={{ ...btnStyle(false), padding: "4px 10px" }} onClick={() => setZoom((z) => Math.max(ZOOM_MIN, Number((z / 1.4).toFixed(3))))}>−</button>
                  <input
                    type="range" min={ZOOM_MIN} max={ZOOM_MAX} step={0.05} value={zoom}
                    style={{ flex: 1, accentColor: "#D98356" }}
                    onChange={(ev) => setZoom(Number(ev.target.value))}
                  />
                  <button style={{ ...btnStyle(false), padding: "4px 10px" }} onClick={() => setZoom((z) => Math.min(ZOOM_MAX, Number((z * 1.4).toFixed(3))))}>+</button>
                </div>
              </div>

              <div style={S.grid}>
                <button style={btnStyle(showGrid)} onClick={() => setShowGrid(!showGrid)}>grid</button>
                <button style={btnStyle(false)} onClick={() => setZoom(1)}>reset view</button>
              </div>

              <div>
                <div style={{ ...S.label, marginBottom: 7 }}>Layers — click to outline on the rig</div>
                <div style={{ ...S.grid, gridTemplateColumns: "1fr 1fr 1fr" }}>
                  {LAYERS.map((name) => (
                    <button key={name} style={{ ...btnStyle(name === selectedLayer), padding: "5px 2px", fontSize: 11 }} onClick={() => pickLayer(name)}>
                      {name}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={S.label}>source art overlay</span>
                  <span style={{ ...S.label, opacity: 0.8 }}>{refOpacity.toFixed(2)}</span>
                </div>
                <input
                  type="range" min={0} max={1} step={0.01} value={refOpacity}
                  style={{ width: "100%", accentColor: "#D98356" }}
                  onChange={(ev) => setRefOpacity(Number(ev.target.value))}
                />
              </div>

            </div>
          )}
        </div>

        <div>
          <div style={{ ...S.label, marginBottom: 7 }}>Scenario beats</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <button style={btnStyle(false)} onClick={() => { setEmotionState("celebrating"); director.perform({ emotion: "celebrating", warmth: 1, energy: 0.9, duration: 3.5 }); }}>
              🎉 Task shipped (auto-returns to calm)
            </button>
            <button style={btnStyle(false)} onClick={() => { setEmotionState("unsure"); director.perform({ emotion: "unsure", warmth: 0.95, confidence: 0.45, energy: 0.3, attention: "user", intent: "offer_suggestion", duration: 5 }); }}>
              💭 Spec example: unsure suggestion
            </button>
            <button style={btnStyle(false)} onClick={() => { setEmotionState("sleepy"); director.perform({ emotion: "sleepy", energy: 0.1 }); }}>
              🌙 End of day
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
