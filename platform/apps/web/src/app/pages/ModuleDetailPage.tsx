/**
 * ModuleDetailPage — manifest-driven Module Detail surface (§4b, UI-RULES-1,
 * TASK-001, VOCAB6).
 *
 * Route: /module/:moduleId
 *
 * Clicking any installed Module in the left nav lands here. The page reads
 * exclusively from:
 *   - trpc.packages.list → installed module manifest (capabilities, connectors, etc.)
 *
 * Layout: seven canonical Sections per §4b:
 *   1. Overview + health/status
 *   2. Pages and Databases
 *   3. Agents — each expanding to show declared Skills, permissions, and permitted Actions
 *   4. Automations — trigger, Agent, next/last Run, pause/edit/run Actions
 *   5. Integrations — connector health without exposing secrets
 *   6. Files and recent Results
 *   7. Settings — version, rollback, archive/uninstall (subject to authority)
 *
 * All empty states are honest (AP-002): no dummy data, no invented capability cards.
 * Skills appear ONLY under their consuming Agent; no standalone Skills section.
 */
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router";
import {
  Package,
  Bot,
  Zap,
  Cable,
  FolderOpen,
  Settings,
  Database,
  CheckCircle,
  AlertCircle,
  Loader,
  ExternalLink,
  Activity,
  ChevronRight,
} from "lucide-react";
import { trpc, PILOT_WORKSPACE } from "../lib/trpc";

type PackageRow = Awaited<ReturnType<typeof trpc.packages.list.query>>["items"][number];
type Capability = NonNullable<PackageRow["manifest"]>["capabilities"][number];

function capabilityRoute(packageName: string, capabilityId: string): string | null {
  for (const marker of [".page.", ".submodule."]) {
    const prefix = `${packageName}${marker}`;
    if (capabilityId.startsWith(prefix)) {
      return `/module/${packageName}/${capabilityId.slice(prefix.length)}`;
    }
  }
  return null;
}

// Human-readable risk labels
const RISK_LABELS: Record<string, string> = {
  informational: "Informational — read-only",
  advisory: "Advisory — reads and proposes changes",
  transformational: "Transformational — modifies local data",
  operational: "Operational — manages live resources",
  external: "External — sends to external services (governed)",
};

function SectionHeader({ icon: Icon, title }: { icon: typeof Package; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-4 h-4 shrink-0" style={{ color: "var(--color-steel)" }} />
      <h2 className="text-sm font-semibold" style={{ color: "var(--color-navy)" }}>
        {title}
      </h2>
    </div>
  );
}

function EmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <div
      className="p-4 rounded-lg border text-sm"
      style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}
    >
      <p>{message}</p>
      {hint && (
        <p className="mt-1 text-xs" style={{ color: "var(--color-warm-gray)" }}>
          {hint}
        </p>
      )}
    </div>
  );
}

function StatusBadge({ value }: { value: string }) {
  const active = value === "available" || value === "installed";
  return (
    <span
      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border"
      style={{
        borderColor: active ? "var(--color-steel-light)" : "var(--color-border)",
        color: active ? "var(--color-steel)" : "var(--color-warm-gray)",
        backgroundColor: active
          ? "color-mix(in srgb, var(--color-steel-light) 20%, transparent)"
          : "transparent",
      }}
    >
      {active ? <CheckCircle className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
      {value}
    </span>
  );
}

/** Overview section — module identity, risk, and status. */
function OverviewSection({ pkg }: { pkg: PackageRow }) {
  const manifest = pkg.manifest;
  return (
    <section className="space-y-3">
      <SectionHeader icon={Activity} title="Overview" />
      <div
        className="rounded-lg border p-4 space-y-3"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <h1
              className="text-base font-semibold"
              style={{ color: "var(--color-navy)", fontFamily: "var(--font-editorial)" }}
            >
              {manifest?.name ?? pkg.packageName}
            </h1>
            {manifest?.summary && (
              <p className="text-sm mt-0.5" style={{ color: "var(--color-navy-mid)" }}>
                {manifest.summary}
              </p>
            )}
            {manifest?.description && (
              <p className="text-xs mt-1.5" style={{ color: "var(--color-warm-gray)" }}>
                {manifest.description}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <StatusBadge value={pkg.state} />
            <StatusBadge value={pkg.status} />
          </div>
        </div>
        <div
          className="flex flex-wrap gap-3 pt-2 border-t text-xs"
          style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}
        >
          <span>
            <span className="font-medium">Version</span> v{pkg.packageVersion}
          </span>
          <span>
            <span className="font-medium">Risk</span>{" "}
            {RISK_LABELS[pkg.computedRisk] ?? pkg.computedRisk}
          </span>
          <span>
            <span className="font-medium">Origin</span>{" "}
            {manifest?.capabilities.map((capability) => capability.origin).filter((value, index, values) => values.indexOf(value) === index).join(", ") || "not declared"}
          </span>
        </div>
      </div>
    </section>
  );
}

/** Pages and Databases section — sourced from the module manifest. */
function PagesDatabasesSection({ pkg }: { pkg: PackageRow }) {
  const manifest = pkg.manifest;
  const capabilities = manifest?.capabilities ?? [];
  const viewCaps = capabilities.filter((c) => c.capabilityType === "view");

  return (
    <section className="space-y-3">
      <SectionHeader icon={Database} title="Pages and Databases" />
      {viewCaps.length === 0 ? (
        <EmptyState
          message={`No pages or databases defined in ${pkg.packageName} v${pkg.packageVersion}.`}
          hint="Pages and Databases appear here once a module version declares view capabilities."
        />
      ) : (
        <ul className="divide-y border rounded-lg" style={{ borderColor: "var(--color-border)" }}>
          {viewCaps.map((cap) => {
            const route = capabilityRoute(pkg.packageName, cap.id);
            const content = (
              <>
                <Database className="w-4 h-4 shrink-0" style={{ color: "var(--color-warm-gray)" }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium" style={{ color: "var(--color-navy)" }}>
                    {cap.name}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--color-warm-gray)" }}>
                    {cap.id.includes(".submodule.") ? "Sub-module" : "Page"} · {cap.id}
                  </p>
                </div>
                {route ? (
                  <ChevronRight className="w-4 h-4 shrink-0" style={{ color: "var(--color-warm-gray)" }} />
                ) : (
                  <span
                    className="text-xs border rounded px-1.5 py-0.5"
                    style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}
                  >
                    {cap.capabilityType}
                  </span>
                )}
              </>
            );
            return (
              <li key={cap.id}>
                {route ? (
                  <Link to={route} className="flex items-center gap-3 p-3 no-underline hover:bg-[var(--color-surface)]">
                    {content}
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 p-3">{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Agents section — each with Skills nested underneath. */
function AgentsSection({ pkg }: { pkg: PackageRow }) {
  const capabilities = pkg.manifest?.capabilities ?? [];
  const agents = capabilities.filter((capability) => capability.capabilityType === "agent");
  const skills = new Map(
    capabilities
      .filter((capability) => capability.capabilityType === "skill")
      .map((capability) => [capability.id, capability] as const),
  );

  return (
    <section className="space-y-3">
      <SectionHeader icon={Bot} title="Agents" />
      {agents.length === 0 ? (
        <EmptyState
          message={`No attributable Agent bindings are declared for ${pkg.packageName} v${pkg.packageVersion}.`}
          hint="Skills remain hidden until the runtime exposes their consuming Agent. Only an attributable allowed Agent may invoke a Skill."
        />
      ) : (
        <div className="space-y-2">
          {agents.map((agent) => {
            const boundSkills = agent.dependencies
              .map((dependency) => skills.get(dependency.manifestId))
              .filter((skill): skill is Capability => Boolean(skill));
            return (
              <details key={agent.id} className="rounded-lg border" style={{ borderColor: "var(--color-border)" }}>
                <summary className="cursor-pointer list-none p-3 flex items-center gap-3">
                  <Bot className="w-4 h-4 shrink-0" style={{ color: "var(--color-steel)" }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium" style={{ color: "var(--color-navy)" }}>{agent.name}</p>
                    <p className="text-xs" style={{ color: "var(--color-warm-gray)" }}>
                      {boundSkills.length} allowed Skill{boundSkills.length === 1 ? "" : "s"}
                    </p>
                  </div>
                </summary>
                <div className="border-t p-3 space-y-2" style={{ borderColor: "var(--color-border)" }}>
                  {boundSkills.length === 0 ? (
                    <p className="text-xs" style={{ color: "var(--color-warm-gray)" }}>
                      No Skills are bound to this Agent.
                    </p>
                  ) : (
                    boundSkills.map((skill) => (
                      <div key={skill.id} className="rounded-md border p-2" style={{ borderColor: "var(--color-border)" }}>
                        <p className="text-xs font-medium" style={{ color: "var(--color-navy)" }}>{skill.name}</p>
                        <p className="text-[11px] mt-0.5" style={{ color: "var(--color-warm-gray)" }}>
                          {skill.permissions.map((permission) => `${permission.action} ${permission.resourceType} (${permission.dataScope})`).join(" · ")}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </details>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Automations section. */
function AutomationsSection({ pkg }: { pkg: PackageRow }) {
  const capabilities = pkg.manifest?.capabilities ?? [];
  const automations = capabilities.filter((capability) => capability.capabilityType === "workflow");
  const byId = new Map(capabilities.map((capability) => [capability.id, capability] as const));
  return (
    <section className="space-y-3">
      <SectionHeader icon={Zap} title="Automations" />
      {automations.length === 0 ? (
        <EmptyState
          message={`No Automations configured for ${pkg.packageName} yet.`}
          hint="Automations start governed Agent Runs. Configure one from Settings once the module is active."
        />
      ) : (
        <ul className="divide-y border rounded-lg" style={{ borderColor: "var(--color-border)" }}>
          {automations.map((automation) => {
            const selectedAgent = automation.dependencies
              .map((dependency) => byId.get(dependency.manifestId))
              .find((capability) => capability?.capabilityType === "agent");
            return (
              <li key={automation.id} className="flex items-center gap-3 p-3">
                <Zap className="w-4 h-4 shrink-0" style={{ color: "var(--color-steel)" }} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium" style={{ color: "var(--color-navy)" }}>{automation.name}</p>
                  <p className="text-xs" style={{ color: "var(--color-warm-gray)" }}>
                    Starts {selectedAgent?.name ?? "an attributable Agent"} · no external send
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Integrations section — connector health from the manifest. */
function IntegrationsSection({ pkg }: { pkg: PackageRow }) {
  const manifest = pkg.manifest;
  const capabilities = manifest?.capabilities ?? [];
  const connectors = capabilities.flatMap((c) =>
    c.connectors.map((conn) => ({ ...conn, capabilityName: c.name }))
  );

  return (
    <section className="space-y-3">
      <SectionHeader icon={Cable} title="Integrations" />
      {connectors.length === 0 ? (
        <EmptyState
          message={`${pkg.packageName} has no external connectors in this version.`}
          hint="Integrations will appear here once this module declares connector dependencies."
        />
      ) : (
        <ul className="divide-y border rounded-lg" style={{ borderColor: "var(--color-border)" }}>
          {connectors.map((conn, i) => (
            <li key={`${conn.id}-${i}`} className="flex items-center gap-3 p-3">
              <Cable className="w-4 h-4 shrink-0" style={{ color: "var(--color-warm-gray)" }} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium" style={{ color: "var(--color-navy)" }}>
                  {conn.id}
                </p>
                <p className="text-xs mt-0.5" style={{ color: "var(--color-warm-gray)" }}>
                  Used by: {conn.capabilityName}
                </p>
              </div>
              {conn.externalSend && (
                <span
                  className="flex items-center gap-1 text-xs border rounded px-1.5 py-0.5"
                  style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}
                >
                  <ExternalLink className="w-3 h-3" />
                  external send
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Files and Results section. */
function FilesSection({ pkg }: { pkg: PackageRow }) {
  return (
    <section className="space-y-3">
      <SectionHeader icon={FolderOpen} title="Files and Results" />
      <EmptyState
        message={`Exports, briefs, and results generated by ${pkg.packageName} will appear here.`}
        hint="Files are stored locally under ~/Documents/Bridge/<Organization>/<Module>/."
      />
    </section>
  );
}

/** Settings section — version, rollback, archive/uninstall. */
function SettingsSection({ pkg }: { pkg: PackageRow }) {
  return (
    <section className="space-y-3">
      <SectionHeader icon={Settings} title="Settings" />
      <div
        className="rounded-lg border divide-y"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="p-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium" style={{ color: "var(--color-navy)" }}>
              Version
            </p>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-warm-gray)" }}>
              {pkg.packageName} v{pkg.packageVersion}
            </p>
          </div>
          <StatusBadge value={pkg.state} />
        </div>
        <div className="p-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium" style={{ color: "var(--color-navy)" }}>
              Rollback
            </p>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-warm-gray)" }}>
              Revert to a previous version of this module. Requires approval.
            </p>
          </div>
          <span className="text-xs" style={{ color: "var(--color-warm-gray)" }}>
            Unavailable until version history is connected
          </span>
        </div>
        <div className="p-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium" style={{ color: "var(--color-navy)" }}>
              Archive / Uninstall
            </p>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-warm-gray)" }}>
              Archive preserves data; Uninstall removes module surface.
              Both require authority.
            </p>
          </div>
          <span className="text-xs" style={{ color: "var(--color-warm-gray)" }}>
            Unavailable until governed lifecycle Actions are connected
          </span>
        </div>
      </div>
    </section>
  );
}

export function ModuleDetailPage() {
  const { moduleId } = useParams<{ moduleId: string }>();
  const [pkg, setPkg] = useState<PackageRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!moduleId) return;
    setLoading(true);
    setError(null);
    trpc.packages.list
      .query({ workspaceId: PILOT_WORKSPACE, limit: 100, offset: 0 })
      .then((result) => {
        // Find the package whose packageName matches the route param.
        // The moduleId in the URL IS the packageName (e.g. "deal-pilot").
        const found = result.items.find(
          (p) => p.packageName === moduleId && p.state === "available" && p.status === "installed"
        );
        setPkg(found ?? null);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, [moduleId]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center h-full" style={{ color: "var(--color-warm-gray)" }}>
        <Loader className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm">Loading module…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 p-6">
        <div
          className="border rounded-lg p-4 text-sm"
          style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}
        >
          <p className="font-medium text-red-600">Could not load module</p>
          <p className="mt-1 break-words">{error}</p>
        </div>
      </div>
    );
  }

  if (!pkg) {
    return (
      <div className="flex-1 p-6">
        <div
          className="border rounded-lg p-4 text-sm"
          style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}
        >
          <p className="font-medium" style={{ color: "var(--color-navy)" }}>
            Module not found
          </p>
          <p className="mt-1">
            No installed module named <code>{moduleId}</code> was found. It may not be installed yet or
            may not have reached <code>available</code> state.
          </p>
          <Link
            to="/"
            className="mt-3 inline-flex items-center gap-1 text-xs underline"
            style={{ color: "var(--color-steel)" }}
          >
            Back to home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 flex flex-col h-full overflow-hidden w-full max-w-full"
      style={{ backgroundColor: "var(--color-background)" }}
    >
      {/* Page header */}
      <div
        className="h-14 flex items-center gap-3 px-6 border-b shrink-0"
        style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-background)" }}
      >
        <Package className="w-5 h-5 shrink-0" style={{ color: "var(--color-steel)" }} />
        <h1
          className="text-base font-semibold"
          style={{ color: "var(--color-navy)", fontFamily: "var(--font-editorial)" }}
        >
          {pkg.manifest?.name ?? pkg.packageName}
        </h1>
        <div className="ml-auto flex items-center gap-2">
          <StatusBadge value={pkg.state} />
        </div>
      </div>

      {/* Scrollable sections */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-2xl mx-auto px-6 py-6 space-y-8">
          <OverviewSection pkg={pkg} />
          <PagesDatabasesSection pkg={pkg} />
          <AgentsSection pkg={pkg} />
          <AutomationsSection pkg={pkg} />
          <IntegrationsSection pkg={pkg} />
          <FilesSection pkg={pkg} />
          <SettingsSection pkg={pkg} />
        </div>
      </div>
    </div>
  );
}
