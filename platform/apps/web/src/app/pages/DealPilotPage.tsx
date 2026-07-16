import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  BriefcaseBusiness,
  Database,
  Eye,
  Files,
  LayoutGrid,
  LockKeyhole,
  Plus,
  RefreshCw,
  Table as TableIcon,
  Target,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { Header } from "../components/shared/Header";
import { StandardToolbar, type ToolbarView } from "../components/shared/StandardToolbar";
import { CardGrid, NotionCard } from "../components/shared/NotionCard";
import { trpc, PILOT_WORKSPACE } from "../lib/trpc";
import { StandardColumnMenu } from "../components/shared/StandardColumnMenu";

type PageId = "deals" | "sources" | "theses";
type ViewId = "table" | "card" | "board" | "form";
type ModuleManifest = Awaited<ReturnType<typeof trpc.dealpilot.module.query>>;
type RecordPage = Awaited<ReturnType<typeof trpc.dealpilot.records.query>>;
type RecordRow = RecordPage["items"][number];
type RecordDetail = Awaited<ReturnType<typeof trpc.dealpilot.detail.query>>;
type Capture = Awaited<ReturnType<typeof trpc.dealpilot.captures.query>>[number];

const PAGE_META = {
  deals: { label: "Deals", icon: BriefcaseBusiness, kind: "deal" as const },
  sources: { label: "Sources", icon: Database, kind: "source" as const },
  theses: { label: "Theses", icon: Target, kind: "thesis" as const },
};

const VIEW_ICONS = {
  table: TableIcon,
  card: LayoutGrid,
  board: BriefcaseBusiness,
  form: Plus,
};

function parsePage(value: string | undefined): PageId {
  return value === "sources" || value === "theses" ? value : "deals";
}

function recordName(record: RecordRow): string {
  if (record.kind === "deal") return record.company;
  return record.name;
}

function recordPage(record: RecordRow): PageId {
  if (record.kind === "deal") return "deals";
  if (record.kind === "source") return "sources";
  return "theses";
}

function displayValue(record: RecordRow, field: string): string {
  if (record.kind === "source" && (field === "userId" || field === "password")) {
    return record.credentialRef ? "Locked - re-authenticate in Record Detail" : "Unavailable";
  }
  if (field === "sources" || field === "theses" || field === "deals" || field === "tasks" || field === "relationships") {
    return "-";
  }
  const value: unknown = Object.entries(record).find(([key]) => key === field)?.[1];
  if (Array.isArray(value)) return value.length ? value.join(", ") : "-";
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "string" && value) return value;
  return "-";
}

export function DealPilotPage() {
  const navigate = useNavigate();
  const params = useParams<{ page?: string; recordId?: string }>();
  const pageId = parsePage(params.page);
  const recordId = params.recordId;
  const [manifest, setManifest] = useState<ModuleManifest | null>(null);
  const [records, setRecords] = useState<RecordPage | null>(null);
  const [detail, setDetail] = useState<RecordDetail | null>(null);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [view, setView] = useState<ViewId>("table");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingProposalId, setPendingProposalId] = useState<string | null>(null);
  const [sort, setSort] = useState<{ field: string; direction: "asc" | "desc" } | null>(null);

  useEffect(() => {
    if (!params.page) navigate("/dealpilot/deals", { replace: true });
  }, [navigate, params.page]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const module = await trpc.dealpilot.module.query({ workspaceId: PILOT_WORKSPACE });
      setManifest(module);
      if (recordId) {
        const selected = await trpc.dealpilot.detail.query({
          workspaceId: PILOT_WORKSPACE,
          kind: PAGE_META[pageId].kind,
          id: recordId,
        });
        setDetail(selected);
        setRecords(null);
        if (pageId === "sources") {
          setCaptures(
            (await trpc.dealpilot.captures.query({ workspaceId: PILOT_WORKSPACE })).filter(
              (capture) => capture.sourceId === recordId,
            ),
          );
        } else {
          setCaptures([]);
        }
      } else {
        setRecords(
          await trpc.dealpilot.records.query({
            workspaceId: PILOT_WORKSPACE,
            page: pageId,
            limit: 100,
            offset: 0,
          }),
        );
        setDetail(null);
        setCaptures([]);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, [pageId, recordId]);

  useEffect(() => {
    void load();
  }, [load]);

  const activePage = manifest?.pages.find((page) => page.id === pageId);
  const views: ToolbarView[] = (activePage?.views ?? ["table", "card", "form"]).map((id) => ({
    id,
    label: id[0]!.toUpperCase() + id.slice(1),
    icon: VIEW_ICONS[id],
  }));

  useEffect(() => {
    if (!views.some((candidate) => candidate.id === view)) setView("table");
  }, [pageId, view, views]);

  const visibleRecords = useMemo(() => {
    const query = search.trim().toLowerCase();
    const visible = !records
      ? []
      : !query
        ? records.items
        : records.items.filter((record) => JSON.stringify(record).toLowerCase().includes(query));
    if (!sort) return visible;
    return [...visible].sort((left, right) => {
      const order = displayValue(left, sort.field).localeCompare(displayValue(right, sort.field));
      return sort.direction === "asc" ? order : -order;
    });
  }, [records, search, sort]);

  if (error) {
    return (
      <div className="flex-1 p-8">
        <p className="text-sm text-red-700">{error}</p>
        <button className="mt-4 text-sm underline" onClick={() => void load()}>Retry</button>
      </div>
    );
  }
  if (!manifest || (!recordId && !records) || (recordId && !detail)) {
    return <div className="flex-1 p-8 text-sm text-[var(--color-warm-gray)]">Loading DealPilot...</div>;
  }

  const tabs = (Object.keys(PAGE_META) as PageId[]).map((id) => ({
    id,
    label: PAGE_META[id].label,
    icon: PAGE_META[id].icon,
  }));

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden" style={{ backgroundColor: "var(--color-surface)" }}>
      <Header
        tabs={tabs}
        activeTab={pageId}
        onTabChange={(id) => navigate(`/dealpilot/${id}`)}
      />
      {recordId && detail ? (
        <RecordDetailSurface
          key={detail.record.id}
          detail={detail}
          captures={captures}
          notice={notice}
          onNotice={setNotice}
          onReload={load}
        />
      ) : (
        <>
          <StandardToolbar
            lists={[{ id: "all", label: `All ${PAGE_META[pageId].label}` }]}
            activeListId="all"
            onListSelect={() => {}}
            view={view}
            views={views}
            onViewChange={(id) => setView(id as ViewId)}
            search={search}
            onSearchChange={setSearch}
            onFilterClick={() => setNotice("No filters are configured for this real-data view yet.")}
            customActions={
              <button
                onClick={() => setView("form")}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border bg-white text-sm font-medium"
                style={{ borderColor: "var(--color-border)", color: "var(--color-navy-mid)" }}
              >
                <Plus className="w-3.5 h-3.5" />
                Add {PAGE_META[pageId].label.slice(0, -1)}
              </button>
            }
            moreMenu={
              <Link
                to="/module/deal-pilot"
                className="block px-3 py-2 text-sm hover:bg-black/5"
                style={{ color: "var(--color-navy-mid)" }}
              >
                Control Panel / Module Detail
              </Link>
            }
          />
          {notice && (
            <div className="px-4 py-2 border-b text-sm flex items-center justify-between" style={{ borderColor: "var(--color-border)" }}>
              <span>{notice}</span>
              {pendingProposalId && (
                <button
                  className="font-semibold underline"
                  onClick={async () => {
                    try {
                      await trpc.dealpilot.decideSourceDiscovery.mutate({
                        workspaceId: PILOT_WORKSPACE,
                        proposalId: pendingProposalId,
                        decision: "approve",
                      });
                      setPendingProposalId(null);
                      setNotice("Source discovery approved and authorized Source candidates linked.");
                      await load();
                    } catch (approvalError) {
                      setNotice(approvalError instanceof Error ? approvalError.message : String(approvalError));
                    }
                  }}
                >
                  Approve
                </button>
              )}
            </div>
          )}
          <div className="flex-1 overflow-auto">
            <section className="min-h-[18rem]">
              {view === "form" ? (
                <CreateRecordForm
                  page={pageId}
                  onCreated={async (message, proposalId) => {
                    setNotice(message);
                    setPendingProposalId(proposalId);
                    setView("table");
                    await load();
                  }}
                />
              ) : visibleRecords.length === 0 ? (
                <HonestEmptyState page={pageId} onAdd={() => setView("form")} />
              ) : view === "table" ? (
                <RecordTable
                  rows={visibleRecords}
                  columns={activePage?.columns ?? []}
                  onOpen={(record) => navigate(`/dealpilot/${recordPage(record)}/${record.id}`)}
                  onFilter={() => setNotice("Use the standard toolbar search while field filters are being connected.")}
                  onSort={(field, direction) => setSort({ field, direction })}
                />
              ) : view === "board" ? (
                <DealBoard rows={visibleRecords} onOpen={(record) => navigate(`/dealpilot/deals/${record.id}`)} />
              ) : (
                <CardGrid>
                  {visibleRecords.map((record) => (
                    <button
                      key={record.id}
                      className="text-left"
                      onClick={() => navigate(`/dealpilot/${recordPage(record)}/${record.id}`)}
                    >
                      <NotionCard
                        title={recordName(record)}
                        subtitle={record.kind === "deal" ? record.stage : record.kind === "source" ? record.health : record.focus}
                      />
                    </button>
                  ))}
                </CardGrid>
              )}
            </section>
            <FilesSection />
          </div>
        </>
      )}
    </div>
  );
}

function HonestEmptyState({ page, onAdd }: { page: PageId; onAdd: () => void }) {
  const singular = PAGE_META[page].label.slice(0, -1);
  return (
    <div className="m-4 p-10 text-center border border-dashed rounded-xl" style={{ borderColor: "var(--color-border)" }}>
      <p className="text-sm" style={{ color: "var(--color-warm-gray)" }}>No {page} yet.</p>
      <button className="mt-3 text-sm font-semibold underline" onClick={onAdd}>Add {singular}</button>
    </div>
  );
}

function FilesSection() {
  return (
    <section className="m-4 p-5 rounded-xl border bg-white" style={{ borderColor: "var(--color-border)" }}>
      <div className="flex items-center gap-2 font-semibold" style={{ color: "var(--color-navy)" }}>
        <Files className="w-4 h-4" /> Files
      </div>
      <p className="mt-2 text-sm" style={{ color: "var(--color-warm-gray)" }}>
        Exports and briefs generated by DealPilot will show up here.
      </p>
    </section>
  );
}

function RecordTable({
  rows,
  columns,
  onOpen,
  onFilter,
  onSort,
}: {
  rows: RecordRow[];
  columns: ModuleManifest["pages"][number]["columns"];
  onOpen: (record: RecordRow) => void;
  onFilter: () => void;
  onSort: (field: string, direction: "asc" | "desc") => void;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-xs uppercase tracking-wide" style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}>
          {columns.map((column) => (
            <th key={column.id} className="px-4 py-2 font-semibold">
              <StandardColumnMenu
                label={column.label}
                databaseBacked
                onFilter={onFilter}
                onSort={(direction) => onSort(column.id, direction)}
              />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((record) => (
          <tr
            key={record.id}
            tabIndex={0}
            className="border-b cursor-pointer hover:bg-black/[0.02]"
            style={{ borderColor: "var(--color-border)" }}
            onClick={() => onOpen(record)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpen(record);
              }
            }}
          >
            {columns.map((column) => (
              <td key={column.id} className="px-4 py-3 max-w-[18rem] truncate">
                {displayValue(record, column.id)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DealBoard({ rows, onOpen }: { rows: RecordRow[]; onOpen: (record: RecordRow) => void }) {
  const deals = rows.filter((record) => record.kind === "deal");
  const stages = [...new Set(deals.map((deal) => deal.stage))];
  return (
    <div className="grid gap-4 p-4 md:grid-cols-3">
      {stages.map((stage) => (
        <section key={stage} className="rounded-xl border bg-white p-3" style={{ borderColor: "var(--color-border)" }}>
          <h3 className="text-xs uppercase font-semibold mb-3">{stage}</h3>
          {deals.filter((deal) => deal.stage === stage).map((deal) => (
            <button key={deal.id} className="block w-full text-left p-3 mb-2 rounded-lg border" onClick={() => onOpen(deal)}>
              {deal.company}
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}

function CreateRecordForm({
  page,
  onCreated,
}: {
  page: PageId;
  onCreated: (message: string, proposalId: string | null) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    const data = new FormData(event.currentTarget);
    try {
      if (page === "deals") {
        await trpc.dealpilot.createDeal.mutate({
          workspaceId: PILOT_WORKSPACE,
          company: String(data.get("company") ?? ""),
          ...(data.get("revenue") ? { revenue: Number(data.get("revenue")) } : {}),
          ...(data.get("askingPrice") ? { askingPrice: Number(data.get("askingPrice")) } : {}),
        });
        await onCreated("Deal added.", null);
      } else if (page === "sources") {
        await trpc.dealpilot.createSource.mutate({
          workspaceId: PILOT_WORKSPACE,
          name: String(data.get("name") ?? ""),
          link: String(data.get("link") ?? ""),
          connectionType: String(data.get("connectionType") ?? "url") as "url" | "email_alert" | "api" | "account",
          spendCap: Number(data.get("spendCap") ?? 0),
          rightsAttested: data.get("rightsAttested") === "on",
          ...(data.get("userId") ? { userId: String(data.get("userId")) } : {}),
          ...(data.get("password") ? { password: String(data.get("password")) } : {}),
        });
        await onCreated("Source added. Open it to run governed Deal discovery.", null);
      } else {
        const result = await trpc.dealpilot.createThesis.mutate({
          workspaceId: PILOT_WORKSPACE,
          name: String(data.get("name") ?? ""),
          focus: String(data.get("focus") ?? ""),
          criteria: String(data.get("criteria") ?? "").split("\n").map((value) => value.trim()).filter(Boolean),
          exclusions: String(data.get("exclusions") ?? "").split("\n").map((value) => value.trim()).filter(Boolean),
          ...(data.get("targetCagr") ? { targetCagr: Number(data.get("targetCagr")) } : {}),
        });
        await onCreated(
          result.discovery.status === "pending_review"
            ? `Thesis added. Source discovery found ${((result.discovery.output?.proposedOutput as { relations?: unknown[] } | undefined)?.relations ?? []).length} authorized Source candidate(s) and awaits approval.`
            : `Thesis added. Source discovery status: ${result.discovery.status}.`,
          result.discovery.status === "pending_review" ? result.discovery.id : null,
        );
      }
    } catch (submitError) {
      setFormError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="max-w-2xl m-4 p-6 rounded-xl border bg-white space-y-4" style={{ borderColor: "var(--color-border)" }}>
      <h2 className="font-semibold">Add {PAGE_META[page].label.slice(0, -1)}</h2>
      {page === "deals" && (
        <>
          <Field name="company" label="Company" required />
          <Field name="revenue" label="Revenue" type="number" />
          <Field name="askingPrice" label="Asking price" type="number" />
        </>
      )}
      {page === "sources" && (
        <>
          <Field name="name" label="Source" required />
          <Field name="link" label="Link" type="url" required />
          <label className="block text-sm">Connection type
            <select name="connectionType" className="mt-1 w-full rounded-lg border px-3 py-2">
              <option value="url">URL</option>
              <option value="email_alert">Email alert</option>
              <option value="api">API</option>
              <option value="account">Account</option>
            </select>
          </label>
          <Field name="spendCap" label="Spend cap" type="number" required />
          <Field name="userId" label="User ID (stored only in the credential vault)" />
          <Field name="password" label="Password (stored only in the credential vault)" type="password" />
          <label className="flex gap-2 items-start text-sm">
            <input name="rightsAttested" type="checkbox" className="mt-1" />
            I attest that I have rights to use this Source for the stated purpose and accept its spend cap.
          </label>
        </>
      )}
      {page === "theses" && (
        <>
          <Field name="name" label="Thesis" required />
          <Field name="focus" label="Focus" required />
          <Field name="targetCagr" label="Target CAGR" type="number" />
          <TextArea name="criteria" label="Criteria (one per line)" />
          <TextArea name="exclusions" label="Exclusions (one per line)" />
        </>
      )}
      {formError && <p className="text-sm text-red-700">{formError}</p>}
      <button disabled={busy} className="px-4 py-2 rounded-lg text-white text-sm font-semibold" style={{ backgroundColor: "var(--color-steel)" }}>
        {busy ? "Saving..." : "Add"}
      </button>
    </form>
  );
}

function Field({ name, label, type = "text", required = false }: { name: string; label: string; type?: string; required?: boolean }) {
  return (
    <label className="block text-sm">{label}
      <input name={name} type={type} required={required} className="mt-1 w-full rounded-lg border px-3 py-2" />
    </label>
  );
}

function TextArea({ name, label }: { name: string; label: string }) {
  return (
    <label className="block text-sm">{label}
      <textarea name={name} rows={4} className="mt-1 w-full rounded-lg border px-3 py-2" />
    </label>
  );
}

function RecordDetailSurface({
  detail,
  captures,
  notice,
  onNotice,
  onReload,
}: {
  detail: RecordDetail;
  captures: Capture[];
  notice: string | null;
  onNotice: (message: string | null) => void;
  onReload: () => Promise<void>;
}) {
  const record = detail.record;
  const [reauthToken, setReauthToken] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Partial<Record<"userId" | "password", string>>>({});

  async function reauthenticate() {
    try {
      const session = await trpc.dealpilot.reauthenticateCredential.mutate({
        workspaceId: PILOT_WORKSPACE,
        sourceId: record.id,
      });
      setReauthToken(session.token);
      onNotice(`Re-authenticated until ${new Date(session.expiresAt).toLocaleTimeString()}.`);
    } catch (reauthError) {
      onNotice(reauthError instanceof Error ? reauthError.message : String(reauthError));
    }
  }

  async function access(field: "userId" | "password", action: "reveal" | "copy") {
    if (!reauthToken) {
      onNotice("Re-authenticate before revealing or copying credentials.");
      return;
    }
    try {
      const result = await trpc.dealpilot.accessCredential.mutate({
        workspaceId: PILOT_WORKSPACE,
        sourceId: record.id,
        token: reauthToken,
        field,
        action,
      });
      if (action === "copy") {
        await navigator.clipboard.writeText(result.value);
        onNotice(
          `${field === "userId" ? "User ID" : "Password"} copied. Bridge will request clipboard clearing in 30 seconds where the OS permits it.`,
        );
        window.setTimeout(() => {
          void navigator.clipboard.writeText("").catch(() => {
            onNotice("The OS did not permit automatic clipboard clearing; overwrite the clipboard when finished.");
          });
        }, 30_000);
        return;
      }
      setRevealed((current) => ({ ...current, [field]: result.value }));
      window.setTimeout(() => {
        setRevealed((current) => {
          const next = { ...current };
          delete next[field];
          return next;
        });
      }, 30_000);
    } catch (accessError) {
      onNotice(accessError instanceof Error ? accessError.message : String(accessError));
    }
  }

  const fields = Object.entries(record).filter(
    ([key]) => !["workspaceId", "kind", "credentialRef", "credentialOwnerId"].includes(key),
  );
  return (
    <div className="flex-1 overflow-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link to={`/dealpilot/${recordPage(record)}`} className="text-sm underline">Back to {PAGE_META[recordPage(record)].label}</Link>
          <h1 className="text-2xl font-semibold mt-2">{recordName(record)}</h1>
        </div>
        {record.kind === "source" && (
          <button
            className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-white text-sm"
            onClick={async () => {
              try {
                const result = await trpc.dealpilot.discoverDeals.mutate({
                  workspaceId: PILOT_WORKSPACE,
                  sourceId: record.id,
                });
                onNotice(
                  `Governed Deal discovery ${result.status}; charged ${result.spend.actual.toLocaleString()} of ${result.spend.cap.toLocaleString()} Source spend units.`,
                );
                await onReload();
              } catch (discoveryError) {
                onNotice(discoveryError instanceof Error ? discoveryError.message : String(discoveryError));
              }
            }}
          >
            <RefreshCw className="w-4 h-4" /> Discover Deals
          </button>
        )}
      </div>
      {notice && <div className="p-3 rounded-lg border bg-white text-sm">{notice}</div>}
      <section className="rounded-xl border bg-white p-5" style={{ borderColor: "var(--color-border)" }}>
        <h2 className="font-semibold mb-3">Fields</h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          {fields.map(([key, value]) => (
            <div key={key}>
              <dt className="text-xs uppercase" style={{ color: "var(--color-warm-gray)" }}>{key}</dt>
              <dd className="text-sm break-words">{Array.isArray(value) ? value.join(", ") || "-" : String(value ?? "-")}</dd>
            </div>
          ))}
        </dl>
      </section>
      {record.kind === "source" && (
        <section className="rounded-xl border bg-white p-5" style={{ borderColor: "var(--color-border)" }}>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2"><LockKeyhole className="w-4 h-4" /> Credential controls</h2>
            <button className="text-sm underline" onClick={() => void reauthenticate()}>Re-authenticate</button>
          </div>
          {(["userId", "password"] as const).map((field) => {
            const projection = "credentialProjection" in detail ? detail.credentialProjection[field] : { state: "unavailable" as const };
            return (
              <div key={field} className="mt-4 flex flex-wrap items-center gap-3">
                <span className="w-24 text-sm font-medium">{field === "userId" ? "User ID" : "Password"}</span>
                <code className="text-sm">{revealed[field] ?? projection.masked ?? "Unavailable"}</code>
                {projection.state === "available" && (
                  <>
                    <button className="text-sm underline flex items-center gap-1" onClick={() => void access(field, "reveal")}>
                      <Eye className="w-3.5 h-3.5" /> Reveal
                    </button>
                    <button className="text-sm underline" onClick={() => void access(field, "copy")}>Copy</button>
                  </>
                )}
              </div>
            );
          })}
        </section>
      )}
      <section className="rounded-xl border bg-white p-5" style={{ borderColor: "var(--color-border)" }}>
        <h2 className="font-semibold mb-3">Related Records</h2>
        {detail.relatedRecords.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-warm-gray)" }}>No related Records yet.</p>
        ) : (
          <div className="space-y-2">
            {detail.relatedRecords.map((related) => (
              <Link key={related.id} className="block text-sm underline" to={`/dealpilot/${recordPage(related)}/${related.id}`}>
                {recordName(related)}
              </Link>
            ))}
          </div>
        )}
      </section>
      {record.kind === "source" && captures.length > 0 && (
        <section className="rounded-xl border bg-white p-5" style={{ borderColor: "var(--color-border)" }}>
          <h2 className="font-semibold mb-3">Quarantined Deal candidates</h2>
          {captures.map((capture) => (
            <div key={capture.captureId} className="flex items-center justify-between gap-4 py-2 border-b">
              <span className="text-sm">{String(capture.payload.name ?? capture.captureId)}</span>
              <button
                className="text-sm font-semibold underline"
                onClick={async () => {
                  try {
                    await trpc.dealpilot.commit.mutate({
                      workspaceId: PILOT_WORKSPACE,
                      captureId: capture.captureId,
                    });
                    onNotice("Candidate committed as a Deal with Source and Thesis provenance.");
                    await onReload();
                  } catch (commitError) {
                    onNotice(commitError instanceof Error ? commitError.message : String(commitError));
                  }
                }}
              >
                Add Deal
              </button>
            </div>
          ))}
        </section>
      )}
      <section className="rounded-xl border bg-white p-5" style={{ borderColor: "var(--color-border)" }}>
        <h2 className="font-semibold mb-3">Sections</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {detail.sections.map((section) => (
            <div key={section} className="rounded-lg border p-3 text-sm">
              <strong>{section}</strong>
              <p className="mt-1" style={{ color: "var(--color-warm-gray)" }}>No connected data in this Section yet.</p>
            </div>
          ))}
        </div>
      </section>
      <FilesSection />
    </div>
  );
}
