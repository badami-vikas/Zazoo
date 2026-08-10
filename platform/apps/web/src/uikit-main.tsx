/**
 * UI Kit lab (/uikit.html) — the one place the shared surface can be seen on
 * its own, with no Module, no API and no data.
 *
 * WHY IT EXISTS. User challenge 2026-08-10: *"Infact I thought you were
 * reusing one UI kit everywhere, but you arent and thats why differnt pages
 * appear different. If you were using one kit, any changes in kit should have
 * been reflected across."* That was correct, and the reason it kept happening
 * is that the kit had no surface of its own: the only way to look at a
 * dropdown or a toolbar was to open a Module Page, which needs the desktop
 * shell and a live API sidecar. So the kit was only ever reviewed indirectly,
 * per page, which is exactly how per-page drift survives.
 *
 * This page renders the shared primitives directly. A change here is a change
 * everywhere, and it can be checked in a plain browser in seconds.
 *
 * NOT A FIXTURE SURFACE: nothing here is wired to Bridge data, and nothing in
 * the app reads from it. The rows below are obvious placeholders for looking
 * at layout — they are never presented as Records (docs/dummy.md's concern is
 * runtime surfaces claiming fake data; this is a component lab).
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { defaultViewConfig, type TableSpec, type ViewConfig } from "@bridge/tables";
import { useState } from "react";
import { DataViews } from "./app/dataviews/DataViews";
import { viewConfigForKind } from "./app/dataviews/eligibility";
import { DashboardRow } from "./app/components/shared/DashboardRow";
import { Button } from "./app/components/ui/button";
import type { DataRow, GraphData } from "./app/dataviews/types";
import "./styles/globals.css";

const SPEC: TableSpec = {
  id: "uikit.sample",
  columns: [
    { id: "name", label: "Name", kind: "text" },
    { id: "stage", label: "Stage", kind: "select", options: ["Sourced", "Engaged", "Closed"] },
    { id: "amount", label: "Amount", kind: "number", display: "currency" },
    { id: "owner", label: "Owner", kind: "text" },
  ],
};

const ROWS: DataRow[] = [
  { id: "1", name: "Placeholder One", stage: "Sourced", amount: 1200000, owner: "Unassigned" },
  { id: "2", name: "Placeholder Two", stage: "Engaged", amount: 450000, owner: "Unassigned" },
  { id: "3", name: "Placeholder Three", stage: "Closed", amount: 2750000, owner: "Unassigned" },
];

function Panel({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="text-sm font-semibold" style={{ color: "var(--color-navy)" }}>{title}</h2>
        <p className="text-xs" style={{ color: "var(--color-warm-gray)" }}>{note}</p>
      </div>
      <div
        className="rounded-xl border p-3"
        style={{ borderColor: "var(--color-border)", background: "var(--color-background)" }}
      >
        {children}
      </div>
    </section>
  );
}

/** Each instance owns its own ViewConfig so switching a view in one panel
 *  doesn't move the others. */
function Sample({ data, width }: { data: DataRow[]; width: string }) {
  const [view, setView] = useState<ViewConfig>(() => defaultViewConfig(`${SPEC.id}:table`));
  return (
    <div style={{ width, height: 360 }} className="overflow-hidden">
      <DataViews
        spec={SPEC}
        view={view}
        data={data}
        onViewChange={setView}
        searchPlaceholder="Search…"
        onInsert={async () => {}}
        insights={
          <DashboardRow
            metrics={[
              { id: "count", label: "Rows", value: String(data.length) },
              { id: "open", label: "Open", value: "—" },
              { id: "value", label: "Value", value: "—" },
            ]}
          />
        }
        actions={<Button size="sm" variant="outline">Action</Button>}
      />
    </div>
  );
}

/** A deliberately tiny graph — enough types to show the categorical palette and
 *  enough edges to show that Relation labels are drawn ON the edge. */
const GRAPH_SPEC: TableSpec = {
  id: "uikit.graph",
  columns: [
    { id: "name", label: "Name", kind: "text", editable: false },
    { id: "related", label: "Related", kind: "relation", relationTarget: "uikit.related", editable: false },
  ],
};

const GRAPH: GraphData = {
  databases: [
    { id: "relationship.people", label: "People", moduleId: "relationship" },
    { id: "dealpilot.deals", label: "Deals", moduleId: "dealpilot" },
    { id: "relationship.communities", label: "Communities", moduleId: "relationship" },
  ],
  nodes: [
    { id: "p1", label: "Placeholder Person", databaseId: "relationship.people", databaseLabel: "People", moduleId: "relationship" },
    { id: "p2", label: "Second Person", databaseId: "relationship.people", databaseLabel: "People", moduleId: "relationship" },
    { id: "d1", label: "Placeholder Deal", databaseId: "dealpilot.deals", databaseLabel: "Deals", moduleId: "dealpilot" },
    { id: "c1", label: "Placeholder Community", databaseId: "relationship.communities", databaseLabel: "Communities", moduleId: "relationship" },
  ],
  edges: [
    { id: "e1", sourceId: "p1", targetId: "d1", label: "introduced by", relationType: "introduced_by" },
    { id: "e2", sourceId: "p2", targetId: "d1", label: "advises", relationType: "advises" },
    { id: "e3", sourceId: "p1", targetId: "c1", label: "member of", relationType: "member_of" },
    { id: "e4", sourceId: "p2", targetId: "p1", label: "worked with", relationType: "worked_with" },
  ],
};

function GraphSample() {
  const [view, setView] = useState<ViewConfig>(() =>
    viewConfigForKind(GRAPH_SPEC, "graph", { id: "uikit.graph:graph", graphScope: "full" }),
  );
  return (
    <div style={{ height: 520 }} className="overflow-hidden">
      <DataViews
        spec={GRAPH_SPEC}
        view={view}
        data={[]}
        availableKinds={["graph"]}
        onViewChange={setView}
        graphData={GRAPH}
      />
    </div>
  );
}

function UiKit() {
  return (
    <main
      className="min-h-screen p-6 flex flex-col gap-8"
      style={{ background: "var(--color-surface)" }}
    >
      <header>
        <h1 className="text-lg font-semibold" style={{ color: "var(--color-navy)" }}>Bridge UI Kit</h1>
        <p className="text-xs" style={{ color: "var(--color-warm-gray)" }}>
          The shared surface, rendered with no Module and no API. What this page
          shows is what every Module Page shows.
        </p>
      </header>

      <Panel
        title="Sandwich row + populated table"
        note="List → View → Search → Filter → actions → 3-dots → insights chevron, on ONE line."
      >
        <Sample data={ROWS} width="100%" />
      </Panel>

      <Panel
        title="Empty table"
        note="Zero rows keeps the headers, column rhythm, add-row and footer — no message replaces the table."
      >
        <Sample data={[]} width="100%" />
      </Panel>

      <Panel
        title="Narrow — staged collapse"
        note="As width drops the search compresses, then labels go icon-only, then Filter moves into the 3-dots. It never wraps to a second line."
      >
        <Sample data={ROWS} width="560px" />
      </Panel>

      <Panel title="Narrower still" note="Same row, less space.">
        <Sample data={ROWS} width="380px" />
      </Panel>

      <Panel
        title="Graph — labelled Relations, colour by type"
        note="Every edge carries its Relation label, rotated to the edge and never upside down. Node colour is categorical with a legend; labels fade out as you zoom out."
      >
        <GraphSample />
      </Panel>
    </main>
  );
}

createRoot(document.getElementById("uikit-root")!).render(
  <StrictMode>
    <UiKit />
  </StrictMode>,
);
