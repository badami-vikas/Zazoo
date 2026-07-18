import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import {
  ArrowLeft,
  Archive,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Database,
  FileText,
  FormInput,
  LayoutGrid,
  List as ListIcon,
  Pencil,
  Plus,
  Radio,
  Save,
  Table as TableIcon,
  User,
  Users,
  X,
} from "lucide-react";
import { Header } from "../components/shared/Header";
import { StandardToolbar, type ToolbarView } from "../components/shared/StandardToolbar";
import { Button } from "../components/ui/button";
import { trpc, PILOT_WORKSPACE } from "../lib/trpc";
import { SignalsPage } from "./SignalsPage";

type RelationshipPageId = "signals" | "people" | "communities";
type RecordKind = "person" | "community";
type ViewId = "table" | "card" | "list" | "form";

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

const VIEWS: ToolbarView[] = [
  { id: "table", label: "Table", icon: TableIcon },
  { id: "card", label: "Card", icon: LayoutGrid },
  { id: "list", label: "List", icon: ListIcon },
  { id: "form", label: "Form", icon: FormInput },
];

function isPage(value: string | undefined): value is RelationshipPageId {
  return value === "signals" || value === "people" || value === "communities";
}

function displayDate(value: string | Date | null | undefined): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleString();
}

function recommendedActionLabel(recommendedAction: unknown): string {
  if (typeof recommendedAction === "object" && recommendedAction !== null && !Array.isArray(recommendedAction)) {
    const label = (recommendedAction as Record<string, unknown>).label;
    if (typeof label === "string" && label.trim()) return label.trim();
  }
  return "Review action";
}

function RecordEmptyState({
  kind,
  query,
  onCreate,
}: {
  kind: "People" | "Communities";
  query: string;
  onCreate: () => void;
}) {
  return (
    <div className="m-4 rounded-xl border border-dashed p-8 text-center" style={{ borderColor: "var(--color-border)" }}>
      <p className="text-sm font-medium" style={{ color: "var(--color-navy)" }}>
        {query ? `No ${kind.toLowerCase()} match "${query}".` : `No ${kind.toLowerCase()} yet.`}
      </p>
      <p className="mt-1 text-xs" style={{ color: "var(--color-warm-gray)" }}>
        {query
          ? "Try a different bounded search."
          : `Create a ${kind === "People" ? "Person" : "Community"} or connect a permitted source.`}
      </p>
      {!query && (
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <Button size="sm" onClick={onCreate}><Plus className="w-4 h-4" /> Create</Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/settings">Manage sources</Link>
          </Button>
        </div>
      )}
    </div>
  );
}

function fieldClassName() {
  return "mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-steel)]";
}

function RecordForm({
  kind,
  onCancel,
  onApplied,
}: {
  kind: RecordKind;
  onCancel: () => void;
  onApplied: () => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [context, setContext] = useState("");
  const [description, setDescription] = useState("");
  const [emails, setEmails] = useState("");
  const [visibility, setVisibility] = useState<"private" | "workspace">("private");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const result = kind === "person"
        ? await trpc.relationship.createPerson.mutate({
            workspaceId: PILOT_WORKSPACE,
            values: {
              displayName,
              currentTitle: context || null,
              bio: description || null,
              emails: emails.split(",").map((email) => email.trim()).filter(Boolean),
              visibility,
            },
          })
        : await trpc.relationship.createCommunity.mutate({
            workspaceId: PILOT_WORKSPACE,
            values: {
              displayName,
              kind: context || null,
              description: description || null,
              visibility,
            },
          });
      setStatus(result.materialization.status.replace("_", " "));
      if (result.materialization.status === "applied") onApplied();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  const noun = kind === "person" ? "Person" : "Community";
  return (
    <form onSubmit={submit} className="m-4 max-w-2xl rounded-xl border p-4 sm:p-5" style={{ borderColor: "var(--color-border)" }}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-warm-gray)" }}>Form view</p>
          <h2 className="text-lg font-semibold" style={{ color: "var(--color-navy)" }}>Create {noun}</h2>
        </div>
        <button type="button" onClick={onCancel} aria-label="Close form" className="rounded-lg p-2 hover:bg-[var(--color-surface)]">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium sm:col-span-2" style={{ color: "var(--color-navy-mid)" }}>
          Name
          <input required maxLength={300} value={displayName} onChange={(event) => setDisplayName(event.target.value)} className={fieldClassName()} style={{ borderColor: "var(--color-border)" }} />
        </label>
        <label className="text-sm font-medium" style={{ color: "var(--color-navy-mid)" }}>
          {kind === "person" ? "Current role" : "Kind"}
          <input maxLength={300} value={context} onChange={(event) => setContext(event.target.value)} className={fieldClassName()} style={{ borderColor: "var(--color-border)" }} />
        </label>
        <label className="text-sm font-medium" style={{ color: "var(--color-navy-mid)" }}>
          Visibility
          <select value={visibility} onChange={(event) => setVisibility(event.target.value as "private" | "workspace")} className={fieldClassName()} style={{ borderColor: "var(--color-border)" }}>
            <option value="private">Only me</option>
            <option value="workspace">Workspace</option>
          </select>
        </label>
        {kind === "person" && (
          <label className="text-sm font-medium sm:col-span-2" style={{ color: "var(--color-navy-mid)" }}>
            Emails, comma separated
            <input value={emails} onChange={(event) => setEmails(event.target.value)} className={fieldClassName()} style={{ borderColor: "var(--color-border)" }} inputMode="email" />
          </label>
        )}
        <label className="text-sm font-medium sm:col-span-2" style={{ color: "var(--color-navy-mid)" }}>
          {kind === "person" ? "Bio" : "Description"}
          <textarea maxLength={5000} rows={4} value={description} onChange={(event) => setDescription(event.target.value)} className={fieldClassName()} style={{ borderColor: "var(--color-border)" }} />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button disabled={busy || !displayName.trim()} type="submit"><Save className="w-4 h-4" /> {busy ? "Submitting…" : `Create ${noun}`}</Button>
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        {status && <span role="status" className="text-xs capitalize" style={{ color: "var(--color-steel)" }}>Action {status}</span>}
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-red-600 break-words">{error}</p>}
      <p className="mt-3 text-xs" style={{ color: "var(--color-warm-gray)" }}>
        Save stages a server-owned Action; the browser never writes Relationship tables directly.
      </p>
    </form>
  );
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
      workspaceId: PILOT_WORKSPACE,
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
  const [rows, setRows] = useState<RelationshipListRecord[] | null>(null);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [reload, setReload] = useState(0);
  const [searchParams, setSearchParams] = useSearchParams();
  const initialView = searchParams.get("view");
  const [view, setView] = useState<ViewId>(
    initialView === "card" || initialView === "list" || initialView === "form" ? initialView : "table",
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setOffset(0);
      setQuery(search.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let active = true;
    setRows(null);
    setError(null);
    const request =
      kind === "person"
        ? trpc.relationship.listPeople.query({
            workspaceId: PILOT_WORKSPACE,
            limit: 50,
            offset,
            ...(query ? { query } : {}),
          }).then((page) => ({
            ...page,
            items: page.items.map((record) => ({
                id: record.id,
                name: record.displayName || "Unnamed person",
                subtitle: record.currentTitle || "No current role recorded",
                visibility: record.visibility,
                source: record.source || "Not recorded",
                isOwner: record.isOwner,
              })),
            }))
        : trpc.relationship.listCommunities.query({
            workspaceId: PILOT_WORKSPACE,
            limit: 50,
            offset,
            ...(query ? { query } : {}),
          }).then((page) => ({
            ...page,
            items: page.items.map((record) => ({
                id: record.id,
                name: record.displayName || "Unnamed community",
                subtitle: record.kind || record.description || "No kind recorded",
                visibility: record.visibility,
                source: record.source,
                isOwner: record.isOwner,
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
  }, [kind, offset, query, reload]);

  function selectView(next: string) {
    const nextView = next as ViewId;
    setView(nextView);
    const params = new URLSearchParams(searchParams);
    params.set("view", nextView);
    setSearchParams(params, { replace: true });
  }

  const plural = kind === "person" ? "People" : "Communities";
  const detailSegment = kind === "person" ? "people" : "communities";

  if (error) return <div className="p-4 sm:p-6 text-sm text-red-600 break-words">{error}</div>;
  if (rows === null) return <div className="p-4 sm:p-6 text-sm text-muted-foreground">Loading {plural.toLowerCase()}…</div>;

  return (
    <div className="flex-1 overflow-auto">
      <section aria-label={`${plural} landing section`}>
        <StandardToolbar
          lists={[{ id: "__all", label: `All ${plural}` }]}
          activeListId="__all"
          onListSelect={() => {}}
          view={view}
          views={VIEWS}
          onViewChange={selectView}
          search={search}
          onSearchChange={setSearch}
          customActions={<Button size="sm" onClick={() => selectView("form")}><Plus className="w-4 h-4" /> New {kind === "person" ? "Person" : "Community"}</Button>}
          moreMenu={<div className="px-3 py-2 text-xs text-[var(--color-warm-gray)]">Export requires a governed Action.</div>}
        />
        {view === "form" ? (
          <RecordForm
            kind={kind}
            onCancel={() => selectView("table")}
            onApplied={() => {
              setOffset(0);
              setReload((value) => value + 1);
              selectView("table");
            }}
          />
        ) : rows.length === 0 ? (
          <RecordEmptyState kind={plural} query={query} onCreate={() => selectView("form")} />
        ) : view === "table" ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide" style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}>
                  <th className="px-4 py-2 font-semibold">{kind === "person" ? "Person" : "Community"}</th>
                  <th className="px-4 py-2 font-semibold">Context</th>
                  <th className="px-4 py-2 font-semibold">Source</th>
                  <th className="px-4 py-2 font-semibold">Visibility</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((record) => (
                  <tr key={record.id} className="border-b" style={{ borderColor: "var(--color-border)" }}>
                    <td className="px-4 py-3">
                      <Link to={`/module/relationship/${detailSegment}/${record.id}`} className="font-medium hover:underline" style={{ color: "var(--color-navy)" }}>
                        {record.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3" style={{ color: "var(--color-navy-mid)" }}>{record.subtitle}</td>
                    <td className="px-4 py-3" style={{ color: "var(--color-warm-gray)" }}>{record.source}</td>
                    <td className="px-4 py-3 capitalize" style={{ color: "var(--color-warm-gray)" }}>{record.visibility}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={view === "card" ? "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 p-4" : "divide-y"} style={{ borderColor: "var(--color-border)" }}>
            {rows.map((record) => (
              <Link
                key={record.id}
                to={`/module/relationship/${detailSegment}/${record.id}`}
                className={view === "card" ? "rounded-xl border p-4 no-underline hover:shadow-sm" : "flex items-center gap-3 px-4 py-3 no-underline hover:bg-[var(--color-surface)]"}
                style={{ borderColor: "var(--color-border)" }}
              >
                {kind === "person" ? <User className="w-4 h-4 shrink-0" /> : <Users className="w-4 h-4 shrink-0" />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate" style={{ color: "var(--color-navy)" }}>{record.name}</p>
                  <p className="text-xs truncate" style={{ color: "var(--color-warm-gray)" }}>{record.subtitle}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
        {view !== "form" && total > 0 && (
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
      <section className="m-4 rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }}>
        <h2 className="text-sm font-semibold" style={{ color: "var(--color-navy)" }}>Files</h2>
        <p className="mt-1 text-xs" style={{ color: "var(--color-warm-gray)" }}>
          Imports, exports, and briefs generated by Relationship will appear here.
        </p>
      </section>
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
      {activePage === "signals" ? <SignalsPage embedded /> : <RecordListPage kind={activePage === "people" ? "person" : "community"} />}
    </div>
  );
}

type SignalDetail = Awaited<ReturnType<typeof trpc.graph.getSignalDetail.query>>;

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
    trpc.graph.getSignalDetail
      .query({ workspaceId: PILOT_WORKSPACE, signalId })
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
      const proposal = await trpc.graph.proposeSignalAction.mutate({
        workspaceId: PILOT_WORKSPACE,
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
    trpc.graph.getSignalDetail
      .query({ workspaceId: PILOT_WORKSPACE, signalId })
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
  const [emails, setEmails] = useState(
    props.kind === "person" ? props.record.emails.join(", ") : "",
  );
  const [visibility, setVisibility] = useState<"private" | "workspace">(
    props.record.visibility === "workspace" ? "workspace" : "private",
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
            workspaceId: PILOT_WORKSPACE,
            id: props.record.id,
            values: {
              displayName,
              currentTitle: context || null,
              bio: description || null,
              emails: emails.split(",").map((email) => email.trim()).filter(Boolean),
              visibility,
            },
          })
        : await trpc.relationship.updateCommunity.mutate({
            workspaceId: PILOT_WORKSPACE,
            id: props.record.id,
            values: {
              displayName,
              kind: context || null,
              description: description || null,
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
          <select value={visibility} onChange={(event) => setVisibility(event.target.value as "private" | "workspace")} className={fieldClassName()} style={{ borderColor: "var(--color-border)" }}>
            <option value="private">Only me</option>
            <option value="workspace">Workspace</option>
          </select>
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
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [visibility, setVisibility] = useState<"private" | "workspace">("private");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await trpc.relationship.createInteraction.mutate({
        workspaceId: PILOT_WORKSPACE,
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
          <select value={visibility} onChange={(event) => setVisibility(event.target.value as "private" | "workspace")} className={fieldClassName()} style={{ borderColor: "var(--color-border)" }}>
            <option value="private">Only me</option>
            <option value="workspace">Workspace</option>
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
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const requestGeneration = useRef(0);

  useEffect(() => {
    const generation = ++requestGeneration.current;
    setRecord(undefined);
    setTimeline([]);
    setNextCursor(null);
    setError(null);
    const recordRequest = kind === "person"
      ? trpc.relationship.getPerson.query({ workspaceId: PILOT_WORKSPACE, id: recordId })
      : trpc.relationship.getCommunity.query({ workspaceId: PILOT_WORKSPACE, id: recordId });
    void Promise.all([
      recordRequest,
      trpc.relationship.timeline.query({
        workspaceId: PILOT_WORKSPACE,
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
  }, [kind, recordId, reload]);

  async function loadMoreTimeline() {
    if (!nextCursor || timelineLoading) return;
    setTimelineLoading(true);
    setError(null);
    try {
      const page = await trpc.relationship.timeline.query({
        workspaceId: PILOT_WORKSPACE,
        recordType: kind,
        recordId,
        limit: 25,
        cursor: nextCursor,
      });
      setTimeline((items) => [...items, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setTimelineLoading(false);
    }
  }

  async function archiveRecord() {
    if (!record?.isOwner || !window.confirm(`Archive ${record.displayName || kind}?`)) return;
    setError(null);
    try {
      const result = kind === "person"
        ? await trpc.relationship.archivePerson.mutate({ workspaceId: PILOT_WORKSPACE, id: recordId })
        : await trpc.relationship.archiveCommunity.mutate({ workspaceId: PILOT_WORKSPACE, id: recordId });
      setActionStatus(result.materialization.status.replace("_", " "));
      if (result.materialization.status === "applied") {
        navigate(`/module/relationship/${kind === "person" ? "people" : "communities"}`);
      }
    } catch (cause) {
      setError(String(cause));
    }
  }

  if (error && record === undefined) return <div className="p-4 sm:p-6 text-sm text-red-600 break-words">{error}</div>;
  if (record === undefined) return <div className="p-4 sm:p-6 text-sm text-muted-foreground">Loading Record…</div>;
  if (record === null) return <div className="p-4 sm:p-6 text-sm text-muted-foreground">Record not found or not accessible.</div>;

  const isPerson = kind === "person";
  const person = isPerson ? record as PersonDetail : null;
  const community = !isPerson ? record as CommunityDetail : null;
  const name = record.displayName || `Unnamed ${kind}`;
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
            ? <RecordEditForm kind="person" record={person!} onCancel={() => setEditing(false)} onApplied={() => { setEditing(false); setReload((value) => value + 1); }} />
            : <RecordEditForm kind="community" record={community!} onCancel={() => setEditing(false)} onApplied={() => { setEditing(false); setReload((value) => value + 1); }} />
        )}
        <section className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }} aria-labelledby="record-overview-title">
          <h2 id="record-overview-title" className="text-sm font-semibold" style={{ color: "var(--color-navy)" }}>Overview</h2>
          <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div><dt className="text-xs" style={{ color: "var(--color-warm-gray)" }}>Context</dt><dd className="break-words" style={{ color: "var(--color-navy)" }}>{person?.currentTitle || community?.kind || "Not recorded"}</dd></div>
            <div><dt className="text-xs" style={{ color: "var(--color-warm-gray)" }}>Visibility</dt><dd className="capitalize" style={{ color: "var(--color-navy)" }}>{record.visibility}</dd></div>
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
        {record.isOwner && <InteractionForm kind={kind} recordId={recordId} onApplied={() => setReload((value) => value + 1)} />}
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
