import { createBrowserRouter } from "react-router";
import Layout from "./Layout";
import { DealPilotPage } from "./pages/DealPilotPage";
import { AgentCreate } from "./pages/AgentCreate";
import { AgentDetail } from "./pages/AgentDetail";
import { IntegrationDetail } from "./pages/IntegrationDetail";
import { GoogleIntegrationPanel } from "./pages/GoogleIntegrationPanel";
import { ApprovalsPage } from "./pages/ApprovalsPage";
import { JobPilotPage } from "./pages/JobPilotPage";
import { ResourcesPage } from "./pages/ResourcesPage";
import { PublicHelpdesk } from "./pages/PublicHelpdesk";
import { OrganizationPage } from "./pages/OrganizationPage";
import { ChiefOfStaffPage } from "./pages/ChiefOfStaffPage";
import { SettingsPage } from "./pages/SettingsPage";
import { PendingWorkPage } from "./pages/PendingWorkPage";
import { TaskManagerPage } from "./pages/TaskManagerPage";
// Ported prototype surface (faithful visual port, 2026-07-07)
import { HomePage } from "./pages/HomePage";
import { WorkPage } from "./pages/WorkPage";
import { ItemDetail } from "./pages/ItemDetail";
import { RecordDetail } from "./pages/RecordDetail";
import { ControlPanelPage } from "./pages/ControlPanelPage";
import { SecondBrainPage } from "./pages/SecondBrainPage";
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
      {
        path: "dealpilot",
        element: (
          <InstalledModuleBoundary moduleName="deal-pilot">
            <DealPilotPage />
          </InstalledModuleBoundary>
        ),
      },
      {
        path: "dealpilot/:page",
        element: (
          <InstalledModuleBoundary moduleName="deal-pilot">
            <DealPilotPage />
          </InstalledModuleBoundary>
        ),
      },
      {
        path: "dealpilot/:page/:recordId",
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
      { path: "module/relationship/signals/:signalId/event", Component: SignalSourceEventPage },
      { path: "module/relationship/signals/:signalId", Component: SignalDetailPage },
      { path: "module/relationship/people/:recordId", element: <RelationshipRecordDetailPage kind="person" /> },
      { path: "module/relationship/communities/:recordId", element: <RelationshipRecordDetailPage kind="community" /> },
      { path: "module/relationship/helpdesk/:ticketId", Component: RelationshipHelpdeskThreadPage },
      { path: "module/relationship/helpdesk", Component: RelationshipHelpdeskPage },
      { path: "module/relationship/relations", Component: RelationshipRelationsPage },
      { path: "module/relationship/interactions", Component: RelationshipInteractionsPage },
      { path: "module/relationship/introductions", Component: RelationshipIntroductionsPage },
      { path: "module/relationship/sources", Component: RelationshipSourcesPage },
      { path: "module/relationship/:page", Component: RelationshipPage },

      { path: "second-brain", Component: SecondBrainPage },
      { path: "item/:id", Component: ItemDetail },
      { path: "work", Component: WorkPage },
      { path: "record/:id", Component: RecordDetail },
      // Per-Record admin (ADR-029): platform admin = /settings, record
      // admin = its Control Panel. Strictly scoped to the one :id.
      { path: "record/:id/control-panel", Component: ControlPanelPage },
      { path: "agent/create", Component: AgentCreate },
      { path: "agent/:id", Component: AgentDetail },
      { path: "integration/:id", Component: IntegrationDetail },
      { path: "task-manager", Component: TaskManagerPage },

      { path: "approvals", Component: ApprovalsPage },

      { path: "agents/new", Component: AgentCreate },
      { path: "agents/update", Component: AgentDetail },

      { path: "integrations", Component: IntegrationDetail },
      { path: "integrations/google", Component: GoogleIntegrationPanel },

      {
        path: "jobpilot",
        element: (
          <InstalledModuleBoundary moduleName="job-pilot">
            <JobPilotPage />
          </InstalledModuleBoundary>
        ),
      },

      { path: "resources", Component: ResourcesPage },

      { path: "organization", Component: OrganizationPage },

      { path: "chief-of-staff", Component: ChiefOfStaffPage },

      { path: "settings", Component: SettingsPage },
      { path: "pending-work", Component: PendingWorkPage },
    ],
  },
]);
