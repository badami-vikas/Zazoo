import { useState } from "react";
import { trpc, PILOT_WORKSPACE } from "../lib/trpc";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";

type RunResult = Awaited<ReturnType<typeof trpc.ritual.run.mutate>>;
type RunByIdResult = Awaited<ReturnType<typeof trpc.ritual.runById.mutate>>;

/**
 * Run a ritual either by explicit inline steps (`ritual.run`) or by registered id
 * (`ritual.runById`). There is no `ritual.get`/`ritual.list` read procedure yet (see
 * RitualsPage note + docs/BUGS.md), so this page cannot pre-fill from a route param —
 * the user supplies the ritualId directly.
 */
export function RitualDetail() {
  const [ritualId, setRitualId] = useState("");
  const [actorId, setActorId] = useState("dummy_user_1");
  const [stepsJson, setStepsJson] = useState(
    '[\n  { "skill": "example.skill", "action": "read", "resourceType": "touchpoint", "inputs": {} }\n]',
  );
  const [result, setResult] = useState<RunResult | RunByIdResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function runInline() {
    setError(null);
    setResult(null);
    let steps: unknown;
    try {
      steps = JSON.parse(stepsJson);
    } catch {
      setError("Steps must be valid JSON (an array of step objects).");
      return;
    }
    setSubmitting(true);
    try {
      const res = await trpc.ritual.run.mutate({
        workspaceId: PILOT_WORKSPACE,
        ritualId,
        actor: { type: "user", id: actorId },
        steps: steps as never,
      });
      setResult(res);
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function runById() {
    setError(null);
    setResult(null);
    setSubmitting(true);
    try {
      const res = await trpc.ritual.runById.mutate({
        workspaceId: PILOT_WORKSPACE,
        ritualId,
        actor: { type: "user", id: actorId },
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
      <h1 className="text-lg font-medium">Run Workflow</h1>
      <div className="space-y-1.5">
        <Label htmlFor="ritualId">Workflow ID</Label>
        <Input id="ritualId" value={ritualId} onChange={(e) => setRitualId(e.target.value)} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="actorId">Actor (user) ID</Label>
        <Input id="actorId" value={actorId} onChange={(e) => setActorId(e.target.value)} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="steps">Inline steps (JSON array) — used by "Run (inline steps)" only</Label>
        <Textarea
          id="steps"
          value={stepsJson}
          onChange={(e) => setStepsJson(e.target.value)}
          rows={8}
          className="font-mono text-xs"
        />
      </div>
      <div className="flex gap-2">
        <Button onClick={runInline} disabled={submitting || !ritualId}>
          Run (inline steps)
        </Button>
        <Button variant="outline" onClick={runById} disabled={submitting || !ritualId}>
          Run by ID (registered steps)
        </Button>
      </div>
      {error && <div className="text-sm text-red-600">{error}</div>}
      {result && (
        <pre className="text-xs bg-muted p-3 rounded-md overflow-auto">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
