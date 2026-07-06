import { useState } from "react";
import { trpc, PILOT_WORKSPACE } from "../lib/trpc";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

type CreateResult = Awaited<ReturnType<typeof trpc.agent.create.mutate>>;

const EGRESS_TIERS = ["none", "read-graph", "draft-graph", "source-internet"] as const;
const DATA_SCOPES = ["all", "public", "private"] as const;

/** Form hitting `agent.create` (router.ts's `agentCreateInput`). Escalating capability
 * tokens are stripped server-side; `dropped` in the response shows what was refused. */
export function AgentCreate() {
  const [name, setName] = useState("");
  const [capabilityScope, setCapabilityScope] = useState("");
  const [allowedSkills, setAllowedSkills] = useState("");
  const [dataScope, setDataScope] = useState<(typeof DATA_SCOPES)[number]>("public");
  const [egressTier, setEgressTier] = useState<(typeof EGRESS_TIERS)[number]>("none");
  const [result, setResult] = useState<CreateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setSubmitting(true);
    try {
      const res = await trpc.agent.create.mutate({
        workspaceId: PILOT_WORKSPACE,
        name,
        capabilityScope: capabilityScope
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        allowedSkills: allowedSkills
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        dataScope,
        egressTier,
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
      <h1 className="text-lg font-medium">Create Agent</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">Name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="capabilityScope">Capability scope (comma-separated tokens)</Label>
          <Input
            id="capabilityScope"
            value={capabilityScope}
            onChange={(e) => setCapabilityScope(e.target.value)}
            placeholder="e.g. touchpoint:read, signal:read"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="allowedSkills">Allowed skills (comma-separated)</Label>
          <Input id="allowedSkills" value={allowedSkills} onChange={(e) => setAllowedSkills(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dataScope">Data scope</Label>
          <select
            id="dataScope"
            className="border rounded-md h-9 px-3 text-sm w-full bg-input-background"
            value={dataScope}
            onChange={(e) => setDataScope(e.target.value as (typeof DATA_SCOPES)[number])}
          >
            {DATA_SCOPES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="egressTier">Egress tier</Label>
          <select
            id="egressTier"
            className="border rounded-md h-9 px-3 text-sm w-full bg-input-background"
            value={egressTier}
            onChange={(e) => setEgressTier(e.target.value as (typeof EGRESS_TIERS)[number])}
          >
            {EGRESS_TIERS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Creating…" : "Create Agent"}
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
