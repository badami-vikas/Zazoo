import type { TableSpec, ViewConfig } from "@bridge/tables";
import { defaultViewConfig } from "@bridge/tables";
import type { DealStage } from "./deal.js";
import { PIPELINE_STAGES, TERMINAL_STAGES } from "./deal.js";

// RYG triage feed as a table view (docs/raw/dealpilot-architecture-requirement.md S4: "Triage UI
// reads a materialized per-tenant feed view"). Columns-as-data on @bridge/tables — the same
// engine the prototype's People/Communities tables use — so DealPilot gets kanban/list/gallery
// views for free instead of a bespoke triage UI.

// All stage option strings in display order: pipeline stages first, then terminal stages.
const DEAL_STAGE_OPTIONS: DealStage[] = [
  ...PIPELINE_STAGES,
  ...(["portfolio", "passed"] as DealStage[]).filter((s) => TERMINAL_STAGES.has(s)),
];

export const dealsTableSpec: TableSpec = {
  id: "dealpilot.deals",
  columns: [
    { id: "name", label: "Deal", kind: "text", locked: true },
    {
      id: "stage",
      label: "Stage",
      kind: "select",
      options: DEAL_STAGE_OPTIONS,
    },
    { id: "industry", label: "Industry", kind: "select" },
    { id: "geo", label: "Geo", kind: "text" },
    { id: "askPrice", label: "Ask Price", kind: "number" },
    { id: "sde", label: "SDE", kind: "number" },
    { id: "revenue", label: "Revenue", kind: "number" },
    { id: "triage", label: "Triage", kind: "select", options: ["green", "yellow", "red"] },
    { id: "thesisFit", label: "Thesis Fit", kind: "number", editable: false },
  ],
};

/** RYG triage kanban — existing view, groups deals by triage colour. */
export function dealsKanbanView(): ViewConfig {
  return { ...defaultViewConfig("dealpilot.deals.kanban", "kanban"), groupBy: "triage" };
}

/** Stage board — groups deals by pipeline stage for a pipeline progress view. */
export function dealsStageBoardView(): ViewConfig {
  return {
    ...defaultViewConfig("dealpilot.deals.stage-board", "kanban"),
    groupBy: "stage",
  };
}
