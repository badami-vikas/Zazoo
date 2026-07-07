import { useEffect, useState } from "react";
import type { RiskBand } from "@bridge/core";
import { trpc, PILOT_WORKSPACE } from "../lib/trpc";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";

type PendingPage = Awaited<ReturnType<typeof trpc.action.listPending.query>>;
type PendingItem = PendingPage["items"][number];
type BlueprintDraft = NonNullable<Awaited<ReturnType<typeof trpc.workspace.blueprint.get.query>>["definition"]>;

/** Honest, CLIENT-SIDE ESTIMATE of a proposal's risk — there is no per-proposal
 * computed risk on a generic Proposal today (computeRisk in @bridge/core only
 * runs over Capability Manifests, capability/risk.ts). Rather than inventing a
 * fake authoritative number, this maps the same resourceType/action shape the
 * Capability Trust Model's risk bands describe onto a clearly-labeled estimate
 * (see the "(estimated)" badge below) — external sends/shares are the one case
 * confidently bucketed as "external" (mirrors capability/approvals.ts's hard
 * floor); everything else is a coarser, honestly-labeled guess. */
function estimateRiskBand(item: PendingItem): RiskBand {
  const { action, resourceType } = item.request;
  if (resourceType === "external:send" || action === "share") return "external";
  if (resourceType === "external:fetch") return "operational";
  if (action === "write" || action === "archive") return "transformational";
  if (action === "approve") return "operational";
  return "informational";
}

const RISK_BAND_VARIANT: Record<RiskBand, "outline" | "secondary" | "destructive"> = {
  informational: "outline",
  advisory: "outline",
  transformational: "secondary",
  operational: "secondary",
  external: "destructive",
};

/** True for the one proposal shape this app currently knows how to render a
 * real diff for: workspace.blueprint.activate's governed step (inputs carries
 * `definitionId` pointing at a draft workspace_definition — see
 * apps/api/src/router.ts's workspace.blueprint.activate). Anything else with
 * no `diff`/structured payload gets an honest "no preview available" note
 * rather than a fabricated one. */
function blueprintDefinitionId(item: PendingItem): string | null {
  if (item.request.resourceType !== "skill") return null;
  const inputs = item.request.inputs as { definitionId?: unknown } | null;
  const id = inputs && typeof inputs === "object" ? inputs.definitionId : undefined;
  return typeof id === "string" ? id : null;
}

/**
 * Approvals — the governance inbox (docs/wiki/roadmap.md P1 "approval cards").
 * Every card shows what/why, an honestly-labeled risk estimate, the requester,
 * and — when the payload carries one (blueprint activation proposals) — a real
 * diff preview fetched from the underlying draft. Approve/Reject go through the
 * existing `action.decide` (server-resolved identity, agent-floor applies).
 * Mobile-width-safe from 375px: single-column stacked layout, no fixed widths
 * wider than the viewport, buttons wrap instead of overflowing.
 *
 * Approvals-ONLY surface (user revision 2026-07-06, overriding ADR-023 item
 * 4's tabs-merge): Signals is a SEPARATE pinned governance tool — see
 * SignalsPage.tsx. Both appear as pinned tools in the left nav by default
 * (lib/pins.ts), each surface keeping its own count so consent decisions
 * never drown in observation noise.
 */
export function ApprovalsPage() {
  const [page, setPage] = useState<PendingPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, BlueprintDraft | null>>({});

  function refresh() {
    trpc.action.listPending
      .query({ workspaceId: PILOT_WORKSPACE, limit: 50, offset: 0 })
      .then(setPage)
      .catch((e) => setError(String(e)));
  }

  useEffect(refresh, []);

  useEffect(() => {
    if (!page) return;
    for (const item of page.items) {
      const definitionId = blueprintDefinitionId(item);
      if (!definitionId || definitionId in drafts) continue;
      trpc.workspace.blueprint.get
        .query({ workspaceId: PILOT_WORKSPACE })
        .then((res) => {
          // get() only returns the ACTIVE definition, not an arbitrary draft by
          // id — honest limitation: there is no workspace.blueprint.getById yet.
          // We can only show the diff when the active definition happens to be
          // the one referenced (rare); otherwise fall back to the propose-time
          // note. Recorded as a known gap in docs/BUGS.md rather than papered
          // over with a fabricated fetch.
          const match = res.definition && res.definition.id === definitionId ? res.definition : null;
          setDrafts((prev) => ({ ...prev, [definitionId]: match }));
        })
        .catch(() => setDrafts((prev) => ({ ...prev, [definitionId]: null })));
    }
  }, [page, drafts]);

  async function decide(proposalId: string, decision: "approve" | "veto") {
    setBusyId(proposalId);
    try {
      await trpc.action.decide.mutate({ proposalId, decision });
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyId(null);
    }
  }

  if (error) return <div className="p-4 sm:p-6 text-red-600 text-sm break-words">{error}</div>;
  if (!page) return <div className="p-4 sm:p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="p-4 sm:p-6 space-y-4 w-full max-w-full overflow-x-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-medium">Approvals</h1>
        <Button size="sm" onClick={refresh}>
          Refresh
        </Button>
      </div>
      <div className="text-sm text-muted-foreground">
        {page.total} pending{page.hasMore ? " (more available)" : ""}
      </div>

      <ul className="flex flex-col gap-3">
        {page.items.map((p) => {
          const risk = estimateRiskBand(p);
          const definitionId = blueprintDefinitionId(p);
          const draft = definitionId ? drafts[definitionId] : undefined;
          const requester = `${p.request.actor.type}:${p.request.actor.id}`;

          return (
            <li key={p.id} className="border rounded-md p-3 sm:p-4 text-sm space-y-3 w-full max-w-full">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium break-words">
                    {p.request.action} · {p.request.resourceType}
                  </div>
                  <div className="text-muted-foreground break-words">skill: {p.request.skill}</div>
                </div>
                <Badge variant={RISK_BAND_VARIANT[risk]}>{risk} (estimated)</Badge>
              </div>

              <div className="text-xs text-muted-foreground break-words">requested by {requester}</div>

              {definitionId && (
                <div className="border rounded-md p-2 bg-muted/40 text-xs space-y-1 overflow-x-auto">
                  <div className="font-medium">Blueprint activation preview</div>
                  {draft === undefined && <div className="text-muted-foreground">Loading preview…</div>}
                  {draft === null && (
                    <div className="text-muted-foreground">
                      No diff preview available for this draft yet (only the currently-active definition can be
                      diffed today — known gap, see docs/BUGS.md).
                    </div>
                  )}
                  {draft && (
                    <div className="space-y-1">
                      <div>version {draft.version}</div>
                      <div>
                        entities: {draft.blueprint.entities.map((e) => e.label).join(", ") || "none"}
                      </div>
                      <div>views: {draft.blueprint.views.map((v) => `${v.entity} (${v.kind})`).join(", ") || "none"}</div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busyId === p.id} onClick={() => decide(p.id, "veto")}>
                  Reject
                </Button>
                <Button size="sm" disabled={busyId === p.id} onClick={() => decide(p.id, "approve")}>
                  Approve
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
