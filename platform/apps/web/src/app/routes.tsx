import { createBrowserRouter, Navigate } from "react-router";
import { requireBuiltInModule } from "@bridge/module-manifests";
import Layout from "./Layout";
import { DealPilotPage } from "./pages/DealPilotPage";
import { GoogleIntegrationPanel } from "./pages/GoogleIntegrationPanel";
import { ApprovalsPage } from "./pages/ApprovalsPage";
import { JobPilotPage } from "./pages/JobPilotPage";
import { PublicHelpdesk } from "./pages/PublicHelpdesk";
import { OrganizationPage } from "./pages/OrganizationPage";
import { ChiefOfStaffPage } from "./pages/ChiefOfStaffPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TaskManagerPage } from "./pages/TaskManagerPage";
import { TaskRecordDetailPage } from "./pages/TaskRecordDetailPage";
// Ported prototype surface (faithful visual port, 2026-07-07)
import { HomePage } from "./pages/HomePage";
import { SecondBrainPage } from "./pages/SecondBrainPage";
// AP-086 / ADR-154: Intelligence is its own top-level cross-Module capability page.
import { IntelligencePage } from "./pages/IntelligencePage";
// TASK-028: background Research Run timeline/interrupt Page (plan §5).
import { ResearchRunsPage } from "./pages/ResearchRunsPage";
// TASK-001 / VOCAB6: manifest-driven Module Detail (§4b)
import { ModuleDetailPage } from "./pages/ModuleDetailPage";
import { InstalledModuleBoundary } from "./components/InstalledModuleBoundary";
import {
  RelationshipPage,
  RelationshipRecordDetailPage,
  SignalDetailPage,
  SignalSourceEventPage,
} from "./pages/RelationshipPage";
import {
  RelationshipHelpdeskPage,
  RelationshipHelpdeskThreadPage,
} from "./pages/RelationshipHelpdeskPage";
import { RelationshipSubmodulePage } from "./pages/RelationshipSubmodulePage";
import { AuthGate } from "./auth/AuthSession";
import { AuthPage } from "./auth/AuthPage";

function ProtectedLayout() {
  return (
    <AuthGate>
      <Layout />
    </AuthGate>
  );
}

function RelationshipRelationsPage() {
  return <RelationshipSubmodulePage submodule="relations" />;
}

function RelationshipInteractionsPage() {
  return <RelationshipSubmodulePage submodule="interactions" />;
}

function RelationshipIntroductionsPage() {
  return <RelationshipSubmodulePage submodule="introductions" />;
}

function RelationshipSourcesPage() {
  return <RelationshipSubmodulePage submodule="sources" />;
}

function childPath(route: string): string {
  return route.replace(/^\//, "");
}

function parentRoute(route: string): string {
  const segments = route.split("/").filter(Boolean);
  return `/${segments.slice(0, -1).join("/")}`;
}

const dealPilotModule = requireBuiltInModule("deal-pilot").manifest.module!;
const jobPilotModule = requireBuiltInModule("job-pilot").manifest.module!;
const relationshipModule = requireBuiltInModule("relationship").manifest.module!;
const dealPilotRoot = parentRoute(dealPilotModule.route);
const relationshipSignalsRoute = relationshipModule.pages.find((page) => page.id === "signals")!.route;

const dealPilotRoutes = dealPilotModule.pages.map((page) => ({
  path: childPath(page.route),
  element: (
    <InstalledModuleBoundary moduleName="deal-pilot">
      <DealPilotPage />
    </InstalledModuleBoundary>
  ),
}));

export const router = createBrowserRouter([
  // Public/unauthenticated — outside Layout's authenticated nav shell entirely
  // (frontend-migration-scoping.md gap #5: a genuinely different auth model).
  { path: "/help", Component: PublicHelpdesk },
  // Prototype's shareable public helpdesk URL shape (slug-addressed).
  { path: "/help/:slug", Component: PublicHelpdesk },
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
      // HomePage is the index (prototype parity); DealPilot keeps /dealpilot.
      { index: true, Component: HomePage },
      { path: "home", Component: HomePage },
      ...dealPilotRoutes,
      {
        path: `${childPath(dealPilotRoot)}/:page/:recordId`,
        element: (
          <InstalledModuleBoundary moduleName="deal-pilot">
            <DealPilotPage />
          </InstalledModuleBoundary>
        ),
      },

      // TASK-001 / VOCAB6: manifest-driven Module Detail surface (§4b).
      // Route param = moduleName (e.g. "deal-pilot", "job-pilot"). Every
      // installed Module in the left nav links here.
      { path: "module/:moduleId", Component: ModuleDetailPage },
      { path: `${childPath(relationshipSignalsRoute)}/:signalId/event`, Component: SignalSourceEventPage },
      { path: `${childPath(relationshipSignalsRoute)}/:signalId`, Component: SignalDetailPage },
      { path: `${childPath(relationshipModule.route)}/people/:recordId`, element: <RelationshipRecordDetailPage kind="person" /> },
      { path: `${childPath(relationshipModule.route)}/communities/:recordId`, element: <RelationshipRecordDetailPage kind="community" /> },
      { path: `${childPath(relationshipModule.route)}/helpdesk/:ticketId`, Component: RelationshipHelpdeskThreadPage },
      { path: `${childPath(relationshipModule.route)}/helpdesk`, Component: RelationshipHelpdeskPage },
      { path: `${childPath(relationshipModule.route)}/relations`, Component: RelationshipRelationsPage },
      { path: `${childPath(relationshipModule.route)}/interactions`, Component: RelationshipInteractionsPage },
      { path: `${childPath(relationshipModule.route)}/introductions`, Component: RelationshipIntroductionsPage },
      { path: `${childPath(relationshipModule.route)}/sources`, Component: RelationshipSourcesPage },
      { path: `${childPath(relationshipModule.route)}/:page`, Component: RelationshipPage },

      { path: "second-brain", Component: SecondBrainPage },
      { path: "research", Component: ResearchRunsPage },
      { path: "intelligence", Component: IntelligencePage },
      { path: "task-manager", Component: TaskManagerPage },
      { path: "task-manager/:taskId", Component: TaskRecordDetailPage },

      { path: "approvals", Component: ApprovalsPage },

      { path: "integrations/google", Component: GoogleIntegrationPanel },

      {
        path: childPath(jobPilotModule.route),
        element: (
          <InstalledModuleBoundary moduleName="job-pilot">
            <JobPilotPage />
          </InstalledModuleBoundary>
        ),
      },

      { path: "organization", Component: OrganizationPage },

      { path: "chief-of-staff", Component: ChiefOfStaffPage },

      { path: "settings", Component: SettingsPage },
      { path: "pending-work", element: <Navigate to="/task-manager" replace /> },
    ],
  },
]);
