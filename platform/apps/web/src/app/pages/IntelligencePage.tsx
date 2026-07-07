/**
 * Intelligence — the capability surface (user revision 2026-07-06 over
 * ADR-023: the bottom-bar Intelligence container owns capabilities, not the
 * Chief of Staff chat, which stays at /chief-of-staff as a pinnable tool).
 *
 * Tab order = biggest-to-smallest complexity, exactly per the revision:
 * Tools, Integrations, Agents, Workflows, Skills.
 *
 * - Tools = installed capability packages (ADR-020/021's "packages, not
 *   products"): DealPilot/JobPilot/Helpdesk are wired end-to-end
 *   (dealpilot.list / jobpilot.list / helpdesk.list), plus Chief of Staff.
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
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";

type IntelligenceSection = "tools" | "integrations" | "agents" | "workflows" | "skills";

const SECTIONS: { id: IntelligenceSection; label: string }[] = [
  { id: "tools", label: "Tools" },
  { id: "integrations", label: "Integrations" },
  { id: "agents", label: "Agents" },
  { id: "workflows", label: "Workflows" },
  { id: "skills", label: "Skills" },
];

const TOOLS = [
  { to: "/dealpilot", label: "DealPilot", desc: "Sourcing waterfall + thesis-fit scoring" },
  { to: "/jobpilot", label: "JobPilot", desc: "Job search tracker + application pipeline" },
  { to: "/helpdesk", label: "Helpdesk", desc: "Support ticket inbox + routing" },
  { to: "/chief-of-staff", label: "Chief of Staff", desc: "Conversational router — one governed route per turn" },
];

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

export function IntelligencePage() {
  const [section, setSection] = useState<IntelligenceSection>("tools");

  return (
    <div className="p-4 sm:p-6 space-y-4 w-full max-w-full overflow-x-hidden">
      <h1 className="text-lg font-medium">Intelligence</h1>

      <Tabs value={section} onValueChange={(v) => setSection(v as IntelligenceSection)}>
        <TabsList className="flex-wrap h-auto">
          {SECTIONS.map((s) => (
            <TabsTrigger key={s.id} value={s.id}>
              {s.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div>
        {section === "tools" && (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {TOOLS.map((tool) => (
              <li key={tool.to} className="border rounded-md p-4">
                <Link to={tool.to} className="font-medium hover:underline">
                  {tool.label}
                </Link>
                <p className="text-sm text-muted-foreground mt-1">{tool.desc}</p>
              </li>
            ))}
          </ul>
        )}
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
      </div>
    </div>
  );
}
