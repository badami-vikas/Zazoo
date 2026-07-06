import { useEffect, useState } from "react";
import { Link, Outlet } from "react-router";
import { trpc, PILOT_WORKSPACE } from "./lib/trpc";
import { OnboardingDialog } from "./onboarding/OnboardingDialog";

/**
 * Minimal nav shell — proves routing end-to-end. NOT a port of the prototype's
 * Sidebar/AgentPanel (large components with their own data layer); that's a separate,
 * larger follow-up increment. See docs/raw/frontend-migration-scoping.md.
 *
 * Onboarding pop-up (docs/wiki/clients.md, roadmap.md P1): shown automatically
 * when `workspace.blueprint.get` reports no active workspace_definition yet —
 * checked once at mount. Also re-openable any time from the sidebar's "Set up
 * workspace" link, per the "dismissible, re-openable" requirement.
 */
export default function Layout() {
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [checkedOnboarding, setCheckedOnboarding] = useState(false);

  useEffect(() => {
    trpc.workspace.blueprint.get
      .query({ workspaceId: PILOT_WORKSPACE })
      .then((res) => {
        if (!res.definition) setOnboardingOpen(true);
      })
      .catch(() => {
        // Honest no-op: if the check itself fails (e.g. API unreachable), don't
        // force the modal open on top of an already-broken app shell.
      })
      .finally(() => setCheckedOnboarding(true));
  }, []);

  const links = [
    { to: "/approvals", label: "Approvals" },
    { to: "/chief-of-staff", label: "Chief of Staff" },
    { to: "/dealpilot", label: "DealPilot" },
    { to: "/tools", label: "Tools" },
    { to: "/rituals", label: "Rituals" },
    { to: "/calendar", label: "Calendar" },
    { to: "/jobpilot", label: "JobPilot" },
    { to: "/helpdesk", label: "Helpdesk" },
    { to: "/resources", label: "Resources" },
    { to: "/workspace", label: "Workspace" },
  ];
  return (
    <div className="flex h-screen w-full overflow-hidden font-sans">
      <nav className="w-48 shrink-0 border-r p-4 flex flex-col gap-2">
        {links.map((l) => (
          <Link key={l.to} to={l.to} className="text-sm hover:underline">
            {l.label}
          </Link>
        ))}
        <button
          type="button"
          className="text-sm text-left text-muted-foreground hover:underline mt-2 pt-2 border-t"
          onClick={() => setOnboardingOpen(true)}
        >
          Set up workspace…
        </button>
      </nav>
      <div className="flex-1 overflow-auto">
        <Outlet />
      </div>
      {checkedOnboarding && (
        <OnboardingDialog open={onboardingOpen} onOpenChange={setOnboardingOpen} onProposed={() => setOnboardingOpen(false)} />
      )}
    </div>
  );
}
