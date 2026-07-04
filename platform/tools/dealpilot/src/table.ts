import type { TableSpec, ViewConfig } from "@bridge/tables";
import { defaultViewConfig } from "@bridge/tables";

// RYG triage feed as a table view (docs/raw/dealpilot-architecture-requirement.md S4: "Triage UI
// reads a materialized per-tenant feed view"). Columns-as-data on @bridge/tables — the same
// engine the prototype's People/Communities tables use — so DealPilot gets kanban/list/gallery
// views for free instead of a bespoke triage UI.
export const dealsTableSpec: TableSpec = {
  id: "dealpilot.deals",
  columns: [
    { id: "name", label: "Deal", kind: "text", locked: true },
    { id: "industry", label: "Industry", kind: "select" },
    { id: "geo", label: "Geo", kind: "text" },
    { id: "sde", label: "SDE", kind: "number" },
    { id: "revenue", label: "Revenue", kind: "number" },
    { id: "triage", label: "Triage", kind: "select", options: ["green", "yellow", "red"] },
    { id: "thesisFit", label: "Thesis Fit", kind: "number", editable: false },
  ],
};

export function dealsKanbanView(): ViewConfig {
  return { ...defaultViewConfig("dealpilot.deals.kanban", "kanban"), groupBy: "triage" };
}
