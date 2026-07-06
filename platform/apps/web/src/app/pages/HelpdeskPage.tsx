import { useEffect, useState } from "react";
import { Link } from "react-router";
import { trpc, PILOT_WORKSPACE } from "../lib/trpc";

type TicketPage = Awaited<ReturnType<typeof trpc.helpdesk.list.query>>;

/** Support-agent inbox — workspace-authenticated (see router.ts's `helpdesk.list`).
 * The public submitter side lives at PublicHelpdesk, a separate token-based surface. */
export function HelpdeskPage() {
  const [page, setPage] = useState<TicketPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    trpc.helpdesk.list
      .query({ workspaceId: PILOT_WORKSPACE, limit: 50, offset: 0 })
      .then(setPage)
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <div className="p-6 text-red-600 text-sm">{error}</div>;

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-lg font-medium">Helpdesk</h1>
      <div className="text-sm text-muted-foreground">
        {page?.total ?? "…"} ticket{page?.total === 1 ? "" : "s"}{page?.hasMore ? " (more available)" : ""}
      </div>
      <ul className="divide-y">
        {page?.items.map((t) => (
          <li key={t.id} className="py-2 text-sm">
            <Link to={`/helpdesk/${t.id}`} className="hover:underline">
              {t.subject}
            </Link>
            <div className="text-muted-foreground">
              {t.submitterEmail} · {t.status}
            </div>
          </li>
        ))}
        {page && page.items.length === 0 && (
          <li className="py-2 text-sm text-muted-foreground">No tickets yet.</li>
        )}
      </ul>
    </div>
  );
}
