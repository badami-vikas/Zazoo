import { useEffect, useState } from "react";
import { trpc, PILOT_WORKSPACE } from "../lib/trpc";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

type IntegrationList = Awaited<ReturnType<typeof trpc.integration.list.query>>;
type Providers = Awaited<ReturnType<typeof trpc.integration.providers.query>>;
type Scopes = Awaited<ReturnType<typeof trpc.integration.listScopes.query>>;

const ACTIONS = ["read", "write", "execute", "share", "archive"] as const;

/**
 * Social-integration management: connect/disconnect providers + view/grant/revoke
 * governed scopes. Maps to router.ts's `integration.*` (providers/list/connect/disconnect/
 * listScopes/grantScope/revokeScope) — distinct from the `google.*` router (see
 * GoogleIntegrationPanel).
 */
export function IntegrationDetail() {
  const [providers, setProviders] = useState<Providers | null>(null);
  const [list, setList] = useState<IntegrationList | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [selectedIntegrationId, setSelectedIntegrationId] = useState("");
  const [scopes, setScopes] = useState<Scopes | null>(null);
  const [scopeResourceType, setScopeResourceType] = useState("touchpoint");
  const [scopeAction, setScopeAction] = useState<(typeof ACTIONS)[number]>("read");

  function refreshList() {
    trpc.integration.list
      .query({ workspaceId: PILOT_WORKSPACE, limit: 50, offset: 0 })
      .then(setList)
      .catch((e) => setError(String(e)));
  }

  useEffect(() => {
    trpc.integration.providers.query().then(setProviders).catch((e) => setError(String(e)));
    refreshList();
  }, []);

  async function connect(provider: "x" | "instagram" | "facebook" | "linkedin") {
    setError(null);
    try {
      await trpc.integration.connect.mutate({ workspaceId: PILOT_WORKSPACE, provider });
      refreshList();
    } catch (err) {
      setError(String(err));
    }
  }

  async function disconnect(integrationId: string) {
    setError(null);
    try {
      await trpc.integration.disconnect.mutate({ workspaceId: PILOT_WORKSPACE, integrationId });
      refreshList();
    } catch (err) {
      setError(String(err));
    }
  }

  async function loadScopes(integrationId: string) {
    setError(null);
    setSelectedIntegrationId(integrationId);
    try {
      const s = await trpc.integration.listScopes.query({ workspaceId: PILOT_WORKSPACE, integrationId });
      setScopes(s);
    } catch (err) {
      setError(String(err));
    }
  }

  async function grantScope() {
    if (!selectedIntegrationId) return;
    setError(null);
    try {
      await trpc.integration.grantScope.mutate({
        workspaceId: PILOT_WORKSPACE,
        integrationId: selectedIntegrationId,
        resourceType: scopeResourceType,
        action: scopeAction,
      });
      await loadScopes(selectedIntegrationId);
    } catch (err) {
      setError(String(err));
    }
  }

  async function revokeScope(permissionId: string) {
    setError(null);
    try {
      await trpc.integration.revokeScope.mutate({ workspaceId: PILOT_WORKSPACE, permissionId });
      if (selectedIntegrationId) await loadScopes(selectedIntegrationId);
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <h1 className="text-lg font-medium">Integrations</h1>
      {error && <div className="text-sm text-red-600">{error}</div>}

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Available providers</h2>
        <div className="flex flex-wrap gap-2">
          {providers?.map((p) => (
            <Button key={p.id} size="sm" variant="outline" onClick={() => connect(p.id as never)}>
              Connect {p.id}
            </Button>
          ))}
          {!providers && <span className="text-sm text-muted-foreground">Loading…</span>}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">
          Connected ({list?.total ?? "…"}){list?.hasMore ? " (more available)" : ""}
        </h2>
        <ul className="divide-y">
          {list?.items.map((item: { id: string; provider?: string }) => (
            <li key={item.id} className="py-2 flex items-center justify-between text-sm">
              <span>
                {item.provider ?? "unknown"} — <span className="text-muted-foreground">{item.id}</span>
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => loadScopes(item.id)}>
                  Scopes
                </Button>
                <Button size="sm" variant="destructive" onClick={() => disconnect(item.id)}>
                  Disconnect
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {selectedIntegrationId && (
        <section className="space-y-3 border rounded-md p-4">
          <h2 className="text-sm font-medium">Scopes for {selectedIntegrationId}</h2>
          <ul className="divide-y">
            {scopes?.map((s: { id: string; resourceType: string; action: string }) => (
              <li key={s.id} className="py-2 flex items-center justify-between text-sm">
                <span>
                  {s.action} {s.resourceType}
                </span>
                <Button size="sm" variant="destructive" onClick={() => revokeScope(s.id)}>
                  Revoke
                </Button>
              </li>
            ))}
            {scopes && scopes.length === 0 && (
              <li className="py-2 text-sm text-muted-foreground">No scopes granted.</li>
            )}
          </ul>
          <div className="flex items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="resourceType">Resource type</Label>
              <Input
                id="resourceType"
                value={scopeResourceType}
                onChange={(e) => setScopeResourceType(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="action">Action</Label>
              <select
                id="action"
                className="border rounded-md h-9 px-3 text-sm bg-input-background"
                value={scopeAction}
                onChange={(e) => setScopeAction(e.target.value as (typeof ACTIONS)[number])}
              >
                {ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <Button size="sm" onClick={grantScope}>
              Grant
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
