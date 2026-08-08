/**
 * Intelligence — the capability surface (user revision 2026-07-06 over
 * ADR-023: the bottom-bar Intelligence container owns capabilities, not the
 * Chief of Staff chat, which stays at /chief-of-staff as a pinnable tool).
 *
 * Tab order = biggest-to-smallest complexity: Packages, Tools, Integrations,
 * Agents, Workflows, Skills. Packages added 2026-07-07 (user call) — the
 * Capability Registry view (`packages.list`, a real Drizzle-backed store,
 * not a placeholder) belongs before Tools: packages are what get INSTALLED,
 * tools are what's currently wired/pinned as a result.
 *
 * - Packages = `packages.list` — every package installation in this
 *   workspace (draft/pending_review/private/promoted/available/deprecated),
 *   the Capability Trust Model states from packages/core/src/package/
 *   lifecycle.ts. Read-only here; install/promote/rollback are governed
 *   mutations, not exposed as raw buttons yet (tracked in docs/BUGS.md).
 * - Tools = installed capability packages (ADR-020/021's "packages, not
 *   products"): DealPilot/JobPilot/Helpdesk are wired end-to-end
 *   (dealpilot.list / jobpilot.list / helpdesk.list), plus Chief of Staff.
 *   NOTE (2026-07-07, filed in BUGS.md): these three are currently
 *   hardcoded into routes.tsx/this list, not gated by `packages.list`
 *   installation state — the add-on-package architecture isn't load-bearing
 *   yet, this tab is the first step toward it.
 * - Integrations = REAL endpoints exist: `integration.providers` (connectable
 *   platforms + declared OAuth scopes) and `integration.list` (connected
 *   integrations, paginated) — both rendered; Google's dedicated panel is
 *   linked (/integrations/google).
 * - Agents / Workflows / Skills = honest empty states; no `agent.list`,
 *   `ritual.list`, or `capability.list` read procedure exists on the backend
 *   (pre-existing gaps, docs/BUGS.md). Workflow (display label for the kernel
 *   `ritual` node type — identifier unchanged) create/run links kept.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { trpc, PILOT_WORKSPACE } from "../lib/trpc";
import { Package, PenTool, Cable, Bot, Repeat, Sparkles, Globe } from "lucide-react";
import { Header } from "../components/shared/Header";

type IntelligenceSection = "packages" | "tools" | "integrations" | "agents" | "workflows" | "skills" | "commons";

// UI copy uses the primitive name "Modules" for the capability registry rows; the backing
// identifiers/procedures (`packages.list`, section id "packages") are unchanged.
const SECTIONS: { id: IntelligenceSection; label: string; icon: typeof Package }[] = [
  { id: "packages", label: "Modules", icon: Package },
  { id: "tools", label: "Tools", icon: PenTool },
  { id: "integrations", label: "Integrations", icon: Cable },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "workflows", label: "Workflows", icon: Repeat },
  { id: "skills", label: "Skills", icon: Sparkles },
  { id: "commons", label: "Registry", icon: Globe },
];

// Maps package name → route + display metadata. Only packages in packages.list
// with state="available" are rendered in the Tools tab. Add a row here when a
// new workspace_definition package ships — the package must also be seeded in
// apps/api/src/built-in-packages.ts or registered through Learning Agent.
// Chief of Staff deliberately excluded (2026-07-10, user correction): it's
// the router agent, not an installable Module — see built-in-packages.ts's
// header comment. Its own /chief-of-staff page stays reachable elsewhere.
const PACKAGE_ROUTES: Record<string, { to: string; label: string; desc: string }> = {
  "deal-pilot": { to: "/dealpilot", label: "DealPilot", desc: "Sourcing waterfall + thesis-fit scoring" },
  "job-pilot": { to: "/jobpilot", label: "JobPilot", desc: "Job search tracker + application pipeline" },
  helpdesk: { to: "/helpdesk", label: "Helpdesk", desc: "Support ticket inbox + routing" },
  calendar: { to: "/task-manager", label: "Task Manager", desc: "Rank and schedule pending work — pre-installed" },
};

function NotWiredYet({ label, note }: { label: string; note: string }) {
  return (
    <div className="p-6 border rounded-md text-sm text-muted-foreground max-w-xl">
      No <code>{label}</code> read procedure exists yet on the backend — this section can't enumerate {note}. Tracked
      in docs/BUGS.md.
    </div>
  );
}

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

function ToolsSection() {
  const [result, setResult] = useState<Awaited<ReturnType<typeof trpc.packages.list.query>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    trpc.packages.list
      .query({ workspaceId: PILOT_WORKSPACE, limit: 100, offset: 0 })
      .then(setResult)
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <div className="text-sm text-red-600 break-words max-w-2xl">{error}</div>;
  if (result === null) return <div className="text-sm text-muted-foreground">Loading…</div>;

  const available = result.items
    .filter((r) => r.state === "available" && r.packageName in PACKAGE_ROUTES)
    .map((r) => ({ ...PACKAGE_ROUTES[r.packageName]!, risk: r.computedRisk }));

  if (available.length === 0) {
    return (
      <div className="p-4 border rounded-md text-sm text-muted-foreground max-w-2xl">
        No modules installed yet — Tools appear here once an installed module reaches <code>available</code> state.
      </div>
    );
  }

  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {available.map((tool) => (
        <li key={tool.to} className="border rounded-md p-4">
          <Link to={tool.to} className="font-medium hover:underline">
            {tool.label}
          </Link>
          <p className="text-sm text-muted-foreground mt-1">{tool.desc}</p>
          <span className="mt-2 inline-block border rounded px-1.5 py-0.5 text-xs text-muted-foreground">{tool.risk}</span>
        </li>
      ))}
    </ul>
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
        {section === "tools" && <ToolsSection />}
        {section === "integrations" && <IntegrationsSection />}
        {section === "agents" && <NotWiredYet label="agent.list" note="registered agents" />}
        {section === "workflows" && (
          <div className="space-y-3">
            <NotWiredYet label="ritual.list" note="registered workflows" />
            <div className="flex gap-4 text-sm">
              <Link to="/rituals/new" className="underline">
                Create a workflow
              </Link>
              <Link to="/rituals/run" className="underline">
                Run a workflow
              </Link>
            </div>
          </div>
        )}
        {section === "skills" && <NotWiredYet label="capability.list" note="registered skills" />}
        {section === "commons" && <CommonsSection />}
      </div>
    </div>
  );
}
