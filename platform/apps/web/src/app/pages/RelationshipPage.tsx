import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { normalizeViewKind, type TableSpec, type ViewConfig } from "@bridge/tables";
import {
  ArrowLeft,
  Archive,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Database,
  FileText,
  MessageCircle,
  Pencil,
  Radio,
  Save,
  User,
  Users,
  X,
} from "lucide-react";
import { Header } from "../components/shared/Header";
import { ModuleFilesSection } from "../components/shared/ModuleFilesSection";
import { ModuleIntelligenceSection } from "../components/shared/ModuleIntelligenceSection";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { DataViews } from "../dataviews/DataViews";
import { computeEligibleKinds, viewConfigForKind } from "../dataviews/eligibility";
import type { DataRow, GraphData, GraphEdge, GraphNode } from "../dataviews/types";
import { trpc, PILOT_ORGANIZATION } from "../lib/trpc";
import { SignalsPage } from "./SignalsPage";

type RelationshipPageId = "signals" | "people" | "communities";
type RecordKind = "person" | "community";

interface RelationshipListRecord {
  id: string;
  name: string;
  subtitle: string;
  visibility: string;
  source: string;
  isOwner: boolean;
}

const PAGES: Array<{ id: RelationshipPageId; label: string; icon: typeof Radio }> = [
  { id: "signals", label: "Signals", icon: Radio },
  { id: "people", label: "People", icon: User },
  { id: "communities", label: "Communities", icon: Users },
];

const CONTEXT_PAGE_SIZE = 25;
const PEOPLE_SPEC: TableSpec = {
  id: "people",
  columns: [
    { id: "displayName", label: "Person", kind: "text", editable: true, required: true },
    { id: "currentTitle", label: "Current role", kind: "text", editable: true },
    { id: "location", label: "Location", kind: "location", editable: true },
    {
      id: "visibility",
      label: "Visibility",
      kind: "select",
      editable: true,
      options: ["private", "organization"],
      defaultValue: "private",
    },
    { id: "source", label: "Source", kind: "text", editable: false, hiddenInForm: true },
    {
      id: "community",
      label: "Community",
      kind: "relation",
      relationTarget: "communities",
      editable: false,
      hiddenInForm: true,
    },
  ],
};

const COMMUNITIES_SPEC: TableSpec = {
  id: "communities",
  columns: [
    { id: "displayName", label: "Community", kind: "text", editable: true, required: true },
    { id: "kind", label: "Kind", kind: "text", editable: true },
    { id: "description", label: "Description", kind: "text", editable: true },
    { id: "location", label: "Location", kind: "location", editable: true },
    {
      id: "visibility",
      label: "Visibility",
      kind: "select",
      editable: true,
      options: ["private", "organization"],
      defaultValue: "private",
    },
    { id: "source", label: "Source", kind: "text", editable: false, hiddenInForm: true },
    {
      id: "members",
      label: "Members",
      kind: "relation",
      relationTarget: "people",
      editable: false,
      hiddenInForm: true,
    },
  ],
};

function isPage(value: string | undefined): value is RelationshipPageId {
  return value === "signals" || value === "people" || value === "communities";
}

function displayDate(value: string | Date | null | undefined): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleString();
}

function toDatetimeLocal(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function recommendedActionLabel(recommendedAction: unknown): string {
  if (typeof recommendedAction === "object" && recommendedAction !== null && !Array.isArray(recommendedAction)) {
    const label = (recommendedAction as Record<string, unknown>).label;
    if (typeof label === "string" && label.trim()) return label.trim();
  }
  return "Review action";
}

function fieldClassName() {
  return "mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-steel)]";
}

type IntakeReviewPage = Awaited<ReturnType<typeof trpc.relationship.intakeReview.query>>;

function IntakeReviewSection() {
  const [page, setPage] = useState<IntakeReviewPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);
    trpc.relationship.intakeReview.query({
      organizationId: PILOT_ORGANIZATION,
      limit: 25,
      offset,
    }).then((next) => {
      if (active) setPage(next);
    }).catch((cause) => {
      if (active) setError(String(cause));
    });
    return () => {
      active = false;
    };
  }, [offset]);

  return (
    <section className="m-4 rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }} aria-labelledby="identity-review-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="identity-review-title" className="text-sm font-semibold" style={{ color: "var(--color-navy)" }}>Intake and identity review</h2>
          <p className="mt-1 text-xs" style={{ color: "var(--color-warm-gray)" }}>Bounded Gmail, Calendar, and capture proposals. Source bodies stay in the Local Plane.</p>
        </div>
        <Link to="/approvals" className="text-xs font-semibold no-underline hover:underline" style={{ color: "var(--color-steel)" }}>Open Approvals</Link>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-600 break-words">{error}</p>
      ) : page === null ? (
        <p className="mt-3 text-xs" style={{ color: "var(--color-warm-gray)" }}>Loading review queue…</p>
      ) : page.items.length === 0 ? (
        <p className="mt-3 text-xs" style={{ color: "var(--color-warm-gray)" }}>No intake items in this bounded review page.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {page.items.map((item) => (
            <li key={item.proposalId} className="rounded-lg border p-3" style={{ borderColor: "var(--color-border)" }}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                 <p className="text-sm font-medium" style={{ color: "var(--color-navy)" }}>{item.resource}</p>
                 <p className="text-xs capitalize" style={{ color: "var(--color-warm-gray)" }}>{item.channel} · {item.source.replace("_", " ")} · {item.match}</p>
                </div>
                <time className="text-xs" dateTime={item.createdAt} style={{ color: "var(--color-warm-gray)" }}>{displayDate(item.createdAt)}</time>
              </div>
              <p className="mt-2 text-xs" style={{ color: "var(--color-navy-mid)" }}>{item.reason}</p>
              {item.candidateEmail && <p className="mt-1 text-xs" style={{ color: "var(--color-warm-gray)" }}>Candidate email: {item.candidateEmail}</p>}
              {item.candidates.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2" aria-label="Identity candidates">
                 {item.candidates.map((candidate) => (
                   <Link key={candidate.id} to={`/module/relationship/people/${candidate.id}`} className="rounded-full border px-2 py-1 text-xs no-underline" style={{ borderColor: "var(--color-border)", color: "var(--color-steel)" }}>
                     {candidate.name || "Unnamed Person"}
                   </Link>
                 ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {page && (offset > 0 || page.hasMore) && (
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}><ChevronLeft className="w-4 h-4" /> Previous</Button>
          <Button size="sm" variant="outline" disabled={!page.hasMore} onClick={() => setOffset(page.nextOffset ?? offset)} >Next <ChevronRight className="w-4 h-4" /></Button>
        </div>
      )}
    </section>
  );
}

function RecordListPage({ kind }: { kind: RecordKind }) {
  const navigate = useNavigate();
  const spec = kind === "person" ? PEOPLE_SPEC : COMMUNITIES_SPEC;
  const plural = kind === "person" ? "People" : "Communities";
  const detailSegment = kind === "person" ? "people" : "communities";
  const [rows, setRows] = useState<DataRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [formRecord, setFormRecord] = useState<DataRow | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [reload, setReload] = useState(0);
  const [searchParams, setSearchParams] = useSearchParams();
  const initialKind = (() => {
    const requested = searchParams.get("view");
    const normalized = normalizeViewKind(requested === "card" ? "gallery" : requested);
    return normalized && computeEligibleKinds(spec).includes(normalized) ? normalized : "table";
  })();
  const [view, setView] = useState<ViewConfig>(
    viewConfigForKind(spec, initialKind, {
      id: `${spec.id}:${initialKind}`,
      ...(initialKind === "graph"
        ? { graphScope: "multi_database", graphDatabaseIds: ["people", "communities"] }
        : {}),
    }),
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setOffset(0);
      setQuery(search.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  // D10 (BUGS.md "paginated Relationship Views filter and sort only the
  // loaded page", OPEN 2026-07-19): changing the active View's sort/filter
  // changes which rows and what order the NEXT server page returns, so
  // (like a new search term) it must restart from the first page rather than
  // keep whatever offset applied under the previous sort/filter.
  useEffect(() => {
    setOffset(0);
  }, [view.sorts, view.rowFilters, view.filterMatch]);

  useEffect(() => {
    let active = true;
    setRows(null);
    setError(null);
    // D10: forward the active View's sorts/rowFilters so the SERVER — which
    // sees every matching row across the whole Organization, not just this
    // one loaded page — is the authoritative filter/sort. `DataViews`' own
    // client-side `applyFilters`/`applySorts` still runs afterward as a
    // display layer; since the page it receives already satisfies the same
    // filter/sort, that is a no-op, not a second source of truth.
    const activeSorts = view.sorts.length ? view.sorts : undefined;
    const activeRowFilters = view.rowFilters.length ? view.rowFilters : undefined;
    const request =
      kind === "person"
        ? trpc.relationship.listPeople.query({
            organizationId: PILOT_ORGANIZATION,
            limit: 50,
            offset,
            ...(query ? { query } : {}),
            ...(activeSorts ? { sorts: activeSorts } : {}),
            ...(activeRowFilters ? { rowFilters: activeRowFilters, filterMatch: view.filterMatch } : {}),
          }).then((page) => ({
            ...page,
            items: page.items.map((record) => ({
              id: record.id,
              isOwner: record.isOwner,
              displayName: record.displayName || "Unnamed Person",
              currentTitle: record.currentTitle,
              location: record.location,
              visibility: record.visibility,
              source: record.source || "Not recorded",
              community: record.currentCommunityId,
            })),
            }))
        : trpc.relationship.listCommunities.query({
            organizationId: PILOT_ORGANIZATION,
            limit: 50,
            offset,
            ...(query ? { query } : {}),
            ...(activeSorts ? { sorts: activeSorts } : {}),
            ...(activeRowFilters ? { rowFilters: activeRowFilters, filterMatch: view.filterMatch } : {}),
          }).then((page) => ({
            ...page,
            items: page.items.map((record) => ({
              id: record.id,
              isOwner: record.isOwner,
              displayName: record.displayName || "Unnamed Community",
              kind: record.kind,
              description: record.description,
              location: record.location,
              visibility: record.visibility,
              source: record.source,
              members: [],
            })),
            }));
    request
      .then((page) => {
        if (active) {
          setRows(page.items);
          setTotal(page.total);
          setHasMore(page.hasMore);
        }
      })
      .catch((cause) => {
        if (active) setError(String(cause));
      });
    return () => {
    active = false;
    };
  }, [kind, offset, query, reload, view.sorts, view.rowFilters, view.filterMatch]);

  useEffect(() => {
    if (view.kind !== "graph") return;
    let active = true;
    setGraphLoading(true);
    setGraphError(null);
    void trpc.relationship.graph.query({
      organizationId: PILOT_ORGANIZATION,
      limit: 500,
    }).then((data) => {
      if (active) setGraphData(data);
    }).catch((cause) => {
      if (active) setGraphError(String(cause));
    }).finally(() => {
      if (active) setGraphLoading(false);
    });
    return () => {
      active = false;
    };
  }, [reload, view.kind]);

  function changeView(next: ViewConfig, preserveFormRecord = false) {
    const nextView =
      next.kind === "graph" && view.kind !== "graph"
        ? {
            ...next,
            graphScope: "multi_database" as const,
            graphDatabaseIds: ["people", "communities"],
          }
        : next;
    if (!preserveFormRecord) setFormRecord(null);
    setView(nextView);
    const params = new URLSearchParams(searchParams);
    params.set("view", nextView.kind);
    setSearchParams(params, { replace: true });
  }

  function openRecord(row: DataRow | GraphNode) {
    if ("recordPath" in row && row.recordPath) {
      navigate(row.recordPath);
      return;
    }
    const id = row["id"];
    if (typeof id === "string" || typeof id === "number") {
      navigate(`/module/relationship/${detailSegment}/${id}`);
    }
  }

  function openRelation(edge: GraphEdge) {
    if (edge.recordPath) navigate(edge.recordPath);
  }

  async function insertRecord(draft: Partial<DataRow>) {
    const displayName = typeof draft["displayName"] === "string"
      ? draft["displayName"].trim()
      : "";
    if (!displayName) throw new Error("Name is required.");
    const optionalText = (value: unknown) =>
      typeof value === "string" && value.trim() ? value.trim() : null;
    const visibility = draft["visibility"] === "organization" ? "organization" : "private";
    const result = kind === "person"
      ? await trpc.relationship.createPerson.mutate({
          organizationId: PILOT_ORGANIZATION,
          values: {
            displayName,
            currentTitle: optionalText(draft["currentTitle"]),
            location: optionalText(draft["location"]),
            visibility,
          },
        })
      : await trpc.relationship.createCommunity.mutate({
          organizationId: PILOT_ORGANIZATION,
          values: {
            displayName,
            kind: optionalText(draft["kind"]),
            description: optionalText(draft["description"]),
            location: optionalText(draft["location"]),
            visibility,
          },
        });
    if (result.materialization.status !== "applied") {
      throw new Error(`Action ${result.materialization.status.replace("_", " ")}; review it in Approvals.`);
    }
    setReload((value) => value + 1);
    changeView(viewConfigForKind(spec, "table", view));
  }

  async function updateRecord(id: string, draft: Partial<DataRow>) {
    const optionalText = (value: unknown) =>
      typeof value === "string" && value.trim() ? value.trim() : null;
    const includes = (field: string) =>
      Object.prototype.hasOwnProperty.call(draft, field);
    const displayName = typeof draft["displayName"] === "string"
      ? draft["displayName"].trim()
      : undefined;
    const visibility: "organization" | "private" | undefined =
      draft["visibility"] === "organization" || draft["visibility"] === "private"
        ? draft["visibility"]
        : undefined;
    let appliedPatch: Partial<DataRow>;
    let materialization: { status: string };
    if (kind === "person") {
      const values = {
        ...(displayName !== undefined ? { displayName } : {}),
        ...(includes("currentTitle")
          ? { currentTitle: optionalText(draft["currentTitle"]) }
          : {}),
        ...(includes("location")
          ? { location: optionalText(draft["location"]) }
          : {}),
        ...(visibility ? { visibility } : {}),
      };
      const result = await trpc.relationship.updatePerson.mutate({
        organizationId: PILOT_ORGANIZATION,
        id,
        values,
      });
      appliedPatch = values;
      materialization = result.materialization;
    } else {
      const values = {
        ...(displayName !== undefined ? { displayName } : {}),
        ...(includes("kind") ? { kind: optionalText(draft["kind"]) } : {}),
        ...(includes("description")
          ? { description: optionalText(draft["description"]) }
          : {}),
        ...(includes("location")
          ? { location: optionalText(draft["location"]) }
          : {}),
        ...(visibility ? { visibility } : {}),
      };
      const result = await trpc.relationship.updateCommunity.mutate({
        organizationId: PILOT_ORGANIZATION,
        id,
        values,
      });
      appliedPatch = values;
      materialization = result.materialization;
    }
    if (materialization.status !== "applied") {
      throw new Error(`Action ${materialization.status.replace("_", " ")}; review it in Approvals.`);
    }
    setRows((current) =>
      current?.map((row) =>
        String(row["id"]) === id ? { ...row, ...appliedPatch } : row,
      ) ?? current,
    );
    if (view.kind === "form") {
      changeView(viewConfigForKind(spec, "table", view));
    }
  }

  if (error) return <div className="p-4 sm:p-6 text-sm text-red-600 break-words">{error}</div>;
  if (rows === null) return <div className="p-4 sm:p-6 text-sm text-muted-foreground">Loading {plural.toLowerCase()}…</div>;

  return (
    <div className="flex-1 overflow-auto">
      <section aria-label={`${plural} landing section`}>
        <div className="border-b px-4 py-3" style={{ borderColor: "var(--color-border)" }}>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-8 max-w-sm"
            placeholder={`Search all ${plural.toLowerCase()}…`}
            aria-label={`Search ${plural}`}
          />
        </div>
        <div className="p-4">
          <DataViews
            spec={spec}
            view={view}
            data={rows}
            onViewChange={changeView}
            onInsert={insertRecord}
            onUpdate={updateRecord}
            canUpdateRow={(row) => row["isOwner"] === true}
            formRecord={formRecord}
            onOpenRecord={openRecord}
            onOpenRelation={openRelation}
            onEditRecord={(row) => {
              setFormRecord(row);
              changeView(viewConfigForKind(spec, "form", view), true);
            }}
            graphData={graphData ?? undefined}
            graphLoading={graphLoading}
            graphError={graphError}
            onGraphScopeChange={(scope) => {
              if (scope === "full") navigate("/second-brain");
            }}
          />
        </div>
        {view.kind !== "form" && total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3" style={{ borderColor: "var(--color-border)" }}>
            <p className="text-xs" style={{ color: "var(--color-warm-gray)" }}>
              Showing {offset + 1}–{offset + rows.length} of {total}
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}><ChevronLeft className="w-4 h-4" /> Previous</Button>
              <Button size="sm" variant="outline" disabled={!hasMore} onClick={() => setOffset(offset + 50)}>Next <ChevronRight className="w-4 h-4" /></Button>
            </div>
          </div>
        )}
      </section>
      {kind === "person" && <IntakeReviewSection />}
      <div className="m-4 rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }}>
        <ModuleFilesSection moduleName="relationship" />
      </div>
      <div className="m-4 rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }}>
        <ModuleIntelligenceSection moduleName="relationship" />
      </div>
    </div>
  );
}

export function RelationshipPage() {
  const { page } = useParams<{ page: string }>();
  const navigate = useNavigate();
  const activePage = isPage(page) ? page : "signals";
  const active = PAGES.find((item) => item.id === activePage)!;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden w-full max-w-full" style={{ backgroundColor: "var(--color-background)" }}>
      <Header
        tabs={PAGES.map((item) => ({ id: item.label, icon: item.icon }))}
        activeTab={active.label}
        onTabChange={(label) => {
          const next = PAGES.find((item) => item.label === label);
          if (next) navigate(`/module/relationship/${next.id}`);
        }}
      />
      {activePage === "signals"
        ? <SignalsPage embedded />
        : (
          <RecordListPage
            key={activePage}
            kind={activePage === "people" ? "person" : "community"}
          />
        )}
    </div>
  );
}

type SignalDetail = Awaited<ReturnType<typeof trpc.relationship.getSignalDetail.query>>;

function SignalEvidence({ detail }: { detail: NonNullable<SignalDetail> }) {
  return (
    <div className="space-y-6">
      <section className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }}>
        <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-warm-gray)" }}>Why this surfaced</h2>
        <p className="mt-2 text-sm" style={{ color: "var(--color-navy)" }}>{detail.reason}</p>
        {detail.reasonSource === "inferred" && (
          <p className="mt-1 text-xs" style={{ color: "var(--color-warm-gray)" }}>Inference — inspect the source Event before acting.</p>
        )}
      </section>
      <section className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }}>
        <h2 className="text-sm font-semibold" style={{ color: "var(--color-navy)" }}>Participants</h2>
        {detail.participants.length === 0 ? (
          <p className="mt-2 text-xs" style={{ color: "var(--color-warm-gray)" }}>No participant Relations are accessible. Actions remain disabled.</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {detail.participants.map((participant) => (
              <Link
                key={`${participant.recordType}:${participant.recordId}`}
                to={`/module/relationship/${participant.recordType === "person" ? "people" : "communities"}/${participant.recordId}`}
                className="rounded-lg border px-3 py-2 text-sm no-underline hover:bg-[var(--color-surface)]"
                style={{ borderColor: "var(--color-border)", color: "var(--color-steel)" }}
              >
                {participant.displayName || `Unnamed ${participant.recordType}`} · {participant.relationType}
              </Link>
            ))}
          </div>
        )}
      </section>
      <section className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }}>
        <h2 className="text-sm font-semibold" style={{ color: "var(--color-navy)" }}>Source Event</h2>
        {detail.sourceEvent ? (
          <Link
            to={`/module/relationship/signals/${detail.signal.id}/event`}
            className="mt-2 flex items-center gap-3 rounded-lg border p-3 no-underline hover:bg-[var(--color-surface)]"
            style={{ borderColor: "var(--color-border)" }}
          >
            <CalendarClock className="w-4 h-4 shrink-0" style={{ color: "var(--color-steel)" }} />
            <div className="min-w-0">
              <p className="text-sm font-medium" style={{ color: "var(--color-navy)" }}>{detail.sourceEvent.type}</p>
              <p className="text-xs" style={{ color: "var(--color-warm-gray)" }}>{displayDate(detail.sourceEvent.createdAt)}</p>
            </div>
          </Link>
        ) : (
          <p className="mt-2 text-xs" style={{ color: "var(--color-warm-gray)" }}>No accessible source Event is linked. Actions remain disabled.</p>
        )}
      </section>
    </div>
  );
}

export function SignalDetailPage() {
  const { signalId = "" } = useParams<{ signalId: string }>();
  const [detail, setDetail] = useState<SignalDetail | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [proposalStatus, setProposalStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestGeneration = useRef(0);

  useEffect(() => {
    const generation = ++requestGeneration.current;
    setDetail(undefined);
    setError(null);
    setProposalStatus(null);
    setBusy(false);
    trpc.relationship.getSignalDetail
      .query({ organizationId: PILOT_ORGANIZATION, signalId })
      .then((nextDetail) => {
        if (requestGeneration.current === generation) setDetail(nextDetail);
      })
      .catch((cause) => {
        if (requestGeneration.current === generation) setError(String(cause));
      });
  }, [signalId]);

  async function act() {
    if (!detail || detail.signal.id !== signalId) {
      setError("Signal evidence is still loading.");
      return;
    }
    const generation = requestGeneration.current;
    const actionSignalId = detail.signal.id;
    setBusy(true);
    setError(null);
    try {
      const proposal = await trpc.relationship.proposeSignalAction.mutate({
        organizationId: PILOT_ORGANIZATION,
        signalId: actionSignalId,
      });
      if (requestGeneration.current === generation) {
        setProposalStatus(proposal.status);
        if (proposal.status === "rejected") setError(proposal.rejectionReason || "The governed Action was rejected.");
      }
    } catch (cause) {
      if (requestGeneration.current === generation) setError(String(cause));
    } finally {
      if (requestGeneration.current === generation) setBusy(false);
    }
  }

  if (error && detail === undefined) return <div className="p-4 sm:p-6 text-sm text-red-600 break-words">{error}</div>;
  if (detail === undefined) return <div className="p-4 sm:p-6 text-sm text-muted-foreground">Loading Signal evidence…</div>;
  if (detail === null) return <div className="p-4 sm:p-6 text-sm text-muted-foreground">Signal not found or not accessible.</div>;

  const actionable =
    detail.signal.id === signalId &&
    detail.participants.some(participant => participant.relationType === "participant" && participant.relationId) &&
    detail.sourceEvent !== null;
  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <Link to="/module/relationship/signals" className="inline-flex items-center gap-1 text-sm no-underline hover:underline" style={{ color: "var(--color-steel)" }}>
          <ArrowLeft className="w-4 h-4" /> Signals
        </Link>
        <div>
          <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-warm-gray)" }}>Signal</p>
          <h1 className="text-2xl font-semibold" style={{ color: "var(--color-navy)", fontFamily: "var(--font-editorial)" }}>{detail.signal.type}</h1>
          <p className="mt-1 text-sm capitalize" style={{ color: "var(--color-warm-gray)" }}>{detail.signal.status}</p>
        </div>
        <SignalEvidence detail={detail} />
        <section className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--color-navy)" }}>Safe governed Action</h2>
          <p className="mt-1 text-xs" style={{ color: "var(--color-warm-gray)" }}>
            The server reloads this Signal, participant Relations, and source Event before proposing the Action through the Universal Action Pipeline.
          </p>
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <Button disabled={!actionable || busy} onClick={act}>{recommendedActionLabel(detail.signal.recommendedAction)}</Button>
            {proposalStatus && <span className="text-xs capitalize" style={{ color: "var(--color-steel)" }}>Proposal {proposalStatus.replace("_", " ")}</span>}
          </div>
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        </section>
      </div>
    </div>
  );
}

export function SignalSourceEventPage() {
  const { signalId = "" } = useParams<{ signalId: string }>();
  const [detail, setDetail] = useState<SignalDetail | undefined>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    trpc.relationship.getSignalDetail
      .query({ organizationId: PILOT_ORGANIZATION, signalId })
      .then(setDetail)
      .catch((cause) => setError(String(cause)));
  }, [signalId]);

  if (error) return <div className="p-4 sm:p-6 text-sm text-red-600 break-words">{error}</div>;
  if (detail === undefined) return <div className="p-4 sm:p-6 text-sm text-muted-foreground">Loading source Event…</div>;
  if (!detail?.sourceEvent) return <div className="p-4 sm:p-6 text-sm text-muted-foreground">Source Event not found or not accessible.</div>;

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <Link to={`/module/relationship/signals/${signalId}`} className="inline-flex items-center gap-1 text-sm no-underline hover:underline" style={{ color: "var(--color-steel)" }}>
          <ArrowLeft className="w-4 h-4" /> Signal evidence
        </Link>
        <div>
          <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-warm-gray)" }}>Source Event</p>
          <h1 className="text-2xl font-semibold" style={{ color: "var(--color-navy)", fontFamily: "var(--font-editorial)" }}>{detail.sourceEvent.type}</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--color-warm-gray)" }}>{displayDate(detail.sourceEvent.createdAt)}</p>
        </div>
        <section className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--color-navy)" }}>Event provenance</h2>
          <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div><dt className="text-xs" style={{ color: "var(--color-warm-gray)" }}>Entity type</dt><dd style={{ color: "var(--color-navy)" }}>{detail.sourceEvent.entityType}</dd></div>
            <div><dt className="text-xs" style={{ color: "var(--color-warm-gray)" }}>Entity ID</dt><dd className="break-all" style={{ color: "var(--color-navy)" }}>{detail.sourceEvent.entityId}</dd></div>
          </dl>
          <pre className="mt-4 overflow-auto rounded-lg p-3 text-xs" style={{ backgroundColor: "var(--color-surface)", color: "var(--color-navy-mid)" }}>
            {JSON.stringify(detail.sourceEvent.payload, null, 2)}
          </pre>
        </section>
      </div>
    </div>
  );
}

type PersonDetail = NonNullable<Awaited<ReturnType<typeof trpc.relationship.getPerson.query>>>;
type CommunityDetail = NonNullable<Awaited<ReturnType<typeof trpc.relationship.getCommunity.query>>>;
type RelationshipTimelinePage = Awaited<ReturnType<typeof trpc.relationship.timeline.query>>;
type RelationshipMemoryPage = Awaited<ReturnType<typeof trpc.relationship.memories.query>>;
type RelationshipCommitmentPage = Awaited<ReturnType<typeof trpc.relationship.commitments.query>>;
type RelationshipIntroductionPage = Awaited<ReturnType<typeof trpc.relationship.introductions.query>>;
type RelationshipMeetingPrep = Awaited<ReturnType<typeof trpc.relationship.meetingPrep.query>>;
type RelationshipCommunityOrganization = Awaited<ReturnType<typeof trpc.relationship.communityOrganization.query>>;
type RelationshipPathResult = Awaited<ReturnType<typeof trpc.relationship.findPaths.query>>;
/**
 * WhatsApp activity for this Record, read from the LOCAL plane (ADR-159).
 *
 * Kept as its own query rather than merged into `timeline` server-side: those
 * rows live on a different plane and are joined here, at render time, so no
 * Local-Plane fact is ever written into cloud canonical storage.
 */
type RelationshipWhatsAppActivity = Awaited<ReturnType<typeof trpc.relationship.whatsappTimeline.query>>;

/** Why a Record shows no WhatsApp activity — each reason is a different fact. */
const WHATSAPP_LINKAGE_NOTE: Record<string, string> = {
  community_unsupported:
    "WhatsApp groups are not staged as Communities yet, so no group chat can be attached to this Community.",
  no_local_record:
    "This Record has no Local Plane counterpart, so there is no WhatsApp identity to read.",
  no_whatsapp_identity: "No WhatsApp identity is linked to this Record.",
};

function RecordEditForm(props:
  | { kind: "person"; record: PersonDetail; onCancel: () => void; onApplied: () => void }
  | { kind: "community"; record: CommunityDetail; onCancel: () => void; onApplied: () => void }
) {
  const [displayName, setDisplayName] = useState(props.record.displayName || "");
  const [context, setContext] = useState(
    props.kind === "person" ? props.record.currentTitle || "" : props.record.kind || "",
  );
  const [description, setDescription] = useState(
    props.kind === "person" ? props.record.bio || "" : props.record.description || "",
  );
  const [location, setLocation] = useState(props.record.location || "");
  const [emails, setEmails] = useState(
    props.kind === "person" ? props.record.emails.join(", ") : "",
  );
  const [visibility, setVisibility] = useState<"private" | "organization">(
    props.record.visibility === "organization" ? "organization" : "private",
  );
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = props.kind === "person"
        ? await trpc.relationship.updatePerson.mutate({
            organizationId: PILOT_ORGANIZATION,
            id: props.record.id,
            values: {
              displayName,
              currentTitle: context || null,
              bio: description || null,
              location: location || null,
              emails: emails.split(",").map((email) => email.trim()).filter(Boolean),
              visibility,
            },
          })
        : await trpc.relationship.updateCommunity.mutate({
            organizationId: PILOT_ORGANIZATION,
            id: props.record.id,
            values: {
              displayName,
              kind: context || null,
              description: description || null,
              location: location || null,
              visibility,
            },
          });
      setStatus(result.materialization.status.replace("_", " "));
      if (result.materialization.status === "applied") props.onApplied();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold" style={{ color: "var(--color-navy)" }}>Edit {props.kind === "person" ? "Person" : "Community"}</h2>
        <button type="button" onClick={props.onCancel} aria-label="Close edit form" className="rounded-lg p-2 hover:bg-[var(--color-surface)]"><X className="w-4 h-4" /></button>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium sm:col-span-2" style={{ color: "var(--color-navy-mid)" }}>
          Name
          <input required maxLength={300} value={displayName} onChange={(event) => setDisplayName(event.target.value)} className={fieldClassName()} style={{ borderColor: "var(--color-border)" }} />
        </label>
        <label className="text-sm font-medium" style={{ color: "var(--color-navy-mid)" }}>
          {props.kind === "person" ? "Current role" : "Kind"}
          <input value={context} maxLength={300} onChange={(event) => setContext(event.target.value)} className={fieldClassName()} style={{ borderColor: "var(--color-border)" }} />
        </label>
        <label className="text-sm font-medium" style={{ color: "var(--color-navy-mid)" }}>
          Visibility
          <select value={visibility} onChange={(event) => setVisibility(event.target.value as "private" | "organization")} className={fieldClassName()} style={{ borderColor: "var(--color-border)" }}>
            <option value="private">Only me</option>
            <option value="organization">Organization</option>
          </select>
        </label>
        <label className="text-sm font-medium sm:col-span-2" style={{ color: "var(--color-navy-mid)" }}>
          Location
          <input
            value={location}
            maxLength={500}
            onChange={(event) => setLocation(event.target.value)}
            className={fieldClassName()}
            style={{ borderColor: "var(--color-border)" }}
            placeholder="latitude, longitude or a place label"
          />
        </label>
        {props.kind === "person" && (
          <label className="text-sm font-medium sm:col-span-2" style={{ color: "var(--color-navy-mid)" }}>
            Emails, comma separated
            <input value={emails} onChange={(event) => setEmails(event.target.value)} className={fieldClassName()} style={{ borderColor: "var(--color-border)" }} inputMode="email" />
          </label>
        )}
        <label className="text-sm font-medium sm:col-span-2" style={{ color: "var(--color-navy-mid)" }}>
          {props.kind === "person" ? "Bio" : "Description"}
          <textarea rows={4} maxLength={5000} value={description} onChange={(event) => setDescription(event.target.value)} className={fieldClassName()} style={{ borderColor: "var(--color-border)" }} />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={busy || !displayName.trim()}><Save className="w-4 h-4" /> {busy ? "Submitting…" : "Save"}</Button>
        <Button type="button" variant="outline" onClick={props.onCancel}>Cancel</Button>
        {status && <span role="status" className="text-xs capitalize" style={{ color: "var(--color-steel)" }}>Action {status}</span>}
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-red-600 break-words">{error}</p>}
    </form>
  );
}

function InteractionForm({
  kind,
  recordId,
  onApplied,
}: {
  kind: RecordKind;
  recordId: string;
  onApplied: () => void;
}) {
  const [summary, setSummary] = useState("");
  const [interactionKind, setInteractionKind] = useState("meeting");
  const [occurredAt, setOccurredAt] = useState(() => toDatetimeLocal(new Date()));
  const [visibility, setVisibility] = useState<"private" | "organization">("private");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await trpc.relationship.createInteraction.mutate({
        organizationId: PILOT_ORGANIZATION,
        values: {
          kind: interactionKind,
          occurredAt: new Date(occurredAt).toISOString(),
          summary,
          visibility,
          participants: [{ recordType: kind, recordId }],
        },
      });
      setStatus(result.materialization.status.replace("_", " "));
      if (result.materialization.status === "applied") {
        setSummary("");
        onApplied();
      }
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }}>
      <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--color-navy)" }}><Clock3 className="w-4 h-4" /> Add Interaction Event</h2>
      <p className="mt-1 text-xs" style={{ color: "var(--color-warm-gray)" }}>The current Record is attached as a participant through a governed Relation.</p>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium" style={{ color: "var(--color-navy-mid)" }}>
          Kind
          <input required maxLength={100} value={interactionKind} onChange={(event) => setInteractionKind(event.target.value)} className={fieldClassName()} style={{ borderColor: "var(--color-border)" }} />
        </label>
        <label className="text-sm font-medium" style={{ color: "var(--color-navy-mid)" }}>
          Occurred at
          <input required type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} className={fieldClassName()} style={{ borderColor: "var(--color-border)" }} />
        </label>
        <label className="text-sm font-medium sm:col-span-2" style={{ color: "var(--color-navy-mid)" }}>
          Summary
          <textarea required rows={3} maxLength={5000} value={summary} onChange={(event) => setSummary(event.target.value)} className={fieldClassName()} style={{ borderColor: "var(--color-border)" }} />
        </label>
        <label className="text-sm font-medium" style={{ color: "var(--color-navy-mid)" }}>
          Visibility
          <select value={visibility} onChange={(event) => setVisibility(event.target.value as "private" | "organization")} className={fieldClassName()} style={{ borderColor: "var(--color-border)" }}>
            <option value="private">Only me</option>
            <option value="organization">Organization</option>
          </select>
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={busy || !summary.trim()}>{busy ? "Submitting…" : "Add Event"}</Button>
        {status && <span role="status" className="text-xs capitalize" style={{ color: "var(--color-steel)" }}>Action {status}</span>}
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-red-600 break-words">{error}</p>}
    </form>
  );
}

export function RelationshipRecordDetailPage({ kind }: { kind: RecordKind }) {
  const { recordId = "" } = useParams<{ recordId: string }>();
  const navigate = useNavigate();
  const [record, setRecord] = useState<PersonDetail | CommunityDetail | null | undefined>();
  const [timeline, setTimeline] = useState<RelationshipTimelinePage["items"]>([]);
  const [nextCursor, setNextCursor] = useState<RelationshipTimelinePage["nextCursor"]>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [whatsapp, setWhatsapp] = useState<RelationshipWhatsAppActivity | null>(null);
  const [memories, setMemories] = useState<RelationshipMemoryPage["items"]>([]);
  const [commitments, setCommitments] = useState<RelationshipCommitmentPage["items"]>([]);
  const [introductions, setIntroductions] = useState<RelationshipIntroductionPage["items"]>([]);
  const [memoriesHaveMore, setMemoriesHaveMore] = useState(false);
  const [commitmentsHaveMore, setCommitmentsHaveMore] = useState(false);
  const [introductionsHaveMore, setIntroductionsHaveMore] = useState(false);
  const [memorySnapshotAt, setMemorySnapshotAt] = useState<string | null>(null);
  const [commitmentSnapshotAt, setCommitmentSnapshotAt] = useState<string | null>(null);
  const [introductionSnapshotAt, setIntroductionSnapshotAt] = useState<string | null>(null);
  const [meetingPrep, setMeetingPrep] = useState<RelationshipMeetingPrep | null>(null);
  const [communityOrganization, setCommunityOrganization] = useState<RelationshipCommunityOrganization | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [memoryDraft, setMemoryDraft] = useState("");
  const [memoryScope, setMemoryScope] = useState<"private" | "organization">("private");
  const [commitmentDraft, setCommitmentDraft] = useState("");
  const [commitmentDueAt, setCommitmentDueAt] = useState("");
  const [contextBusy, setContextBusy] = useState(false);
  const [pathQuery, setPathQuery] = useState("");
  const [pathCandidates, setPathCandidates] = useState<RelationshipListRecord[]>([]);
  const [pathResult, setPathResult] = useState<RelationshipPathResult | null>(null);
  const [pathLoading, setPathLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const requestGeneration = useRef(0);
  const contextGeneration = useRef(0);

  useEffect(() => {
    const generation = ++requestGeneration.current;
    setRecord(undefined);
    setTimeline([]);
    setNextCursor(null);
    setTimelineLoading(false);
    setError(null);
    const recordRequest = kind === "person"
      ? trpc.relationship.getPerson.query({ organizationId: PILOT_ORGANIZATION, id: recordId })
      : trpc.relationship.getCommunity.query({ organizationId: PILOT_ORGANIZATION, id: recordId });
    void Promise.all([
      recordRequest,
      trpc.relationship.timeline.query({
        organizationId: PILOT_ORGANIZATION,
        recordType: kind,
        recordId,
        limit: 25,
      }),
    ]).then(([nextRecord, timelinePage]) => {
      if (requestGeneration.current !== generation) return;
      setRecord(nextRecord);
      setTimeline(timelinePage.items);
      setNextCursor(timelinePage.nextCursor);
    }).catch((cause) => {
      if (requestGeneration.current === generation) setError(String(cause));
    });
    return () => {
      if (requestGeneration.current === generation) requestGeneration.current += 1;
    };
  }, [kind, recordId, reload]);

  // Local Plane read, deliberately its own effect: WhatsApp activity is an
  // addition to the Timeline, so a Local Plane that is unavailable must degrade
  // to "no WhatsApp activity shown" rather than take the whole Record page down.
  useEffect(() => {
    let active = true;
    setWhatsapp(null);
    void trpc.relationship.whatsappTimeline
      .query({ organizationId: PILOT_ORGANIZATION, recordType: kind, recordId })
      .then((activity) => {
        if (active) setWhatsapp(activity);
      })
      .catch(() => {
        // Swallowed on purpose, and visibly: `whatsapp` stays null, which the
        // Timeline renders as nothing at all rather than as "no activity".
        if (active) setWhatsapp(null);
      });
    return () => {
      active = false;
    };
  }, [kind, recordId, reload]);

  useEffect(() => {
    if (kind !== "community") {
      setCommunityOrganization(null);
      return;
    }
    setCommunityOrganization(null);
    let active = true;
    void trpc.relationship.communityOrganization.query({
      organizationId: PILOT_ORGANIZATION,
      communityId: recordId,
      limit: 25,
    }).then((organization) => {
      if (active) setCommunityOrganization(organization);
    }).catch((cause) => {
      if (active) setError(String(cause));
    });
    return () => {
      active = false;
    };
  }, [kind, recordId, reload]);

  useEffect(() => {
    setEditing(false);
    setMemoryDraft("");
    setMemoryScope("private");
    setCommitmentDraft("");
    setCommitmentDueAt("");
    setActionStatus(null);
    setContextBusy(false);
    setPathQuery("");
    setPathCandidates([]);
    setPathResult(null);
    setPathLoading(false);
  }, [kind, recordId]);

  useEffect(() => {
    const generation = ++contextGeneration.current;
    setMemories([]);
    setCommitments([]);
    setIntroductions([]);
    setMemoriesHaveMore(false);
    setCommitmentsHaveMore(false);
    setIntroductionsHaveMore(false);
    setMemorySnapshotAt(null);
    setCommitmentSnapshotAt(null);
    setIntroductionSnapshotAt(null);
    setMeetingPrep(null);
    if (kind !== "person") {
      setContextLoading(false);
      return;
    }
    setContextLoading(true);
    void Promise.all([
      trpc.relationship.memories.query({
        organizationId: PILOT_ORGANIZATION,
        personId: recordId,
        limit: CONTEXT_PAGE_SIZE,
        offset: 0,
      }),
      trpc.relationship.commitments.query({
        organizationId: PILOT_ORGANIZATION,
        personId: recordId,
        limit: CONTEXT_PAGE_SIZE,
        offset: 0,
        includeArchived: false,
      }),
      trpc.relationship.introductions.query({
        organizationId: PILOT_ORGANIZATION,
        personId: recordId,
        limit: CONTEXT_PAGE_SIZE,
        offset: 0,
      }),
      trpc.relationship.meetingPrep.query({
        organizationId: PILOT_ORGANIZATION,
        personId: recordId,
        limit: 10,
      }),
    ]).then(([memoryPage, commitmentPage, introductionPage, prep]) => {
      if (contextGeneration.current !== generation) return;
      setMemories(memoryPage.items);
      setCommitments(commitmentPage.items);
      setIntroductions(introductionPage.items);
      setMemoriesHaveMore(memoryPage.hasMore);
      setCommitmentsHaveMore(commitmentPage.hasMore);
      setIntroductionsHaveMore(introductionPage.hasMore);
      setMemorySnapshotAt(memoryPage.snapshotAt);
      setCommitmentSnapshotAt(commitmentPage.snapshotAt);
      setIntroductionSnapshotAt(introductionPage.snapshotAt);
      setMeetingPrep(prep);
    }).catch((cause) => {
      if (contextGeneration.current === generation) setError(String(cause));
    }).finally(() => {
      if (contextGeneration.current === generation) setContextLoading(false);
    });
    return () => {
      if (contextGeneration.current === generation) contextGeneration.current += 1;
    };
  }, [kind, recordId, reload]);

  async function loadMoreTimeline() {
    if (!nextCursor || timelineLoading) return;
    const generation = requestGeneration.current;
    const cursor = nextCursor;
    setTimelineLoading(true);
    setError(null);
    try {
      const page = await trpc.relationship.timeline.query({
        organizationId: PILOT_ORGANIZATION,
        recordType: kind,
        recordId,
        limit: 25,
        cursor,
      });
      if (requestGeneration.current !== generation) return;
      setTimeline((items) => [...items, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (cause) {
      if (requestGeneration.current === generation) setError(String(cause));
    } finally {
      if (requestGeneration.current === generation) setTimelineLoading(false);
    }
  }

  async function loadMoreMemories() {
    if (kind !== "person" || !memoriesHaveMore || contextLoading) return;
    const generation = contextGeneration.current;
    const offset = memories.length;
    setContextLoading(true);
    setError(null);
    try {
      const page = await trpc.relationship.memories.query({
        organizationId: PILOT_ORGANIZATION,
        personId: recordId,
        limit: CONTEXT_PAGE_SIZE,
        offset,
        ...(memorySnapshotAt ? { snapshotAt: memorySnapshotAt } : {}),
      });
      if (contextGeneration.current !== generation) return;
      setMemories((items) => [
        ...new Map(
          [...items, ...page.items].map((item) => [item.id, item]),
        ).values(),
      ]);
      setMemoriesHaveMore(page.hasMore);
    } catch (cause) {
      if (contextGeneration.current === generation) setError(String(cause));
    } finally {
      if (contextGeneration.current === generation) setContextLoading(false);
    }
  }

  async function loadMoreCommitments() {
    if (kind !== "person" || !commitmentsHaveMore || contextLoading) return;
    const generation = contextGeneration.current;
    const offset = commitments.length;
    setContextLoading(true);
    setError(null);
    try {
      const page = await trpc.relationship.commitments.query({
        organizationId: PILOT_ORGANIZATION,
        personId: recordId,
        limit: CONTEXT_PAGE_SIZE,
        offset,
        includeArchived: false,
        ...(commitmentSnapshotAt ? { snapshotAt: commitmentSnapshotAt } : {}),
      });
      if (contextGeneration.current !== generation) return;
      setCommitments((items) => [
        ...new Map(
          [...items, ...page.items].map((item) => [item.id, item]),
        ).values(),
      ]);
      setCommitmentsHaveMore(page.hasMore);
    } catch (cause) {
      if (contextGeneration.current === generation) setError(String(cause));
    } finally {
      if (contextGeneration.current === generation) setContextLoading(false);
    }
  }

  async function loadMoreIntroductions() {
    if (kind !== "person" || !introductionsHaveMore || contextLoading) return;
    const generation = contextGeneration.current;
    const offset = introductions.length;
    setContextLoading(true);
    setError(null);
    try {
      const page = await trpc.relationship.introductions.query({
        organizationId: PILOT_ORGANIZATION,
        personId: recordId,
        limit: CONTEXT_PAGE_SIZE,
        offset,
        ...(introductionSnapshotAt ? { snapshotAt: introductionSnapshotAt } : {}),
      });
      if (contextGeneration.current !== generation) return;
      setIntroductions((items) => [
        ...new Map(
          [...items, ...page.items].map((item) => [item.id, item]),
        ).values(),
      ]);
      setIntroductionsHaveMore(page.hasMore);
    } catch (cause) {
      if (contextGeneration.current === generation) setError(String(cause));
    } finally {
      if (contextGeneration.current === generation) setContextLoading(false);
    }
  }

  async function addMemory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!memoryDraft.trim() || contextBusy) return;
    const generation = requestGeneration.current;
    setContextBusy(true);
    setError(null);
    try {
      const result = await trpc.relationship.addMemory.mutate({
        organizationId: PILOT_ORGANIZATION,
        personId: recordId,
        type: "semantic",
        content: memoryDraft,
        scope: memoryScope,
      });
      if (requestGeneration.current !== generation) return;
      setActionStatus(result.materialization.status.replace("_", " "));
      if (result.materialization.status === "applied") {
        setMemoryDraft("");
        setReload((value) => value + 1);
      }
    } catch (cause) {
      if (requestGeneration.current === generation) setError(String(cause));
    } finally {
      if (requestGeneration.current === generation) setContextBusy(false);
    }
  }

  async function correctMemory(memory: RelationshipMemoryPage["items"][number]) {
    const content = window.prompt("Correct what Bridge knows", memory.content);
    if (content === null || !content.trim() || content.trim() === memory.content) return;
    const generation = requestGeneration.current;
    setContextBusy(true);
    setError(null);
    try {
      const result = await trpc.relationship.correctMemory.mutate({
        organizationId: PILOT_ORGANIZATION,
        personId: recordId,
        memoryId: memory.id,
        content,
      });
      if (requestGeneration.current !== generation) return;
      setActionStatus(result.materialization.status.replace("_", " "));
      if (result.materialization.status === "applied") setReload((value) => value + 1);
    } catch (cause) {
      if (requestGeneration.current === generation) setError(String(cause));
    } finally {
      if (requestGeneration.current === generation) setContextBusy(false);
    }
  }

  async function forgetMemory(memoryId: string) {
    if (!window.confirm("Forget this Memory and its correction history?")) return;
    const generation = requestGeneration.current;
    setContextBusy(true);
    setError(null);
    try {
      const result = await trpc.relationship.forgetMemory.mutate({
        organizationId: PILOT_ORGANIZATION,
        personId: recordId,
        memoryId,
      });
      if (requestGeneration.current !== generation) return;
      setActionStatus(result.materialization.status.replace("_", " "));
      if (result.materialization.status === "applied") setReload((value) => value + 1);
    } catch (cause) {
      if (requestGeneration.current === generation) setError(String(cause));
    } finally {
      if (requestGeneration.current === generation) setContextBusy(false);
    }
  }

  async function createCommitment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!commitmentDraft.trim() || contextBusy) return;
    const generation = requestGeneration.current;
    setContextBusy(true);
    setError(null);
    try {
      const result = await trpc.relationship.createCommitment.mutate({
        organizationId: PILOT_ORGANIZATION,
        personId: recordId,
        text: commitmentDraft,
        dueAt: commitmentDueAt ? new Date(commitmentDueAt).toISOString() : null,
      });
      if (requestGeneration.current !== generation) return;
      setActionStatus(result.materialization.status.replace("_", " "));
      if (result.materialization.status === "applied") {
        setCommitmentDraft("");
        setCommitmentDueAt("");
        setReload((value) => value + 1);
      }
    } catch (cause) {
      if (requestGeneration.current === generation) setError(String(cause));
    } finally {
      if (requestGeneration.current === generation) setContextBusy(false);
    }
  }

  async function updateCommitment(
    commitment: RelationshipCommitmentPage["items"][number],
    status: "pending" | "completed" | "cancelled",
  ) {
    const generation = requestGeneration.current;
    setContextBusy(true);
    setError(null);
    try {
      const result = await trpc.relationship.updateCommitment.mutate({
        organizationId: PILOT_ORGANIZATION,
        personId: recordId,
        commitmentId: commitment.id,
        text: commitment.text,
        dueAt: commitment.dueAt,
        status,
      });
      if (requestGeneration.current !== generation) return;
      setActionStatus(result.materialization.status.replace("_", " "));
      if (result.materialization.status === "applied") setReload((value) => value + 1);
    } catch (cause) {
      if (requestGeneration.current === generation) setError(String(cause));
    } finally {
      if (requestGeneration.current === generation) setContextBusy(false);
    }
  }

  async function archiveCommitment(commitmentId: string) {
    if (!window.confirm("Archive this commitment?")) return;
    const generation = requestGeneration.current;
    setContextBusy(true);
    setError(null);
    try {
      const result = await trpc.relationship.archiveCommitment.mutate({
        organizationId: PILOT_ORGANIZATION,
        personId: recordId,
        commitmentId,
      });
      if (requestGeneration.current !== generation) return;
      setActionStatus(result.materialization.status.replace("_", " "));
      if (result.materialization.status === "applied") setReload((value) => value + 1);
    } catch (cause) {
      if (requestGeneration.current === generation) setError(String(cause));
    } finally {
      if (requestGeneration.current === generation) setContextBusy(false);
    }
  }

  async function createIntroduction(targetPersonId: string) {
    if (kind !== "person" || contextBusy) return;
    const generation = requestGeneration.current;
    setContextBusy(true);
    setError(null);
    try {
      const result = await trpc.relationship.createIntroduction.mutate({
        organizationId: PILOT_ORGANIZATION,
        sourcePersonId: recordId,
        targetPersonId,
      });
      if (requestGeneration.current !== generation) return;
      setActionStatus(result.materialization.status.replace("_", " "));
      if (result.materialization.status === "applied") setReload((value) => value + 1);
    } catch (cause) {
      if (requestGeneration.current === generation) setError(String(cause));
    } finally {
      if (requestGeneration.current === generation) setContextBusy(false);
    }
  }

  async function recordIntroductionConsent(
    introduction: RelationshipIntroductionPage["items"][number],
    decision: "consent" | "decline",
  ) {
    const declineReason = decision === "decline"
      ? window.prompt("Private decline reason (visible only to you)")
      : null;
    if (decision === "decline" && !declineReason?.trim()) return;
    const generation = requestGeneration.current;
    setContextBusy(true);
    setError(null);
    try {
      const result = await trpc.relationship.recordIntroductionConsent.mutate({
        organizationId: PILOT_ORGANIZATION,
        personId: recordId,
        introductionId: introduction.id,
        party: "recipient",
        decision,
        ...(declineReason ? { declineReason } : {}),
      });
      if (requestGeneration.current !== generation) return;
      setActionStatus(result.materialization.status.replace("_", " "));
      if (result.materialization.status === "applied") setReload((value) => value + 1);
    } catch (cause) {
      if (requestGeneration.current === generation) setError(String(cause));
    } finally {
      if (requestGeneration.current === generation) setContextBusy(false);
    }
  }

  async function transitionIntroduction(
    introductionId: string,
    transition: "cancel" | "complete",
  ) {
    const confirmed = transition === "complete"
      ? window.confirm("Record that the introduction happened? This does not send a message.")
      : window.confirm("Cancel this introduction?");
    if (!confirmed) return;
    const generation = requestGeneration.current;
    setContextBusy(true);
    setError(null);
    try {
      const result = await trpc.relationship.transitionIntroduction.mutate({
        organizationId: PILOT_ORGANIZATION,
        personId: recordId,
        introductionId,
        transition,
      });
      if (requestGeneration.current !== generation) return;
      setActionStatus(result.materialization.status.replace("_", " "));
      if (result.materialization.status === "applied") setReload((value) => value + 1);
    } catch (cause) {
      if (requestGeneration.current === generation) setError(String(cause));
    } finally {
      if (requestGeneration.current === generation) setContextBusy(false);
    }
  }

  async function logFollowUp(label: string) {
    const generation = requestGeneration.current;
    setContextBusy(true);
    setError(null);
    try {
      const result = await trpc.relationship.createInteraction.mutate({
        organizationId: PILOT_ORGANIZATION,
        values: {
          kind: "follow_up",
          occurredAt: new Date().toISOString(),
          summary: label.replace(/^Log follow-up:\s*/i, ""),
          visibility: "private",
          participants: [{ recordType: "person", recordId }],
        },
      });
      if (requestGeneration.current !== generation) return;
      setActionStatus(result.materialization.status.replace("_", " "));
      if (result.materialization.status === "applied") setReload((value) => value + 1);
    } catch (cause) {
      if (requestGeneration.current === generation) setError(String(cause));
    } finally {
      if (requestGeneration.current === generation) setContextBusy(false);
    }
  }

  async function searchPathTargets(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pathQuery.trim() || pathLoading) return;
    const generation = requestGeneration.current;
    const query = pathQuery.trim();
    setPathLoading(true);
    setError(null);
    setPathResult(null);
    try {
      const page = await trpc.relationship.listPeople.query({
        organizationId: PILOT_ORGANIZATION,
        query,
        limit: 10,
        offset: 0,
      });
      if (requestGeneration.current !== generation) return;
      setPathCandidates(
        page.items
          .filter((person) => kind !== "person" || person.id !== recordId)
          .map((person) => ({
            id: person.id,
            name: person.displayName || "Unnamed Person",
            subtitle: person.currentTitle || "No current role",
            visibility: person.visibility,
            source: person.source || "Not recorded",
            isOwner: person.isOwner,
          })),
      );
    } catch (cause) {
      if (requestGeneration.current === generation) setError(String(cause));
    } finally {
      if (requestGeneration.current === generation) setPathLoading(false);
    }
  }

  async function findPathTo(targetId: string) {
    const generation = requestGeneration.current;
    setPathLoading(true);
    setError(null);
    try {
      const result = await trpc.relationship.findPaths.query({
        organizationId: PILOT_ORGANIZATION,
        start: { nodeType: kind, nodeId: recordId },
        end: { nodeType: "person", nodeId: targetId },
        maxDepth: 4,
        maxPaths: 3,
      });
      if (requestGeneration.current === generation) setPathResult(result);
    } catch (cause) {
      if (requestGeneration.current === generation) setError(String(cause));
    } finally {
      if (requestGeneration.current === generation) setPathLoading(false);
    }
  }

  async function archiveRecord() {
    if (!record?.isOwner || !window.confirm(`Archive ${record.displayName || kind}?`)) return;
    const generation = requestGeneration.current;
    setError(null);
    try {
      const result = kind === "person"
        ? await trpc.relationship.archivePerson.mutate({ organizationId: PILOT_ORGANIZATION, id: recordId })
        : await trpc.relationship.archiveCommunity.mutate({ organizationId: PILOT_ORGANIZATION, id: recordId });
      if (requestGeneration.current !== generation) return;
      setActionStatus(result.materialization.status.replace("_", " "));
      if (result.materialization.status === "applied") {
        navigate(`/module/relationship/${kind === "person" ? "people" : "communities"}`);
      }
    } catch (cause) {
      if (requestGeneration.current === generation) setError(String(cause));
    }
  }

  if (error && record === undefined) return <div className="p-4 sm:p-6 text-sm text-red-600 break-words">{error}</div>;
  if (record === undefined || (record !== null && record.id !== recordId)) return <div className="p-4 sm:p-6 text-sm text-muted-foreground">Loading Record…</div>;
  if (record === null) return <div className="p-4 sm:p-6 text-sm text-muted-foreground">Record not found or not accessible.</div>;

  const isPerson = kind === "person";
  const person = isPerson ? record as PersonDetail : null;
  const community = !isPerson ? record as CommunityDetail : null;
  const name = record.displayName || `Unnamed ${kind}`;
  const activeGeneration = requestGeneration.current;
  const reloadCurrentRecord = () => {
    if (requestGeneration.current !== activeGeneration) return;
    setEditing(false);
    setReload((value) => value + 1);
  };
  const sourceRows = [
    { key: `record:${record.source}`, source: record.source || "Not recorded", sourceRecordId: null as string | null, eventId: null as string | null },
    ...timeline.map((item) => ({
      key: `event:${item.id}`,
      source: item.source,
      sourceRecordId: item.sourceRecordId,
      eventId: item.id,
    })),
  ];
  const uniqueSources = [...new Map(sourceRows.map((source) => [source.key, source])).values()];

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <Link to={`/module/relationship/${isPerson ? "people" : "communities"}`} className="inline-flex items-center gap-1 text-sm no-underline hover:underline" style={{ color: "var(--color-steel)" }}>
          <ArrowLeft className="w-4 h-4" /> {isPerson ? "People" : "Communities"}
        </Link>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            {isPerson ? <User className="w-7 h-7 shrink-0" /> : <Users className="w-7 h-7 shrink-0" />}
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-warm-gray)" }}>{isPerson ? "Person" : "Community"}</p>
              <h1 className="text-2xl font-semibold break-words" style={{ color: "var(--color-navy)", fontFamily: "var(--font-editorial)" }}>{name}</h1>
            </div>
          </div>
          {record.isOwner && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing((value) => !value)} aria-expanded={editing}><Pencil className="w-4 h-4" /> Edit</Button>
              <Button size="sm" variant="outline" onClick={archiveRecord}><Archive className="w-4 h-4" /> Archive</Button>
            </div>
          )}
        </div>
        {actionStatus && <p role="status" className="text-xs capitalize" style={{ color: "var(--color-steel)" }}>Action {actionStatus}</p>}
        {error && <p role="alert" className="text-sm text-red-600 break-words">{error}</p>}
        {editing && (
          isPerson
            ? <RecordEditForm key={`person:${recordId}`} kind="person" record={person!} onCancel={() => setEditing(false)} onApplied={reloadCurrentRecord} />
            : <RecordEditForm key={`community:${recordId}`} kind="community" record={community!} onCancel={() => setEditing(false)} onApplied={reloadCurrentRecord} />
        )}
        <section className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }} aria-labelledby="record-overview-title">
          <h2 id="record-overview-title" className="text-sm font-semibold" style={{ color: "var(--color-navy)" }}>Overview</h2>
          <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div><dt className="text-xs" style={{ color: "var(--color-warm-gray)" }}>Context</dt><dd className="break-words" style={{ color: "var(--color-navy)" }}>{person?.currentTitle || community?.kind || "Not recorded"}</dd></div>
            <div><dt className="text-xs" style={{ color: "var(--color-warm-gray)" }}>Visibility</dt><dd className="capitalize" style={{ color: "var(--color-navy)" }}>{record.visibility}</dd></div>
            <div><dt className="text-xs" style={{ color: "var(--color-warm-gray)" }}>Location</dt><dd className="break-words" style={{ color: "var(--color-navy)" }}>{record.location || "Not recorded"}</dd></div>
            {person && <div><dt className="text-xs" style={{ color: "var(--color-warm-gray)" }}>Last Interaction</dt><dd style={{ color: "var(--color-navy)" }}>{displayDate(person.lastInteractionAt)}</dd></div>}
            {community && <div><dt className="text-xs" style={{ color: "var(--color-warm-gray)" }}>Accessible members</dt><dd style={{ color: "var(--color-navy)" }}>{community.memberCount}</dd></div>}
          </dl>
          {(person?.bio || community?.description) && <p className="mt-4 whitespace-pre-wrap text-sm" style={{ color: "var(--color-navy-mid)" }}>{person?.bio || community?.description}</p>}
          {person && person.emails.length > 0 && (
            <div className="mt-4">
              <p className="text-xs" style={{ color: "var(--color-warm-gray)" }}>Emails</p>
              <div className="mt-1 flex flex-wrap gap-2">{person.emails.map((email) => <a key={email} href={`mailto:${email}`} className="text-sm hover:underline" style={{ color: "var(--color-steel)" }}>{email}</a>)}</div>
            </div>
          )}
        </section>
        {community && (
          <section className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }} aria-labelledby="community-organization-title">
            <h2 id="community-organization-title" className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--color-navy)" }}>
              <Users className="w-4 h-4" /> Community organization
            </h2>
            <p className="mt-1 text-xs" style={{ color: "var(--color-warm-gray)" }}>
              People, surfaced Signals, shared Events, and local Files associated with this Community.
            </p>
            {communityOrganization === null ? (
              <p className="mt-3 text-xs" style={{ color: "var(--color-warm-gray)" }}>Loading bounded Community context…</p>
            ) : (
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-lg border p-3" style={{ borderColor: "var(--color-border)" }}>
                  <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-warm-gray)" }}>People</h3>
                  {communityOrganization.people.length === 0 ? (
                    <p className="mt-2 text-xs" style={{ color: "var(--color-warm-gray)" }}>No accessible People are linked yet.</p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {communityOrganization.people.map((member) => (
                        <li key={member.id}>
                          <Link to={`/module/relationship/people/${member.id}`} className="text-sm no-underline hover:underline" style={{ color: "var(--color-steel)" }}>
                            {member.displayName || "Unnamed Person"}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="rounded-lg border p-3" style={{ borderColor: "var(--color-border)" }}>
                  <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-warm-gray)" }}>Signals and Events</h3>
                  <p className="mt-2 text-sm" style={{ color: "var(--color-navy)" }}>{communityOrganization.events.length} accessible Events</p>
                  {communityOrganization.signals.length === 0 ? (
                    <p className="mt-1 text-xs" style={{ color: "var(--color-warm-gray)" }}>No surfaced Signals for this Community.</p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {communityOrganization.signals.map((signal) => (
                        <li key={signal.id}>
                          <Link to={`/module/relationship/signals/${signal.id}`} className="text-sm capitalize no-underline hover:underline" style={{ color: "var(--color-steel)" }}>
                            {signal.type.replace(/_/g, " ")}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="rounded-lg border p-3" style={{ borderColor: "var(--color-border)" }}>
                  <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-warm-gray)" }}>Files</h3>
                  {communityOrganization.files.length === 0 ? (
                    <>
                      <p className="mt-2 text-xs" style={{ color: "var(--color-warm-gray)" }}>No local Files are associated yet.</p>
                      <Link to="/settings" className="mt-2 inline-block text-xs font-semibold no-underline hover:underline" style={{ color: "var(--color-steel)" }}>Manage sources</Link>
                    </>
                  ) : null}
                </div>
              </div>
            )}
            {communityOrganization && Object.values(communityOrganization.bounds).some(Boolean) && (
              <p className="mt-3 text-xs" style={{ color: "var(--color-warm-gray)" }}>
                This organization view reached a safety bound. Refine through a related Record for more context.
              </p>
            )}
          </section>
        )}
        {person && (
          <section className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }} aria-labelledby="record-meeting-prep-title">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 id="record-meeting-prep-title" className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--color-navy)" }}>
                  <FileText className="w-4 h-4" /> Meeting preparation
                </h2>
                <p className="mt-1 text-xs" style={{ color: "var(--color-warm-gray)" }}>
                  Source-grounded context from this Person&apos;s accessible Memory, commitments, and Timeline.
                </p>
              </div>
              {meetingPrep && (
                <span className="text-xs" style={{ color: "var(--color-warm-gray)" }}>
                  Prepared {displayDate(meetingPrep.generatedAt)}
                </span>
              )}
            </div>
            {contextLoading && !meetingPrep ? (
              <p className="mt-3 text-xs" style={{ color: "var(--color-warm-gray)" }}>Preparing bounded context…</p>
            ) : meetingPrep === null ? (
              <p className="mt-3 text-xs" style={{ color: "var(--color-warm-gray)" }}>No meeting context is available yet.</p>
            ) : (
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-lg border p-3" style={{ borderColor: "var(--color-border)" }}>
                  <p className="text-xs" style={{ color: "var(--color-warm-gray)" }}>Current Memory</p>
                  <p className="mt-1 text-lg font-semibold" style={{ color: "var(--color-navy)" }}>{meetingPrep.context.memories.length}</p>
                </div>
                <div className="rounded-lg border p-3" style={{ borderColor: "var(--color-border)" }}>
                  <p className="text-xs" style={{ color: "var(--color-warm-gray)" }}>Recent Events</p>
                  <p className="mt-1 text-lg font-semibold" style={{ color: "var(--color-navy)" }}>{meetingPrep.context.recentEvents.length}</p>
                </div>
                <div className="rounded-lg border p-3" style={{ borderColor: "var(--color-border)" }}>
                  <p className="text-xs" style={{ color: "var(--color-warm-gray)" }}>Commitments</p>
                  <p className="mt-1 text-lg font-semibold" style={{ color: "var(--color-navy)" }}>{meetingPrep.context.commitments.length}</p>
                </div>
              </div>
            )}
            {meetingPrep && meetingPrep.recommendedActions.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2" aria-label="Meeting preparation actions">
                {meetingPrep.recommendedActions.map((action) => (
                  <Button
                    key={action.commitmentId}
                    size="sm"
                    variant="outline"
                    disabled={contextBusy || !record.isOwner}
                    onClick={() => logFollowUp(action.label)}
                  >
                    {action.label}
                  </Button>
                ))}
              </div>
            )}
          </section>
        )}
        {person && (
          <section className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }} aria-labelledby="record-memory-title">
            <h2 id="record-memory-title" className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--color-navy)" }}>
              <Database className="w-4 h-4" /> What Bridge knows
            </h2>
            <p className="mt-1 text-xs" style={{ color: "var(--color-warm-gray)" }}>
              Module-associated Memory is classified, source-linked, correctable, and forgettable.
            </p>
            {memories.length === 0 ? (
              <p className="mt-3 text-xs" style={{ color: "var(--color-warm-gray)" }}>
                {contextLoading ? "Loading Memory…" : "Bridge has no accessible Memory for this Person yet."}
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {memories.map((memory) => (
                  <li key={memory.id} className="rounded-lg border p-3" style={{ borderColor: "var(--color-border)" }}>
                    <p className="whitespace-pre-wrap text-sm" style={{ color: "var(--color-navy)" }}>{memory.content}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs capitalize" style={{ color: "var(--color-warm-gray)" }}>
                      <span>{memory.type}</span>
                      <span>·</span>
                      <span>{memory.scope}</span>
                      <span>·</span>
                      <time dateTime={memory.createdAt}>{displayDate(memory.createdAt)}</time>
                    </div>
                    {record.isOwner && memory.ownerUserId === record.ownerUserId && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" disabled={contextBusy} onClick={() => correctMemory(memory)}>Correct</Button>
                        <Button size="sm" variant="outline" disabled={contextBusy} onClick={() => forgetMemory(memory.id)}>Forget</Button>
                      </div>
                    )}
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer" style={{ color: "var(--color-steel)" }}>Provenance</summary>
                      <dl className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2" style={{ color: "var(--color-warm-gray)" }}>
                        <div><dt>Source</dt><dd>{memory.sourceRefType || "Not recorded"}</dd></div>
                        <div><dt>Source ID</dt><dd className="break-all">{memory.sourceRefId || "Not recorded"}</dd></div>
                        <div><dt>Trust origin</dt><dd>{memory.trustOrigin.replace(/_/g, " ")}</dd></div>
                        <div><dt>Supersedes</dt><dd className="break-all">{memory.supersedesId || "None"}</dd></div>
                      </dl>
                    </details>
                  </li>
                ))}
              </ul>
            )}
            {memoriesHaveMore && (
              <Button className="mt-3" size="sm" variant="outline" disabled={contextLoading} onClick={loadMoreMemories}>
                {contextLoading ? "Loading…" : "Load more Memory"}
              </Button>
            )}
            {record.isOwner && (
              <form onSubmit={addMemory} className="mt-4 rounded-lg border p-3" style={{ borderColor: "var(--color-border)" }}>
                <label className="text-sm font-medium" style={{ color: "var(--color-navy-mid)" }}>
                  Add context
                  <textarea
                    rows={3}
                    maxLength={5_000}
                    value={memoryDraft}
                    onChange={(event) => setMemoryDraft(event.target.value)}
                    className={fieldClassName()}
                    style={{ borderColor: "var(--color-border)" }}
                  />
                </label>
                <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
                  <label className="text-sm font-medium" style={{ color: "var(--color-navy-mid)" }}>
                    Classification
                    <select
                      value={memoryScope}
                      onChange={(event) => setMemoryScope(event.target.value as "private" | "organization")}
                      className={fieldClassName()}
                      style={{ borderColor: "var(--color-border)" }}
                    >
                      <option value="private">Only me</option>
                      <option value="organization">Organization</option>
                    </select>
                  </label>
                  <Button type="submit" disabled={contextBusy || !memoryDraft.trim()}>Add Memory</Button>
                </div>
              </form>
            )}
          </section>
        )}
        {person && (
          <section className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }} aria-labelledby="record-commitments-title">
            <h2 id="record-commitments-title" className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--color-navy)" }}>
              <Clock3 className="w-4 h-4" /> Commitments
            </h2>
            <p className="mt-1 text-xs" style={{ color: "var(--color-warm-gray)" }}>
              Private, evidence-bearing commitments linked through governed Relations.
            </p>
            {commitments.length === 0 ? (
              <p className="mt-3 text-xs" style={{ color: "var(--color-warm-gray)" }}>
                {contextLoading ? "Loading commitments…" : "No active commitments for this Person."}
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {commitments.map((commitment) => (
                  <li key={commitment.id} className="rounded-lg border p-3" style={{ borderColor: "var(--color-border)" }}>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-medium" style={{ color: "var(--color-navy)" }}>{commitment.text}</p>
                        <p className="mt-1 text-xs capitalize" style={{ color: "var(--color-warm-gray)" }}>
                          {commitment.status} · due {displayDate(commitment.dueAt)}
                        </p>
                      </div>
                      {record.isOwner && (
                        <div className="flex flex-wrap gap-2">
                          {commitment.status === "pending" ? (
                            <Button size="sm" variant="outline" disabled={contextBusy} onClick={() => updateCommitment(commitment, "completed")}>Complete</Button>
                          ) : (
                            <Button size="sm" variant="outline" disabled={contextBusy} onClick={() => updateCommitment(commitment, "pending")}>Reopen</Button>
                          )}
                          <Button size="sm" variant="outline" disabled={contextBusy} onClick={() => archiveCommitment(commitment.id)}>Archive</Button>
                        </div>
                      )}
                    </div>
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer" style={{ color: "var(--color-steel)" }}>Evidence</summary>
                      <dl className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2" style={{ color: "var(--color-warm-gray)" }}>
                        <div><dt>Transition Event</dt><dd className="break-all">{commitment.transitionEventId}</dd></div>
                        <div><dt>Decision</dt><dd className="break-all">{commitment.provenance.decisionLedgerId}</dd></div>
                        <div><dt>Relation</dt><dd className="break-all">{commitment.provenance.relationId}</dd></div>
                        <div><dt>Evidence refs</dt><dd>{commitment.provenance.evidenceRefs.length}</dd></div>
                      </dl>
                    </details>
                  </li>
                ))}
              </ul>
            )}
            {commitmentsHaveMore && (
              <Button className="mt-3" size="sm" variant="outline" disabled={contextLoading} onClick={loadMoreCommitments}>
                {contextLoading ? "Loading…" : "Load more commitments"}
              </Button>
            )}
            {record.isOwner && (
              <form onSubmit={createCommitment} className="mt-4 rounded-lg border p-3" style={{ borderColor: "var(--color-border)" }}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="text-sm font-medium" style={{ color: "var(--color-navy-mid)" }}>
                    Commitment
                    <input
                      maxLength={2_000}
                      value={commitmentDraft}
                      onChange={(event) => setCommitmentDraft(event.target.value)}
                      className={fieldClassName()}
                      style={{ borderColor: "var(--color-border)" }}
                    />
                  </label>
                  <label className="text-sm font-medium" style={{ color: "var(--color-navy-mid)" }}>
                    Due at
                    <input
                      type="datetime-local"
                      value={commitmentDueAt}
                      onChange={(event) => setCommitmentDueAt(event.target.value)}
                      className={fieldClassName()}
                      style={{ borderColor: "var(--color-border)" }}
                    />
                  </label>
                </div>
                <Button className="mt-3" type="submit" disabled={contextBusy || !commitmentDraft.trim()}>Add Commitment</Button>
              </form>
            )}
          </section>
        )}
        {person && (
          <section className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }} aria-labelledby="record-introductions-title">
            <h2 id="record-introductions-title" className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--color-navy)" }}>
              <Users className="w-4 h-4" /> Introductions
            </h2>
            <p className="mt-1 text-xs" style={{ color: "var(--color-warm-gray)" }}>
              Both parties must explicitly consent before an introduction can be recorded. Bridge never sends the introduction from this surface.
            </p>
            {introductions.length === 0 ? (
              <p className="mt-3 text-xs" style={{ color: "var(--color-warm-gray)" }}>
                {contextLoading ? "Loading introductions…" : "No governed introductions for this Person."}
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {introductions.map((introduction) => (
                  <li key={introduction.id} className="rounded-lg border p-3" style={{ borderColor: "var(--color-border)" }}>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        {introduction.counterpart ? (
                          <Link
                            to={`/module/relationship/people/${introduction.counterpart.id}`}
                            className="text-sm font-medium hover:underline"
                            style={{ color: "var(--color-navy)" }}
                          >
                            {introduction.counterpart.displayName || "Unnamed Person"}
                          </Link>
                        ) : (
                          <p className="text-sm font-medium" style={{ color: "var(--color-navy)" }}>Person no longer accessible</p>
                        )}
                        <p className="mt-1 text-xs capitalize" style={{ color: "var(--color-warm-gray)" }}>
                          {introduction.status.replace(/_/g, " ")} · initiator {introduction.initiatorConsent ? "consented" : "pending"} · recipient {introduction.recipientConsent ? "consented" : "pending"}
                        </p>
                        {introduction.declineReasonRecorded && (
                          <p className="mt-1 text-xs" style={{ color: "var(--color-warm-gray)" }}>
                            A private decline reason is recorded. Its contents are not exposed here.
                          </p>
                        )}
                      </div>
                      {record.isOwner && (
                        <div className="flex flex-wrap gap-2">
                          {introduction.status === "awaiting_consents" && !introduction.recipientConsent && (
                            <>
                              <Button size="sm" variant="outline" disabled={contextBusy} onClick={() => recordIntroductionConsent(introduction, "consent")}>Record recipient consent</Button>
                              <Button size="sm" variant="outline" disabled={contextBusy} onClick={() => recordIntroductionConsent(introduction, "decline")}>Record decline</Button>
                            </>
                          )}
                          {introduction.status === "ready" && (
                            <Button size="sm" variant="outline" disabled={contextBusy} onClick={() => transitionIntroduction(introduction.id, "complete")}>Mark introduced</Button>
                          )}
                          {(introduction.status === "awaiting_consents" || introduction.status === "ready") && (
                            <Button size="sm" variant="outline" disabled={contextBusy} onClick={() => transitionIntroduction(introduction.id, "cancel")}>Cancel</Button>
                          )}
                        </div>
                      )}
                    </div>
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer" style={{ color: "var(--color-steel)" }}>Evidence</summary>
                      <dl className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2" style={{ color: "var(--color-warm-gray)" }}>
                        <div><dt>Transition Event</dt><dd className="break-all">{introduction.transitionEventId}</dd></div>
                        <div><dt>Decision</dt><dd className="break-all">{introduction.provenance.decisionLedgerId}</dd></div>
                        <div><dt>Relations</dt><dd>{introduction.provenance.relationIds.length}</dd></div>
                        <div><dt>Evidence refs</dt><dd>{introduction.provenance.evidenceRefs.length}</dd></div>
                      </dl>
                    </details>
                  </li>
                ))}
              </ul>
            )}
            {introductionsHaveMore && (
              <Button className="mt-3" size="sm" variant="outline" disabled={contextLoading} onClick={loadMoreIntroductions}>
                {contextLoading ? "Loading…" : "Load more introductions"}
              </Button>
            )}
          </section>
        )}
        <section className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }} aria-labelledby="record-connections-title">
          <h2 id="record-connections-title" className="text-sm font-semibold" style={{ color: "var(--color-navy)" }}>How are they connected?</h2>
          <p className="mt-1 text-xs" style={{ color: "var(--color-warm-gray)" }}>
            Finds shortest paths through at most four visibility-pruned Relation hops. This is an explanation, not the cross-Module Graph renderer.
          </p>
          <form onSubmit={searchPathTargets} className="mt-3 flex flex-col gap-2 sm:flex-row">
            <label className="flex-1 text-sm font-medium" style={{ color: "var(--color-navy-mid)" }}>
              Find a Person
              <input
                maxLength={120}
                value={pathQuery}
                onChange={(event) => setPathQuery(event.target.value)}
                className={fieldClassName()}
                style={{ borderColor: "var(--color-border)" }}
              />
            </label>
            <Button className="sm:self-end" type="submit" disabled={pathLoading || !pathQuery.trim()}>
              {pathLoading ? "Searching…" : "Search"}
            </Button>
          </form>
          {pathCandidates.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2" aria-label="Path target results">
              {pathCandidates.map((candidate) => (
                <div key={candidate.id} className="flex flex-wrap gap-1 rounded-lg border p-1" style={{ borderColor: "var(--color-border)" }}>
                  <Button size="sm" variant="outline" disabled={pathLoading} onClick={() => findPathTo(candidate.id)}>
                    Path to {candidate.name}
                  </Button>
                  {person?.isOwner && (
                    <Button size="sm" variant="outline" disabled={contextBusy} onClick={() => createIntroduction(candidate.id)}>
                      Prepare introduction
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
          {pathResult && (
            pathResult.paths.length === 0 ? (
              <p className="mt-3 text-xs" style={{ color: "var(--color-warm-gray)" }}>No accessible path was found inside the current safety bounds.</p>
            ) : (
              <ol className="mt-3 space-y-3">
                {pathResult.paths.map((path, pathIndex) => (
                  <li key={`${pathIndex}:${path.nodes.map((node) => node.nodeId).join(":")}`} className="rounded-lg border p-3" style={{ borderColor: "var(--color-border)" }}>
                    <p className="text-xs" style={{ color: "var(--color-warm-gray)" }}>
                      {path.steps.length} hops · {Math.round(path.confidence * 100)}% combined confidence
                    </p>
                    <ol className="mt-2 space-y-2">
                      {path.steps.map((step) => (
                        <li key={step.relation.id} className="text-sm" style={{ color: "var(--color-navy)" }}>
                          <span className="capitalize">{step.from.nodeType}</span>
                          {" → "}
                          <strong>{step.relation.edgeType.replace(/_/g, " ")}</strong>
                          {" → "}
                          <span className="capitalize">{step.to.nodeType}</span>
                          <span className="ml-2 text-xs" style={{ color: "var(--color-warm-gray)" }}>
                            {step.relation.evidenceRefs.length} evidence refs
                          </span>
                        </li>
                      ))}
                    </ol>
                  </li>
                ))}
              </ol>
            )
          )}
          {pathResult?.truncated && (
            <p className="mt-2 text-xs" style={{ color: "var(--color-warm-gray)" }}>
              Search stopped at its explicit visit or edge bound.
            </p>
          )}
        </section>
        {record.isOwner && <InteractionForm key={`${kind}:${recordId}`} kind={kind} recordId={recordId} onApplied={reloadCurrentRecord} />}
        <section className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }} aria-labelledby="record-timeline-title">
          <h2 id="record-timeline-title" className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--color-navy)" }}><CalendarClock className="w-4 h-4" /> Timeline</h2>
          {timeline.length === 0 ? (
            <p className="mt-2 text-xs" style={{ color: "var(--color-warm-gray)" }}>No accessible Events are linked to this Record yet.</p>
          ) : (
            <ol className="mt-3 space-y-3">
              {timeline.map((item) => (
                <li key={item.id} className="rounded-lg border p-3" style={{ borderColor: "var(--color-border)" }}>
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-sm font-medium" style={{ color: "var(--color-navy)" }}>{item.summary || item.kind.replace(/_/g, " ")}</p>
                      <p className="text-xs capitalize" style={{ color: "var(--color-warm-gray)" }}>{item.kind.replace(/_/g, " ")} · {item.source.replace(/_/g, " ")}</p>
                    </div>
                    <time dateTime={item.occurredAt} className="text-xs" style={{ color: "var(--color-warm-gray)" }}>{displayDate(item.occurredAt)}</time>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2" aria-label="Event participants">
                    {item.participants.map((participant) => (
                      <Link key={participant.relationId} to={`/module/relationship/${participant.recordType === "person" ? "people" : "communities"}/${participant.recordId}`} className="rounded-full border px-2 py-1 text-xs no-underline" style={{ borderColor: "var(--color-border)", color: "var(--color-steel)" }}>
                        {participant.displayName || `Unnamed ${participant.recordType}`}
                        {participant.role ? ` · ${participant.role}` : ""}
                      </Link>
                    ))}
                  </div>
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer" style={{ color: "var(--color-steel)" }}>Provenance</summary>
                    <dl className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2" style={{ color: "var(--color-warm-gray)" }}>
                      <div><dt>Event</dt><dd className="break-all">{item.provenance.eventId}</dd></div>
                      <div><dt>Relations</dt><dd>{item.provenance.relationIds.length}</dd></div>
                      <div><dt>Evidence refs</dt><dd>{item.provenance.evidenceRefs.length}</dd></div>
                      <div><dt>Decisions</dt><dd>{item.provenance.decisionLedgerIds.length}</dd></div>
                    </dl>
                  </details>
                </li>
              ))}
            </ol>
          )}
          {nextCursor && <Button className="mt-3" size="sm" variant="outline" disabled={timelineLoading} onClick={loadMoreTimeline}>{timelineLoading ? "Loading…" : "Load older Events"}</Button>}
          {whatsapp && (
            <div className="mt-4 border-t pt-4" style={{ borderColor: "var(--color-border)" }}>
              <h3 className="text-xs font-semibold flex items-center gap-2" style={{ color: "var(--color-navy)" }}>
                <MessageCircle className="w-3.5 h-3.5" /> WhatsApp activity
              </h3>
              {/* Stated on the surface, not only in the code: these rows are
                  read from this machine and are not part of the Event graph. */}
              <p className="mt-1 text-xs" style={{ color: "var(--color-warm-gray)" }}>
                Read from this machine. Message content stays in the WhatsApp Module and is never copied into this Record.
              </p>
              {whatsapp.entries.length === 0 ? (
                <p className="mt-2 text-xs" style={{ color: "var(--color-warm-gray)" }}>
                  {WHATSAPP_LINKAGE_NOTE[whatsapp.linkage] ?? "No WhatsApp chats are linked to this Record yet."}
                </p>
              ) : (
                <ol className="mt-3 space-y-2">
                  {whatsapp.entries.map((entry) => (
                    <li key={entry.chatId} className="rounded-lg border p-3" style={{ borderColor: "var(--color-border)" }}>
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-sm font-medium" style={{ color: "var(--color-navy)" }}>{entry.chatName || "WhatsApp chat"}</p>
                          <p className="text-xs" style={{ color: "var(--color-warm-gray)" }}>
                            {entry.messageCount} message{entry.messageCount === 1 ? "" : "s"} · {entry.inboundCount} received · {entry.outboundCount} sent
                          </p>
                        </div>
                        <time dateTime={entry.occurredAt ?? undefined} className="text-xs" style={{ color: "var(--color-warm-gray)" }}>{displayDate(entry.occurredAt)}</time>
                      </div>
                      <Link to="/module/whatsapp/chats" className="mt-2 inline-block text-xs no-underline" style={{ color: "var(--color-steel)" }}>
                        Open in the WhatsApp Module →
                      </Link>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </section>
        <section className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }} aria-labelledby="record-sources-title">
          <h2 id="record-sources-title" className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--color-navy)" }}><Database className="w-4 h-4" /> Sources</h2>
          <ul className="mt-3 space-y-2">
            {uniqueSources.map((source) => (
              <li key={source.key} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--color-border)" }}>
                <p className="font-medium capitalize" style={{ color: "var(--color-navy)" }}>{source.source.replace(/_/g, " ")}</p>
                {source.sourceRecordId && <p className="mt-1 break-all text-xs" style={{ color: "var(--color-warm-gray)" }}>Source Record: {source.sourceRecordId}</p>}
                {source.eventId && <p className="mt-1 break-all text-xs" style={{ color: "var(--color-warm-gray)" }}>Event: {source.eventId}</p>}
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }}>
          <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--color-navy)" }}><FileText className="w-4 h-4" /> Files</h2>
          <p className="mt-1 text-xs" style={{ color: "var(--color-warm-gray)" }}>No local Files are attached to this Record yet.</p>
        </section>
      </div>
    </div>
  );
}
