/**
 * GraphView — placeholder for kind "network" (and the map fallback, see
 * registry.ts). docs/wiki/vision.md's grammar restricts relationship views to
 * "graph OR table ONLY" — actual node-link graph rendering is later work
 * (P1 spec: "GraphView placeholder that renders relationships as a table
 * fallback (graph rendering later — grammar says graph OR table, table is the
 * honest v1)"). Reuses TableView's rendering rather than duplicating it, with a
 * banner making the fallback explicit instead of silently pretending to be a
 * real graph.
 */
import { TableView } from "./TableView.js";
import type { DataViewProps } from "../types.js";

export function GraphView(props: DataViewProps) {
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground border rounded-md px-3 py-2 bg-muted/30">
        Graph rendering isn't built yet — showing {props.spec.id} as a table (grammar allows graph or table for
        relationships; table is the honest v1).
      </div>
      <TableView {...props} />
    </div>
  );
}
