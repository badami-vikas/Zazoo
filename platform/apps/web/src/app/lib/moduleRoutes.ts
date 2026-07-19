/**
 * Module → surface route map. "Module" is the user-facing word for an
 * installed capability module (`modules.list` rows) — never "module" in
 * UI copy (vocabulary rule, requests.md R-017..R-020).
 *
 * Copied from IntelligencePage's MODULE_ROUTES (owned by another workstream;
 * kept byte-identical rather than imported to avoid a cross-page coupling on
 * a page-private constant). Only modules whose `moduleName` appears here
 * have a navigable surface; add a row when a new organization_definition module
 * ships (must also be seeded in apps/api/src/built-in-modules.ts).
 */
// Chief of Staff excluded (2026-07-10): it's the router agent, always
// present, never a creatable "new Record from a Module" — see
// apps/api/src/built-in-modules.ts's header comment.
export const MODULE_ROUTES: Record<string, { to: string; label: string; desc: string }> = {
  "deal-pilot": { to: "/dealpilot", label: "DealPilot", desc: "Sourcing waterfall + thesis-fit scoring" },
  "job-pilot": { to: "/jobpilot", label: "JobPilot", desc: "Job search tracker + application pipeline" },
  relationship: { to: "/module/relationship/signals", label: "Relationship", desc: "Signals, People, Communities, and relationship continuity" },
};
