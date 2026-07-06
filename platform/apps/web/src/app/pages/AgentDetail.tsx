import { useState } from "react";
import { trpc } from "../lib/trpc";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

type UpdateResult = Awaited<ReturnType<typeof trpc.agent.update.mutate>>;

const EGRESS_TIERS = ["none", "read-graph", "draft-graph", "source-internet"] as const;
const DATA_SCOPES = ["all", "public", "private"] as const;

/**
 * Update an existing agent via `agent.update` (router.ts's `agentUpdateInput`). There is
 * no `agent.get`/`agent.list` read procedure yet (see docs/BUGS.md gap note), so this page
 * cannot pre-fill from an id — the user supplies the agentId and the fields to change;
 * fields left blank/unset are omitted from the mutation (server keeps existing value).
 */
export function AgentDetail() {
  const [agentId, setAgentId] = useState("");
  const [name, setName] = useState("");
  const [capabilityScope, setCapabilityScope] = useState("");
  const [allowedSkills, setAllowedSkills] = useState("");
  const [dataScope, setDataScope] = useState("");
  const [egressTier, setEgressTier] = useState("");
  const [result, setResult] = useState<UpdateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setSubmitting(true);
    try {
      const res = await trpc.agent.update.mutate({
        agentId,
        ...(name ? { name } : {}),
        ...(capabilityScope
          ? {
              capabilityScope: capabilityScope
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            }
          : {}),
        ...(allowedSkills
          ? {
              allowedSkills: allowedSkills
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            }
          : {}),
        ...(dataScope ? { dataScope: dataScope as (typeof DATA_SCOPES)[number] } : {}),
        ...(egressTier ? { egressTier: egressTier as (typeof EGRESS_TIERS)[number] } : {}),
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
      <h1 className="text-lg font-medium">Update Agent</h1>
      <p className="text-xs text-muted-foreground">
        No agent.get/list procedure exists yet — enter the agent ID directly. Blank fields
        are left unchanged.
      </p>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="agentId">Agent ID</Label>
          <Input id="agentId" value={agentId} onChange={(e) => setAgentId(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="name">Name (optional)</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="capabilityScope">Capability scope (optional, comma-separated)</Label>
          <Input id="capabilityScope" value={capabilityScope} onChange={(e) => setCapabilityScope(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="allowedSkills">Allowed skills (optional, comma-separated)</Label>
          <Input id="allowedSkills" value={allowedSkills} onChange={(e) => setAllowedSkills(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dataScope">Data scope (optional)</Label>
          <select
            id="dataScope"
            className="border rounded-md h-9 px-3 text-sm w-full bg-input-background"
            value={dataScope}
            onChange={(e) => setDataScope(e.target.value)}
          >
            <option value="">(unchanged)</option>
            {DATA_SCOPES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="egressTier">Egress tier (optional)</Label>
          <select
            id="egressTier"
            className="border rounded-md h-9 px-3 text-sm w-full bg-input-background"
            value={egressTier}
            onChange={(e) => setEgressTier(e.target.value)}
          >
            <option value="">(unchanged)</option>
            {EGRESS_TIERS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={submitting || !agentId}>
          {submitting ? "Updating…" : "Update Agent"}
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
