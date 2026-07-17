import type { TableSpec, ViewConfig } from "@bridge/tables";
import { defaultViewConfig } from "@bridge/tables";
import type { DealStage } from "./deal.js";
import { PIPELINE_STAGES, TERMINAL_STAGES } from "./deal.js";

// Thesis-fit feed as a domain evaluation view. Fit bands are not platform Red Flag feedback.
// Columns-as-data on @bridge/tables — the same
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
    {
      id: "thesisFitBand",
      label: "Thesis fit band",
      kind: "select",
      options: ["strong_fit", "needs_review", "weak_fit"],
    },
    { id: "thesisFit", label: "Thesis Fit", kind: "number", editable: false },
  ],
};

/** Domain evaluation board, grouped independently of platform Red Flag feedback. */
export function dealsKanbanView(): ViewConfig {
  return { ...defaultViewConfig("dealpilot.deals.kanban", "kanban"), groupBy: "thesisFitBand" };
}

/** Stage board — groups deals by pipeline stage for a pipeline progress view. */
export function dealsStageBoardView(): ViewConfig {
  return {
    ...defaultViewConfig("dealpilot.deals.stage-board", "kanban"),
    groupBy: "stage",
  };
}
