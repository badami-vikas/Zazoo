import { useEffect, useMemo, useState } from "react";
import { compileBlueprint, type CompiledWorkspace, type WorkspaceBlueprint } from "@bridge/core";
import type { TableSpec, ViewConfig } from "@bridge/tables";
import { trpc, PILOT_WORKSPACE } from "../lib/trpc";
import { Button } from "../components/ui/button";
import { DataViews, DashboardView, type DataRow } from "../dataviews/index";

/** Kernel node-type registry — MUST mirror apps/api/src/router.ts's
 * BLUEPRINT_NODE_TYPE_REGISTRY (server-side compile at propose-time uses the
 * same list); kept in sync by hand for now since there is no shared runtime
 * registry endpoint yet (see docs/BUGS.md if this drifts). */
const REGISTERED_NODE_TYPES = [
  "person",
  "community",
  "initiative",
  "touchpoint",
  "ritual",
  "tool",
  "file",
  "signal",
  "policy",
  "policy_param",
  "skill",
  "agent",
  "role",
  "permission",
  "ledger",
  "delegation",
  "integration",
  "network_graph:full",
  "external:send",
  "external:fetch",
  "edge",
] as const;
const RELATIONSHIP_NODE_TYPES = ["edge"] as const;

/** The data source each registered node type reads real rows from — only
 * entities with a wired source render data; anything else renders an honest
 * "not yet wired" empty state rather than fabricating rows (CLAUDE.md: no
 * dummy/demo/seeded product data). */
async function fetchRowsFor(nodeType: string): Promise<DataRow[] | null> {
  switch (nodeType) {
    case "initiative": {
      const page = await trpc.graph.listInitiatives.query({ workspaceId: PILOT_WORKSPACE, limit: 100, offset: 0 });
      return page.items.map((r) => ({ ...r }));
    }
    case "touchpoint": {
      const page = await trpc.graph.listTouchpoints.query({ workspaceId: PILOT_WORKSPACE, limit: 100, offset: 0 });
      return page.items.map((r) => ({ ...r }));
    }
    case "signal": {
      const page = await trpc.graph.listSignals.query({ workspaceId: PILOT_WORKSPACE, limit: 100, offset: 0 });
      return page.items.map((r) => ({ ...r }));
    }
    default:
      return null; // not yet wired — WorkspacePage says so plainly, no fallback data
  }
}

type BlueprintResult = Awaited<ReturnType<typeof trpc.workspace.blueprint.get.query>>;

/**
 * WorkspacePage (/workspace) — the P1 Workspace Generator's frontend proof:
 * fetches the active workspace_definition, compiles it CLIENT-SIDE with
 * @bridge/core's compileBlueprint (the same pure function apps/api validates
 * drafts against server-side at propose-time), and renders each entity's
 * views through <DataViews> with real data from the existing graph endpoints.
 * Entities with no wired data source get an honest empty state, never
 * fabricated rows.
 */
export function WorkspacePage() {
  const [blueprintResult, setBlueprintResult] = useState<BlueprintResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rowsByEntity, setRowsByEntity] = useState<Record<string, DataRow[] | null>>({});
  const [viewsByCompiledId, setViewsByCompiledId] = useState<Record<string, ViewConfig>>({});

  useEffect(() => {
    trpc.workspace.blueprint.get
      .query({ workspaceId: PILOT_WORKSPACE })
      .then(setBlueprintResult)
      .catch((e) => setError(String(e)));
  }, []);

  const compiled: CompiledWorkspace | null = useMemo(() => {
    const definition = blueprintResult?.definition;
    if (!definition) return null;
    try {
      return compileBlueprint(definition.blueprint as WorkspaceBlueprint, REGISTERED_NODE_TYPES, RELATIONSHIP_NODE_TYPES);
    } catch (e) {
      setError(`Active blueprint failed to compile: ${String(e)}`);
      return null;
    }
  }, [blueprintResult]);

  useEffect(() => {
    if (!compiled) return;
    let cancelled = false;
    for (const entity of compiled.navigation) {
      fetchRowsFor(entity.nodeType)
        .then((rows) => {
          if (!cancelled) setRowsByEntity((prev) => ({ ...prev, [entity.nodeType]: rows }));
        })
        .catch((e) => !cancelled && setError(String(e)));
    }
    return () => {
      cancelled = true;
    };
  }, [compiled]);

  if (error) {
    return (
      <div className="p-6">
        <div className="text-sm text-red-600">{error}</div>
      </div>
    );
  }

  if (!blueprintResult) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Loading workspace…</div>
    );
  }

  if (!compiled) {
    return (
      <div className="p-6 space-y-3 max-w-xl">
        <h1 className="text-lg font-medium">Workspace</h1>
        <div className="border rounded-md p-4 text-sm text-muted-foreground">
          No active workspace blueprint yet. This workspace hasn't been generated — propose one via
          <code className="mx-1 px-1 py-0.5 rounded bg-muted">workspace.blueprint.propose</code>
          and activate it (governed proposal, human approval required) before entities/views appear here.
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-8">
      <h1 className="text-lg font-medium">Workspace</h1>

      {compiled.navigation.map((entity) => {
        const spec: TableSpec | undefined = compiled.tableSpecs.find((t) => t.id === entity.nodeType);
        const entityViews = compiled.viewConfigs.filter((v) => v.entity === entity.nodeType);
        const rows = rowsByEntity[entity.nodeType];
        const isRelationship = RELATIONSHIP_NODE_TYPES.includes(entity.nodeType as (typeof RELATIONSHIP_NODE_TYPES)[number]);

        return (
          <section key={entity.nodeType} className="space-y-2">
            <h2 className="text-sm font-medium">{entity.label}</h2>

            {rows === null ? (
              <div className="p-4 border rounded-md text-sm text-muted-foreground">
                {entity.label} isn't wired to a data source yet — connect an account or add data to see it here.
              </div>
            ) : rows === undefined ? (
              <div className="p-4 border rounded-md text-sm text-muted-foreground">Loading {entity.label}…</div>
            ) : entityViews.length === 0 ? (
              <div className="p-4 border rounded-md text-sm text-muted-foreground">No views configured for {entity.label}.</div>
            ) : (
              entityViews.map((compiledView) => {
                if (compiledView.kind === "dashboard") {
                  return spec ? <DashboardView key={compiledView.id} spec={spec} data={rows} /> : null;
                }
                if (compiledView.kind === "chatbot" || compiledView.kind === "canvas") {
                  return (
                    <div key={compiledView.id} className="p-4 border rounded-md text-sm text-muted-foreground">
                      "{compiledView.kind}" views aren't implemented yet.
                    </div>
                  );
                }
                if (!spec) return null;
                const view: ViewConfig = viewsByCompiledId[compiledView.id] ?? {
                  id: compiledView.id,
                  kind: compiledView.kind,
                  sorts: compiledView.sorts,
                  rowFilters: compiledView.rowFilters,
                  filterMatch: compiledView.filterMatch,
                  groupBy: compiledView.groupBy,
                };
                return (
                  <DataViews
                    key={compiledView.id}
                    spec={spec}
                    view={view}
                    data={rows}
                    isRelationship={isRelationship}
                    onViewChange={(next) => setViewsByCompiledId((prev) => ({ ...prev, [compiledView.id]: next }))}
                  />
                );
              })
            )}
          </section>
        );
      })}

      {compiled.navigation.length === 0 && (
        <div className="p-4 border rounded-md text-sm text-muted-foreground max-w-xl">
          The active blueprint declares no entities yet.
        </div>
      )}

      <div className="pt-2">
        <Button variant="outline" size="sm" disabled>
          Propose a new blueprint version (coming soon)
        </Button>
      </div>
    </div>
  );
}
