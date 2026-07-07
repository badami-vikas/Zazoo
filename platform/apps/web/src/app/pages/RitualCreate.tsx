import { useState } from "react";
import { trpc, PILOT_WORKSPACE } from "../lib/trpc";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";

type CreateResult = Awaited<ReturnType<typeof trpc.ritual.create.mutate>>;

/**
 * Minimal form hitting `ritual.create`. Steps are entered as raw JSON (an array of
 * `{ skill, action, resourceType, inputs }`) rather than a full step builder — this proves
 * the migration pattern, a richer step editor is a follow-up. See `router.ts`'s
 * `ritualCreateInput`/`ritualStep` schemas for the exact shape required.
 */
export function RitualCreate() {
  const [name, setName] = useState("");
  const [agentIds, setAgentIds] = useState("");
  const [stepsJson, setStepsJson] = useState(
    '[\n  { "skill": "example.skill", "action": "read", "resourceType": "touchpoint", "inputs": {} }\n]',
  );
  const [result, setResult] = useState<CreateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
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
      const res = await trpc.ritual.create.mutate({
        workspaceId: PILOT_WORKSPACE,
        name,
        agentIds: agentIds
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        steps: steps as never,
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
      <h1 className="text-lg font-medium">Create Workflow</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">Name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agentIds">Agent IDs (comma-separated)</Label>
          <Input id="agentIds" value={agentIds} onChange={(e) => setAgentIds(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="steps">Steps (JSON array)</Label>
          <Textarea
            id="steps"
            value={stepsJson}
            onChange={(e) => setStepsJson(e.target.value)}
            rows={8}
            className="font-mono text-xs"
          />
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Creating…" : "Create Workflow"}
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
