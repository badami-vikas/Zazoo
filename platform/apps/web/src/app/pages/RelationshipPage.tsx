import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import {
  ArrowLeft,
  CalendarClock,
  FileText,
  LayoutGrid,
  List as ListIcon,
  Radio,
  Table as TableIcon,
  User,
  Users,
} from "lucide-react";
import { Header } from "../components/shared/Header";
import { StandardToolbar, type ToolbarView } from "../components/shared/StandardToolbar";
import { Button } from "../components/ui/button";
import { trpc, PILOT_WORKSPACE } from "../lib/trpc";
import { SignalsPage } from "./SignalsPage";

type RelationshipPageId = "signals" | "people" | "communities";
type RecordKind = "person" | "community";
type ViewId = "table" | "card" | "list";

interface RelationshipListRecord {
  id: string;
  name: string;
  subtitle: string;
  visibility: string;
  source: string;
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

function RecordEmptyState({ kind }: { kind: "People" | "Communities" }) {
  return (
    <div className="m-4 rounded-xl border border-dashed p-8 text-center" style={{ borderColor: "var(--color-border)" }}>
      <p className="text-sm font-medium" style={{ color: "var(--color-navy)" }}>No {kind.toLowerCase()} yet.</p>
      <p className="mt-1 text-xs" style={{ color: "var(--color-warm-gray)" }}>
        Connect or import a permitted source to populate this Page.
      </p>
      <Button asChild size="sm" variant="outline" className="mt-3">
        <Link to="/settings">Manage sources</Link>
      </Button>
    </div>
  );
}

function RecordListPage({ kind }: { kind: RecordKind }) {
  const [rows, setRows] = useState<RelationshipListRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const initialView = searchParams.get("view");
  const [view, setView] = useState<ViewId>(
    initialView === "card" || initialView === "list" ? initialView : "table",
  );

  useEffect(() => {
    setRows(null);
    setError(null);
    const request =
      kind === "person"
        ? trpc.graph.listPeople
            .query({ workspaceId: PILOT_WORKSPACE, limit: 200, offset: 0 })
            .then((page) =>
              page.items.map((record) => ({
                id: record.id,
                name: record.displayName || "Unnamed person",
                subtitle: record.currentTitle || "No current role recorded",
                visibility: record.visibility,
                source: record.source || "Not recorded",
              })),
            )
        : trpc.graph.listCommunities
            .query({ workspaceId: PILOT_WORKSPACE, limit: 200, offset: 0 })
            .then((page) =>
              page.items.map((record) => ({
                id: record.id,
                name: record.displayName || "Unnamed community",
                subtitle: record.kind || record.description || "No kind recorded",
                visibility: record.visibility,
                source: record.source,
              })),
            );
    request.then(setRows).catch((cause) => setError(String(cause)));
  }, [kind]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const query = search.trim().toLowerCase();
    return query
      ? rows.filter((row) => `${row.name} ${row.subtitle} ${row.source}`.toLowerCase().includes(query))
      : rows;
  }, [rows, search]);

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
          moreMenu={<div className="px-3 py-2 text-xs text-[var(--color-warm-gray)]">Export requires a governed Action.</div>}
        />
        {filtered.length === 0 ? (
          <RecordEmptyState kind={plural} />
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
                {filtered.map((record) => (
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
            {filtered.map((record) => (
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
      </section>
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
                {participant.confidence !== null ? ` · ${Math.round(participant.confidence * 100)}% evidence confidence` : ""}
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

  useEffect(() => {
    trpc.graph.getSignalDetail
      .query({ workspaceId: PILOT_WORKSPACE, signalId })
      .then(setDetail)
      .catch((cause) => setError(String(cause)));
  }, [signalId]);

  async function act() {
    setBusy(true);
    setError(null);
    try {
      const proposal = await trpc.graph.proposeSignalAction.mutate({ workspaceId: PILOT_WORKSPACE, signalId });
      setProposalStatus(proposal.status);
      if (proposal.status === "rejected") setError(proposal.rejectionReason || "The governed Action was rejected.");
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  if (error && detail === undefined) return <div className="p-4 sm:p-6 text-sm text-red-600 break-words">{error}</div>;
  if (detail === undefined) return <div className="p-4 sm:p-6 text-sm text-muted-foreground">Loading Signal evidence…</div>;
  if (detail === null) return <div className="p-4 sm:p-6 text-sm text-muted-foreground">Signal not found or not accessible.</div>;

  const actionable = detail.participants.length > 0 && detail.sourceEvent !== null;
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

export function RelationshipRecordDetailPage({ kind }: { kind: RecordKind }) {
  const { recordId = "" } = useParams<{ recordId: string }>();
  const [record, setRecord] = useState<
    Awaited<ReturnType<typeof trpc.graph.getPerson.query>> |
    Awaited<ReturnType<typeof trpc.graph.getCommunity.query>> |
    undefined
  >();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = kind === "person"
      ? trpc.graph.getPerson.query({ workspaceId: PILOT_WORKSPACE, id: recordId })
      : trpc.graph.getCommunity.query({ workspaceId: PILOT_WORKSPACE, id: recordId });
    query.then(setRecord).catch((cause) => setError(String(cause)));
  }, [kind, recordId]);

  if (error) return <div className="p-4 sm:p-6 text-sm text-red-600 break-words">{error}</div>;
  if (record === undefined) return <div className="p-4 sm:p-6 text-sm text-muted-foreground">Loading Record…</div>;
  if (record === null) return <div className="p-4 sm:p-6 text-sm text-muted-foreground">Record not found or not accessible.</div>;

  const isPerson = kind === "person";
  const person = isPerson ? record as Awaited<ReturnType<typeof trpc.graph.getPerson.query>> : null;
  const community = !isPerson ? record as Awaited<ReturnType<typeof trpc.graph.getCommunity.query>> : null;
  const name = person?.displayName || community?.displayName || `Unnamed ${kind}`;

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <Link to={`/module/relationship/${isPerson ? "people" : "communities"}`} className="inline-flex items-center gap-1 text-sm no-underline hover:underline" style={{ color: "var(--color-steel)" }}>
          <ArrowLeft className="w-4 h-4" /> {isPerson ? "People" : "Communities"}
        </Link>
        <div className="flex items-center gap-3">
          {isPerson ? <User className="w-7 h-7" /> : <Users className="w-7 h-7" />}
          <div>
            <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-warm-gray)" }}>{isPerson ? "Person" : "Community"}</p>
            <h1 className="text-2xl font-semibold" style={{ color: "var(--color-navy)", fontFamily: "var(--font-editorial)" }}>{name}</h1>
          </div>
        </div>
        <section className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--color-navy)" }}>Overview</h2>
          <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div><dt className="text-xs" style={{ color: "var(--color-warm-gray)" }}>Context</dt><dd style={{ color: "var(--color-navy)" }}>{person?.currentTitle || community?.kind || community?.description || "Not recorded"}</dd></div>
            <div><dt className="text-xs" style={{ color: "var(--color-warm-gray)" }}>Source</dt><dd style={{ color: "var(--color-navy)" }}>{person?.source || community?.source || "Not recorded"}</dd></div>
            <div><dt className="text-xs" style={{ color: "var(--color-warm-gray)" }}>Visibility</dt><dd className="capitalize" style={{ color: "var(--color-navy)" }}>{record.visibility}</dd></div>
            {person && <div><dt className="text-xs" style={{ color: "var(--color-warm-gray)" }}>Last Interaction</dt><dd style={{ color: "var(--color-navy)" }}>{displayDate(person.lastInteractionAt)}</dd></div>}
          </dl>
        </section>
        {["Relations", "Event history", "Files"].map((section) => (
          <section key={section} className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }}>
            <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--color-navy)" }}>
              {section === "Files" && <FileText className="w-4 h-4" />} {section}
            </h2>
            <p className="mt-1 text-xs" style={{ color: "var(--color-warm-gray)" }}>
              No accessible {section.toLowerCase()} are linked to this Record yet.
            </p>
          </section>
        ))}
      </div>
    </div>
  );
}
