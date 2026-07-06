import { useEffect, useState } from "react";
import { trpc, PILOT_WORKSPACE } from "../lib/trpc";
import { Button } from "../components/ui/button";

type PendingPage = Awaited<ReturnType<typeof trpc.action.listPending.query>>;

/**
 * The moat: pending proposals awaiting a human decision. Backed by
 * `action.listPending` (frontend-migration-scoping.md Phase 2 — `action.decide`
 * existed with nothing enumerating what's awaiting approval).
 */
export function ApprovalsPage() {
  const [page, setPage] = useState<PendingPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function refresh() {
    trpc.action.listPending
      .query({ workspaceId: PILOT_WORKSPACE, limit: 50, offset: 0 })
      .then(setPage)
      .catch((e) => setError(String(e)));
  }

  useEffect(refresh, []);

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

  if (error) return <div className="p-6 text-red-600 text-sm">{error}</div>;
  if (!page) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">Approvals</h1>
        <Button onClick={refresh}>Refresh</Button>
      </div>
      <div className="text-sm text-muted-foreground">
        {page.total} pending{page.hasMore ? " (more available)" : ""}
      </div>
      <ul className="divide-y">
        {page.items.map((p) => (
          <li key={p.id} className="py-3 flex items-center justify-between gap-4 text-sm">
            <div>
              <div className="font-medium">
                {p.request.action} · {p.request.resourceType}
              </div>
              <div className="text-muted-foreground">{p.request.skill}</div>
            </div>
            <div className="flex gap-2">
              <Button disabled={busyId === p.id} onClick={() => decide(p.id, "veto")}>
                Veto
              </Button>
              <Button disabled={busyId === p.id} onClick={() => decide(p.id, "approve")}>
                Approve
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
