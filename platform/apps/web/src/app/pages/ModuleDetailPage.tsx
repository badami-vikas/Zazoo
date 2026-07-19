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
import { CommonsCapabilityPanel } from "../components/CommonsCapabilityPanel";

type PackageRow = Awaited<ReturnType<typeof trpc.packages.list.query>>["items"][number];
type FileInventory = Awaited<ReturnType<typeof trpc.packages.files.query>>;

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

function SubmodulesSection({ pkg }: { pkg: PackageRow }) {
  const prefix = `${pkg.packageName}.submodule.`;
  const submodules = (pkg.manifest?.capabilities ?? []).filter(
    (capability) => capability.capabilityType === "view" && capability.id.startsWith(prefix),
  );
  if (submodules.length === 0) return null;

  return (
    <section className="space-y-3">
      <SectionHeader icon={Package} title="Sub-modules" />
      <ul className="divide-y rounded-lg border" style={{ borderColor: "var(--color-border)" }}>
        {submodules.map((submodule) => (
          <li key={submodule.id}>
            <Link
              to={`/module/${pkg.packageName}/${submodule.id.slice(prefix.length)}`}
              className="flex items-center gap-3 p-3 no-underline hover:bg-[var(--color-surface)]"
            >
              <Package className="h-4 w-4 shrink-0" style={{ color: "var(--color-steel)" }} />
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
              {manifest?.module?.displayName ?? manifest?.name ?? pkg.packageName}
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
  const pages = manifest?.module?.pages ?? [];

  return (
    <section className="space-y-3">
      <SectionHeader icon={Database} title="Pages and Databases" />
      {pages.length === 0 ? (
        <EmptyState
          message={`No pages or databases defined in ${pkg.packageName} v${pkg.packageVersion}.`}
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
  pkg: PackageRow;
  attachments: PackageRow[];
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

  const runInstalledSkill = async (attachment: PackageRow, capabilityId: string) => {
    const key = `${attachment.id}:${capabilityId}`;
    setSkillRunStates((current) => ({ ...current, [key]: { status: "running" } }));
    try {
      const result = await trpc.commons.runInstalledSkill.mutate({
        workspaceId: PILOT_WORKSPACE,
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
          message={`No attributable Agent bindings are declared for ${pkg.packageName} v${pkg.packageVersion}.`}
          hint="Skills remain hidden until an installed manifest binds them to a consuming Agent."
        />
      ) : (
        <div className="space-y-2">
          {agents.map((agent) => {
            const agentCapability = capabilities.get(agent.capabilityId);
            const attachedPackages = attachments.filter((attachment) => attachment.moduleAttachment?.agentId === agent.id);
            const attachedSkills = attachedPackages.flatMap((attachment) =>
              attachment.manifest.capabilities
                .filter((capability) => capability.capabilityType === "skill")
                .map((capability) => ({ capability, attachment }))
            );
            const totalSkills = agent.skillIds.length + attachedSkills.length;
            return (
              <details
                key={agent.id}
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
                      modulePackageName={pkg.packageName}
                      need={need}
                      installed={attachedPackages.find((attachment) => attachment.moduleAttachment?.needId === need.id)}
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
function AutomationsSection({ pkg }: { pkg: PackageRow }) {
  const automations = pkg.manifest?.module?.automations ?? [];
  const runtimeAutomationIds = new Set(pkg.runtimeAutomationIds);
  const agents = new Map((pkg.manifest?.module?.agents ?? []).map((agent) => [agent.id, agent]));
  const [runStates, setRunStates] = useState<Record<string, {
    status: "running" | "completed" | "halted" | "error";
    runId?: string;
    needsReview?: boolean;
    message?: string;
  }>>({});

  const runAutomation = async (automationId: string, ritualId: string) => {
    setRunStates((current) => ({ ...current, [automationId]: { status: "running" } }));
    try {
      const result = await trpc.ritual.runById.mutate({
        workspaceId: PILOT_WORKSPACE,
        ritualId,
        modulePackageName: pkg.packageName,
      });
      setRunStates((current) => ({
        ...current,
        [automationId]: {
          status: result.status,
          runId: result.runId,
          needsReview: result.proposals.some((proposal) => proposal.status === "pending_review"),
        },
      }));
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
          message={`No Automations are declared by ${pkg.packageName} v${pkg.packageVersion}.`}
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
                {automation.ritualId && runtimeAutomationIds.has(automation.id) ? (
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
                      onClick={() => void runAutomation(automation.id, automation.ritualId!)}
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
function IntegrationsSection({ pkg }: { pkg: PackageRow }) {
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
          message={`${pkg.packageName} has no Integration bindings in this version.`}
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
function FilesSection({
  pkg,
  inventory,
  loading,
  error,
}: {
  pkg: PackageRow;
  inventory: FileInventory | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <section className="space-y-3">
      <SectionHeader icon={FolderOpen} title="Files and Results" />
      {loading ? (
        <div className="text-sm" style={{ color: "var(--color-warm-gray)" }}>Loading local File inventory…</div>
      ) : error ? (
        <div className="rounded-lg border p-3 text-sm text-red-600" style={{ borderColor: "var(--color-border)" }}>
          Could not read local Files: {error}
        </div>
      ) : inventory && inventory.items.length > 0 ? (
        <div className="rounded-lg border" style={{ borderColor: "var(--color-border)" }}>
          <p className="border-b p-3 text-xs break-all" style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}>
            {inventory.root}
          </p>
          <ul className="divide-y" style={{ borderColor: "var(--color-border)" }}>
            {inventory.items.map((file) => (
              <li key={file.path} className="p-3">
                <p className="text-sm font-medium break-all" style={{ color: "var(--color-navy)" }}>{file.path}</p>
                <p className="mt-0.5 text-xs" style={{ color: "var(--color-warm-gray)" }}>
                  {file.size.toLocaleString()} bytes · {new Date(file.modifiedAt).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <EmptyState
          message={`No Files currently exist in ${pkg.manifest?.module?.displayName ?? pkg.packageName}'s local inventory.`}
          hint={inventory?.root ?? "The local File inventory path could not be resolved."}
        />
      )}
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
  const [files, setFiles] = useState<FileInventory | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<PackageRow[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!moduleId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPkg(null);
    setFiles(null);
    setFilesError(null);
    setFilesLoading(false);
    setAttachments([]);
    trpc.packages.list
      .query({ workspaceId: PILOT_WORKSPACE, limit: 100, offset: 0 })
      .then((result) => {
        if (cancelled) return;
        // Find the package whose packageName matches the route param.
        // The moduleId in the URL IS the packageName (e.g. "deal-pilot").
        const found = result.items.find(
          (p) => p.packageName === moduleId && p.state === "available" && p.status === "installed"
        );
        setPkg(found ?? null);
        setAttachments(
          result.items.filter(
            (item) =>
              item.moduleAttachment?.modulePackageName === moduleId &&
              item.state === "available" &&
              item.status === "installed"
          )
        );
        if (found) {
          setFilesLoading(true);
          trpc.packages.files
            .query({ workspaceId: PILOT_WORKSPACE, moduleName: found.packageName })
            .then((inventory) => {
              if (!cancelled) setFiles(inventory);
            })
            .catch((filesFailure) => {
              if (!cancelled) setFilesError(String(filesFailure));
            })
            .finally(() => {
              if (!cancelled) setFilesLoading(false);
            });
        }
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
        <Package className="w-5 h-5 shrink-0" style={{ color: "var(--color-steel)" }} />
        <h1
          className="text-base font-semibold"
          style={{ color: "var(--color-navy)", fontFamily: "var(--font-editorial)" }}
        >
          {pkg.manifest?.module?.displayName ?? pkg.manifest?.name ?? pkg.packageName}
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
          <AutomationsSection pkg={pkg} />
          <IntegrationsSection pkg={pkg} />
          <FilesSection pkg={pkg} inventory={files} loading={filesLoading} error={filesError} />
          <SettingsSection pkg={pkg} />
        </div>
      </div>
    </div>
  );
}
