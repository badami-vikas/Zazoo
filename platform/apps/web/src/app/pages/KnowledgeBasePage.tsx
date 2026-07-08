/**
 * KnowledgeBase (ADR-023 item 2, docs/raw/decisions-log.md) — replaces the
 * never-built standalone "Network" page (this repo never had one; the rename
 * target is the CONCEPT ADR-023 describes, not an existing file) with a
 * toggle-tabbed shell: People / Communities / Resources / Projects (display
 * label for the kernel `initiative` node type — identifiers unchanged).
 *
 * Each toggle wires to whatever real tRPC query already backs that data:
 * - Projects -> `graph.listInitiatives` (same source WorkspacePage.tsx uses).
 * - Resources -> `resources.list` (same source ResourcesPage.tsx uses).
 * - People / Communities -> NO backend query exists yet (no `graph.listPeople`
 *   / `graph.listCommunities` procedure — grep-confirmed against
 *   apps/api/src/router.ts's `graph` router, which only has
 *   listInitiatives/listTouchpoints/listSignals/recordSignalAction). Rather
 *   than fabricate rows, these toggles render an honest "not wired yet" empty
 *   state and the gap is filed in docs/BUGS.md.
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { trpc, PILOT_WORKSPACE } from "../lib/trpc";
import { Target, BookOpen, Users, User } from "lucide-react";
import { Header } from "../components/shared/Header";
import { DataViews, type DataRow } from "../dataviews/index";
import type { TableSpec, ViewConfig } from "@bridge/tables";
import { defaultViewConfig } from "@bridge/tables";
import { ResourcesPage } from "./ResourcesPage";

type KnowledgeBaseSection = "people" | "communities" | "resources" | "projects";

/** Tab order = biggest-to-smallest complexity (user revision 2026-07-06):
 * Initiatives (kernel `initiative` node type), Resources, Communities, People. */
const SECTIONS: { id: KnowledgeBaseSection; label: string; icon: typeof Target }[] = [
  { id: "projects", label: "Initiatives", icon: Target },
  { id: "resources", label: "Resources", icon: BookOpen },
  { id: "communities", label: "Communities", icon: Users },
  { id: "people", label: "People", icon: User },
];

const PROJECTS_SPEC: TableSpec = {
  id: "initiative",
  columns: [
    { id: "id", label: "ID", kind: "text" },
    { id: "name", label: "Name", kind: "text" },
    { id: "stage", label: "Stage", kind: "select" },
    { id: "createdAt", label: "Created", kind: "date" },
  ],
};

function NotWiredYet({ label }: { label: string }) {
  return (
    <div className="p-6 border rounded-md text-sm text-muted-foreground max-w-xl">
      {label} isn't wired to a data source yet — no read endpoint exists on the backend for it. Tracked in
      docs/BUGS.md. Honest empty state, not fabricated data.
    </div>
  );
}

function ProjectsSection() {
  const [rows, setRows] = useState<DataRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewConfig>(defaultViewConfig("projects-default", "table"));

  useEffect(() => {
    trpc.graph.listInitiatives
      .query({ workspaceId: PILOT_WORKSPACE, limit: 100, offset: 0 })
      .then((page) => setRows(page.items.map((r) => ({ ...r }))))
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <div className="p-4 text-sm text-red-600 break-words">{error}</div>;
  if (rows === null) return <div className="p-4 text-sm text-muted-foreground">Loading projects…</div>;

  return <DataViews spec={PROJECTS_SPEC} view={view} data={rows} onViewChange={setView} />;
}

/**
 * Cross-disciplinary container per ADR-023 item 2: "Projects = cross-
 * disciplinary container (people + orgs + resources + chat outputs)". Today
 * it renders the wired `initiative` rows only — the people/orgs/resources
 * cross-linking is a real gap (no join/aggregation endpoint exists), left as
 * an honest single-source view rather than a fabricated composite.
 */
function isKnowledgeBaseSection(value: string | null): value is KnowledgeBaseSection {
  return value === "people" || value === "communities" || value === "resources" || value === "projects";
}

export function KnowledgeBasePage() {
  const [searchParams] = useSearchParams();
  const initialSection = searchParams.get("section");
  const [section, setSection] = useState<KnowledgeBaseSection>(
    isKnowledgeBaseSection(initialSection) ? initialSection : "projects",
  );

  const active = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden w-full max-w-full">
      <Header
        tabs={SECTIONS.map((s) => ({ id: s.label, icon: s.icon }))}
        activeTab={active.label}
        onTabChange={(label) => {
          const next = SECTIONS.find((s) => s.label === label);
          if (next) setSection(next.id);
        }}
      />
      <div className="flex-1 overflow-auto p-4 sm:p-6">
        {section === "people" && <NotWiredYet label="People" />}
        {section === "communities" && <NotWiredYet label="Communities" />}
        {section === "resources" && <ResourcesPage embedded />}
        {section === "projects" && <ProjectsSection />}
      </div>
    </div>
  );
}
