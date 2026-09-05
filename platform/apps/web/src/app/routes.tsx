import { lazy, Suspense, useEffect, useState } from "react";
import { createBrowserRouter, Navigate, useParams, type RouteObject } from "react-router";
import { moduleNavTarget, requireBuiltInModule } from "@bridge/module-manifests";
import Layout from "./Layout";
import { ApprovalsPage } from "./pages/ApprovalsPage";
import { OrganizationPage } from "./pages/OrganizationPage";
// TASK-089: the Organization's own admin surface — its installed Modules,
// their mount state/scopes/versions, and its membership. Reached from the
// Organization control at the top of the rail (ADR-180's one granted slot),
// never as a per-Module page (ADR-224/261).
import { OrganizationAdminPage } from "./pages/OrganizationAdminPage";
import { ChiefOfStaffPage } from "./pages/ChiefOfStaffPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TaskManagerPage } from "./pages/TaskManagerPage";
import { TaskRecordDetailPage } from "./pages/TaskRecordDetailPage";
// Ported prototype surface (faithful visual port, 2026-07-07)
import { HomePage } from "./pages/HomePage";
// AP-086 / ADR-154: Intelligence is its own top-level cross-Module capability page.
import { IntelligencePage } from "./pages/IntelligencePage";
import { AgentDetailPage } from "./pages/AgentDetailPage";
// TASK-028: background Research Run timeline/interrupt Page (plan §5).
import { ResearchRunsPage } from "./pages/ResearchRunsPage";
// ADR 2026-09-04: the standard Module Page — every manifest-declared Page of
// an installed Module renders here, Builder-built Modules included.
import { ModulePage, modulePageRoute } from "./pages/ModulePage";
import { ModuleRecordDetailPage } from "./pages/ModuleRecordDetailPage";
import { InstalledModuleBoundary } from "./components/InstalledModuleBoundary";
import { PILOT_ORGANIZATION, trpc } from "./lib/trpc";
import { AuthGate } from "./auth/AuthSession";
import { AuthPage } from "./auth/AuthPage";

/**
 * Egg profile (ADR 2026-09-04 "The Egg ships the kernel; Modules live in
 * Commons"). `VITE_BRIDGE_PROFILE=egg` at BUILD time drops every Commons
 * Module Page from the bundle: the routes below are behind this constant, so
 * the bundler never reaches their dynamic imports and emits no chunk for them.
 * In the full profile the same Pages load as lazy chunks on first visit.
 */
const EGG = import.meta.env.VITE_BRIDGE_PROFILE === "egg";

function ProtectedLayout() {
  return (
    <AuthGate>
      <Layout />
    </AuthGate>
  );
}

function childPath(route: string): string {
  return route.replace(/^\//, "");
}

function parentRoute(route: string): string {
  const segments = route.split("/").filter(Boolean);
  return `/${segments.slice(0, -1).join("/")}`;
}

/**
 * `/module/:name` → that Module's own landing Page. Not a surface of its own:
 * it renders nothing and immediately redirects, so Module Detail stays
 * deleted while links to a Module root keep resolving. A Module that declares
 * no Page has nowhere of its own to land, so it falls back to Home.
 */
function ModuleRootRedirect() {
  const { moduleId } = useParams();
  const builtIn = moduleId ? moduleNavTarget(moduleId)?.landing : undefined;
  // A Module the Builder made is in no built-in catalog: its landing Page is
  // the first Page its INSTALLED manifest declares (ADR 2026-09-04).
  const [installed, setInstalled] = useState<string | null | undefined>(
    builtIn === undefined ? undefined : null,
  );
  useEffect(() => {
    if (builtIn !== undefined || !moduleId) return;
    let cancelled = false;
    trpc.modules.list
      .query({ organizationId: PILOT_ORGANIZATION, limit: 100, offset: 0 })
      .then((result) => {
        if (cancelled) return;
        const page = result.items.find((item) => item.moduleName === moduleId)?.manifest?.module
          ?.pages[0];
        setInstalled(page ? modulePageRoute(moduleId, page.id) : null);
      })
      .catch(() => {
        if (!cancelled) setInstalled(null);
      });
    return () => {
      cancelled = true;
    };
  }, [builtIn, moduleId]);
  if (builtIn !== undefined) return <Navigate to={builtIn} replace />;
  if (installed === undefined) return null;
  return <Navigate to={installed ?? "/home"} replace />;
}

/**
 * The Commons Modules' Pages. Everything in here is a lazy chunk, and the
 * whole function is unreachable in the Egg build — see `EGG` above.
 */
function commonsModulePublicRoutes(): RouteObject[] {
  const PublicHelpdesk = lazy(() =>
    import("./pages/PublicHelpdesk").then((m) => ({ default: m.PublicHelpdesk })),
  );
  const helpdesk = (
    <Suspense fallback={null}>
      <PublicHelpdesk />
    </Suspense>
  );
  return [
    // Public/unauthenticated — outside Layout's authenticated nav shell entirely
    // (frontend-migration-scoping.md gap #5: a genuinely different auth model).
    { path: "/help", element: helpdesk },
    // Prototype's shareable public helpdesk URL shape (slug-addressed).
    { path: "/help/:slug", element: helpdesk },
  ];
}

function commonsModuleRoutes(): RouteObject[] {
  const DealPilotPage = lazy(() =>
    import("./pages/DealPilotPage").then((m) => ({ default: m.DealPilotPage })),
  );
  const JobPilotPage = lazy(() =>
    import("./pages/JobPilotPage").then((m) => ({ default: m.JobPilotPage })),
  );
  const AccountingPage = lazy(() =>
    import("./pages/AccountingPage").then((m) => ({ default: m.AccountingPage })),
  );
  const D2COrdersPage = lazy(() =>
    import("./pages/D2CPage").then((m) => ({ default: m.D2COrdersPage })),
  );
  const D2CInventoryPage = lazy(() =>
    import("./pages/D2CPage").then((m) => ({ default: m.D2CInventoryPage })),
  );
  const D2CResearchPage = lazy(() =>
    import("./pages/D2CResearchPage").then((m) => ({ default: m.D2CResearchPage })),
  );
  const D2CNotesPage = lazy(() =>
    import("./pages/D2CNotesPage").then((m) => ({ default: m.D2CNotesPage })),
  );
  // WhatsApp Module: the live session surface plus its Tool list.
  const WhatsAppPage = lazy(() =>
    import("./pages/WhatsAppPage").then((m) => ({ default: m.WhatsAppPage })),
  );
  const EventsPage = lazy(() =>
    import("./pages/EventsPage").then((m) => ({ default: m.EventsPage })),
  );
  // DevPilot Module (D0/D1): Pull Requests/Issues/Repos Pages plus the GitHub
  // Personal Access Token connection panel.
  const DevPilotPage = lazy(() =>
    import("./pages/DevPilotPage").then((m) => ({ default: m.DevPilotPage })),
  );
  const GithubIntegrationPanel = lazy(() =>
    import("./pages/GithubIntegrationPanel").then((m) => ({ default: m.GithubIntegrationPanel })),
  );
  const GoogleIntegrationPanel = lazy(() =>
    import("./pages/GoogleIntegrationPanel").then((m) => ({ default: m.GoogleIntegrationPanel })),
  );
  const RelationshipPage = lazy(() =>
    import("./pages/RelationshipPage").then((m) => ({ default: m.RelationshipPage })),
  );
  const RelationshipRecordDetailPage = lazy(() =>
    import("./pages/RelationshipPage").then((m) => ({ default: m.RelationshipRecordDetailPage })),
  );
  const SignalDetailPage = lazy(() =>
    import("./pages/RelationshipPage").then((m) => ({ default: m.SignalDetailPage })),
  );
  const SignalSourceEventPage = lazy(() =>
    import("./pages/RelationshipPage").then((m) => ({ default: m.SignalSourceEventPage })),
  );
  const RelationshipHelpdeskPage = lazy(() =>
    import("./pages/RelationshipHelpdeskPage").then((m) => ({ default: m.RelationshipHelpdeskPage })),
  );
  const RelationshipHelpdeskThreadPage = lazy(() =>
    import("./pages/RelationshipHelpdeskPage").then((m) => ({ default: m.RelationshipHelpdeskThreadPage })),
  );
  const RelationshipSubmodulePage = lazy(() =>
    import("./pages/RelationshipSubmodulePage").then((m) => ({ default: m.RelationshipSubmodulePage })),
  );

  const dealPilotModule = requireBuiltInModule("deal-pilot").manifest.module!;
  const jobPilotModule = requireBuiltInModule("job-pilot").manifest.module!;
  const relationshipModule = requireBuiltInModule("relationship").manifest.module!;
  const eventsModule = requireBuiltInModule("events").manifest.module!;
  const accountingModule = requireBuiltInModule("accounting").manifest.module!;
  const d2cModule = requireBuiltInModule("d2c").manifest.module!;
  const d2cResearchModule = requireBuiltInModule("d2c-research").manifest.module!;
  const d2cNotesModule = requireBuiltInModule("d2c-notes").manifest.module!;
  const dealPilotRoot = parentRoute(dealPilotModule.route);
  const relationshipSignalsRoute = relationshipModule.pages.find((page) => page.id === "signals")!.route;

  const dealPilotRoutes: RouteObject[] = dealPilotModule.pages.map((page) => ({
    path: childPath(page.route),
    element: (
      <InstalledModuleBoundary moduleName="deal-pilot">
        <DealPilotPage />
      </InstalledModuleBoundary>
    ),
  }));

  return [
    // DealPilot keeps /dealpilot.
    ...dealPilotRoutes,
    {
      path: `${childPath(dealPilotRoot)}/:page/:recordId`,
      element: (
        <InstalledModuleBoundary moduleName="deal-pilot">
          <DealPilotPage />
        </InstalledModuleBoundary>
      ),
    },

    // WhatsApp Module Pages. The Module lands on Chats; /module/whatsapp
    // alone redirects there rather than showing the capability inventory.
    { path: "module/whatsapp", element: <Navigate to="/module/whatsapp/chats" replace /> },
    { path: "module/whatsapp/chats", element: <WhatsAppPage page="chats" /> },
    { path: "module/whatsapp/tools", element: <WhatsAppPage page="tools" /> },

    // Academics (TASK-069) has no Page code: its three declared Databases
    // render on the standard `module/:moduleName/:pageId` Module Page below.
    // Events sub-module of NetworkManager (TASK-070, ADR-236) — one Page.
    { path: childPath(eventsModule.route), Component: EventsPage },

    // DevPilot Module Pages (D0/D1). Lands on Pull Requests; /module/devpilot
    // alone redirects there rather than showing the capability inventory.
    { path: "module/devpilot", element: <Navigate to="/module/devpilot/pulls" replace /> },
    { path: "module/devpilot/pulls", element: <DevPilotPage page="pulls" /> },
    { path: "module/devpilot/issues", element: <DevPilotPage page="issues" /> },
    { path: "module/devpilot/repos", element: <DevPilotPage page="repos" /> },

    { path: `${childPath(relationshipSignalsRoute)}/:signalId/event`, Component: SignalSourceEventPage },
    { path: `${childPath(relationshipSignalsRoute)}/:signalId`, Component: SignalDetailPage },
    { path: `${childPath(relationshipModule.route)}/people/:recordId`, element: <RelationshipRecordDetailPage kind="person" /> },
    { path: `${childPath(relationshipModule.route)}/communities/:recordId`, element: <RelationshipRecordDetailPage kind="community" /> },
    { path: `${childPath(relationshipModule.route)}/helpdesk/:ticketId`, Component: RelationshipHelpdeskThreadPage },
    { path: `${childPath(relationshipModule.route)}/helpdesk`, Component: RelationshipHelpdeskPage },
    { path: `${childPath(relationshipModule.route)}/relations`, element: <RelationshipSubmodulePage submodule="relations" /> },
    { path: `${childPath(relationshipModule.route)}/interactions`, element: <RelationshipSubmodulePage submodule="interactions" /> },
    { path: `${childPath(relationshipModule.route)}/introductions`, element: <RelationshipSubmodulePage submodule="introductions" /> },
    { path: `${childPath(relationshipModule.route)}/sources`, element: <RelationshipSubmodulePage submodule="sources" /> },
    { path: `${childPath(relationshipModule.route)}/:page`, Component: RelationshipPage },

    { path: "integrations/google", Component: GoogleIntegrationPanel },
    { path: "integrations/github", Component: GithubIntegrationPanel },

    {
      path: childPath(jobPilotModule.route),
      element: (
        <InstalledModuleBoundary moduleName="job-pilot">
          <JobPilotPage />
        </InstalledModuleBoundary>
      ),
    },

    // Accounting Module (TASK-074, ADR-246) — Clients and Reports Pages,
    // both real sqlite-backed (accounting-store.ts). `/module/accounting`
    // alone resolves via the generic ModuleRootRedirect.
    { path: childPath(accountingModule.pages.find((p) => p.id === "clients")!.route), element: <AccountingPage page="clients" /> },
    { path: childPath(accountingModule.pages.find((p) => p.id === "reports")!.route), element: <AccountingPage page="reports" /> },

    // D2C Module (TASK-074, ADR-246) — Orders/Inventory toggle Pages plus
    // the Research/Notes sub-modules, all real sqlite-backed (d2c-store.ts).
    { path: childPath(d2cModule.pages.find((p) => p.id === "orders")!.route), element: <D2COrdersPage /> },
    { path: childPath(d2cModule.pages.find((p) => p.id === "inventory")!.route), element: <D2CInventoryPage /> },
    { path: childPath(d2cResearchModule.route), element: <D2CResearchPage /> },
    { path: childPath(d2cNotesModule.route), element: <D2CNotesPage /> },
  ];
}

export const router = createBrowserRouter([
  ...(EGG ? [] : commonsModulePublicRoutes()),
  { path: "/auth/sign-in", element: <AuthPage mode="sign-in" /> },
  { path: "/auth/sign-up", element: <AuthPage mode="sign-up" /> },
  {
    path: "/auth/forgot-password",
    element: <AuthPage mode="forgot-password" />,
  },
  {
    path: "/auth/reset-password",
    element: <AuthPage mode="reset-password" />,
  },

  {
    path: "/",
    Component: ProtectedLayout,
    children: [
      // HomePage is the index (prototype parity).
      { index: true, Component: HomePage },
      { path: "home", Component: HomePage },

      ...(EGG ? [] : commonsModuleRoutes()),

      // Module Detail was removed 2026-08-10 (user directive: "There is no
      // module detail page. Delete it. Ensure no trace of it remains."). The
      // PAGE is gone; the bare `/module/:name` PATH still resolves, as a pure
      // redirect to that Module's landing Page. Deleting the path outright
      // (the first cut of this change) stranded every existing link to a
      // Module root — e.g. RelationshipHelpdeskPage's "/module/relationship"
      // back-link — on a blank router miss. A redirect keeps those links
      // working without reintroducing a detail surface.
      { path: "module/:moduleId", Component: ModuleRootRedirect },
      // The standard Module Page (ADR 2026-09-04). Declared AFTER the Commons
      // Module routes so a built-in's hand-written Page at the same shape
      // (e.g. /module/whatsapp/chats) keeps winning in the full profile.
      { path: "module/:moduleName/:pageId", Component: ModulePage },
      // The standard Record detail page of a declared Page (TASK-100, C-15).
      { path: "module/:moduleName/:pageId/:recordId", Component: ModuleRecordDetailPage },

      // Second Brain is Intelligence's first tab, not a surface of its own
      // (ADR-224). The path stays so existing links keep working, but it
      // redirects — two routes rendering the same graph is how the rail and the
      // tab strip drifted apart in the first place.
      { path: "second-brain", element: <Navigate to="/intelligence" replace /> },
      { path: "research", Component: ResearchRunsPage },
      { path: "intelligence", Component: IntelligencePage },
      // Agent Detail is reached from its card on Intelligence (ADR-250).
      { path: "agent/:moduleName/:agentId", Component: AgentDetailPage },
      { path: "task-manager", Component: TaskManagerPage },
      { path: "task-manager/:taskId", Component: TaskRecordDetailPage },

      { path: "approvals", Component: ApprovalsPage },

      { path: "organization", Component: OrganizationPage },
      { path: "organization/admin", Component: OrganizationAdminPage },

      { path: "chief-of-staff", Component: ChiefOfStaffPage },

      { path: "settings", Component: SettingsPage },
      { path: "pending-work", element: <Navigate to="/task-manager" replace /> },
    ],
  },
]);
