import { useCallback, useEffect, useMemo, useState } from "react";
import { Sparkles, Network } from "lucide-react";
import { useNavigate } from "react-router";
import type { TableSpec, ViewConfig, ViewKind } from "@bridge/tables";
import { Header } from "../components/shared/Header";
import { DataViews } from "../dataviews/DataViews";
import { viewConfigForKind } from "../dataviews/eligibility";
import type { DataRow, GraphEdge, GraphNode } from "../dataviews/types";
import { PILOT_ORGANIZATION, trpc } from "../lib/trpc";

const FULL_GRAPH_VIEWS: ViewKind[] = ["table", "graph"];

const FULL_GRAPH_SPEC: TableSpec = {
  id: "second-brain",
  columns: [
    { id: "label", label: "Record", kind: "text", editable: false },
    { id: "databaseLabel", label: "Database", kind: "text", editable: false },
    { id: "moduleId", label: "Source Module", kind: "text", editable: false },
    { id: "provenance", label: "Provenance", kind: "text", editable: false },
    {
      id: "relatedRecord",
      label: "Related Records",
      kind: "relation",
      relationTarget: "permitted-records",
      editable: false,
      hiddenInForm: true,
    },
  ],
};

type FullGraph = Awaited<ReturnType<typeof trpc.graph.full.query>>;

type ClaimSuggestionsResult = Awaited<ReturnType<typeof trpc.learning.claims.suggestions.query>>;
type ClaimsResult = Awaited<ReturnType<typeof trpc.learning.claims.claims.query>>;
type ClaimEntitiesResult = Awaited<ReturnType<typeof trpc.learning.claims.entities.query>>;
type ClaimHistoryResult = Awaited<ReturnType<typeof trpc.learning.claims.claimHistory.query>>;

const CLAIM_ENTITY_KINDS = ["person", "community", "task", "topic"] as const;

/**
 * K3 (TASK-047) — the human half of "one substrate, two projections": pending
 * claim suggestions (accept/reject), live claims with supersedence history
 * and the forget path, and a propose form. Exactly the rows the fusion graph
 * lane retrieves — this panel is what makes the knowledge inspectable and
 * deletable, so it renders honest empty states and hides entirely (via the
 * parent) when the flight is off.
 */
function ClaimsPanel({ onClaimsChanged }: { onClaimsChanged: () => void }) {
  const [suggestions, setSuggestions] = useState<ClaimSuggestionsResult["suggestions"]>([]);
  const [claims, setClaims] = useState<ClaimsResult["claims"]>([]);
  const [entities, setEntities] = useState<ClaimEntitiesResult["entities"]>([]);
  const [history, setHistory] = useState<{ key: string; rows: ClaimHistoryResult["history"] } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({ kind: "person" as (typeof CLAIM_ENTITY_KINDS)[number], name: "", field: "", value: "" });

  const refresh = useCallback(() => {
    void Promise.all([
      trpc.learning.claims.suggestions.query({ organizationId: PILOT_ORGANIZATION, status: "proposed" }),
      trpc.learning.claims.claims.query({ organizationId: PILOT_ORGANIZATION }),
      trpc.learning.claims.entities.query({ organizationId: PILOT_ORGANIZATION }),
    ]).then(([nextSuggestions, nextClaims, nextEntities]) => {
      setSuggestions(nextSuggestions.suggestions);
      setClaims(nextClaims.claims);
      setEntities(nextEntities.entities);
    }).catch((cause) => setMessage(String(cause)));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const entityNames = useMemo(
    () => new Map(entities.map((entity) => [entity.id, entity.name])),
    [entities],
  );

  async function run(action: () => Promise<unknown>, doneMessage: string) {
    setMessage(null);
    try {
      await action();
      setMessage(doneMessage);
      refresh();
      onClaimsChanged();
    } catch (cause) {
      setMessage(String(cause));
    }
  }

  return (
    <div className="border-b px-4 py-3 text-sm" data-testid="claims-panel">
      <div className="mb-2 flex items-center gap-2 font-medium">
        <Sparkles className="h-4 w-4" aria-hidden />
        Claims
        <span className="text-xs font-normal" style={{ color: "var(--color-navy-mid)" }}>
          Governed claims — suggested, then accepted by you; inspectable, correctable, deletable.
        </span>
      </div>
      {message && (
        <p role="status" className="mb-2 text-xs" style={{ color: "var(--color-navy-mid)" }}>{message}</p>
      )}

      {suggestions.length > 0 && (
        <div className="mb-3">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide">Pending suggestions</p>
          <ul className="space-y-1">
            {suggestions.map((suggestion) => (
              <li key={suggestion.memoryId} className="flex items-center gap-2 text-xs">
                <span className="flex-1">{suggestion.suggestedText}</span>
                <button
                  type="button"
                  className="rounded border px-2 py-0.5"
                  onClick={() => run(
                    () => trpc.learning.claims.acceptClaim.mutate({
                      organizationId: PILOT_ORGANIZATION,
                      suggestionMemoryId: suggestion.memoryId,
                    }),
                    "Claim accepted and materialized through the governed pipeline.",
                  )}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="rounded border px-2 py-0.5"
                  onClick={() => run(
                    () => trpc.learning.claims.rejectClaim.mutate({
                      organizationId: PILOT_ORGANIZATION,
                      suggestionMemoryId: suggestion.memoryId,
                    }),
                    "Claim rejected — this exact claim will never be re-proposed.",
                  )}
                >
                  Reject
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {claims.length === 0 && suggestions.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--color-navy-mid)" }}>
          Nothing here yet. Bridge only stores claims you explicitly accept.
        </p>
      ) : (
        claims.length > 0 && (
          <ul className="mb-3 space-y-1">
            {claims.map((claim) => {
              const historyKey = `${claim.entityId}:${claim.field}`;
              return (
                <li key={claim.id} className="text-xs">
                  <div className="flex items-center gap-2">
                    <span className="flex-1">
                      <span className="font-medium">{entityNames.get(claim.entityId) ?? "Unknown entity"}</span>
                      {" — "}{claim.field}: {claim.value}
                      <span style={{ color: "var(--color-navy-mid)" }}>
                        {" "}· {claim.claimClass} · {claim.sensitivity} · {claim.evidence.length} evidence
                        {" "}· accepted {claim.recordedAt.slice(0, 10)}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="rounded border px-2 py-0.5"
                      onClick={() =>
                        history?.key === historyKey
                          ? setHistory(null)
                          : void trpc.learning.claims.claimHistory
                              .query({ organizationId: PILOT_ORGANIZATION, entityId: claim.entityId, field: claim.field })
                              .then((result) => setHistory({ key: historyKey, rows: result.history }))
                              .catch((cause) => setMessage(String(cause)))
                      }
                    >
                      History
                    </button>
                    <button
                      type="button"
                      className="rounded border px-2 py-0.5"
                      onClick={() => run(
                        () => trpc.learning.claims.forgetClaim.mutate({
                          organizationId: PILOT_ORGANIZATION,
                          claimId: claim.id,
                        }),
                        "Claim forgotten — deleted from the substrate.",
                      )}
                    >
                      Forget
                    </button>
                  </div>
                  {history?.key === historyKey && (
                    <ul className="mt-1 border-l pl-3" style={{ color: "var(--color-navy-mid)" }}>
                      {history.rows.map((row) => (
                        <li key={row.id}>
                          {row.value} — recorded {row.recordedAt.slice(0, 10)}
                          {row.invalidatedAt
                            ? ` · superseded ${row.invalidatedAt.slice(0, 10)} (kept, never deleted)`
                            : " · current"}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )
      )}

      <form
        className="flex flex-wrap items-center gap-2 text-xs"
        onSubmit={(event) => {
          event.preventDefault();
          if (!form.name.trim() || !form.field.trim() || !form.value.trim()) return;
          void run(
            () => trpc.learning.claims.proposeClaim.mutate({
              organizationId: PILOT_ORGANIZATION,
              entity: { kind: form.kind, name: form.name.trim() },
              field: form.field.trim(),
              value: form.value.trim(),
              claimClass: "stated_fact",
            }),
            "Proposed — accept it above to store it as a claim.",
          ).then(() => setForm((current) => ({ ...current, field: "", value: "" })));
        }}
      >
        <span className="font-medium">Tell Bridge a fact:</span>
        <select
          aria-label="Entity kind"
          className="rounded border px-1 py-0.5"
          value={form.kind}
          onChange={(event) => setForm({ ...form, kind: event.target.value as typeof form.kind })}
        >
          {CLAIM_ENTITY_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
        </select>
        <input
          aria-label="Entity name"
          className="rounded border px-2 py-0.5"
          placeholder="Who or what (e.g. Priya Sharma)"
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
        />
        <input
          aria-label="Field"
          className="rounded border px-2 py-0.5"
          placeholder="Attribute (e.g. timezone)"
          value={form.field}
          onChange={(event) => setForm({ ...form, field: event.target.value })}
        />
        <input
          aria-label="Value"
          className="rounded border px-2 py-0.5"
          placeholder="Value (e.g. CET)"
          value={form.value}
          onChange={(event) => setForm({ ...form, value: event.target.value })}
        />
        <button type="submit" className="rounded border px-2 py-0.5">Propose</button>
      </form>
    </div>
  );
}

/**
 * `embedded` drops this surface's own toggle strip so it can be mounted as a
 * tab of another surface. Intelligence mounts it as its FIRST tab (user
 * directive 2026-08-10) — one graph renderer, two entry points, never a second
 * copy of the view.
 */
export function SecondBrainPage({ embedded = false }: { embedded?: boolean } = {}) {
  const navigate = useNavigate();
  const [limit, setLimit] = useState(100);
  const [graph, setGraph] = useState<FullGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [claimsEnabled, setClaimsEnabled] = useState(false);
  const [graphRefresh, setGraphRefresh] = useState(0);
  const [view, setView] = useState<ViewConfig>(
    viewConfigForKind(FULL_GRAPH_SPEC, "graph", {
      id: "second-brain:full",
      graphScope: "full",
      graphDatabaseIds: ["people"],
    }),
  );

  useEffect(() => {
    let active = true;
    setError(null);
    void trpc.graph.full.query({
      organizationId: PILOT_ORGANIZATION,
      limit,
    }).then((next) => {
      if (active) setGraph(next);
    }).catch((cause) => {
      if (active) setError(String(cause));
    });
    return () => {
      active = false;
    };
  }, [limit, graphRefresh]);

  // K3 flight discovery — hidden entirely when the substrate is off, the
  // same honest-hiding pattern as Settings' learning cards.
  useEffect(() => {
    let active = true;
    void trpc.learning.claims.status.query({ organizationId: PILOT_ORGANIZATION })
      .then((status) => { if (active) setClaimsEnabled(status.enabled); })
      .catch(() => { if (active) setClaimsEnabled(false); });
    return () => { active = false; };
  }, []);

  const rows = useMemo<DataRow[]>(() => {
    if (!graph) return [];
    const edgesByNode = new Map<string, string[]>();
    for (const edge of graph.edges) {
      edgesByNode.set(edge.sourceId, [...(edgesByNode.get(edge.sourceId) ?? []), edge.targetId]);
      edgesByNode.set(edge.targetId, [...(edgesByNode.get(edge.targetId) ?? []), edge.sourceId]);
    }
    return graph.nodes.map((node) => ({
      ...node,
      relatedRecord: edgesByNode.get(node.id) ?? [],
    }));
  }, [graph]);

  function openRecord(row: DataRow | GraphNode) {
    const recordPath = "recordPath" in row ? row.recordPath : row["recordPath"];
    if (typeof recordPath === "string" && recordPath) navigate(recordPath);
  }

  function openRelation(edge: GraphEdge) {
    if (edge.recordPath) navigate(edge.recordPath);
  }

  async function invokeSignalAction(node: GraphNode) {
    const signalId = node.recordId ?? (node.id.startsWith("signal:") ? node.id.slice("signal:".length) : null);
    if (!signalId) {
      setActionStatus("This node has no attributable Signal Action.");
      return;
    }
    setActionStatus("Submitting governed Signal Action…");
    try {
      const proposal = await trpc.relationship.proposeSignalAction.mutate({
        organizationId: PILOT_ORGANIZATION,
        signalId,
      });
      setActionStatus(`Governed Signal Action ${proposal.status.replace(/_/g, " ")}.`);
    } catch (cause) {
      setActionStatus(`Signal Action failed: ${String(cause)}`);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-white">
      {!embedded && (
        <Header
          tabs={[{ id: "Second Brain", icon: Network }]}
          activeTab="Second Brain"
          onTabChange={() => {}}
        />
      )}
      {actionStatus && (
        <div role="status" className="border-b px-4 py-2 text-xs" style={{ color: "var(--color-navy-mid)" }}>
          {actionStatus}
        </div>
      )}
      {claimsEnabled && (
        <ClaimsPanel onClaimsChanged={() => setGraphRefresh((tick) => tick + 1)} />
      )}
      {/* One surface, one view, nothing below the fold: the view region takes
          the whole remaining height so the table/graph covers the screen, and
          each renderer scrolls its own body. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
        {error ? (
          <p role="alert" className="rounded-md border border-red-200 p-4 text-sm text-red-600">
            Full graph could not load: {error}
          </p>
        ) : (
          <DataViews
            spec={FULL_GRAPH_SPEC}
            view={view}
            data={rows}
            availableKinds={FULL_GRAPH_VIEWS}
            insertDisabledReason="Second Brain is a cross-Module view of Records that already exist — create a Record on its owning Module's Page."
            onViewChange={setView}
            graphData={graph ?? undefined}
            graphLoading={graph === null}
            graphError={null}
            onOpenRecord={openRecord}
            onOpenRelation={openRelation}
            onInvokeNodeAction={invokeSignalAction}
            onLoadMoreGraph={graph?.hasMore && limit < 200
              ? () => setLimit((current) => Math.min(200, current + 100))
              : undefined}
          />
        )}
      </div>
    </div>
  );
}
