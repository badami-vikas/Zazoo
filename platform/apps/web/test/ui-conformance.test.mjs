/**
 * UI conformance gate — the corrective measure for "the UI rules kept getting lost"
 * (user directive 2026-08-10).
 *
 * ROOT CAUSE THIS TEST EXISTS TO FIX: the UI standardization rules lived ONLY in
 * docs/raw/ui-architecture-rules-2026-07.md. A doc rule is advisory — nothing in
 * the build ever failed when a page hand-rolled its own toolbar, dropdown, or
 * table. So every new surface (ChiefOfStaffPage, ResearchRunsPage,
 * …) quietly re-invented the shell, and "standardized" became a claim in a
 * document rather than a property of the code.
 *
 * This test turns each rule into something that FAILS. A page that reinvents a
 * standard surface breaks `pnpm verify`, in CI, before review — the rule stops
 * depending on anyone remembering it.
 *
 * ADDING A PAGE: a new data-shape page must render through <ModuleSurfaceLayout>
 * + <DataViews>. If it genuinely is not a data-shape page, add it to EXEMPT with
 * a real reason. The exemption list is deliberately noisy to read — a growing
 * list is the signal that the shell is missing a capability, not that the rule
 * is wrong.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "app");
const PAGES = join(APP, "pages");
/** Read a source file by its path relative to `src/`. */
const read = (rel) => readFileSync(join(APP, "..", ...rel.replace(/^src\//, "").split("/")), "utf8");

/**
 * Pages that legitimately do NOT render a Database through the standard shell.
 * Each entry states WHY. An entry with no reason, or a reason that no longer
 * holds, is a bug in this list — not a licence to diverge.
 */
const EXEMPT = {
  "GoogleIntegrationPanel.tsx": "Integration credential/consent panel — no Database rows.",
  "GithubIntegrationPanel.tsx": "Integration credential/consent panel — no Database rows.",
  "HomePage.tsx": "Cross-Module landing surface; composes Module cards, owns no single Database.",
  "PublicHelpdesk.tsx": "Unauthenticated surface outside the authed nav shell entirely.",
  "SettingsPage.tsx": "Preferences form; not a Database view.",
  "TaskRecordDetailPage.tsx": "Record Detail surface (§3b) — sections, not a landing view.",
  "ModuleRecordDetailPage.tsx": "Record Detail surface (§3b, C-15) of a Builder-built Module — fields + Sections, not a landing view.",
  "IntelligencePage.tsx": "Agents/Automations/Integrations inventory (§4b), manifest-sourced.",
  "ChiefOfStaffPage.tsx": "Agent conversation surface, not a Database page.",
  "WhatsAppPage.tsx": "Live session surface driven by the WhatsApp engine, not a table.",
  "RelationshipHelpdeskPage.tsx": "Ticket thread surface; Record Detail shape (§3b).",
  "OrganizationPage.tsx":
    "Compiled-Organization preview that stacks SEVERAL Databases down one auto-height page; <ModuleSurfaceLayout>'s first screen holds exactly one table region, and each preview already renders through <DataViews fill={false}>.",
  "RelationshipSubmodulePage.tsx":
    "Signpost for a sub-module whose Records live on another Page — it owns no Database rows, only links and the Module Sections.",
  "AgentDetailPage.tsx":
    "One Agent's manifest-sourced, read-only detail with the ADR-250 Zazoo room rig — no Database rows, like IntelligencePage it reads modules.list.",
};

/**
 * Hand-rolled re-implementations of surfaces that already have ONE shared
 * component. A page matching any of these is doing case-by-case UI — exactly
 * what the standard exists to prevent (§5, §5e).
 */
const REINVENTIONS = [
  {
    // A bespoke dropdown: an open/close state driving an absolutely-positioned
    // menu panel. StandardDropdown (§5e) owns search + pinned Add for all of them.
    pattern: /absolute\s+top-full/,
    rule: "§5e — dropdowns render through <StandardDropdown> (search + pinned Add), never hand-rolled",
  },
  {
    // A bespoke toolbar row: the standard one is <DataViews>'s.
    // Anchored: `searchPlaceholder="Search jobs…"` is a page handing <DataViews>
    // its placeholder — the compliant path — and the unanchored form matched it,
    // which is why JobPilotPage sat in the ratchet for a divergence it never had.
    // A gate that fires on correct code is a gate people learn to suppress.
    pattern: /(?:^|[^a-zA-Z])placeholder=["'`]Search\s/i,
    rule: "§5 — the search slot belongs to <DataViews>, not a page-local input",
  },
  {
    // A bespoke table: TableView/GlideTableView render through <DataViews>.
    pattern: /<table[\s>]/i,
    rule: "§5 — tabular data renders through <DataViews>, never a raw <table>",
  },
];

/**
 * THE RATCHET IS EMPTY (TASK-061, 2026-09-03). It listed seven pages that
 * diverged before this gate existed; every one has been routed through the
 * shell or exempted with a written reason, so the list and its stale-entry test
 * are DELETED rather than kept as an empty formality — an empty backlog nobody
 * can add to is what the burn-down was for.
 *
 * A page that diverges now fails immediately. There is no list to join.
 */
function pageFiles() {
  return readdirSync(PAGES).filter((f) => f.endsWith(".tsx"));
}

/** The conformance assertion, shared by both scans. */
function assertRatchet(offenders, what) {
  assert.deepEqual(
    offenders,
    [],
    `${what}. Use the shared component, or — only with a written reason — add\n` +
      `the page to EXEMPT:\n  - ${offenders.join("\n  - ")}`,
  );
  return offenders;
}

test("every data-shape page renders through the standard shell (§3, §5)", (t) => {
  const offenders = [];
  for (const file of pageFiles()) {
    if (file in EXEMPT) continue;
    const src = readFileSync(join(PAGES, file), "utf8");
    const hasLayout = src.includes("ModuleSurfaceLayout");
    const hasViews = /<DataViews[\s/>]/.test(src);
    if (!hasLayout || !hasViews) {
      offenders.push(
        `${file}: ${hasLayout ? "" : "missing <ModuleSurfaceLayout> "}${hasViews ? "" : "missing <DataViews>"}`.trim(),
      );
    }
  }
  assertRatchet(offenders, "page bypassing the standard shell");
  t.diagnostic(`shell backlog remaining: ${offenders.length}`);
});

test("no page re-implements a standardized primitive (§5, §5e)", (t) => {
  const offenders = [];
  for (const file of pageFiles()) {
    // A page exempted from the shell WITH A REASON cannot then be required to
    // use the shell's slots: SettingsPage is a preferences form and Helpdesk is
    // a ticket thread, and neither has a toolbar to put a search box in.
    if (file in EXEMPT) continue;
    const src = readFileSync(join(PAGES, file), "utf8");
    for (const { pattern, rule } of REINVENTIONS) {
      if (pattern.test(src)) offenders.push(`${file}: ${rule}`);
    }
  }
  assertRatchet(offenders, "case-by-case UI");
  t.diagnostic(`primitive backlog remaining: ${offenders.length}`);
});

test("there is ONE toolbar, and it is <DataViews>'s (§5, TASK-061)", () => {
  // StandardToolbar was the second one — §5-conformant, one consumer, and the
  // reason "which toolbar is canonical?" had two answers. Approvals moved onto
  // the shell and the file is deleted; a re-introduction fails here.
  assert.throws(
    () => read("src/app/components/shared/StandardToolbar.tsx"),
    /ENOENT/,
    "A second toolbar component is back. The canonical row lives in <DataViews>.",
  );
  const shell = read("src/app/dataviews/DataViews.tsx");
  // §5 slot order, read off the one row that survives.
  const order = ["List", "Switch view", "searchPlaceholder", "Filter", "{actions}", "View actions"];
  let cursor = 0;
  for (const slot of order) {
    const at = shell.indexOf(slot, cursor);
    assert.ok(at > 0, `§5 slot "${slot}" is missing or out of order in the toolbar row.`);
    cursor = at;
  }
});

test("every exemption states a reason (the list cannot rot silently)", () => {
  const files = new Set(pageFiles());
  for (const [file, reason] of Object.entries(EXEMPT)) {
    assert.ok(files.has(file), `EXEMPT lists ${file}, which no longer exists — remove the entry.`);
    assert.ok(
      typeof reason === "string" && reason.length > 20,
      `EXEMPT[${file}] needs a real reason, not "${reason}".`,
    );
  }
});

test("dropdowns are built on the one shared primitive (§5e)", () => {
  const shared = join(APP, "components", "shared");
  // `ListDropdown` is gone with the second toolbar that was its only consumer
  // (TASK-061). The List control lives in <DataViews> on StandardDropdown, so
  // there is one dropdown primitive rather than one plus a wrapper.
  const standard = readFileSync(join(shared, "StandardDropdown.tsx"), "utf8");
  assert.match(standard, /Search/, "StandardDropdown must provide the search slot (§5e).");
  assert.match(standard, /onAdd/, "StandardDropdown must provide the pinned Add slot (§5e).");

  const dataViews = readFileSync(join(APP, "dataviews", "DataViews.tsx"), "utf8");
  assert.match(
    dataViews,
    /StandardDropdown/,
    "The View dropdown must use StandardDropdown like every other dropdown (§5e).",
  );
});

test("cell right-click opens the standard menu, and the flag lives in it (§5f)", () => {
  const table = readFileSync(join(APP, "dataviews", "views", "TableView.tsx"), "utf8");
  assert.match(
    table,
    /onContextMenu=\{\(event\) => \{/,
    "Cells must open StandardCellMenu on right-click (§5f) — two gestures, one menu.",
  );
  assert.match(table, /StandardCellMenu/, "TableView must render the shared cell menu.");

  const menu = readFileSync(join(APP, "components", "shared", "StandardCellMenu.tsx"), "utf8");
  // The row-scoped half must be the SAME item list the row caret renders —
  // never a re-typed second copy.
  assert.match(
    menu,
    /StandardRowMenuItems/,
    "The cell menu's row commands must reuse StandardRowMenuItems, not restate them.",
  );
  for (const command of ["Edit cell", "Copy value", "Clear cell", "Delete row"]) {
    assert.ok(menu.includes(command), `Cell menu is missing the "${command}" command (§5f).`);
  }
  assert.match(menu, /onToggleFlag/, "Flagging must be a cell-menu command (user directive 2026-08-10).");

  const flag = readFileSync(join(APP, "components", "shared", "RedFlagControl.tsx"), "utf8");
  assert.match(
    flag,
    /affordance = 'menu'/,
    "The flag must NOT be offered on hover by default — it is a right-click command now.",
  );
});

test("clicking an open red flag removes it (§5d, user directive 2026-08-10)", () => {
  const src = readFileSync(join(APP, "components", "shared", "RedFlagControl.tsx"), "utf8");
  // Plain activation on an open flag must reach handleClear, not the popover.
  const activate = src.slice(
    src.indexOf("async function handleGlyphActivate"),
    src.indexOf("function openDetail"),
  );
  assert.ok(activate.length > 0, "handleGlyphActivate/openDetail split not found.");
  assert.match(
    activate,
    /if \(isOpen\)[\s\S]{0,120}handleClear\(\)/,
    "A click on an open red flag must clear it directly — not open the inspect popover.",
  );
  assert.match(
    src,
    /onContextMenu=\{openDetail\}/,
    "Inspect/edit must remain reachable via the secondary gesture (right-click).",
  );
  assert.match(
    src,
    /e\.key === 'Enter' && e\.shiftKey/,
    "§5d requires a keyboard equivalent for every pointer gesture.",
  );
});

test("an empty View keeps its chrome and says nothing (§6b, user directive 2026-08-10)", () => {
  const table = read("src/app/dataviews/views/TableView.tsx");

  // The box hugs its content, so the add-row and aggregate footer land at the
  // END of the section. `h-full` put them in the middle with dead space below.
  assert.match(table, /bridge-scroll max-h-full/);
  assert.doesNotMatch(table, /bridge-scroll h-full/);

  // Zero rows draws blank filler rows, never a message.
  assert.match(table, /EMPTY_FILLER_ROWS/);
  assert.match(table, /aria-hidden="true"[\s\S]{0,160}EMPTY_FILLER_ROWS/);

  // The add-row and footer are not gated on having data (nor, since §3a, on
  // the page wiring a create path — see the add-row shape test below).
  assert.match(table, /bridge-add-row/);
  assert.doesNotMatch(table, /sorted\.length > 0 && <tfoot/);

  // Artefacts follows the same rule: an empty body block, no copy.
  const files = read("src/app/components/shared/ModuleFilesSection.tsx");
  assert.match(files, /EMPTY_BODY_MIN_HEIGHT/);
});

test("the macOS header row IS the titlebar — no strip, no repeated Organization name (§5g)", () => {
  const chrome = read("src/app/components/shared/DesktopWindowChrome.tsx");
  // The strip is what forced the Organization name to be duplicated above the shell.
  assert.doesNotMatch(chrome, /DesktopTitlebar/);
  assert.match(chrome, /MAC_TRAFFIC_LIGHT_GUTTER/);

  const layout = read("src/app/Layout.tsx");
  assert.doesNotMatch(layout, /<DesktopTitlebar/);
  // The drag region and the gutter now live on the rail's own h-14 header row.
  assert.match(layout, /data-tauri-drag-region=\{isMacDesktop/);
  assert.match(layout, /paddingLeft: MAC_TRAFFIC_LIGHT_GUTTER/);
});

test("New is always present, states a reason when disabled, and opens the Record page (§3a, TASK-083)", () => {
  const table = read("src/app/dataviews/views/TableView.tsx");
  // THE DEFECT THIS TEST WAS WRITTEN FOR, unchanged by TASK-083: gating the
  // control's EXISTENCE on onInsert is what made JobPilot and Signals silently
  // lose an affordance DealPilot and Relationship had.
  assert.doesNotMatch(table, /\{onInsert && /);
  assert.match(table, /bridge-add-row/);
  // It renders disabled with a stated reason instead of vanishing.
  assert.match(table, /disabled=\{createReason !== null\}/);
  assert.match(table, /title=\{createReason \?\? undefined\}/);

  // C-34 (AP-168, reversing C-33): New opens the Database's Record page — no
  // draft row collects a Record cell by cell in the table any more.
  assert.doesNotMatch(table, /setDraft|<DraftCell/);
  assert.match(table, /onRequestCreate\?\.\(\)/);

  // And the page it opens is the shell's, so the table and the Form view
  // cannot grow two different create surfaces again.
  const shell = read("src/app/dataviews/DataViews.tsx");
  assert.match(shell, /<RecordPage/);
  assert.match(shell, /onRequestCreate=\{\(\) => setCreating\(true\)\}/);
});

test("the Record page shows every field and writes nothing before Save (C-34, TASK-083)", () => {
  const page = read("src/app/dataviews/RecordPage.tsx");
  // EVERY field — a formula or locked column is listed with what fills it,
  // never dropped, or the create page would be a different page from the one
  // the Record gets afterwards.
  assert.match(page, /spec\.columns\.map/);
  assert.match(page, /nonEditableReason/);
  // Defaults are pre-filled (ADR-259: pre-filling a default is not a write),
  // and the only write is Save.
  assert.match(page, /initialRecordDraft/);
  assert.match(page, /defaultValue/);
  assert.doesNotMatch(page, /useEffect\([^)]*onSave/);
});

test("Record Sections are chosen per DATABASE, never per Record (ADR-261, TASK-083)", () => {
  const shell = read("src/app/dataviews/DataViews.tsx");
  // The ⋮ entry exists and offers exactly the three resolved Sections.
  assert.match(shell, /LayoutList className="size-4" \/> Records/);
  assert.match(shell, /RECORD_SECTION_IDS\.map/);

  const hook = read("src/app/dataviews/useRecordSections.ts");
  // Keyed by the spec id alone: there is no Record-scoped variant to diverge.
  assert.match(hook, /useRecordSections\(specId: string\)/);
  assert.doesNotMatch(hook, /recordId/);
  assert.match(hook, /RECORD_SECTION_IDS = \["notes", "intelligence", "governance"\]/);
});

test("every page that cannot insert states WHY (§3a, no silent omission)", () => {
  const offenders = [];
  for (const file of readdirSync(PAGES).filter((name) => name.endsWith(".tsx"))) {
    if (file in EXEMPT) continue;
    const src = readFileSync(join(PAGES, file), "utf8");
    if (!/<DataViews[\s/>]/.test(src)) continue;
    // A page either wires a create path or names the reason it has none.
    if (!/onInsert[=:]/.test(src) && !/insertDisabledReason/.test(src)) {
      offenders.push(file);
    }
  }
  assert.deepEqual(offenders, [], `pages with neither onInsert nor a stated reason: ${offenders.join(", ")}`);
});

test("Second Brain has exactly one entry point — Intelligence (ADR-224)", () => {
  const layout = read("src/app/Layout.tsx");
  // The rail entry is what disagreed with the tab strip.
  assert.doesNotMatch(layout, /to="\/second-brain"/);
  // The route survives for existing links, but redirects rather than
  // rendering a second copy of the same graph.
  const routes = read("src/app/routes.tsx");
  // Matched without spelling react-router's own prop name — that word is
  // retired BRIDGE vocabulary and the gate cannot tell a library API from ours.
  assert.match(routes, /path: "second-brain",[^\n]*<Navigate to="\/intelligence" replace \/>/);
  assert.doesNotMatch(routes, /path: "second-brain", Component/);
  // Intelligence mounts the ONE renderer, embedded.
  assert.match(read("src/app/pages/IntelligencePage.tsx"), /<SecondBrainPage embedded \/>/);
});

test("Approvals belong to Tasks — no standalone page, /approvals only redirects (ADR 2026-09-04, user report 2026-09-05)", () => {
  const routes = read("src/app/routes.tsx");
  assert.doesNotMatch(routes, /ApprovalsPage/);
  assert.match(routes, /path: "approvals",[^\n]*<Navigate to="\/task-manager" replace \/>/);
  assert.ok(!existsSync(join(PAGES, "ApprovalsPage.tsx")), "the standalone Approvals page must be deleted");
  // Every link that used to open the page now opens the Task (or the queue).
  for (const file of readdirSync(PAGES).filter((name) => name.endsWith(".tsx"))) {
    assert.doesNotMatch(readFileSync(join(PAGES, file), "utf8"), /to="\/approvals"/, `${file} still links to /approvals`);
  }
  // Unanchored proposals (a direct Human action has no Automation Run, so no
  // Task) still have ONE home: the same section the Task page renders.
  assert.match(read("src/app/pages/TaskManagerPage.tsx"), /<TaskApprovalsSection taskId=\{null\} \/>/);
  // The dead Egg call the red banner came from is gone with the page.
  assert.doesNotMatch(read("src/app/data/ledger.ts"), /outstandingMaterializations/);
});

test("the insights row is ONE component everywhere (§5, user directive 2026-08-10)", () => {
  // DealPilot used to render a bespoke `StatCard` grid inside the kit's
  // insights slot while every other Module used DashboardRow — same slot, two
  // components, visibly different Modules. Icon and tone moved INTO the kit.
  const offenders = [];
  for (const file of readdirSync(PAGES).filter((name) => name.endsWith(".tsx"))) {
    const src = readFileSync(join(PAGES, file), "utf8");
    if (!/insights=/.test(src)) continue;
    if (!/<DashboardRow/.test(src)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], `insights slots not using DashboardRow: ${offenders.join(", ")}`);
  assert.doesNotMatch(read("src/app/pages/DealPilotPage.tsx"), /function StatCard/);
});

test("every data-shape page carries a Governance Section, directly below Intelligence (ADR-248)", () => {
  // ADR-248 put Governance in ModuleSurfaceLayout's `below` slot immediately after
  // ModuleIntelligenceSection, on EVERY Module: Intelligence answers what a Module can
  // do, Governance answers what it may do, and "a capability list a reader cannot see
  // the limits of is half an answer". Shipped at 14 call sites and ungated until now —
  // which is exactly how the Second Brain rail entry drifted back.
  const missing = [];
  const outOfOrder = [];
  for (const file of readdirSync(PAGES).filter((name) => name.endsWith(".tsx"))) {
    if (file in EXEMPT) continue;
    const src = readFileSync(join(PAGES, file), "utf8");
    if (!/<DataViews[\s/>]/.test(src)) continue;
    if (!/<ModuleIntelligenceSection[\s/>]/.test(src)) continue;
    if (!/<ModuleGovernanceSection[\s/>]/.test(src)) {
      missing.push(file);
      continue;
    }
    // Governance must FOLLOW Intelligence everywhere both appear.
    const intelligence = [...src.matchAll(/<ModuleIntelligenceSection[\s/>]/g)].map((m) => m.index);
    const governance = [...src.matchAll(/<ModuleGovernanceSection[\s/>]/g)].map((m) => m.index);
    if (intelligence.length !== governance.length) {
      outOfOrder.push(`${file}: ${intelligence.length} Intelligence vs ${governance.length} Governance`);
      continue;
    }
    for (let i = 0; i < intelligence.length; i += 1) {
      if (governance[i] < intelligence[i]) outOfOrder.push(`${file}: Governance renders before Intelligence`);
    }
  }
  assert.deepEqual(missing, [], `pages with Intelligence but no Governance Section: ${missing.join(", ")}`);
  assert.deepEqual(outOfOrder, [], outOfOrder.join("; "));
});

test("the Governance Section states that an empty policy is not a default-deny (ADR-248)", () => {
  // Present-not-absent (ADR-001) governs the empty case: a Module declaring no policy
  // renders the Section with an honest empty state and is never filtered out. The
  // dangerous misreading is that silence means denial, so the copy has to say otherwise.
  const src = read("src/app/components/shared/ModuleGovernanceSection.tsx");
  assert.match(src, /not a default-deny/i, "the empty state must say an empty policy is not a default-deny");
});

test("derived metadata columns are read-only everywhere, and the shell fills them (TASK-063)", () => {
  // Nothing can write to them: they are a projection of the Event log, and a
  // second copy on the Record row could disagree with the append-only source.
  const form = read("src/app/dataviews/views/FormView.tsx");
  assert.match(form, /if \(isMetadataColumn\(col\.kind\)\) return false;/);
  const recordPage = read("src/app/dataviews/RecordPage.tsx");
  assert.match(recordPage, /isMetadataColumn\(column\.kind\)/);
  // Change-type must not offer them a type to become.
  const table = read("src/app/dataviews/views/TableView.tsx");
  assert.match(table, /isMetadataColumn\(col\.kind\) \? \{\} : \{ columnKind: col\.kind \}/);

  // The SHELL fetches them, so every page through <DataViews> gets them —
  // a per-page opt-in would be one chance to forget per page.
  const shell = read("src/app/dataviews/DataViews.tsx");
  assert.match(shell, /useRecordMetadata\(spec, data, recordEntityType\)/);
  const hook = read("src/app/dataviews/useRecordMetadata.ts");
  assert.match(hook, /trpc\.records\.metadata\.query/);
  // Merged BEFORE search and sort, or sorting by "last edited" would order on
  // empty cells.
  assert.ok(
    shell.indexOf("useRecordMetadata") < shell.indexOf("filterRowsByQuery(withMetadata"),
  );
});

test("Share acts instead of explaining, and never invents a URL (TASK-064)", () => {
  const dataViews = read("src/app/dataviews/DataViews.tsx");
  // The panel that shipped disabled now issues and revokes real grants.
  assert.match(dataViews, /Share this list/);
  assert.match(dataViews, /shareGrants\.createLink/);
  assert.match(dataViews, /shareGrants\.revoke/);

  const hook = read("src/app/dataviews/useShareGrants.ts");
  assert.match(hook, /trpc\.view\.share\.grant\.mutate/);
  assert.match(hook, /trpc\.view\.share\.revoke\.mutate/);
  // "usable" is the SERVER's answer. A client that computed expiry itself would
  // eventually disagree with the server about who still has access.
  assert.doesNotMatch(hook, /Date\.now\(\)/);

  // No fabricated share URL: Bridge has no route that opens a shared View yet,
  // so the token is shown and nothing pretends to be a link (ADR-247).
  assert.doesNotMatch(dataViews, /https?:\/\/[^"'`\s]*share/i);

  // The old refusal must be gone from the Form view's Share panel — a stated
  // reason that outlives its cause trains people to read "disabled" as decor.
  const form = read("src/app/dataviews/views/FormView.tsx");
  assert.doesNotMatch(form, /needs a governed share token for Views/);
});

test("§5's List slot is a real control, not a placeholder (TASK-062)", () => {
  // The List dropdown shipped with its Add row disabled and a reason naming
  // this task — the honest form of a capability that did not exist yet
  // (§3a/AP-021). Persistence exists now, so the placeholder reason must be
  // GONE: a disabled reason that outlives its cause trains people to read
  // "disabled" as decoration.
  const dataViews = read("src/app/dataviews/DataViews.tsx");
  assert.doesNotMatch(dataViews, /not built yet \(TASK-062\)/);
  // The slot lists saved Views beside "All", and saving goes through the
  // durable surface rather than component state.
  assert.match(dataViews, /savedViews\.views\.map/);
  assert.match(dataViews, /useSavedViews\(spec\.id\)/);
  // The shell owns this, so every page that renders through <DataViews> gets
  // saved Lists — a per-page opt-in would be one chance to forget per page.
  const hook = read("src/app/dataviews/useSavedViews.ts");
  assert.match(hook, /trpc\.view\.saved\.list\.query/);
  assert.match(hook, /trpc\.view\.saved\.save\.mutate/);
  // Selecting a List restores BOTH halves of what was on screen: the view
  // config, and the column visibility the shell keeps outside it.
  assert.match(dataViews, /setHiddenColumns\(new Set\(chosen\.hiddenColumns\)\)/);
  // Unreachable store => the row stays visible and says why, never vanishes.
  assert.match(dataViews, /Saved Lists are unavailable/);
});
