import { Link } from "react-router";

/**
 * STUB — router.ts's `tool` router has only `run` (via the shared `ritualRunByIdInput`
 * shape), no `list`/`get` procedure to enumerate available tools. Listing is out of
 * scope to invent here (backend work reserved for Phase 2/3/4 in this session); tracked
 * as a gap in docs/BUGS.md. `tool.run` IS ported — see /tools/run.
 */
export function ToolsPage() {
  return (
    <div className="p-6 space-y-3 text-sm">
      <h1 className="text-lg font-medium">Tools</h1>
      <p className="text-muted-foreground">
        No <code>tool.list</code> procedure exists yet on the backend — this page can't
        enumerate available tools. Tracked in docs/BUGS.md.
      </p>
      <Link to="/tools/run" className="underline">
        Run a tool
      </Link>
    </div>
  );
}
