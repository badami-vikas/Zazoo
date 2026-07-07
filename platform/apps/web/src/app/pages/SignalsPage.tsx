/**
 * Signals — standalone pinned governance tool (user revision 2026-07-06,
 * overriding ADR-023 item 4's tabs-merge: Signals and Approvals are TWO
 * SEPARATE pinned tools again, each with its own count so consent decisions
 * and observation noise never share a surface).
 *
 * Reuses `graph.listSignals` for the read and `graph.recordSignalAction` for
 * act/dismiss/save — a direct write, not a governed proposal (see
 * graph-store.ts's header comment: recording a reaction to an observation
 * carries no external effect requiring approval, unlike ApprovalsPage's
 * proposals).
 */
import { useEffect, useState } from "react";
import { trpc, PILOT_WORKSPACE } from "../lib/trpc";
import { Button } from "../components/ui/button";

type SignalPage = Awaited<ReturnType<typeof trpc.graph.listSignals.query>>;
type SignalItem = SignalPage["items"][number];

export function SignalsPage() {
  const [page, setPage] = useState<SignalPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function refresh() {
    trpc.graph.listSignals
      .query({ workspaceId: PILOT_WORKSPACE, limit: 50, offset: 0 })
      .then(setPage)
      .catch((e) => setError(String(e)));
  }

  useEffect(refresh, []);

  async function react(signalId: string, verb: "act" | "dismiss" | "save") {
    setBusyId(signalId);
    try {
      await trpc.graph.recordSignalAction.mutate({ workspaceId: PILOT_WORKSPACE, signalId, verb });
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyId(null);
    }
  }

  if (error) return <div className="p-4 sm:p-6 text-sm text-red-600 break-words">{error}</div>;
  if (!page) return <div className="p-4 sm:p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="p-4 sm:p-6 space-y-4 w-full max-w-full overflow-x-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-medium">Signals</h1>
        <Button size="sm" onClick={refresh}>
          Refresh
        </Button>
      </div>
      <div className="text-sm text-muted-foreground">
        {page.total} signal{page.total === 1 ? "" : "s"}
        {page.hasMore ? " (more available)" : ""}
      </div>

      <ul className="flex flex-col gap-3">
        {page.items.map((s: SignalItem) => (
          <li key={s.id} className="border rounded-md p-3 sm:p-4 text-sm space-y-2 w-full max-w-full">
            <div className="font-medium break-words">
              {s.type} · {s.subjectType}
            </div>
            <div className="text-xs text-muted-foreground">status: {s.status}</div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={busyId === s.id} onClick={() => react(s.id, "act")}>
                Act
              </Button>
              <Button size="sm" variant="outline" disabled={busyId === s.id} onClick={() => react(s.id, "save")}>
                Save
              </Button>
              <Button size="sm" variant="outline" disabled={busyId === s.id} onClick={() => react(s.id, "dismiss")}>
                Dismiss
              </Button>
            </div>
          </li>
        ))}
        {page.items.length === 0 && <li className="text-sm text-muted-foreground">No signals yet.</li>}
      </ul>
    </div>
  );
}
