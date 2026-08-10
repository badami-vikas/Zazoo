/**
 * Placement for the relation label drawn on a graph edge (ADR-223).
 *
 * Bridge has REAL typed Relations, which the file-link tools (Obsidian, Logseq,
 * Roam) structurally do not — their edges are untyped wikilinks, which is why
 * none of them draws an edge label and why their users keep asking for one. Of
 * everything in the 2026-08-10 research, labelled edges is the cheapest large
 * win available to us and the clearest differentiator, so the label is drawn on
 * the edge itself rather than hidden in a click-to-inspect panel.
 *
 * Two things make that legible instead of noisy:
 *  - the label rotates to the edge and is flipped when the edge runs
 *    right-to-left, so text is never upside down;
 *  - the pill is sized to the text, so short labels stop reserving the width of
 *    long ones (the old fixed 88px box overlapped its neighbours constantly).
 */

/** Beyond this, the label is truncated with an ellipsis. */
const MAX_LABEL_CHARS = 20;
/** Approximate advance width of the 11px label face, in px per character. */
const CHAR_WIDTH = 6;
const PILL_PAD_X = 10;
/** Node circle radius — the label has to clear both endpoints. */
const NODE_RADIUS = 20;

export interface EdgeLabelPlacement {
  /** Label midpoint, in graph coordinates. */
  x: number;
  y: number;
  /** Degrees, already flipped so the text reads left-to-right. */
  rotation: number;
  text: string;
  pillWidth: number;
  /**
   * False when the pill is wider than the gap between the two node circles.
   * Drawing it anyway puts the Relation label on top of the node labels — the
   * exact "wall of text" failure the fade rules exist to prevent — so a label
   * that does not fit waits for the reader to zoom in, where the edge is longer
   * in screen space but the pill is not.
   */
  fits: boolean;
}

export function edgeLabelPlacement(
  label: string,
  source: { x: number; y: number },
  target: { x: number; y: number },
): EdgeLabelPlacement {
  const text =
    label.length > MAX_LABEL_CHARS ? `${label.slice(0, MAX_LABEL_CHARS - 1)}…` : label;
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const raw = (Math.atan2(dy, dx) * 180) / Math.PI;
  // A label at 170° is upside down; the same line at -10° reads correctly, and
  // the two are the same line. Normalise into (-90, 90].
  const rotation = raw > 90 ? raw - 180 : raw <= -90 ? raw + 180 : raw;
  const pillWidth = text.length * CHAR_WIDTH + PILL_PAD_X * 2;
  const gap = Math.hypot(dx, dy) - NODE_RADIUS * 2;
  return {
    x: (source.x + target.x) / 2,
    y: (source.y + target.y) / 2,
    rotation,
    text,
    pillWidth,
    fits: pillWidth <= gap,
  };
}

/**
 * Text fades out as you zoom out — the one display convention every graph tool
 * in the research shares, and the reason a dense graph stays readable. Logseq
 * omits it and its labels turn into a wall of text at scale; that is the failure
 * mode being avoided here.
 *
 * Edge labels go first (there are more of them and they carry less), node labels
 * survive further out. A selected edge always keeps its label — the user pointed
 * at it.
 */
export function showEdgeLabels(scale: number, edgeCount: number): boolean {
  if (scale < 0.75) return false;
  // Past this density the labels overlap faster than zoom can separate them, so
  // they only appear once the reader has zoomed in on a neighbourhood.
  return edgeCount <= 120 || scale >= 1.4;
}

export function showNodeLabels(scale: number): boolean {
  return scale >= 0.5;
}
