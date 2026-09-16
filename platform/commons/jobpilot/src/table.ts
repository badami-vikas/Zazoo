import type { TableSpec, ViewConfig } from "@bridge/tables";
import { defaultViewConfig } from "@bridge/tables";

// Card feed + tracker as table views (docs/raw/jobpilot-architecture-requirement.md S5: card feed
// + board tracker by `applications.status`). Columns-as-data on @bridge/tables — the same engine
// DealPilot's triage feed and the prototype's People/Communities tables use — so JobPilot gets
// board/list/gallery views for free instead of a bespoke tracker UI.
export const jobsTableSpec: TableSpec = {
  id: "jobpilot.jobs",
  columns: [
    { id: "title", label: "Title", kind: "text", locked: true },
    { id: "company", label: "Company", kind: "text" },
    { id: "location", label: "Location", kind: "location" },
    { id: "salaryMax", label: "Salary (max)", kind: "number" },
    { id: "flag", label: "Recommendation", kind: "select", options: ["pursue", "review", "pass"] },
    { id: "stage", label: "Stage", kind: "select", options: ["queued", "tailoring", "evaluating", "approved", "awaiting_review", "applying", "parked", "submitted", "confirmed", "rejected_by_user", "failed", "expired"] },
    { id: "fitScore", label: "Fit Score", kind: "number", editable: false },
  ],
};

export function jobsCardFeedView(): ViewConfig {
  return { ...defaultViewConfig("jobpilot.jobs.feed", "gallery"), groupBy: "flag" };
}

export function jobsTrackerView(): ViewConfig {
  return { ...defaultViewConfig("jobpilot.jobs.tracker", "board"), groupBy: "stage" };
}
