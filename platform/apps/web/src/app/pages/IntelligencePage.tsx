/**
 * Intelligence — the capability surface.
 *
 * TASK-001 / VOCAB2 / VOCAB6 (2026-07-16): removed deprecated Tools, Workflows,
 * and standalone Skills sections. Retained sections:
 *   - Modules (packages.list registry)
 *   - Integrations (real providers + connected endpoints)
 *   - Agents (honest empty state — no agent.list API yet)
 *   - Registry (Universal Commons)
 *
 * Tools → each Module's own surface (reachable from left nav → Module Detail).
 * Skills → nested under Agents in Module Detail (§4b, not a standalone toggle).
 * Workflows → renamed Automations; appear under Module Detail (§4b).
 *
 * Packages tab uses "Modules" as display label (vocabulary rule R-017–R-020).
 */
import { useEffect, useState } from "react";
import { trpc, PILOT_WORKSPACE } from "../lib/trpc";
import { Package, Cable, Bot, Globe } from "lucide-react";
import { Header } from "../components/shared/Header";

type IntelligenceSection = "packages" | "integrations" | "agents" | "commons";

const SECTIONS: { id: IntelligenceSection; label: string; icon: typeof Package }[] = [
  { id: "packages", label: "Modules", icon: Package },
  { id: "integrations", label: "Integrations", icon: Cable },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "commons", label: "Registry", icon: Globe },
];

type ProvidersResult = Awaited<ReturnType<typeof trpc.integration.providers.query>>;
type IntegrationsResult = Awaited<ReturnType<typeof trpc.integration.list.query>>;

function IntegrationsSection() {
  const [providers, setProviders] = useState<ProvidersResult | null>(null);
  const [connected, setConnected] = useState<IntegrationsResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    trpc.integration.providers.query().then(setProviders).catch((e) => setError(String(e)));
    trpc.integration.list
      .query({ workspaceId: PILOT_WORKSPACE, limit: 50, offset: 0 })
      .then(setConnected)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div className="space-y-4 max-w-2xl">
      {error && <div className="text-sm text-red-600 break-words">{error}</div>}

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Connected</h2>
        {connected === null ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : connected.items.length === 0 ? (
          <div className="p-4 border rounded-md text-sm text-muted-foreground">No integrations connected yet.</div>
        ) : (
          <ul className="divide-y border rounded-md">
            {connected.items.map((i) => (
              <li key={i.id} className="p-3 text-sm">
                {i.provider}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Available providers</h2>
        {providers === null ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : providers.length === 0 ? (
          <div className="p-4 border rounded-md text-sm text-muted-foreground">No providers registered.</div>
        ) : (
          <ul className="divide-y border rounded-md">
            {providers.map((p) => (
              <li key={p.id} className="p-3 text-sm">
                <span className="font-medium">{p.id}</span>
                <span className="text-muted-foreground"> · scopes: {p.oauthScopes.join(", ") || "none"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="text-sm">
        <Link to="/integrations/google" className="underline">
          Google integration panel (Gmail + Calendar)
        </Link>
      </div>
    </div>
  );
}

type PackagesResult = Awaited<ReturnType<typeof trpc.packages.list.query>>;

function PackagesSection() {
  const [result, setResult] = useState<PackagesResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    trpc.packages.list
      .query({ workspaceId: PILOT_WORKSPACE, limit: 50, offset: 0 })
      .then(setResult)
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <div className="text-sm text-red-600 break-words max-w-2xl">{error}</div>;
  if (result === null) return <div className="text-sm text-muted-foreground">Loading…</div>;
  if (result.items.length === 0) {
    return (
      <div className="p-4 border rounded-md text-sm text-muted-foreground max-w-2xl">
        No modules installed yet. Modules arrive through the Learning Agent's proposals or a manual
        <code> packages.register</code> call — nothing installs itself.
      </div>
    );
  }

  return (
    <ul className="divide-y border rounded-md max-w-2xl">
      {result.items.map((row) => (
        <li key={row.id} className="p-3 text-sm flex items-center justify-between gap-3">
          <div>
            <span className="font-medium">{row.packageName}</span>
            <span className="text-muted-foreground"> · v{row.packageVersion}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="border rounded px-1.5 py-0.5">{row.state}</span>
            <span className="border rounded px-1.5 py-0.5">{row.status}</span>
            <span className="border rounded px-1.5 py-0.5">{row.computedRisk}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

type CommonsListResult = Awaited<ReturnType<typeof trpc.commons.list.query>>;

/**
 * Registry tab — browse packages published to the Universal Commons (CM0 wire).
 * Shows name/version/kind/summary for each listed entry. "Install" opens a
 * governed flow: calls commons.installPropose to register the manifest, then
 * packages.install for risk-assessment + approval routing.
 * If the Commons service is not running, an honest offline state is shown.
 */
function CommonsSection() {
  const [result, setResult] = useState<CommonsListResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishMsg, setPublishMsg] = useState<string | null>(null);

  useEffect(() => {
    trpc.commons.list
      .query({ limit: 50 })
      .then(setResult)
      .catch((e) => setError(String(e)));
  }, []);

  async function handlePublishBuiltins() {
    setPublishing(true);
    setPublishMsg(null);
    try {
      const res = await trpc.commons.publishBuiltins.mutate();
      setPublishMsg(
        `Published: ${res.published.join(", ") || "none"} · Skipped (already in registry): ${res.skipped.join(", ") || "none"}`,
      );
      // Refresh the list
      const updated = await trpc.commons.list.query({ limit: 50 });
      setResult(updated);
    } catch (e) {
      setPublishMsg(`Error: ${String(e)}`);
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Universal Commons — browse and install capability packages from the registry.
        </div>
        <button
          onClick={handlePublishBuiltins}
          disabled={publishing}
          className="text-xs border rounded px-2 py-1 hover:bg-muted disabled:opacity-50"
        >
          {publishing ? "Publishing…" : "Publish built-ins"}
        </button>
      </div>

      {publishMsg && (
        <div className="text-xs text-muted-foreground border rounded p-2 break-words">{publishMsg}</div>
      )}

      {error && (
        <div className="p-4 border border-destructive/30 rounded-md text-sm text-muted-foreground">
          <p className="font-medium text-destructive">Commons registry unreachable</p>
          <p className="mt-1">
            The Commons service at <code>localhost:4780</code> is not running. Start it with{" "}
            <code>pnpm --filter @bridge/commons dev</code> or set <code>COMMONS_URL</code>.
          </p>
          <p className="mt-1 text-xs break-words">{error}</p>
        </div>
      )}

      {!error && result === null && (
        <div className="text-sm text-muted-foreground">Loading registry…</div>
      )}

      {!error && result !== null && result.items.length === 0 && (
        <div className="p-4 border rounded-md text-sm text-muted-foreground">
          No packages in the registry yet. Click <strong>Publish built-ins</strong> to seed it with the
          built-in workspace packages (DealPilot, JobPilot, Helpdesk, Calendar).
        </div>
      )}

      {!error && result !== null && result.items.length > 0 && (
        <ul className="divide-y border rounded-md">
          {result.items.map((pkg) => (
            <li key={`${pkg.name}@${pkg.latestVersion}`} className="p-3 text-sm flex items-start justify-between gap-3">
              <div>
                <span className="font-medium">{pkg.name}</span>
                <span className="text-muted-foreground"> · v{pkg.latestVersion}</span>
                {pkg.summary && <p className="text-xs text-muted-foreground mt-0.5">{pkg.summary}</p>}
                {pkg.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {pkg.tags.map((t) => (
                      <span key={t} className="border rounded px-1.5 py-0.5 text-xs text-muted-foreground">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <span className="border rounded px-1.5 py-0.5 text-xs text-muted-foreground shrink-0">{pkg.kind}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function IntelligencePage() {
  const [section, setSection] = useState<IntelligenceSection>("packages");

  const active = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden w-full max-w-full">
      <Header
        tabs={SECTIONS.map((s) => ({ id: s.label, icon: s.icon }))}
        activeTab={active.label}
        onTabChange={(label) => {
          const next = SECTIONS.find((s) => s.label === label);
          if (next) setSection(next.id);
        }}
      />
      <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-4">
        {section === "packages" && <PackagesSection />}
        {section === "integrations" && <IntegrationsSection />}
        {section === "agents" && (
          <div className="p-6 border rounded-md text-sm text-muted-foreground max-w-xl">
            No <code>agent.list</code> API exists yet — registered Agents appear in Module Detail
            pages under <strong>Agents</strong>, with their Skills nested beneath each Agent.
            Tracked in docs/BUGS.md.
          </div>
        )}
        {section === "commons" && <CommonsSection />}
      </div>
    </div>
  );
}
