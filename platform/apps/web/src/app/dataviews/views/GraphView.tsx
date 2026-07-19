import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ExternalLink, Filter, Loader2, Minus, Plus, RotateCcw, ShieldCheck, Sparkles } from "lucide-react";
import { applyFilters, applySorts, type GraphScope } from "@bridge/tables";
import { Button } from "../../components/ui/button.js";
import type { DataRow, DataViewProps, GraphData, GraphEdge, GraphNode } from "../types.js";

interface PositionedNode extends GraphNode {
  x: number;
  y: number;
  color: string;
}

interface RelationValue {
  id: string;
  label: string;
  type: string;
}

const WIDTH = 1100;
const HEIGHT = 640;
const MAX_RENDERED_NODES = 500;

function relationValues(value: unknown, defaultType: string): RelationValue[] {
  const values = Array.isArray(value) ? value : value == null || value === "" ? [] : [value];
  return values.flatMap((item) => {
    if (typeof item === "string" || typeof item === "number") {
      const text = String(item);
      return [{ id: text, label: text, type: defaultType }];
    }
    if (!item || typeof item !== "object") return [];
    const relation = item as Record<string, unknown>;
    const rawId = relation.targetId ?? relation.id;
    if (typeof rawId !== "string" && typeof rawId !== "number") return [];
    return [{
      id: String(rawId),
      label:
        typeof relation.label === "string"
          ? relation.label
          : typeof relation.name === "string"
            ? relation.name
            : String(rawId),
      type: typeof relation.type === "string" ? relation.type : defaultType,
    }];
  });
}

function moduleIdFor(databaseId: string): string {
  const separator = databaseId.indexOf(".");
  return separator > 0 ? databaseId.slice(0, separator) : databaseId;
}

function deriveGraphData({ spec, view, data }: Pick<DataViewProps, "spec" | "view" | "data">): GraphData {
  const relationColumn =
    spec.columns.find((column) => column.id === view.relationBy && column.kind === "relation") ??
    spec.columns.find(
      (column) =>
        column.kind === "relation" &&
        column.relationParent !== true &&
        column.relationTarget !== spec.id,
    );
  const titleColumn =
    spec.columns.find((column) => column.kind === "text") ??
    spec.columns.find((column) => column.id !== relationColumn?.id);
  const rows = applySorts(applyFilters(data, view.rowFilters, view.filterMatch), view.sorts);
  const rowNodes = new Map<string, GraphNode>();
  rows.forEach((row, index) => {
    const id = String(row["id"] ?? index);
    rowNodes.set(id, {
      id,
      label: String(row[titleColumn?.id ?? "id"] ?? id),
      databaseId: spec.id,
      databaseLabel: spec.id,
      moduleId: moduleIdFor(spec.id),
      recordType: spec.id,
    });
  });

  const externalNodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  if (relationColumn) {
    rows.forEach((row, index) => {
      const sourceId = String(row["id"] ?? index);
      for (const [relationIndex, relation] of relationValues(row[relationColumn.id], relationColumn.label).entries()) {
        const targetId = rowNodes.has(relation.id)
          ? relation.id
          : `${relationColumn.relationTarget ?? "related"}:${relation.id}`;
        if (!rowNodes.has(relation.id) && !externalNodes.has(targetId)) {
          const databaseId = relationColumn.relationTarget ?? "related";
          externalNodes.set(targetId, {
            id: targetId,
            label: relation.label,
            databaseId,
            databaseLabel: databaseId,
            moduleId: moduleIdFor(databaseId),
            recordType: databaseId,
          });
        }
        edges.push({
          id: `${sourceId}:${targetId}:${relationIndex}`,
          sourceId,
          targetId,
          label: relation.type,
          relationType: relation.type,
        });
      }
    });
  }

  const nodes = [...rowNodes.values(), ...externalNodes.values()];
  const databases = [...new Map(nodes.map((node) => [node.databaseId, {
    id: node.databaseId,
    label: node.databaseLabel,
    moduleId: node.moduleId,
  }])).values()];
  return { nodes, edges, databases };
}

function databaseColor(databaseId: string): string {
  let hash = 0;
  for (const char of databaseId) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 52% 48%)`;
}

function positionNodes(nodes: GraphNode[]): PositionedNode[] {
  const byDatabase = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    byDatabase.set(node.databaseId, [...(byDatabase.get(node.databaseId) ?? []), node]);
  }
  const groups = [...byDatabase.entries()];
  const outerRadius = groups.length === 1 ? 0 : Math.min(WIDTH, HEIGHT) * 0.3;
  const centerX = WIDTH / 2;
  const centerY = HEIGHT / 2;
  const positioned: PositionedNode[] = [];

  groups.forEach(([databaseId, groupNodes], groupIndex) => {
    const groupAngle = (groupIndex / Math.max(1, groups.length)) * Math.PI * 2 - Math.PI / 2;
    const groupX = centerX + Math.cos(groupAngle) * outerRadius;
    const groupY = centerY + Math.sin(groupAngle) * outerRadius;
    const radius = Math.min(150, Math.max(45, groupNodes.length * 7));
    groupNodes.forEach((node, nodeIndex) => {
      const angle = (nodeIndex / Math.max(1, groupNodes.length)) * Math.PI * 2 - Math.PI / 2;
      positioned.push({
        ...node,
        x: groupX + (groupNodes.length === 1 ? 0 : Math.cos(angle) * radius),
        y: groupY + (groupNodes.length === 1 ? 0 : Math.sin(angle) * radius),
        color: databaseColor(databaseId),
      });
    });
  });
  return positioned;
}

export function GraphView({
  spec,
  view,
  data,
  onViewChange,
  onOpenRecord,
  onOpenRelation,
  graphData,
  graphLoading,
  graphError,
  onGraphScopeChange,
  onLoadMoreGraph,
  onInvokeNodeAction,
}: DataViewProps) {
  const [relationType, setRelationType] = useState<string>("all");
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number } | null>(null);
  const scope = view.graphScope ?? "single_database";
  const allData = useMemo(
    () => graphData ?? deriveGraphData({ spec, view, data }),
    [data, graphData, spec, view],
  );
  const resolvedData = useMemo(() => {
    if (scope === "full") return allData;
    const includedDatabases = new Set(
      scope === "single_database"
        ? [view.graphDatabaseIds?.[0] ?? spec.id]
        : view.graphDatabaseIds ?? [],
    );
    const nodes = allData.nodes.filter((node) => includedDatabases.has(node.databaseId));
    const nodeIds = new Set(nodes.map((node) => node.id));
    return {
      ...allData,
      nodes,
      edges: allData.edges.filter(
        (edge) => nodeIds.has(edge.sourceId) && nodeIds.has(edge.targetId),
      ),
    };
  }, [allData, scope, spec.id, view.graphDatabaseIds]);
  const relationTypes = useMemo(
    () => [...new Set(resolvedData.edges.map((edge) => edge.relationType))].sort(),
    [resolvedData.edges],
  );
  useEffect(() => {
    if (relationType !== "all" && !relationTypes.includes(relationType)) {
      setRelationType("all");
    }
  }, [relationType, relationTypes]);
  const filteredEdges = useMemo(
    () =>
      relationType === "all"
        ? resolvedData.edges
        : resolvedData.edges.filter((edge) => edge.relationType === relationType),
    [relationType, resolvedData.edges],
  );
  const connectedNodeIds = useMemo(
    () => new Set(filteredEdges.flatMap((edge) => [edge.sourceId, edge.targetId])),
    [filteredEdges],
  );
  const renderNodes = resolvedData.nodes
    .filter((node) => relationType === "all" || connectedNodeIds.has(node.id))
    .slice(0, MAX_RENDERED_NODES);
  const positioned = useMemo(() => positionNodes(renderNodes), [renderNodes]);
  const nodeById = useMemo(() => new Map(positioned.map((node) => [node.id, node])), [positioned]);
  const renderEdges = filteredEdges.filter(
    (edge) => nodeById.has(edge.sourceId) && nodeById.has(edge.targetId),
  );

  function changeScope(nextScope: GraphScope) {
    const currentDatabaseIds = view.graphDatabaseIds ?? [];
    const databaseIds = nextScope === "single_database"
      ? [currentDatabaseIds[0] ?? spec.id]
      : currentDatabaseIds;
    const next = { ...view, graphScope: nextScope, graphDatabaseIds: databaseIds };
    onViewChange(next);
    onGraphScopeChange?.(nextScope, databaseIds);
  }

  function toggleDatabase(databaseId: string) {
    const current = view.graphDatabaseIds ?? [];
    const nextIds = current.includes(databaseId)
      ? current.filter((id) => id !== databaseId)
      : [...current, databaseId];
    onViewChange({ ...view, graphScope: "multi_database", graphDatabaseIds: nextIds });
    onGraphScopeChange?.("multi_database", nextIds);
  }

  function startPan(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  }

  function movePan(event: ReactPointerEvent<SVGSVGElement>) {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    setPan({
      x: drag.current.panX + event.clientX - drag.current.x,
      y: drag.current.panY + event.clientY - drag.current.y,
    });
  }

  if (graphError) {
    return (
      <div className="rounded-md border border-destructive/40 p-6 text-center text-sm text-destructive">
        Graph could not load: {graphError}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border">
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 p-2">
        <div className="flex max-w-full flex-wrap rounded-md border bg-background p-0.5" aria-label="Graph scope">
          {([
            ["single_database", "This Database"],
            ["multi_database", "Selected Databases"],
            ["full", "Full · Second Brain"],
          ] as const).map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={scope === value ? "secondary" : "ghost"}
              className="h-7"
              onClick={() => changeScope(value)}
            >
              {label}
            </Button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <Filter className="size-3.5" />
          Relation
          <select
            className="h-7 rounded border bg-background px-2 text-foreground"
            value={relationType}
            onChange={(event) => setRelationType(event.target.value)}
          >
            <option value="all">All types</option>
            {relationTypes.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
      </div>

      {scope === "multi_database" && (
        <div className="flex flex-wrap gap-3 border-b px-3 py-2 text-xs">
          {allData.databases.map((database) => (
            <label key={database.id} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={(view.graphDatabaseIds ?? []).includes(database.id)}
                onChange={() => toggleDatabase(database.id)}
              />
              {database.label}
            </label>
          ))}
          {allData.databases.length === 0 && (
            <span className="text-muted-foreground">No additional permitted Databases are available.</span>
          )}
        </div>
      )}

      <div className="relative min-h-80 bg-slate-50">
        {graphLoading && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-background/70 text-sm text-muted-foreground">
            <span className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" />Loading permitted graph data…</span>
          </div>
        )}
        {!graphLoading && resolvedData.nodes.length === 0 ? (
          <div className="grid min-h-80 place-items-center p-6 text-center text-sm text-muted-foreground">
            No related records are available in this scope.
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="h-[min(62vh,640px)] min-h-80 w-full touch-none cursor-grab active:cursor-grabbing"
            onPointerDown={startPan}
            onPointerMove={movePan}
            onPointerUp={() => { drag.current = null; }}
            onPointerCancel={() => { drag.current = null; }}
            onWheel={(event) => {
              event.preventDefault();
              setScale((current) => Math.min(2.5, Math.max(0.4, current * (event.deltaY > 0 ? 0.9 : 1.1))));
            }}
            aria-label={`${scope} relationship graph`}
          >
            <defs>
              <marker id="graph-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="#94a3b8" />
              </marker>
            </defs>
            <g transform={`translate(${pan.x} ${pan.y}) scale(${scale})`}>
              {renderEdges.map((edge) => {
                const source = nodeById.get(edge.sourceId);
                const target = nodeById.get(edge.targetId);
                if (!source || !target) return null;
                const midX = (source.x + target.x) / 2;
                const midY = (source.y + target.y) / 2;
                return (
                  <g
                    key={edge.id}
                    role="button"
                    tabIndex={0}
                    className="cursor-pointer"
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedEdge(edge);
                      setSelectedNode(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") setSelectedEdge(edge);
                    }}
                  >
                    <line
                      x1={source.x}
                      y1={source.y}
                      x2={target.x}
                      y2={target.y}
                      stroke={selectedEdge?.id === edge.id ? "#1d4ed8" : "#94a3b8"}
                      strokeWidth={selectedEdge?.id === edge.id ? 3 : 1.5}
                      markerEnd="url(#graph-arrow)"
                    />
                    <rect x={midX - 44} y={midY - 10} width={88} height={20} rx={8} fill="#f8fafc" opacity={0.92} />
                    <text x={midX} y={midY + 4} textAnchor="middle" fontSize={11} fill="#475569">
                      {edge.label.slice(0, 24)}
                    </text>
                  </g>
                );
              })}
              {positioned.map((node) => (
                <g
                  key={node.id}
                  role="button"
                  tabIndex={0}
                  className="cursor-pointer outline-none"
                  transform={`translate(${node.x} ${node.y})`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedNode(node);
                    setSelectedEdge(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") setSelectedNode(node);
                  }}
                >
                  <circle
                    r={selectedNode?.id === node.id ? 24 : 20}
                    fill={node.color}
                    stroke={selectedNode?.id === node.id ? "#0f172a" : "white"}
                    strokeWidth={3}
                  />
                  <text y={35} textAnchor="middle" fontSize={12} fontWeight={600} fill="#0f172a">
                    {node.label.length > 24 ? `${node.label.slice(0, 22)}…` : node.label}
                  </text>
                </g>
              ))}
            </g>
          </svg>
        )}
        <div className="absolute bottom-3 right-3 flex gap-1 rounded-md border bg-background p-1 shadow-sm">
          <Button size="sm" variant="ghost" aria-label="Zoom out" onClick={() => setScale((value) => Math.max(0.4, value - 0.15))}>
            <Minus className="size-4" />
          </Button>
          <Button size="sm" variant="ghost" aria-label="Reset graph position" onClick={() => { setScale(1); setPan({ x: 0, y: 0 }); }}>
            <RotateCcw className="size-4" />
          </Button>
          <Button size="sm" variant="ghost" aria-label="Zoom in" onClick={() => setScale((value) => Math.min(2.5, value + 0.15))}>
            <Plus className="size-4" />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5" />
        {relationType === "all"
          ? `${resolvedData.nodes.length} permitted nodes · ${resolvedData.edges.length} typed Relations`
          : `${connectedNodeIds.size} matching nodes · ${filteredEdges.length} matching ${filteredEdges.length === 1 ? "Relation" : "Relations"}`}
        {resolvedData.nodes.length > MAX_RENDERED_NODES && <> · rendering first {MAX_RENDERED_NODES}</>}
        {resolvedData.hasMore && (
          onLoadMoreGraph ? (
            <Button size="sm" variant="outline" className="ml-auto h-7" onClick={onLoadMoreGraph}>
              Load more
            </Button>
          ) : <span className="ml-auto">More permitted graph data exists.</span>
        )}
      </div>

      {selectedNode && (
        <div className="flex flex-wrap items-center gap-3 border-t bg-background px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{selectedNode.label}</div>
            <div className="text-xs text-muted-foreground">
              {selectedNode.databaseLabel}{selectedNode.subtitle ? ` · ${selectedNode.subtitle}` : ""}
            </div>
            {selectedNode.provenance && (
              <div className="text-xs text-muted-foreground">{selectedNode.provenance}</div>
            )}
          </div>
          {selectedNode.actionKind === "signal" && onInvokeNodeAction && (
            <Button size="sm" variant="secondary" onClick={() => onInvokeNodeAction(selectedNode)}>
              <Sparkles className="size-3.5" /> Governed Action
            </Button>
          )}
          {onOpenRecord && (selectedNode.recordPath || !graphData) && (
            <Button size="sm" variant="outline" onClick={() => onOpenRecord(selectedNode)}>
              Open Record <ExternalLink className="size-3.5" />
            </Button>
          )}
        </div>
      )}
      {selectedEdge && (
        <div className="flex flex-wrap items-center gap-3 border-t bg-background px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{selectedEdge.label}</div>
            <div className="text-xs text-muted-foreground">
              {selectedEdge.evidence ?? "Relation evidence is available from the owning Record."}
            </div>
            {selectedEdge.sourceModule && (
              <div className="text-xs text-muted-foreground">Source Module: {selectedEdge.sourceModule}</div>
            )}
          </div>
          {onOpenRelation && (
            <Button size="sm" variant="outline" onClick={() => onOpenRelation(selectedEdge)}>
              Open Relation <ExternalLink className="size-3.5" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
