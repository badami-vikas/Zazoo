/**
 * ModuleIntelligenceSection — the standard per-page "Intelligence" section
 * (user request 2026-07-27). Sits below the artefacts / Files section and shows
 * the Module's capability bindings under three tabs: Agents · Automations ·
 * Integrations. Data is manifest-sourced (modules.list).
 *
 * NO "MANAGE IN MODULE DETAIL" (user directive 2026-09-06). That button linked
 * to /module/:name, which renders THIS Section and the Governance one below it —
 * the same two Sections the reader was already looking at. It was a hop from a
 * surface to itself, so nothing moved inline with it; it is simply gone.
 *
 * Honest empty states throughout (UI-RULES §6a): no dummy rows, ever, and a
 * short line rather than a definition of what is missing.
 */
import { useEffect, useMemo, useState } from "react";
import { Sparkles, Bot, Zap, Cable, ExternalLink } from "lucide-react";
import { Link } from "react-router";
import { trpc, PILOT_ORGANIZATION } from "../../lib/trpc";

type ModuleRow = Awaited<ReturnType<typeof trpc.modules.list.query>>["items"][number];
type IntelligenceTab = "agents" | "automations" | "integrations";

const TABS: { id: IntelligenceTab; label: string; icon: typeof Bot }[] = [
  { id: "agents", label: "Agents", icon: Bot },
  { id: "automations", label: "Automations", icon: Zap },
  { id: "integrations", label: "Integrations", icon: Cable },
];

export function ModuleIntelligenceSection({
  moduleName,
  title = "Intelligence",
}: {
  moduleName: string;
  title?: string;
}) {
  const [pkg, setPkg] = useState<ModuleRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<IntelligenceTab>("agents");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setPkg(null);
    trpc.modules.list
      .query({ organizationId: PILOT_ORGANIZATION, limit: 100, offset: 0 })
      .then((res) => {
        if (!active) return;
        setPkg(res.items.find((item) => item.moduleName === moduleName) ?? null);
      })
      .catch((cause) => {
        if (active) setError(String(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [moduleName]);

  const agents = useMemo(() => pkg?.manifest?.module?.agents ?? [], [pkg]);
  const automations = useMemo(() => pkg?.manifest?.module?.automations ?? [], [pkg]);
  const agentNames = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent.name])),
    [agents],
  );
  const connectors = useMemo(() => {
    const capabilities = pkg?.manifest?.capabilities ?? [];
    return capabilities
      .filter((capability) => capability.capabilityType === "integration")
      .flatMap((capability) =>
        capability.connectors.map((connector) => ({ ...connector, capabilityName: capability.name })),
      );
  }, [pkg]);

  return (
    <section className="space-y-3" aria-labelledby={`${moduleName}-intelligence-title`}>
      <div className="flex items-center gap-2">
        <Sparkles className="size-4" style={{ color: "var(--color-steel)" }} />
        <h2 id={`${moduleName}-intelligence-title`} className="text-sm font-semibold" style={{ color: "var(--color-navy)" }}>
          {title}
        </h2>
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label={`${title} sections`}
        className="flex items-center gap-1 border-b"
        style={{ borderColor: "var(--color-border)" }}
      >
        {TABS.map((entry) => {
          const active = tab === entry.id;
          const Icon = entry.icon;
          const count =
            entry.id === "agents" ? agents.length : entry.id === "automations" ? automations.length : connectors.length;
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(entry.id)}
              className="relative -mb-px flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors"
              style={{
                color: active ? "var(--color-steel)" : "var(--color-warm-gray)",
                borderBottom: active ? "2px solid var(--color-steel)" : "2px solid transparent",
              }}
            >
              <Icon className="size-3.5" />
              {entry.label}
              <span
                className="rounded-full px-1.5 text-[10px]"
                style={{ backgroundColor: "var(--color-surface)", color: "var(--color-warm-gray)" }}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Panel */}
      <div role="tabpanel">
        {loading ? (
          <p className="text-xs" style={{ color: "var(--color-warm-gray)" }}>Loading Module intelligence…</p>
        ) : error ? (
          <p role="alert" className="break-words text-xs text-red-600">{error}</p>
        ) : pkg === null ? (
          <EmptyNote text={`“${moduleName}” is not installed yet.`} />
        ) : tab === "agents" ? (
          agents.length === 0 ? (
            <EmptyNote text="No Agents." />
          ) : (
            <ul className="divide-y rounded-lg border" style={{ borderColor: "var(--color-border)" }}>
              {agents.map((agent) => (
                <li key={agent.id} className="flex items-center gap-3 p-3">
                  <Bot className="size-4 shrink-0" style={{ color: "var(--color-warm-gray)" }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" style={{ color: "var(--color-navy)" }}>{agent.name}</p>
                    <p className="mt-0.5 text-xs" style={{ color: "var(--color-warm-gray)" }}>
                      {agent.skillIds.length} {agent.skillIds.length === 1 ? "Skill" : "Skills"}
                    </p>
                  </div>
                  {/* ADR-180: an Agent's Run surface (e.g. Research Runs for the
                      Learning Agent) is reached through the Agent that owns it,
                      from the manifest's run_route — never a nav entry. */}
                  {agent.runRoute && (
                    <Link
                      to={agent.runRoute}
                      className="shrink-0 rounded-md border px-2 py-1 text-xs font-medium no-underline hover:bg-[var(--color-surface)]"
                      style={{ borderColor: "var(--color-border)", color: "var(--color-steel)" }}
                    >
                      Runs
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )
        ) : tab === "automations" ? (
          automations.length === 0 ? (
            <EmptyNote text="No Automations." />
          ) : (
            <ul className="divide-y rounded-lg border" style={{ borderColor: "var(--color-border)" }}>
              {automations.map((automation) => (
                <li key={automation.id} className="flex items-center gap-3 p-3">
                  <Zap className="size-4 shrink-0" style={{ color: "var(--color-warm-gray)" }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" style={{ color: "var(--color-navy)" }}>{automation.name}</p>
                    <p className="mt-0.5 text-xs" style={{ color: "var(--color-warm-gray)" }}>
                      Trigger: {automation.trigger} · Agent: {agentNames.get(automation.agentId) ?? automation.agentId}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : connectors.length === 0 ? (
          <EmptyNote text="No Integrations." />
        ) : (
          <ul className="divide-y rounded-lg border" style={{ borderColor: "var(--color-border)" }}>
            {connectors.map((connector, index) => (
              <li key={`${connector.id}-${index}`} className="flex items-center gap-3 p-3">
                <Cable className="size-4 shrink-0" style={{ color: "var(--color-warm-gray)" }} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" style={{ color: "var(--color-navy)" }}>{connector.id}</p>
                  <p className="mt-0.5 text-xs" style={{ color: "var(--color-warm-gray)" }}>Used by: {connector.capabilityName}</p>
                </div>
                {connector.externalSend && (
                  <span
                    className="flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs"
                    style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}
                  >
                    <ExternalLink className="size-3" />
                    external send
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
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
