/**
 * Initiative Control Panel (/initiative/:id/control-panel) — per-Initiative
 * admin, strictly scoped to ONE Initiative. Answers "How is this Initiative
 * configured?"; changes here never affect other Initiatives. Platform-wide
 * admin lives in Settings (ADR-029 separation).
 *
 * One unified table: Category · Name · Status · Source Module · Version ·
 * Scope · Actions. Rows are REAL queryable resources only:
 *   - Modules      = `packages.list` (Drizzle-backed package installations)
 *   - Integrations = `integration.list` + `google.list` (connected sources)
 * The API has NO per-initiative resource binding yet (packages/integrations/
 * Automations are all workspace-scoped; no `automation.list` or `agent.list` read
 * procedure exists) — so Scope honestly reads "Organization-wide", and
 * categories with no backing data render an honest note row instead of
 * fabricated rows. Gaps tracked in docs/BUGS.md.
 */
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { SlidersHorizontal, ExternalLink } from "lucide-react";
import { trpc, PILOT_WORKSPACE } from "../lib/trpc";
import { getInitiatives } from "../data/initiatives";
import { MODULE_ROUTES } from "../lib/moduleRoutes";
import { Header } from "../components/shared/Header";

interface PanelRow {
  key: string;
  category: string;
  name: string;
  status: string;
  sourceModule: string;
  version: string;
  scope: string;
  action?: { to: string; label: string };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ControlPanelPage() {
  const { id } = useParams();
  const iid = id ? decodeURIComponent(id) : "";
  const [initiativeName, setInitiativeName] = useState<string | null>(null);
  const [rows, setRows] = useState<PanelRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Resolve the initiative name from whichever real store owns this id:
    // kernel rows (uuid → graph.getInitiative) or the local Work-surface store.
    const local = getInitiatives().find((i) => i.id === iid);
    if (local) setInitiativeName(local.name);
    else if (UUID_RE.test(iid)) {
      trpc.graph.getInitiative
        .query({ id: iid })
        .then((row) => setInitiativeName(row?.title ?? iid))
        .catch(() => setInitiativeName(iid));
    } else setInitiativeName(iid);
  }, [iid]);

  useEffect(() => {
    Promise.all([
      trpc.packages.list.query({ workspaceId: PILOT_WORKSPACE, limit: 100, offset: 0 }),
      trpc.integration.list.query({ workspaceId: PILOT_WORKSPACE, limit: 100, offset: 0 }),
      trpc.google.list.query().catch(() => null),
    ])
      .then(([pkgs, integrations, google]) => {
        const next: PanelRow[] = [];

        for (const p of pkgs.items) {
          const route = MODULE_ROUTES[p.packageName];
          next.push({
            key: `module-${p.id}`,
            category: "Module",
            name: route?.label ?? p.packageName,
            status: p.state,
            sourceModule: route?.label ?? p.packageName,
            version: p.packageVersion,
            scope: "Organization-wide",
            ...(route && p.state === "available" ? { action: { to: route.to, label: "Open" } } : {}),
          });
        }

        for (const i of integrations.items) {
          next.push({
            key: `integration-${i.id}`,
            category: "Integration",
            name: i.provider,
            status: i.status ?? "connected",
            sourceModule: "—",
            version: "—",
            scope: "Organization-wide",
          });
        }

        if (google) {
          next.push({
            key: "integration-google",
            category: "Integration",
            name: "Google (Gmail + Calendar)",
            status: google.connection?.connected ? "connected" : "not connected",
            sourceModule: "—",
            version: "—",
            scope: "Organization-wide",
            action: { to: "/integrations/google", label: "Open" },
          });
        }

        setRows(next);
      })
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Shared Header with a single tab = plain centered title. */}
      <Header tabs={[{ id: "Control Panel", icon: SlidersHorizontal }]} activeTab="Control Panel" onTabChange={() => {}} />

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          <div>
            <h1 className="text-lg font-medium">
              {initiativeName ?? "…"}
            </h1>
            <p className="text-sm text-muted-foreground">
              How is this Initiative configured? Changes here never affect other Initiatives.{" "}
              <Link to={`/initiative/${encodeURIComponent(iid)}`} className="underline">
                Back to the Initiative
              </Link>
            </p>
          </div>

          {error && <div className="text-sm text-red-600 break-words">{error}</div>}
          {!error && rows === null && <div className="text-sm text-muted-foreground">Loading…</div>}

          {rows !== null && (
            <div className="border rounded-md overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="border-b bg-muted/40">
                  <tr>
                    {["Category", "Name", "Status", "Source Module", "Version", "Scope", "Actions"].map((h) => (
                      <th key={h} className="px-3 py-2 text-xs font-medium text-muted-foreground whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} className="border-b last:border-b-0">
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{r.category}</td>
                      <td className="px-3 py-2 font-medium whitespace-nowrap">{r.name}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="border rounded px-1.5 py-0.5 text-xs text-muted-foreground">{r.status}</span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.sourceModule}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.version}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{r.scope}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {r.action ? (
                          <Link to={r.action.to} className="inline-flex items-center gap-1 underline">
                            {r.action.label} <ExternalLink className="w-3 h-3" />
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-sm text-muted-foreground">
                        Nothing configured for this Initiative yet.
                      </td>
                    </tr>
                  )}
                  {/* Honest note rows — categories with no queryable backing yet. */}
                  <tr className="border-t">
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">Automation</td>
                    <td colSpan={6} className="px-3 py-2 text-xs text-muted-foreground">
                      No Automations can be listed yet — the platform has no read endpoint for them.
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">Assistant</td>
                    <td colSpan={6} className="px-3 py-2 text-xs text-muted-foreground">
                      No Assistants can be listed yet — the platform has no read endpoint for them.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {rows !== null && (
            <p className="text-xs text-muted-foreground">
              Resources are not yet bound to individual Initiatives — everything above is currently shared
              Organization-wide. Per-Initiative scoping will appear here once it exists.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
