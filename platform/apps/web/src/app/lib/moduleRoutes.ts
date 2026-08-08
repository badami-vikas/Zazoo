/**
 * Module → surface route map. "Module" is the user-facing word for an
 * installed capability package (`packages.list` rows) — never "package" in
 * UI copy (vocabulary rule, requests.md R-017..R-020).
 *
 * Copied from IntelligencePage's PACKAGE_ROUTES (owned by another workstream;
 * kept byte-identical rather than imported to avoid a cross-page coupling on
 * a page-private constant). Only packages whose `packageName` appears here
 * have a navigable surface; add a row when a new workspace_definition package
 * ships (must also be seeded in apps/api/src/built-in-packages.ts).
 */
// Chief of Staff excluded (2026-07-10): it's the router agent, always
// present, never a creatable "new Initiative from a Module" — see
// apps/api/src/built-in-packages.ts's header comment.
export const MODULE_ROUTES: Record<string, { to: string; label: string; desc: string }> = {
  "deal-pilot": { to: "/dealpilot", label: "DealPilot", desc: "Sourcing waterfall + thesis-fit scoring" },
  "job-pilot": { to: "/jobpilot", label: "JobPilot", desc: "Job search tracker + application pipeline" },
  helpdesk: { to: "/helpdesk", label: "Helpdesk", desc: "Support ticket inbox + routing" },
  calendar: { to: "/task-manager", label: "Task Manager", desc: "Rank and schedule pending work" },
};
