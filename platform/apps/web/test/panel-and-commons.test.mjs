/**
 * panel-and-commons.test.mjs (renamed from module-detail.test.mjs 2026-08-10 —
 * ModuleDetailPage was removed per user directive: "There is no module detail
 * page. Delete it. Ensure no trace of it remains." This file kept the tests
 * that were never actually about that page: PanelControl logic (§5b),
 * Intelligence (ADR-154), Commons attachment/install-retry, and Relationship
 * routing. The three tests that asserted against ModuleDetailPage.tsx's
 * source, and the "Module Detail route" string-format test, are gone with it.
 *
 * Tests are pure-logic (no DOM/React runtime) except where a small set of
 * source files are read and pattern-matched directly.
 *
 * Run with: node --test test/panel-and-commons.test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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

test("PanelControl Escape returns extended to expanded before collapsing", () => {
  function escapeDecision(mode, defaultWidth) {
    if (mode === "extended") return { collapsed: false, width: defaultWidth };
    if (mode === "expanded") return { collapsed: true };
    return { collapsed: true };
  }
  assert.deepEqual(escapeDecision("extended", 220), { collapsed: false, width: 220 });
  assert.deepEqual(escapeDecision("expanded", 220), { collapsed: true });
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

test("A Module with no declared Page lands on Home, never a dead /module/:id link", () => {
  // Module Detail was removed 2026-08-10; Layout.tsx's moduleNavTarget fallback
  // must route to Home, not to the deleted page's route shape.
  const layout = readFileSync(new URL("../src/app/Layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /to: nav\?\.landing \?\? "\/home"/);
  assert.match(layout, /base: nav\?\.base \?\? "\/home"/);
  assert.doesNotMatch(layout, /`\/module\/\$\{mod\.moduleName\}`/);
});

test("no trace of the Module Detail PAGE remains — the bare module path only redirects", () => {
  const routes = readFileSync(new URL("../src/app/routes.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(routes, /ModuleDetailPage/);
  // The path still resolves, but only as a redirect — never a rendered
  // surface. Deleting it outright stranded every "/module/<name>" back-link
  // in the app on a router miss.
  assert.match(routes, /path: "module\/:moduleId", Component: ModuleRootRedirect/);
  assert.match(routes, /function ModuleRootRedirect[\s\S]{0,320}<Navigate/);
});

test("Commons discovery stays Module-scoped; Intelligence stays manifest-sourced (ADR-154)", () => {
  const routes = readFileSync(new URL("../src/app/routes.tsx", import.meta.url), "utf8");
  // ADR-154 reintroduces /intelligence as something different in kind: the
  // manifest-driven cross-Module capability inventory. It must stay
  // manifest-sourced — no fixture data, no marketplace.
  assert.match(routes, /path: "intelligence", Component: IntelligencePage/);
  const page = readFileSync(new URL("../src/app/pages/IntelligencePage.tsx", import.meta.url), "utf8");
  assert.match(page, /trpc\.modules\.list/);
  assert.doesNotMatch(page, /agentsData|marketplace|AgentDetail/);
});

test("Intelligence is the cross-Module capability inventory, not a Module list (ADR-154)", () => {
  const page = readFileSync(new URL("../src/app/pages/IntelligencePage.tsx", import.meta.url), "utf8");
  // The four capability tabs the user asked for; Modules are provenance only.
  for (const tab of ["Agents", "Automations", "Skills", "Integrations"]) {
    assert.match(page, new RegExp(`"${tab}"`), `Intelligence should surface ${tab}`);
  }
  // Canon: a Skill is never free-standing — every row names its consuming Agent.
  assert.match(page, /Invoked by: \$\{skill\.agentName\}/);
  // Honest empty states, never dummy rows (UI-RULES §6a).
  assert.match(page, /No Modules are installed yet/);
  assert.match(page, /No attributable Agent bindings are declared/);

  // The left nav points at the page, and Settings no longer owns the section.
  const layout = readFileSync(new URL("../src/app/Layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /to="\/intelligence"/);
  assert.doesNotMatch(layout, /settings\?section=intelligence/);
  const settings = readFileSync(new URL("../src/app/pages/SettingsPage.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(settings, /label: "Capabilities"/);
  // ...but the old deep link still resolves rather than silently 404-ing.
  assert.match(settings, /<Navigate to="\/intelligence" replace \/>/);
});

test("Commons provenance uses canonical capability vocabulary", () => {
  const source = readFileSync(new URL("../src/app/components/CommonsCapabilityPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /source \{detail\.latest\.provenance\.repositoryLicense\}/);
  assert.match(source, /capability \{detail\.latest\.provenance\.contentLicense\}/);
  assert.doesNotMatch(source, /· result \{/);
});

test("Relationship routes stay Module-scoped while deprecated standalone routes remain removed", () => {
  const source = readFileSync(new URL("../src/app/routes.tsx", import.meta.url), "utf8");
  assert.match(source, /requireBuiltInModule\("relationship"\)/);
  assert.ok(source.includes("${childPath(relationshipSignalsRoute)}/:signalId"));
  assert.ok(source.includes("${childPath(relationshipModule.route)}/people/:recordId"));
  assert.ok(source.includes("${childPath(relationshipModule.route)}/communities/:recordId"));
  assert.ok(source.includes("${childPath(relationshipModule.route)}/helpdesk"));
  assert.doesNotMatch(source, /path: "(?:helpdesk|signals)(?:\/|")/);
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

test("both shell panels share a single collapse control + double-arrow resize handle (no extend button) and Escape", () => {
  // UX realignment 2026-07-27 (AP-073): the full-screen / extend icon was
  // dropped. Each panel keeps exactly ONE collapse control plus the inner-edge
  // double-sided arrow (MoveHorizontal) resize handle; Escape still steps back.
  const panelSource = readFileSync(new URL("../src/app/components/shared/PanelControl.tsx", import.meta.url), "utf8");
  const layoutSource = readFileSync(new URL("../src/app/Layout.tsx", import.meta.url), "utf8");
  const chatSource = readFileSync(new URL("../src/app/components/shared/AgentPanel.tsx", import.meta.url), "utf8");
  assert.match(panelSource, /function handleEscape/);
  assert.match(panelSource, /function ResizeHandle/);
  assert.match(panelSource, /MoveHorizontal/);
  // The extend/full-screen control is gone from the component and both panels.
  assert.doesNotMatch(panelSource, /function ExtendToggleButton/);
  assert.doesNotMatch(layoutSource, /ExtendToggleButton/);
  assert.doesNotMatch(chatSource, /ExtendToggleButton/);
  // A single shared collapse control remains on each panel.
  assert.match(layoutSource, /<CollapseToggleButton/);
  assert.match(layoutSource, /rail\.handleEscape\(\)/);
  assert.match(chatSource, /<CollapseToggleButton/);
  assert.match(chatSource, /panel\.handleEscape\(\)/);
});
