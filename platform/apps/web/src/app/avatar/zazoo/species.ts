/**
 * Species — each character is a SMALL DELTA on the shared baseline, never a
 * new rig. Everybody keeps the same egg silhouette, suit, painted mitts,
 * standard mouth/brow parts and the full acting stack; a species only picks
 * its felt color and swaps the few features that carry identity.
 *
 * Feature primitives (the whole vocabulary — kept deliberately tiny):
 *   ears     cap (painted panda) · point · tall · bud · none, with earSize
 *   eye      dark (panda's glossy eye inside its patch) · white (sclera +
 *            centered round pupil — how cats, foxes and most mammals read)
 *   nose     painted · tri · oval · nostrils (snout mound, no button nose —
 *            rhinos don't have one) · beak (birds; sits where a nose would,
 *            the standard mouth still acts underneath)
 *   horn     none · cone (on the snout, rhino) · antlers (ride the ears)
 *   tail     stub · curl · puff · fan — always the ANIMAL's color, never
 *            wardrobe: a tail is anatomy, the suit is clothes
 *   flags    patches · whiskers · muzzle · crest
 *
 * The cast is Zootopia/Pixar-inspired but stays on brand: plush felt, muted
 * palette, professional-minimal. Identity from the delta, life from the rig.
 */

export interface ZazooSpecies {
  id: string;
  name: string;
  /** e.g. "panda", "fox" — shown in the picker next to the given name. */
  kind: string;
  ears: "cap" | "point" | "tall" | "bud" | "none";
  /** Scales the vector ears about their base (koala big, sloth small). */
  earSize?: number;
  eye: "dark" | "white";
  patches: boolean;
  whiskers: boolean;
  muzzle: boolean;
  crest?: boolean;
  nose: "painted" | "tri" | "oval" | "nostrils" | "beak";
  noseColor: string;
  horn: "none" | "cone" | "antlers";
  earInner: string;
  tail: "stub" | "curl" | "puff" | "fan";
  /** Default felt — a starting point, the fur swatches still apply. */
  body: string;
}

const base = {
  earSize: 1, eye: "white" as const, patches: false, whiskers: false,
  muzzle: false, crest: false, horn: "none" as const,
};

export const SPECIES: ZazooSpecies[] = [
  { ...base, id: "zazoo", name: "Zazoo", kind: "panda", ears: "cap", eye: "dark", patches: true, nose: "painted", noseColor: "#1B1C21", earInner: "#2F3038", tail: "stub", body: "#FAF1E7" },
  { ...base, id: "miso", name: "Miso", kind: "cat", ears: "point", whiskers: true, nose: "tri", noseColor: "#E8899B", earInner: "#E9AEB6", tail: "curl", body: "#F0DFC2" },
  { ...base, id: "clover", name: "Clover", kind: "rabbit", ears: "tall", whiskers: true, nose: "tri", noseColor: "#E39AA8", earInner: "#EDBCC6", tail: "puff", body: "#E6E8ED" },
  { ...base, id: "felix", name: "Felix", kind: "fox", ears: "point", whiskers: true, nose: "tri", noseColor: "#463629", earInner: "#4A3A30", tail: "curl", body: "#D99A66" },
  { ...base, id: "bruno", name: "Bruno", kind: "bear", ears: "bud", muzzle: true, nose: "oval", noseColor: "#463629", earInner: "#A87C50", tail: "stub", body: "#C99C6E" },
  { ...base, id: "pip", name: "Pip", kind: "otter", ears: "bud", earSize: 0.85, whiskers: true, muzzle: true, nose: "oval", noseColor: "#4A3A30", earInner: "#96714C", tail: "curl", body: "#B98D64" },
  { ...base, id: "rikki", name: "Rikki", kind: "mongoose", ears: "bud", earSize: 0.8, whiskers: true, nose: "tri", noseColor: "#463629", earInner: "#A88E68", tail: "curl", body: "#C9AE84" },
  { ...base, id: "momo", name: "Momo", kind: "red panda", ears: "point", whiskers: true, nose: "oval", noseColor: "#3A3238", earInner: "#E3C3AC", tail: "curl", body: "#C97F5E" },
  { ...base, id: "willow", name: "Willow", kind: "deer", ears: "bud", horn: "antlers", nose: "oval", noseColor: "#463629", earInner: "#A8845E", tail: "stub", body: "#C7A27E" },
  { ...base, id: "kiki", name: "Kiki", kind: "koala", ears: "bud", earSize: 1.35, nose: "oval", noseColor: "#3A3238", earInner: "#D6D9DE", tail: "stub", body: "#B8BCC4" },
  { ...base, id: "hamish", name: "Hamish", kind: "hamster", ears: "bud", earSize: 1.1, whiskers: true, nose: "tri", noseColor: "#E8899B", earInner: "#EFD9BE", tail: "stub", body: "#D9C4A8" },
  { ...base, id: "remy", name: "Remy", kind: "rhino", ears: "bud", earSize: 0.9, nose: "nostrils", noseColor: "#4A4550", horn: "cone", earInner: "#ABAFBC", tail: "stub", body: "#C7CBD6" },
  { ...base, id: "sacha", name: "Sacha", kind: "sloth", ears: "bud", earSize: 0.7, muzzle: true, nose: "oval", noseColor: "#6B5B48", earInner: "#9C8E76", tail: "stub", body: "#B4A488" },
  { ...base, id: "nova", name: "Nova", kind: "peacock", ears: "none", crest: true, nose: "beak", noseColor: "#D9A24C", earInner: "#5E8C94", tail: "fan", body: "#5E8C94" },
  { ...base, id: "aquila", name: "Aquila", kind: "eagle", ears: "none", nose: "beak", noseColor: "#E0A93E", earInner: "#B0906A", tail: "stub", body: "#B0906A" },
  { ...base, id: "otis", name: "Otis", kind: "owl", ears: "point", earSize: 0.65, nose: "beak", noseColor: "#D9A24C", earInner: "#8C7E62", tail: "stub", body: "#A89878" },
  { ...base, id: "perry", name: "Perry", kind: "penguin", ears: "none", nose: "beak", noseColor: "#E0A93E", earInner: "#D8DCE4", tail: "stub", body: "#D8DCE4" },
];

export const DEFAULT_SPECIES = SPECIES[0];
