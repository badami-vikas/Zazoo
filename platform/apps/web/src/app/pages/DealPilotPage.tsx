import { useEffect, useState } from "react";
import { trpc, PILOT_WORKSPACE } from "../lib/trpc";
import { Button } from "../components/ui/button";

type DealPilotList = Awaited<ReturnType<typeof trpc.dealpilot.list.query>>;

/**
 * Reference port proving the migration pattern end-to-end: real typed tRPC call
 * (no fetch/localStorage/Supabase), governed by the same pipeline as the prototype's
 * partial `api.ts` seam. See docs/raw/frontend-migration-scoping.md Phase 1.
 */
export function DealPilotPage() {
  const [page, setPage] = useState<DealPilotList | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    trpc.dealpilot.list
      .query({ workspaceId: PILOT_WORKSPACE, limit: 50, offset: 0 })
      .then(setPage)
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <div className="p-6 text-red-600 text-sm">{error}</div>;
  if (!page) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">DealPilot</h1>
        <Button
          onClick={() =>
            trpc.dealpilot.list
              .query({ workspaceId: PILOT_WORKSPACE, limit: 50, offset: 0 })
              .then(setPage)
          }
        >
          Refresh
        </Button>
      </div>
      <div className="text-sm text-muted-foreground">
        {page.total} candidate{page.total === 1 ? "" : "s"}
        {page.hasMore ? " (more available)" : ""}
      </div>
      <ul className="divide-y">
        {page.items.map((item) => (
          <li key={item.id} className="py-2 text-sm">
            {String(item.profile.name ?? item.id)}
          </li>
        ))}
      </ul>
    </div>
  );
}
