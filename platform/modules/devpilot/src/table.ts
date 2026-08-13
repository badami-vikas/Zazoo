import type { TableSpec, ViewConfig } from "@bridge/tables";
import { defaultViewConfig } from "@bridge/tables";
import { DEVPILOT_ISSUE_STATES, DEVPILOT_PULL_STATES, DEVPILOT_REVIEW_STATES, DEVPILOT_SOURCES } from "./domain.js";

// Columns-as-data on @bridge/tables (the DealPilot/JobPilot pattern) — DevPilot
// gets board/list/gallery Views for free instead of a bespoke tracker UI.

export const reposTableSpec: TableSpec = {
  id: "devpilot.repos",
  columns: [
    { id: "fullName", label: "Repository", kind: "text", locked: true, editable: false },
    { id: "private", label: "Private", kind: "checkbox", editable: false },
    { id: "defaultBranch", label: "Default branch", kind: "text", editable: false },
    { id: "archived", label: "Archived", kind: "checkbox", editable: false },
    { id: "tracked", label: "Tracked", kind: "checkbox" },
    { id: "pushedAt", label: "Last pushed", kind: "date", editable: false },
    { id: "url", label: "URL", kind: "url", editable: false, hiddenInForm: true },
  ],
};

export const pullsTableSpec: TableSpec = {
  id: "devpilot.pulls",
  columns: [
    { id: "title", label: "Pull request", kind: "text", locked: true, editable: false },
    { id: "repoFullName", label: "Repository", kind: "text", editable: false },
    { id: "number", label: "#", kind: "number", editable: false },
    { id: "state", label: "State", kind: "select", options: [...DEVPILOT_PULL_STATES], editable: false },
    { id: "reviewState", label: "Review", kind: "select", options: [...DEVPILOT_REVIEW_STATES], editable: false },
    { id: "author", label: "Author", kind: "text", editable: false },
    { id: "isDraft", label: "Draft", kind: "checkbox", editable: false },
    { id: "additions", label: "+", kind: "number", editable: false },
    { id: "deletions", label: "-", kind: "number", editable: false },
    { id: "externalUpdatedAt", label: "Updated", kind: "date", editable: false },
    { id: "url", label: "URL", kind: "url", editable: false, hiddenInForm: true },
  ],
};

export const issuesTableSpec: TableSpec = {
  id: "devpilot.issues",
  columns: [
    { id: "title", label: "Issue", kind: "text", locked: true, editable: false },
    { id: "source", label: "Source", kind: "select", options: [...DEVPILOT_SOURCES], editable: false },
    { id: "repoFullName", label: "Repository", kind: "text", editable: false },
    { id: "number", label: "#", kind: "number", editable: false },
    { id: "state", label: "State", kind: "select", options: [...DEVPILOT_ISSUE_STATES], editable: false },
    { id: "labels", label: "Labels", kind: "text", editable: false },
    { id: "assignee", label: "Assignee", kind: "text", editable: false },
    { id: "priority", label: "Priority", kind: "text", editable: false },
    { id: "externalUpdatedAt", label: "Updated", kind: "date", editable: false },
    { id: "url", label: "URL", kind: "url", editable: false, hiddenInForm: true },
  ],
};

/** Pulls triage board — grouped by review state, the shape a freelancer
 * actually works from ("what needs my review vs. what's waiting on theirs"). */
export function pullsTriageBoardView(): ViewConfig {
  return { ...defaultViewConfig("devpilot.pulls.triage-board", "board"), groupBy: "reviewState" };
}

/** Issues list — sorted newest-touched first. */
export function issuesUpdatedListView(): ViewConfig {
  return {
    ...defaultViewConfig("devpilot.issues.updated-list", "table"),
    sorts: [{ id: "externalUpdatedAt", dir: "desc" }],
  };
}
