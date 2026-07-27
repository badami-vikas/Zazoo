import { useEffect, useMemo, useState } from "react";
import { Network } from "lucide-react";
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

export function SecondBrainPage() {
  const navigate = useNavigate();
  const [limit, setLimit] = useState(100);
  const [graph, setGraph] = useState<FullGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
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
  }, [limit]);

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
      <Header
        tabs={[{ id: "Second Brain", icon: Network }]}
        activeTab="Second Brain"
        onTabChange={() => {}}
      />
      {actionStatus && (
        <div role="status" className="border-b px-4 py-2 text-xs" style={{ color: "var(--color-navy-mid)" }}>
          {actionStatus}
        </div>
      )}
      <div className="flex-1 overflow-auto p-4">
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
