import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { defaultViewConfig, type TableSpec, type ViewConfig } from "@bridge/tables";
import { buildAssociations } from "../data/associations";
import { DataViews } from "../dataviews/DataViews";
import type { DataRow, GraphData, GraphNode } from "../dataviews/types";

const ASSOCIATION_SPEC: TableSpec = {
  id: "associations",
  columns: [
    { id: "label", label: "Record", kind: "text", editable: false, hiddenInForm: true },
    {
      id: "kind",
      label: "Record type",
      kind: "select",
      editable: false,
      hiddenInForm: true,
      options: ["center", "person", "community", "record"],
    },
    { id: "degree", label: "Degree", kind: "select", editable: false, hiddenInForm: true },
    {
      id: "relationship",
      label: "Relation",
      kind: "relation",
      relationTarget: "association-records",
      editable: false,
      hiddenInForm: true,
    },
  ],
};

interface AssociationRow extends DataRow {
  id: string;
  label: string;
  kind: "center" | "person" | "community" | "record";
  degree: string;
  relationship: string | null;
  recordPath?: string;
}

export function AssociationsMap({
  center,
  isCommunity = false,
}: {
  center: string;
  isCommunity?: boolean;
}) {
  const navigate = useNavigate();
  const result = useMemo(() => buildAssociations(center, isCommunity), [center, isCommunity]);
  const [view, setView] = useState<ViewConfig>(
    () => ({ ...defaultViewConfig("associations:graph", "graph"), graphScope: "single_database" }),
  );

  const rows = useMemo<AssociationRow[]>(() => {
    const centerRow: AssociationRow = {
      id: "center",
      label: result.centerLabel,
      kind: "center",
      degree: "Center",
      relationship: null,
    };
    const people = [
      ...result.degrees.one.map((person) => ({ person, degree: "1st" })),
      ...result.degrees.two.map((person) => ({ person, degree: "2nd" })),
      ...result.degrees.three.map((person) => ({ person, degree: "3rd+" })),
    ].map(({ person, degree }): AssociationRow => ({
      id: person.id,
      label: person.name,
      kind: "person",
      degree,
      relationship: "center",
      recordPath: `/item/${encodeURIComponent(person.name)}`,
    }));
    const communities = [...new Set([
      ...result.communities.home,
      ...result.communities.related,
    ])].map((community): AssociationRow => ({
      id: `community:${community}`,
      label: community,
      kind: "community",
      degree: result.communities.home.includes(community) ? "1st" : "2nd",
      relationship: "center",
      recordPath: `/item/${encodeURIComponent(community)}`,
    }));
    const records = result.records.map((record): AssociationRow => ({
      id: record.id,
      label: record.name,
      kind: "record",
      degree: "Overlay",
      relationship: "center",
    }));
    return [centerRow, ...people, ...communities, ...records];
  }, [result]);

  const graphData = useMemo<GraphData>(() => {
    const nodes = rows.map((row) => ({
      id: row.id,
      recordId: row.id,
      label: row.label,
      databaseId: row.kind,
      databaseLabel: row.kind === "center" ? "Center" : `${row.kind[0]?.toUpperCase()}${row.kind.slice(1)}`,
      moduleId: row.kind === "record" ? "records" : "relationship",
      recordType: row.kind,
      subtitle: row.degree,
      ...(row.recordPath ? { recordPath: row.recordPath } : {}),
    }));
    return {
      nodes,
      edges: rows.flatMap((row) => row.id === "center" ? [] : [{
        id: `${row.id}:center`,
        sourceId: row.id,
        targetId: "center",
        label: row.degree,
        relationType: "association",
        evidence: "Derived from the current association projection.",
        sourceModule: row.kind === "record" ? "records" : "relationship",
      }]),
      databases: [...new Map(nodes.map((node) => [node.databaseId, {
        id: node.databaseId,
        label: node.databaseLabel,
        moduleId: node.moduleId,
      }])).values()],
    };
  }, [rows]);

  function openRecord(row: DataRow | GraphNode) {
    const recordPath = "recordPath" in row ? row.recordPath : undefined;
    if (typeof recordPath === "string" && recordPath) navigate(recordPath);
  }

  return (
    <div className="space-y-3">
      <p className="text-sm" style={{ color: "var(--color-navy-mid)" }}>
        Centered on <strong style={{ color: "var(--color-navy)" }}>{result.centerLabel}</strong>
        <span className="mx-1.5" style={{ color: "var(--color-warm-gray)" }}>·</span>
        <span style={{ color: "var(--color-warm-gray)" }}>{result.centerSubtitle}</span>
      </p>
      <DataViews
        spec={ASSOCIATION_SPEC}
        view={view}
        data={rows}
        onViewChange={setView}
        onOpenRecord={openRecord}
        graphData={graphData}
      />
    </div>
  );
}
