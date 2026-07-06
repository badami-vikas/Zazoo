import { Link, Outlet } from "react-router";

/**
 * Minimal nav shell — proves routing end-to-end. NOT a port of the prototype's
 * Sidebar/AgentPanel (large components with their own data layer); that's a separate,
 * larger follow-up increment. See docs/raw/frontend-migration-scoping.md.
 */
export default function Layout() {
  const links = [
    { to: "/approvals", label: "Approvals" },
    { to: "/dealpilot", label: "DealPilot" },
    { to: "/tools", label: "Tools" },
    { to: "/rituals", label: "Rituals" },
    { to: "/calendar", label: "Calendar" },
    { to: "/jobpilot", label: "JobPilot" },
    { to: "/helpdesk", label: "Helpdesk" },
    { to: "/resources", label: "Resources" },
  ];
  return (
    <div className="flex h-screen w-full overflow-hidden font-sans">
      <nav className="w-48 shrink-0 border-r p-4 flex flex-col gap-2">
        {links.map((l) => (
          <Link key={l.to} to={l.to} className="text-sm hover:underline">
            {l.label}
          </Link>
        ))}
      </nav>
      <div className="flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  );
}
