import { useEffect, useState } from "react";
import { trpc, PILOT_WORKSPACE } from "../lib/trpc";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

type ResourcePage = Awaited<ReturnType<typeof trpc.resources.list.query>>;

const KINDS = ["book", "podcast", "vlog", "article", "other"] as const;

/** Replaces the prototype's Supabase-direct `resources_canonical` read
 * (frontend-migration-scoping.md gap #4) with `resources.list`/`resources.create`. */
export function ResourcesPage() {
  const [page, setPage] = useState<ResourcePage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]>("book");
  const [url, setUrl] = useState("");

  function refresh() {
    trpc.resources.list
      .query({ workspaceId: PILOT_WORKSPACE, limit: 50, offset: 0 })
      .then(setPage)
      .catch((e) => setError(String(e)));
  }
  useEffect(refresh, []);

  async function add() {
    if (!title) return;
    setError(null);
    try {
      await trpc.resources.create.mutate({
        workspaceId: PILOT_WORKSPACE,
        title,
        kind,
        ...(url ? { url } : {}),
      });
      setTitle("");
      setUrl("");
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <h1 className="text-lg font-medium">Resources</h1>
      {error && <div className="text-sm text-red-600">{error}</div>}

      <section className="space-y-2 border rounded-md p-4">
        <h2 className="text-sm font-medium">Add a resource</h2>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kind">Kind</Label>
            <select
              id="kind"
              className="border rounded-md h-9 px-3 text-sm bg-input-background"
              value={kind}
              onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="url">URL</Label>
            <Input id="url" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
          <Button onClick={add}>Add</Button>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">
          {page?.total ?? "…"} resource{page?.total === 1 ? "" : "s"}{page?.hasMore ? " (more available)" : ""}
        </h2>
        <ul className="divide-y">
          {page?.items.map((r) => (
            <li key={r.id} className="py-2 text-sm">
              {r.url ? (
                <a href={r.url} target="_blank" rel="noreferrer" className="hover:underline">
                  {r.title}
                </a>
              ) : (
                r.title
              )}
              <span className="text-muted-foreground"> · {r.kind}</span>
            </li>
          ))}
          {page && page.items.length === 0 && (
            <li className="py-2 text-sm text-muted-foreground">No resources yet.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
