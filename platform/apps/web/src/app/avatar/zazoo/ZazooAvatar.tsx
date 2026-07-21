/**
 * Zazoo — plush-felt companion rig ("Zazoo crew" visual language: huge glossy
 * eyes, tiny nose, thread-line mouth, navy suit + white collar, nub hands,
 * no legs, oval tail). Layered SVG driven per-frame by the ZazooDirector via
 * refs — no React re-render inside the animation loop. Renderer stays dumb:
 * all acting decisions live in the director.
 */
import { useEffect, useRef } from "react";
import { ZazooDirector, type ZazooFrame } from "./director";

export interface ZazooAppearance {
  /** Base felt color of the cat. */
  body: string;
  /** Suit color. */
  suit: string;
  accessory: "tie" | "bowtie" | "scarf" | "none";
  /** Spectacles are an accessory, not anatomy. */
  glasses: boolean;
}

export const DEFAULT_APPEARANCE: ZazooAppearance = {
  body: "#F0DFC2",
  suit: "#3E5A7E",
  accessory: "tie",
  glasses: true,
};

/** Mix hex color toward white (amt>0) or black (amt<0). */
function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const t = amt > 0 ? 255 : 0;
  const a = Math.abs(amt);
  const r = Math.round(((n >> 16) & 255) * (1 - a) + t * a);
  const g = Math.round(((n >> 8) & 255) * (1 - a) + t * a);
  const b = Math.round((n & 255) * (1 - a) + t * a);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** Cheek blush: pale pink → warm coral as cheekWarm rises. */
function cheekColor(warm: number): string {
  const mix = (a: number, b: number) => Math.round(a + (b - a) * warm);
  return `rgb(${mix(242, 240)}, ${mix(199, 138)}, ${mix(192, 106)})`;
}

interface Props {
  director: ZazooDirector;
  width?: number;
  appearance?: ZazooAppearance;
}

export function ZazooAvatar({ director, width = 340, appearance = DEFAULT_APPEARANCE }: Props) {
  const refs = {
    root: useRef<SVGGElement>(null),
    cat: useRef<SVGGElement>(null),
    bundle: useRef<SVGGElement>(null),
    body: useRef<SVGGElement>(null),
    tail: useRef<SVGGElement>(null),
    earL: useRef<SVGGElement>(null),
    earR: useRef<SVGGElement>(null),
    face: useRef<SVGGElement>(null),
    eyeL: useRef<SVGGElement>(null),
    eyeR: useRef<SVGGElement>(null),
    pupilL: useRef<SVGGElement>(null),
    pupilR: useRef<SVGGElement>(null),
    sparkleL: useRef<SVGCircleElement>(null),
    sparkleR: useRef<SVGCircleElement>(null),
    browL: useRef<SVGPathElement>(null),
    browR: useRef<SVGPathElement>(null),
    specs: useRef<SVGGElement>(null),
    mouth: useRef<SVGPathElement>(null),
    cheekG: useRef<SVGGElement>(null),
    cheekL: useRef<SVGEllipseElement>(null),
    cheekR: useRef<SVGEllipseElement>(null),
    whiskerL: useRef<SVGGElement>(null),
    whiskerR: useRef<SVGGElement>(null),
    pawL: useRef<SVGGElement>(null),
    pawR: useRef<SVGGElement>(null),
    shadow: useRef<SVGEllipseElement>(null),
    zzz: useRef<SVGTextElement>(null),
  };

  useEffect(() => {
    let raf = 0;
    const apply = (f: ZazooFrame) => {
      const r = refs;
      if (!r.root.current) return;
      r.root.current.setAttribute("transform", `translate(0 ${f.hopY.toFixed(2)}) rotate(${f.wiggle.toFixed(2)} 120 240)`);

      // hide: Zazoo ROLLS forward and wraps itself into its own suit —
      // diegetic compression (~2.5 full rolls sell the tumble; size loss
      // reads as a consequence of rolling up, never a plain scale-down);
      // cat fully gone by h≈0.85 so the settling spring never leaves a ghost
      const h = Math.max(0, Math.min(1, f.hide));
      r.cat.current!.setAttribute("opacity", Math.max(0, 1 - h * 1.18).toFixed(3));
      r.cat.current!.setAttribute(
        "transform",
        h > 0.001
          ? `translate(${(120 + h * 12).toFixed(1)} 256) rotate(${(h * 900).toFixed(1)}) scale(${(1 - h * 0.5).toFixed(3)} ${(1 - h * 0.55).toFixed(3)}) translate(-120 -256)`
          : "",
      );
      r.bundle.current!.setAttribute("opacity", h < 0.3 ? "0" : ((h - 0.3) / 0.7).toFixed(3));
      r.bundle.current!.setAttribute(
        "transform",
        `translate(${(120 + (1 - Math.min(1, h * 1.1)) * 4).toFixed(1)} 272) rotate(${((1 - Math.min(1, h * 1.1)) * 140).toFixed(1)}) scale(${(0.55 + h * 0.45).toFixed(3)}) translate(-120 -272)`,
      );

      // breath + posture + squash-and-stretch
      const sq = f.squash;
      const bScaleY = (1 + f.breath * 0.014 + (f.posture - 0.5) * 0.03) * (1 - sq * 0.16);
      const bScaleX = (1 - f.breath * 0.007) * (1 + sq * 0.08);
      r.body.current!.setAttribute(
        "transform",
        `rotate(${(f.bodyLean * 0.5).toFixed(2)} 120 282) translate(120 288) scale(${bScaleX.toFixed(4)} ${bScaleY.toFixed(4)}) translate(-120 -288)`,
      );

      // grounding: shadow reacts to hop height (Pixar weight cue)
      const air = Math.min(1, Math.abs(f.hopY) / 20);
      r.shadow.current!.setAttribute("rx", (62 - air * 14).toFixed(1));
      r.shadow.current!.setAttribute("opacity", (0.1 - air * 0.05).toFixed(3));

      const wag = Math.sin(f.tailWagPhase) * (3 + f.wagAmount * 22);
      r.tail.current!.setAttribute("transform", `rotate(${(f.tailCurl * 16 - 6 + wag).toFixed(2)} 186 246)`);

      const es = f.earScale.toFixed(3);
      r.earL.current!.setAttribute("transform", `translate(84 112) scale(${es}) translate(-84 -112) rotate(${(-f.earL * 0.8).toFixed(2)} 84 112)`);
      r.earR.current!.setAttribute("transform", `translate(156 112) scale(${es}) translate(-156 -112) rotate(${(f.earR * 0.8).toFixed(2)} 156 112)`);

      const fx = f.gazeX * 4.2;
      const fy = f.gazeY * 2.6 + f.headDrop + f.nodY;
      r.face.current!.setAttribute("transform", `translate(${fx.toFixed(2)} ${fy.toFixed(2)}) rotate(${f.headTilt.toFixed(2)} 120 148)`);

      const eo = Math.max(0.04, Math.min(1.15, f.eyeOpen));
      r.eyeL.current!.setAttribute("transform", `translate(94 144) scale(1 ${eo.toFixed(3)}) translate(-94 -144)`);
      r.eyeR.current!.setAttribute("transform", `translate(146 144) scale(1 ${eo.toFixed(3)}) translate(-146 -144)`);

      const px = f.gazeX * 3.6, py = f.gazeY * 2.8;
      const ps = f.pupilScale.toFixed(3);
      r.pupilL.current!.setAttribute("transform", `translate(${px.toFixed(2)} ${py.toFixed(2)}) translate(94 144) scale(${ps}) translate(-94 -144)`);
      r.pupilR.current!.setAttribute("transform", `translate(${px.toFixed(2)} ${py.toFixed(2)}) translate(146 144) scale(${ps}) translate(-146 -144)`);
      r.sparkleL.current!.setAttribute("opacity", (0.5 + f.sparkle * 0.5).toFixed(2));
      r.sparkleR.current!.setAttribute("opacity", (0.5 + f.sparkle * 0.5).toFixed(2));

      // brows: raise + sorrow (inner-up) + furrow (inner-down, draw in) +
      // LENGTH variation (raised brows lengthen, furrowed brows shorten)
      const braise = -f.browRaise * 5;
      const furrowIn = f.browFurrow * 2.4;
      const bLen = 15 + f.browRaise * 5 - f.browFurrow * 4 + f.browSorrow * 2;
      const bArc = -4.5 - f.browRaise * 2.5 + f.browFurrow * 2;
      r.browL.current!.setAttribute("d", `M ${(94 - bLen / 2).toFixed(1)},119 q ${(bLen / 2).toFixed(1)},${bArc.toFixed(1)} ${bLen.toFixed(1)},-1.5`);
      r.browR.current!.setAttribute("d", `M ${(146 + bLen / 2).toFixed(1)},119 q ${(-bLen / 2).toFixed(1)},${bArc.toFixed(1)} ${(-bLen).toFixed(1)},-1.5`);
      r.browL.current!.setAttribute(
        "transform",
        `translate(${furrowIn.toFixed(2)} ${braise.toFixed(2)}) rotate(${(f.browSorrow * 16 - f.browFurrow * 13).toFixed(2)} 94 119)`,
      );
      r.browR.current!.setAttribute(
        "transform",
        `translate(${(-furrowIn).toFixed(2)} ${braise.toFixed(2)}) rotate(${(-f.browSorrow * 16 + f.browFurrow * 13).toFixed(2)} 146 119)`,
      );

      r.specs.current?.setAttribute("transform", `translate(${(f.specJiggle * 0.6).toFixed(2)} ${(Math.abs(f.specJiggle) * 0.5 + f.pawLift * 1.5).toFixed(2)})`);

      // ONE mouth element: a thread-line whose interior opens into a lens —
      // never a second mark below the smile (round-2 defect fix); the nose
      // sits 14px above it as an isolated micro-dot and takes no part here.
      const c = f.mouthCurve;
      const mo = f.mouthOpen;
      const lipY = (172 + c * 6).toFixed(1);
      const openY = (172 + c * 6 + mo * 10).toFixed(1);
      r.mouth.current!.setAttribute("d", `M 113,172 Q 120,${lipY} 127,172 Q 120,${openY} 113,172 Z`);
      r.mouth.current!.setAttribute("fill-opacity", mo > 0.04 ? "0.95" : "0");

      // cheeks: opacity + puff scale + emotional color temperature
      const cc = cheekColor(Math.max(0, Math.min(1, f.cheekWarm)));
      const puff = (1 + f.cheekPuff * 0.3).toFixed(3);
      r.cheekG.current!.setAttribute("opacity", (0.25 + f.cheek * 0.6).toFixed(2));
      r.cheekL.current!.setAttribute("fill", cc);
      r.cheekR.current!.setAttribute("fill", cc);
      r.cheekL.current!.setAttribute("transform", `translate(76 158) scale(${puff}) translate(-76 -158)`);
      r.cheekR.current!.setAttribute("transform", `translate(164 158) scale(${puff}) translate(-164 -158)`);

      // whiskers float in the air: sway + droop
      const swayL = (f.whiskerSway - f.whiskerDroop * 9).toFixed(2);
      const swayR = (-f.whiskerSway + f.whiskerDroop * 9).toFixed(2);
      r.whiskerL.current!.setAttribute("transform", `rotate(${swayL} 70 156)`);
      r.whiskerR.current!.setAttribute("transform", `rotate(${swayR} 170 156)`);

      // paws (nub hands): rest IN FRONT on the belly by default (reference
      // image), not at the sides — celebration > spectacle-adjust > meditate > chest > rest
      const lift = f.pawLift, up = f.armsUp, chest = f.pawChest, med = f.pawMeditate;
      let rx = 0, ry = 0, rrot = 0, lx = 0, ly = 0, lrot = 0;
      if (up > 0.01) {
        rx = 12 * up; ry = -78 * up; rrot = 30 * up;
        lx = -12 * up; ly = -78 * up; lrot = -30 * up;
      } else if (lift > 0.01) {
        rx = -8 * lift; ry = -58 * lift; rrot = -18 * lift;
      } else if (med > 0.01) {
        rx = -6 * med; ry = 4 * med; rrot = -10 * med;
        lx = 6 * med; ly = 4 * med; lrot = 10 * med;
      } else if (chest > 0.01) {
        rx = -4 * chest; ry = -18 * chest; rrot = -22 * chest;
      }
      r.pawR.current!.setAttribute("transform", `translate(${rx.toFixed(2)} ${ry.toFixed(2)}) rotate(${rrot.toFixed(2)} 132 244)`);
      r.pawL.current!.setAttribute("transform", `translate(${lx.toFixed(2)} ${ly.toFixed(2)}) rotate(${lrot.toFixed(2)} 108 244)`);

      r.zzz.current!.setAttribute("opacity", f.zzz ? (0.35 + 0.3 * Math.sin(f.tailWagPhase * 0.5)).toFixed(2) : "0");
    };

    const loop = () => {
      apply(director.tick(performance.now() / 1000));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [director]);

  const { body, suit, accessory } = appearance;
  const bodyLight = shade(body, 0.35);
  const bodyDark = shade(body, -0.12);
  const bodyDeep = shade(body, -0.22);
  const suitLight = shade(suit, 0.14);
  const suitDark = shade(suit, -0.25);
  const inner = "#E8B49E";

  return (
    <svg
      viewBox="0 0 240 310"
      width={width}
      height={(width * 310) / 240}
      style={{ overflow: "visible", userSelect: "none" }}
      aria-label="Zazoo, your companion"
      role="img"
    >
      <defs>
        <radialGradient id="zz-body" cx="0.42" cy="0.28" r="0.95">
          <stop offset="0%" stopColor={bodyLight} />
          <stop offset="70%" stopColor={body} />
          <stop offset="100%" stopColor={bodyDark} />
        </radialGradient>
        {/* The rolled-up bundle takes the suit's color. */}
        <radialGradient id="zz-bundle" cx="0.42" cy="0.3" r="0.9">
          <stop offset="0%" stopColor={suitLight} />
          <stop offset="100%" stopColor={suitDark} />
        </radialGradient>
        <linearGradient id="zz-suit" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={suitLight} />
          <stop offset="100%" stopColor={suitDark} />
        </linearGradient>
      </defs>

      <g ref={refs.root}>
        <ellipse ref={refs.shadow} cx="120" cy="294" rx="62" ry="7" fill="#000" opacity="0.10" />

        {/* Compact cloth bundle shown in the hide pose. */}
        <g ref={refs.bundle} opacity="0">
          <ellipse cx="120" cy="274" rx="24" ry="17" fill="url(#zz-bundle)" />
          <ellipse cx="113" cy="268" rx="7" ry="5" fill="#E3E5E9" opacity="0.7" />
        </g>

        <g ref={refs.cat}>
          {/* oval plush tail (behind body) */}
          <g ref={refs.tail}>
            <ellipse cx="194" cy="242" rx="15" ry="9.5" fill={bodyDark} />
            <ellipse cx="197" cy="240" rx="7" ry="4.5" fill={bodyLight} opacity="0.6" />
          </g>

          <g ref={refs.body}>
            {/* soft round ears */}
            <g ref={refs.earL}>
              <path d="M 68,112 C 62,84 74,70 90,78 C 101,84 103,100 100,114 Z" fill="url(#zz-body)" />
              <path d="M 75,107 C 72,89 79,79 89,84 C 96,88 97,100 95,110 Z" fill={inner} opacity="0.75" />
            </g>
            <g ref={refs.earR}>
              <path d="M 172,112 C 178,84 166,70 150,78 C 139,84 137,100 140,114 Z" fill="url(#zz-body)" />
              <path d="M 165,107 C 168,89 161,79 151,84 C 144,88 143,100 145,110 Z" fill={inner} opacity="0.75" />
            </g>

            {/* rounded body */}
            <path
              d="M 120,84 C 176,84 202,142 202,200 C 202,258 164,288 120,288 C 76,288 38,258 38,200 C 38,142 64,84 120,84 Z"
              fill="url(#zz-body)"
            />

            {/* suit — navy felt, white collar, accessory */}
            <path
              d="M 44,212 C 58,200 86,194 120,194 C 154,194 182,200 196,212 C 198,254 163,288 120,288 C 77,288 42,254 44,212 Z"
              fill="url(#zz-suit)"
            />
            <path d="M 103,196 L 120,215 L 137,196 L 129,191 L 120,203 L 111,191 Z" fill="#FBF8F1" />
            {accessory === "tie" && (
              <g>
                <path d="M 116,206 L 124,206 L 122,212 L 118,212 Z" fill={suitDark} />
                <path d="M 118,212 L 122,212 L 126,236 L 120,244 L 114,236 Z" fill={shade(suit, -0.38)} />
              </g>
            )}
            {accessory === "bowtie" && (
              <g fill={shade(suit, -0.38)}>
                <path d="M 119,203 L 106,197 L 106,211 Z" />
                <path d="M 121,203 L 134,197 L 134,211 Z" />
                <circle cx="120" cy="204" r="3.4" />
              </g>
            )}
            {accessory === "scarf" && (
              <g>
                <path d="M 100,193 C 108,201 132,201 140,193 L 138,205 C 128,211 112,211 102,205 Z" fill="#C96F52" />
                <path d="M 112,205 L 118,205 L 116,228 L 108,226 Z" fill="#B8603F" />
              </g>
            )}

            {/* face */}
            <g ref={refs.face}>
              <path ref={refs.browL} d="M 76,120 q 8,-4 16,-1.5" stroke={bodyDeep} strokeWidth="3.2" strokeLinecap="round" fill="none" />
              <path ref={refs.browR} d="M 164,120 q -8,-4 -16,-1.5" stroke={bodyDeep} strokeWidth="3.2" strokeLinecap="round" fill="none" />

              {/* huge glossy eyes (crew style: dark, two highlights) */}
              <g ref={refs.eyeL}>
                <circle cx="94" cy="144" r="12.2" fill="#33313B" />
                <g ref={refs.pupilL}>
                  <circle cx="94" cy="144" r="12.2" fill="#2A2831" />
                  <circle cx="89.8" cy="139.6" r="4.4" fill="#FFF" opacity="0.95" />
                  <circle ref={refs.sparkleL} cx="97.8" cy="148.2" r="1.9" fill="#FFF" opacity="0.5" />
                </g>
              </g>
              <g ref={refs.eyeR}>
                <circle cx="146" cy="144" r="12.2" fill="#33313B" />
                <g ref={refs.pupilR}>
                  <circle cx="146" cy="144" r="12.2" fill="#2A2831" />
                  <circle cx="141.8" cy="139.6" r="4.4" fill="#FFF" opacity="0.95" />
                  <circle ref={refs.sparkleR} cx="149.8" cy="148.2" r="1.9" fill="#FFF" opacity="0.5" />
                </g>
              </g>

              {/* round spectacles — an ACCESSORY (add/remove), never anatomy */}
              {appearance.glasses && (
                <g ref={refs.specs}>
                  <circle cx="94" cy="144" r="16.5" fill="none" stroke="#454B57" strokeWidth="2.9" />
                  <circle cx="146" cy="144" r="16.5" fill="none" stroke="#454B57" strokeWidth="2.9" />
                  <path d="M 110.5,142.5 Q 120,138 129.5,142.5" fill="none" stroke="#454B57" strokeWidth="2.7" />
                  <path d="M 77.5,141 L 64,136" stroke="#454B57" strokeWidth="2.4" strokeLinecap="round" />
                  <path d="M 162.5,141 L 176,136" stroke="#454B57" strokeWidth="2.4" strokeLinecap="round" />
                </g>
              )}

              {/* cheeks — color + puff driven by emotion */}
              <g ref={refs.cheekG} opacity="0.4">
                <ellipse ref={refs.cheekL} cx="76" cy="158" rx="7" ry="5.2" fill="#F2C7C0" />
                <ellipse ref={refs.cheekR} cx="164" cy="158" rx="7" ry="5.2" fill="#F2C7C0" />
              </g>

              {/* whiskers — thin, floating */}
              <g ref={refs.whiskerL} stroke={bodyDeep} strokeWidth="1.1" strokeLinecap="round" opacity="0.85">
                <path d="M 68,152 Q 52,148 42,150" fill="none" />
                <path d="M 68,161 Q 51,162 41,166" fill="none" />
              </g>
              <g ref={refs.whiskerR} stroke={bodyDeep} strokeWidth="1.1" strokeLinecap="round" opacity="0.85">
                <path d="M 172,152 Q 188,148 198,150" fill="none" />
                <path d="M 172,161 Q 189,162 199,166" fill="none" />
              </g>

              {/* micro-dot nose — clearly separated from the mouth (never a
                  cluster); ONE mouth element, thread-line at rest, opens
                  into a lens shape for speech/joy (round-2 defect fix) */}
              <circle cx="120" cy="158" r="2.1" fill="#D98E7C" />
              <path ref={refs.mouth} d="M 113,172 Q 120,175 127,172" fill="#9A6B58" fillOpacity="0" stroke="#9A6B58" strokeWidth="2" strokeLinecap="round" />
            </g>

            {/* nub hands — tiny jointless mittens resting IN FRONT on the
                suit, close together (reference image), not at the sides;
                no legs at rest (legs only appear in locomotion states) */}
            <g ref={refs.pawL}>
              <ellipse cx="108" cy="244" rx="11" ry="9" fill={body} stroke={bodyDark} strokeWidth="1.4" />
            </g>
            <g ref={refs.pawR}>
              <ellipse cx="132" cy="244" rx="11" ry="9" fill={body} stroke={bodyDark} strokeWidth="1.4" />
            </g>
          </g>

          <text ref={refs.zzz} x="182" y="90" fontSize="20" fontFamily="Georgia, serif" fill="#9DB0C2" opacity="0">
            z<tspan dx="4" dy="-10" fontSize="14">z</tspan>
          </text>
        </g>
      </g>
    </svg>
  );
}
