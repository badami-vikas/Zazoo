/**
 * IntelligencePage — the cross-Module capability inventory (AP-086 / ADR-154).
 *
 * The left-nav "Intelligence" entry lands here. It answers "what can Bridge
 * actually do for me right now?" by flattening the governed capability bindings
 * of every installed Module into four tabs: Agents · Automations · Skills ·
 * Integrations. It deliberately does NOT render a list of Modules — the Modules
 * rail already does that, and per ADR-152 a Module opens on its data Page.
 *
 * Canon: Skills are never shown free-standing — each row names the Agent that
 * consumes it and the Module it came from, because only an attributable allowed
 * Agent may invoke a Skill. Data is manifest-sourced (`modules.list`) and
 * read-only here; the per-Module inventory stays at Module Detail.
 *
 * Honest empty states throughout (UI-RULES §6a): no dummy rows, ever.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Bot, Cable, ExternalLink, Sparkles, Wrench, Zap } from "lucide-react";
import { Header } from "../components/shared/Header";
import { PILOT_ORGANIZATION, trpc } from "../lib/trpc";

type ModuleRow = Awaited<ReturnType<typeof trpc.modules.list.query>>["items"][number];
type IntelligenceTab = "Agents" | "Automations" | "Skills" | "Integrations";

const TABS = [
  { id: "Agents" as const, icon: Bot },
  { id: "Automations" as const, icon: Zap },
  { id: "Skills" as const, icon: Wrench },
  { id: "Integrations" as const, icon: Cable },
];

/** One installed Module's manifest, narrowed to the rows we render. */
type Installed = {
  moduleName: string;
  displayName: string;
  version: string;
  module: NonNullable<NonNullable<ModuleRow["manifest"]>["module"]>;
  capabilities: NonNullable<ModuleRow["manifest"]>["capabilities"];
};

export function IntelligencePage() {
  const [rows, setRows] = useState<ModuleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<IntelligenceTab>("Agents");

  useEffect(() => {
    let active = true;
    trpc.modules.list
      .query({ organizationId: PILOT_ORGANIZATION, limit: 100, offset: 0 })
      .then((result) => {
        if (active) setRows(result.items);
      })
      .catch((cause) => {
        if (active) setError(String(cause));
      });
    return () => {
      active = false;
    };
  }, []);

  // Same installed-Module predicate the rail and Module Detail use.
  const installed = useMemo<Installed[]>(
    () =>
      (rows ?? [])
        .filter(
          (row) =>
            row.state === "available" &&
            row.status === "installed" &&
            row.manifest.module !== undefined &&
            row.moduleAttachment === undefined,
        )
        .map((row) => ({
          moduleName: row.moduleName,
          displayName: row.manifest.module?.displayName ?? row.manifest.name,
          version: row.moduleVersion,
          module: row.manifest.module!,
          capabilities: row.manifest.capabilities ?? [],
        })),
    [rows],
  );

  const agents = useMemo(
    () =>
      installed.flatMap((mod) =>
        mod.module.agents.map((agent) => ({ ...agent, mod })),
      ),
    [installed],
  );

  const automations = useMemo(
    () =>
      installed.flatMap((mod) =>
        mod.module.automations.map((automation) => ({
          ...automation,
          mod,
          agentName:
            mod.module.agents.find((agent) => agent.id === automation.agentId)?.name ??
            automation.agentId,
        })),
      ),
    [installed],
  );

  // Skills are listed through their consuming Agent — never free-standing.
  const skills = useMemo(
    () =>
      installed.flatMap((mod) =>
        mod.module.agents.flatMap((agent) =>
          agent.skillIds.map((skillId) => ({
            skillId,
            name:
              mod.capabilities.find(
                (capability) =>
                  capability.id === skillId && capability.capabilityType === "skill",
              )?.name ?? skillId,
            agentName: agent.name,
            mod,
          })),
        ),
      ),
    [installed],
  );

  const integrations = useMemo(
    () =>
      installed.flatMap((mod) =>
        mod.capabilities
          .filter((capability) => capability.capabilityType === "integration")
          .flatMap((capability) =>
            capability.connectors.map((connector) => ({
              ...connector,
              capabilityName: capability.name,
              mod,
            })),
          ),
      ),
    [installed],
  );

  const counts: Record<IntelligenceTab, number> = {
    Agents: agents.length,
    Automations: automations.length,
    Skills: skills.length,
    Integrations: integrations.length,
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <Header
        tabs={TABS.map((entry) => ({
          id: entry.id,
          icon: entry.icon,
          label: rows === null ? entry.id : `${entry.id} (${counts[entry.id]})`,
        }))}
        activeTab={tab}
        onTabChange={(id) => setTab(id as IntelligenceTab)}
      />

      <div className="flex-1 overflow-auto p-4">
        <div className="mb-4 flex items-center gap-2">
          <Sparkles className="size-4" style={{ color: "var(--color-steel)" }} />
          <p className="text-xs" style={{ color: "var(--color-warm-gray)" }}>
            Governed Agents, Automations, Skills, and Integrations provided by every installed Module.
          </p>
        </div>

        {error ? (
          <p role="alert" className="rounded-md border border-red-200 p-4 text-sm text-red-600">
            Intelligence could not load: {error}
          </p>
        ) : rows === null ? (
          <p className="text-xs" style={{ color: "var(--color-warm-gray)" }}>Loading Intelligence…</p>
        ) : installed.length === 0 ? (
          <EmptyNote text="No Modules are installed yet. The Agents, Automations, Skills, and Integrations they provide appear here once one is." />
        ) : tab === "Agents" ? (
          agents.length === 0 ? (
            <EmptyNote text="No attributable Agent bindings are declared by the installed Modules." />
          ) : (
            <Rows>
              {agents.map((agent) => (
                <Row
                  key={`${agent.mod.moduleName}:${agent.id}`}
                  icon={Bot}
                  title={agent.name}
                  // `plane` is optional in the manifest schema — several
                  // built-ins omit it, so never render "undefined plane".
                  subtitle={[
                    `${agent.skillIds.length} ${agent.skillIds.length === 1 ? "Skill" : "Skills"}`,
                    agent.plane ? `${agent.plane} plane` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  source={agent.mod}
                  // ADR-180: an Agent's Run surface is reached through the
                  // Agent, from its manifest-declared run_route. This is how
                  // Research Runs are reached now that /research is no longer a
                  // left-nav entry.
                  action={agent.runRoute ? { to: agent.runRoute, label: "Runs" } : undefined}
                />
              ))}
            </Rows>
          )
        ) : tab === "Automations" ? (
          automations.length === 0 ? (
            <EmptyNote text="No Automations are declared by the installed Modules." />
          ) : (
            <Rows>
              {automations.map((automation) => (
                <Row
                  key={`${automation.mod.moduleName}:${automation.id}`}
                  icon={Zap}
                  title={automation.name}
                  subtitle={`Trigger: ${automation.trigger} · Agent: ${automation.agentName}`}
                  source={automation.mod}
                  action={
                    automation.runRoute
                      ? { to: automation.runRoute, label: "Open" }
                      : undefined
                  }
                />
              ))}
            </Rows>
          )
        ) : tab === "Skills" ? (
          skills.length === 0 ? (
            <EmptyNote text="No Skills are bound to an Agent in the installed Modules." />
          ) : (
            <Rows>
              {skills.map((skill) => (
                <Row
                  key={`${skill.mod.moduleName}:${skill.agentName}:${skill.skillId}`}
                  icon={Wrench}
                  title={skill.name}
                  subtitle={`Invoked by: ${skill.agentName}`}
                  source={skill.mod}
                />
              ))}
            </Rows>
          )
        ) : integrations.length === 0 ? (
          <EmptyNote text="No Integration bindings are declared by the installed Modules." />
        ) : (
          <Rows>
            {integrations.map((connector, index) => (
              <Row
                key={`${connector.mod.moduleName}:${connector.id}:${index}`}
                icon={Cable}
                title={connector.id}
                subtitle={`Used by: ${connector.capabilityName}`}
                source={connector.mod}
                badge={
                  connector.externalSend
                    ? { icon: ExternalLink, label: "external send" }
                    : undefined
                }
              />
            ))}
          </Rows>
        )}
      </div>
    </div>
  );
}

function Rows({ children }: { children: React.ReactNode }) {
  return (
    <ul className="divide-y rounded-lg border" style={{ borderColor: "var(--color-border)" }}>
      {children}
    </ul>
  );
}

function Row({
  icon: Icon,
  title,
  subtitle,
  source,
  action,
  badge,
}: {
  icon: typeof Bot;
  title: string;
  subtitle: string;
  source: Installed;
  action?: { to: string; label: string };
  badge?: { icon: typeof ExternalLink; label: string };
}) {
  const BadgeIcon = badge?.icon;
  return (
    <li className="flex items-center gap-3 p-3">
      <Icon className="size-4 shrink-0" style={{ color: "var(--color-warm-gray)" }} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" style={{ color: "var(--color-navy)" }}>
          {title}
        </p>
        <p className="mt-0.5 text-xs" style={{ color: "var(--color-warm-gray)" }}>
          {subtitle}
        </p>
      </div>
      {/* Provenance, not the payload: which Module provides this capability.
          Canon keeps every installed Module clickable through to its
          manifest-driven Module Detail. */}
      <Link
        to={`/module/${encodeURIComponent(source.moduleName)}`}
        className="hidden shrink-0 rounded border px-1.5 py-0.5 text-xs no-underline hover:bg-[var(--color-surface)] sm:inline"
        style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}
        title={`Provided by ${source.displayName} v${source.version} — open Module Detail`}
      >
        {source.displayName}
      </Link>
      {BadgeIcon && (
        <span
          className="flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-xs"
          style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}
        >
          <BadgeIcon className="size-3" />
          {badge!.label}
        </span>
      )}
      {action && (
        <Link
          to={action.to}
          className="shrink-0 rounded-md border px-2 py-1 text-xs font-medium no-underline hover:bg-[var(--color-surface)]"
          style={{ borderColor: "var(--color-border)", color: "var(--color-steel)" }}
        >
          {action.label}
        </Link>
      )}
    </li>
  );
}

function EmptyNote({ text }: { text: string }) {
  return (
    <div
      className="rounded-lg border border-dashed p-4 text-xs"
      style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}
    >
      {text}
    </div>
  );
}
