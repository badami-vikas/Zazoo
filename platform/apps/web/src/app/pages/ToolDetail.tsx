import { useState } from "react";
import { trpc, PILOT_WORKSPACE } from "../lib/trpc";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";

type RunResult = Awaited<ReturnType<typeof trpc.tool.run.mutate>>;

/**
 * Invoke a tool via `tool.run`, which shares `ritualRunByIdInput`'s shape (workspaceId,
 * ritualId used as the tool id, actor, optional params/seed) — see router.ts's `tool.run`.
 * There is no `tool.list`/`tool.get` read procedure yet (see ToolsPage note + docs/BUGS.md),
 * so the tool id is supplied directly by the user.
 */
export function ToolDetail() {
  const [toolId, setToolId] = useState("");
  const [actorId, setActorId] = useState("dummy_user_1");
  const [paramsJson, setParamsJson] = useState("{}");
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    let params: unknown;
    try {
      params = JSON.parse(paramsJson);
    } catch {
      setError("Params must be valid JSON.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await trpc.tool.run.mutate({
        workspaceId: PILOT_WORKSPACE,
        ritualId: toolId,
        actor: { type: "user", id: actorId },
        params: params as Record<string, unknown>,
      });
      setResult(res);
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-6 space-y-4 max-w-xl">
      <h1 className="text-lg font-medium">Run Tool</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="toolId">Tool ID</Label>
          <Input id="toolId" value={toolId} onChange={(e) => setToolId(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="actorId">Actor (user) ID</Label>
          <Input id="actorId" value={actorId} onChange={(e) => setActorId(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="params">Params (JSON object)</Label>
          <Textarea
            id="params"
            value={paramsJson}
            onChange={(e) => setParamsJson(e.target.value)}
            rows={6}
            className="font-mono text-xs"
          />
        </div>
        <Button type="submit" disabled={submitting || !toolId}>
          {submitting ? "Running…" : "Run Tool"}
        </Button>
      </form>
      {error && <div className="text-sm text-red-600">{error}</div>}
      {result && (
        <pre className="text-xs bg-muted p-3 rounded-md overflow-auto">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
