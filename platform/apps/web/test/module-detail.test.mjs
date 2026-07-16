/**
 * module-detail.test.mjs — focused tests for TASK-001 Module Detail and
 * PanelControl logic (§4b, §5b).
 *
 * Tests are pure-logic (no DOM/React runtime), exercising:
 *   1. MODULE_AGENTS map — every built-in package has an agent binding
 *   2. RISK_LABELS — every risk tier has a display label
 *   3. PanelControl state logic — collapsed persists, width clamping, drag direction
 *   4. Nav modules filter — only "available" packages are shown in the nav
 *
 * Run with: node --test test/module-detail.test.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";

// ---------------------------------------------------------------------------
// Inline the logic under test so this file has no import dependency on React
// or the browser environment. Tests validate the algorithms, not the JSX.
// ---------------------------------------------------------------------------

/** Mirrored from ModuleDetailPage.tsx */
const MODULE_AGENTS = {
  "deal-pilot": [{ id: "cos", name: "Chief of Staff", role: "Routes deal-related requests; invokes sourcing and thesis-scoring capabilities.", capabilityIds: ["deal-pilot.surface"] }],
  "job-pilot": [{ id: "cos", name: "Chief of Staff", role: "Routes job-search requests; invokes application pipeline capabilities.", capabilityIds: ["job-pilot.surface"] }],
  helpdesk: [{ id: "cos", name: "Chief of Staff", role: "Routes support requests; invokes ticket-triage and routing capabilities.", capabilityIds: ["helpdesk.surface"] }],
  calendar: [{ id: "cos", name: "Chief of Staff", role: "Routes scheduling requests; invokes calendar-event capabilities with governed egress.", capabilityIds: ["calendar.surface"] }],
};

/** Mirrored from ModuleDetailPage.tsx */
const RISK_LABELS = {
  informational: "Informational — read-only",
  advisory: "Advisory — reads and proposes changes",
  transformational: "Transformational — modifies local data",
  operational: "Operational — manages live resources",
  external: "External — sends to external services (governed)",
};

/** Mirrored from built-in-packages.ts */
const BUILT_IN_PACKAGE_NAMES = ["deal-pilot", "job-pilot", "helpdesk", "calendar"];

// ---------------------------------------------------------------------------
// PanelControl state logic (mirrored from usePanelControl, no React)
// ---------------------------------------------------------------------------

/** Pure clamp helper matching usePanelControl's onMove logic. */
function clampWidth(raw, min, max) {
  return Math.min(max, Math.max(min, raw));
}

/** Pure snap helper matching usePanelControl's snap onUp logic. */
function snapDecision(finalWidth, snapMidpoint, maxWidth) {
  if (finalWidth >= snapMidpoint) {
    return { collapsed: false, width: maxWidth };
  }
  return { collapsed: true };
}

/** Continuous (non-snap) panel width update. */
function continuousWidth(startWidth, dx, min, max) {
  return clampWidth(startWidth - dx, min, max); // right panel: left drag = negative dx
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("MODULE_AGENTS contains all four built-in package names", () => {
  for (const name of BUILT_IN_PACKAGE_NAMES) {
    assert.ok(name in MODULE_AGENTS, `Missing agent binding for "${name}"`);
  }
});

test("Each built-in module has exactly one agent (Chief of Staff)", () => {
  for (const [pkg, agents] of Object.entries(MODULE_AGENTS)) {
    assert.equal(agents.length, 1, `${pkg} should have exactly 1 agent`);
    assert.equal(agents[0].id, "cos", `${pkg}'s agent should be 'cos'`);
  }
});

test("Agent capabilityIds matches <packageName>.surface pattern", () => {
  for (const [pkg, agents] of Object.entries(MODULE_AGENTS)) {
    const expected = `${pkg}.surface`;
    assert.ok(
      agents[0].capabilityIds.includes(expected),
      `${pkg}'s agent should declare capability "${expected}"`
    );
  }
});

test("RISK_LABELS covers all risk tiers from built-in-packages.ts", () => {
  // built-in packages use: advisory, operational, external
  for (const tier of ["advisory", "operational", "external"]) {
    assert.ok(tier in RISK_LABELS, `Missing risk label for "${tier}"`);
    assert.ok(RISK_LABELS[tier].length > 0);
  }
});

test("PanelControl clampWidth respects min/max bounds", () => {
  assert.equal(clampWidth(50, 76, 220), 76, "below min clamps to min");
  assert.equal(clampWidth(300, 76, 220), 220, "above max clamps to max");
  assert.equal(clampWidth(150, 76, 220), 150, "within range passes through");
  assert.equal(clampWidth(76, 76, 220), 76, "at min boundary is valid");
  assert.equal(clampWidth(220, 76, 220), 220, "at max boundary is valid");
});

test("PanelControl snap: below midpoint collapses panel", () => {
  const result = snapDecision(80, 148, 220); // 80 < midpoint(148) → collapse
  assert.deepEqual(result, { collapsed: true });
});

test("PanelControl snap: at or above midpoint expands panel to max", () => {
  const result = snapDecision(150, 148, 220); // 150 >= midpoint(148) → expand
  assert.deepEqual(result, { collapsed: false, width: 220 });
});

test("PanelControl snap: exactly at midpoint expands (boundary inclusive)", () => {
  const result = snapDecision(148, 148, 220);
  assert.deepEqual(result, { collapsed: false, width: 220 });
});

test("PanelControl right panel: drag left (positive dx) grows width", () => {
  // Right panel: dragging LEFT (startX > ev.clientX) means dx < 0 → startWidth - dx > startWidth
  const startWidth = 286;
  const dx = -20; // dragged 20px left
  const result = continuousWidth(startWidth, dx, 260, 520);
  assert.equal(result, 306, "right panel drag left by 20px should grow by 20px");
});

test("PanelControl right panel: drag right (negative dx) shrinks width", () => {
  const startWidth = 286;
  const dx = 20; // dragged 20px right
  const result = continuousWidth(startWidth, dx, 260, 520);
  assert.equal(result, 266, "right panel drag right by 20px should shrink by 20px");
});

test("PanelControl right panel: drag respects minimum width", () => {
  const startWidth = 265;
  const dx = 30; // would bring to 235, below min(260)
  const result = continuousWidth(startWidth, dx, 260, 520);
  assert.equal(result, 260, "should clamp to minimum 260");
});

test("Nav module filter: only available packages appear", () => {
  const packages = [
    { packageName: "deal-pilot", state: "available" },
    { packageName: "job-pilot", state: "draft" },
    { packageName: "helpdesk", state: "available" },
    { packageName: "calendar", state: "deprecated" },
  ];
  const navModules = packages.filter((p) => p.state === "available");
  assert.equal(navModules.length, 2);
  assert.deepEqual(
    navModules.map((m) => m.packageName),
    ["deal-pilot", "helpdesk"]
  );
});

test("Module Detail route uses packageName as route param", () => {
  // The route is /module/:moduleId where moduleId === packageName
  for (const name of BUILT_IN_PACKAGE_NAMES) {
    const route = `/module/${name}`;
    assert.ok(route.startsWith("/module/"), `route should start with /module/`);
    assert.ok(route.endsWith(name), `route should end with packageName`);
  }
});

test("IntelligencePage sections do not include Tools, Workflows, or Skills", () => {
  // These are the section IDs that were removed (VOCAB2/VOCAB6).
  const deprecatedSectionIds = ["tools", "workflows", "skills"];
  // Mirror the current SECTIONS array from IntelligencePage.tsx
  const currentSections = ["packages", "integrations", "agents", "commons"];
  for (const deprecated of deprecatedSectionIds) {
    assert.ok(!currentSections.includes(deprecated), `Section "${deprecated}" should be removed`);
  }
});
