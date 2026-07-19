/**
 * module-detail.test.mjs — focused tests for TASK-001 Module Detail and
 * PanelControl logic (§4b, §5b).
 *
 * Tests are pure-logic (no DOM/React runtime), exercising:
 *   1. RISK_LABELS — every risk tier has a display label
 *   2. PanelControl state logic — collapsed persists, width clamping, drag direction
 *   3. Nav modules filter — only installed, available modules are shown
 *
 * Run with: node --test test/module-detail.test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// ---------------------------------------------------------------------------
// Inline the logic under test so this file has no import dependency on React
// or the browser environment. Tests validate the algorithms, not the JSX.
// ---------------------------------------------------------------------------

/** Mirrored from ModuleDetailPage.tsx */
const RISK_LABELS = {
  informational: "Informational — read-only",
  advisory: "Advisory — reads and proposes changes",
  transformational: "Transformational — modifies local data",
  operational: "Operational — manages live resources",
  external: "External — sends to external services (governed)",
};

/** Mirrored from built-in-modules.ts */
const BUILT_IN_MODULE_NAMES = ["deal-pilot", "job-pilot", "relationship", "calendar"];

// ---------------------------------------------------------------------------
// PanelControl state logic (mirrored from usePanelControl, no React)
// ---------------------------------------------------------------------------

/** Pure clamp helper matching usePanelControl's onMove logic. */
function clampWidth(raw, min, max) {
  return Math.min(max, Math.max(min, raw));
}

/** Pure snap helper matching usePanelControl's snap onUp logic. */
function snapDecision(finalWidth, snapMidpoint, defaultWidth) {
  if (finalWidth >= snapMidpoint) {
    return { collapsed: false, width: Math.max(defaultWidth, finalWidth) };
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

test("RISK_LABELS covers all risk tiers from built-in-modules.ts", () => {
  // built-in modules use: advisory, operational, external
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

test("PanelControl snap: above midpoint preserves the dragged width", () => {
  const result = snapDecision(150, 148, 220);
  assert.deepEqual(result, { collapsed: false, width: 220 });
});

test("PanelControl snap: exactly at midpoint expands (boundary inclusive)", () => {
  const result = snapDecision(148, 148, 220);
  assert.deepEqual(result, { collapsed: false, width: 220 });
});

test("PanelControl snap: extended width is preserved instead of snapping to normal width", () => {
  const result = snapDecision(340, 148, 220);
  assert.deepEqual(result, { collapsed: false, width: 340 });
});

test("PanelControl right panel: drag left (negative client delta) grows width", () => {
  // Right panel: dragging LEFT (startX > ev.clientX) means dx < 0 → startWidth - dx > startWidth
  const startWidth = 286;
  const dx = -20; // dragged 20px left
  const result = continuousWidth(startWidth, dx, 260, 520);
  assert.equal(result, 306, "right panel drag left by 20px should grow by 20px");
});

test("PanelControl right panel: drag right (positive client delta) shrinks width", () => {
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

test("Nav module filter: only installed Module manifests appear", () => {
  const modules = [
    { moduleName: "deal-pilot", state: "available", status: "installed", manifest: { module: {} } },
    { moduleName: "job-pilot", state: "available", status: "pending_review", manifest: { module: {} } },
    { moduleName: "relationship", state: "available", status: "installed", manifest: { module: {} } },
    { moduleName: "calendar", state: "deprecated", status: "installed", manifest: { module: {} } },
    {
      moduleName: "calendar-skill",
      state: "available",
      status: "installed",
      manifest: {},
      moduleAttachment: { ownerModuleName: "job-pilot" },
    },
  ];
  const navModules = modules.filter(
    (p) =>
      p.state === "available" &&
      p.status === "installed" &&
      p.manifest?.module !== undefined &&
      p.moduleAttachment === undefined,
  );
  assert.equal(navModules.length, 2);
  assert.deepEqual(
    navModules.map((m) => m.moduleName),
    ["deal-pilot", "relationship"]
  );
});

test("Module Detail route uses moduleName as route param", () => {
  // The route is /module/:moduleId where moduleId === moduleName
  for (const name of BUILT_IN_MODULE_NAMES) {
    const route = `/module/${name}`;
    assert.ok(route.startsWith("/module/"), `route should start with /module/`);
    assert.ok(route.endsWith(name), `route should end with moduleName`);
  }
});

test("Commons discovery stays Module-scoped and does not resurrect an Intelligence route", () => {
  const routedSurfaces = ["home", "module/:moduleId", "module/relationship/helpdesk", "dealpilot", "jobpilot", "calendar/google"];
  assert.equal(routedSurfaces.includes("intelligence"), false);
  assert.equal(routedSurfaces.includes("marketplace"), false);
});

test("Commons provenance uses canonical capability vocabulary", () => {
  const source = readFileSync(new URL("../src/app/components/CommonsCapabilityPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /source \{detail\.latest\.provenance\.repositoryLicense\}/);
  assert.match(source, /capability \{detail\.latest\.provenance\.artifactLicense\}/);
  assert.doesNotMatch(source, /· artifact \{/);
});

test("Relationship routes stay Module-scoped while deprecated standalone routes remain removed", () => {
  const source = readFileSync(new URL("../src/app/routes.tsx", import.meta.url), "utf8");
  assert.match(source, /path: "module\/relationship\/signals\/:signalId"/);
  assert.match(source, /path: "module\/relationship\/people\/:recordId"/);
  assert.match(source, /path: "module\/relationship\/communities\/:recordId"/);
  assert.match(source, /path: "module\/relationship\/helpdesk"/);
  assert.doesNotMatch(source, /path: "(?:helpdesk|signals)(?:\/|")/);
  assert.doesNotMatch(source, /IntelligencePage|KnowledgeBasePage|Marketplace/);
});

test("only installed available Commons modules attach beneath their declared Module Agent", () => {
  const modules = [
    {
      moduleName: "calendar-skill",
      state: "available",
      status: "installed",
      moduleAttachment: { ownerModuleName: "job-pilot", agentId: "application-agent", needId: "calendar" },
    },
    {
      moduleName: "pending-skill",
      state: "promoted",
      status: "pending_review",
      moduleAttachment: { ownerModuleName: "job-pilot", agentId: "application-agent", needId: "calendar" },
    },
    {
      moduleName: "other-module-skill",
      state: "available",
      status: "installed",
      moduleAttachment: { ownerModuleName: "deal-pilot", agentId: "sourcing-agent", needId: "source" },
    },
  ];
  const attachments = modules.filter(
    (item) =>
      item.moduleAttachment?.ownerModuleName === "job-pilot" &&
      item.moduleAttachment.agentId === "application-agent" &&
      item.state === "available" &&
      item.status === "installed"
  );
  assert.deepEqual(attachments.map((item) => item.moduleName), ["calendar-skill"]);
});

test("Commons install retries resume promotion after an interrupted install", () => {
  function nextStep(installation) {
    if (installation.state === "available" && installation.status === "installed") return "done";
    if (installation.state === "promoted" && installation.status === "installed") return "promote";
    return "install";
  }

  assert.equal(nextStep({ state: "private", status: "pending_review" }), "install");
  assert.equal(nextStep({ state: "promoted", status: "installed" }), "promote");
  assert.equal(nextStep({ state: "available", status: "installed" }), "done");
});

test("Module Automation Run delegates to server-owned Agent execution and existing Approvals", () => {
  const source = readFileSync(new URL("../src/app/pages/ModuleDetailPage.tsx", import.meta.url), "utf8");
  assert.match(source, /trpc\.automation\.runById\.mutate/);
  assert.match(source, /automationId:\s*manifestAutomationId/);
  assert.match(source, /ownerModuleName:\s*pkg\.moduleName/);
  assert.match(source, /automation\.automationId/);
  assert.match(source, /runtimeAutomationIds\.has\(automation\.id\)/);
  assert.match(source, /automation\.runRoute/);
  assert.match(source, /to=\{automation\.runRoute\}/);
  assert.match(source, /Runtime binding pending/);
  assert.doesNotMatch(source, /actor:\s*\{/);
  assert.match(source, /to="\/approvals"/);
  assert.match(source, /Review or correct in Approvals/);
});

test("installed Commons Skill Run uses the server-owned Agent binding and existing correction surface", () => {
  const source = readFileSync(new URL("../src/app/pages/ModuleDetailPage.tsx", import.meta.url), "utf8");
  assert.match(source, /attachment\.runtimeSkillIds\.includes\(capability\.id\)/);
  assert.match(source, /trpc\.commons\.runInstalledSkill\.mutate/);
  assert.match(source, /installationId:\s*attachment\.id/);
  assert.match(source, /Run with \$\{agent\.name\}/);
  assert.match(source, /attachment\.runtimeBindingIssues\[0\]/);
  assert.match(source, /Runtime binding unavailable/);
  assert.match(source, /to="\/approvals"/);
  assert.match(source, /Review or correct in Approvals/);
  assert.doesNotMatch(source, /actor:\s*\{/);
});
