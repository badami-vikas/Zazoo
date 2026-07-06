import { Link } from "react-router";

/**
 * STUB — router.ts's `ritual` router has `create`/`run`/`runById` but no `list` (or
 * `get`) procedure to enumerate registered rituals. Listing is out of scope to invent
 * here (backend work reserved for Phase 2/3/4 in this session); tracked as a gap in
 * docs/BUGS.md. `ritual.create` and `ritual.run`/`runById` ARE ported — see
 * /rituals/new and /rituals/run.
 */
export function RitualsPage() {
  return (
    <div className="p-6 space-y-3 text-sm">
      <h1 className="text-lg font-medium">Rituals</h1>
      <p className="text-muted-foreground">
        No <code>ritual.list</code> procedure exists yet on the backend — this page can't
        enumerate registered rituals. Tracked in docs/BUGS.md.
      </p>
      <div className="flex gap-4">
        <Link to="/rituals/new" className="underline">
          Create a ritual
        </Link>
        <Link to="/rituals/run" className="underline">
          Run a ritual
        </Link>
      </div>
    </div>
  );
}
