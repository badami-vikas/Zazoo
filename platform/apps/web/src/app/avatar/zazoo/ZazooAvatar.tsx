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
import { MOUTH_PARTS, MOUTH_SHAPES, BROW_PARTS, BROW_SHAPES, LOOP_N, type Loop } from "./parts";
import { DEFAULT_SPECIES, type ZazooSpecies } from "./species";

export interface ZazooAppearance {
  /** Base felt color of the panda's fur. */
  body: string;
  /** Suit color — screened over the painted charcoal fabric. */
  suit: string;
  /** Tie color. The tie is its own painted layer, so it tints independently. */
  tie: string;
  accessory: "tie" | "bowtie" | "scarf" | "none";
  /** Spectacles are an accessory, not anatomy. */
  glasses: boolean;
}

export const DEFAULT_APPEARANCE: ZazooAppearance = {
  body: "#FAF1E7",
  suit: "#7E2732",
  tie: "#E8B93C",
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
  // brow anchor; the shape itself comes from the sheet, already scaled so the
  // default `arch` matches the reference's 9.48 × 4.87
  brow: { lx: 91, rx: 149, y: 106.4 },
  snout: { y: 130.7, w: 17.81, aspect: 1.499 },
  // the lip line the sheet's mouth parts hang from
  mouth: { y: 140.3 },
  // high and inboard, so the blush lands on cheek fur and stays clear of the
  // collar even at full head-drop
  cheek: { lx: 76, rx: 164, y: 143 },
  head: { x: 120, y: 152 },
  // mitts rest LOW and quiet at the belly — the reference art is a clean egg,
  // so at rest the hands stay out of the statement; every gesture channel
  // LIFTS them from here into one meaningful stage position and back
  paw: { lx: 99, rx: 141, y: 212, w: 24, aspect: 1.133, tilt: 16 },
  suit: { x: 40.54, y: 137.17, w: 159.05, h: 150.64 },
  // lifted off the same 3840² canvas as the suit, so it drops back into the
  // collar with no alignment of its own
  tie: { x: 109.04, y: 165.87, w: 21.71, h: 41.27 },
} as const;

// The sheet's parts, indexed to match the director's weight vectors.
const mouthOuter = MOUTH_SHAPES.map((s) => MOUTH_PARTS[s].outer);
const mouthInner = MOUTH_SHAPES.map((s) => MOUTH_PARTS[s].inner);
const browLoops = BROW_SHAPES.map((s) => BROW_PARTS[s] as Loop);

/** Tongue, sampled from the fill-colour mouths on the parts sheet. */
const TONGUE = "#E2646F";

/** Body silhouette traced from `Avatar/base front shape.png`. */
const BODY_PATH =
  "M 119.87,76.16 C 123.79,76.16 127.80,76.60 131.64,77.38 C 135.48,78.16 139.32,79.33 142.92,80.85 C 146.51,82.36 149.99,84.37 153.22,86.49 C 156.46,88.62 159.50,91.11 162.34,93.62 C 165.19,96.13 167.84,98.82 170.29,101.57 C 172.74,104.32 174.98,107.21 177.05,110.11 C 179.11,113.02 181.02,115.97 182.68,119.00 C 184.33,122.03 185.74,125.18 186.98,128.29 C 188.22,131.40 189.17,134.59 190.12,137.67 C 191.07,140.74 191.90,143.76 192.69,146.74 C 193.48,149.72 194.23,152.64 194.87,155.56 C 195.51,158.49 196.05,161.40 196.54,164.31 C 197.03,167.22 197.47,170.11 197.82,173.02 C 198.18,175.94 198.45,178.86 198.66,181.81 C 198.86,184.76 199.00,187.72 199.04,190.73 C 199.09,193.73 199.04,196.76 198.91,199.85 C 198.79,202.93 198.59,206.06 198.27,209.24 C 197.95,212.42 197.54,215.65 196.99,218.95 C 196.44,222.24 195.78,225.59 194.95,228.98 C 194.12,232.38 193.18,235.86 191.99,239.32 C 190.79,242.77 189.48,246.36 187.78,249.71 C 186.08,253.07 184.07,256.40 181.78,259.43 C 179.48,262.47 176.82,265.33 173.99,267.94 C 171.17,270.56 168.07,273.00 164.81,275.13 C 161.56,277.26 158.06,279.13 154.48,280.72 C 150.90,282.30 147.14,283.61 143.34,284.63 C 139.54,285.65 135.61,286.34 131.70,286.81 C 127.79,287.28 123.81,287.52 119.87,287.45 C 115.94,287.39 111.97,287.02 108.08,286.43 C 104.20,285.84 100.31,285.04 96.56,283.92 C 92.82,282.81 89.12,281.40 85.60,279.75 C 82.08,278.10 78.65,276.19 75.45,274.04 C 72.26,271.89 69.23,269.43 66.44,266.85 C 63.65,264.26 61.02,261.46 58.71,258.51 C 56.39,255.55 54.38,252.32 52.57,249.10 C 50.77,245.89 49.23,242.54 47.89,239.21 C 46.55,235.88 45.46,232.49 44.55,229.13 C 43.64,225.78 43.00,222.40 42.43,219.10 C 41.87,215.80 41.47,212.55 41.18,209.34 C 40.89,206.14 40.76,202.98 40.70,199.88 C 40.64,196.77 40.70,193.73 40.83,190.71 C 40.96,187.70 41.19,184.74 41.47,181.81 C 41.75,178.87 42.09,175.98 42.50,173.09 C 42.90,170.20 43.37,167.34 43.91,164.47 C 44.44,161.60 45.03,158.74 45.71,155.86 C 46.38,152.97 47.14,150.10 47.95,147.17 C 48.77,144.24 49.63,141.30 50.58,138.27 C 51.54,135.24 52.47,132.11 53.67,129.01 C 54.86,125.91 56.17,122.74 57.74,119.68 C 59.31,116.61 61.11,113.58 63.10,110.62 C 65.09,107.66 67.26,104.70 69.66,101.90 C 72.06,99.10 74.68,96.36 77.49,93.81 C 80.31,91.27 83.34,88.77 86.56,86.62 C 89.79,84.47 93.25,82.45 96.84,80.91 C 100.43,79.37 104.27,78.17 108.11,77.38 C 111.94,76.59 115.95,76.16 119.87,76.16 Z";

/**
 * Vector suit, drawn to the reference's geometry and clipped to the egg —
 * the jacket's top edge rises over the shoulders and dips into the collar,
 * exactly where the painted sheet's silhouette sat.
 */
const SUIT_JACKET =
  "M 34,153 Q 70,139 96,147 Q 120,161 144,147 Q 170,139 206,153 L 206,296 L 34,296 Z";

/**
 * Blend a family of traced loops by weight into `dst`, and return the path
 * for it — scaled about the lip line and placed at (cx, y).
 *
 * Loops are pre-corresponded point-for-point, so this is a plain weighted sum:
 * no shape matching, no re-parameterisation, and the result is always a valid
 * in-between of the artist's parts rather than an invented shape.
 */
function blendPath(
  loops: readonly Loop[], w: readonly number[], dst: Float64Array,
  cx: number, y: number, sx: number, sy: number,
): string {
  dst.fill(0);
  for (let s = 0; s < loops.length; s++) {
    const k = w[s];
    if (k < 0.0005) continue;
    const L = loops[s];
    for (let i = 0; i < dst.length; i++) dst[i] += L[i] * k;
  }
  let d = "";
  for (let i = 0; i < LOOP_N; i++) {
    d += `${i ? "L" : "M"}${(cx + dst[i * 2] * sx).toFixed(2)},${(y + dst[i * 2 + 1] * sy).toFixed(2)}`;
  }
  return d + "Z";
}

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
  /** Which character is on the rig — a small delta on the shared baseline. */
  species?: ZazooSpecies;
}

export function ZazooAvatar({ director, width = 340, appearance = DEFAULT_APPEARANCE, species = DEFAULT_SPECIES }: Props) {
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
    tongueG: useRef<SVGGElement>(null),
    tongueFill: useRef<SVGPathElement>(null),
    cheekFace: useRef<SVGGElement>(null),
    cheekG: useRef<SVGGElement>(null),
    cheekL: useRef<SVGEllipseElement>(null),
    cheekR: useRef<SVGEllipseElement>(null),
    pawL: useRef<SVGGElement>(null),
    pawR: useRef<SVGGElement>(null),
    whiskerL: useRef<SVGGElement>(null),
    whiskerR: useRef<SVGGElement>(null),
    beakUpper: useRef<SVGGElement>(null),
    beakLower: useRef<SVGGElement>(null),
    shadow: useRef<SVGEllipseElement>(null),
    zzz: useRef<SVGTextElement>(null),
  };

  useEffect(() => {
    let raf = 0;
    // scratch for the shape blends — allocated once per mounted avatar so the
    // animation loop never touches the allocator
    const mouthBufA = new Float64Array(LOOP_N * 2);
    const mouthBufB = new Float64Array(LOOP_N * 2);
    const browBuf = new Float64Array(LOOP_N * 2);

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
      // Amplitude is sized for the SMALLEST place this rig is drawn: the 84px
      // desktop companion, where the old 3.5% breath moved the silhouette by
      // about one pixel and read as a still image. At 6% the body visibly
      // rises and falls there and still stays a breath, not a pulse, at lab
      // size.
      const sq = f.squash;
      const sy = (1 + f.breath * 0.06 + (f.posture - 0.5) * 0.03) * (1 - sq * 0.2);
      const sx = (1 - f.breath * 0.03) / sy;
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

      // eyes lead, head follows: the face turns on the LAGGED gaze while the
      // pupils (below) take the raw one — a saccade reads as a decision, not
      // as the whole head being dragged by the cursor
      const fx = f.headGazeX * 4.2;
      const fy = f.headGazeY * 2.6 + f.headDrop + f.nodY;
      const headXf = `translate(${fx.toFixed(2)} ${fy.toFixed(2)}) rotate(${f.headTilt.toFixed(2)} ${RIG.head.x} ${RIG.head.y})`;
      r.face.current!.setAttribute("transform", headXf);
      // the cheeks sit in a different layer (under the suit) but belong to the
      // same head, so they take the identical transform
      r.cheekFace.current!.setAttribute("transform", headXf);

      // fully-closable: 0 collapses the eye to nothing and the drawn lid arc
      // (opacity ramps in below) takes over — meditation is a CLOSED eye,
      // not a squint
      const eo = Math.max(0, Math.min(1.15, f.eyeOpen));
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

      // BROWS come from the sheet — the artist drew arch / perk / wave, and
      // the director picks between them. The rig only stretches the chosen
      // part (raised brows lengthen, furrowed ones shorten) and moves it;
      // it no longer invents a curve.
      const by = RIG.brow.y;
      const braise = -f.browRaise * 4;
      const furrowIn = f.browFurrow * 1.8;
      const bsx = 1 + f.browRaise * 0.2 - f.browFurrow * 0.18;
      const bsy = 1 + f.browRaise * 0.12 + f.browSorrow * 0.1;
      r.browL.current!.setAttribute("d", blendPath(browLoops, f.browW, browBuf, RIG.brow.lx, by, bsx, bsy));
      // the right brow is the same part mirrored — but NOT to the pixel. It
      // raises 94% as far and drifts a fraction of a degree with the breath:
      // perfect symmetry is the strongest "printed on" tell a face can give.
      r.browR.current!.setAttribute("d", blendPath(browLoops, f.browW, browBuf, RIG.brow.rx, by, -bsx, bsy * 0.97));
      r.browL.current!.setAttribute(
        "transform",
        `translate(${furrowIn.toFixed(2)} ${braise.toFixed(2)}) rotate(${(f.browSorrow * 16 - f.browFurrow * 13).toFixed(2)} ${RIG.brow.lx} ${by})`,
      );
      r.browR.current!.setAttribute(
        "transform",
        `translate(${(-furrowIn).toFixed(2)} ${(braise * 0.94 + f.breath * 0.22).toFixed(2)}) rotate(${(-f.browSorrow * 16 + f.browFurrow * 13 + f.breath * 0.6).toFixed(2)} ${RIG.brow.rx} ${by})`,
      );

      r.specs.current?.setAttribute("transform", `translate(${(f.specJiggle * 0.6).toFixed(2)} ${(Math.abs(f.specJiggle) * 0.5 + f.pawLift * 1.5).toFixed(2)})`);

      // MOUTH: a weighted blend of the artist's standard parts. The director
      // says which part; the weights arrive mid-morph, so what is drawn here
      // is a genuine in-between of two of the sheet's own shapes.
      //
      // Scale is anisotropic on purpose — `mouthScale` sizes the whole part
      // while the jaw stretches it vertically, so breathing and a slack jaw
      // read on the same shape without needing another traced part.
      const ms = f.mouthScale;
      const jaw = 1 + f.mouthOpen * 0.55;
      // beak species act with the mandible instead of the felt mouth: the
      // lower half drops with the jaw (talking flaps it), the upper half
      // tips up a touch, and mouthScale still sizes the whole beak
      if (r.beakLower.current) {
        const drop = Math.min(1.4, f.mouthOpen);
        r.beakLower.current.setAttribute("transform", `translate(0 ${(drop * 4.2).toFixed(2)})`);
        r.beakUpper.current!.setAttribute(
          "transform",
          `rotate(${(-drop * 6).toFixed(2)} 120 124.5) translate(120 128) scale(${ms.toFixed(3)}) translate(-120 -128)`,
        );
      }
      if (r.mouth.current) {
      r.mouth.current.setAttribute("d", blendPath(mouthOuter, f.mouthW, mouthBufA, 120, RIG.mouth.y, ms, ms * jaw));

      // …and the cavity, which is a speck on a closed mouth and the real
      // opening on an open one. The tongue is the cavity's OWN shape, shrunk
      // about its centre and dropped toward the jaw — deriving it from the
      // cavity rather than clipping an ellipse to it means it can never spill
      // past the lips no matter which parts are being blended.
      blendPath(mouthInner, f.mouthW, mouthBufB, 120, RIG.mouth.y, ms, ms * jaw);
      let iy0 = Infinity, iy1 = -Infinity, ix0 = Infinity, ix1 = -Infinity;
      for (let i = 0; i < LOOP_N; i++) {
        const x = mouthBufB[i * 2] * ms, y = mouthBufB[i * 2 + 1] * ms * jaw;
        if (x < ix0) ix0 = x;
        if (x > ix1) ix1 = x;
        if (y < iy0) iy0 = y;
        if (y > iy1) iy1 = y;
      }
      const openH = iy1 - iy0;
      // fades in with the opening, so it can never show on a shut mouth
      const tongueOn = Math.max(0, Math.min(1, (openH - 2.5) / 4));
      r.tongueG.current!.setAttribute("opacity", tongueOn.toFixed(3));
      if (tongueOn > 0.002) {
        const tcx = (ix0 + ix1) / 2, tcy = (iy0 + iy1) / 2;
        const drop = openH * 0.2;
        let td = "";
        for (let i = 0; i < LOOP_N; i++) {
          const x = tcx + (mouthBufB[i * 2] * ms - tcx) * 0.62;
          const y = tcy + (mouthBufB[i * 2 + 1] * ms * jaw - tcy) * 0.62 + drop;
          td += `${i ? "L" : "M"}${(120 + x).toFixed(2)},${(RIG.mouth.y + y).toFixed(2)}`;
        }
        r.tongueFill.current!.setAttribute("d", td + "Z");
      }
      }

      // cheeks: opacity + puff scale + emotional color temperature
      const cc = cheekColor(Math.max(0, Math.min(1, f.cheekWarm)));
      const puff = (1 + f.cheekPuff * 0.3).toFixed(3);
      r.cheekG.current!.setAttribute("opacity", (0.25 + f.cheek * 0.6).toFixed(2));
      r.cheekL.current!.setAttribute("fill", cc);
      r.cheekR.current!.setAttribute("fill", cc);
      r.cheekL.current!.setAttribute("transform", `translate(${RIG.cheek.lx} ${RIG.cheek.y}) scale(${puff}) translate(${-RIG.cheek.lx} ${-RIG.cheek.y})`);
      r.cheekR.current!.setAttribute("transform", `translate(${RIG.cheek.rx} ${RIG.cheek.y}) scale(${puff}) translate(${-RIG.cheek.rx} ${-RIG.cheek.y})`);

      // whiskers (whiskered species only) — pure secondary action, consuming
      // the director's whiskerSway/whiskerDroop channels: they float on the
      // idle air, and hang when the mood does. Signs differ because a left
      // whisker's tip is at -x, so the same on-screen "tips up" is +deg on
      // the left group and -deg on the right.
      if (r.whiskerL.current) {
        const tipsUp = f.whiskerSway - f.whiskerDroop * 13;
        r.whiskerL.current.setAttribute("transform", `rotate(${tipsUp.toFixed(2)} 98 138)`);
        r.whiskerR.current!.setAttribute("transform", `rotate(${(-tipsUp).toFixed(2)} 142 138)`);
      }

      // HAND CHOREOGRAPHY — every channel is a weighted offset from the quiet
      // rest pose, summed rather than switched. Channels are springed in the
      // director, so mid-transition the paws draw a real arc between stages
      // instead of teleporting when a priority ladder flips. At rest only the
      // breath moves them (a hand that is pixel-frozen reads as painted on).
      let rx = 0, ry = f.breath * 0.9, rrot = 0, lx = 0, ly = f.breath * 0.9, lrot = 0;
      const stage = (w: number, dxr: number, dyr: number, rr: number, dxl: number, dyl: number, rl: number) => {
        if (w < 0.005) return;
        rx += dxr * w; ry += dyr * w; rrot += rr * w;
        lx += dxl * w; ly += dyl * w; lrot += rl * w;
      };
      stage(f.pawChin, -12, -60, -26, -2, -4, -4); // right paw to the chin; left barely stirs
      stage(f.pawFold, -14, -28, -30, 14, -28, 30); // both meet at the chest
      stage(f.pawOpen, 8, -22, 44, -8, -22, -44); // palms turned out, offering
      stage(f.pawUp, 15, -68, 40, -15, -68, -40); // held celebration, cheek-high
      stage(f.pawDroop, 7, 8, -14, -7, 8, 14); // sleepy weight
      stage(f.pawMeditate, 8, 3, -12, -8, 3, 12);
      stage(f.pawChest, -5, -9, -24, 0, 0, 0);
      stage(f.armsUp, 12, -34, 34, -12, -34, -34); // hop throws them higher still
      stage(f.pawLift, -5, -26, -20, 0, 0, 0); // spectacle adjust
      stage(f.wave, 11, -48, 30, 0, -3, 0); // greeting…
      rrot += f.wave * f.waveOsc * 17; // …and the wave itself
      ry += f.pawTap; // thinking: the chin paw taps
      rx += f.fidgetX; lx -= f.fidgetX; // unsure: folded paws rub
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

  const { body, suit, tie, accessory } = appearance;
  const bodyLight = shade(body, 0.5);
  const bodyDark = shade(body, -0.1);
  const bodyDeep = shade(body, -0.32);
  const suitDark = shade(suit, -0.25);
  const patchInk = "#141519";
  const ink = "#22232A";
  const feltLine = shade(body, -0.42);

  /**
   * Vector felt ear, one per side, drawn at the same anchors the painted cap
   * uses so the existing ear pivots (scale/swivel at the skull) keep working.
   * `m` mirrors the x-offsets; everything else is shared.
   */
  const vectorEar = (side: "L" | "R") => {
    const ex = side === "L" ? 79 : 161;
    const m = side === "L" ? 1 : -1;
    const X = (dx: number) => (ex + m * dx).toFixed(1);
    const sz = species.earSize ?? 1;
    // headgear rides the ear groups on purpose: it shares the skull pivot,
    // so ear perks and listening scale carry it — cheap secondary life
    const antlers =
      species.horn === "antlers" ? (
        <g stroke="#9A7B54" strokeWidth="2.6" strokeLinecap="round" fill="none">
          <path d={`M ${X(7)},92 Q ${X(9)},72 ${X(16)},60`} />
          <path d={`M ${X(10)},76 Q ${X(4)},70 ${X(0)},70`} />
          <path d={`M ${X(13)},66 Q ${X(19)},62 ${X(22)},63`} />
        </g>
      ) : species.horn === "up" ? (
        // short felt horns curving up-and-in (goat / cow / bison)
        <path
          d={`M ${X(16)},92 Q ${X(14)},72 ${X(25)},62 Q ${X(24)},78 ${X(26)},92 Z`}
          fill="#D9CBB4" stroke={shade("#D9CBB4", -0.4)} strokeWidth="1.4"
        />
      ) : null;
    const scaled = (inner: React.ReactNode) =>
      sz === 1 ? (
        <>{antlers}{inner}</>
      ) : (
        <>
          {antlers}
          <g transform={`translate(${ex} 108) scale(${sz}) translate(${-ex} -108)`}>{inner}</g>
        </>
      );
    if (species.ears === "none") return antlers || null;
    if (species.ears === "point") {
      return scaled(
        <>
          <path
            d={`M ${X(-17)},112 Q ${X(-21)},88 ${X(-8)},72 Q ${X(-1)},64 ${X(6)},76 Q ${X(14)},92 ${X(11)},110 Z`}
            fill={body} stroke={feltLine} strokeWidth="2"
          />
          <path
            d={`M ${X(-10)},106 Q ${X(-12)},90 ${X(-4)},79 Q ${X(1)},74 ${X(5)},84 Q ${X(9)},94 ${X(7)},104 Z`}
            fill={species.earInner} opacity="0.85"
          />
        </>,
      );
    }
    if (species.ears === "tall") {
      return scaled(
        <g transform={`rotate(${m * -11} ${ex} 96)`}>
          <ellipse cx={ex} cy={58} rx={11.5} ry={34} fill={body} stroke={feltLine} strokeWidth="2" />
          <ellipse cx={ex} cy={61} rx={5.5} ry={24} fill={species.earInner} opacity="0.85" />
        </g>,
      );
    }
    if (species.ears === "drop") {
      // floppy ear hanging down-and-out (sheep / goat / cow / pig)
      return scaled(
        <g transform={`rotate(${m * -38} ${ex} 96)`}>
          <ellipse cx={ex - m * 4} cy={108} rx={8.5} ry={16.5} fill={body} stroke={feltLine} strokeWidth="2" />
          <ellipse cx={ex - m * 4} cy={110} rx={4.2} ry={10.5} fill={species.earInner} opacity="0.8" />
        </g>,
      );
    }
    if (species.ears === "side") {
      // low round ears at the sides of the head (ape family) — mostly
      // tucked behind the skull, only the outer arc shows
      return scaled(
        <>
          <circle cx={ex - m * 14} cy={128} r={13} fill={body} stroke={feltLine} strokeWidth="2" />
          <circle cx={ex - m * 14} cy={128} r={7} fill={species.earInner} opacity="0.8" />
        </>,
      );
    }
    if (species.ears === "fin") {
      // side fins where ears would be — they still perk and swivel on the
      // ear channels, which is exactly the secondary life a fish needs
      return scaled(
        <g transform={`rotate(${m * 14} ${ex} 140)`}>
          <path
            d={`M ${X(6)},130 Q ${X(-30)},122 ${X(-46)},142 Q ${X(-30)},162 ${X(4)},152 Z`}
            fill={bodyDark} stroke={feltLine} strokeWidth="1.6"
          />
          <path d={`M ${X(-14)},136 Q ${X(-28)},140 ${X(-34)},146`} fill="none" stroke={feltLine} strokeWidth="1" opacity="0.5" />
        </g>,
      );
    }
    // bud — small round felt ear (bear / rhino family)
    return scaled(
      <>
        <circle cx={ex} cy={89} r={15} fill={body} stroke={feltLine} strokeWidth="2" />
        <circle cx={ex} cy={89} r={8} fill={species.earInner} opacity="0.8" />
      </>,
    );
  };

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
          <feGaussianBlur stdDeviation="4.5" />
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
        {/* The suit is fully vector now, so tints are direct fills — no
            alpha masks, no screen blending, no raster sheets. */}
        <clipPath id="zz-suitclip">
          <path d={SUIT_JACKET} />
        </clipPath>
        <radialGradient id="zz-suitg" cx="0.42" cy="0.2" r="1.05">
          <stop offset="0%" stopColor={shade(suit, 0.14)} />
          <stop offset="55%" stopColor={suit} />
          <stop offset="100%" stopColor={shade(suit, -0.28)} />
        </radialGradient>
        <radialGradient id="zz-mittg" cx="0.38" cy="0.28" r="0.95">
          <stop offset="0%" stopColor="#34353E" />
          <stop offset="100%" stopColor="#17181D" />
        </radialGradient>
      </defs>

      <g ref={refs.root}>
        <ellipse ref={refs.shadow} data-layer="shadow" cx="120" cy="294" rx="62" ry="7" fill="#000" opacity="0.10" />

        {/* Compact cloth bundle shown in the hide pose. */}
        <g ref={refs.bundle} opacity="0">
          <ellipse cx="120" cy="274" rx="24" ry="17" fill="url(#zz-bundle)" />
          <ellipse cx="113" cy="268" rx="7" ry="5" fill="#E3E5E9" opacity="0.7" />
        </g>

        <g ref={refs.cat}>
          {/* tail — species delta on the same wag pivot. ALWAYS the animal's
              own color: a tail is anatomy, the suit is clothes. (Yes, pandas
              have tails — a short white stub, which is exactly what the felt
              stub in body color gives Zazoo.) */}
          <g ref={refs.tail} data-layer="tail">
            {species.tail === "curl" ? (
              <path
                d="M 186,254 Q 208,250 210,232 Q 211,220 200,219 Q 192,219 192,227"
                fill="none" stroke={bodyDark} strokeWidth="8" strokeLinecap="round"
              />
            ) : species.tail === "puff" ? (
              <>
                <circle cx="192" cy="248" r="9.5" fill={bodyLight} stroke={feltLine} strokeWidth="1.6" />
                <circle cx="189" cy="245" r="4" fill="#FFF" opacity="0.7" />
              </>
            ) : species.tail === "fan" ? (
              // small folded train — five felt feathers with eyespots,
              // rocking on the same wag pivot
              <g>
                {[-52, -26, 0, 26, 52].map((a, i) => (
                  <g key={a} transform={`rotate(${a + 14} 188 250)`}>
                    <ellipse cx="188" cy="234" rx="4.6" ry="12.5" fill={i % 2 ? shade(body, -0.22) : shade(body, 0.12)} stroke={feltLine} strokeWidth="1" />
                    <circle cx="188" cy="228" r="2" fill={shade(body, -0.5)} />
                    <circle cx="188" cy="228" r="0.9" fill={shade(body, 0.5)} />
                  </g>
                ))}
              </g>
            ) : species.tail === "bushy" ? (
              // squirrel — a tall S-curled plume rising behind the shoulder
              <g transform="translate(11 0)">
                <path
                  d="M 184,258 Q 214,252 216,220 Q 217,196 202,188 Q 190,183 186,194 Q 197,194 200,206 Q 203,224 188,236 Z"
                  fill={bodyDark} stroke={feltLine} strokeWidth="1.6" strokeLinejoin="round"
                />
                <path d="M 196,240 Q 208,228 207,206" fill="none" stroke={shade(body, 0.25)} strokeWidth="2.4" opacity="0.6" strokeLinecap="round" />
              </g>
            ) : species.tail === "paddle" ? (
              // beaver — flat leathery paddle with crosshatch
              <g transform="rotate(-34 190 246)">
                <ellipse cx="196" cy="258" rx="10.5" ry="17" fill="#8A6844" stroke={shade("#8A6844", -0.35)} strokeWidth="1.6" />
                <path d="M 189,250 L 203,250 M 188,258 L 204,258 M 190,266 L 202,266" stroke={shade("#8A6844", -0.3)} strokeWidth="1" opacity="0.7" />
              </g>
            ) : species.tail === "finTail" ? (
              // fish — caudal fin
              <g>
                <path d="M 186,246 L 208,230 Q 213,246 208,262 Z" fill={bodyDark} stroke={feltLine} strokeWidth="1.6" strokeLinejoin="round" />
                <path d="M 194,244 Q 202,240 206,236 M 195,250 Q 203,250 207,252" fill="none" stroke={feltLine} strokeWidth="1" opacity="0.5" />
              </g>
            ) : species.tail === "tentacles" ? (
              // jellyfish — a fringe of strands under the bell; the wag pivot
              // is far away, so the wag reads as a slow drift, which suits her
              <g stroke={bodyDark} strokeWidth="3.2" strokeLinecap="round" fill="none" opacity="0.9">
                <path d="M 88,280 Q 84,292 88,304" />
                <path d="M 104,286 Q 100,298 105,310" />
                <path d="M 120,288 Q 117,300 121,314" />
                <path d="M 136,286 Q 133,298 138,310" />
                <path d="M 152,280 Q 149,292 153,304" />
              </g>
            ) : species.tail === "tuft" ? (
              // cow / bison — rope tail with a tufted tip
              <g>
                <path d="M 190,244 Q 198,252 200,264" fill="none" stroke={bodyDark} strokeWidth="3.4" strokeLinecap="round" />
                <circle cx="200" cy="268" r="5" fill={shade(body, -0.42)} />
              </g>
            ) : species.tail === "none" ? null : (
              <>
                <ellipse cx="190" cy="248" rx="8.5" ry="6.5" fill={body} stroke={feltLine} strokeWidth="1.6" />
                <ellipse cx="192" cy="246" rx="3.6" ry="2.6" fill={bodyLight} opacity="0.8" />
              </>
            )}
          </g>

          <g ref={refs.body}>
            {/* back accents — silhouette features drawn behind the body so
                only what pokes past the egg edge shows */}
            {species.back === "quills" && (
              <g data-layer="ears">
                {[-64, -48, -32, -16, 0, 16, 32, 48, 64].map((a) => (
                  <g key={a} transform={`rotate(${a} 120 150)`}>
                    <line x1="120" y1="112" x2="120" y2="66" stroke="#6B5540" strokeWidth="3" strokeLinecap="round" />
                    <line x1="120" y1="78" x2="120" y2="66" stroke="#EDE2CE" strokeWidth="3" strokeLinecap="round" />
                  </g>
                ))}
              </g>
            )}
            {species.back === "star" && (
              <g data-layer="ears">
                {[-90, -18, 54, 126, 198].map((a) => (
                  <g key={a} transform={`rotate(${a + 90} 120 178)`}>
                    <path d="M 94,178 L 120,44 L 146,178 Z" fill={shade(body, -0.06)} stroke={feltLine} strokeWidth="1.8" strokeLinejoin="round" />
                  </g>
                ))}
              </g>
            )}
            {species.back === "wool" && (
              <g data-layer="ears" fill="#F6F1E8" stroke={feltLine} strokeWidth="1.2">
                <circle cx="78" cy="99" r="10" />
                <circle cx="93" cy="85" r="11" />
                <circle cx="110" cy="76" r="12" />
                <circle cx="130" cy="76" r="12" />
                <circle cx="147" cy="85" r="11" />
                <circle cx="162" cy="99" r="10" />
              </g>
            )}

            {/* ears — behind the head, so only the outer arc shows and the
                root tucks under the skull. Panda keeps the painted cap; other
                species swap in a vector felt shape at the same pivots, which
                is all it takes for the earScale/earPerk acting to carry over. */}
            <g ref={refs.earL} data-layer="ears">
              {species.ears === "cap" ? (
                <>
                  <ellipse cx={79} cy={101} rx={24.5} ry={23} fill="url(#zz-ear)" stroke="#0B0C0F" strokeWidth="1.2" />
                  <ellipse cx={73} cy={94} rx={10} ry={8} fill="#3E3F49" opacity="0.5" />
                </>
              ) : (
                vectorEar("L")
              )}
            </g>
            <g ref={refs.earR} data-layer="ears">
              {species.ears === "cap" ? (
                <>
                  <ellipse cx={161} cy={101} rx={24.5} ry={23} fill="url(#zz-ear)" stroke="#0B0C0F" strokeWidth="1.2" />
                  <ellipse cx={167} cy={94} rx={10} ry={8} fill="#3E3F49" opacity="0.5" />
                </>
              ) : (
                vectorEar("R")
              )}
            </g>

            {/* cream felt body traced from the source art — the ink line is
                stroked INSIDE the clip so the body never grows past the
                silhouette the painted suit was registered against */}
            <path d={BODY_PATH} fill="url(#zz-body)" data-layer="body" />
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
              <g ref={refs.cheekG} data-layer="cheeks" opacity="0.4">
                <ellipse ref={refs.cheekL} cx={RIG.cheek.lx} cy={RIG.cheek.y} rx="7" ry="5" fill="#F2C7C0" />
                <ellipse ref={refs.cheekR} cx={RIG.cheek.rx} cy={RIG.cheek.y} rx="7" ry="5" fill="#F2C7C0" />
              </g>
            </g>

            {/* VECTOR SUIT — the reference projected on the standardized egg:
                jacket clipped to the body silhouette, white shirt V, notch
                lapels, center seam and buttons. Being vector, the suit and
                tie tint by direct fill — no masks, no screen blending. */}
            <g data-layer="suit">
              <g clipPath="url(#zz-bodyclip)">
                <path d={SUIT_JACKET} fill="url(#zz-suitg)" />
                <path d={SUIT_JACKET} fill="none" stroke={shade(suit, -0.42)} strokeWidth="2" />
                {/* chin occlusion — clipped inside the jacket so the blur
                    can't band across the collar edge */}
                <g clipPath="url(#zz-suitclip)">
                  <path d="M 56,150 Q 120,198 184,150" fill="none" stroke="#000" strokeWidth="7" opacity="0.15" filter="url(#zz-soft2)" />
                </g>
              </g>
              {/* shirt V */}
              <path d="M 96,146.5 Q 120,160 144,146.5 L 133,201 Q 120,210 107,201 Z" fill="#F8F4EA" />
              <path d="M 96,146.5 Q 120,160 144,146.5" fill="none" stroke="#DAD3C1" strokeWidth="1" opacity="0.8" />
              {/* notch lapels — a shade darker than the jacket, tips folding
                  in toward the button seam */}
              <path
                d="M 96,146.5 Q 90,176 105,202 L 113,206 Q 103,178 104,154 Q 111,159.5 120,161 Q 107,155 96,146.5 Z"
                fill={shade(suit, -0.14)} stroke={shade(suit, -0.4)} strokeWidth="1" strokeLinejoin="round"
              />
              <path
                d="M 144,146.5 Q 150,176 135,202 L 127,206 Q 137,178 136,154 Q 129,159.5 120,161 Q 133,155 144,146.5 Z"
                fill={shade(suit, -0.14)} stroke={shade(suit, -0.4)} strokeWidth="1" strokeLinejoin="round"
              />
              {/* seam + buttons */}
              <path d="M 120,211 L 120,285" stroke={shade(suit, -0.3)} strokeWidth="1.1" opacity="0.7" />
              {[227, 251].map((by) => (
                <g key={by}>
                  <circle cx="120.5" cy={by} r="4.6" fill="#B4713A" stroke="#7E4C24" strokeWidth="1" />
                  {[[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]].map(([dx, dy], i) => (
                    <circle key={i} cx={120.5 + dx} cy={by + dy} r="0.55" fill="#7E4C24" />
                  ))}
                </g>
              ))}
            </g>
            {accessory === "tie" && (
              <g data-layer="tie">
                <path d="M 113,172 L 127,172 L 131.5,201 L 120,211 L 108.5,201 Z" fill={tie} stroke={shade(tie, -0.35)} strokeWidth="1" strokeLinejoin="round" />
                <path d="M 116,177 L 117.5,196" stroke={shade(tie, 0.35)} strokeWidth="1.2" opacity="0.55" strokeLinecap="round" />
                <path d="M 112.5,161 L 127.5,161 Q 130.5,167.5 127.5,173 L 112.5,173 Q 109.5,167.5 112.5,161 Z" fill={shade(tie, -0.12)} stroke={shade(tie, -0.4)} strokeWidth="0.9" />
              </g>
            )}

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
            <g ref={refs.face} data-layer="face">
              {/* hair — a three-strand felt cowlick on the crown; rides the
                  head, skipped where headgear (crest/wool/quills) lives */}
              {(species.hair ?? true) && (
                <g
                  data-layer="ears" fill="none" strokeLinecap="round" strokeWidth="2.2"
                  stroke={species.eye === "dark" ? "#17181D" : feltLine}
                >
                  <path d="M 114.5,80 Q 111,71 116,64.5" />
                  <path d="M 120,78.5 Q 119,67.5 125,63" />
                  <path d="M 125.5,80.5 Q 125.5,71.5 131,67.5" />
                </g>
              )}
              {/* painted eye patches — panda anatomy, they never blink. The
                  sheet carries the art's own tilt, ink rim and soft interior,
                  so there is no angle left for the rig to approximate. */}
              {species.patches && (
                <>
                  <ellipse cx={88.9} cy={125.4} rx={10.4} ry={8.6} fill="url(#zz-patch)" transform="rotate(-26 88.9 125.4)" />
                  <ellipse cx={151.1} cy={125.4} rx={10.4} ry={8.6} fill="url(#zz-patch)" transform="rotate(26 151.1 125.4)" />
                </>
              )}

              {/* brows are solid parts off the sheet, not strokes we draw */}
              <path ref={refs.browL} d="" fill={ink} data-layer="brows" />
              <path ref={refs.browR} d="" fill={ink} data-layer="brows" />

              {/* glossy eyes, kept from the cat rig, tilted with the patch and
                  set where the art puts them: up and toward the nose. Both
                  highlights read INWARD, mirrored — that pair of catchlights is
                  what makes the two eyes look like one gaze. */}
              {(
                [
                  [RIG.eye.lx, 1, refs.eyeL, refs.pupilL, refs.sparkleL],
                  [RIG.eye.rx, -1, refs.eyeR, refs.pupilR, refs.sparkleR],
                ] as const
              ).map(([ex, dir, eyeRef, pupilRef, sparkRef], i) =>
                species.eye === "dark" ? (
                  // panda: white sclera so blinks and state are visible against
                  // the black patch; dark pupil moves with gaze
                  <g key={i} ref={eyeRef} data-layer="eyes">
                    <g transform={`rotate(${-dir * RIG.eye.tilt} ${ex} ${RIG.eye.y})`}>
                      <ellipse cx={ex} cy={RIG.eye.y} rx={erx} ry={ery} fill="#F0EDFF" stroke="#C8C0E8" strokeWidth="0.5" />
                      <g ref={pupilRef}>
                        <ellipse cx={ex} cy={RIG.eye.y} rx={erx * 0.58} ry={ery * 0.58} fill="#1A1920" />
                        <circle cx={ex + dir * 0.45} cy={RIG.eye.y - 1.8} r={1.1} fill="#FFF" opacity="0.95" />
                        <circle ref={sparkRef} cx={ex - dir * 1.6} cy={RIG.eye.y + 2.0} r={0.62} fill="#FFF" opacity="0.5" />
                      </g>
                    </g>
                  </g>
                ) : (
                  // everyone else: white sclera + centered dark pupil, with
                  // the geometry customized per animal — eyeScale/eyeTilt on
                  // the sclera, pupilSize/pupilAspect on the pupil (a >1
                  // aspect is a cat/snake slit, <1 is the horizontal bar
                  // sheep and goats really have). Only the pupil travels,
                  // which is what sells a LOOK rather than an eye sliding.
                  <g key={i} ref={eyeRef} data-layer="eyes">
                    <g transform={`rotate(${dir * (species.eyeTilt ?? 0)} ${ex} ${RIG.eye.y})`}>
                      <ellipse cx={ex} cy={RIG.eye.y} rx={4.7 * (species.eyeScale ?? 1)} ry={5.15 * (species.eyeScale ?? 1)} fill="#FFFEFA" stroke={feltLine} strokeWidth="1" />
                      <g ref={pupilRef}>
                        <ellipse
                          cx={ex} cy={RIG.eye.y}
                          rx={(2.6 * (species.pupilSize ?? 1)) / Math.sqrt(species.pupilAspect ?? 1)}
                          ry={2.6 * (species.pupilSize ?? 1) * Math.sqrt(species.pupilAspect ?? 1)}
                          fill="#2A2530"
                        />
                        <circle cx={ex - dir * 0.8} cy={RIG.eye.y - 0.9} r={0.85 * (species.pupilSize ?? 1)} fill="#FFF" opacity="0.95" />
                        <circle ref={sparkRef} cx={ex + dir * 1.1} cy={RIG.eye.y + 1.2} r={0.5} fill="#FFF" opacity="0.5" />
                      </g>
                    </g>
                  </g>
                ),
              )}

              {([[RIG.eye.lx, refs.lidL], [RIG.eye.rx, refs.lidR]] as const).map(([ex, lidRef], i) => (
                <path
                  key={i} ref={lidRef} opacity="0" fill="none" stroke={species.eye === "dark" ? bodyLight : shade(body, -0.52)} strokeWidth={1.5} strokeLinecap="round"
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

              {/* muzzle field (bear family) — a light patch the nose and
                  mouth sit on, drawn before both */}
              {species.muzzle && (
                <ellipse cx="120" cy="135" rx="15" ry="10.5" fill={shade(body, 0.4)} opacity="0.9" data-layer="nose" />
              )}

              {/* whiskers — secondary action riding whiskerSway/whiskerDroop;
                  anchored at the muzzle so they fan past the cheeks */}
              {species.whiskers && (
                <>
                  <g ref={refs.whiskerL} data-layer="whiskers" stroke={feltLine} strokeWidth="1.1" strokeLinecap="round" opacity="0.55" fill="none">
                    <path d="M 97,135 Q 78,130 63,132" />
                    <path d="M 97,139 Q 75,138 59,142" />
                    <path d="M 97,143 Q 79,146 66,152" />
                  </g>
                  <g ref={refs.whiskerR} data-layer="whiskers" stroke={feltLine} strokeWidth="1.1" strokeLinecap="round" opacity="0.55" fill="none">
                    <path d="M 143,135 Q 162,130 177,132" />
                    <path d="M 143,139 Q 165,138 181,142" />
                    <path d="M 143,143 Q 161,146 174,152" />
                  </g>
                </>
              )}

              {/* crest — peacock head filaments, tipped with dots */}
              {species.crest && (
                <g data-layer="nose" stroke={shade(body, -0.35)} strokeWidth="1.6" strokeLinecap="round" fill="none">
                  <path d="M 112,80 Q 109,68 105,63" />
                  <path d="M 120,77 Q 120,64 120,59" />
                  <path d="M 128,80 Q 131,68 135,63" />
                  <circle cx="105" cy="62" r="2.2" fill={shade(body, -0.2)} stroke="none" />
                  <circle cx="120" cy="58" r="2.2" fill={shade(body, -0.2)} stroke="none" />
                  <circle cx="135" cy="62" r="2.2" fill={shade(body, -0.2)} stroke="none" />
                </g>
              )}

              {/* nose: panda keeps the painted snout sheet; the rest get a
                  vector treatment at the same anchor. Rhinos deliberately do
                  NOT get a button nose — the horn grows from the snout, so
                  they get a felt mound with nostrils and the cone on top. */}
              {species.nose === "painted" ? (
                // panda snout, vectorized off the painted sheet: light felt
                // mound, ink tri-nose with a highlight, philtrum to the lip
                <g data-layer="nose">
                  <ellipse cx="120" cy="130.9" rx="9.4" ry="6" fill={bodyLight} opacity="0.95" />
                  <path d="M 115.4,127.4 Q 120,124.9 124.6,127.4 Q 123.1,132.2 120,133.3 Q 116.9,132.2 115.4,127.4 Z" fill="#22232A" />
                  <circle cx="117.9" cy="127.7" r="1" fill="#FFF" opacity="0.5" />
                  <path d="M 120,133.3 L 120,136.8" stroke="#22232A" strokeWidth="0.9" strokeLinecap="round" />
                </g>
              ) : species.nose === "tri" ? (
                <g data-layer="nose">
                  <path d="M 114.5,127.5 Q 120,124.5 125.5,127.5 Q 124,133 120,134.2 Q 116,133 114.5,127.5 Z" fill={species.noseColor} stroke={shade(species.noseColor, -0.3)} strokeWidth="0.8" />
                  <ellipse cx="117.6" cy="127.8" rx="1.5" ry="0.9" fill="#FFF" opacity="0.5" />
                </g>
              ) : species.nose === "nostrils" ? (
                <g data-layer="nose">
                  <ellipse cx="120" cy="130" rx="9" ry="6.2" fill={shade(body, 0.22)} stroke={feltLine} strokeWidth="1" opacity="0.95" />
                  <ellipse cx="116.4" cy="131" rx="1.7" ry="1.15" fill={species.noseColor} />
                  <ellipse cx="123.6" cy="131" rx="1.7" ry="1.15" fill={species.noseColor} />
                </g>
              ) : species.nose === "beak" ? (
                // ARTICULATED: the lower mandible is its own group and drops
                // with the jaw channel, so birds talk and emote with the beak
                // itself — the felt mouth is not drawn for beak species
                <g data-layer="nose">
                  <g ref={refs.beakLower}>
                    <path d="M 115.5,128.5 Q 120,127.2 124.5,128.5 Q 122.5,136.8 120,138 Q 117.5,136.8 115.5,128.5 Z" fill={shade(species.noseColor, -0.28)} stroke={shade(species.noseColor, -0.45)} strokeWidth="0.9" />
                  </g>
                  <g ref={refs.beakUpper}>
                    <path d="M 113,125.5 Q 120,122 127,125.5 Q 123.5,132.5 120,133.4 Q 116.5,132.5 113,125.5 Z" fill={species.noseColor} stroke={shade(species.noseColor, -0.35)} strokeWidth="1" />
                    <path d="M 114.5,127 Q 120,124.8 125.5,127" fill="none" stroke={shade(species.noseColor, -0.3)} strokeWidth="0.7" opacity="0.7" />
                  </g>
                </g>
              ) : species.nose === "none" ? null : (
                <g data-layer="nose">
                  <ellipse cx="120" cy="129.5" rx="6.5" ry="4.6" fill={species.noseColor} />
                  <ellipse cx="117.5" cy="127.8" rx="2" ry="1.2" fill="#FFF" opacity="0.35" />
                </g>
              )}

              {/* horn — rhino: one felt cone rising off the snout mound */}
              {species.horn === "cone" && (
                <path d="M 114,126 Q 120,104 126,126 Q 120,130 114,126 Z" fill="#EFE9DC" stroke={shade("#EFE9DC", -0.4)} strokeWidth="1.4" data-layer="nose" />
              )}

              {/* the mouth part beneath — silhouette first, tongue derived
                  from the cavity on top. Beak species emote with the beak
                  instead, so the felt mouth stays out of their face. */}
              {species.nose !== "beak" && (
                <>
                  <path ref={refs.mouth} d="" fill="#202126" data-layer="mouth" />
                  <g ref={refs.tongueG} opacity="0">
                    <path ref={refs.tongueFill} d="" fill={TONGUE} />
                  </g>
                </>
              )}
            </g>

            {/* vector felt mitts — rounded mitten + thumb bump at the same
                anchors and tilts the painted limb used; the bevel filter is
                what keeps charcoal readable on charcoal */}
            {([
              [RIG.paw.lx, -1, refs.pawL],
              [RIG.paw.rx, 1, refs.pawR],
            ] as const).map(([px, dir, pawRef], i) => (
              <g key={i} ref={pawRef} data-layer="paws" filter="url(#zz-mitt)">
                <g transform={`rotate(${dir * RIG.paw.tilt} ${px} ${RIG.paw.y})`}>
                  <ellipse cx={px} cy={RIG.paw.y} rx={9.8} ry={10.3} fill="url(#zz-mittg)" />
                  <ellipse cx={px + dir * 6.8} cy={RIG.paw.y - 5.2} rx={3.8} ry={4.6} fill="url(#zz-mittg)" transform={`rotate(${dir * 24} ${px + dir * 6.8} ${RIG.paw.y - 5.2})`} />
                </g>
              </g>
            ))}
          </g>

          <text ref={refs.zzz} x="182" y="86" fontSize="20" fontFamily="Georgia, serif" fill="#9DB0C2" opacity="0">
            z<tspan dx="4" dy="-10" fontSize="14">z</tspan>
          </text>
        </g>
      </g>
    </svg>
  );
}
