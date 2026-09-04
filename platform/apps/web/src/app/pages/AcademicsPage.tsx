import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { BookOpen, CalendarClock, ClipboardList, FileText, GraduationCap, Sparkles } from "lucide-react";
import { defaultViewConfig, type TableSpec, type ViewConfig } from "@bridge/tables";
import { Header } from "../components/shared/Header";
import { ModuleFilesSection } from "../components/shared/ModuleFilesSection";
import { ModuleIntelligenceSection } from "../components/shared/ModuleIntelligenceSection";
import { ModuleGovernanceSection } from "../components/shared/ModuleGovernanceSection";
import { ModuleSurfaceLayout } from "../components/shared/ModuleSurfaceLayout";
import { Input } from "../components/ui/input";
import { DataViews } from "../dataviews/DataViews";
import type { DataRow } from "../dataviews/types";
import { trpc, PILOT_ORGANIZATION } from "../lib/trpc";

type AcademicsPageId = "subjects" | "sessions" | "assignments" | "documents";

const PAGES: Array<{ id: AcademicsPageId; label: string; icon: typeof BookOpen }> = [
  { id: "subjects", label: "Subjects", icon: GraduationCap },
  { id: "sessions", label: "Lecture Sessions", icon: CalendarClock },
  { id: "assignments", label: "Assignments", icon: ClipboardList },
  { id: "documents", label: "Documents", icon: FileText },
];

function isPage(value: string | undefined): value is AcademicsPageId {
  return value === "subjects" || value === "sessions" || value === "assignments" || value === "documents";
}

const SUBJECTS_SPEC: TableSpec = {
  id: "academics.subjects",
  columns: [
    { id: "code", label: "Code", kind: "text", editable: true },
    { id: "title", label: "Title", kind: "text", editable: true, required: true },
    { id: "term", label: "Term", kind: "text", editable: true },
    { id: "instructor", label: "Instructor", kind: "text", editable: true },
    { id: "credits", label: "Credits", kind: "number", editable: true },
    {
      id: "status",
      label: "Status",
      kind: "select",
      editable: true,
      options: ["planned", "active", "complete", "dropped"],
      defaultValue: "planned",
    },
    { id: "grade", label: "Grade", kind: "text", editable: true },
    { id: "targetGrade", label: "Target grade", kind: "text", editable: true },
  ],
};

/** Subject is a plain select of subject titles rather than a `relation`
 * column — the relation-column render/edit path (RelationshipPage's
 * `community`/`members`) is read-only-derived there too. Resolving the
 * typed title back to `subjectId` at submit time is this skeleton's known
 * limitation for duplicate titles; real Subject linking is a later phase. */
function subjectColumn(subjectTitles: string[]) {
  return { id: "subject", label: "Subject", kind: "select" as const, editable: true, required: true, options: subjectTitles };
}

const SESSIONS_SPEC = (subjectTitles: string[]): TableSpec => ({
  id: "academics.lecture-sessions",
  columns: [
    subjectColumn(subjectTitles),
    { id: "sessionDate", label: "Session date", kind: "date", editable: true },
    { id: "topic", label: "Topic", kind: "text", editable: true },
    {
      id: "status",
      label: "Status",
      kind: "select",
      editable: true,
      options: ["scheduled", "attended", "missed", "reviewed"],
      defaultValue: "scheduled",
    },
    { id: "myNotes", label: "My notes", kind: "text", editable: true },
  ],
});

const ASSIGNMENTS_SPEC = (subjectTitles: string[]): TableSpec => ({
  id: "academics.assignments",
  columns: [
    subjectColumn(subjectTitles),
    { id: "title", label: "Title", kind: "text", editable: true, required: true },
    {
      id: "type",
      label: "Type",
      kind: "select",
      editable: true,
      options: ["problem_set", "essay", "project", "exam", "lab"],
    },
    { id: "dueAt", label: "Due", kind: "date", editable: true },
    { id: "weight", label: "Weight", kind: "number", editable: true, display: "meter" },
    {
      id: "status",
      label: "Status",
      kind: "select",
      editable: true,
      options: ["not_started", "in_progress", "submitted", "graded"],
      defaultValue: "not_started",
    },
    { id: "risk", label: "Risk", kind: "select", editable: true, options: ["red", "yellow", "green"], display: "rag" },
    { id: "submittedAt", label: "Submitted", kind: "date", editable: true },
    { id: "grade", label: "Grade", kind: "text", editable: true },
  ],
});

const DOCUMENTS_SPEC: TableSpec = {
  id: "academics.documents",
  columns: [
    { id: "subject", label: "Subject", kind: "text" },
    { id: "kind", label: "Type", kind: "select", options: ["page", "file"] },
    { id: "title", label: "Title", kind: "text" },
    { id: "summary", label: "AI summary", kind: "text" },
    { id: "summarizedAt", label: "Summarized", kind: "date" },
  ],
};

function textOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  const num = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(num) ? num : undefined;
}

function isoOrUndefined(value: unknown): string | undefined {
  if (!value) return undefined;
  const date = new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function AcademicsRecordListPage({ kind }: { kind: AcademicsPageId }) {
  const [subjects, setSubjects] = useState<Array<{ id: string; title: string }>>([]);
  const [rows, setRows] = useState<DataRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const spec =
    kind === "subjects"
      ? SUBJECTS_SPEC
      : kind === "sessions"
        ? SESSIONS_SPEC(subjects.map((subject) => subject.title))
        : kind === "documents"
          ? DOCUMENTS_SPEC
          : ASSIGNMENTS_SPEC(subjects.map((subject) => subject.title));
  const [view, setView] = useState<ViewConfig>(defaultViewConfig(`${spec.id}:table`, "table"));

  // Subjects are fetched on every toggle: Sessions/Assignments need the title
  // list to build their Subject select, and Subjects' own toggle needs the
  // list to resolve `subjectId -> title` when rendering rows below.
  useEffect(() => {
    let active = true;
    trpc.academics.listSubjects
      .query({ organizationId: PILOT_ORGANIZATION, limit: 200, offset: 0 })
      .then((page) => {
        if (active) setSubjects(page.items.map((item) => ({ id: item.id, title: item.title })));
      })
      .catch(() => {
        // Subjects list is supplementary here (drives the select + subject
        // labels); a failure degrades to an empty picker, not a page error.
      });
    return () => {
      active = false;
    };
  }, [reload]);

  useEffect(() => {
    let active = true;
    setRows(null);
    setError(null);
    const byId = new Map(subjects.map((subject) => [subject.id, subject.title]));
    const request =
      kind === "subjects"
        ? trpc.academics.listSubjects.query({ organizationId: PILOT_ORGANIZATION, limit: 100, offset: 0 })
        : kind === "sessions"
          ? trpc.academics.listLectureSessions.query({ organizationId: PILOT_ORGANIZATION, limit: 100, offset: 0 })
          : kind === "documents"
            ? trpc.academics.listDocuments.query({ organizationId: PILOT_ORGANIZATION, limit: 100, offset: 0 })
            : trpc.academics.listAssignments.query({ organizationId: PILOT_ORGANIZATION, limit: 100, offset: 0 });
    request
      .then((page) => {
        if (!active) return;
        setTotal(page.total);
        setRows(
          page.items.map((item: Record<string, unknown>) =>
            kind === "subjects"
              ? {
                  id: item["id"],
                  code: item["code"] ?? "",
                  title: item["title"],
                  term: item["term"] ?? "",
                  instructor: item["instructor"] ?? "",
                  credits: item["credits"] ?? undefined,
                  status: item["status"],
                  grade: item["grade"] ?? "",
                  targetGrade: item["targetGrade"] ?? "",
                }
              : kind === "sessions"
                ? {
                    id: item["id"],
                    subject: byId.get(String(item["subjectId"])) ?? "",
                    sessionDate: item["sessionDate"] ?? "",
                    topic: item["topic"] ?? "",
                    status: item["status"],
                    myNotes: item["myNotes"] ?? "",
                  }
                : kind === "documents"
                  ? {
                      id: item["id"],
                      subject: byId.get(String(item["subjectId"])) ?? "",
                      kind: item["kind"],
                      title: item["title"],
                      summary: item["summary"] ?? "",
                      summarizedAt: item["summarizedAt"] ?? "",
                    }
                  : {
                      id: item["id"],
                      subject: byId.get(String(item["subjectId"])) ?? "",
                      title: item["title"],
                      type: item["type"] ?? "",
                      dueAt: item["dueAt"] ?? "",
                      weight: item["weight"] ?? undefined,
                      status: item["status"],
                      risk: item["risk"] ?? "",
                      submittedAt: item["submittedAt"] ?? "",
                      grade: item["grade"] ?? "",
                    },
          ),
        );
      })
      .catch((cause) => {
        if (active) setError(String(cause));
      });
    return () => {
      active = false;
    };
  }, [kind, reload, subjects]);

  async function insertRecord(draft: Partial<DataRow>) {
    if (kind === "subjects") {
      const title = textOrUndefined(draft["title"]);
      if (!title) throw new Error("Title is required.");
      await trpc.academics.createSubject.mutate({
        organizationId: PILOT_ORGANIZATION,
        title,
        ...(textOrUndefined(draft["code"]) ? { code: textOrUndefined(draft["code"]) } : {}),
        ...(textOrUndefined(draft["term"]) ? { term: textOrUndefined(draft["term"]) } : {}),
        ...(textOrUndefined(draft["instructor"]) ? { instructor: textOrUndefined(draft["instructor"]) } : {}),
        ...(numberOrUndefined(draft["credits"]) !== undefined ? { credits: numberOrUndefined(draft["credits"]) } : {}),
        ...(textOrUndefined(draft["targetGrade"]) ? { targetGrade: textOrUndefined(draft["targetGrade"]) } : {}),
      });
    } else {
      const subjectTitle = textOrUndefined(draft["subject"]);
      const subjectId = subjects.find((subject) => subject.title === subjectTitle)?.id;
      if (!subjectId) throw new Error("Choose a Subject first — add one on the Subjects toggle if the list is empty.");
      if (kind === "sessions") {
        await trpc.academics.createLectureSession.mutate({
          organizationId: PILOT_ORGANIZATION,
          subjectId,
          ...(isoOrUndefined(draft["sessionDate"]) ? { sessionDate: isoOrUndefined(draft["sessionDate"]) } : {}),
          ...(textOrUndefined(draft["topic"]) ? { topic: textOrUndefined(draft["topic"]) } : {}),
          ...(textOrUndefined(draft["myNotes"]) ? { myNotes: textOrUndefined(draft["myNotes"]) } : {}),
        });
      } else {
        const title = textOrUndefined(draft["title"]);
        if (!title) throw new Error("Title is required.");
        await trpc.academics.createAssignment.mutate({
          organizationId: PILOT_ORGANIZATION,
          subjectId,
          title,
          ...(textOrUndefined(draft["type"]) ? { type: textOrUndefined(draft["type"]) as never } : {}),
          ...(isoOrUndefined(draft["dueAt"]) ? { dueAt: isoOrUndefined(draft["dueAt"]) } : {}),
          ...(numberOrUndefined(draft["weight"]) !== undefined ? { weight: numberOrUndefined(draft["weight"]) } : {}),
        });
      }
    }
    setReload((value) => value + 1);
  }

  async function updateRecord(id: string, draft: Partial<DataRow>) {
    if (kind === "subjects") {
      await trpc.academics.updateSubject.mutate({
        organizationId: PILOT_ORGANIZATION,
        id,
        ...(textOrUndefined(draft["code"]) !== undefined ? { code: textOrUndefined(draft["code"]) } : {}),
        ...(textOrUndefined(draft["title"]) !== undefined ? { title: textOrUndefined(draft["title"]) } : {}),
        ...(textOrUndefined(draft["term"]) !== undefined ? { term: textOrUndefined(draft["term"]) } : {}),
        ...(textOrUndefined(draft["instructor"]) !== undefined ? { instructor: textOrUndefined(draft["instructor"]) } : {}),
        ...(draft["credits"] !== undefined ? { credits: numberOrUndefined(draft["credits"]) } : {}),
        ...(draft["status"] !== undefined ? { status: draft["status"] as "planned" | "active" | "complete" | "dropped" } : {}),
        ...(draft["grade"] !== undefined ? { grade: textOrUndefined(draft["grade"]) } : {}),
        ...(draft["targetGrade"] !== undefined ? { targetGrade: textOrUndefined(draft["targetGrade"]) } : {}),
      });
    } else if (kind === "sessions") {
      await trpc.academics.updateLectureSession.mutate({
        organizationId: PILOT_ORGANIZATION,
        id,
        ...(draft["sessionDate"] !== undefined ? { sessionDate: isoOrUndefined(draft["sessionDate"]) } : {}),
        ...(draft["topic"] !== undefined ? { topic: textOrUndefined(draft["topic"]) } : {}),
        ...(draft["status"] !== undefined ? { status: draft["status"] as "scheduled" | "attended" | "missed" | "reviewed" } : {}),
        ...(draft["myNotes"] !== undefined ? { myNotes: textOrUndefined(draft["myNotes"]) } : {}),
      });
    } else {
      await trpc.academics.updateAssignment.mutate({
        organizationId: PILOT_ORGANIZATION,
        id,
        ...(draft["title"] !== undefined ? { title: textOrUndefined(draft["title"]) } : {}),
        ...(draft["type"] !== undefined ? { type: draft["type"] as never } : {}),
        ...(draft["dueAt"] !== undefined ? { dueAt: isoOrUndefined(draft["dueAt"]) } : {}),
        ...(draft["weight"] !== undefined ? { weight: numberOrUndefined(draft["weight"]) } : {}),
        ...(draft["status"] !== undefined ? { status: draft["status"] as "not_started" | "in_progress" | "submitted" | "graded" } : {}),
        ...(draft["risk"] !== undefined ? { risk: draft["risk"] as "red" | "yellow" | "green" } : {}),
        ...(draft["submittedAt"] !== undefined ? { submittedAt: isoOrUndefined(draft["submittedAt"]) } : {}),
        ...(draft["grade"] !== undefined ? { grade: textOrUndefined(draft["grade"]) } : {}),
      });
    }
    setReload((value) => value + 1);
  }

  const [summarizing, setSummarizing] = useState(false);
  const [summarizeMessage, setSummarizeMessage] = useState<string | null>(null);
  async function runSummarize() {
    setSummarizing(true);
    setSummarizeMessage(null);
    try {
      const result = (await trpc.academics.canvas.summarize.mutate({ organizationId: PILOT_ORGANIZATION })) as
        | { documentsConsidered?: number; summarized?: number; skipped?: number; modelConfigured?: boolean }
        | undefined;
      setSummarizeMessage(
        result?.modelConfigured === false
          ? "No cloud model is configured — add an API key (OpenRouter, Anthropic, or Groq) in Settings first."
          : `Summarized ${result?.summarized ?? 0} of ${result?.documentsConsidered ?? 0} unsummarized document(s).`,
      );
      setReload((value) => value + 1);
    } catch (cause) {
      setSummarizeMessage(`Summarize failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setSummarizing(false);
    }
  }

  const label = PAGES.find((page) => page.id === kind)!.label;
  const visibleRows = rows?.filter((row) => {
    if (!search.trim()) return true;
    const query = search.trim().toLowerCase();
    return Object.values(row).some((value) => String(value ?? "").toLowerCase().includes(query));
  }) ?? null;

  if (error) return <div className="p-4 sm:p-6 text-sm text-red-600 break-words">{error}</div>;
  if (visibleRows === null) return <div className="p-4 sm:p-6 text-sm text-muted-foreground">Loading {label.toLowerCase()}…</div>;

  return (
    <ModuleSurfaceLayout
      above={
        <div className="border-b px-4 py-3 flex items-center justify-between gap-3" style={{ borderColor: "var(--color-border)" }}>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-8 max-w-sm"
            placeholder={`Search ${label.toLowerCase()}…`}
            aria-label={`Search ${label}`}
          />
          {kind === "documents" && (
            <div className="flex items-center gap-2">
              {summarizeMessage && (
                <span className="text-xs" style={{ color: "var(--color-warm-gray)" }}>
                  {summarizeMessage}
                </span>
              )}
              <button
                type="button"
                onClick={() => void runSummarize()}
                disabled={summarizing}
                className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm"
                style={{ borderColor: "var(--color-border)" }}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {summarizing ? "Summarizing…" : "Summarize"}
              </button>
            </div>
          )}
        </div>
      }
      table={
        <section aria-label={`${label} landing section`} className="h-full">
          <DataViews
            spec={spec}
            view={view}
            data={visibleRows}
            onViewChange={setView}
            {...(kind === "documents"
              ? { insertDisabledReason: "Documents sync from Canvas — connect and Sync at /integrations/canvas" }
              : { onInsert: insertRecord, onUpdate: updateRecord, canUpdateRow: () => true })}
          />
        </section>
      }
      footer={
        total > 0 ? (
          <div className="border-t px-4 py-3 text-xs" style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}>
            {total} {label}
          </div>
        ) : null
      }
      below={
        <>
          <div className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }}>
            <ModuleFilesSection moduleName="academics" />
          </div>
          <div className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }}>
            <ModuleIntelligenceSection moduleName="academics" />
            <ModuleGovernanceSection moduleName="academics" />
          </div>
        </>
      }
    />
  );
}

export function AcademicsPage() {
  const { page } = useParams<{ page: string }>();
  const navigate = useNavigate();
  const activePage = isPage(page) ? page : "subjects";
  const active = PAGES.find((item) => item.id === activePage)!;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden w-full max-w-full" style={{ backgroundColor: "var(--color-background)" }}>
      <Header
        tabs={PAGES.map((item) => ({ id: item.label, icon: item.icon }))}
        activeTab={active.label}
        onTabChange={(label) => {
          const next = PAGES.find((item) => item.label === label);
          if (next) navigate(`/module/academics/${next.id}`);
        }}
      />
      <AcademicsRecordListPage key={activePage} kind={activePage} />
    </div>
  );
}

export default AcademicsPage;
