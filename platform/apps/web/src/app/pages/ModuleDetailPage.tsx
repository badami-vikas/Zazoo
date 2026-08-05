/**
 * ModuleDetailPage — manifest-driven Module Detail surface (§4b, UI-RULES-1,
 * TASK-001, VOCAB6).
 *
 * Route: /module/:moduleId
 *
 * Clicking any installed Module in the left nav lands here. The page reads
 * exclusively from:
 *   - trpc.modules.list → installed module manifest (capabilities, connectors, etc.)
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
  type LucideIcon,
  Boxes,
  Bot,
  Zap,
  Cable,
  Settings,
  Database,
  CheckCircle,
  AlertCircle,
  Loader,
  ExternalLink,
  Activity,
  History,
  ChevronRight,
} from "lucide-react";
import { trpc, PILOT_ORGANIZATION } from "../lib/trpc";
import { CommonsCapabilityPanel } from "../components/CommonsCapabilityPanel";
import { ModuleFilesSection } from "../components/shared/ModuleFilesSection";

type ModuleRow = Awaited<ReturnType<typeof trpc.modules.list.query>>["items"][number];

// Human-readable risk labels
const RISK_LABELS: Record<string, string> = {
  informational: "Informational — read-only",
  advisory: "Advisory — reads and proposes changes",
  transformational: "Transformational — modifies local data",
  operational: "Operational — manages live resources",
  external: "External — sends to external services (governed)",
};

function SectionHeader({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-4 h-4 shrink-0" style={{ color: "var(--color-steel)" }} />
      <h2 className="text-sm font-semibold" style={{ color: "var(--color-navy)" }}>
        {title}
      </h2>
    </div>
  );
}

function SubmodulesSection({ pkg }: { pkg: ModuleRow }) {
  const prefix = `${pkg.moduleName}.submodule.`;
  const submodules = (pkg.manifest?.capabilities ?? []).filter(
    (capability) => capability.capabilityType === "database" && capability.id.startsWith(prefix),
  );
  if (submodules.length === 0) return null;

  return (
    <section className="space-y-3">
      <SectionHeader icon={Boxes} title="Sub-modules" />
      <ul className="divide-y rounded-lg border" style={{ borderColor: "var(--color-border)" }}>
        {submodules.map((submodule) => (
          <li key={submodule.id}>
            <Link
              to={`/module/${pkg.moduleName}/${submodule.id.slice(prefix.length)}`}
              className="flex items-center gap-3 p-3 no-underline hover:bg-[var(--color-surface)]"
            >
              <Boxes className="h-4 w-4 shrink-0" style={{ color: "var(--color-steel)" }} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium" style={{ color: "var(--color-navy)" }}>{submodule.name}</p>
                <p className="mt-0.5 text-xs" style={{ color: "var(--color-warm-gray)" }}>{submodule.id}</p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--color-warm-gray)" }} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
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
      className="inline-flex items-center gap-1 text-xs"
      style={{
        color: active ? "var(--color-steel)" : "var(--color-warm-gray)",
      }}
    >
      {active ? <CheckCircle className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
      {value}
    </span>
  );
}

function RunsSection({ pkg, refreshKey }: { pkg: ModuleRow; refreshKey: number }) {
  type Run = Awaited<ReturnType<typeof trpc.modules.recentRuns.query>>["items"][number];
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setRuns(null);
    setError(null);
    void trpc.modules.recentRuns.query({
      organizationId: PILOT_ORGANIZATION,
      moduleName: pkg.moduleName,
      limit: 10,
    }).then((result) => {
      if (active) setRuns(result.items);
    }).catch((cause) => {
      if (active) setError(String(cause));
    });
    return () => {
      active = false;
    };
  }, [pkg.moduleName, refreshKey]);

  return (
    <section className="space-y-3">
      <SectionHeader icon={History} title="Recent Runs" />
      {error ? (
        <p role="alert" className="text-sm text-red-600 break-words">
          Recent Runs could not load: {error}
        </p>
      ) : runs === null ? (
        <p role="status" className="text-sm" style={{ color: "var(--color-warm-gray)" }}>
          Loading recent Runs…
        </p>
      ) : runs.length === 0 ? (
        <EmptyState
          message={`No Automation Runs have been recorded for ${pkg.moduleName}.`}
          hint="A Run appears here after a declared Automation starts its attributable Agent."
        />
      ) : (
        <div className="space-y-2">
          {runs.map((run) => (
            <details
              key={run.runId}
              className="rounded-lg border p-3"
              style={{ borderColor: "var(--color-border)" }}
            >
              <summary className="cursor-pointer text-sm font-medium" style={{ color: "var(--color-navy)" }}>
                {run.automationName} · {run.status.replace(/_/g, " ")}
              </summary>
              <dl className="mt-3 grid gap-1 text-xs" style={{ color: "var(--color-warm-gray)" }}>
                <div><dt className="inline font-medium">Run</dt> <dd className="inline break-all">{run.runId}</dd></div>
                <div><dt className="inline font-medium">Agent</dt> <dd className="inline break-all">{run.agentId}</dd></div>
                <div><dt className="inline font-medium">Started</dt> <dd className="inline">{new Date(run.startedAt).toLocaleString()}</dd></div>
                {run.finishedAt && <div><dt className="inline font-medium">Finished</dt> <dd className="inline">{new Date(run.finishedAt).toLocaleString()}</dd></div>}
              </dl>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

/** Overview section — module identity, risk, and status. */
function OverviewSection({ pkg }: { pkg: ModuleRow }) {
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
              {manifest?.module?.displayName ?? manifest?.name ?? pkg.moduleName}
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
            <span className="font-medium">Version</span> v{pkg.moduleVersion}
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
function PagesDatabasesSection({ pkg }: { pkg: ModuleRow }) {
  const manifest = pkg.manifest;
  const pages = manifest?.module?.pages ?? [];

  return (
    <section className="space-y-3">
      <SectionHeader icon={Database} title="Pages and Databases" />
      {pages.length === 0 ? (
        <EmptyState
          message={`No pages or databases defined in ${pkg.moduleName} v${pkg.moduleVersion}.`}
          hint="Pages and Databases appear here once a module version declares view capabilities."
        />
      ) : (
        <ul className="divide-y border rounded-lg" style={{ borderColor: "var(--color-border)" }}>
          {pages.map((page) => (
            <li
              key={page.id}
              className="flex items-center gap-3 p-3"
            >
              <Database className="w-4 h-4 shrink-0" style={{ color: "var(--color-warm-gray)" }} />
              <div className="flex-1 min-w-0">
                <Link
                  to={page.route}
                  className="text-sm font-medium underline-offset-2 hover:underline"
                  style={{ color: "var(--color-navy)" }}
                >
                  {page.name}
                </Link>
                <p className="text-xs mt-0.5" style={{ color: "var(--color-warm-gray)" }}>
                  Database: {page.databaseId}
                </p>
              </div>
              <span
                className="text-xs border rounded px-1.5 py-0.5"
                style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}
              >
                Open page
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Agents section — each with Skills nested underneath. */
function AgentsSection({
  pkg,
  attachments,
  onInstalled,
}: {
  pkg: ModuleRow;
  attachments: ModuleRow[];
  onInstalled: () => void;
}) {
  const agents = pkg.manifest?.module?.agents ?? [];
  const capabilities = new Map((pkg.manifest?.capabilities ?? []).map((capability) => [capability.id, capability]));
  const needs = pkg.manifest?.module?.commonsNeeds ?? [];
  const [skillRunStates, setSkillRunStates] = useState<Record<string, {
    status: "running" | "pending_review" | "error";
    proposalId?: string;
    message?: string;
  }>>({});

  const runInstalledSkill = async (attachment: ModuleRow, capabilityId: string) => {
    const key = `${attachment.id}:${capabilityId}`;
    setSkillRunStates((current) => ({ ...current, [key]: { status: "running" } }));
    try {
      const result = await trpc.commons.runInstalledSkill.mutate({
        organizationId: PILOT_ORGANIZATION,
        installationId: attachment.id,
      });
      setSkillRunStates((current) => ({
        ...current,
        [key]: {
          status: "pending_review",
          proposalId: result.proposal.id,
        },
      }));
    } catch (failure) {
      setSkillRunStates((current) => ({
        ...current,
        [key]: { status: "error", message: String(failure) },
      }));
    }
  };

  return (
    <section className="space-y-3">
      <SectionHeader icon={Bot} title="Agents" />
      {agents.length === 0 ? (
        <EmptyState
          message={`No attributable Agent bindings are declared for ${pkg.moduleName} v${pkg.moduleVersion}.`}
          hint="Skills remain hidden until an installed manifest binds them to a consuming Agent."
        />
      ) : (
        <div className="space-y-2">
          {agents.map((agent) => {
            const agentCapability = capabilities.get(agent.capabilityId);
            const attachedModules = attachments.filter((attachment) => attachment.moduleAttachment?.agentId === agent.id);
            const attachedSkills = attachedModules.flatMap((attachment) =>
              attachment.manifest.capabilities
                .filter((capability) => capability.capabilityType === "skill")
                .map((capability) => ({ capability, attachment }))
            );
            const totalSkills = agent.skillIds.length + attachedSkills.length;
            return (
              <details
                key={agent.id}
                id={`agent-${agent.id}`}
                className="rounded-lg border p-3"
                style={{ borderColor: "var(--color-border)" }}
              >
                <summary className="cursor-pointer text-sm font-medium" style={{ color: "var(--color-navy)" }}>
                  {agent.name} · {totalSkills} {totalSkills === 1 ? "Skill" : "Skills"}
                </summary>
                <div className="mt-3 space-y-3">
                  <div className="flex flex-wrap gap-1.5">
                    {(agentCapability?.permissions ?? []).map((permission, index) => (
                      <span
                        key={`${permission.resourceType}-${permission.action}-${index}`}
                        className="text-xs rounded border px-1.5 py-0.5"
                        style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}
                      >
                        {permission.action} {permission.resourceType}
                      </span>
                    ))}
                  </div>
                  <ul className="divide-y rounded border" style={{ borderColor: "var(--color-border)" }}>
                    {agent.skillIds.map((skillId) => {
                      const skill = capabilities.get(skillId);
                      return (
                        <li key={skillId} className="p-3">
                          <p className="text-sm font-medium" style={{ color: "var(--color-navy)" }}>
                            {skill?.name ?? skillId}
                          </p>
                          <p className="mt-0.5 text-xs" style={{ color: "var(--color-warm-gray)" }}>
                            {skillId} · invoked only by {agent.name}
                          </p>
                        </li>
                      );
                    })}
                    {attachedSkills.map(({ capability, attachment }) => {
                      const runKey = `${attachment.id}:${capability.id}`;
                      const runState = skillRunStates[runKey];
                      const runnable = attachment.runtimeSkillIds.includes(capability.id);
                      const bindingIssue = attachment.runtimeBindingIssues[0];
                      return (
                        <li key={`${attachment.id}-${capability.id}`} className="p-3 space-y-2">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium" style={{ color: "var(--color-navy)" }}>
                                {capability.name}
                              </p>
                              <p className="mt-0.5 text-xs break-all" style={{ color: "var(--color-warm-gray)" }}>
                                {capability.id} · installed from Commons · invoked only by {agent.name}
                              </p>
                            </div>
                            {runnable ? (
                              <button
                                type="button"
                                onClick={() => void runInstalledSkill(attachment, capability.id)}
                                disabled={runState?.status === "running"}
                                className="inline-flex shrink-0 items-center gap-1.5 rounded border px-2 py-1 text-xs disabled:opacity-60"
                                style={{ borderColor: "var(--color-border)", color: "var(--color-steel)" }}
                              >
                                {runState?.status === "running" ? <Loader className="h-3 w-3 animate-spin" /> : <Bot className="h-3 w-3" />}
                                {runState?.status === "running" ? "Running…" : `Run with ${agent.name}`}
                              </button>
                            ) : (
                              <span
                                className="shrink-0 rounded border px-2 py-1 text-xs"
                                style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}
                              >
                                Runtime binding unavailable
                              </span>
                            )}
                          </div>
                          {!runnable && bindingIssue && (
                            <p className="text-xs break-words" style={{ color: "var(--destructive)" }}>
                              {bindingIssue}
                            </p>
                          )}
                          {runState && runState.status !== "running" && (
                            <p
                              className="text-xs break-words"
                              style={{ color: runState.status === "error" ? "var(--destructive)" : "var(--color-warm-gray)" }}
                            >
                              {runState.status === "error"
                                ? `Run failed: ${runState.message}`
                                : `Proposal ${runState.proposalId} is awaiting review. `}
                              {runState.status === "pending_review" && (
                                <Link to="/approvals" className="font-medium underline" style={{ color: "var(--color-steel)" }}>
                                  Review or correct in Approvals
                                </Link>
                              )}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {needs.filter((need) => need.agentId === agent.id).map((need) => (
                    <CommonsCapabilityPanel
                      key={need.id}
                      ownerModuleName={pkg.moduleName}
                      need={need}
                      installed={attachedModules.find((attachment) => attachment.moduleAttachment?.needId === need.id)}
                      onInstalled={onInstalled}
                    />
                  ))}
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
function AutomationsSection({
  pkg,
  onRunRecorded,
}: {
  pkg: ModuleRow;
  onRunRecorded: () => void;
}) {
  const automations = pkg.manifest?.module?.automations ?? [];
  const runtimeAutomationIds = new Set(pkg.runtimeAutomationIds);
  const agents = new Map((pkg.manifest?.module?.agents ?? []).map((agent) => [agent.id, agent]));
  const [runStates, setRunStates] = useState<Record<string, {
    status: "running" | "completed" | "halted" | "error";
    runId?: string;
    needsReview?: boolean;
    message?: string;
  }>>({});

  const runAutomation = async (automationId: string, manifestAutomationId: string) => {
    setRunStates((current) => ({ ...current, [automationId]: { status: "running" } }));
    try {
      const result = await trpc.automation.runById.mutate({
        organizationId: PILOT_ORGANIZATION,
        automationId: manifestAutomationId,
        moduleName: pkg.moduleName,
      });
      setRunStates((current) => ({
        ...current,
        [automationId]: {
          status: result.status,
          runId: result.runId,
          needsReview: result.proposals.some((proposal) => proposal.status === "pending_review"),
        },
      }));
      onRunRecorded();
    } catch (failure) {
      setRunStates((current) => ({
        ...current,
        [automationId]: { status: "error", message: String(failure) },
      }));
    }
  };

  return (
    <section className="space-y-3">
      <SectionHeader icon={Zap} title="Automations" />
      {automations.length === 0 ? (
        <EmptyState
          message={`No Automations are declared by ${pkg.moduleName} v${pkg.moduleVersion}.`}
          hint="This inventory reads the installed manifest; it does not invent Automation cards."
        />
      ) : (
        <ul className="divide-y rounded-lg border" style={{ borderColor: "var(--color-border)" }}>
          {automations.map((automation) => {
            const runState = runStates[automation.id];
            return (
            <li key={automation.id} className="p-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium" style={{ color: "var(--color-navy)" }}>{automation.name}</p>
                  <p className="mt-0.5 text-xs" style={{ color: "var(--color-warm-gray)" }}>
                    Trigger: {automation.trigger} · Agent: {agents.get(automation.agentId)?.name ?? automation.agentId}
                  </p>
                </div>
                {automation.automationId && runtimeAutomationIds.has(automation.id) ? (
                  automation.runRoute ? (
                    <Link
                      to={automation.runRoute}
                      className="inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs"
                      style={{ borderColor: "var(--color-border)", color: "var(--color-steel)" }}
                    >
                      Open context
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void runAutomation(automation.id, automation.automationId!)}
                      disabled={runState?.status === "running"}
                      className="inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs disabled:opacity-60"
                      style={{ borderColor: "var(--color-border)", color: "var(--color-steel)" }}
                    >
                      {runState?.status === "running" ? <Loader className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                      {runState?.status === "running" ? "Running…" : "Run"}
                    </button>
                  )
                ) : (
                  <span className="rounded border px-2 py-1 text-xs" style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}>
                    Runtime binding pending
                  </span>
                )}
              </div>
              <p className="text-xs break-all" style={{ color: "var(--color-warm-gray)" }}>
                Procedure: {automation.procedure}
              </p>
              {runState && runState.status !== "running" && (
                <div className="text-xs" style={{ color: runState.status === "error" ? "var(--destructive)" : "var(--color-warm-gray)" }}>
                  {runState.status === "error"
                    ? `Run failed: ${runState.message}`
                    : `Run ${runState.runId} ${runState.status}.`}
                  {runState.needsReview && (
                    <>
                      {" "}
                      <Link to="/approvals" className="font-medium underline" style={{ color: "var(--color-steel)" }}>
                        Review or correct in Approvals
                      </Link>
                    </>
                  )}
                </div>
              )}
            </li>
          )})}
        </ul>
      )}
    </section>
  );
}

/** Integrations section — connector health from the manifest. */
function IntegrationsSection({ pkg }: { pkg: ModuleRow }) {
  const manifest = pkg.manifest;
  const capabilities = manifest?.capabilities ?? [];
  const integrations = capabilities.filter((capability) => capability.capabilityType === "integration");
  const connectors = integrations.flatMap((capability) =>
    capability.connectors.map((connector) => ({ ...connector, capabilityName: capability.name }))
  );

  return (
    <section className="space-y-3">
      <SectionHeader icon={Cable} title="Integrations" />
      {connectors.length === 0 ? (
        <EmptyState
          message={`${pkg.moduleName} has no Integration bindings in this version.`}
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

/** Settings section — version, rollback, archive/uninstall. */
function SettingsSection({ pkg }: { pkg: ModuleRow }) {
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
              {pkg.moduleName} v{pkg.moduleVersion}
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
  const [pkg, setPkg] = useState<ModuleRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<ModuleRow[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [runsRefreshKey, setRunsRefreshKey] = useState(0);

  useEffect(() => {
    if (!moduleId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPkg(null);
    setAttachments([]);
    trpc.modules.list
      .query({ organizationId: PILOT_ORGANIZATION, limit: 100, offset: 0 })
      .then((result) => {
        if (cancelled) return;
        // Find the module whose moduleName matches the route param.
        // The moduleId in the URL IS the moduleName (e.g. "deal-pilot").
        const found = result.items.find(
          (p) => p.moduleName === moduleId && p.state === "available" && p.status === "installed"
        );
        setPkg(found ?? null);
        setAttachments(
          result.items.filter(
            (item) =>
              item.moduleAttachment?.ownerModuleName === moduleId &&
              item.state === "available" &&
              item.status === "installed"
          )
        );
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [moduleId, refreshKey]);

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
        <Boxes className="w-5 h-5 shrink-0" style={{ color: "var(--color-steel)" }} />
        <h1
          className="text-base font-semibold"
          style={{ color: "var(--color-navy)", fontFamily: "var(--font-editorial)" }}
        >
          {pkg.manifest?.module?.displayName ?? pkg.manifest?.name ?? pkg.moduleName}
        </h1>
        <div className="ml-auto flex items-center gap-2">
          <StatusBadge value={pkg.state} />
        </div>
      </div>

      {/* Scrollable sections */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-8">
          <OverviewSection pkg={pkg} />
          <PagesDatabasesSection pkg={pkg} />
          <SubmodulesSection pkg={pkg} />
          <AgentsSection pkg={pkg} attachments={attachments} onInstalled={() => setRefreshKey((value) => value + 1)} />
          <AutomationsSection
            pkg={pkg}
            onRunRecorded={() => setRunsRefreshKey((value) => value + 1)}
          />
          <RunsSection pkg={pkg} refreshKey={runsRefreshKey} />
          <IntegrationsSection pkg={pkg} />
          <ModuleFilesSection moduleName={pkg.moduleName} title="Files and Results" />
          <SettingsSection pkg={pkg} />
        </div>
      </div>
    </div>
  );
}
