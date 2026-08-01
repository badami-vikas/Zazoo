/**
 * Species — each character is a SMALL DELTA on the shared baseline, never a
 * new rig. Everybody keeps the same egg silhouette, suit, painted mitts,
 * glossy eyes, and the artist's standard mouth/brow parts; a species only
 * chooses its felt color and swaps the few features that carry identity:
 * ear shape, nose, tail, and the optional whiskers / horn / muzzle / patches.
 *
 * This is the v3 crew idea (Avatar repo, c3aa693) redone the cheap way: v3
 * needed a full photo plate set per species; here a species is ~8 flags,
 * because everything expressive already lives in the standardized parts.
 * Identity comes from the delta; LIFE comes from the shared rig — so every
 * new character is born already knowing how to think, wave, and breathe.
 */

export interface ZazooSpecies {
  id: string;
  name: string;
  /** cap = the painted panda ear sheet; the rest are vector felt. */
  ears: "cap" | "point" | "tall" | "bud";
  /** Painted panda eye patches — panda anatomy, nobody else's. */
  patches: boolean;
  whiskers: boolean;
  horn: boolean;
  /** Light muzzle field behind nose + mouth (bear-family faces). */
  muzzle: boolean;
  /** painted = the panda snout sheet; tri/oval are vector felt noses. */
  nose: "painted" | "tri" | "oval";
  noseColor: string;
  /** Inner-ear felt for the vector ears. */
  earInner: string;
  tail: "stub" | "curl" | "puff";
  /** Default felt — a starting point, the fur swatches still apply. */
  body: string;
}

export const SPECIES: ZazooSpecies[] = [
  {
    id: "zazoo", name: "Zazoo", ears: "cap", patches: true, whiskers: false,
    horn: false, muzzle: false, nose: "painted", noseColor: "#1B1C21",
    earInner: "#2F3038", tail: "stub", body: "#FAF1E7",
  },
  {
    id: "miso", name: "Miso", ears: "point", patches: false, whiskers: true,
    horn: false, muzzle: false, nose: "tri", noseColor: "#E8899B",
    earInner: "#E9AEB6", tail: "curl", body: "#F0DFC2",
  },
  {
    id: "clover", name: "Clover", ears: "tall", patches: false, whiskers: true,
    horn: false, muzzle: false, nose: "tri", noseColor: "#E39AA8",
    earInner: "#EDBCC6", tail: "puff", body: "#E6E8ED",
  },
  {
    id: "bruno", name: "Bruno", ears: "bud", patches: false, whiskers: false,
    horn: false, muzzle: true, nose: "oval", noseColor: "#463629",
    earInner: "#A87C50", tail: "stub", body: "#C99C6E",
  },
  {
    id: "remy", name: "Remy", ears: "bud", patches: false, whiskers: false,
    horn: true, muzzle: false, nose: "oval", noseColor: "#4C4956",
    earInner: "#ABAFBC", tail: "stub", body: "#C7CBD6",
  },
];

export const DEFAULT_SPECIES = SPECIES[0];
