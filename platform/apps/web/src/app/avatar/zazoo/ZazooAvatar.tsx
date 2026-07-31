/**
 * Zazoo — plush-felt companion rig, now a PANDA built on the painted
 * `Avatar/` source art (round cream body, black ear caps + eye patches,
 * charcoal suit with white collar, brass buttons). The rig is unchanged:
 * layered SVG driven per-frame by the ZazooDirector via refs — no React
 * re-render inside the animation loop, renderer stays dumb, every acting
 * decision still lives in the director.
 *
 * Painted layers (suit, tie, snout, arms) are registered against the source
 * art's shared 3840² canvas; RIG below is that canvas mapped into viewBox
 * units, so anatomy anchors and the artwork agree by construction. Anything
 * that has to deform per frame (eyes, brows, mouth, cheeks, ears, body)
 * stays vector so it can squash, blink and recolor.
 */
import { useEffect, useRef } from "react";
import { ZazooDirector, type ZazooFrame } from "./director";
import suitTieUrl from "./assets/suit-front.webp";
import suitPlainUrl from "./assets/suit-notie.webp";
import earUrl from "./assets/ear-front.webp";
import patchUrl from "./assets/eye-patch.webp";
import snoutUrl from "./assets/snout.webp";
import armUrl from "./assets/arm-front.webp";

export interface ZazooAppearance {
  /** Base felt color of the panda's fur. */
  body: string;
  /** Suit color — screened over the painted charcoal fabric. */
  suit: string;
  accessory: "tie" | "bowtie" | "scarf" | "none";
  /** Spectacles are an accessory, not anatomy. */
  glasses: boolean;
}

export const DEFAULT_APPEARANCE: ZazooAppearance = {
  body: "#FAF1E7",
  suit: "#15151A",
  accessory: "tie",
  glasses: false,
};

/**
 * Anatomy anchors in viewBox units, measured off `Avatar/Panda main front.png`
 * and carried through the same transform as the painted layers.
 */
const RIG = {
  // ear box solved by fitting the extended-ear sheet against the reference
  // composite (IoU 0.98); the right ear is the same box mirrored about x=120
  ear: { lx: 53.83, rx: 135.35, y: 78.12, w: 50.83, h: 47.5, pivotLx: 93, pivotRx: 147, pivotY: 111 },
  // painted eye patch (`eye out.png`) dropped straight onto the bbox the same
  // shape occupies in the reference composite — the art's tilt comes with it,
  // so nothing here has to guess an angle. Right patch = mirrored about x=120.
  patch: { lx: 79.32, rx: 141.4, y: 115.49, w: 19.28, h: 19.86 },
  // the glossy eye sits UP AND INWARD of the patch centre, where the source
  // art puts it; dead-centred pupils read as a doll's stare
  eye: { lx: 92.05, rx: 147.95, y: 124.8, rx_: 3.9, ry_: 5.2, tilt: 20 },
  // brow length and weight measured off the reference: 9.5 long, 2.3 thick —
  // a third of what a generic "eyebrow stroke" wants to be
  brow: { lx: 91, rx: 149, y: 108.8, len: 9.5, weight: 2.3 },
  snout: { y: 130.7, w: 17.81, aspect: 1.499 },
  mouth: { y: 140.9, w: 15.05 },
  // high and inboard, so the blush lands on cheek fur and stays clear of the
  // collar even at full head-drop
  cheek: { lx: 76, rx: 164, y: 143 },
  head: { x: 120, y: 152 },
  // mitts rest at tie level just below the chin, set wide enough to clear the
  // white collar points and sit on the lapels
  paw: { lx: 92, rx: 148, y: 193, w: 24, aspect: 1.133, tilt: 26 },
  suit: { x: 40.54, y: 137.17, w: 159.05, h: 150.64 },
} as const;

/** Body silhouette traced from `Avatar/base front shape.png`. */
const BODY_PATH =
  "M 119.87,76.16 C 123.79,76.16 127.80,76.60 131.64,77.38 C 135.48,78.16 139.32,79.33 142.92,80.85 C 146.51,82.36 149.99,84.37 153.22,86.49 C 156.46,88.62 159.50,91.11 162.34,93.62 C 165.19,96.13 167.84,98.82 170.29,101.57 C 172.74,104.32 174.98,107.21 177.05,110.11 C 179.11,113.02 181.02,115.97 182.68,119.00 C 184.33,122.03 185.74,125.18 186.98,128.29 C 188.22,131.40 189.17,134.59 190.12,137.67 C 191.07,140.74 191.90,143.76 192.69,146.74 C 193.48,149.72 194.23,152.64 194.87,155.56 C 195.51,158.49 196.05,161.40 196.54,164.31 C 197.03,167.22 197.47,170.11 197.82,173.02 C 198.18,175.94 198.45,178.86 198.66,181.81 C 198.86,184.76 199.00,187.72 199.04,190.73 C 199.09,193.73 199.04,196.76 198.91,199.85 C 198.79,202.93 198.59,206.06 198.27,209.24 C 197.95,212.42 197.54,215.65 196.99,218.95 C 196.44,222.24 195.78,225.59 194.95,228.98 C 194.12,232.38 193.18,235.86 191.99,239.32 C 190.79,242.77 189.48,246.36 187.78,249.71 C 186.08,253.07 184.07,256.40 181.78,259.43 C 179.48,262.47 176.82,265.33 173.99,267.94 C 171.17,270.56 168.07,273.00 164.81,275.13 C 161.56,277.26 158.06,279.13 154.48,280.72 C 150.90,282.30 147.14,283.61 143.34,284.63 C 139.54,285.65 135.61,286.34 131.70,286.81 C 127.79,287.28 123.81,287.52 119.87,287.45 C 115.94,287.39 111.97,287.02 108.08,286.43 C 104.20,285.84 100.31,285.04 96.56,283.92 C 92.82,282.81 89.12,281.40 85.60,279.75 C 82.08,278.10 78.65,276.19 75.45,274.04 C 72.26,271.89 69.23,269.43 66.44,266.85 C 63.65,264.26 61.02,261.46 58.71,258.51 C 56.39,255.55 54.38,252.32 52.57,249.10 C 50.77,245.89 49.23,242.54 47.89,239.21 C 46.55,235.88 45.46,232.49 44.55,229.13 C 43.64,225.78 43.00,222.40 42.43,219.10 C 41.87,215.80 41.47,212.55 41.18,209.34 C 40.89,206.14 40.76,202.98 40.70,199.88 C 40.64,196.77 40.70,193.73 40.83,190.71 C 40.96,187.70 41.19,184.74 41.47,181.81 C 41.75,178.87 42.09,175.98 42.50,173.09 C 42.90,170.20 43.37,167.34 43.91,164.47 C 44.44,161.60 45.03,158.74 45.71,155.86 C 46.38,152.97 47.14,150.10 47.95,147.17 C 48.77,144.24 49.63,141.30 50.58,138.27 C 51.54,135.24 52.47,132.11 53.67,129.01 C 54.86,125.91 56.17,122.74 57.74,119.68 C 59.31,116.61 61.11,113.58 63.10,110.62 C 65.09,107.66 67.26,104.70 69.66,101.90 C 72.06,99.10 74.68,96.36 77.49,93.81 C 80.31,91.27 83.34,88.77 86.56,86.62 C 89.79,84.47 93.25,82.45 96.84,80.91 C 100.43,79.37 104.27,78.17 108.11,77.38 C 111.94,76.59 115.95,76.16 119.87,76.16 Z";

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
    lidL: useRef<SVGPathElement>(null),
    lidR: useRef<SVGPathElement>(null),
    pupilL: useRef<SVGGElement>(null),
    pupilR: useRef<SVGGElement>(null),
    sparkleL: useRef<SVGCircleElement>(null),
    sparkleR: useRef<SVGCircleElement>(null),
    browL: useRef<SVGPathElement>(null),
    browR: useRef<SVGPathElement>(null),
    specs: useRef<SVGGElement>(null),
    mouth: useRef<SVGPathElement>(null),
    cheekFace: useRef<SVGGElement>(null),
    cheekG: useRef<SVGGElement>(null),
    cheekL: useRef<SVGEllipseElement>(null),
    cheekR: useRef<SVGEllipseElement>(null),
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
      // panda fully gone by h≈0.85 so the settling spring never leaves a ghost
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

      // breath + posture + squash-and-stretch.
      //
      // VOLUME IS PRESERVED: x is the reciprocal of y, so squashing widens by
      // exactly as much as it flattens and the panda never appears to gain or
      // lose mass. The anchor is the FLOOR (y=288), not the centre — a body
      // that squashes about its middle floats; one that squashes about its
      // base plants, which is where the weight reads from.
      const sq = f.squash;
      const sy = (1 + f.breath * 0.014 + (f.posture - 0.5) * 0.03) * (1 - sq * 0.2);
      const sx = (1 - f.breath * 0.007) / sy;
      r.body.current!.setAttribute(
        "transform",
        `rotate(${(f.bodyLean * 0.5).toFixed(2)} 120 282) translate(120 288) scale(${sx.toFixed(4)} ${sy.toFixed(4)}) translate(-120 -288)`,
      );

      // grounding: shadow reacts to hop height (Pixar weight cue)
      const air = Math.min(1, Math.abs(f.hopY) / 20);
      r.shadow.current!.setAttribute("rx", (62 - air * 14).toFixed(1));
      r.shadow.current!.setAttribute("opacity", (0.1 - air * 0.05).toFixed(3));

      const wag = Math.sin(f.tailWagPhase) * (3 + f.wagAmount * 22);
      r.tail.current!.setAttribute("transform", `rotate(${(f.tailCurl * 16 - 6 + wag).toFixed(2)} 190 238)`);

      // ears scale and swivel about their BASE, where they meet the skull —
      // pivoting at the lobe would make the whole ear slide off the head
      const es = f.earScale.toFixed(3);
      const { pivotLx, pivotRx, pivotY } = RIG.ear;
      r.earL.current!.setAttribute(
        "transform",
        `translate(${pivotLx} ${pivotY}) scale(${es}) translate(${-pivotLx} ${-pivotY}) rotate(${(-f.earL * 0.8).toFixed(2)} ${pivotLx} ${pivotY})`,
      );
      r.earR.current!.setAttribute(
        "transform",
        `translate(${pivotRx} ${pivotY}) scale(${es}) translate(${-pivotRx} ${-pivotY}) rotate(${(f.earR * 0.8).toFixed(2)} ${pivotRx} ${pivotY})`,
      );

      const fx = f.gazeX * 4.2;
      const fy = f.gazeY * 2.6 + f.headDrop + f.nodY;
      const headXf = `translate(${fx.toFixed(2)} ${fy.toFixed(2)}) rotate(${f.headTilt.toFixed(2)} ${RIG.head.x} ${RIG.head.y})`;
      r.face.current!.setAttribute("transform", headXf);
      // the cheeks sit in a different layer (under the suit) but belong to the
      // same head, so they take the identical transform
      r.cheekFace.current!.setAttribute("transform", headXf);

      const eo = Math.max(0.04, Math.min(1.15, f.eyeOpen));
      r.eyeL.current!.setAttribute("transform", `translate(${RIG.eye.lx} ${RIG.eye.y}) scale(1 ${eo.toFixed(3)}) translate(${-RIG.eye.lx} ${-RIG.eye.y})`);
      r.eyeR.current!.setAttribute("transform", `translate(${RIG.eye.rx} ${RIG.eye.y}) scale(1 ${eo.toFixed(3)}) translate(${-RIG.eye.rx} ${-RIG.eye.y})`);
      // A shut dark eye would vanish inside the black patch, so the closing
      // lid is drawn as its own pale arc that fades in as the eye goes flat.
      const lid = Math.max(0, Math.min(1, 1 - eo * 3.2)).toFixed(3);
      r.lidL.current!.setAttribute("opacity", lid);
      r.lidR.current!.setAttribute("opacity", lid);

      const px = f.gazeX * 2.2, py = f.gazeY * 1.7;
      const ps = f.pupilScale.toFixed(3);
      r.pupilL.current!.setAttribute("transform", `translate(${px.toFixed(2)} ${py.toFixed(2)}) translate(${RIG.eye.lx} ${RIG.eye.y}) scale(${ps}) translate(${-RIG.eye.lx} ${-RIG.eye.y})`);
      r.pupilR.current!.setAttribute("transform", `translate(${px.toFixed(2)} ${py.toFixed(2)}) translate(${RIG.eye.rx} ${RIG.eye.y}) scale(${ps}) translate(${-RIG.eye.rx} ${-RIG.eye.y})`);
      r.sparkleL.current!.setAttribute("opacity", (0.5 + f.sparkle * 0.5).toFixed(2));
      r.sparkleR.current!.setAttribute("opacity", (0.5 + f.sparkle * 0.5).toFixed(2));

      // brows: raise + sorrow (inner-up) + furrow (inner-down, draw in) +
      // LENGTH variation (raised brows lengthen, furrowed brows shorten).
      // Rest length is the reference's 9.5, so the deltas stay proportionate.
      const by = RIG.brow.y;
      const braise = -f.browRaise * 4;
      const furrowIn = f.browFurrow * 1.8;
      const bLen = RIG.brow.len * (1 + f.browRaise * 0.22 - f.browFurrow * 0.2 + f.browSorrow * 0.1);
      const bArc = -4.8 - f.browRaise * 2 + f.browFurrow * 2.4;
      r.browL.current!.setAttribute("d", `M ${(RIG.brow.lx - bLen / 2).toFixed(2)},${by} q ${(bLen / 2).toFixed(2)},${bArc.toFixed(2)} ${bLen.toFixed(2)},-1`);
      r.browR.current!.setAttribute("d", `M ${(RIG.brow.rx + bLen / 2).toFixed(2)},${by} q ${(-bLen / 2).toFixed(2)},${bArc.toFixed(2)} ${(-bLen).toFixed(2)},-1`);
      r.browL.current!.setAttribute(
        "transform",
        `translate(${furrowIn.toFixed(2)} ${braise.toFixed(2)}) rotate(${(f.browSorrow * 16 - f.browFurrow * 13).toFixed(2)} ${RIG.brow.lx} ${by})`,
      );
      r.browR.current!.setAttribute(
        "transform",
        `translate(${(-furrowIn).toFixed(2)} ${braise.toFixed(2)}) rotate(${(-f.browSorrow * 16 + f.browFurrow * 13).toFixed(2)} ${RIG.brow.rx} ${by})`,
      );

      r.specs.current?.setAttribute("transform", `translate(${(f.specJiggle * 0.6).toFixed(2)} ${(Math.abs(f.specJiggle) * 0.5 + f.pawLift * 1.5).toFixed(2)})`);

      // ONE mouth element, driven by THREE independent axes so the shape —
      // not just the smile depth — changes with the emotion:
      //   curve  corners rise and the twin lobes deepen; negative inverts the
      //          lobes and drops the corners into a frown
      //   wide   corner spread — pursed "thinking" vs stretched "celebrating"
      //   open   the jaw drops, and it drops most at the CENTRE, so the
      //          interior opens as an offset lip rather than a symmetric lens
      // The outgoing and return edges are generated by the same function, so
      // at open=0 they coincide exactly and a shut mouth is a single line.
      const cu = f.mouthCurve;
      const mo = f.mouthOpen;
      const mw = RIG.mouth.w * (1 + f.mouthWide * 0.32 - mo * 0.1);
      const y0 = RIG.mouth.y;
      const xl = 120 - mw / 2, xr = 120 + mw / 2;
      // Rest geometry is the reference's: lobes ~3.9 deep with the corners
      // barely lifted. Lifting the corners hard is what turns a soft panda
      // smile into a cartoon "W", so that coefficient stays small.
      const yCorner = y0 - Math.max(0, cu) * 1.2 + Math.max(0, -cu) * 1.8;
      // a frown collapses the twin lobes into one arc lifted at the middle
      const lobe = 3 + cu * 2.6;
      const yMid = y0 - Math.max(0, -cu) * 3.6;
      // control y that forces a quadratic through `depth` at its midpoint
      const ctrl = (ya: number, yb: number, depth: number) => 2 * (y0 + depth) - (ya + yb) / 2;
      /**
       * The mouth line, dropped by `d` — d=0 is the upper lip, d>0 the lower.
       * The twin lobes fade out as the jaw drops: a lower lip that kept them
       * would hang lower at the quarters than at the centre, which reads as a
       * beard rather than an open mouth. Wide open, it is a single bowl.
       */
      const edge = (d: number) => {
        const flat = Math.min(1, d / 6);
        return {
          yc: yCorner + d * 0.25,
          ym: yMid + d,
          yq: ctrl(yCorner + d * 0.25, yMid + d, lobe * (1 - flat) + d * 0.55),
        };
      };
      const lipU = edge(0);
      const lipL = edge(mo * 9);
      const q1 = (120 - mw / 4).toFixed(2), q2 = (120 + mw / 4).toFixed(2);
      r.mouth.current!.setAttribute(
        "d",
        `M ${xl.toFixed(2)},${lipU.yc.toFixed(2)}` +
          ` Q ${q1},${lipU.yq.toFixed(2)} 120,${lipU.ym.toFixed(2)}` +
          ` Q ${q2},${lipU.yq.toFixed(2)} ${xr.toFixed(2)},${lipU.yc.toFixed(2)}` +
          // …and back along the lower lip, right to left
          ` L ${xr.toFixed(2)},${lipL.yc.toFixed(2)}` +
          ` Q ${q2},${lipL.yq.toFixed(2)} 120,${lipL.ym.toFixed(2)}` +
          ` Q ${q1},${lipL.yq.toFixed(2)} ${xl.toFixed(2)},${lipL.yc.toFixed(2)} Z`,
      );
      r.mouth.current!.setAttribute("fill-opacity", mo > 0.04 ? "0.92" : "0");

      // cheeks: opacity + puff scale + emotional color temperature
      const cc = cheekColor(Math.max(0, Math.min(1, f.cheekWarm)));
      const puff = (1 + f.cheekPuff * 0.3).toFixed(3);
      r.cheekG.current!.setAttribute("opacity", (0.25 + f.cheek * 0.6).toFixed(2));
      r.cheekL.current!.setAttribute("fill", cc);
      r.cheekR.current!.setAttribute("fill", cc);
      r.cheekL.current!.setAttribute("transform", `translate(${RIG.cheek.lx} ${RIG.cheek.y}) scale(${puff}) translate(${-RIG.cheek.lx} ${-RIG.cheek.y})`);
      r.cheekR.current!.setAttribute("transform", `translate(${RIG.cheek.rx} ${RIG.cheek.y}) scale(${puff}) translate(${-RIG.cheek.rx} ${-RIG.cheek.y})`);

      // painted mitts rest IN FRONT at tie level, just below the chin, not
      // at the sides — celebration > spectacle-adjust > meditate > chest > rest
      const lift = f.pawLift, up = f.armsUp, chest = f.pawChest, med = f.pawMeditate;
      let rx = 0, ry = 0, rrot = 0, lx = 0, ly = 0, lrot = 0;
      if (up > 0.01) {
        rx = 12 * up; ry = -34 * up; rrot = 34 * up;
        lx = -12 * up; ly = -34 * up; lrot = -34 * up;
      } else if (lift > 0.01) {
        rx = -5 * lift; ry = -26 * lift; rrot = -20 * lift;
      } else if (med > 0.01) {
        rx = 8 * med; ry = 3 * med; rrot = -12 * med;
        lx = -8 * med; ly = 3 * med; lrot = 12 * med;
      } else if (chest > 0.01) {
        rx = -5 * chest; ry = -9 * chest; rrot = -24 * chest;
      }
      const shoulderY = (RIG.paw.y - 20).toFixed(1);
      r.pawR.current!.setAttribute("transform", `translate(${rx.toFixed(2)} ${ry.toFixed(2)}) rotate(${rrot.toFixed(2)} ${RIG.paw.rx + 10} ${shoulderY})`);
      r.pawL.current!.setAttribute("transform", `translate(${lx.toFixed(2)} ${ly.toFixed(2)}) rotate(${lrot.toFixed(2)} ${RIG.paw.lx - 10} ${shoulderY})`);

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
  const bodyLight = shade(body, 0.5);
  const bodyDark = shade(body, -0.1);
  const bodyDeep = shade(body, -0.32);
  const suitDark = shade(suit, -0.25);
  const patchInk = "#141519";
  const ink = "#22232A";
  const suitUrl = accessory === "tie" ? suitTieUrl : suitPlainUrl;

  const snoutH = RIG.snout.w / RIG.snout.aspect;
  const pawH = RIG.paw.w / RIG.paw.aspect;
  const erx = RIG.eye.rx_;
  const ery = RIG.eye.ry_;

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
        <radialGradient id="zz-body" cx="0.38" cy="0.24" r="0.92">
          <stop offset="0%" stopColor={bodyLight} />
          <stop offset="62%" stopColor={body} />
          <stop offset="100%" stopColor={bodyDark} />
        </radialGradient>
        <radialGradient id="zz-ear" cx="0.36" cy="0.26" r="0.9">
          <stop offset="0%" stopColor="#2F3038" />
          <stop offset="100%" stopColor="#0E0F12" />
        </radialGradient>
        <radialGradient id="zz-patch" cx="0.4" cy="0.3" r="0.95">
          <stop offset="0%" stopColor="#26272E" />
          <stop offset="100%" stopColor={patchInk} />
        </radialGradient>
        <radialGradient id="zz-eye" cx="0.36" cy="0.3" r="0.85">
          <stop offset="0%" stopColor="#4A4854" />
          <stop offset="100%" stopColor="#1E1D24" />
        </radialGradient>
        {/* The rolled-up bundle takes the suit's color. */}
        <radialGradient id="zz-bundle" cx="0.42" cy="0.3" r="0.9">
          <stop offset="0%" stopColor={shade(suit, 0.3)} />
          <stop offset="100%" stopColor={suitDark} />
        </radialGradient>
        {/* Soft key light on the upper-left of the felt. */}
        <filter id="zz-soft" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
        <filter id="zz-soft2" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
        {/* Bevels the charcoal mitts so they read against the charcoal suit:
            a lit edge up-left, a cast shadow down-right. */}
        <filter id="zz-mitt" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="1.2" dy="2" stdDeviation="1.5" floodColor="#000" floodOpacity="0.6" />
          <feDropShadow dx="-0.7" dy="-0.9" stdDeviation="0.5" floodColor="#8E8F98" floodOpacity="0.85" />
        </filter>
        <clipPath id="zz-bodyclip">
          <path d={BODY_PATH} />
        </clipPath>
        {/* Alpha mask so a suit tint only lands on painted fabric. */}
        <mask id="zz-suitmask" style={{ maskType: "alpha" }}>
          <image href={suitUrl} x={RIG.suit.x} y={RIG.suit.y} width={RIG.suit.w} height={RIG.suit.h} />
        </mask>
      </defs>

      <g ref={refs.root}>
        <ellipse ref={refs.shadow} cx="120" cy="294" rx="62" ry="7" fill="#000" opacity="0.10" />

        {/* Compact cloth bundle shown in the hide pose. */}
        <g ref={refs.bundle} opacity="0">
          <ellipse cx="120" cy="274" rx="24" ry="17" fill="url(#zz-bundle)" />
          <ellipse cx="113" cy="268" rx="7" ry="5" fill="#E3E5E9" opacity="0.7" />
        </g>

        <g ref={refs.cat}>
          {/* stubby panda tail — barely clears the silhouette from the front,
              but still carries the director's wag */}
          <g ref={refs.tail}>
            <ellipse cx="190" cy="248" rx="8.5" ry="6.5" fill={shade(suit, -0.1)} />
            <ellipse cx="192" cy="246" rx="3.6" ry="2.6" fill={shade(suit, 0.22)} opacity="0.7" />
          </g>

          <g ref={refs.body}>
            {/* painted ear caps — behind the head, so only the outer arc
                shows and the tapered root tucks under the skull */}
            <g ref={refs.earL}>
              <image href={earUrl} x={RIG.ear.lx} y={RIG.ear.y} width={RIG.ear.w} height={RIG.ear.h} />
            </g>
            <g ref={refs.earR}>
              <g transform={`translate(${2 * (RIG.ear.rx + RIG.ear.w / 2)} 0) scale(-1 1)`}>
                <image href={earUrl} x={RIG.ear.rx} y={RIG.ear.y} width={RIG.ear.w} height={RIG.ear.h} />
              </g>
            </g>

            {/* cream felt body traced from the source art — the ink line is
                stroked INSIDE the clip so the body never grows past the
                silhouette the painted suit was registered against */}
            <path d={BODY_PATH} fill="url(#zz-body)" />
            <g clipPath="url(#zz-bodyclip)">
              <ellipse cx="88" cy="112" rx="34" ry="26" fill="#FFF" opacity="0.34" filter="url(#zz-soft)" />
              {/* rim light down the shaded side, opposite the key */}
              <ellipse cx="177" cy="132" rx="15" ry="48" fill="#FFF" opacity="0.2" filter="url(#zz-soft)" transform="rotate(-14 177 132)" />
              <ellipse cx="120" cy="292" rx="70" ry="26" fill={bodyDeep} opacity="0.22" filter="url(#zz-soft)" />
              <path d={BODY_PATH} fill="none" stroke={shade(body, -0.42)} strokeWidth="2.2" />
            </g>

            {/* Cheeks — colour + puff driven by emotion. They live BEFORE the
                suit on purpose: blush belongs to fur, so when the head drops or
                the cheeks puff past the chin line the collar has to cover them.
                Painted over the fabric they read as a stain on the jacket. They
                still ride the head, so `apply` gives them the face transform. */}
            <g ref={refs.cheekFace}>
              <g ref={refs.cheekG} opacity="0.4">
                <ellipse ref={refs.cheekL} cx={RIG.cheek.lx} cy={RIG.cheek.y} rx="7" ry="5" fill="#F2C7C0" />
                <ellipse ref={refs.cheekR} cx={RIG.cheek.rx} cy={RIG.cheek.y} rx="7" ry="5" fill="#F2C7C0" />
              </g>
            </g>

            {/* painted suit — charcoal fabric, white collar, brass buttons */}
            <g style={{ isolation: "isolate" }}>
              <image href={suitUrl} x={RIG.suit.x} y={RIG.suit.y} width={RIG.suit.w} height={RIG.suit.h} />
              <rect
                x={RIG.suit.x} y={RIG.suit.y} width={RIG.suit.w} height={RIG.suit.h}
                fill={suit} mask="url(#zz-suitmask)" style={{ mixBlendMode: "screen" }}
              />
            </g>
            {/* the head sits in front of the collar, so it drops a soft
                occlusion onto the fabric — masked to the suit so the fur above
                the chin line stays clean */}
            <g mask="url(#zz-suitmask)">
              <path d="M 44,138 Q 120,194 196,138" fill="none" stroke="#000" strokeWidth="9" opacity="0.3" filter="url(#zz-soft2)" />
            </g>

            {accessory === "bowtie" && (
              <g fill="#1D1E23">
                <path d="M 119,170 L 106,163 L 106,179 Z" />
                <path d="M 121,170 L 134,163 L 134,179 Z" />
                <ellipse cx="120" cy="171" rx="4.2" ry="3.8" fill="#2A2B31" />
              </g>
            )}
            {accessory === "scarf" && (
              <g>
                <path d="M 101,161 C 110,171 130,171 139,161 L 137,175 C 127,182 113,182 103,175 Z" fill="#C96F52" />
                <path d="M 113,175 L 120,175 L 118,199 L 109,197 Z" fill="#B8603F" />
              </g>
            )}

            {/* face */}
            <g ref={refs.face}>
              {/* painted eye patches — panda anatomy, they never blink. The
                  sheet carries the art's own tilt, ink rim and soft interior,
                  so there is no angle left for the rig to approximate. */}
              <image href={patchUrl} x={RIG.patch.lx} y={RIG.patch.y} width={RIG.patch.w} height={RIG.patch.h} />
              <g transform={`translate(${2 * (RIG.patch.rx + RIG.patch.w / 2)} 0) scale(-1 1)`}>
                <image href={patchUrl} x={RIG.patch.rx} y={RIG.patch.y} width={RIG.patch.w} height={RIG.patch.h} />
              </g>

              <path ref={refs.browL} d="" stroke={ink} strokeWidth={RIG.brow.weight} strokeLinecap="round" fill="none" />
              <path ref={refs.browR} d="" stroke={ink} strokeWidth={RIG.brow.weight} strokeLinecap="round" fill="none" />

              {/* glossy eyes, kept from the cat rig, tilted with the patch and
                  set where the art puts them: up and toward the nose. Both
                  highlights read INWARD, mirrored — that pair of catchlights is
                  what makes the two eyes look like one gaze. */}
              {(
                [
                  [RIG.eye.lx, 1, refs.eyeL, refs.pupilL, refs.sparkleL],
                  [RIG.eye.rx, -1, refs.eyeR, refs.pupilR, refs.sparkleR],
                ] as const
              ).map(([ex, dir, eyeRef, pupilRef, sparkRef], i) => (
                <g key={i} ref={eyeRef}>
                  <g transform={`rotate(${-dir * RIG.eye.tilt} ${ex} ${RIG.eye.y})`}>
                    <ellipse cx={ex} cy={RIG.eye.y} rx={erx} ry={ery} fill="url(#zz-eye)" />
                    <g ref={pupilRef}>
                      <ellipse cx={ex} cy={RIG.eye.y} rx={erx} ry={ery} fill="url(#zz-eye)" />
                      <circle cx={ex + dir * 0.45} cy={RIG.eye.y - 2.3} r={1.25} fill="#FFF" opacity="0.97" />
                      <circle ref={sparkRef} cx={ex - dir * 1.9} cy={RIG.eye.y + 2.4} r={0.72} fill="#FFF" opacity="0.5" />
                    </g>
                  </g>
                </g>
              ))}

              {([[RIG.eye.lx, refs.lidL], [RIG.eye.rx, refs.lidR]] as const).map(([ex, lidRef], i) => (
                <path
                  key={i} ref={lidRef} opacity="0" fill="none" stroke={bodyLight} strokeWidth={1.5} strokeLinecap="round"
                  d={`M ${(ex - erx * 1.5).toFixed(2)},${(RIG.eye.y + 1.2).toFixed(2)} q ${(erx * 1.5).toFixed(2)},-4.6 ${(erx * 3).toFixed(2)},0`}
                />
              ))}

              {/* round spectacles — an ACCESSORY (add/remove), never anatomy */}
              {appearance.glasses && (
                <g ref={refs.specs}>
                  <circle cx={RIG.eye.lx} cy={RIG.eye.y} r="16.5" fill="none" stroke="#6C7382" strokeWidth="2.6" />
                  <circle cx={RIG.eye.rx} cy={RIG.eye.y} r="16.5" fill="none" stroke="#6C7382" strokeWidth="2.6" />
                  <path d={`M ${RIG.eye.lx + 16.5},${RIG.eye.y - 2} Q 120,${RIG.eye.y - 6} ${RIG.eye.rx - 16.5},${RIG.eye.y - 2}`} fill="none" stroke="#6C7382" strokeWidth="2.4" />
                  <path d={`M ${RIG.eye.lx - 16.5},${RIG.eye.y - 2} L 60,${RIG.eye.y - 7}`} stroke="#6C7382" strokeWidth="2.2" strokeLinecap="round" />
                  <path d={`M ${RIG.eye.rx + 16.5},${RIG.eye.y - 2} L 180,${RIG.eye.y - 7}`} stroke="#6C7382" strokeWidth="2.2" strokeLinecap="round" />
                </g>
              )}

              {/* painted snout, then the thread-line mouth beneath it */}
              <image href={snoutUrl} x={120 - RIG.snout.w / 2} y={RIG.snout.y - snoutH / 2} width={RIG.snout.w} height={snoutH} />
              <path ref={refs.mouth} d="" fill="#202126" fillOpacity="0" stroke="#202126" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
            </g>

            {/* painted mitts, mirrored from the one source limb */}
            <g ref={refs.pawL} filter="url(#zz-mitt)">
              <g transform={`rotate(${-RIG.paw.tilt} ${RIG.paw.lx} ${RIG.paw.y}) translate(${2 * RIG.paw.lx} 0) scale(-1 1)`}>
                <image href={armUrl} x={RIG.paw.lx - RIG.paw.w / 2} y={RIG.paw.y - pawH / 2} width={RIG.paw.w} height={pawH} />
              </g>
            </g>
            <g ref={refs.pawR} filter="url(#zz-mitt)">
              <g transform={`rotate(${RIG.paw.tilt} ${RIG.paw.rx} ${RIG.paw.y})`}>
                <image href={armUrl} x={RIG.paw.rx - RIG.paw.w / 2} y={RIG.paw.y - pawH / 2} width={RIG.paw.w} height={pawH} />
              </g>
            </g>
          </g>

          <text ref={refs.zzz} x="182" y="86" fontSize="20" fontFamily="Georgia, serif" fill="#9DB0C2" opacity="0">
            z<tspan dx="4" dy="-10" fontSize="14">z</tspan>
          </text>
        </g>
      </g>
    </svg>
  );
}
