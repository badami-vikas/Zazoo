/**
 * Categorical colour for graph nodes (ADR-222).
 *
 * WHY THIS REPLACES A HASH. `GraphView` used to colour a node by hashing its
 * `databaseId` into `hsl(hash % 360, 52%, 48%)`. Two problems, both fatal to the
 * thing colour is for: adjacent hues in a 360-way hash are indistinguishable, so
 * two Modules routinely rendered the same colour; and nothing told the reader
 * what any colour MEANT, so the encoding carried no information even when it
 * happened to be distinct.
 *
 * The cross-tool research (2026-08-10) is unambiguous about which convention
 * survives: Capacities colours by OBJECT TYPE and reuses each type's colour
 * everywhere in the app, and that is the single most-cited reason its small
 * graph is legible where Obsidian's undifferentiated dots are not. Obsidian's
 * own colour groups are user-authored queries — powerful, but it ships grey by
 * default and its community calls the result decorative.
 *
 * So: a fixed ordered palette, assigned by stable sorted position of the
 * distinct keys present. Every colour in a given graph is therefore drawn from
 * as far apart in the palette as the set allows, and a LEGEND is mandatory —
 * every research source flagged the missing legend as a top complaint.
 *
 * STABILITY TRADE-OFF, stated plainly: assignment depends on which keys are
 * present, so changing scope can move a Module's colour. That is deliberate.
 * The alternative (hash to a fixed slot) is stable but re-admits collisions,
 * and a colour that is stable AND ambiguous is worse than one that is
 * unambiguous and explained by a legend on screen.
 */

/**
 * Twelve hues chosen to stay distinguishable from each other AND legible as a
 * filled circle on the light graph canvas. Ordered so that a graph with few
 * types (the common case) draws from maximally separated hues first.
 */
export const GRAPH_PALETTE = [
  "#2563eb", // blue
  "#ea580c", // orange
  "#059669", // emerald
  "#9333ea", // violet
  "#dc2626", // red
  "#0891b2", // cyan
  "#ca8a04", // amber
  "#db2777", // pink
  "#4d7c0f", // olive
  "#4f46e5", // indigo
  "#b45309", // bronze
  "#0f766e", // teal
] as const;

/** Anything with no key at all — never silently borrows another type's colour. */
export const GRAPH_UNTYPED_COLOR = "#64748b"; // slate

export interface GraphLegendEntry {
  key: string;
  label: string;
  color: string;
  count: number;
}

interface Colorable {
  databaseId: string;
  databaseLabel: string;
}

/**
 * Build the key → colour map plus the legend rows, in one pass, so the swatch a
 * node draws and the swatch the legend draws can never disagree.
 *
 * Keys sort by label then id: the ordering is a property of the DATA, not of
 * render order, so two renders of the same node set always agree.
 */
export function buildGraphLegend(nodes: readonly Colorable[]): {
  colorOf: (databaseId: string) => string;
  legend: GraphLegendEntry[];
} {
  const seen = new Map<string, { label: string; count: number }>();
  for (const node of nodes) {
    const key = node.databaseId;
    const current = seen.get(key);
    if (current) current.count += 1;
    else seen.set(key, { label: node.databaseLabel || key, count: 1 });
  }

  const ordered = [...seen.entries()].sort(([aId, a], [bId, b]) =>
    a.label.localeCompare(b.label) || aId.localeCompare(bId),
  );

  const colors = new Map<string, string>();
  const legend: GraphLegendEntry[] = ordered.map(([key, { label, count }], index) => {
    const color = key ? (GRAPH_PALETTE[index % GRAPH_PALETTE.length] as string) : GRAPH_UNTYPED_COLOR;
    colors.set(key, color);
    return { key, label, color, count };
  });

  return {
    colorOf: (databaseId: string) => colors.get(databaseId) ?? GRAPH_UNTYPED_COLOR,
    legend,
  };
}
