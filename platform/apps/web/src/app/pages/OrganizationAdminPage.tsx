import { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, Users } from "lucide-react";
import { defaultViewConfig, type TableSpec, type ViewConfig } from "@bridge/tables";
import { trpc, PILOT_ORGANIZATION } from "../lib/trpc";
import { Header } from "../components/shared/Header";
import { ModuleSurfaceLayout } from "../components/shared/ModuleSurfaceLayout";
import { DashboardRow } from "../components/shared/DashboardRow";
import { DataViews } from "../dataviews/DataViews";
import type { DataRow } from "../dataviews/types";

/**
 * TASK-089 — Organization admin: ONE surface for one Organization.
 *
 * WHAT THIS IS. A user is admin of their own home Organization and a member of
 * any number of others by invitation. Everything that is scoped to an
 * Organization rather than to a Page — which Modules are installed, which
 * version of each is live, what each one is scoped to do, and who belongs —
 * lives here, reached from the Organization control at the top of the rail.
 * That control is the one slot ADR-180's closed left-nav scope grants outside
 * Modules / Intelligence / Settings, which is why there is no rail entry of
 * its own for this page.
 *
 * WHAT THIS IS NOT. It is not a per-Module page. The per-Module inventory
 * surface was deleted (ADR-224) and reviving it was explicitly rejected
 * (ADR-261): one Organization-scoped list of that Organization's Modules is
 * the whole surface, and nothing here links anywhere per-Module.
 *
 * HONEST ABOUT WHAT IT CANNOT DO. Installing and promoting a Module version is
 * a governed proposal through the Universal Action Pipeline (`modules.install`
 * / `modules.promote`), with human approval — there is no unmount procedure at
 * all. So mount state is REPORTED here, per version, and the footer says
 * plainly where the action lives instead of showing a control that would have
 * to fail (AP-021: interactive-looking UI performs, opens, or explains).
 */

const MODULE_SPEC: TableSpec = {
  id: "organization.modules",
  columns: [
    { id: "displayName", label: "Module", kind: "text" },
    { id: "moduleName", label: "Name", kind: "text" },
    { id: "moduleVersion", label: "Version", kind: "text" },
    { id: "mount", label: "Mount", kind: "text" },
    { id: "state", label: "State", kind: "text" },
    { id: "status", label: "Status", kind: "text" },
    { id: "plane", label: "Plane", kind: "text" },
    { id: "scopes", label: "Scopes", kind: "text" },
    { id: "governance", label: "Governance", kind: "text" },
    { id: "risk", label: "Risk", kind: "text" },
  ],
};

const MEMBER_SPEC: TableSpec = {
  id: "organization.members",
  columns: [
    { id: "email", label: "Email", kind: "text", required: true },
    { id: "name", label: "Name", kind: "text" },
    { id: "userId", label: "User", kind: "text" },
  ],
};

type ModuleRow = Awaited<ReturnType<typeof trpc.modules.list.query>>["items"][number];

/** Live for this Organization = the single promoted-to-available, installed row. */
function mountLabel(row: ModuleRow): string {
  if (row.state === "available" && row.status === "installed") return "Mounted";
  if (row.state === "promoted") return "Awaiting promotion";
  if (row.state === "legacy" || row.state === "deprecated") return "Superseded version";
  return "Not mounted";
}

/** Scopes = the permissions the Module's own capabilities declare. Counted,
 *  not invented: a Module that declares none says so. */
function scopeSummary(row: ModuleRow): string {
  const permissions = (row.manifest?.capabilities ?? []).flatMap((capability) => capability.permissions ?? []);
  if (permissions.length === 0) return "none declared";
  const egress = permissions.filter((permission) => permission.egress).length;
  const privateReads = permissions.filter((permission) => permission.dataScope !== "public").length;
  return `${permissions.length} · ${privateReads} private · ${egress} egress`;
}

/** A Module declares no plane of its own — its AGENTS do, one each. Report the
 *  distinct set rather than inventing a Module-level residency claim. */
function planeSummary(row: ModuleRow): string {
  const planes = [...new Set((row.manifest?.module?.agents ?? []).flatMap((agent) => (agent.plane ? [agent.plane] : [])))];
  return planes.length ? planes.join(", ") : "unspecified";
}

/** ADR-248: an absent policy is an honest empty state, never a default-deny. */
function governanceSummary(row: ModuleRow): string {
  const policy = row.manifest?.governance;
  if (!policy) return "none declared";
  return `${policy.allow.length} allow · ${policy.deny.length} deny`;
}

export function OrganizationAdminPage() {
  const [tab, setTab] = useState<"Modules" | "Members">("Modules");
  const [modules, setModules] = useState<ModuleRow[] | null>(null);
  const [members, setMembers] = useState<{ userId: string; email: string; name: string | null }[] | null>(null);
  const [organizationName, setOrganizationName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moduleView, setModuleView] = useState<ViewConfig>(() => defaultViewConfig(MODULE_SPEC.id));
  const [memberView, setMemberView] = useState<ViewConfig>(() => defaultViewConfig(MEMBER_SPEC.id));

  const load = useCallback(async () => {
    try {
      const [installed, memberRows, organizations] = await Promise.all([
        trpc.modules.list.query({ organizationId: PILOT_ORGANIZATION, limit: 200, offset: 0 }),
        trpc.organization.listMembers.query({ organizationId: PILOT_ORGANIZATION }),
        trpc.organization.list.query(),
      ]);
      setModules(installed.items);
      setMembers(memberRows);
      setOrganizationName(organizations.find((row) => row.id === PILOT_ORGANIZATION)?.name ?? null);
    } catch (failure) {
      setError(String(failure));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const moduleRows = useMemo<DataRow[]>(
    () =>
      (modules ?? []).map((row) => ({
        id: row.id,
        displayName: row.manifest?.module?.displayName ?? row.manifest?.name ?? row.moduleName,
        moduleName: row.moduleName,
        moduleVersion: row.moduleVersion,
        mount: mountLabel(row),
        state: row.state,
        status: row.status,
        plane: planeSummary(row),
        scopes: scopeSummary(row),
        governance: governanceSummary(row),
        risk: row.computedRisk,
      })),
    [modules],
  );

  const memberRows = useMemo<DataRow[]>(
    () => (members ?? []).map((row) => ({ id: row.userId, email: row.email, name: row.name ?? "", userId: row.userId })),
    [members],
  );

  const mounted = (modules ?? []).filter((row) => row.state === "available" && row.status === "installed").length;

  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden" style={{ backgroundColor: "var(--color-surface)" }}>
      <Header
        tabs={[
          { id: "Modules", icon: Boxes },
          { id: "Members", icon: Users },
        ]}
        activeTab={tab}
        onTabChange={(id) => setTab(id as "Modules" | "Members")}
      />
      {tab === "Modules" ? (
        <ModuleSurfaceLayout
          table={
            <section aria-label="Installed Modules" className="h-full">
              <DataViews
                spec={MODULE_SPEC}
                view={moduleView}
                data={moduleRows}
                searchPlaceholder="Search Modules…"
                insertDisabledReason="Installing a Module is a governed proposal (modules.install) with human approval — it is started from ＋New, not typed into this list."
                onViewChange={setModuleView}
                insights={
                  <DashboardRow
                    metrics={[
                      { id: "organization", label: "Organization", value: organizationName ?? "…" },
                      { id: "mounted", label: "Mounted", value: String(mounted) },
                      { id: "versions", label: "Versions on record", value: String(modules?.length ?? 0) },
                      { id: "members", label: "Members", value: String(members?.length ?? 0) },
                    ]}
                  />
                }
              />
            </section>
          }
          footer={
            <div
              className="border-t px-4 py-2 text-xs"
              style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}
            >
              Mounting a version runs through the governed install pipeline
              (<code>modules.install</code> → approval → <code>modules.promote</code>), so exactly one
              version of a Module is ever live in this Organization. Unmounting is not implemented:
              no procedure removes an installed Module yet, and this surface will not offer a control
              that cannot run.
            </div>
          }
        />
      ) : (
        <ModuleSurfaceLayout
          table={
            <section aria-label="Organization members" className="h-full">
              <DataViews
                spec={MEMBER_SPEC}
                view={memberView}
                data={memberRows}
                searchPlaceholder="Search members…"
                onViewChange={setMemberView}
                onInsert={async (draft) => {
                  const email = String(draft["email"] ?? "").trim();
                  if (!email) return;
                  // SEC-6 / AP-014: the invite is scoped-membership checked
                  // server-side; this surface adds no second authority path.
                  await trpc.organization.inviteMember.mutate({
                    organizationId: PILOT_ORGANIZATION,
                    email,
                  });
                  await load();
                }}
              />
            </section>
          }
          footer={
            <div
              className="border-t px-4 py-2 text-xs"
              style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}
            >
              You are admin of your home Organization and a member of any other by invitation.
              Membership here is flat — an invited member is a member of this Organization only.
            </div>
          }
        />
      )}
    </div>
  );
}

export default OrganizationAdminPage;
